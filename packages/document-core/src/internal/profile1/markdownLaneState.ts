import { frontMatterPolicy, type FrontMatterPolicy } from '@marktext/input-policy'
import {
  composeMarkdownLiteralRanges,
  type MarkdownContainerDepthFailure,
  type MarkdownLiteralRange,
  type MarkdownMathForm
} from './markdownTypes.js'
import {
  findAutolinkEnd,
  findGfmExtendedAutolink,
  findInlineHtmlEnd,
  findInlineLinkDestinationEnd,
  hasEvenBackslashRunBefore
} from './markdownLexical.js'
import {
  findMarkdownFenceOpening,
  isMarkdownFenceCloser
} from './markdownFence.js'
import {
  PARSE_SOURCE_CHECKPOINT_INTERVAL,
  type ParseExecutionTracker
} from '../../parseExecutionControl.js'
import type {
  Profile1PhysicalTraversalRecorderV1
} from './physicalTraversalAccounting.js'

interface MarkdownLinePath {
  readonly parent: MarkdownLinePath | undefined
  readonly text: string
  readonly sourceStart: number
  /**
   * The physical record of the lane that built this path, captured so a
   * lazy prefix materialization still attributes its walk to the owning
   * engine.
   */
  readonly recorder?: Profile1PhysicalTraversalRecorderV1
}

interface MarkdownBlockContainer {
  readonly path: readonly ActiveBlockContainer[]
}

interface MarkdownInlineCodeState {
  readonly openStart: number
  readonly markerLength: number
  readonly closeStart: number
}

interface MarkdownMathState {
  readonly openStart: number
  readonly delimiterLength: number
  readonly closeStart: number
  /** The opener is a line of its own `$$`: a math block, which spans blank lines. */
  readonly block?: true
  /** Non-dollar delimiters; they read as inline spans like a lone `$`. */
  readonly form?: MarkdownMathForm
}

interface MarkdownFenceState {
  readonly openStart: number
  readonly openLineStart: number
  readonly markerCodeUnit: number
  readonly openerLength: number
  readonly provider: 'fenced-code' | 'math' | 'diagram'
  readonly container: MarkdownBlockContainer
}

interface MarkdownFrontMatterState {
  readonly openStart: number
  readonly openLineStart: number
  readonly style: FrontMatterPolicy['style']
}

interface MarkdownIndentedCodeState {
  readonly openStart: number
  readonly openLineStart: number
  readonly lastCodeEnd: number
  readonly container: MarkdownBlockContainer
}

interface MarkdownHtmlBlockState {
  readonly openStart: number
  readonly openLineStart: number
  readonly terminator: string | undefined
  readonly lastOwnedEnd: number
  readonly container: MarkdownBlockContainer
}

interface MarkdownDefinitionState {
  readonly openStart: number
  readonly lastOwnedEnd: number
  readonly lineStart: number
  readonly phase:
    | 'reference-label'
    | 'reference-destination'
    | 'reference'
    | 'reference-title'
    | 'reference-title-open'
    | 'footnote'
  /** Close delimiter of a title still open across lines. */
  readonly titleCloseCodeUnit?: number | undefined
  /**
   * A footnote body is paragraph text; only its `[^label]:` owns markers.
   * Source offset just after that colon, present until the lane passes it.
   */
  readonly footnoteBodyStart?: number | undefined
}

type MarkdownDefinitionStep = Readonly<{
  phase: MarkdownDefinitionState['phase']
  titleCloseCodeUnit?: number | undefined
  /** Probe-line offset just after a footnote label's colon. */
  footnoteBodyOffset?: number | undefined
}>

/** Markers in a definition are data, except in a footnote's body. */
function definitionOwnsMarkers(definition: MarkdownDefinitionState): boolean {
  return definition.phase === 'footnote'
    ? definition.footnoteBodyStart !== undefined
    : definition.phase !== 'reference-label'
}

/** Phases whose state, if the definition ends there, yields a real literal.
 * A definition abandoned mid-label, awaiting its destination, or inside an
 * unclosed title never existed — its lines revert to paragraph text. */
function definitionPhaseComplete(
  phase: MarkdownDefinitionState['phase']
): boolean {
  return phase === 'reference' ||
    phase === 'reference-title' ||
    phase === 'footnote'
}

interface MarkdownBracketPath {
  readonly parent: MarkdownBracketPath | undefined
  readonly kind: 'link' | 'image'
  /** Source identity of the actual `[` matching delimiter. */
  readonly bracketStart: number
  /** Source identity of the whole construct (`!` for images, `[` for links). */
  readonly start: number
  readonly labelStart: number
  readonly matchingScopeId: number
  readonly matchingScopeDepth: number
}

interface MarkdownPendingLinkLabel {
  readonly kind: 'link' | 'image'
  readonly bracketStart: number
  readonly start: number
  readonly labelStart: number
  readonly labelEnd: number
  readonly normalizedLabel: string
  readonly matchingScopeId: number
  readonly matchingScopeDepth: number
  readonly parentBracketPath: MarkdownBracketPath | undefined
}

interface MarkdownFixedInlineState {
  readonly kind: 'link-destination' | 'inline-html' | 'autolink'
  readonly openStart: number
  readonly closeEnd: number
  readonly extendedAutolink?: true
  readonly linkLabel?: MarkdownPendingLinkLabel
}

interface MarkdownPendingCarriageReturn {
  readonly sourceStart: number
  readonly sourceEnd: number
}

export interface MarkdownCheckpoint {
  readonly linePath: MarkdownLinePath | undefined
  readonly inlineCode: MarkdownInlineCodeState | undefined
  readonly math: MarkdownMathState | undefined
  readonly bracketPath: MarkdownBracketPath | undefined
  readonly pendingLinkLabel: MarkdownPendingLinkLabel | undefined
  readonly fixedInline: MarkdownFixedInlineState | undefined
  /** End of an angle-delimited text region that cannot own a GFM autolink. */
  readonly extendedAutolinkSuppressedUntil?: number | undefined
  /** End of a math literal the current line started inside, whose text the line is up to there. */
  readonly mathOwnedUntil?: number | undefined
  readonly activeContainers: readonly ActiveBlockContainer[]
  /**
   * The containers the pending line entered with, kept once a block opened
   * earlier on that line has bound `activeContainers` to the line's own
   * markers. The line's record is read against these, so a marker the line
   * opened is not taken for one it continued.
   */
  readonly lineEntryContainers?: readonly ActiveBlockContainer[] | undefined
  readonly paragraphOpen: boolean
  /**
   * The last line belonged to a reference definition. No paragraph is open,
   * but a lazy line may still continue the definition's containers, as it
   * would continue the paragraph CommonMark reads the definition from.
   */
  readonly definitionLazyContinuation?: boolean | undefined
  /**
   * By depth of `activeContainers`, whether that list item has held a list:
   * once it has, its later paragraphs read list markers as CommonMark does.
   */
  readonly listItemsHoldingLists?: readonly boolean[] | undefined
  /** A GFM table is open, so the next line of its containers may be a row. */
  readonly tableOpen?: boolean | undefined
  /**
   * The cell count of the last line when it was paragraph text, which a
   * delimiter row with as many cells turns into a table's header row.
   */
  readonly tableHeaderCells?: number | undefined
  readonly lastLineLazy: boolean
  readonly lineStart: number
  readonly fence: MarkdownFenceState | undefined
  readonly lineBlockClosed: boolean
  readonly trailingBackslashOdd: boolean
  readonly frontMatterEligible: boolean
  readonly frontMatter: MarkdownFrontMatterState | undefined
  readonly indentedCode: MarkdownIndentedCodeState | undefined
  readonly htmlBlock: MarkdownHtmlBlockState | undefined
  readonly definition: MarkdownDefinitionState | undefined
  readonly pendingCarriageReturn: MarkdownPendingCarriageReturn | undefined
  readonly firstContainerDepthFailure: MarkdownContainerDepthFailure | undefined
  readonly enclosingLabelInterrupted: boolean
  readonly atVirtualBof: boolean
}

export interface MarkdownLaneAdvance {
  readonly checkpoint: MarkdownCheckpoint
  readonly completedLiterals: readonly MarkdownLiteralRange[]
  readonly completedLines?: readonly PlainMarkdownLine[]
}

export interface MarkdownPendingLineBlockFact {
  /** No content remains after the line's owned container prefixes. */
  readonly blank: boolean
  /** Indentation remaining after the line's owned container prefixes. */
  readonly indentation: number
  readonly paragraphOpen: boolean
  readonly continuesExistingParagraph: boolean
  readonly containerPath: readonly ('blockquote' | 'list-item')[]
  readonly containers: readonly MarkdownPendingLineContainerFact[]
  /** Canonical ranges of new container markers present on this pending line. */
  readonly containerOpeners: readonly Readonly<{ start: number; end: number }>[]
  readonly listContinuationIndentations:
  readonly MarkdownPendingListContinuationIndentationFact[]
}

export type MarkdownPendingLineContainerFact =
  | Readonly<{ readonly kind: 'blockquote' }>
  | Readonly<{
    readonly kind: 'list-item'
    readonly contentIndent: number
  }>

export interface MarkdownPendingListContinuationIndentationFact {
  /** One-based position of the continued list item in the container path. */
  readonly containerDepth: number
  readonly contentIndent: number
  /** Exact canonical whitespace consumed to continue this list item. */
  readonly trivia: Readonly<{ readonly start: number; readonly end: number }>
  /** Smallest trailing part of `trivia` whose removal exits this list item. */
  readonly exitTrivia: Readonly<{ readonly start: number; readonly end: number }>
}

export type MarkdownArmMode =
  | 'continuous'
  | 'self-contained'
  | 'isolated'

/**
 * Re-base every coordinate a checkpoint carries by a fixed delta — the
 * marker-bearing G32 splice re-uses retained lane state on both sides of an
 * edit bracket. Coordinate knowledge stays in this module: each member's
 * offsets are enumerated here beside their declarations, and a member added
 * without a shift arm fails the exhaustive spread review below, not a
 * consumer downstream.
 */
export function shiftMarkdownCheckpoint(
  checkpoint: MarkdownCheckpoint,
  delta: number
): MarkdownCheckpoint {
  if (delta === 0) return checkpoint
  const shiftLinePath = (
    path: MarkdownLinePath | undefined
  ): MarkdownLinePath | undefined =>
    path === undefined
      ? undefined
      : Object.freeze({
        ...path,
        parent: shiftLinePath(path.parent),
        sourceStart: path.sourceStart + delta
      })
  const shiftBracketPath = (
    path: MarkdownBracketPath | undefined
  ): MarkdownBracketPath | undefined =>
    path === undefined
      ? undefined
      : Object.freeze({
        ...path,
        parent: shiftBracketPath(path.parent),
        bracketStart: path.bracketStart + delta,
        start: path.start + delta,
        labelStart: path.labelStart + delta
      })
  const shiftPendingLabel = (
    label: MarkdownPendingLinkLabel | undefined
  ): MarkdownPendingLinkLabel | undefined =>
    label === undefined
      ? undefined
      : Object.freeze({
        ...label,
        bracketStart: label.bracketStart + delta,
        start: label.start + delta,
        labelStart: label.labelStart + delta,
        labelEnd: label.labelEnd + delta,
        parentBracketPath: shiftBracketPath(label.parentBracketPath)
      })
  return Object.freeze({
    ...checkpoint,
    lineStart: checkpoint.lineStart + delta,
    linePath: shiftLinePath(checkpoint.linePath),
    inlineCode: checkpoint.inlineCode === undefined
      ? undefined
      : Object.freeze({
        ...checkpoint.inlineCode,
        openStart: checkpoint.inlineCode.openStart + delta,
        closeStart: checkpoint.inlineCode.closeStart + delta
      }),
    math: checkpoint.math === undefined
      ? undefined
      : Object.freeze({
        ...checkpoint.math,
        openStart: checkpoint.math.openStart + delta,
        closeStart: checkpoint.math.closeStart + delta
      }),
    mathOwnedUntil: checkpoint.mathOwnedUntil === undefined ? undefined : checkpoint.mathOwnedUntil + delta,
    bracketPath: shiftBracketPath(checkpoint.bracketPath),
    pendingLinkLabel: shiftPendingLabel(checkpoint.pendingLinkLabel),
    fixedInline: checkpoint.fixedInline === undefined
      ? undefined
      : Object.freeze({
        ...checkpoint.fixedInline,
        openStart: checkpoint.fixedInline.openStart + delta,
        closeEnd: checkpoint.fixedInline.closeEnd + delta,
        ...(checkpoint.fixedInline.linkLabel === undefined
          ? {}
          : {
            linkLabel: shiftPendingLabel(
              checkpoint.fixedInline.linkLabel
            ) as MarkdownPendingLinkLabel
          })
      }),
    fence: checkpoint.fence === undefined
      ? undefined
      : Object.freeze({
        ...checkpoint.fence,
        openStart: checkpoint.fence.openStart + delta,
        openLineStart: checkpoint.fence.openLineStart + delta
      }),
    frontMatter: checkpoint.frontMatter === undefined
      ? undefined
      : Object.freeze({
        ...checkpoint.frontMatter,
        openStart: checkpoint.frontMatter.openStart + delta,
        openLineStart: checkpoint.frontMatter.openLineStart + delta
      }),
    indentedCode: checkpoint.indentedCode === undefined
      ? undefined
      : Object.freeze({
        ...checkpoint.indentedCode,
        openStart: checkpoint.indentedCode.openStart + delta,
        openLineStart: checkpoint.indentedCode.openLineStart + delta,
        lastCodeEnd: checkpoint.indentedCode.lastCodeEnd + delta
      }),
    htmlBlock: checkpoint.htmlBlock === undefined
      ? undefined
      : Object.freeze({
        ...checkpoint.htmlBlock,
        openStart: checkpoint.htmlBlock.openStart + delta,
        openLineStart: checkpoint.htmlBlock.openLineStart + delta,
        lastOwnedEnd: checkpoint.htmlBlock.lastOwnedEnd + delta
      }),
    definition: checkpoint.definition === undefined
      ? undefined
      : Object.freeze({
        ...checkpoint.definition,
        openStart: checkpoint.definition.openStart + delta,
        lastOwnedEnd: checkpoint.definition.lastOwnedEnd + delta,
        lineStart: checkpoint.definition.lineStart + delta,
        footnoteBodyStart: checkpoint.definition.footnoteBodyStart === undefined
          ? undefined
          : checkpoint.definition.footnoteBodyStart + delta
      }),
    pendingCarriageReturn: checkpoint.pendingCarriageReturn === undefined
      ? undefined
      : Object.freeze({
        sourceStart: checkpoint.pendingCarriageReturn.sourceStart + delta,
        sourceEnd: checkpoint.pendingCarriageReturn.sourceEnd + delta
      }),
    firstContainerDepthFailure:
      checkpoint.firstContainerDepthFailure === undefined
        ? undefined
        : Object.freeze({
          ...checkpoint.firstContainerDepthFailure,
          start: checkpoint.firstContainerDepthFailure.start + delta,
          end: checkpoint.firstContainerDepthFailure.end + delta
        })
  })
}

export interface MarkdownLaneState {
  readonly emptyCheckpoint: MarkdownCheckpoint
  readonly advance: (
    checkpoint: MarkdownCheckpoint,
    sourceStart: number,
    sourceEnd: number,
    laneStart: number,
    laneEnd: number,
    boundaryEnd: number
  ) => MarkdownLaneAdvance
  readonly enterArm: (
    checkpoint: MarkdownCheckpoint,
    sourceStart: number,
    mode: MarkdownArmMode
  ) => MarkdownCheckpoint
  readonly markerIsProtected: (checkpoint: MarkdownCheckpoint) => boolean
  readonly markerIsLiteralOwned: (checkpoint: MarkdownCheckpoint) => boolean
  /**
   * Unfinished inline code, inline math and bare autolinks yield to their
   * owning annotation's compatible closer (Profile rule L2a). Completed
   * literal owners, including `$$` math blocks, still win.
   */
  readonly compatibleCloserStandsAgainstLiteral: (
    checkpoint: MarkdownCheckpoint
  ) => boolean
  /**
   * Profile rule L2c: an arm boundary token that begins its line, directly
   * after the container prefix the open literal continues, stands against a
   * block literal (or multi-line `$$` math) opened at or after `armStart`.
   * The caller decides that the token is the innermost annotation's boundary.
   */
  readonly lineStartBoundaryStandsAgainstLiteral: (
    checkpoint: MarkdownCheckpoint,
    markerOffset: number,
    armStart: number
  ) => boolean
  /**
   * Profile rule L2b: an arm boundary stands against a reference definition
   * opened at or after `armStart` whose destination or title would reach the
   * boundary. Returns the checkpoint with that definition re-read as the
   * arm-local fragment ending at the boundary (dropped when that fragment is
   * no complete definition), or undefined when the rule does not apply.
   */
  readonly releaseDefinitionAtBoundary: (
    checkpoint: MarkdownCheckpoint,
    markerOffset: number,
    armStart: number
  ) => MarkdownCheckpoint | undefined
  readonly finishArm: (
    continuation: MarkdownCheckpoint,
    armEnd: MarkdownCheckpoint,
    mode: MarkdownArmMode,
    payloadIntervened: boolean,
    enclosingLabelPreservedByAllArms: boolean,
    atDocumentRoot: boolean
  ) => MarkdownCheckpoint
  /**
   * Ends the lane at `boundary`. An annotation closer that stands ends its
   * arm (`endsArm`): inline code or math opened in the arm and left pending
   * past it recovers as text there (Profile rules L2a, L2c, C1) rather than
   * carrying on to its lookahead closer beyond the annotation.
   */
  readonly finishLane: (
    checkpoint: MarkdownCheckpoint,
    boundary: number,
    endsArm?: boolean
  ) => MarkdownLaneAdvance
  readonly releaseAtBoundary: (
    checkpoint: MarkdownCheckpoint,
    boundary: number
  ) => MarkdownLaneAdvance
  readonly prepareForMarker: (
    checkpoint: MarkdownCheckpoint,
    markerOffset: number,
    laneEnd: number
  ) => MarkdownLaneAdvance
  readonly containerDepthFailure: (
    checkpoint: MarkdownCheckpoint
  ) => MarkdownContainerDepthFailure | undefined
}

export interface MarkdownReferenceDefinitionLookup {
  /** Stable resolution-shape key used only to share already-emitted AST regions. */
  readonly cacheKey?: string
  readonly has: (
    normalizedLabel: string,
    sourceOffset: number
  ) => boolean
  readonly hasAny?: (normalizedLabel: string) => boolean
  readonly definitionStart?: (
    normalizedLabel: string,
    sourceOffset: number
  ) => number | undefined
  /**
   * Reject a standing Profile 1 scope candidate when the intrinsic Markdown
   * lane proves that its opener belongs to an unconditional literal owner.
   * The scoped definition lookup and the grammar share the opener's canonical
   * source identity; no second topology is reconstructed from accepted nodes.
   */
  readonly rejectDelimiterCandidate?: (candidateStart: number) => void
}

export interface PlainMarkdownLaneParse {
  readonly literals: readonly MarkdownLiteralRange[]
  readonly containerDepthFailure: MarkdownContainerDepthFailure | undefined
  // Immutable absolute-offset facts emitted by lane progression and consumed
  // by intrinsic AST admission. Keep them inside internal/profile1 so
  // positional representations do not leak into public consumers.
  readonly lines: readonly PlainMarkdownLine[]
}

/**
 * A completed lane parse plus the reference-definition index built from its
 * final literals. The block/literal phase already has to build this index to
 * resolve links; carrying it forward lets the inline phase consume it instead
 * of rebuilding an identical one from the same literals.
 */
export interface PlainMarkdownLaneParseWithDefinitions
  extends PlainMarkdownLaneParse {
  readonly referenceDefinitions: MarkdownReferenceDefinitionLookup
}

export interface PlainMarkdownLine {
  readonly listContinuationIndentations: readonly ListContinuationIndentationState[]
  readonly start: number
  readonly contentEnd: number
  readonly end: number
  readonly blank: boolean
  /** True when the line continues a paragraph lazily (no container match). */
  readonly lazy: boolean
  readonly contentOffset: number
  readonly indentation: number
  readonly blockQuoteDepth: number
  readonly listDepth: number
  readonly listMarkers: readonly PlainMarkdownListMarker[]
  /** Parser-owned outermost-to-innermost block-container path for this line. */
  readonly containers: readonly PlainMarkdownContainer[]
}

export type PlainMarkdownContainer =
  | Readonly<{
    readonly kind: 'blockquote'
    readonly markerRange?: Readonly<{ start: number, end: number }>
    readonly continued: boolean
    readonly start: number
    readonly end: number
  }>
  | Readonly<{
    readonly kind: 'list-item'
    readonly continued: boolean
    readonly start: number
    readonly end: number
    readonly ordered: boolean
    readonly startNumber: number
    readonly delimiterCodeUnit: number
    readonly contentOffset: number
  }>

export interface PlainMarkdownListMarker {
  readonly start: number
  readonly end: number
  readonly ordered: boolean
  readonly startNumber: number
  readonly contentOffset: number
}

type NextBacktickRunStart = (
  markerLength: number,
  openerStart: number,
  after: number,
  laneEnd: number
) => number | undefined

export interface MarkdownMatchingScopePolicy {
  /** End of contiguous canonical spelling; elided arm markers cannot join a run. */
  readonly delimiterRunLimit?: (start: number, ceiling: number) => number
  readonly matchingScopeAt: (
    offset: number
  ) => Readonly<{ readonly id: number; readonly depth: number }> | undefined
  readonly rejectCrossScopeMatch: (
    openerStart: number,
    closerStart: number
  ) => number | undefined
  // Planning-linearity instrumentation for the scope-aware inline-code closer
  // lookup: one query per lookup request, one candidate per indexed probe.
  // The R-4 gate asserts both stay linear in the number of backtick runs.
  readonly recordInlineCodeCloserQuery?: (start: number, end: number) => void
  readonly recordInlineCodeCloserCandidate?: (
    start: number,
    end: number
  ) => void
  readonly rejectCrossScopeImageOpener: (
    bangStart: number,
    bracketStart: number
  ) => void
  readonly definitionCanResolveReference: (
    definitionStart: number,
    referenceStart: number
  ) => boolean
}

type NextMathRunStart = (
  delimiterLength: number,
  openerStart: number,
  after: number,
  laneEnd: number,
  reaches?: (closeStart: number) => boolean
) => number | undefined

const EMPTY_MARKDOWN_CHECKPOINT: MarkdownCheckpoint = Object.freeze({
  linePath: undefined,
  inlineCode: undefined,
  math: undefined,
  bracketPath: undefined,
  pendingLinkLabel: undefined,
  fixedInline: undefined,
  activeContainers: Object.freeze([]),
  paragraphOpen: false,
  lastLineLazy: false,
  lineStart: 0,
  fence: undefined,
  lineBlockClosed: false,
  trailingBackslashOdd: false,
  frontMatterEligible: true,
  frontMatter: undefined,
  indentedCode: undefined,
  htmlBlock: undefined,
  definition: undefined,
  pendingCarriageReturn: undefined,
  firstContainerDepthFailure: undefined,
  enclosingLabelInterrupted: false,
  atVirtualBof: true
})

const EMPTY_REFERENCE_DEFINITIONS: MarkdownReferenceDefinitionLookup =
  Object.freeze({
    has: Object.freeze((): boolean => false)
  })

const FULL_PREFIX_CACHE_MAX_SOURCE_UNITS = 65_536
const MAX_LONG_LINE_MATERIALIZATIONS = 4
const shortMaterializedLinePaths = new WeakMap<MarkdownLinePath, string>()
const longMaterializedLinePaths = new Map<MarkdownLinePath, string>()

function cachedMaterializedLinePath(
  path: MarkdownLinePath
): string | undefined {
  const short = shortMaterializedLinePaths.get(path)
  if (short !== undefined) {
    return short
  }
  const cached = longMaterializedLinePaths.get(path)
  if (cached !== undefined) {
    longMaterializedLinePaths.delete(path)
    longMaterializedLinePaths.set(path, cached)
  }
  return cached
}

function retainMaterializedLinePath(
  path: MarkdownLinePath,
  source: string
): void {
  if (source.length <= FULL_PREFIX_CACHE_MAX_SOURCE_UNITS) {
    shortMaterializedLinePaths.set(path, source)
    return
  }
  longMaterializedLinePaths.delete(path)
  longMaterializedLinePaths.set(path, source)
  path.recorder?.recordLongLineMaterializationRetained()
  while (
    longMaterializedLinePaths.size > MAX_LONG_LINE_MATERIALIZATIONS
  ) {
    const oldest = longMaterializedLinePaths.keys().next().value
    if (oldest === undefined) {
      break
    }
    longMaterializedLinePaths.delete(oldest)
    path.recorder?.recordLongLineMaterializationEvicted()
  }
}

interface SourceLine {
  readonly start: number
  readonly contentEnd: number
  readonly end: number
}

interface ActiveBlockquoteContainer {
  readonly kind: 'blockquote'
}

interface ActiveListContainer {
  readonly kind: 'list-item'
  /** CommonMark marker indent + W + N relative to the containing block. */
  readonly contentIndent: number
  /** Item opened on a blank line and has not yet seen content: one more
   * blank line closes it (CommonMark: at most one leading blank line). */
  readonly awaitingContent: boolean
  readonly ordered: boolean
  readonly startNumber: number
  readonly delimiterCodeUnit: number
}

type ActiveBlockContainer = ActiveBlockquoteContainer | ActiveListContainer

interface ListMarker {
  readonly start: number
  readonly end: number
  readonly ordered: boolean
  readonly startNumber: number
  readonly delimiterCodeUnit: number
}

interface ContainerLineState {
  readonly blockquoteMarkers: readonly Readonly<{ depth: number, start: number, end: number }>[]
  readonly activeContainers: readonly ActiveBlockContainer[]
  readonly continuedContainerDepth: number
  readonly listContinuationIndentations:
  readonly ListContinuationIndentationState[]
  readonly blockQuoteDepth: number
  readonly blank: boolean
  readonly indentation: number
  readonly contentOffset: number
  /** End of THIS line's content — construct checks must never scan past it. */
  readonly lineContentEnd: number
  readonly containerBaseColumn: number
  readonly openers: readonly MarkdownContainerOpener[]
  readonly lazy: boolean
  /** The line underlines the open paragraph, turning it into a setext heading. */
  readonly setextUnderline: boolean
  /**
   * The open paragraph is still the innermost block on this line, so blocks
   * that cannot interrupt a paragraph cannot start here.
   */
  readonly paragraphContinues: boolean
  /**
   * A GFM table's row may continue here: the table is open and the line is
   * one of its containers' (or lazily kept in them). Such a line starts no
   * block that cannot interrupt a paragraph, except indented code.
   */
  readonly tableRowContinues: boolean
  /**
   * The line's indentation as upstream measures a lazy line: inside the
   * block quotes it lazily continues, against the content column of each
   * list item there that it reaches. Equal to `indentation` otherwise.
   */
  readonly lazyIndentation: number
}

interface ListContinuationIndentationState {
  readonly containerDepth: number
  readonly contentIndent: number
  readonly triviaStart: number
  readonly triviaEnd: number
  readonly exitTriviaStart: number
  readonly exitTriviaEnd: number
}

interface MarkdownContainerOpener {
  readonly kind: 'blockquote' | 'list-item'
  readonly start: number
  readonly end: number
  readonly observed: number
  readonly ordered?: boolean
  readonly startNumber?: number
  readonly delimiterCodeUnit?: number
  readonly contentOffset?: number
}

function isSpaceOrTab(codeUnit: number): boolean {
  return codeUnit === 32 || codeUnit === 9
}

export { advanceColumn as advanceMarkdownColumn }

function advanceColumn(column: number, codeUnit: number): number {
  return codeUnit === 9 ? column + (4 - (column % 4)) : column + 1
}

function isBlankFrom(source: string, start: number, end: number): boolean {
  for (let offset = start; offset < end; offset += 1) {
    if (!isSpaceOrTab(source.charCodeAt(offset))) return false
  }
  return true
}

/**
 * Whether a list marker leaves the line to the open paragraph (CommonMark
 * 0.31.2 §5.2, §4.3). While the paragraph is the innermost open block, an
 * empty item cannot interrupt it and a `-` run is its setext underline. An
 * ordered item not starting at 1 cannot interrupt it either; like upstream
 * MarkText, that also holds on a lazy continuation line. Under a list item's
 * own paragraph, upstream nests an empty or renumbered item as a sublist, so
 * only the underline applies there.
 */
function refusesParagraphInterruption(
  source: string,
  marker: ListMarker,
  lineContentEnd: number,
  paragraphOpen: boolean,
  containersMatched: boolean,
  insideListItem: boolean,
  underlinedAhead: () => boolean = () => false
): boolean {
  if (!paragraphOpen) return false
  const empty = isBlankFrom(source, marker.end, lineContentEnd)
  if (containersMatched && empty && isSetextUnderline(source, marker.start, lineContentEnd)) {
    return true
  }
  // Upstream reads a bare marker, with nothing after it, as heading text when
  // the paragraph it follows goes on to a setext underline.
  if (insideListItem) return containersMatched && marker.end >= lineContentEnd && underlinedAhead()
  return (containersMatched && empty) ||
    (marker.ordered && marker.startNumber !== 1)
}

/**
 * Whether the paragraph a bare list marker would interrupt reaches a setext
 * underline, reading on from `next` in `source`. As upstream's setext rule
 * does, it passes lines of text, bare markers and rules, and stops at a
 * blank line, a line that leaves the paragraph's containers, indented code,
 * a list item with text, a block quote, an ATX heading, a fence or an HTML
 * block.
 */
// The answer for each line the scan passes, so a paragraph of bare markers
// is read once however many of them ask.
let underlinedAheadMemo: { source: string, results: Map<string, boolean> } | undefined

function paragraphUnderlinedAhead(
  source: string,
  next: number,
  containers: readonly ActiveBlockContainer[]
): boolean {
  if (underlinedAheadMemo?.source !== source) {
    underlinedAheadMemo = { source, results: new Map() }
  }
  const results = underlinedAheadMemo.results
  const key = (start: number): string => `${String(start)}:${String(containers.length)}`
  const known = results.get(key(next))
  if (known !== undefined) return known
  const visited: number[] = []
  const settle = (answer: boolean): boolean => {
    for (const start of visited) results.set(key(start), answer)
    return answer
  }
  let start = next
  while (start < source.length) {
    const cached = results.get(key(start))
    if (cached !== undefined) return settle(cached)
    visited.push(start)
    let contentEnd = start
    while (
      contentEnd < source.length &&
      source.charCodeAt(contentEnd) !== 10 &&
      source.charCodeAt(contentEnd) !== 13
    ) {
      contentEnd += 1
    }
    const text = source.slice(start, contentEnd)
    const state = analyzeContainerLine(text, { start: 0, contentEnd: text.length, end: text.length }, containers, true, true)
    if (
      state.blank ||
      (state.continuedContainerDepth < containers.length && !state.lazy) ||
      state.indentation > 3
    ) {
      return settle(false)
    }
    if (isSetextUnderline(text, state.contentOffset, text.length)) return settle(true)
    const marker = findListMarker(text, state.contentOffset, text.length)
    if (
      (marker !== undefined && marker.end < text.length) ||
      text.charCodeAt(state.contentOffset) === 62 ||
      isAtxHeadingLine(text, state) ||
      findMarkdownFenceOpening(text, state.contentOffset, state.indentation, false) !== undefined ||
      htmlBlockOpening(text, state, true) !== undefined
    ) {
      return settle(false)
    }
    start = contentEnd + (
      source.charCodeAt(contentEnd) === 13 && source.charCodeAt(contentEnd + 1) === 10 ? 2 : 1
    )
  }
  return settle(false)
}

const NO_LIST_HOLDERS: readonly boolean[] = Object.freeze([])

/**
 * By depth, whether each container a line leaves open is a list item that
 * has held a list: those kept from the line before carry the answer on, and
 * an item holds one while another list item is open inside it.
 */
function listHoldersAfterLine(
  previous: readonly boolean[],
  continuedDepth: number,
  containers: readonly ActiveBlockContainer[]
): readonly boolean[] {
  let any = false
  const holders = containers.map((container, depth) => {
    const holds = container.kind === 'list-item' && (
      (depth < continuedDepth && previous[depth] === true) ||
      containers[depth + 1]?.kind === 'list-item'
    )
    any ||= holds
    return holds
  })
  return any ? Object.freeze(holders) : NO_LIST_HOLDERS
}

/**
 * Whether a list marker ends a GFM table's rows. Upstream (marked) ends
 * them only at a bullet or a `1.` / `1)` marker followed by a space, so
 * `-` alone or `2. x` there is a row.
 */
function endsTableRows(
  source: string,
  marker: ListMarker,
  lineContentEnd: number
): boolean {
  return (!marker.ordered || marker.startNumber === 1) &&
    marker.end < lineContentEnd &&
    isSpaceOrTab(source.charCodeAt(marker.end))
}

/**
 * The number of cells GFM reads in a table row: cells lie between
 * unescaped pipes, empty edge cells are not cells, and a row without a pipe
 * is one cell. Mirrors the parser's row splitting.
 */
function gfmTableRowCellCount(source: string, start: number, end: number): number {
  const separators: number[] = []
  for (let offset = start; offset < end; offset += 1) {
    if (source.charCodeAt(offset) === 124 && !hasOddLineBackslashRunBefore(source, offset, start)) {
      separators.push(offset)
    }
  }
  if (separators.length === 0) return 1
  const boundaries = [start, ...separators, end]
  let cells = 0
  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const cellStart = (boundaries[index] ?? start) + (index > 0 ? 1 : 0)
    const cellEnd = boundaries[index + 1] ?? end
    const empty = isBlankFrom(source, cellStart, cellEnd)
    if (!(empty && (index === 0 || index + 2 === boundaries.length))) cells += 1
  }
  return cells
}

/**
 * Upstream (marked) takes no line that begins like a reference definition,
 * `[label]:`, for a table's header row.
 */
const DEFINITION_LABEL_START = /^[ \t]*\[(?:[^\\[\]]|\\.)*\]:/u

function gfmTableHeaderCellCount(source: string, start: number, end: number): number | undefined {
  return DEFINITION_LABEL_START.test(source.slice(start, end))
    ? undefined
    : gfmTableRowCellCount(source, start, end)
}

/** The column count of a GFM delimiter row, or undefined if it is none. */
function gfmTableDelimiterCellCount(source: string, start: number, end: number): number | undefined {
  const text = source.slice(start, end)
  const pieces = text.split(/(?<!\\)\|/u).map(piece => piece.trim())
  if (pieces.length === 1) {
    // Without a pipe a delimiter row needs a colon, or it is an underline.
    return /^:-+:?$|^-+:$/u.test(pieces[0] ?? '') ? 1 : undefined
  }
  if (pieces[0] === '') pieces.shift()
  if (pieces.at(-1) === '') pieces.pop()
  if (pieces.length === 0 || !pieces.every(piece => /^:?-+:?$/u.test(piece))) return undefined
  return pieces.length
}

function hasOddLineBackslashRunBefore(source: string, offset: number, floor: number): boolean {
  let count = 0
  for (let cursor = offset - 1; cursor >= floor && source.charCodeAt(cursor) === 92; cursor -= 1) {
    count += 1
  }
  return count % 2 === 1
}

function isThematicBreakFrom(source: string, start: number, end: number): boolean {
  const marker = source.charCodeAt(start)
  if (marker !== 42 && marker !== 45 && marker !== 95) {
    return false
  }
  let markerCount = 0
  for (let offset = start; offset < end; offset += 1) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === marker) {
      markerCount += 1
    } else if (!isSpaceOrTab(codeUnit)) {
      return false
    }
  }
  return markerCount >= 3
}

function isAtxHeadingLine(source: string, state: ContainerLineState): boolean {
  if (
    state.blank ||
    state.indentation > 3 ||
    source.charCodeAt(state.contentOffset) !== 35
  ) {
    return false
  }
  let offset = state.contentOffset
  while (offset < state.lineContentEnd && source.charCodeAt(offset) === 35) {
    offset += 1
  }
  const level = offset - state.contentOffset
  return level <= 6 &&
    (offset === state.lineContentEnd || isSpaceOrTab(source.charCodeAt(offset)))
}

function findListMarker(
  source: string,
  offset: number,
  contentEnd: number
): ListMarker | undefined {
  const first = source.charCodeAt(offset)
  let markerEnd = offset
  if (first === 42 || first === 43 || first === 45) {
    markerEnd += 1
    if (markerEnd < contentEnd && !isSpaceOrTab(source.charCodeAt(markerEnd))) {
      return undefined
    }
    return Object.freeze({
      start: offset,
      end: markerEnd,
      ordered: false,
      startNumber: 1,
      delimiterCodeUnit: first
    })
  } else if (first >= 48 && first <= 57) {
    let digits = 0
    let startNumber = 0
    while (
      markerEnd < contentEnd &&
      source.charCodeAt(markerEnd) >= 48 &&
      source.charCodeAt(markerEnd) <= 57 &&
      digits < 9
    ) {
      startNumber = startNumber * 10 + source.charCodeAt(markerEnd) - 48
      markerEnd += 1
      digits += 1
    }
    if (
      digits === 0 ||
      (source.charCodeAt(markerEnd) !== 46 && source.charCodeAt(markerEnd) !== 41)
    ) {
      return undefined
    }
    markerEnd += 1
    if (markerEnd < contentEnd && !isSpaceOrTab(source.charCodeAt(markerEnd))) {
      return undefined
    }
    return Object.freeze({
      start: offset,
      end: markerEnd,
      ordered: true,
      startNumber,
      delimiterCodeUnit: source.charCodeAt(markerEnd - 1)
    })
  } else {
    return undefined
  }
}

function consumeListPadding(
  source: string,
  markerEnd: number,
  contentEnd: number,
  markerEndColumn: number
): Readonly<{ offset: number; column: number; contentColumn: number }> {
  if (markerEnd >= contentEnd) {
    return Object.freeze({
      offset: markerEnd,
      column: markerEndColumn + 1,
      contentColumn: markerEndColumn + 1
    })
  }
  let paddingEnd = markerEnd
  let paddingColumn = markerEndColumn
  while (paddingEnd < contentEnd && isSpaceOrTab(source.charCodeAt(paddingEnd))) {
    paddingColumn = advanceColumn(paddingColumn, source.charCodeAt(paddingEnd))
    paddingEnd += 1
  }
  if (paddingEnd >= contentEnd) {
    return Object.freeze({
      offset: paddingEnd,
      column: markerEndColumn + 1,
      contentColumn: markerEndColumn + 1
    })
  }
  if (paddingColumn - markerEndColumn <= 4) {
    return Object.freeze({
      offset: paddingEnd,
      column: paddingColumn,
      contentColumn: paddingColumn
    })
  }
  return Object.freeze({
    offset: markerEnd + 1,
    column: advanceColumn(markerEndColumn, source.charCodeAt(markerEnd)),
    contentColumn: markerEndColumn + 1
  })
}

function analyzeContainerLine(
  source: string,
  line: SourceLine,
  inheritedContainers: readonly ActiveBlockContainer[],
  paragraphOpen: boolean,
  suppressNewContainers: boolean = false,
  // A line after a reference definition may be lazy though no paragraph is
  // open; it then starts blocks as after any complete block.
  lazyContinuationOpen: boolean = paragraphOpen,
  tableRowOpen: boolean = false,
  // Where the line's paragraph goes on in full source, for a bare marker
  // that upstream may read as heading text.
  following?: Readonly<{ source: string, next: number }>,
  // By depth, whether an inherited list item has held a list.
  listHolders: readonly boolean[] = NO_LIST_HOLDERS
): ContainerLineState {
  let offset = line.start
  let column = 0
  if (offset === 0 && source.charCodeAt(offset) === 0xfeff) {
    offset += 1
  }

  // CommonMark phase 1 matches existing containers in their source order.
  // List indentation is relative to its parent container, so flattening lists
  // and block quotes into separate counters cannot represent `> -` and `- >`.
  const activeContainers: ActiveBlockContainer[] = []
  const blockquoteMarkers: Array<Readonly<{ depth: number, start: number, end: number }>> = []
  const listContinuationIndentations: ListContinuationIndentationState[] = []
  let containerBaseColumn = column
  for (const inherited of inheritedContainers) {
    const matchStartOffset = offset
    const matchStartColumn = column
    if (inherited.kind === 'blockquote') {
      while (
        offset < line.contentEnd &&
        isSpaceOrTab(source.charCodeAt(offset))
      ) {
        const nextColumn = advanceColumn(column, source.charCodeAt(offset))
        if (nextColumn - containerBaseColumn > 3) {
          break
        }
        column = nextColumn
        offset += 1
      }
      if (source.charCodeAt(offset) !== 62) {
        offset = matchStartOffset
        column = matchStartColumn
        break
      }
      const markerStart = offset
      column += 1
      offset += 1
      let contentColumn = column
      if (offset < line.contentEnd && isSpaceOrTab(source.charCodeAt(offset))) {
        contentColumn = column + 1
        column = advanceColumn(column, source.charCodeAt(offset))
        offset += 1
      }
      blockquoteMarkers.push(Object.freeze({ depth: activeContainers.length, start: markerStart, end: offset }))
      containerBaseColumn = contentColumn
    } else {
      const triviaStart = offset
      const targetColumn = containerBaseColumn + inherited.contentIndent
      while (
        offset < line.contentEnd &&
        isSpaceOrTab(source.charCodeAt(offset)) &&
        column < targetColumn
      ) {
        column = advanceColumn(column, source.charCodeAt(offset))
        offset += 1
      }
      let blankOffset = offset
      while (
        blankOffset < line.contentEnd &&
        isSpaceOrTab(source.charCodeAt(blankOffset))
      ) {
        blankOffset += 1
      }
      if (column < targetColumn) {
        // Empty lines need not carry list-item indentation. Retain only this
        // list prefix; a following blockquote still has to match explicitly.
        if (blankOffset !== line.contentEnd || inherited.awaitingContent) {
          offset = matchStartOffset
          column = matchStartColumn
          break
        }
      } else if (blankOffset === line.contentEnd && inherited.awaitingContent) {
        // An item begins with at most one blank line: whatever its
        // indentation, a blank line after an empty item's marker ends it.
        offset = matchStartOffset
        column = matchStartColumn
        break
      } else {
        listContinuationIndentations.push(Object.freeze({
          containerDepth: activeContainers.length + 1,
          contentIndent: inherited.contentIndent,
          triviaStart,
          triviaEnd: offset,
          exitTriviaStart: offset - 1,
          exitTriviaEnd: offset
        }))
        containerBaseColumn = targetColumn
      }
    }
    activeContainers.push(
      inherited.kind === 'list-item' && inherited.awaitingContent
        ? Object.freeze({ ...inherited, awaitingContent: false })
        : inherited
    )
  }

  const inheritedMatchDepth = activeContainers.length
  const openers: MarkdownContainerOpener[] = []
  // Inside an open block literal (fence, front matter, HTML block, indented
  // code) every byte is content: continued containers still match above, but
  // a '>' or '-' here opens nothing.
  const openerScanEnd = suppressNewContainers ? offset : line.contentEnd
  while (offset < openerScanEnd) {
    while (offset < line.contentEnd && isSpaceOrTab(source.charCodeAt(offset))) {
      const nextColumn = advanceColumn(column, source.charCodeAt(offset))
      if (nextColumn - containerBaseColumn > 3) {
        break
      }
      column = nextColumn
      offset += 1
    }

    if (source.charCodeAt(offset) === 62) {
      const markerStart = offset
      const container: ActiveBlockquoteContainer = Object.freeze({
        kind: 'blockquote'
      })
      activeContainers.push(container)
      openers.push(Object.freeze({
        kind: 'blockquote',
        start: markerStart,
        end: markerStart + 1,
        observed: activeContainers.length
      }))
      column += 1
      offset += 1
      let contentColumn = column
      if (offset < line.contentEnd && isSpaceOrTab(source.charCodeAt(offset))) {
        contentColumn = column + 1
        column = advanceColumn(column, source.charCodeAt(offset))
        offset += 1
      }
      blockquoteMarkers.push(Object.freeze({ depth: activeContainers.length - 1, start: markerStart, end: offset }))
      containerBaseColumn = contentColumn
      continue
    }

    if (isThematicBreakFrom(source, offset, line.contentEnd)) {
      break
    }
    const listMarker = findListMarker(source, offset, line.contentEnd)
    const containersMatched = inheritedMatchDepth === inheritedContainers.length &&
      activeContainers.length === inheritedContainers.length
    if (
      listMarker === undefined ||
      (tableRowOpen && containersMatched && !endsTableRows(source, listMarker, line.contentEnd)) ||
      refusesParagraphInterruption(
        source,
        listMarker,
        line.contentEnd,
        // A container opened earlier on this line has already ended the
        // paragraph, so a marker after it interrupts nothing.
        paragraphOpen && openers.length === 0,
        containersMatched,
        // Upstream's nesting applies to a list item's own paragraph, not to
        // one in a block quote the line continues inside that item, nor
        // once a list has opened in the item: its later paragraphs read
        // markers as CommonMark does.
        containersMatched
          ? (() => {
            const depth = activeContainers.length - 1
            return activeContainers[depth]?.kind === 'list-item' && listHolders[depth] !== true
          })()
          : inheritedContainers.some((container) => container.kind === 'list-item'),
        () => following !== undefined &&
          paragraphUnderlinedAhead(following.source, following.next, Object.freeze([...activeContainers]))
      )
    ) {
      break
    }
    while (offset < listMarker.end) {
      column = advanceColumn(column, source.charCodeAt(offset))
      offset += 1
    }
    const padding = consumeListPadding(source, offset, line.contentEnd, column)
    offset = padding.offset
    column = padding.column
    const container: ActiveListContainer = Object.freeze({
      kind: 'list-item',
      contentIndent: padding.contentColumn - containerBaseColumn,
      awaitingContent: offset >= line.contentEnd,
      ordered: listMarker.ordered,
      startNumber: listMarker.startNumber,
      delimiterCodeUnit: listMarker.delimiterCodeUnit
    })
    containerBaseColumn = padding.contentColumn
    activeContainers.push(container)
    openers.push(Object.freeze({
      kind: 'list-item',
      start: listMarker.start,
      end: listMarker.end,
      observed: activeContainers.length,
      ordered: listMarker.ordered,
      startNumber: listMarker.startNumber,
      delimiterCodeUnit: listMarker.delimiterCodeUnit,
      contentOffset: offset
    }))
  }

  let contentColumn = column
  let contentOffset = offset
  while (
    contentOffset < line.contentEnd &&
    isSpaceOrTab(source.charCodeAt(contentOffset))
  ) {
    contentColumn = advanceColumn(contentColumn, source.charCodeAt(contentOffset))
    contentOffset += 1
  }
  const provisionalState: ContainerLineState = Object.freeze({
    activeContainers: Object.freeze(activeContainers),
    blockquoteMarkers: Object.freeze(blockquoteMarkers),
    continuedContainerDepth: inheritedMatchDepth,
    listContinuationIndentations: Object.freeze(listContinuationIndentations),
    blockQuoteDepth: activeContainers.reduce(
      (depth, container) => depth + (container.kind === 'blockquote' ? 1 : 0),
      0
    ),
    blank: contentOffset === line.contentEnd,
    indentation: contentColumn - containerBaseColumn,
    contentOffset,
    lineContentEnd: line.contentEnd,
    containerBaseColumn,
    openers: Object.freeze(openers),
    lazy: false,
    paragraphContinues:
      (paragraphOpen || tableRowOpen) &&
      inheritedMatchDepth === inheritedContainers.length &&
      openers.length === 0,
    tableRowContinues:
      tableRowOpen &&
      inheritedMatchDepth === inheritedContainers.length &&
      openers.length === 0,
    lazyIndentation: contentColumn - containerBaseColumn,
    setextUnderline:
      paragraphOpen &&
      inheritedMatchDepth === inheritedContainers.length &&
      openers.length === 0 &&
      contentOffset < line.contentEnd &&
      contentColumn - containerBaseColumn <= 3 &&
      isSetextUnderline(source, contentOffset, line.contentEnd)
  })
  if (
    (lazyContinuationOpen || tableRowOpen) &&
    inheritedMatchDepth < inheritedContainers.length &&
    isLazyParagraphContinuation(source, provisionalState)
  ) {
    // A complete HTML tag interrupts the paragraph it lazily continues. As
    // upstream reads it, a block quote keeps such a line and the HTML block
    // opens inside it, but a list item ends at an opening tag, with every
    // container inside it.
    let kept = inheritedContainers.length
    if (
      source.charCodeAt(provisionalState.contentOffset + 1) !== 47 &&
      htmlBlockOpening(source, provisionalState, true) === undefined &&
      htmlBlockOpening(source, provisionalState, false) !== undefined
    ) {
      const firstListItem = inheritedContainers.findIndex((container) => container.kind === 'list-item')
      if (firstListItem !== -1) kept = firstListItem
    }
    if (kept > inheritedMatchDepth) {
      const keptContainers = inheritedContainers.slice(0, kept)
      let lazyIndentation = provisionalState.indentation
      for (const container of keptContainers.slice(inheritedMatchDepth)) {
        if (container.kind !== 'list-item') continue
        if (lazyIndentation < container.contentIndent) break
        lazyIndentation -= container.contentIndent
      }
      return Object.freeze({
        ...provisionalState,
        activeContainers: Object.freeze(keptContainers),
        continuedContainerDepth: kept,
        blockQuoteDepth: keptContainers.reduce(
          (depth, container) =>
            depth + (container.kind === 'blockquote' ? 1 : 0),
          0
        ),
        lazy: true,
        // A lazy line leaves a quoted table as a paragraph of its own.
        paragraphContinues: paragraphOpen || (tableRowOpen && keptContainers.at(-1)?.kind !== 'blockquote'),
        tableRowContinues: tableRowOpen,
        lazyIndentation
      })
    }
  }
  return provisionalState
}

const RAW_HTML_BLOCK_TAGS = Object.freeze([
  'script',
  'pre',
  'style',
  'textarea'
] as const)
const RAW_HTML_END_TERMINATOR = 'raw-html-end-tag'
const RAW_HTML_END_TAG = /<\/(?:script|pre|style|textarea)>/i
const BLANK_TERMINATED_HTML_TAG =
  /^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[\t >]|\/>|$)/i

interface HtmlBlockOpening {
  readonly terminator: string | undefined
}

function htmlBlockOpening(
  lineText: string,
  state: ContainerLineState,
  paragraphOpen: boolean
): HtmlBlockOpening | undefined {
  if (
    state.blank ||
    state.indentation > 3 ||
    lineText.charCodeAt(state.contentOffset) !== 60
  ) {
    return undefined
  }
  // The line may be read inside the whole source: its text ends at its own
  // content end, not at the source's.
  const lineEnd = state.lineContentEnd
  const candidate = lineText.slice(state.contentOffset, lineEnd)
  const lowerCandidate = candidate.toLowerCase()
  for (const tag of RAW_HTML_BLOCK_TAGS) {
    if (
      lowerCandidate.startsWith(`<${tag}`) &&
      [' ', '\t', '>', ''].includes(lowerCandidate[tag.length + 1] ?? '')
    ) {
      return Object.freeze({ terminator: RAW_HTML_END_TERMINATOR })
    }
  }
  if (lowerCandidate.startsWith('<!--')) {
    return Object.freeze({ terminator: '-->' })
  }
  if (lowerCandidate.startsWith('<?')) {
    return Object.freeze({ terminator: '?>' })
  }
  if (candidate.startsWith('<![CDATA[')) {
    return Object.freeze({ terminator: ']]>' })
  }
  if (
    candidate.startsWith('<!') &&
    ((candidate.charCodeAt(2) >= 65 && candidate.charCodeAt(2) <= 90) ||
      (candidate.charCodeAt(2) >= 97 && candidate.charCodeAt(2) <= 122))
  ) {
    return Object.freeze({ terminator: '>' })
  }
  if (BLANK_TERMINATED_HTML_TAG.test(candidate)) {
    return Object.freeze({ terminator: undefined })
  }
  if (paragraphOpen) {
    return undefined
  }
  const tagEnd = findInlineHtmlEnd(
    lineText,
    state.contentOffset,
    lineEnd
  )
  if (tagEnd === undefined) {
    return undefined
  }
  for (let offset = tagEnd; offset < lineEnd; offset += 1) {
    if (!isSpaceOrTab(lineText.charCodeAt(offset))) {
      return undefined
    }
  }
  return Object.freeze({ terminator: undefined })
}

function isSetextUnderline(
  source: string,
  start: number,
  end: number
): boolean {
  const marker = source.charCodeAt(start)
  if (marker !== 45 && marker !== 61) {
    return false
  }
  let offset = start
  while (offset < end && source.charCodeAt(offset) === marker) {
    offset += 1
  }
  while (offset < end && isSpaceOrTab(source.charCodeAt(offset))) {
    offset += 1
  }
  return offset === end
}

function isLazyParagraphContinuation(
  source: string,
  state: ContainerLineState
): boolean {
  if (state.indentation >= 4 && !state.blank && state.openers.length === 0) {
    return true
  }
  if (
    state.blank ||
    state.openers.length > 0 ||
    isAtxHeadingLine(source, state) ||
    isThematicBreakFrom(source, state.contentOffset, state.lineContentEnd) ||
    findMarkdownFenceOpening(
      source.slice(0, state.lineContentEnd),
      state.contentOffset,
      state.indentation,
      state.blank
    ) !== undefined
  ) {
    return false
  }
  return htmlBlockOpening(source, state, true) === undefined
}

/**
 * Whether the checkpoint's pending line holds nothing but the container
 * prefix (and trivia) of its active containers, so text appended there still
 * begins a line inside those containers.
 */
export function markdownPendingLineIsContainerPrefix(
  checkpoint: MarkdownCheckpoint
): boolean {
  const lineText = materializeMarkdownLine(checkpoint.linePath)
  if (lineText.length === 0) {
    return true
  }
  const lineState = analyzeContainerLine(
    lineText,
    { start: 0, contentEnd: lineText.length, end: lineText.length },
    checkpoint.activeContainers,
    false,
    true
  )
  return lineState.blank &&
    lineState.indentation < 4 &&
    lineState.continuedContainerDepth === checkpoint.activeContainers.length
}

/**
 * Non-destructively classifies the line retained by a parser checkpoint.
 * Canonical lane evidence uses this at fragment boundaries so projection does
 * not have to rediscover block structure from flattened text.
 */
export function inspectMarkdownPendingLineBlock(
  checkpoint: MarkdownCheckpoint
): MarkdownPendingLineBlockFact | undefined {
  const lineText = materializeMarkdownLine(checkpoint.linePath)
  if (lineText.length === 0) {
    return undefined
  }
  const lineState = analyzeContainerLine(
    lineText,
    { start: 0, contentEnd: lineText.length, end: lineText.length },
    checkpoint.activeContainers,
    checkpoint.paragraphOpen,
    false,
    lazyContinuationOpenFor(checkpoint),
    checkpoint.tableOpen === true,
    undefined,
    checkpoint.listItemsHoldingLists
  )
  const opensFence = findMarkdownFenceOpening(
    lineText,
    lineState.contentOffset,
    lineState.indentation,
    lineState.blank
  ) !== undefined
  const ownsBlockLiteral =
    checkpoint.fence !== undefined ||
    checkpoint.frontMatter !== undefined ||
    checkpoint.indentedCode !== undefined ||
    checkpoint.htmlBlock !== undefined ||
    checkpoint.definition !== undefined ||
    (
      checkpoint.frontMatterEligible &&
      frontMatterOpeningStyle(lineText) !== undefined
    ) ||
    ((!lineState.paragraphContinues || lineState.tableRowContinues) && lineState.lazyIndentation >= 4) ||
    htmlBlockOpening(lineText, lineState, lineState.paragraphContinues && !lineState.lazy) !== undefined ||
    definitionOpening(lineText, lineState, lineState.paragraphContinues, false) !==
      undefined
  const paragraphOpen =
    !checkpoint.lineBlockClosed &&
    !lineState.blank &&
    !ownsBlockLiteral &&
    !opensFence &&
    !isAtxHeadingLine(lineText, lineState) &&
    !lineState.setextUnderline &&
    !(
      lineState.indentation <= 3 &&
      isThematicBreakFrom(
        lineText,
        lineState.contentOffset,
        lineText.length
      )
    )
  const mapContiguousTrivia = (
    start: number,
    end: number
  ): Readonly<{ readonly start: number; readonly end: number }> | undefined => {
    if (start < 0 || end <= start) {
      return undefined
    }
    const sourceStart = linePathSourceOffsetAt(checkpoint.linePath, start)
    if (sourceStart === undefined) {
      return undefined
    }
    for (let offset = start + 1; offset < end; offset += 1) {
      if (
        linePathSourceOffsetAt(checkpoint.linePath, offset) !==
        sourceStart + offset - start
      ) {
        return undefined
      }
    }
    return Object.freeze({ start: sourceStart, end: sourceStart + end - start })
  }
  const listContinuationIndentations = lineState.listContinuationIndentations
    .flatMap((indentation): readonly MarkdownPendingListContinuationIndentationFact[] => {
      const trivia = mapContiguousTrivia(
        indentation.triviaStart,
        indentation.triviaEnd
      )
      const exitTrivia = mapContiguousTrivia(
        indentation.exitTriviaStart,
        indentation.exitTriviaEnd
      )
      return trivia === undefined || exitTrivia === undefined
        ? Object.freeze([])
        : Object.freeze([Object.freeze({
          containerDepth: indentation.containerDepth,
          contentIndent: indentation.contentIndent,
          trivia,
          exitTrivia
        })])
    })
  return Object.freeze({
    blank: lineState.blank,
    indentation: lineState.indentation,
    paragraphOpen,
    continuesExistingParagraph:
      checkpoint.paragraphOpen &&
      paragraphOpen &&
      isLazyParagraphContinuation(lineText, lineState),
    containerPath: Object.freeze(
      lineState.activeContainers.map((container) => container.kind)
    ),
    containers: Object.freeze(lineState.activeContainers.map((container) =>
      container.kind === 'blockquote'
        ? Object.freeze({ kind: 'blockquote' as const })
        : Object.freeze({
          kind: 'list-item' as const,
          contentIndent: container.contentIndent
        })
    )),
    containerOpeners: Object.freeze(lineState.openers.flatMap(opener => {
      const range = mapContiguousTrivia(opener.start, opener.end)
      return range === undefined ? [] : [range]
    })),
    listContinuationIndentations: Object.freeze(listContinuationIndentations)
  })
}

function htmlBlockTerminatedOnLine(
  lineText: string,
  htmlBlock: MarkdownHtmlBlockState
): boolean {
  return htmlBlock.terminator === RAW_HTML_END_TERMINATOR
    ? RAW_HTML_END_TAG.test(lineText)
    : htmlBlock.terminator !== undefined && lineText.includes(htmlBlock.terminator)
}

function decodeReferenceEntity(
  source: string,
  start: number,
  end: number
): Readonly<{ value: string; end: number }> | undefined {
  const semicolon = source.indexOf(';', start + 1)
  if (semicolon < 0 || semicolon >= end || semicolon - start > 32) {
    return undefined
  }
  const body = source.slice(start + 1, semicolon)
  const named: Readonly<Record<string, string>> = Object.freeze({
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"'
  })
  const namedValue = named[body]
  if (namedValue !== undefined) {
    return Object.freeze({ value: namedValue, end: semicolon + 1 })
  }
  const numeric = body.startsWith('#x') || body.startsWith('#X')
    ? Number.parseInt(body.slice(2), 16)
    : body.startsWith('#')
      ? Number.parseInt(body.slice(1), 10)
      : Number.NaN
  if (
    !Number.isInteger(numeric) ||
    numeric <= 0 ||
    numeric > 0x10ffff ||
    (numeric >= 0xd800 && numeric <= 0xdfff)
  ) {
    return undefined
  }
  return Object.freeze({
    value: String.fromCodePoint(numeric),
    end: semicolon + 1
  })
}

export function normalizeMarkdownReferenceLabel(
  source: string,
  start: number,
  end: number
): string {
  let normalized = ''
  let pendingWhitespace = false
  for (let offset = start; offset < end;) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 38) {
      const entity = decodeReferenceEntity(source, offset, end)
      if (entity !== undefined) {
        if (pendingWhitespace && normalized.length > 0) {
          normalized += ' '
        }
        pendingWhitespace = false
        normalized += entity.value
        offset = entity.end
        continue
      }
    }
    if (isMarkdownWhitespace(codeUnit)) {
      pendingWhitespace = normalized.length > 0
      offset += 1
      continue
    }
    if (pendingWhitespace && normalized.length > 0) {
      normalized += ' '
    }
    pendingWhitespace = false
    const codePoint = source.codePointAt(offset)
    if (codePoint === undefined) {
      break
    }
    // Unicode case fold, not just lowercase: both sharp S forms fold to 'ss'.
    normalized += codePoint === 0xdf || codePoint === 0x1e9e
      ? 'ss'
      : String.fromCodePoint(codePoint).toLowerCase()
    offset += codePoint > 0xffff ? 2 : 1
  }
  return normalized
}

export function markdownReferenceDefinitionLabel(
  source: string,
  start: number,
  end: number,
  /** Whether a `[^` opens a footnote's label rather than a reference's. */
  footnotesEnabled: boolean = true
): string | undefined {
  for (let opener = start; opener < end; opener += 1) {
    if (
      source.charCodeAt(opener) !== 91 ||
      (footnotesEnabled && source.charCodeAt(opener + 1) === 94) ||
      !hasEvenBackslashRunBefore(source, opener)
    ) {
      continue
    }
    // The label may span lines; only an unescaped '[' or a ']' not followed
    // by ':' disqualifies it.
    for (let closer = opener + 1; closer + 1 < end; closer += 1) {
      const codeUnit = source.charCodeAt(closer)
      if (codeUnit === 92 && closer + 1 < end) {
        closer += 1
        continue
      }
      if (codeUnit === 91) {
        return undefined
      }
      if (codeUnit !== 93 || source.charCodeAt(closer + 1) !== 58) {
        continue
      }
      const label = normalizeMarkdownReferenceLabel(source, opener + 1, closer)
      return label.length === 0 || closer - opener - 1 > 999
        ? undefined
        : label
    }
    return undefined
  }
  return undefined
}

export interface StagedMarkdownReferenceDefinition {
  readonly normalizedLabel: string
  readonly start: number
  readonly end: number
}

/**
 * Recognize one reference definition from a real or parser-created virtual
 * line start. This is the block-stage production used to make later
 * definitions available to inline resolution without replaying the intrinsic
 * source grammar.
 */
export function stagedMarkdownReferenceDefinitionAt(
  source: string,
  start: number,
  laneEnd: number,
  footnotesEnabled: boolean = true
): StagedMarkdownReferenceDefinition | undefined {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(laneEnd) ||
    start < 0 ||
    laneEnd <= start ||
    laneEnd > source.length
  ) {
    return undefined
  }
  const lineBoundsAt = (
    lineStart: number
  ): Readonly<{ readonly contentEnd: number; readonly end: number }> => {
    let contentEnd = lineStart
    while (
      contentEnd < laneEnd &&
      source.charCodeAt(contentEnd) !== 10 &&
      source.charCodeAt(contentEnd) !== 13
    ) {
      contentEnd += 1
    }
    let end = contentEnd
    if (end < laneEnd) {
      end +=
        source.charCodeAt(end) === 13 &&
        end + 1 < laneEnd &&
        source.charCodeAt(end + 1) === 10
          ? 2
          : 1
    }
    return Object.freeze({ contentEnd, end })
  }
  const lineStateAt = (
    lineStart: number,
    contentEnd: number,
    paragraphOpen: boolean
  ): Readonly<{
    readonly text: string
    readonly state: ContainerLineState
  }> => {
    const text = source.slice(lineStart, contentEnd)
    return Object.freeze({
      text,
      state: analyzeContainerLine(
        text,
        { start: 0, contentEnd: text.length, end: text.length },
        Object.freeze([]),
        paragraphOpen,
        false
      )
    })
  }

  const firstBounds = lineBoundsAt(start)
  const first = lineStateAt(start, firstBounds.contentEnd, false)
  const opening = definitionOpening(first.text, first.state, false, true, footnotesEnabled)
  if (opening === undefined || opening.phase === 'footnote') {
    return undefined
  }
  let definition: MarkdownDefinitionState = Object.freeze({
    openStart: start,
    lastOwnedEnd: firstBounds.end,
    lineStart: start,
    phase: opening.phase,
    titleCloseCodeUnit: opening.titleCloseCodeUnit
  })
  let lineStart = firstBounds.end
  while (lineStart < laneEnd) {
    const bounds = lineBoundsAt(lineStart)
    const line = lineStateAt(
      lineStart,
      bounds.contentEnd,
      !definitionPhaseComplete(definition.phase)
    )
    const continuation = definitionContinuationPhase(
      line.text,
      line.state,
      definition
    )
    if (continuation === 'invalid') {
      return undefined
    }
    if (continuation === undefined) {
      break
    }
    definition = Object.freeze({
      ...definition,
      lineStart,
      phase: continuation.phase,
      titleCloseCodeUnit: continuation.titleCloseCodeUnit,
      lastOwnedEnd: bounds.end
    })
    lineStart = bounds.end
  }
  if (!definitionPhaseComplete(definition.phase)) {
    return undefined
  }
  const normalizedLabel = markdownReferenceDefinitionLabel(
    source,
    start,
    definition.lastOwnedEnd,
    footnotesEnabled
  )
  return normalizedLabel === undefined
    ? undefined
    : Object.freeze({
      normalizedLabel,
      start,
      end: definition.lastOwnedEnd
    })
}

function referenceLabelSuffix(
  source: string,
  start: number,
  laneEnd: number
): Readonly<{ labelStart: number; labelEnd: number; end: number }> | undefined {
  if (source.charCodeAt(start) !== 91) {
    return undefined
  }
  let contentLength = 0
  for (let offset = start + 1; offset < laneEnd; offset += 1) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 92 && offset + 1 < laneEnd) {
      contentLength += 1
      offset += 1
      continue
    }
    if (codeUnit === 91) {
      return undefined
    }
    if (codeUnit === 93) {
      return contentLength <= 999
        ? Object.freeze({ labelStart: start + 1, labelEnd: offset, end: offset + 1 })
        : undefined
    }
    contentLength += 1
  }
  return undefined
}

function definitionColonInLine(
  lineText: string,
  state: ContainerLineState,
  footnotesEnabled: boolean
): number | 'label-open' | undefined {
  const start = state.contentOffset
  if (state.indentation > 3 || lineText.charCodeAt(start) !== 91) {
    return undefined
  }
  // Without footnotes, `[^label]:` is an ordinary reference definition.
  const footnote = footnotesEnabled && lineText.charCodeAt(start + 1) === 94
  const labelStart = footnote ? start + 2 : start + 1
  let hasLabelContent = false
  let sawCloser = false
  for (let offset = labelStart; offset < lineText.length; offset += 1) {
    if (lineText.charCodeAt(offset) === 92) {
      if (offset + 1 < lineText.length) {
        hasLabelContent = true
      }
      offset += 1
      continue
    }
    if (lineText.charCodeAt(offset) === 91) {
      return undefined
    }
    if (lineText.charCodeAt(offset) === 93) {
      sawCloser = true
      if (lineText.charCodeAt(offset + 1) !== 58) {
        return undefined
      }
      const labelLength = offset - labelStart
      return hasLabelContent && labelLength <= 999 ? offset + 1 : undefined
    }
    if (!isMarkdownWhitespace(lineText.charCodeAt(offset))) {
      hasLabelContent = true
    }
  }
  // Reference labels may span lines; footnote labels stay single-line.
  return sawCloser || footnote ? undefined : 'label-open'
}

type MarkdownDefinitionTail = Readonly<{
  kind: 'destination' | 'destination-title' | 'title-open'
  titleCloseCodeUnit?: number | undefined
}>

function referenceDefinitionTailInLine(
  lineText: string,
  start: number
): MarkdownDefinitionTail | undefined {
  const end = lineText.length
  let offset = start
  while (offset < end && isSpaceOrTab(lineText.charCodeAt(offset))) {
    offset += 1
  }
  if (offset >= end) {
    return undefined
  }
  if (lineText.charCodeAt(offset) === 60) {
    offset += 1
    let closed = false
    while (offset < end) {
      const codeUnit = lineText.charCodeAt(offset)
      if (codeUnit === 92 && offset + 1 < end) {
        offset += 2
        continue
      }
      if (codeUnit === 60 || codeUnit === 10 || codeUnit === 13) {
        return undefined
      }
      if (codeUnit === 62) {
        offset += 1
        closed = true
        break
      }
      offset += 1
    }
    if (!closed) {
      return undefined
    }
  } else {
    const destinationStart = offset
    let depth = 0
    while (offset < end) {
      const codeUnit = lineText.charCodeAt(offset)
      if (codeUnit === 92 && offset + 1 < end) {
        offset += 2
        continue
      }
      if (codeUnit === 40) {
        depth += 1
        if (depth > 32) {
          return undefined
        }
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
    if (offset === destinationStart || depth !== 0) {
      return undefined
    }
  }
  const destinationEnd = offset
  while (offset < end && isSpaceOrTab(lineText.charCodeAt(offset))) {
    offset += 1
  }
  if (offset === end) {
    return Object.freeze({ kind: 'destination' as const })
  }
  if (offset === destinationEnd) {
    return undefined
  }
  const titleOpen = lineText.charCodeAt(offset)
  const titleClose = titleOpen === 40 ? 41 : titleOpen
  if (titleOpen !== 34 && titleOpen !== 39 && titleOpen !== 40) {
    return undefined
  }
  offset += 1
  while (offset < end) {
    const codeUnit = lineText.charCodeAt(offset)
    if (codeUnit === 92 && offset + 1 < end) {
      offset += 2
      continue
    }
    if (codeUnit === titleClose) {
      offset += 1
      while (offset < end && isSpaceOrTab(lineText.charCodeAt(offset))) {
        offset += 1
      }
      return offset === end
        ? Object.freeze({ kind: 'destination-title' as const })
        : undefined
    }
    offset += 1
  }
  return Object.freeze({
    kind: 'title-open' as const,
    titleCloseCodeUnit: titleClose
  })
}

function definitionOpening(
  lineText: string,
  state: ContainerLineState,
  paragraphOpen: boolean = false,
  lineComplete: boolean = true,
  footnotesEnabled: boolean = true
): MarkdownDefinitionStep | undefined {
  if (paragraphOpen) {
    // A link reference definition cannot interrupt a paragraph.
    return undefined
  }
  const colon = definitionColonInLine(lineText, state, footnotesEnabled)
  if (colon === undefined) {
    return undefined
  }
  if (colon === 'label-open') {
    // A still-open label only means something when the whole line has been
    // seen — a retained partial line may still close it as an inline link.
    return lineComplete
      ? Object.freeze({ phase: 'reference-label' as const })
      : undefined
  }
  if (footnotesEnabled && lineText.charCodeAt(state.contentOffset + 1) === 94) {
    return Object.freeze({ phase: 'footnote' as const, footnoteBodyOffset: colon + 1 })
  }
  let tailStart = colon + 1
  while (tailStart < lineText.length && isSpaceOrTab(lineText.charCodeAt(tailStart))) {
    tailStart += 1
  }
  if (tailStart === lineText.length) {
    return Object.freeze({ phase: 'reference-destination' as const })
  }
  const tail = referenceDefinitionTailInLine(lineText, colon + 1)
  if (tail === undefined) {
    return undefined
  }
  // A title on the definition's own line completes it; no later line can
  // add another.
  return tail.kind === 'title-open'
    ? Object.freeze({
      phase: 'reference-title-open' as const,
      titleCloseCodeUnit: tail.titleCloseCodeUnit
    })
    : Object.freeze({
      phase: tail.kind === 'destination-title'
        ? 'reference-title' as const
        : 'reference' as const
    })
}

function isValidReferenceTitleLine(
  lineText: string,
  state: ContainerLineState
): boolean {
  let offset = state.contentOffset
  const titleOpen = lineText.charCodeAt(offset)
  const titleClose = titleOpen === 40 ? 41 : titleOpen
  if (titleOpen !== 34 && titleOpen !== 39 && titleOpen !== 40) {
    return false
  }
  offset += 1
  while (offset < lineText.length) {
    const codeUnit = lineText.charCodeAt(offset)
    if (codeUnit === 92 && offset + 1 < lineText.length) {
      offset += 2
      continue
    }
    if (codeUnit === titleClose) {
      offset += 1
      while (
        offset < lineText.length &&
        isSpaceOrTab(lineText.charCodeAt(offset))
      ) {
        offset += 1
      }
      return offset === lineText.length
    }
    offset += 1
  }
  return false
}

function definitionContinuationPhase(
  lineText: string,
  state: ContainerLineState,
  definition: MarkdownDefinitionState
): MarkdownDefinitionStep | 'invalid' | undefined {
  if (definition.phase === 'footnote') {
    return state.blank || state.indentation >= 2
      ? Object.freeze({ phase: 'footnote' as const })
      : undefined
  }
  // A reference definition is read from the start of a paragraph, so a line
  // that would not continue that paragraph ends the definition as a blank
  // line does: a new container, a setext underline, or an interrupting block.
  const paragraphEnds = state.setextUnderline ||
    !isLazyParagraphContinuation(lineText, state)
  if (definition.phase === 'reference-label') {
    if (paragraphEnds) {
      return 'invalid'
    }
    for (let offset = state.contentOffset; offset < lineText.length; offset += 1) {
      const codeUnit = lineText.charCodeAt(offset)
      if (codeUnit === 92 && offset + 1 < lineText.length) {
        offset += 1
        continue
      }
      if (codeUnit === 91) {
        return 'invalid'
      }
      if (codeUnit === 93) {
        if (lineText.charCodeAt(offset + 1) !== 58) {
          return 'invalid'
        }
        let tailStart = offset + 2
        while (
          tailStart < lineText.length &&
          isSpaceOrTab(lineText.charCodeAt(tailStart))
        ) {
          tailStart += 1
        }
        if (tailStart === lineText.length) {
          return Object.freeze({ phase: 'reference-destination' as const })
        }
        const tail = referenceDefinitionTailInLine(lineText, offset + 2)
        if (tail === undefined) {
          return 'invalid'
        }
        return tail.kind === 'title-open'
          ? Object.freeze({
            phase: 'reference-title-open' as const,
            titleCloseCodeUnit: tail.titleCloseCodeUnit
          })
          : Object.freeze({
            phase: tail.kind === 'destination-title'
              ? 'reference-title' as const
              : 'reference' as const
          })
      }
    }
    return Object.freeze({ phase: 'reference-label' as const })
  }
  if (definition.phase === 'reference-destination') {
    if (paragraphEnds) {
      return 'invalid'
    }
    const tail = referenceDefinitionTailInLine(lineText, state.contentOffset)
    if (tail === undefined) {
      return 'invalid'
    }
    return tail.kind === 'title-open'
      ? Object.freeze({
        phase: 'reference-title-open' as const,
        titleCloseCodeUnit: tail.titleCloseCodeUnit
      })
      : Object.freeze({
        phase: tail.kind === 'destination-title'
          ? 'reference-title' as const
          : 'reference' as const
      })
  }
  if (definition.phase === 'reference-title-open') {
    if (paragraphEnds) {
      return 'invalid'
    }
    for (let offset = state.contentOffset; offset < lineText.length; offset += 1) {
      const codeUnit = lineText.charCodeAt(offset)
      if (codeUnit === 92 && offset + 1 < lineText.length) {
        offset += 1
        continue
      }
      if (codeUnit === definition.titleCloseCodeUnit) {
        let rest = offset + 1
        while (rest < lineText.length && isSpaceOrTab(lineText.charCodeAt(rest))) {
          rest += 1
        }
        return rest === lineText.length
          ? Object.freeze({ phase: 'reference-title' as const })
          : 'invalid'
      }
    }
    return Object.freeze({
      phase: 'reference-title-open' as const,
      titleCloseCodeUnit: definition.titleCloseCodeUnit
    })
  }
  return !paragraphEnds && isValidReferenceTitleLine(lineText, state)
    ? Object.freeze({ phase: 'reference-title' as const })
    : undefined
}

/**
 * An unescaped Addition, Deletion or Substitution closer begins at `offset`;
 * these are the boundaries L2b lets stand against an in-arm definition.
 */
function isArmCloserAt(source: string, offset: number): boolean {
  const first = source.charCodeAt(offset)
  return (first === 43 || first === 45 || first === 126) &&
    source.charCodeAt(offset + 1) === first &&
    source.charCodeAt(offset + 2) === 125 &&
    hasEvenBackslashRunBefore(source, offset)
}

function completedDefinitionLiteral(
  definition: MarkdownDefinitionState,
  end: number
): MarkdownLiteralRange {
  return Object.freeze({
    kind: 'definition',
    start: definition.openStart,
    end,
    ...(definition.phase === 'footnote'
      ? { blockKind: 'footnote-definition' as const }
      : {})
  })
}

function isFenceCloserLine(
  lineText: string,
  state: ContainerLineState,
  fence: MarkdownFenceState
): boolean {
  // An open fence takes the whole line once its containers continue, so a
  // marker such as `>` there is code text and cannot introduce a closer.
  if (state.openers.length > 0 || !continuesBlockContainer(state, fence.container)) {
    return false
  }
  return isMarkdownFenceCloser(
    lineText,
    state.contentOffset,
    state.indentation,
    state.blank,
    fence
  )
}

/**
 * Upstream's diagram types (`diagramTypeOfLang`). A fence is a diagram only
 * when its info string's first word is one of them exactly; `Mermaid` is code.
 */
export const DIAGRAM_FENCE_LANGUAGES: ReadonlySet<string> = new Set([
  'flowchart',
  'mermaid',
  'plantuml',
  'sequence',
  'vega-lite'
])

function fencedLiteralProvider(
  lineText: string,
  openerEnd: number,
  texMathGfmEnabled: boolean = true
): MarkdownFenceState['provider'] {
  const info = lineText.slice(openerEnd).trim()
  // The fence rides tex_math_gfm alone, without the dollar extension (#5446).
  if (info.toLowerCase() === 'math' && texMathGfmEnabled) {
    return 'math'
  }
  const language = info.split(/[\t ]/, 1)[0] ?? ''
  return DIAGRAM_FENCE_LANGUAGES.has(language) ? 'diagram' : 'fenced-code'
}

function blockContainerFrom(state: ContainerLineState): MarkdownBlockContainer {
  return Object.freeze({
    path: Object.freeze([...state.activeContainers])
  })
}

function continuesBlockContainer(
  state: ContainerLineState,
  container: MarkdownBlockContainer
): boolean {
  if (state.continuedContainerDepth < container.path.length) {
    return false
  }
  for (let index = 0; index < container.path.length; index += 1) {
    if (state.activeContainers[index] !== container.path[index]) {
      return false
    }
  }
  return true
}

/**
 * Whether indented code continues on this line: a blank line keeps it open,
 * other lines need four columns of indentation inside its container. A
 * marker that opens a container here means the line is not code at all.
 */
function continuesIndentedCode(
  state: ContainerLineState,
  container: MarkdownBlockContainer
): boolean {
  if (state.openers.length > 0) return false
  return state.blank ||
    (state.indentation >= 4 && continuesBlockContainer(state, container))
}

function firstRunIndexAtLeast(
  starts: readonly number[],
  after: number
): number {
  let low = 0
  let high = starts.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if ((starts[middle] ?? Number.POSITIVE_INFINITY) < after) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

function firstRunStartAtLeast(
  starts: readonly number[] | undefined,
  after: number
): number | undefined {
  if (starts === undefined) {
    return undefined
  }
  let low = 0
  let high = starts.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if ((starts[middle] ?? Number.POSITIVE_INFINITY) < after) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return starts[low]
}

// Closer lookups partition run starts by matching-scope id up front, so a
// lookup never walks cross-scope candidates (that walk was quadratic on
// scope-dense views — one rejected probe per later run, per opener). The
// plain-reparse hazard the walk used to report survives as a single global
// successor check: the one run an unconstrained reparse would actually pair
// with is rejected when it sits in a different scope.
function scopePartitionedRunStarts(
  startsByLength: ReadonlyMap<number, readonly number[]>,
  matchingPolicy: MarkdownMatchingScopePolicy
): ReadonlyMap<number, ReadonlyMap<number, readonly number[]>> {
  const buckets = new Map<number, Map<number, number[]>>()
  for (const [length, starts] of startsByLength) {
    const byScope = new Map<number, number[]>()
    for (const start of starts) {
      const scopeId = matchingPolicy.matchingScopeAt(start)?.id ?? -1
      const bucket = byScope.get(scopeId)
      if (bucket === undefined) {
        byScope.set(scopeId, [start])
      } else {
        bucket.push(start)
      }
    }
    buckets.set(length, byScope)
  }
  return buckets
}

function createNextBacktickRunStart(
  source: string,
  matchingPolicy?: MarkdownMatchingScopePolicy,
  execution?: ParseExecutionTracker
): NextBacktickRunStart {
  const startsByLength = new Map<number, number[]>()
  let reportedOffset = 0
  const reportThrough = (offset: number): void => {
    if (
      execution !== undefined &&
      offset - reportedOffset >= PARSE_SOURCE_CHECKPOINT_INTERVAL
    ) {
      execution.examineParserWork(offset - reportedOffset)
      reportedOffset = offset
    }
  }
  // A code span is paragraph content and no paragraph crosses a blank line,
  // so a run after the next blank line can never close an opener.
  const blankLineStarts: number[] = []
  let lineStart = -1
  let lineBlank = false
  for (let offset = 0; offset < source.length;) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 10 || codeUnit === 13) {
      if (lineBlank) blankLineStarts.push(lineStart)
      offset += codeUnit === 13 && source.charCodeAt(offset + 1) === 10 ? 2 : 1
      lineStart = offset
      lineBlank = true
      reportThrough(offset)
      continue
    }
    if (codeUnit !== 32 && codeUnit !== 9) lineBlank = false
    if (codeUnit !== 96) {
      offset += 1
      reportThrough(offset)
      continue
    }
    const runLimit = matchingPolicy?.delimiterRunLimit?.(offset, source.length) ?? source.length
    let runEnd = offset + 1
    while (runEnd < runLimit && source.charCodeAt(runEnd) === 96) {
      runEnd += 1
      reportThrough(runEnd)
    }
    const markerLength = runEnd - offset
    const starts = startsByLength.get(markerLength)
    if (starts === undefined) {
      startsByLength.set(markerLength, [offset])
    } else {
      starts.push(offset)
    }
    offset = runEnd
    reportThrough(offset)
  }
  execution?.examineParserWork(source.length - reportedOffset)
  const scopedStarts =
    matchingPolicy === undefined
      ? undefined
      : scopePartitionedRunStarts(startsByLength, matchingPolicy)
  const paragraphLimit = (after: number, laneEnd: number): number =>
    Math.min(laneEnd, firstRunStartAtLeast(blankLineStarts, after) ?? laneEnd)

  return (
    markerLength: number,
    openerStart: number,
    after: number,
    laneEnd: number
  ): number | undefined => {
    laneEnd = paragraphLimit(after, laneEnd)
    if (matchingPolicy === undefined || scopedStarts === undefined) {
      const start = firstRunStartAtLeast(startsByLength.get(markerLength), after)
      return start !== undefined && start < laneEnd ? start : undefined
    }
    matchingPolicy.recordInlineCodeCloserQuery?.(openerStart, after)
    const openerScopeId = matchingPolicy.matchingScopeAt(openerStart)?.id ?? -1
    const sameScope = firstRunStartAtLeast(
      scopedStarts.get(markerLength)?.get(openerScopeId),
      after
    )
    const closer =
      sameScope !== undefined && sameScope < laneEnd ? sameScope : undefined
    if (closer !== undefined) {
      matchingPolicy.recordInlineCodeCloserCandidate?.(
        closer,
        closer + markerLength
      )
    }
    const globalNext = firstRunStartAtLeast(
      startsByLength.get(markerLength),
      after
    )
    if (
      globalNext !== undefined &&
      globalNext < laneEnd &&
      globalNext !== closer
    ) {
      matchingPolicy.recordInlineCodeCloserCandidate?.(
        globalNext,
        globalNext + markerLength
      )
      matchingPolicy.rejectCrossScopeMatch(openerStart, globalNext)
    }
    return closer
  }
}

function isMarkdownWhitespace(codeUnit: number): boolean {
  return codeUnit === 9 || codeUnit === 10 || codeUnit === 13 || codeUnit === 32
}

function createNextMathRunStart(
  source: string,
  matchingPolicy?: MarkdownMatchingScopePolicy,
  execution?: ParseExecutionTracker
): NextMathRunStart {
  // Every unescaped `$`, one entry per character: upstream's editor retries
  // an opener at each `$`, including inside a run of them.
  const dollars: number[] = []
  let reportedOffset = 0
  for (let offset = source.indexOf('$'); offset >= 0; offset = source.indexOf('$', offset + 1)) {
    if (hasEvenBackslashRunBefore(source, offset)) dollars.push(offset)
    if (
      execution !== undefined &&
      offset - reportedOffset >= PARSE_SOURCE_CHECKPOINT_INTERVAL
    ) {
      execution.examineParserWork(offset - reportedOffset)
      reportedOffset = offset
    }
  }
  execution?.examineParserWork(source.length - reportedOffset)

  const startsByLength = new Map<number, readonly number[]>([[0, dollars]])
  const scopedStarts =
    matchingPolicy === undefined
      ? undefined
      : scopePartitionedRunStarts(startsByLength, matchingPolicy)

  // pandoc's `tex_math_dollars`, as upstream's editor rule reads it (#5446,
  // #4904): a single `$` closes on the first unescaped `$` after it, which
  // must stand alone with no space before it and no digit after it; `$$`
  // closes on the first `$$`, which must not continue into a third `$`.
  // Elided CriticMarkup arm markers end a run, so `$` across them never joins.
  const joinsDollar = (start: number, next: number): boolean =>
    source.charCodeAt(next) === 36 &&
    (matchingPolicy?.delimiterRunLimit?.(start, source.length) ?? source.length) > next
  const candidate = (
    starts: readonly number[] | undefined,
    delimiterLength: number,
    after: number
  ): number | undefined => {
    if (starts === undefined) return undefined
    let index = firstRunIndexAtLeast(starts, after)
    if (delimiterLength === 2) {
      while (index < starts.length && !joinsDollar(starts[index] ?? 0, (starts[index] ?? 0) + 1)) {
        index += 1
      }
    }
    return starts[index]
  }
  const closes = (delimiterLength: number, after: number, start: number): boolean => {
    if (start <= after) return false
    // `\1(?!\1)`: a `$` closer may not touch another `$`; a `$$` closer may
    // not be followed by another `$$`.
    if (delimiterLength === 2) {
      return !(joinsDollar(start, start + 2) && joinsDollar(start, start + 3))
    }
    if (joinsDollar(start, start + 1)) return false
    if (isMarkdownWhitespace(source.charCodeAt(start - 1))) return false
    const next = source.charCodeAt(start + 1)
    return !(next >= 48 && next <= 57)
  }

  return (
    delimiterLength: number,
    openerStart: number,
    after: number,
    laneEnd: number,
    // Whether a closer at a start would complete the opener's span, as the
    // paragraph it opens in allows; a run it could not reach is no match to
    // reject.
    reaches: (closeStart: number) => boolean = () => true
  ): number | undefined => {
    if (delimiterLength > 2) return undefined
    if (matchingPolicy === undefined || scopedStarts === undefined) {
      const start = candidate(dollars, delimiterLength, after)
      return start !== undefined && start < laneEnd && closes(delimiterLength, after, start)
        ? start
        : undefined
    }
    const openerScopeId = matchingPolicy.matchingScopeAt(openerStart)?.id ?? -1
    const sameScope = candidate(scopedStarts.get(0)?.get(openerScopeId), delimiterLength, after)
    const closer =
      sameScope !== undefined && sameScope < laneEnd && closes(delimiterLength, after, sameScope)
        ? sameScope
        : undefined
    const globalNext = candidate(dollars, delimiterLength, after)
    if (
      globalNext !== undefined &&
      globalNext < laneEnd &&
      globalNext !== closer &&
      closes(delimiterLength, after, globalNext) &&
      reaches(globalNext)
    ) {
      matchingPolicy.rejectCrossScopeMatch(openerStart, globalNext)
    }
    return closer
  }
}

/**
 * pandoc's optional math delimiters as upstream's editor reads them (#5446):
 * `` $`…`$ `` (tex_math_gfm), `\(…\)`/`\[…\]` (tex_math_single_backslash,
 * where `\\` inside stays a literal backslash) and `\\(…\\)`/`\\[…\\]`
 * (tex_math_double_backslash, closed by the first literal closer). The
 * opener is an unescaped character, so these run ahead of escapes.
 */
function findOptionalMathSpan(
  source: string,
  offset: number,
  laneEnd: number,
  gfm: boolean,
  singleBackslash: boolean,
  doubleBackslash: boolean
): MarkdownMathState | undefined {
  const first = source.charCodeAt(offset)
  if (gfm && first === 36 && source.charCodeAt(offset + 1) === 96) {
    for (let index = offset + 2; index < laneEnd; index += 1) {
      const codeUnit = source.charCodeAt(index)
      if (codeUnit === 92) {
        index += 1
        continue
      }
      if (codeUnit === 96) {
        return index > offset + 2 && index + 1 < laneEnd && source.charCodeAt(index + 1) === 36
          ? Object.freeze({ openStart: offset, delimiterLength: 2, closeStart: index, form: 'gfm' as const })
          : undefined
      }
    }
    return undefined
  }
  if (first !== 92) return undefined
  const second = source.charCodeAt(offset + 1)
  if (doubleBackslash && second === 92) {
    const opener = source.charCodeAt(offset + 2)
    if (opener === 40 || opener === 91) {
      const closer = source.indexOf(opener === 40 ? '\\\\)' : '\\\\]', offset + 4)
      if (closer >= 0 && closer + 3 <= laneEnd) {
        return Object.freeze({ openStart: offset, delimiterLength: 3, closeStart: closer, form: 'double-backslash' as const })
      }
    }
  }
  if (singleBackslash && (second === 40 || second === 91)) {
    const close = second === 40 ? 41 : 93
    for (let index = offset + 2; index + 1 < laneEnd; index += 1) {
      if (source.charCodeAt(index) !== 92) continue
      if (source.charCodeAt(index + 1) === close) {
        return index > offset + 2
          ? Object.freeze({ openStart: offset, delimiterLength: 2, closeStart: index, form: 'single-backslash' as const })
          : undefined
      }
      index += 1
    }
  }
  return undefined
}

function materializeMarkdownLine(path: MarkdownLinePath | undefined): string {
  if (path === undefined) {
    return ''
  }
  const cached = cachedMaterializedLinePath(path)
  if (cached !== undefined) {
    return cached
  }
  // Climb only the uncached suffix, then memoize every node on the way back
  // down. Checkpoints along one line materialize sibling prefixes of the same
  // chain, so per-node memoization makes the total walk amortized-linear in
  // chain nodes — walking each prefix from scratch was the single-line
  // family's measured superlinearity (R-4 gate in the linearity spec).
  const pending: MarkdownLinePath[] = []
  let base = ''
  for (
    let current: MarkdownLinePath | undefined = path;
    current !== undefined;
    current = current.parent
  ) {
    const ancestor = cachedMaterializedLinePath(current)
    if (ancestor !== undefined) {
      base = ancestor
      break
    }
    current.recorder?.recordLineMaterializationChunkWalk()
    pending.push(current)
  }
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const node = pending[index]
    if (node === undefined) {
      continue
    }
    base += node.text
    retainMaterializedLinePath(node, base)
  }
  return base
}

function linePathSourceOffsetAt(
  path: MarkdownLinePath | undefined,
  virtualOffset: number
): number | undefined {
  const chunks: MarkdownLinePath[] = []
  let current = path
  while (current !== undefined) {
    chunks.push(current)
    current = current.parent
  }
  chunks.reverse()
  let remaining = virtualOffset
  for (const chunk of chunks) {
    if (remaining < chunk.text.length) {
      return chunk.sourceStart + remaining
    }
    remaining -= chunk.text.length
  }
  return undefined
}

function probeSourceOffsetAt(
  prefixPath: MarkdownLinePath | undefined,
  prefixLength: number,
  textSourceStart: number,
  textLength: number,
  suffixSourceStart: number,
  virtualOffset: number
): number {
  if (virtualOffset < prefixLength) {
    return linePathSourceOffsetAt(prefixPath, virtualOffset) ?? textSourceStart
  }
  const textOffset = virtualOffset - prefixLength
  return textOffset < textLength
    ? textSourceStart + textOffset
    : suffixSourceStart + textOffset - textLength
}

function sourceLineContentEnd(
  source: string,
  start: number,
  limit: number,
  execution?: ParseExecutionTracker
): number {
  let end = start
  let reportedEnd = start
  while (
    end < limit &&
    source.charCodeAt(end) !== 10 &&
    source.charCodeAt(end) !== 13
  ) {
    end += 1
    if (
      execution !== undefined &&
      end - reportedEnd >= PARSE_SOURCE_CHECKPOINT_INTERVAL
    ) {
      execution.examineParserWork(end - reportedEnd)
      reportedEnd = end
    }
  }
  execution?.examineParserWork(end - reportedEnd)
  return end
}

function sourceLineEnd(source: string, contentEnd: number, limit: number): number {
  if (contentEnd >= limit) {
    return contentEnd
  }
  if (
    source.charCodeAt(contentEnd) === 13 &&
    contentEnd + 1 < limit &&
    source.charCodeAt(contentEnd + 1) === 10
  ) {
    return contentEnd + 2
  }
  const codeUnit = source.charCodeAt(contentEnd)
  return codeUnit === 10 || codeUnit === 13 ? contentEnd + 1 : contentEnd
}

function trimMarkdownLineWhitespace(value: string): string {
  let start = 0
  let end = value.length
  while (
    start < end &&
    (value.charCodeAt(start) === 32 || value.charCodeAt(start) === 9)
  ) {
    start += 1
  }
  while (
    end > start &&
    (value.charCodeAt(end - 1) === 32 || value.charCodeAt(end - 1) === 9)
  ) {
    end -= 1
  }
  return value.slice(start, end)
}

function frontMatterOpeningStyle(line: string): FrontMatterPolicy['style'] | undefined {
  const delimiter = trimMarkdownLineWhitespace(line)
  const style = delimiter[0]
  if (style !== '-' && style !== '+' && style !== ';' && style !== '{') return undefined
  return frontMatterPolicy(style).open === delimiter ? style : undefined
}

function isFrontMatterDelimiter(line: string, style: FrontMatterPolicy['style']): boolean {
  const delimiter = trimMarkdownLineWhitespace(line)
  return delimiter === frontMatterPolicy(style).close || (style === '-' && delimiter === '...')
}

function hasFrontMatterCloser(
  source: string,
  start: number,
  limit: number,
  style: FrontMatterPolicy['style']
): boolean {
  for (let lineStart = start; lineStart < limit;) {
    const contentEnd = sourceLineContentEnd(source, lineStart, limit)
    if (isFrontMatterDelimiter(source.slice(lineStart, contentEnd), style)) {
      return true
    }
    const next = sourceLineEnd(source, contentEnd, limit)
    if (next <= lineStart) {
      break
    }
    lineStart = next
  }
  return false
}

function hasEvenLaneBackslashRunBefore(
  source: string,
  offset: number,
  runStart: number,
  inheritedOdd: boolean
): boolean {
  let start = offset
  while (start > runStart && source.charCodeAt(start - 1) === 92) {
    start -= 1
  }
  const localOdd = (offset - start) % 2 === 1
  return start === runStart && inheritedOdd
    ? localOdd
    : !localOdd
}

function trailingBackslashParity(text: string, inheritedOdd: boolean): boolean {
  let start = text.length
  while (start > 0 && text.charCodeAt(start - 1) === 92) {
    start -= 1
  }
  const localOdd = (text.length - start) % 2 === 1
  return start === 0 && inheritedOdd
    ? !localOdd
    : localOdd
}

function hasEvenBackslashRunBeforeText(text: string, offset: number): boolean {
  let start = offset
  while (start > 0 && text.charCodeAt(start - 1) === 92) {
    start -= 1
  }
  return (offset - start) % 2 === 0
}

function retainImageBracketOpeners(
  path: MarkdownBracketPath | undefined
): MarkdownBracketPath | undefined {
  const images: MarkdownBracketPath[] = []
  for (let cursor = path; cursor !== undefined; cursor = cursor.parent) {
    if (cursor.kind === 'image') {
      images.push(cursor)
    }
  }
  let retained: MarkdownBracketPath | undefined
  for (let index = images.length - 1; index >= 0; index -= 1) {
    const image = images[index]
    if (image !== undefined) {
      retained = Object.freeze({
        parent: retained,
        kind: 'image',
        bracketStart: image.bracketStart,
        start: image.start,
        labelStart: image.labelStart,
        matchingScopeId: image.matchingScopeId,
        matchingScopeDepth: image.matchingScopeDepth
      })
    }
  }
  return retained
}

export function createMarkdownLaneState(
  source: string,
  containerDepthLimit: number = Number.POSITIVE_INFINITY,
  referenceDefinitions: MarkdownReferenceDefinitionLookup =
  EMPTY_REFERENCE_DEFINITIONS,
  matchingScopePolicy?: MarkdownMatchingScopePolicy,
  frontMatterEnabled: boolean = true,
  gfmEnabled: boolean = true,
  gfmAutolinksEnabled: boolean = true,
  mathEnabled: boolean = true,
  texMathGfmEnabled: boolean = true,
  texMathSingleBackslashEnabled: boolean = false,
  texMathDoubleBackslashEnabled: boolean = false,
  footnotesEnabled: boolean = true,
  execution?: ParseExecutionTracker,
  hasCriticMarkupCandidate?: boolean,
  physicalRecorder?: Profile1PhysicalTraversalRecorderV1
): MarkdownLaneState {
  const lineBlockProbeCanPersist = hasCriticMarkupCandidate === undefined
    ? ![
      '{++',
      '++}',
      '{--',
      '--}',
      '{~~',
      '~>',
      '~~}',
      '{==',
      '==}',
      '{>>',
      '<<}'
    ].some((marker) => source.includes(marker))
    : !hasCriticMarkupCandidate
  const linePathsWithBlockProbe = new WeakSet<MarkdownLinePath>()
  const nextBacktickRunStart = createNextBacktickRunStart(
    source,
    matchingScopePolicy,
    execution
  )
  const nextMathRunStart = createNextMathRunStart(
    source,
    matchingScopePolicy,
    execution
  )
  const matchingScopeAtOffset = (
    offset: number
  ): Readonly<{ readonly id: number; readonly depth: number }> =>
    matchingScopePolicy?.matchingScopeAt(offset) ??
    Object.freeze({ id: -1, depth: -1 })
  const bracketOpenerScopeHasExited = (
    opener: MarkdownBracketPath,
    current: Readonly<{ readonly id: number; readonly depth: number }>
  ): boolean =>
    opener.matchingScopeDepth > current.depth ||
    (
      opener.matchingScopeDepth === current.depth &&
      opener.matchingScopeId !== current.id
    )
  const authenticateRetargetedBracketCloser = (
    parentPath: MarkdownBracketPath | undefined,
    closerStart: number
  ): void => {
    if (parentPath === undefined) {
      return
    }
    const closerScope = matchingScopeAtOffset(closerStart)
    if (bracketOpenerScopeHasExited(parentPath, closerScope)) {
      throw new Error('Pending Markdown label retained an inactive parent')
    }
    if (
      parentPath.matchingScopeDepth < closerScope.depth
    ) {
      matchingScopePolicy?.rejectCrossScopeMatch(
        parentPath.bracketStart,
        closerStart
      )
    }
  }

  const firstExcessContainer = (
    state: ContainerLineState
  ): MarkdownContainerOpener | undefined =>
    state.openers.find((opener) => opener.observed > containerDepthLimit)

  // A code span or inline math span is paragraph content, so a closing run on
  // a later line counts only when every line up to it continues the opener's
  // paragraph. The closer searches stop at blank lines; a heading, fence,
  // list item or other interrupting line ends the paragraph too, and
  // treating the span as open across it made markers before that line
  // literal although the span never closes. Paragraph ends are memoized by
  // line start so each line is examined once per lane state.
  let sourceLineStarts: number[] | undefined
  const rawLineStartAt = (offset: number): number => {
    if (sourceLineStarts === undefined) {
      sourceLineStarts = [0]
      for (let index = 0; index < source.length; index += 1) {
        const codeUnit = source.charCodeAt(index)
        if (codeUnit === 13 && source.charCodeAt(index + 1) === 10) continue
        if (codeUnit === 10 || codeUnit === 13) sourceLineStarts.push(index + 1)
      }
    }
    const starts = sourceLineStarts
    const index = firstRunIndexAtLeast(starts, offset + 1)
    return starts[index - 1] ?? 0
  }
  const paragraphEndByLineStart = new Map<number, Readonly<{
    end: number
    laneLimited: boolean
  }>>()
  // Where each paragraph line after an opener's line begins its content,
  // past its container prefix, as the paragraph scan below finds it.
  const contentStartByLineStart = new Map<number, number>()
  const inlineLiteralParagraphEnd = (
    openerOffset: number,
    laneEnd: number,
    containers: readonly ActiveBlockContainer[],
    paragraphWasOpen: boolean
  ): number => {
    const openerLineStart = rawLineStartAt(openerOffset)
    const cached = paragraphEndByLineStart.get(openerLineStart)
    if (cached !== undefined && (!cached.laneLimited || cached.end >= laneEnd)) {
      return Math.min(cached.end, laneEnd)
    }
    const lineAt = (start: number): Readonly<{ text: string, next: number }> => {
      const contentEnd = sourceLineContentEnd(source, start, source.length, execution)
      return Object.freeze({
        text: source.slice(start, contentEnd),
        next: sourceLineEnd(source, contentEnd, source.length)
      })
    }
    const analyzed = (
      text: string,
      inherited: readonly ActiveBlockContainer[],
      open: boolean
    ): ContainerLineState => analyzeContainerLine(
      text,
      { start: 0, contentEnd: text.length, end: text.length },
      inherited,
      open
    )
    const visited = [openerLineStart]
    const openerLine = lineAt(openerLineStart)
    const openerState = analyzed(openerLine.text, containers, paragraphWasOpen)
    let end: number
    let laneLimited = false
    if (isAtxHeadingLine(openerLine.text, openerState)) {
      end = openerLine.next
    } else {
      let lineContainers = openerState.lazy ? containers : openerState.activeContainers
      let cursor = openerLine.next
      // A GFM table's header row is not paragraph text: the paragraph ends
      // before a line that a delimiter row below turns into one.
      let previous = Object.freeze({
        start: openerLineStart,
        text: openerLine.text,
        contentOffset: openerState.contentOffset
      })
      for (;;) {
        if (cursor >= laneEnd || cursor >= source.length) {
          end = Math.min(cursor, laneEnd)
          laneLimited = cursor >= laneEnd && laneEnd < source.length
          break
        }
        const line = lineAt(cursor)
        const state = analyzed(line.text, lineContainers, true)
        const continues = !state.blank && (
          (state.lazy && htmlBlockOpening(line.text, state, false) === undefined) ||
          (
            !state.lazy &&
            state.continuedContainerDepth === lineContainers.length &&
            !isSetextUnderline(line.text, state.contentOffset, state.lineContentEnd) &&
            isLazyParagraphContinuation(line.text, state)
          )
        )
        if (!continues) {
          end = cursor
          break
        }
        if (
          gfmEnabled &&
          !(state.lazy && lineContainers.at(-1)?.kind === 'blockquote') &&
          state.indentation <= 3 &&
          gfmTableDelimiterCellCount(line.text, state.contentOffset, line.text.length) ===
            (gfmTableHeaderCellCount(previous.text, previous.contentOffset, previous.text.length) ?? -1)
        ) {
          end = previous.start
          break
        }
        previous = Object.freeze({ start: cursor, text: line.text, contentOffset: state.contentOffset })
        contentStartByLineStart.set(cursor, cursor + state.contentOffset)
        visited.push(cursor)
        if (!state.lazy) lineContainers = state.activeContainers
        cursor = line.next
      }
    }
    const entry = Object.freeze({ end, laneLimited })
    for (const lineStart of visited) paragraphEndByLineStart.set(lineStart, entry)
    return end
  }
  /** Whether a closer found for an inline literal lies inside its opener's paragraph. */
  const inlineLiteralCloserInParagraph = (
    openerOffset: number,
    closeStart: number,
    laneEnd: number,
    containers: readonly ActiveBlockContainer[],
    paragraphWasOpen: boolean,
    // The opener is in a table row, whose inline syntax ends with the row.
    tableRow: boolean,
    doubleDollar: boolean = false,
    // The opener's line as the lane reads it, when that is not its raw line:
    // an arm's first line holds the text before the arm opener, not the marker.
    openerLineText?: string
  ): boolean => {
    const openerLineStart = rawLineStartAt(openerOffset)
    if (rawLineStartAt(closeStart) === openerLineStart) return true
    if (tableRow) return false
    if (doubleDollar) {
      // A `$$` alone on a line that starts a block opens a math block, which
      // spans blank lines; one continuing a paragraph is paragraph text, since
      // a math block cannot interrupt a paragraph.
      const text = openerLineText ?? source.slice(
        openerLineStart,
        sourceLineContentEnd(source, openerLineStart, source.length, execution)
      )
      const state = analyzeContainerLine(
        text,
        { start: 0, contentEnd: text.length, end: text.length },
        containers,
        paragraphWasOpen
      )
      if (!state.paragraphContinues && text.slice(state.contentOffset).trim() === '$$') return true
    }
    return closeStart < inlineLiteralParagraphEnd(
      openerOffset,
      laneEnd,
      containers,
      paragraphWasOpen
    )
  }

  // Whether the line after a paragraph line is a GFM delimiter row with as
  // many cells as that line, in its containers.
  const tableDelimiterFollows = (
    lineText: string,
    state: ContainerLineState,
    next: number
  ): boolean => {
    if (next >= source.length) return false
    const contentEnd = sourceLineContentEnd(source, next, source.length, execution)
    const text = source.slice(next, contentEnd)
    const following = analyzeContainerLine(
      text,
      { start: 0, contentEnd: text.length, end: text.length },
      state.activeContainers,
      true
    )
    return !following.blank &&
      following.openers.length === 0 &&
      !(following.lazy && state.activeContainers.at(-1)?.kind === 'blockquote') &&
      following.indentation <= 3 &&
      gfmTableDelimiterCellCount(text, following.contentOffset, text.length) ===
        (gfmTableHeaderCellCount(lineText, state.contentOffset, lineText.length) ?? -1)
  }

  /**
   * A raw HTML tag may run onto the paragraph's later lines, but not past
   * the paragraph. In a block quote those lines begin with a `>` marker,
   * which is no part of the tag, so a tag that does not close on its own
   * line is read with each later line's container prefix blanked out. Only
   * the next 64 lines are read: no tag spans more.
   */
  const inlineHtmlEndAcrossPrefixes = (
    offset: number,
    laneEnd: number,
    containers: readonly ActiveBlockContainer[],
    paragraphWasOpen: boolean,
    rawEnd: number | undefined
  ): number | undefined => {
    const lineEnd = sourceLineContentEnd(source, offset, laneEnd, execution)
    const next = source.charCodeAt(offset + 1)
    if (
      (rawEnd !== undefined && rawEnd <= lineEnd) ||
      !((next >= 65 && next <= 90) || (next >= 97 && next <= 122) || next === 47 || next === 33 || next === 63)
    ) {
      return rawEnd
    }
    const paragraphEnd = inlineLiteralParagraphEnd(offset, laneEnd, containers, paragraphWasOpen)
    if (paragraphEnd <= lineEnd) return rawEnd !== undefined && rawEnd <= lineEnd ? rawEnd : undefined
    let text = ''
    let cursor = offset
    let lines = 0
    let windowEnd = paragraphEnd
    for (
      let lineStart = sourceLineEnd(source, lineEnd, laneEnd);
      lineStart < paragraphEnd && lineStart > cursor;
      lineStart = sourceLineEnd(source, sourceLineContentEnd(source, lineStart, laneEnd, execution), laneEnd)
    ) {
      if (lines === 64) {
        windowEnd = lineStart
        break
      }
      lines += 1
      const contentStart = Math.min(contentStartByLineStart.get(lineStart) ?? lineStart, paragraphEnd)
      text += source.slice(cursor, lineStart) + ' '.repeat(contentStart - lineStart)
      cursor = contentStart
    }
    text += source.slice(cursor, windowEnd)
    const end = findInlineHtmlEnd(text, 0, text.length)
    return end === undefined ? undefined : offset + end
  }

  const advanceCore = (
    checkpoint: MarkdownCheckpoint,
    sourceStart: number,
    sourceEnd: number,
    laneStart: number,
    laneEnd: number,
    boundaryEnd: number,
    deferTerminalCarriageReturn: boolean
  ): MarkdownLaneAdvance => {
    if (checkpoint.pendingCarriageReturn !== undefined) {
      if (sourceStart < sourceEnd && source.charCodeAt(sourceStart) === 10) {
        checkpoint = Object.freeze({
          ...checkpoint,
          pendingCarriageReturn: undefined
        })
      } else {
        const pending = checkpoint.pendingCarriageReturn
        const completedCarriageReturn = advanceCore(
          Object.freeze({ ...checkpoint, pendingCarriageReturn: undefined }),
          pending.sourceStart,
          pending.sourceEnd,
          laneStart,
          laneEnd,
          boundaryEnd,
          false
        )
        const advanced = advanceCore(
          completedCarriageReturn.checkpoint,
          sourceStart,
          sourceEnd,
          laneStart,
          laneEnd,
          boundaryEnd,
          deferTerminalCarriageReturn
        )
        return Object.freeze({
          checkpoint: advanced.checkpoint,
          completedLiterals: Object.freeze([
            ...completedCarriageReturn.completedLiterals,
            ...advanced.completedLiterals
          ]),
          completedLines: Object.freeze([
            ...(completedCarriageReturn.completedLines ?? []),
            ...(advanced.completedLines ?? [])
          ])
        })
      }
    }
    if (
      deferTerminalCarriageReturn &&
      sourceEnd === sourceStart + 1 &&
      source.charCodeAt(sourceStart) === 13
    ) {
      return Object.freeze({
        checkpoint: Object.freeze({
          ...checkpoint,
          trailingBackslashOdd: false,
          pendingCarriageReturn: Object.freeze({ sourceStart, sourceEnd }),
          atVirtualBof: false
        }),
        completedLiterals: Object.freeze([])
      })
    }
    let text = source.slice(sourceStart, sourceEnd)
    let textSourceStart = sourceStart
    if (sourceStart === 0 && text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1)
      textSourceStart += 1
    }
    if (text.length === 0) {
      return Object.freeze({ checkpoint, completedLiterals: Object.freeze([]) })
    }

    const completedLiterals: MarkdownLiteralRange[] = []
    let inlineCode = checkpoint.inlineCode
    let math = checkpoint.math
    let mathOwnedUntil = checkpoint.mathOwnedUntil
    // A line that starts inside math is the math's text: no fence opens
    // there, though the math closes later on the line.
    const lineStartsInMath = (start: number): boolean =>
      (math !== undefined && math.openStart < start) || (mathOwnedUntil !== undefined && mathOwnedUntil > start)
    // The line holding an offset as this lane reads it, when the line began
    // before this text: text an earlier advance read, then this text, with no
    // CriticMarkup marker between them.
    const laneLineTextAt = (offset: number): string | undefined => {
      if (rawLineStartAt(offset) >= textSourceStart) return undefined
      for (let index = textSourceStart; index < offset; index += 1) {
        const code = source.charCodeAt(index)
        if (code === 10 || code === 13) return undefined
      }
      return materializeMarkdownLine(checkpoint.linePath) +
        source.slice(textSourceStart, sourceLineContentEnd(source, offset, laneEnd, execution))
    }
    let bracketPath = checkpoint.bracketPath
    let pendingLinkLabel = checkpoint.pendingLinkLabel
    let fixedInline = checkpoint.fixedInline
    let extendedAutolinkSuppressedUntil =
      checkpoint.extendedAutolinkSuppressedUntil ?? 0
    let activeContainers = checkpoint.activeContainers
    let paragraphOpen = checkpoint.paragraphOpen
    let definitionLazyContinuation = checkpoint.definitionLazyContinuation === true
    let tableOpen = checkpoint.tableOpen === true
    let listHolders = checkpoint.listItemsHoldingLists ?? NO_LIST_HOLDERS
    let tableHeaderCells = checkpoint.tableHeaderCells
    let lastLineLazy = checkpoint.lastLineLazy
    let lineStart = checkpoint.lineStart
    let fence = checkpoint.fence
    let lineBlockClosed = checkpoint.lineBlockClosed
    let frontMatterEligible = checkpoint.frontMatterEligible
    let frontMatter = checkpoint.frontMatter
    let indentedCode = checkpoint.indentedCode
    let htmlBlock = checkpoint.htmlBlock
    let definition = checkpoint.definition
    let firstContainerDepthFailure = checkpoint.firstContainerDepthFailure
    let enclosingLabelInterrupted = checkpoint.enclosingLabelInterrupted
    const trailingBackslashOdd = trailingBackslashParity(
      text,
      checkpoint.trailingBackslashOdd
    )
    const containsEol = text.includes('\n') || text.includes('\r')
    let lineBlockProbeEstablished =
      lineBlockProbeCanPersist &&
      checkpoint.linePath !== undefined &&
      linePathsWithBlockProbe.has(checkpoint.linePath)
    // Inline syntax pending from the previous line continues its paragraph,
    // but a footnote body's paragraph continues only while its definition does.
    const footnoteLineUnprobed =
      checkpoint.definition?.phase === 'footnote' &&
      checkpoint.definition.lineStart !== checkpoint.lineStart
    if (
      !containsEol &&
      (
        footnoteLineUnprobed ||
        (
          checkpoint.inlineCode === undefined &&
          checkpoint.math === undefined &&
          checkpoint.fixedInline === undefined
        )
      ) &&
      !lineBlockProbeEstablished
    ) {
      const inheritedPrefix = materializeMarkdownLine(checkpoint.linePath)
      const visibleThroughRun = inheritedPrefix + text
      const lookaheadEnd = sourceLineContentEnd(
        source,
        sourceEnd,
        laneEnd,
        execution
      )
      const probeLine = visibleThroughRun + source.slice(sourceEnd, lookaheadEnd)
      // Profile rule L2b: a definition line that an unescaped arm closer
      // interrupts is read as the arm-local fragment ending at that closer.
      const armFragmentLine =
        sourceEnd <= boundaryEnd &&
        boundaryEnd < lookaheadEnd &&
        isArmCloserAt(source, boundaryEnd)
          ? visibleThroughRun + source.slice(sourceEnd, boundaryEnd)
          : undefined
      const armFragmentState = armFragmentLine === undefined
        ? undefined
        : analyzeContainerLine(
          armFragmentLine,
          { start: 0, contentEnd: armFragmentLine.length, end: armFragmentLine.length },
          activeContainers,
          paragraphOpen,
          true,
          paragraphOpen || definitionLazyContinuation,
          tableOpen,
          undefined,
          listHolders
        )
      const probeState = analyzeContainerLine(
        probeLine,
        { start: 0, contentEnd: probeLine.length, end: probeLine.length },
        activeContainers,
        paragraphOpen,
        false,
        paragraphOpen || definitionLazyContinuation,
        tableOpen,
        { source, next: sourceLineEnd(source, lookaheadEnd, laneEnd) },
        listHolders
      )
      if (firstContainerDepthFailure === undefined) {
        const excess = firstExcessContainer(probeState)
        if (excess !== undefined) {
          const mapOffset = (virtualOffset: number): number =>
            probeSourceOffsetAt(
              checkpoint.linePath,
              inheritedPrefix.length,
              textSourceStart,
              text.length,
              sourceEnd,
              virtualOffset
            )
          firstContainerDepthFailure = Object.freeze({
            start: mapOffset(excess.start),
            end: mapOffset(excess.end - 1) + 1,
            observed: excess.observed
          })
        }
      }
      if (
        fence !== undefined &&
        lineStart !== fence.openLineStart &&
        !continuesBlockContainer(probeState, fence.container)
      ) {
        completedLiterals.push(Object.freeze({
          kind: fence.provider,
          start: fence.openStart,
          end: lineStart
        }))
        fence = undefined
      }
      if (
        htmlBlock !== undefined &&
        lineStart !== htmlBlock.openLineStart &&
        !continuesBlockContainer(probeState, htmlBlock.container)
      ) {
        completedLiterals.push(Object.freeze({
          kind: 'html-block',
          htmlTermination: htmlBlock.terminator === undefined ? 'blank-line' : 'explicit',
          start: htmlBlock.openStart,
          end: Math.min(htmlBlock.lastOwnedEnd, lineStart)
        }))
        htmlBlock = undefined
      }
      if (
        indentedCode !== undefined &&
        lineStart !== indentedCode.openLineStart &&
        !continuesIndentedCode(probeState, indentedCode.container)
      ) {
        completedLiterals.push(Object.freeze({
          kind: 'indented-code',
          start: indentedCode.openStart,
          end: indentedCode.lastCodeEnd
        }))
        indentedCode = undefined
      } else if (indentedCode !== undefined && !probeState.blank) {
        indentedCode = Object.freeze({
          ...indentedCode,
          lastCodeEnd: sourceLineEnd(source, lookaheadEnd, laneEnd)
        })
      }
      if (definition !== undefined && definition.lineStart !== lineStart) {
        let continuation = definitionContinuationPhase(
          probeLine,
          probeState,
          definition
        )
        if (
          continuation !== undefined &&
          continuation !== 'invalid' &&
          !definitionPhaseComplete(continuation.phase)
        ) {
          // An incomplete continuation stays pending across the closer.
        } else if (
          (continuation === 'invalid' || continuation === undefined) &&
          armFragmentLine !== undefined &&
          armFragmentState !== undefined
        ) {
          const fragmentContinuation = definitionContinuationPhase(
            armFragmentLine,
            armFragmentState,
            definition
          )
          if (
            fragmentContinuation !== undefined &&
            fragmentContinuation !== 'invalid'
          ) {
            continuation = fragmentContinuation
          }
        }
        if (continuation === 'invalid') {
          definition = undefined
        } else if (continuation === undefined) {
          completedLiterals.push(completedDefinitionLiteral(
            definition,
            definition.lastOwnedEnd
          ))
          if (definition.phase === 'footnote') {
            // Inline syntax opened in the footnote body ends with it.
            inlineCode = undefined
            if (math?.block !== true) math = undefined
            fixedInline = undefined
            bracketPath = undefined
            pendingLinkLabel = undefined
          }
          definition = undefined
        } else {
          definition = Object.freeze({
            ...definition,
            lineStart,
            phase: continuation.phase,
            titleCloseCodeUnit: continuation.titleCloseCodeUnit,
            lastOwnedEnd: sourceLineEnd(source, lookaheadEnd, laneEnd)
          })
        }
      }
      if (
        fence === undefined &&
        frontMatter === undefined &&
        indentedCode === undefined &&
        htmlBlock === undefined &&
        definition === undefined &&
        !lineStartsInMath(lineStart)
      ) {
        const opening = findMarkdownFenceOpening(
          probeLine,
          probeState.contentOffset,
          probeState.indentation,
          probeState.blank
        )
        if (opening !== undefined) {
          fence = Object.freeze({
            openStart: Math.max(
              laneStart,
              probeSourceOffsetAt(
                checkpoint.linePath,
                inheritedPrefix.length,
                textSourceStart,
                text.length,
                sourceEnd,
                opening.startOffset
              )
            ),
            openLineStart: lineStart,
            markerCodeUnit: opening.markerCodeUnit,
            openerLength: opening.openerLength,
            provider: fencedLiteralProvider(
              probeLine,
              opening.startOffset + opening.openerLength,
              texMathGfmEnabled
            ),
            container: blockContainerFrom(probeState)
          })
          activeContainers = probeState.activeContainers
          enclosingLabelInterrupted = true
          bracketPath = undefined
          pendingLinkLabel = undefined
        } else if (
          (!probeState.paragraphContinues || probeState.tableRowContinues) &&
          !probeState.blank &&
          probeState.lazyIndentation >= 4
        ) {
          indentedCode = Object.freeze({
            openStart: Math.max(
              laneStart,
              probeSourceOffsetAt(
                checkpoint.linePath,
                inheritedPrefix.length,
                textSourceStart,
                text.length,
                sourceEnd,
                0
              )
            ),
            openLineStart: lineStart,
            lastCodeEnd: sourceLineEnd(source, lookaheadEnd, laneEnd),
            container: blockContainerFrom(probeState)
          })
          activeContainers = probeState.activeContainers
          enclosingLabelInterrupted = true
          bracketPath = undefined
          pendingLinkLabel = undefined
        } else {
          // A complete HTML tag interrupts the paragraph on a lazy line, as
          // upstream and micromark read it: the block opens in the lazily
          // kept containers. So it does where a delimiter row below would
          // make the line a table's header: the table interrupts the
          // paragraph, and the HTML block starts first.
          const htmlOpening = htmlBlockOpening(
            probeLine,
            probeState,
            probeState.paragraphContinues && !probeState.lazy &&
              !(gfmEnabled && tableDelimiterFollows(
                probeLine,
                probeState,
                sourceLineEnd(source, lookaheadEnd, laneEnd)
              ))
          )
          if (htmlOpening !== undefined) {
            htmlBlock = Object.freeze({
              openStart: Math.max(
                laneStart,
                probeSourceOffsetAt(
                  checkpoint.linePath,
                  inheritedPrefix.length,
                  textSourceStart,
                  text.length,
                  sourceEnd,
                  0
                )
              ),
              openLineStart: lineStart,
              terminator: htmlOpening.terminator,
              lastOwnedEnd: sourceLineEnd(source, lookaheadEnd, laneEnd),
              container: blockContainerFrom(probeState)
            })
            activeContainers = probeState.activeContainers
            enclosingLabelInterrupted = true
            bracketPath = undefined
            pendingLinkLabel = undefined
          } else {
            const definitionKind = definitionOpening(
              probeLine,
              probeState,
              probeState.paragraphContinues,
              true,
              footnotesEnabled
            ) ?? (
              armFragmentLine === undefined || armFragmentState === undefined
                ? undefined
                : definitionOpening(
                  armFragmentLine,
                  armFragmentState,
                  armFragmentState.paragraphContinues,
                  true,
                  footnotesEnabled
                )
            )
            if (definitionKind !== undefined) {
              definition = Object.freeze({
                openStart: Math.max(
                  laneStart,
                  probeSourceOffsetAt(
                    checkpoint.linePath,
                    inheritedPrefix.length,
                    textSourceStart,
                    text.length,
                    sourceEnd,
                    0
                  )
                ),
                lastOwnedEnd: sourceLineEnd(source, lookaheadEnd, laneEnd),
                lineStart,
                phase: definitionKind.phase,
                titleCloseCodeUnit: definitionKind.titleCloseCodeUnit,
                footnoteBodyStart: definitionKind.footnoteBodyOffset === undefined
                  ? undefined
                  : probeSourceOffsetAt(
                    checkpoint.linePath,
                    inheritedPrefix.length,
                    textSourceStart,
                    text.length,
                    sourceEnd,
                    definitionKind.footnoteBodyOffset
                  )
              })
              activeContainers = probeState.activeContainers
              if (definitionKind.phase !== 'reference-label') {
                enclosingLabelInterrupted = true
                bracketPath = undefined
                pendingLinkLabel = undefined
              }
            }
          }
        }
      }
      lineBlockProbeEstablished = lineBlockProbeCanPersist
    }
    if (
      fence === undefined &&
      frontMatter === undefined &&
      indentedCode === undefined &&
      htmlBlock === undefined &&
      (
        definition === undefined ||
        !definitionOwnsMarkers(definition) ||
        (
          definition.phase === 'footnote' &&
          (definition.footnoteBodyStart ?? sourceEnd) < sourceEnd
        )
      )
    ) {
      // A footnote's label is not paragraph text; its body starts after `:`.
      const inlineStart = definition?.phase === 'footnote'
        ? Math.max(sourceStart, definition.footnoteBodyStart ?? sourceStart)
        : sourceStart
      for (let offset = inlineStart; offset < sourceEnd;) {
        if (fixedInline !== undefined) {
          if (fixedInline.closeEnd > sourceEnd) {
            break
          }
          completedLiterals.push(Object.freeze({
            kind: fixedInline.kind,
            start: fixedInline.openStart,
            end: fixedInline.closeEnd,
            ...(fixedInline.linkLabel === undefined
              ? {}
              : {
                construct: Object.freeze({
                  kind: fixedInline.linkLabel.kind,
                  start: fixedInline.linkLabel.start,
                  labelStart: fixedInline.linkLabel.labelStart,
                  labelEnd: fixedInline.linkLabel.labelEnd
                })
              })
          }))
          offset = fixedInline.closeEnd
          fixedInline = undefined
          continue
        }

        if (math !== undefined) {
          if (math.closeStart >= sourceEnd) {
            break
          }
          const closeEnd = math.closeStart + math.delimiterLength
          mathOwnedUntil = closeEnd
          completedLiterals.push(Object.freeze({
            kind: 'math',
            start: math.openStart,
            end: closeEnd,
            ...(math.form === undefined ? {} : { mathForm: math.form })
          }))
          offset = closeEnd
          math = undefined
          continue
        }

        if (inlineCode === undefined && pendingLinkLabel !== undefined) {
          const resolvedLabel = pendingLinkLabel
          pendingLinkLabel = undefined
          const suffixScope = matchingScopeAtOffset(offset)
          const suffixSharesLabelScope =
            suffixScope.id === resolvedLabel.matchingScopeId
          let rejectedExplicitSuffix = false
          if (source.charCodeAt(offset) === 40) {
            if (!suffixSharesLabelScope) {
              const protectedOffset =
                matchingScopePolicy?.rejectCrossScopeMatch(
                  resolvedLabel.bracketStart,
                  offset
                )
              if (protectedOffset === resolvedLabel.bracketStart) {
                authenticateRetargetedBracketCloser(
                  resolvedLabel.parentBracketPath,
                  resolvedLabel.labelEnd
                )
              }
              rejectedExplicitSuffix = true
            } else {
              const closeEnd = findInlineLinkDestinationEnd(
                source,
                offset,
                laneEnd
              )
              if (closeEnd !== undefined) {
                const closeStart = closeEnd - 1
                const closeScope = matchingScopeAtOffset(closeStart)
                if (closeScope.id !== suffixScope.id) {
                  matchingScopePolicy?.rejectCrossScopeMatch(
                    offset,
                    closeStart
                  )
                  rejectedExplicitSuffix = true
                } else {
                  fixedInline = Object.freeze({
                    kind: 'link-destination',
                    openStart: offset,
                    closeEnd,
                    linkLabel: resolvedLabel
                  })
            // Links cannot contain links, but images may contain links and
            // links may contain images. Resolving an image therefore leaves
            // an enclosing link opener active; resolving a link deactivates
            // only earlier link openers while retaining image openers.
                  if (resolvedLabel.kind === 'link') {
                    bracketPath = retainImageBracketOpeners(bracketPath)
                  }
                  continue
                }
              }
            }
          }
          const referenceSuffix = rejectedExplicitSuffix
            ? undefined
            : referenceLabelSuffix(source, offset, laneEnd)
          if (referenceSuffix !== undefined) {
            if (!suffixSharesLabelScope) {
              const protectedOffset =
                matchingScopePolicy?.rejectCrossScopeMatch(
                  resolvedLabel.bracketStart,
                  offset
                )
              if (protectedOffset === resolvedLabel.bracketStart) {
                authenticateRetargetedBracketCloser(
                  resolvedLabel.parentBracketPath,
                  resolvedLabel.labelEnd
                )
              }
              rejectedExplicitSuffix = true
            } else {
              const normalizedReference =
              referenceSuffix.labelStart === referenceSuffix.labelEnd
                ? resolvedLabel.normalizedLabel
                : normalizeMarkdownReferenceLabel(
                  source,
                  referenceSuffix.labelStart,
                  referenceSuffix.labelEnd
                )
              if (
                referenceDefinitions.has(
                  normalizedReference,
                  resolvedLabel.start
                )
              ) {
                if (resolvedLabel.kind === 'link') {
                  bracketPath = retainImageBracketOpeners(bracketPath)
                }
                offset = referenceSuffix.end
                continue
              }
            }
          } else if (
            !rejectedExplicitSuffix &&
            referenceDefinitions.has(
              resolvedLabel.normalizedLabel,
              resolvedLabel.start
            )
          ) {
            if (resolvedLabel.kind === 'link') {
              bracketPath = retainImageBracketOpeners(bracketPath)
            }
            continue
          }
        }

        if (source.charCodeAt(offset) !== 96) {
          if (
            inlineCode === undefined &&
          hasEvenLaneBackslashRunBefore(
            source,
            offset,
            sourceStart,
            checkpoint.trailingBackslashOdd
          )
          ) {
            if (
              gfmAutolinksEnabled &&
              offset >= extendedAutolinkSuppressedUntil &&
              source.charCodeAt(offset) === 60
            ) {
              let close = offset + 1
              while (
                close < laneEnd &&
                source.charCodeAt(close) !== 10 &&
                source.charCodeAt(close) !== 13 &&
                source.charCodeAt(close) !== 62
              ) {
                close += 1
              }
              if (close < laneEnd && source.charCodeAt(close) === 62) {
                extendedAutolinkSuppressedUntil = close + 1
              }
            }
            if (gfmAutolinksEnabled) {
              const extendedAutolink = offset >= extendedAutolinkSuppressedUntil
                ? findGfmExtendedAutolink(
                  source,
                  offset,
                  laneEnd,
                  Math.max(laneStart, lineStart)
                )
                : undefined
              if (extendedAutolink !== undefined) {
                fixedInline = Object.freeze({
                  kind: 'autolink',
                  openStart: offset,
                  closeEnd: extendedAutolink.end,
                  extendedAutolink: true
                })
                continue
              }
            }
            if (source.charCodeAt(offset) === 60) {
              const htmlEnd = inlineHtmlEndAcrossPrefixes(
                offset,
                laneEnd,
                activeContainers,
                paragraphOpen,
                findInlineHtmlEnd(source, offset, laneEnd)
              )
              const autolinkEnd =
              htmlEnd === undefined
                ? findAutolinkEnd(source, offset, laneEnd)
                : undefined
              const closeEnd = htmlEnd ?? autolinkEnd
              if (closeEnd !== undefined) {
                fixedInline = Object.freeze({
                  kind: htmlEnd === undefined ? 'autolink' : 'inline-html',
                  openStart: offset,
                  closeEnd
                })
                continue
              }
            }
            const optionalMath = findOptionalMathSpan(
              source,
              offset,
              laneEnd,
              texMathGfmEnabled,
              texMathSingleBackslashEnabled,
              texMathDoubleBackslashEnabled
            )
            if (optionalMath !== undefined) {
              math = optionalMath
              offset = optionalMath.openStart + (optionalMath.form === 'double-backslash' ? 3 : 2)
              continue
            }
            if (mathEnabled && source.charCodeAt(offset) === 36) {
              const runLimit = matchingScopePolicy?.delimiterRunLimit?.(offset, sourceEnd) ?? sourceEnd
              let runEnd = offset + 1
              while (runEnd < runLimit && source.charCodeAt(runEnd) === 36) {
                runEnd += 1
              }
              // Each `$` of the run may open: `$$` when exactly two follow,
              // otherwise a lone `$` before a non-space.
              const openerLineText = laneLineTextAt(offset)
              for (let opener = offset; opener < runEnd; opener += 1) {
                const delimiterLength =
                  opener + 1 < runEnd
                    ? opener + 2 < runEnd ? 0 : 2
                    : opener + 1 < source.length &&
                      !isMarkdownWhitespace(source.charCodeAt(opener + 1))
                      ? 1
                      : 0
                const closeStart = delimiterLength === 0
                  ? undefined
                  : nextMathRunStart(delimiterLength, opener, opener + delimiterLength, laneEnd, start =>
                    inlineLiteralCloserInParagraph(opener, start, laneEnd, activeContainers, paragraphOpen, tableOpen, delimiterLength === 2, openerLineText))
                if (
                  closeStart !== undefined &&
                  inlineLiteralCloserInParagraph(
                    opener,
                    closeStart,
                    laneEnd,
                    activeContainers,
                    paragraphOpen,
                    tableOpen,
                    delimiterLength === 2,
                    openerLineText
                  )
                ) {
                  math = Object.freeze({ openStart: opener, delimiterLength, closeStart })
                  break
                }
              }
              offset = runEnd
              continue
            }
            if (source.charCodeAt(offset) === 91) {
              const openerScope = matchingScopeAtOffset(offset)
              while (
                bracketPath !== undefined &&
                bracketOpenerScopeHasExited(bracketPath, openerScope)
              ) {
                bracketPath = bracketPath.parent
              }
              const inheritedLine = materializeMarkdownLine(checkpoint.linePath)
              const activeBangStart =
              offset > sourceStart
                ? source.charCodeAt(offset - 1) === 33 &&
                  hasEvenLaneBackslashRunBefore(
                    source,
                    offset - 1,
                    sourceStart,
                    checkpoint.trailingBackslashOdd
                  )
                  ? offset - 1
                  : undefined
                : inheritedLine.charCodeAt(inheritedLine.length - 1) === 33 &&
                  hasEvenBackslashRunBeforeText(
                    inheritedLine,
                    inheritedLine.length - 1
                  )
                  ? linePathSourceOffsetAt(
                    checkpoint.linePath,
                    inheritedLine.length - 1
                  ) ?? Math.max(0, offset - 1)
                  : undefined
              const imageOpenerSharesScope =
                activeBangStart === undefined ||
                matchingScopeAtOffset(activeBangStart).id === openerScope.id
              if (
                activeBangStart !== undefined &&
                !imageOpenerSharesScope
              ) {
                matchingScopePolicy?.rejectCrossScopeImageOpener(
                  activeBangStart,
                  offset
                )
              }
              const image =
                activeBangStart !== undefined && imageOpenerSharesScope
              bracketPath = Object.freeze({
                parent: bracketPath,
                kind: image ? 'image' : 'link',
                bracketStart: offset,
                start: image ? activeBangStart : offset,
                labelStart: offset + 1,
                matchingScopeId: openerScope.id,
                matchingScopeDepth: openerScope.depth
              })
            } else if (source.charCodeAt(offset) === 93 && bracketPath !== undefined) {
              const closerScope = matchingScopeAtOffset(offset)
              while (
                bracketPath !== undefined &&
                bracketOpenerScopeHasExited(bracketPath, closerScope)
              ) {
                matchingScopePolicy?.rejectCrossScopeMatch(
                  bracketPath.bracketStart,
                  offset
                )
                bracketPath = bracketPath.parent
              }
              if (
                bracketPath !== undefined &&
                bracketPath.matchingScopeDepth < closerScope.depth
              ) {
                matchingScopePolicy?.rejectCrossScopeMatch(
                  bracketPath.bracketStart,
                  offset
                )
              }
              if (
                bracketPath !== undefined &&
                bracketPath.matchingScopeId === closerScope.id
              ) {
                const label = bracketPath
                bracketPath = bracketPath.parent
                pendingLinkLabel = Object.freeze({
                  kind: label.kind,
                  bracketStart: label.bracketStart,
                  start: label.start,
                  labelStart: label.labelStart,
                  labelEnd: offset,
                  normalizedLabel: normalizeMarkdownReferenceLabel(
                    source,
                    label.labelStart,
                    offset
                  ),
                  matchingScopeId: label.matchingScopeId,
                  matchingScopeDepth: label.matchingScopeDepth,
                  parentBracketPath: bracketPath
                })
              }
            }
          }
          offset += 1
          continue
        }
        const runLimit = matchingScopePolicy?.delimiterRunLimit?.(offset, sourceEnd) ?? sourceEnd
        let runEnd = offset + 1
        while (runEnd < runLimit && source.charCodeAt(runEnd) === 96) {
          runEnd += 1
        }
        const markerLength = runEnd - offset
        if (
          inlineCode !== undefined &&
        inlineCode.closeStart === offset &&
        inlineCode.markerLength === markerLength
        ) {
          completedLiterals.push(Object.freeze({
            kind: 'inline-code',
            start: inlineCode.openStart,
            end: runEnd
          }))
          inlineCode = undefined
        } else if (
          inlineCode === undefined &&
        hasEvenLaneBackslashRunBefore(
          source,
          offset,
          sourceStart,
          checkpoint.trailingBackslashOdd
        )
        ) {
          const closeStart = nextBacktickRunStart(
            markerLength,
            offset,
            runEnd,
            laneEnd
          )
          if (
            closeStart !== undefined &&
            inlineLiteralCloserInParagraph(
              offset,
              closeStart,
              laneEnd,
              activeContainers,
              paragraphOpen,
              tableOpen
            )
          ) {
            inlineCode = Object.freeze({ openStart: offset, markerLength, closeStart })
          }
        }
        offset = runEnd
      }
    }

    if (
      fence !== undefined &&
      !containsEol &&
      sourceEnd === boundaryEnd &&
      lineStart !== fence.openLineStart
    ) {
      const boundaryLine = materializeMarkdownLine(checkpoint.linePath) + text
      const boundaryState = analyzeContainerLine(
        boundaryLine,
        { start: 0, contentEnd: boundaryLine.length, end: boundaryLine.length },
        activeContainers,
        paragraphOpen,
        false,
        paragraphOpen || definitionLazyContinuation,
        tableOpen,
        undefined,
        listHolders
      )
      if (isFenceCloserLine(boundaryLine, boundaryState, fence)) {
        completedLiterals.push(Object.freeze({
          kind: fence.provider,
          start: fence.openStart,
          end: sourceEnd
        }))
        fence = undefined
        lineBlockClosed = true
      }
    }

    if (
      frontMatter !== undefined &&
      !containsEol &&
      sourceEnd === boundaryEnd
    ) {
      const boundaryLine = materializeMarkdownLine(checkpoint.linePath) + text
      if (isFrontMatterDelimiter(boundaryLine, frontMatter.style)) {
        completedLiterals.push(Object.freeze({
          kind: 'front-matter',
          start: frontMatter.openStart,
          end: sourceEnd
        }))
        frontMatter = undefined
      }
    }

    if (
      htmlBlock !== undefined &&
      !containsEol &&
      sourceEnd === boundaryEnd
    ) {
      const boundaryLine = materializeMarkdownLine(checkpoint.linePath) + text
      if (htmlBlockTerminatedOnLine(boundaryLine, htmlBlock)) {
        completedLiterals.push(Object.freeze({
          kind: 'html-block',
          htmlTermination: htmlBlock.terminator === undefined ? 'blank-line' : 'explicit',
          start: htmlBlock.openStart,
          end: sourceEnd
        }))
        htmlBlock = undefined
      }
    }

    const lastLineFeed = text.lastIndexOf('\n')
    const lastCarriageReturn = text.lastIndexOf('\r')
    const lastEol = Math.max(lastLineFeed, lastCarriageReturn)
    const completedLines: PlainMarkdownLine[] = []
    if (lastEol >= 0) {
      const firstLineFeed = text.indexOf('\n')
      const firstCarriageReturn = text.indexOf('\r')
      const firstEol =
        firstLineFeed < 0
          ? firstCarriageReturn
          : firstCarriageReturn < 0
            ? firstLineFeed
            : Math.min(firstLineFeed, firstCarriageReturn)
      const completedLineStart = lineStart
      const completedContentEnd = textSourceStart + firstEol
      const completedEnd = Math.min(
        sourceEnd,
        sourceLineEnd(source, completedContentEnd, laneEnd)
      )
      const completedBounds = Object.freeze({
        start: completedLineStart,
        contentEnd: completedContentEnd,
        end: completedEnd
      })
      completedLines.push(buildPlainMarkdownLine(
        source,
        completedBounds,
        checkpoint.lineEntryContainers ?? checkpoint.activeContainers,
        checkpoint.paragraphOpen,
        markdownCheckpointContinuesLiteralContainer(
          source,
          completedBounds,
          checkpoint
        ),
        lazyContinuationOpenFor(checkpoint),
        checkpoint.tableOpen === true,
        checkpoint.listItemsHoldingLists
      ))
      const completedLine =
        materializeMarkdownLine(checkpoint.linePath) + text.slice(0, firstEol)
      const lineState = analyzeContainerLine(
        completedLine,
        { start: 0, contentEnd: completedLine.length, end: completedLine.length },
        activeContainers,
        paragraphOpen,
        false,
        paragraphOpen || definitionLazyContinuation,
        tableOpen,
        { source, next: completedBounds.end },
        listHolders
      )
      if (lineState.blank || lineBlockClosed) {
        enclosingLabelInterrupted = true
      }
      if (firstContainerDepthFailure === undefined) {
        const excess = firstExcessContainer(lineState)
        if (excess !== undefined) {
          const prefixLength = materializeMarkdownLine(checkpoint.linePath).length
          const mapOffset = (virtualOffset: number): number =>
            probeSourceOffsetAt(
              checkpoint.linePath,
              prefixLength,
              textSourceStart,
              firstEol,
              textSourceStart + firstEol,
              virtualOffset
            )
          firstContainerDepthFailure = Object.freeze({
            start: mapOffset(excess.start),
            end: mapOffset(excess.end - 1) + 1,
            observed: excess.observed
          })
        }
      }
      if (
        fence !== undefined &&
        lineStart !== fence.openLineStart &&
        !continuesBlockContainer(lineState, fence.container)
      ) {
        completedLiterals.push(Object.freeze({
          kind: fence.provider,
          start: fence.openStart,
          end: lineStart
        }))
        fence = undefined
      }
      if (
        htmlBlock !== undefined &&
        lineStart !== htmlBlock.openLineStart &&
        !continuesBlockContainer(lineState, htmlBlock.container)
      ) {
        completedLiterals.push(Object.freeze({
          kind: 'html-block',
          htmlTermination: htmlBlock.terminator === undefined ? 'blank-line' : 'explicit',
          start: htmlBlock.openStart,
          end: Math.min(htmlBlock.lastOwnedEnd, lineStart)
        }))
        htmlBlock = undefined
      }
      const lineEnteredWithFence = fence !== undefined
      const lineEnteredWithFrontMatter = frontMatter !== undefined
      // The line probe opened this HTML block, indented code block or
      // definition and bound it to the probe's container objects.
      // Re-analyzing the completed line against those containers mints a
      // fresh list item for a marker on this line, so adopting that result
      // would orphan the block from its own container on the next line.
      const lineOpenedHtmlBlock = htmlBlock?.openLineStart === lineStart
      const lineOpenedIndentedCode = indentedCode?.openLineStart === lineStart
      const lineOpenedDefinition = definition !== undefined && definition.openStart >= lineStart
      const frontMatterStyle = frontMatterEligible ? frontMatterOpeningStyle(completedLine) : undefined
      let lineOwnedByIndentedCode = false
      if (indentedCode !== undefined) {
        if (lineOpenedIndentedCode) {
          indentedCode = Object.freeze({
            ...indentedCode,
            lastCodeEnd: sourceEnd
          })
          lineOwnedByIndentedCode = true
        } else if (
          !lineState.blank &&
          continuesIndentedCode(lineState, indentedCode.container)
        ) {
          indentedCode = Object.freeze({
            ...indentedCode,
            lastCodeEnd: sourceEnd
          })
          lineOwnedByIndentedCode = true
        } else if (continuesIndentedCode(lineState, indentedCode.container)) {
          lineOwnedByIndentedCode = true
        } else {
          completedLiterals.push(Object.freeze({
            kind: 'indented-code',
            start: indentedCode.openStart,
            end: indentedCode.lastCodeEnd
          }))
          indentedCode = undefined
        }
      }
      let lineOwnedByHtmlBlock = false
      if (htmlBlock !== undefined) {
        if (htmlBlock.terminator !== undefined) {
          lineOwnedByHtmlBlock = true
          if (htmlBlockTerminatedOnLine(completedLine, htmlBlock)) {
            completedLiterals.push(Object.freeze({
              kind: 'html-block',
              htmlTermination: htmlBlock.terminator === undefined ? 'blank-line' : 'explicit',
              start: htmlBlock.openStart,
              end: sourceEnd
            }))
            htmlBlock = undefined
          } else {
            htmlBlock = Object.freeze({
              ...htmlBlock,
              lastOwnedEnd: sourceEnd
            })
          }
        } else if (lineState.blank && lineState.openers.length === 0) {
          // A marker-only line such as `-` or `>` is content, not the blank
          // line that ends this HTML block.
          completedLiterals.push(Object.freeze({
            kind: 'html-block',
            htmlTermination: htmlBlock.terminator === undefined ? 'blank-line' : 'explicit',
            start: htmlBlock.openStart,
            end: htmlBlock.lastOwnedEnd
          }))
          htmlBlock = undefined
        } else {
          lineOwnedByHtmlBlock = true
          htmlBlock = Object.freeze({
            ...htmlBlock,
            lastOwnedEnd: sourceEnd
          })
        }
      }
      let lineOwnedByDefinition = false
      let lineOwnedByReferenceDefinition = false
      if (definition !== undefined) {
        if (definition.lineStart !== lineStart) {
          const continuation = definitionContinuationPhase(
            completedLine,
            lineState,
            definition
          )
          if (continuation === 'invalid') {
            definition = undefined
          } else if (continuation === undefined) {
            completedLiterals.push(completedDefinitionLiteral(
              definition,
              definition.lastOwnedEnd
            ))
            if (definition.phase === 'footnote') {
              inlineCode = undefined
              if (math?.block !== true) math = undefined
              fixedInline = undefined
              bracketPath = undefined
              pendingLinkLabel = undefined
            }
            definition = undefined
          } else {
            definition = Object.freeze({
              ...definition,
              lineStart,
              phase: continuation.phase,
              titleCloseCodeUnit: continuation.titleCloseCodeUnit
            })
          }
        }
        if (definition !== undefined) {
          lineOwnedByDefinition = true
          lineOwnedByReferenceDefinition = definition.phase !== 'footnote'
          definition = Object.freeze({
            ...definition,
            lastOwnedEnd: sourceEnd
          })
          if (definition.phase === 'reference-title') {
            completedLiterals.push(completedDefinitionLiteral(
              definition,
              sourceEnd
            ))
            definition = undefined
          }
        }
      }
      if (
        lineOwnedByIndentedCode ||
        lineOwnedByHtmlBlock ||
        lineOwnedByDefinition
      ) {
        if (!lineOpenedHtmlBlock && !lineOpenedIndentedCode && !lineOpenedDefinition) {
          // A `>` or list marker inside the block is content; it opens
          // nothing for the lines after it.
          activeContainers = lineState.openers.length === 0
            ? lineState.activeContainers
            : Object.freeze(lineState.activeContainers.slice(
              0,
              lineState.activeContainers.length - lineState.openers.length
            ))
        }
      } else if (frontMatter !== undefined) {
        if (
          lineStart !== frontMatter.openLineStart &&
          isFrontMatterDelimiter(completedLine, frontMatter.style)
        ) {
          completedLiterals.push(Object.freeze({
            kind: 'front-matter',
            start: frontMatter.openStart,
            end: sourceEnd
          }))
          frontMatter = undefined
        }
      } else if (
        frontMatterStyle !== undefined &&
        hasFrontMatterCloser(source, sourceEnd, laneEnd, frontMatterStyle)
      ) {
        frontMatter = Object.freeze({
          openStart:
            linePathSourceOffsetAt(checkpoint.linePath, 0) ?? lineStart,
          openLineStart: lineStart,
          style: frontMatterStyle
        })
      } else if (fence !== undefined) {
        if (
          lineStart !== fence.openLineStart &&
          isFenceCloserLine(completedLine, lineState, fence)
        ) {
          completedLiterals.push(Object.freeze({
            kind: fence.provider,
            start: fence.openStart,
            end: sourceEnd
          }))
          fence = undefined
        }
      } else if (lineBlockClosed) {
        paragraphOpen = false
        bracketPath = undefined
        pendingLinkLabel = undefined
      } else {
        if (lineState.blank) {
          // Link-label openers belong to a paragraph. A blank line ends that
          // paragraph, so a later `](` cannot resolve an opener from before
          // the boundary.
          bracketPath = undefined
          pendingLinkLabel = undefined
        }
        const opening = lineStartsInMath(lineStart)
          ? undefined
          : findMarkdownFenceOpening(
            completedLine,
            lineState.contentOffset,
            lineState.indentation,
            lineState.blank
          )
        if (opening !== undefined) {
          fence = Object.freeze({
            openStart: Math.max(
              laneStart,
              probeSourceOffsetAt(
                checkpoint.linePath,
                materializeMarkdownLine(checkpoint.linePath).length,
                textSourceStart,
                text.length,
                sourceEnd,
                opening.startOffset
              )
            ),
            openLineStart: lineStart,
            markerCodeUnit: opening.markerCodeUnit,
            openerLength: opening.openerLength,
            provider: fencedLiteralProvider(
              completedLine,
              opening.startOffset + opening.openerLength,
              texMathGfmEnabled
            ),
            container: blockContainerFrom(lineState)
          })
          if (inlineCode?.openStart !== undefined && inlineCode.openStart >= lineStart) {
            inlineCode = undefined
          }
          enclosingLabelInterrupted = true
          bracketPath = undefined
          pendingLinkLabel = undefined
          fixedInline = undefined
          math = undefined
        }
        activeContainers = lineState.activeContainers
      }
      if (
        math !== undefined && math.block !== true && math.openStart >= lineStart &&
        completedLine.slice(lineState.contentOffset).trim() === '$$'
      ) {
        math = Object.freeze({ ...math, block: true })
      }
      // An unfinished reference definition is still the paragraph it began,
      // so the next line is read against that paragraph: lazily, as its
      // setext underline, or as a block that may interrupt it. Once complete
      // it stands alone, as upstream reads it, and any block may follow.
      paragraphOpen = (
        definition !== undefined &&
        !definitionPhaseComplete(definition.phase) &&
        !lineState.blank
      ) || (
        !lineBlockClosed &&
        !lineState.blank &&
        !lineOwnedByIndentedCode &&
        !lineOwnedByHtmlBlock &&
        !lineOwnedByDefinition &&
        !lineEnteredWithFence &&
        !lineEnteredWithFrontMatter &&
        fence === undefined &&
        frontMatter === undefined &&
        indentedCode === undefined &&
        htmlBlock === undefined &&
        definition === undefined &&
        !isAtxHeadingLine(completedLine, lineState) &&
        !lineState.setextUnderline &&
        !(
          lineState.indentation <= 3 &&
          isThematicBreakFrom(
            completedLine,
            lineState.contentOffset,
            completedLine.length
          )
        )
      )
      // A footnote body's lines form paragraphs of their own, which a blank
      // line ends.
      const footnoteParagraphContinues =
        lineOwnedByDefinition &&
        definition?.phase === 'footnote' &&
        !lineState.blank
      if (!paragraphOpen && !footnoteParagraphContinues) {
        // Code spans and inline math are paragraph content: once the line
        // ends its paragraph or leaf block, a later run cannot close them.
        inlineCode = undefined
        if (math?.block !== true) math = undefined
        if (lineOwnedByDefinition && definition?.phase === 'footnote') {
          bracketPath = undefined
          pendingLinkLabel = undefined
        }
      }
      if (gfmEnabled) {
        const paragraphText = paragraphOpen && !lineOwnedByDefinition
        const ownContainers = lineState.openers.length === 0 && (
          lineState.lazy
            ? lineState.activeContainers.at(-1)?.kind !== 'blockquote'
            : lineState.continuedContainerDepth === lineState.activeContainers.length
        )
        if (tableOpen) {
          // Upstream reads any other text line of the table's containers as
          // a row; a lazy line leaves a quoted table as a paragraph.
          tableOpen = paragraphText && ownContainers
        } else {
          tableOpen = paragraphText && ownContainers &&
            tableHeaderCells !== undefined &&
            lineState.indentation <= 3 &&
            gfmTableDelimiterCellCount(completedLine, lineState.contentOffset, completedLine.length) ===
              tableHeaderCells
        }
        if (tableOpen) {
          paragraphOpen = false
          inlineCode = undefined
          if (math?.block !== true) math = undefined
        }
        tableHeaderCells = paragraphOpen && !lineOwnedByDefinition
          ? gfmTableHeaderCellCount(completedLine, lineState.contentOffset, completedLine.length)
          : undefined
      }
      listHolders = listHoldersAfterLine(listHolders, lineState.continuedContainerDepth, activeContainers)
      definitionLazyContinuation = !paragraphOpen && lineOwnedByReferenceDefinition &&
        !lineState.blank
      lastLineLazy = lineState.lazy
      frontMatterEligible = false
      lineStart = sourceEnd
    }
    const lineText = lastEol < 0 ? text : text.slice(lastEol + 1)
    const linePath =
      lineText.length === 0
        ? undefined
        : Object.freeze({
          parent: lastEol < 0 ? checkpoint.linePath : undefined,
          text: lineText,
          sourceStart:
            lastEol < 0
              ? textSourceStart
              : sourceEnd - lineText.length,
          ...(physicalRecorder === undefined
            ? {}
            : { recorder: physicalRecorder })
        })
    if (
      linePath !== undefined &&
      lastEol < 0 &&
      lineBlockProbeEstablished
    ) {
      linePathsWithBlockProbe.add(linePath)
    }
    const lineEntryContainers = checkpoint.lineEntryContainers ?? checkpoint.activeContainers
    return Object.freeze({
      checkpoint: Object.freeze({
        linePath,
        inlineCode,
        math,
        bracketPath,
        pendingLinkLabel,
        fixedInline,
        extendedAutolinkSuppressedUntil,
        mathOwnedUntil: mathOwnedUntil !== undefined && mathOwnedUntil > lineStart ? mathOwnedUntil : undefined,
        activeContainers,
        definitionLazyContinuation: definitionLazyContinuation ? true : undefined,
        tableOpen: tableOpen ? true : undefined,
        listItemsHoldingLists: listHolders.length === 0 ? undefined : listHolders,
        tableHeaderCells,
        lineEntryContainers: linePath !== undefined && lastEol < 0 &&
            lineEntryContainers !== activeContainers
          ? lineEntryContainers
          : undefined,
        paragraphOpen,
        lastLineLazy,
        lineStart,
        fence,
        lineBlockClosed: lastEol < 0 && lineBlockClosed,
        trailingBackslashOdd,
        frontMatterEligible,
        frontMatter,
        indentedCode,
        htmlBlock,
        definition:
          definition?.footnoteBodyStart !== undefined &&
          definition.footnoteBodyStart <= sourceEnd
            ? Object.freeze({ ...definition, footnoteBodyStart: undefined })
            : definition,
        pendingCarriageReturn: undefined,
        firstContainerDepthFailure,
        enclosingLabelInterrupted,
        atVirtualBof: false
      }),
      completedLiterals: Object.freeze(completedLiterals),
      completedLines: Object.freeze(completedLines)
    })
  }

  const finishLane = (
    checkpoint: MarkdownCheckpoint,
    boundary: number,
    endsArm = false
  ): MarkdownLaneAdvance => {
    if (checkpoint.pendingCarriageReturn !== undefined) {
      const pending = checkpoint.pendingCarriageReturn
      // A terminal CR has no following LF to complete its physical line.
      // Emit it before deriving the final literal and line boundaries.
      const flushed = advanceCore(
        Object.freeze({ ...checkpoint, pendingCarriageReturn: undefined }),
        pending.sourceStart,
        pending.sourceEnd,
        0,
        boundary,
        boundary,
        false
      )
      const finished = finishLane(flushed.checkpoint, boundary, endsArm)
      return Object.freeze({
        checkpoint: finished.checkpoint,
        completedLiterals: Object.freeze([...flushed.completedLiterals, ...finished.completedLiterals]),
        completedLines: Object.freeze([...(flushed.completedLines ?? []), ...(finished.completedLines ?? [])])
      })
    }
    const completedLiterals: MarkdownLiteralRange[] = []
    const completedLines =
      checkpoint.linePath === undefined || checkpoint.lineStart >= boundary
        ? Object.freeze([])
        : Object.freeze([buildPlainMarkdownLine(
          source,
          Object.freeze({
            start: checkpoint.lineStart,
            contentEnd: boundary,
            end: boundary
          }),
          checkpoint.lineEntryContainers ?? checkpoint.activeContainers,
          checkpoint.paragraphOpen,
          markdownCheckpointContinuesLiteralContainer(
            source,
            Object.freeze({
              start: checkpoint.lineStart,
              contentEnd: boundary,
              end: boundary
            }),
            checkpoint
          ),
          lazyContinuationOpenFor(checkpoint),
          checkpoint.tableOpen === true,
          checkpoint.listItemsHoldingLists
        )])
    if (checkpoint.fence !== undefined) {
      completedLiterals.push(Object.freeze({
        kind: checkpoint.fence.provider,
        start: checkpoint.fence.openStart,
        end: boundary
      }))
    }
    if (checkpoint.indentedCode !== undefined) {
      completedLiterals.push(Object.freeze({
        kind: 'indented-code',
        start: checkpoint.indentedCode.openStart,
        end: Math.min(checkpoint.indentedCode.lastCodeEnd, boundary)
      }))
    }
    if (checkpoint.htmlBlock !== undefined) {
      completedLiterals.push(Object.freeze({
        kind: 'html-block',
        htmlTermination: checkpoint.htmlBlock.terminator === undefined ? 'blank-line' : 'explicit',
        start: checkpoint.htmlBlock.openStart,
        end: boundary
      }))
    }
    if (
      checkpoint.definition !== undefined &&
      definitionPhaseComplete(checkpoint.definition.phase)
    ) {
      completedLiterals.push(completedDefinitionLiteral(
        checkpoint.definition,
        Math.min(checkpoint.definition.lastOwnedEnd, boundary)
      ))
    }
    const pendingInArm = endsArm && (checkpoint.inlineCode !== undefined || checkpoint.math !== undefined)
    const checkpointChanged =
      pendingInArm ||
      checkpoint.fence !== undefined ||
      checkpoint.frontMatter !== undefined ||
      checkpoint.indentedCode !== undefined ||
      checkpoint.htmlBlock !== undefined ||
      checkpoint.definition !== undefined
    return Object.freeze({
      checkpoint:
        checkpointChanged
          ? Object.freeze({
            ...checkpoint,
            ...(pendingInArm ? { inlineCode: undefined, math: undefined } : {}),
            fence: undefined,
            frontMatter: undefined,
            indentedCode: undefined,
            htmlBlock: undefined,
            definition: undefined
          })
          : checkpoint,
      completedLiterals: Object.freeze(completedLiterals),
      completedLines
    })
  }

  const releaseAtBoundary = (
    checkpoint: MarkdownCheckpoint,
    boundary: number
  ): MarkdownLaneAdvance => {
    // A bare URL has no closing delimiter of its own. An arm separator ends
    // that URL; angle autolinks and completed destinations retain ownership.
    if (checkpoint.fixedInline?.extendedAutolink === true) {
      return releaseAtBoundary(Object.freeze({ ...checkpoint, fixedInline: undefined }), boundary)
    }
    if (materializeMarkdownLine(checkpoint.linePath).length !== 0) {
      return Object.freeze({
        checkpoint,
        completedLiterals: Object.freeze([])
      })
    }
    const completedLiterals: MarkdownLiteralRange[] = []
    const releasesHtmlBlock =
      checkpoint.htmlBlock !== undefined &&
      checkpoint.htmlBlock.terminator === undefined
    if (releasesHtmlBlock && checkpoint.htmlBlock !== undefined) {
      completedLiterals.push(Object.freeze({
        kind: 'html-block',
        htmlTermination: checkpoint.htmlBlock.terminator === undefined ? 'blank-line' : 'explicit',
        start: checkpoint.htmlBlock.openStart,
        end: Math.min(checkpoint.htmlBlock.lastOwnedEnd, boundary)
      }))
    }
    const releasesDefinition = checkpoint.definition !== undefined
    if (
      checkpoint.definition !== undefined &&
      definitionPhaseComplete(checkpoint.definition.phase)
    ) {
      completedLiterals.push(completedDefinitionLiteral(
        checkpoint.definition,
        Math.min(checkpoint.definition.lastOwnedEnd, boundary)
      ))
    }
    if (!releasesHtmlBlock && !releasesDefinition) {
      return Object.freeze({
        checkpoint,
        completedLiterals: Object.freeze([])
      })
    }
    return Object.freeze({
      checkpoint: Object.freeze({
        ...checkpoint,
        htmlBlock: releasesHtmlBlock ? undefined : checkpoint.htmlBlock,
        definition: undefined
      }),
      completedLiterals: Object.freeze(completedLiterals)
    })
  }

  const prepareForMarker = (
    checkpoint: MarkdownCheckpoint,
    markerOffset: number,
    laneEnd: number
  ): MarkdownLaneAdvance => {
    if (checkpoint.pendingCarriageReturn !== undefined) {
      // A marker is not LF. Complete the preceding CR line before deciding
      // whether its literal owner still governs this delimiter.
      const pending = checkpoint.pendingCarriageReturn
      const flushed = advanceCore(
        Object.freeze({ ...checkpoint, pendingCarriageReturn: undefined }),
        pending.sourceStart, pending.sourceEnd, 0, laneEnd, markerOffset, false
      )
      const prepared = prepareForMarker(flushed.checkpoint, markerOffset, laneEnd)
      return Object.freeze({
        checkpoint: prepared.checkpoint,
        completedLiterals: Object.freeze([...flushed.completedLiterals, ...prepared.completedLiterals]),
        completedLines: Object.freeze([...(flushed.completedLines ?? []), ...(prepared.completedLines ?? [])])
      })
    }
    if (
      checkpoint.indentedCode === undefined &&
      checkpoint.definition === undefined &&
      checkpoint.fence === undefined &&
      checkpoint.htmlBlock === undefined
    ) {
      return Object.freeze({
        checkpoint,
        completedLiterals: Object.freeze([])
      })
    }
    const contentEnd = sourceLineContentEnd(
      source,
      markerOffset,
      laneEnd,
      execution
    )
    const lineText =
      materializeMarkdownLine(checkpoint.linePath) +
      source.slice(markerOffset, contentEnd)
    const lineState = analyzeContainerLine(
      lineText,
      { start: 0, contentEnd: lineText.length, end: lineText.length },
      checkpoint.activeContainers,
      checkpoint.paragraphOpen
    )
    const completedLiterals: MarkdownLiteralRange[] = []
    let indentedCode = checkpoint.indentedCode
    if (
      indentedCode !== undefined &&
      indentedCode.openLineStart !== checkpoint.lineStart &&
      !continuesIndentedCode(lineState, indentedCode.container)
    ) {
      completedLiterals.push(Object.freeze({
        kind: 'indented-code',
        start: indentedCode.openStart,
        end: indentedCode.lastCodeEnd
      }))
      indentedCode = undefined
    }
    let definition = checkpoint.definition
    let footnoteEnded = false
    if (definition !== undefined && definition.lineStart !== checkpoint.lineStart) {
      const continuation = definitionContinuationPhase(
        lineText,
        lineState,
        definition
      )
      if (continuation === 'invalid') {
        definition = undefined
      } else if (continuation === undefined) {
        completedLiterals.push(completedDefinitionLiteral(
          definition,
          definition.lastOwnedEnd
        ))
        footnoteEnded = definition.phase === 'footnote'
        definition = undefined
      } else {
        definition = Object.freeze({
          ...definition,
          lineStart: checkpoint.lineStart,
          phase: continuation.phase,
          titleCloseCodeUnit: continuation.titleCloseCodeUnit,
          lastOwnedEnd: sourceLineEnd(source, contentEnd, laneEnd)
        })
      }
    }
    let fence = checkpoint.fence
    if (
      fence !== undefined &&
      checkpoint.lineStart !== fence.openLineStart &&
      !continuesBlockContainer(lineState, fence.container)
    ) {
      completedLiterals.push(Object.freeze({
        kind: fence.provider,
        start: fence.openStart,
        end: checkpoint.lineStart
      }))
      fence = undefined
    }
    let htmlBlock = checkpoint.htmlBlock
    if (
      htmlBlock !== undefined &&
      checkpoint.lineStart !== htmlBlock.openLineStart &&
      !continuesBlockContainer(lineState, htmlBlock.container)
    ) {
      completedLiterals.push(Object.freeze({
        kind: 'html-block',
        htmlTermination: htmlBlock.terminator === undefined ? 'blank-line' : 'explicit',
        start: htmlBlock.openStart,
        end: Math.min(htmlBlock.lastOwnedEnd, checkpoint.lineStart)
      }))
      htmlBlock = undefined
    }
    if (
      indentedCode === checkpoint.indentedCode &&
      definition === checkpoint.definition &&
      fence === checkpoint.fence &&
      htmlBlock === checkpoint.htmlBlock
    ) {
      return Object.freeze({
        checkpoint,
        completedLiterals: Object.freeze(completedLiterals)
      })
    }
    return Object.freeze({
      checkpoint: Object.freeze({
        ...checkpoint,
        indentedCode,
        definition,
        fence,
        htmlBlock,
        ...(footnoteEnded
          ? {
            inlineCode: undefined,
            math: checkpoint.math?.block === true ? checkpoint.math : undefined,
            fixedInline: undefined,
            bracketPath: undefined,
            pendingLinkLabel: undefined
          }
          : {})
      }),
      completedLiterals: Object.freeze(completedLiterals)
    })
  }

  const advance: MarkdownLaneState['advance'] = (
    checkpoint,
    sourceStart,
    sourceEnd,
    laneStart,
    laneEnd,
    boundaryEnd
  ) => advanceCore(
    checkpoint,
    sourceStart,
    sourceEnd,
    laneStart,
    laneEnd,
    boundaryEnd,
    true
  )

  const lineStartBoundaryStandsAgainstLiteral: MarkdownLaneState['lineStartBoundaryStandsAgainstLiteral'] = (
    checkpoint,
    markerOffset,
    armStart
  ) => {
    if (
      checkpoint.inlineCode !== undefined ||
      checkpoint.fixedInline !== undefined ||
      checkpoint.frontMatter !== undefined ||
      checkpoint.definition !== undefined ||
      (checkpoint.math?.delimiterLength === 1 || checkpoint.math?.form !== undefined)
    ) {
      return false
    }
    const literal =
      checkpoint.fence ??
      checkpoint.indentedCode ??
      checkpoint.htmlBlock ??
      checkpoint.math
    if (literal === undefined || literal.openStart < armStart) {
      return false
    }
    const prefix = materializeMarkdownLine(checkpoint.linePath)
    const lineText =
      prefix +
      source.slice(
        markerOffset,
        sourceLineContentEnd(source, markerOffset, source.length, execution)
      )
    const lineState = analyzeContainerLine(
      lineText,
      { start: 0, contentEnd: lineText.length, end: lineText.length },
      checkpoint.activeContainers,
      false,
      true
    )
    const container = 'container' in literal ? literal.container : undefined
    // `$$` math pairs its runs across container ends, so it goes on into a
    // line no container continues, and a boundary token beginning that line
    // ends it there too.
    return (
      lineState.contentOffset === prefix.length &&
      lineState.indentation === 0 &&
      (
        container === undefined
          ? literal === checkpoint.math ||
            lineState.continuedContainerDepth === checkpoint.activeContainers.length
          : continuesBlockContainer(lineState, container)
      )
    )
  }

  const releaseDefinitionAtBoundary: MarkdownLaneState['releaseDefinitionAtBoundary'] = (
    checkpoint,
    markerOffset,
    armStart
  ) => {
    const definition = checkpoint.definition
    if (
      definition === undefined ||
      !definitionOwnsMarkers(definition) ||
      definition.openStart < armStart ||
      definition.lineStart !== checkpoint.lineStart
    ) {
      return undefined
    }
    let step: MarkdownDefinitionStep | undefined
    if (definition.openStart >= checkpoint.lineStart) {
      const lineText = materializeMarkdownLine(checkpoint.linePath)
      step = definitionOpening(
        lineText,
        analyzeContainerLine(
          lineText,
          { start: 0, contentEnd: lineText.length, end: lineText.length },
          checkpoint.activeContainers,
          false,
          true
        ),
        false,
        true,
        footnotesEnabled
      )
    } else if (definition.phase === 'footnote') {
      step = Object.freeze({ phase: 'footnote' as const })
    } else if (
      stagedMarkdownReferenceDefinitionAt(
        source,
        definition.openStart,
        markerOffset,
        footnotesEnabled
      ) !== undefined
    ) {
      step = Object.freeze({ phase: 'reference' as const })
    }
    return Object.freeze({
      ...checkpoint,
      definition: step === undefined || !definitionPhaseComplete(step.phase)
        ? undefined
        : Object.freeze({
          ...definition,
          phase: step.phase,
          titleCloseCodeUnit: step.titleCloseCodeUnit,
          lastOwnedEnd: markerOffset
        })
    })
  }

  const finishArm: MarkdownLaneState['finishArm'] = (
    continuation,
    armEnd,
    mode,
    payloadIntervened,
    enclosingLabelPreservedByAllArms,
    atDocumentRoot
  ) => {
    const resumed = mode === 'isolated'
      ? continuation
      : mode === 'continuous'
        ? armEnd
        : Object.freeze({
          linePath: armEnd.linePath,
          inlineCode: continuation.inlineCode,
          math: continuation.math,
          bracketPath: enclosingLabelPreservedByAllArms
            ? continuation.bracketPath
            : undefined,
          pendingLinkLabel: payloadIntervened
            ? undefined
            : continuation.pendingLinkLabel,
          fixedInline: continuation.fixedInline,
          activeContainers: armEnd.activeContainers,
          paragraphOpen: armEnd.paragraphOpen,
          lastLineLazy: armEnd.lastLineLazy,
          lineStart: armEnd.lineStart,
          fence: continuation.fence,
          lineBlockClosed: armEnd.lineBlockClosed,
          trailingBackslashOdd: continuation.trailingBackslashOdd,
          frontMatterEligible: armEnd.frontMatterEligible,
          frontMatter: continuation.frontMatter,
          indentedCode: continuation.indentedCode,
          htmlBlock: continuation.htmlBlock,
          definition: continuation.definition,
          pendingCarriageReturn: armEnd.pendingCarriageReturn,
          firstContainerDepthFailure:
            continuation.firstContainerDepthFailure ??
            armEnd.firstContainerDepthFailure,
          enclosingLabelInterrupted:
            continuation.enclosingLabelInterrupted ||
            !enclosingLabelPreservedByAllArms,
          atVirtualBof: armEnd.atVirtualBof
        })
    return atDocumentRoot
      ? Object.freeze({
        ...resumed,
        frontMatterEligible: false,
        frontMatter: undefined,
        atVirtualBof: false
      })
      : resumed
  }

  return Object.freeze({
    emptyCheckpoint:
      frontMatterEnabled
        ? EMPTY_MARKDOWN_CHECKPOINT
        : Object.freeze({
          ...EMPTY_MARKDOWN_CHECKPOINT,
          frontMatterEligible: false
        }),
    advance: Object.freeze(advance),
    finishLane: Object.freeze(finishLane),
    releaseAtBoundary: Object.freeze(releaseAtBoundary),
    prepareForMarker: Object.freeze(prepareForMarker),
    containerDepthFailure: Object.freeze(
      (checkpoint: MarkdownCheckpoint): MarkdownContainerDepthFailure | undefined => {
        if (checkpoint.firstContainerDepthFailure !== undefined) {
          return checkpoint.firstContainerDepthFailure
        }
        if (
          checkpoint.linePath !== undefined &&
          lineBlockProbeCanPersist &&
          linePathsWithBlockProbe.has(checkpoint.linePath)
        ) {
          return undefined
        }
        const pendingLine = materializeMarkdownLine(checkpoint.linePath)
        if (pendingLine.length === 0) {
          return undefined
        }
        const lineState = analyzeContainerLine(
          pendingLine,
          { start: 0, contentEnd: pendingLine.length, end: pendingLine.length },
          checkpoint.activeContainers,
          checkpoint.paragraphOpen
        )
        const excess = firstExcessContainer(lineState)
        if (excess === undefined) {
          return undefined
        }
        const mapOffset = (virtualOffset: number): number =>
          linePathSourceOffsetAt(checkpoint.linePath, virtualOffset) ??
          checkpoint.lineStart
        return Object.freeze({
          start: mapOffset(excess.start),
          end: mapOffset(excess.end - 1) + 1,
          observed: excess.observed
        })
      }
    ),
    markerIsProtected: Object.freeze(
      (checkpoint: MarkdownCheckpoint): boolean => checkpoint.trailingBackslashOdd
    ),
    markerIsLiteralOwned: Object.freeze(
      (checkpoint: MarkdownCheckpoint): boolean =>
        checkpoint.inlineCode !== undefined ||
        checkpoint.math !== undefined ||
        checkpoint.fixedInline !== undefined ||
        checkpoint.fence !== undefined ||
        checkpoint.frontMatter !== undefined ||
        checkpoint.indentedCode !== undefined ||
        checkpoint.htmlBlock !== undefined ||
        (
          checkpoint.definition !== undefined &&
          definitionOwnsMarkers(checkpoint.definition)
        )
    ),
    compatibleCloserStandsAgainstLiteral: Object.freeze(
      (checkpoint: MarkdownCheckpoint): boolean =>
        checkpoint.inlineCode !== undefined ||
        (checkpoint.math !== undefined && checkpoint.math.block !== true) ||
        checkpoint.fixedInline?.extendedAutolink === true
    ),
    lineStartBoundaryStandsAgainstLiteral: Object.freeze(
      lineStartBoundaryStandsAgainstLiteral
    ),
    releaseDefinitionAtBoundary: Object.freeze(releaseDefinitionAtBoundary),
    finishArm: Object.freeze(finishArm),
    enterArm: Object.freeze((
      checkpoint: MarkdownCheckpoint,
      sourceStart: number,
      mode: MarkdownArmMode
    ): MarkdownCheckpoint =>
      mode === 'isolated'
        ? Object.freeze({
          ...EMPTY_MARKDOWN_CHECKPOINT,
          lineStart: sourceStart,
          frontMatterEligible: frontMatterEnabled
        })
        : mode === 'continuous'
          ? Object.freeze({
            ...checkpoint,
            frontMatterEligible:
              frontMatterEnabled && checkpoint.atVirtualBof
          })
          : Object.freeze({
            ...checkpoint,
            inlineCode: undefined,
            math: undefined,
            bracketPath: undefined,
            pendingLinkLabel: undefined,
            fixedInline: undefined,
            fence: undefined,
            frontMatter: undefined,
            indentedCode: undefined,
            htmlBlock: undefined,
            definition: undefined,
            trailingBackslashOdd: false,
            pendingCarriageReturn: undefined,
            enclosingLabelInterrupted: false,
            frontMatterEligible:
              frontMatterEnabled && checkpoint.atVirtualBof
          }))
  })
}

/**
 * Build the `PlainMarkdownLine` record for one source line from the lane state
 * entering it.
 *
 * Extracted so the canonical CriticMarkup-bearing driver can emit the same line
 * records the plain driver does. Line emission is the only thing the plain
 * driver has that the canonical one lacks, and it is the reason two drivers
 * exist over one lane state machine; sharing this is the first step to
 * collapsing them (Phase 0.5 step 7).
 */
function lazyContinuationOpenFor(checkpoint: MarkdownCheckpoint): boolean {
  return checkpoint.paragraphOpen || checkpoint.definitionLazyContinuation === true
}

export function buildPlainMarkdownLine(
  source: string,
  bounds: Readonly<{ start: number, contentEnd: number, end: number }>,
  activeContainers: MarkdownCheckpoint['activeContainers'],
  paragraphOpen: boolean,
  literalOpen: boolean = false,
  lazyContinuationOpen: boolean = paragraphOpen,
  tableRowOpen: boolean = false,
  listHolders: readonly boolean[] = NO_LIST_HOLDERS
): PlainMarkdownLine {
  const { start, contentEnd, end } = bounds
  const lineState = analyzeContainerLine(
    source,
    { start, contentEnd, end },
    activeContainers,
    paragraphOpen,
    literalOpen,
    lazyContinuationOpen,
    tableRowOpen,
    { source, next: end },
    listHolders
  )
  let openerIndex = 0
  let quoteMarkerIndex = 0
  const containers = lineState.activeContainers.map(
    (container, depth): PlainMarkdownContainer => {
      const continued = depth < lineState.continuedContainerDepth
      const opener = continued ? undefined : lineState.openers[openerIndex++]
      if (container.kind === 'blockquote') {
        const candidate = lineState.blockquoteMarkers[quoteMarkerIndex]
        const marker = candidate?.depth === depth ? candidate : undefined
        if (marker !== undefined) quoteMarkerIndex += 1
        return Object.freeze({
          kind: 'blockquote',
          ...(marker === undefined ? {} : { markerRange: Object.freeze({ start: marker.start, end: marker.end }) }),
          continued,
          start: opener?.start ?? start,
          end: opener?.end ?? start
        })
      }
      return Object.freeze({
        kind: 'list-item',
        continued,
        start: opener?.start ?? start,
        end: opener?.end ?? start,
        ordered: container.ordered,
        startNumber: container.startNumber,
        delimiterCodeUnit: container.delimiterCodeUnit,
        contentOffset: opener?.contentOffset ?? lineState.contentOffset
      })
    }
  )
  return Object.freeze({
    start,
    contentEnd,
    end,
    listContinuationIndentations: lineState.listContinuationIndentations,
    blank: lineState.blank,
    lazy: lineState.lazy,
    contentOffset: lineState.contentOffset,
    indentation: lineState.indentation,
    blockQuoteDepth: lineState.blockQuoteDepth,
    listDepth: lineState.activeContainers.filter(
      (container) => container.kind === 'list-item'
    ).length,
    listMarkers: Object.freeze(
      lineState.openers
        .filter((opener) => opener.kind === 'list-item')
        .map((opener): PlainMarkdownListMarker => Object.freeze({
          start: opener.start,
          end: opener.end,
          ordered: opener.ordered ?? false,
          startNumber: opener.startNumber ?? 1,
          contentOffset: opener.contentOffset ?? opener.end
        }))
    ),
    containers: Object.freeze(containers)
  })
}

/** Line boundaries starting at `start`, honoring LF, CRLF and CR. */
export function plainMarkdownLineBounds(
  source: string,
  start: number
): Readonly<{ start: number, contentEnd: number, end: number }> {
  let contentEnd = start
  while (
    contentEnd < source.length &&
    source.charCodeAt(contentEnd) !== 10 &&
    source.charCodeAt(contentEnd) !== 13
  ) {
    contentEnd += 1
  }
  let end = contentEnd
  if (end < source.length) {
    end +=
      source.charCodeAt(end) === 13 && source.charCodeAt(end + 1) === 10
        ? 2
        : 1
  }
  return Object.freeze({ start, contentEnd, end })
}

/**
 * Whether an already-open block literal owns this physical line through the
 * same container path. Fork continuations use this emitted checkpoint fact so
 * a new sibling list item or block quote is still parsed structurally.
 */
export function markdownCheckpointContinuesLiteralContainer(
  source: string,
  bounds: Readonly<{ start: number, contentEnd: number, end: number }>,
  checkpoint: MarkdownCheckpoint
): boolean {
  if (checkpoint.frontMatter !== undefined) {
    return true
  }
  // The pending line itself opened the fence or HTML block, so its markers
  // are the block's containers rather than content inside it.
  if (checkpoint.lineEntryContainers !== undefined) {
    return false
  }
  const literalContainer =
    checkpoint.fence?.container ?? checkpoint.htmlBlock?.container
  return literalContainer !== undefined &&
    continuesBlockContainer(
      analyzeContainerLine(
        source,
        bounds,
        checkpoint.activeContainers,
        checkpoint.paragraphOpen
      ),
      literalContainer
    )
}

function parsePlainMarkdownLanePass(
  source: string,
  containerDepthLimit: number,
  referenceDefinitions: MarkdownReferenceDefinitionLookup,
  matchingScopePolicy?: MarkdownMatchingScopePolicy,
  frontMatterEnabled: boolean = true,
  gfmEnabled: boolean = true,
  gfmAutolinksEnabled: boolean = true,
  mathEnabled: boolean = true,
  texMathGfmEnabled: boolean = true,
  texMathSingleBackslashEnabled: boolean = false,
  texMathDoubleBackslashEnabled: boolean = false,
  footnotesEnabled: boolean = true,
  physicalRecorder?: Profile1PhysicalTraversalRecorderV1
): PlainMarkdownLaneParse {
  const parser = createMarkdownLaneState(
    source,
    containerDepthLimit,
    referenceDefinitions,
    matchingScopePolicy,
    frontMatterEnabled,
    gfmEnabled,
    gfmAutolinksEnabled,
    mathEnabled,
    texMathGfmEnabled,
    texMathSingleBackslashEnabled,
    texMathDoubleBackslashEnabled,
    footnotesEnabled,
    undefined,
    undefined,
    physicalRecorder
  )
  const literals: MarkdownLiteralRange[] = []
  const lines: PlainMarkdownLine[] = []
  let checkpoint = parser.emptyCheckpoint
  const advanceRange = (
    start: number,
    end: number
  ): MarkdownContainerDepthFailure | undefined => {
    if (start === end && checkpoint.pendingCarriageReturn === undefined) {
      return undefined
    }
    const advanced = parser.advance(
      checkpoint,
      start,
      end,
      0,
      source.length,
      source.length
    )
    checkpoint = advanced.checkpoint
    literals.push(...advanced.completedLiterals)
    return parser.containerDepthFailure(checkpoint)
  }
  let start = 0
  while (start < source.length) {
    const bounds = plainMarkdownLineBounds(source, start)
    const { contentEnd, end } = bounds
    const literalContainer =
      checkpoint.fence?.container ?? checkpoint.htmlBlock?.container
    const lineContinuesLiteralContainer =
      literalContainer !== undefined &&
      continuesBlockContainer(
        analyzeContainerLine(
          source,
          bounds,
          checkpoint.activeContainers,
          checkpoint.paragraphOpen
        ),
        literalContainer
      )
    lines.push(buildPlainMarkdownLine(
      source,
      bounds,
      checkpoint.activeContainers,
      checkpoint.paragraphOpen,
      lineContinuesLiteralContainer ||
        checkpoint.frontMatter !== undefined,
      lazyContinuationOpenFor(checkpoint),
      checkpoint.tableOpen === true,
      checkpoint.listItemsHoldingLists
    ))
    // This driver owns complete physical lines. Finalize a lone CR before
    // deriving the next line's inherited container and literal state.
    const failure =
      advanceRange(start, contentEnd) ?? advanceRange(contentEnd, end) ?? advanceRange(end, end)
    if (failure !== undefined) {
      return Object.freeze({
        literals: composeMarkdownLiteralRanges(literals),
        containerDepthFailure: failure,
        lines: Object.freeze(lines)
      })
    }
    start = end
  }
  const finished = parser.finishLane(checkpoint, source.length)
  literals.push(...finished.completedLiterals)
  return Object.freeze({
    literals: composeMarkdownLiteralRanges(literals),
    containerDepthFailure: parser.containerDepthFailure(finished.checkpoint),
    lines: Object.freeze(lines)
  })
}

/**
 * Emit block/literal facts for one parser-declared intrinsic fork region.
 *
 * The caller supplies the canonical admission's reference-definition facts,
 * so this does not construct a selected-source reference index or account the
 * work as a projected-document parse.
 */
export function parseIntrinsicForkMarkdownLaneFacts(
  source: string,
  referenceDefinitions: MarkdownReferenceDefinitionLookup,
  containerDepthLimit: number = Number.POSITIVE_INFINITY,
  matchingScopePolicy?: MarkdownMatchingScopePolicy,
  frontMatterEnabled: boolean = true,
  gfmEnabled: boolean = true,
  gfmAutolinksEnabled: boolean = true,
  mathEnabled: boolean = true,
  texMathGfmEnabled: boolean = true,
  texMathSingleBackslashEnabled: boolean = false,
  texMathDoubleBackslashEnabled: boolean = false,
  footnotesEnabled: boolean = true,
  physicalRecorder?: Profile1PhysicalTraversalRecorderV1
): PlainMarkdownLaneParse {
  return parsePlainMarkdownLanePass(
    source,
    containerDepthLimit,
    referenceDefinitions,
    matchingScopePolicy,
    frontMatterEnabled,
    gfmEnabled,
    gfmAutolinksEnabled,
    mathEnabled,
    texMathGfmEnabled,
    texMathSingleBackslashEnabled,
    texMathDoubleBackslashEnabled,
    footnotesEnabled,
    physicalRecorder
  )
}
