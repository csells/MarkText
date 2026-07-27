import type {
  MarkdownDocument,
  MarkdownLiteralProvider,
  MarkdownNode,
  MarkdownNodeKind,
  SourceOffset,
  ViewRange
} from '../../revision.js'
import {
  PARSE_SOURCE_CHECKPOINT_INTERVAL,
  type ParseExecutionTracker
} from '../../parseExecutionControl.js'
import {
  normalizeMarkdownReferenceLabel,
  parseIntrinsicForkMarkdownLaneFacts,
  type MarkdownCheckpoint,
  type PlainMarkdownLaneParse,
  type PlainMarkdownLaneParseWithDefinitions,
  __plainMarkdownLaneUnitsV1,
  __resetPlainMarkdownLaneUnitsV1,
  type MarkdownMatchingScopePolicy,
  type MarkdownReferenceDefinitionLookup,
  type PlainMarkdownContainer,
  type PlainMarkdownLine
} from './markdownLaneState.js'
import type {
  MarkdownContainerDepthFailure,
  MarkdownInlineConstruct,
  MarkdownLiteralRange
} from './markdownTypes.js'
import { composeMarkdownLiteralRanges } from './markdownTypes.js'
import type {
  ProfileParseTraceRecorderV1,
  ProfileParseTraceViewV1
} from '../profileParseTraceV1.js'
import {
  findGfmExtendedAutolink,
  findInlineLinkDestinationEnd
} from './markdownLexical.js'
import {
  createProfile1SyntaxIdentityRegistry,
  defineNodeId,
  type Profile1SyntaxIdentityRegistry,
  type SyntaxSourceIdentity
} from './syntaxIdentity.js'
import {
  findMarker,
  type FormDefinition,
  type MarkerRole,
  type Profile1CriticKind
} from './sourceTape.js'
import type {
  IntrinsicProfile1ForkGraph,
  IntrinsicProfile1ForkLane
} from './intrinsicProfile1ForkGraph.js'
import {
  recordForkAstRegionEmissionV1,
  recordForkAstRegionReuseV1,
  __profile1PhysicalTraversalCountsV1,
  __resetProfile1PhysicalTraversalCountsV1
} from './physicalTraversalAccounting.js'
import {
  createStagedProfile1ReferenceDefinitionLookup,
  type Profile1CanonicalReferenceDefinitionLookup,
  type Profile1ReferenceDelimiterCandidate
} from './referenceDefinitionIndex.js'
import { createMarkdownDocumentIndices } from './markdownDocumentIndices.js'

export interface IntrinsicProfile1Delimiter {
  readonly kind: 'delimiter'
  readonly definition: FormDefinition
  readonly role: MarkerRole
  readonly start: number
  readonly end: number
}

export interface IntrinsicProfile1Text {
  readonly kind: 'markdown-text'
  readonly start: number
  readonly end: number
}

export type IntrinsicProfile1SourceStep =
  | IntrinsicProfile1Delimiter
  | IntrinsicProfile1Text

/**
 * Canonical-source progression for the intrinsic Profile 1 grammar.
 *
 * The Markdown kernel owns the cursor and lexes CriticMarkup delimiters as
 * native grammar candidates. The CriticMarkup production can accept a whole
 * delimiter or reject one code unit, but it cannot scan or reposition the
 * source itself. Pre-indexing closer and separator starts also keeps standing
 * arm boundaries in the same source authority.
 */
export interface IntrinsicProfile1SourceProgression {
  readonly hasCriticMarkupCandidate: boolean
  readonly referenceDefinitions: Profile1CanonicalReferenceDefinitionLookup
  readonly offset: () => number
  readonly next: () => IntrinsicProfile1SourceStep | undefined
  readonly consume: (end: number) => void
  readonly nextCloserStart: (
    kind: Profile1CriticKind,
    start: number
  ) => number
  readonly nextSubstitutionSeparatorStart: (start: number) => number
}

function nextIndexedOffset(
  offsets: readonly number[],
  start: number,
  fallback: number
): number {
  let low = 0
  let high = offsets.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if ((offsets[middle] ?? Number.POSITIVE_INFINITY) < start) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return offsets[low] ?? fallback
}

export function createIntrinsicProfile1SourceProgression(
  source: string,
  execution?: ParseExecutionTracker
): IntrinsicProfile1SourceProgression {
  const delimiterByStart = new Map<number, IntrinsicProfile1Delimiter>()
  const referenceDelimiterCandidates: Profile1ReferenceDelimiterCandidate[] = []
  const closerStartsByKind = new Map<Profile1CriticKind, number[]>()
  const substitutionSeparatorStarts: number[] = []
  const physicalLineStarts = [0]
  const sourceStepBoundaryStarts: number[] = []
  const lineEndingEndByStart = new Map<number, number>()
  let hasDefinitionCandidate = false
  for (let offset = 0; offset < source.length; offset += 1) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 10) {
      sourceStepBoundaryStarts.push(offset)
      lineEndingEndByStart.set(offset, offset + 1)
      if (source.charCodeAt(offset - 1) !== 13) {
        physicalLineStarts.push(offset + 1)
      }
    } else if (codeUnit === 13) {
      sourceStepBoundaryStarts.push(offset)
      lineEndingEndByStart.set(
        offset,
        source.charCodeAt(offset + 1) === 10 ? offset + 2 : offset + 1
      )
      physicalLineStarts.push(
        source.charCodeAt(offset + 1) === 10 ? offset + 2 : offset + 1
      )
    }
    hasDefinitionCandidate ||= codeUnit === 93 &&
      source.charCodeAt(offset + 1) === 58
    if (
      (offset + 1) % PARSE_SOURCE_CHECKPOINT_INTERVAL === 0
    ) {
      execution?.examineSource(PARSE_SOURCE_CHECKPOINT_INTERVAL)
    }
    const marker = findMarker(source, offset)
    if (marker === undefined) {
      continue
    }
    sourceStepBoundaryStarts.push(offset)
    delimiterByStart.set(offset, Object.freeze({
      kind: 'delimiter',
      definition: marker.definition,
      role: marker.role,
      start: offset,
      end: offset + marker.length
    }))
    referenceDelimiterCandidates.push(Object.freeze({
      kind: marker.definition.kind,
      role: marker.role,
      start: offset,
      end: offset + marker.length
    }))
    if (marker.role === 'separator') {
      substitutionSeparatorStarts.push(offset)
    } else if (marker.role === 'close') {
      const starts = closerStartsByKind.get(marker.definition.kind)
      if (starts === undefined) {
        closerStartsByKind.set(marker.definition.kind, [offset])
      } else {
        starts.push(offset)
      }
    }
  }
  const indexedRemainder = source.length % PARSE_SOURCE_CHECKPOINT_INTERVAL
  if (indexedRemainder !== 0) {
    execution?.examineSource(indexedRemainder)
  }
  const referenceDefinitions =
    createStagedProfile1ReferenceDefinitionLookup(
      source,
      Object.freeze(referenceDelimiterCandidates),
      Object.freeze(physicalLineStarts.filter((start) => start < source.length)),
      hasDefinitionCandidate
    )

  let cursor = 0
  let sourceStepBoundaryOrdinal = 0
  const next = (): IntrinsicProfile1SourceStep | undefined => {
    if (cursor >= source.length) {
      return undefined
    }
    const delimiter = delimiterByStart.get(cursor)
    if (delimiter !== undefined) {
      return delimiter
    }
    const lineEndingEnd = lineEndingEndByStart.get(cursor)
    const boundaryStart = cursor + 1
    while (
      (sourceStepBoundaryStarts[sourceStepBoundaryOrdinal] ?? source.length) <
        boundaryStart
    ) {
      sourceStepBoundaryOrdinal += 1
    }
    const end = lineEndingEnd ?? Math.min(
      cursor + PARSE_SOURCE_CHECKPOINT_INTERVAL,
      sourceStepBoundaryStarts[sourceStepBoundaryOrdinal] ?? source.length
    )
    return Object.freeze({
      kind: 'markdown-text',
      start: cursor,
      end
    })
  }

  return Object.freeze({
    hasCriticMarkupCandidate: delimiterByStart.size !== 0,
    referenceDefinitions,
    offset: Object.freeze((): number => cursor),
    next: Object.freeze(next),
    consume: Object.freeze((end: number): void => {
      const step = next()
      if (
        step === undefined ||
        !Number.isInteger(end) ||
        end <= cursor ||
        end > step.end
      ) {
        throw new Error('Intrinsic Profile 1 grammar consumed outside its next token')
      }
      // The canonical indexing pass already examined these exact source units.
      // Consumption is still cooperatively cancellable, but it is parser work
      // over the indexed authority rather than a second source scan.
      execution?.examineParserWork(end - cursor)
      cursor = end
    }),
    nextCloserStart: Object.freeze((
      kind: Profile1CriticKind,
      start: number
    ): number => nextIndexedOffset(
      closerStartsByKind.get(kind) ?? Object.freeze([]),
      start,
      source.length
    )),
    nextSubstitutionSeparatorStart: Object.freeze((
      start: number
    ): number => nextIndexedOffset(
      substitutionSeparatorStarts,
      start,
      source.length
    ))
  })
}

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
  /** Profile configuration consumed by the block grammar. */
  readonly gfmEnabled?: boolean
  readonly frontMatterEnabled?: boolean
  readonly mathEnabled?: boolean
  readonly gitLabMathEnabled?: boolean
  readonly footnotesEnabled?: boolean
  readonly subscriptAndSuperscriptEnabled?: boolean
  /** Parser-owned view selection for this intrinsic fork continuation. */
  readonly forkView?: 'original' | 'revised' | 'editing'
  /**
   * Revision-owned identity sink. Supplying this makes node identity and
   * containment edges part of grammar construction rather than a tree rewrite.
   */
  readonly syntaxIdentity?: Readonly<{
    readonly registry: Profile1SyntaxIdentityRegistry
    readonly sourceAt: (start: number, end: number) => SyntaxSourceIdentity
  }>
  /**
   * Parser-owned Substitution-arm scopes mapped into this lane. These are
   * emitted fork facts; a branch read consumes them without rediscovery.
   */
  readonly matchingScopes?: readonly MappedMarkdownMatchingScope[]
  /** Maximal candidate runs that retain one contiguous canonical tape identity. */
  readonly canonicalIdentityRuns?: readonly MappedMarkdownCanonicalIdentityRun[]
  /**
   * Projection edits justified by parser-owned arm termination facts.
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
const TABLE_OF_CONTENTS_ATTRIBUTES = Object.freeze({
  tableOfContents: true
})
const EMPTY_INLINE_CONSTRUCTS: ReadonlyMap<number, MappedMarkdownLiteral> = new Map()
const EMPTY_REFERENCE_DEFINITIONS: MarkdownReferenceDefinitionLookup =
  Object.freeze({
    cacheKey: '[]',
    has: Object.freeze((): boolean => false)
  })

const GFM_TAG_FILTER_PATTERN =
  /<\/?(?:title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?=[\t\n\f\r />])/i

function gfmTagFilterApplies(content: string): boolean {
  return activeMarkdownGfmEnabled && GFM_TAG_FILTER_PATTERN.test(content)
}

function viewRange(start: number, end: number): ViewRange {
  return Object.freeze({ start, end })
}

interface ActiveMarkdownSyntaxIdentity {
  readonly registry: Profile1SyntaxIdentityRegistry
  readonly sourceAt: (start: number, end: number) => SyntaxSourceIdentity
  definitionStart?: (
    normalizedLabel: string,
    referenceStart: number
  ) => number | undefined
}

let activeMarkdownSyntaxIdentity: ActiveMarkdownSyntaxIdentity | undefined
let activeMarkdownGfmEnabled = true
let activeMarkdownFootnotesEnabled = true
let activeMarkdownSubscriptAndSuperscriptEnabled = false
let activeMarkdownExecution: ParseExecutionTracker | undefined

function stableAttributesKey(
  attributes: Readonly<Record<string, string | number | boolean>>
): string {
  return Object.keys(attributes)
    // These are view-coordinate projections of parser-owned source facts. They
    // move when an earlier CriticMarkup arm is elided, but that must not give
    // the same canonical syntax node a different identity in another view.
    .filter((key) => ![
      'destinationStart',
      'destinationEnd',
      'definitionStart',
      'titleStart',
      'titleEnd',
      'taskMarkerStart',
      'taskMarkerEnd',
      'labelStart',
      'labelEnd',
      'bodyStart',
      'bodyEnd',
      'contentStart',
      'contentEnd',
      'delimiterStart',
      'delimiterEnd'
    ].includes(key))
    .sort()
    .map((key) => `${key}=${String(attributes[key])}`)
    .join('&')
}

function createNode(
  kind: MarkdownNodeKind,
  start: number,
  end: number,
  children: readonly MarkdownNode[] = Object.freeze([]),
  attributes: Readonly<Record<string, string | number | boolean>> = EMPTY_ATTRIBUTES
): MarkdownNode {
  const stableChildren = Object.freeze([...children])
  const identity = activeMarkdownSyntaxIdentity
  if (identity === undefined) {
    throw new Error('Markdown syntax node was created outside a parser identity scope')
  }
  const stableAttributes = Object.freeze({ ...attributes })
  const sourceIdentity = identity.sourceAt(start, end)
  const semanticKey = [
    sourceIdentity.key,
    stableAttributesKey(stableAttributes),
    ...stableChildren.map((child) => child.nodeId)
  ].join('\u0000')
  const nodeId = identity.registry.emitNode(
    kind,
    sourceIdentity,
    semanticKey
  )
  for (const child of stableChildren) {
    identity.registry.emitEdge('contains', nodeId, child.nodeId)
  }
  if (
    kind === 'definition' &&
    typeof stableAttributes['label'] === 'string'
  ) {
    const definitionStart = stableAttributes['definitionStart']
    const definitionIdentity = typeof definitionStart === 'number'
      ? identity.sourceAt(definitionStart, definitionStart)
      : sourceIdentity
    identity.registry.emitDefinition(definitionIdentity.range.start, nodeId)
  } else if (
    kind === 'footnote-definition' &&
    typeof stableAttributes['label'] === 'string'
  ) {
    identity.registry.emitFootnoteDefinition(
      nodeId,
      stableAttributes['label']
    )
  } else if (
    kind === 'footnote-reference' &&
    typeof stableAttributes['label'] === 'string'
  ) {
    identity.registry.emitFootnoteReference(
      nodeId,
      stableAttributes['label']
    )
  } else if (
    (kind === 'link' || kind === 'image') &&
    typeof stableAttributes['referenceLabel'] === 'string'
  ) {
    const definitionStart = identity.definitionStart?.(
      stableAttributes['referenceLabel'],
      start
    )
    if (definitionStart !== undefined) {
      const definitionIdentity = identity.sourceAt(
        definitionStart,
        definitionStart
      )
      identity.registry.emitReference(nodeId, definitionIdentity.range.start)
    }
  }
  const objectKey = `${String(start)}:${String(end)}`
  return identity.registry.internObject(nodeId, objectKey, (): MarkdownNode => {
    const childAt = Object.freeze((ordinal: number): MarkdownNode => {
      if (
        !Number.isInteger(ordinal) ||
        ordinal < 0 ||
        ordinal >= stableChildren.length
      ) {
        throw new RangeError('Markdown child ordinal is outside the node')
      }
      const child = stableChildren[ordinal]
      if (child === undefined) {
        throw new Error('Markdown child index invariant failed')
      }
      return child
    })
    return Object.freeze(defineNodeId({
      kind,
      range: viewRange(start, end),
      attributes: stableAttributes,
      childCount: stableChildren.length,
      childAt
    }, nodeId))
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
  constructs: ReadonlyMap<number, MappedMarkdownLiteral>,
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
  // A link opener is inactive once a complete link has formed inside its
  // label. Images remain eligible because CommonMark permits links in image
  // descriptions; this function recognizes links only.
  for (const candidate of constructs.values()) {
    if (
      candidate.start > opener &&
      candidate.start < labelEnd &&
      candidate.end > labelEnd
    ) {
      return undefined
    }
    if (
      candidate.construct?.kind === 'link' &&
      candidate.construct.start > opener &&
      candidate.construct.start < labelEnd &&
      candidate.end <= labelEnd
    ) {
      return undefined
    }
  }
  for (let cursor = opener + 1; cursor < labelEnd; cursor += 1) {
    if (source.charCodeAt(cursor) !== 91) {
      continue
    }
    const activeImageOpener =
      cursor > opener + 1 &&
      source.charCodeAt(cursor - 1) === 33 &&
      !hasOddBackslashRunBefore(source, cursor - 1, opener + 1)
    if (activeImageOpener) {
      continue
    }
    if (
      findReferenceLink(
        source,
        cursor,
        labelEnd,
        opener + 1,
        constructs,
        referenceDefinitions,
        boundaryPolicy
      ) !== undefined
    ) {
      return undefined
    }
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
  readonly canonicalIdentityRuns:
  readonly MappedMarkdownCanonicalIdentityRun[]
  readonly unsafeDelimiterOffsets: Set<number>
  readonly enclosingEmphasisRespellings: Map<
    string,
    Extract<
      MarkdownArmBoundaryProjectionEdit,
      { readonly kind: 'respell-enclosing-emphasis-delimiters' }
    >
  >
  readonly emphasisFlankingScalarEdits: Map<
    string,
    Extract<
      MarkdownArmBoundaryProjectionEdit,
      { readonly kind: 'encode-emphasis-flanking-scalar' }
    >
  >
  readonly canonicalBacktickAtoms: Map<
    string,
    Readonly<{
      readonly start: number
      readonly end: number
      readonly scopeId: number
    }>
  >
  readonly projectedBacktickRuns: Map<
    string,
    Readonly<{
      readonly start: number
      readonly end: number
      readonly scopeId: number
    }>
  >
  readonly bracketOffsets: Set<number>
}

function createInlineBoundaryPolicy(
  scopeRuns: readonly MappedMarkdownMatchingScope[],
  canonicalIdentityRuns: readonly MappedMarkdownCanonicalIdentityRun[]
): InlineBoundaryPolicy {
  return {
    scopeRuns,
    canonicalIdentityRuns,
    unsafeDelimiterOffsets: new Set<number>(),
    enclosingEmphasisRespellings: new Map(),
    emphasisFlankingScalarEdits: new Map(),
    canonicalBacktickAtoms: new Map(),
    projectedBacktickRuns: new Map(),
    bracketOffsets: new Set()
  }
}

function recordBoundaryBacktickRun(
  source: string,
  start: number,
  ceiling: number,
  boundaryPolicy: InlineBoundaryPolicy
): number {
  const end = backtickRunEnd(source, start, ceiling)
  const scopeId = matchingScopeAt(boundaryPolicy, start)?.id ?? -1
  boundaryPolicy.projectedBacktickRuns.set(
    `${String(start)}:${String(end)}`,
    Object.freeze({ start, end, scopeId })
  )
  for (const identityRun of boundaryPolicy.canonicalIdentityRuns) {
    const atomStart = Math.max(start, identityRun.candidateStart)
    const atomEnd = Math.min(end, identityRun.candidateEnd)
    if (atomStart >= atomEnd) {
      continue
    }
    const atomScopeId =
      matchingScopeAt(boundaryPolicy, atomStart)?.id ?? -1
    boundaryPolicy.canonicalBacktickAtoms.set(
      `${String(atomStart)}:${String(atomEnd)}`,
      Object.freeze({
        start: atomStart,
        end: atomEnd,
        scopeId: atomScopeId
      })
    )
  }
  return end
}

function recordBoundaryBackticksInRange(
  source: string,
  start: number,
  end: number,
  boundaryPolicy: InlineBoundaryPolicy
): void {
  for (let offset = start; offset < end;) {
    if (source.charCodeAt(offset) !== 96) {
      offset += 1
      continue
    }
    offset = recordBoundaryBacktickRun(
      source,
      offset,
      end,
      boundaryPolicy
    )
  }
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
    (
      markerCodeUnit === 126 &&
      !activeMarkdownGfmEnabled &&
      !activeMarkdownSubscriptAndSuperscriptEnabled
    ) ||
    (
      markerCodeUnit === 94 &&
      !activeMarkdownSubscriptAndSuperscriptEnabled
    ) ||
    (
      markerCodeUnit !== 42 &&
      markerCodeUnit !== 95 &&
      markerCodeUnit !== 126 &&
      markerCodeUnit !== 94
    ) ||
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
  if (
    (markerCodeUnit === 126 && length > 2) ||
    (
      markerCodeUnit === 126 &&
      length === 2 &&
      !activeMarkdownGfmEnabled
    ) ||
    (markerCodeUnit === 94 && length !== 1)
  ) {
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
  source: string,
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
  if (
    activeMarkdownSubscriptAndSuperscriptEnabled &&
    (
      opener.markerCodeUnit === 94 ||
      (
        opener.markerCodeUnit === 126 &&
        (opener.length === 1 || closer.length === 1)
      )
    )
  ) {
    return opener.length === 1 &&
      closer.length === 1 &&
      opener.end < closer.start &&
      !/\s/u.test(source.slice(opener.end, closer.start))
  }
  if (opener.markerCodeUnit === 126) {
    return activeMarkdownGfmEnabled
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
    opener.markerCodeUnit === 94
      ? 'superscript'
      : opener.markerCodeUnit === 126
        ? activeMarkdownSubscriptAndSuperscriptEnabled && useCount === 1
          ? 'subscript'
          : 'strikethrough'
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
  source: string,
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
          delimiterPairIsAllowed(source, opener, candidate)
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
        const closerClass =
          closer.markerCodeUnit === 126 &&
          !activeMarkdownSubscriptAndSuperscriptEnabled
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
            delimiterPairIsAllowed(source, opener, closer)
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
            for (const scalarEdit of emphasisFlankingScalarEdits(
              source,
              respelling
            )) {
              boundaryPolicy.emphasisFlankingScalarEdits.set(
                `${String(scalarEdit.candidateStart)}:${
                  String(scalarEdit.candidateEnd)
                }`,
                scalarEdit
              )
            }
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
  let reportedOffset = start
  const reportThrough = (end: number): void => {
    if (
      activeMarkdownExecution !== undefined &&
      end - reportedOffset >= PARSE_SOURCE_CHECKPOINT_INTERVAL
    ) {
      activeMarkdownExecution.examineParserWork(end - reportedOffset)
      reportedOffset = end
    }
  }
  while (offset < end) {
    reportThrough(offset)
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
      const enclosingImageEnd =
        construct.kind === 'image' &&
        source.charCodeAt(literal.end) === 93 &&
        source.charCodeAt(literal.end + 1) === 40
          ? findInlineLinkDestinationEnd(source, literal.end + 1, end)
          : undefined
      const nodeEnd = enclosingImageEnd ?? literal.end
      const labelEnd = enclosingImageEnd === undefined
        ? construct.labelEnd
        : literal.end
      const destinationStart = enclosingImageEnd === undefined
        ? literal.start + 1
        : literal.end + 2
      boundaryPolicy?.bracketOffsets.add(construct.labelStart - 1)
      boundaryPolicy?.bracketOffsets.add(labelEnd)
      appendNode(createNode(
        construct.kind,
        construct.start,
        nodeEnd,
        parseInlineNodes(
          source,
          construct.labelStart,
          labelEnd,
          constructs,
          referenceDefinitions,
          boundaryPolicy
        ),
        scanLinkTargetAttributes(source, destinationStart, nodeEnd - 1)
      ))
      offset = nodeEnd
      textStart = offset
      continue
    }
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 91 || codeUnit === 93) {
      boundaryPolicy?.bracketOffsets.add(offset)
    }
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
      activeMarkdownFootnotesEnabled &&
      source.charCodeAt(offset + 1) === 94 &&
      !hasOddBackslashRunBefore(source, offset, start)
    ) {
      const close = source.indexOf(']', offset + 2)
      if (close > offset + 2 && close < end) {
        boundaryPolicy?.bracketOffsets.add(close)
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
    const extendedAutolink =
      activeMarkdownGfmEnabled
        ? findGfmExtendedAutolink(
          source,
          offset,
          end,
          start,
          activeMarkdownExecution
        )
        : undefined
    if (extendedAutolink !== undefined) {
      if (textStart < offset) {
        appendNode(createNode('text', textStart, offset))
      }
      appendNode(createNode(
        'link',
        offset,
        extendedAutolink.end,
        [createNode('text', offset, extendedAutolink.end)],
        {
          destination: extendedAutolink.destination,
          extendedAutolink: true,
          extendedAutolinkType: extendedAutolink.type
        }
      ))
      offset = extendedAutolink.end
      textStart = offset
      continue
    }
    const referenceLink = findReferenceLink(
      source,
      offset,
      end,
      start,
      constructs,
      referenceDefinitions,
      boundaryPolicy
    )
    if (referenceLink !== undefined) {
      if (textStart < offset) {
        appendNode(createNode('text', textStart, offset))
      }
      boundaryPolicy?.bracketOffsets.add(referenceLink.labelStart - 1)
      boundaryPolicy?.bracketOffsets.add(referenceLink.labelEnd)
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
      // CommonMark treats the two invalid comment starts `<!-->` and
      // `<!--->` as complete inline-HTML tags at their first `>`. The later
      // `-->` is ordinary text, not a retroactive comment closer.
      const nodeEnd =
        literal.provider === 'inline-html' && source.startsWith('<!-->', offset)
          ? offset + 5
          : literal.provider === 'inline-html' &&
              source.startsWith('<!--->', offset)
            ? offset + 6
            : literal.end
      let markerLength = 0
      if (literal.provider === 'inline-code') {
        if (boundaryPolicy !== undefined) {
          recordBoundaryBackticksInRange(
            source,
            offset,
            nodeEnd,
            boundaryPolicy
          )
        }
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
        nodeEnd,
        [],
        literal.provider === 'math'
          ? inlineMathAttributes(source, literal)
          : literal.provider === 'inline-code'
            ? inlineCodeAttributes(source, offset, nodeEnd, markerLength)
            : literal.provider === 'inline-html'
              ? (() => {
                const content = source.slice(offset, nodeEnd)
                return Object.freeze({
                  content,
                  contentStart: offset,
                  contentEnd: nodeEnd,
                  ...(gfmTagFilterApplies(content)
                    ? { gfmTagFilter: true }
                    : {})
                })
              })()
              : EMPTY_ATTRIBUTES
      ))
      offset = nodeEnd
      textStart = offset
      continue
    }
    if (codeUnit === 96 && boundaryPolicy !== undefined) {
      offset = recordBoundaryBacktickRun(
        source,
        offset,
        end,
        boundaryPolicy
      )
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
  activeMarkdownExecution?.examineParserWork(end - reportedOffset)
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
  return resolveInlineDelimiterItems(list, delimiters, source, boundaryPolicy)
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
  return resolveInlineDelimiterItems(list, delimiters, source, boundaryPolicy)
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
    (
      closingStart === offset ||
      source.charCodeAt(closingStart - 1) === 32 ||
      source.charCodeAt(closingStart - 1) === 9
    )
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

// Code content is a line-level fact: container prefixes ('> ', list padding)
// and the code indent live BEFORE each line's content offset, which only the
// line records know. Extracting here keeps every consumer (HTML materializer,
// editor view) off raw-slice re-derivation.
function codeBlockAttributes(
  source: string,
  literal: MappedMarkdownLiteral,
  lines: readonly PlainMarkdownLine[],
  fromLineIndex: number
): Readonly<Record<string, string | number | boolean>> {
  const covered: PlainMarkdownLine[] = []
  for (let index = fromLineIndex; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined || line.start >= literal.end) {
      break
    }
    if (line.contentEnd >= literal.start) {
      covered.push(line)
    }
  }
  const lineText = (line: PlainMarkdownLine, stripColumns: number): string => {
    const kept = Math.max(0, line.indentation - stripColumns)
    return ' '.repeat(kept) + source.slice(line.contentOffset, line.contentEnd)
  }
  if (literal.provider === 'indented-code') {
    const content = covered.map((line) => lineText(line, 4)).join('\n')
    const contentStart = covered[0]?.contentOffset ?? literal.start
    const contentEnd = covered.at(-1)?.end ?? contentStart
    return Object.freeze({
      provider: literal.provider,
      content: content === '' ? '' : `${content}\n`,
      contentStart,
      contentEnd
    })
  }
  const opener = covered[0]
  if (opener === undefined) {
    return Object.freeze({
      provider: literal.provider,
      content: '',
      contentStart: literal.start,
      contentEnd: literal.start
    })
  }
  const openerText = source.slice(opener.contentOffset, opener.contentEnd)
  const markerMatch = /^([`~]+)(.*)$/.exec(openerText)
  const info = (markerMatch?.[2] ?? '').trim()
  const marker = markerMatch?.[1]?.charAt(0) ?? '`'
  const fenceIndent = opener.indentation
  const last = covered[covered.length - 1]
  const closerPattern = new RegExp(`^\\${marker}+[\\t ]*$`)
  const hasCloser =
    covered.length > 1 &&
    last !== undefined &&
    last.indentation <= 3 &&
    closerPattern.test(source.slice(last.contentOffset, last.contentEnd))
  const interior = covered.slice(1, hasCloser ? covered.length - 1 : covered.length)
  const content = interior.map((line) => lineText(line, fenceIndent)).join('\n')
  const contentStart = interior[0]?.contentOffset ?? opener.end
  const contentEnd = interior.at(-1)?.end ?? contentStart
  return Object.freeze({
    provider: literal.provider,
    content: interior.length === 0 ? '' : `${content}\n`,
    contentStart,
    contentEnd,
    ...(info === '' ? {} : { info })
  })
}

function inlineMathAttributes(
  source: string,
  literal: MappedMarkdownLiteral
): Readonly<Record<string, string | number>> {
  let delimiterLength = 0
  while (
    literal.start + delimiterLength < literal.end &&
    source.charCodeAt(literal.start + delimiterLength) === 36
  ) {
    delimiterLength += 1
  }
  const contentEnd = Math.max(
    literal.start + delimiterLength,
    literal.end - delimiterLength
  )
  const contentStart = literal.start + delimiterLength
  return Object.freeze({
    content: source.slice(contentStart, contentEnd),
    delimiterLength,
    contentStart,
    contentEnd
  })
}

function inlineCodeAttributes(
  source: string,
  start: number,
  end: number,
  markerLength: number
): Readonly<Record<string, string | number>> {
  const contentStart = Math.min(end, start + markerLength)
  const contentEnd = Math.max(contentStart, end - markerLength)
  let content = source
    .slice(contentStart, contentEnd)
    .replace(/\r\n|\r|\n/g, ' ')
  if (
    content.length >= 2 &&
    content.startsWith(' ') &&
    content.endsWith(' ') &&
    content.trim() !== ''
  ) {
    content = content.slice(1, -1)
  }
  return Object.freeze({
    markerLength,
    content,
    contentStart,
    contentEnd
  })
}

function fencedBlockPayloadAttributes(
  source: string,
  literal: MappedMarkdownLiteral,
  lines: readonly PlainMarkdownLine[],
  fromLineIndex: number
): Readonly<Record<string, string | number | boolean>> {
  return codeBlockAttributes(source, literal, lines, fromLineIndex)
}

function mathBlockAttributes(
  source: string,
  literal: MappedMarkdownLiteral,
  lines: readonly PlainMarkdownLine[],
  fromLineIndex: number
): Readonly<Record<string, string | number>> {
  const opener = lines[fromLineIndex]
  if (
    opener === undefined ||
    source.slice(opener.contentOffset, opener.contentEnd).trim() !== '$$'
  ) {
    const fenced = fencedBlockPayloadAttributes(
      source,
      literal,
      lines,
      fromLineIndex
    )
    return Object.freeze({
      content: typeof fenced['content'] === 'string' ? fenced['content'] : '',
      contentStart: typeof fenced['contentStart'] === 'number'
        ? fenced['contentStart']
        : literal.start,
      contentEnd: typeof fenced['contentEnd'] === 'number'
        ? fenced['contentEnd']
        : literal.start,
      syntax: 'fenced'
    })
  }

  const covered: PlainMarkdownLine[] = []
  for (let index = fromLineIndex; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined || line.start >= literal.end) {
      break
    }
    covered.push(line)
  }
  const last = covered.at(-1)
  const hasCloser =
    last !== undefined &&
    last !== opener &&
    source.slice(last.contentOffset, last.contentEnd).trim() === '$$'
  const interior = covered.slice(1, hasCloser ? -1 : undefined)
  const content = interior.map((line) =>
    source.slice(line.contentOffset, line.contentEnd)
  ).join('\n')
  const contentStart = interior[0]?.contentOffset ?? opener.end
  const contentEnd = interior.at(-1)?.end ?? contentStart
  return Object.freeze({
    content: interior.length === 0 ? '' : `${content}\n`,
    contentStart,
    contentEnd,
    syntax: 'dollar'
  })
}

function diagramAttributes(
  source: string,
  literal: MappedMarkdownLiteral,
  lines: readonly PlainMarkdownLine[],
  fromLineIndex: number
): Readonly<Record<string, string | number>> {
  const fenced = fencedBlockPayloadAttributes(
    source,
    literal,
    lines,
    fromLineIndex
  )
  const info = typeof fenced['info'] === 'string' ? fenced['info'] : ''
  return Object.freeze({
    content: typeof fenced['content'] === 'string' ? fenced['content'] : '',
    contentStart: typeof fenced['contentStart'] === 'number'
      ? fenced['contentStart']
      : literal.start,
    contentEnd: typeof fenced['contentEnd'] === 'number'
      ? fenced['contentEnd']
      : literal.start,
    language: info.split(/[\t ]/, 1)[0]?.toLowerCase() ?? ''
  })
}

interface FootnoteDefinitionParts {
  readonly attributes: Readonly<Record<string, string | number>>
  readonly children: readonly MarkdownNode[]
}

function footnoteDefinitionParts(
  source: string,
  literal: MappedMarkdownLiteral,
  lines: readonly PlainMarkdownLine[],
  fromLineIndex: number,
  referenceDefinitions: MarkdownReferenceDefinitionLookup,
  boundaryPolicy?: InlineBoundaryPolicy
): FootnoteDefinitionParts {
  const firstLine = lines[fromLineIndex]
  if (firstLine === undefined) {
    return Object.freeze({
      attributes: EMPTY_ATTRIBUTES,
      children: Object.freeze([])
    })
  }
  let opener = Math.max(literal.start, firstLine.contentOffset)
  while (
    opener < firstLine.contentEnd &&
    (
      source.charCodeAt(opener) !== 91 ||
      source.charCodeAt(opener + 1) !== 94
    )
  ) {
    opener += 1
  }
  const labelStart = opener + 2
  let labelEnd = labelStart
  while (labelEnd < firstLine.contentEnd) {
    if (
      source.charCodeAt(labelEnd) === 92 &&
      labelEnd + 1 < firstLine.contentEnd
    ) {
      labelEnd += 2
      continue
    }
    if (
      source.charCodeAt(labelEnd) === 93 &&
      source.charCodeAt(labelEnd + 1) === 58
    ) {
      break
    }
    labelEnd += 1
  }
  let bodyStart = Math.min(firstLine.contentEnd, labelEnd + 2)
  while (
    bodyStart < firstLine.contentEnd &&
    (
      source.charCodeAt(bodyStart) === 32 ||
      source.charCodeAt(bodyStart) === 9
    )
  ) {
    bodyStart += 1
  }

  const bodyLines: PlainMarkdownLine[] = []
  if (bodyStart < firstLine.contentEnd) {
    bodyLines.push(Object.freeze({
      ...firstLine,
      start: bodyStart,
      contentOffset: bodyStart,
      indentation: 0,
      blockQuoteDepth: 0,
      listDepth: 0,
      listMarkers: Object.freeze([]),
      containers: Object.freeze([])
    }))
  }
  const contentParts: string[] = []
  if (bodyStart < firstLine.contentEnd) {
    contentParts.push(source.slice(bodyStart, firstLine.contentEnd))
  }
  for (let index = fromLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined || line.start >= literal.end) {
      break
    }
    if (line.blank) {
      contentParts.push('')
      bodyLines.push(Object.freeze({
        ...line,
        start: line.contentOffset,
        indentation: 0,
        blockQuoteDepth: 0,
        listDepth: 0,
        listMarkers: Object.freeze([]),
        containers: Object.freeze([])
      }))
      continue
    }
    contentParts.push(source.slice(line.contentOffset, line.contentEnd))
    bodyLines.push(Object.freeze({
      ...line,
      start: line.contentOffset,
      indentation: 0,
      blockQuoteDepth: 0,
      listDepth: 0,
      listMarkers: Object.freeze([]),
      containers: Object.freeze([])
    }))
  }

  const children: MarkdownNode[] = []
  let paragraphLines: PlainMarkdownLine[] = []
  const appendParagraph = (): void => {
    const first = paragraphLines[0]
    const last = paragraphLines.at(-1)
    if (first === undefined || last === undefined) {
      return
    }
    children.push(createNode(
      'paragraph',
      first.contentOffset,
      last.contentEnd,
      parseInlineLineSequence(
        source,
        paragraphLines,
        EMPTY_INLINE_CONSTRUCTS,
        referenceDefinitions,
        boundaryPolicy
      )
    ))
    paragraphLines = []
  }
  for (const line of bodyLines) {
    if (line.blank) {
      appendParagraph()
    } else {
      paragraphLines.push(line)
    }
  }
  appendParagraph()

  const bodyEnd = bodyLines.at(-1)?.contentEnd ?? bodyStart
  return Object.freeze({
    attributes: Object.freeze({
      label: normalizeMarkdownReferenceLabel(source, labelStart, labelEnd),
      labelStart,
      labelEnd,
      bodyStart,
      bodyEnd,
      content: contentParts.join('\n')
    }),
    children: Object.freeze(children)
  })
}

function htmlBlockAttributes(
  source: string,
  literal: MappedMarkdownLiteral,
  lines: readonly PlainMarkdownLine[],
  fromLineIndex: number
): Readonly<Record<string, string | number | boolean>> {
  const content: string[] = []
  let contentStart = literal.start
  let contentEnd = literal.start
  for (let index = fromLineIndex; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined || line.start >= literal.end) {
      break
    }
    const lineContentStart =
      line.containers.length === 0 ? line.start : line.contentOffset
    if (content.length === 0) {
      contentStart = lineContentStart
    }
    contentEnd = line.end
    content.push(
      line.containers.length === 0
        ? source.slice(line.start, line.contentEnd)
        : ' '.repeat(line.indentation) +
          source.slice(line.contentOffset, line.contentEnd)
    )
  }
  return Object.freeze({
    content: content.length === 0 ? '' : `${content.join('\n')}\n`,
    contentStart,
    contentEnd,
    ...(gfmTagFilterApplies(content.join('\n'))
      ? { gfmTagFilter: true }
      : {})
  })
}

// The parser's own reading of a link target: the destination and optional
// title CONTENT ranges inside an inline-link suffix or after a definition's
// colon. Attached as node attributes so materializers never re-recognize
// link syntax (ADR-0009).
function scanLinkTargetAttributes(
  source: string,
  start: number,
  end: number
): Record<string, number> {
  let offset = start
  while (offset < end && isLinkWhitespace(source.charCodeAt(offset))) {
    offset += 1
  }
  let destinationStart = offset
  let destinationEnd = offset
  if (source.charCodeAt(offset) === 60) {
    destinationStart = offset + 1
    offset += 1
    while (offset < end) {
      const codeUnit = source.charCodeAt(offset)
      if (codeUnit === 92 && offset + 1 < end) {
        offset += 2
        continue
      }
      if (codeUnit === 62) {
        break
      }
      offset += 1
    }
    destinationEnd = offset
    offset += 1
  } else {
    let depth = 0
    while (offset < end) {
      const codeUnit = source.charCodeAt(offset)
      if (codeUnit === 92 && offset + 1 < end) {
        offset += 2
        continue
      }
      if (codeUnit === 40) {
        depth += 1
      } else if (codeUnit === 41) {
        if (depth === 0) {
          break
        }
        depth -= 1
      } else if (codeUnit <= 32 || codeUnit === 127) {
        break
      }
      offset += 1
    }
    destinationEnd = offset
  }
  while (offset < end && isLinkWhitespace(source.charCodeAt(offset))) {
    offset += 1
  }
  const titleOpen = source.charCodeAt(offset)
  if (titleOpen !== 34 && titleOpen !== 39 && titleOpen !== 40) {
    return { destinationStart, destinationEnd }
  }
  const titleClose = titleOpen === 40 ? 41 : titleOpen
  const titleStart = offset + 1
  offset = titleStart
  while (offset < end) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 92 && offset + 1 < end) {
      offset += 2
      continue
    }
    if (codeUnit === titleClose) {
      break
    }
    offset += 1
  }
  return { destinationStart, destinationEnd, titleStart, titleEnd: offset }
}

function isLinkWhitespace(codeUnit: number): boolean {
  return codeUnit === 32 || codeUnit === 9 || codeUnit === 10 || codeUnit === 13
}

function definitionAttributes(
  source: string,
  literal: MappedMarkdownLiteral
): Record<string, string | number> {
  for (let opener = literal.start; opener < literal.end; opener += 1) {
    if (
      source.charCodeAt(opener) !== 91 ||
      hasOddBackslashRunBefore(source, opener, literal.start)
    ) {
      continue
    }
    for (let closer = opener + 1; closer + 1 < literal.end; closer += 1) {
      const codeUnit = source.charCodeAt(closer)
      if (codeUnit === 92 && closer + 1 < literal.end) {
        closer += 1
        continue
      }
      if (codeUnit === 91) {
        break
      }
      if (codeUnit === 93 && source.charCodeAt(closer + 1) === 58) {
        return {
          label: normalizeMarkdownReferenceLabel(source, opener + 1, closer),
          definitionStart: literal.start,
          ...scanLinkTargetAttributes(source, closer + 2, literal.end)
        }
      }
    }
  }
  return {}
}

function blockLiteralNode(
  source: string,
  literal: MappedMarkdownLiteral,
  start: number = literal.start,
  lines?: readonly PlainMarkdownLine[],
  fromLineIndex?: number,
  referenceDefinitions: MarkdownReferenceDefinitionLookup =
  EMPTY_REFERENCE_DEFINITIONS,
  boundaryPolicy?: InlineBoundaryPolicy
): MarkdownNode | undefined {
  if (literal.provider === 'fenced-code' || literal.provider === 'indented-code') {
    return createNode('code-block', start, literal.end, [],
      lines !== undefined && fromLineIndex !== undefined
        ? codeBlockAttributes(source, literal, lines, fromLineIndex)
        : { provider: literal.provider })
  }
  if (literal.provider === 'html-block') {
    return createNode(
      'html-block',
      start,
      literal.end,
      [],
      lines !== undefined && fromLineIndex !== undefined
        ? htmlBlockAttributes(source, literal, lines, fromLineIndex)
        : EMPTY_ATTRIBUTES
    )
  }
  if (literal.provider === 'front-matter') {
    return createNode('front-matter', start, literal.end)
  }
  if (literal.provider === 'definition') {
    const attributes = definitionAttributes(source, literal)
    if (
      literal.blockKind !== 'footnote-definition' &&
      attributes['label'] === ''
    ) {
      return undefined
    }
    if (
      literal.blockKind === 'footnote-definition' &&
      lines !== undefined &&
      fromLineIndex !== undefined
    ) {
      const footnote = footnoteDefinitionParts(
        source,
        literal,
        lines,
        fromLineIndex,
        referenceDefinitions,
        boundaryPolicy
      )
      return createNode(
        'footnote-definition',
        start,
        literal.end,
        footnote.children,
        footnote.attributes
      )
    }
    return createNode('definition', start, literal.end, [], attributes)
  }
  if (literal.provider === 'diagram') {
    return createNode(
      'diagram',
      start,
      literal.end,
      [],
      lines !== undefined && fromLineIndex !== undefined
        ? diagramAttributes(source, literal, lines, fromLineIndex)
        : EMPTY_ATTRIBUTES
    )
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
      return createNode(
        'math-block',
        start,
        literal.end,
        [],
        lines !== undefined && fromLineIndex !== undefined
          ? mathBlockAttributes(source, literal, lines, fromLineIndex)
          : EMPTY_ATTRIBUTES
      )
    }
  }
  return undefined
}

interface MutableContainerNode {
  readonly mutable: true
  readonly kind: 'document' | 'blockquote' | 'list' | 'list-item' | 'paragraph'
  attributes: Readonly<Record<string, string | number | boolean>>
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

function containsBlankLine(
  blankLineStarts: readonly number[],
  start: number,
  end: number
): boolean {
  let low = 0
  let high = blankLineStarts.length
  while (low < high) {
    const middle = low + ((high - low) >> 1)
    if ((blankLineStarts[middle] ?? end) < start) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  const candidate = blankLineStarts[low]
  return candidate !== undefined && candidate < end
}

function blankLineStartsOf(lines: readonly PlainMarkdownLine[]): readonly number[] {
  const starts: number[] = []
  for (const line of lines) {
    if (!line.blank) {
      continue
    }
    const deepest = line.containers.at(-1)
    if (deepest?.kind === 'blockquote') {
      continue
    }
    if (deepest?.kind === 'list-item' && !deepest.continued) {
      continue
    }
    starts.push(line.start)
  }
  return starts
}

interface TaskListItemMarker {
  readonly checked: boolean
  readonly start: number
  readonly end: number
}

/**
 * GFM task-list recognition belongs to the block grammar: only the first
 * paragraph in a list item may contribute the marker. Returning the exact
 * marker range lets downstream consumers render the parser fact without
 * searching paragraph text again.
 */
function taskListItemMarker(
  source: string,
  line: PlainMarkdownLine
): TaskListItemMarker | undefined {
  let start = line.contentOffset
  let optionalSpaces = 0
  while (
    start < line.contentEnd &&
    source.charCodeAt(start) === 32 &&
    optionalSpaces < 3
  ) {
    start += 1
    optionalSpaces += 1
  }
  const state = source.charCodeAt(start + 1)
  const close = start + 2
  const following = source.charCodeAt(close + 1)
  if (
    source.charCodeAt(start) !== 91 ||
    source.charCodeAt(close) !== 93 ||
    (state !== 32 && state !== 9 && state !== 120 && state !== 88) ||
    (following !== 32 && following !== 9)
  ) {
    return undefined
  }
  return Object.freeze({
    checked: state === 120 || state === 88,
    start,
    end: close + 1
  })
}

/**
 * MarkText's table-of-contents marker is a top-level block production. It is
 * deliberately decided here, alongside the paragraph production it replaces;
 * consumers receive the fact and never inspect paragraph text for syntax.
 */
function tableOfContentsParagraphAttributes(
  source: string,
  start: number,
  end: number
): Readonly<Record<string, string | number | boolean>> {
  let markerStart = start
  let markerEnd = end
  while (
    markerStart < markerEnd &&
    (
      source.charCodeAt(markerStart) === 32 ||
      source.charCodeAt(markerStart) === 9
    )
  ) {
    markerStart += 1
  }
  while (
    markerStart < markerEnd &&
    (
      source.charCodeAt(markerEnd - 1) === 32 ||
      source.charCodeAt(markerEnd - 1) === 9
    )
  ) {
    markerEnd -= 1
  }
  if (
    markerEnd - markerStart !== 5 ||
    source.charCodeAt(markerStart) !== 91 ||
    source.charCodeAt(markerStart + 1) !== 84 ||
    source.charCodeAt(markerStart + 2) !== 79 ||
    source.charCodeAt(markerStart + 3) !== 67 ||
    source.charCodeAt(markerStart + 4) !== 93 ||
    source.slice(start, end).includes('\n') ||
    source.slice(start, end).includes('\r')
  ) {
    return EMPTY_ATTRIBUTES
  }
  return TABLE_OF_CONTENTS_ATTRIBUTES
}

function finalizeMutableContainer(
  node: MutableContainerNode,
  source: string,
  blankLineStarts: readonly number[]
): MarkdownNode {
  const children = node.children.map((child) =>
    isMutableContainerNode(child)
      ? finalizeMutableContainer(child, source, blankLineStarts)
      : child
  )
  let attributes = node.attributes
  if (node.kind === 'list') {
    // A list is loose when a blank line separates two items, or separates two
    // blocks inside one item. Trailing blanks after the last item are the
    // following block's separation, not the list's.
    let loose = false
    for (let index = 0; index < children.length && !loose; index += 1) {
      const item = children[index]
      const next = children[index + 1]
      if (item !== undefined && next !== undefined) {
        loose = containsBlankLine(blankLineStarts, item.range.end, next.range.start)
      }
      if (!loose && item !== undefined) {
        for (let inner = 0; inner + 1 < item.childCount && !loose; inner += 1) {
          loose = containsBlankLine(
            blankLineStarts,
            item.childAt(inner).range.end,
            item.childAt(inner + 1).range.start
          )
        }
      }
    }
    const taskList = children.some((child) =>
      child.kind === 'list-item' && child.attributes['task'] === true
    )
    attributes = Object.freeze({
      ...attributes,
      tight: !loose,
      ...(taskList ? { taskList: true } : {})
    })
  }
  return createNode(node.kind, node.start, node.end, children, attributes)
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
  const blankLineStarts = blankLineStartsOf(lines)
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
      // Blank lines end the run only when no container line resumes after
      // them: '* a / * / (blank) / * c' is one list with a dead middle item.
      if (!line.blank) {
        break
      }
      let probe = nextLineIndex
      while (lines[probe]?.blank === true) {
        probe += 1
      }
      if ((lines[probe]?.containers.length ?? 0) === 0) {
        break
      }
      closeParagraph()
      nextLineIndex = probe
      continue
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

    if (reusedDepth < line.containers.length && paragraph !== undefined) {
      // Opening a nested container ends the paragraph in its parent item. The
      // first child line must therefore be eligible for block-owned facts such
      // as an unchecked task marker, just like later sibling items.
      closeParagraph()
    }

    const taskMarker =
      activeMarkdownGfmEnabled &&
      parent.kind === 'list-item' &&
      parent.children.length === 0 &&
      paragraph === undefined
        ? taskListItemMarker(source, line)
        : undefined
    if (taskMarker !== undefined) {
      parent.attributes = Object.freeze({
        ...parent.attributes,
        task: true,
        checked: taskMarker.checked,
        taskMarkerStart: taskMarker.start,
        taskMarkerEnd: taskMarker.end
      })
    }
    const contentLine =
      taskMarker === undefined
        ? line
        : Object.freeze({
          ...line,
          contentOffset: taskMarker.end
        })

    if (line.start < literalEnd) {
      extendOpenContainers(Math.min(literalEnd, line.contentEnd))
      closeParagraph()
      nextLineIndex += 1
      continue
    }
    const literal = literals.find(
      (candidate) =>
        candidate.start <= contentLine.contentOffset &&
        contentLine.contentOffset < candidate.end
    )
    const literalNode =
      literal !== undefined && literal.start >= line.start
        ? blockLiteralNode(
          source,
          literal,
          contentLine.contentOffset,
          lines,
          nextLineIndex,
          referenceDefinitions,
          boundaryPolicy
        )
        : undefined
    if (literal !== undefined && literalNode !== undefined) {
      parent.children.push(literalNode)
      literalEnd = literal.end
      extendOpenContainers(literal.end)
      closeParagraph()
      nextLineIndex += 1
      continue
    }

    if (
      paragraph !== undefined &&
      paragraphOwner === parent &&
      paragraphLines.length > 0 &&
      !line.lazy &&
      line.containers.every((descriptor) => descriptor.continued)
    ) {
      const underlineLevel = setextUnderlineLevel(source, contentLine)
      if (underlineLevel !== undefined) {
        const heading = createNode(
          'heading',
          paragraph.start,
          line.contentEnd,
          parseInlineLineSequence(
            source,
            paragraphLines,
            constructs,
            referenceDefinitions,
            boundaryPolicy
          ),
          { level: underlineLevel, style: 'setext' }
        )
        parent.children[parent.children.indexOf(paragraph)] = heading
        paragraphOwner = undefined
        paragraph = undefined
        paragraphLines = []
        extendOpenContainers(line.contentEnd)
        nextLineIndex += 1
        continue
      }
    }

    const heading = parseAtxHeading(
      source,
      contentLine.contentOffset,
      contentLine.contentEnd,
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

    if (
      isThematicBreakRun(
        source,
        contentLine.contentOffset,
        contentLine.contentEnd
      )
    ) {
      parent.children.push(
        createNode(
          'thematic-break',
          contentLine.contentOffset,
          contentLine.contentEnd
        )
      )
      extendOpenContainers(line.contentEnd)
      closeParagraph()
      nextLineIndex += 1
      continue
    }

    if (paragraphOwner !== parent || paragraph === undefined) {
      closeParagraph()
      paragraph = mutableContainerNode(
        'paragraph',
        contentLine.contentOffset,
        contentLine.contentEnd
      )
      parent.children.push(paragraph)
      paragraphOwner = parent
    }
    paragraphLines.push(contentLine)
    paragraph.end = contentLine.contentEnd
    extendOpenContainers(contentLine.contentEnd)
    nextLineIndex += 1
  }

  closeParagraph()

  return Object.freeze({
    nodes: Object.freeze(root.children.map((child) =>
      isMutableContainerNode(child)
        ? finalizeMutableContainer(child, source, blankLineStarts)
        : child
    )),
    nextLineIndex
  })
}

function setextHeadingLevel(
  source: string,
  line: PlainMarkdownLine
): 1 | 2 | undefined {
  if (line.blockQuoteDepth > 0 || line.listDepth > 0) {
    return undefined
  }
  return setextUnderlineLevel(source, line)
}

function setextUnderlineLevel(
  source: string,
  line: PlainMarkdownLine
): 1 | 2 | undefined {
  if (line.indentation > 3) {
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

function isThematicBreakRun(source: string, start: number, end: number): boolean {
  let marker: number | undefined
  let count = 0
  for (let offset = start; offset < end; offset += 1) {
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

function isThematicBreak(source: string, line: PlainMarkdownLine): boolean {
  if (line.indentation > 3 || line.blockQuoteDepth > 0 || line.listDepth > 0) {
    return false
  }
  return isThematicBreakRun(source, line.contentOffset, line.contentEnd)
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
    if (!/^:?-+:?$/.test(value)) {
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
    const cells = splitTableCells(source, line) ?? (() => {
      let start = line.contentOffset
      let end = line.contentEnd
      while (
        start < end &&
        (source.charCodeAt(start) === 32 || source.charCodeAt(start) === 9)
      ) {
        start += 1
      }
      while (
        end > start &&
        (source.charCodeAt(end - 1) === 32 ||
          source.charCodeAt(end - 1) === 9)
      ) {
        end -= 1
      }
      return Object.freeze([Object.freeze({ start, end })])
    })()
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
      {
        columns: alignments.length,
        delimiterStart: delimiterLine.start,
        delimiterEnd: delimiterLine.contentEnd
      }
    ),
    nextLineIndex
  })
}

function parseBlocksRegion(
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
    if (line.blank && !line.containers.some((container) => !container.continued)) {
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
    const table =
      activeMarkdownGfmEnabled
        ? parseTable(
          source,
          lines,
          lineIndex,
          constructs,
          referenceDefinitions,
          boundaryPolicy
        )
        : undefined
    if (table !== undefined) {
      blocks.push(table.node)
      lineIndex = table.nextLineIndex
      continue
    }
    while ((literals[literalIndex]?.end ?? Number.POSITIVE_INFINITY) <= line.start) {
      literalIndex += 1
    }
    const literal = literals[literalIndex]
    const literalNode =
      literal !== undefined &&
      literal.start >= line.start &&
      literal.start <= line.contentOffset
        ? blockLiteralNode(
          source,
          literal,
          literal.start,
          lines,
          lineIndex,
          referenceDefinitions,
          boundaryPolicy
        )
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
    if (isThematicBreak(source, line)) {
      blocks.push(createNode('thematic-break', line.start, line.contentEnd))
      lineIndex += 1
      continue
    }
    const paragraphStart = line.start
    let paragraphEnd = line.contentEnd
    let nextLineIndex = lineIndex + 1
    let setextLevel: 1 | 2 | undefined
    while (nextLineIndex < lines.length) {
      const nextLine = lines[nextLineIndex]
      if (nextLine === undefined) {
        break
      }
      // A setext underline binds tighter than every paragraph interrupter
      // that shares its shape ('---' is also a thematic break).
      setextLevel = setextHeadingLevel(source, nextLine)
      if (setextLevel !== undefined) {
        nextLineIndex += 1
        break
      }
      if (
        (nextLine.blank && nextLine.listMarkers.length === 0) ||
        nextLine.blockQuoteDepth > 0 ||
        parseAtxHeading(
          source,
          nextLine.start,
          nextLine.contentEnd,
          constructs,
          referenceDefinitions,
          boundaryPolicy
        ) !== undefined ||
        (nextLine.listMarkers.length > 0 && !nextLine.blank) ||
        isThematicBreak(source, nextLine) ||
        literals.some((candidate) =>
          (candidate.provider === 'fenced-code' ||
            candidate.provider === 'html-block' ||
            candidate.provider === 'diagram') &&
          candidate.start >= nextLine.start &&
          candidate.start <= nextLine.contentOffset &&
          candidate.start < nextLine.contentEnd)
      ) {
        break
      }
      paragraphEnd = nextLine.contentEnd
      nextLineIndex += 1
    }
    if (setextLevel !== undefined) {
      blocks.push(createNode(
        'heading',
        paragraphStart,
        (lines[nextLineIndex - 1] ?? line).contentEnd,
        parseInlineNodes(
          source,
          line.contentOffset,
          paragraphEnd,
          constructs,
          referenceDefinitions,
          boundaryPolicy
        ),
        { level: setextLevel, style: 'setext' }
      ))
      lineIndex = nextLineIndex
      continue
    }
    const children = parseInlineNodes(
      source,
      paragraphStart,
      paragraphEnd,
      constructs,
      referenceDefinitions,
      boundaryPolicy
    )
    blocks.push(createNode(
      'paragraph',
      paragraphStart,
      paragraphEnd,
      children,
      tableOfContentsParagraphAttributes(
        source,
        paragraphStart,
        paragraphEnd
      )
    ))
    lineIndex = nextLineIndex
  }
  return Object.freeze(blocks)
}

interface MarkdownAstNodeTemplate {
  readonly kind: MarkdownNodeKind
  readonly start: number
  readonly end: number
  readonly attributes: Readonly<Record<string, string | number | boolean>>
  readonly children: readonly MarkdownAstNodeTemplate[]
}

interface MarkdownAstRegionTemplate {
  readonly source: string
  readonly linesKey: string
  readonly literalsKey: string
  readonly nodes: readonly MarkdownAstNodeTemplate[]
}

let markdownAstCacheTemplateConstructions = 0

export function __markdownAstCacheTemplateConstructionsV1(): number {
  return markdownAstCacheTemplateConstructions
}

export function __resetMarkdownAstCacheTemplateConstructionsV1(): void {
  markdownAstCacheTemplateConstructions = 0
}

const astRegionCaches =
  new WeakMap<
    MarkdownAstRegionCacheIdentity,
    Map<string, MarkdownAstRegionTemplate>
  >()
const MAX_RETAINED_FRAGMENT_ENTRIES = 32_768
export const PROFILE1_MARKDOWN_REUSE_MAX_RETAINED_BYTES_V1 = 4 * 1_024 * 1_024
const RETAINED_STRING_HEADER_BYTES = 16
const RETAINED_OBJECT_HEADER_BYTES = 24
const RETAINED_REFERENCE_BYTES = 8
const RETAINED_SCALAR_BYTES = 8
// One retained key/value also owns a Map node, a FIFO queue record, and its
// array slot. This deliberately rounds their combined fixed cost upward.
const RETAINED_CACHE_ENTRY_BYTES = 96
// Minimum charged by retainedValueBytes for one template: its object/slots and
// field labels, the shortest node-kind string, two scalars, and the newly
// allocated attributes object and children array. Child slots only add cost.
const RETAINED_AST_TEMPLATE_NODE_MINIMUM_BYTES =
  RETAINED_OBJECT_HEADER_BYTES + 5 * RETAINED_REFERENCE_BYTES +
  ['kind', 'start', 'end', 'attributes', 'children'].reduce(
    (bytes, field) => bytes + retainedStringBytes(field),
    0
  ) +
  retainedStringBytes('text') + 2 * RETAINED_SCALAR_BYTES +
  2 * RETAINED_OBJECT_HEADER_BYTES

interface RetainedFragmentEntry {
  readonly cache: Readonly<{
    delete: (key: string) => boolean
  }>
  readonly key: string
  readonly keyBytes: number
  readonly valueBytes: number
}

interface RetainedFragmentBudget {
  entries: number
  keyBytes: number
  valueBytes: number
  queue: Array<RetainedFragmentEntry | undefined>
  queueCursor: number
}

const retainedFragmentBudgets = new WeakMap<object, RetainedFragmentBudget>()

export interface Profile1MarkdownReuseRetentionV1 {
  readonly entries: number
  readonly keyBytes: number
  readonly valueBytes: number
  readonly overheadBytes: number
  readonly retainedBytes: number
  readonly maximumRetainedBytes: number
}

function retainedStringBytes(value: string): number {
  return RETAINED_STRING_HEADER_BYTES + value.length * 2
}

function fragmentSourceCanFit(source: string): boolean {
  return retainedStringBytes(source) + RETAINED_CACHE_ENTRY_BYTES <=
    PROFILE1_MARKDOWN_REUSE_MAX_RETAINED_BYTES_V1
}

function retainedValueBytes(value: unknown, seen: Set<object>): number {
  if (typeof value === 'string') {
    return retainedStringBytes(value)
  }
  if (value === null || typeof value !== 'object') {
    return RETAINED_SCALAR_BYTES
  }
  if (seen.has(value)) {
    return 0
  }
  seen.add(value)
  if (Array.isArray(value)) {
    return RETAINED_OBJECT_HEADER_BYTES +
      value.length * RETAINED_REFERENCE_BYTES +
      value.reduce(
        (total, entry) => total + retainedValueBytes(entry, seen),
        0
      )
  }
  if (value instanceof Map) {
    let bytes = RETAINED_OBJECT_HEADER_BYTES +
      value.size * 2 * RETAINED_REFERENCE_BYTES
    for (const [key, entry] of value) {
      bytes += retainedValueBytes(key, seen) + retainedValueBytes(entry, seen)
    }
    return bytes
  }
  if (value instanceof Set) {
    let bytes = RETAINED_OBJECT_HEADER_BYTES +
      value.size * RETAINED_REFERENCE_BYTES
    for (const entry of value) {
      bytes += retainedValueBytes(entry, seen)
    }
    return bytes
  }
  const entries = Object.entries(value)
  return RETAINED_OBJECT_HEADER_BYTES +
    entries.length * RETAINED_REFERENCE_BYTES +
    entries.reduce(
      (total, [key, entry]) => total +
        retainedStringBytes(key) + retainedValueBytes(entry, seen),
      0
    )
}

function fragmentMapRetention(cache: ReadonlyMap<string, unknown>): Readonly<{
  readonly entries: number
  readonly keyBytes: number
  readonly valueBytes: number
}> {
  let keyBytes = 0
  let valueBytes = 0
  for (const [key, value] of cache) {
    keyBytes += retainedStringBytes(key)
    valueBytes += retainedValueBytes(value, new Set())
  }
  return Object.freeze({ entries: cache.size, keyBytes, valueBytes })
}

function createRetainedFragmentBudget(): RetainedFragmentBudget {
  return {
    entries: 0,
    keyBytes: 0,
    valueBytes: 0,
    queue: [],
    queueCursor: 0
  }
}

function registerRetainedFragmentCache(
  cache: object,
  budget: RetainedFragmentBudget
): void {
  retainedFragmentBudgets.set(cache, budget)
}

function retainedFragmentBudget(cache: object): RetainedFragmentBudget {
  const budget = retainedFragmentBudgets.get(cache)
  if (budget === undefined) {
    throw new Error('Markdown reuse cache is detached from its retention budget')
  }
  return budget
}

function evictOldestFragmentEntry(budget: RetainedFragmentBudget): void {
  const entry = budget.queue[budget.queueCursor]
  budget.queue[budget.queueCursor] = undefined
  budget.queueCursor += 1
  if (entry !== undefined && entry.cache.delete(entry.key)) {
    budget.entries -= 1
    budget.keyBytes -= entry.keyBytes
    budget.valueBytes -= entry.valueBytes
  }
  if (
    budget.queueCursor >= 256 &&
    budget.queueCursor * 2 >= budget.queue.length
  ) {
    budget.queue = budget.queue.slice(budget.queueCursor)
    budget.queueCursor = 0
  }
}

function retainFragmentEntry<Value>(
  cache: Map<string, Value>,
  key: string,
  value: Value
): void {
  if (cache.has(key)) {
    return
  }
  const budget = retainedFragmentBudget(cache)
  const keyBytes = retainedStringBytes(key)
  const valueBytes = retainedValueBytes(value, new Set())
  const retainedBytes = keyBytes + valueBytes + RETAINED_CACHE_ENTRY_BYTES
  if (retainedBytes > PROFILE1_MARKDOWN_REUSE_MAX_RETAINED_BYTES_V1) {
    return
  }
  while (
    budget.entries >= MAX_RETAINED_FRAGMENT_ENTRIES ||
    budget.keyBytes + budget.valueBytes +
      budget.entries * RETAINED_CACHE_ENTRY_BYTES + retainedBytes >
      PROFILE1_MARKDOWN_REUSE_MAX_RETAINED_BYTES_V1
  ) {
    evictOldestFragmentEntry(budget)
  }
  cache.set(key, value)
  budget.entries += 1
  budget.keyBytes += keyBytes
  budget.valueBytes += valueBytes
  budget.queue.push({ cache, key, keyBytes, valueBytes })
}

const POSITIONAL_MARKDOWN_ATTRIBUTES = new Set([
  'destinationStart',
  'destinationEnd',
  'definitionStart',
  'titleStart',
  'titleEnd',
  'taskMarkerStart',
  'taskMarkerEnd',
  'labelStart',
  'labelEnd',
  'bodyStart',
  'bodyEnd',
  'contentStart',
  'contentEnd',
  'delimiterStart',
  'delimiterEnd'
])

function markdownAstNodeTemplate(
  node: MarkdownNode,
  regionStart: number,
  cacheRetention: boolean = false
): MarkdownAstNodeTemplate {
  if (cacheRetention) {
    markdownAstCacheTemplateConstructions += 1
  }
  return Object.freeze({
    kind: node.kind,
    start: node.range.start - regionStart,
    end: node.range.end - regionStart,
    attributes: Object.freeze(Object.fromEntries(
      Object.entries(node.attributes).map(([key, value]) => [
        key,
        POSITIONAL_MARKDOWN_ATTRIBUTES.has(key) && typeof value === 'number'
          ? value - regionStart
          : value
      ])
    )),
    children: Object.freeze(Array.from(
      { length: node.childCount },
      (_, ordinal) => markdownAstNodeTemplate(
        node.childAt(ordinal),
        regionStart,
        cacheRetention
      )
    ))
  })
}

function markdownAstNodeFromTemplate(
  template: MarkdownAstNodeTemplate,
  regionStart: number
): MarkdownNode {
  const attributes = Object.freeze(Object.fromEntries(
    Object.entries(template.attributes).map(([key, value]) => [
      key,
      POSITIONAL_MARKDOWN_ATTRIBUTES.has(key) && typeof value === 'number'
        ? value + regionStart
        : value
    ])
  ))
  return createNode(
    template.kind,
    regionStart + template.start,
    regionStart + template.end,
    template.children.map((child) =>
      markdownAstNodeFromTemplate(child, regionStart)),
    attributes
  )
}

function markdownAstNodeAtOffset(
  node: MarkdownNode,
  offset: number
): MarkdownNode {
  const attributes = Object.freeze(Object.fromEntries(
    Object.entries(node.attributes).map(([key, value]) => [
      key,
      POSITIONAL_MARKDOWN_ATTRIBUTES.has(key) && typeof value === 'number'
        ? value + offset
        : value
    ])
  ))
  return createNode(
    node.kind,
    node.range.start + offset,
    node.range.end + offset,
    Array.from(
      { length: node.childCount },
      (_, ordinal) => markdownAstNodeAtOffset(node.childAt(ordinal), offset)
    ),
    attributes
  )
}

function astRegionTemplateBaseBytes(
  key: string,
  source: string,
  linesKey: string,
  literalsKey: string
): number {
  const emptyTemplate = {
    source,
    linesKey,
    literalsKey,
    nodes: Object.freeze([])
  }
  return retainedStringBytes(key) +
    retainedValueBytes(emptyTemplate, new Set()) +
    RETAINED_CACHE_ENTRY_BYTES
}

function astRegionTemplateCanFit(
  key: string,
  source: string,
  linesKey: string,
  literalsKey: string
): boolean {
  return astRegionTemplateBaseBytes(key, source, linesKey, literalsKey) <=
    PROFILE1_MARKDOWN_REUSE_MAX_RETAINED_BYTES_V1
}

function astRegionTemplateNodesCanFit(
  key: string,
  source: string,
  linesKey: string,
  literalsKey: string,
  nodes: readonly MarkdownNode[]
): boolean {
  let minimumBytes = astRegionTemplateBaseBytes(
    key,
    source,
    linesKey,
    literalsKey
  ) + nodes.length * RETAINED_AST_TEMPLATE_NODE_MINIMUM_BYTES
  if (minimumBytes > PROFILE1_MARKDOWN_REUSE_MAX_RETAINED_BYTES_V1) {
    return false
  }
  const pending = [...nodes]
  while (pending.length !== 0) {
    const node = pending.pop()
    if (node === undefined) {
      continue
    }
    minimumBytes +=
      node.childCount * RETAINED_AST_TEMPLATE_NODE_MINIMUM_BYTES
    if (minimumBytes > PROFILE1_MARKDOWN_REUSE_MAX_RETAINED_BYTES_V1) {
      return false
    }
    for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
      pending.push(node.childAt(ordinal))
    }
  }
  return true
}

function markdownAstRegionLinesKey(
  lines: readonly PlainMarkdownLine[],
  start: number
): string {
  return JSON.stringify(lines.map((line) => [
    line.start - start,
    line.contentEnd - start,
    line.end - start,
    line.blank,
    line.lazy,
    line.contentOffset - start,
    line.indentation,
    line.blockQuoteDepth,
    line.listDepth,
    line.listMarkers.map((marker) => [
      marker.start - start,
      marker.end - start,
      marker.ordered,
      marker.startNumber,
      marker.contentOffset - start
    ]),
    line.containers.map((container) => container.kind === 'blockquote'
      ? [
        container.kind,
        container.continued,
        container.start - start,
        container.end - start
      ]
      : [
        container.kind,
        container.continued,
        container.start - start,
        container.end - start,
        container.ordered,
        container.startNumber,
        container.delimiterCodeUnit,
        container.contentOffset - start
      ])
  ]))
}

function markdownAstRegionLiteralsKey(
  literals: readonly MappedMarkdownLiteral[],
  start: number
): string {
  return JSON.stringify(literals.map((literal) => [
    literal.provider,
    literal.start - start,
    literal.end - start,
    literal.blockKind,
    literal.construct === undefined
      ? undefined
      : {
        ...literal.construct,
        start: literal.construct.start - start,
        labelStart: literal.construct.labelStart - start,
        labelEnd: literal.construct.labelEnd - start
      }
  ]))
}

function markdownRegionLine(
  line: PlainMarkdownLine,
  regionStart: number
): PlainMarkdownLine {
  return Object.freeze({
    ...line,
    start: line.start - regionStart,
    contentEnd: line.contentEnd - regionStart,
    end: line.end - regionStart,
    contentOffset: line.contentOffset - regionStart,
    listMarkers: Object.freeze(line.listMarkers.map((marker) =>
      Object.freeze({
        ...marker,
        start: marker.start - regionStart,
        end: marker.end - regionStart,
        contentOffset: marker.contentOffset - regionStart
      }))),
    containers: Object.freeze(line.containers.map((container) =>
      container.kind === 'blockquote'
        ? Object.freeze({
          ...container,
          start: container.start - regionStart,
          end: container.end - regionStart
        })
        : Object.freeze({
          ...container,
          start: container.start - regionStart,
          end: container.end - regionStart,
          contentOffset: container.contentOffset - regionStart
        })))
  })
}

function markdownRegionLiteral(
  literal: MappedMarkdownLiteral,
  regionStart: number
): MappedMarkdownLiteral {
  return Object.freeze({
    ...literal,
    start: literal.start - regionStart,
    end: literal.end - regionStart,
    ...(literal.construct === undefined
      ? {}
      : {
        construct: Object.freeze({
          ...literal.construct,
          start: literal.construct.start - regionStart,
          labelStart: literal.construct.labelStart - regionStart,
          labelEnd: literal.construct.labelEnd - regionStart
        })
      })
  })
}

function markdownRegionReferenceDefinitions(
  definitions: MarkdownReferenceDefinitionLookup,
  regionStart: number
): MarkdownReferenceDefinitionLookup {
  return Object.freeze({
    ...(definitions.cacheKey === undefined
      ? {}
      : { cacheKey: definitions.cacheKey }),
    has: Object.freeze((normalizedLabel: string, offset: number): boolean =>
      definitions.has(normalizedLabel, offset + regionStart)),
    ...(definitions.hasAny === undefined
      ? {}
      : {
        hasAny: Object.freeze((normalizedLabel: string): boolean =>
          definitions.hasAny?.(normalizedLabel) === true)
      }),
    ...(definitions.definitionStart === undefined
      ? {}
      : {
        definitionStart: Object.freeze((
          normalizedLabel: string,
          offset: number
        ): number | undefined => {
          const start = definitions.definitionStart?.(
            normalizedLabel,
            offset + regionStart
          )
          return start === undefined ? undefined : start - regionStart
        })
      })
  })
}

function markdownRegionBoundaryPolicy(
  boundaryPolicy: InlineBoundaryPolicy | undefined,
  regionStart: number,
  regionEnd: number
): InlineBoundaryPolicy | undefined {
  if (boundaryPolicy === undefined) {
    return undefined
  }
  return createInlineBoundaryPolicy(
    Object.freeze(boundaryPolicy.scopeRuns
      .filter((scope) =>
        scope.start < regionEnd && regionStart < scope.end)
      .map((scope) =>
        Object.freeze({
          ...scope,
          start: Math.max(scope.start, regionStart) - regionStart,
          end: Math.min(scope.end, regionEnd) - regionStart
        }))),
    Object.freeze(boundaryPolicy.canonicalIdentityRuns.flatMap(
      (run): readonly MappedMarkdownCanonicalIdentityRun[] => {
        const overlapStart = Math.max(run.candidateStart, regionStart)
        const overlapEnd = Math.min(run.candidateEnd, regionEnd)
        return overlapStart >= overlapEnd
          ? Object.freeze([])
          : Object.freeze([Object.freeze({
            candidateStart: overlapStart - regionStart,
            candidateEnd: overlapEnd - regionStart,
            sourceRunId: run.sourceRunId,
            sourceStart:
              run.sourceStart + overlapStart - run.candidateStart
          })])
      }
    ))
  )
}

function emitMarkdownAstRegion(
  source: string,
  lines: readonly PlainMarkdownLine[],
  literals: readonly MappedMarkdownLiteral[],
  referenceDefinitions: MarkdownReferenceDefinitionLookup,
  boundaryPolicy: InlineBoundaryPolicy | undefined,
  regionStart: number
): readonly MarkdownNode[] {
  const identity = activeMarkdownSyntaxIdentity
  if (identity === undefined) {
    throw new Error('Markdown AST region was emitted outside an identity scope')
  }
  activeMarkdownSyntaxIdentity = {
    registry: identity.registry,
    sourceAt: Object.freeze((start: number, end: number): SyntaxSourceIdentity =>
      identity.sourceAt(start + regionStart, end + regionStart)),
    ...(identity.definitionStart === undefined
      ? {}
      : {
        definitionStart: Object.freeze((
          normalizedLabel: string,
          referenceStart: number
        ): number | undefined => {
          const definitionStart = identity.definitionStart?.(
            normalizedLabel,
            referenceStart + regionStart
          )
          return definitionStart === undefined
            ? undefined
            : definitionStart - regionStart
        })
      })
  }
  try {
    const regionalBoundaryPolicy = markdownRegionBoundaryPolicy(
      boundaryPolicy,
      regionStart,
      regionStart + source.length
    )
    const nodes = parseBlocksRegion(
      source,
      literals.map((literal) => markdownRegionLiteral(literal, regionStart)),
      lines.map((line) => markdownRegionLine(line, regionStart)),
      markdownRegionReferenceDefinitions(referenceDefinitions, regionStart),
      regionalBoundaryPolicy
    )
    if (boundaryPolicy !== undefined && regionalBoundaryPolicy !== undefined) {
      for (const offset of regionalBoundaryPolicy.unsafeDelimiterOffsets) {
        boundaryPolicy.unsafeDelimiterOffsets.add(offset + regionStart)
      }
      for (const respelling of
        regionalBoundaryPolicy.enclosingEmphasisRespellings.values()) {
        const rebased = Object.freeze({
          ...respelling,
          openerStart: respelling.openerStart + regionStart,
          openerEnd: respelling.openerEnd + regionStart,
          closerStart: respelling.closerStart + regionStart,
          closerEnd: respelling.closerEnd + regionStart
        })
        boundaryPolicy.enclosingEmphasisRespellings.set(
          `${String(rebased.openerStart)}:${String(rebased.closerStart)}`,
          rebased
        )
      }
      for (const scalarEdit of
        regionalBoundaryPolicy.emphasisFlankingScalarEdits.values()) {
        const rebased = Object.freeze({
          ...scalarEdit,
          candidateStart: scalarEdit.candidateStart + regionStart,
          candidateEnd: scalarEdit.candidateEnd + regionStart
        })
        boundaryPolicy.emphasisFlankingScalarEdits.set(
          `${String(rebased.candidateStart)}:${String(rebased.candidateEnd)}`,
          rebased
        )
      }
      for (const atom of
        regionalBoundaryPolicy.canonicalBacktickAtoms.values()) {
        const rebased = Object.freeze({
          ...atom,
          start: atom.start + regionStart,
          end: atom.end + regionStart
        })
        boundaryPolicy.canonicalBacktickAtoms.set(
          `${String(rebased.start)}:${String(rebased.end)}`,
          rebased
        )
      }
      for (const run of
        regionalBoundaryPolicy.projectedBacktickRuns.values()) {
        const rebased = Object.freeze({
          ...run,
          start: run.start + regionStart,
          end: run.end + regionStart
        })
        boundaryPolicy.projectedBacktickRuns.set(
          `${String(rebased.start)}:${String(rebased.end)}`,
          rebased
        )
      }
      for (const offset of regionalBoundaryPolicy.bracketOffsets) {
        boundaryPolicy.bracketOffsets.add(offset + regionStart)
      }
    }
    return nodes
  } finally {
    activeMarkdownSyntaxIdentity = identity
  }
}

interface MarkdownAstRegion {
  readonly start: number
  readonly end: number
  readonly lines: readonly PlainMarkdownLine[]
  readonly literals: readonly MappedMarkdownLiteral[]
}

/**
 * Split already-emitted line facts at grammar-independent reconvergence
 * boundaries. This does not recognize Markdown: it only partitions the fork
 * graph's immutable line/literal facts so each local alternative can be
 * emitted once and shared by every selection that reaches it.
 */
function markdownAstRegions(
  lines: readonly PlainMarkdownLine[],
  literals: readonly MappedMarkdownLiteral[]
): readonly MarkdownAstRegion[] {
  const firstLiteralEndingAfter = (offset: number): number => {
    let low = 0
    let high = literals.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (
        (literals[middle]?.end ?? Number.POSITIVE_INFINITY) <= offset
      ) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return low
  }
  const overlappingLiterals = (
    start: number,
    end: number
  ): readonly MappedMarkdownLiteral[] => {
    const overlapping: MappedMarkdownLiteral[] = []
    for (
      let index = firstLiteralEndingAfter(start);
      index < literals.length;
      index += 1
    ) {
      const literal = literals[index]
      if (literal === undefined || literal.start >= end) {
        break
      }
      overlapping.push(literal)
    }
    return Object.freeze(overlapping)
  }
  const regions: Array<Readonly<{
    readonly start: number
    readonly end: number
    readonly lines: readonly PlainMarkdownLine[]
    readonly literals: readonly MappedMarkdownLiteral[]
  }>> = []
  let regionStartIndex = 0
  const appendRegion = (endIndex: number): void => {
    const regionLines = lines.slice(regionStartIndex, endIndex)
    const first = regionLines[0]
    const last = regionLines.at(-1)
    if (first === undefined || last === undefined) {
      return
    }
    const start = first.start
    const end = last.end
    regions.push(Object.freeze({
      start,
      end,
      lines: Object.freeze(regionLines),
      literals: overlappingLiterals(start, end)
    }))
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) {
      continue
    }
    const firstLiteral = literals[firstLiteralEndingAfter(line.start)]
    const literalOwnsLine =
      firstLiteral !== undefined && firstLiteral.start < line.end
    const previousLine = lines[index - 1]
    const nextLine = lines[index + 1]
    if (
      line.blank &&
      line.containers.length === 0 &&
      previousLine?.containers.length === 0 &&
      nextLine?.containers.length === 0 &&
      !literalOwnsLine
    ) {
      appendRegion(index)
      regionStartIndex = index + 1
    }
  }
  appendRegion(lines.length)
  return Object.freeze(regions)
}

function emitMarkdownAstRegions(
  source: string,
  regions: readonly MarkdownAstRegion[],
  referenceDefinitions: MarkdownReferenceDefinitionLookup,
  boundaryPolicy: InlineBoundaryPolicy | undefined,
  reuseCache: MarkdownAstRegionCacheIdentity | undefined
): readonly MarkdownNode[] {
  const blocks: MarkdownNode[] = []
  const cache = reuseCache === undefined
    ? undefined
    : astRegionCaches.get(reuseCache) ??
      (() => {
        const created = new Map<string, MarkdownAstRegionTemplate>()
        astRegionCaches.set(reuseCache, created)
        registerRetainedFragmentCache(
          created,
          retainedFragmentBudget(reuseCache)
        )
        return created
      })()
  for (const region of regions) {
    const regionSource = source.slice(region.start, region.end)
    const regionBoundaryPolicy =
      boundaryPolicy?.scopeRuns.some(
        (scope) => scope.start < region.end && region.start < scope.end
      ) === true
        ? boundaryPolicy
        : undefined
    const sourceCanFitCache =
      cache !== undefined && fragmentSourceCanFit(regionSource)
    const hasReferenceSyntax =
      sourceCanFitCache &&
      (regionSource.includes('[') || regionSource.includes(']'))
    const cacheable =
      sourceCanFitCache &&
      regionBoundaryPolicy === undefined &&
      (!hasReferenceSyntax || referenceDefinitions.cacheKey !== undefined)
    const linesKey = cacheable
      ? markdownAstRegionLinesKey(region.lines, region.start)
      : undefined
    const literalsKey = cacheable
      ? markdownAstRegionLiteralsKey(region.literals, region.start)
      : undefined
    const serializedKey =
      cacheable && linesKey !== undefined && literalsKey !== undefined
        ? JSON.stringify([
          activeMarkdownGfmEnabled,
          activeMarkdownFootnotesEnabled,
          activeMarkdownSubscriptAndSuperscriptEnabled,
          referenceDefinitions.cacheKey,
          regionSource,
          linesKey,
          literalsKey
        ])
        : undefined
    const key =
      serializedKey !== undefined &&
      linesKey !== undefined &&
      literalsKey !== undefined &&
      astRegionTemplateCanFit(
        serializedKey,
        regionSource,
        linesKey,
        literalsKey
      )
        ? serializedKey
        : undefined
    const cached = key === undefined ? undefined : cache?.get(key)
    if (
      cached !== undefined &&
      cached.source === regionSource &&
      cached.linesKey === linesKey &&
      cached.literalsKey === literalsKey
    ) {
      recordForkAstRegionReuseV1()
      for (const template of cached.nodes) {
        blocks.push(markdownAstNodeFromTemplate(template, region.start))
      }
      continue
    }

    recordForkAstRegionEmissionV1(region.end - region.start)
    const localNodes = emitMarkdownAstRegion(
      regionSource,
      region.lines,
      region.literals,
      referenceDefinitions,
      regionBoundaryPolicy,
      region.start
    )
    if (
      key === undefined ||
      cache === undefined ||
      linesKey === undefined ||
      literalsKey === undefined ||
      !astRegionTemplateNodesCanFit(
        key,
        regionSource,
        linesKey,
        literalsKey,
        localNodes
      )
    ) {
      for (const node of localNodes) {
        blocks.push(markdownAstNodeAtOffset(node, region.start))
      }
      continue
    }
    const templates = Object.freeze(localNodes.map((node) =>
      markdownAstNodeTemplate(node, 0, true)))
    for (const template of templates) {
      blocks.push(markdownAstNodeFromTemplate(template, region.start))
    }
    retainFragmentEntry(cache, key, Object.freeze({
      source: regionSource,
      linesKey,
      literalsKey,
      nodes: templates
    }))
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

function withMappedMarkdownIdentity<Value>(
  lane: MappedMarkdownLane,
  emit: () => Value,
  execution?: ParseExecutionTracker
): Value {
  const syntaxIdentity = lane.syntaxIdentity
  if (syntaxIdentity === undefined) {
    throw new Error('Intrinsic Markdown fork region has no syntax identity')
  }
  const previousIdentity = activeMarkdownSyntaxIdentity
  const previousGfmEnabled = activeMarkdownGfmEnabled
  const previousFootnotesEnabled = activeMarkdownFootnotesEnabled
  const previousSubscriptAndSuperscriptEnabled =
    activeMarkdownSubscriptAndSuperscriptEnabled
  const previousExecution = activeMarkdownExecution
  activeMarkdownSyntaxIdentity = {
    registry: syntaxIdentity.registry,
    sourceAt: syntaxIdentity.sourceAt
  }
  activeMarkdownGfmEnabled = lane.gfmEnabled ?? true
  activeMarkdownFootnotesEnabled = lane.footnotesEnabled ?? true
  activeMarkdownSubscriptAndSuperscriptEnabled =
    lane.subscriptAndSuperscriptEnabled ?? false
  activeMarkdownExecution = execution
  try {
    return emit()
  } finally {
    activeMarkdownSyntaxIdentity = previousIdentity
    activeMarkdownGfmEnabled = previousGfmEnabled
    activeMarkdownFootnotesEnabled = previousFootnotesEnabled
    activeMarkdownSubscriptAndSuperscriptEnabled =
      previousSubscriptAndSuperscriptEnabled
    activeMarkdownExecution = previousExecution
  }
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
  const authenticatedRuns: Array<Readonly<{
    readonly candidateStart: number
    readonly candidateEnd: number
    readonly sourceRunId: number
    readonly sourceStart: number
    readonly matchingScopeId: number
  }>> = []
  let scopeRunIndex = 0
  for (const identityRun of canonicalIdentityRuns) {
    let candidateStart = identityRun.candidateStart
    while (candidateStart < identityRun.candidateEnd) {
      while (
        (scopeRuns[scopeRunIndex]?.end ?? Number.POSITIVE_INFINITY) <=
          candidateStart
      ) {
        scopeRunIndex += 1
      }
      const scope = scopeRuns[scopeRunIndex]
      const insideScope =
        scope !== undefined &&
        scope.start <= candidateStart &&
        candidateStart < scope.end
      const candidateEnd = Math.min(
        identityRun.candidateEnd,
        insideScope
          ? scope?.end ?? identityRun.candidateEnd
          : scope?.start ?? identityRun.candidateEnd
      )
      authenticatedRuns.push(Object.freeze({
        candidateStart,
        candidateEnd,
        sourceRunId: identityRun.sourceRunId,
        sourceStart:
          identityRun.sourceStart +
          candidateStart -
          identityRun.candidateStart,
        matchingScopeId: insideScope ? scope?.id ?? -1 : -1
      }))
      candidateStart = candidateEnd
    }
  }
  let authenticatedRunIndex = 0
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
      // Identity and scope boundaries are merged once above. The one cursor
      // below therefore advances through each authenticated segment at most
      // once instead of charging parallel identity and scope probes per
      // delimiter query.
      trace?.recorder.recordInlineCodeCloserQuery(trace.view, start, end)
      if (start >= end) {
        return undefined
      }
      while (
        (authenticatedRuns[authenticatedRunIndex]?.candidateEnd ??
          Number.POSITIVE_INFINITY) <= start
      ) {
        trace?.recorder.recordInlineCodeCloserCandidate(trace.view, start, end)
        authenticatedRunIndex += 1
      }
      const authenticated = authenticatedRuns[authenticatedRunIndex]
      if (
        authenticated === undefined ||
        authenticated.candidateStart > start ||
        end > authenticated.candidateEnd
      ) {
        return undefined
      }

      return Object.freeze({
        sourceRunId: authenticated.sourceRunId,
        sourceStart:
          authenticated.sourceStart + start - authenticated.candidateStart,
        matchingScopeId: authenticated.matchingScopeId
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

interface BoundaryBacktickRun {
  readonly start: number
  readonly end: number
  readonly scopeId: number
}

function findInlineCodeDelimiterRuns(
  literal: MappedMarkdownLiteral,
  backtickRuns: readonly BoundaryBacktickRun[]
): Readonly<{
  readonly opener: BoundaryBacktickRun
  readonly closer: BoundaryBacktickRun
}> | undefined {
  const opener = backtickRuns.find((run) => run.start === literal.start)
  const closer = backtickRuns.find((run) => run.end === literal.end)
  if (
    opener === undefined ||
    closer === undefined ||
    opener.end > closer.start ||
    opener.end - opener.start !== closer.end - closer.start
  ) {
    return undefined
  }
  return Object.freeze({ opener, closer })
}

function inlineCodeDelimiterRuns(
  literal: MappedMarkdownLiteral,
  backtickRuns: readonly BoundaryBacktickRun[]
): Readonly<{
    readonly opener: BoundaryBacktickRun
    readonly closer: BoundaryBacktickRun
  }> {
  const delimiters = findInlineCodeDelimiterRuns(literal, backtickRuns)
  if (delimiters === undefined) {
    throw new Error('Inline-code literal lost its parser-owned delimiters')
  }
  return delimiters
}

function analyzeInlineCodeLiteralForExtension(
  literal: MappedMarkdownLiteral,
  backtickRuns: readonly BoundaryBacktickRun[],
  identityLookup: AuthenticatedMarkdownDelimiterLookup,
  trace?: Profile1ProjectionPlanningTraceV1
): InlineCodeLiteralExtensionAnalysis {
  trace?.recorder.recordInlineCodeExtensionAnalysis(
    trace.view,
    literal.start,
    literal.end
  )
  const delimiters = inlineCodeDelimiterRuns(literal, backtickRuns)
  const openerEnd = delimiters.opener.end
  const closerStart = delimiters.closer.start
  const delimiterLength = openerEnd - literal.start

  const openerIdentity = identityLookup.authenticate(
    literal.start,
    openerEnd
  )
  let maximumInteriorRunLength = 0
  const eligibleUnsafeOffsets = new Set<number>()
  for (const run of backtickRuns) {
    if (run.start < openerEnd || run.end > closerStart) {
      continue
    }
    const runLength = run.end - run.start
    maximumInteriorRunLength = Math.max(
      maximumInteriorRunLength,
      runLength
    )
    if (runLength >= delimiterLength) {
      eligibleUnsafeOffsets.add(run.end - delimiterLength)
    }
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
  literals: readonly MappedMarkdownLiteral[],
  backtickRuns: readonly BoundaryBacktickRun[],
  identityLookup: AuthenticatedMarkdownDelimiterLookup,
  boundaryPolicy: InlineBoundaryPolicy | undefined
): readonly number[] {
  const offsets: number[] = []
  for (const literal of literals) {
    const delimiters = inlineCodeDelimiterRuns(literal, backtickRuns)
    const openerEnd = delimiters.opener.end
    const closerStart = delimiters.closer.start
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
      offsets.push(
        mappedCrossScopeProtectionOffset(
          boundaryPolicy,
          literal.start,
          closerStart
        ) ?? closerStart
      )
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
  }
  for (const scalarEdit of [
    ...(boundaryPolicy?.emphasisFlankingScalarEdits.values() ?? [])
  ].sort((left, right) =>
    left.candidateStart - right.candidateStart ||
    left.candidateEnd - right.candidateEnd)) {
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
  const projectedBacktickRuns = [
    ...(boundaryPolicy?.projectedBacktickRuns.values() ?? [])
  ].sort((left, right) => left.start - right.start || left.end - right.end)
  const inlineCodeLiterals = literals.filter(
    (literal) =>
      literal.provider === 'inline-code' &&
      findInlineCodeDelimiterRuns(
        literal,
        projectedBacktickRuns
      ) !== undefined
  )
  const authenticatedInlineCodeLiterals = [...inlineCodeLiterals]
  const canonicalBacktickAtoms = [
    ...(boundaryPolicy?.canonicalBacktickAtoms.values() ?? [])
  ].sort((left, right) => left.start - right.start || left.end - right.end)
  const stableEndpointAtoms = canonicalBacktickAtoms.filter(
    (atom) => projectedBacktickRuns.some(
      (run) => run.start === atom.start && run.end === atom.end
    )
  )
  const scopeUnsafeBacktickOffsets = new Set<number>()
  for (let openerIndex = 0; openerIndex < stableEndpointAtoms.length; openerIndex += 1) {
    const opener = stableEndpointAtoms[openerIndex]
    if (opener === undefined) {
      continue
    }
    const delimiterLength = opener.end - opener.start
    let closer: typeof opener | undefined
    for (let closerIndex = openerIndex + 1; closerIndex < stableEndpointAtoms.length; closerIndex += 1) {
      const candidate = stableEndpointAtoms[closerIndex]
      if (
        candidate !== undefined &&
        candidate.end - candidate.start === delimiterLength &&
        candidate.scopeId === opener.scopeId
      ) {
        closer = candidate
      }
    }
    if (closer === undefined) {
      continue
    }
    const crossScopeInterior = canonicalBacktickAtoms.filter(
      (atom) =>
        opener.end <= atom.start &&
        atom.end <= closer.end &&
        atom.scopeId !== opener.scopeId
    )
    if (crossScopeInterior.length === 0) {
      continue
    }
    inlineCodeLiterals.push(Object.freeze({
      provider: 'inline-code',
      start: opener.start,
      end: closer.end
    }))
    for (const atom of crossScopeInterior) {
      scopeUnsafeBacktickOffsets.add(
        atom.end - Math.min(delimiterLength, atom.end - atom.start)
      )
    }
    break
  }
  if (scopeUnsafeBacktickOffsets.size === 0) {
    for (
      let openerIndex = 0;
      openerIndex < projectedBacktickRuns.length;
      openerIndex += 1
    ) {
      const opener = projectedBacktickRuns[openerIndex]
      const openerAtomCount = opener === undefined
        ? 0
        : canonicalBacktickAtoms.filter(
          (atom) => opener.start <= atom.start && atom.end <= opener.end
        ).length
      if (opener === undefined || openerAtomCount < 2) {
        continue
      }
      for (
        let closerIndex = openerIndex + 1;
        closerIndex < projectedBacktickRuns.length;
        closerIndex += 1
      ) {
        const closer = projectedBacktickRuns[closerIndex]
        if (
          closer !== undefined &&
          closer.end - closer.start === opener.end - opener.start &&
          closer.scopeId !== opener.scopeId
        ) {
          scopeUnsafeBacktickOffsets.add(opener.start)
          scopeUnsafeBacktickOffsets.add(closer.start)
          break
        }
      }
      if (scopeUnsafeBacktickOffsets.size !== 0) {
        break
      }
    }
  }
  for (const literal of authenticatedInlineCodeLiterals) {
    const delimiters = inlineCodeDelimiterRuns(
      literal,
      projectedBacktickRuns
    )
    const openerEnd = delimiters.opener.end
    const delimiterLength = openerEnd - literal.start
    const closerStart = delimiters.closer.start
    if (
      delimiterLength <= 0 ||
      mappedCrossScopeProtectionOffset(
        boundaryPolicy,
        literal.start,
        closerStart
      ) === undefined
    ) {
      continue
    }
    const openerScopeId =
      matchingScopeAt(boundaryPolicy, literal.start)?.id ?? -1
    for (const run of projectedBacktickRuns) {
      if (
        run.start >= literal.end &&
        run.end - run.start === delimiterLength &&
        run.scopeId === openerScopeId
      ) {
        inlineCodeLiterals.push(Object.freeze({
          provider: 'inline-code',
          start: literal.start,
          end: run.end
        }))
        break
      }
    }
  }
  inlineCodeLiterals.sort(
    (left, right) => left.start - right.start || right.end - left.end
  )
  const protectionOffsets = new Set<number>(
    unauthenticatedInlineCodeDelimiterOffsets(
      authenticatedInlineCodeLiterals,
      projectedBacktickRuns,
      createAuthenticatedMarkdownDelimiterLookup(
        canonicalIdentityRuns,
        boundaryPolicy,
        trace
      ),
      boundaryPolicy
    )
  )
  for (const offset of scopeUnsafeBacktickOffsets) {
    protectionOffsets.add(offset)
  }
  for (const literal of literals) {
    if (
      literal.provider === 'math' &&
      literal.end > literal.start + 1
    ) {
      const unsafeOffset = mappedCrossScopeProtectionOffset(
        boundaryPolicy,
        literal.start,
        literal.end - 1
      )
      if (unsafeOffset !== undefined) {
        protectionOffsets.add(unsafeOffset)
      }
    }
    if (
      literal.provider === 'link-destination' &&
      literal.end > literal.start + 1
    ) {
      const unsafeOffset = mappedCrossScopeProtectionOffset(
        boundaryPolicy,
        literal.start,
        literal.end - 1
      )
      if (unsafeOffset !== undefined) {
        protectionOffsets.add(unsafeOffset)
      }
    }
    const construct = literal.construct
    if (construct !== undefined) {
      const bracketStart = construct.labelStart - 1
      const unsafeBracket = mappedCrossScopeProtectionOffset(
        boundaryPolicy,
        bracketStart,
        construct.labelEnd
      )
      if (unsafeBracket !== undefined) {
        protectionOffsets.add(
          unsafeBracket === construct.labelEnd
            ? construct.labelEnd
            : bracketStart
        )
      }
    }
    if (construct?.kind === 'image') {
      const bracketStart = construct.labelStart - 1
      if (
        mappedCrossScopeProtectionOffset(
          boundaryPolicy,
          construct.start,
          bracketStart
        ) !== undefined
      ) {
        // `!` plus an arm-local `[` must remain text + link, never become an
        // image assembled by projection.
        protectionOffsets.add(construct.start)
      }
    }
  }
  for (const scope of boundaryPolicy?.scopeRuns ?? []) {
    if (
      (
        protectionOffsets.has(scope.start) ||
        unsafeDelimiterOffsets.has(scope.start)
      ) &&
      boundaryPolicy?.bracketOffsets.has(scope.start) === true &&
      boundaryPolicy.bracketOffsets.has(scope.end - 1) &&
      [...boundaryPolicy.bracketOffsets].some(
        (offset) => offset < scope.start
      )
    ) {
      // Once the arm-local opener is escaped, its closer could otherwise be
      // retargeted to an enclosing opener. Guard both ends in the same
      // projection transaction.
      protectionOffsets.add(scope.end - 1)
    }
  }
  const analysisIdentityLookup = createAuthenticatedMarkdownDelimiterLookup(
    canonicalIdentityRuns,
    boundaryPolicy
  )
  const extensionUnsafeOffsets = new Set<number>([
    ...unsafeDelimiterOffsets,
    ...protectionOffsets
  ])
  const extendedInlineCodeStarts = new Set<number>()
  let inlineCodeLiteralIndex = 0
  let cachedAnalysis: InlineCodeLiteralExtensionAnalysis | undefined
  const orderedUnsafeOffsets = [...extensionUnsafeOffsets].sort(
    (left, right) => left - right
  )
  for (const candidateOffset of orderedUnsafeOffsets) {
    if (candidateOffset < 0 || candidateOffset >= source.length) {
      throw new Error('Unsafe Markdown delimiter offset is outside the lane')
    }
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
      projectedBacktickRuns.some(
        (run) => run.start <= candidateOffset && candidateOffset < run.end
      )
    ) {
      cachedAnalysis ??= analyzeInlineCodeLiteralForExtension(
        literal,
        projectedBacktickRuns,
        analysisIdentityLookup,
        trace
      )
      extension = inlineCodeDelimiterExtension(
        cachedAnalysis,
        candidateOffset
      )
    }
    if (extension !== undefined) {
      protectionOffsets.delete(candidateOffset)
      if (!extendedInlineCodeStarts.has(extension.openerStart)) {
        extendedInlineCodeStarts.add(extension.openerStart)
        edits.push(extension)
      }
      continue
    }
    protectionOffsets.add(candidateOffset)
  }
  for (const candidateOffset of [...protectionOffsets].sort(
    (left, right) => left - right
  )) {
    if (candidateOffset < 0 || candidateOffset >= source.length) {
      throw new Error('Markdown delimiter protection is outside the lane')
    }
    edits.push(Object.freeze({ kind: 'protect-delimiter', candidateOffset }))
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
      throw new Error(
        `Mapped Markdown matching scope is invalid: ${JSON.stringify({
          sourceLength,
          scope
        })}`
      )
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

function mappedLiteralsFromFacts(
  facts: PlainMarkdownLaneParseWithDefinitions
): readonly MappedMarkdownLiteral[] {
  return Object.freeze(facts.literals.map(
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
  ))
}

function emitIntrinsicForkRegionNodes(
  lane: MappedMarkdownLane,
  facts: PlainMarkdownLaneParseWithDefinitions,
  reuseCache: MarkdownAstRegionCacheIdentity,
  boundaryPolicy: InlineBoundaryPolicy | undefined,
  execution?: ParseExecutionTracker
): readonly MarkdownNode[] {
  return withMappedMarkdownIdentity(lane, () => {
    if (facts.referenceDefinitions.definitionStart !== undefined) {
      if (activeMarkdownSyntaxIdentity === undefined) {
        throw new Error('Intrinsic fork region lost its syntax identity')
      }
      activeMarkdownSyntaxIdentity.definitionStart =
        facts.referenceDefinitions.definitionStart
    }
    const literals = mappedLiteralsFromFacts(facts)
    return lane.source.length === 0
      ? Object.freeze([])
      : emitMarkdownAstRegions(
        lane.source,
        markdownAstRegions(facts.lines, literals),
        facts.referenceDefinitions,
        boundaryPolicy,
        reuseCache
      )
  }, execution)
}

function materializeIntrinsicForkRegionNodes(
  selectionLane: MappedMarkdownLane,
  localNodes: readonly MarkdownNode[],
  selectionOffset: number
): readonly MarkdownNode[] {
  return withMappedMarkdownIdentity(selectionLane, () =>
    Object.freeze(localNodes.map((node) =>
      markdownAstNodeFromTemplate(
        markdownAstNodeTemplate(node, 0),
        selectionOffset
      )
    )))
}

function intrinsicForkDocumentFromNodes(
  lane: MappedMarkdownLane,
  children: readonly MarkdownNode[],
  containerDepthFailure: MarkdownContainerDepthFailure | undefined,
  execution: ParseExecutionTracker
): Profile1MarkdownParse {
  return withMappedMarkdownIdentity(lane, () => {
    const root = createNode('document', 0, lane.source.length, children)
    const registry = activeMarkdownSyntaxIdentity?.registry
    if (registry === undefined) {
      throw new Error('Markdown document index lost parser reference identity')
    }
    const indices = createMarkdownDocumentIndices(
      lane.source,
      root,
      registry,
      execution
    )
    const nodeAt = Object.freeze((
      projectedOffset: number,
      affinity: 'previous' | 'next'
    ): readonly MarkdownNode[] => {
      if (
        !Number.isInteger(projectedOffset) ||
        projectedOffset < 0 ||
        projectedOffset > lane.source.length
      ) {
        throw new RangeError('Projected Markdown position is outside the document')
      }
      if (affinity !== 'previous' && affinity !== 'next') {
        throw new RangeError(
          `Unknown projected Markdown affinity: ${String(affinity)}`
        )
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
      document: Object.freeze({
        source: lane.source,
        root,
        references: indices.references,
        headings: indices.headings,
        nodeAt
      }),
      containerDepthFailure
    })
  })
}

export function __markdownDocumentParsesV1(): number {
  return __profile1PhysicalTraversalCountsV1().total
}

export function __resetMarkdownDocumentParsesV1(): void {
  __resetProfile1PhysicalTraversalCountsV1()
  __resetPlainMarkdownLaneUnitsV1()
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
export type MarkdownAstRegionCacheIdentity = object

function projectedOffsetForCanonicalOffset(
  runs: readonly MappedMarkdownCanonicalIdentityRun[],
  offset: number,
  affinity: 'previous' | 'next'
): number | undefined {
  let previous: MappedMarkdownCanonicalIdentityRun | undefined
  for (const run of runs) {
    const sourceEnd =
      run.sourceStart + run.candidateEnd - run.candidateStart
    if (run.sourceStart <= offset && offset <= sourceEnd) {
      return run.candidateStart + offset - run.sourceStart
    }
    if (offset < run.sourceStart) {
      return affinity === 'next'
        ? run.candidateStart
        : previous?.candidateEnd
    }
    previous = run
  }
  return affinity === 'previous' ? previous?.candidateEnd : undefined
}

function canonicalOffsetForProjectedOffset(
  runs: readonly MappedMarkdownCanonicalIdentityRun[],
  offset: number,
  affinity: 'previous' | 'next'
): number | undefined {
  let previous: MappedMarkdownCanonicalIdentityRun | undefined
  for (const run of runs) {
    if (offset < run.candidateStart) {
      return affinity === 'next'
        ? run.sourceStart
        : previous === undefined
          ? undefined
          : previous.sourceStart +
            previous.candidateEnd - previous.candidateStart
    }
    if (offset < run.candidateEnd) {
      return run.sourceStart + offset - run.candidateStart
    }
    if (offset === run.candidateEnd && affinity === 'previous') {
      return run.sourceStart + run.candidateEnd - run.candidateStart
    }
    previous = run
  }
  return affinity === 'previous' && previous !== undefined
    ? previous.sourceStart +
      previous.candidateEnd - previous.candidateStart
    : undefined
}

function projectedReferenceDefinitionsFromCanonicalFacts(
  canonical: Profile1CanonicalReferenceDefinitionLookup,
  identityRuns: readonly MappedMarkdownCanonicalIdentityRun[],
  literals?: readonly MarkdownLiteralRange[]
): MarkdownReferenceDefinitionLookup {
  const factByStart = new Map(
    canonical.definitionFacts().map((fact) => [fact.sourceStart, fact] as const)
  )
  const selectedStarts = new Set<number>()
  if (literals === undefined) {
    for (const fact of factByStart.values()) {
      const projectedStart = projectedOffsetForCanonicalOffset(
        identityRuns,
        fact.sourceStart,
        'next'
      )
      const projectedEnd = projectedOffsetForCanonicalOffset(
        identityRuns,
        fact.sourceEnd,
        'previous'
      )
      if (
        projectedStart !== undefined &&
        projectedEnd !== undefined &&
        projectedStart < projectedEnd
      ) {
        selectedStarts.add(fact.sourceStart)
      }
    }
  } else {
    for (const literal of literals) {
      if (literal.kind !== 'definition') {
        continue
      }
      const canonicalStart = canonicalOffsetForProjectedOffset(
        identityRuns,
        literal.start,
        'next'
      )
      if (canonicalStart !== undefined && factByStart.has(canonicalStart)) {
        selectedStarts.add(canonicalStart)
      }
    }
  }
  const selectedFacts = [...selectedStarts]
    .map((start) => factByStart.get(start))
    .filter((fact) => fact !== undefined)
  const selectedLabels = new Set(
    selectedFacts.map((fact) => fact.normalizedLabel)
  )
  const definitionStart = (
    normalizedLabel: string,
    projectedReferenceStart: number
  ): number | undefined => {
    const canonicalReferenceStart = canonicalOffsetForProjectedOffset(
      identityRuns,
      projectedReferenceStart,
      'next'
    )
    if (canonicalReferenceStart === undefined) {
      return undefined
    }
    const canonicalDefinitionStart = canonical.definitionStartMatching(
      normalizedLabel,
      canonicalReferenceStart,
      (candidate) => selectedStarts.has(candidate)
    )
    return canonicalDefinitionStart === undefined
      ? undefined
      : projectedOffsetForCanonicalOffset(
        identityRuns,
        canonicalDefinitionStart,
        'next'
      )
  }
  return Object.freeze({
    cacheKey: JSON.stringify(
      selectedFacts.map((fact) => [
        fact.normalizedLabel,
        fact.sourceStart
      ])
    ),
    hasAny: Object.freeze((normalizedLabel: string): boolean =>
      selectedLabels.has(normalizedLabel)),
    definitionStart: Object.freeze(definitionStart),
    has: Object.freeze((
      normalizedLabel: string,
      projectedReferenceStart: number
    ): boolean =>
      definitionStart(
        normalizedLabel,
        projectedReferenceStart
      ) !== undefined)
  })
}

function checkpointIsForkReconvergence(
  checkpoint: MarkdownCheckpoint
): boolean {
  return (
    checkpoint.linePath === undefined &&
    checkpoint.inlineCode === undefined &&
    checkpoint.math === undefined &&
    checkpoint.bracketPath === undefined &&
    checkpoint.pendingLinkLabel === undefined &&
    checkpoint.fixedInline === undefined &&
    checkpoint.activeContainers.length === 0 &&
    !checkpoint.paragraphOpen &&
    checkpoint.fence === undefined &&
    checkpoint.frontMatter === undefined &&
    checkpoint.indentedCode === undefined &&
    checkpoint.htmlBlock === undefined &&
    checkpoint.definition === undefined &&
    checkpoint.pendingCarriageReturn === undefined
  )
}

function intrinsicForkSafeSourcePoints(
  lane: IntrinsicProfile1ForkLane
): readonly number[] {
  const points = new Set<number>()
  const lines = lane.transitions.flatMap(
    (transition) => transition.emittedFacts.lines
  ).sort((left, right) => left.start - right.start || left.end - right.end)
  const literals = lane.transitions.flatMap(
    (transition) => transition.emittedFacts.literals
  )
  for (const transition of lane.transitions) {
    const sourcePoint = transition.exitCheckpoint.lineStart
    if (
      transition.operation === 'advance' &&
      transition.entryCheckpoint.linePath === undefined &&
      sourcePoint > transition.entryCheckpoint.lineStart &&
      checkpointIsForkReconvergence(transition.exitCheckpoint)
    ) {
      const blankIndex = lines.findIndex(
        (line) =>
          line.end === sourcePoint &&
          line.blank &&
          line.containers.length === 0
      )
      const blank = lines[blankIndex]
      const previous = lines[blankIndex - 1]
      const next = lines[blankIndex + 1]
      if (
        blank !== undefined &&
        previous?.end === blank.start &&
        previous.containers.length === 0 &&
        next?.start === sourcePoint &&
        next.containers.length === 0 &&
        !literals.some(
          (literal) =>
            literal.start < blank.end && blank.start < literal.end
        )
      ) {
        points.add(sourcePoint)
      }
    }
  }
  return Object.freeze([...points].sort((left, right) => left - right))
}

function projectedOffsetForCanonicalPoint(
  runs: readonly MappedMarkdownCanonicalIdentityRun[],
  sourcePoint: number
): number | undefined {
  let first = 0
  let last = runs.length
  while (first < last) {
    const middle = first + Math.floor((last - first) / 2)
    const run = runs[middle]
    if (run === undefined) {
      break
    }
    const sourceEnd =
      run.sourceStart + run.candidateEnd - run.candidateStart
    if (sourceEnd < sourcePoint) {
      first = middle + 1
    } else {
      last = middle
    }
  }
  const run = runs[first]
  if (run === undefined || sourcePoint < run.sourceStart) {
    return undefined
  }
  const sourceEnd =
    run.sourceStart + run.candidateEnd - run.candidateStart
  return sourcePoint > sourceEnd
    ? undefined
    : run.candidateStart + sourcePoint - run.sourceStart
}

interface IntrinsicForkRegionLane {
  readonly start: number
  readonly end: number
  readonly lane: MappedMarkdownLane
}

function sliceIntrinsicForkRegionLane(
  lane: MappedMarkdownLane,
  start: number,
  end: number,
  identityRuns: readonly MappedMarkdownCanonicalIdentityRun[],
  sourceMatchingScopes: readonly MappedMarkdownMatchingScope[]
): IntrinsicForkRegionLane {
  const forkView = lane.forkView
  if (forkView === undefined) {
    throw new Error('Intrinsic Markdown fork region has no view selection')
  }
  let firstIdentityRun = 0
  let lastIdentityRun = identityRuns.length
  while (firstIdentityRun < lastIdentityRun) {
    const middle =
      firstIdentityRun + Math.floor((lastIdentityRun - firstIdentityRun) / 2)
    if (
      (identityRuns[middle]?.candidateEnd ?? Number.POSITIVE_INFINITY) <= start
    ) {
      firstIdentityRun = middle + 1
    } else {
      lastIdentityRun = middle
    }
  }
  const canonicalIdentityRuns: MappedMarkdownCanonicalIdentityRun[] = []
  for (
    let index = firstIdentityRun;
    index < identityRuns.length;
    index += 1
  ) {
    const run = identityRuns[index]
    if (run === undefined || run.candidateStart >= end) {
      break
    }
    const overlapStart = Math.max(start, run.candidateStart)
    const overlapEnd = Math.min(end, run.candidateEnd)
    if (overlapStart < overlapEnd) {
      canonicalIdentityRuns.push(Object.freeze({
        candidateStart: overlapStart - start,
        candidateEnd: overlapEnd - start,
        sourceRunId: run.sourceRunId,
        sourceStart:
          run.sourceStart + overlapStart - run.candidateStart
      }))
    }
  }
  let firstScope = 0
  let lastScope = sourceMatchingScopes.length
  while (firstScope < lastScope) {
    const middle = firstScope + Math.floor((lastScope - firstScope) / 2)
    if (
      (sourceMatchingScopes[middle]?.start ?? Number.POSITIVE_INFINITY) < start
    ) {
      firstScope = middle + 1
    } else {
      lastScope = middle
    }
  }
  while (
    firstScope > 0 &&
    (sourceMatchingScopes[firstScope - 1]?.end ?? 0) > start
  ) {
    firstScope -= 1
  }
  const matchingScopes: MappedMarkdownMatchingScope[] = []
  for (
    let index = firstScope;
    index < sourceMatchingScopes.length;
    index += 1
  ) {
    const scope = sourceMatchingScopes[index]
    if (scope === undefined || scope.start >= end) {
      break
    }
    if (scope.end > start) {
      const overlapStart = Math.max(start, scope.start)
      const overlapEnd = Math.min(end, scope.end)
      if (overlapStart < overlapEnd) {
        matchingScopes.push(Object.freeze({
          ...scope,
          start: overlapStart - start,
          end: overlapEnd - start
        }))
      }
    }
  }
  const sourceAt = lane.syntaxIdentity?.sourceAt
  return Object.freeze({
    start,
    end,
    lane: Object.freeze({
      source: lane.source.slice(start, end),
      forkView,
      frontMatterEnabled: (lane.frontMatterEnabled ?? true) && start === 0,
      gfmEnabled: lane.gfmEnabled ?? true,
      mathEnabled: lane.mathEnabled ?? true,
      gitLabMathEnabled: lane.gitLabMathEnabled ?? true,
      footnotesEnabled: lane.footnotesEnabled ?? true,
      subscriptAndSuperscriptEnabled:
        lane.subscriptAndSuperscriptEnabled ?? false,
      canonicalIdentityRuns: Object.freeze(canonicalIdentityRuns),
      matchingScopes: Object.freeze(matchingScopes),
      ...(sourceAt === undefined || lane.syntaxIdentity === undefined
        ? {}
        : {
          syntaxIdentity: Object.freeze({
            registry: lane.syntaxIdentity.registry,
            sourceAt: Object.freeze((
              localStart: number,
              localEnd: number
            ): SyntaxSourceIdentity => sourceAt(
              localStart + start,
              localEnd + start
            ))
          })
        })
    })
  })
}

function intrinsicForkRegionLanes(
  forkLane: IntrinsicProfile1ForkLane,
  lane: MappedMarkdownLane
): readonly IntrinsicForkRegionLane[] {
  const identityRuns = validatedCanonicalIdentityRuns(
    lane.source.length,
    lane.canonicalIdentityRuns
  )
  const sourceOrderedIdentityRuns = Object.freeze([...identityRuns].sort(
    (left, right) =>
      left.sourceStart - right.sourceStart ||
      left.candidateStart - right.candidateStart
  ))
  const sourceMatchingScopes = Object.freeze([
    ...(lane.matchingScopes ?? Object.freeze([]))
  ].sort((left, right) =>
    left.start - right.start ||
    right.end - left.end ||
    left.depth - right.depth
  ))
  // Validate the selected lane once, but retain its unique nested scopes for
  // clipping. `validatedMatchingScopeRuns` returns disjoint active runs and can
  // therefore repeat an outer scope id around an inner scope; feeding those
  // normalized runs back through validation would invent duplicate scopes.
  validatedMatchingScopeRuns(lane.source.length, sourceMatchingScopes)
  const points = new Set<number>([0, lane.source.length])
  for (const sourcePoint of intrinsicForkSafeSourcePoints(forkLane)) {
    const projected = projectedOffsetForCanonicalPoint(
      sourceOrderedIdentityRuns,
      sourcePoint
    )
    if (
      projected !== undefined &&
      projected > 0 &&
      projected < lane.source.length
    ) {
      points.add(projected)
    }
  }
  const ordered = [...points].sort((left, right) => left - right)
  const regions: IntrinsicForkRegionLane[] = []
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const start = ordered[index]
    const end = ordered[index + 1]
    if (start !== undefined && end !== undefined && start < end) {
      regions.push(sliceIntrinsicForkRegionLane(
        lane,
        start,
        end,
        identityRuns,
        sourceMatchingScopes
      ))
    }
  }
  return Object.freeze(regions)
}

function forkRegionBoundaryFacts(
  lane: MappedMarkdownLane,
  trace?: Profile1ProjectionPlanningTraceV1
): Readonly<{
    readonly boundaryPolicy: InlineBoundaryPolicy | undefined
    readonly matchingScopePolicy: MarkdownMatchingScopePolicy | undefined
  }> {
  const identityRuns = validatedCanonicalIdentityRuns(
    lane.source.length,
    lane.canonicalIdentityRuns
  )
  const scopes = validatedMatchingScopeRuns(
    lane.source.length,
    lane.matchingScopes
  )
  const boundaryPolicy = scopes.length === 0
    ? undefined
    : createInlineBoundaryPolicy(scopes, identityRuns)
  const matchingScopePolicy: MarkdownMatchingScopePolicy | undefined =
    boundaryPolicy === undefined
      ? undefined
      : Object.freeze({
        ...(trace === undefined
          ? {}
          : {
            recordInlineCodeCloserQuery: Object.freeze((
              start: number,
              end: number
            ): void => {
              trace.recorder.recordInlineCodeCloserQuery(trace.view, start, end)
            }),
            recordInlineCodeCloserCandidate: Object.freeze((
              start: number,
              end: number
            ): void => {
              trace.recorder.recordInlineCodeCloserCandidate(
                trace.view,
                start,
                end
              )
            })
          }),
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
  return Object.freeze({ boundaryPolicy, matchingScopePolicy })
}

interface IntrinsicCanonicalFactIndex {
  readonly linesByStart: ReadonlyMap<number, readonly PlainMarkdownLine[]>
  readonly literals: readonly MarkdownLiteralRange[]
  readonly depthFailures: readonly MarkdownContainerDepthFailure[]
}

function createIntrinsicCanonicalFactIndex(
  forkGraph: IntrinsicProfile1ForkGraph
): IntrinsicCanonicalFactIndex {
  const linesByStart = new Map<number, PlainMarkdownLine[]>()
  const lineKeysByStart = new Map<number, Set<string>>()
  const literalByKey = new Map<string, MarkdownLiteralRange>()
  const failureByKey = new Map<string, MarkdownContainerDepthFailure>()
  for (const graphLane of forkGraph.lanes) {
    for (const transition of graphLane.transitions) {
      for (const line of transition.emittedFacts.lines) {
        const existing = linesByStart.get(line.start)
        const key = `${String(line.end)}:${String(line.contentEnd)}`
        if (existing === undefined) {
          linesByStart.set(line.start, [line])
          lineKeysByStart.set(line.start, new Set([key]))
        } else {
          const existingKeys = lineKeysByStart.get(line.start)
          if (existingKeys === undefined) {
            throw new Error('Canonical line fact index is internally incomplete')
          }
          if (!existingKeys.has(key)) {
            existing.push(line)
            existingKeys.add(key)
          }
        }
      }
      for (const literal of transition.emittedFacts.literals) {
        literalByKey.set(
          `${literal.kind}:${String(literal.start)}:${String(literal.end)}`,
          literal
        )
      }
      const failure = transition.exitCheckpoint.firstContainerDepthFailure
      if (failure !== undefined) {
        failureByKey.set(
          `${String(failure.start)}:${String(failure.end)}:${String(failure.observed)}`,
          failure
        )
      }
    }
  }
  return Object.freeze({
    linesByStart,
    literals: Object.freeze([...literalByKey.values()].sort(
      (left, right) => left.start - right.start || right.end - left.end
    )),
    depthFailures: Object.freeze([...failureByKey.values()].sort(
      (left, right) => left.start - right.start || left.end - right.end
    ))
  })
}

function intrinsicCanonicalRegionFacts(
  index: IntrinsicCanonicalFactIndex,
  lane: MappedMarkdownLane
): PlainMarkdownLaneParse | undefined {
  if ((lane.matchingScopes?.length ?? 0) !== 0) {
    return undefined
  }
  const runs = validatedCanonicalIdentityRuns(
    lane.source.length,
    lane.canonicalIdentityRuns
  )
  const first = runs[0]
  if (
    first === undefined ||
    first.candidateStart !== 0 ||
    runs.at(-1)?.candidateEnd !== lane.source.length
  ) {
    return undefined
  }
  let candidateCursor = 0
  let sourceCursor = first.sourceStart
  for (const run of runs) {
    if (
      run.candidateStart !== candidateCursor ||
      run.sourceStart !== sourceCursor
    ) {
      return undefined
    }
    const length = run.candidateEnd - run.candidateStart
    candidateCursor = run.candidateEnd
    sourceCursor += length
  }
  const sourceStart = first.sourceStart
  const sourceEnd = sourceCursor
  const canonicalLines: PlainMarkdownLine[] = []
  let lineCursor = sourceStart
  while (lineCursor < sourceEnd) {
    const line = index.linesByStart.get(lineCursor)?.find(
      (candidate) => candidate.end <= sourceEnd
    )
    if (line === undefined || line.end <= lineCursor) {
      return undefined
    }
    canonicalLines.push(line)
    lineCursor = line.end
  }
  if (lane.source.length !== 0 && lineCursor !== sourceEnd) {
    return undefined
  }
  let literalIndex = 0
  let literalCeiling = index.literals.length
  while (literalIndex < literalCeiling) {
    const middle = literalIndex +
      Math.floor((literalCeiling - literalIndex) / 2)
    if ((index.literals[middle]?.start ?? Number.POSITIVE_INFINITY) <
      sourceStart) {
      literalIndex = middle + 1
    } else {
      literalCeiling = middle
    }
  }
  const canonicalLiterals: MarkdownLiteralRange[] = []
  for (
    let current = literalIndex;
    current < index.literals.length;
    current += 1
  ) {
    const literal = index.literals[current]
    if (literal === undefined || literal.start >= sourceEnd) {
      break
    }
    if (literal.end <= sourceEnd) {
      canonicalLiterals.push(literal)
    }
  }
  const depthFailure = index.depthFailures.find(
    (failure) =>
      sourceStart <= failure.start && failure.end <= sourceEnd
  )
  const shiftLiteral = (
    literal: MarkdownLiteralRange
  ): MarkdownLiteralRange => Object.freeze({
    ...literal,
    start: literal.start - sourceStart,
    end: literal.end - sourceStart,
    ...(literal.construct === undefined
      ? {}
      : {
        construct: Object.freeze({
          ...literal.construct,
          start: literal.construct.start - sourceStart,
          labelStart: literal.construct.labelStart - sourceStart,
          labelEnd: literal.construct.labelEnd - sourceStart
        })
      })
  })
  return Object.freeze({
    lines: Object.freeze(canonicalLines.map((line) =>
      markdownRegionLine(line, sourceStart))),
    literals: Object.freeze(canonicalLiterals.map(shiftLiteral)),
    containerDepthFailure: depthFailure === undefined
      ? undefined
      : Object.freeze({
        ...depthFailure,
        start: depthFailure.start - sourceStart,
        end: depthFailure.end - sourceStart
      })
  })
}

function parseIntrinsicForkRegionFacts(
  canonicalFacts: IntrinsicCanonicalFactIndex,
  lane: MappedMarkdownLane,
  selectionReferenceDefinitions: MarkdownReferenceDefinitionLookup,
  selectionOffset: number,
  containerDepthLimit: number,
  reuse: Map<string, PlainMarkdownLaneParse>,
  trace?: Profile1ProjectionPlanningTraceV1
): Readonly<{
    readonly facts: PlainMarkdownLaneParseWithDefinitions
    readonly boundaryPolicy: InlineBoundaryPolicy | undefined
  }> {
  const boundary = forkRegionBoundaryFacts(lane, trace)
  const localReferenceDefinitions = markdownRegionReferenceDefinitions(
    selectionReferenceDefinitions,
    selectionOffset
  )
  const retainedFacts = intrinsicCanonicalRegionFacts(canonicalFacts, lane)
  let reuseKey: string | undefined
  if (
    retainedFacts === undefined &&
    boundary.matchingScopePolicy === undefined &&
    fragmentSourceCanFit(lane.source)
  ) {
    const serialized = JSON.stringify([
      lane.source,
      lane.frontMatterEnabled ?? true,
      lane.gfmEnabled ?? true,
      lane.mathEnabled ?? true,
      lane.gitLabMathEnabled ?? true,
      lane.footnotesEnabled ?? true,
      localReferenceDefinitions.cacheKey
    ])
    if (
      retainedStringBytes(serialized) + RETAINED_CACHE_ENTRY_BYTES <=
        PROFILE1_MARKDOWN_REUSE_MAX_RETAINED_BYTES_V1
    ) {
      reuseKey = serialized
    }
  }
  const parsed = retainedFacts ??
    (reuseKey === undefined ? undefined : reuse.get(reuseKey)) ??
    parseIntrinsicForkMarkdownLaneFacts(
      lane.source,
      localReferenceDefinitions,
      containerDepthLimit,
      boundary.matchingScopePolicy,
      lane.frontMatterEnabled ?? true,
      lane.gfmEnabled ?? true,
      lane.mathEnabled ?? true,
      lane.gitLabMathEnabled ?? true,
      lane.footnotesEnabled ?? true
    )
  if (reuseKey !== undefined && !reuse.has(reuseKey)) {
    retainFragmentEntry(reuse, reuseKey, parsed)
  }
  return Object.freeze({
    facts: Object.freeze({
      ...parsed,
      referenceDefinitions: localReferenceDefinitions
    }),
    boundaryPolicy: boundary.boundaryPolicy
  })
}

function projectionPlanningTraceAt(
  trace: Profile1ProjectionPlanningTraceV1 | undefined,
  offset: number
): Profile1ProjectionPlanningTraceV1 | undefined {
  if (trace === undefined || offset === 0) {
    return trace
  }
  const recorder = trace.recorder
  return Object.freeze({
    view: trace.view,
    recorder: Object.freeze({
      recordInlineCodeExtensionAnalysis: Object.freeze((
        view: ProfileParseTraceViewV1,
        start: number,
        end: number
      ): void => recorder.recordInlineCodeExtensionAnalysis(
        view,
        start + offset,
        end + offset
      )),
      recordInlineCodeCloserQuery: Object.freeze((
        view: ProfileParseTraceViewV1,
        start: number,
        end: number
      ): void => recorder.recordInlineCodeCloserQuery(
        view,
        start + offset,
        end + offset
      )),
      recordInlineCodeCloserCandidate: Object.freeze((
        view: ProfileParseTraceViewV1,
        start: number,
        end: number
      ): void => recorder.recordInlineCodeCloserCandidate(
        view,
        start + offset,
        end + offset
      )),
      recordArmTerminationFenceProbe:
        recorder.recordArmTerminationFenceProbe,
      recordCanonicalSourceAdmission: recorder.recordCanonicalSourceAdmission,
      recordSourceProgression: recorder.recordSourceProgression,
      recordAuthoritativeMarkdownParse:
        recorder.recordAuthoritativeMarkdownParse
    })
  })
}

function markdownBoundaryEditCandidateRange(
  edit: MarkdownArmBoundaryProjectionEdit
): Readonly<{ readonly start: number; readonly end: number }> {
  if (
    edit.kind === 'protect-delimiter' ||
    edit.kind === 'terminate-fenced-block-fragment' ||
    edit.kind === 'separate-following-block'
  ) {
    const indentation = edit.kind === 'separate-following-block'
      ? edit.indentationElision
      : undefined
    return indentation === undefined
      ? Object.freeze({
        start: edit.candidateOffset,
        end: edit.candidateOffset
      })
      : Object.freeze({
        start: Math.min(edit.candidateOffset, indentation.candidateStart),
        end: Math.max(edit.candidateOffset, indentation.candidateEnd)
      })
  }
  if (edit.kind === 'encode-emphasis-flanking-scalar') {
    return Object.freeze({
      start: edit.candidateStart,
      end: edit.candidateEnd
    })
  }
  return Object.freeze({
    start: Math.min(edit.openerStart, edit.closerStart),
    end: Math.max(edit.openerEnd, edit.closerEnd)
  })
}

function rebaseMarkdownBoundaryEdit(
  edit: MarkdownArmBoundaryProjectionEdit,
  offset: number
): MarkdownArmBoundaryProjectionEdit {
  if (edit.kind === 'protect-delimiter') {
    return Object.freeze({
      ...edit,
      candidateOffset: edit.candidateOffset + offset
    })
  }
  if (edit.kind === 'encode-emphasis-flanking-scalar') {
    return Object.freeze({
      ...edit,
      candidateStart: edit.candidateStart + offset,
      candidateEnd: edit.candidateEnd + offset
    })
  }
  if (
    edit.kind === 'respell-enclosing-emphasis-delimiters' ||
    edit.kind === 'extend-inline-code-delimiters'
  ) {
    return Object.freeze({
      ...edit,
      openerStart: edit.openerStart + offset,
      openerEnd: edit.openerEnd + offset,
      closerStart: edit.closerStart + offset,
      closerEnd: edit.closerEnd + offset
    })
  }
  if (edit.kind === 'terminate-fenced-block-fragment') {
    return Object.freeze({
      ...edit,
      candidateOffset: edit.candidateOffset + offset
    })
  }
  return Object.freeze({
    ...edit,
    candidateOffset: edit.candidateOffset + offset,
    ...(edit.indentationElision === undefined
      ? {}
      : {
        indentationElision: Object.freeze({
          ...edit.indentationElision,
          candidateStart:
            edit.indentationElision.candidateStart + offset,
          candidateEnd:
            edit.indentationElision.candidateEnd + offset
        })
      })
  })
}

function localArmTerminationEdits(
  edits: readonly MarkdownArmBoundaryProjectionEdit[],
  regionStart: number,
  regionEnd: number,
  assigned: Set<number>
): readonly MarkdownArmBoundaryProjectionEdit[] {
  const local: MarkdownArmBoundaryProjectionEdit[] = []
  for (let index = 0; index < edits.length; index += 1) {
    if (assigned.has(index)) {
      continue
    }
    const edit = edits[index]
    if (edit === undefined) {
      continue
    }
    const range = markdownBoundaryEditCandidateRange(edit)
    if (range.start < regionStart || range.end > regionEnd) {
      continue
    }
    assigned.add(index)
    local.push(rebaseMarkdownBoundaryEdit(edit, -regionStart))
  }
  return Object.freeze(local)
}

/**
 * One intrinsic Markdown parse that branches over parser-emitted Profile 1
 * alternatives. Each read still accounts its physical source units, while the
 * parse counter records the single grammar admission that owns all forks.
 */
export interface Profile1MarkdownForkParser {
  readonly admitLiteralFacts: (
    forkLane: IntrinsicProfile1ForkLane,
    lane: MappedMarkdownLane,
    containerDepthLimit?: number,
    trace?: Profile1ProjectionPlanningTraceV1
  ) => readonly MarkdownLiteralRange[]
  readonly emitAst: (
    requests: readonly Profile1MarkdownForkAstRequest[]
  ) => Profile1MarkdownForkAst
  readonly planArmBoundaryEdits: (
    forkLane: IntrinsicProfile1ForkLane,
    lane: MappedMarkdownLane,
    containerDepthLimit?: number,
    trace?: Profile1ProjectionPlanningTraceV1
  ) => readonly MarkdownArmBoundaryProjectionEdit[]
}

export interface Profile1MarkdownForkAstRequest {
  readonly key: string
  readonly role: string
  readonly forkLane: IntrinsicProfile1ForkLane
  readonly lane: MappedMarkdownLane
}

export interface Profile1MarkdownForkAst {
  readonly read: (key: string) => Profile1MarkdownParse
}

export interface Profile1MarkdownReuseCache {
  readonly astRegions: MarkdownAstRegionCacheIdentity
  readonly admittedRegionFacts: Map<string, PlainMarkdownLaneParse>
}

export function createProfile1MarkdownReuseCache():
Profile1MarkdownReuseCache {
  const astRegions = {}
  const admittedRegionFacts = new Map<string, PlainMarkdownLaneParse>()
  const budget = createRetainedFragmentBudget()
  registerRetainedFragmentCache(astRegions, budget)
  registerRetainedFragmentCache(admittedRegionFacts, budget)
  return { astRegions, admittedRegionFacts }
}

export function profile1MarkdownReuseRetentionV1(
  reuseCache: Profile1MarkdownReuseCache
): Profile1MarkdownReuseRetentionV1 {
  const ast = fragmentMapRetention(
    astRegionCaches.get(reuseCache.astRegions) ?? new Map()
  )
  const admitted = fragmentMapRetention(reuseCache.admittedRegionFacts)
  const entries = ast.entries + admitted.entries
  const keyBytes = ast.keyBytes + admitted.keyBytes
  const valueBytes = ast.valueBytes + admitted.valueBytes
  const overheadBytes = entries * RETAINED_CACHE_ENTRY_BYTES
  return Object.freeze({
    entries,
    keyBytes,
    valueBytes,
    overheadBytes,
    retainedBytes: keyBytes + valueBytes + overheadBytes,
    maximumRetainedBytes: PROFILE1_MARKDOWN_REUSE_MAX_RETAINED_BYTES_V1
  })
}

export function createProfile1MarkdownForkParser(
  forkGraph: IntrinsicProfile1ForkGraph,
  canonicalReferenceDefinitions: Profile1CanonicalReferenceDefinitionLookup,
  execution: ParseExecutionTracker,
  reuseCache: Profile1MarkdownReuseCache =
  createProfile1MarkdownReuseCache()
): Profile1MarkdownForkParser {
  const emittedRegionCache = reuseCache.astRegions
  const admittedRegionFactsCache = reuseCache.admittedRegionFacts
  const canonicalFactIndex = createIntrinsicCanonicalFactIndex(forkGraph)
  const requireForkLane = (lane: IntrinsicProfile1ForkLane): void => {
    if (forkGraph.lanes[lane.id] !== lane) {
      throw new Error('Markdown fork read is detached from the intrinsic parser graph')
    }
  }
  const requireMappedForkRead = (lane: MappedMarkdownLane): void => {
    if (lane.canonicalIdentityRuns === undefined) {
      throw new Error('Markdown fork read has no canonical source identity')
    }
  }
  return Object.freeze({
    admitLiteralFacts: Object.freeze((
      forkLane: IntrinsicProfile1ForkLane,
      lane: MappedMarkdownLane,
      containerDepthLimit: number = Number.POSITIVE_INFINITY,
      trace?: Profile1ProjectionPlanningTraceV1
    ): readonly MarkdownLiteralRange[] => {
      requireForkLane(forkLane)
      requireMappedForkRead(lane)
      const selectionReferenceDefinitions =
        projectedReferenceDefinitionsFromCanonicalFacts(
          canonicalReferenceDefinitions,
          validatedCanonicalIdentityRuns(
            lane.source.length,
            lane.canonicalIdentityRuns
          )
        )
      const literals: MarkdownLiteralRange[] = []
      for (const region of intrinsicForkRegionLanes(forkLane, lane)) {
        const emitted = parseIntrinsicForkRegionFacts(
          canonicalFactIndex,
          region.lane,
          selectionReferenceDefinitions,
          region.start,
          containerDepthLimit,
          admittedRegionFactsCache,
          projectionPlanningTraceAt(trace, region.start)
        )
        literals.push(...emitted.facts.literals.map(
          (literal): MarkdownLiteralRange => Object.freeze({
            ...literal,
            start: literal.start + region.start,
            end: literal.end + region.start,
            ...(literal.construct === undefined
              ? {}
              : {
                construct: Object.freeze({
                  ...literal.construct,
                  start: literal.construct.start + region.start,
                  labelStart: literal.construct.labelStart + region.start,
                  labelEnd: literal.construct.labelEnd + region.start
                })
              })
          })
        ))
      }
      return composeMarkdownLiteralRanges(literals)
    }),
    emitAst: Object.freeze((
      requests: readonly Profile1MarkdownForkAstRequest[]
    ): Profile1MarkdownForkAst => {
      const requestByKey = new Map<string, Profile1MarkdownForkAstRequest>()
      for (const request of requests) {
        if (requestByKey.has(request.key)) {
          throw new Error(`Markdown fork AST key is duplicated: ${request.key}`)
        }
        requireForkLane(request.forkLane)
        requireMappedForkRead(request.lane)
        requestByKey.set(request.key, request)
      }

      const parseByKey = new Map<string, Profile1MarkdownParse>()
      const emitRequest = (
        request: Profile1MarkdownForkAstRequest
      ): Profile1MarkdownParse => {
        const children: MarkdownNode[] = []
        let depthFailure: MarkdownContainerDepthFailure | undefined
        const selectionReferenceDefinitions =
          projectedReferenceDefinitionsFromCanonicalFacts(
            canonicalReferenceDefinitions,
            validatedCanonicalIdentityRuns(
              request.lane.source.length,
              request.lane.canonicalIdentityRuns
            )
          )
        for (const region of intrinsicForkRegionLanes(
          request.forkLane,
          request.lane
        )) {
          const emitted = parseIntrinsicForkRegionFacts(
            canonicalFactIndex,
            region.lane,
            selectionReferenceDefinitions,
            region.start,
            Number.POSITIVE_INFINITY,
            admittedRegionFactsCache
          )
          const localNodes = emitIntrinsicForkRegionNodes(
            region.lane,
            emitted.facts,
            emittedRegionCache,
            emitted.boundaryPolicy,
            execution
          )
          children.push(...materializeIntrinsicForkRegionNodes(
            request.lane,
            localNodes,
            region.start
          ))
          const localFailure = emitted.facts.containerDepthFailure
          if (localFailure !== undefined) {
            const candidate = Object.freeze({
              start: localFailure.start + region.start,
              end: localFailure.end + region.start,
              observed: localFailure.observed
            })
            if (
              depthFailure === undefined ||
              candidate.start < depthFailure.start ||
              (
                candidate.start === depthFailure.start &&
                candidate.end < depthFailure.end
              )
            ) {
              depthFailure = candidate
            }
          }
        }
        const parsed = intrinsicForkDocumentFromNodes(
          request.lane,
          Object.freeze(children),
          depthFailure,
          execution
        )
        parseByKey.set(request.key, parsed)
        const registry = request.lane.syntaxIdentity?.registry
        if (registry === undefined) {
          throw new Error('Markdown fork AST emission has no syntax registry')
        }
        registry.emitEdge(
          'fork-alternative',
          registry.root,
          parsed.document.root.nodeId,
          request.role
        )
        return parsed
      }
      for (const request of requestByKey.values()) {
        emitRequest(request)
      }
      return Object.freeze({
        read: Object.freeze((key: string): Profile1MarkdownParse => {
          const parsed = parseByKey.get(key)
          if (parsed !== undefined) {
            return parsed
          }
          throw new RangeError(`Markdown fork AST has no selection: ${key}`)
        })
      })
    }),
    planArmBoundaryEdits: Object.freeze((
      forkLane: IntrinsicProfile1ForkLane,
      lane: MappedMarkdownLane,
      containerDepthLimit: number = Number.POSITIVE_INFINITY,
      trace?: Profile1ProjectionPlanningTraceV1
    ): readonly MarkdownArmBoundaryProjectionEdit[] => {
      requireForkLane(forkLane)
      requireMappedForkRead(lane)
      const planningIdentity = lane.syntaxIdentity ?? Object.freeze({
        registry: createProfile1SyntaxIdentityRegistry(lane.source.length),
        sourceAt: Object.freeze((
          start: number,
          end: number
        ): SyntaxSourceIdentity => Object.freeze({
          key: `fork-boundary:${String(start)}:${String(end)}`,
          range: Object.freeze({
            start: start as SourceOffset,
            end: end as SourceOffset
          })
        }))
      })
      const planningLane = Object.freeze({
        ...lane,
        syntaxIdentity: planningIdentity
      })
      const assignedTerminationEdits = new Set<number>()
      const planned: MarkdownArmBoundaryProjectionEdit[] = []
      const selectionReferenceDefinitions =
        projectedReferenceDefinitionsFromCanonicalFacts(
          canonicalReferenceDefinitions,
          validatedCanonicalIdentityRuns(
            planningLane.source.length,
            planningLane.canonicalIdentityRuns
          )
        )
      for (const region of intrinsicForkRegionLanes(forkLane, planningLane)) {
        const regionTrace = projectionPlanningTraceAt(trace, region.start)
        const terminationEdits = localArmTerminationEdits(
          lane.armTerminationEdits ?? Object.freeze([]),
          region.start,
          region.end,
          assignedTerminationEdits
        )
        const localLane = Object.freeze({
          ...region.lane,
          armTerminationEdits: terminationEdits
        })
        const emitted = parseIntrinsicForkRegionFacts(
          canonicalFactIndex,
          localLane,
          selectionReferenceDefinitions,
          region.start,
          containerDepthLimit,
          admittedRegionFactsCache,
          regionTrace
        )
        emitIntrinsicForkRegionNodes(
          localLane,
          emitted.facts,
          emittedRegionCache,
          emitted.boundaryPolicy,
          execution
        )
        const localEdits = planBoundaryProjectionEdits(
          localLane.source,
          mappedLiteralsFromFacts(emitted.facts),
          validatedCanonicalIdentityRuns(
            localLane.source.length,
            localLane.canonicalIdentityRuns
          ),
          emitted.boundaryPolicy,
          emitted.boundaryPolicy?.unsafeDelimiterOffsets ??
            new Set<number>(),
          emitted.boundaryPolicy?.enclosingEmphasisRespellings ??
            new Map(),
          terminationEdits,
          regionTrace
        )
        planned.push(...localEdits.map((edit) =>
          rebaseMarkdownBoundaryEdit(edit, region.start)))
      }
      if (
        assignedTerminationEdits.size !==
        (lane.armTerminationEdits?.length ?? 0)
      ) {
        throw new Error(
          'Intrinsic fork region lost an arm-termination projection edit'
        )
      }
      return Object.freeze(planned)
    })
  })
}

export function __markdownParsedUnitsV1(): number {
  const physical = __profile1PhysicalTraversalCountsV1()
  return physical.intrinsicSourceUnits +
    __plainMarkdownLaneUnitsV1()
}
