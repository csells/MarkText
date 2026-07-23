import type {
  MarkdownDocument,
  MarkdownLiteralProvider,
  MarkdownNode,
  MarkdownNodeKind,
  ViewRange
} from '../../revision.js'
import {
  createMarkdownReferenceDefinitionIndex,
  normalizeMarkdownReferenceLabel,
  parsePlainMarkdownLane,
  type MarkdownMatchingScopePolicy,
  type MarkdownReferenceDefinitionLookup,
  type PlainMarkdownContainer,
  type PlainMarkdownLine
} from './markdownLaneState.js'
import type {
  MarkdownContainerDepthFailure,
  MarkdownInlineConstruct
} from './markdownTypes.js'
import type {
  ProfileParseTraceRecorderV1,
  ProfileParseTraceViewV1
} from '../profileParseTraceV1.js'

export interface Profile1ProjectionPlanningTraceV1 {
  readonly view: ProfileParseTraceViewV1
  readonly recorder: ProfileParseTraceRecorderV1
}

interface MappedMarkdownLiteral {
  readonly provider: MarkdownLiteralProvider
  readonly start: number
  readonly end: number
  readonly construct?: MarkdownInlineConstruct
  readonly blockKind?: 'footnote-definition'
}

export interface MappedMarkdownLane {
  readonly source: string
  /**
   * Parser-owned Substitution-arm scopes mapped into this lane. These are
   * transitional evidence for the boundary guard; they are not rediscovered
   * from the flattened source.
   */
  readonly matchingScopes?: readonly MappedMarkdownMatchingScope[]
  /** Maximal candidate runs that retain one contiguous canonical tape identity. */
  readonly canonicalIdentityRuns?: readonly MappedMarkdownCanonicalIdentityRun[]
  /**
   * Projection edits justified by parser-owned arm termination facts. The
   * flattened lane may consume this evidence, but it must not rediscover it.
   */
  readonly armTerminationEdits?: readonly MarkdownArmBoundaryProjectionEdit[]
}

export interface MappedMarkdownMatchingScope {
  readonly id: number
  readonly start: number
  readonly end: number
  readonly depth: number
}

export interface MappedMarkdownCanonicalIdentityRun {
  readonly candidateStart: number
  readonly candidateEnd: number
  readonly sourceRunId: number
  readonly sourceStart: number
}

export type MarkdownArmBoundaryProjectionEdit =
  | Readonly<{
    readonly kind: 'protect-delimiter'
    readonly candidateOffset: number
  }>
  | Readonly<{
    readonly kind: 'respell-enclosing-emphasis-delimiters'
    readonly openerStart: number
    readonly openerEnd: number
    readonly closerStart: number
    readonly closerEnd: number
    readonly replacementMarker: '*' | '_'
  }>
  | Readonly<{
    readonly kind: 'encode-emphasis-flanking-scalar'
    readonly candidateStart: number
    readonly candidateEnd: number
    readonly codePoint: number
  }>
  | Readonly<{
    readonly kind: 'extend-inline-code-delimiters'
    readonly openerStart: number
    readonly openerEnd: number
    readonly closerStart: number
    readonly closerEnd: number
    readonly delimiterLength: number
  }>
  | Readonly<{
    readonly kind: 'terminate-fenced-block-fragment'
    readonly candidateOffset: number
    readonly sourcePosition: number
    readonly marker: '`' | '~'
    readonly delimiterLength: number
    readonly lineEnding: '\n' | '\r' | '\r\n'
    readonly needsLeadingLineEnding: boolean
  }>
  | Readonly<{
    readonly kind: 'separate-following-block'
    readonly candidateOffset: number
    readonly sourcePosition: number
    readonly lineEnding: '\n' | '\r' | '\r\n'
    readonly indentationElision?: Readonly<{
      readonly candidateStart: number
      readonly candidateEnd: number
      readonly sourceStart: number
      readonly sourceEnd: number
    }>
  }>

export interface Profile1MarkdownParse {
  readonly document: MarkdownDocument
  readonly containerDepthFailure: MarkdownContainerDepthFailure | undefined
}

const EMPTY_ATTRIBUTES = Object.freeze({})
const EMPTY_INLINE_CONSTRUCTS: ReadonlyMap<number, MappedMarkdownLiteral> = new Map()
const EMPTY_REFERENCE_DEFINITIONS: MarkdownReferenceDefinitionLookup =
  Object.freeze({
    has: Object.freeze((): boolean => false)
  })

function viewRange(start: number, end: number): ViewRange {
  return Object.freeze({ start, end })
}

function createNode(
  kind: MarkdownNodeKind,
  start: number,
  end: number,
  children: readonly MarkdownNode[] = Object.freeze([]),
  attributes: Readonly<Record<string, string | number | boolean>> = EMPTY_ATTRIBUTES
): MarkdownNode {
  const stableChildren = Object.freeze([...children])
  const childAt = Object.freeze((ordinal: number): MarkdownNode => {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= stableChildren.length) {
      throw new RangeError('Markdown child ordinal is outside the node')
    }
    const child = stableChildren[ordinal]
    if (child === undefined) {
      throw new Error('Markdown child index invariant failed')
    }
    return child
  })
  return Object.freeze({
    kind,
    range: viewRange(start, end),
    attributes: Object.freeze({ ...attributes }),
    childCount: stableChildren.length,
    childAt
  })
}

function hasOddBackslashRunBefore(source: string, offset: number, floor: number): boolean {
  let count = 0
  for (
    let cursor = offset - 1;
    cursor >= floor && source.charCodeAt(cursor) === 92;
    cursor -= 1
  ) {
    count += 1
  }
  return count % 2 === 1
}

interface ParsedReferenceLink {
  readonly kind: 'link' | 'image'
  readonly start: number
  readonly labelStart: number
  readonly labelEnd: number
  readonly end: number
  readonly referenceLabel: string
}

function findBalancedLabelEnd(
  source: string,
  opener: number,
  end: number
): number | undefined {
  let depth = 0
  for (let offset = opener; offset < end; offset += 1) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 92 && offset + 1 < end) {
      offset += 1
      continue
    }
    if (codeUnit === 91) {
      depth += 1
    } else if (codeUnit === 93) {
      depth -= 1
      if (depth === 0) {
        return offset
      }
    }
  }
  return undefined
}

function findReferenceLink(
  source: string,
  start: number,
  end: number,
  floor: number,
  referenceDefinitions: MarkdownReferenceDefinitionLookup,
  boundaryPolicy?: InlineBoundaryPolicy
): ParsedReferenceLink | undefined {
  const image =
    source.charCodeAt(start) === 33 && source.charCodeAt(start + 1) === 91
  const opener = image ? start + 1 : start
  if (
    source.charCodeAt(opener) !== 91 ||
    hasOddBackslashRunBefore(source, start, floor)
  ) {
    return undefined
  }
  if (
    image &&
    (matchingScopeAt(boundaryPolicy, start)?.id ?? -1) !==
      (matchingScopeAt(boundaryPolicy, opener)?.id ?? -1)
  ) {
    boundaryPolicy?.unsafeDelimiterOffsets.add(start)
    return undefined
  }
  const labelEnd = findBalancedLabelEnd(source, opener, end)
  if (labelEnd === undefined || labelEnd === opener + 1) {
    return undefined
  }
  if (rejectMappedCrossScopeMatch(boundaryPolicy, opener, labelEnd)) {
    return undefined
  }
  const normalizedLabel = normalizeMarkdownReferenceLabel(
    source,
    opener + 1,
    labelEnd
  )
  let constructEnd = labelEnd + 1
  let referenceLabel = normalizedLabel
  if (source.charCodeAt(constructEnd) === 91) {
    const referenceStart = constructEnd
    const referenceEnd = findBalancedLabelEnd(source, referenceStart, end)
    if (referenceEnd === undefined) {
      return undefined
    }
    if (
      rejectMappedCrossScopeMatch(boundaryPolicy, opener, referenceStart) ||
      rejectMappedCrossScopeMatch(
        boundaryPolicy,
        referenceStart,
        referenceEnd
      )
    ) {
      return undefined
    }
    referenceLabel = referenceEnd === constructEnd + 1
      ? normalizedLabel
      : normalizeMarkdownReferenceLabel(
        source,
        constructEnd + 1,
        referenceEnd
      )
    constructEnd = referenceEnd + 1
  } else if (
    source.charCodeAt(constructEnd) === 40 ||
    source.charCodeAt(constructEnd) === 91
  ) {
    return undefined
  }
  if (!referenceDefinitions.has(referenceLabel, start)) {
    if (referenceDefinitions.hasAny?.(referenceLabel) === true) {
      boundaryPolicy?.unsafeDelimiterOffsets.add(opener)
    }
    return undefined
  }
  return Object.freeze({
    kind: image ? 'image' : 'link',
    start,
    labelStart: opener + 1,
    labelEnd,
    end: constructEnd,
    referenceLabel
  })
}

interface InlineNodeItem {
  readonly kind: 'node'
  readonly node: MarkdownNode
  previous: InlineItem | undefined
  next: InlineItem | undefined
}

interface InlineDelimiterItem {
  readonly kind: 'delimiter'
  readonly markerCodeUnit: number
  readonly canOpen: boolean
  readonly canClose: boolean
  start: number
  end: number
  length: number
  active: boolean
  readonly matchingScopeId: number
  previous: InlineItem | undefined
  next: InlineItem | undefined
}

type InlineItem = InlineNodeItem | InlineDelimiterItem

interface InlineList {
  head: InlineItem | undefined
  tail: InlineItem | undefined
}

interface InlineDelimiterRun {
  readonly markerCodeUnit: number
  readonly start: number
  readonly end: number
  readonly length: number
  readonly canOpen: boolean
  readonly canClose: boolean
  readonly matchingScopeId: number
}

interface InlineBoundaryPolicy {
  readonly scopeRuns: readonly MappedMarkdownMatchingScope[]
  readonly unsafeDelimiterOffsets: Set<number>
  readonly enclosingEmphasisRespellings: Map<
    string,
    Extract<
      MarkdownArmBoundaryProjectionEdit,
      { readonly kind: 'respell-enclosing-emphasis-delimiters' }
    >
  >
}

const UNICODE_WHITESPACE = /^\s$/u
const UNICODE_PUNCTUATION_OR_SYMBOL = /^[\p{P}\p{S}]$/u

function markdownFlankingScalar(scalar: string): string {
  if (scalar.length !== 1) {
    return scalar
  }
  const codeUnit = scalar.charCodeAt(0)
  return codeUnit === 0 || (codeUnit >= 0xd800 && codeUnit <= 0xdfff)
    ? '\ufffd'
    : scalar
}

function matchingScopeAt(
  policy: InlineBoundaryPolicy | undefined,
  offset: number
): MappedMarkdownMatchingScope | undefined {
  const runs = policy?.scopeRuns ?? []
  let low = 0
  let high = runs.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if ((runs[middle]?.end ?? Number.POSITIVE_INFINITY) <= offset) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  const run = runs[low]
  return run !== undefined && run.start <= offset ? run : undefined
}

function rejectMappedCrossScopeMatch(
  policy: InlineBoundaryPolicy | undefined,
  openerStart: number,
  closerStart: number
): boolean {
  const unsafeOffset = mappedCrossScopeProtectionOffset(
    policy,
    openerStart,
    closerStart
  )
  if (policy === undefined || unsafeOffset === undefined) {
    return false
  }
  policy.unsafeDelimiterOffsets.add(unsafeOffset)
  return true
}

function mappedCrossScopeProtectionOffset(
  policy: InlineBoundaryPolicy | undefined,
  openerStart: number,
  closerStart: number
): number | undefined {
  if (policy === undefined) {
    return undefined
  }
  const openerScope = matchingScopeAt(policy, openerStart)
  const closerScope = matchingScopeAt(policy, closerStart)
  if ((openerScope?.id ?? -1) === (closerScope?.id ?? -1)) {
    return undefined
  }
  const openerDepth = openerScope?.depth ?? -1
  const closerDepth = closerScope?.depth ?? -1
  return closerDepth > openerDepth ? closerStart : openerStart
}

function unicodeScalarBefore(
  source: string,
  offset: number,
  floor: number
): string | undefined {
  if (offset <= floor) {
    return undefined
  }
  let start = offset - 1
  const trailing = source.charCodeAt(start)
  if (
    trailing >= 0xdc00 &&
    trailing <= 0xdfff &&
    start > floor
  ) {
    const leading = source.charCodeAt(start - 1)
    if (leading >= 0xd800 && leading <= 0xdbff) {
      start -= 1
    }
  }
  return markdownFlankingScalar(source.slice(start, offset))
}

function unicodeScalarAt(
  source: string,
  offset: number,
  ceiling: number
): string | undefined {
  if (offset >= ceiling) {
    return undefined
  }
  const codePoint = source.codePointAt(offset)
  if (codePoint === undefined) {
    return undefined
  }
  return markdownFlankingScalar(String.fromCodePoint(codePoint))
}

function unicodeScalarRangeBefore(
  source: string,
  offset: number
): Readonly<{
  readonly start: number
  readonly end: number
  readonly scalar: string
}> | undefined {
  const scalar = unicodeScalarBefore(source, offset, 0)
  return scalar === undefined
    ? undefined
    : Object.freeze({ start: offset - scalar.length, end: offset, scalar })
}

function unicodeScalarRangeAt(
  source: string,
  offset: number
): Readonly<{
  readonly start: number
  readonly end: number
  readonly scalar: string
}> | undefined {
  const scalar = unicodeScalarAt(source, offset, source.length)
  return scalar === undefined
    ? undefined
    : Object.freeze({ start: offset, end: offset + scalar.length, scalar })
}

function underscoreCanOpenBetween(
  previous: string | undefined,
  next: string | undefined
): boolean {
  const previousIsWhitespace =
    previous === undefined || UNICODE_WHITESPACE.test(previous)
  const nextIsWhitespace =
    next === undefined || UNICODE_WHITESPACE.test(next)
  const previousIsPunctuation =
    previous !== undefined && UNICODE_PUNCTUATION_OR_SYMBOL.test(previous)
  const nextIsPunctuation =
    next !== undefined && UNICODE_PUNCTUATION_OR_SYMBOL.test(next)
  const leftFlanking =
    !nextIsWhitespace &&
    (!nextIsPunctuation || previousIsWhitespace || previousIsPunctuation)
  const rightFlanking =
    !previousIsWhitespace &&
    (!previousIsPunctuation || nextIsWhitespace || nextIsPunctuation)
  return leftFlanking && (!rightFlanking || previousIsPunctuation)
}

function underscoreCanCloseBetween(
  previous: string | undefined,
  next: string | undefined
): boolean {
  const previousIsWhitespace =
    previous === undefined || UNICODE_WHITESPACE.test(previous)
  const nextIsWhitespace =
    next === undefined || UNICODE_WHITESPACE.test(next)
  const previousIsPunctuation =
    previous !== undefined && UNICODE_PUNCTUATION_OR_SYMBOL.test(previous)
  const nextIsPunctuation =
    next !== undefined && UNICODE_PUNCTUATION_OR_SYMBOL.test(next)
  const leftFlanking =
    !nextIsWhitespace &&
    (!nextIsPunctuation || previousIsWhitespace || previousIsPunctuation)
  const rightFlanking =
    !previousIsWhitespace &&
    (!previousIsPunctuation || nextIsWhitespace || nextIsPunctuation)
  return rightFlanking && (!leftFlanking || nextIsPunctuation)
}

function delimiterRunAt(
  source: string,
  offset: number,
  start: number,
  end: number,
  boundaryPolicy?: InlineBoundaryPolicy
): InlineDelimiterRun | undefined {
  const matchingScope = matchingScopeAt(boundaryPolicy, offset)
  const matchingFloor = Math.max(start, matchingScope?.start ?? start)
  const matchingCeiling = Math.min(end, matchingScope?.end ?? end)
  const markerCodeUnit = source.charCodeAt(offset)
  if (
    (markerCodeUnit !== 42 && markerCodeUnit !== 95 && markerCodeUnit !== 126) ||
    (
      source.charCodeAt(offset - 1) === markerCodeUnit &&
      offset - 1 >= matchingFloor &&
      (matchingScopeAt(boundaryPolicy, offset - 1)?.id ?? -1) ===
        (matchingScope?.id ?? -1) &&
      !hasOddBackslashRunBefore(source, offset - 1, matchingFloor)
    ) ||
    hasOddBackslashRunBefore(source, offset, matchingFloor)
  ) {
    return undefined
  }
  let runEnd = offset + 1
  while (
    runEnd < matchingCeiling &&
    source.charCodeAt(runEnd) === markerCodeUnit &&
    (matchingScopeAt(boundaryPolicy, runEnd)?.id ?? -1) ===
      (matchingScope?.id ?? -1)
  ) {
    runEnd += 1
  }
  const length = runEnd - offset
  if (markerCodeUnit === 126 && length > 2) {
    return undefined
  }

  const previous = unicodeScalarBefore(source, offset, matchingFloor)
  const next = unicodeScalarAt(source, runEnd, matchingCeiling)
  const previousIsWhitespace =
    previous === undefined || UNICODE_WHITESPACE.test(previous)
  const nextIsWhitespace = next === undefined || UNICODE_WHITESPACE.test(next)
  const previousIsPunctuation =
    previous !== undefined && UNICODE_PUNCTUATION_OR_SYMBOL.test(previous)
  const nextIsPunctuation =
    next !== undefined && UNICODE_PUNCTUATION_OR_SYMBOL.test(next)
  const leftFlanking =
    !nextIsWhitespace &&
    (!nextIsPunctuation || previousIsWhitespace || previousIsPunctuation)
  const rightFlanking =
    !previousIsWhitespace &&
    (!previousIsPunctuation || nextIsWhitespace || nextIsPunctuation)
  const canOpen = markerCodeUnit === 95
    ? leftFlanking && (!rightFlanking || previousIsPunctuation)
    : leftFlanking
  const canClose = markerCodeUnit === 95
    ? rightFlanking && (!leftFlanking || nextIsPunctuation)
    : rightFlanking
  return Object.freeze({
    markerCodeUnit,
    start: offset,
    end: runEnd,
    length,
    canOpen,
    canClose,
    matchingScopeId: matchingScope?.id ?? -1
  })
}

function appendInlineItem(list: InlineList, item: InlineItem): void {
  item.previous = list.tail
  item.next = undefined
  if (list.tail === undefined) {
    list.head = item
  } else {
    list.tail.next = item
  }
  list.tail = item
}

function appendMergedMarkdownNode(
  nodes: MarkdownNode[],
  node: MarkdownNode
): void {
  const previous = nodes.at(-1)
  if (
    previous?.kind === 'text' &&
    node.kind === 'text' &&
    previous.range.end === node.range.start
  ) {
    nodes[nodes.length - 1] = createNode(
      'text',
      previous.range.start,
      node.range.end
    )
    return
  }
  nodes.push(node)
}

function markdownNodeFromInlineItem(item: InlineItem): MarkdownNode {
  return item.kind === 'node'
    ? item.node
    : createNode('text', item.start, item.end)
}

function delimiterPairIsAllowed(
  opener: InlineDelimiterItem,
  closer: InlineDelimiterItem
): boolean {
  if (
    opener.markerCodeUnit !== closer.markerCodeUnit ||
    !opener.canOpen ||
    !closer.canClose
  ) {
    return false
  }
  if (opener.markerCodeUnit === 126) {
    return true
  }
  return !(
    (opener.canClose || closer.canOpen) &&
    (opener.length + closer.length) % 3 === 0 &&
    (opener.length % 3 !== 0 || closer.length % 3 !== 0)
  )
}

function wrapInlineDelimiterPair(
  list: InlineList,
  opener: InlineDelimiterItem,
  closer: InlineDelimiterItem
): void {
  const useCount =
    opener.length >= 2 && closer.length >= 2 ? 2 : 1
  const openerMarkerStart = opener.end - useCount
  const closerMarkerEnd = closer.start + useCount
  const children: MarkdownNode[] = []
  for (let item = opener.next; item !== undefined && item !== closer;) {
    const next = item.next
    if (item.kind === 'delimiter') {
      item.active = false
    }
    appendMergedMarkdownNode(children, markdownNodeFromInlineItem(item))
    item = next
  }

  opener.end -= useCount
  opener.length -= useCount
  closer.start += useCount
  closer.length -= useCount
  const nodeKind: MarkdownNodeKind =
    opener.markerCodeUnit === 126
      ? 'strikethrough'
      : useCount === 2
        ? 'strong'
        : 'emphasis'
  const nodeItem: InlineNodeItem = {
    kind: 'node',
    node: createNode(
      nodeKind,
      openerMarkerStart,
      closerMarkerEnd,
      children
    ),
    previous: undefined,
    next: undefined
  }

  const before = opener.length === 0 ? opener.previous : opener
  const after = closer.length === 0 ? closer.next : closer
  if (opener.length === 0) {
    opener.active = false
  }
  if (closer.length === 0) {
    closer.active = false
  }
  nodeItem.previous = before
  nodeItem.next = after
  if (before === undefined) {
    list.head = nodeItem
  } else {
    before.next = nodeItem
  }
  if (after === undefined) {
    list.tail = nodeItem
  } else {
    after.previous = nodeItem
  }
}

function resolveInlineDelimiterItems(
  list: InlineList,
  delimiters: readonly InlineDelimiterItem[],
  boundaryPolicy?: InlineBoundaryPolicy
): readonly MarkdownNode[] {
  const openerStacks = new Map<number, InlineDelimiterItem[]>()
  const openerBottoms = new Map<number, Map<string, number>>()
  const futureCloserIndexes = new Map<string, number[]>()
  const futureCloserKey = (
    delimiter: InlineDelimiterItem,
    lengthModulo: number = delimiter.length % 3,
    canOpen: boolean = delimiter.canOpen
  ): string =>
    `${delimiter.matchingScopeId}:${delimiter.markerCodeUnit}:${lengthModulo}:${canOpen ? 1 : 0}`
  for (let index = 0; index < delimiters.length; index += 1) {
    const delimiter = delimiters[index]
    if (delimiter === undefined || !delimiter.canClose) {
      continue
    }
    const key = futureCloserKey(delimiter)
    const indexes = futureCloserIndexes.get(key)
    if (indexes === undefined) {
      futureCloserIndexes.set(key, [index])
    } else {
      indexes.push(index)
    }
  }
  const nextSameScopeCloser = (
    opener: InlineDelimiterItem,
    afterIndex: number
  ): Readonly<{
    readonly delimiter: InlineDelimiterItem
    readonly index: number
  }> | undefined => {
    let selectedIndex = Number.POSITIVE_INFINITY
    for (let lengthModulo = 0; lengthModulo < 3; lengthModulo += 1) {
      for (const canOpen of [false, true]) {
        const indexes = futureCloserIndexes.get(
          futureCloserKey(opener, lengthModulo, canOpen)
        ) ?? []
        let low = 0
        let high = indexes.length
        while (low < high) {
          const middle = low + Math.floor((high - low) / 2)
          if ((indexes[middle] ?? Number.POSITIVE_INFINITY) <= afterIndex) {
            low = middle + 1
          } else {
            high = middle
          }
        }
        const candidateIndex = indexes[low]
        const candidate = delimiters[candidateIndex ?? -1]
        if (
          candidateIndex !== undefined &&
          candidateIndex < selectedIndex &&
          candidate !== undefined &&
          delimiterPairIsAllowed(opener, candidate)
        ) {
          selectedIndex = candidateIndex
        }
      }
    }
    const delimiter = delimiters[selectedIndex]
    return delimiter === undefined
      ? undefined
      : Object.freeze({ delimiter, index: selectedIndex })
  }
  for (
    let delimiterIndex = 0;
    delimiterIndex < delimiters.length;
    delimiterIndex += 1
  ) {
    const closer = delimiters[delimiterIndex]
    if (closer === undefined) {
      continue
    }
    if (!closer.active) {
      continue
    }
    if (closer.canClose) {
      while (closer.active && closer.length > 0) {
        const openers = openerStacks.get(closer.markerCodeUnit) ?? []
        const bottoms = openerBottoms.get(closer.markerCodeUnit) ?? new Map()
        if (!openerBottoms.has(closer.markerCodeUnit)) {
          openerBottoms.set(closer.markerCodeUnit, bottoms)
        }
        const closerClass = closer.markerCodeUnit === 126
          ? 'tilde'
          : `${closer.length % 3}:${closer.canOpen ? 1 : 0}`
        const lowerBound = Math.min(
          bottoms.get(closerClass) ?? 0,
          openers.length
        )
        let openerIndex = openers.length - 1
        while (openerIndex >= lowerBound) {
          const opener = openers[openerIndex]
          if (
            opener !== undefined &&
            opener.active &&
            delimiterPairIsAllowed(opener, closer)
          ) {
            break
          }
          openerIndex -= 1
        }
        const opener = openers[openerIndex]
        if (openerIndex < lowerBound || opener === undefined) {
          bottoms.set(closerClass, openers.length)
          break
        }
        if (opener.matchingScopeId !== closer.matchingScopeId) {
          const laterOpenerScopeCloser = nextSameScopeCloser(
            opener,
            delimiterIndex
          )
          const laterCloserScopeCloser = closer.canOpen
            ? nextSameScopeCloser(closer, delimiterIndex)
            : undefined
          if (
            boundaryPolicy !== undefined &&
            (opener.markerCodeUnit === 42 || opener.markerCodeUnit === 95) &&
            opener.length === 1 &&
            closer.length === 1 &&
            laterOpenerScopeCloser?.delimiter.length === 1 &&
            laterCloserScopeCloser?.delimiter.length === 1 &&
            laterCloserScopeCloser.index < laterOpenerScopeCloser.index
          ) {
            const replacementMarker = opener.markerCodeUnit === 42 ? '_' : '*'
            const respelling = Object.freeze({
              kind: 'respell-enclosing-emphasis-delimiters' as const,
              openerStart: opener.start,
              openerEnd: opener.end,
              closerStart: laterOpenerScopeCloser.delimiter.start,
              closerEnd: laterOpenerScopeCloser.delimiter.end,
              replacementMarker
            })
            boundaryPolicy.enclosingEmphasisRespellings.set(
              `${respelling.openerStart}:${respelling.closerStart}`,
              respelling
            )
            break
          }
          const unsafeDelimiter: InlineDelimiterItem =
            laterOpenerScopeCloser !== undefined ? closer : opener
          for (
            let markerOffset = unsafeDelimiter.start;
            markerOffset < unsafeDelimiter.end;
          ) {
            boundaryPolicy?.unsafeDelimiterOffsets.add(markerOffset)
            markerOffset += 1
          }
          unsafeDelimiter.active = false
          if (unsafeDelimiter === closer) {
            break
          }
          openers.splice(openerIndex, 1)
          for (const [key, bottom] of bottoms) {
            if (bottom > openers.length) {
              bottoms.set(key, openers.length)
            }
          }
          continue
        }
        wrapInlineDelimiterPair(list, opener, closer)
        openers.length = openerIndex + (opener.active ? 1 : 0)
        for (const [key, bottom] of bottoms) {
          if (bottom > openers.length) {
            bottoms.set(key, openers.length)
          }
        }
      }
    }
    if (closer.active && closer.length > 0 && closer.canOpen) {
      const openers = openerStacks.get(closer.markerCodeUnit)
      if (openers === undefined) {
        openerStacks.set(closer.markerCodeUnit, [closer])
      } else if (openers.at(-1) !== closer) {
        openers.push(closer)
      }
    }
  }

  const nodes: MarkdownNode[] = []
  for (let item = list.head; item !== undefined; item = item.next) {
    appendMergedMarkdownNode(nodes, markdownNodeFromInlineItem(item))
  }
  return Object.freeze(nodes)
}

function appendInlineRange(
  list: InlineList,
  delimiters: InlineDelimiterItem[],
  source: string,
  start: number,
  end: number,
  constructs: ReadonlyMap<number, MappedMarkdownLiteral> = EMPTY_INLINE_CONSTRUCTS,
  referenceDefinitions: MarkdownReferenceDefinitionLookup =
  EMPTY_REFERENCE_DEFINITIONS,
  boundaryPolicy?: InlineBoundaryPolicy
): void {
  const appendNode = (node: MarkdownNode): void => {
    appendInlineItem(list, {
      kind: 'node',
      node,
      previous: undefined,
      next: undefined
    })
  }
  let textStart = start
  let offset = start
  while (offset < end) {
    const literal = constructs.get(offset)
    const construct = literal?.construct
    if (
      literal !== undefined &&
      construct !== undefined &&
      literal.end <= end
    ) {
      if (textStart < offset) {
        appendNode(createNode('text', textStart, offset))
      }
      appendNode(createNode(
        construct.kind,
        construct.start,
        literal.end,
        parseInlineNodes(
          source,
          construct.labelStart,
          construct.labelEnd,
          constructs,
          referenceDefinitions,
          boundaryPolicy
        ),
        {
          destinationStart: literal.start,
          destinationEnd: literal.end
        }
      ))
      offset = literal.end
      textStart = offset
      continue
    }
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 10 || codeUnit === 13) {
      const lineEndingEnd =
        codeUnit === 13 && source.charCodeAt(offset + 1) === 10
          ? offset + 2
          : offset + 1
      let breakStart = offset
      let kind: MarkdownNodeKind = 'soft-break'
      let spaces = 0
      while (breakStart > textStart && source.charCodeAt(breakStart - 1) === 32) {
        breakStart -= 1
        spaces += 1
      }
      if (spaces >= 2) {
        kind = 'hard-break'
      } else {
        breakStart = offset
        if (
          offset > textStart &&
          source.charCodeAt(offset - 1) === 92 &&
          !hasOddBackslashRunBefore(source, offset - 1, textStart)
        ) {
          breakStart = offset - 1
          kind = 'hard-break'
        }
      }
      if (textStart < breakStart) {
        appendNode(createNode('text', textStart, breakStart))
      }
      appendNode(createNode(kind, breakStart, lineEndingEnd))
      offset = lineEndingEnd
      textStart = offset
      continue
    }
    if (
      source.charCodeAt(offset) === 91 &&
      source.charCodeAt(offset + 1) === 94 &&
      !hasOddBackslashRunBefore(source, offset, start)
    ) {
      const close = source.indexOf(']', offset + 2)
      if (close > offset + 2 && close < end) {
        if (textStart < offset) {
          appendNode(createNode('text', textStart, offset))
        }
        appendNode(createNode(
          'footnote-reference',
          offset,
          close + 1,
          [],
          {
            label: normalizeMarkdownReferenceLabel(
              source,
              offset + 2,
              close
            )
          }
        ))
        offset = close + 1
        textStart = offset
        continue
      }
    }
    const referenceLink = findReferenceLink(
      source,
      offset,
      end,
      start,
      referenceDefinitions,
      boundaryPolicy
    )
    if (referenceLink !== undefined) {
      if (textStart < offset) {
        appendNode(createNode('text', textStart, offset))
      }
      appendNode(createNode(
        referenceLink.kind,
        referenceLink.start,
        referenceLink.end,
        parseInlineNodes(
          source,
          referenceLink.labelStart,
          referenceLink.labelEnd,
          constructs,
          referenceDefinitions,
          boundaryPolicy
        ),
        { referenceLabel: referenceLink.referenceLabel }
      ))
      offset = referenceLink.end
      textStart = offset
      continue
    }
    if (
      literal !== undefined &&
      literal.end <= end &&
      (
        literal.provider === 'inline-code' ||
        literal.provider === 'inline-html' ||
        literal.provider === 'autolink' ||
        literal.provider === 'math'
      )
    ) {
      if (textStart < offset) {
        appendNode(createNode('text', textStart, offset))
      }
      const kind: MarkdownNodeKind =
        literal.provider === 'math' ? 'inline-math' : literal.provider
      let markerLength = 0
      if (literal.provider === 'inline-code') {
        while (
          offset + markerLength < literal.end &&
          source.charCodeAt(offset + markerLength) === 96
        ) {
          markerLength += 1
        }
      }
      appendNode(createNode(
        kind,
        offset,
        literal.end,
        [],
        markerLength === 0 ? EMPTY_ATTRIBUTES : { markerLength }
      ))
      offset = literal.end
      textStart = offset
      continue
    }
    const delimiterRun = delimiterRunAt(
      source,
      offset,
      start,
      end,
      boundaryPolicy
    )
    if (delimiterRun !== undefined) {
      if (textStart < offset) {
        appendNode(createNode('text', textStart, offset))
      }
      const delimiter: InlineDelimiterItem = {
        kind: 'delimiter',
        markerCodeUnit: delimiterRun.markerCodeUnit,
        canOpen: delimiterRun.canOpen,
        canClose: delimiterRun.canClose,
        start: delimiterRun.start,
        end: delimiterRun.end,
        length: delimiterRun.length,
        active: true,
        matchingScopeId: delimiterRun.matchingScopeId,
        previous: undefined,
        next: undefined
      }
      appendInlineItem(list, delimiter)
      delimiters.push(delimiter)
      offset = delimiterRun.end
      textStart = offset
      continue
    }
    offset += 1
  }
  if (textStart < end) {
    appendNode(createNode('text', textStart, end))
  }
}

function parseInlineNodes(
  source: string,
  start: number,
  end: number,
  constructs: ReadonlyMap<number, MappedMarkdownLiteral> = EMPTY_INLINE_CONSTRUCTS,
  referenceDefinitions: MarkdownReferenceDefinitionLookup =
  EMPTY_REFERENCE_DEFINITIONS,
  boundaryPolicy?: InlineBoundaryPolicy
): readonly MarkdownNode[] {
  const list: InlineList = { head: undefined, tail: undefined }
  const delimiters: InlineDelimiterItem[] = []
  appendInlineRange(
    list,
    delimiters,
    source,
    start,
    end,
    constructs,
    referenceDefinitions,
    boundaryPolicy
  )
  return resolveInlineDelimiterItems(list, delimiters, boundaryPolicy)
}

function parseInlineLineSequence(
  source: string,
  lines: readonly PlainMarkdownLine[],
  constructs: ReadonlyMap<number, MappedMarkdownLiteral>,
  referenceDefinitions: MarkdownReferenceDefinitionLookup,
  boundaryPolicy?: InlineBoundaryPolicy
): readonly MarkdownNode[] {
  const list: InlineList = { head: undefined, tail: undefined }
  const delimiters: InlineDelimiterItem[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) {
      continue
    }
    appendInlineRange(
      list,
      delimiters,
      source,
      line.contentOffset,
      index + 1 < lines.length ? line.end : line.contentEnd,
      constructs,
      referenceDefinitions,
      boundaryPolicy
    )
  }
  return resolveInlineDelimiterItems(list, delimiters, boundaryPolicy)
}

function leadingIndent(source: string, start: number, end: number): number {
  let offset = start
  while (offset < end && offset - start < 4 && source.charCodeAt(offset) === 32) {
    offset += 1
  }
  return offset - start
}

function parseAtxHeading(
  source: string,
  start: number,
  end: number,
  constructs: ReadonlyMap<number, MappedMarkdownLiteral> = EMPTY_INLINE_CONSTRUCTS,
  referenceDefinitions: MarkdownReferenceDefinitionLookup =
  EMPTY_REFERENCE_DEFINITIONS,
  boundaryPolicy?: InlineBoundaryPolicy
): MarkdownNode | undefined {
  const indentation = leadingIndent(source, start, end)
  let offset = start + indentation
  if (indentation > 3 || source.charCodeAt(offset) !== 35) {
    return undefined
  }
  const markerStart = offset
  while (offset < end && source.charCodeAt(offset) === 35) {
    offset += 1
  }
  const level = offset - markerStart
  if (
    level > 6 ||
    (offset < end && source.charCodeAt(offset) !== 32 && source.charCodeAt(offset) !== 9)
  ) {
    return undefined
  }
  while (
    offset < end &&
    (source.charCodeAt(offset) === 32 || source.charCodeAt(offset) === 9)
  ) {
    offset += 1
  }
  let contentEnd = end
  while (
    contentEnd > offset &&
    (source.charCodeAt(contentEnd - 1) === 32 || source.charCodeAt(contentEnd - 1) === 9)
  ) {
    contentEnd -= 1
  }
  let closingStart = contentEnd
  while (closingStart > offset && source.charCodeAt(closingStart - 1) === 35) {
    closingStart -= 1
  }
  if (
    closingStart < contentEnd &&
    closingStart > offset &&
    (source.charCodeAt(closingStart - 1) === 32 || source.charCodeAt(closingStart - 1) === 9)
  ) {
    contentEnd = closingStart - 1
    while (
      contentEnd > offset &&
      (source.charCodeAt(contentEnd - 1) === 32 || source.charCodeAt(contentEnd - 1) === 9)
    ) {
      contentEnd -= 1
    }
  }
  const children = offset < contentEnd
    ? parseInlineNodes(
      source,
      offset,
      contentEnd,
      constructs,
      referenceDefinitions,
      boundaryPolicy
    )
    : []
  return createNode('heading', start, end, children, { level })
}

function blockLiteralNode(
  source: string,
  literal: MappedMarkdownLiteral,
  start: number = literal.start
): MarkdownNode | undefined {
  if (literal.provider === 'fenced-code' || literal.provider === 'indented-code') {
    return createNode('code-block', start, literal.end, [], {
      provider: literal.provider
    })
  }
  if (literal.provider === 'html-block') {
    return createNode('html-block', start, literal.end)
  }
  if (literal.provider === 'front-matter') {
    return createNode('front-matter', start, literal.end)
  }
  if (literal.provider === 'definition') {
    return createNode(
      literal.blockKind === 'footnote-definition'
        ? 'footnote-definition'
        : 'definition',
      start,
      literal.end
    )
  }
  if (literal.provider === 'diagram') {
    return createNode('diagram', start, literal.end)
  }
  if (literal.provider === 'math') {
    const firstLineEndCandidates = [
      source.indexOf('\n', literal.start),
      source.indexOf('\r', literal.start)
    ].filter((candidate) => candidate >= literal.start && candidate < literal.end)
    const firstLineEnd = firstLineEndCandidates.length === 0
      ? literal.end
      : Math.min(...firstLineEndCandidates)
    const firstLine = source.slice(literal.start, firstLineEnd).trim()
    if (
      firstLine === '$$' ||
      /^(?:`{3,}|~{3,})[\t ]*math(?:[\t ].*)?$/i.test(firstLine)
    ) {
      return createNode('math-block', start, literal.end)
    }
  }
  return undefined
}

interface MutableContainerNode {
  readonly mutable: true
  readonly kind: 'document' | 'blockquote' | 'list' | 'list-item' | 'paragraph'
  readonly attributes: Readonly<Record<string, string | number | boolean>>
  readonly children: Array<MutableContainerNode | MarkdownNode>
  start: number
  end: number
  readonly listDelimiterCodeUnit?: number
}

interface OpenContainerContext {
  readonly descriptor: PlainMarkdownContainer
  readonly content: MutableContainerNode
  readonly extents: readonly MutableContainerNode[]
}

interface ParsedContainerSequence {
  readonly nodes: readonly MarkdownNode[]
  readonly nextLineIndex: number
}

function mutableContainerNode(
  kind: MutableContainerNode['kind'],
  start: number,
  end: number,
  attributes: Readonly<Record<string, string | number | boolean>> = EMPTY_ATTRIBUTES,
  listDelimiterCodeUnit?: number
): MutableContainerNode {
  return {
    mutable: true,
    kind,
    start,
    end,
    attributes,
    children: [],
    ...(listDelimiterCodeUnit === undefined ? {} : { listDelimiterCodeUnit })
  }
}

function isMutableContainerNode(
  node: MutableContainerNode | MarkdownNode
): node is MutableContainerNode {
  return 'mutable' in node && node.mutable
}

function finalizeMutableContainer(node: MutableContainerNode): MarkdownNode {
  return createNode(
    node.kind,
    node.start,
    node.end,
    node.children.map((child) =>
      isMutableContainerNode(child) ? finalizeMutableContainer(child) : child
    ),
    node.attributes
  )
}

function sameContainerKind(
  context: OpenContainerContext,
  descriptor: PlainMarkdownContainer
): boolean {
  if (context.descriptor.kind !== descriptor.kind) {
    return false
  }
  return descriptor.kind !== 'list-item' || (
    context.descriptor.kind === 'list-item' &&
    context.descriptor.ordered === descriptor.ordered &&
    context.descriptor.delimiterCodeUnit === descriptor.delimiterCodeUnit
  )
}

function parseOrderedContainerSequence(
  source: string,
  lines: readonly PlainMarkdownLine[],
  lineIndex: number,
  literals: readonly MappedMarkdownLiteral[],
  constructs: ReadonlyMap<number, MappedMarkdownLiteral>,
  referenceDefinitions: MarkdownReferenceDefinitionLookup,
  boundaryPolicy?: InlineBoundaryPolicy
): ParsedContainerSequence | undefined {
  if ((lines[lineIndex]?.containers.length ?? 0) === 0) {
    return undefined
  }

  const root = mutableContainerNode('document', 0, source.length)
  const stack: OpenContainerContext[] = []
  let paragraphOwner: MutableContainerNode | undefined
  let paragraph: MutableContainerNode | undefined
  let paragraphLines: PlainMarkdownLine[] = []
  let literalEnd = -1
  let nextLineIndex = lineIndex

  const currentParent = (): MutableContainerNode =>
    stack.at(-1)?.content ?? root
  const extendOpenContainers = (end: number): void => {
    for (const context of stack) {
      for (const extent of context.extents) {
        extent.end = Math.max(extent.end, end)
      }
    }
  }
  const closeParagraph = (): void => {
    if (paragraph !== undefined && paragraphLines.length > 0) {
      paragraph.children.push(...parseInlineLineSequence(
        source,
        paragraphLines,
        constructs,
        referenceDefinitions,
        boundaryPolicy
      ))
    }
    paragraphOwner = undefined
    paragraph = undefined
    paragraphLines = []
  }

  while (nextLineIndex < lines.length) {
    const line = lines[nextLineIndex]
    if (line === undefined) {
      break
    }
    if (line.containers.length === 0) {
      break
    }

    let reusedDepth = 0
    while (
      reusedDepth < line.containers.length &&
      reusedDepth < stack.length
    ) {
      const descriptor = line.containers[reusedDepth]
      const context = stack[reusedDepth]
      if (
        descriptor === undefined ||
        context === undefined ||
        !descriptor.continued ||
        !sameContainerKind(context, descriptor)
      ) {
        break
      }
      reusedDepth += 1
    }
    if (reusedDepth < stack.length) {
      stack.splice(reusedDepth)
      closeParagraph()
    }

    for (let depth = reusedDepth; depth < line.containers.length; depth += 1) {
      const descriptor = line.containers[depth]
      if (descriptor === undefined) {
        continue
      }
      const parent = currentParent()
      if (descriptor.kind === 'blockquote') {
        const quote = mutableContainerNode(
          'blockquote',
          descriptor.start,
          descriptor.end
        )
        parent.children.push(quote)
        stack.push(Object.freeze({
          descriptor,
          content: quote,
          extents: Object.freeze([quote])
        }))
        continue
      }

      const previousChild = parent.children.at(-1)
      const compatibleList =
        previousChild !== undefined &&
        isMutableContainerNode(previousChild) &&
        previousChild.kind === 'list' &&
        previousChild.attributes.ordered === descriptor.ordered &&
        previousChild.listDelimiterCodeUnit === descriptor.delimiterCodeUnit
          ? previousChild
          : undefined
      const list = compatibleList ?? mutableContainerNode(
        'list',
        descriptor.start,
        descriptor.end,
        descriptor.ordered
          ? Object.freeze({ ordered: true, start: descriptor.startNumber })
          : Object.freeze({ ordered: false }),
        descriptor.delimiterCodeUnit
      )
      if (compatibleList === undefined) {
        parent.children.push(list)
      }
      const item = mutableContainerNode(
        'list-item',
        descriptor.start,
        descriptor.end,
        descriptor.ordered
          ? Object.freeze({ ordinal: descriptor.startNumber })
          : EMPTY_ATTRIBUTES
      )
      list.children.push(item)
      stack.push(Object.freeze({
        descriptor,
        content: item,
        extents: Object.freeze([list, item])
      }))
    }

    const parent = currentParent()
    if (line.blank) {
      closeParagraph()
      nextLineIndex += 1
      continue
    }

    if (line.start < literalEnd) {
      extendOpenContainers(Math.min(literalEnd, line.contentEnd))
      closeParagraph()
      nextLineIndex += 1
      continue
    }
    const literal = literals.find(
      (candidate) =>
        candidate.start <= line.contentOffset &&
        line.contentOffset < candidate.end
    )
    const literalNode =
      literal !== undefined && literal.start >= line.start
        ? blockLiteralNode(source, literal, line.contentOffset)
        : undefined
    if (literal !== undefined && literalNode !== undefined) {
      parent.children.push(literalNode)
      literalEnd = literal.end
      extendOpenContainers(literal.end)
      closeParagraph()
      nextLineIndex += 1
      continue
    }

    const heading = parseAtxHeading(
      source,
      line.contentOffset,
      line.contentEnd,
      constructs,
      referenceDefinitions,
      boundaryPolicy
    )
    if (heading !== undefined) {
      parent.children.push(heading)
      extendOpenContainers(heading.range.end)
      closeParagraph()
      nextLineIndex += 1
      continue
    }

    if (paragraphOwner !== parent || paragraph === undefined) {
      closeParagraph()
      paragraph = mutableContainerNode(
        'paragraph',
        line.contentOffset,
        line.contentEnd
      )
      parent.children.push(paragraph)
      paragraphOwner = parent
    }
    paragraphLines.push(line)
    paragraph.end = line.contentEnd
    extendOpenContainers(line.contentEnd)
    nextLineIndex += 1
  }

  closeParagraph()

  return Object.freeze({
    nodes: Object.freeze(root.children.map((child) =>
      isMutableContainerNode(child) ? finalizeMutableContainer(child) : child
    )),
    nextLineIndex
  })
}

function setextHeadingLevel(
  source: string,
  line: PlainMarkdownLine
): 1 | 2 | undefined {
  if (line.indentation > 3 || line.blockQuoteDepth > 0 || line.listDepth > 0) {
    return undefined
  }
  let start = line.contentOffset
  while (
    start < line.contentEnd &&
    (source.charCodeAt(start) === 32 || source.charCodeAt(start) === 9)
  ) {
    start += 1
  }
  let end = line.contentEnd
  while (
    end > start &&
    (source.charCodeAt(end - 1) === 32 || source.charCodeAt(end - 1) === 9)
  ) {
    end -= 1
  }
  const marker = source.charCodeAt(start)
  if (marker !== 61 && marker !== 45) {
    return undefined
  }
  for (let offset = start + 1; offset < end; offset += 1) {
    if (source.charCodeAt(offset) !== marker) {
      return undefined
    }
  }
  return marker === 61 ? 1 : 2
}

function isThematicBreak(source: string, line: PlainMarkdownLine): boolean {
  if (line.indentation > 3 || line.blockQuoteDepth > 0 || line.listDepth > 0) {
    return false
  }
  let marker: number | undefined
  let count = 0
  for (let offset = line.contentOffset; offset < line.contentEnd; offset += 1) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 32 || codeUnit === 9) {
      continue
    }
    if (codeUnit !== 42 && codeUnit !== 45 && codeUnit !== 95) {
      return false
    }
    marker ??= codeUnit
    if (codeUnit !== marker) {
      return false
    }
    count += 1
  }
  return count >= 3
}

interface TableCellRange {
  readonly start: number
  readonly end: number
}

function splitTableCells(
  source: string,
  line: PlainMarkdownLine
): readonly TableCellRange[] | undefined {
  const separators: number[] = []
  for (let offset = line.contentOffset; offset < line.contentEnd; offset += 1) {
    if (
      source.charCodeAt(offset) === 124 &&
      !hasOddBackslashRunBefore(source, offset, line.contentOffset)
    ) {
      separators.push(offset)
    }
  }
  if (separators.length === 0) {
    return undefined
  }
  const boundaries = [line.contentOffset, ...separators, line.contentEnd]
  const cells: TableCellRange[] = []
  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    let start = boundaries[index] ?? line.contentOffset
    let end = boundaries[index + 1] ?? line.contentEnd
    if (index > 0) {
      start += 1
    }
    while (
      start < end &&
      (source.charCodeAt(start) === 32 || source.charCodeAt(start) === 9)
    ) {
      start += 1
    }
    while (
      end > start &&
      (source.charCodeAt(end - 1) === 32 || source.charCodeAt(end - 1) === 9)
    ) {
      end -= 1
    }
    const isLeadingEmpty = index === 0 && start === end
    const isTrailingEmpty = index + 2 === boundaries.length && start === end
    if (!isLeadingEmpty && !isTrailingEmpty) {
      cells.push(Object.freeze({ start, end }))
    }
  }
  return cells.length === 0 ? undefined : Object.freeze(cells)
}

type TableAlignment = 'none' | 'left' | 'center' | 'right'

function tableDelimiterAlignments(
  source: string,
  line: PlainMarkdownLine
): readonly TableAlignment[] | undefined {
  const cells = splitTableCells(source, line)
  if (cells === undefined) {
    return undefined
  }
  const alignments: TableAlignment[] = []
  for (const cell of cells) {
    const value = source.slice(cell.start, cell.end)
    if (!/^:?-{3,}:?$/.test(value)) {
      return undefined
    }
    alignments.push(
      value.startsWith(':') && value.endsWith(':')
        ? 'center'
        : value.startsWith(':')
          ? 'left'
          : value.endsWith(':')
            ? 'right'
            : 'none'
    )
  }
  return Object.freeze(alignments)
}

interface ParsedTable {
  readonly node: MarkdownNode
  readonly nextLineIndex: number
}

function parseTable(
  source: string,
  lines: readonly PlainMarkdownLine[],
  lineIndex: number,
  constructs: ReadonlyMap<number, MappedMarkdownLiteral>,
  referenceDefinitions: MarkdownReferenceDefinitionLookup,
  boundaryPolicy?: InlineBoundaryPolicy
): ParsedTable | undefined {
  const headerLine = lines[lineIndex]
  const delimiterLine = lines[lineIndex + 1]
  if (
    headerLine === undefined ||
    delimiterLine === undefined ||
    headerLine.blank ||
    delimiterLine.blank ||
    headerLine.blockQuoteDepth !== 0 ||
    headerLine.listDepth !== 0
  ) {
    return undefined
  }
  const headerCells = splitTableCells(source, headerLine)
  const alignments = tableDelimiterAlignments(source, delimiterLine)
  if (
    headerCells === undefined ||
    alignments === undefined ||
    headerCells.length !== alignments.length
  ) {
    return undefined
  }
  const rows: MarkdownNode[] = []
  const createRow = (
    line: PlainMarkdownLine,
    cells: readonly TableCellRange[],
    header: boolean
  ): MarkdownNode => createNode(
    'table-row',
    line.start,
    line.contentEnd,
    alignments.map((alignment, index) => {
      const cell = cells[index] ?? Object.freeze({
        start: line.contentEnd,
        end: line.contentEnd
      })
      return createNode(
        'table-cell',
        cell.start,
        cell.end,
        parseInlineNodes(
          source,
          cell.start,
          cell.end,
          constructs,
          referenceDefinitions,
          boundaryPolicy
        ),
        { header, alignment }
      )
    }),
    { header }
  )
  rows.push(createRow(headerLine, headerCells, true))
  let nextLineIndex = lineIndex + 2
  while (nextLineIndex < lines.length) {
    const line = lines[nextLineIndex]
    if (line === undefined || line.blank || line.blockQuoteDepth > 0 || line.listDepth > 0) {
      break
    }
    const cells = splitTableCells(source, line)
    if (cells === undefined) {
      break
    }
    rows.push(createRow(line, cells, false))
    nextLineIndex += 1
  }
  const lastLine = lines[nextLineIndex - 1] ?? delimiterLine
  return Object.freeze({
    node: createNode(
      'table',
      headerLine.start,
      lastLine.contentEnd,
      rows,
      { columns: alignments.length }
    ),
    nextLineIndex
  })
}

function parseBlocks(
  source: string,
  literals: readonly MappedMarkdownLiteral[],
  lines: readonly PlainMarkdownLine[],
  referenceDefinitions: MarkdownReferenceDefinitionLookup,
  boundaryPolicy?: InlineBoundaryPolicy
): readonly MarkdownNode[] {
  const blocks: MarkdownNode[] = []
  const constructs = new Map<number, MappedMarkdownLiteral>()
  for (const literal of literals) {
    if (
      literal.construct !== undefined ||
      literal.provider === 'inline-code' ||
      literal.provider === 'inline-html' ||
      literal.provider === 'autolink' ||
      literal.provider === 'math'
    ) {
      constructs.set(literal.construct?.start ?? literal.start, literal)
    }
  }
  let literalIndex = 0
  let lineIndex = 0
  while (lineIndex < lines.length) {
    const line = lines[lineIndex]
    if (line === undefined) {
      break
    }
    if (line.blank) {
      lineIndex += 1
      continue
    }
    const containerSequence = parseOrderedContainerSequence(
      source,
      lines,
      lineIndex,
      literals,
      constructs,
      referenceDefinitions,
      boundaryPolicy
    )
    if (containerSequence !== undefined) {
      blocks.push(...containerSequence.nodes)
      lineIndex = containerSequence.nextLineIndex
      while (
        literalIndex < literals.length &&
        (literals[literalIndex]?.end ?? Number.POSITIVE_INFINITY) <=
          (containerSequence.nodes.at(-1)?.range.end ?? line.start)
      ) {
        literalIndex += 1
      }
      continue
    }
    const table = parseTable(
      source,
      lines,
      lineIndex,
      constructs,
      referenceDefinitions,
      boundaryPolicy
    )
    if (table !== undefined) {
      blocks.push(table.node)
      lineIndex = table.nextLineIndex
      continue
    }
    while ((literals[literalIndex]?.end ?? Number.POSITIVE_INFINITY) <= line.start) {
      literalIndex += 1
    }
    const literal = literals[literalIndex]
    const standalone = parseAtxHeading(
      source,
      line.start,
      line.contentEnd,
      constructs,
      referenceDefinitions,
      boundaryPolicy
    )
    if (standalone !== undefined) {
      blocks.push(standalone)
      lineIndex += 1
      while (
        lineIndex < lines.length &&
        (lines[lineIndex]?.start ?? Number.POSITIVE_INFINITY) < standalone.range.end
      ) {
        lineIndex += 1
      }
      if (literal !== undefined && literal.end === standalone.range.end) {
        literalIndex += 1
      }
      continue
    }
    const setextLine = lines[lineIndex + 1]
    const setextLevel =
      setextLine === undefined ? undefined : setextHeadingLevel(source, setextLine)
    if (setextLine !== undefined && setextLevel !== undefined) {
      blocks.push(createNode(
        'heading',
        line.start,
        setextLine.contentEnd,
        parseInlineNodes(
          source,
          line.contentOffset,
          line.contentEnd,
          constructs,
          referenceDefinitions,
          boundaryPolicy
        ),
        { level: setextLevel, style: 'setext' }
      ))
      lineIndex += 2
      continue
    }
    if (isThematicBreak(source, line)) {
      blocks.push(createNode('thematic-break', line.start, line.contentEnd))
      lineIndex += 1
      continue
    }
    const literalNode =
      literal !== undefined && literal.start === line.start
        ? blockLiteralNode(source, literal)
        : undefined
    if (literal !== undefined && literalNode !== undefined) {
      blocks.push(literalNode)
      lineIndex += 1
      while (
        lineIndex < lines.length &&
        (lines[lineIndex]?.start ?? Number.POSITIVE_INFINITY) < literal.end
      ) {
        lineIndex += 1
      }
      literalIndex += 1
      continue
    }
    const paragraphStart = line.start
    let paragraphEnd = line.contentEnd
    let nextLineIndex = lineIndex + 1
    while (nextLineIndex < lines.length) {
      const nextLine = lines[nextLineIndex]
      if (
        nextLine === undefined ||
        nextLine.blank ||
        nextLine.blockQuoteDepth > 0 ||
        parseAtxHeading(
          source,
          nextLine.start,
          nextLine.contentEnd,
          constructs,
          referenceDefinitions,
          boundaryPolicy
        ) !== undefined ||
        nextLine.listMarkers.length > 0
      ) {
        break
      }
      paragraphEnd = nextLine.contentEnd
      nextLineIndex += 1
    }
    blocks.push(createNode(
      'paragraph',
      paragraphStart,
      paragraphEnd,
      parseInlineNodes(
        source,
        paragraphStart,
        paragraphEnd,
        constructs,
        referenceDefinitions,
        boundaryPolicy
      )
    ))
    lineIndex = nextLineIndex
  }
  return Object.freeze(blocks)
}

function containsPosition(
  range: ViewRange,
  offset: number,
  affinity: 'previous' | 'next'
): boolean {
  if (range.start === range.end) {
    return offset === range.start
  }
  return (
    (range.start < offset && offset < range.end) ||
    (offset === range.start && affinity === 'next') ||
    (offset === range.end && affinity === 'previous')
  )
}

interface BoundaryAwareMarkdownParse extends Profile1MarkdownParse {
  readonly boundaryProjectionEdits: readonly MarkdownArmBoundaryProjectionEdit[]
}

function backtickRunEnd(
  source: string,
  start: number,
  ceiling: number
): number {
  let end = start
  while (end < ceiling && source.charCodeAt(end) === 96) {
    end += 1
  }
  return end
}

interface AuthenticatedMarkdownDelimiterIdentity {
  readonly sourceRunId: number
  readonly sourceStart: number
  readonly matchingScopeId: number
}

interface AuthenticatedMarkdownDelimiterLookup {
  readonly authenticate: (
    start: number,
    end: number
  ) => AuthenticatedMarkdownDelimiterIdentity | undefined
}

function createAuthenticatedMarkdownDelimiterLookup(
  canonicalIdentityRuns: readonly MappedMarkdownCanonicalIdentityRun[],
  boundaryPolicy: InlineBoundaryPolicy | undefined,
  trace?: Profile1ProjectionPlanningTraceV1
): AuthenticatedMarkdownDelimiterLookup {
  const scopeRuns = boundaryPolicy?.scopeRuns ?? []
  let identityRunIndex = 0
  let scopeRunIndex = 0
  let previousStart = -1
  return Object.freeze({
    authenticate: Object.freeze((
      start: number,
      end: number
    ): AuthenticatedMarkdownDelimiterIdentity | undefined => {
      if (start < previousStart) {
        throw new Error('Markdown delimiter identity lookup moved backward')
      }
      previousStart = start
      // One indexed lookup request. Both index cursors below advance
      // monotonically, so the recorded candidate probes stay linear in the
      // number of runs rather than rescanning the lane per query.
      trace?.recorder.recordInlineCodeCloserQuery(trace.view, start, end)
      if (start >= end) {
        return undefined
      }
      while (
        (canonicalIdentityRuns[identityRunIndex]?.candidateEnd ??
          Number.POSITIVE_INFINITY) <= start
      ) {
        trace?.recorder.recordInlineCodeCloserCandidate(trace.view, start, end)
        identityRunIndex += 1
      }
      const identityRun = canonicalIdentityRuns[identityRunIndex]
      if (
        identityRun === undefined ||
        identityRun.candidateStart > start ||
        end > identityRun.candidateEnd
      ) {
        return undefined
      }

      while (
        (scopeRuns[scopeRunIndex]?.end ?? Number.POSITIVE_INFINITY) <= start
      ) {
        trace?.recorder.recordInlineCodeCloserCandidate(trace.view, start, end)
        scopeRunIndex += 1
      }
      const matchingScope = scopeRuns[scopeRunIndex]
      const startsInMatchingScope =
        matchingScope !== undefined && matchingScope.start <= start
      if (startsInMatchingScope) {
        if (end > matchingScope.end) {
          return undefined
        }
      } else if (
        matchingScope !== undefined && matchingScope.start < end
      ) {
        return undefined
      }

      return Object.freeze({
        sourceRunId: identityRun.sourceRunId,
        sourceStart:
          identityRun.sourceStart + start - identityRun.candidateStart,
        matchingScopeId: startsInMatchingScope
          ? matchingScope.id
          : -1
      })
    })
  })
}

interface InlineCodeLiteralExtensionAnalysis {
  readonly literal: MappedMarkdownLiteral
  readonly openerEnd: number
  readonly closerStart: number
  readonly delimiterLength: number
  readonly extensionDelimiterLength: number | undefined
  readonly eligibleUnsafeOffsets: ReadonlySet<number>
}

function analyzeInlineCodeLiteralForExtension(
  source: string,
  literal: MappedMarkdownLiteral,
  identityLookup: AuthenticatedMarkdownDelimiterLookup,
  trace?: Profile1ProjectionPlanningTraceV1
): InlineCodeLiteralExtensionAnalysis {
  trace?.recorder.recordInlineCodeExtensionAnalysis(
    trace.view,
    literal.start,
    literal.end
  )
  const openerEnd = backtickRunEnd(source, literal.start, literal.end)
  const delimiterLength = openerEnd - literal.start
  let closerStart = literal.end - 1
  while (
    closerStart > literal.start &&
    source.charCodeAt(closerStart - 1) === 96
  ) {
    closerStart -= 1
  }
  if (
    delimiterLength === 0 ||
    literal.end - closerStart !== delimiterLength
  ) {
    throw new Error('Inline-code literal lost its paired delimiters')
  }

  const openerIdentity = identityLookup.authenticate(
    literal.start,
    openerEnd
  )
  let maximumInteriorRunLength = 0
  const eligibleUnsafeOffsets = new Set<number>()
  for (let offset = openerEnd; offset < closerStart;) {
    if (source.charCodeAt(offset) !== 96) {
      offset += 1
      continue
    }
    const runEnd = backtickRunEnd(source, offset, closerStart)
    maximumInteriorRunLength = Math.max(
      maximumInteriorRunLength,
      runEnd - offset
    )
    if (runEnd - offset >= delimiterLength) {
      eligibleUnsafeOffsets.add(runEnd - delimiterLength)
    }
    offset = runEnd
  }
  const closerIdentity = identityLookup.authenticate(
    closerStart,
    literal.end
  )
  const canExtend =
    openerIdentity !== undefined &&
    closerIdentity !== undefined &&
    openerIdentity.matchingScopeId === closerIdentity.matchingScopeId &&
    maximumInteriorRunLength >= delimiterLength
  return Object.freeze({
    literal,
    openerEnd,
    closerStart,
    delimiterLength,
    extensionDelimiterLength: canExtend
      ? maximumInteriorRunLength + 1
      : undefined,
    eligibleUnsafeOffsets: canExtend
      ? eligibleUnsafeOffsets
      : new Set<number>()
  })
}

function inlineCodeDelimiterExtension(
  analysis: InlineCodeLiteralExtensionAnalysis,
  unsafeOffset: number
): Extract<
  MarkdownArmBoundaryProjectionEdit,
  { readonly kind: 'extend-inline-code-delimiters' }
> | undefined {
  const extensionDelimiterLength = analysis.extensionDelimiterLength
  if (
    extensionDelimiterLength === undefined ||
    !analysis.eligibleUnsafeOffsets.has(unsafeOffset)
  ) {
    return undefined
  }
  return Object.freeze({
    kind: 'extend-inline-code-delimiters',
    openerStart: analysis.literal.start,
    openerEnd: analysis.openerEnd,
    closerStart: analysis.closerStart,
    closerEnd: analysis.literal.end,
    delimiterLength: extensionDelimiterLength
  })
}

function unauthenticatedInlineCodeDelimiterOffsets(
  source: string,
  literals: readonly MappedMarkdownLiteral[],
  identityLookup: AuthenticatedMarkdownDelimiterLookup
): readonly number[] {
  const offsets: number[] = []
  for (const literal of literals) {
    const openerEnd = backtickRunEnd(source, literal.start, literal.end)
    let closerStart = literal.end - 1
    while (
      closerStart > literal.start &&
      source.charCodeAt(closerStart - 1) === 96
    ) {
      closerStart -= 1
    }
    const openerLength = openerEnd - literal.start
    if (
      openerLength <= 0 ||
      literal.end - closerStart !== openerLength
    ) {
      throw new Error('Inline-code literal lost its paired delimiters')
    }
    const openerIdentity = identityLookup.authenticate(
      literal.start,
      openerEnd
    )
    if (openerIdentity === undefined) {
      offsets.push(literal.start)
      continue
    }
    const closerIdentity = identityLookup.authenticate(
      closerStart,
      literal.end
    )
    if (
      closerIdentity === undefined ||
      closerIdentity.matchingScopeId !== openerIdentity.matchingScopeId
    ) {
      offsets.push(closerStart)
    }
  }
  return Object.freeze(offsets)
}

function emphasisFlankingScalarEdits(
  source: string,
  respelling: Extract<
    MarkdownArmBoundaryProjectionEdit,
    { readonly kind: 'respell-enclosing-emphasis-delimiters' }
  >
): readonly Extract<
    MarkdownArmBoundaryProjectionEdit,
    { readonly kind: 'encode-emphasis-flanking-scalar' }
  >[] {
  if (respelling.replacementMarker !== '_') {
    return Object.freeze([])
  }
  const edits: Extract<
    MarkdownArmBoundaryProjectionEdit,
    { readonly kind: 'encode-emphasis-flanking-scalar' }
  >[] = []
  const beforeOpener = unicodeScalarRangeBefore(source, respelling.openerStart)
  const afterOpener = unicodeScalarRangeAt(source, respelling.openerEnd)
  if (
    !underscoreCanOpenBetween(beforeOpener?.scalar, afterOpener?.scalar) &&
    beforeOpener !== undefined
  ) {
    edits.push(Object.freeze({
      kind: 'encode-emphasis-flanking-scalar',
      candidateStart: beforeOpener.start,
      candidateEnd: beforeOpener.end,
      codePoint: beforeOpener.scalar.codePointAt(0) ?? 0
    }))
  }

  const beforeCloser = unicodeScalarRangeBefore(source, respelling.closerStart)
  const afterCloser = unicodeScalarRangeAt(source, respelling.closerEnd)
  if (
    !underscoreCanCloseBetween(beforeCloser?.scalar, afterCloser?.scalar) &&
    afterCloser !== undefined
  ) {
    edits.push(Object.freeze({
      kind: 'encode-emphasis-flanking-scalar',
      candidateStart: afterCloser.start,
      candidateEnd: afterCloser.end,
      codePoint: afterCloser.scalar.codePointAt(0) ?? 0
    }))
  }
  return Object.freeze(edits)
}

function planBoundaryProjectionEdits(
  source: string,
  literals: readonly MappedMarkdownLiteral[],
  canonicalIdentityRuns: readonly MappedMarkdownCanonicalIdentityRun[],
  boundaryPolicy: InlineBoundaryPolicy | undefined,
  unsafeDelimiterOffsets: ReadonlySet<number>,
  enclosingEmphasisRespellings: ReadonlyMap<
    string,
    Extract<
      MarkdownArmBoundaryProjectionEdit,
      { readonly kind: 'respell-enclosing-emphasis-delimiters' }
    >
  >,
  armTerminationEdits: readonly MarkdownArmBoundaryProjectionEdit[],
  trace?: Profile1ProjectionPlanningTraceV1
): readonly MarkdownArmBoundaryProjectionEdit[] {
  const respellings = [
    ...enclosingEmphasisRespellings.values()
  ].sort((left, right) => left.openerStart - right.openerStart)
  const edits: MarkdownArmBoundaryProjectionEdit[] = [
    ...armTerminationEdits
  ]
  const flankingScalarEditsByRange = new Map<
    string,
    Extract<
      MarkdownArmBoundaryProjectionEdit,
      { readonly kind: 'encode-emphasis-flanking-scalar' }
    >
  >()
  for (const respelling of respellings) {
    edits.push(respelling)
    for (const scalarEdit of emphasisFlankingScalarEdits(source, respelling)) {
      const rangeKey = `${scalarEdit.candidateStart}:${scalarEdit.candidateEnd}`
      const existing = flankingScalarEditsByRange.get(rangeKey)
      if (existing === undefined) {
        flankingScalarEditsByRange.set(rangeKey, scalarEdit)
        edits.push(scalarEdit)
        continue
      }
      if (existing.codePoint !== scalarEdit.codePoint) {
        throw new Error(
          'Emphasis projection codecs conflict for one flanking scalar'
        )
      }
    }
  }
  const inlineCodeLiterals = literals.filter(
    (literal) => literal.provider === 'inline-code'
  )
  const protectionOffsets = new Set<number>(
    unauthenticatedInlineCodeDelimiterOffsets(
      source,
      inlineCodeLiterals,
      createAuthenticatedMarkdownDelimiterLookup(
        canonicalIdentityRuns,
        boundaryPolicy,
        trace
      )
    )
  )
  const analysisIdentityLookup = createAuthenticatedMarkdownDelimiterLookup(
    canonicalIdentityRuns,
    boundaryPolicy
  )
  const extendedInlineCodeStarts = new Set<number>()
  let inlineCodeLiteralIndex = 0
  let cachedAnalysis: InlineCodeLiteralExtensionAnalysis | undefined
  let visitedUnsafeOffsetCount = 0
  for (
    let candidateOffset = 0;
    candidateOffset < source.length;
    candidateOffset += 1
  ) {
    if (!unsafeDelimiterOffsets.has(candidateOffset)) {
      continue
    }
    visitedUnsafeOffsetCount += 1
    while (
      (inlineCodeLiterals[inlineCodeLiteralIndex]?.end ??
        Number.POSITIVE_INFINITY) <= candidateOffset
    ) {
      inlineCodeLiteralIndex += 1
      cachedAnalysis = undefined
    }
    const literal = inlineCodeLiterals[inlineCodeLiteralIndex]
    let extension: Extract<
      MarkdownArmBoundaryProjectionEdit,
      { readonly kind: 'extend-inline-code-delimiters' }
    > | undefined
    if (
      literal !== undefined &&
      literal.start < candidateOffset &&
      candidateOffset < literal.end &&
      source.charCodeAt(candidateOffset) === 96
    ) {
      cachedAnalysis ??= analyzeInlineCodeLiteralForExtension(
        source,
        literal,
        analysisIdentityLookup,
        trace
      )
      extension = inlineCodeDelimiterExtension(
        cachedAnalysis,
        candidateOffset
      )
    }
    if (extension !== undefined) {
      if (!extendedInlineCodeStarts.has(extension.openerStart)) {
        extendedInlineCodeStarts.add(extension.openerStart)
        edits.push(extension)
      }
      continue
    }
    protectionOffsets.add(candidateOffset)
  }
  if (visitedUnsafeOffsetCount !== unsafeDelimiterOffsets.size) {
    throw new Error('Unsafe Markdown delimiter offset is outside the lane')
  }
  let visitedProtectionOffsetCount = 0
  for (
    let candidateOffset = 0;
    candidateOffset < source.length;
    candidateOffset += 1
  ) {
    if (protectionOffsets.has(candidateOffset)) {
      visitedProtectionOffsetCount += 1
      edits.push(Object.freeze({ kind: 'protect-delimiter', candidateOffset }))
    }
  }
  if (visitedProtectionOffsetCount !== protectionOffsets.size) {
    throw new Error('Markdown delimiter protection is outside the lane')
  }
  return Object.freeze(edits)
}

function validatedCanonicalIdentityRuns(
  sourceLength: number,
  runs: readonly MappedMarkdownCanonicalIdentityRun[] | undefined
): readonly MappedMarkdownCanonicalIdentityRun[] {
  const stable = Object.freeze([...(runs ?? [])])
  let previousEnd = 0
  for (const run of stable) {
    if (
      !Number.isInteger(run.candidateStart) ||
      !Number.isInteger(run.candidateEnd) ||
      !Number.isInteger(run.sourceRunId) ||
      !Number.isInteger(run.sourceStart) ||
      run.candidateStart < previousEnd ||
      run.candidateStart >= run.candidateEnd ||
      run.candidateEnd > sourceLength ||
      run.sourceRunId < 0 ||
      run.sourceStart < 0
    ) {
      throw new Error('Mapped Markdown canonical identity run is invalid')
    }
    previousEnd = run.candidateEnd
  }
  return stable
}

function validatedMatchingScopeRuns(
  sourceLength: number,
  scopes: readonly MappedMarkdownMatchingScope[] | undefined
): readonly MappedMarkdownMatchingScope[] {
  const stable = Object.freeze([...(scopes ?? [])])
  const ids = new Set<number>()
  const events: Array<Readonly<{
    readonly offset: number
    readonly role: 'enter' | 'exit'
    readonly scope: MappedMarkdownMatchingScope
  }>> = []
  for (const scope of stable) {
    if (
      scope === undefined ||
      !Number.isInteger(scope.id) ||
      ids.has(scope.id) ||
      !Number.isInteger(scope.start) ||
      !Number.isInteger(scope.end) ||
      !Number.isInteger(scope.depth) ||
      scope.start < 0 ||
      scope.start >= scope.end ||
      scope.end > sourceLength ||
      scope.depth < 0
    ) {
      throw new Error('Mapped Markdown matching scope is invalid')
    }
    ids.add(scope.id)
    events.push(
      Object.freeze({ offset: scope.start, role: 'enter', scope }),
      Object.freeze({ offset: scope.end, role: 'exit', scope })
    )
  }
  events.sort((left, right) =>
    left.offset - right.offset ||
    (left.role === right.role
      ? left.role === 'enter'
        ? left.scope.depth - right.scope.depth
        : right.scope.depth - left.scope.depth
      : left.role === 'exit' ? -1 : 1)
  )

  const active: MappedMarkdownMatchingScope[] = []
  const runs: MappedMarkdownMatchingScope[] = []
  let eventIndex = 0
  while (eventIndex < events.length) {
    const offset = events[eventIndex]?.offset
    if (offset === undefined) {
      break
    }
    while (events[eventIndex]?.offset === offset) {
      const event = events[eventIndex]
      if (event === undefined) {
        break
      }
      if (event.role === 'exit') {
        if (active.pop()?.id !== event.scope.id) {
          throw new Error('Mapped Markdown matching scopes cross')
        }
      } else {
        if (event.scope.depth !== active.length) {
          throw new Error('Mapped Markdown matching scope depth is invalid')
        }
        active.push(event.scope)
      }
      eventIndex += 1
    }
    const nextOffset = events[eventIndex]?.offset
    const selected = active.at(-1)
    if (
      selected !== undefined &&
      nextOffset !== undefined &&
      offset < nextOffset
    ) {
      runs.push(Object.freeze({
        id: selected.id,
        start: offset,
        end: nextOffset,
        depth: selected.depth
      }))
    }
  }
  if (active.length !== 0) {
    throw new Error('Mapped Markdown matching scope is unterminated')
  }
  return Object.freeze(runs)
}

function parseMarkdownDocumentWithBoundaryEvidence(
  lane: MappedMarkdownLane,
  containerDepthLimit: number = Number.POSITIVE_INFINITY,
  trace?: Profile1ProjectionPlanningTraceV1
): BoundaryAwareMarkdownParse {
  // Every full document parse flows through here — both parseMarkdownDocument
  // and planMarkdownArmBoundaryProjectionEdits (which builds a full document
  // only to read its boundary edits). Count here so no full-parse entry point
  // is invisible to __markdownDocumentParsesV1 (invariant 21).
  markdownDocumentParses += 1
  const source = lane.source
  const canonicalIdentityRuns = validatedCanonicalIdentityRuns(
    source.length,
    lane.canonicalIdentityRuns
  )
  const matchingScopeRuns = validatedMatchingScopeRuns(
    source.length,
    lane.matchingScopes
  )
  const boundaryPolicy: InlineBoundaryPolicy | undefined =
    matchingScopeRuns.length === 0
      ? undefined
      : {
        scopeRuns: matchingScopeRuns,
        unsafeDelimiterOffsets: new Set<number>(),
        enclosingEmphasisRespellings: new Map()
      }
  const matchingScopePolicy: MarkdownMatchingScopePolicy | undefined =
    boundaryPolicy === undefined
      ? undefined
      : Object.freeze({
        matchingScopeAt: Object.freeze((offset: number) => {
          const scope = matchingScopeAt(boundaryPolicy, offset)
          return scope === undefined
            ? undefined
            : Object.freeze({ id: scope.id, depth: scope.depth })
        }),
        rejectCrossScopeMatch: Object.freeze((
          openerStart: number,
          closerStart: number
        ): number | undefined => {
          const unsafeOffset = mappedCrossScopeProtectionOffset(
            boundaryPolicy,
            openerStart,
            closerStart
          )
          if (unsafeOffset !== undefined) {
            boundaryPolicy.unsafeDelimiterOffsets.add(unsafeOffset)
          }
          return unsafeOffset
        }),
        rejectCrossScopeImageOpener: Object.freeze((
          bangStart: number,
          bracketStart: number
        ): void => {
          if (
            (matchingScopeAt(boundaryPolicy, bangStart)?.id ?? -1) ===
            (matchingScopeAt(boundaryPolicy, bracketStart)?.id ?? -1)
          ) {
            throw new Error('Cross-scope image rejection received one scope')
          }
          boundaryPolicy.unsafeDelimiterOffsets.add(bangStart)
        }),
        definitionCanResolveReference: Object.freeze((
          definitionStart: number,
          referenceStart: number
        ): boolean => (lane.matchingScopes ?? []).every((scope) =>
          !(
            scope.start <= definitionStart &&
            definitionStart < scope.end
          ) || (
            scope.start <= referenceStart &&
            referenceStart < scope.end
          )
        ))
      })
  // Count units where the block phase actually consumes text. That is the
  // shareable work — block structure, literals and definitions — so measuring
  // here is what makes "unchanged text is parsed once" observable: sharing a
  // region across views means its characters are handed to this phase once.
  markdownParsedUnits += source.length
  const parsedLane = parsePlainMarkdownLane(
    source,
    containerDepthLimit,
    matchingScopePolicy
  )
  const literals = parsedLane.literals.map(
    (literal): MappedMarkdownLiteral => Object.freeze({
      provider: literal.kind,
      start: literal.start,
      end: literal.end,
      ...(literal.construct === undefined
        ? {}
        : { construct: literal.construct }),
      ...(literal.blockKind === undefined
        ? {}
        : { blockKind: literal.blockKind })
    })
  )
  // The block/literal phase already built this index from these exact literals
  // with this exact predicate; consume it rather than rebuilding an identical
  // one (Phase 0.5 step 6: one index per lane parse, handed to the inline phase).
  const referenceDefinitions = parsedLane.referenceDefinitions
  const children =
    source.length === 0
      ? Object.freeze([])
      : parseBlocks(
        source,
        literals,
        parsedLane.lines,
        referenceDefinitions,
        boundaryPolicy
      )
  const root = createNode('document', 0, source.length, children)
  const nodeAt = Object.freeze((
    projectedOffset: number,
    affinity: 'previous' | 'next'
  ): readonly MarkdownNode[] => {
    if (
      !Number.isInteger(projectedOffset) ||
      projectedOffset < 0 ||
      projectedOffset > source.length
    ) {
      throw new RangeError('Projected Markdown position is outside the document')
    }
    if (affinity !== 'previous' && affinity !== 'next') {
      throw new RangeError(`Unknown projected Markdown affinity: ${String(affinity)}`)
    }
    const path: MarkdownNode[] = [root]
    let current = root
    while (current.childCount > 0) {
      let selected: MarkdownNode | undefined
      for (let ordinal = 0; ordinal < current.childCount; ordinal += 1) {
        const child = current.childAt(ordinal)
        if (containsPosition(child.range, projectedOffset, affinity)) {
          selected = child
          break
        }
      }
      if (selected === undefined) {
        break
      }
      path.push(selected)
      current = selected
    }
    return Object.freeze(path)
  })
  return Object.freeze({
    document: Object.freeze({ source, root, nodeAt }),
    containerDepthFailure: parsedLane.containerDepthFailure,
    boundaryProjectionEdits: planBoundaryProjectionEdits(
      source,
      literals,
      canonicalIdentityRuns,
      boundaryPolicy,
      boundaryPolicy?.unsafeDelimiterOffsets ?? new Set<number>(),
      boundaryPolicy?.enclosingEmphasisRespellings ?? new Map(),
      lane.armTerminationEdits ?? Object.freeze([]),
      trace
    )
  })
}

export function planMarkdownArmBoundaryProjectionEdits(
  lane: MappedMarkdownLane,
  containerDepthLimit: number = Number.POSITIVE_INFINITY,
  trace?: Profile1ProjectionPlanningTraceV1
): readonly MarkdownArmBoundaryProjectionEdit[] {
  return parseMarkdownDocumentWithBoundaryEvidence(
    lane,
    containerDepthLimit,
    trace
  ).boundaryProjectionEdits
}

/**
 * Test-only counter of authoritative Markdown parses. Phase 0.5 drives this
 * toward one parse per published view; a projection that verifies itself by
 * parsing the same text twice is counted twice here on purpose.
 */
let markdownDocumentParses = 0

export function __markdownDocumentParsesV1(): number {
  return markdownDocumentParses
}

export function __resetMarkdownDocumentParsesV1(): void {
  markdownDocumentParses = 0
  markdownParsedUnits = 0
}

/**
 * Test-only counter of parsed source units — the code units handed to the
 * Markdown grammar, summed over every parse.
 *
 * Parse *count* cannot express the parse-once invariant for a document that
 * carries markers: Original and Revised resolve to genuinely different text
 * (`ab` vs `axb`), so they can never literally share one parse, and the count
 * has a floor of one per distinct view text. What the invariant actually claims
 * is that *unchanged* text is parsed once — which is a statement about units,
 * not calls. A document whose views differ in one paragraph should cost about
 * its own length plus that paragraph, not twice its length.
 *
 * So this is the metric slices 2-3 are measured by; the parse count remains
 * useful only for the case where views share one text exactly.
 */
let markdownParsedUnits = 0

export function __markdownParsedUnitsV1(): number {
  return markdownParsedUnits
}

export function parseMarkdownDocument(
  lane: MappedMarkdownLane,
  containerDepthLimit: number = Number.POSITIVE_INFINITY
): Profile1MarkdownParse {
  const parsed = parseMarkdownDocumentWithBoundaryEvidence(
    lane,
    containerDepthLimit
  )
  return Object.freeze({
    document: parsed.document,
    containerDepthFailure: parsed.containerDepthFailure
  })
}
