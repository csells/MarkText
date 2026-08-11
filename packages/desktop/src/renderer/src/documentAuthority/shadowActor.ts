import {
  createDocumentCore,
  DocumentCoreError,
  type CriticMarkupAnnotation,
  type DocumentDiagnostic,
  type DocumentRevision,
  type DocumentSourceEdit
} from '@marktext/document-core'

import type {
  ShadowRejectionReason,
  ShadowRecognitionSummary,
  ShadowReply,
  ShadowRequest
} from './protocol'

export interface ShadowActor {
  handle(request: ShadowRequest, queueDepth?: number, queuedAt?: number): ShadowReply
  dispose(): void
}

const parseNow = (): number => performance.now()
const queueNow = (): number => Date.now()
const DIAGNOSTIC_SAMPLE_LIMIT = 16

function diagnosticSampleOf(revision: DocumentRevision): Readonly<{
  count: number
  sample: readonly DocumentDiagnostic[]
}> {
  return Object.freeze({
    count: revision.diagnostics.length,
    sample: Object.freeze(revision.diagnostics.slice(0, DIAGNOSTIC_SAMPLE_LIMIT))
  })
}

function applyExactSourceEdits(
  source: string,
  edits: readonly DocumentSourceEdit[]
): string {
  const pieces: string[] = []
  let sourceOffset = 0

  for (const [index, edit] of edits.entries()) {
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < sourceOffset ||
      edit.end < edit.start ||
      edit.end > source.length ||
      typeof edit.insert !== 'string'
    ) {
      throw new RangeError(`Shadow source edit ${String(index)} is invalid`)
    }
    pieces.push(source.slice(sourceOffset, edit.start), edit.insert)
    sourceOffset = edit.end
  }
  pieces.push(source.slice(sourceOffset))
  return pieces.join('')
}

function recognitionOf(revision: DocumentRevision): ShadowRecognitionSummary {
  const annotationCounts = {
    addition: 0,
    deletion: 0,
    substitution: 0,
    highlight: 0,
    comment: 0
  }
  const pending: CriticMarkupAnnotation[] = [...revision.annotations]
  while (pending.length !== 0) {
    const annotation = pending.pop()
    if (annotation === undefined) continue
    annotationCounts[annotation.kind] += 1
    for (const arm of annotation.arms) {
      for (const nested of arm.annotations) pending.push(nested)
    }
  }
  return Object.freeze({
    sourceLength: revision.source.length,
    annotationCounts: Object.freeze(annotationCounts)
  })
}

export function createShadowActor(): ShadowActor {
  // The actor never replaces this instance: all accepted revisions in every
  // session/barrier belong to one DocumentCore lineage.
  const core = createDocumentCore()
  let revision: DocumentRevision | undefined
  let candidateSource: string | undefined
  let currentSession = 0
  let currentGeneration = 0
  let lastSequence = 0
  let revisionNumber = 0
  let disposed = false

  const handle = (
    request: ShadowRequest,
    queueDepth = 0,
    queuedAt = queueNow()
  ): ShadowReply => {
    const parseStartedAt = parseNow()
    const queueMs = Math.max(0, queueNow() - queuedAt)
    const metric = (parseMs = 0) => Object.freeze({
      parseMs,
      queueMs,
      queueDepth
    })
    const rejected = (
      reason: ShadowRejectionReason,
      targetRevision = revisionNumber
    ): ShadowReply => Object.freeze({
      type: 'result',
      session: request.session,
      generation: request.generation,
      sequence: request.sequence,
      revision: targetRevision,
      accepted: false,
      status: 'rejected',
      diagnosticCount: 0,
      diagnostics: Object.freeze([]),
      rejectionReason: reason,
      metrics: metric()
    })

    if (disposed) return rejected('closed')

    if (request.type === 'open') {
      if (request.session < currentSession) return rejected('stale-session')
      if (
        request.session === currentSession &&
        request.generation < currentGeneration
      ) {
        return rejected('stale-generation')
      }
      if (
        request.session === currentSession &&
        request.generation === currentGeneration &&
        request.sequence <= lastSequence
      ) {
        return rejected('out-of-order')
      }
      if (
        request.session === currentSession &&
        request.generation === currentGeneration &&
        revision !== undefined
      ) {
        lastSequence = request.sequence
        return rejected('already-open')
      }

      // Advancing the session first permanently retires the old candidate even
      // if parsing this barrier source fails.
      currentSession = request.session
      currentGeneration = request.generation
      lastSequence = request.sequence
      revision = undefined
      candidateSource = undefined
      revisionNumber = 0

      try {
        const opened = core.open(request.source, request.options)
        revision = opened
        candidateSource = request.source
        revisionNumber = 1
        const diagnostics = diagnosticSampleOf(opened)
        return Object.freeze({
          type: 'result',
          session: request.session,
          generation: request.generation,
          sequence: request.sequence,
          revision: revisionNumber,
          accepted: true,
          status: diagnostics.count === 0 ? 'accepted' : 'diagnostic',
          diagnosticCount: diagnostics.count,
          diagnostics: diagnostics.sample,
          recognition: recognitionOf(opened),
          metrics: metric(Math.max(0, parseNow() - parseStartedAt))
        })
      } catch (error) {
        if (error instanceof DocumentCoreError) {
          return Object.freeze({
            type: 'result',
            session: request.session,
            generation: request.generation,
            sequence: request.sequence,
            revision: revisionNumber,
            accepted: false,
            status: 'resource',
            diagnosticCount: 0,
            diagnostics: Object.freeze([]),
            resource: Object.freeze({
              code: error.code,
              range: Object.freeze({ ...error.range }),
              metadata: Object.freeze({ ...error.metadata })
            }),
            metrics: metric(Math.max(0, parseNow() - parseStartedAt))
          })
        }
        throw error
      }
    }

    if (request.session < currentSession) return rejected('stale-session')
    if (request.session > currentSession) return rejected('not-open', 0)
    if (request.generation < currentGeneration) {
      return rejected('stale-generation')
    }
    if (request.generation > currentGeneration) return rejected('not-open', 0)
    if (request.sequence <= lastSequence) return rejected('out-of-order')
    lastSequence = request.sequence

    if (request.type === 'close') {
      if (revision === undefined) return rejected('not-open')
      revision = undefined
      candidateSource = undefined
      return Object.freeze({
        type: 'result',
        session: request.session,
        generation: request.generation,
        sequence: request.sequence,
        revision: revisionNumber,
        accepted: true,
        status: 'accepted',
        diagnosticCount: 0,
        diagnostics: Object.freeze([]),
        metrics: metric()
      })
    }

    if (revision === undefined || candidateSource === undefined) {
      return rejected('not-open')
    }
    if (request.baseRevision !== revisionNumber) {
      return rejected('stale-base')
    }

    let nextSource: string
    try {
      nextSource = applyExactSourceEdits(candidateSource, request.edits)
    } catch (error) {
      if (error instanceof RangeError) return rejected('invalid-edit')
      throw error
    }

    try {
      const reopened = core.reopen(revision, nextSource, request.edits)
      revision = reopened
      candidateSource = nextSource
      revisionNumber += 1
      const diagnostics = diagnosticSampleOf(reopened)
      return Object.freeze({
        type: 'result',
        session: request.session,
        generation: request.generation,
        sequence: request.sequence,
        revision: revisionNumber,
        accepted: true,
        status: diagnostics.count === 0 ? 'accepted' : 'diagnostic',
        diagnosticCount: diagnostics.count,
        diagnostics: diagnostics.sample,
        recognition: recognitionOf(reopened),
        metrics: metric(Math.max(0, parseNow() - parseStartedAt))
      })
    } catch (error) {
      if (error instanceof DocumentCoreError) {
        return Object.freeze({
          type: 'result',
          session: request.session,
          generation: request.generation,
          sequence: request.sequence,
          revision: revisionNumber,
          accepted: false,
          status: 'resource',
          diagnosticCount: 0,
          diagnostics: Object.freeze([]),
          resource: Object.freeze({
            code: error.code,
            range: Object.freeze({ ...error.range }),
            metadata: Object.freeze({ ...error.metadata })
          }),
          metrics: metric(Math.max(0, parseNow() - parseStartedAt))
        })
      }
      // An unexpected core failure is not an invalid author edit. Let the port
      // fail so the Shadow session can disable itself terminally.
      throw error
    }
  }

  return Object.freeze({
    handle,
    dispose(): void {
      disposed = true
      revision = undefined
      candidateSource = undefined
    }
  })
}
