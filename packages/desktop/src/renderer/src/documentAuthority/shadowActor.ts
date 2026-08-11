import {
  createDocumentCore,
  DocumentCoreError,
  DocumentSourceEditError,
  type CriticMarkupAnnotation,
  type DocumentCore,
  type DocumentDiagnostic,
  type DocumentRevision
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
    sourceLength: revision.sourceLength,
    annotationCounts: Object.freeze(annotationCounts)
  })
}

export function createShadowActor(
  createCore: () => DocumentCore = createDocumentCore
): ShadowActor {
  // A core belongs to exactly one accepted open generation. Dropping a
  // generation drops its current revision and full canonical source too.
  let core: DocumentCore | undefined
  let revision: DocumentRevision | undefined
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
      core = undefined
      revision = undefined
      revisionNumber = 0

      try {
        const nextCore = createCore()
        const opened = nextCore.open(request.source, request.options)
        core = nextCore
        revision = opened
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
      core = undefined
      revision = undefined
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

    if (core === undefined || revision === undefined) {
      return rejected('not-open')
    }
    if (request.baseRevision !== revisionNumber) {
      return rejected('stale-base')
    }

    try {
      const applied = core.apply(revision, request.edits)
      revision = applied.revision
      revisionNumber += 1
      const diagnostics = diagnosticSampleOf(applied.revision)
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
        recognition: recognitionOf(applied.revision),
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
      if (error instanceof DocumentSourceEditError) {
        return rejected('invalid-edit')
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
      core = undefined
      revision = undefined
    }
  })
}
