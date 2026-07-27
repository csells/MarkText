import type { ModelPosition } from './documentSession.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from './resourcePolicy.js'

const MARKUP_COORDINATE_MAP_FIELDS = Object.freeze([
  'schema',
  'affinity',
  'sourceLength',
  'modelLength',
  'spans'
] as const)
const MARKUP_COORDINATE_SPAN_FIELDS = Object.freeze([
  'modelStart',
  'modelEnd',
  'sourceStart',
  'sourceEnd'
] as const)

const MAX_COORDINATE_SPANS = 2_000_000

export interface MarkupCoordinateSpanV1 {
  readonly modelStart: number
  readonly modelEnd: number
  readonly sourceStart: number
  readonly sourceEnd: number
}

/**
 * Parser-created coordinate topology for the editable Markup projection.
 *
 * Model spans are contiguous. Source gaps are syntax hidden from the editable
 * projection. At a visible boundary, `previous` owns the code unit on the
 * left and `next` owns the code unit on the right. A source position inside a
 * hidden gap snaps to the preceding or following visible boundary according
 * to that same affinity.
 */
export interface MarkupCoordinateMapV1 {
  readonly schema: 'markup-coordinate-map-1'
  readonly affinity: 'previous-left-next-right-1'
  readonly sourceLength: number
  readonly modelLength: number
  readonly spans: readonly MarkupCoordinateSpanV1[]
}

function assertClosedRecord(
  value: unknown,
  label: string,
  fields: readonly string[]
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a closed record`)
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a closed record`)
  }
  const allowed = new Set(fields)
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !allowed.has(key))
  ) {
    throw new TypeError(`${label} has an unexpected field`)
  }
}

function boundedInteger(
  value: unknown,
  label: string,
  maximum: number
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new RangeError(`${label} exceeds the bounded coordinate limit`)
  }
  return value
}

function requiredAt<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) {
    throw new Error('Verified Markup coordinate map is internally incomplete')
  }
  return item
}

function freezePosition(position: ModelPosition): ModelPosition {
  return Object.freeze({
    offset: position.offset,
    affinity: position.affinity
  })
}

function assertAffinity(position: ModelPosition): void {
  if (position.affinity !== 'previous' && position.affinity !== 'next') {
    throw new TypeError('Markup coordinate position has an invalid affinity')
  }
}

function assertPosition(
  position: ModelPosition,
  maximum: number,
  coordinate: 'model' | 'source'
): void {
  assertAffinity(position)
  if (
    !Number.isSafeInteger(position.offset) ||
    position.offset < 0 ||
    position.offset > maximum
  ) {
    throw new RangeError(
      `Markup ${coordinate} position is outside the coordinate map`
    )
  }
}

function decodeSpan(
  value: unknown,
  ordinal: number,
  sourceLength: number,
  expectedModelStart: number,
  previousSourceEnd: number | undefined
): MarkupCoordinateSpanV1 {
  const label = `Markup coordinate span ${ordinal}`
  assertClosedRecord(value, label, MARKUP_COORDINATE_SPAN_FIELDS)
  const modelStart = boundedInteger(
    value.modelStart,
    `${label} modelStart`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
  )
  const modelEnd = boundedInteger(
    value.modelEnd,
    `${label} modelEnd`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
  )
  const sourceStart = boundedInteger(
    value.sourceStart,
    `${label} sourceStart`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
  )
  const sourceEnd = boundedInteger(
    value.sourceEnd,
    `${label} sourceEnd`,
    DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
  )
  if (
    modelStart !== expectedModelStart ||
    modelEnd <= modelStart ||
    sourceEnd <= sourceStart ||
    modelEnd - modelStart !== sourceEnd - sourceStart
  ) {
    throw new TypeError(`${label} has an invalid length or model span`)
  }
  if (
    sourceEnd > sourceLength ||
    (
      previousSourceEnd !== undefined &&
      sourceStart <= previousSourceEnd
    )
  ) {
    throw new TypeError(`${label} overlaps or is not a compact source span`)
  }
  return Object.freeze({
    modelStart,
    modelEnd,
    sourceStart,
    sourceEnd
  })
}

export function decodeMarkupCoordinateMapV1(
  value: unknown
): MarkupCoordinateMapV1 {
  assertClosedRecord(
    value,
    'Markup coordinate map',
    MARKUP_COORDINATE_MAP_FIELDS
  )
  if (value.schema !== 'markup-coordinate-map-1') {
    throw new TypeError('Markup coordinate map has an invalid schema')
  }
  if (value.affinity !== 'previous-left-next-right-1') {
    throw new TypeError('Markup coordinate map has an invalid affinity contract')
  }
  const sourceLength = boundedInteger(
    value.sourceLength,
    'Markup coordinate source length',
    DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
  )
  const modelLength = boundedInteger(
    value.modelLength,
    'Markup coordinate model length',
    DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
  )
  if (!Array.isArray(value.spans)) {
    throw new TypeError('Markup coordinate map spans must be an array')
  }
  if (value.spans.length > MAX_COORDINATE_SPANS) {
    throw new RangeError('Markup coordinate map exceeds the bounded span limit')
  }

  const spans: MarkupCoordinateSpanV1[] = []
  let expectedModelStart = 0
  let previousSourceEnd: number | undefined
  for (let ordinal = 0; ordinal < value.spans.length; ordinal += 1) {
    const span = decodeSpan(
      value.spans[ordinal],
      ordinal,
      sourceLength,
      expectedModelStart,
      previousSourceEnd
    )
    spans.push(span)
    expectedModelStart = span.modelEnd
    previousSourceEnd = span.sourceEnd
  }
  if (expectedModelStart !== modelLength) {
    throw new TypeError(
      'Markup coordinate map spans do not cover the declared model length'
    )
  }

  return Object.freeze({
    schema: 'markup-coordinate-map-1' as const,
    affinity: 'previous-left-next-right-1' as const,
    sourceLength,
    modelLength,
    spans: Object.freeze(spans)
  })
}

export function createMarkupCoordinateMapV1(
  sourceLength: number,
  modelLength: number,
  spans: readonly MarkupCoordinateSpanV1[]
): MarkupCoordinateMapV1 {
  return decodeMarkupCoordinateMapV1({
    schema: 'markup-coordinate-map-1',
    affinity: 'previous-left-next-right-1',
    sourceLength,
    modelLength,
    spans
  })
}

function modelSpanAt(
  map: MarkupCoordinateMapV1,
  modelCharacter: number
): MarkupCoordinateSpanV1 {
  let low = 0
  let high = map.spans.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const span = requiredAt(map.spans, middle)
    if (modelCharacter < span.modelStart) {
      high = middle - 1
    } else if (modelCharacter >= span.modelEnd) {
      low = middle + 1
    } else {
      return span
    }
  }
  throw new Error('Verified Markup coordinate map has a model gap')
}

export function sourcePositionAtMarkupCoordinateMap(
  map: MarkupCoordinateMapV1,
  position: ModelPosition
): ModelPosition {
  assertPosition(position, map.modelLength, 'model')
  if (map.spans.length === 0) {
    return freezePosition({ offset: 0, affinity: position.affinity })
  }
  if (position.offset === 0) {
    return freezePosition({
      offset: requiredAt(map.spans, 0).sourceStart,
      affinity: position.affinity
    })
  }
  if (position.offset === map.modelLength) {
    return freezePosition({
      offset: map.sourceLength,
      affinity: position.affinity
    })
  }

  const left = modelSpanAt(map, position.offset - 1)
  const right = modelSpanAt(map, position.offset)
  const owner = position.affinity === 'previous' ? left : right
  return freezePosition({
    offset: owner.sourceStart + position.offset - owner.modelStart,
    affinity: position.affinity
  })
}

/**
 * Return only a directly visible source position.
 *
 * This is the nullable parser/session primitive. Most view clients should use
 * `modelPositionAtMarkupCoordinateMap`, which applies the artifact's declared
 * hidden-gap affinity contract.
 */
export function visibleModelPositionAtMarkupCoordinateMap(
  map: MarkupCoordinateMapV1,
  position: ModelPosition
): ModelPosition | null {
  assertAffinity(position)
  if (
    !Number.isSafeInteger(position.offset) ||
    position.offset < 0 ||
    position.offset > map.sourceLength
  ) {
    return null
  }
  if (map.spans.length === 0) {
    return position.offset === 0
      ? freezePosition({ offset: 0, affinity: position.affinity })
      : null
  }
  const first = requiredAt(map.spans, 0)
  if (position.offset === first.sourceStart) {
    return freezePosition({ offset: 0, affinity: position.affinity })
  }
  if (position.offset === map.sourceLength) {
    return freezePosition({
      offset: map.modelLength,
      affinity: position.affinity
    })
  }

  let low = 0
  let high = map.spans.length - 1
  let candidateIndex = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const span = requiredAt(map.spans, middle)
    if (span.sourceStart <= position.offset) {
      candidateIndex = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  const candidateIndexes = position.affinity === 'previous'
    ? [candidateIndex, candidateIndex - 1]
    : [candidateIndex]
  for (const index of candidateIndexes) {
    if (index < 0) continue
    const span = requiredAt(map.spans, index)
    const inside = position.affinity === 'previous'
      ? position.offset > span.sourceStart &&
        position.offset <= span.sourceEnd
      : position.offset >= span.sourceStart &&
        position.offset < span.sourceEnd
    if (!inside) continue
    const modelOffset =
      span.modelStart + position.offset - span.sourceStart
    if (modelOffset === map.modelLength) continue
    return freezePosition({
      offset: modelOffset,
      affinity: position.affinity
    })
  }
  return null
}

export function modelPositionAtMarkupCoordinateMap(
  map: MarkupCoordinateMapV1,
  position: ModelPosition
): ModelPosition {
  assertPosition(position, map.sourceLength, 'source')
  const direct = visibleModelPositionAtMarkupCoordinateMap(map, position)
  if (direct !== null) return direct
  if (map.spans.length === 0) {
    return freezePosition({ offset: 0, affinity: position.affinity })
  }

  let low = 0
  let high = map.spans.length - 1
  let previousIndex = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const span = requiredAt(map.spans, middle)
    if (span.sourceEnd <= position.offset) {
      previousIndex = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  if (position.affinity === 'previous') {
    return freezePosition({
      offset: previousIndex < 0
        ? 0
        : requiredAt(map.spans, previousIndex).modelEnd,
      affinity: position.affinity
    })
  }

  const nextIndex = previousIndex + 1
  return freezePosition({
    offset: nextIndex >= map.spans.length
      ? map.modelLength
      : requiredAt(map.spans, nextIndex).modelStart,
    affinity: position.affinity
  })
}
