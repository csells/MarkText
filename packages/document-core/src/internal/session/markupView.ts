import type { LiveRenderRun, ModelPosition } from '../../documentSession.js'
import type { CompleteDocumentRevision } from '../../revision.js'
import type { AffineSourcePosition } from './revisionTransition.js'

interface ProjectedOriginSpan {
  readonly start: number
  readonly end: number
}

export interface MarkupView {
  readonly modelLength: number
  readonly runs: readonly LiveRenderRun[]
  readonly sourcePositionAt: (position: ModelPosition) => AffineSourcePosition
  readonly modelPositionAt: (position: AffineSourcePosition) => ModelPosition | null
}

function requiredAt<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) {
    throw new Error('Internal Markup view collection invariant failed')
  }
  return item
}

function freezePosition(position: ModelPosition): ModelPosition {
  return Object.freeze({ offset: position.offset, affinity: position.affinity })
}

function freezeSourcePosition(position: AffineSourcePosition): AffineSourcePosition {
  return Object.freeze({ offset: position.offset, affinity: position.affinity })
}

function createOrigins(revision: CompleteDocumentRevision): readonly ProjectedOriginSpan[] {
  const origins: ProjectedOriginSpan[] = []
  const projection = revision.markup
  for (let ordinal = 0; ordinal < projection.runCount; ordinal += 1) {
    const run = projection.runAt(ordinal)
    const sourceLength = run.sourceRange.end - run.sourceRange.start
    if (run.text.length !== sourceLength) {
      throw new Error('Markup run text does not match its canonical source range')
    }
    for (let offset = 0; offset < run.text.length; offset += 1) {
      const sourceOffset = run.sourceRange.start + offset
      origins.push(Object.freeze({ start: sourceOffset, end: sourceOffset + 1 }))
    }
  }
  return Object.freeze(origins)
}

function createRuns(
  revision: CompleteDocumentRevision
): readonly LiveRenderRun[] {
  let modelOffset = 0
  const projection = revision.markup
  const projectionRuns = Array.from(
    { length: projection.runCount },
    (_, ordinal) => projection.runAt(ordinal)
  )
  return Object.freeze(
    projectionRuns.map((run) => {
      const modelStart = modelOffset
      modelOffset += run.text.length
      const markKey = run.marks
        .map((mark) =>
          mark.kind === 'substitution' ? `${mark.kind}-${mark.arm}` : mark.kind
        )
        .join('+')
      return Object.freeze({
        key: `${markKey || 'text'}:${run.sourceRange.start}:${run.sourceRange.end}`,
        marks: run.marks,
        text: run.text,
        modelRange: Object.freeze({ start: modelStart, end: modelOffset }),
        sourceRange: run.sourceRange
      })
    })
  )
}

function assertModelPosition(position: ModelPosition, modelLength: number): void {
  if (!Number.isInteger(position.offset) || position.offset < 0 || position.offset > modelLength) {
    throw new RangeError('Model position is outside the Markup view')
  }
  if (position.affinity !== 'previous' && position.affinity !== 'next') {
    throw new TypeError('Model position has an invalid affinity')
  }
}

function mapModelToSource(
  origins: readonly ProjectedOriginSpan[],
  sourceLength: number,
  position: ModelPosition
): AffineSourcePosition {
  assertModelPosition(position, origins.length)
  if (origins.length === 0) {
    return freezeSourcePosition({ offset: 0, affinity: position.affinity })
  }
  if (position.offset === 0) {
    return freezeSourcePosition({
      offset: requiredAt(origins, 0).start,
      affinity: position.affinity
    })
  }
  if (position.offset === origins.length) {
    return freezeSourcePosition({ offset: sourceLength, affinity: position.affinity })
  }

  const left = requiredAt(origins, position.offset - 1)
  const right = requiredAt(origins, position.offset)
  return freezeSourcePosition({
    offset: position.affinity === 'previous' ? left.end : right.start,
    affinity: position.affinity
  })
}

export function createMarkupView(revision: CompleteDocumentRevision): MarkupView {
  const origins = createOrigins(revision)
  const sourceLength = revision.source.text.length
  const sourcePositionAt = Object.freeze(
    (position: ModelPosition): AffineSourcePosition =>
      mapModelToSource(origins, sourceLength, position)
  )
  const modelPositionAt = Object.freeze((position: AffineSourcePosition): ModelPosition | null => {
    for (let modelOffset = 0; modelOffset <= origins.length; modelOffset += 1) {
      const candidate = freezePosition({
        offset: modelOffset,
        affinity: position.affinity
      })
      if (sourcePositionAt(candidate).offset === position.offset) {
        return candidate
      }
    }
    return null
  })

  return Object.freeze({
    modelLength: origins.length,
    runs: createRuns(revision),
    sourcePositionAt,
    modelPositionAt
  })
}
