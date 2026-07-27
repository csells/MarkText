import type { LiveRenderRun, ModelPosition } from '../../documentSession.js'
import {
  createMarkupCoordinateMapV1,
  sourcePositionAtMarkupCoordinateMap,
  visibleModelPositionAtMarkupCoordinateMap,
  type MarkupCoordinateMapV1
} from '../../markupCoordinateMap.js'
import type { CompleteDocumentRevision } from '../../revision.js'

type SourcePosition = ModelPosition

export interface MarkupView {
  readonly modelLength: number
  readonly runs: readonly LiveRenderRun[]
  readonly coordinateMap: MarkupCoordinateMapV1
  readonly sourcePositionAt: (position: ModelPosition) => SourcePosition
  readonly modelPositionAt: (position: SourcePosition) => ModelPosition | null
}

function createCoordinateMap(
  revision: CompleteDocumentRevision
): MarkupCoordinateMapV1 {
  const spans: Array<{
    modelStart: number
    modelEnd: number
    sourceStart: number
    sourceEnd: number
  }> = []
  const projection = revision.markup
  let modelOffset = 0
  for (let ordinal = 0; ordinal < projection.runCount; ordinal += 1) {
    const run = projection.runAt(ordinal)
    const sourceLength = run.sourceRange.end - run.sourceRange.start
    if (run.text.length !== sourceLength) {
      throw new Error('Markup run text does not match its canonical source range')
    }
    if (run.text.length === 0) continue
    const sourceStart = Number(run.sourceRange.start)
    const sourceEnd = Number(run.sourceRange.end)
    const previous = spans.at(-1)
    if (
      previous !== undefined &&
      previous.modelEnd === modelOffset &&
      previous.sourceEnd === sourceStart
    ) {
      previous.modelEnd += run.text.length
      previous.sourceEnd = sourceEnd
    } else {
      spans.push({
        modelStart: modelOffset,
        modelEnd: modelOffset + run.text.length,
        sourceStart,
        sourceEnd
      })
    }
    modelOffset += run.text.length
  }
  return createMarkupCoordinateMapV1(
    revision.source.text.length,
    modelOffset,
    spans
  )
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

export function createMarkupView(revision: CompleteDocumentRevision): MarkupView {
  const coordinateMap = createCoordinateMap(revision)
  const sourcePositionAt = Object.freeze(
    (position: ModelPosition): SourcePosition =>
      sourcePositionAtMarkupCoordinateMap(coordinateMap, position)
  )
  const modelPositionAt = Object.freeze(
    (position: SourcePosition): ModelPosition | null =>
      visibleModelPositionAtMarkupCoordinateMap(coordinateMap, position)
  )

  return Object.freeze({
    modelLength: coordinateMap.modelLength,
    runs: createRuns(revision),
    coordinateMap,
    sourcePositionAt,
    modelPositionAt
  })
}
