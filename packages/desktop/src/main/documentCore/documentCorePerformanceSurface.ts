import {
  WireEnvelopeCodecV1,
  decodeFileSnapshot
} from '@marktext/document-core'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  DocumentCoreExecutionReport,
  DocumentCoreOpenCompletion,
  DocumentCorePublication
} from '../../shared/types/documentCore'
import { documentParseConfigurationFor } from './documentParseConfiguration'
import type { DocumentCoreFileHost } from './documentFileHost'
import {
  decodeDocumentCorePublication,
  type DocumentCoreMainSessionHost
} from './mainSessionHost'

interface StagedFile {
  readonly ownerId: string
  readonly documentId: string
  readonly durabilityKey: string
  readonly ticketId: string
  readonly executionThreadId: number
  readonly sourceLength: number
  readonly ticketAdmissionMs: number
  readonly maximumMainStageMs: number
}

export interface DocumentCorePerformanceSurface {
  /**
   * The latest execution report main returned to the renderer for this
   * document, or null before the first recorded operation.
   */
  readonly readLastExecution: (
    documentId: string
  ) => DocumentCoreExecutionReport | null
  /**
   * The latest dispatch-kind execution report for this document. A select
   * that follows a keystroke's dispatch cannot mask it here.
   */
  readonly readLastDispatchExecution: (
    documentId: string
  ) => DocumentCoreExecutionReport | null
  /** The attach-kind twin of readLastDispatchExecution. */
  readonly readLastAttachExecution: (
    documentId: string
  ) => DocumentCoreExecutionReport | null
  /**
   * Length and boundary units of the canonical head, computed main-side so
   * a maximum document's source never crosses the automation boundary. The
   * read leases and releases without persisting, leaving history untouched.
   */
  readonly readSourceStats: (
    documentId: string
  ) => Promise<Readonly<{
    readonly length: number
    readonly firstUnit: number
    readonly lastUnit: number
  }>>
  readonly readAdmission: (
    documentId: string
  ) => Readonly<{
    readonly admission: DocumentCoreOpenCompletion
    readonly ticketAdmissionMs: number
    readonly maximumMainStageMs: number
    readonly resources: ReturnType<DocumentCoreMainSessionHost['resourceCounts']>
  }>
  readonly runFileAdmission: (
    pathname: string
  ) => Promise<Readonly<{
    readonly sourceLength: number
    readonly executionThreadId: number
    readonly ticketAdmissionMs: number
    readonly maximumMainStageMs: number
    readonly terminalMs: number
    readonly admission: DocumentCoreOpenCompletion
    readonly resourcesAfterClose:
    ReturnType<DocumentCoreMainSessionHost['resourceCounts']>
  }>>
  readonly cancelFileAdmission: (
    pathname: string
  ) => Promise<Readonly<{
    readonly sourceLength: number
    readonly executionThreadId: number
    readonly ticketAdmissionMs: number
    readonly maximumMainStageMs: number
    readonly cancellationMs: number
    readonly terminalAfterCancellationMs: number
    readonly cancellationKind: string
    readonly checkpointObserved: boolean
    readonly terminalStatus: 'fulfilled' | 'rejected'
    readonly resources: ReturnType<DocumentCoreMainSessionHost['resourceCounts']>
  }>>
  readonly cancelDispatchAndRecoverFile: (
    pathname: string
  ) => Promise<Readonly<{
    readonly sourceLength: number
    readonly executionThreadId: number
    readonly ticketAdmissionMs: number
    readonly maximumMainStageMs: number
    readonly cancellationMs: number
    readonly terminalAfterCancellationMs: number
    readonly cancellationKind: string
    readonly cancelledStayedOnBase: boolean
    readonly cancelledExecution: DocumentCoreExecutionReport
    readonly recoveredExecution: DocumentCoreExecutionReport
    readonly recoveredSourceLength: number
    readonly recoveredThreadMatches: boolean
    readonly resourcesAfterClose:
    ReturnType<DocumentCoreMainSessionHost['resourceCounts']>
  }>>
}

const configuration = documentParseConfigurationFor(Object.freeze({
  footnotes: false,
  gitLabMath: false,
  subscriptAndSuperscript: true
}))

function publication(
  value: DocumentCoreOpenCompletion | DocumentCorePublication,
  label: string
): DocumentCorePublication {
  if (!('envelope' in value)) {
    throw new TypeError(`${label} returned no verified publication`)
  }
  return value
}

function completion(
  value: DocumentCoreOpenCompletion | DocumentCorePublication,
  label: string
): DocumentCoreOpenCompletion {
  if ('envelope' in value) {
    throw new TypeError(`${label} returned an unexpected publication`)
  }
  return value
}

function exactPath(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 32_768 ||
    !path.isAbsolute(value)
  ) {
    throw new TypeError('Performance file path must be a bounded absolute path')
  }
  return path.resolve(value)
}

export function createDocumentCorePerformanceSurface(
  sessions: DocumentCoreMainSessionHost,
  files: DocumentCoreFileHost,
  recordedExecution: (documentId: string) => Readonly<{
    readonly ownerId: string
    readonly execution: DocumentCoreExecutionReport
    readonly dispatchExecution: DocumentCoreExecutionReport | null
    readonly attachExecution: DocumentCoreExecutionReport | null
  }> | undefined
): DocumentCorePerformanceSurface {
  const stageFile = async(pathname: string): Promise<StagedFile> => {
    const resolved = exactPath(pathname)
    const bytes = await readFile(resolved)
    const snapshot = decodeFileSnapshot(bytes, 'utf-8')
    const operationId = randomUUID()
    const ownerId = `performance-owner:${operationId}`
    const documentId = `performance-document:${operationId}`
    const durabilityKey = `performance-journal:${operationId}`
    const ticketStartedAt = performance.now()
    const ticket = await sessions.startOpen(ownerId, {
      documentId,
      durabilityKey,
      sourceLength: snapshot.source.text.length,
      parseConfiguration: configuration
    })
    const ticketAdmissionMs = performance.now() - ticketStartedAt
    if (!ticket.requiresSource) {
      throw new Error('Performance file unexpectedly reused a session')
    }
    let maximumMainStageMs = 0
    let ordinal = 0
    for (
      let start = 0;
      start < snapshot.source.text.length;
      start += ticket.chunkUnits
    ) {
      const callerStageStartedAt = performance.now()
      const text = snapshot.source.text.slice(start, start + ticket.chunkUnits)
      const staged = sessions.appendOpenChunk(
        ownerId,
        documentId,
        ticket.ticketId,
        ordinal,
        text
      )
      const callerStageMs = performance.now() - callerStageStartedAt
      const receipt = await staged
      maximumMainStageMs = Math.max(
        maximumMainStageMs,
        callerStageMs,
        receipt.mainStageMs
      )
      ordinal += 1
    }
    return Object.freeze({
      ownerId,
      documentId,
      durabilityKey,
      ticketId: ticket.ticketId,
      executionThreadId: ticket.executionThreadId,
      sourceLength: snapshot.source.text.length,
      ticketAdmissionMs,
      maximumMainStageMs
    })
  }

  const attach = async(
    staged: StagedFile
  ): Promise<DocumentCorePublication> => {
    const ticket = await sessions.startOpen(staged.ownerId, {
      documentId: staged.documentId,
      durabilityKey: staged.durabilityKey,
      sourceLength: 0,
      parseConfiguration: configuration
    })
    if (ticket.requiresSource) {
      throw new Error('Completed performance file requested source on attach')
    }
    return publication(
      await sessions.completeOpen(
        staged.ownerId,
        staged.documentId,
        ticket.ticketId
      ),
      'Performance attachment'
    )
  }

  const runFileAdmission:
  DocumentCorePerformanceSurface['runFileAdmission'] =
    async(pathname) => {
      const staged = await stageFile(pathname)
      const terminalStartedAt = performance.now()
      const admission = completion(
        await sessions.completeOpen(
          staged.ownerId,
          staged.documentId,
          staged.ticketId
        ),
        'Performance admission'
      )
      const terminalMs = performance.now() - terminalStartedAt
      await sessions.close(staged.ownerId, staged.documentId)
      return Object.freeze({
        sourceLength: staged.sourceLength,
        executionThreadId: staged.executionThreadId,
        ticketAdmissionMs: staged.ticketAdmissionMs,
        maximumMainStageMs: staged.maximumMainStageMs,
        terminalMs,
        admission,
        resourcesAfterClose: sessions.resourceCounts()
      })
    }

  const cancelFileAdmission:
  DocumentCorePerformanceSurface['cancelFileAdmission'] =
    async(pathname) => {
      const staged = await stageFile(pathname)
      const terminal = sessions.completeOpen(
        staged.ownerId,
        staged.documentId,
        staged.ticketId
      )
      const terminalStatus = terminal.then(
        () => 'fulfilled' as const,
        () => 'rejected' as const
      )
      await new Promise<void>(resolve => setImmediate(resolve))
      const cancellationStartedAt = performance.now()
      const cancelled = await sessions.cancelOpen(
        staged.ownerId,
        staged.documentId,
        staged.ticketId
      )
      const cancellationMs = performance.now() - cancellationStartedAt
      const settledStatus = await terminalStatus
      return Object.freeze({
        sourceLength: staged.sourceLength,
        executionThreadId: staged.executionThreadId,
        ticketAdmissionMs: staged.ticketAdmissionMs,
        maximumMainStageMs: staged.maximumMainStageMs,
        cancellationMs,
        terminalAfterCancellationMs:
          performance.now() - cancellationStartedAt,
        cancellationKind: cancelled.kind,
        checkpointObserved:
          cancelled.kind === 'cancelled' &&
          cancelled.checkpointObserved,
        terminalStatus: settledStatus,
        resources: sessions.resourceCounts()
      })
    }

  const cancelDispatchAndRecoverFile:
  DocumentCorePerformanceSurface['cancelDispatchAndRecoverFile'] =
    async(pathname) => {
      const staged = await stageFile(pathname)
      completion(
        await sessions.completeOpen(
          staged.ownerId,
          staged.documentId,
          staged.ticketId
        ),
        'Dispatch performance admission'
      )
      const attached = await attach(staged)
      const codec = new WireEnvelopeCodecV1()
      const mounted = decodeDocumentCorePublication(
        codec.publish(attached.envelope, attached.baseSnapshotId)
      )
      if (mounted.kind !== 'complete') {
        throw new Error('Dispatch performance file entered SourceOnly')
      }
      const caret = Object.freeze({
        offset: mounted.modelText.length,
        affinity: 'next' as const
      })
      const intent = Object.freeze({
        kind: 'insert-text' as const,
        target: Object.freeze({
          ...mounted.selection,
          anchor: caret,
          focus: caret
        }),
        text: '!'
      })
      const ticket = await sessions.startDispatch(staged.ownerId, {
        documentId: staged.documentId,
        baseSnapshotId: mounted.snapshotId,
        intent
      })
      const terminal = sessions.completeDispatch(
        staged.ownerId,
        staged.documentId,
        ticket.ticketId
      )
      const cancellationStartedAt = performance.now()
      const cancelled = await sessions.cancelDispatch(
        staged.ownerId,
        staged.documentId,
        ticket.ticketId
      )
      const cancellationMs = performance.now() - cancellationStartedAt
      const cancelledTerminal = await terminal
      const terminalAfterCancellationMs =
        performance.now() - cancellationStartedAt
      const recoveredPublication = await sessions.dispatch(staged.ownerId, {
        documentId: staged.documentId,
        baseSnapshotId: cancelledTerminal.envelope.nextSnapshotId,
        intent
      })
      const recovered = decodeDocumentCorePublication(
        codec.publish(
          recoveredPublication.envelope,
          recoveredPublication.baseSnapshotId
        ),
        mounted
      )
      await sessions.close(staged.ownerId, staged.documentId)
      return Object.freeze({
        sourceLength: staged.sourceLength,
        executionThreadId: staged.executionThreadId,
        ticketAdmissionMs: staged.ticketAdmissionMs,
        maximumMainStageMs: staged.maximumMainStageMs,
        cancellationMs,
        terminalAfterCancellationMs,
        cancellationKind: cancelled.kind,
        cancelledStayedOnBase:
          cancelledTerminal.envelope.nextSnapshotId === mounted.snapshotId,
        cancelledExecution: cancelledTerminal.execution,
        recoveredExecution: recoveredPublication.execution,
        recoveredSourceLength: recovered.source.length,
        recoveredThreadMatches:
          cancelledTerminal.execution.executionThreadId ===
            staged.executionThreadId &&
          recoveredPublication.execution.executionThreadId ===
            staged.executionThreadId,
        resourcesAfterClose: sessions.resourceCounts()
      })
    }

  return Object.freeze({
    readLastExecution: (
      documentId: string
    ): DocumentCoreExecutionReport | null =>
      recordedExecution(documentId)?.execution ?? null,
    readLastDispatchExecution: (
      documentId: string
    ): DocumentCoreExecutionReport | null =>
      recordedExecution(documentId)?.dispatchExecution ?? null,
    readLastAttachExecution: (
      documentId: string
    ): DocumentCoreExecutionReport | null =>
      recordedExecution(documentId)?.attachExecution ?? null,
    readSourceStats: async(documentId: string) => {
      const recorded = recordedExecution(documentId)
      if (recorded === undefined) {
        throw new Error(
          `No recorded owner for document ${documentId}`
        )
      }
      const lease = await sessions.preparePersistence(
        recorded.ownerId,
        documentId,
        'save'
      )
      await sessions.releasePersistence(
        recorded.ownerId,
        documentId,
        lease.leaseId
      )
      const source = lease.source
      return Object.freeze({
        length: source.length,
        firstUnit: source.charCodeAt(0),
        lastUnit: source.charCodeAt(source.length - 1)
      })
    },
    readAdmission: (documentId: string) => {
      const staging = files.readAdmissionPerformance(documentId)
      return Object.freeze({
        admission: files.readAdmission(documentId),
        ticketAdmissionMs: staging.ticketAdmissionMs,
        maximumMainStageMs: staging.maximumMainStageMs,
        resources: sessions.resourceCounts()
      })
    },
    runFileAdmission,
    cancelFileAdmission,
    cancelDispatchAndRecoverFile
  })
}
