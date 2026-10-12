import { editsMayRepairDollarMath } from './internal/profile1/dollarMathPairing.js'
import { planAuthor, type DocumentAuthorAction, type DocumentAuthorPlan } from './authorPlanning.js'
import { commentPairPreservingResolution, commentedSpanSafeClipboard, commentedSpanSafeInput } from './commentedSpans.js'
import { planCommentEdit, type DocumentCommentAction, type DocumentCommentPlan } from './commentSpelling.js'
import { planSourceInput, type DocumentSourceInputAction } from './sourceInputPlanning.js'
import { sourceSyntaxSpans, type DocumentSourceSyntaxSpan } from './sourceSyntax.js'
import { paragraphEnterConversion } from './internal/profile1/markdownParser.js'
import { planClipboard, type DocumentClipboardAction, type DocumentClipboardPlan } from './clipboardPlanning.js'
import { planFormat, type DocumentFormatAction, type DocumentFormatPlan } from './formatPlanning.js'
import { planInput, positionBefore, reconcileInput, inputSourceRange, type DocumentInputAction, type DocumentInputPlan, type DocumentInputResult, type RegionalBlockContext } from './inputPlanning.js'
import { editingReconciliation } from './editingReconciliation.js'
import { normalizeEdits, normalizeInputPlan, selectionAfterNormalization, type EditNormalizationOptions, type EditNormalizationReaders } from './editNormalization.js'
import { paragraphBackwardStructuralTarget } from './paragraphJoinPlanning.js'
import { isLiteralBlock } from './literalBlock.js'
import { syntaxPathAt } from './syntaxPath.js'
import { findBlockCommandTarget } from './blockCommandPlanning.js'
import { createTrackedPendingArmEdits, createTrackedLiteralSourceEdit, createTrackedSourceEdit, protectNativeCriticText, retainedTrackedHistoryEdit } from './trackedAuthoring.js'
import { joinedTrackedEdit, mergedTrackedDeletion, separateTrackedParts, trackedEditableEdits, trackedEditableSpans, trackedPartsSeparate, unchangedTrackedEdit, withinHistory } from './trackedHistoryEditing.js'
import { OWN_DRAFT_SHORTCUT_UNITS, createTrackedOracle, widenedTrackedSourceEdit, withBestEffortSpelling, deferEquivalence, equivalenceDeferred, unresolvedDraftEdges, markUnresolvedDraft, windowEndsDocument, keepsTyping, markWindowCompileCore, literalHistoryInsertionPoint, projectionSignature, resolvedSuggestions, trackedAnnotatedViews, trackedMarkdownSignatures, trackedRootCounts, withDocumentSearchBudget, withoutDocumentSearchBudget, documentSearchExhausted, spelledAsSource, recordedExactly, trackedStructure, type TrackedStructure, type TrackedPart, readingChange, DERIVED_SPELLING_UNITS, derivesSpelling, documentReadingChanges, typedKeys, trackedOperationEquivalent, trackedPreviewFacts, trackedRegionalReadings, withDeferredEquivalence, type TrackedRegionalReading } from './trackedExtent.js'
import { createMarkupSourceEdits, createMarkupCompoundSourceEdits } from './markupEditing.js'
import { markupAnnotations } from './markupEditOwnership.js'
import { CRITIC_MARKER_ALTERNATION } from './internal/profile1/sourceTape.js'
import {
  admitProfile1PlainParagraphRegion,
  createProfile1DocumentReuseCache,
  parseProfile1Document,
  parseProfile1ReaderViews,
  profile1CriticMarkupRootCount,
  type PreviousIntrinsicPass,
  type Profile1DocumentProducts,
  type Profile1DocumentReuseCache
} from './internal/profile1Document.js'
import { createPhysicalTraversalRecorderV1 } from './internal/profile1/physicalTraversalAccounting.js'
import {
  admitCriticMarkupRegionalChange,
  createCriticMarkupRegionalIndex,
  type CriticMarkupRegionalIndex
} from './internal/profile1/criticMarkupRegional.js'
import {
  admitCommentRegionalChange,
  createCommentRegionalIndex,
  type CommentRegionalIndex
} from './internal/profile1/commentRegional.js'
import {
  applyRegionalInventory,
  createPlainRegionalInventory,
  createRegionalInventory,
  literalBlockReplacement,
  materializeRegionalInventoryAnnotations,
  materializeRegionalInventoryAnnotationsAround,
  materializeRegionalInventoryAnnotationsIn,
  materializeRegionalInventoryDiagnostics,
  previewRegionalContext,
  previewRegionalInventory,
  previewRegionalRange,
  regionalInventoryDefinitions,
  regionalInventoryRootCount,
  regionalInventoryRootRanges,
  regionalInventoryListRange,
  regionalInventoryLiteralRange,
  regionalInventoryLeaves,
  displayMathReachesPast,
  withLinesBack,
  regionalInventorySplitsLists,
  regionalLeafPoints,
  regionalRangeWindow,
  strayMarkersStayLocal,
  referenceDependencyPrefixEnd,
  type RegionalInventory,
  type RegionalInventoryAdmission,
  type RegionalInventoryPreview,
  type RegionalInventoryRecorder
} from './internal/profile1/regionalInventory.js'
import {
  createPlainParagraphRetainedIndex,
  type PlainParagraphIndexRecorder,
  type PlainParagraphRetainedIndex
} from './internal/profile1/plainParagraphRetainedIndex.js'
import {
  createPersistentCanonicalSource,
  type CanonicalSourceMaterializationReason,
  type CanonicalSourceView,
  type PersistentCanonicalSource,
  type PersistentCanonicalSourceRecorder
} from './internal/persistentCanonicalSource.js'
import { checksAppliedReadings, checksReaderViews, checksReadingWindows, searchesWithoutBudget, planFromGeneralCompile, plansFromDocumentParse, plansFromGeneralCompile, registerDocumentCoreInspection, registerRegionalLeaves } from './internal/documentCoreInspection.js'
import { annotationsOverlapping, registerAnnotationsAround } from './internal/annotationsAround.js'
import {
  createRevisionProductStore,
  type RevisionProductStore
} from './internal/revisionProductStore.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from './resourcePolicy.js'
import { surrogateSplittingEdit } from './surrogatePairEdits.js'
import {
  decodeGfmTableCodeContent,
  decodeMarkdownSemanticText,
  normalizeMarkdownAutolinkDestination,
  normalizeMarkdownSemanticDestination
} from './internal/profile1/markdownSemanticText.js'
import type {
  CriticMarkupNode,
  ExecutionBudgetId,
  MarkdownNode as ParserMarkdownNode,
  MarkdownOptionsV1,
  NodeId,
  ResourceDiagnostic,
  SyntaxDiagnostic
} from './revision.js'

export type CriticMarkupKind =
  | 'addition'
  | 'deletion'
  | 'substitution'
  | 'highlight'
  | 'comment'

export interface SourceRange {
  /** Inclusive UTF-16 code-unit offset in canonical source. */
  readonly start: number
  /** Exclusive UTF-16 code-unit offset in canonical source. */
  readonly end: number
}

export interface CriticMarkupArm {
  readonly name: 'content' | 'old' | 'new' | 'comment'
  readonly range: SourceRange
  readonly annotations: readonly CriticMarkupAnnotation[]
}

export interface CriticMarkupAnnotation {
  readonly kind: CriticMarkupKind
  readonly range: SourceRange
  readonly arms: readonly CriticMarkupArm[]
}

export type DocumentDiagnosticCode =
  | 'CM_UNMATCHED_CLOSER'
  | 'CM_NON_TOP_CLOSER'
  | 'CM_UNTERMINATED_OPENER'
  | 'CM_SUBSTITUTION_SEPARATOR_MISSING'

export interface DocumentDiagnostic {
  readonly code: DocumentDiagnosticCode
  readonly range: SourceRange
  readonly metadata: Readonly<Record<string, string>>
}

export interface DocumentRevision {
  /**
   * Exact canonical UTF-16 source for this revision. This compatibility
   * accessor materializes and caches the full source on first read, so use
   * sourceLength for length-only work. The revision is engine-local; value
   * enumeration, JSON serialization, spreading, or cloning may invoke this
   * enumerable getter and perform O(N) work. DocumentChange is the portable
   * transport contract.
   */
  readonly source: string
  /** Exact UTF-16 source length without forcing source materialization. */
  readonly sourceLength: number
  /** Top-level CriticMarkup annotations in canonical source order. */
  readonly annotations: readonly CriticMarkupAnnotation[]
  /** Recoverable syntax diagnostics in canonical source order. */
  readonly diagnostics: readonly DocumentDiagnostic[]
}

export type MarkdownProjectionName = 'original' | 'revised'
export type DocumentProjectionName = MarkdownProjectionName | 'markup'
export type ProjectionAffinity = 'previous' | 'next'

export type ProjectionOrigin =
  | Readonly<{
    readonly kind: 'source'
    readonly sourceOffset: number
  }>
  | Readonly<{
    readonly kind: 'generated'
    readonly sourcePosition: number
    readonly affinity: ProjectionAffinity
  }>

export interface ProjectionCoordinateMap {
  /** Portable retained runs; omitted/generated text never claims source. */
  readonly sourceSegments?: readonly MarkupCoordinateSegment[]
  /**
   * Returns the origin of one projected UTF-16 code unit. Generated text is
   * anchored to a source position but never claims to be durable source.
   */
  readonly originAt: (projectedOffset: number) => ProjectionOrigin
  /**
   * Maps a UTF-16 position in the projection to canonical source. At a
   * discontinuity, `previous` selects the source boundary before omitted or
   * generated text and `next` selects the boundary after it. A position inside
   * generated text maps to that text's source anchor.
   */
  readonly toSource: (
    projectedPosition: number,
    affinity: ProjectionAffinity
  ) => number
  /**
   * Maps a canonical UTF-16 source position into the projection. A position
   * inside omitted source snaps before or after the gap according to affinity;
   * at a generated-text anchor, `previous` selects the start of the generated
   * cluster and `next` selects its end.
   */
  readonly toProjected: (
    sourcePosition: number,
    affinity: ProjectionAffinity
  ) => number
  /**
   * Reports whether a half-open source range contributes retained text. Empty
   * ranges never intersect.
   */
  readonly intersectsSource: (range: SourceRange) => boolean
}

export type MarkdownNodeKind =
  | 'document'
  | 'paragraph'
  | 'heading'
  | 'blockquote'
  | 'list'
  | 'list-item'
  | 'thematic-break'
  | 'text'
  | 'soft-break'
  | 'hard-break'
  | 'emphasis'
  | 'strong'
  | 'strikethrough'
  | 'subscript'
  | 'superscript'
  | 'link'
  | 'image'
  | 'inline-code'
  | 'code-block'
  | 'inline-html'
  | 'html-block'
  | 'autolink'
  | 'definition'
  | 'front-matter'
  | 'inline-math'
  | 'math-block'
  | 'diagram'
  | 'table'
  | 'table-row'
  | 'table-cell'
  | 'footnote-definition'
  | 'footnote-reference'
export type MarkdownAttribute = string | number | boolean

export interface MarkdownAstNode {
  readonly kind: MarkdownNodeKind
  /** Half-open UTF-16 range in the projected Markdown source. */
  readonly range: SourceRange
  /**
   * Parser-owned scalar facts for this node.
   *
   * Text nodes expose their CommonMark value as `semanticText` (literal in code) while
   * retaining the exact authored spelling through `range`. Inline-code nodes
   * expose `semanticContent`; this differs from `content` when a containing
   * GFM table consumes an escaped pipe. Fenced code blocks expose decoded
   * `semanticInfo` separately from exact `info`. GFM strong nodes expose
   * `semanticFlattenStrongChildren` when directly nested strong wrappers are
   * transparent under the pinned GFM semantics; the delimiter tree and ranges
   * remain lossless. Ordered lists expose their marker's `delimiter`, `.` or `)`.
   *
   * Link, image, and autolink nodes use `rawDestination` and `rawTitle` to
   * retain Markdown source spelling. Their renderer-ready decoded values are
   * exposed as `semanticDestination` and `semanticTitle`; `decodedDestination`
   * resolves escapes and entities without percent-encoding, as document
   * formats that store a path rather than a URL expect. Resolved reference
   * links/images and footnote references use `resolvedDefinitionStart` and
   * `resolvedDefinitionEnd`; every footnote reference also has a `resolved`
   * boolean and a `rawLabel` preserving the spelling of unresolved references.
   * Every numeric attribute whose name ends in `Start` or `End` is a
   * UTF-16 position in the projection, and each matching Start/End pair
   * describes a half-open subrange. Editor adapters may use those positions
   * directly without re-recognizing Markdown syntax.
   */
  readonly attributes: Readonly<Record<string, MarkdownAttribute>>
  /** Normalized entity, escape or literal indentation spellings; ranges use this node's coordinates. */
  readonly semanticTextSegments?: readonly {
    readonly range: SourceRange
    readonly value: string
  }[]
  readonly children: readonly MarkdownAstNode[]
}

export interface MarkdownAst {
  readonly root: MarkdownAstNode
}

export interface MarkdownProjection {
  readonly kind: 'markdown'
  readonly name: MarkdownProjectionName
  readonly markdown: string
  readonly ast: MarkdownAst
  readonly coordinates: ProjectionCoordinateMap
}

export interface CommentProjection {
  readonly kind: 'comment'
  /** Full canonical range of the enclosing `{>> … <<}` annotation. */
  readonly annotationRange: SourceRange
  /** Revised Markdown for the exact, isolated Comment payload. */
  readonly markdown: string
  readonly ast: MarkdownAst
  readonly coordinates: ProjectionCoordinateMap
}

/**
 * The Markup reading of one Comment payload, as the Review sidebar shows it.
 * Its syntax holds every nested suggestion and highlight arm in canonical
 * order, as the document's Markup syntax does; nested Comments stay hidden.
 * The Comment annotation's nested arms locate those marks, and the
 * coordinates map into the enclosing document's source.
 */
export interface CommentMarkupProjection {
  readonly kind: 'comment-markup'
  /** Full canonical range of the enclosing `{>> … <<}` annotation. */
  readonly annotationRange: SourceRange
  readonly syntax: MarkupSyntax
}

export type MarkupMark =
  | Readonly<{
    readonly kind: 'addition' | 'deletion' | 'highlight'
    readonly annotationRange: SourceRange
  }>
  | Readonly<{
    readonly kind: 'substitution'
    readonly arm: 'old' | 'new'
    readonly annotationRange: SourceRange
  }>

export type MarkupEvent =
  | Readonly<{
    readonly kind: 'enter'
    readonly mark: MarkupMark
  }>
  | Readonly<{
    readonly kind: 'text'
    readonly text: string
    readonly sourceRange: SourceRange
  }>
  | Readonly<{
    readonly kind: 'exit'
    readonly mark: MarkupMark
  }>

export interface MarkupSyntax {
  /**
   * Semantic Markdown over the parser-emitted editing coordinate domain.
   * That domain contains every non-comment CriticMarkup arm in canonical arm
   * order and may contain generated protective text. It is not canonical
   * source and no flattened editing Markdown string is exposed. AST ranges and
   * this coordinate map use that same private projection domain; visible text
   * and CriticMarkup decoration come from `MarkupProjection.events`.
   */
  readonly ast: MarkdownAst
  readonly coordinates: ProjectionCoordinateMap
}

export interface MarkupProjection {
  readonly kind: 'markup'
  readonly name: 'markup'
  /**
   * Linear immutable display stream. Matching enter and exit events share the
   * same mark object, so consumers can validate nesting by identity.
   */
  readonly events: readonly MarkupEvent[]
  readonly syntax: MarkupSyntax
}

export type DocumentProjection = MarkdownProjection | MarkupProjection

export interface DocumentSourceEdit {
  /** Inclusive UTF-16 code-unit offset in the previous revision. */
  readonly start: number
  /** Exclusive UTF-16 code-unit offset in the previous revision. */
  readonly end: number
  readonly insert: string
}

export interface OrdinalRange {
  readonly start: number
  readonly end: number
}

export interface MarkupCoordinateSegment {
  readonly projected: SourceRange
  readonly source: SourceRange
}

export interface MarkupRegionReplacement {
  readonly previous: Readonly<{
    readonly source: SourceRange
    readonly syntax: SourceRange
    readonly events: OrdinalRange
  }>
  readonly next: Readonly<{
    readonly source: SourceRange
    readonly syntax: SourceRange
    readonly events: OrdinalRange
  }>
  readonly events: readonly MarkupEvent[]
  readonly syntaxBlocks: readonly MarkdownAstNode[]
  readonly coordinates: readonly MarkupCoordinateSegment[]
  /**
   * The outermost annotations of the replaced blocks, as the revision's
   * annotations hold them: a view reads the region with the same
   * annotation facts it reads the whole document with.
   */
  readonly annotations: readonly CriticMarkupAnnotation[]
  /**
   * The unchanged text events from the block before the replaced ones to
   * their start, when the region was read with it: the view of a block's
   * first line can depend on the lines before it, as a blank line's end is
   * the position of the empty line Enter leaves there.
   */
  readonly precedingEvents?: readonly Extract<MarkupEvent, { kind: 'text' }>[]
  /**
   * Where the first block after the replaced ones starts, when the region
   * was read with it, with the text events up to there: a view keeps the
   * blank text between a block and the next one.
   */
  readonly following?: Readonly<{
    blockStart: number,
    events: readonly Extract<MarkupEvent, { kind: 'text' }>[]
  }>
  /**
   * Present when the replaced blocks are items of a list that keeps items
   * outside them: `syntaxBlocks` are items that replace the list's
   * `previousItems` items after its first `itemsBefore`. `list` gives the
   * whole list's attributes, which the replacement leaves as they were; it
   * lists no children.
   */
  readonly listItems?: Readonly<{
    readonly list: MarkdownAstNode
    readonly itemsBefore: number
    readonly previousItems: number
    /**
     * The replaced items' canonical source, delimiters included, which the
     * view reads the list's structure from.
     */
    readonly source: string
  }>
  /**
   * Present when the replaced blocks are lines of one literal block (code,
   * math, HTML or a diagram) that keeps lines outside them: `syntaxBlocks`
   * are the block's children for its lines replacing its `previousLines`
   * lines, of `previousChildren` children, after its first `linesBefore`
   * lines, of `childrenBefore` children. `block` gives the whole block's
   * kind and attributes, other than its offsets and text, which the
   * replacement leaves as they were; it lists no children.
   */
  readonly literalLines?: Readonly<{
    readonly block: MarkdownAstNode
    readonly linesBefore: number
    readonly childrenBefore: number
    readonly previousLines: number
    readonly previousChildren: number
    /** The replaced lines' canonical source. */
    readonly source: string
    /**
     * Where the replaced lines start in the source, when the replaced span
     * holds more than those lines (see `enclosing`).
     */
    readonly sourceStart?: number
  }>
  /**
   * Present when the replaced lines are lines of a literal block that is
   * the whole text of a suggestion's arm: the replaced span is the text
   * event holding the block, and these are the previous source ranges of
   * the suggestions holding it, which keep their starts and whose ends move
   * with the edit; the Markup marks of those suggestions outside the
   * replaced span read their ranges so.
   */
  readonly enclosing?: readonly SourceRange[]
}

export interface MarkupRegionProjectionChange {
  readonly name: 'markup'
  readonly scope: 'regions'
  readonly replacements: readonly MarkupRegionReplacement[]
}

export interface CommentProjectionRequest {
  readonly name: 'comment'
  /** Exact full annotation range in the previous revision. */
  readonly annotationRange: SourceRange
}

export type DocumentProjectionRequest = 'markup' | CommentProjectionRequest

export interface CommentProjectionSpan {
  /** Full canonical range including the enclosing Comment markers. */
  readonly annotation: SourceRange
  /** Canonical Comment payload range excluding its markers. */
  readonly payload: SourceRange
  /** Range in the isolated Comment Display projection. */
  readonly projection: SourceRange
}

export interface CommentRegionReplacement {
  readonly previous: CommentProjectionSpan
  readonly next: CommentProjectionSpan
  /** Full portable annotation subtree in the next revision. */
  readonly annotation: CriticMarkupAnnotationSnapshot
  readonly markdown: string
  readonly ast: MarkdownAst
  readonly coordinates: readonly CommentCoordinateSegment[]
}

export interface CriticMarkupAnnotationSnapshotArm {
  readonly name: CriticMarkupArm['name']
  readonly range: SourceRange
  /** Direct child ordinals into the containing snapshot's node table. */
  readonly children: readonly number[]
}

export interface CriticMarkupAnnotationSnapshotNode {
  readonly kind: CriticMarkupKind
  readonly range: SourceRange
  readonly arms: readonly CriticMarkupAnnotationSnapshotArm[]
}

/** Depth-independent portable encoding of one CriticMarkup annotation tree. */
export interface CriticMarkupAnnotationSnapshot {
  readonly root: number
  readonly nodes: readonly CriticMarkupAnnotationSnapshotNode[]
}

export type CommentCoordinateSegment =
  | Readonly<{
    readonly kind: 'source'
    readonly projected: SourceRange
    readonly source: SourceRange
  }>
  | Readonly<{
    readonly kind: 'generated'
    readonly projected: SourceRange
    readonly sourcePosition: number
    readonly affinity: ProjectionAffinity
  }>

export interface CommentRegionProjectionChange {
  readonly name: 'comment'
  readonly scope: 'regions'
  readonly replacements: readonly CommentRegionReplacement[]
}

export type DocumentProjectionFallbackReason =
  | 'criticmarkup-facts-present'
  | 'definition-or-reference-facts'
  | 'markdown-options-changed'
  | 'source-fragmentation-rebase'
  | 'structural-region-ineligible'

export interface MarkupDocumentProjectionChange {
  readonly name: 'markup'
  readonly scope: 'document'
  readonly reason: DocumentProjectionFallbackReason
}

export interface CommentDocumentProjectionChange {
  readonly name: 'comment'
  readonly scope: 'document'
  readonly targets: readonly SourceRange[]
  readonly reason: DocumentProjectionFallbackReason
}

export type DocumentProjectionChange =
  | MarkupRegionProjectionChange
  | MarkupDocumentProjectionChange
  | CommentRegionProjectionChange
  | CommentDocumentProjectionChange

/** Exact canonical source carried only when regional publication falls back. */
export interface DocumentSourceResynchronization {
  readonly kind: 'source'
  readonly scope: 'document'
  readonly reason: DocumentProjectionFallbackReason
  readonly source: string
}

/**
 * One atomically admitted canonical-source transaction. The core owns source
 * reconstruction; callers retain the exact accepted edits for reconciliation
 * without carrying a second candidate source.
 */
export interface DocumentChange {
  readonly appliedEdits: readonly DocumentSourceEdit[]
  readonly projections: readonly DocumentProjectionChange[]
  readonly resynchronization?: DocumentSourceResynchronization
}

export interface DocumentCommit {
  /** Engine-local revision handle; actor transports publish only `change`. */
  readonly revision: DocumentRevision
  readonly change: DocumentChange
}

export interface DocumentApplyOptions {
  /** Partial language options inherited over the previous revision. */
  readonly markdown?: Readonly<Partial<MarkdownOptions>>
  /** Projection deltas requested atomically with admission. */
  readonly projections?: readonly DocumentProjectionRequest[]
}

export type DocumentResolutionDecision = 'accept' | 'reject'

export interface MarkdownOptions {
  readonly gfm: boolean
  /** GFM's extended-autolink extension, independently selectable. */
  readonly gfmAutolinks: boolean
  /** GFM's disallowed-raw-HTML extension, independently selectable. */
  readonly gfmTagFilter: boolean
  readonly frontMatter: boolean
  /** pandoc's tex_math_dollars: `$…$` and `$$…$$`. */
  readonly texMathDollars: boolean
  /** pandoc's tex_math_gfm: `` $`…`$ `` and the ```math fence. */
  readonly texMathGfm: boolean
  /** pandoc's tex_math_single_backslash: `\(…\)` and `\[…\]`. */
  readonly texMathSingleBackslash: boolean
  /** pandoc's tex_math_double_backslash: `\\(…\\)` and `\\[…\\]`. */
  readonly texMathDoubleBackslash: boolean
  readonly footnotes: boolean
  readonly subscriptAndSuperscript: boolean
}

export type DocumentCoreErrorCode =
  | 'CM_RESOURCE_SOURCE_UNITS_EXCEEDED'
  | 'CM_RESOURCE_LOGICAL_NODES_EXCEEDED'
  | 'CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED'
  | 'CM_RESOURCE_CM_DEPTH_EXCEEDED'

export class DocumentCoreError extends Error {
  readonly code: DocumentCoreErrorCode
  readonly range: SourceRange
  readonly metadata: Readonly<Record<string, string>>

  constructor(
    code: DocumentCoreErrorCode,
    range: SourceRange,
    metadata: Readonly<Record<string, string>>
  ) {
    super(`Document parser rejected source: ${code}`)
    this.name = 'DocumentCoreError'
    this.code = code
    this.range = Object.freeze({ ...range })
    this.metadata = Object.freeze({ ...metadata })
  }
}

/** Invalid canonical-source transaction input; no revision was published. */
export class DocumentSourceEditError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentSourceEditError'
  }
}

/**
 * One document lineage. Successful open and reopen calls advance its current
 * revision. Older revisions remain projectable but cannot be reopened.
 */
export interface DocumentCore {
  /** Source highlighting from this revision’s shared Markdown and CriticMarkup syntax. */
  sourceSyntax(revision: DocumentRevision): readonly DocumentSourceSyntaxSpan[]
  /** Plans an imported clipboard action against the exact current source selection. */
  planAuthor(previous: DocumentRevision, action: DocumentAuthorAction): DocumentAuthorPlan | undefined
  /**
   * Replaces an existing Comment's payload with the author's text, adding the
   * Profile's minimal backslash escapes only where the text would otherwise
   * close or break the Comment. `escaped` reports that MarkText-only spelling.
   */
  planCommentEdit(previous: DocumentRevision, action: DocumentCommentAction): DocumentCommentPlan | undefined
  planClipboard(previous: DocumentRevision, action: DocumentClipboardAction): DocumentClipboardPlan
  /**
   * `edits`, which no edit planner made (such as a Find replacement), with the
   * normalizations `options` ask for composed into the same operation (see
   * `normalizeEdits`).
   */
  normalizeEdits(previous: DocumentRevision, edits: readonly DocumentSourceEdit[], options: EditNormalizationOptions): readonly DocumentSourceEdit[]
  /** Plans a native inline-format action using owned syntax and exact source positions. */
  planSourceInput(previous: DocumentRevision, action: DocumentSourceInputAction): DocumentSourceInputAction
  planFormat(previous: DocumentRevision, action: DocumentFormatAction): DocumentFormatPlan
  /**
   * Plan an actual native action using the current owned language context.
   * Spelling that upstream normalizes around an edit, such as table padding,
   * is written only for an input known to be untracked; a suggestion never
   * carries it.
   */
  planInput(previous: DocumentRevision, action: DocumentInputAction, options?: { readonly tracked?: boolean }): DocumentInputPlan
  /** Compile a planned input with its actual operation's annotation-consumption scope. */
  inputEdits(previous: DocumentRevision, action: DocumentInputAction, plan: DocumentInputPlan, tracked: boolean): readonly DocumentSourceEdit[] | undefined
  /** Locate a planned input selection in its admitted canonical source. */
  reconcileInput(previous: DocumentRevision, policy: DocumentInputPlan, commit: DocumentCommit | null, action: DocumentInputAction): DocumentInputResult
  /** Maps the exact edited payload into admitted syntax, including review arms and escapes. */
  editingReconciliation(previous: DocumentRevision, input: DocumentSourceEdit, commit: DocumentCommit): readonly DocumentSourceEdit[] | undefined
  /**
   * Plans ordinary editing across a source envelope selected in Markup. Hidden
   * comments and surviving annotation wrappers remain intact. Undefined refuses
   * an unsafe mapping without changing the current revision.
   */
  markupEdit(previous: DocumentRevision, edit: DocumentSourceEdit): readonly DocumentSourceEdit[] | undefined
  /** Plans sparse native changes as one transaction, preserving source between edits. */
  markupEdits(previous: DocumentRevision, edits: readonly DocumentSourceEdit[]): readonly DocumentSourceEdit[] | undefined
  trackedEdits(previous: DocumentRevision, edits: readonly DocumentSourceEdit[]): readonly DocumentSourceEdit[] | undefined
  /** Plans one tracked native-text edit against this revision's owned syntax. */
  trackedEdit(
    previous: DocumentRevision,
    edit: DocumentSourceEdit
  ): DocumentSourceEdit | undefined
  /** Authors and atomically applies one tracked native-text edit. */
  track(
    previous: DocumentRevision,
    edit: DocumentSourceEdit,
    options?: DocumentApplyOptions
  ): DocumentCommit
  open(
    source: string,
    options?: Readonly<Partial<MarkdownOptions>>
  ): DocumentRevision
  /**
   * Admits exact source edits as one transaction. Edits never split a UTF-16
   * surrogate pair: one whose start or end falls between a pair's halves, or
   * whose insert holds a lone surrogate, is refused with
   * DocumentSourceEditError and nothing is published. Refusing rather than
   * widening keeps each edit's reported extent the caller's own.
   */
  apply(
    previous: DocumentRevision,
    edits: readonly DocumentSourceEdit[],
    options?: DocumentApplyOptions
  ): DocumentCommit
  /**
   * Resolves one exact CriticMarkup annotation owned by `previous`. Resolution
   * is admitted through the same atomic source transaction as ordinary edits.
   */
  resolve(
    previous: DocumentRevision,
    annotation: CriticMarkupAnnotation,
    decision: DocumentResolutionDecision,
    options?: DocumentApplyOptions
  ): DocumentCommit
  /** Reads one bounded canonical-source range without materializing a revision. */
  sourceSlice(revision: DocumentRevision, range: SourceRange): string
  /**
   * Transitional compatibility entry point. Core-mode consumers should use
   * `apply`, which does not accept a separately reconstructed candidate.
   */
  reopen(
    previous: DocumentRevision,
    source: string,
    edits: readonly DocumentSourceEdit[],
    options?: Readonly<Partial<MarkdownOptions>>
  ): DocumentRevision
  project(
    revision: DocumentRevision,
    projection: MarkdownProjectionName
  ): MarkdownProjection
  project(
    revision: DocumentRevision,
    projection: 'markup'
  ): MarkupProjection
  project(
    revision: DocumentRevision,
    projection: DocumentProjectionName
  ): DocumentProjection
  /**
   * Projects one exact Comment object owned by `revision` as an isolated full
   * Markdown+CriticMarkup subdocument. The returned Markdown is the Comment's
   * Revised interpretation; its block, reference, and footnote state is local.
   */
  projectComment(
    revision: DocumentRevision,
    comment: CriticMarkupAnnotation
  ): CommentProjection
  projectComment(
    revision: DocumentRevision,
    comment: CriticMarkupAnnotation,
    view: 'markup'
  ): CommentMarkupProjection
  /**
   * Whether a half-open source range contributes retained text to a
   * projection, as that projection's coordinates report. A revision reached
   * by a regional edit answers from the blocks around the range instead of
   * projecting the whole document.
   */
  intersectsProjection(
    revision: DocumentRevision,
    projection: DocumentProjectionName,
    range: SourceRange
  ): boolean
  /**
   * A projection holding the source range `range`, whose ends are top-level
   * block starts or the document's ends, and the projected span the range
   * reads as there. Each end of the span falls after any text omitted or
   * generated at that end of the range, so adjacent ranges read as adjacent
   * spans. A revision reached by a regional edit is read from the blocks
   * around the range, so the projection may hold only those blocks; its
   * coordinates still map to the revision's source.
   */
  projectAround(
    revision: DocumentRevision,
    projection: MarkdownProjectionName,
    range: SourceRange
  ): Readonly<{ projection: MarkdownProjection; span: SourceRange }>
}

const DEFAULT_MARKDOWN_OPTIONS: MarkdownOptions = Object.freeze({
  gfm: true,
  gfmAutolinks: true,
  gfmTagFilter: true,
  frontMatter: true,
  texMathDollars: true,
  texMathGfm: false,
  texMathSingleBackslash: false,
  texMathDoubleBackslash: false,
  footnotes: false,
  subscriptAndSuperscript: false
})

// Resource and accounting profiles remain private transitional inputs to the
// research parser. They are deliberately absent from the MarkText facade.
/** Browser input types that transcribe the user's own typed characters. */
const typedInputTypes: ReadonlySet<string> = new Set(['insertText', 'insertCompositionText', 'insertReplacementText'])

const EXECUTION_BUDGET: ExecutionBudgetId = Object.freeze({
  limitsProfile: 'desktop-v1',
  accountingSchema: 'syntax-accounting-1'
})

function markdownOptions(
  options: Readonly<Partial<MarkdownOptions>> = {},
  inherited: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS
): MarkdownOptionsV1 {
  // Profile 1 Y1: an unrecognized configuration name is refused rather than
  // carried into a revision's parse configuration.
  for (const name of Object.keys(options)) {
    if (!Object.hasOwn(DEFAULT_MARKDOWN_OPTIONS, name)) {
      throw new TypeError(`Unknown Markdown option ${name}`)
    }
  }
  const resolved = Object.freeze({
    gfm: inherited.gfm,
    gfmAutolinks: inherited.gfmAutolinks,
    gfmTagFilter: inherited.gfmTagFilter,
    frontMatter: inherited.frontMatter,
    texMathDollars: inherited.texMathDollars,
    texMathGfm: inherited.texMathGfm,
    texMathSingleBackslash: inherited.texMathSingleBackslash,
    texMathDoubleBackslash: inherited.texMathDoubleBackslash,
    footnotes: inherited.footnotes,
    subscriptAndSuperscript: inherited.subscriptAndSuperscript,
    ...options
  })

  for (const [name, value] of Object.entries(resolved)) {
    if (typeof value !== 'boolean') {
      throw new TypeError(`Markdown option ${name} must be a boolean`)
    }
  }

  return Object.freeze({
    schema: 'markdown-options-1',
    ...resolved
  })
}

interface MaterializedAnnotations {
  readonly annotations: readonly CriticMarkupAnnotation[]
  readonly rangeByNodeId: ReadonlyMap<NodeId, SourceRange>
  readonly nodeIdByAnnotation: ReadonlyMap<CriticMarkupAnnotation, NodeId>
}

/** What a candidate's reader views and its whole parse both hold. */
type ReaderProducts = Pick<Profile1DocumentProducts, 'criticMarkup' | 'diagnostics' | 'original' | 'revised'>

/** Everything a candidate's reader views publish, node identities included. */
function readerViewsDigest(products: ReaderProducts): string {
  const nodes = (projection: Profile1DocumentProducts['original']): string => {
    const parts: string[] = []
    const visit = (node: MarkdownAstNode): void => {
      parts.push(`(${String((node as { nodeId?: unknown }).nodeId)} ${node.kind} ${node.range.start}-${node.range.end} ${JSON.stringify(node.attributes)}`)
      for (const child of node.children) visit(child)
      parts.push(')')
    }
    visit(markdownAstOf(projection).root)
    return `${JSON.stringify(projection.source)}${parts.join('')}`
  }
  const { annotations, rangeByNodeId } = annotationsOf(products)
  return JSON.stringify([
    annotations, [...rangeByNodeId], diagnosticsOf(products), nodes(products.original), nodes(products.revised)
  ])
}

function annotationsOf(
  products: Pick<Profile1DocumentProducts, 'criticMarkup'>
): MaterializedAnnotations {
  const roots = Array.from(
    { length: products.criticMarkup.rootCount },
    (_, ordinal) => products.criticMarkup.rootAt(ordinal)
  )
  const materialized = new Map<CriticMarkupNode, CriticMarkupAnnotation>()
  const rangeByNodeId = new Map<NodeId, SourceRange>()
  const nodeIdByAnnotation = new Map<CriticMarkupAnnotation, NodeId>()
  const pending = roots.map(annotation => ({ annotation, ready: false }))

  while (pending.length > 0) {
    const task = pending.pop()
    if (task === undefined) break

    if (!task.ready) {
      pending.push({ annotation: task.annotation, ready: true })
      for (let armIndex = task.annotation.arms.length - 1; armIndex >= 0; armIndex -= 1) {
        const arm = task.annotation.arms[armIndex]
        if (arm === undefined) continue
        for (let childIndex = arm.children.length - 1; childIndex >= 0; childIndex -= 1) {
          const child = arm.children[childIndex]
          if (child !== undefined) {
            pending.push({ annotation: child, ready: false })
          }
        }
      }
      continue
    }

    const range = sourceRangeOf(task.annotation.range)
    rangeByNodeId.set(task.annotation.nodeId, range)
    const annotation: CriticMarkupAnnotation = Object.freeze({
      kind: task.annotation.kind,
      range,
      arms: Object.freeze(task.annotation.arms.map(arm => Object.freeze({
        name: arm.name,
        range: sourceRangeOf(arm.range),
        annotations: Object.freeze(arm.children.map(child => {
          const annotation = materialized.get(child)
          if (annotation === undefined) {
            throw new Error('CriticMarkup child was not materialized')
          }
          return annotation
        }))
      })))
    })
    materialized.set(task.annotation, annotation)
    nodeIdByAnnotation.set(annotation, task.annotation.nodeId)
  }

  const annotations = Object.freeze(roots.map(root => {
    const annotation = materialized.get(root)
    if (annotation === undefined) {
      throw new Error('CriticMarkup root was not materialized')
    }
    return annotation
  }))
  return Object.freeze({ annotations, rangeByNodeId, nodeIdByAnnotation })
}

function annotationFactsForMaterialized(
  products: Profile1DocumentProducts,
  annotations: readonly CriticMarkupAnnotation[]
): MaterializedAnnotations {
  const parserRoots = Array.from(
    { length: products.criticMarkup.rootCount },
    (_, ordinal) => products.criticMarkup.rootAt(ordinal)
  )
  if (parserRoots.length !== annotations.length) {
    throw new Error('Regional inventory annotation roots diverged')
  }
  const rangeByNodeId = new Map<NodeId, SourceRange>()
  const nodeIdByAnnotation = new Map<CriticMarkupAnnotation, NodeId>()
  const pending = parserRoots.map((node, ordinal) => {
    const annotation = annotations[ordinal]
    if (annotation === undefined) {
      throw new Error('Regional inventory annotation root is sparse')
    }
    return { node, annotation }
  })
  while (pending.length > 0) {
    const pair = pending.pop()
    if (pair === undefined) break
    if (
      pair.node.kind !== pair.annotation.kind ||
      pair.node.arms.length !== pair.annotation.arms.length
    ) {
      throw new Error('Regional inventory annotation topology diverged')
    }
    rangeByNodeId.set(pair.node.nodeId, pair.annotation.range)
    nodeIdByAnnotation.set(pair.annotation, pair.node.nodeId)
    for (let armOrdinal = 0; armOrdinal < pair.node.arms.length; armOrdinal += 1) {
      const parserArm = pair.node.arms[armOrdinal]
      const publicArm = pair.annotation.arms[armOrdinal]
      if (
        parserArm === undefined || publicArm === undefined ||
        parserArm.name !== publicArm.name ||
        parserArm.children.length !== publicArm.annotations.length
      ) {
        throw new Error('Regional inventory annotation arm diverged')
      }
      for (let childOrdinal = 0; childOrdinal < parserArm.children.length; childOrdinal += 1) {
        const node = parserArm.children[childOrdinal]
        const annotation = publicArm.annotations[childOrdinal]
        if (node === undefined || annotation === undefined) {
          throw new Error('Regional inventory annotation child is sparse')
        }
        pending.push({ node, annotation })
      }
    }
  }
  return Object.freeze({ annotations, rangeByNodeId, nodeIdByAnnotation })
}

function sourceRangeOf(range: {
  readonly start: number
  readonly end: number
}): SourceRange {
  return Object.freeze({ start: range.start, end: range.end })
}

function markdownAstOf(
  projection: Profile1DocumentProducts['original']
): MarkdownAst {
  const semanticMarkdown = projection.semanticMarkdown ?? projection.markdown
  const semanticToProjected = projection.semanticToProjected ??
    ((offset: number): number => offset)
  const projectedRange = (range: {
    readonly start: number
    readonly end: number
  }): SourceRange => Object.freeze({
    start: semanticToProjected(range.start, 'previous'),
    end: semanticToProjected(range.end, 'previous')
  })
  const root = semanticMarkdown.root
  const materialized = new Map<ParserMarkdownNode, MarkdownAstNode>()
  const footnoteReferenceByNode = new Map<ParserMarkdownNode, Readonly<{
    readonly definition?: Readonly<{ readonly node: ParserMarkdownNode }>
  }>>()
  for (
    let ordinal = 0;
    ordinal < semanticMarkdown.references.footnoteReferenceCount;
    ordinal += 1
  ) {
    const reference = semanticMarkdown.references.footnoteReferenceAt(ordinal)
    footnoteReferenceByNode.set(reference.node, reference)
  }
  const pending: Array<Readonly<{
    node: ParserMarkdownNode
    ready: boolean
    inTable: boolean
    inLiteral: boolean
  }>> = [{ node: root, ready: false, inTable: false, inLiteral: false }]

  while (pending.length > 0) {
    const task = pending.pop()
    if (task === undefined) break

    if (!task.ready) {
      pending.push({ ...task, ready: true })
      const inTable = task.inTable || task.node.kind === 'table'
      const inLiteral = task.inLiteral || isLiteralBlock(task.node.kind)
      for (let ordinal = task.node.childCount - 1; ordinal >= 0; ordinal -= 1) {
        pending.push({
          node: task.node.childAt(ordinal),
          ready: false,
          inTable,
          inLiteral
        })
      }
      continue
    }

    const attributes: Record<string, MarkdownAttribute> = {
      ...task.node.attributes
    }
    const semanticTextSegments: Array<{ readonly range: SourceRange, readonly value: string }> = []
    if (task.node.kind === 'text' && task.inLiteral) {
      const value = attributes.semanticText
      if (typeof value !== 'string') throw new Error('Literal payload text has no literal value')
      if (semanticMarkdown.source.slice(task.node.range.start, task.node.range.end) !== value) {
        semanticTextSegments.push(Object.freeze({ range: projectedRange(task.node.range), value }))
      }
    } else if (task.node.kind === 'text') {
      const semanticStart = task.node.attributes['semanticStart']
      const semanticEnd = task.node.attributes['semanticEnd']
      const start = typeof semanticStart === 'number' ? semanticStart : task.node.range.start
      attributes.semanticText = decodeMarkdownSemanticText(
        semanticMarkdown.source.slice(
          start,
          typeof semanticEnd === 'number' ? semanticEnd : task.node.range.end
        ),
        (from, to, value) => semanticTextSegments.push(Object.freeze({
          range: projectedRange({ start: start + from, end: start + to }), value
        }))
      )
    } else if (task.node.kind === 'inline-code') {
      const content = task.node.attributes['content']
      if (typeof content === 'string') {
        attributes.semanticContent = task.inTable
          ? decodeGfmTableCodeContent(content)
          : content
      }
    } else if (task.node.kind === 'code-block') {
      const info = task.node.attributes['info']
      if (typeof info === 'string') attributes.semanticInfo = decodeMarkdownSemanticText(info)
      const infoStart = task.node.attributes['infoStart']
      const infoEnd = task.node.attributes['infoEnd']
      if (typeof infoStart === 'number' && typeof infoEnd === 'number') {
        attributes.infoInputValue = decodeMarkdownSemanticText(semanticMarkdown.source.slice(infoStart, infoEnd),
          (from, to, value) => semanticTextSegments.push(Object.freeze({ range: projectedRange({ start: infoStart + from, end: infoStart + to }), value })))
      }
    }
    delete attributes.semanticStart
    delete attributes.semanticEnd
    for (const [key, value] of Object.entries(attributes)) {
      if (typeof value !== 'number') continue
      if (key.endsWith('Start')) {
        attributes[key] = semanticToProjected(value, 'next')
      } else if (key.endsWith('End')) {
        attributes[key] = semanticToProjected(value, 'previous')
      }
    }
    delete attributes.destination
    delete attributes.title
    const link = semanticMarkdown.references.linkForNode(task.node.nodeId)
    if (link !== undefined) {
      attributes.rawDestination = task.node.kind === 'autolink'
        ? semanticMarkdown.source.slice(
          Math.min(task.node.range.end, task.node.range.start + 1),
          Math.max(task.node.range.start + 1, task.node.range.end - 1)
        )
        : task.node.attributes['extendedAutolink'] === true
          ? semanticMarkdown.source.slice(
            task.node.range.start,
            task.node.range.end
          )
          : link.destination
      attributes.semanticDestination = task.node.kind === 'autolink'
        ? normalizeMarkdownAutolinkDestination(link.destination)
        : normalizeMarkdownSemanticDestination(link.destination)
      attributes.decodedDestination = task.node.kind === 'autolink'
        ? link.destination
        : decodeMarkdownSemanticText(link.destination)
      if (link.title !== undefined) {
        attributes.rawTitle = link.title
        attributes.semanticTitle = decodeMarkdownSemanticText(link.title)
      }
      if (link.definition !== undefined) {
        attributes.resolvedDefinitionStart = semanticToProjected(
          link.definition.node.range.start,
          'next'
        )
        attributes.resolvedDefinitionEnd = semanticToProjected(
          link.definition.node.range.end,
          'previous'
        )
      }
    }
    if (task.node.kind === 'footnote-reference') {
      const definition = footnoteReferenceByNode.get(task.node)?.definition
      attributes.resolved = definition !== undefined
      if (definition !== undefined) {
        attributes.resolvedDefinitionStart = semanticToProjected(
          definition.node.range.start,
          'next'
        )
        attributes.resolvedDefinitionEnd = semanticToProjected(
          definition.node.range.end,
          'previous'
        )
      }
    }
    const children = Object.freeze(Array.from(
      { length: task.node.childCount },
      (_, ordinal) => {
        const child = materialized.get(task.node.childAt(ordinal))
        if (child === undefined) {
          throw new Error('Markdown child was not materialized')
        }
        return child
      }
    ))
    materialized.set(task.node, Object.freeze({
      kind: task.node.kind,
      range: projectedRange(task.node.range),
      attributes: Object.freeze(attributes),
      ...(semanticTextSegments.length > 0 ? { semanticTextSegments: Object.freeze(semanticTextSegments) } : {}),
      children
    }))
  }

  const materializedRoot = materialized.get(root)
  if (materializedRoot === undefined) {
    throw new Error('Markdown root was not materialized')
  }
  return Object.freeze({ root: materializedRoot })
}

function accountingUnitsOf(products: Profile1DocumentProducts): number {
  return products.accountingCounts.reduce((total, count) => total + count, 0)
}

function countMarkdownAstNodes(root: MarkdownAstNode): number {
  let count = 0
  const pending = [root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) break
    count += 1
    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index]
      if (child !== undefined) pending.push(child)
    }
  }
  return count
}

function countCriticMarkupAnnotationNodes(
  roots: readonly CriticMarkupAnnotation[]
): number {
  let count = 0
  const pending = [...roots]
  while (pending.length > 0) {
    const annotation = pending.pop()
    if (annotation === undefined) break
    count += 1
    for (const arm of annotation.arms) {
      for (const child of arm.annotations) pending.push(child)
    }
  }
  return count
}

function shiftMarkdownAstNode(
  node: MarkdownAstNode,
  delta: number
): MarkdownAstNode {
  const attributes: Record<string, MarkdownAttribute> = { ...node.attributes }
  for (const [name, value] of Object.entries(attributes)) {
    if (
      typeof value === 'number' &&
      (name.endsWith('Start') || name.endsWith('End'))
    ) {
      attributes[name] = value + delta
    }
  }
  return Object.freeze({
    kind: node.kind,
    range: Object.freeze({
      start: node.range.start + delta,
      end: node.range.end + delta
    }),
    attributes: Object.freeze(attributes),
    ...(node.semanticTextSegments === undefined
      ? {}
      : {
        semanticTextSegments: Object.freeze(node.semanticTextSegments.map(segment => Object.freeze({
          range: Object.freeze({ start: segment.range.start + delta, end: segment.range.end + delta }),
          value: segment.value
        })))
      }),
    children: Object.freeze(node.children.map(
      child => shiftMarkdownAstNode(child, delta)
    ))
  })
}

/** Window annotations inside `[start, end)` of the window, in document source offsets. */
function regionalAnnotations(
  annotations: readonly CriticMarkupAnnotation[],
  sourceStart: number,
  start = 0,
  end = Number.POSITIVE_INFINITY
): readonly CriticMarkupAnnotation[] {
  return Object.freeze(annotations
    .filter(annotation => annotation.range.start >= start && annotation.range.end <= end)
    .map(annotation => shiftCriticMarkupAnnotation(annotation, sourceStart)))
}

function shiftRegionalTextEvent(
  event: Extract<MarkupEvent, { kind: 'text' }>,
  delta: number
): MarkupEvent {
  return Object.freeze({
    kind: 'text',
    text: event.text,
    sourceRange: Object.freeze({
      start: event.sourceRange.start + delta,
      end: event.sourceRange.end + delta
    })
  })
}

/**
 * The list holding a regional replacement's items, as the whole list reads
 * in place: the window's list reads its own items only, so its looseness,
 * task reading and start come from the list's key (`listKeyOf`).
 */
function regionalListNode(key: string, windowList: MarkdownAstNode, delta: number): MarkdownAstNode {
  const [ordered, delimiter, tight, taskList, start] = key.split('|')
  return Object.freeze({
    kind: windowList.kind,
    range: Object.freeze({ start: windowList.range.start + delta, end: windowList.range.end + delta }),
    attributes: Object.freeze({
      ordered: ordered === 'true',
      ...(ordered === 'true' ? { start: Number(start) } : {}),
      tight: tight === 'true',
      ...(taskList === 'true' ? { taskList: true } : {}),
      ...(ordered === 'true' && delimiter !== undefined && delimiter !== '' ? { delimiter } : {})
    }),
    children: Object.freeze([])
  })
}

function shiftRegionalMarkupEvents(
  events: readonly MarkupEvent[],
  sourceDelta: number
): readonly MarkupEvent[] {
  const shiftedMarks = new WeakMap<object, MarkupMark>()
  const shiftMark = (mark: MarkupMark): MarkupMark => {
    const retained = shiftedMarks.get(mark)
    if (retained !== undefined) return retained
    const annotationRange = Object.freeze({
      start: mark.annotationRange.start + sourceDelta,
      end: mark.annotationRange.end + sourceDelta
    })
    const shifted = mark.kind === 'substitution'
      ? Object.freeze({
        kind: mark.kind,
        arm: mark.arm,
        annotationRange
      })
      : Object.freeze({ kind: mark.kind, annotationRange })
    shiftedMarks.set(mark, shifted)
    return shifted
  }
  return Object.freeze(events.map((event): MarkupEvent => {
    if (event.kind === 'text') {
      return shiftRegionalTextEvent(event, sourceDelta)
    }
    return Object.freeze({ kind: event.kind, mark: shiftMark(event.mark) })
  }))
}

function shiftCriticMarkupAnnotation(
  annotation: CriticMarkupAnnotation,
  delta: number
): CriticMarkupAnnotation {
  const shifted = new Map<CriticMarkupAnnotation, CriticMarkupAnnotation>()
  const pending = [{ annotation, ready: false }]
  while (pending.length > 0) {
    const task = pending.pop()
    if (task === undefined) break
    if (!task.ready) {
      pending.push({ annotation: task.annotation, ready: true })
      for (
        let armIndex = task.annotation.arms.length - 1;
        armIndex >= 0;
        armIndex -= 1
      ) {
        const arm = task.annotation.arms[armIndex]
        if (arm === undefined) continue
        for (
          let childIndex = arm.annotations.length - 1;
          childIndex >= 0;
          childIndex -= 1
        ) {
          const child = arm.annotations[childIndex]
          if (child !== undefined) {
            pending.push({ annotation: child, ready: false })
          }
        }
      }
      continue
    }
    const materialized: CriticMarkupAnnotation = Object.freeze({
      kind: task.annotation.kind,
      range: Object.freeze({
        start: task.annotation.range.start + delta,
        end: task.annotation.range.end + delta
      }),
      arms: Object.freeze(task.annotation.arms.map(arm => Object.freeze({
        name: arm.name,
        range: Object.freeze({
          start: arm.range.start + delta,
          end: arm.range.end + delta
        }),
        annotations: Object.freeze(arm.annotations.map(child => {
          const materializedChild = shifted.get(child)
          if (materializedChild === undefined) {
            throw new Error('CriticMarkup child was not shifted')
          }
          return materializedChild
        }))
      })))
    })
    shifted.set(task.annotation, materialized)
  }
  const root = shifted.get(annotation)
  if (root === undefined) {
    throw new Error('CriticMarkup annotation was not shifted')
  }
  return root
}

function annotationSnapshotOf(
  annotation: CriticMarkupAnnotation
): CriticMarkupAnnotationSnapshot {
  const nodes: CriticMarkupAnnotation[] = []
  const ordinalByNode = new Map<CriticMarkupAnnotation, number>()
  const pending = [annotation]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined || ordinalByNode.has(node)) continue
    ordinalByNode.set(node, nodes.length)
    nodes.push(node)
    for (let armIndex = node.arms.length - 1; armIndex >= 0; armIndex -= 1) {
      const arm = node.arms[armIndex]
      if (arm === undefined) continue
      for (
        let childIndex = arm.annotations.length - 1;
        childIndex >= 0;
        childIndex -= 1
      ) {
        const child = arm.annotations[childIndex]
        if (child !== undefined) pending.push(child)
      }
    }
  }
  return Object.freeze({
    root: 0,
    nodes: Object.freeze(nodes.map(node => Object.freeze({
      kind: node.kind,
      range: node.range,
      arms: Object.freeze(node.arms.map(arm => Object.freeze({
        name: arm.name,
        range: arm.range,
        children: Object.freeze(arm.annotations.map(child => {
          const ordinal = ordinalByNode.get(child)
          if (ordinal === undefined) {
            throw new Error('CriticMarkup child was not snapshotted')
          }
          return ordinal
        }))
      })))
    })))
  })
}

function balancedRegionalMarkupEvents(
  events: readonly MarkupEvent[],
  index: CriticMarkupRegionalIndex
): boolean {
  const stack: MarkupMark[] = []
  const entered: MarkupMark[] = []
  for (const event of events) {
    if (event.kind === 'text') continue
    if (event.kind === 'enter') {
      if (
        event.mark.kind !== index.kind ||
        event.mark.annotationRange.start !== index.annotation.start ||
        event.mark.annotationRange.end !== index.annotation.end
      ) {
        return false
      }
      entered.push(event.mark)
      stack.push(event.mark)
      continue
    }
    if (stack.pop() !== event.mark) return false
  }
  if (stack.length !== 0) return false
  if (index.kind !== 'substitution') return entered.length === 1
  const old = entered[0]
  const next = entered[1]
  return entered.length === 2 &&
    old?.kind === 'substitution' && old.arm === 'old' &&
    next?.kind === 'substitution' && next.arm === 'new' &&
    old !== next
}

type FacadeProjectedMarkdown = Profile1DocumentProducts['original']

type CoordinateSegment =
  | Readonly<{
    kind: 'source'
    projectedStart: number
    projectedEnd: number
    sourceStart: number
    sourceEnd: number
  }>
  | Readonly<{
    kind: 'generated'
    projectedStart: number
    projectedEnd: number
    sourcePosition: number
    affinity: ProjectionAffinity
  }>

interface GeneratedCoordinateCluster {
  readonly sourcePosition: number
  readonly projectedStart: number
  readonly projectedEnd: number
}

function position(
  value: number,
  length: number,
  coordinateName: string
): number {
  if (!Number.isInteger(value) || value < 0 || value > length) {
    throw new RangeError(`${coordinateName} position is outside its document`)
  }
  return value
}

function coordinateAffinity(value: ProjectionAffinity): ProjectionAffinity {
  if (value !== 'previous' && value !== 'next') {
    throw new RangeError(`Unknown coordinate affinity: ${String(value)}`)
  }
  return value
}

function projectionCoordinatesOf(
  projection: FacadeProjectedMarkdown,
  sourceLength: number
): ProjectionCoordinateMap {
  const projectedLength = projection.source.length
  const segments: readonly CoordinateSegment[] = Object.freeze(
    projection.mappedTape.map(segment => segment.kind === 'canonical'
      ? Object.freeze({
        kind: 'source' as const,
        projectedStart: segment.projectedStart,
        projectedEnd: segment.projectedEnd,
        sourceStart: segment.sourceStart,
        sourceEnd:
          segment.sourceStart + segment.projectedEnd - segment.projectedStart
      })
      : Object.freeze({
        kind: 'generated' as const,
        projectedStart: segment.projectedStart,
        projectedEnd: segment.projectedEnd,
        sourcePosition: segment.sourcePosition,
        affinity: segment.affinity
      }))
  )
  const sourceSegments = Object.freeze(segments.flatMap(segment =>
    segment.kind === 'source' ? [segment] : []
  ))
  const generatedClustersByPosition = new Map<number, GeneratedCoordinateCluster>()
  for (const segment of segments) {
    if (segment.kind !== 'generated') continue
    const previous = generatedClustersByPosition.get(segment.sourcePosition)
    generatedClustersByPosition.set(segment.sourcePosition, Object.freeze({
      sourcePosition: segment.sourcePosition,
      projectedStart: Math.min(
        previous?.projectedStart ?? segment.projectedStart,
        segment.projectedStart
      ),
      projectedEnd: Math.max(
        previous?.projectedEnd ?? segment.projectedEnd,
        segment.projectedEnd
      )
    }))
  }
  const generatedClusters = Object.freeze(
    [...generatedClustersByPosition.values()].sort((left, right) =>
      left.sourcePosition - right.sourcePosition ||
      left.projectedStart - right.projectedStart
    )
  )

  const sourceSegmentAtOrBefore = (sourcePosition: number): number => {
    let low = 0
    let high = sourceSegments.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if ((sourceSegments[middle]?.sourceStart ?? Infinity) <= sourcePosition) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return low - 1
  }
  const generatedClusterAtOrBefore = (sourcePosition: number): number => {
    let low = 0
    let high = generatedClusters.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (
        (generatedClusters[middle]?.sourcePosition ?? Infinity) <= sourcePosition
      ) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return low - 1
  }

  const originAt = Object.freeze((projectedOffset: number): ProjectionOrigin => {
    if (
      !Number.isInteger(projectedOffset) ||
      projectedOffset < 0 ||
      projectedOffset >= projectedLength
    ) {
      throw new RangeError('Projected offset is outside the projection')
    }
    let low = 0
    let high = segments.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if ((segments[middle]?.projectedEnd ?? Infinity) <= projectedOffset) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    const segment = segments[low]
    if (
      segment === undefined ||
      projectedOffset < segment.projectedStart ||
      projectedOffset >= segment.projectedEnd
    ) {
      throw new Error('Projection provenance has an uncovered code unit')
    }
    return segment.kind === 'source'
      ? Object.freeze({
        kind: 'source' as const,
        sourceOffset:
          segment.sourceStart + projectedOffset - segment.projectedStart
      })
      : Object.freeze({
        kind: 'generated' as const,
        sourcePosition: segment.sourcePosition,
        affinity: segment.affinity
      })
  })
  const toSource = Object.freeze((
    projectedPosition: number,
    affinity: ProjectionAffinity
  ): number => {
    const projected = position(
      projectedPosition,
      projectedLength,
      'Projected'
    )
    coordinateAffinity(affinity)

    let low = 0
    let high = segments.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if ((segments[middle]?.projectedEnd ?? Infinity) <= projected) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    const following = segments[low]
    if (
      following !== undefined &&
      following.projectedStart < projected &&
      projected < following.projectedEnd
    ) {
      return following.kind === 'source'
        ? following.sourceStart + projected - following.projectedStart
        : following.sourcePosition
    }

    const preceding = segments[low - 1]
    if (affinity === 'previous') {
      return preceding === undefined
        ? 0
        : preceding.kind === 'source'
          ? preceding.sourceEnd
          : preceding.sourcePosition
    }
    return following === undefined
      ? sourceLength
      : following.kind === 'source'
        ? following.sourceStart
        : following.sourcePosition
  })
  const toProjected = Object.freeze((
    sourcePosition: number,
    affinity: ProjectionAffinity
  ): number => {
    const source = position(sourcePosition, sourceLength, 'Source')
    coordinateAffinity(affinity)
    const sourceIndex = sourceSegmentAtOrBefore(source)
    const sourceCandidates = [
      sourceSegments[sourceIndex - 1],
      sourceSegments[sourceIndex],
      sourceSegments[sourceIndex + 1]
    ].filter((segment): segment is Extract<CoordinateSegment, { kind: 'source' }> =>
      segment !== undefined &&
      segment.sourceStart <= source &&
      source <= segment.sourceEnd
    )
    const generatedIndex = generatedClusterAtOrBefore(source)
    const generated = generatedClusters[generatedIndex]?.sourcePosition === source
      ? generatedClusters[generatedIndex]
      : undefined
    const direct = sourceCandidates.map(segment =>
      segment.projectedStart + source - segment.sourceStart
    )
    if (generated !== undefined) {
      direct.push(generated.projectedStart, generated.projectedEnd)
    }
    if (direct.length > 0) {
      return affinity === 'previous'
        ? Math.min(...direct)
        : Math.max(...direct)
    }

    const precedingSource = sourceSegments[sourceIndex]
    const followingSource = sourceSegments[sourceIndex + 1]
    const precedingGenerated = generatedClusters[generatedIndex]
    const followingGenerated = generatedClusters[generatedIndex + 1]
    if (affinity === 'previous') {
      if (
        precedingGenerated !== undefined &&
        (
          precedingSource === undefined ||
          precedingGenerated.sourcePosition >= precedingSource.sourceEnd
        )
      ) {
        return precedingGenerated.projectedEnd
      }
      return precedingSource?.projectedEnd ?? 0
    }
    if (
      followingGenerated !== undefined &&
      (
        followingSource === undefined ||
        followingGenerated.sourcePosition <= followingSource.sourceStart
      )
    ) {
      return followingGenerated.projectedStart
    }
    return followingSource?.projectedStart ?? projectedLength
  })
  const intersectsSource = Object.freeze((range: SourceRange): boolean => {
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.end > sourceLength
    ) {
      throw new RangeError('Source range is outside its document')
    }
    if (range.start === range.end) return false
    let low = 0
    let high = sourceSegments.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if ((sourceSegments[middle]?.sourceEnd ?? Infinity) <= range.start) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return (sourceSegments[low]?.sourceStart ?? Infinity) < range.end
  })
  return Object.freeze({
    originAt,
    toSource,
    toProjected,
    intersectsSource,
    sourceSegments: Object.freeze(sourceSegments.map(segment => Object.freeze({
      projected: Object.freeze({ start: segment.projectedStart, end: segment.projectedEnd }),
      source: Object.freeze({ start: segment.sourceStart, end: segment.sourceEnd })
    })))
  })
}

function shiftedRegionalProjectionCoordinatesOf(
  projection: FacadeProjectedMarkdown,
  localSourceLength: number,
  sourceDelta: number,
  documentSourceLength: number
): ProjectionCoordinateMap {
  const projectedLength = projection.source.length
  const local = projectionCoordinatesOf(projection, localSourceLength)
  const originAt = Object.freeze((projectedOffset: number): ProjectionOrigin => {
    const origin = local.originAt(projectedOffset)
    return origin.kind === 'source'
      ? Object.freeze({
        kind: 'source' as const,
        sourceOffset: origin.sourceOffset + sourceDelta
      })
      : Object.freeze({
        kind: 'generated' as const,
        sourcePosition: origin.sourcePosition + sourceDelta,
        affinity: origin.affinity
      })
  })
  const toSource = Object.freeze((
    projectedPosition: number,
    affinity: ProjectionAffinity
  ): number => {
    if (projectedPosition === 0 && affinity === 'previous') return 0
    if (
      projectedPosition === projectedLength &&
      affinity === 'next'
    ) {
      return documentSourceLength
    }
    return local.toSource(projectedPosition, affinity) + sourceDelta
  })
  const toProjected = Object.freeze((
    sourcePosition: number,
    affinity: ProjectionAffinity
  ): number => {
    const source = position(sourcePosition, documentSourceLength, 'Source')
    coordinateAffinity(affinity)
    if (source < sourceDelta) return 0
    if (source > sourceDelta + localSourceLength) {
      return projectedLength
    }
    return local.toProjected(source - sourceDelta, affinity)
  })
  const intersectsSource = Object.freeze((sourceRange: SourceRange): boolean => {
    if (
      !Number.isInteger(sourceRange.start) ||
      !Number.isInteger(sourceRange.end) ||
      sourceRange.start < 0 ||
      sourceRange.end < sourceRange.start ||
      sourceRange.end > documentSourceLength
    ) {
      throw new RangeError('Source range is outside its document')
    }
    if (
      sourceRange.start === sourceRange.end ||
      sourceRange.end <= sourceDelta ||
      sourceRange.start >= sourceDelta + localSourceLength
    ) {
      return false
    }
    return local.intersectsSource(Object.freeze({
      start: Math.max(0, sourceRange.start - sourceDelta),
      end: Math.min(localSourceLength, sourceRange.end - sourceDelta)
    }))
  })
  return Object.freeze({
    originAt,
    toSource,
    toProjected,
    intersectsSource,
    sourceSegments: Object.freeze((local.sourceSegments ?? []).map(segment => Object.freeze({
      projected: segment.projected,
      source: Object.freeze({ start: segment.source.start + sourceDelta, end: segment.source.end + sourceDelta })
    })))
  })
}

function commentCoordinateSegmentsOf(
  projection: FacadeProjectedMarkdown,
  sourceDelta: number
): readonly CommentCoordinateSegment[] {
  return Object.freeze(projection.mappedTape.map(segment => {
    const projected = Object.freeze({
      start: segment.projectedStart,
      end: segment.projectedEnd
    })
    if (segment.kind === 'canonical') {
      return Object.freeze({
        kind: 'source' as const,
        projected,
        source: Object.freeze({
          start: sourceDelta + segment.sourceStart,
          end: sourceDelta + segment.sourceStart +
            segment.projectedEnd - segment.projectedStart
        })
      })
    }
    return Object.freeze({
      kind: 'generated' as const,
      projected,
      sourcePosition: sourceDelta + segment.sourcePosition,
      affinity: segment.affinity
    })
  }))
}

function markupProjectionOf(
  products: Profile1DocumentProducts,
  annotationRangeByNodeId: ReadonlyMap<NodeId, SourceRange>,
  sourceLength: number,
  splitLists = products.diagnostics.count === 0
): MarkupProjection {
  const publicMarks = new WeakMap<object, MarkupMark>()
  // Text runs split where regional leaves meet, so a region replaces whole
  // runs; a window splits lists as its document does (`splitLists`).
  const safePoints = regionalLeafPoints(products, sourceLength, splitLists)
  const events: MarkupEvent[] = []
  let safePointIndex = 0
  for (let ordinal = 0; ordinal < products.markup.eventCount; ordinal += 1) {
    const event = products.markup.eventAt(ordinal)
    if (event.kind === 'text') {
      const range = event.sourceRange
      while (
        safePointIndex < safePoints.length &&
        (safePoints[safePointIndex] ?? range.start) <= range.start
      ) {
        safePointIndex += 1
      }
      const boundaries: number[] = [range.start]
      while (
        safePointIndex < safePoints.length &&
        (safePoints[safePointIndex] ?? range.end) < range.end
      ) {
        boundaries.push(safePoints[safePointIndex] as number)
        safePointIndex += 1
      }
      boundaries.push(range.end)
      for (let index = 0; index + 1 < boundaries.length; index += 1) {
        const start = boundaries[index]
        const end = boundaries[index + 1]
        if (start === undefined || end === undefined || start === end) continue
        events.push(Object.freeze({
          kind: 'text',
          text: event.text.slice(start - range.start, end - range.start),
          sourceRange: Object.freeze({ start, end })
        }))
      }
      continue
    }
    let mark = publicMarks.get(event.mark)
    if (mark === undefined) {
      const annotationRange = annotationRangeByNodeId.get(event.mark.nodeId)
      if (annotationRange === undefined) {
        throw new Error('Markup event lost its public annotation range')
      }
      mark = event.mark.kind === 'substitution'
        ? Object.freeze({
          kind: event.mark.kind,
          arm: event.mark.arm,
          annotationRange
        })
        : Object.freeze({ kind: event.mark.kind, annotationRange })
      publicMarks.set(event.mark, mark)
    }
    events.push(Object.freeze({ kind: event.kind, mark }))
  }
  const frozenEvents = Object.freeze(events)
  const editing = products.editing()
  const syntax = Object.freeze({
    ast: markdownAstOf(editing),
    coordinates: projectionCoordinatesOf(editing, sourceLength)
  })
  return Object.freeze({
    kind: 'markup',
    name: 'markup',
    events: frozenEvents,
    syntax
  })
}

function commentProjectionOf(
  products: Profile1DocumentProducts,
  comment: NodeId,
  annotationRange: SourceRange,
  sourceLength: number
): CommentProjection {
  const projected = products.commentDisplay(comment)
  return Object.freeze({
    kind: 'comment',
    annotationRange,
    markdown: projected.source,
    ast: markdownAstOf(projected),
    coordinates: projectionCoordinatesOf(projected, sourceLength)
  })
}

function diagnosticOf(diagnostic: SyntaxDiagnostic): DocumentDiagnostic {
  return Object.freeze({
    code: diagnostic.code,
    range: sourceRangeOf(diagnostic.range),
    metadata: Object.freeze({ ...diagnostic.metadata })
  })
}

function diagnosticsOf(
  products: Pick<Profile1DocumentProducts, 'diagnostics'>
): readonly DocumentDiagnostic[] {
  return Object.freeze(Array.from(
    { length: products.diagnostics.count },
    (_, ordinal) => diagnosticOf(products.diagnostics.at(ordinal))
  ))
}

function documentCoreError(
  diagnostic: ResourceDiagnostic
): DocumentCoreError {
  return new DocumentCoreError(
    diagnostic.code,
    sourceRangeOf(diagnostic.range),
    diagnostic.metadata
  )
}

function sameMarkdownOptions(
  left: MarkdownOptionsV1,
  right: MarkdownOptionsV1
): boolean {
  return left.gfm === right.gfm &&
    left.gfmAutolinks === right.gfmAutolinks &&
    left.gfmTagFilter === right.gfmTagFilter &&
    left.frontMatter === right.frontMatter &&
    left.texMathDollars === right.texMathDollars &&
    left.texMathGfm === right.texMathGfm &&
    left.texMathSingleBackslash === right.texMathSingleBackslash &&
    left.texMathDoubleBackslash === right.texMathDoubleBackslash &&
    left.footnotes === right.footnotes &&
    left.subscriptAndSuperscript === right.subscriptAndSuperscript
}

interface NormalizedProjectionRequests {
  readonly markup: boolean
  readonly comments: readonly SourceRange[]
}

function normalizeProjectionRequests(
  requests: readonly DocumentProjectionRequest[] | undefined
): NormalizedProjectionRequests | undefined {
  if (requests === undefined) return undefined
  if (!Array.isArray(requests)) {
    throw new TypeError('Document core projection requests must be an array')
  }
  let markup = false
  const comments = new Map<string, SourceRange>()
  for (const request of requests) {
    if (request === 'markup') {
      markup = true
      continue
    }
    if (
      request === null ||
      typeof request !== 'object' ||
      request.name !== 'comment' ||
      request.annotationRange === null ||
      typeof request.annotationRange !== 'object' ||
      !Number.isInteger(request.annotationRange.start) ||
      !Number.isInteger(request.annotationRange.end) ||
      request.annotationRange.start < 0 ||
      request.annotationRange.end < request.annotationRange.start
    ) {
      throw new TypeError('Document core projection request is malformed')
    }
    const stable = Object.freeze({
      start: request.annotationRange.start,
      end: request.annotationRange.end
    })
    comments.set(`${stable.start}:${stable.end}`, stable)
  }
  const orderedComments = Object.freeze([...comments.values()].sort(
    (left, right) => left.start - right.start || left.end - right.end
  ))
  return Object.freeze({ markup, comments: orderedComments })
}

interface RevisionFacts {
  readonly products: Profile1DocumentProducts
  readonly annotations: readonly CriticMarkupAnnotation[]
  readonly annotationRangeByNodeId: ReadonlyMap<NodeId, SourceRange>
  readonly nodeIdByAnnotation: ReadonlyMap<CriticMarkupAnnotation, NodeId>
}

interface RetainedAdmissionSummary {
  readonly hasCriticMarkupCandidate: boolean
  readonly rootCount: number
  readonly markerDecisionCount: number
  readonly referenceDefinitionCount: number
}

interface FullRevisionState {
  readonly kind: 'full'
  readonly source: PersistentCanonicalSource
  readonly productStore: RevisionProductStore<Profile1DocumentProducts>
  readonly annotations: (
    products?: Profile1DocumentProducts,
    retain?: boolean
  ) => readonly CriticMarkupAnnotation[]
  readonly retainedSummary: RetainedAdmissionSummary | undefined
  readonly markdownOptions: MarkdownOptionsV1
  readonly retainedIndex: PlainParagraphRetainedIndex | undefined
  readonly criticMarkupIndex: CriticMarkupRegionalIndex | undefined
  readonly commentIndex: CommentRegionalIndex | undefined
  readonly regionalInventory: RegionalInventory | undefined
  /** Parser accounting units of the whole revision, bounded from above. */
  readonly accountingUpperBound: number | undefined
}

interface RegionalRevisionState {
  readonly kind: 'regional'
  readonly source: PersistentCanonicalSource
  readonly markdownOptions: MarkdownOptionsV1
  readonly retainedIndex: PlainParagraphRetainedIndex | undefined
  readonly criticMarkupIndex: CriticMarkupRegionalIndex | undefined
  readonly commentIndex: CommentRegionalIndex | undefined
  readonly regionalInventory: RegionalInventory | undefined
  readonly regionalComments: readonly Readonly<{
    readonly annotation: CriticMarkupAnnotation
    readonly projection: CommentProjection
  }>[]
  readonly inventoryAnnotations: (() => readonly CriticMarkupAnnotation[]) |
    undefined
  readonly accountingUpperBound: number | undefined
  readonly productStore: RevisionProductStore<Profile1DocumentProducts>
  readonly annotations: (
    products?: Profile1DocumentProducts,
    retain?: boolean
  ) => readonly CriticMarkupAnnotation[]
}

type RevisionState = FullRevisionState | RegionalRevisionState

interface MutableDocumentCoreInspection {
  intrinsicSourceUnits: number
  documentParses: number
  documentParseSourceUnits: number
  regionalIntrinsicSourceUnits: number
  regionalFastApplies: number
  documentProjectionPreparationUnits: number
  documentMarkupEventUnits: number
  documentAstMaterializedNodes: number
  documentCoordinateSegments: number
  documentAnnotationMaterializedNodes: number
  annotationFactTables: number
  fullProductStoresStrongCurrent: number
  fullProductStoresStrongPeak: number
  fullProductStoreReleases: number
  keystrokesAppliedAsTyped: number
  canonicalFactIndexUnits: number
  regionalProjectionPreparationUnits: number
  regionalMarkupEventUnits: number
  regionalAstMaterializedNodes: number
  regionalCoordinateSegments: number
  regionalCommentProjectionPreparationUnits: number
  regionalCommentAstMaterializedNodes: number
  regionalCommentCoordinateSegments: number
  regionalInventoryBuildUnits: number
  regionalInventoryLookupComparisons: number
  regionalInventoryNodesVisited: number
  regionalInventoryNodesAllocated: number
  regionalInventoryNodesShared: number
  regionalInventoryChangedLeaves: number
  regionalInventoryRootsAttempted: number
  regionalInventoryRootsCommitted: number
  regionalInventoryLocalAnnotationMaterializedNodes: number
  regionalInventoryCandidateRegionParses: number
  regionalInventoryCandidateRegionParseSourceUnits: number
  regionalInventoryAnnotationMaterializedNodes: number
  retainedFactInputStructuralUnits: number
  retainedFactOutputStructuralUnits: number
  retainedInitialBuildUnits: number
  retainedIndexLookupComparisons: number
  retainedOverlayNodeVisits: number
  retainedOverlayNodesAllocated: number
  retainedOverlayNodesReused: number
  retainedChangedLeafUnits: number
  retainedCommittedUpdates: number
  retainedLocalIndexUnitsCopied: number
  retainedOverlayMaximumDepth: number
  sourceRopeNodeVisits: number
  sourceRopeNodesAllocated: number
  sourceRopePiecesAllocated: number
  sourceRopeCoalesces: number
  sourceRopeRebalances: number
  sourceRopeMaximumDepth: number
  sourceRopeMaximumHeight: number
  sourceRopeCurrentHeight: number
  sourceRopeCurrentPieces: number
  sourceRopeMaximumPieces: number
  sourceSliceCalls: number
  sourceSlicePieces: number
  sourceSliceUnits: number
  sourceMaterializations: number
  sourceMaterializationPieces: number
  sourceMaterializationOutputUnits: number
  sourceGetterHits: number
  sourceGetterMisses: number
  sourceCompactions: number
  sourceCompactionInputPieces: number
  sourceCompactionRetainedUpperBoundReductionUnits: number
  sourceGetterMaterializations: number
  sourceGetterMaterializationOutputUnits: number
  sourceFallbackMaterializations: number
  sourceFallbackMaterializationOutputUnits: number
  sourceRebaseMaterializations: number
  sourceRebaseMaterializationOutputUnits: number
  sourceProjectionMaterializations: number
  sourceProjectionMaterializationOutputUnits: number
  sourceReopenMaterializations: number
  sourceReopenMaterializationOutputUnits: number
  sourceReopenComparisonUnits: number
  sourceRopeRootsAttempted: number
  sourceRopeRootsCommitted: number
  sourceRebases: number
  sourceCurrentRetainedBufferUnitsUpperBound: number
}

export function createDocumentCore(): DocumentCore {
  return createDocumentCoreWithExecutionBudget(EXECUTION_BUDGET)
}

/** Package-private seam for structural tests outside production admission. */
export function createUnboundedDocumentCoreForInspection(): DocumentCore {
  return createDocumentCoreWithExecutionBudget(Object.freeze({
    limitsProfile: 'inspection-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }))
}

/** Annotations read alike once each is placed at its own source offset. */
function sameAnnotations(
  left: readonly CriticMarkupAnnotation[],
  leftStart: number,
  right: readonly CriticMarkupAnnotation[],
  rightStart: number
): boolean {
  const same = (a: SourceRange, b: SourceRange) => a.start + leftStart === b.start + rightStart && a.end + leftStart === b.end + rightStart
  const sameArm = (arm: CriticMarkupArm, other: CriticMarkupArm | undefined) => other !== undefined &&
    arm.name === other.name && same(arm.range, other.range) &&
    sameAnnotations(arm.annotations, leftStart, other.annotations, rightStart)
  return left.length === right.length && left.every((annotation, ordinal) => {
    const other = right[ordinal]
    return other !== undefined && annotation.kind === other.kind && same(annotation.range, other.range) &&
      annotation.arms.length === other.arms.length &&
      annotation.arms.every((arm, armOrdinal) => sameArm(arm, other.arms[armOrdinal]))
  })
}

function sameDiagnostics(
  left: readonly DocumentDiagnostic[],
  leftStart: number,
  right: readonly DocumentDiagnostic[],
  rightStart: number
): boolean {
  return left.length === right.length && left.every((diagnostic, ordinal) => {
    const other = right[ordinal]
    return other !== undefined && diagnostic.code === other.code &&
      diagnostic.range.start + leftStart === other.range.start + rightStart &&
      diagnostic.range.end + leftStart === other.range.end + rightStart &&
      JSON.stringify(diagnostic.metadata) === JSON.stringify(other.metadata)
  })
}

/**
 * A block's structure without its text, which the escaping of an unfinished
 * opener elsewhere may change.
 */
function blockStructure(root: MarkdownAstNode): string {
  const parts: string[] = []
  const visit = (node: MarkdownAstNode): void => {
    const attributes = Object.entries(node.attributes)
      .filter(([name, value]) => !(typeof value === 'number' && /(?:Start|End)$/u.test(name)) &&
        !(typeof value === 'string' && (node.kind === 'text' || /(?:[Tt]ext|[Cc]ontent)$/u.test(name))))
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    parts.push(`(${node.kind}${JSON.stringify(attributes)}`)
    for (const child of node.children) visit(child)
    parts.push(')')
  }
  visit(root)
  return parts.join('')
}

/**
 * The blocks of a window document `previous` around an edit's result, read
 * once, while `previous` is its core's current revision and holds its
 * parse: read after another revision is published, it would be parsed again.
 */
interface ContextBlocks {
  /**
   * Whether the blocks outside the run of lines between blank lines that
   * holds the range `start`..`end` of `previous` keep their places and
   * structure in `next`, which replaced that range and grew by `delta`, in
   * every view: an edit whose effect leaves its blocks, as one splitting a
   * fence, changes a block after them. 'unbounded' when a side has no such
   * block before `limit`, unless the window reaches that edge of its
   * document (`edges`). `next` is published only when compared, as a
   * revision of the same core.
   */
  readonly kept: (
    next: () => DocumentRevision,
    range: SourceRange,
    delta: number,
    edges: Readonly<{ start: boolean, end: boolean }>
  ) => 'kept' | 'changed' | 'unbounded'
  /**
   * Whether `kept` is 'unbounded' for `range` before it reads any `next`,
   * as it is for every range holding this one: a wider range leaves fewer
   * blocks outside it.
   */
  readonly unbounded: (range: SourceRange, edges: Readonly<{ start: boolean, end: boolean }>) => boolean
}

function contextBlocksOf(core: DocumentCore, previous: DocumentRevision, limit: number): ContextBlocks {
  const text = core.sourceSlice(previous, { start: 0, end: limit })
  const lineStart = (offset: number): number => {
    let at = offset
    while (at > 0 && text[at - 1] !== '\n' && text[at - 1] !== '\r') at -= 1
    return at
  }
  const markup = core.project(previous, 'markup').syntax
  const itemStarts = markup.ast.root.children.flatMap(list => list.kind === 'list'
    ? list.children.map(item => lineStart(Math.min(limit, markup.coordinates.toSource(item.range.start, 'next'))))
    : [])
  // A top-level list's items are blocks of their own, each noting whether it
  // continues the list of the block before it.
  // An empty paragraph a view reads for a line of spaces has no extent of
  // its own: beside an elided closer its offset maps past the hidden
  // marker, so it moves by more than the edit. Such a line keeps its place
  // with the blocks around it, which are compared, and is left out.
  const blankLineAt = (revision: DocumentRevision, offset: number): boolean => {
    const source = core.sourceSlice(revision, { start: 0, end: revision.sourceLength })
    let start = offset
    while (start > 0 && source[start - 1] !== '\n' && source[start - 1] !== '\r') start -= 1
    let end = offset
    while (end < source.length && source[end] !== '\n' && source[end] !== '\r') end += 1
    return /^[ \t]*$/u.test(source.slice(start, end))
  }
  const blocks = (revision: DocumentRevision, view: 'original' | 'revised' | 'markup') => {
    const projection = core.project(revision, view)
    const { ast, coordinates } = projection.kind === 'markup' ? projection.syntax : projection
    return ast.root.children.flatMap(block => block.kind === 'list'
      ? block.children.map((item, ordinal) => ({ block: item, continues: ordinal > 0 }))
      : [{ block, continues: false }]).map(({ block, continues }) => ({
      range: { start: coordinates.toSource(block.range.start, 'next'), end: coordinates.toSource(block.range.end, 'previous') },
      structure: `${blockStructure(block)}${continues ? '|continues' : ''}`
    })).filter(({ range, structure }) =>
      !(structure === '(paragraph[])' && range.start === range.end && blankLineAt(revision, range.start)))
  }
  let befores: readonly Readonly<{ view: 'original' | 'revised' | 'markup', blocks: ReturnType<typeof blocks> }>[] | undefined
  const viewsBefore = () => {
    befores ??= (['original', 'revised', 'markup'] as const).map(view => ({ view, blocks: blocks(previous, view) }))
    return befores
  }
  // A view elides deleted text, so a block's own range can stop short of an
  // edit to it; the blank lines around the edit, and the first lines of the
  // items of a list, bound the blocks it touches.
  const edited = ({ start, end }: SourceRange): Readonly<{ start: number, end: number }> => {
    const blank = /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/gu
    let editedStart = 0
    let editedEnd = limit
    for (const match of text.matchAll(blank)) {
      // A blank line the edit reaches no longer separates its neighbours.
      if (match.index + match[0].length <= start) editedStart = match.index + match[0].length
      else if (match.index >= end) {
        editedEnd = match.index
        break
      }
    }
    for (const itemStart of itemStarts) {
      if (itemStart <= start) editedStart = Math.max(editedStart, itemStart)
      else if (itemStart > end) editedEnd = Math.min(editedEnd, itemStart)
    }
    return { start: editedStart, end: editedEnd }
  }
  type Block = ReturnType<typeof blocks>[number]
  const around = (items: readonly Block[], bounds: Readonly<{ start: number, end: number }>, shift: number) => items.filter(block =>
    (block.range.end < bounds.start || block.range.start > bounds.end + shift) && block.range.start < limit + shift)
  const unboundedIn = (before: readonly Block[], bounds: Readonly<{ start: number, end: number }>,
    edges: Readonly<{ start: boolean, end: boolean }>): boolean => {
    const kept = around(before, bounds, 0)
    return (!edges.start && !kept.some(block => block.range.end < bounds.start)) ||
      (!edges.end && !kept.some(block => block.range.start > bounds.end))
  }
  const read: ContextBlocks = {
    unbounded: (range, edges) => {
      const [original] = viewsBefore()
      return original !== undefined && unboundedIn(original.blocks, edited(range), edges)
    },
    kept: (next, range, delta, edges) => {
      const bounds = edited(range)
      let published: DocumentRevision | undefined
      for (const { view, blocks: before } of viewsBefore()) {
        if (unboundedIn(before, bounds, edges)) return 'unbounded'
        const kept = around(before, bounds, 0)
        const revision = published ??= next()
        const after = around(blocks(revision, view), bounds, delta)
        if (after.length !== kept.length || kept.some((block, ordinal) => {
          const other = after[ordinal]
          const shift = block.range.start > bounds.end ? delta : 0
          return other === undefined || other.structure !== block.structure ||
            other.range.start !== block.range.start + shift || other.range.end !== block.range.end + shift
        })) return 'changed'
      }
      return 'kept'
    }
  }
  return Object.freeze(read)
}

const LITERAL_BLOCK_KINDS = new Set(['code-block', 'math-block', 'diagram'])

/**
 * The top-level fence or math block of a parse holding `start` to `end`
 * between its opening and closing lines, with no suggestion overlapping it.
 * Markers there are the block's text, and a tracked edit there changes the
 * block itself.
 */
function plainLiteralBlockHolding(
  products: Profile1DocumentProducts,
  source: string,
  start: number,
  end: number
): SourceRange | undefined {
  const editing = products.editing()
  return plainLiteralBlockIn(markdownAstOf(editing), projectionCoordinatesOf(editing, source.length), source,
    (products.retainedIntrinsic?.roots ?? []).map(root => root.range), start, end)
}

/** plainLiteralBlockHolding, read from a revision's Markup syntax and suggestions. */
function plainLiteralBlockOf(core: DocumentCore, revision: DocumentRevision, start: number, end: number): SourceRange | undefined {
  const { ast, coordinates } = core.project(revision, 'markup').syntax
  return plainLiteralBlockIn(ast, coordinates, core.sourceSlice(revision, { start: 0, end: revision.sourceLength }),
    revision.annotations.map(annotation => annotation.range), start, end)
}

function plainLiteralBlockIn(
  ast: MarkdownAst,
  coordinates: ProjectionCoordinateMap,
  source: string,
  suggestions: readonly SourceRange[],
  start: number,
  end: number
): SourceRange | undefined {
  const block = ast.root.children.find(node =>
    coordinates.toSource(node.range.start, 'next') < start && end < coordinates.toSource(node.range.end, 'previous'))
  if (block === undefined || !LITERAL_BLOCK_KINDS.has(block.kind)) return undefined
  const range = { start: coordinates.toSource(block.range.start, 'next'), end: coordinates.toSource(block.range.end, 'previous') }
  const text = source.slice(range.start, range.end)
  const openerEnd = range.start + text.search(/[\r\n]/u)
  const closerStart = range.start + Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r')) + 1
  if (openerEnd < range.start || start <= openerEnd || end >= closerStart) return undefined
  return suggestions.some(suggestion => suggestion.start < range.end && suggestion.end > range.start) ? undefined : range
}

type SourceEditPreview = (previous: DocumentRevision, edits: readonly DocumentSourceEdit[]) => DocumentRevision

// A core's candidate preview and native edit planner, for compiling on a
// window core of another; a window core compiles on its own document.
const sourceEditPreviews = new WeakMap<DocumentCore, SourceEditPreview>()
const nativeEditPlanners = new WeakMap<DocumentCore, (
  previous: DocumentRevision,
  edits: readonly DocumentSourceEdit[],
  tracked: boolean,
  typed: boolean
) => readonly DocumentSourceEdit[] | undefined>()
const windowCores = new WeakSet<DocumentCore>()
/**
 * Source units up to which a window core previews a candidate by parsing
 * its whole document: a few blocks, which one parse reads for no more than
 * the regional windows, often several, that would read the candidate.
 */
const WINDOW_WHOLE_PREVIEW_UNITS = 2048

/**
 * Typed text as a suggestion's arm holds it: a final odd backslash would
 * escape the arm's closer, so it is completed to an escaped backslash,
 * which renders the one backslash typed.
 */
function escapeCompleted(text: string): string {
  let run = 0
  while (run < text.length && text[text.length - 1 - run] === '\\') run += 1
  return run % 2 === 1 ? `${text}\\` : text
}

/**
 * The outermost suggestion whose deleted or replaced text (a Deletion's, or a
 * Substitution's old arm) holds a range, with that arm.
 */
function historyHolder(
  annotations: readonly CriticMarkupAnnotation[],
  start: number,
  end: number
): Readonly<{ annotation: CriticMarkupAnnotation, arm: CriticMarkupArm }> | undefined {
  for (let level = annotations; ;) {
    const annotation = level.find(candidate => candidate.range.start < start && end < candidate.range.end)
    const arm = annotation?.arms.find(candidate => candidate.range.start <= start && end <= candidate.range.end)
    if (annotation === undefined || arm === undefined) return undefined
    if (annotation.kind === 'deletion' || (annotation.kind === 'substitution' && arm.name === 'old')) return { annotation, arm }
    level = arm.annotations
  }
}

/**
 * The respelling of the outermost suggestion whose deleted or replaced text
 * holds every edit that types something, split where each edit types: the
 * text before and after each split point stays deleted (the last part of a
 * Substitution's old arm keeps its new arm) and the typed text is added
 * between. A split at the caret, at the start of its line, or before or
 * after the whole suggestion: a literal block's text can end an arm only at
 * a line start (Profile 2 L2c), and typing that starts a block can change
 * how the suggestion after it reads. With `arm`, the one suggestion replaces
 * the deleted text with the typing ahead of any proposed text. Undefined
 * where no such suggestion holds the edits.
 */
function historySplit(
  annotations: readonly CriticMarkupAnnotation[],
  source: string,
  edits: readonly DocumentSourceEdit[],
  at: 'caret' | 'line' | 'arm' | 'before' | 'after'
): Readonly<{ range: SourceRange, insert: string, typed: string }> | undefined {
  if (!edits.some(edit => edit.insert.length > 0)) return undefined
  const held = edits.map(edit => historyHolder(annotations, edit.start, edit.end))
  const outer = held[0]
  if (outer === undefined || held.some(entry => entry?.annotation !== outer.annotation)) return undefined
  const { annotation, arm } = outer
  const typed = edits.map(edit => escapeCompleted(edit.insert)).join('')
  const replacement = annotation.arms.find(candidate => candidate.name === 'new')
  const proposed = replacement === undefined ? '' : source.slice(replacement.range.start, replacement.range.end)
  // The typing may also lead the proposed text of the one suggestion: its
  // closer then follows that text, not the typing, which can end inside a
  // literal block's line.
  if (at === 'arm') {
    const leading = proposed.length === 0 ? typed : edits.map(edit => edit.insert).join('')
    return { range: annotation.range, insert: `{~~${source.slice(arm.range.start, arm.range.end)}~>${leading}${proposed}~~}`, typed: leading }
  }
  if (at === 'after') {
    return { range: { start: annotation.range.end, end: annotation.range.end }, insert: `{++${typed}++}`, typed }
  }
  // A split point never cuts a suggestion nested in the arm: the typing goes
  // before the one holding the caret.
  const lineStart = (offset: number): number => Math.max(source.lastIndexOf('\n', offset - 1), source.lastIndexOf('\r', offset - 1)) + 1
  const points = edits.map(edit => {
    const point = at === 'caret' ? edit.start : at === 'line' ? Math.max(arm.range.start, lineStart(edit.start)) : arm.range.start
    return arm.annotations.find(nested => nested.range.start < point && point < nested.range.end)?.range.start ?? point
  })
  if (points.some((point, index) => index > 0 && point < (points[index - 1] ?? 0))) return undefined
  let insert = ''
  let cursor = arm.range.start
  edits.forEach((edit, index) => {
    const point = points[index] ?? edit.start
    if (point > cursor) insert += `{--${source.slice(cursor, point)}--}`
    if (edit.insert.length > 0) insert += `{++${escapeCompleted(edit.insert)}++}`
    cursor = point
  })
  const rest = source.slice(cursor, arm.range.end)
  if (annotation.kind === 'deletion') {
    if (rest.length > 0) insert += `{--${rest}--}`
  } else {
    insert += rest.length === 0 ? (proposed.length === 0 ? '' : `{++${proposed}++}`) : `{~~${rest}~>${proposed}~~}`
  }
  return { range: annotation.range, insert, typed }
}

/** A line opening a block other than a paragraph, or indented as code. */
const OPENS_BLOCK_LINE = /^(?: {4}|\t| {0,3}(?:#{1,6}(?:[ \t]|$)|>|[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|`{3,}|~{3,}|<|\$\$|(?:[-*_][ \t]*){3,}(?:[\r\n]|$)|=+[ \t]*(?:[\r\n]|$)|\|))/u

const CRITIC_MARKER = new RegExp(CRITIC_MARKER_ALTERNATION, 'gu')

/** The general tracked compiler for one edit, on any core. */
function generalTrackedEdit(
  activeCore: DocumentCore,
  previous: DocumentRevision,
  edit: DocumentSourceEdit,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision
): DocumentSourceEdit | undefined {
  const compile = (): DocumentSourceEdit | undefined => createTrackedSourceEdit(activeCore, previous, edit, preview) ??
    createTrackedLiteralSourceEdit(activeCore, previous, edit, preview) ??
    // A selection starting or ending between suggestions owns the ones it encloses.
    (edit.start < edit.end ? createTrackedSourceEdit(activeCore, previous, edit, preview, false, 'structure') : undefined)
  typedKeys.set(activeCore, Object.freeze({ previous, edit }))
  let planned: DocumentSourceEdit | undefined
  try {
    planned = compile()
  } finally {
    typedKeys.delete(activeCore)
  }
  return planned !== undefined && edit.insert.length === 0
    ? mergedTrackedDeletion(activeCore, previous, edit, planned, preview) ?? planned
    : planned
}

/**
 * Whether an edit writes inside a CriticMarkup delimiter (`{++`, `~>`,
 * `--}` and the like), as typing between its characters does, at any depth.
 */
function splitsMarker(annotations: readonly CriticMarkupAnnotation[], edit: DocumentSourceEdit): boolean {
  const touches = (start: number, end: number): boolean => start < end &&
    (edit.start === edit.end ? start < edit.start && edit.start < end : edit.start < end && start < edit.end)
  return annotations.some(annotation => {
    let cursor = annotation.range.start
    for (const arm of annotation.arms) {
      if (touches(cursor, arm.range.start) || splitsMarker(arm.annotations, edit)) return true
      cursor = arm.range.end
    }
    return touches(cursor, annotation.range.end)
  })
}

/**
 * Whether an edit cuts a suggestion's CriticMarkup delimiters, at any depth:
 * writes between a delimiter's characters, or removes any of them without
 * removing the whole suggestion they delimit.
 */
function cutsMarker(annotations: readonly CriticMarkupAnnotation[], edit: DocumentSourceEdit): boolean {
  const cuts = (start: number, end: number): boolean => start < end && (edit.start === edit.end
    ? start < edit.start && edit.start < end
    : edit.start < end && start < edit.end)
  return annotations.some(annotation => {
    if (edit.start < edit.end && edit.start <= annotation.range.start && annotation.range.end <= edit.end) return false
    let cursor = annotation.range.start
    for (const arm of annotation.arms) {
      if (cuts(cursor, arm.range.start) || cutsMarker(arm.annotations, edit)) return true
      cursor = arm.range.end
    }
    return cuts(cursor, annotation.range.end)
  })
}

function createDocumentCoreWithExecutionBudget(
  executionBudget: ExecutionBudgetId
): DocumentCore {
  const stateByRevision = new WeakMap<
    DocumentRevision,
    RevisionState
  >()
  const projectionCache = new WeakMap<
    DocumentRevision,
    Map<DocumentProjectionName, DocumentProjection>
  >()
  const commentProjectionCache = new WeakMap<
    DocumentRevision,
    WeakMap<CriticMarkupAnnotation, CommentProjection>
  >()
  const commentMarkupProjectionCache = new WeakMap<
    DocumentRevision,
    WeakMap<CriticMarkupAnnotation, CommentMarkupProjection>
  >()
  let reuseCache: Profile1DocumentReuseCache =
    createProfile1DocumentReuseCache()
  // Whether a source spells no `$` at all, carried from each source to the
  // next so the check below reads no text for documents without math.
  const dollarFreeSources = new WeakMap<CanonicalSourceView, boolean>()
  // Where a source spells its first `$$`, or -1: no `$$` line before a
  // window can reach into it when none comes before the window.
  const firstDoubleDollars = new WeakMap<CanonicalSourceView, number>()
  /**
   * Whether every `$$` before `offset` is settled there: the last before it
   * closes a `$$` math literal outside every suggestion, and no literal runs
   * across the offset. A `$$` line left open before it would have taken that
   * literal's opener as its closer, and one inside a suggestion pairs only
   * within its arm, so no `$$` before the offset pairs past it.
   */
  const dollarsSettledBefore = (state: RevisionState, offset: number): boolean =>
    state.productStore.withRetained(products => {
      const retained = products.retainedIntrinsic
      if (retained === undefined) return false
      let last: { readonly start: number, readonly end: number } | undefined
      for (const literal of retained.markdownLiterals) {
        if (literal.start < offset && offset < literal.end) return false
        if (literal.kind === 'math' && literal.end <= offset && (last === undefined || literal.end > last.end)) last = literal
      }
      if (last === undefined || last.end - last.start < 4) return false
      const settled = last
      if (state.source.slice(settled.start, settled.start + 2) !== '$$' ||
          state.source.slice(settled.end - 2, settled.end) !== '$$' ||
          state.source.slice(settled.end, settled.end + 1) === '$') return false
      if (retained.roots.some(root => Number(root.range.start) <= settled.start && settled.start < Number(root.range.end))) return false
      return !state.source.slice(settled.end, offset).includes('$$')
    }) === true
  const firstDoubleDollar = (source: CanonicalSourceView): number => {
    let first = firstDoubleDollars.get(source)
    if (first === undefined) {
      first = source.slice(0, source.length).indexOf('$$')
      firstDoubleDollars.set(source, first)
    }
    return first
  }
  const editsMayRepairMath = (
    previous: CanonicalSourceView,
    next: CanonicalSourceView,
    edits: readonly DocumentSourceEdit[],
    options: MarkdownOptionsV1
  ): boolean => {
    let dollarFree = dollarFreeSources.get(previous)
    if (dollarFree === undefined) {
      dollarFree = !previous.slice(0, previous.length).includes('$')
      dollarFreeSources.set(previous, dollarFree)
    }
    dollarFreeSources.set(next, dollarFree && edits.every(edit => !edit.insert.includes('$')))
    // Without a `$` before the edit, every `$$` is in the edited text.
    return options.texMathDollars && !dollarFree && editsMayRepairDollarMath(previous, next, edits)
  }
  /**
   * Whether the edits suggest replacing one closed math block whole, as a
   * tracked key in it does: the struck block is the block itself, whose
   * dollar lines the inventory reads as pairing each other, and the proposed
   * block repeats them, so each block's dollars pair with each other alone
   * and no dollars outside them pair otherwise.
   */
  const mathBlockSubstitution = (
    previous: CanonicalSourceView,
    edits: readonly DocumentSourceEdit[],
    inventory: RegionalInventory | undefined
  ): boolean => {
    const edit = edits.length === 1 ? edits[0] : undefined
    if (edit === undefined || inventory === undefined) return false
    const leaves = regionalInventoryLiteralRange(inventory, edit.start)
    if (leaves === undefined || leaves.start !== edit.start || edit.end > leaves.end) return false
    const removed = previous.slice(edit.start, edit.end)
    const block = removed.replace(/(?:\r\n|\r|\n)[ \t\r\n]*$/u, '')
    const mathBlock = (text: string): boolean =>
      /^\$\$[^$\r\n]*(?:\r\n|\r|\n)[^$]*(?:\r\n|\r|\n)\$\$[ \t]*$/u.test(text)
    if (!mathBlock(block) || /[^ \t\r\n]/u.test(removed.slice(block.length))) return false
    const opener = `{~~${block}`
    const separator = edit.insert.indexOf('~>', opener.length)
    if (!edit.insert.startsWith(opener) || separator < 0 || !edit.insert.endsWith('~~}') ||
        /[^ \t\r\n]/u.test(edit.insert.slice(opener.length, separator))) return false
    const proposed = edit.insert.slice(separator + 2, -3).replace(/[ \t\r\n]+$/u, '')
    return mathBlock(proposed)
  }
  /**
   * Whether the edits replace one closed math block whole in a revision
   * only its inventory edits regionally: the inventory window that reads the
   * edit proves its dollars pair within the blocks it writes (see
   * `literalBlockReplacement`).
   */
  const inventoryMathReplacement = (state: RevisionState, edits: readonly DocumentSourceEdit[]): boolean => {
    const edit = edits.length === 1 ? edits[0] : undefined
    return edit !== undefined && state.kind === 'regional' && state.regionalInventory !== undefined &&
      literalBlockReplacement(state.source, edit, state.regionalInventory)?.kind === 'math'
  }
  /**
   * Whether the edits write and remove no dollar or backslash in a revision
   * only its inventory edits regionally: the inventory window that reads them
   * proves the dollar runs beside them keep their pairing.
   */
  const inventoryDollarsKept = (state: RevisionState, edits: readonly DocumentSourceEdit[]): boolean =>
    state.kind === 'regional' && state.regionalInventory !== undefined && dollarsKept(state.source, edits)
  const dollarsKept = (source: CanonicalSourceView, edits: readonly DocumentSourceEdit[]): boolean =>
    edits.every(edit => !/[$\\]/u.test(edit.insert + source.slice(edit.start, edit.end)))
  const physicalRecorder = createPhysicalTraversalRecorderV1()
  const regionalPhysicalRecorder = createPhysicalTraversalRecorderV1()
  const inspection: MutableDocumentCoreInspection = {
    intrinsicSourceUnits: 0,
    documentParses: 0,
    documentParseSourceUnits: 0,
    regionalIntrinsicSourceUnits: 0,
    regionalFastApplies: 0,
    documentProjectionPreparationUnits: 0,
    documentMarkupEventUnits: 0,
    documentAstMaterializedNodes: 0,
    documentCoordinateSegments: 0,
    documentAnnotationMaterializedNodes: 0,
    annotationFactTables: 0,
    fullProductStoresStrongCurrent: 0,
    fullProductStoresStrongPeak: 0,
    fullProductStoreReleases: 0,
    keystrokesAppliedAsTyped: 0,
    canonicalFactIndexUnits: 0,
    regionalProjectionPreparationUnits: 0,
    regionalMarkupEventUnits: 0,
    regionalAstMaterializedNodes: 0,
    regionalCoordinateSegments: 0,
    regionalCommentProjectionPreparationUnits: 0,
    regionalCommentAstMaterializedNodes: 0,
    regionalCommentCoordinateSegments: 0,
    regionalInventoryBuildUnits: 0,
    regionalInventoryLookupComparisons: 0,
    regionalInventoryNodesVisited: 0,
    regionalInventoryNodesAllocated: 0,
    regionalInventoryNodesShared: 0,
    regionalInventoryChangedLeaves: 0,
    regionalInventoryRootsAttempted: 0,
    regionalInventoryRootsCommitted: 0,
    regionalInventoryLocalAnnotationMaterializedNodes: 0,
    regionalInventoryCandidateRegionParses: 0,
    regionalInventoryCandidateRegionParseSourceUnits: 0,
    regionalInventoryAnnotationMaterializedNodes: 0,
    retainedFactInputStructuralUnits: 0,
    retainedFactOutputStructuralUnits: 0,
    retainedInitialBuildUnits: 0,
    retainedIndexLookupComparisons: 0,
    retainedOverlayNodeVisits: 0,
    retainedOverlayNodesAllocated: 0,
    retainedOverlayNodesReused: 0,
    retainedChangedLeafUnits: 0,
    retainedCommittedUpdates: 0,
    retainedLocalIndexUnitsCopied: 0,
    retainedOverlayMaximumDepth: 0,
    sourceRopeNodeVisits: 0,
    sourceRopeNodesAllocated: 0,
    sourceRopePiecesAllocated: 0,
    sourceRopeCoalesces: 0,
    sourceRopeRebalances: 0,
    sourceRopeMaximumDepth: 0,
    sourceRopeMaximumHeight: 0,
    sourceRopeCurrentHeight: 0,
    sourceRopeCurrentPieces: 0,
    sourceRopeMaximumPieces: 0,
    sourceSliceCalls: 0,
    sourceSlicePieces: 0,
    sourceSliceUnits: 0,
    sourceMaterializations: 0,
    sourceMaterializationPieces: 0,
    sourceMaterializationOutputUnits: 0,
    sourceGetterHits: 0,
    sourceGetterMisses: 0,
    sourceCompactions: 0,
    sourceCompactionInputPieces: 0,
    sourceCompactionRetainedUpperBoundReductionUnits: 0,
    sourceGetterMaterializations: 0,
    sourceGetterMaterializationOutputUnits: 0,
    sourceFallbackMaterializations: 0,
    sourceFallbackMaterializationOutputUnits: 0,
    sourceRebaseMaterializations: 0,
    sourceRebaseMaterializationOutputUnits: 0,
    sourceProjectionMaterializations: 0,
    sourceProjectionMaterializationOutputUnits: 0,
    sourceReopenMaterializations: 0,
    sourceReopenMaterializationOutputUnits: 0,
    sourceReopenComparisonUnits: 0,
    sourceRopeRootsAttempted: 0,
    sourceRopeRootsCommitted: 0,
    sourceRebases: 0,
    sourceCurrentRetainedBufferUnitsUpperBound: 0
  }
  const sourceRecorder: PersistentCanonicalSourceRecorder = Object.freeze({
    recordNodeVisit: (depth: number): void => {
      inspection.sourceRopeNodeVisits += 1
      inspection.sourceRopeMaximumDepth = Math.max(
        inspection.sourceRopeMaximumDepth,
        depth
      )
    },
    recordRootShape: (height: number, pieces: number): void => {
      inspection.sourceRopeMaximumHeight = Math.max(
        inspection.sourceRopeMaximumHeight,
        height
      )
      inspection.sourceRopeMaximumPieces = Math.max(
        inspection.sourceRopeMaximumPieces,
        pieces
      )
    },
    recordNodeAllocation: (piece: boolean): void => {
      inspection.sourceRopeNodesAllocated += 1
      if (piece) inspection.sourceRopePiecesAllocated += 1
    },
    recordCoalesce: (): void => {
      inspection.sourceRopeCoalesces += 1
    },
    recordRebalance: (): void => {
      inspection.sourceRopeRebalances += 1
    },
    recordSlice: (pieces: number, units: number): void => {
      inspection.sourceSliceCalls += 1
      inspection.sourceSlicePieces += pieces
      inspection.sourceSliceUnits += units
    },
    recordMaterialization: (
      reason: CanonicalSourceMaterializationReason,
      pieces: number,
      units: number
    ): void => {
      inspection.sourceMaterializations += 1
      inspection.sourceMaterializationPieces += pieces
      inspection.sourceMaterializationOutputUnits += units
      if (reason === 'getter') {
        inspection.sourceGetterMaterializations += 1
        inspection.sourceGetterMaterializationOutputUnits += units
      } else if (reason === 'fallback') {
        inspection.sourceFallbackMaterializations += 1
        inspection.sourceFallbackMaterializationOutputUnits += units
      } else if (reason === 'projection') {
        inspection.sourceProjectionMaterializations += 1
        inspection.sourceProjectionMaterializationOutputUnits += units
      } else if (reason === 'rebase') {
        inspection.sourceRebaseMaterializations += 1
        inspection.sourceRebaseMaterializationOutputUnits += units
      } else {
        inspection.sourceReopenMaterializations += 1
        inspection.sourceReopenMaterializationOutputUnits += units
      }
    },
    recordGetterHit: (): void => {
      inspection.sourceGetterHits += 1
    },
    recordGetterMiss: (): void => {
      inspection.sourceGetterMisses += 1
    },
    recordCompaction: (
      pieces: number,
      retainedUpperBoundReductionUnits: number,
      fragmentationRebase: boolean
    ): void => {
      inspection.sourceCompactions += 1
      inspection.sourceCompactionInputPieces += pieces
      inspection.sourceCompactionRetainedUpperBoundReductionUnits +=
        retainedUpperBoundReductionUnits
      if (fragmentationRebase) {
        inspection.sourceRebases += 1
      }
    },
    recordAttemptedRoot: (): void => {
      inspection.sourceRopeRootsAttempted += 1
    }
  })
  const retainedIndexRecorder: PlainParagraphIndexRecorder = Object.freeze({
    recordInitialBuildUnit: (): void => {
      inspection.retainedInitialBuildUnits += 1
    },
    recordLookupComparison: (): void => {
      inspection.retainedIndexLookupComparisons += 1
    },
    recordOverlayNodeVisit: (): void => {
      inspection.retainedOverlayNodeVisits += 1
    },
    recordOverlayNodeAllocation: (): void => {
      inspection.retainedOverlayNodesAllocated += 1
    },
    recordOverlayNodeReuse: (): void => {
      inspection.retainedOverlayNodesReused += 1
    },
    recordChangedLeafUnit: (): void => {
      inspection.retainedChangedLeafUnits += 1
    },
    recordLocalCopyUnit: (): void => {
      inspection.retainedLocalIndexUnitsCopied += 1
    },
    recordOverlayDepth: (depth: number): void => {
      inspection.retainedOverlayMaximumDepth = Math.max(
        inspection.retainedOverlayMaximumDepth,
        depth
      )
    }
  })
  const regionalInventoryRecorder: RegionalInventoryRecorder = Object.freeze({
    recordBuildUnit: (): void => {
      inspection.regionalInventoryBuildUnits += 1
    },
    recordLookupComparison: (): void => {
      inspection.regionalInventoryLookupComparisons += 1
    },
    recordNodeVisited: (): void => {
      inspection.regionalInventoryNodesVisited += 1
    },
    recordNodeAllocated: (): void => {
      inspection.regionalInventoryNodesAllocated += 1
    },
    recordNodeShared: (): void => {
      inspection.regionalInventoryNodesShared += 1
    },
    recordChangedLeaf: (): void => {
      inspection.regionalInventoryChangedLeaves += 1
    },
    recordRootAttempted: (): void => {
      inspection.regionalInventoryRootsAttempted += 1
    },
    recordRootCommitted: (): void => {
      inspection.regionalInventoryRootsCommitted += 1
    },
    recordCandidateRegionParse: (sourceUnits: number): void => {
      inspection.regionalInventoryCandidateRegionParses += 1
      inspection.regionalInventoryCandidateRegionParseSourceUnits += sourceUnits
    },
    recordAnnotationMaterialized: (): void => {
      inspection.regionalInventoryAnnotationMaterializedNodes += 1
      inspection.documentAnnotationMaterializedNodes += 1
    }
  })
  // Block starts of plain runs inside the suggestion inventory count as
  // inventory work, apart from the plain document's own retained overlay.
  const inventoryPlainIndexRecorder: PlainParagraphIndexRecorder = Object.freeze({
    recordInitialBuildUnit: regionalInventoryRecorder.recordBuildUnit,
    recordLookupComparison: regionalInventoryRecorder.recordLookupComparison,
    recordOverlayNodeVisit: regionalInventoryRecorder.recordNodeVisited,
    recordOverlayNodeAllocation: regionalInventoryRecorder.recordNodeAllocated,
    recordOverlayNodeReuse: regionalInventoryRecorder.recordNodeShared,
    recordChangedLeafUnit: (): void => {},
    recordLocalCopyUnit: (): void => {},
    recordOverlayDepth: (): void => {}
  })
  let currentRevision: DocumentRevision | undefined
  const productStoreRecorder = Object.freeze({
    recordStrongAcquire: (): void => {
      inspection.fullProductStoresStrongCurrent += 1
      inspection.fullProductStoresStrongPeak = Math.max(
        inspection.fullProductStoresStrongPeak,
        inspection.fullProductStoresStrongCurrent
      )
    },
    recordStrongRelease: (): void => {
      inspection.fullProductStoresStrongCurrent -= 1
      inspection.fullProductStoreReleases += 1
      if (inspection.fullProductStoresStrongCurrent < 0) {
        throw new Error('Document product-store accounting underflowed')
      }
    }
  })

  // A tracked compile reads its previous revision's Original and Revised
  // projections between whole reads of its candidates, and each candidate read
  // demotes the previous revision's parse. Projected from that parse first,
  // they cost a few milliseconds where rehydrating each later is a whole parse.
  let compilingFrom: DocumentRevision | undefined
  const setAsideFor = (revision: DocumentRevision): void => {
    if (revision === currentRevision) return
    const current = currentRevision
    if (
      current !== undefined && compilingFrom === current &&
      stateByRevision.get(current)?.productStore.withRetained(() => true) === true
    ) {
      projectRevision(current, 'original')
      projectRevision(current, 'revised')
    }
    demoteCurrentProductStore()
  }

  const demoteCurrentProductStore = <Result>(
    select?: (products: Profile1DocumentProducts) => Result
  ): Result | undefined => {
    if (currentRevision === undefined) return
    const state = stateByRevision.get(currentRevision)
    if (state === undefined) return
    return state.productStore.demoteStrong(products => select?.(products))
  }

  /**
   * A window core's reading, of its window or of a candidate there, holds
   * only while no `$$` line it leaves open takes a `$$` past the window,
   * which the document would pair it with: the draft is then the document's
   * to settle (see `displayMathReachesPast`).
   */
  const noteWindowDollarReach = (products: Profile1DocumentProducts, source: string, options: MarkdownOptionsV1): void => {
    if (windowEndsDocument(core) === false && options.texMathDollars && displayMathReachesPast(products, source)) {
      markUnresolvedDraft(core, { start: false, end: true })
    }
  }
  const parse = (
    source: string,
    resolvedOptions: MarkdownOptionsV1,
    previousPass?: PreviousIntrinsicPass
  ): Profile1DocumentProducts => {
    let products
    inspection.documentParses += 1
    inspection.documentParseSourceUnits += source.length
    inspection.documentProjectionPreparationUnits += source.length
    try {
      products = parseProfile1Document(
        source,
        executionBudget,
        undefined,
        resolvedOptions,
        false,
        undefined,
        // The general-compile reference reads every source whole.
        plansFromGeneralCompile(core) ? createProfile1DocumentReuseCache() : reuseCache,
        physicalRecorder,
        plansFromGeneralCompile(core) ? undefined : previousPass
      )
    } catch (error) {
      reuseCache = createProfile1DocumentReuseCache()
      throw error
    }
    if (products.kind !== 'complete') {
      reuseCache = createProfile1DocumentReuseCache()
      throw documentCoreError(products.fatalDiagnostic)
    }
    inspection.canonicalFactIndexUnits +=
      products.retainedIntrinsic?.tape.length ?? 0
    noteWindowDollarReach(products, source, resolvedOptions)
    return products
  }

  const isolatedProducts = (
    source: string,
    resolvedOptions: MarkdownOptionsV1,
    previousPass?: PreviousIntrinsicPass
  ): Profile1DocumentProducts => {
    inspection.documentParses += 1
    inspection.documentParseSourceUnits += source.length
    inspection.documentProjectionPreparationUnits += source.length
    const result = parseProfile1Document(
      source,
      executionBudget,
      undefined,
      resolvedOptions,
      false,
      undefined,
      createProfile1DocumentReuseCache(),
      physicalRecorder,
      previousPass
    )
    if (result.kind !== 'complete') {
      throw documentCoreError(result.fatalDiagnostic)
    }
    inspection.canonicalFactIndexUnits +=
      result.retainedIntrinsic?.tape.length ?? 0
    noteWindowDollarReach(result, source, resolvedOptions)
    return result
  }

  // A regional edit never lowers the bound: replaced text's units stay counted.
  const grownAccountingBound = (
    previousState: RevisionState,
    windowProducts: Profile1DocumentProducts
  ): number | undefined => previousState.accountingUpperBound === undefined
    ? undefined
    : previousState.accountingUpperBound + accountingUnitsOf(windowProducts)

  const publish = (
    source: PersistentCanonicalSource,
    products: Profile1DocumentProducts,
    resolvedOptions: MarkdownOptionsV1
  ): DocumentRevision => {
    let productStore: RevisionProductStore<Profile1DocumentProducts> | undefined
    try {
      const retained = products.retainedIntrinsic
      const dependencyPrefixEnd = retained?.referenceDefinitionCount === 0
        ? 0
        : referenceDependencyPrefixEnd(products)
      const retainedIndex = retained !== undefined &&
        !retained.hasCriticMarkupCandidate &&
        retained.rootCount === 0 &&
        retained.markerDecisionCount === 0 &&
        retained.diagnostics.length === 0 &&
        retained.markdownLiterals.every(literal => literal.kind === 'definition')
        ? createPlainParagraphRetainedIndex(
          retained.safePoints,
          source.length,
          dependencyPrefixEnd,
          retainedIndexRecorder
        )
        : undefined
      const criticMarkupIndex = createCriticMarkupRegionalIndex(products)
      const commentIndex = createCommentRegionalIndex(products)
      const regionalInventory = createRegionalInventory(
        products,
        source.length,
        regionalInventoryRecorder,
        executionBudget.limitsProfile === 'desktop-v1'
          ? DOCUMENT_RESOURCE_POLICY_V1.maximumLogicalNodes
          : Number.MAX_SAFE_INTEGER,
        dependencyPrefixEnd,
        inventoryPlainIndexRecorder,
        // Neither smaller index covers a document with stray or unfinished
        // markers, one whose code spans, links or math the plain paragraph
        // index does not model, or an edit before its last reference
        // definition, so such a document is inventoried however few
        // suggestions it holds.
        (retained?.diagnostics.length ?? 0) !== 0 ||
          ((retainedIndex === undefined || retainedIndex.dependencyPrefixEnd !== 0) &&
            criticMarkupIndex === undefined && commentIndex === undefined)
          ? 0
          : 2
      )
      const retainedSummary = retained === undefined
        ? undefined
        : Object.freeze({
          hasCriticMarkupCandidate: retained.hasCriticMarkupCandidate,
          rootCount: retained.rootCount,
          markerDecisionCount: retained.markerDecisionCount,
          referenceDefinitionCount: retained.referenceDefinitionCount
        })
      const createdStore = createRevisionProductStore(
        products,
        () => isolatedProducts(
          source.materialize('projection'),
          resolvedOptions
        ),
        productStoreRecorder
      )
      productStore = createdStore
      let memoizedAnnotations: readonly CriticMarkupAnnotation[] | undefined
      const annotations = Object.freeze(
        (
          availableProducts?: Profile1DocumentProducts,
          retain: boolean = false
        ): readonly CriticMarkupAnnotation[] => {
          if (memoizedAnnotations !== undefined) return memoizedAnnotations
          if (regionalInventory !== undefined) {
            memoizedAnnotations = materializeRegionalInventoryAnnotations(
              regionalInventory
            ) as readonly CriticMarkupAnnotation[]
          } else {
            const materialize = (
              candidate: Profile1DocumentProducts
            ): readonly CriticMarkupAnnotation[] => {
              const materialized = annotationsOf(candidate).annotations
              inspection.documentAnnotationMaterializedNodes +=
                countCriticMarkupAnnotationNodes(materialized)
              return materialized
            }
            memoizedAnnotations = availableProducts === undefined
              ? createdStore.withProduct(materialize, retain)
              : materialize(availableProducts)
          }
          if (memoizedAnnotations === undefined) {
            throw new Error('Document annotations were not materialized')
          }
          return memoizedAnnotations
        })
      const diagnostics = diagnosticsOf(products)
      const revision: DocumentRevision = Object.freeze({
        get source(): string {
          return source.materialize('getter')
        },
        sourceLength: source.length,
        get annotations(): readonly CriticMarkupAnnotation[] {
          if (memoizedAnnotations !== undefined) return memoizedAnnotations
          if (regionalInventory !== undefined) return annotations()
          setAsideFor(revision)
          return annotations(undefined, revision === currentRevision)
        },
        diagnostics
      })
      stateByRevision.set(revision, Object.freeze({
        kind: 'full',
        source,
        productStore,
        annotations,
        retainedSummary,
        markdownOptions: resolvedOptions,
        retainedIndex,
        criticMarkupIndex,
        commentIndex,
        regionalInventory,
        accountingUpperBound: accountingUnitsOf(products)
      }))
      currentRevision = revision
      previewedCandidates = undefined
      inspection.sourceRopeRootsCommitted += 1
      return revision
    } catch (error) {
      productStore?.releaseStrong()
      // Parsing updates provenance state before facade materialization. If
      // publication fails, discard that candidate state so the current head
      // can still be reopened safely.
      reuseCache = createProfile1DocumentReuseCache()
      throw error
    }
  }

  const publishRegional = (
    source: PersistentCanonicalSource,
    resolvedOptions: MarkdownOptionsV1,
    retainedIndex: PlainParagraphRetainedIndex | undefined,
    criticMarkupIndex: CriticMarkupRegionalIndex | undefined,
    annotations: readonly CriticMarkupAnnotation[] = Object.freeze([]),
    commentIndex: CommentRegionalIndex | undefined = undefined,
    regionalComments: RegionalRevisionState['regionalComments'] = Object.freeze([]),
    regionalInventory: RegionalInventory | undefined = undefined,
    accountingUpperBound: number | undefined = undefined
  ): DocumentRevision => {
    demoteCurrentProductStore()
    const productStore = createRevisionProductStore(
      undefined,
      () => isolatedProducts(
        source.materialize('projection'),
        resolvedOptions
      ),
      productStoreRecorder
    )
    const revisionAnnotations = Object.freeze(
      (): readonly CriticMarkupAnnotation[] => annotations
    )
    const revision = Object.freeze({
      get source(): string {
        return source.materialize('getter')
      },
      sourceLength: source.length,
      annotations,
      diagnostics: Object.freeze([])
    })
    stateByRevision.set(revision, Object.freeze({
      kind: 'regional',
      source,
      markdownOptions: resolvedOptions,
      retainedIndex,
      criticMarkupIndex,
      commentIndex,
      regionalInventory,
      regionalComments,
      inventoryAnnotations: undefined,
      accountingUpperBound,
      productStore,
      annotations: revisionAnnotations
    }))
    currentRevision = revision
    previewedCandidates = undefined
    inspection.sourceRopeRootsCommitted += 1
    inspection.retainedCommittedUpdates += 1
    return revision
  }

  /**
   * A revision of `source` read through `inventory`, registered for reads
   * but not published: the current revision and its products stay as they
   * are, so it can stand for one of several candidates of the same edit.
   */
  const inventoryRevision = (
    source: PersistentCanonicalSource,
    resolvedOptions: MarkdownOptionsV1,
    inventory: RegionalInventory,
    regionalComments: RegionalRevisionState['regionalComments'] = Object.freeze([])
  ): DocumentRevision => {
    let annotations: readonly CriticMarkupAnnotation[] | undefined
    const inventoryAnnotations = Object.freeze(
      (): readonly CriticMarkupAnnotation[] => {
        if (annotations !== undefined) return annotations
        annotations = materializeRegionalInventoryAnnotations(inventory) as
          readonly CriticMarkupAnnotation[]
        return annotations
      }
    )
    let diagnostics: readonly DocumentDiagnostic[] | undefined
    const revision = Object.freeze({
      get source(): string {
        return source.materialize('getter')
      },
      sourceLength: source.length,
      get annotations(): readonly CriticMarkupAnnotation[] {
        return inventoryAnnotations()
      },
      get diagnostics(): readonly DocumentDiagnostic[] {
        diagnostics ??= Object.freeze(materializeRegionalInventoryDiagnostics(inventory).map(diagnosticOf))
        return diagnostics
      }
    })
    const productStore = createRevisionProductStore(
      undefined,
      () => isolatedProducts(
        source.materialize('projection'),
        resolvedOptions
      ),
      productStoreRecorder
    )
    stateByRevision.set(revision, Object.freeze({
      kind: 'regional',
      source,
      markdownOptions: resolvedOptions,
      retainedIndex: undefined,
      criticMarkupIndex: undefined,
      commentIndex: undefined,
      regionalInventory: inventory,
      regionalComments,
      inventoryAnnotations,
      accountingUpperBound: undefined,
      productStore,
      annotations: inventoryAnnotations
    }))
    return revision
  }

  const publishInventoryRegional = (
    source: PersistentCanonicalSource,
    resolvedOptions: MarkdownOptionsV1,
    inventory: RegionalInventory,
    regionalComments: RegionalRevisionState['regionalComments'] = Object.freeze([])
  ): DocumentRevision => {
    demoteCurrentProductStore()
    const revision = inventoryRevision(source, resolvedOptions, inventory, regionalComments)
    currentRevision = revision
    previewedCandidates = undefined
    inspection.sourceRopeRootsCommitted += 1
    regionalInventoryRecorder.recordRootCommitted()
    return revision
  }

  // A reader per annotation, such as the Review overview's Comment
  // projections, would otherwise rebuild the whole document's facts each time.
  const materializedFacts = new WeakMap<Profile1DocumentProducts, MaterializedAnnotations>()
  const withFacts = <Result>(
    state: RevisionState,
    use: (facts: RevisionFacts) => Result,
    retain: boolean = false
  ): Result => {
    return state.productStore.withProduct(products => {
      const annotations = state.annotations(products)
      let materialized = materializedFacts.get(products)
      if (materialized?.annotations !== annotations) {
        materialized = annotationFactsForMaterialized(products, annotations)
        materializedFacts.set(products, materialized)
        inspection.annotationFactTables += 1
      }
      return use(Object.freeze({
        products,
        annotations: materialized.annotations,
        annotationRangeByNodeId: materialized.rangeByNodeId,
        nodeIdByAnnotation: materialized.nodeIdByAnnotation
      }))
    }, retain)
  }

  const annotationAtPreorder = (
    roots: readonly CriticMarkupAnnotation[],
    targetOrdinal: number
  ): CriticMarkupAnnotation | undefined => {
    const pending = [...roots].reverse()
    let ordinal = 0
    while (pending.length > 0) {
      const annotation = pending.pop()
      if (annotation === undefined) break
      if (ordinal === targetOrdinal) return annotation
      ordinal += 1
      for (let armOrdinal = annotation.arms.length - 1; armOrdinal >= 0; armOrdinal -= 1) {
        const arm = annotation.arms[armOrdinal]
        if (arm === undefined) continue
        for (
          let childOrdinal = arm.annotations.length - 1;
          childOrdinal >= 0;
          childOrdinal -= 1
        ) {
          const child = arm.annotations[childOrdinal]
          if (child !== undefined) pending.push(child)
        }
      }
    }
    return undefined
  }

  /**
   * The Markup reply for lines of a literal block that is the whole text of
   * a suggestion's arm (see `RegionalInventoryAdmission.armLines`): the text
   * event holding the block, its replaced lines' nodes from the window of
   * those lines, and the suggestions holding it.
   */
  const armLinesChange = (
    admission: RegionalInventoryAdmission,
    source: PersistentCanonicalSource
  ): DocumentProjectionChange => {
    const arm = admission.armLines
    const lines = admission.literalLines
    const block = admission.nextProducts.editing().markdown.root.childAt(0)
    if (arm === undefined || lines === undefined) throw new Error('Arm lines need their lines')
    const ast = markdownAstOf(admission.nextProducts.editing()).root.children[0]
    if (ast === undefined || block === undefined) throw new Error('Arm lines need their block')
    const shift = arm.syntax - arm.lines.start
    const syntaxBlocks = Object.freeze(ast.children
      .filter(child => child.range.start >= arm.lines.start &&
        (child.range.start < arm.lines.end || (child.range.start === arm.lines.end && child.range.end === arm.lines.end &&
          arm.lines.start === arm.lines.end)))
      .map(child => shiftMarkdownAstNode(child, shift)))
    const next = admission.next
    const text = source.slice(next.source.start, next.source.end)
    return Object.freeze({
      name: 'markup' as const,
      scope: 'regions' as const,
      replacements: Object.freeze([Object.freeze({
        previous: admission.previous,
        next: admission.next,
        events: Object.freeze([Object.freeze({
          kind: 'text' as const,
          text,
          sourceRange: Object.freeze({ start: next.source.start, end: next.source.end })
        })]),
        syntaxBlocks,
        coordinates: Object.freeze([Object.freeze({
          projected: Object.freeze({ start: next.syntax.start, end: next.syntax.end }),
          source: Object.freeze({ start: next.source.start, end: next.source.end })
        })]),
        annotations: Object.freeze([]),
        literalLines: Object.freeze({
          block: Object.freeze({
            kind: ast.kind,
            range: Object.freeze({ start: next.syntax.start, end: next.syntax.end }),
            attributes: Object.freeze(Object.fromEntries(Object.entries(ast.attributes).filter(([name, value]) =>
              name !== 'content' && !(typeof value === 'number' && /(?:Start|End)$/u.test(name))))),
            children: Object.freeze([])
          }),
          linesBefore: lines.linesBefore,
          childrenBefore: lines.childrenBefore,
          previousLines: lines.previousLines,
          previousChildren: lines.previousChildren,
          source: admission.nextWindow.slice(arm.lines.start, arm.lines.end),
          sourceStart: arm.source
        }),
        enclosing: arm.enclosing
      }) satisfies MarkupRegionReplacement])
    })
  }

  /**
   * The Markup reply for a long literal block struck and proposed again,
   * read with lines far from the key left out of both blocks (see
   * `RegionalInventoryAdmission.armCreation`): `replacement` as read there,
   * with the lines put back in each block, as text the source spells and
   * children each line makes, and the document's spans.
   */
  const armCreationReplacement = (
    replacement: MarkupRegionReplacement,
    admission: RegionalInventoryAdmission,
    source: PersistentCanonicalSource
  ): MarkupRegionReplacement | undefined => {
    const lines = admission.armCreation?.next.lines
    if (lines === undefined) return undefined
    const toSource = withLinesBack(lines)
    // Inside the blocks the projection spells the source, so each point's
    // projection offset is the coordinate run's that holds it.
    const syntaxLines: Array<(typeof lines)[number]> = []
    for (const left of lines) {
      const run = replacement.coordinates.find(segment => segment.source.start <= left.at && left.at <= segment.source.end &&
        segment.source.end - segment.source.start === segment.projected.end - segment.projected.start)
      if (run === undefined) return undefined
      syntaxLines.push(Object.freeze({ ...left, at: run.projected.start + left.at - run.source.start }))
    }
    const toSyntax = withLinesBack(syntaxLines)
    const marks = new Map<MarkupMark, MarkupMark>()
    const events = replacement.events.map((event): MarkupEvent => {
      if (event.kind === 'text') {
        const start = toSource(event.sourceRange.start)
        const end = toSource(event.sourceRange.end)
        return start === event.sourceRange.start && end === event.sourceRange.end
          ? event
          : Object.freeze({ ...event, text: source.slice(start, end), sourceRange: Object.freeze({ start, end }) })
      }
      let mark = marks.get(event.mark)
      if (mark === undefined) {
        const range = event.mark.annotationRange
        mark = Object.freeze({
          ...event.mark,
          annotationRange: Object.freeze({ start: toSource(range.start), end: toSource(range.end) })
        }) as MarkupMark
        marks.set(event.mark, mark)
      }
      return Object.freeze({ ...event, mark })
    })
    const moved = (node: MarkdownAstNode): MarkdownAstNode => {
      const attributes: Record<string, MarkdownAttribute> = { ...node.attributes }
      for (const [name, value] of Object.entries(attributes)) {
        if (typeof value === 'number' && (name.endsWith('Start') || name.endsWith('End'))) attributes[name] = toSyntax(value)
      }
      return Object.freeze({
        ...node,
        range: Object.freeze({ start: toSyntax(node.range.start), end: toSyntax(node.range.end) }),
        attributes: Object.freeze(attributes),
        children: Object.freeze(node.children.map(moved))
      })
    }
    // A node or run that no point falls inside moves as its start does.
    const shifted = (node: MarkdownAstNode): MarkdownAstNode => {
      const delta = toSyntax(node.range.start) - node.range.start
      return delta === 0 ? node : shiftMarkdownAstNode(node, delta)
    }
    const lineText = (child: MarkdownAstNode): string =>
      child.kind === 'soft-break' ? '\n' : String(child.attributes['semanticText'] ?? '')
    const syntaxBlocks: MarkdownAstNode[] = []
    for (const block of replacement.syntaxBlocks) {
      const own = syntaxLines.filter(left => block.range.start < left.at && left.at < block.range.end)
      if (own.length === 0) {
        syntaxBlocks.push(shifted(block))
        continue
      }
      // The lines' children, from the shape of a line of the block.
      const text = block.children.find(child => child.kind === 'text' && child.range.end > child.range.start &&
        child.semanticTextSegments === undefined)
      const lineBreak = block.children.find(child => child.kind === 'soft-break')
      if (text === undefined || lineBreak === undefined || block.kind === 'html-block' && own.length === 0) return undefined
      const indent = block.attributes['provider'] === 'indented-code' ? 4 : 0
      const children: MarkdownAstNode[] = []
      let content = typeof block.attributes['content'] === 'string' ? block.attributes['content'] : undefined
      let contentAdded = 0
      let child = 0
      for (const left of own) {
        while (child < block.children.length && (block.children[child]?.range.start ?? 0) < left.at) {
          const kept = block.children[child]
          if (kept !== undefined) children.push(shifted(kept))
          child += 1
        }
        let at = toSyntax(left.at) - left.length
        let added = ''
        for (const line of left.text.split('\n').slice(0, -1)) {
          const textStart = line === '' ? at : at + indent
          const semanticText = line.slice(line === '' ? 0 : indent)
          children.push(Object.freeze({
            ...text,
            range: Object.freeze({ start: textStart, end: at + line.length }),
            attributes: Object.freeze({ ...text.attributes, semanticText })
          }))
          children.push(Object.freeze({
            ...lineBreak,
            range: Object.freeze({ start: at + line.length, end: at + line.length + 1 })
          }))
          added += `${semanticText}\n`
          at += line.length + 1
        }
        if (content !== undefined) {
          let offset = contentAdded
          for (let before = 0; before < child; before += 1) {
            const kept = block.children[before]
            if (kept !== undefined) offset += lineText(kept).length
          }
          content = content.slice(0, offset) + added + content.slice(offset)
          contentAdded += added.length
        }
      }
      for (; child < block.children.length; child += 1) {
        const kept = block.children[child]
        if (kept !== undefined) children.push(shifted(kept))
      }
      const shell = moved({ ...block, children: [] })
      syntaxBlocks.push(Object.freeze({
        ...shell,
        attributes: content === undefined ? shell.attributes : Object.freeze({ ...shell.attributes, content }),
        children: Object.freeze(children)
      }))
    }
    // Each line's runs, from the runs of the kept line the lines go before.
    const coordinates: MarkupCoordinateSegment[] = []
    let point = 0
    for (const segment of replacement.coordinates) {
      while (point < lines.length && (lines[point]?.at ?? 0) <= segment.source.start) {
        const left = lines[point]
        const syntaxLeft = syntaxLines[point]
        point += 1
        if (left === undefined || syntaxLeft === undefined) return undefined
        const indent = segment.source.start - left.at
        if (indent !== 0 && indent !== 4) return undefined
        let sourceAt = toSource(left.at) - left.length
        let syntaxAt = toSyntax(syntaxLeft.at) - left.length
        for (const line of left.text.split('\n').slice(0, -1)) {
          const from = line === '' ? 0 : indent
          if (line.length > from) {
            coordinates.push(Object.freeze({
              projected: Object.freeze({ start: syntaxAt + from, end: syntaxAt + line.length }),
              source: Object.freeze({ start: sourceAt + from, end: sourceAt + line.length })
            }))
          }
          coordinates.push(Object.freeze({
            projected: Object.freeze({ start: syntaxAt + line.length, end: syntaxAt + line.length + 1 }),
            source: Object.freeze({ start: sourceAt + line.length, end: sourceAt + line.length + 1 })
          }))
          sourceAt += line.length + 1
          syntaxAt += line.length + 1
        }
      }
      const sourceDelta = toSource(segment.source.start) - segment.source.start
      const syntaxDelta = toSyntax(segment.projected.start) - segment.projected.start
      coordinates.push(sourceDelta === 0 && syntaxDelta === 0
        ? segment
        : Object.freeze({
          projected: Object.freeze({ start: segment.projected.start + syntaxDelta, end: segment.projected.end + syntaxDelta }),
          source: Object.freeze({ start: segment.source.start + sourceDelta, end: segment.source.end + sourceDelta })
        }))
    }
    if (point !== lines.length) return undefined
    return Object.freeze({
      ...replacement,
      previous: admission.previous,
      next: admission.next,
      events: Object.freeze(events),
      syntaxBlocks: Object.freeze(syntaxBlocks),
      coordinates: Object.freeze(coordinates)
    })
  }

  /**
   * A preview's replaced blocks, as the window its regional apply parsed
   * reads them: the products, the window's source and its document offset.
   */
  const appliedWindows = new WeakMap<DocumentRevision, Readonly<{
    sourceStart: number
    nextProducts: Profile1DocumentProducts
    nextWindow: string
    replaced: SourceRange
  }>>()
  const tryInventoryRegionalApply = (
    previousState: RevisionState,
    source: PersistentCanonicalSource,
    stableEdits: readonly DocumentSourceEdit[],
    resolvedOptions: MarkdownOptionsV1,
    requests: NormalizedProjectionRequests,
    inventory: RegionalInventory | undefined = previousState.regionalInventory,
    preview = false
  ): Readonly<{
    readonly kind: 'applied'
    readonly revision: DocumentRevision
    readonly projections: readonly DocumentProjectionChange[]
    /** A preview's: the source the edit replaced, in the previous revision, and where it ends after. */
    readonly replaced?: Readonly<{ start: number, end: number, nextEnd: number }>
  }> | Readonly<{
    readonly kind: 'fallback'
    readonly reason: DocumentProjectionFallbackReason
  }> | undefined => {
    if (inventory === undefined) return undefined
    const subscriptions = Object.freeze([
      ...(requests.markup ? [{ name: 'markup' as const }] : []),
      ...requests.comments.map(annotationRange => Object.freeze({
        name: 'comment' as const,
        annotationRange
      }))
    ])
    const admission = applyRegionalInventory(
      inventory,
      previousState.source,
      source,
      stableEdits,
      subscriptions,
      executionBudget,
      resolvedOptions,
      regionalPhysicalRecorder
    )
    if (admission.kind === 'resource-failure') {
      throw documentCoreError(admission.fatalDiagnostic)
    }
    if (admission.kind !== 'admitted') {
      return Object.freeze({
        kind: 'fallback',
        reason: admission.reason === 'definition-or-reference-facts'
          ? admission.reason
          : 'structural-region-ineligible'
      })
    }

    const materializedByProducts = new Map<
      Profile1DocumentProducts,
      ReturnType<typeof annotationsOf>
    >()
    const materializedFor = (
      products: Profile1DocumentProducts
    ): ReturnType<typeof annotationsOf> => {
      const cached = materializedByProducts.get(products)
      if (cached !== undefined) return cached
      const value = annotationsOf(products)
      materializedByProducts.set(products, value)
      inspection.regionalInventoryLocalAnnotationMaterializedNodes +=
        countCriticMarkupAnnotationNodes(value.annotations)
      return value
    }
    const projections: DocumentProjectionChange[] = []
    let counted: Readonly<{
      events: readonly MarkupEvent[]
      blocks: readonly MarkdownAstNode[]
      coordinates: readonly MarkupCoordinateSegment[]
    }> = { events: [], blocks: [], coordinates: [] }
    // A Substitution read with lines left out builds its reply from that read.
    const read: RegionalInventoryAdmission = admission.armCreation === undefined
      ? admission
      : Object.freeze({ ...admission, previous: admission.armCreation.previous.span, next: admission.armCreation.next.span })
    if (admission.armLines !== undefined) {
      const change = armLinesChange(admission, source)
      const replacement = change.name === 'markup' && change.scope === 'regions' ? change.replacements[0] : undefined
      if (replacement !== undefined) {
        counted = { events: replacement.events, blocks: replacement.syntaxBlocks, coordinates: replacement.coordinates }
      }
      if (requests.markup) projections.push(change)
    } else {
      const materialized = materializedFor(admission.nextProducts)
      const markup = markupProjectionOf(
        admission.nextProducts,
        materialized.rangeByNodeId,
        admission.nextWindow.length,
        !admission.strayMarkers
      )
      // Products parsed with unchanged context contribute only the replaced
      // blocks; their offsets are relative to the whole parsed window.
      const window = admission.window ?? {
        source: read.next.source.start,
        syntax: read.next.syntax.start,
        blocks: {
          source: { start: 0, end: admission.nextWindow.length },
          syntax: { start: 0, end: Number.POSITIVE_INFINITY }
        }
      }
      const { blocks } = window
      // Items of a list share its text runs, which the replaced items' bounds cut.
      const listItems = admission.listItems
      const list = listItems === undefined
        ? undefined
        : markup.syntax.ast.root.children.find(child => child.kind === 'list' &&
          child.range.start <= blocks.syntax.start && blocks.syntax.start < child.range.end)
      if (listItems !== undefined && list === undefined) {
        return Object.freeze({ kind: 'fallback', reason: 'structural-region-ineligible' })
      }
      // Lines of a literal block: its window's one block stands for the whole.
      const literalLines = admission.literalLines
      const literalBlock = literalLines === undefined ? undefined : markup.syntax.ast.root.children[0]
      if (literalLines !== undefined && literalBlock === undefined) {
        return Object.freeze({ kind: 'fallback', reason: 'structural-region-ineligible' })
      }
      const eventsWithin = (start: number, end: number): readonly MarkupEvent[] => markup.events.flatMap((event): MarkupEvent[] => {
        if (event.kind !== 'text') {
          return event.mark.annotationRange.start >= start && event.mark.annotationRange.end <= end ? [event] : []
        }
        const from = Math.max(start, event.sourceRange.start)
        const to = Math.min(end, event.sourceRange.end)
        if (from >= to) return []
        if (from === event.sourceRange.start && to === event.sourceRange.end) return [event]
        return [Object.freeze({
          ...event,
          text: event.text.slice(from - event.sourceRange.start, to - event.sourceRange.start),
          sourceRange: Object.freeze({ start: from, end: to })
        })]
      })
      const events = shiftRegionalMarkupEvents(
        admission.window === undefined
          ? markup.events
          : list !== undefined || literalBlock !== undefined
            ? eventsWithin(blocks.source.start, blocks.source.end)
            : markup.events.filter(event => event.kind === 'text'
              ? event.sourceRange.start >= blocks.source.start && event.sourceRange.end <= blocks.source.end
              : event.mark.annotationRange.start >= blocks.source.start && event.mark.annotationRange.end <= blocks.source.end),
        window.source
      )
      const syntaxBlocks = Object.freeze((literalBlock?.children ?? list?.children ?? markup.syntax.ast.root.children)
        .filter(child => admission.window === undefined ||
          (child.range.start >= blocks.syntax.start && child.range.start < blocks.syntax.end) ||
          // An empty paragraph on a whitespace-only last line sits at the
          // document's end, which is also the end of blocks reaching it.
          (child.range.start === blocks.syntax.end && child.range.end === child.range.start &&
            read.next.source.end === source.length))
        .map(child => shiftMarkdownAstNode(child, window.syntax)))
      const markupCoordinates: MarkupCoordinateSegment[] = []
      // A reply's coordinates omit generated text, which a view reads as
      // generated at the source where the next canonical run starts; text
      // generated there, as the blank line parting a Substitution's old block
      // from its new one, needs no run of its own.
      const tape = admission.nextProducts.editing().mappedTape
      const readsAsGap = (ordinal: number): boolean => {
        const segment = tape[ordinal]
        const next = tape.slice(ordinal + 1).find(candidate => candidate.kind === 'canonical')
        return segment?.kind === 'generated' && segment.affinity === 'next' && next?.kind === 'canonical' &&
          next.sourceStart === segment.sourcePosition
      }
      for (const [ordinal, segment] of tape.entries()) {
        if (segment.kind !== 'canonical') {
          if (admission.strayMarkers || readsAsGap(ordinal)) continue
          return Object.freeze({
            kind: 'fallback',
            reason: 'structural-region-ineligible'
          })
        }
        const projectedStart = Math.max(segment.projectedStart, blocks.syntax.start)
        const projectedEnd = Math.min(segment.projectedEnd, blocks.syntax.end)
        if (projectedEnd <= projectedStart && admission.window !== undefined) continue
        const sourceStart = segment.sourceStart + projectedStart - segment.projectedStart
        markupCoordinates.push(Object.freeze({
          projected: Object.freeze({
            start: window.syntax + projectedStart,
            end: window.syntax + projectedEnd
          }),
          source: Object.freeze({
            start: window.source + sourceStart,
            end: window.source + sourceStart + projectedEnd - projectedStart
          })
        }))
      }
      if (requests.markup) {
        const replacement = Object.freeze({
          previous: read.previous,
          next: Object.freeze({
            source: read.next.source,
            syntax: read.next.syntax,
            events: Object.freeze({
              start: read.previous.events.start,
              end: read.previous.events.start + events.length
            })
          }),
          events,
          syntaxBlocks,
          coordinates: Object.freeze(markupCoordinates),
          annotations: regionalAnnotations(
            materialized.annotations, window.source, blocks.source.start, blocks.source.end
          ),
          ...(admission.window === undefined || blocks.source.start === 0 || literalBlock !== undefined
            ? {}
            : {
              precedingEvents: shiftRegionalMarkupEvents(
                (list === undefined ? markup.events : eventsWithin(0, blocks.source.start))
                  .filter(event => event.kind === 'text' && event.sourceRange.end <= blocks.source.start),
                window.source
              ) as readonly Extract<MarkupEvent, { kind: 'text' }>[]
            }),
          ...(() => {
            if (admission.window === undefined || literalBlock !== undefined) return {}
            const next = (list?.children ?? markup.syntax.ast.root.children).find(child => child.range.start >= blocks.syntax.end &&
              child.range.start > blocks.syntax.start)
            if (next === undefined) return {}
            const blockStart = markup.syntax.coordinates.toSource(next.range.start, 'previous')
            return {
              following: Object.freeze({
                blockStart: window.source + blockStart,
                events: shiftRegionalMarkupEvents(
                  (list === undefined ? markup.events : eventsWithin(blocks.source.end, blockStart))
                    .filter(event => event.kind === 'text' &&
                      event.sourceRange.start >= blocks.source.end && event.sourceRange.start < blockStart),
                  window.source
                ) as readonly Extract<MarkupEvent, { kind: 'text' }>[]
              })
            }
          })(),
          ...(literalLines === undefined || literalBlock === undefined
            ? {}
            : {
              literalLines: Object.freeze({
                block: Object.freeze({
                  kind: literalBlock.kind,
                  range: Object.freeze({ start: blocks.syntax.start + window.syntax, end: blocks.syntax.end + window.syntax }),
                  attributes: Object.freeze(Object.fromEntries(Object.entries(literalBlock.attributes).filter(([name, value]) =>
                    name !== 'content' && !(typeof value === 'number' && /(?:Start|End)$/u.test(name))))),
                  children: Object.freeze([])
                }),
                linesBefore: literalLines.linesBefore,
                childrenBefore: literalLines.childrenBefore,
                previousLines: literalLines.previousLines,
                previousChildren: literalLines.previousChildren,
                source: admission.nextWindow.slice(blocks.source.start, blocks.source.end)
              })
            }),
          ...(listItems === undefined || list === undefined
            ? {}
            : {
              listItems: Object.freeze({
                list: regionalListNode(listItems.key, list, window.syntax),
                itemsBefore: listItems.itemsBefore,
                previousItems: listItems.previousItems,
                source: admission.nextWindow.slice(blocks.source.start, blocks.source.end)
              })
            })
        }) satisfies MarkupRegionReplacement
        projections.push(Object.freeze({
          name: 'markup',
          scope: 'regions',
          replacements: Object.freeze([replacement])
        }))
      }

      counted = { events, blocks: syntaxBlocks, coordinates: markupCoordinates }
      if (admission.armCreation !== undefined && requests.markup) {
        const change = projections.at(-1)
        const short = change?.name === 'markup' && change.scope === 'regions' ? change.replacements[0] : undefined
        const replacement = short === undefined ? undefined : armCreationReplacement(short, admission, source)
        if (replacement === undefined) return Object.freeze({ kind: 'fallback', reason: 'structural-region-ineligible' })
        projections[projections.length - 1] = Object.freeze({
          name: 'markup',
          scope: 'regions',
          replacements: Object.freeze([replacement])
        })
        counted = { events: replacement.events, blocks: replacement.syntaxBlocks, coordinates: replacement.coordinates }
      }
    }
    const regionalComments: Array<
      RegionalRevisionState['regionalComments'][number]
    > = []
    const commentReplacements: CommentRegionReplacement[] = []
    for (const impact of admission.commentImpacts) {
      const commentMaterialized = materializedFor(impact.nextProducts)
      const localAnnotation = annotationAtPreorder(
        commentMaterialized.annotations,
        impact.nodeOrdinal
      )
      if (localAnnotation?.kind !== 'comment') {
        return Object.freeze({
          kind: 'fallback',
          reason: 'structural-region-ineligible'
        })
      }
      const annotation = shiftCriticMarkupAnnotation(
        localAnnotation,
        impact.nextSourceStart
      )
      const nodeId = commentMaterialized.nodeIdByAnnotation.get(localAnnotation)
      if (nodeId === undefined) {
        return Object.freeze({
          kind: 'fallback',
          reason: 'structural-region-ineligible'
        })
      }
      const display = impact.nextProducts.commentDisplay(nodeId)
      const ast = markdownAstOf(display)
      const coordinates = commentCoordinateSegmentsOf(
        display,
        impact.nextSourceStart
      )
      const projection: CommentProjection = Object.freeze({
        kind: 'comment',
        annotationRange: annotation.range,
        markdown: display.source,
        ast,
        coordinates: shiftedRegionalProjectionCoordinatesOf(
          display,
          impact.nextWindow.length,
          impact.nextSourceStart,
          source.length
        )
      })
      const payload = annotation.arms.find(arm => arm.name === 'comment')
      if (payload === undefined) {
        return Object.freeze({
          kind: 'fallback',
          reason: 'structural-region-ineligible'
        })
      }
      commentReplacements.push(Object.freeze({
        previous: impact.previous,
        next: Object.freeze({
          annotation: annotation.range,
          payload: payload.range,
          projection: Object.freeze({ start: 0, end: display.source.length })
        }),
        annotation: annotationSnapshotOf(annotation),
        markdown: display.source,
        ast,
        coordinates
      }))
      regionalComments.push(Object.freeze({ annotation, projection }))
      inspection.regionalCommentAstMaterializedNodes +=
        countMarkdownAstNodes(ast.root)
      inspection.regionalCommentCoordinateSegments += coordinates.length
    }
    if (commentReplacements.length > 0) {
      projections.push(Object.freeze({
        name: 'comment',
        scope: 'regions',
        replacements: Object.freeze(commentReplacements)
      }))
    }
    // A preview reads as the revision apply() would publish, unpublished.
    if (preview) {
      const revision = inventoryRevision(source, resolvedOptions, admission.nextInventory, Object.freeze(regionalComments))
      // The window this apply parsed reads the replaced blocks as the
      // revision does, whole blocks and unchanged context alone.
      if (admission.armCreation === undefined && admission.armLines === undefined &&
          admission.listItems === undefined && admission.literalLines === undefined) {
        appliedWindows.set(revision, Object.freeze({
          sourceStart: admission.window?.source ?? admission.next.source.start,
          nextProducts: admission.nextProducts,
          nextWindow: admission.nextWindow,
          replaced: Object.freeze({ start: admission.next.source.start, end: admission.next.source.end })
        }))
      }
      return Object.freeze({
        kind: 'applied',
        revision,
        projections: Object.freeze(projections),
        replaced: Object.freeze({
          start: admission.previous.source.start,
          end: admission.previous.source.end,
          nextEnd: admission.next.source.end
        })
      })
    }
    const revision = publishInventoryRegional(
      source,
      resolvedOptions,
      admission.nextInventory,
      Object.freeze(regionalComments)
    )
    inspection.regionalFastApplies += 1
    const preparedProducts = new Set<Profile1DocumentProducts>()
    let preparedSourceUnits = 0
    const recordPrepared = (
      products: Profile1DocumentProducts,
      sourceUnits: number
    ): void => {
      if (preparedProducts.has(products)) return
      preparedProducts.add(products)
      preparedSourceUnits += sourceUnits
    }
    recordPrepared(admission.nextProducts, admission.nextWindow.length)
    for (const impact of admission.commentImpacts) {
      recordPrepared(impact.nextProducts, impact.nextWindow.length)
    }
    inspection.regionalProjectionPreparationUnits += preparedSourceUnits
    inspection.regionalMarkupEventUnits += counted.events.reduce(
      (total, event) => total + (event.kind === 'text' ? event.text.length : 1),
      0
    )
    inspection.regionalAstMaterializedNodes += counted.blocks.reduce(
      (total, block) => total + countMarkdownAstNodes(block),
      0
    )
    inspection.regionalCoordinateSegments += counted.coordinates.length
    return Object.freeze({
      kind: 'applied',
      revision,
      projections: Object.freeze(projections)
    })
  }

  const tryCriticMarkupRegionalApply = (
    previousState: RevisionState,
    source: PersistentCanonicalSource,
    stableEdits: readonly DocumentSourceEdit[],
    resolvedOptions: MarkdownOptionsV1
  ): Readonly<{
    readonly revision: DocumentRevision
    readonly projection: MarkupRegionProjectionChange
  }> | undefined => {
    const index = previousState.criticMarkupIndex
    if (index === undefined) return undefined
    const admission = admitCriticMarkupRegionalChange(
      previousState.source,
      source,
      index,
      stableEdits,
      executionBudget,
      resolvedOptions,
      regionalPhysicalRecorder
    )
    if (admission === undefined) return undefined
    if (admission.kind === 'resource-failure') {
      throw documentCoreError(admission.fatalDiagnostic)
    }
    const materialized = annotationsOf(admission.nextProducts)
    const localAnnotation = materialized.annotations[0]
    if (
      localAnnotation === undefined ||
      materialized.annotations.length !== 1 ||
      localAnnotation.kind !== admission.nextIndex.kind
    ) {
      return undefined
    }
    const markup = markupProjectionOf(
      admission.nextProducts,
      materialized.rangeByNodeId,
      admission.nextWindow.length
    )
    const events = shiftRegionalMarkupEvents(
      markup.events,
      admission.nextIndex.source.start
    )
    if (
      events.length !== index.events.end - index.events.start ||
      !balancedRegionalMarkupEvents(events, admission.nextIndex)
    ) {
      return undefined
    }
    const syntaxBlocks = Object.freeze(markup.syntax.ast.root.children.map(
      child => shiftMarkdownAstNode(child, admission.nextIndex.syntax.start)
    ))
    const editing = admission.nextProducts.editing()
    const coordinates: MarkupCoordinateSegment[] = []
    for (const segment of editing.mappedTape) {
      if (segment.kind !== 'canonical') return undefined
      const length = segment.projectedEnd - segment.projectedStart
      coordinates.push(Object.freeze({
        projected: Object.freeze({
          start: admission.nextIndex.syntax.start + segment.projectedStart,
          end: admission.nextIndex.syntax.start + segment.projectedEnd
        }),
        source: Object.freeze({
          start: admission.nextIndex.source.start + segment.sourceStart,
          end: admission.nextIndex.source.start + segment.sourceStart + length
        })
      }))
    }
    if (syntaxBlocks.length === 0 || coordinates.length === 0) return undefined
    const replacement = Object.freeze({
      previous: Object.freeze({
        source: index.source,
        syntax: index.syntax,
        events: index.events
      }),
      next: Object.freeze({
        source: admission.nextIndex.source,
        syntax: admission.nextIndex.syntax,
        events: Object.freeze({
          start: index.events.start,
          end: index.events.start + events.length
        })
      }),
      events,
      syntaxBlocks,
      coordinates: Object.freeze(coordinates),
      annotations: regionalAnnotations(materialized.annotations, admission.nextIndex.source.start)
    }) satisfies MarkupRegionReplacement
    const annotations = Object.freeze([
      shiftCriticMarkupAnnotation(
        localAnnotation,
        admission.nextIndex.source.start
      )
    ])
    const revision = publishRegional(
      source,
      resolvedOptions,
      undefined,
      admission.nextIndex,
      annotations,
      undefined,
      undefined,
      undefined,
      grownAccountingBound(previousState, admission.nextProducts)
    )
    inspection.regionalFastApplies += 1
    inspection.regionalProjectionPreparationUnits +=
      admission.previousWindow.length + admission.nextWindow.length
    inspection.regionalMarkupEventUnits += events.reduce(
      (total, event) => total + (event.kind === 'text' ? event.text.length : 1),
      0
    )
    inspection.regionalAstMaterializedNodes += syntaxBlocks.reduce(
      (total, block) => total + countMarkdownAstNodes(block),
      0
    )
    inspection.regionalCoordinateSegments += coordinates.length
    return Object.freeze({
      revision,
      projection: Object.freeze({
        name: 'markup',
        scope: 'regions',
        replacements: Object.freeze([replacement])
      })
    })
  }

  const tryCommentRegionalApply = (
    previousState: RevisionState,
    source: PersistentCanonicalSource,
    stableEdits: readonly DocumentSourceEdit[],
    resolvedOptions: MarkdownOptionsV1,
    requests: NormalizedProjectionRequests
  ): Readonly<{
    readonly revision: DocumentRevision
    readonly projections: readonly DocumentProjectionChange[]
  }> | undefined => {
    const index = previousState.commentIndex
    const requestedAnnotation = requests.comments[0]
    if (
      index === undefined ||
      requestedAnnotation === undefined ||
      requests.comments.length !== 1
    ) {
      return undefined
    }
    const admission = admitCommentRegionalChange(
      previousState.source,
      source,
      index,
      requestedAnnotation,
      stableEdits,
      executionBudget,
      resolvedOptions,
      regionalPhysicalRecorder
    )
    if (admission === undefined) return undefined
    if (admission.kind === 'resource-failure') {
      throw documentCoreError(admission.fatalDiagnostic)
    }
    const materialized = annotationsOf(admission.nextProducts)
    const localAnnotation = materialized.annotations[0]
    if (
      localAnnotation === undefined ||
      localAnnotation.kind !== 'comment' ||
      materialized.annotations.length !== 1
    ) {
      return undefined
    }
    const annotation = shiftCriticMarkupAnnotation(
      localAnnotation,
      admission.nextIndex.source.start
    )
    const ast = markdownAstOf(admission.nextDisplay)
    const commentCoordinates = commentCoordinateSegmentsOf(
      admission.nextDisplay,
      admission.nextIndex.source.start
    )
    const commentProjection: CommentProjection = Object.freeze({
      kind: 'comment',
      annotationRange: annotation.range,
      markdown: admission.nextDisplay.source,
      ast,
      coordinates: shiftedRegionalProjectionCoordinatesOf(
        admission.nextDisplay,
        admission.nextWindow.length,
        admission.nextIndex.source.start,
        source.length
      )
    })
    const commentReplacement = Object.freeze({
      previous: Object.freeze({
        annotation: index.annotation,
        payload: index.payload,
        projection: index.projection
      }),
      next: Object.freeze({
        annotation: admission.nextIndex.annotation,
        payload: admission.nextIndex.payload,
        projection: admission.nextIndex.projection
      }),
      annotation: annotationSnapshotOf(annotation),
      markdown: admission.nextDisplay.source,
      ast,
      coordinates: commentCoordinates
    }) satisfies CommentRegionReplacement
    const projections: DocumentProjectionChange[] = []
    if (requests.markup) {
      const markup = markupProjectionOf(
        admission.nextProducts,
        materialized.rangeByNodeId,
        admission.nextWindow.length
      )
      const events = shiftRegionalMarkupEvents(
        markup.events,
        admission.nextIndex.source.start
      )
      const syntaxBlocks = Object.freeze(markup.syntax.ast.root.children.map(
        child => shiftMarkdownAstNode(child, admission.nextIndex.syntax.start)
      ))
      const coordinates: MarkupCoordinateSegment[] = []
      for (const segment of admission.nextProducts.editing().mappedTape) {
        if (segment.kind !== 'canonical') return undefined
        const length = segment.projectedEnd - segment.projectedStart
        coordinates.push(Object.freeze({
          projected: Object.freeze({
            start: admission.nextIndex.syntax.start + segment.projectedStart,
            end: admission.nextIndex.syntax.start + segment.projectedEnd
          }),
          source: Object.freeze({
            start: admission.nextIndex.source.start + segment.sourceStart,
            end: admission.nextIndex.source.start + segment.sourceStart + length
          })
        }))
      }
      if (
        events.length !== index.events.end - index.events.start ||
        coordinates.length === 0
      ) {
        return undefined
      }
      const replacement = Object.freeze({
        previous: Object.freeze({
          source: index.source,
          syntax: index.syntax,
          events: index.events
        }),
        next: Object.freeze({
          source: admission.nextIndex.source,
          syntax: admission.nextIndex.syntax,
          events: Object.freeze({
            start: index.events.start,
            end: index.events.start + events.length
          })
        }),
        events,
        syntaxBlocks,
        coordinates: Object.freeze(coordinates),
        annotations: regionalAnnotations(materialized.annotations, admission.nextIndex.source.start)
      }) satisfies MarkupRegionReplacement
      projections.push(Object.freeze({
        name: 'markup',
        scope: 'regions',
        replacements: Object.freeze([replacement])
      }))
      inspection.regionalMarkupEventUnits += events.reduce(
        (total, event) => total +
          (event.kind === 'text' ? event.text.length : 1),
        0
      )
      inspection.regionalAstMaterializedNodes += syntaxBlocks.reduce(
        (total, block) => total + countMarkdownAstNodes(block),
        0
      )
      inspection.regionalCoordinateSegments += coordinates.length
    }
    projections.push(Object.freeze({
      name: 'comment',
      scope: 'regions',
      replacements: Object.freeze([commentReplacement])
    }))
    const revision = publishRegional(
      source,
      resolvedOptions,
      undefined,
      undefined,
      Object.freeze([annotation]),
      admission.nextIndex,
      Object.freeze([
        Object.freeze({ annotation, projection: commentProjection })
      ])
    )
    inspection.regionalFastApplies += 1
    inspection.regionalProjectionPreparationUnits +=
      admission.previousWindow.length + admission.nextWindow.length
    inspection.regionalAstMaterializedNodes += countMarkdownAstNodes(ast.root)
    inspection.regionalCoordinateSegments += commentCoordinates.length
    inspection.regionalCommentAstMaterializedNodes += countMarkdownAstNodes(
      ast.root
    )
    inspection.regionalCommentCoordinateSegments += commentCoordinates.length
    return Object.freeze({
      revision,
      projections: Object.freeze(projections)
    })
  }

  const tryRegionalMarkupApply = (
    previousState: RevisionState,
    source: PersistentCanonicalSource,
    stableEdits: readonly DocumentSourceEdit[],
    resolvedOptions: MarkdownOptionsV1
  ): Readonly<{
    readonly kind: 'applied'
    readonly revision: DocumentRevision
    readonly projection: MarkupRegionProjectionChange
  }> | Readonly<{
    readonly kind: 'fallback'
    readonly reason: DocumentProjectionFallbackReason
  }> | undefined => {
    if (previousState.criticMarkupIndex !== undefined) {
      const applied = tryCriticMarkupRegionalApply(
        previousState,
        source,
        stableEdits,
        resolvedOptions
      )
      if (applied !== undefined) {
        return Object.freeze({ kind: 'applied', ...applied })
      }
      return Object.freeze({
        kind: 'fallback',
        reason: 'criticmarkup-facts-present'
      })
    }
    const retained = previousState.kind === 'full'
      ? previousState.retainedSummary
      : undefined
    const retainedIndex = previousState.retainedIndex
    if (
      retained !== undefined &&
      (
        retained.hasCriticMarkupCandidate ||
        retained.rootCount !== 0 ||
        retained.markerDecisionCount !== 0
      )
    ) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'criticmarkup-facts-present'
      })
    }
    if (
      (
        retained !== undefined &&
        retained.referenceDefinitionCount !== 0 &&
        retainedIndex === undefined
      ) ||
      (
        retainedIndex !== undefined &&
        retainedIndex.dependencyPrefixEnd !== 0 &&
        stableEdits.some(edit => edit.start <= retainedIndex.dependencyPrefixEnd)
      )
    ) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'definition-or-reference-facts'
      })
    }
    if (retainedIndex === undefined) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'structural-region-ineligible'
      })
    }
    const admission = admitProfile1PlainParagraphRegion(
      previousState.source,
      source,
      retainedIndex,
      stableEdits,
      executionBudget,
      resolvedOptions,
      regionalPhysicalRecorder
    )
    if (admission?.kind === 'reference-dependency') {
      return Object.freeze({
        kind: 'fallback',
        reason: 'definition-or-reference-facts'
      })
    }
    if (admission === undefined) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'structural-region-ineligible'
      })
    }
    const previousEventStart = admission.bracket.previousEventStart
    const previousEventEnd = admission.bracket.previousEventEnd
    const regionSource = admission.nextWindow
    const regionalResult = admission.parsed
    if (
      regionalResult.kind !== 'complete' ||
      regionalResult.criticMarkup.rootCount !== 0 ||
      regionalResult.diagnostics.count !== 0
    ) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'structural-region-ineligible'
      })
    }
    if (
      (regionalResult.retainedIntrinsic?.referenceDefinitionCount ?? 0) !== 0
    ) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'definition-or-reference-facts'
      })
    }
    const materialized = annotationsOf(regionalResult)
    const markup = markupProjectionOf(
      regionalResult,
      materialized.rangeByNodeId,
      regionSource.length
    )
    if (
      markup.events.length !== 1 ||
      markup.events[0]?.kind !== 'text'
    ) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'structural-region-ineligible'
      })
    }
    const events = Object.freeze([
      shiftRegionalTextEvent(markup.events[0], admission.bracket.start)
    ])
    const syntaxBlocks = Object.freeze(markup.syntax.ast.root.children.map(
      child => shiftMarkdownAstNode(child, admission.bracket.start)
    ))
    const editing = regionalResult.editing()
    const coordinates: MarkupCoordinateSegment[] = []
    for (const segment of editing.mappedTape) {
      if (segment.kind !== 'canonical') {
        return Object.freeze({
          kind: 'fallback',
          reason: 'structural-region-ineligible'
        })
      }
      const length = segment.projectedEnd - segment.projectedStart
      coordinates.push(Object.freeze({
        projected: Object.freeze({
          start: admission.bracket.start + segment.projectedStart,
          end: admission.bracket.start + segment.projectedEnd
        }),
        source: Object.freeze({
          start: admission.bracket.start + segment.sourceStart,
          end: admission.bracket.start + segment.sourceStart + length
        })
      }))
    }
    if (syntaxBlocks.length === 0 || coordinates.length === 0) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'structural-region-ineligible'
      })
    }
    const replacement = Object.freeze({
      previous: Object.freeze({
        source: Object.freeze({
          start: admission.bracket.start,
          end: admission.bracket.endPrevious
        }),
        syntax: Object.freeze({
          start: admission.bracket.start,
          end: admission.bracket.endPrevious
        }),
        events: Object.freeze({
          start: previousEventStart,
          end: previousEventEnd
        })
      }),
      next: Object.freeze({
        source: Object.freeze({
          start: admission.bracket.start,
          end: admission.bracket.endNext
        }),
        syntax: Object.freeze({
          start: admission.bracket.start,
          end: admission.bracket.endNext
        }),
        events: Object.freeze({
          start: previousEventStart,
          end: previousEventStart + events.length
        })
      }),
      events,
      syntaxBlocks,
      coordinates: Object.freeze(coordinates),
      annotations: regionalAnnotations(materialized.annotations, admission.bracket.start)
    }) satisfies MarkupRegionReplacement
    const revision = publishRegional(
      source,
      resolvedOptions,
      admission.retainedIndex,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      admission.parsed.kind === 'complete'
        ? grownAccountingBound(previousState, admission.parsed)
        : undefined
    )
    inspection.regionalFastApplies += 1
    inspection.regionalProjectionPreparationUnits += regionSource.length
    inspection.regionalMarkupEventUnits += events.reduce(
      (total, event) => total + (event.kind === 'text' ? event.text.length : 1),
      0
    )
    inspection.regionalAstMaterializedNodes += syntaxBlocks.reduce(
      (total, block) => total + countMarkdownAstNodes(block),
      0
    )
    inspection.regionalCoordinateSegments += coordinates.length
    return Object.freeze({
      kind: 'applied',
      revision,
      projection: Object.freeze({
        name: 'markup',
        scope: 'regions',
        replacements: Object.freeze([replacement])
      })
    })
  }

  const trySourceOnlyRegionalApply = (
    previousState: RevisionState,
    source: PersistentCanonicalSource,
    stableEdits: readonly DocumentSourceEdit[],
    resolvedOptions: MarkdownOptionsV1
  ): Readonly<{
    readonly kind: 'applied'
    readonly revision: DocumentRevision
  }> | Readonly<{
    readonly kind: 'fallback'
    readonly reason: DocumentProjectionFallbackReason
  }> => {
    const retained = previousState.kind === 'full'
      ? previousState.retainedSummary
      : undefined
    const retainedIndex = previousState.retainedIndex
    if (
      previousState.criticMarkupIndex !== undefined ||
      (
        retained !== undefined &&
        (
          retained.hasCriticMarkupCandidate ||
          retained.rootCount !== 0 ||
          retained.markerDecisionCount !== 0
        )
      )
    ) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'criticmarkup-facts-present'
      })
    }
    if (
      (
        retained !== undefined &&
        retained.referenceDefinitionCount !== 0 &&
        retainedIndex === undefined
      ) ||
      (
        retainedIndex !== undefined &&
        retainedIndex.dependencyPrefixEnd !== 0 &&
        stableEdits.some(edit => edit.start <= retainedIndex.dependencyPrefixEnd)
      )
    ) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'definition-or-reference-facts'
      })
    }
    if (retainedIndex === undefined) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'structural-region-ineligible'
      })
    }
    const admission = admitProfile1PlainParagraphRegion(
      previousState.source,
      source,
      retainedIndex,
      stableEdits,
      executionBudget,
      resolvedOptions,
      regionalPhysicalRecorder
    )
    if (admission?.kind === 'reference-dependency') {
      return Object.freeze({
        kind: 'fallback',
        reason: 'definition-or-reference-facts'
      })
    }
    if (admission === undefined) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'structural-region-ineligible'
      })
    }
    const revision = publishRegional(
      source,
      resolvedOptions,
      admission.retainedIndex,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      admission.parsed.kind === 'complete'
        ? grownAccountingBound(previousState, admission.parsed)
        : undefined
    )
    inspection.regionalFastApplies += 1
    return Object.freeze({ kind: 'applied', revision })
  }

  const fallbackProjectionChanges = (
    requests: NormalizedProjectionRequests,
    reason: DocumentProjectionFallbackReason
  ): readonly DocumentProjectionChange[] => {
    const projections: DocumentProjectionChange[] = []
    if (requests.markup) {
      projections.push(Object.freeze({
        name: 'markup',
        scope: 'document',
        reason
      }))
    }
    if (requests.comments.length > 0) {
      projections.push(Object.freeze({
        name: 'comment',
        scope: 'document',
        targets: requests.comments,
        reason
      }))
    }
    return Object.freeze(projections)
  }

  // Source units before a region its replacement reads the lines of.
  const PRECEDING_LINES_SPAN = 512
  /**
   * `projections` with the context each Markup region lacks: the text before
   * it, read from the unchanged source back to a line start after the last
   * annotation there, and where the next block starts, so the region's view
   * reads the lines around its blocks as the whole view does.
   */
  const withRegionContext = (
    previousState: RevisionState,
    projections: readonly DocumentProjectionChange[]
  ): readonly DocumentProjectionChange[] => Object.freeze(projections.map(change => {
    if (change.name !== 'markup' || change.scope !== 'regions') return change
    // The annotations around the region, read without a document parse or
    // materializing one: a plain document's index holds none, and a
    // revision without an inventory cannot say.
    const inventory = previousState.regionalInventory ?? convertedRegionalInventory(previousState)
    const rootsIn = (range: SourceRange): readonly SourceRange[] | undefined =>
      inventory !== undefined
        ? regionalInventoryRootRanges(inventory, range.start, range.end)
        : previousState.retainedIndex !== undefined ? [] : undefined
    return Object.freeze({
      ...change,
      replacements: Object.freeze(change.replacements.map(replacement => {
        const end = replacement.previous.source.start
        // Lines of a literal block are read with their block, which stays.
        if (replacement.literalLines !== undefined || replacement.precedingEvents !== undefined || end === 0) return replacement
        let from = Math.max(0, end - PRECEDING_LINES_SPAN)
        // Only the text after the last annotation before the region reads
        // as its source.
        const before = rootsIn({ start: from, end })
        if (before === undefined) return replacement
        for (const root of before) {
          if (root.start >= end || root.end <= from) continue
          if (root.end > end) return replacement
          from = Math.max(from, root.end)
        }
        const text = previousState.source.slice(from, end)
        const breakAt = from === 0 ? -1 : text.search(/[\r\n]/u)
        if (from !== 0 && breakAt === -1) return replacement
        const lineStart = from === 0 ? 0 : breakAt + (text.startsWith('\r\n', breakAt) ? 2 : 1)
        const start = from + lineStart
        if (start >= end) return replacement
        return Object.freeze({
          ...replacement,
          precedingEvents: Object.freeze([Object.freeze({
            kind: 'text' as const,
            text: text.slice(lineStart),
            sourceRange: Object.freeze({ start, end })
          })])
        })
      }).map(replacement => {
        // The first block after the region, read from the blocks there.
        const end = replacement.previous.source.end
        if (replacement.literalLines !== undefined || replacement.following !== undefined ||
            end >= previousState.source.length) return replacement
        if (inventory === undefined) return replacement
        // A block on a line of its own at the first line after blank lines
        // starts there; an indented one is read from the blocks there.
        let text = ''
        let line = 0
        for (let span = 64; ; span *= 8) {
          text = previousState.source.slice(end, Math.min(previousState.source.length, end + span))
          line = /^(?:[ \t]*(?:\r\n|\r|\n))*/u.exec(text)?.[0].length ?? 0
          if (line < text.length || end + span >= previousState.source.length || span >= PRECEDING_LINES_SPAN) break
        }
        if (line === text.length) return replacement
        let blockStart: number | undefined
        if (!/[ \t]/u.test(text.charAt(line))) blockStart = end + line
        else {
          const window = regionalRangeWindow(inventory, previousState.source, { start: end, end }, executionBudget,
            previousState.markdownOptions, regionalPhysicalRecorder, false)
          if (window?.validated !== true) return replacement
          const editing = window.nextProducts.editing()
          const coordinates = projectionCoordinatesOf(editing, window.nextWindow.length)
          for (const child of markdownAstOf(editing).root.children) {
            const start = window.sourceStart + coordinates.toSource(child.range.start, 'previous')
            if (start >= end) {
              blockStart = start
              break
            }
          }
        }
        if (blockStart === undefined || blockStart - end > PRECEDING_LINES_SPAN) return replacement
        const after = rootsIn({ start: end, end: blockStart })
        if (after === undefined || after.some(root => root.end > end && root.start < blockStart)) return replacement
        const shift = replacement.next.source.end - end
        return Object.freeze({
          ...replacement,
          following: Object.freeze({
            blockStart: blockStart + shift,
            events: Object.freeze(blockStart === end
              ? []
              : [Object.freeze({
                kind: 'text' as const,
                text: previousState.source.slice(end, blockStart),
                sourceRange: Object.freeze({ start: end + shift, end: blockStart + shift })
              })])
          })
        })
      }))
    })
  }))

  // Source units between the first and last of several edits one regional
  // replacement may cover.
  const COMBINED_EDIT_SPAN = 4096
  /**
   * Edits spread over one list, as the ordinals of a list renumbered after an
   * edit, written as one replacement of the text they span: the source and
   * its regions then take one edit instead of many. Callers still see the
   * edits as given.
   */
  const editsWithinOneList = (state: RevisionState, edits: readonly DocumentSourceEdit[]): readonly DocumentSourceEdit[] => {
    const first = edits[0]
    const last = edits.at(-1)
    if (edits.length < 2 || first === undefined || last === undefined || last.end - first.start <= COMBINED_EDIT_SPAN) return edits
    // Only a revision already read by regions has an inventory to consult;
    // converting one here would cost what the combined edit saves.
    const inventory = state.regionalInventory
    const list = inventory === undefined ? undefined : regionalInventoryListRange(inventory, first.start)
    if (list === undefined || first.start < list.start || last.end > list.end) return edits
    let insert = ''
    let cursor = first.start
    for (const edit of edits) {
      insert += state.source.slice(cursor, edit.start) + edit.insert
      cursor = edit.end
    }
    return Object.freeze([Object.freeze({ start: first.start, end: last.end, insert })])
  }
  const tryRegionalApply = (
    previousState: RevisionState,
    source: PersistentCanonicalSource,
    stableEdits: readonly DocumentSourceEdit[],
    options: DocumentApplyOptions | undefined,
    requests: NormalizedProjectionRequests | undefined
  ): Readonly<{
    readonly kind: 'applied'
    readonly revision: DocumentRevision
    readonly projections: readonly DocumentProjectionChange[]
  }> | Readonly<{
    readonly kind: 'fallback'
    readonly reason: DocumentProjectionFallbackReason
    readonly projections: readonly DocumentProjectionChange[]
  }> | undefined => {
    if (requests === undefined || plansFromGeneralCompile(core)) return undefined
    const resolvedOptions = options?.markdown === undefined
      ? previousState.markdownOptions
      : markdownOptions(options.markdown, previousState.markdownOptions)
    let fallbackReason: DocumentProjectionFallbackReason | undefined
    if (!sameMarkdownOptions(previousState.markdownOptions, resolvedOptions)) {
      fallbackReason = 'markdown-options-changed'
    } else if (source.requiresFragmentationRebase) {
      fallbackReason = 'source-fragmentation-rebase'
    } else if (editsMayRepairMath(previousState.source, source, stableEdits, resolvedOptions) &&
      !mathBlockSubstitution(previousState.source, stableEdits, previousState.regionalInventory) &&
      !inventoryMathReplacement(previousState, stableEdits) && !inventoryDollarsKept(previousState, stableEdits)) {
      fallbackReason = 'structural-region-ineligible'
    }
    if (fallbackReason !== undefined) {
      return Object.freeze({
        kind: 'fallback',
        reason: fallbackReason,
        projections: fallbackProjectionChanges(requests, fallbackReason)
      })
    }
    // Nearby edits, such as the two Enter writes in a setext heading's text,
    // are one replacement of the text they span, which a region can hold.
    const firstEdit = stableEdits[0]
    const lastEdit = stableEdits.at(-1)
    if (stableEdits.length > 1 && firstEdit !== undefined && lastEdit !== undefined &&
        lastEdit.end - firstEdit.start <= COMBINED_EDIT_SPAN) {
      let insert = ''
      let cursor = firstEdit.start
      for (const edit of stableEdits) {
        insert += previousState.source.slice(cursor, edit.start) + edit.insert
        cursor = edit.end
      }
      return tryRegionalApply(previousState, source,
        Object.freeze([Object.freeze({ start: firstEdit.start, end: lastEdit.end, insert })]), options, requests)
    }
    // A key that only moves the caret, such as Delete over struck text,
    // applies no edit: the next revision reads exactly as this one.
    if (stableEdits.length === 0) {
      const unchanged = republishUnchanged(previousState, source)
      if (unchanged !== undefined) {
        inspection.regionalFastApplies += 1
        return Object.freeze({
          kind: 'applied',
          revision: unchanged,
          projections: requests.markup
            ? Object.freeze([Object.freeze({ name: 'markup' as const, scope: 'regions' as const, replacements: Object.freeze([]) })])
            : Object.freeze([])
        })
      }
    }
    const inventoryApplied = (
      previousState.regionalInventory !== undefined &&
      (previousState.kind === 'regional' || regionalInventorySplitsLists(previousState.regionalInventory))
    ) || (
      requests.comments.length > 0
    ) || (
      requests.markup && previousState.retainedIndex === undefined &&
      previousState.criticMarkupIndex === undefined
    )
      ? tryInventoryRegionalApply(
        previousState,
        source,
        stableEdits,
        resolvedOptions,
        requests
      )
      : undefined
    if (inventoryApplied?.kind === 'applied') {
      return Object.freeze({
        kind: 'applied',
        revision: inventoryApplied.revision,
        projections: inventoryApplied.projections
      })
    }
    if (inventoryApplied?.kind === 'fallback') {
      const reason = inventoryApplied.reason
      return Object.freeze({
        kind: 'fallback',
        reason,
        projections: fallbackProjectionChanges(requests, reason)
      })
    }
    if (requests.comments.length > 0) {
      const applied = tryCommentRegionalApply(
        previousState,
        source,
        stableEdits,
        resolvedOptions,
        requests
      )
      if (applied !== undefined) {
        return Object.freeze({ kind: 'applied', ...applied })
      }
      const reason = 'structural-region-ineligible'
      return Object.freeze({
        kind: 'fallback',
        reason,
        projections: fallbackProjectionChanges(requests, reason)
      })
    }
    // A structural edit the plain or single-suggestion index cannot express
    // still reparses only its own blocks, through an inventory of the
    // unchanged document.
    const converted = (): ReturnType<typeof tryInventoryRegionalApply> => {
      const inventory = convertedRegionalInventory(previousState)
      return inventory === undefined
        ? undefined
        : tryInventoryRegionalApply(previousState, source, stableEdits, resolvedOptions, requests, inventory)
    }
    if (!requests.markup) {
      const sourceOnly = trySourceOnlyRegionalApply(
        previousState,
        source,
        stableEdits,
        resolvedOptions
      )
      if (sourceOnly.kind === 'applied') {
        return Object.freeze({
          kind: 'applied',
          revision: sourceOnly.revision,
          projections: Object.freeze([])
        })
      }
      const structural = converted()
      if (structural?.kind === 'applied') return Object.freeze({ ...structural })
      return Object.freeze({
        kind: 'fallback',
        reason: sourceOnly.reason,
        projections: Object.freeze([])
      })
    }
    const markup = tryRegionalMarkupApply(
      previousState,
      source,
      stableEdits,
      resolvedOptions
    )
    if (markup?.kind === 'applied') {
      return Object.freeze({
        kind: 'applied',
        revision: markup.revision,
        projections: Object.freeze([markup.projection])
      })
    }
    const structural = converted()
    if (structural?.kind === 'applied') return Object.freeze({ ...structural })
    if (markup?.kind === 'fallback') {
      return Object.freeze({
        kind: 'fallback',
        reason: markup.reason,
        projections: fallbackProjectionChanges(requests, markup.reason)
      })
    }
    return undefined
  }

  /** A revision of the same source reusing the regional facts `state` holds. */
  const republishUnchanged = (
    state: RevisionState,
    source: PersistentCanonicalSource
  ): DocumentRevision | undefined => {
    if (state.regionalInventory !== undefined) {
      return publishInventoryRegional(source, state.markdownOptions, state.regionalInventory,
        state.kind === 'regional' ? state.regionalComments : Object.freeze([]))
    }
    if (state.kind !== 'regional' || (state.retainedIndex === undefined && state.criticMarkupIndex === undefined)) {
      return undefined
    }
    return publishRegional(source, state.markdownOptions, state.retainedIndex, state.criticMarkupIndex,
      state.annotations(), state.commentIndex, state.regionalComments, undefined, state.accountingUpperBound)
  }

  const convertedRegionalInventory = (state: RevisionState): RegionalInventory | undefined => {
    if (state.regionalInventory !== undefined || state.accountingUpperBound === undefined) return undefined
    const logicalNodeLimit = executionBudget.limitsProfile === 'desktop-v1'
      ? DOCUMENT_RESOURCE_POLICY_V1.maximumLogicalNodes
      : Number.MAX_SAFE_INTEGER
    if (state.retainedIndex !== undefined) {
      return createPlainRegionalInventory(state.retainedIndex, state.accountingUpperBound,
        regionalInventoryRecorder, retainedIndexRecorder, logicalNodeLimit)
    }
    // A single suggestion's index covers only its own region; the parse
    // this revision still holds inventories the rest.
    if (state.kind !== 'full' || state.criticMarkupIndex === undefined) return undefined
    return state.productStore.withRetained(products => createRegionalInventory(
      products, state.source.length, regionalInventoryRecorder, logicalNodeLimit,
      referenceDependencyPrefixEnd(products), inventoryPlainIndexRecorder, 1))
  }

  function projectRevision(
    revision: DocumentRevision,
    projection: MarkdownProjectionName
  ): MarkdownProjection
  function projectRevision(
    revision: DocumentRevision,
    projection: 'markup'
  ): MarkupProjection
  function projectRevision(
    revision: DocumentRevision,
    projection: DocumentProjectionName
  ): DocumentProjection {
    const state = stateByRevision.get(revision)
    if (state === undefined) {
      throw new Error('Document revision belongs to another core')
    }
    if (
      projection !== 'original' &&
      projection !== 'revised' &&
      projection !== 'markup'
    ) {
      throw new RangeError(`Unknown document projection: ${String(projection)}`)
    }
    let cachedByName = projectionCache.get(revision)
    if (cachedByName === undefined) {
      cachedByName = new Map()
      projectionCache.set(revision, cachedByName)
    }
    const cached = cachedByName.get(projection)
    if (cached !== undefined) {
      if (projection === 'markup') {
        if (cached.kind !== 'markup') {
          throw new Error('Markup projection cache contains Markdown')
        }
        return cached
      }
      if (cached.kind !== 'markdown') {
        throw new Error('Markdown projection cache contains Markup')
      }
      return cached
    }
    setAsideFor(revision)

    const result = withFacts(state, (facts): DocumentProjection => {
      if (projection === 'markup') {
        const markup = markupProjectionOf(
          facts.products,
          facts.annotationRangeByNodeId,
          state.source.length
        )
        inspection.documentMarkupEventUnits += markup.events.length
        inspection.documentAstMaterializedNodes += countMarkdownAstNodes(
          markup.syntax.ast.root
        )
        inspection.documentCoordinateSegments +=
          facts.products.editing().mappedTape.length
        return markup
      }
      const projected = projection === 'original'
        ? facts.products.original
        : facts.products.revised
      const markdown: MarkdownProjection = Object.freeze({
        kind: 'markdown',
        name: projection,
        markdown: projected.source,
        ast: markdownAstOf(projected),
        coordinates: projectionCoordinatesOf(projected, state.source.length)
      })
      inspection.documentAstMaterializedNodes += countMarkdownAstNodes(
        markdown.ast.root
      )
      inspection.documentCoordinateSegments += projected.mappedTape.length
      return markdown
    }, revision === currentRevision)
    cachedByName.set(projection, result)
    return result
  }

  const projectComment = (
    revision: DocumentRevision,
    comment: CriticMarkupAnnotation
  ): CommentProjection => {
    const state = stateByRevision.get(revision)
    if (state === undefined) {
      throw new Error('Document revision belongs to another core')
    }
    if (comment.kind !== 'comment') {
      throw new RangeError('CriticMarkup annotation is not a Comment')
    }
    if (state.kind === 'regional' && state.regionalComments.length > 0) {
      const ownedInventoryComment =
        state.regionalInventory !== undefined &&
        state.inventoryAnnotations !== undefined &&
        (() => {
          const pending = [...state.inventoryAnnotations()].reverse()
          while (pending.length > 0) {
            const candidate = pending.pop()
            if (candidate === undefined) break
            if (candidate === comment) return true
            for (const arm of candidate.arms) {
              for (const child of arm.annotations) pending.push(child)
            }
          }
          return false
        })()
      for (const regionalComment of state.regionalComments) {
        if (
          regionalComment.annotation === comment ||
          (
            ownedInventoryComment &&
            regionalComment.annotation.range.start === comment.range.start &&
            regionalComment.annotation.range.end === comment.range.end
          )
        ) {
          return regionalComment.projection
        }
      }
    }
    let cachedByComment = commentProjectionCache.get(revision)
    if (cachedByComment === undefined) {
      cachedByComment = new WeakMap()
      commentProjectionCache.set(revision, cachedByComment)
    }
    const cached = cachedByComment.get(comment)
    if (cached !== undefined) return cached
    setAsideFor(revision)

    const result = withFacts(state, facts => {
      const nodeId = facts.nodeIdByAnnotation.get(comment)
      if (nodeId === undefined) {
        throw new Error('Comment does not belong to this revision')
      }
      return commentProjectionOf(
        facts.products,
        nodeId,
        comment.range,
        state.source.length
      )
    }, revision === currentRevision)
    cachedByComment.set(comment, result)
    return result
  }

  const projectCommentMarkup = (
    revision: DocumentRevision,
    comment: CriticMarkupAnnotation
  ): CommentMarkupProjection => {
    const state = stateByRevision.get(revision)
    if (state === undefined) {
      throw new Error('Document revision belongs to another core')
    }
    if (comment.kind !== 'comment') {
      throw new RangeError('CriticMarkup annotation is not a Comment')
    }
    let cachedByComment = commentMarkupProjectionCache.get(revision)
    if (cachedByComment === undefined) {
      cachedByComment = new WeakMap()
      commentMarkupProjectionCache.set(revision, cachedByComment)
    }
    const cached = cachedByComment.get(comment)
    if (cached !== undefined) return cached
    const regional = regionalCommentMarkup(state, comment)
    if (regional !== undefined) {
      cachedByComment.set(comment, regional)
      return regional
    }
    setAsideFor(revision)

    const result = withFacts(state, (facts): CommentMarkupProjection => {
      const nodeId = facts.nodeIdByAnnotation.get(comment) ?? sameComment(facts, comment)
      if (nodeId === undefined) {
        throw new Error('Comment does not belong to this revision')
      }
      const editing = facts.products.commentEditing(nodeId)
      return Object.freeze({
        kind: 'comment-markup',
        annotationRange: comment.range,
        syntax: Object.freeze({
          ast: markdownAstOf(editing),
          coordinates: projectionCoordinatesOf(editing, state.source.length)
        })
      })
    }, revision === currentRevision)
    cachedByComment.set(comment, result)
    return result
  }

  /**
   * The node of this revision's Comment at the same range as `comment`, which
   * a regional reply's annotations describe without being the objects the
   * revision's own parse holds.
   */
  const sameComment = (facts: RevisionFacts, comment: CriticMarkupAnnotation): NodeId | undefined => {
    for (const [annotation, nodeId] of facts.nodeIdByAnnotation) {
      if (annotation.kind === 'comment' && annotation.range.start === comment.range.start &&
          annotation.range.end === comment.range.end) return nodeId
    }
    return undefined
  }

  /**
   * The blocks around `range` with a block of context on each side, parsed as
   * the regional window of an edit there, for reading a revision that no
   * longer holds its document parse. A Comment payload or a suggestion's arm
   * reads there as in the whole document, since the window keeps its safe
   * points. Undefined when the revision holds its parse or no window covers
   * `range`.
   */
  const regionalReadWindow = (
    state: RevisionState,
    range: SourceRange
  ): ReturnType<typeof previewRegionalRange> => {
    if (state.productStore.withRetained(() => true) === true) return undefined
    const inventory = state.regionalInventory ?? convertedRegionalInventory(state)
    if (inventory === undefined) return undefined
    return previewRegionalRange(inventory, state.source, range, executionBudget,
      state.markdownOptions, regionalPhysicalRecorder)
  }

  /**
   * The blocks around `range` read for planning a key, also when a label in
   * them names one of the document's definitions: the window reads that
   * label as text. Planning reads only blocks and code and math spans, which
   * bind before links do, so a resolved label changes none of them.
   */
  const regionalPlanningWindow = (
    state: RevisionState,
    range: SourceRange
  ): ReturnType<typeof previewRegionalRange> => {
    if (state.productStore.withRetained(() => true) === true) return undefined
    const inventory = state.regionalInventory ?? convertedRegionalInventory(state)
    if (inventory === undefined) return undefined
    // Planning reads blocks alone, as a suggestion arm's lines read in place.
    const validated = previewRegionalRange(inventory, state.source, range, executionBudget,
      state.markdownOptions, regionalPhysicalRecorder, true)
    if (validated !== undefined) return validated
    const window = regionalRangeWindow(inventory, state.source, range, executionBudget,
      state.markdownOptions, regionalPhysicalRecorder)
    if (window?.labelsOnly !== true) return undefined
    return Object.freeze({
      sourceStart: window.sourceStart,
      nextProducts: window.nextProducts,
      nextWindow: window.nextWindow,
      ...(window.cleanStart === true ? { cleanStart: true as const } : {}),
      ...(window.cleanEnd === true ? { cleanEnd: true as const } : {}),
      ...(window.wholeLeaf === true ? { wholeLeaf: true as const } : {}),
      ...(window.literal === undefined ? {} : { literal: window.literal })
    })
  }

  const windowAnnotations = new WeakMap<Profile1DocumentProducts, MaterializedAnnotations>()
  const windowAnnotationsOf = (products: Profile1DocumentProducts): MaterializedAnnotations => {
    let materialized = windowAnnotations.get(products)
    if (materialized === undefined) {
      materialized = annotationsOf(products)
      windowAnnotations.set(products, materialized)
      inspection.regionalInventoryLocalAnnotationMaterializedNodes +=
        countCriticMarkupAnnotationNodes(materialized.annotations)
    }
    return materialized
  }

  const regionalCommentMarkup = (
    state: RevisionState,
    comment: CriticMarkupAnnotation
  ): CommentMarkupProjection | undefined => {
    const window = regionalReadWindow(state, comment.range)
    if (window === undefined) return undefined
    const shift = window.sourceStart
    const materialized = windowAnnotationsOf(window.nextProducts)
    const pending = [...materialized.annotations]
    let local: CriticMarkupAnnotation | undefined
    while (pending.length > 0 && local === undefined) {
      const candidate = pending.pop()
      if (candidate === undefined) break
      if (candidate.kind === 'comment' && candidate.range.start + shift === comment.range.start &&
          candidate.range.end + shift === comment.range.end) local = candidate
      for (const arm of candidate.arms) pending.push(...arm.annotations)
    }
    const nodeId = local === undefined ? undefined : materialized.nodeIdByAnnotation.get(local)
    if (nodeId === undefined) return undefined
    const editing = window.nextProducts.commentEditing(nodeId)
    return Object.freeze({
      kind: 'comment-markup',
      annotationRange: comment.range,
      syntax: Object.freeze({
        ast: markdownAstOf(editing),
        coordinates: shiftedRegionalProjectionCoordinatesOf(
          editing, window.nextWindow.length, shift, state.source.length
        )
      })
    })
  }

  const intersectsProjection = (
    revision: DocumentRevision,
    projection: DocumentProjectionName,
    range: SourceRange
  ): boolean => {
    const state = stateByRevision.get(revision)
    if (state === undefined) {
      throw new Error('Document revision belongs to another core')
    }
    if (
      range === null || typeof range !== 'object' ||
      !Number.isInteger(range.start) || !Number.isInteger(range.end) ||
      range.start < 0 || range.end < range.start || range.end > state.source.length
    ) {
      throw new RangeError('Source range is outside the revision')
    }
    if (projectionCache.get(revision)?.get(projection) === undefined) {
      const window = regionalReadWindow(state, range)
      if (window !== undefined) {
        const products = window.nextProducts
        const projected = projection === 'original'
          ? products.original
          : projection === 'revised' ? products.revised : products.editing()
        return projectionCoordinatesOf(projected, window.nextWindow.length).intersectsSource(Object.freeze({
          start: range.start - window.sourceStart,
          end: range.end - window.sourceStart
        }))
      }
    }
    return projection === 'markup'
      ? projectRevision(revision, projection).syntax.coordinates.intersectsSource(range)
      : projectRevision(revision, projection).coordinates.intersectsSource(range)
  }

  const projectAround = (
    revision: DocumentRevision,
    name: MarkdownProjectionName,
    range: SourceRange
  ): Readonly<{ projection: MarkdownProjection; span: SourceRange }> => {
    const state = stateByRevision.get(revision)
    if (state === undefined) {
      throw new Error('Document revision belongs to another core')
    }
    if (name !== 'original' && name !== 'revised') {
      throw new RangeError(`Unknown Markdown projection: ${String(name)}`)
    }
    if (
      range === null || typeof range !== 'object' ||
      !Number.isInteger(range.start) || !Number.isInteger(range.end) ||
      range.start < 0 || range.end < range.start || range.end > state.source.length
    ) {
      throw new RangeError('Source range is outside the revision')
    }
    let projection = projectionCache.get(revision)?.get(name) as MarkdownProjection | undefined
    if (projection === undefined) {
      const window = regionalReadWindow(state, range)
      if (window !== undefined) {
        const projected = name === 'original' ? window.nextProducts.original : window.nextProducts.revised
        projection = Object.freeze({
          kind: 'markdown',
          name,
          markdown: projected.source,
          ast: markdownAstOf(projected),
          coordinates: shiftedRegionalProjectionCoordinatesOf(
            projected, window.nextWindow.length, window.sourceStart, state.source.length
          )
        })
        inspection.regionalAstMaterializedNodes += countMarkdownAstNodes(projection.ast.root)
      }
    }
    projection ??= projectRevision(revision, name)
    return Object.freeze({
      projection,
      span: Object.freeze({
        start: projection.coordinates.toProjected(range.start, 'next'),
        end: projection.coordinates.toProjected(range.end, 'next')
      })
    })
  }

  // Authoring compares sibling candidates around the same ranges repeatedly.
  const trackedReadingCache = new WeakMap<DocumentRevision, Map<string, TrackedRegionalReading | null>>()
  const trackedRegionalReading = (
    revision: DocumentRevision,
    range: SourceRange
  ): TrackedRegionalReading | undefined => {
    const state = stateByRevision.get(revision)
    if (state === undefined || range.start < 0 || range.end < range.start || range.end > state.source.length) return undefined
    let cache = trackedReadingCache.get(revision)
    if (cache === undefined) {
      cache = new Map()
      trackedReadingCache.set(revision, cache)
    }
    const key = `${range.start}:${range.end}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached ?? undefined
    const spanned = (
      projected: { readonly source: string },
      coordinates: MarkdownProjection['coordinates']
    ): string => projected.source.slice(
      coordinates.toProjected(range.start, 'next'),
      coordinates.toProjected(range.end, 'next')
    )
    let reading: TrackedRegionalReading | undefined
    // A revision holding its parse answers from its whole projections.
    if (state.productStore.withRetained(() => true) === true) {
      const original = projectRevision(revision, 'original')
      const revised = projectRevision(revision, 'revised')
      let view: string | undefined
      reading = Object.freeze({
        original: spanned({ source: original.markdown }, original.coordinates),
        revised: spanned({ source: revised.markdown }, revised.coordinates),
        window: Object.freeze({ start: 0, end: state.source.length }),
        view: () => {
          view ??= projectionSignature(revised.ast.root)
          return view
        }
      })
    } else {
      // A preview's replaced blocks read from the window its apply parsed,
      // where no window of the inventory proves a reading of them.
      const applied = appliedWindows.get(revision)
      const window = regionalReadWindow(state, range) ??
        (applied !== undefined && applied.replaced.start <= range.start && range.end <= applied.replaced.end ? applied : undefined)
      if (window !== undefined) {
        const { original, revised } = window.nextProducts
        const coordinatesOf = (projected: typeof original): MarkdownProjection['coordinates'] =>
          shiftedRegionalProjectionCoordinatesOf(projected, window.nextWindow.length, window.sourceStart, state.source.length)
        let view: string | undefined
        reading = Object.freeze({
          original: spanned(original, coordinatesOf(original)),
          revised: spanned(revised, coordinatesOf(revised)),
          window: Object.freeze({ start: window.sourceStart, end: window.sourceStart + window.nextWindow.length }),
          view: () => {
            view ??= projectionSignature(markdownAstOf(revised).root)
            return view
          }
        })
      }
    }
    if (reading !== undefined && checksAppliedReadings() && state.productStore.withRetained(() => true) !== true &&
        regionalReadWindow(state, range) === undefined) {
      const original = projectRevision(revision, 'original')
      const revised = projectRevision(revision, 'revised')
      if (spanned({ source: original.markdown }, original.coordinates) !== reading.original ||
          spanned({ source: revised.markdown }, revised.coordinates) !== reading.revised) {
        throw new Error(`An applied window's reading diverged from the whole projection of ${JSON.stringify(revision.source)}`)
      }
    }
    cache.set(key, reading ?? null)
    return reading
  }

  function projectCommentView(
    revision: DocumentRevision,
    comment: CriticMarkupAnnotation
  ): CommentProjection
  function projectCommentView(
    revision: DocumentRevision,
    comment: CriticMarkupAnnotation,
    view: 'markup'
  ): CommentMarkupProjection
  function projectCommentView(
    revision: DocumentRevision,
    comment: CriticMarkupAnnotation,
    view?: 'markup'
  ): CommentProjection | CommentMarkupProjection {
    if (view === undefined) return projectComment(revision, comment)
    if (view !== 'markup') {
      throw new RangeError(`Unknown Comment projection: ${String(view)}`)
    }
    return projectCommentMarkup(revision, comment)
  }

  const stableSourceEdits = (
    edits: readonly DocumentSourceEdit[]
  ): readonly DocumentSourceEdit[] => {
    if (!Array.isArray(edits)) {
      throw new DocumentSourceEditError(
        'Document core source edits must be an array'
      )
    }
    if (
      edits.length >
      DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction
    ) {
      throw new DocumentSourceEditError(
        'Document core source edits exceed the transaction limit'
      )
    }
    const stable: DocumentSourceEdit[] = []
    for (let index = 0; index < edits.length; index += 1) {
      const candidate: unknown = edits[index]
      if (candidate === null || typeof candidate !== 'object') {
        throw new DocumentSourceEditError(
          `Document core source edit ${String(index)} is invalid`
        )
      }
      const edit = candidate as Partial<DocumentSourceEdit>
      if (
        !Number.isInteger(edit.start) ||
        !Number.isInteger(edit.end) ||
        (edit.start ?? -1) < 0 ||
        (edit.end ?? -1) < (edit.start ?? 0) ||
        typeof edit.insert !== 'string'
      ) {
        throw new DocumentSourceEditError(
          `Document core source edit ${String(index)} is invalid`
        )
      }
      stable.push(Object.freeze({
        start: edit.start as number,
        end: edit.end as number,
        insert: edit.insert
      }))
    }
    return Object.freeze(stable)
  }

  const currentStateOf = (previous: DocumentRevision): RevisionState => {
    const previousState = stateByRevision.get(previous)
    if (previousState === undefined) {
      throw new Error('Document revision belongs to another core')
    }
    if (previous !== currentRevision) {
      throw new Error('Document revision is not the current core revision')
    }
    return previousState
  }

  const preflightSourceEdits = (
    sourceLength: number,
    edits: readonly DocumentSourceEdit[]
  ): number => {
    let previousEnd = 0
    let nextLength = sourceLength
    for (let index = 0; index < edits.length; index += 1) {
      const edit = edits[index]
      if (
        edit === undefined ||
        edit.start < previousEnd ||
        edit.end > sourceLength
      ) {
        throw new DocumentSourceEditError(
          `Document core source edit ${String(index)} is invalid`
        )
      }
      nextLength += edit.insert.length - (edit.end - edit.start)
      previousEnd = edit.end
    }
    if (nextLength > DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits) {
      const limit = DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
      throw new DocumentCoreError(
        'CM_RESOURCE_SOURCE_UNITS_EXCEEDED',
        Object.freeze({ start: limit, end: limit }),
        Object.freeze({ limit: String(limit), observed: String(nextLength) })
      )
    }
    return nextLength
  }

  const rejectSurrogateSplits = (
    source: PersistentCanonicalSource,
    edits: readonly DocumentSourceEdit[]
  ): void => {
    const index = surrogateSplittingEdit(source, edits)
    if (index !== undefined) {
      throw new DocumentSourceEditError(
        `Document core source edit ${String(index)} splits a surrogate pair`
      )
    }
  }

  const applyCandidate = (
    previousState: RevisionState,
    source: PersistentCanonicalSource,
    stableEdits: readonly DocumentSourceEdit[],
    options?: Readonly<Partial<MarkdownOptions>>,
    materializationReason: CanonicalSourceMaterializationReason = 'fallback'
  ): DocumentRevision => {
    const resolvedOptions = options === undefined
      ? previousState.markdownOptions
      : markdownOptions(options, previousState.markdownOptions)
    const previousPass = demoteCurrentProductStore(products => {
      // A regionally reached revision's parse is made apart from the reuse
      // cache the document parse reads, so its templates can describe blocks
      // a regional edit has since changed.
      if (previousState.kind === 'regional') return undefined
      if (!sameMarkdownOptions(previousState.markdownOptions, resolvedOptions)) {
        return undefined
      }
      // Front matter runs from the document's first line to its closing line,
      // wherever an edit moves that, so the retained pass cannot bound it.
      const frontMatter = /^(?:---|\+\+\+)[ \t]*(?:\r\n|\r|\n|$)/u
      if (resolvedOptions.frontMatter &&
          (frontMatter.test(previousState.source.slice(0, Math.min(8, previousState.source.length))) ||
           frontMatter.test(source.slice(0, Math.min(8, source.length))))) {
        return undefined
      }
      if (editsMayRepairMath(previousState.source, source, stableEdits, resolvedOptions)) {
        return undefined
      }
      const retained = products.retainedIntrinsic
      return retained === undefined
        ? undefined
        : Object.freeze({ retained, edits: stableEdits })
    })
    const materialized = source.materialize(materializationReason)
    return publish(
      source,
      parse(materialized, resolvedOptions, previousPass),
      resolvedOptions
    )
  }

  // The candidates previewed for the current revision, newest first: planning
  // a key may preview one edit several times, and the edit it settles on is
  // applied next, which publishes the same parse instead of repeating it.
  const PREVIEWED_CANDIDATES_RETAINED = 2
  // A window core's document is a few blocks, and its spelling search
  // previews the same candidate text again from several planners.
  const WINDOW_PREVIEWED_CANDIDATES_RETAINED = 16
  // An entry's whole parse may wait until something reads beyond its reader views.
  let previewedCandidates: {
    revision: DocumentRevision
    entries: Array<Readonly<{ key: string, source: string, reader: ReaderProducts, products: Profile1DocumentProducts }>>
  } | undefined
  const candidateKey = (edits: readonly DocumentSourceEdit[]): string => JSON.stringify(edits.map(edit => [edit.start, edit.end, edit.insert]))
  const previewedCandidate = (revision: DocumentRevision, edits: readonly DocumentSourceEdit[]) => {
    if (previewedCandidates?.revision !== revision || revision !== currentRevision) return undefined
    const key = candidateKey(edits)
    return previewedCandidates.entries.find(entry => entry.key === key)
  }
  const rememberPreviewedCandidate = (
    revision: DocumentRevision,
    edits: readonly DocumentSourceEdit[],
    source: string,
    products: Profile1DocumentProducts | (() => Profile1DocumentProducts),
    reader: ReaderProducts | undefined = typeof products === 'function' ? undefined : products
  ): void => {
    if (revision !== currentRevision) return
    if (previewedCandidates?.revision !== revision) previewedCandidates = { revision, entries: [] }
    let whole = typeof products === 'function' ? undefined : products
    const parseWhole = typeof products === 'function' ? products : () => products
    previewedCandidates.entries.unshift(Object.freeze({
      key: candidateKey(edits),
      source,
      reader: reader ?? (whole ??= parseWhole()),
      get products(): Profile1DocumentProducts {
        whole ??= parseWhole()
        return whole
      }
    }))
    previewedCandidates.entries.length = Math.min(previewedCandidates.entries.length,
      windowCores.has(core) ? WINDOW_PREVIEWED_CANDIDATES_RETAINED : PREVIEWED_CANDIDATES_RETAINED)
  }

  // Authoring validates the complete candidate in the acknowledged parser
  // context, but cannot publish, demote, or alter the live reuse cache. Only
  // detached facts leave this callback; candidate parser products are discarded.
  const withSourceEditPreview = <T>(
    previous: DocumentRevision,
    edits: readonly DocumentSourceEdit[],
    inspect: (products: Profile1DocumentProducts, source: string) => T
  ): T => {
    const state = currentStateOf(previous)
    const stableEdits = stableSourceEdits(edits)
    preflightSourceEdits(state.source.length, stableEdits)
    const whole = plansFromGeneralCompile(core)
    const cached = whole ? undefined : previewedCandidate(previous, stableEdits)
    if (cached !== undefined) return inspect(cached.products, cached.source)
    const source = state.source.applyExact(stableEdits, 'Authoring candidate')
      .materialize('fallback')
    // No edit reads as the revision itself, whose parse it may still hold.
    const held = stableEdits.length === 0 && !whole ? state.productStore.withRetained(products => products) : undefined
    if (held !== undefined) return inspect(held, source)
    // Other edits writing the same text read as the same candidate: the
    // untracked compile of a key and of the block it rewrites often agree.
    const written = whole || previewedCandidates?.revision !== previous || previous !== currentRevision
      ? undefined
      : previewedCandidates.entries.find(entry => entry.source === source)
    if (written !== undefined) {
      rememberPreviewedCandidate(previous, stableEdits, source, written.products)
      return inspect(written.products, source)
    }
    const reusable = !editsMayRepairMath(state.source, { length: source.length, slice: (start: number, end: number) => source.slice(start, end) }, stableEdits, state.markdownOptions)
    // A revision holding its parse lends it to the candidate's; one edited
    // regionally is not parsed for that, as the candidate's parse is whole.
    const retained = reusable && !whole ? state.productStore.withRetained(products => products.retainedIntrinsic) : undefined
    const products = isolatedProducts(source, state.markdownOptions,
      retained === undefined ? undefined : { retained, edits: stableEdits })
    if (!whole) rememberPreviewedCandidate(previous, stableEdits, source, products)
    return inspect(products, source)
  }

  /**
   * A window core's candidate, read as `withSourceEditPreview` reads it, from
   * its reader views alone: the editing projection, which the tracked oracle
   * does not read, is parsed whole only once something asks for it.
   */
  const withSourceEditReaderPreview = <T>(
    previous: DocumentRevision,
    edits: readonly DocumentSourceEdit[],
    inspect: (reader: ReaderProducts, source: string, products: () => Profile1DocumentProducts) => T
  ): T => {
    const state = currentStateOf(previous)
    const stableEdits = stableSourceEdits(edits)
    preflightSourceEdits(state.source.length, stableEdits)
    const cached = previewedCandidate(previous, stableEdits)
    if (cached !== undefined) return inspect(cached.reader, cached.source, () => cached.products)
    const source = state.source.applyExact(stableEdits, 'Authoring candidate')
      .materialize('fallback')
    const held = stableEdits.length === 0 ? state.productStore.withRetained(products => products) : undefined
    if (held !== undefined) return inspect(held, source, () => held)
    const written = previewedCandidates?.revision !== previous || previous !== currentRevision
      ? undefined
      : previewedCandidates.entries.find(entry => entry.source === source)
    if (written !== undefined) {
      rememberPreviewedCandidate(previous, stableEdits, source, () => written.products, written.reader)
      return inspect(written.reader, source, () => written.products)
    }
    const reusable = !editsMayRepairMath(state.source, { length: source.length, slice: (start: number, end: number) => source.slice(start, end) }, stableEdits, state.markdownOptions)
    const retained = reusable ? state.productStore.withRetained(products => products.retainedIntrinsic) : undefined
    const previousPass = retained === undefined ? undefined : { retained, edits: stableEdits }
    inspection.documentParses += 1
    inspection.documentParseSourceUnits += source.length
    inspection.documentProjectionPreparationUnits += source.length
    const reader = parseProfile1ReaderViews(source, executionBudget, state.markdownOptions, physicalRecorder, previousPass)
    if (reader.kind !== 'reader') throw documentCoreError(reader.fatalDiagnostic)
    let whole: Profile1DocumentProducts | undefined
    const products = (): Profile1DocumentProducts => {
      whole ??= isolatedProducts(source, state.markdownOptions, previousPass)
      return whole
    }
    rememberPreviewedCandidate(previous, stableEdits, source, products, reader)
    if (checksReaderViews() && readerViewsDigest(reader) !== readerViewsDigest(products())) {
      throw new Error(`Reader views diverged from the whole parse of ${JSON.stringify(source)}`)
    }
    return inspect(reader, source, products)
  }

  // A full revision's inventory is built from the parse it holds, once.
  const convertedInventories = new WeakMap<RevisionState, RegionalInventory | null>()

  /**
   * The revision `edits` make of `previous`, read regionally as apply()
   * reads it, but not published; undefined where apply() would parse the
   * document instead. Candidates of one edit are previewed as siblings of
   * `previous`, which stays the current revision.
   */
  const regionalPreview = (
    previous: DocumentRevision,
    edits: readonly DocumentSourceEdit[]
  ): Readonly<{ revision: DocumentRevision, replaced: Readonly<{ start: number, end: number, nextEnd: number }> }> | undefined => {
    const state = stateByRevision.get(previous)
    if (state === undefined || plansFromDocumentParse(core)) return undefined
    let inventory = state.regionalInventory
    if (inventory === undefined) {
      let converted = convertedInventories.get(state)
      if (converted === undefined) {
        converted = convertedRegionalInventory(state) ?? null
        convertedInventories.set(state, converted)
      }
      inventory = converted ?? undefined
    }
    if (inventory === undefined) return undefined
    const given = stableSourceEdits(edits)
    preflightSourceEdits(state.source.length, given)
    const stable = editsWithinOneList(state, given)
    const first = stable[0]
    const last = stable.at(-1)
    if (first === undefined || last === undefined) return undefined
    const source = state.source.applyExact(stable, 'Authoring regional preview')
    // The inventory window proves a whole math block's replacement (see
    // `literalBlockReplacement`).
    if (source.requiresFragmentationRebase || editsMayRepairMath(state.source, source, stable, state.markdownOptions) &&
        !mathBlockSubstitution(state.source, stable, inventory) &&
        !(stable.length === 1 && stable[0] !== undefined && literalBlockReplacement(state.source, stable[0], inventory)?.kind === 'math') &&
        !dollarsKept(state.source, stable)) {
      return undefined
    }
    // Nearby edits are one replacement of the text they span, as apply() reads them.
    let replacement = stable
    if (stable.length > 1) {
      if (last.end - first.start > COMBINED_EDIT_SPAN) return undefined
      let insert = ''
      let cursor = first.start
      for (const edit of stable) {
        insert += state.source.slice(cursor, edit.start) + edit.insert
        cursor = edit.end
      }
      replacement = Object.freeze([Object.freeze({ start: first.start, end: last.end, insert })])
    }
    const requests = normalizeProjectionRequests([])
    if (requests === undefined) return undefined
    const result = tryInventoryRegionalApply(state, source, replacement, state.markdownOptions, requests, inventory, true)
    return result?.kind === 'applied' && result.replaced !== undefined
      ? Object.freeze({ revision: result.revision, replaced: result.replaced })
      : undefined
  }

  // `readers`: the candidate is one of a spelling search's, read from its
  // reader views where it is parsed whole (see `withSourceEditReaderPreview`).
  // `whole`: the candidate is parsed whole, as the general-compile reference
  // reads every candidate.
  const previewSourceEdits = (previous: DocumentRevision, edits: readonly DocumentSourceEdit[], readers = false, whole = false): DocumentRevision => {
    const regional = whole || windowCores.has(core) && previous.sourceLength <= WINDOW_WHOLE_PREVIEW_UNITS
      ? undefined
      : regionalPreview(previous, edits)
    if (regional !== undefined) {
      const { revision, replaced } = regional
      // The candidate reads as `previous` outside the source it replaced, so
      // its whole projection is `previous`'s with that source's reading in it;
      // `previous`'s, read once, serves all of its candidates.
      const whole = (name: MarkdownProjectionName): string => {
        const reading = trackedRegionalReading(revision, { start: replaced.start, end: replaced.nextEnd })
        if (reading === undefined) return projectRevision(revision, name).markdown
        const base = projectRevision(previous, name)
        return base.markdown.slice(0, base.coordinates.toProjected(replaced.start, 'next')) + reading[name] +
          base.markdown.slice(base.coordinates.toProjected(replaced.end, 'next'))
      }
      let original: string | undefined
      let revised: string | undefined
      let revisedView: string | undefined
      trackedPreviewFacts.set(revision, Object.freeze({
        // The oracle compares candidates around `region` without these.
        get original(): string {
          original ??= whole('original')
          return original
        },
        get revised(): string {
          revised ??= whole('revised')
          return revised
        },
        revisedView: () => {
          revisedView ??= projectionSignature(projectRevision(revision, 'revised').ast.root)
          return revisedView
        },
        // Read from a whole parse of the candidate, which leaves the core's
        // revisions and the parses they hold as they are.
        structure: () => {
          const source = revision.source
          const editing = isolatedProducts(source, stateByRevision.get(previous)?.markdownOptions ?? markdownOptions()).editing()
          return trackedStructure(markdownAstOf(editing).root, projectionCoordinatesOf(editing, source.length))
        },
        region: Object.freeze({ base: previous, revision, ...replaced })
      }))
      return revision
    }
    const wholePreview = (reader: ReaderProducts, source: string, products: () => Profile1DocumentProducts): DocumentRevision => {
      const preview: DocumentRevision = Object.freeze({
        source,
        sourceLength: source.length,
        annotations: annotationsOf(reader).annotations,
        diagnostics: diagnosticsOf(reader)
      })
      let revisedView: string | undefined
      let structure: TrackedStructure | undefined
      trackedPreviewFacts.set(preview, Object.freeze({
        original: reader.original.source,
        revised: reader.revised.source,
        structure: () => {
          const editing = products().editing()
          structure ??= trackedStructure(markdownAstOf(editing).root, projectionCoordinatesOf(editing, source.length))
          return structure
        },
        revisedView: () => {
          revisedView ??= projectionSignature(markdownAstOf(reader.revised).root)
          return revisedView
        }
      }))
      return preview
    }
    return (windowCores.has(core) || readers) && !plansFromDocumentParse(core)
      ? withSourceEditReaderPreview(previous, edits, wholePreview)
      : withSourceEditPreview(previous, edits, (products, source) => wholePreview(products, source, () => products))
  }

  // Use the canonical region and the same admission parser as apply(). This
  // does not publish a revision or materialize a whole-document projection.
  const regionalCandidate = (
    state: RevisionState,
    edit: DocumentSourceEdit
  ): Readonly<{
    sourceStart: number
    nextProducts: Profile1DocumentProducts
    nextWindow: string
    structural?: Readonly<{ touchesAnnotation: boolean, markerDelta: number }>
    arm?: RegionalInventoryPreview['arm']
    armCreation?: true
  }> | undefined => {
    if (plansFromGeneralCompile(core)) return undefined
    const edits = Object.freeze([edit])
    const source = state.source.applyExact(edits, 'Authoring regional candidate')
    const repairsMath = editsMayRepairMath(state.source, source, edits, state.markdownOptions)
    if (repairsMath && !mathBlockSubstitution(state.source, edits, state.regionalInventory) &&
        !inventoryMathReplacement(state, edits) && !inventoryDollarsKept(state, edits)) return undefined
    if (state.regionalInventory !== undefined) {
      const candidate = previewRegionalInventory(
        state.regionalInventory, state.source, source, edits, [], executionBudget,
        state.markdownOptions, regionalPhysicalRecorder
      )
      if (candidate.kind === 'resource-failure') throw documentCoreError(candidate.fatalDiagnostic)
      if (candidate.kind === 'validated') return candidate
    }
    // Only the inventory window proves where a math block's dollars pair.
    if (repairsMath) return undefined
    if (state.criticMarkupIndex !== undefined) {
      const candidate = admitCriticMarkupRegionalChange(
        state.source, source, state.criticMarkupIndex, edits, executionBudget,
        state.markdownOptions, regionalPhysicalRecorder
      )
      if (candidate?.kind === 'resource-failure') throw documentCoreError(candidate.fatalDiagnostic)
      if (candidate !== undefined) {
        return Object.freeze({
          sourceStart: state.criticMarkupIndex.source.start,
          nextProducts: candidate.nextProducts,
          nextWindow: candidate.nextWindow
        })
      }
    }
    if (state.retainedIndex !== undefined &&
        (state.retainedIndex.dependencyPrefixEnd === 0 || edit.start > state.retainedIndex.dependencyPrefixEnd)) {
      const candidate = admitProfile1PlainParagraphRegion(
        state.source, source, state.retainedIndex, edits, executionBudget,
        state.markdownOptions, regionalPhysicalRecorder
      )
      if (candidate?.kind === 'admitted' && candidate.parsed.kind === 'complete') {
        return Object.freeze({
          sourceStart: candidate.bracket.start,
          nextProducts: candidate.parsed,
          nextWindow: candidate.nextWindow
        })
      }
    }
    const converted = convertedRegionalInventory(state)
    if (converted !== undefined) {
      const candidate = previewRegionalInventory(
        converted, state.source, source, edits, [], executionBudget,
        state.markdownOptions, regionalPhysicalRecorder
      )
      if (candidate.kind === 'resource-failure') throw documentCoreError(candidate.fatalDiagnostic)
      if (candidate.kind === 'validated') return candidate
    }
    return undefined
  }

  const regionalInputSyntax = (state: RevisionState, range: SourceRange): MarkupSyntax | undefined => {
    if (plansFromGeneralCompile(core)) return undefined
    // A caret inside a marker's spelling splits it, which no edit window
    // admits; the blocks around it still read as they do in place.
    const candidate = regionalCandidate(state, { start: range.start, end: range.start, insert: '' }) ??
      regionalPlanningWindow(state, range)
    if (candidate === undefined || range.end > candidate.sourceStart + candidate.nextWindow.length) return undefined
    const literal = 'literal' in candidate ? candidate.literal : undefined
    const syntax = windowSyntax(candidate.sourceStart, candidate.nextProducts, candidate.nextWindow.length, literal)
    if ('cleanStart' in candidate && candidate.cleanStart === true) cleanStartSyntaxes.add(syntax)
    if ('cleanEnd' in candidate && candidate.cleanEnd === true) cleanEndSyntaxes.add(syntax)
    if (('wholeLeaf' in candidate && candidate.wholeLeaf === true) || literal !== undefined) wholeLeafSyntaxes.add(syntax)
    return syntax
  }

  /**
   * The blocks around a caret with their neighbours, for planning a key
   * against a revision that no longer holds its document parse. A revision
   * still holding it plans against it.
   */
  const regionalBlockContext = (state: RevisionState, position: number): RegionalBlockContext | undefined => {
    if (plansFromDocumentParse(core) || state.productStore.withRetained(() => true) === true) return undefined
    const inventory = state.regionalInventory ?? convertedRegionalInventory(state)
    if (inventory === undefined) return undefined
    // Blocks other than paragraphs, or a caret splitting a marker's spelling,
    // admit no edit window, yet still read in place as in the document.
    const candidate = previewRegionalContext(inventory, state.source, position, executionBudget,
      state.markdownOptions, regionalPhysicalRecorder) ??
      regionalPlanningWindow(state, { start: position, end: position })
    if (candidate === undefined) return undefined
    const editing = candidate.nextProducts.editing()
    const literal = candidate.literal
    return Object.freeze({
      syntax: windowSyntax(candidate.sourceStart, candidate.nextProducts, candidate.nextWindow.length, literal),
      lines: editing.markdown.lines,
      enterConversion: (range: SourceRange) =>
        paragraphEnterConversion(editing.source, range.start, range.end, state.markdownOptions.texMathDollars),
      // A literal window's own lines are the document's; its opener and
      // closer stand for the block's lines beyond them.
      source: literal === undefined
        ? Object.freeze({ start: candidate.sourceStart, end: candidate.sourceStart + candidate.nextWindow.length })
        : Object.freeze({ start: candidate.sourceStart + literal.lines.start, end: candidate.sourceStart + literal.lines.end }),
      ...(candidate.cleanStart === true ? { cleanStart: true as const } : {}),
      ...(candidate.cleanEnd === true ? { cleanEnd: true as const } : {}),
      ...(candidate.wholeLeaf === true || literal !== undefined ? { wholeLeaf: true as const } : {})
    })
  }

  /** Window syntaxes whose windows begin at a clean block start (see RegionalBlockContext.cleanStart). */
  const cleanStartSyntaxes = new WeakSet<MarkupSyntax>()
  /** Window syntaxes whose windows end at a clean block end (see RegionalBlockContext.cleanEnd). */
  const cleanEndSyntaxes = new WeakSet<MarkupSyntax>()
  /** Window syntaxes of one leaf read alone, which reads as the document does throughout. */
  const wholeLeafSyntaxes = new WeakSet<MarkupSyntax>()

  /**
   * A window's syntax, in its own projected coordinates, mapped to document
   * source offsets. A literal window's opener and closer map to where the
   * document spells them (see RegionalInventoryPreview.literal).
   */
  const windowSyntax = (
    sourceStart: number,
    products: Profile1DocumentProducts,
    windowLength: number,
    literal?: RegionalInventoryPreview['literal']
  ): MarkupSyntax => {
    const editing = products.editing()
    const local = projectionCoordinatesOf(editing, windowLength)
    // The document offset of window source offset `offset`, and back.
    const shiftOf = (offset: number): number => literal === undefined || (offset >= literal.lines.start && offset < literal.lines.end)
      ? sourceStart
      : offset < literal.lines.start ? literal.opener : literal.closer - literal.lines.end
    const toDocument = (offset: number): number =>
      literal !== undefined && offset === literal.lines.end ? sourceStart + offset : offset + shiftOf(offset)
    const toWindow = (offset: number): number => {
      if (literal === undefined) return offset - sourceStart
      const lines = offset - sourceStart
      if (lines >= literal.lines.start && lines <= literal.lines.end) return lines
      if (offset >= literal.opener && offset < literal.opener + literal.lines.start) return offset - literal.opener
      if (offset >= literal.closer && offset <= literal.closer + windowLength - literal.lines.end) {
        return offset - literal.closer + literal.lines.end
      }
      return offset < sourceStart + literal.lines.start ? 0 : windowLength
    }
    const coordinates = Object.freeze<ProjectionCoordinateMap>({
      originAt(offset) {
        const origin = local.originAt(offset)
        return origin.kind === 'source'
          ? Object.freeze({ ...origin, sourceOffset: toDocument(origin.sourceOffset) })
          : Object.freeze({ ...origin, sourcePosition: toDocument(origin.sourcePosition) })
      },
      toSource: (offset, affinity) => toDocument(local.toSource(offset, affinity)),
      toProjected: (offset, affinity) => local.toProjected(toWindow(offset), affinity),
      intersectsSource: range => local.intersectsSource({ start: toWindow(range.start), end: toWindow(range.end) }),
      // A segment is cut where the window's pieces meet.
      sourceSegments: Object.freeze((local.sourceSegments ?? []).flatMap(segment => {
        const cuts = literal === undefined
          ? []
          : [literal.lines.start, literal.lines.end].filter(cut => segment.source.start < cut && cut < segment.source.end)
        const bounds = [segment.source.start, ...cuts, segment.source.end]
        return bounds.slice(1).map((end, index) => {
          const start = bounds[index] ?? segment.source.start
          const projected = segment.projected.start + start - segment.source.start
          return Object.freeze({
            projected: Object.freeze({ start: projected, end: projected + end - start }),
            source: Object.freeze({ start: start + shiftOf(start), end: start + shiftOf(start) + end - start })
          })
        })
      }))
    })
    return Object.freeze({ ast: markdownAstOf(editing), coordinates })
  }

  /**
   * Whether tracked typing that breaks a line lands strictly inside deleted,
   * struck or comment text of a document with no stray markers, as text that
   * can neither spell nor hide a marker. Its suggestion then keeps its
   * markers and holds the typing in that text, which is history the typing
   * splits; or the typing breaks it, which changes its markers. Either way
   * no payload splice spells it. Typing within a line is left to the payload
   * planner, whose window answers it without reading the suggestions around.
   */
  const typedInHistory = (previous: DocumentRevision, edit: DocumentSourceEdit): boolean => {
    if (edit.start !== edit.end || !/^[\p{L}\p{N} \t\r\n.,;:'"?!()]+$/u.test(edit.insert) ||
        !/[\r\n]/u.test(edit.insert) || previous.diagnostics.length !== 0) return false
    const pending = [...rootsAround(previous, edit.start)]
    while (pending.length > 0) {
      const annotation = pending.pop()
      if (annotation === undefined) break
      for (const arm of annotation.arms) {
        const history = annotation.kind === 'deletion' || arm.name === 'old' || arm.name === 'comment'
        if (history && arm.range.start < edit.start && edit.start < arm.range.end) return true
        pending.push(...arm.annotations)
      }
    }
    return false
  }
  // The region regionalPayloadEdit last read an edit in, which the tracked
  // planners after it read for that edit instead of parsing it again.
  let payloadCandidate: Readonly<{
    state: RevisionState
    edit: DocumentSourceEdit
    candidate: ReturnType<typeof regionalCandidate>
  }> | undefined
  // A same-shape regional preview proves marker ownership, diagnostics and
  // Markdown context without publishing or opening the revision's full products.
  // The general planners remain responsible for changing suggestion structure.
  const regionalPayloadEdit = (
    state: RevisionState,
    edit: DocumentSourceEdit,
    tracked: boolean
  ): DocumentSourceEdit | undefined => {
    if (plansFromGeneralCompile(core) || (edit.start === edit.end && edit.insert.length === 0)) return undefined
    const candidate = regionalCandidate(state, edit)
    payloadCandidate = Object.freeze({ state, edit, candidate })
    if (candidate === undefined) return undefined
    // A structural window proves the parse, not that the planner would splice
    // the raw text: an edit spelling new markers, or an untracked edit
    // touching a suggestion, keeps its full planning. Tracked text still
    // needs the draft ownership checked below.
    if (candidate.structural !== undefined && (candidate.structural.markerDelta !== 0 ||
        (!tracked && candidate.structural.touchesAnnotation))) return undefined
    // Lines of a literal block that is an arm's whole text: the window
    // spells no suggestion, so the arm it reads them in is the inventory's.
    const arm = candidate.arm
    if (arm !== undefined) {
      if (!tracked) return edit
      const owned = arm.kind === 'addition' ? arm.name === 'content' : arm.kind === 'substitution' && arm.name === 'new'
      return owned && arm.range.start < edit.start && edit.start + edit.insert.length < arm.range.end ? edit : undefined
    }
    const start = edit.start - candidate.sourceStart
    const end = start + edit.insert.length
    let visible = false
    for (let ordinal = 0; ordinal < candidate.nextProducts.markup.eventCount; ordinal += 1) {
      const event = candidate.nextProducts.markup.eventAt(ordinal)
      if (event.kind === 'text' && event.sourceRange.start <= start && event.sourceRange.end >= end) visible = true
    }
    if (!visible) return undefined
    const pending = [...(candidate.nextProducts.retainedIntrinsic?.roots ?? [])]
    let owner: CriticMarkupNode | undefined
    while (pending.length > 0) {
      const node = pending.pop()
      if (node === undefined) break
      // Empty-arm removals and exterior-boundary coalescing have semantic
      // behavior beyond a literal payload splice; preserve the full planner.
      if (node.kind !== 'comment' && node.arms.some(arm => arm.range.start === arm.range.end)) return undefined
      if (tracked && edit.start === edit.end && (node.range.end === start || node.range.start === end)) return undefined
      // A draft nested in deleted text is history: typing there splits it.
      if (tracked && node.arms.some(arm => (node.kind === 'deletion' || arm.name === 'old' || arm.name === 'comment') &&
        arm.range.start <= start && end <= arm.range.end)) return undefined
      if (node.range.start < start && node.range.end > start &&
          (owner === undefined || node.range.end - node.range.start < owner.range.end - owner.range.start)) owner = node
      for (const arm of node.arms) pending.push(...arm.children)
    }
    if (tracked) {
      if (owner?.kind !== 'addition' && owner?.kind !== 'substitution') return undefined
      if (edit.end - edit.start + edit.insert.length > OWN_DRAFT_SHORTCUT_UNITS) return undefined
      // Typing that begins a line with block syntax, as `<div>` opening an
      // HTML block, can end at the arm's closer where the accepted draft reads
      // on (Profile 2 L2c): the compile weighs the draft's acceptance there.
      const window = candidate.nextWindow
      const lineStarts = [...edit.insert.matchAll(/\r\n|\r|\n/gu)].map(match => start + match.index + match[0].length)
      if (start === 0 || /[\r\n]/u.test(window[start - 1] ?? '')) lineStarts.unshift(start)
      if (lineStarts.some(at => OPENS_BLOCK_LINE.test(window.slice(at, at + 16)))) return undefined
      const arm = owner.arms.find(arm => arm.name === (owner.kind === 'addition' ? 'content' : 'new'))
      if (arm === undefined || arm.range.start > start || arm.range.end < end ||
          (edit.start !== edit.end && arm.children.length > 0)) return undefined
      if (owner.kind === 'substitution' && edit.start !== edit.end) {
        const old = owner.arms.find(arm => arm.name === 'old')
        if (old !== undefined && old.children.length === 0 && arm.children.length === 0 &&
            candidate.nextWindow.slice(old.range.start, old.range.end) === candidate.nextWindow.slice(arm.range.start, arm.range.end)) return undefined
      }
    }
    return edit
  }

  /**
   * Where a new Addition at `at` stands among the suggestions touching it,
   * as the general compiler places one: beside a Highlight or a Comment
   * (after a Comment only, for a break, which the compiler moves past a
   * Comment it meets), or inside a Highlight's text, nested there. Any
   * other suggestion there keeps the general compiler.
   */
  const newAdditionPlacement = (
    previous: DocumentRevision,
    at: number,
    around: readonly CriticMarkupAnnotation[],
    breaking: boolean
  ): Readonly<{ beside: readonly CriticMarkupAnnotation[], host: CriticMarkupAnnotation | undefined }> | undefined => {
    if (trackedPartsSeparate(core) || !plainParagraphAround(previous, at, breaking)) return undefined
    // Words typed at a Highlight's text edges are nested too; a break keeps
    // to the compiler there.
    const host = around.find(annotation => annotation.kind === 'highlight' && annotation.arms.length === 1 &&
      annotation.arms[0] !== undefined && annotation.arms[0].annotations.length === 0 &&
      (breaking
        ? annotation.arms[0].range.start < at && at < annotation.arms[0].range.end
        : annotation.arms[0].range.start <= at && at <= annotation.arms[0].range.end))
    const beside = around.filter(annotation => annotation !== host && (
      annotation.range.end === at && (annotation.kind === 'highlight' || annotation.kind === 'comment') ||
      annotation.range.start === at && (annotation.kind === 'highlight' || !breaking && annotation.kind === 'comment')))
    // Between a Highlight and its Comment the pair would split.
    return around.length !== beside.length + (host === undefined ? 0 : 1) || beside.length > 1
      ? undefined
      : { beside, host }
  }

  /**
   * The suggestions a new Addition placed by `placement` stands among in a
   * reparsed window: the window's roots, or the children of the Highlight
   * hosting it, provided that the suggestions it abuts and its host are
   * recognized unchanged around it.
   */
  const placedAdditionSiblings = (
    candidate: NonNullable<ReturnType<typeof regionalCandidate>>,
    placement: Readonly<{ beside: readonly CriticMarkupAnnotation[], host: CriticMarkupAnnotation | undefined }>,
    planned: DocumentSourceEdit
  ): readonly CriticMarkupNode[] | undefined => {
    const shift = candidate.sourceStart
    const roots = candidate.nextProducts.retainedIntrinsic?.roots ?? []
    if (!neighboursUnchanged(roots, shift, placement.beside, planned)) return undefined
    const host = placement.host
    if (host === undefined) return roots
    const grown = planned.insert.length
    const text = host.arms[0]
    const next = roots.find(node => node.range.start === host.range.start - shift)
    const nextText = next?.arms[0]
    return next?.kind === 'highlight' && next.arms.length === 1 && text !== undefined && nextText !== undefined &&
      next.range.end === host.range.end + grown - shift && nextText.children.length === 1 &&
      nextText.range.start === text.range.start - shift && nextText.range.end === text.range.end + grown - shift
      ? nextText.children
      : undefined
  }

  /**
   * Whether every suggestion in `neighbours`, which the planned edit only
   * abuts, is recognized unchanged in a reparsed window, moved by the edit
   * when it follows it.
   */
  const neighboursUnchanged = (
    roots: readonly CriticMarkupNode[],
    shift: number,
    neighbours: readonly CriticMarkupAnnotation[],
    planned: DocumentSourceEdit
  ): boolean => neighbours.every(neighbour => {
    const moved = neighbour.range.start >= planned.end ? planned.insert.length - (planned.end - planned.start) : 0
    return roots.some(node => node.kind === neighbour.kind &&
      node.range.start === neighbour.range.start + moved - shift && node.range.end === neighbour.range.end + moved - shift)
  })

  /**
   * Plain words typed beside a Deletion, as the general compiler writes
   * them: right before its text they propose a replacement for it, turning
   * it into a Substitution; right after it they are an Addition of their own.
   */
  /**
   * Words or a break typed inside a Deletion's text, as the general compiler
   * writes them: at its text's start typed words replace it, turning it into
   * a Substitution; at its text's end they are an Addition after it; inside
   * its text they split it around an Addition of their own.
   */
  const regionalTrackedInsideDeletion = (
    state: RevisionState,
    previous: DocumentRevision,
    edit: DocumentSourceEdit
  ): DocumentSourceEdit | undefined => {
    const breaking = /^(?:\r\n|\r|\n)+$/u.test(edit.insert)
    if (plansFromDocumentParse(core) || trackedPartsSeparate(core) || edit.start !== edit.end ||
        !breaking && !/^[\p{L}\p{N}][\p{L}\p{N} ]*$/u.test(edit.insert)) return undefined
    const at = edit.start
    const touching = markupAnnotations(rootsAround(previous, at)).filter(annotation =>
      annotation.range.start < at && at < annotation.range.end)
    const owner = touching[0]
    const text = owner?.arms[0]
    if (touching.length !== 1 || owner?.kind !== 'deletion' || text === undefined || owner.arms.length !== 1 ||
        text.annotations.length !== 0 || text.range.start !== owner.range.start + 3 || text.range.end !== owner.range.end - 3 ||
        at < text.range.start || at > text.range.end || !plainParagraphAround(previous, at, breaking)) return undefined
    // At an edge of its text, words join one's own Addition touching that
    // edge, and any other suggestion there keeps the general compiler.
    const touchingEdge = (edge: number): readonly CriticMarkupAnnotation[] => markupAnnotations(rootsAround(previous, edge)).filter(other =>
      (other.range.start !== owner.range.start || other.range.end !== owner.range.end) &&
      (other.range.end === edge || other.range.start === edge))
    const edgeNeighbours = at === text.range.start ? touchingEdge(owner.range.start) : at === text.range.end ? touchingEdge(owner.range.end) : []
    if (edgeNeighbours.length > 0) {
      const draft = edgeNeighbours[0]
      const draftText = draft?.arms[0]
      if (breaking || edgeNeighbours.length !== 1 || draft?.kind !== 'addition' || draftText === undefined || draft.arms.length !== 1 ||
          draftText.annotations.length !== 0 || draftText.range.start !== draft.range.start + 3 || draftText.range.end !== draft.range.end - 3 ||
          !/^[\p{L}\p{N} .,;:'"?!()]+$/u.test(core.sourceSlice(previous, draftText.range))) return undefined
      const target = at === text.range.start ? draftText.range.end : draftText.range.start
      const joined = Object.freeze({ start: target, end: target, insert: edit.insert })
      const candidate = regionalCandidate(state, joined)
      if (candidate === undefined || (candidate.structural?.markerDelta ?? 0) !== 0) return undefined
      const shift = candidate.sourceStart
      const roots = candidate.nextProducts.retainedIntrinsic?.roots ?? []
      const grown = edit.insert.length
      return neighboursUnchanged(roots, shift, [owner], joined) && roots.some(node => node.kind === 'addition' &&
        node.range.start === draft.range.start + (draft.range.start >= target ? grown : 0) - shift &&
        node.range.end === draft.range.end + grown - shift)
        ? joined
        : undefined
    }
    const old = core.sourceSlice(previous, text.range)
    if (!/^[\p{L}\p{N} .,;:'"?!()]+$/u.test(old)) return undefined
    let planned: DocumentSourceEdit
    let expected: ReadonlyArray<Readonly<{ kind: CriticMarkupNode['kind'], start: number, end: number }>>
    if (at === text.range.start) {
      if (breaking) return undefined
      planned = { start: owner.range.start, end: owner.range.end, insert: `{~~${old}~>${edit.insert}~~}` }
      expected = [{ kind: 'substitution', start: owner.range.start, end: owner.range.start + planned.insert.length }]
    } else if (at === text.range.end) {
      if (breaking) return undefined
      planned = { start: owner.range.end, end: owner.range.end, insert: `{++${edit.insert}++}` }
      expected = [{ kind: 'addition', start: owner.range.end, end: owner.range.end + planned.insert.length }]
    } else {
      planned = { start: at, end: at, insert: `--}{++${edit.insert}++}{--` }
      const addition = at + 3
      expected = [
        { kind: 'deletion', start: owner.range.start, end: addition },
        { kind: 'addition', start: addition, end: addition + edit.insert.length + 6 },
        { kind: 'deletion', start: addition + edit.insert.length + 6, end: owner.range.end + planned.insert.length }
      ]
    }
    planned = Object.freeze(planned)
    const candidate = regionalCandidate(state, planned)
    if (candidate?.structural === undefined) return undefined
    const shift = candidate.sourceStart
    const roots = candidate.nextProducts.retainedIntrinsic?.roots ?? []
    return expected.every(({ kind, start, end }) => roots.some(node => node.kind === kind &&
      node.range.start === start - shift && node.range.end === end - shift && node.arms.every(arm => arm.children.length === 0)))
      ? planned
      : undefined
  }

  /**
   * Words or a break typed at one's own Substitution, as the general
   * compiler writes them: a break at its edges or at its old text's start
   * begins or ends its new text, and one inside its new text stays there;
   * words or a break typed inside its old text split off the old text before
   * the caret as a Deletion, followed by an Addition of their own.
   */
  const regionalTrackedInSubstitution = (
    state: RevisionState,
    previous: DocumentRevision,
    edit: DocumentSourceEdit
  ): DocumentSourceEdit | undefined => {
    const breaking = /^(?:\r\n|\r|\n)+$/u.test(edit.insert)
    if (plansFromDocumentParse(core) || trackedPartsSeparate(core) || edit.start !== edit.end ||
        !breaking && !/^[\p{L}\p{N}][\p{L}\p{N} ]*$/u.test(edit.insert)) return undefined
    const at = edit.start
    const touching = markupAnnotations(rootsAround(previous, at)).filter(annotation =>
      annotation.range.start <= at && at <= annotation.range.end)
    const owner = touching[0]
    const [old, proposed] = owner?.arms ?? []
    const words = /^[\p{L}\p{N} .,;:'"?!()]+$/u
    if (touching.length !== 1 || owner?.kind !== 'substitution' || old === undefined || proposed === undefined ||
        owner.arms.length !== 2 || old.annotations.length !== 0 || proposed.annotations.length !== 0 ||
        old.range.start !== owner.range.start + 3 || proposed.range.end !== owner.range.end - 3 ||
        !words.test(core.sourceSlice(previous, old.range)) || !words.test(core.sourceSlice(previous, proposed.range)) ||
        !plainParagraphAround(previous, at, breaking)) return undefined
    let planned: DocumentSourceEdit
    let expected: ReadonlyArray<Readonly<{ kind: CriticMarkupNode['kind'], start: number, end: number }>>
    if (old.range.start < at && at < old.range.end) {
      const struck = core.sourceSlice(previous, { start: old.range.start, end: at })
      planned = { start: owner.range.start, end: at, insert: `{--${struck}--}{++${edit.insert}++}{~~` }
      const addition = owner.range.start + struck.length + 6
      expected = [
        { kind: 'deletion', start: owner.range.start, end: addition },
        { kind: 'addition', start: addition, end: addition + edit.insert.length + 6 },
        { kind: 'substitution', start: addition + edit.insert.length + 6, end: owner.range.end + planned.insert.length - (at - owner.range.start) }
      ]
    } else if (breaking) {
      // A break at the old text's own start is the document compile's to
      // place: it suggests a new paragraph after the Substitution there.
      const into = at === owner.range.start
        ? proposed.range.start
        : at === owner.range.end || at === proposed.range.end
          ? proposed.range.end
          : proposed.range.start < at && at < proposed.range.end ? at : undefined
      if (into === undefined) return undefined
      planned = { start: into, end: into, insert: edit.insert }
      expected = [{ kind: 'substitution', start: owner.range.start, end: owner.range.end + edit.insert.length }]
    } else return undefined
    planned = Object.freeze(planned)
    const candidate = regionalCandidate(state, planned)
    if (candidate?.structural === undefined) return undefined
    const shift = candidate.sourceStart
    const roots = candidate.nextProducts.retainedIntrinsic?.roots ?? []
    return expected.every(({ kind, start, end }) => roots.some(node => node.kind === kind &&
      node.range.start === start - shift && node.range.end === end - shift && node.arms.every(arm => arm.children.length === 0)))
      ? planned
      : undefined
  }

  /**
   * A tracked key on an inner line of a long literal block, which suggests
   * replacing the whole block. The compiler reads only a short block of the
   * same delimiters, its edited line and the text after it, and its
   * Substitution's spelling is applied to the whole block; one window over
   * the block then proves the result. A key that could change the block's
   * delimiters, indentation or termination is compiled as usual.
   */
  const regionalTrackedLiteralBlock = (
    state: RevisionState,
    edit: DocumentSourceEdit
  ): DocumentSourceEdit | undefined => {
    if (plansFromDocumentParse(core) || trackedPartsSeparate(core) || edit.start !== edit.end ||
        state.regionalInventory === undefined || !/^[\p{L}\p{N} .,;:'"?!()=+*/%&|^@#_-]+$/u.test(edit.insert)) return undefined
    const leaves = regionalInventoryLiteralRange(state.regionalInventory, edit.start)
    if (leaves === undefined) return undefined
    const source = state.source
    const text = source.slice(leaves.start, leaves.end)
    const blockStart = leaves.start
    const blockEnd = blockStart + text.replace(/(?:\r\n|\r|\n)[ \t\r\n]*$/u, '').length
    if (edit.start <= blockStart || edit.start >= blockEnd) return undefined
    const lineEnd = (offset: number): number => {
      const match = /\r\n|\r|\n/u.exec(source.slice(offset, blockEnd))
      return match === null ? blockEnd : offset + match.index + match[0].length
    }
    const lineStartAt = (offset: number): number => {
      let at = offset
      while (at > blockStart && !/[\r\n]/u.test(source.slice(at - 1, at))) at -= 1
      return at
    }
    const editedStart = lineStartAt(edit.start)
    const editedEnd = lineEnd(edit.start)
    // The block's first and last lines hold its delimiters, which stand for
    // the lines between them and the edited one; indented code has none,
    // its indentation is its delimiter, and its edited line may be either.
    const indented = /^(?: {4}|\t)/u.test(text)
    const firstLineEnd = indented && editedStart === blockStart ? blockStart : lineEnd(blockStart)
    const lastStart = indented && editedEnd >= blockEnd ? blockEnd : lineStartAt(blockEnd)
    if (editedStart < firstLineEnd || editedEnd > lastStart || (!indented && editedEnd >= blockEnd) ||
        indented && !/^(?: {4}|\t)/u.test(source.slice(editedStart, edit.start)) ||
        !/\S/u.test(source.slice(editedStart, editedEnd) + edit.insert)) return undefined
    // The text after the block to the end of its next line with text.
    let afterEnd = blockEnd
    while (afterEnd < source.length) {
      const next = /\r\n|\r|\n/u.exec(source.slice(afterEnd, Math.min(source.length, afterEnd + 4096)))
      const end = next === null ? source.length : afterEnd + next.index + next[0].length
      const blank = !/\S/u.test(source.slice(afterEnd, end))
      afterEnd = end
      if (!blank || next === null) break
    }
    const before = blockStart === 0 ? '' : 'P.\n\n'
    const block = source.slice(blockStart, firstLineEnd) + source.slice(editedStart, editedEnd) + source.slice(lastStart, blockEnd)
    const shortBlockEnd = before.length + block.length
    const short = before + block + source.slice(blockEnd, afterEnd)
    const shortEdit = Object.freeze({
      start: before.length + firstLineEnd - blockStart + edit.start - editedStart,
      end: before.length + firstLineEnd - blockStart + edit.start - editedStart,
      insert: edit.insert
    })
    const shortCore = createDocumentCoreWithExecutionBudget(executionBudget)
    windowCores.add(shortCore)
    if (equivalenceDeferred(core)) deferEquivalence(shortCore)
    const { schema: _schema, ...options } = state.markdownOptions
    const opened = shortCore.open(short, blockStart === 0 ? options : { ...options, frontMatter: false })
    const shortPreview = sourceEditPreviews.get(shortCore)
    if (opened.annotations.length !== 0 || opened.diagnostics.length !== 0 || shortPreview === undefined) return undefined
    const compiled = generalTrackedEdit(shortCore, opened, shortEdit, candidate => shortPreview(opened, candidate))
    if (compiled === undefined) return undefined
    // The compiled Substitution spells the short block's text as its struck
    // block and the edited text as its proposed one, between its markers.
    const lead = compiled.start - before.length
    const trail = compiled.end - shortBlockEnd
    if (lead < 0 || lead > firstLineEnd - blockStart || trail < 0 || blockEnd + trail > source.length ||
        short.slice(shortBlockEnd, shortBlockEnd + trail) !== source.slice(blockEnd, blockEnd + trail) ||
        // An edit ending inside a CRLF splits the line ending the short block
        // read, which the whole block need not end the same way.
        source.slice(blockEnd + trail - 1, Math.min(source.length, blockEnd + trail + 1)) === '\r\n') return undefined
    const shortOld = short.slice(compiled.start, shortBlockEnd)
    const shortNew = shortOld.slice(0, shortEdit.start - compiled.start) + edit.insert + shortOld.slice(shortEdit.start - compiled.start)
    const opener = `{~~${shortOld}`
    const separator = compiled.insert.indexOf(`~>${shortNew}`, opener.length)
    if (!compiled.insert.startsWith(opener) || separator < 0 || !compiled.insert.endsWith('~~}')) return undefined
    const between = compiled.insert.slice(opener.length, separator)
    const closing = compiled.insert.slice(separator + 2 + shortNew.length, -3)
    if (/\S/u.test(between + closing)) return undefined
    const start = blockStart + lead
    const old = source.slice(start, blockEnd)
    const proposed = old.slice(0, edit.start - start) + edit.insert + old.slice(edit.start - start)
    const planned = Object.freeze({
      start,
      end: blockEnd + trail,
      insert: `{~~${old}${between}~>${proposed}${closing}~~}`
    })
    const candidate = regionalCandidate(state, planned)
    if (candidate?.structural === undefined) return undefined
    // A long block's Substitution reads with lines far from the key left out
    // of both its blocks, which that read proves it holds.
    if (candidate.armCreation === true) return planned
    const shift = candidate.sourceStart
    return (candidate.nextProducts.retainedIntrinsic?.roots ?? []).some(node => node.kind === 'substitution' &&
      node.range.start === start - shift && node.range.end === start + planned.insert.length - shift)
      ? planned
      : undefined
  }

  const regionalTrackedBesideDeletion = (
    state: RevisionState,
    previous: DocumentRevision,
    edit: DocumentSourceEdit
  ): DocumentSourceEdit | undefined => {
    if (plansFromDocumentParse(core) || trackedPartsSeparate(core) || edit.start !== edit.end ||
        !/^[\p{L}\p{N}][\p{L}\p{N} ]*$/u.test(edit.insert)) return undefined
    const touching = markupAnnotations(rootsAround(previous, edit.start)).filter(annotation =>
      annotation.range.start <= edit.start && edit.start <= annotation.range.end)
    const before = touching.filter(annotation => annotation.range.end === edit.start && annotation.range.start < edit.start)
    const after = touching.filter(annotation => annotation.range.start === edit.start && annotation.range.end > edit.start)
    if (touching.length !== before.length + after.length || before.length > 1 || after.length > 1 ||
        before.some(annotation => annotation.kind !== 'deletion') || !plainParagraphAround(previous, edit.start, false)) return undefined
    const replaced = after[0]
    if (replaced !== undefined && replaced.kind !== 'deletion') return undefined
    const struck = replaced?.arms[0]
    let planned: DocumentSourceEdit
    if (replaced === undefined) {
      if (before.length === 0) return undefined
      planned = Object.freeze({ start: edit.start, end: edit.start, insert: `{++${edit.insert}++}` })
    } else {
      if (struck === undefined || replaced.arms.length !== 1 || struck.annotations.length !== 0 ||
          struck.range.start !== replaced.range.start + 3 || struck.range.end !== replaced.range.end - 3) return undefined
      const old = core.sourceSlice(previous, struck.range)
      if (!/^[\p{L}\p{N} .,;:'"?!()]+$/u.test(old)) return undefined
      planned = Object.freeze({ start: replaced.range.start, end: replaced.range.end, insert: `{~~${old}~>${edit.insert}~~}` })
    }
    const candidate = regionalCandidate(state, planned)
    if (candidate?.structural === undefined || candidate.structural.markerDelta !== (replaced === undefined ? 2 : 1)) return undefined
    const shift = candidate.sourceStart
    const roots = candidate.nextProducts.retainedIntrinsic?.roots ?? []
    if (!neighboursUnchanged(roots, shift, before, planned)) return undefined
    const root = roots.find(node => node.range.start === planned.start - shift)
    if (root === undefined || root.range.end !== planned.start + planned.insert.length - shift ||
        root.arms.some(arm => arm.children.length !== 0)) return undefined
    if (replaced === undefined) {
      const text = root.arms[0]
      return root.kind === 'addition' && root.arms.length === 1 && text !== undefined &&
        text.range.start === planned.start + 3 - shift && text.range.end === planned.start + 3 + edit.insert.length - shift
        ? planned
        : undefined
    }
    const [oldArm, newArm] = root.arms
    const oldLength = planned.insert.length - edit.insert.length - 8
    return root.kind === 'substitution' && root.arms.length === 2 && oldArm !== undefined && newArm !== undefined &&
      oldArm.range.start === planned.start + 3 - shift && oldArm.range.end === planned.start + 3 + oldLength - shift &&
      newArm.range.start === oldArm.range.end + 2 && newArm.range.end === newArm.range.start + edit.insert.length
      ? planned
      : undefined
  }

  /**
   * An untracked break at a suggestion, as the ordinary compiler writes it:
   * at the suggestion's outer edge or inside its text it stays where it is
   * typed, and at the start of its first text it moves before the
   * suggestion. Every suggestion there is recognized again around it.
   */
  const regionalUntrackedBreak = (
    state: RevisionState,
    previous: DocumentRevision,
    edit: DocumentSourceEdit
  ): DocumentSourceEdit | undefined => {
    if (plansFromDocumentParse(core) || edit.start !== edit.end || !/^(?:\r\n|\r|\n)+$/u.test(edit.insert) ||
        !plainParagraphAround(previous, edit.start, false)) return undefined
    const around = markupAnnotations(rootsAround(previous, edit.start)).filter(annotation =>
      annotation.range.start <= edit.start && edit.start <= annotation.range.end)
    if (around.length === 0 || around.length > 2) return undefined
    let at = edit.start
    for (const annotation of around) {
      if (annotation.arms.some(arm => arm.annotations.length > 0)) return undefined
      if (at === annotation.range.start || at === annotation.range.end) continue
      const first = annotation.arms[0]
      const last = annotation.arms.at(-1)
      if (around.length !== 1 || first === undefined || last === undefined || annotation.arms.some(arm => arm.name === 'comment')) return undefined
      // At its first text's start the break moves before the suggestion, at
      // its last text's end after it; between its texts it stays.
      if (at === first.range.start && first.range.start === annotation.range.start + 3) {
        at = annotation.range.start
      } else if (at === last.range.end && last.range.end === annotation.range.end - 3) {
        at = annotation.range.end
      } else if (!annotation.arms.some(arm => arm.range.start <= at && at <= arm.range.end)) return undefined
    }
    const planned = Object.freeze({ start: at, end: at, insert: edit.insert })
    const candidate = regionalCandidate(state, planned)
    if (candidate?.structural === undefined || candidate.structural.markerDelta !== 0) return undefined
    const shift = candidate.sourceStart
    const roots = candidate.nextProducts.retainedIntrinsic?.roots ?? []
    const grown = planned.insert.length
    return around.every(annotation => roots.some(node => node.kind === annotation.kind &&
      node.range.start === annotation.range.start + (annotation.range.start >= at ? grown : 0) - shift &&
      node.range.end === annotation.range.end + (annotation.range.end > at || annotation.range.start >= at ? grown : 0) - shift))
      ? planned
      : undefined
  }

  /**
   * Untracked words typed, or text struck, beside suggestions that the edit
   * only abuts stay exactly as written, as the ordinary compiler writes
   * them; the reparsed paragraphs prove those suggestions unchanged.
   */
  const regionalUntrackedBeside = (
    state: RevisionState,
    previous: DocumentRevision,
    edit: DocumentSourceEdit
  ): DocumentSourceEdit | undefined => {
    const words = /^[\p{L}\p{N} .,;:'"?!()]+$/u
    if (plansFromDocumentParse(core) || (edit.start === edit.end
      ? !words.test(edit.insert)
      : edit.insert !== '' ||
        !words.test(core.sourceSlice(previous, edit))) || !plainParagraphAround(previous, edit.start, false)) return undefined
    const around = markupAnnotations(rootsAround(previous, edit.start)).filter(annotation =>
      annotation.range.start <= edit.end && edit.start <= annotation.range.end)
    if (around.length === 0 || around.some(annotation => annotation.range.end !== edit.start && annotation.range.start !== edit.end)) return undefined
    const planned = Object.freeze({ ...edit })
    const candidate = regionalCandidate(state, planned)
    return candidate !== undefined && (candidate.structural?.markerDelta ?? 0) === 0 &&
      neighboursUnchanged(candidate.nextProducts.retainedIntrinsic?.roots ?? [], candidate.sourceStart, around, planned)
      ? planned
      : undefined
  }

  /**
   * An untracked Backspace or Delete of the whole text of an Addition,
   * Deletion or Highlight removes it, as the ordinary compiler removes an
   * emptied suggestion; the reparsed paragraphs prove nothing else changes.
   */
  const regionalUntrackedEmptied = (
    state: RevisionState,
    previous: DocumentRevision,
    edit: DocumentSourceEdit
  ): DocumentSourceEdit | undefined => {
    if (plansFromDocumentParse(core) || edit.insert !== '' || edit.start >= edit.end) return undefined
    const owner = markupAnnotations(rootsAround(previous, edit.start)).find(annotation =>
      annotation.range.start < edit.start && edit.end < annotation.range.end)
    // Emptying one of a Substitution's texts keeps it, with that text empty.
    if (owner?.kind === 'substitution') {
      const arm = owner.arms.find(item => item.range.start === edit.start && item.range.end === edit.end)
      if (arm === undefined || owner.arms.length !== 2 || owner.arms.some(item => item.annotations.length !== 0) ||
          !/^[\p{L}\p{N} .,;:'"?!()]+$/u.test(core.sourceSlice(previous, edit))) return undefined
      const emptied = Object.freeze({ ...edit })
      const candidate = regionalCandidate(state, emptied)
      const root = candidate?.nextProducts.retainedIntrinsic?.roots.find(node => node.range.start === owner.range.start - candidate.sourceStart)
      return candidate !== undefined && root?.kind === 'substitution' && root.arms.length === 2 &&
        root.range.end === owner.range.end - (edit.end - edit.start) - candidate.sourceStart
        ? emptied
        : undefined
    }
    const text = owner?.arms[0]
    if (owner === undefined || text === undefined || owner.arms.length !== 1 || text.annotations.length !== 0 ||
        !['addition', 'deletion', 'highlight'].includes(owner.kind) ||
        text.range.start !== edit.start || text.range.end !== edit.end ||
        text.range.start !== owner.range.start + 3 || text.range.end !== owner.range.end - 3 ||
        !/^[\p{L}\p{N} .,;:'"?!()]+$/u.test(core.sourceSlice(previous, edit))) return undefined
    const abutting = markupAnnotations(rootsAround(previous, owner.range.start)).filter(annotation => annotation !== owner &&
      (annotation.range.end === owner.range.start || annotation.range.start === owner.range.end))
    if (abutting.length > 0) return undefined
    const removal = Object.freeze({ start: owner.range.start, end: owner.range.end, insert: '' })
    const candidate = regionalCandidate(state, removal)
    return candidate?.structural !== undefined && candidate.structural.markerDelta === -2 ? removal : undefined
  }

  /**
   * Plain words typed away from every suggestion become one Addition. Its
   * source accepts to the untracked text and rejects to the previous text;
   * the general planner's whole-document preview only proves the Addition
   * is recognized as written, which the reparsed paragraphs prove here: the
   * new markers pair with each other and change no other suggestion.
   */
  const regionalTrackedInsertion = (
    state: RevisionState,
    previous: DocumentRevision,
    edit: DocumentSourceEdit
  ): DocumentSourceEdit | undefined => {
    if (edit.start !== edit.end || !/^[\p{L}\p{N}][\p{L}\p{N} ]*$/u.test(edit.insert)) return undefined
    const around = markupAnnotations(rootsAround(previous, edit.start)).filter(annotation =>
      annotation.range.start <= edit.start && edit.start <= annotation.range.end)
    // Beside a Highlight or Comment, or inside a Highlight's text, words
    // typed are an Addition of their own, as away from every suggestion.
    const placement = around.length === 0 ? { beside: [], host: undefined } : newAdditionPlacement(previous, edit.start, around, false)
    if (placement === undefined) return undefined
    // Words typed inside a fence or math block are its text, and so are an
    // Addition's markers there.
    const typed = payloadCandidate?.state === state && payloadCandidate.edit === edit ? payloadCandidate.candidate : undefined
    if (typed !== undefined && typed.arm === undefined && !('literal' in typed && typed.literal !== undefined) &&
        plainLiteralBlockHolding(typed.nextProducts, typed.nextWindow, edit.start - typed.sourceStart,
          edit.start - typed.sourceStart + edit.insert.length) !== undefined) return undefined
    const insert = `{++${edit.insert}++}`
    const planned = Object.freeze({ start: edit.start, end: edit.start, insert })
    const candidate = regionalCandidate(state, planned)
    if (
      candidate?.structural === undefined || (around.length === 0 && candidate.structural.touchesAnnotation) ||
      candidate.structural.markerDelta !== 2
    ) {
      return undefined
    }
    const local = edit.start - candidate.sourceStart
    const siblings = placedAdditionSiblings(candidate, placement, planned)
    const root = siblings?.find(node => node.range.start === local)
    const arm = root?.arms[0]
    return root?.kind === 'addition' && root.range.end === local + insert.length && arm !== undefined &&
      arm.children.length === 0 && arm.range.start === local + 3 && arm.range.end === local + 3 + edit.insert.length
      ? Object.freeze({ ...edit, insert })
      : undefined
  }

  /**
   * Plain words typed at the edge of one's own Addition or Substitution,
   * outside its text or inside its hidden delimiters, join its new text, as
   * the general compiler writes them: before its text they begin it, after
   * its text they end it. The reparsed paragraphs prove the suggestion is
   * recognized with the words and no other suggestion changes.
   */
  /**
   * The root annotations of the blocks around `position` and the root after
   * them. A revision reached regionally reads them from its inventory's
   * nearby blocks instead of materializing every annotation.
   */
  const rootsAround = (revision: DocumentRevision, position: number): readonly CriticMarkupAnnotation[] => {
    const state = stateByRevision.get(revision)
    return state?.kind === 'regional' && state.regionalInventory !== undefined
      ? materializeRegionalInventoryAnnotationsAround(state.regionalInventory, position) as readonly CriticMarkupAnnotation[]
      : revision.annotations
  }

  /** The root annotations of the blocks `range` touches, read the same way. */
  const rootsOverlapping = (revision: DocumentRevision, range: SourceRange): readonly CriticMarkupAnnotation[] => {
    const state = stateByRevision.get(revision)
    return state?.kind === 'regional' && state.regionalInventory !== undefined
      ? materializeRegionalInventoryAnnotationsIn(state.regionalInventory, range.start, range.end) as readonly CriticMarkupAnnotation[]
      : revision.annotations
  }

  const regionalTrackedArmEdge = (
    state: RevisionState,
    previous: DocumentRevision,
    edit: DocumentSourceEdit
  ): DocumentSourceEdit | undefined => {
    if (plansFromDocumentParse(core) || edit.start !== edit.end || !/^[\p{L}\p{N}][\p{L}\p{N} ]*$/u.test(edit.insert)) return undefined
    const at = edit.start
    const around = markupAnnotations(rootsAround(previous, at)).filter(annotation =>
      annotation.range.start <= at && at <= annotation.range.end)
    // A Deletion on the other side of the caret stays as it is.
    const besideDeletion = around.length === 2
      ? around.filter(annotation => annotation.kind === 'deletion' && (annotation.range.end === at || annotation.range.start === at))
      : []
    const touching = around.filter(annotation => !besideDeletion.includes(annotation))
    const owner = touching[0]
    if (touching.length !== 1 || owner === undefined || !plainParagraphAround(previous, at, false) ||
        besideDeletion.length > 0 && owner.range.start !== at && owner.range.end !== at) return undefined
    const text = owner.arms.find(arm => arm.name === (owner.kind === 'addition' ? 'content' : 'new'))
    const history = owner.kind === 'substitution' ? owner.arms.find(arm => arm.name === 'old') : undefined
    if ((owner.kind !== 'addition' && owner.kind !== 'substitution') || text === undefined || text.range.start === text.range.end ||
        owner.arms.some(arm => arm.annotations.length > 0) || (owner.kind === 'substitution' && history === undefined)) return undefined
    // Words join words: a suggestion whose text is a break or other
    // syntax keeps the general compiler's decision.
    if (owner.arms.some(arm => !/^[\p{L}\p{N} .,;:'"?!()]*$/u.test(core.sourceSlice(previous, arm.range))) ||
        !/[\p{L}\p{N}]/u.test(core.sourceSlice(previous, text.range))) return undefined
    // Before the text: the opener, and for a Substitution its whole old text.
    const leading = history === undefined
      ? at <= text.range.start
      : at <= history.range.start || (history.range.end <= at && at <= text.range.start)
    const target = leading ? text.range.start : text.range.end <= at ? text.range.end : undefined
    if (target === undefined || (target === at && at > owner.range.start && at < owner.range.end)) return undefined
    const planned = Object.freeze({ start: target, end: target, insert: edit.insert })
    const candidate = regionalCandidate(state, planned)
    // A region of the same shape keeps its markers.
    // The region's diagnostics move with it unchanged.
    if (candidate === undefined || (candidate.structural?.markerDelta ?? 0) !== 0) return undefined
    const shift = candidate.sourceStart
    const grown = edit.insert.length
    const roots = candidate.nextProducts.retainedIntrinsic?.roots ?? []
    const root = roots.find(node => node.range.start === owner.range.start - shift)
    if (root?.kind !== owner.kind || root.range.end !== owner.range.end + grown - shift || root.arms.length !== owner.arms.length ||
        !neighboursUnchanged(roots, shift, besideDeletion, planned)) return undefined
    return owner.arms.every((arm, index) => {
      const next = root.arms[index]
      const start = arm.range.start + (arm !== text && arm.range.start >= target ? grown : 0)
      const end = arm.range.end + (arm === text || arm.range.end > target ? grown : 0)
      return next !== undefined && next.children.length === 0 && next.range.start === start - shift && next.range.end === end - shift
    })
      ? planned
      : undefined
  }

  /**
   * A tracked paragraph or line break, proved by reparsing the paragraphs it
   * changes instead of previewing the document: inside an Addition's text,
   * or at the end of one whose last text the caret follows, the break
   * extends that Addition; away from every suggestion it is a new Addition.
   * The window proves the result is recognized as written and changes no
   * other suggestion, so accepting it is the untracked break and rejecting
   * it restores the previous text.
   */
  /** Whether `range` spans a whole block: blank lines or the document's ends lie around it. */
  const wholeBlock = (revision: DocumentRevision, range: SourceRange): boolean => {
    const from = Math.max(0, range.start - 256)
    const to = Math.min(revision.sourceLength, range.end + 256)
    const before = core.sourceSlice(revision, { start: from, end: range.start })
    const after = core.sourceSlice(revision, { start: range.end, end: to })
    const opens = (from === 0 && /^\s*$/u.test(before)) || /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)[ \t]*$/u.test(before)
    const closes = (to === revision.sourceLength && /^\s*$/u.test(after)) || /^[ \t]*(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/u.test(after)
    return opens && closes
  }

  /**
   * Where a paragraph break typed at `edit` goes and what it extends: Enter
   * before an Addition's opener begins its text and Enter after its closer
   * continues it where its text reaches the closer, so either extends the
   * Addition; elsewhere the break stands where it was typed. Undefined where
   * the break meets suggestions the tracked planners spell otherwise.
   */
  const trackedBreakTarget = (
    state: RevisionState,
    previous: DocumentRevision,
    edit: DocumentSourceEdit
  ): Readonly<{
    at: number
    owner: CriticMarkupAnnotation | undefined
    arm: CriticMarkupArm | undefined
    around: readonly CriticMarkupAnnotation[]
    beside: readonly CriticMarkupAnnotation[]
    placement: ReturnType<typeof newAdditionPlacement>
    opened: CriticMarkupAnnotation | undefined
  }> | undefined => {
    const around = markupAnnotations(rootsAround(previous, edit.start)).filter(annotation =>
      annotation.range.start <= edit.start && edit.start <= annotation.range.end)
    // A break at a Highlight's text start is an Addition before it.
    const opened = around.length === 1 && around[0]?.kind === 'highlight' && around[0].range.start < edit.start &&
      around[0].arms[0]?.range.start === edit.start
      ? around[0]
      : undefined
    if (opened !== undefined) return { at: edit.start, owner: undefined, arm: undefined, around, beside: [], placement: undefined, opened }
    // A break beside a Deletion is an Addition of its own, as away from
    // every suggestion.
    const besideDeletions = around.filter(annotation => annotation.kind === 'deletion' &&
      (annotation.range.end === edit.start || annotation.range.start === edit.start))
    // A Deletion of a whole block removes that block from the Revised view,
    // where the blocks on either side then meet, as two lists join into one
    // around an added blank line; only the document planner reads them.
    if (besideDeletions.some(deletion => wholeBlock(previous, deletion.range))) return undefined
    const rest = around.filter(annotation => !besideDeletions.includes(annotation))
    // So is one beside a Highlight or after a Comment, or inside a
    // Highlight's text, where it is nested.
    const placement = rest.length > 0 && rest.every(annotation => annotation.kind === 'highlight' || annotation.kind === 'comment')
      ? newAdditionPlacement(previous, edit.start, rest, true)
      : undefined
    const beside = [...besideDeletions, ...(placement?.beside ?? [])]
    const touching = around.filter(annotation => !beside.includes(annotation) && annotation !== placement?.host)
    const owner = touching[0]
    if (touching.length > 1 || owner !== undefined && owner.kind !== 'addition') return undefined
    const arm = owner?.arms[0]
    let at = edit.start
    if (owner !== undefined) {
      if (arm === undefined || owner.arms.length !== 1 || arm.annotations.length !== 0 ||
          core.sourceSlice(previous, arm.range).includes('\\')) return undefined
      // Enter before the opener begins the Addition's text.
      if (at === owner.range.start) {
        if (arm.range.start !== owner.range.start + 3 || arm.range.start === arm.range.end) return undefined
        at = arm.range.start
      } else if (at === owner.range.end) {
        // Enter after the closer continues the Addition only where its text
        // reaches the closer, as exterior typing does.
        const syntax = regionalInputSyntax(state, { start: arm.range.end, end: arm.range.end })
        if (syntax === undefined || arm.range.start === arm.range.end) return undefined
        const edge = syntax.coordinates.toProjected(arm.range.end, 'previous')
        const reaches = (node: MarkdownAstNode): boolean => {
          if (node.range.start >= edge || node.range.end < edge) return false
          if (node.kind === 'text') {
            return syntax.coordinates.toSource(node.range.start, 'next') < arm.range.end &&
              syntax.coordinates.toSource(node.range.end, 'previous') > arm.range.start
          }
          // Literal spans reaching the edge keep the full planner.
          if (['inline-code', 'inline-math', 'inline-html', 'autolink', 'image', 'footnote-reference'].includes(node.kind)) return false
          return node.children.some(reaches)
        }
        if (!reaches(syntax.ast.root)) return undefined
        at = arm.range.end
      } else if (at < arm.range.start || at > arm.range.end) {
        return undefined
      }
    }
    return { at, owner, arm, around, beside, placement, opened: undefined }
  }

  const regionalTrackedBreak = (
    state: RevisionState,
    previous: DocumentRevision,
    edit: DocumentSourceEdit
  ): DocumentSourceEdit | undefined => {
    if (plansFromDocumentParse(core) || edit.start !== edit.end || !/^(?:\r\n|\r|\n)+$/u.test(edit.insert)) return undefined
    const target = trackedBreakTarget(state, previous, edit)
    if (target === undefined) return undefined
    const { at, owner, arm, around, beside, placement, opened } = target
    if (opened !== undefined) {
      return regionalTrackedBreak(state, previous, Object.freeze({ ...edit, start: opened.range.start, end: opened.range.start }))
    }
    if (!plainParagraphAround(previous, at)) return undefined
    const planned = Object.freeze({ start: at, end: at, insert: owner === undefined ? `{++${edit.insert}++}` : edit.insert })
    const candidate = regionalCandidate(state, planned)
    if (candidate?.structural === undefined) return undefined
    const shift = candidate.sourceStart
    const roots = candidate.nextProducts.retainedIntrinsic?.roots ?? []
    if (owner === undefined) {
      if ((around.length === 0 && candidate.structural.touchesAnnotation) || candidate.structural.markerDelta !== 2) return undefined
      const siblings = placedAdditionSiblings(candidate, { beside, host: placement?.host }, planned)
      const local = at - shift
      const root = siblings?.find(node => node.range.start === local)
      const content = root?.arms[0]
      return root?.kind === 'addition' && root.arms.length === 1 && root.range.end === local + planned.insert.length &&
        content !== undefined && content.children.length === 0 &&
        content.range.start === local + 3 && content.range.end === local + 3 + edit.insert.length
        ? planned
        : undefined
    }
    if (candidate.structural.markerDelta !== 0 || arm === undefined) return undefined
    const grown = edit.insert.length
    const root = roots.find(node => node.range.start === owner.range.start - shift)
    const content = root?.arms[0]
    return root?.kind === 'addition' && root.arms.length === 1 && root.range.end === owner.range.end + grown - shift &&
      content !== undefined && content.children.length === 0 &&
      content.range.start === arm.range.start - shift && content.range.end === arm.range.end + grown - shift
      ? planned
      : undefined
  }

  /**
   * A tracked join of two paragraphs, away from every suggestion, proved by
   * reparsing them: the removed break becomes a new Deletion. The window
   * proves the Deletion is recognized as written and changes no other
   * suggestion, and the text on both sides is plain, as for a tracked break.
   */
  const regionalTrackedJoin = (
    state: RevisionState,
    previous: DocumentRevision,
    edit: DocumentSourceEdit
  ): DocumentSourceEdit | undefined => {
    if (plansFromDocumentParse(core) || edit.insert !== '' || edit.start >= edit.end) return undefined
    const removed = core.sourceSlice(previous, edit)
    if (!/^(?:\r\n|\r|\n)+$/u.test(removed) ||
        markupAnnotations(rootsAround(previous, edit.start)).some(annotation =>
          annotation.range.start <= edit.end && edit.start <= annotation.range.end) ||
        !plainParagraphAround(previous, edit.start) || !plainParagraphAround(previous, edit.end)) return undefined
    const planned = Object.freeze({ start: edit.start, end: edit.end, insert: `{--${removed}--}` })
    const candidate = regionalCandidate(state, planned)
    if (candidate?.structural === undefined || candidate.structural.touchesAnnotation ||
        candidate.structural.markerDelta !== 2) return undefined
    const local = edit.start - candidate.sourceStart
    const root = candidate.nextProducts.retainedIntrinsic?.roots.find(node => node.range.start === local)
    const content = root?.arms[0]
    return root?.kind === 'deletion' && root.arms.length === 1 && root.range.end === local + planned.insert.length &&
      content !== undefined && content.children.length === 0 &&
      content.range.start === local + 3 && content.range.end === local + 3 + removed.length
      ? planned
      : undefined
  }

  /**
   * Backspace or Delete over plain words, proved by reparsing the paragraphs
   * they are in: away from every suggestion the struck text becomes a new
   * Deletion, and beside a Deletion that it reaches it joins that Deletion,
   * as the general compiler merges them. The window proves the result is
   * recognized as written and changes no other suggestion.
   */
  /**
   * Text struck between two suggestions, as the general compiler merges it:
   * into a Deletion before it, a Deletion or Substitution after it, or both
   * at once, and otherwise as a Deletion of its own beside them. The window
   * proves the merged suggestion is recognized with the struck text in its
   * deleted text, and that a suggestion it does not merge with is unchanged.
   */
  const regionalTrackedDeletionBetween = (
    state: RevisionState,
    previous: DocumentRevision,
    edit: DocumentSourceEdit,
    removed: string,
    touching: readonly CriticMarkupAnnotation[]
  ): DocumentSourceEdit | undefined => {
    if (trackedPartsSeparate(core)) return undefined
    const left = touching.find(annotation => annotation.range.end === edit.start && annotation.range.start < edit.start)
    const right = touching.find(annotation => annotation.range.start === edit.end && annotation.range.end > edit.end)
    if (left === undefined || right === undefined || left === right) return undefined
    const words = /^[\p{L}\p{N} .,;:'"?!()]*$/u
    const deleted = (annotation: CriticMarkupAnnotation, kinds: readonly string[]) => {
      if (!kinds.includes(annotation.kind)) return undefined
      const arm = annotation.arms[0]
      const arms = annotation.kind === 'substitution' ? 2 : 1
      return arm !== undefined && annotation.arms.length === arms && annotation.arms.every(item => item.annotations.length === 0) &&
        arm.range.start === annotation.range.start + 3 && (arms === 2 || arm.range.end === annotation.range.end - 3) &&
        words.test(core.sourceSlice(previous, arm.range))
        ? arm
        : undefined
    }
    const leftText = deleted(left, ['deletion'])
    const rightText = deleted(right, ['deletion', 'substitution'])
    if (left.kind === 'deletion' && leftText === undefined || (right.kind === 'deletion' || right.kind === 'substitution') && rightText === undefined) return undefined
    const leftStruck = leftText === undefined ? '' : core.sourceSlice(previous, leftText.range)
    let planned: DocumentSourceEdit
    let merged: Readonly<{ kind: CriticMarkupAnnotation['kind'], start: number, end: number, text: string }>
    const unchanged: CriticMarkupAnnotation[] = []
    if (leftText !== undefined && rightText !== undefined) {
      const rightStruck = core.sourceSlice(previous, rightText.range)
      planned = right.kind === 'deletion'
        ? { start: leftText.range.end, end: rightText.range.start, insert: removed }
        : { start: left.range.start, end: rightText.range.start, insert: `{~~${leftStruck}${removed}` }
      merged = { kind: right.kind, start: left.range.start, end: right.range.end, text: leftStruck + removed + rightStruck }
    } else if (leftText !== undefined) {
      planned = { start: leftText.range.end, end: edit.end, insert: `${removed}--}` }
      merged = { kind: 'deletion', start: left.range.start, end: edit.end, text: leftStruck + removed }
      unchanged.push(right)
    } else if (rightText !== undefined) {
      planned = { start: edit.start, end: rightText.range.start, insert: `${right.kind === 'substitution' ? '{~~' : '{--'}${removed}` }
      merged = { kind: right.kind, start: edit.start, end: right.range.end, text: removed + core.sourceSlice(previous, rightText.range) }
      unchanged.push(left)
    } else {
      planned = { start: edit.start, end: edit.end, insert: `{--${removed}--}` }
      merged = { kind: 'deletion', start: edit.start, end: edit.end, text: removed }
      unchanged.push(left, right)
    }
    planned = Object.freeze(planned)
    const shift = planned.insert.length - (planned.end - planned.start)
    const candidate = regionalCandidate(state, planned)
    if (candidate?.structural === undefined) return undefined
    const local = candidate.sourceStart
    const roots = candidate.nextProducts.retainedIntrinsic?.roots ?? []
    if (!neighboursUnchanged(roots, local, unchanged, planned)) return undefined
    const root = roots.find(node => node.range.start === merged.start - local)
    const text = root?.arms[0]
    return root?.kind === merged.kind && root.range.end === merged.end + shift - local && text !== undefined &&
      root.arms.every(arm => arm.children.length === 0) &&
      candidate.nextWindow.slice(text.range.start, text.range.end) === merged.text &&
      (merged.kind !== 'substitution' || root.arms.length === 2)
      ? planned
      : undefined
  }

  const regionalTrackedDeletion = (
    state: RevisionState,
    previous: DocumentRevision,
    edit: DocumentSourceEdit
  ): DocumentSourceEdit | undefined => {
    if (plansFromDocumentParse(core) || edit.insert !== '' || edit.start >= edit.end) return undefined
    const removed = core.sourceSlice(previous, edit)
    if (!/^[\p{L}\p{N} .,;:'"?!()]+$/u.test(removed) ||
        !plainParagraphAround(previous, edit.start, false)) return undefined
    const touching = markupAnnotations(rootsAround(previous, edit.start)).filter(annotation =>
      annotation.range.start <= edit.end && edit.start <= annotation.range.end)
    if (touching.length === 2) return regionalTrackedDeletionBetween(state, previous, edit, removed, touching)
    if (touching.length > 1) return undefined
    // Parts of one edit keep to the general compiler, which keeps them apart.
    if (trackedPartsSeparate(core) && touching[0] !== undefined && touching[0].kind !== 'deletion') return undefined
    // Text struck right after an Addition, Substitution, Highlight or Comment,
    // or right before one of them other than a Substitution (whose old text
    // it joins), is a Deletion of its own, as the general compiler strikes it.
    const beside = touching[0] !== undefined && touching[0].kind !== 'deletion' &&
      (touching[0].range.end === edit.start ||
        touching[0].range.start === edit.end && touching[0].kind !== 'substitution')
    const owner = beside ? undefined : touching[0]
    // Striking the last of one's own Addition's text removes the Addition.
    const emptied = owner?.kind === 'addition' ? owner : undefined
    if (emptied !== undefined) {
      const text = emptied.arms[0]
      if (text === undefined || emptied.arms.length !== 1 || text.annotations.length !== 0 ||
          text.range.start !== edit.start || text.range.end !== edit.end) return undefined
      const abutting = markupAnnotations(rootsAround(previous, emptied.range.start)).filter(annotation => annotation !== emptied &&
        (annotation.range.end === emptied.range.start || annotation.range.start === emptied.range.end))
      if (abutting.length > 1 || abutting.some(annotation => annotation.kind !== 'deletion')) return undefined
      const removal = Object.freeze({ start: emptied.range.start, end: emptied.range.end, insert: '' })
      const candidate = regionalCandidate(state, removal)
      return candidate?.structural !== undefined && candidate.structural.markerDelta === -2 &&
        neighboursUnchanged(candidate.nextProducts.retainedIntrinsic?.roots ?? [], candidate.sourceStart, abutting, removal)
        ? removal
        : undefined
    }
    // Striking the whole of one's own Substitution's new text leaves its old
    // text as a Deletion.
    const proposal = owner?.kind === 'substitution' ? owner.arms[1] : undefined
    if (owner !== undefined && proposal !== undefined && proposal.range.start === edit.start && proposal.range.end === edit.end) {
      const old = owner.arms[0]
      if (old === undefined || owner.arms.length !== 2 || old.annotations.length !== 0 || proposal.annotations.length !== 0 ||
          old.range.start !== owner.range.start + 3 || proposal.range.end !== owner.range.end - 3) return undefined
      const struck = core.sourceSlice(previous, old.range)
      if (!/^[\p{L}\p{N} .,;:'"?!()]+$/u.test(struck)) return undefined
      const withdrawn = Object.freeze({ start: owner.range.start, end: owner.range.end, insert: `{--${struck}--}` })
      const candidate = regionalCandidate(state, withdrawn)
      const root = candidate?.nextProducts.retainedIntrinsic?.roots.find(node => node.range.start === owner.range.start - candidate.sourceStart)
      return candidate?.structural !== undefined && root?.kind === 'deletion' &&
        root.range.end === owner.range.start + withdrawn.insert.length - candidate.sourceStart
        ? withdrawn
        : undefined
    }
    // Text struck right before a Substitution joins its old text.
    const joined = owner?.kind === 'substitution' && owner.range.start === edit.end ? owner : undefined
    if (joined !== undefined) {
      const [old, proposed] = joined.arms
      if (old === undefined || proposed === undefined || joined.arms.length !== 2 || old.annotations.length !== 0 ||
          proposed.annotations.length !== 0 || old.range.start !== joined.range.start + 3) return undefined
      const join = Object.freeze({ start: edit.start, end: old.range.start, insert: `{~~${removed}` })
      const candidate = regionalCandidate(state, join)
      if (candidate?.structural === undefined || candidate.structural.markerDelta !== 0) return undefined
      const shift = candidate.sourceStart
      const root = candidate.nextProducts.retainedIntrinsic?.roots.find(node => node.range.start === edit.start - shift)
      const [oldArm, newArm] = root?.arms ?? []
      return root?.kind === 'substitution' && root.arms.length === 2 && root.range.end === joined.range.end - shift &&
        oldArm !== undefined && newArm !== undefined && oldArm.children.length === 0 && newArm.children.length === 0 &&
        oldArm.range.start === edit.start + 3 - shift && oldArm.range.end === old.range.end - shift &&
        newArm.range.start === proposed.range.start - shift && newArm.range.end === proposed.range.end - shift
        ? join
        : undefined
    }
    // Text struck inside a Highlight's text is a Deletion nested in it.
    const highlighted = owner?.kind === 'highlight' && owner.arms.length === 1 &&
      owner.arms[0] !== undefined && owner.arms[0].annotations.length === 0 &&
      owner.arms[0].range.start <= edit.start && edit.end <= owner.arms[0].range.end
      ? owner
      : undefined
    let planned: DocumentSourceEdit
    let expected: Readonly<{ start: number, end: number, content: SourceRange }>
    if (owner === undefined || highlighted !== undefined) {
      planned = Object.freeze({ start: edit.start, end: edit.end, insert: `{--${removed}--}` })
      expected = { start: edit.start, end: edit.start + planned.insert.length, content: { start: edit.start + 3, end: edit.end + 3 } }
    } else {
      const content = owner.arms[0]
      // Parts of one edit across deleted text stay separate suggestions.
      if (trackedPartsSeparate(core) || owner.kind !== 'deletion' || owner.arms.length !== 1 || content === undefined || content.annotations.length !== 0 ||
          content.range.start !== owner.range.start + 3 || content.range.end !== owner.range.end - 3) return undefined
      if (owner.range.start === edit.end) {
        // Backspace before a Deletion strikes the text into it.
        planned = Object.freeze({ start: edit.start, end: content.range.start, insert: `{--${removed}` })
        expected = { start: edit.start, end: owner.range.end, content: { start: edit.start + 3, end: content.range.end } }
      } else if (owner.range.end === edit.start) {
        // Delete after a Deletion strikes the text into it.
        planned = Object.freeze({ start: content.range.end, end: edit.end, insert: `${removed}--}` })
        expected = { start: owner.range.start, end: edit.end, content: { start: content.range.start, end: edit.end - 3 } }
      } else return undefined
    }
    const candidate = regionalCandidate(state, planned)
    if (candidate?.structural === undefined ||
        candidate.structural.markerDelta !== (owner === undefined || highlighted !== undefined ? 2 : 0) ||
        (owner === undefined && !beside && candidate.structural.touchesAnnotation)) return undefined
    const shift = candidate.sourceStart
    let siblings = candidate.nextProducts.retainedIntrinsic?.roots ?? []
    // The suggestion beside the new Deletion stays as it was.
    if (beside && !neighboursUnchanged(siblings, shift, touching, planned)) return undefined
    if (highlighted !== undefined) {
      const text = highlighted.arms[0]
      const host = siblings.find(node => node.range.start === highlighted.range.start - shift)
      const hostText = host?.arms[0]
      if (host?.kind !== 'highlight' || host.arms.length !== 1 || text === undefined || hostText === undefined ||
          host.range.end !== highlighted.range.end + 6 - shift || hostText.children.length !== 1 ||
          hostText.range.start !== text.range.start - shift || hostText.range.end !== text.range.end + 6 - shift) return undefined
      siblings = hostText.children
    }
    const root = siblings.find(node => node.range.start === expected.start - shift)
    const content = root?.arms[0]
    return root?.kind === 'deletion' && root.arms.length === 1 && root.range.end === expected.end - shift &&
      content !== undefined && content.children.length === 0 &&
      content.range.start === expected.content.start - shift && content.range.end === expected.content.end - shift
      ? planned
      : undefined
  }

  /**
   * Whether the paragraph text around `at` is words and plain punctuation,
   * apart from CriticMarkup delimiters, and, for a break, the line it starts
   * begins with a letter: no Markdown delimiter there can pair across the
   * edit, and no block marker can begin the new line, differently in a
   * suggestion than in untracked text.
   */
  const plainParagraphAround = (previous: DocumentRevision, at: number, breaking = true): boolean => {
    const reach = 4096
    const blank = /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/gu
    const before = core.sourceSlice(previous, { start: Math.max(0, at - reach), end: at })
    const after = core.sourceSlice(previous, { start: at, end: Math.min(previous.sourceLength, at + reach) })
    const opening = [...before.matchAll(blank)].at(-1)
    const closing = after.search(blank)
    if (opening === undefined && at > reach || closing < 0 && previous.sourceLength - at > reach) return false
    const text = before.slice(opening === undefined ? 0 : opening.index + opening[0].length) +
      after.slice(0, closing < 0 ? after.length : closing)
    // Lines indented four columns or more that open a block are indented
    // code, not a paragraph; a line opening with a number and `.` or `)` is
    // an ordered list item.
    if (/^(?: {4}|\t| {0,3}\t)/u.test(text) || /(?:^|[\r\n]) {0,3}\d{1,9}[.)](?:[ \t]|[\r\n]|$)/u.test(text)) return false
    return /^[\p{L}\p{N} \t\r\n.,;:'"?!()]*$/u.test(text.replace(CRITIC_MARKER, '')) &&
      (!breaking || /^[ \t]*(?:\+\+\}|~~\})?(?:\{(?:\+\+|--|==)\p{L}[^{}\r\n]*(?:\+\+|--|==)\}|\{~~\p{L}[^{}\r\n]*~~\}|\{>>[^{}\r\n]*<<\})*[ \t]*(?:\p{L}|[.,;:'"?!()]|\r|\n|$)/u.test(after))
  }

  const resolutionEdit = (
    previousState: RevisionState,
    annotation: CriticMarkupAnnotation,
    decision: DocumentResolutionDecision
  ): DocumentSourceEdit => {
    if (decision !== 'accept' && decision !== 'reject') {
      throw new TypeError('Document resolution decision is malformed')
    }

    const pending = [...previousState.annotations()].reverse()
    let owned = false
    while (pending.length > 0) {
      const candidate = pending.pop()
      if (candidate === undefined) break
      if (candidate === annotation) {
        owned = true
        break
      }
      for (let armIndex = candidate.arms.length - 1; armIndex >= 0; armIndex -= 1) {
        const arm = candidate.arms[armIndex]
        if (arm === undefined) continue
        for (
          let childIndex = arm.annotations.length - 1;
          childIndex >= 0;
          childIndex -= 1
        ) {
          const child = arm.annotations[childIndex]
          if (child !== undefined) pending.push(child)
        }
      }
    }
    if (!owned) {
      throw new TypeError('Document annotation does not belong to this revision')
    }

    const armSource = (name: CriticMarkupArm['name']): string => {
      const arm = annotation.arms.find(candidate => candidate.name === name)
      if (arm === undefined) {
        throw new Error(`Document annotation is missing its ${name} arm`)
      }
      return previousState.source.slice(arm.range.start, arm.range.end)
    }
    let insert: string
    switch (annotation.kind) {
      case 'addition':
        insert = decision === 'accept' ? armSource('content') : ''
        break
      case 'deletion':
        insert = decision === 'accept' ? '' : armSource('content')
        break
      case 'substitution':
        insert = armSource(decision === 'accept' ? 'new' : 'old')
        break
      case 'highlight':
        insert = armSource('content')
        break
      case 'comment':
        insert = ''
        break
    }
    return Object.freeze({
      start: annotation.range.start,
      end: annotation.range.end,
      insert
    })
  }

  /**
   * The blocks around `reach` with a block of context on each side, cut from
   * the revision's inventory, or at the safe points of the parse it holds.
   * `inPlace` is their parse in place when it proves they read there as in
   * the document; `roots` counts the document's root annotations,
   * `definitions` are its reference and footnote definitions when known, and
   * `strayLocal` tells whether replacing the window keeps every marker
   * reading outside it (see strayMarkersStayLocal()).
   */
  const windowFrame = (state: RevisionState, reach: SourceRange): Readonly<{
    sourceStart: number
    window: string
    inPlace?: Profile1DocumentProducts
    roots: number
    definitions: readonly SourceRange[] | undefined
    strayLocal: (nextWindow: string, nextRoots: number, nextUnfinished: boolean, escapingSeen: boolean) => boolean
    cleanStart?: true
    cleanEnd?: true
  }> | undefined => {
    const inventory = state.regionalInventory ?? convertedRegionalInventory(state)
    if (inventory !== undefined) {
      // The general compiler reads the document's own text, a literal block whole.
      const context = regionalRangeWindow(inventory, state.source, reach, executionBudget,
        state.markdownOptions, regionalPhysicalRecorder, false)
      if (context === undefined) return undefined
      const start = context.sourceStart
      const end = start + context.nextWindow.length
      return Object.freeze({
        sourceStart: start,
        window: context.nextWindow,
        ...(context.validated ? { inPlace: context.nextProducts } : {}),
        ...(context.cleanStart === true ? { cleanStart: true as const } : {}),
        ...(context.cleanEnd === true ? { cleanEnd: true as const } : {}),
        roots: regionalInventoryRootCount(inventory),
        definitions: regionalInventoryDefinitions(inventory),
        strayLocal: (nextWindow: string, nextRoots: number, nextUnfinished: boolean, escapingSeen: boolean) =>
          strayMarkersStayLocal(inventory, state.source, start, end, nextWindow, nextRoots, nextUnfinished, escapingSeen)
      })
    }
    return state.productStore.withRetained(products => {
      const retained = products.retainedIntrinsic
      // Without an inventory nothing proves stray markers stay local.
      if (retained === undefined || products.diagnostics.count !== 0) return undefined
      const points = [0, ...retained.safePoints, state.source.length]
      let first = 0
      while (first + 1 < points.length && (points[first + 1] ?? Infinity) <= reach.start) first += 1
      let last = points.length - 1
      while (last > 0 && (points[last - 1] ?? -Infinity) >= reach.end) last -= 1
      const start = points[Math.max(0, first - 1)] ?? 0
      const end = points[Math.min(points.length - 1, last + 1)] ?? state.source.length
      return Object.freeze({
        sourceStart: start,
        window: state.source.slice(start, end),
        roots: products.criticMarkup.rootCount,
        definitions: referenceDependencyPrefixEnd(products) === 0 ? Object.freeze([]) : undefined,
        strayLocal: () => true
      })
    })
  }

  /**
   * The general compiler run on the blocks around an edit, with a block of
   * context on each side, instead of on the whole document, so a key the
   * regional planners do not know costs at most the parse apply() needs.
   * The window must read as a document as its blocks read in place. Its
   * result then reads back in place: parsed regionally as apply() would, or,
   * when no region admits it but the blocks around it keep their structure
   * in the window, in one document preview that apply() reuses; either must
   * hold the suggestions and diagnostics the window compile produced and
   * leave every other one as it was. Undefined when that cannot
   * be shown, which leaves the key to the document compile; `edits` is
   * undefined when the compiler refuses the edit in a window whose blocks
   * are proven to read as in the document.
   */
  const windowedGeneralEdits = (
    state: RevisionState,
    previous: DocumentRevision,
    edits: readonly DocumentSourceEdit[],
    compile: (
      windowCore: DocumentCore,
      revision: DocumentRevision,
      edits: readonly DocumentSourceEdit[],
      preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision
    ) => readonly DocumentSourceEdit[] | undefined,
    reach?: SourceRange,
    widenings = 0,
    retried = false,
    // The compile spells tracked keys, which a window may leave to another.
    spells = false,
    // The source range of the document a tracked key changes the reading of,
    // where its spelling derives from it (see derivesSpelling).
    documentChange?: SourceRange
  ): { readonly edits: readonly DocumentSourceEdit[] | undefined } | undefined => {
    const firstEdit = edits[0]
    const lastEdit = edits.at(-1)
    if (plansFromDocumentParse(core) || windowCores.has(core) || firstEdit === undefined || lastEdit === undefined) return undefined
    const span = { start: firstEdit.start, end: lastEdit.end }
    const context = windowFrame(state, reach ?? span)
    if (context === undefined) return undefined
    const { sourceStart, window, definitions } = context
    const windowEnd = sourceStart + window.length
    // A label resolves against definitions anywhere in the document, so the
    // window document ends with the document's own; one the edit writes
    // could reach labels outside the window.
    const inserted = edits.map(edit => edit.insert).join('\n')
    if (/(?:^|[\r\n])[ \t]{0,3}\[[^\]\r\n]*\]:|\[\^/u.test(inserted)) return undefined
    const open = window.indexOf('[')
    const labels = (open !== -1 && window.indexOf(']', open + 1) !== -1) || /[[\]]/u.test(inserted)
    let windowSource = window
    if (labels && definitions?.length !== 0) {
      if (definitions === undefined ||
          definitions.some(definition => definition.start < windowEnd && definition.end > sourceStart)) return undefined
      windowSource += (/(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)$/u.test(window) ? '' : /[\r\n]$/u.test(window) ? '\n' : '\n\n') +
        definitions.map(definition => state.source.slice(definition.start, definition.end)).join('\n\n') + '\n'
    }
    if (span.start < sourceStart || span.end > windowEnd) return undefined
    // A `$$` line before the window pairs with the first `$$` after it,
    // which a key that writes, removes or reshapes a dollar run may move
    // into or out of the window: the document then reads the key.
    if (sourceStart > 0) {
      const edited = state.source.applyExact(stableSourceEdits(edits), 'Window math reach')
      if (editsMayRepairMath(state.source, edited, stableSourceEdits(edits), state.markdownOptions)) {
        const first = firstDoubleDollar(state.source)
        if (first !== -1 && first < sourceStart && !dollarsSettledBefore(state, sourceStart)) return undefined
      }
    }
    // A key whose reading change the document reads beyond this window, as
    // typing that breaks a fence reads on to the document's end, is spelled
    // in a window holding that change, without opening this one.
    if (documentChange !== undefined) {
      const inside = documentChange.start > sourceStart || (documentChange.start === sourceStart && sourceStart === 0)
      const ends = documentChange.end < windowEnd || (documentChange.end === windowEnd && windowEnd === state.source.length)
      if (!inside || !ends) {
        if (retried) return undefined
        // A block of context on either side of the change keeps a result
        // spelled over it from reaching the window's edges.
        return windowedGeneralEdits(state, previous, edits, compile, {
          start: Math.max(0, Math.min((reach ?? span).start, documentChange.start) - 1),
          end: Math.min(state.source.length, Math.max((reach ?? span).end, documentChange.end) + 1)
        }, widenings, true, spells, documentChange)
      }
    }
    const windowCore = createDocumentCoreWithExecutionBudget(executionBudget)
    windowCores.add(windowCore)
    markWindowCompileCore(windowCore, { startsDocument: sourceStart === 0, endsDocument: windowEnd === state.source.length })
    if (equivalenceDeferred(core)) deferEquivalence(windowCore)
    const { schema: _schema, ...options } = state.markdownOptions
    const opened = windowCore.open(windowSource, sourceStart === 0 ? options : { ...options, frontMatter: false })
    const within = <T extends { range: SourceRange }>(items: readonly T[], start: number, end: number): T[] =>
      items.filter(item => item.range.start >= start && item.range.end <= end)
    const straddling = (items: readonly { range: SourceRange }[], start: number, end: number): boolean =>
      items.some(item => item.range.start < end && item.range.end > start && (item.range.start < start || item.range.end > end))
    if (context.inPlace !== undefined) {
      if (!sameAnnotations(opened.annotations, 0, windowAnnotationsOf(context.inPlace).annotations, 0) ||
          !sameDiagnostics(opened.diagnostics, 0, diagnosticsOf(context.inPlace), 0)) return undefined
    } else {
      const roots = rootsOverlapping(previous, { start: sourceStart, end: windowEnd })
      const diagnostics = previous.diagnostics
      if (straddling(roots, sourceStart, windowEnd) || straddling(diagnostics, sourceStart, windowEnd) ||
          !sameAnnotations(opened.annotations, sourceStart, within(roots, sourceStart, windowEnd), 0) ||
          !sameDiagnostics(opened.diagnostics, sourceStart, within(diagnostics, sourceStart, windowEnd), 0)) return undefined
    }
    // An unfinished opener is escaped in the views of a document with
    // annotations, so the window's own must have them exactly when the
    // document does, whatever a candidate adds or removes.
    if (opened.diagnostics.some(diagnostic => diagnostic.code === 'CM_UNTERMINATED_OPENER') &&
        opened.annotations.length !== context.roots) return undefined
    const windowPreview = sourceEditPreviews.get(windowCore)
    if (windowPreview === undefined) return undefined
    // The window's blocks read the untracked edit as the document does only
    // where blank lines part them from the blocks around it: a block the
    // document runs straight into after the window could take in what the
    // edit writes at its edge.
    const lineBlank = (at: number): boolean => {
      const rest = state.source.slice(at, Math.min(state.source.length, at + 256))
      return /^[ \t]*(?:\r\n|\r|\n|$)/u.test(rest)
    }
    const lineStartOf = (at: number): number => {
      const before = state.source.slice(Math.max(0, at - 256), at)
      const newline = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'))
      return newline === -1 ? (at - 256 <= 0 ? 0 : -1) : at - before.length + newline + 1
    }
    const parted = (at: number): boolean => {
      if (at === 0 || at === state.source.length) return true
      const start = lineStartOf(at)
      if (start === -1) return false
      if (start !== at) return lineBlank(start)
      const previousStart = lineStartOf(at - 1 - (state.source.slice(at - 2, at) === '\r\n' ? 1 : 0))
      return lineBlank(at) || (previousStart !== -1 && previousStart < at && lineBlank(previousStart))
    }
    const blocksAround = contextBlocksOf(windowCore, opened, window.length)
    // A window starting or ending at a clean block boundary, as beside a
    // closed fence, needs no block of context there.
    const windowEdges = { start: sourceStart === 0 || context.cleanStart === true, end: windowEnd === state.source.length || context.cleanEnd === true }
    // A result spelling the edit spells the fence or math block it is typed
    // in whole. Where no blank lines part the window from the blocks beyond
    // it, no region reads that result, and where the window holds no block
    // to show the blocks around the literal one keep their place, the
    // window grows to the reach the result would widen it to, before
    // compiling in it.
    const literal = widenings < 3 && !(parted(sourceStart) && parted(windowEnd))
      ? plainLiteralBlockOf(windowCore, opened, span.start - sourceStart, span.end - sourceStart)
      : undefined
    if (literal !== undefined && blocksAround.unbounded(literal, windowEdges)) {
      return windowedGeneralEdits(state, previous, edits, compile, {
        start: Math.max(0, Math.min((reach ?? span).start, sourceStart) - 1),
        end: Math.min(state.source.length, Math.max((reach ?? span).end, windowEnd) + 1)
      }, widenings + 1, retried, spells, documentChange)
    }
    const local = Object.freeze(edits.map(edit => Object.freeze({
      start: edit.start - sourceStart, end: edit.end - sourceStart, insert: edit.insert
    })))
    // A key the window could only take as typed is the document's to spell.
    // A spelling reaching an edge of the window the document goes on past
    // is compiled once more in a window past that edge: a block more before
    // its start, and at its end the rest of the document, as a fence the key
    // breaks reads to the document's end. Where that rest is most of the
    // document, the document compile reads it for no more.
    const beyond = (edges: Readonly<{ start: boolean, end: boolean }>) => {
      const rest = state.source.length - sourceStart
      if (retried || (edges.end && rest * 5 > state.source.length * 3)) return undefined
      return windowedGeneralEdits(state, previous, edits, compile, {
        start: edges.start ? Math.max(0, Math.min((reach ?? span).start, sourceStart) - 1) : Math.min((reach ?? span).start, sourceStart),
        end: edges.end ? state.source.length : Math.max((reach ?? span).end, windowEnd)
      }, widenings, true, spells, documentChange)
    }
    if (documentChange !== undefined) {
      documentReadingChanges.set(windowCore, { start: documentChange.start - sourceStart, end: documentChange.end - sourceStart })
    }
    const run = () => compile(windowCore, opened, local, candidate => windowPreview(opened, candidate))
    const compiled = trackedPartsSeparate(core) ? separateTrackedParts(windowCore, run) : run()
    const unresolved = unresolvedDraftEdges(windowCore)
    if (unresolved !== undefined) return beyond(unresolved)
    // A window's refusal of an edit that writes or removes a line break or a
    // delimiter a block can open with is not the document's: the document
    // compile may spell it with text beyond the window, which such an edit
    // can reach. Any other refusal in a window proven to read as the
    // document stands.
    if (compiled === undefined) {
      const reaches = edits.some(edit => /[`~$<>\r\n]/u.test(edit.insert + state.source.slice(edit.start, edit.end)))
      return context.inPlace !== undefined && !reaches ? { edits: undefined } : undefined
    }
    if (compiled.length === 0) return { edits: Object.freeze([]) }
    if (compiled.some(part => part.end > window.length)) return undefined
    const planned = Object.freeze(compiled.map(part => Object.freeze({
      start: part.start + sourceStart, end: part.end + sourceStart, insert: part.insert
    })))
    const expected = windowPreview(opened, compiled)
    // Reading the result may show a `$$` line it leaves open past the window,
    // which the document reads otherwise (see noteWindowDollarReach).
    const settled = (): { readonly edits: readonly DocumentSourceEdit[] | undefined } | undefined => {
      const reached = unresolvedDraftEdges(windowCore)
      return reached === undefined ? { edits: planned } : beyond(reached)
    }
    const delta = expected.sourceLength - windowSource.length
    const first = planned[0]
    const last = planned.at(-1)
    if (first === undefined || last === undefined) return undefined
    let insert = ''
    let cursor = first.start
    for (const part of planned) {
      insert += window.slice(cursor - sourceStart, part.start - sourceStart) + part.insert
      cursor = part.end
    }
    const combined = Object.freeze({ start: first.start, end: last.end, insert })
    const candidate = parted(sourceStart) && parted(windowEnd) ? regionalCandidate(state, combined) : undefined
    if (candidate !== undefined) {
      // Both parses must cover the edited text with a block to spare, and
      // agree on every suggestion and diagnostic in the text they share.
      const shared = {
        start: Math.max(sourceStart, candidate.sourceStart),
        end: Math.min(windowEnd + delta, candidate.sourceStart + candidate.nextWindow.length)
      }
      const inPlace = windowAnnotationsOf(candidate.nextProducts).annotations
      const inPlaceDiagnostics = diagnosticsOf(candidate.nextProducts)
      const covered = (shared.start < combined.start || shared.start === 0) &&
        (shared.end > combined.start + insert.length || shared.end === state.source.length + delta)
      const sharedInWindow = { start: shared.start - sourceStart, end: shared.end - sourceStart }
      const sharedInPlace = { start: shared.start - candidate.sourceStart, end: shared.end - candidate.sourceStart }
      if (covered &&
          !straddling(expected.annotations, sharedInWindow.start, sharedInWindow.end) &&
          !straddling(inPlace, sharedInPlace.start, sharedInPlace.end) &&
          sameAnnotations(within(expected.annotations, sharedInWindow.start, sharedInWindow.end), sourceStart,
            within(inPlace, sharedInPlace.start, sharedInPlace.end), candidate.sourceStart) &&
          sameDiagnostics(within(expected.diagnostics, sharedInWindow.start, sharedInWindow.end), sourceStart,
            within(inPlaceDiagnostics, sharedInPlace.start, sharedInPlace.end), candidate.sourceStart)) {
        return settled()
      }
    }
    const nextEnd = window.length + delta
    if (!context.strayLocal(expected.source.slice(0, nextEnd),
      within(expected.annotations, 0, nextEnd).length,
      expected.diagnostics.some(diagnostic => diagnostic.code === 'CM_UNTERMINATED_OPENER' && diagnostic.range.end <= nextEnd),
      // The document parse below publishes the result whole, so a first or
      // last annotation, which changes how every unfinished opener is
      // escaped, reads right there.
      true)) return undefined
    // A result reaching a clean edge the window has no context beyond is one
    // the window's own extent chose, as a span to the window's start or end:
    // it is compiled again with the blocks beyond.
    // A result replacing one block whole is that block's, whatever window
    // reads it.
    const wholeBlockResult = (): boolean => {
      if (compiled.length !== 1) return false
      const part = compiled[0]
      if (part === undefined) return false
      const { ast, coordinates } = windowCore.project(opened, 'markup').syntax
      return ast.root.children.some(block => {
        const start = coordinates.toSource(block.range.start, 'next')
        const end = coordinates.toSource(block.range.end, 'previous')
        return part.start === start && (part.end === end || /^(?:\r\n|\r|\n)$/u.test(window.slice(end, part.end)))
      })
    }
    const reachesCleanEdge = ((context.cleanStart === true && sourceStart > 0 && first.start === sourceStart) ||
      (context.cleanEnd === true && windowEnd < state.source.length && last.end === windowEnd)) && !wholeBlockResult()
    let kept = reachesCleanEdge
      ? 'unbounded'
      : blocksAround.kept(() => windowCore.apply(opened, compiled).revision,
        { start: first.start - sourceStart, end: last.end - sourceStart }, delta, windowEdges)
    // A result splitting the deleted or replaced text that holds the edit
    // (G34) is that suggestion's, read and weighed within it whatever window
    // holds it. Where the window has no block of context beyond a blank line,
    // it is read again with the blocks the document has there: where they
    // keep their structure under the edit and under the result, the result
    // stands as compiled, and the document preview below decides the rest.
    const historyOwner = historyHolder(opened.annotations, local[0]?.start ?? -1, local.at(-1)?.end ?? -1)
    if (kept === 'unbounded' && !reachesCleanEdge && windowSource === window && parted(sourceStart) && parted(windowEnd) &&
        historyOwner !== undefined && local.some(part => part.insert.length > 0) &&
        compiled.every(part => historyOwner.annotation.range.start <= part.start && part.end <= historyOwner.annotation.range.end)) {
      const blockBefore = (at: number): number => {
        let cursor = at
        while (cursor > 0 && /[\r\n \t]/u.test(state.source.slice(cursor - 1, cursor))) cursor -= 1
        const before = state.source.slice(Math.max(0, cursor - 4096), cursor)
        const found = [...before.matchAll(/(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/gu)].at(-1)
        return found === undefined ? (cursor - 4096 <= 0 ? 0 : -1) : cursor - before.length + found.index + found[0].length
      }
      const blockAfter = (at: number): number => {
        const after = state.source.slice(at, Math.min(state.source.length, at + 4096))
        const content = after.search(/[^\r\n \t]/u)
        if (content < 0) return at + after.length === state.source.length ? state.source.length : -1
        const blank = /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/gu
        blank.lastIndex = content
        const found = blank.exec(after)
        return found === null ? (at + after.length === state.source.length ? state.source.length : -1) : at + found.index
      }
      const from = sourceStart === 0 ? 0 : blockBefore(sourceStart)
      const to = windowEnd === state.source.length ? windowEnd : blockAfter(windowEnd)
      if (from >= 0 && to >= 0) {
        const wideCore = createDocumentCoreWithExecutionBudget(executionBudget)
        windowCores.add(wideCore)
        const prefix = sourceStart - from
        const wideSource = state.source.slice(from, to)
        const wideOptions = from === 0 ? options : { ...options, frontMatter: false }
        const wide = wideCore.open(wideSource, wideOptions)
        const shift = (parts: readonly DocumentSourceEdit[]) =>
          parts.map(part => Object.freeze({ start: part.start + prefix, end: part.end + prefix, insert: part.insert }))
        const edges = { start: from === 0, end: to === state.source.length }
        const wideBlocks = contextBlocksOf(wideCore, wide, to - from)
        // The edit itself must leave those blocks as they read too: a fence
        // it leaves open would take them in, which the result alone hides.
        const plainDelta = local.reduce((sum, part) => sum + part.insert.length - (part.end - part.start), 0)
        const plainFirst = local[0]
        const plainLast = local.at(-1)
        kept = plainFirst === undefined || plainLast === undefined ||
          wideBlocks.kept(() => wideCore.apply(wide, shift(local)).revision,
            { start: plainFirst.start + prefix, end: plainLast.end + prefix }, plainDelta, edges) !== 'kept'
          ? 'unbounded'
          // The result is read as the text it writes there, opened whole.
          : wideBlocks.kept(() => {
            let written = ''
            let cursor = 0
            for (const part of shift(compiled)) {
              written += wideSource.slice(cursor, part.start) + part.insert
              cursor = part.end
            }
            return wideCore.open(written + wideSource.slice(cursor), wideOptions)
          }, { start: first.start - from, end: last.end - from }, delta, edges)
      }
    }
    // A result reaching the window's context, as a join of two blocks,
    // is compiled again with the blocks around it as context.
    // The window grows past its own context, whose last block may be one
    // the views read as no block at all, as a line of spaces.
    if (kept === 'unbounded' && widenings < 3) {
      const widened = reach ?? span
      return windowedGeneralEdits(state, previous, edits, compile, {
        start: Math.max(0, Math.min(widened.start, first.start, sourceStart) - 1),
        end: Math.min(state.source.length, Math.max(widened.end, last.end, windowEnd) + 1)
      }, widenings + 1, retried, spells, documentChange)
    }
    // An edit that splits or joins the list it is in changes the items
    // after it, in the window as in the document; the document preview
    // below then shows whether the result reads as the window compiled it.
    const splitsList = kept === 'changed' &&
      windowCore.project(opened, 'markup').syntax.ast.root.children.some(block => block.kind === 'list')
    if (kept !== 'kept' && !splitsList) return undefined
    // The document preview is the parse apply() publishes for these edits.
    const whole = previewSourceEdits(previous, planned)
    const readsBack = <T extends { range: SourceRange }>(
      after: readonly T[],
      before: readonly T[],
      inWindow: readonly T[],
      same: (left: readonly T[], leftStart: number, right: readonly T[], rightStart: number) => boolean
    ): boolean => !straddling(after, sourceStart, windowEnd + delta) && !straddling(before, sourceStart, windowEnd) &&
      same(after.filter(item => item.range.end <= sourceStart), 0, before.filter(item => item.range.end <= sourceStart), 0) &&
      same(within(after, sourceStart, windowEnd + delta), 0, inWindow, sourceStart) &&
      same(after.filter(item => item.range.start >= windowEnd + delta), 0,
        before.filter(item => item.range.start >= windowEnd), delta)
    return readsBack(whole.annotations, previous.annotations, expected.annotations, sameAnnotations) &&
      readsBack(whole.diagnostics, previous.diagnostics, expected.diagnostics, sameDiagnostics)
      ? settled()
      : undefined
  }

  /**
   * Whether a tracked edit in an item of a list the inventory splits reads
   * past the item: one at the item's marker can join or split the list, and
   * backtick and dollar runs pair with runs in other items. The document
   * compile decides those.
   */
  const listSensitiveEdit = (state: RevisionState, edit: DocumentSourceEdit): boolean => {
    const inventory = state.regionalInventory
    if (inventory === undefined || !regionalInventorySplitsLists(inventory) ||
        regionalInventoryListRange(inventory, edit.start) === undefined) return false
    const from = Math.max(0, edit.start - 512)
    const to = Math.min(state.source.length, edit.end + 512)
    const text = state.source.slice(from, to)
    const lineStart = from + Math.max(text.lastIndexOf('\n', edit.start - from - 1), text.lastIndexOf('\r', edit.start - from - 1)) + 1
    const lineEndAt = text.slice(edit.end - from).search(/[\r\n]/u)
    const line = state.source.slice(lineStart, lineEndAt === -1 ? to : edit.end + lineEndAt)
    const marker = /^[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/u.exec(line)
    return /[`$]/u.test(line + edit.insert) || (marker !== null && edit.start <= lineStart + marker[0].length)
  }

  /**
   * The source range whose reading a tracked key that derives its spelling
   * changes, read off the document's parses before and after it: the
   * windows compiling the key spell it over the span the document would.
   */
  const documentReadingChange = (state: RevisionState, previous: DocumentRevision, edit: DocumentSourceEdit): SourceRange | undefined => {
    if (plansFromDocumentParse(core) || state.source.length > DERIVED_SPELLING_UNITS) return undefined
    const source = state.source.slice(0, state.source.length)
    if (!derivesSpelling(source, edit, edit.insert)) return undefined
    const { ast, coordinates } = core.project(previous, 'markup').syntax
    const before = trackedStructure(ast.root, coordinates)
    const delta = edit.insert.length - (edit.end - edit.start)
    const read = readingAfterBlock(state, previous, source, edit, before)
    const windowed = read === undefined ? undefined : readingChange(before, read, edit, delta)
    if (windowed !== undefined && !checksReadingWindows()) return windowed
    const structure = trackedPreviewFacts.get(previewSourceEdits(previous, [edit]))?.structure
    if (structure === undefined) return undefined
    const whole = readingChange(before, structure(), edit, delta)
    if (windowed !== undefined && (windowed.start !== whole.start || windowed.end !== whole.end)) {
      throw new Error(`Window reading change ${JSON.stringify(windowed)} is not the document's ${JSON.stringify(whole)}`)
    }
    return whole
  }

  /**
   * The edited document's blocks and literals, as `trackedStructure` reads
   * them, from a parse of it from a top-level block before the key's line to
   * its end, or undefined where that parse may read otherwise than the whole
   * document's.
   *
   * The block (`first`) is not a list item, and the parse reads it as
   * `before` does. Its first line is the document's before the key, read in
   * the same parse state, so every container before it closes there in both
   * documents, and from that line on the parse and the edited document read
   * the same lines from the same state. Blocks before it read lines only up
   * to its first, which the key leaves alone. A `$$` line pairs with a closer
   * anywhere later, so one before the block that no math block holds, or a
   * key that may pair one otherwise, leaves the reading to the whole
   * document, as does a suggestion spanning the block's start or a stray
   * marker in the document, which could pair across it; with every marker
   * before the block paired before it, the markers after it pair as the
   * parse pairs them. Links, which
   * resolve labels across the document, are no part of the structure, and
   * code spans, math, autolinks and raw HTML bind before them.
   */
  const readingAfterBlock = (
    state: RevisionState,
    previous: DocumentRevision,
    source: string,
    edit: DocumentSourceEdit,
    before: TrackedStructure
  ): TrackedStructure | undefined => {
    if (previous.diagnostics.length !== 0) return undefined
    const next = source.slice(0, edit.start) + edit.insert + source.slice(edit.end)
    if (editsMayRepairMath(state.source, { length: next.length, slice: (from: number, to: number) => next.slice(from, to) },
      [edit], state.markdownOptions)) return undefined
    const lineStartOf = (at: number): number => Math.max(source.lastIndexOf('\n', at - 1), source.lastIndexOf('\r', at - 1)) + 1
    const keyLine = lineStartOf(edit.start)
    let candidate = before.blocks.findIndex(block => block.end >= keyLine)
    if (candidate === -1) candidate = before.blocks.length
    let roots: readonly CriticMarkupAnnotation[] | undefined
    let first: TrackedPart | undefined
    let start = 0
    for (candidate -= 1; candidate >= 0; candidate -= 1) {
      const block = before.blocks[candidate]
      // A block the key's line directly follows can take that line in.
      if (block === undefined || block.kind.startsWith('item ') ||
          !/(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/u.test(source.slice(block.end, keyLine))) continue
      start = lineStartOf(block.start)
      if (start === 0) return undefined
      const straddles = (part: Readonly<{ start: number, end: number }>): boolean => part.start < start && part.end > start
      roots ??= rootsOverlapping(previous, { start: 0, end: keyLine })
      if (before.blocks.some(straddles) || before.literals.some(straddles) || roots.some(root => straddles(root.range))) continue
      first = block
      break
    }
    if (first === undefined) return undefined
    if (state.markdownOptions.texMathDollars) {
      for (let at = source.indexOf('$$'); at !== -1 && at < start; at = source.indexOf('$$', at + 2)) {
        if (!before.literals.some(part => part.kind === 'math-block' && part.start <= at && at < part.end)) return undefined
      }
    }
    const products = isolatedProducts(next.slice(start), Object.freeze({ ...state.markdownOptions, frontMatter: false }))
    // An unfinished opener reads otherwise in a document without annotations.
    if (diagnosticsOf(products).some(diagnostic => diagnostic.code === 'CM_UNTERMINATED_OPENER') &&
        annotationsOf(products).annotations.length === 0 && roots?.some(root => root.range.end <= start) === true) return undefined
    const editing = products.editing()
    const read = trackedStructure(markdownAstOf(editing).root, projectionCoordinatesOf(editing, next.length - start))
    const opening = read.blocks[0]
    if (opening === undefined || opening.kind !== first.kind || opening.start + start !== first.start ||
        opening.end + start !== first.end) return undefined
    const shift = (part: TrackedPart): TrackedPart => ({ kind: part.kind, start: part.start + start, end: part.end + start })
    return {
      blocks: [...before.blocks.filter(part => part.start < start), ...read.blocks.map(shift)],
      literals: [...before.literals.filter(part => part.start < start), ...read.literals.map(shift)]
    }
  }

  /** Tracked compilation of an edit that changes no deleted text or annotation syntax. */
  const ownedTrackedEdit = (
    state: RevisionState,
    previous: DocumentRevision,
    edit: DocumentSourceEdit
  ): DocumentSourceEdit | undefined => {
    // The general compile's spelling search reads its candidates' reader views.
    const searchPreview = (candidate: readonly DocumentSourceEdit[]) => previewSourceEdits(previous, candidate, true)
    const pending = createTrackedPendingArmEdits(core, previous, [edit])
    if (pending !== undefined && pending.length > 0) {
      const first = pending[0]
      const last = pending.at(-1)
      if (first === undefined || last === undefined) return undefined
      // This singular API carries the same exact script as one source edit.
      // Untouched gaps (including comments) come directly from the revision.
      let insert = ''
      let cursor = first.start
      for (const part of pending) {
        insert += core.sourceSlice(previous, { start: cursor, end: part.start }) + part.insert
        cursor = part.end
      }
      return Object.freeze({ start: first.start, end: last.end, insert })
    }
    if (listSensitiveEdit(state, edit)) {
      // The whole list is the window then, as for a list that does not split.
      const list = state.regionalInventory === undefined
        ? undefined
        : regionalInventoryListRange(state.regionalInventory, edit.start)
      const windowed = list === undefined
        ? undefined
        : windowedGeneralEdits(state, previous, [edit], (windowCore, revision, [local], windowPreview) => {
          const planned = local === undefined ? undefined : generalTrackedEdit(windowCore, revision, local, windowPreview)
          return planned === undefined ? undefined : [planned]
        }, { start: Math.min(list.start, edit.start), end: Math.max(list.end, edit.end) }, 0, false, true,
        list === undefined ? undefined : documentReadingChange(state, previous, edit))
      const planned = windowed?.edits?.[0]
      if (windowed !== undefined) {
        return planned === undefined ? undefined : Object.freeze({ start: planned.start, end: planned.end, insert: planned.insert })
      }
      return generalTrackedEdit(core, previous, edit, searchPreview)
    }
    const regional = (typedInHistory(previous, edit) ? undefined : regionalPayloadEdit(state, edit, true)) ??
      regionalTrackedLiteralBlock(state, edit) ??
      regionalTrackedInsertion(state, previous, edit) ??
      regionalTrackedArmEdge(state, previous, edit) ?? regionalTrackedBesideDeletion(state, previous, edit) ??
      regionalTrackedInsideDeletion(state, previous, edit) ?? regionalTrackedInSubstitution(state, previous, edit) ??
      regionalTrackedBreak(state, previous, edit) ?? regionalTrackedJoin(state, previous, edit) ??
      regionalTrackedDeletion(state, previous, edit)
    payloadCandidate = undefined
    if (regional !== undefined) return regional
    // Enter at an Addition's edge extends it, as the regional planner spells
    // it, whichever compile reads the key.
    const breakTarget = edit.start === edit.end && /^(?:\r\n|\r|\n)+$/u.test(edit.insert)
      ? trackedBreakTarget(state, previous, edit)
      : undefined
    if (breakTarget?.owner !== undefined && breakTarget.at !== edit.start && plainParagraphAround(previous, breakTarget.at)) {
      edit = Object.freeze({ start: breakTarget.at, end: breakTarget.at, insert: edit.insert })
    }
    const windowed = windowedGeneralEdits(state, previous, [edit], (windowCore, revision, [local], windowPreview) => {
      const planned = local === undefined ? undefined : generalTrackedEdit(windowCore, revision, local, windowPreview)
      return planned === undefined ? undefined : [planned]
    }, literalCompileReach(state, edit), 0, false, true, documentReadingChange(state, previous, edit))
    if (windowed !== undefined) {
      const planned = windowed.edits?.[0]
      return planned === undefined
        ? undefined
        : Object.freeze({ start: planned.start, end: planned.end, insert: planned.insert })
    }
    return generalTrackedEdit(core, previous, edit, searchPreview)
  }

  /**
   * The text the general compiler may suggest replacing for an edit in a
   * literal block: the block and the blocks after it that a literal can
   * absorb (see `widenedTrackedSourceEdit`), so a window compile reads what
   * the document compile would.
   */
  const literalCompileReach = (state: RevisionState, edit: DocumentSourceEdit): SourceRange | undefined => {
    const block = state.regionalInventory === undefined
      ? undefined
      : regionalInventoryLiteralRange(state.regionalInventory, edit.start)
    if (block === undefined) return undefined
    const text = state.source.slice(block.end, Math.min(state.source.length, block.end + 4096))
    let end = 0
    for (let run = 0; run < 4 && end < text.length; run += 1) {
      const blank = /^(?:[ \t]*(?:\r\n|\r|\n))*/u.exec(text.slice(end))?.[0].length ?? 0
      const lines = /^(?:[^\r\n]*\S[^\r\n]*(?:\r\n|\r|\n|$))*/u.exec(text.slice(end + blank))?.[0].length ?? 0
      if (blank + lines === 0) break
      end += blank + lines
    }
    return Object.freeze({ start: Math.min(block.start, edit.start), end: Math.max(edit.end, block.end + end) })
  }

  /**
   * Tracked compilation of one requested edit, as ordered disjoint parts:
   * one part unless the edit also covers deleted text or annotation syntax.
   */
  // A key compiled in this document spends one spelling-search budget (owner
  // decision, 8 October 2026); window cores and the reference compiles none.
  // Its previous revision's projections outlast the compile's candidate reads
  // (see `setAsideFor`).
  const keyBudget = <T>(previous: DocumentRevision, compile: () => T): T => {
    const outer = compilingFrom
    compilingFrom = previous
    try {
      return windowCores.has(core) || plansFromDocumentParse(core) || searchesWithoutBudget(core)
        ? compile()
        : withDocumentSearchBudget(core, compile)
    } finally {
      compilingFrom = outer
    }
  }

  const trackedEditParts = (previous: DocumentRevision, edit: DocumentSourceEdit): readonly DocumentSourceEdit[] | undefined =>
    keyBudget(previous, () => unbudgetedTrackedEditParts(previous, edit))

  const unbudgetedTrackedEditParts = (previous: DocumentRevision, edit: DocumentSourceEdit): readonly DocumentSourceEdit[] | undefined => {
    const state = currentStateOf(previous)
    const edits = stableSourceEdits([edit])
    preflightSourceEdits(state.source.length, edits)
    const stableEdit = edits[0]
    if (stableEdit === undefined) throw new Error('Tracked source edit is missing')
    // Typing over the whole of one's own Addition rewrites its text.
    const compile = (part: DocumentSourceEdit) => {
      const content = part.insert.length === 0 || part.start === part.end
        ? undefined
        : markupAnnotations(previous.annotations).find(annotation => annotation.kind === 'addition' &&
          annotation.range.start === part.start && annotation.range.end === part.end)?.arms[0]
      return ownedTrackedEdit(state, previous, content === undefined ? part : { ...content.range, insert: part.insert })
    }
    const single = (planned: DocumentSourceEdit | undefined) =>
      planned === undefined ? undefined : Object.freeze(unchangedTrackedEdit(planned) ? [] : [planned])
    const editable = trackedEditableSpans(core, previous, stableEdit)
    const enclosed = trackedEditableSpans(core, previous, stableEdit, true)
    // Deleting text that holds one's own draft removes that draft outright
    // and strikes the rest (Google Docs), so inline deletions never nest.
    // A deleted block stays one suggestion around what it holds.
    if (stableEdit.insert.length === 0 && enclosed !== undefined && !/[\r\n]/u.test(core.sourceSlice(previous, stableEdit))) {
      return trackedEditableEdits(core, stableEdit, enclosed, compile)
    }
    const planned = editable?.history === true
      ? trackedEditableEdits(core, stableEdit, editable, compile)
      : single(ownedTrackedEdit(state, previous, stableEdit))
    if (planned !== undefined) return planned
    // An edit reaching past a draft's delimiters, or a replacement whose
    // suggestion cannot enclose the existing ones, changes only the text a
    // reader can still edit, part by part.
    const parts = editable !== undefined && !editable.history ? trackedEditableEdits(core, stableEdit, editable, compile) : undefined
    return parts ?? (enclosed === undefined ? undefined : trackedEditableEdits(core, stableEdit, enclosed, compile))
  }

  /**
   * Typing is never refused (owner decision, 6 October): an edit no tracked
   * spelling holds while its untracked edit applies takes the closest one.
   * Text typed into deleted or replaced text that no split there holds is
   * proposed beside the outermost suggestion holding it, so Accept All keeps
   * it and Reject All drops it; any other edit takes the spelling that Accept
   * All and Reject All read as the untracked edit.
   */
  const closestTrackedEdit = (previous: DocumentRevision, edit: DocumentSourceEdit, splitting = false): DocumentSourceEdit | undefined =>
    keyBudget(previous, () => unbudgetedClosestTrackedEdit(previous, edit, splitting))

  // `splitting`: a key that splits a marker is weighed too, for a spelling
  // that resolves to its bytes alone (see `recordedExactly`).
  const unbudgetedClosestTrackedEdit = (previous: DocumentRevision, edit: DocumentSourceEdit, splitting = false): DocumentSourceEdit | undefined => {
    const markup = core.markupEdit(previous, edit)
    // An edit the markup compile cannot read is weighed against whole parses
    // of its candidates, as the reference weighs them.
    const preview = (edits: readonly DocumentSourceEdit[]) => previewSourceEdits(previous, edits, markup === undefined, markup === undefined)
    // An edit the markup compile cannot read as an edit of the markup, as
    // typing that pairs with a delimiter outside the suggestion it is typed
    // in, is spelled as the source edit it is, where it writes no delimiter
    // apart; its spelling may leave no marker unpaired.
    const untracked = markup ??
      (edit.start === edit.end && edit.insert.length === 0 || !splitting && splitsMarker(previous.annotations, edit) ? undefined : Object.freeze([edit]))
    if (untracked === undefined || untracked.length === 0) return undefined
    const around = rootsAround(previous, edit.start)
    if (edit.start === edit.end && edit.insert.length > 0 && withinHistory(around, edit)) {
      const outer = markupAnnotations(around)
        .find(annotation => annotation.range.start < edit.start && edit.start < annotation.range.end)
      for (const at of outer === undefined ? [] : [outer.range.end, outer.range.start]) {
        const planned = Object.freeze({ start: at, end: at, insert: `{++${protectNativeCriticText(edit.insert)}++}` })
        const next = preview([planned])
        if (next.annotations.length === previous.annotations.length + 1 &&
            next.diagnostics.length <= previous.diagnostics.length) return planned
      }
      return undefined
    }
    const oracle = createTrackedOracle(core, previous, untracked, preview)
    if (oracle !== undefined && markup === undefined) spelledAsSource.add(oracle)
    if (oracle !== undefined && splitting) {
      recordedExactly.add(oracle)
      // The keystroke struck or proposed where it was typed is its closest
      // record; the search's spans grow to whole suggestions.
      const old = core.sourceSlice(previous, edit)
      const spellings = old.length === 0
        ? [`{++${edit.insert}++}`]
        : edit.insert.length === 0 ? [`{--${old}--}`] : [`{--${old}--}{++${edit.insert}++}`, `{~~${old}~>${edit.insert}~~}`]
      for (const insert of spellings) {
        const spelled = Object.freeze({ start: edit.start, end: edit.end, insert })
        if (oracle.resolvesExactly([spelled])) return spelled
      }
    }
    return oracle === undefined ? undefined : withBestEffortSpelling(core, () => widenedTrackedSourceEdit(core, previous, oracle))
  }

  /**
   * Tracked input that deletes or replaces already deleted text follows
   * Google Docs: Backspace or Delete over deleted text only moves the caret
   * across it, and a replacement proposes its text for the rest of the
   * selection. Backspace keeps the caret before the text it strikes, Delete
   * after it, and typing after its own text.
   */
  const trackedInputPlan = (previous: DocumentRevision, action: DocumentInputAction, plan: DocumentInputPlan): DocumentInputPlan => {
    if ('kind' in action || !('ranges' in action.selection) || !('ranges' in plan.selection)) return plan
    const caret = action.selection.ranges[action.selection.primary]
    const planned = plan.selection.ranges[plan.selection.primary]
    if (caret === undefined || planned === undefined || plan.edits.length === 0) return plan
    const collapsed = (at: number) => Object.freeze({ ranges: Object.freeze([Object.freeze({ anchor: at, focus: at })]), primary: 0 })
    // The character a caret key targets is already deleted: move over it,
    // whatever the untracked policy would also delete beside it.
    const direction = action.inputType === 'deleteContentBackward' ? 'backward' : action.inputType === 'deleteContentForward' ? 'forward' : undefined
    if (direction !== undefined && caret.anchor === caret.focus && 'start' in action.range && action.range.start < action.range.end &&
        trackedEditableSpans(core, previous, action.range, true)?.length === 0) {
      return Object.freeze({
        edits: Object.freeze([]),
        selection: collapsed(direction === 'backward' ? action.range.start : action.range.end),
        reconciliation: Object.freeze([...plan.edits].reverse().map(edit => Object.freeze({ start: edit.start, end: edit.start, insert: core.sourceSlice(previous, edit) })))
      })
    }
    const edit = plan.edits[0]
    // Typing in a literal block's struck old arm edits its proposed block,
    // the caret following the typed text there.
    if (plan.edits.length === 1 && edit !== undefined && edit.start === edit.end && edit.insert.length > 0) {
      let owner: CriticMarkupAnnotation | undefined
      for (const annotation of markupAnnotations(rootsAround(previous, edit.start))) {
        if (annotation.kind === 'substitution' && annotation.range.start < edit.start && edit.start < annotation.range.end &&
            (owner === undefined || annotation.range.end - annotation.range.start < owner.range.end - owner.range.start)) owner = annotation
      }
      const target = owner === undefined ? undefined : literalHistoryInsertionPoint(core, previous, owner, edit.start)
      if (target !== undefined) {
        return Object.freeze({
          edits: Object.freeze([Object.freeze({ start: target, end: target, insert: edit.insert })]),
          selection: collapsed(target + edit.insert.length),
          reconciliation: Object.freeze([]),
          trackedCaret: Object.freeze({ at: target, side: 'after' as const })
        })
      }
    }
    // Where the compiler's spelling has no proven mapping, the caret follows
    // the same source position past the suggestion that now holds it.
    const fallback = Object.freeze({ at: positionBefore(plan.edits, planned.focus), side: 'after' as const, fallback: true })
    if (plan.edits.length !== 1 || edit === undefined) return Object.freeze({ ...plan, trackedCaret: fallback })
    const deletion = edit.insert.length === 0 && edit.start < edit.end
    // A deleted selection keeps the caret after the struck text.
    const backward = caret.anchor === caret.focus && !action.inputType.includes('Forward')
    const struck = Object.freeze({ at: backward ? edit.start : edit.end, side: backward ? 'before' as const : 'after' as const })
    const editable = trackedEditableSpans(core, previous, edit, deletion && !/[\r\n]/u.test(core.sourceSlice(previous, edit)))
    if (editable === undefined) {
      return Object.freeze({ ...plan, trackedCaret: deletion && caret.anchor === caret.focus && action.inputType.startsWith('delete') ? struck : fallback })
    }
    if (editable.length > 0) {
      const spans = deletion ? editable : trackedEditableSpans(core, previous, edit)
      return Object.freeze({
        ...plan,
        trackedCaret: deletion ? struck : spans?.history === true ? Object.freeze({ at: spans[0]?.end ?? edit.end, side: 'after' as const }) : Object.freeze({ ...fallback, at: edit.end })
      })
    }
    if (!deletion) {
      // Typing over deleted text only is typing at the selection's start.
      return Object.freeze({
        edits: Object.freeze([Object.freeze({ start: edit.start, end: edit.start, insert: edit.insert })]),
        selection: collapsed(edit.start + edit.insert.length),
        reconciliation: Object.freeze([]),
        trackedCaret: Object.freeze({ at: edit.start, side: 'after' as const, fallback: true })
      })
    }
    return Object.freeze({
      edits: Object.freeze([]),
      selection: caret.anchor !== caret.focus ? action.selection : collapsed(backward ? edit.start : edit.end),
      reconciliation: Object.freeze([Object.freeze({ start: edit.start, end: edit.start, insert: core.sourceSlice(previous, edit) })])
    })
  }

  // A source with every annotation accepted or rejected, read on a core of
  // its own so this core's current revision stays.
  const resolvedSource = (source: string, decision: 'accept' | 'reject', options: MarkdownOptionsV1): string => {
    const resolver = createDocumentCoreWithExecutionBudget(executionBudget)
    windowCores.add(resolver)
    const { schema: _schema, ...open } = options
    let revision = resolver.open(source, open)
    for (let pass = 0; pass < 64 && revision.annotations.length > 0; pass += 1) {
      const current = revision
      revision = resolver.apply(current, current.annotations.map(annotation => {
        const name = annotation.kind === 'addition'
          ? decision === 'accept' ? 'content' : undefined
          : annotation.kind === 'deletion'
            ? decision === 'accept' ? undefined : 'content'
            : annotation.kind === 'substitution'
              ? decision === 'accept' ? 'new' : 'old'
              : annotation.kind === 'highlight' ? 'content' : undefined
        const kept = name === undefined ? undefined : annotation.arms.find(arm => arm.name === name)
        return { ...annotation.range, insert: kept === undefined ? '' : current.source.slice(kept.range.start, kept.range.end) }
      })).revision
    }
    return revision.source
  }

  /**
   * Tracked mode accepts every edit untracked mode accepts. Where no spelling
   * the compile weighs reads as the untracked result in every view, the
   * change is proposed as one suggestion over the blocks it touches and read
   * for its review alone: accepting it gives the untracked result's accepted
   * source, rejecting it the previous one's, and it leaves no marker unpaired
   * beyond those the untracked edit leaves.
   */
  const trackedFallback = (
    previous: DocumentRevision,
    untracked: readonly DocumentSourceEdit[]
  ): readonly DocumentSourceEdit[] | undefined => {
    const first = untracked[0]
    const last = untracked.at(-1)
    if (first === undefined || last === undefined) return undefined
    const source = core.sourceSlice(previous, { start: 0, end: previous.sourceLength })
    let next = source
    for (const edit of [...untracked].reverse()) next = next.slice(0, edit.start) + edit.insert + next.slice(edit.end)
    const delta = next.length - source.length
    const preview = (candidate: readonly DocumentSourceEdit[]) => previewSourceEdits(previous, candidate)
    const untrackedNext = preview(untracked)
    const allowed = Math.max(previous.diagnostics.length, untrackedNext.diagnostics.length)
    const options = currentStateOf(previous).markdownOptions
    const accepted = resolvedSource(next, 'accept', options)
    const rejected = resolvedSource(source, 'reject', options)
    const authors = (annotations: readonly CriticMarkupAnnotation[], at: number): boolean =>
      annotations.some(({ range, arms }) => range.start === at || arms.some(arm => authors(arm.annotations, at)))
    const nested: CriticMarkupAnnotation[] = []
    const gather = (annotations: readonly CriticMarkupAnnotation[]): void => {
      for (const annotation of annotations) {
        nested.push(annotation)
        for (const arm of annotation.arms) gather(arm.annotations)
      }
    }
    gather(previous.annotations)
    // A span holds whole every annotation it cuts: one it meets that neither
    // holds it within one arm nor lies within it.
    const widen = (start: number, end: number): Readonly<{ start: number, end: number }> => {
      let from = start
      let to = end
      for (let changed = true; changed;) {
        changed = false
        for (const { range, arms } of nested) {
          if (to <= range.start || range.end <= from || (from <= range.start && range.end <= to)) continue
          if (arms.some(arm => arm.range.start <= from && to <= arm.range.end)) continue
          from = Math.min(from, range.start)
          to = Math.max(to, range.end)
          changed = true
        }
      }
      return { start: from, end: to }
    }
    const blockStart = (at: number): number => {
      const before = source.slice(0, at)
      let index = before.length
      while (index > 0) {
        const lineStart = Math.max(before.lastIndexOf('\n', index - 1), before.lastIndexOf('\r', index - 1))
        if (lineStart < 0) return 0
        const previousLineStart = Math.max(before.lastIndexOf('\n', lineStart - 1), before.lastIndexOf('\r', lineStart - 1)) + 1
        if (source.slice(previousLineStart, lineStart).trim() === '') return lineStart + 1
        index = lineStart
      }
      return 0
    }
    const blockEnd = (at: number): number => {
      const blank = /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/gu
      blank.lastIndex = at
      const found = blank.exec(source)
      return found === null ? source.length : found.index + 1
    }
    const validated = (edits: readonly DocumentSourceEdit[]): readonly DocumentSourceEdit[] | undefined => {
      const read = preview(edits)
      if (read.diagnostics.length > allowed) return undefined
      return edits.every(edit => authors(read.annotations, edit.start)) &&
        resolvedSource(read.source, 'reject', options) === rejected
        ? Object.freeze(edits)
        : undefined
    }
    if (historySplit(previous.annotations, source, untracked, 'before') !== undefined) {
      // Owner ruling G34: text typed into deleted or replaced text splits that
      // suggestion at the caret, so the typing survives Accept All while
      // Reject All restores the original. A spelling that drops it is no
      // spelling of the key, so none is weighed below.
      const acceptedBefore = resolvedSource(source, 'accept', options)
      for (const at of ['caret', 'line', 'arm', 'before', 'after'] as const) {
        const history = historySplit(previous.annotations, source, untracked, at)
        if (history === undefined) continue
        const spelled = validated([Object.freeze({ start: history.range.start, end: history.range.end, insert: history.insert })])
        if (spelled !== undefined &&
            keepsTyping(resolvedSource(preview(spelled).source, 'accept', options), acceptedBefore, history.typed)) return spelled
      }
      return undefined
    }
    // The edit itself is tried first, then each suggestion holding it from
    // the innermost out, then the blocks around it, parted at blank lines.
    const edited = widen(first.start, last.end)
    const holders = nested
      .filter(({ range }) => range.start <= edited.start && edited.end <= range.end)
      .sort((left, right) => (left.range.end - left.range.start) - (right.range.end - right.range.start))
      .map(({ range }) => widen(range.start, range.end))
    const rungs = [edited, ...holders]
    let span = edited
    for (let attempt = 0; attempt < 8 + holders.length; attempt += 1) {
      const old = source.slice(span.start, span.end)
      const proposed = next.slice(span.start, span.end + delta)
      const spellings = old === ''
        ? [`{++${proposed}++}`]
        : proposed === ''
          ? [`{--${old}--}`, `{~~${old}~>~~}`]
          : [`{~~${old}~>${proposed}~~}`, `{--${old}--}{++${proposed}++}`]
      for (const insert of spellings) {
        const candidate = Object.freeze({ start: span.start, end: span.end, insert })
        const read = preview([candidate])
        if (read.diagnostics.length > allowed) continue
        if (!authors(read.annotations, span.start)) continue
        if (resolvedSource(read.source, 'reject', options) !== rejected || resolvedSource(read.source, 'accept', options) !== accepted) continue
        return Object.freeze([candidate])
      }
      const holder = rungs[attempt + 1]
      if (holder !== undefined) {
        span = holder
        continue
      }
      const wider = widen(blockStart(span.start), blockEnd(span.end))
      if (wider.start === span.start && wider.end === span.end) {
        if (span.start === 0 && span.end === source.length) return undefined
        span = { start: 0, end: source.length }
      } else span = wider
    }
    return undefined
  }

  /**
   * Whether a plan's Accept All is the previous one's with the typing
   * inserted at one place, read over the suggestions around the edits only,
   * so a large document's annotations stay unread.
   */
  const plannedKeepsTyping = (
    previous: DocumentRevision,
    input: readonly DocumentSourceEdit[],
    planned: readonly DocumentSourceEdit[],
    typing: string
  ): boolean => {
    const read = previewSourceEdits(previous, planned)
    const delta = planned.reduce((sum, edit) => sum + edit.insert.length - (edit.end - edit.start), 0)
    let start = Math.min(...input.map(edit => edit.start), ...planned.map(edit => edit.start))
    let end = Math.max(...input.map(edit => edit.end), ...planned.map(edit => edit.end))
    let before = annotationsOverlapping(core, previous, { start, end })
    let after = annotationsOverlapping(core, read, { start, end: end + delta })
    // Grow the span until it holds every suggestion it meets, before and after.
    for (let pass = 0; pass < 8; pass += 1) {
      const from = Math.min(start, ...before.map(annotation => annotation.range.start), ...after.map(annotation => annotation.range.start))
      const to = Math.max(end, ...before.map(annotation => annotation.range.end), ...after.map(annotation => annotation.range.end - delta))
      if (from === start && to === end) break
      start = from
      end = to
      before = annotationsOverlapping(core, previous, { start, end })
      after = annotationsOverlapping(core, read, { start, end: end + delta })
    }
    return keepsTyping(resolvedSuggestions(read.source.slice(start, end + delta), after, 'accept', start),
      resolvedSuggestions(core.sourceSlice(previous, { start, end }), before, 'accept', start), typing)
  }

  const planNativeEdits = (
    previous: DocumentRevision,
    input: readonly DocumentSourceEdit[],
    tracked: boolean,
    typed = false
  ): readonly DocumentSourceEdit[] | undefined => {
    const planned = planNativeEditsCompiled(previous, input, tracked, typed)
    if (!tracked || windowCores.has(core)) return planned
    // Typing into deleted or replaced text must survive Accept All as typed
    // (G34): a plan that writes it inside deleted or replaced text, or adds
    // to it, is no spelling of the key.
    const typing = input.map(edit => edit.insert).join('')
    if (planned !== undefined && planned.length > 0 && typing.length > 0 &&
        input.some(edit => historyHolder(annotationsOverlapping(core, previous, edit), edit.start, edit.end) !== undefined) &&
        !plannedKeepsTyping(previous, input, planned, typing) &&
        !(escapeCompleted(typing) !== typing && plannedKeepsTyping(previous, input, planned, escapeCompleted(typing)))) {
      const untracked = planNativeEditsCompiled(previous, input, false, typed)
      return untracked === undefined || untracked.length === 0 ? undefined : trackedFallback(previous, untracked)
    }
    // A spelling across lines or many characters is weighed against the
    // untracked result: it may leave no marker unpaired beyond those that
    // leaves, as a local one cannot.
    const source = currentStateOf(previous).source
    const wide = planned?.some(edit => edit.end - edit.start + edit.insert.length > 80 || /[\r\n]/u.test(edit.insert)) ||
      input.some(edit => /[`$~]/u.test(edit.insert + source.slice(edit.start, edit.end)))
    if (planned !== undefined && planned.length > 0 && !wide) return planned
    if (planned !== undefined && planned.length === 0) return planned
    const preview = (candidate: readonly DocumentSourceEdit[]) => previewSourceEdits(previous, candidate)
    if (planned !== undefined && preview(planned).diagnostics.length <= previous.diagnostics.length) return planned
    const untracked = planNativeEditsCompiled(previous, input, false, typed)
    if (untracked === undefined || untracked.length === 0) {
      // An edit the untracked compiler refuses is refused tracked too where
      // its spelling would leave a marker unpaired.
      return planned !== undefined && preview(planned).diagnostics.length <= previous.diagnostics.length ? planned : undefined
    }
    if (planned !== undefined &&
        preview(planned).diagnostics.length <= Math.max(previous.diagnostics.length, preview(untracked).diagnostics.length)) return planned
    return trackedFallback(previous, untracked) ?? planned
  }

  const planNativeEditsCompiled = (
    previous: DocumentRevision,
    input: readonly DocumentSourceEdit[],
    tracked: boolean,
    typed = false
  ): readonly DocumentSourceEdit[] | undefined => {
    const state = currentStateOf(previous)
    let edits = stableSourceEdits(input)
    preflightSourceEdits(state.source.length, edits)
    if (edits.length === 0) return Object.freeze([])
    if (tracked) {
      const pending = createTrackedPendingArmEdits(core, previous, edits)
      if (pending !== undefined) return pending
      // Adjacent declared edits are one contiguous replacement. Compile that
      // replacement before descending through independent spans; otherwise an
      // insertion at a replaced prefix's start is mistaken for an overlap and
      // widens the suggestion across untouched content to a later edit.
      const groups: Array<{ start: number, end: number, inserts: string[] }> = []
      for (const current of edits) {
        const last = groups.at(-1)
        if (last !== undefined && last.end === current.start) {
          last.end = current.end
          last.inserts.push(current.insert)
        } else {
          groups.push({ start: current.start, end: current.end, inserts: [current.insert] })
        }
      }
      edits = Object.freeze(groups.map(group => Object.freeze({
        start: group.start, end: group.end, insert: group.inserts.join('')
      })))
    }
    const edit = edits[0]
    if (edits.length === 1 && edit !== undefined) {
      if (!tracked) {
        const direct = core.markupEdit(previous, edit)
        if (direct !== undefined || !typed) return direct
        const windowed = windowedGeneralEdits(currentStateOf(previous), previous, [edit],
          (windowCore, revision, local, windowPreview) =>
            createMarkupCompoundSourceEdits(windowCore, revision, local, windowPreview, false, 'visible', 'admit-typed'))
        if (windowed !== undefined) return windowed.edits
        return createMarkupCompoundSourceEdits(core, previous, [edit],
          candidateEdits => previewSourceEdits(previous, candidateEdits), false, 'visible', 'admit-typed')
      }
      return trackedEditParts(previous, edit)
    }
    // Several edits, as Enter in a setext heading's text writes, are planned
    // on the blocks around them too.
    const windowed = windowedGeneralEdits(state, previous, edits, (windowCore, revision, local) =>
      nativeEditPlanners.get(windowCore)?.(revision, local, tracked, typed))
    if (windowed !== undefined) return windowed.edits
    if (!tracked) {
      return createMarkupCompoundSourceEdits(core, previous, edits,
        candidateEdits => previewSourceEdits(previous, candidateEdits), false, 'visible', typed ? 'admit-typed' : 'refuse')
    }
    const compoundSuggestion = (): readonly DocumentSourceEdit[] | undefined => {
      if (!tracked) return undefined
      const start = edits[0]!.start
      const end = edits.at(-1)!.end
      const protectedEdits = edits.map(edit => ({ ...edit, insert: protectNativeCriticText(edit.insert) }))
      let insert = core.sourceSlice(previous, { start, end })
      for (const edit of [...protectedEdits].reverse()) {
        insert = insert.slice(0, edit.start - start) + edit.insert + insert.slice(edit.end - start)
      }
      // Separate prefix suggestions may become literal text inside a fence.
      // Validate their complete replacement in the original parser context.
      const planned = createTrackedSourceEdit(core, previous, { start, end, insert },
        candidateEdits => previewSourceEdits(previous, candidateEdits), true)
      if (planned === undefined) return undefined
      const retained = markupAnnotations(rootsOverlapping(previous, { start, end })).filter(annotation =>
        annotation.range.start >= start && annotation.range.end <= end &&
        !edits.some(edit => edit.start <= annotation.range.start && edit.end >= annotation.range.end))
      const offset = (position: number, after: boolean): number => position - start + protectedEdits.reduce((delta, edit) =>
        delta + (edit.end < position || (edit.end === position && (after || edit.start < edit.end))
          ? edit.insert.length - (edit.end - edit.start)
          : 0), 0)
      const candidate = previewSourceEdits(previous, [planned])
      const wrapper = markupAnnotations(candidate.annotations).find(annotation => annotation.range.start === planned.start &&
        annotation.range.end === planned.start + planned.insert.length)
      const arm = wrapper?.arms.find(arm => arm.name === 'new')
      if (arm === undefined) return undefined
      const actual = markupAnnotations(arm.annotations)
      // Structural edits retain existing marks, but cannot activate new marks
      // by joining delimiter fragments across their source boundaries.
      if (actual.length !== retained.length || actual.some((annotation, index) => {
        const previous = retained[index]!
        return annotation.kind !== previous.kind ||
          annotation.range.start - arm.range.start !== offset(previous.range.start, true) ||
          annotation.range.end - arm.range.start !== offset(previous.range.end, false)
      })) return undefined
      return Object.freeze([planned])
    }
    // Container topology may change several distant prefixes. Validate on a
    // detached lineage so a later refusal cannot publish a partial transaction.
    // Descending source order retains the original coordinates of earlier edits.
    const candidateCore = createDocumentCoreWithExecutionBudget(executionBudget)
    if (tracked) deferEquivalence(candidateCore)
    if (plansFromGeneralCompile(core)) planFromGeneralCompile(candidateCore)
    const { schema: _schema, ...options } = state.markdownOptions
    let candidate = candidateCore.open(previous.source, options)
    const result: DocumentSourceEdit[] = []
    const authored: Array<{ edit: DocumentSourceEdit, annotation: CriticMarkupAnnotation }> = []
    let boundary = previous.sourceLength + 1
    // An insertion exactly at the next edit's start precedes it in source order.
    const beyond = (item: DocumentSourceEdit) => item.end > boundary ||
      item.start >= boundary && !(item.start === item.end && item.start === boundary)
    for (const edit of [...edits].reverse()) {
      if (beyond(edit)) return compoundSuggestion()
      if (candidateCore.sourceSlice(candidate, edit) === edit.insert) continue
      const trackedEdit = tracked ? candidateCore.trackedEdit(candidate, edit) : undefined
      const planned = tracked
        ? trackedEdit === undefined ? undefined : unchangedTrackedEdit(trackedEdit) ? [] : [trackedEdit]
        : candidateCore.markupEdit(candidate, edit)
      if (planned === undefined || planned.some(beyond)) return compoundSuggestion()
      if (planned.length === 0) continue
      candidate = candidateCore.apply(candidate, planned).revision
      for (const edit of planned) {
        for (const annotation of markupAnnotations(candidate.annotations)) {
          if (annotation.range.start >= edit.start && annotation.range.end <= edit.start + edit.insert.length) authored.push({ edit, annotation })
        }
      }
      boundary = Math.min(...planned.map(item => item.start))
      result.unshift(...planned)
    }
    if (tracked) {
      // Each suggestion must still be recognized after the entire sparse
      // operation. An earlier prefix change can move a later suggestion into
      // a different literal/container context despite its unchanged bytes.
      const actual = new Map(markupAnnotations(candidate.annotations).map(annotation =>
        [`${annotation.kind}:${annotation.range.start}:${annotation.range.end}`, annotation]))
      const shifts = new Map<DocumentSourceEdit, number>()
      let delta = 0
      for (const edit of result) {
        shifts.set(edit, delta)
        delta += edit.insert.length - (edit.end - edit.start)
      }
      for (const { edit, annotation } of authored) {
        const shift = shifts.get(edit)!
        const retained = actual.get(`${annotation.kind}:${annotation.range.start + shift}:${annotation.range.end + shift}`)
        if (retained === undefined || retained.arms.length !== annotation.arms.length || retained.arms.some((arm, index) => {
          const previous = annotation.arms[index]!
          return arm.name !== previous.name || arm.range.start !== previous.range.start + shift || arm.range.end !== previous.range.end + shift
        })) return compoundSuggestion()
      }
      const { ast, coordinates } = candidateCore.project(candidate, 'markup').syntax
      // Only literals the suggestions reach can gain their lines; one
      // elsewhere in the document reads as it did.
      const editedStart = result[0]?.start ?? 0
      const lastEdit = result.at(-1)
      const editedEnd = lastEdit === undefined ? editedStart : lastEdit.start + (shifts.get(lastEdit) ?? 0) + lastEdit.insert.length
      const pending = [ast.root]
      while (pending.length > 0) {
        const node = pending.pop()!
        const start = node.attributes.contentStart
        const end = node.attributes.contentEnd
        if (['code-block', 'math-block', 'diagram', 'html-block', 'front-matter'].includes(node.kind) &&
            typeof start === 'number' && typeof end === 'number' &&
            coordinates.toSource(node.range.start, 'next') <= editedEnd && coordinates.toSource(node.range.end, 'previous') >= editedStart) {
          let covered = start
          for (const segment of coordinates.sourceSegments ?? []) {
            const from = Math.max(start, segment.projected.start)
            const to = Math.min(end, segment.projected.end)
            if (to <= from) continue
            // Separate suggestions must not create synthetic lines inside a
            // literal. One compound suggestion retains its two complete bodies.
            if (from > covered) return compoundSuggestion()
            covered = Math.max(covered, to)
          }
          if (covered < end) return compoundSuggestion()
        }
        pending.push(...node.children)
      }
      // Separately admitted steps must still compose to the untracked result.
      const untracked = createMarkupCompoundSourceEdits(core, previous, edits,
        candidateEdits => previewSourceEdits(previous, candidateEdits), false, 'visible', 'admit-typed')
      if (!trackedOperationEquivalent(core, previous, untracked, result,
        candidateEdits => previewSourceEdits(previous, candidateEdits))) return compoundSuggestion()
    }
    return Object.freeze(result.map(edit => Object.freeze({ ...edit })))
  }

  const planUnspelledClipboard = (previous: DocumentRevision, action: DocumentClipboardAction): DocumentClipboardPlan => {
    const state = currentStateOf(previous)
    return planClipboard(core, previous, action, edits => previewSourceEdits(previous, edits), source => {
      const state = currentStateOf(previous)
      const products = isolatedProducts(source, state.markdownOptions)
      return markupProjectionOf(products, annotationsOf(products).rangeByNodeId, source.length).syntax
    }, edits => withSourceEditPreview(previous, edits, (products, source) =>
      markupProjectionOf(products, annotationsOf(products).rangeByNodeId, source.length).syntax), edits =>
      createMarkupCompoundSourceEdits(core, previous, edits, candidate => previewSourceEdits(previous, candidate), false, 'structure'),
    () => state.productStore.withProduct(products => products.editing().markdown.lines), {
      syntax: range => regionalInputSyntax(state, range),
      normalization: normalizationReaders(previous),
      compile: inputs => {
        if (inputs.length !== 1) return undefined
        const edits = stableSourceEdits(inputs)
        preflightSourceEdits(state.source.length, edits)
        const edit = edits[0]
        if (edit === undefined) return undefined
        const regional = regionalPayloadEdit(state, edit, false)
        return regional === undefined ? undefined : Object.freeze([regional])
      }
    })
  }

  /** Windows for reading the blocks an edit of `previous` changes (see `normalizeEdits`). */
  const normalizationReaders = (previous: DocumentRevision): EditNormalizationReaders => {
    const state = currentStateOf(previous)
    return {
      syntax: range => regionalInputSyntax(state, range),
      literalBlockRange: position => state.regionalInventory === undefined
        ? undefined
        : regionalInventoryLiteralRange(state.regionalInventory, position),
      armLiteralRange: position => regionalCandidate(state, { start: position, end: position, insert: '' })?.arm?.range,
      parseWindow: (source, atDocumentStart) => {
        const windowCore = createDocumentCoreWithExecutionBudget(executionBudget)
        windowCores.add(windowCore)
        const { schema: _schema, ...options } = state.markdownOptions
        return windowCore.project(windowCore.open(source, atDocumentStart ? options : { ...options, frontMatter: false }), 'markup').syntax
      },
      // Only a revision already read by regions has an inventory; otherwise
      // the document's parse reads the lists around the edit.
      listRange: position => state.regionalInventory === undefined
        ? undefined
        : regionalInventoryListRange(state.regionalInventory, position)
    }
  }

  const tablePreview = (previous: DocumentRevision, edits: readonly DocumentSourceEdit[]) =>
    withSourceEditPreview(previous, edits, (products, source) =>
      ({ syntax: markupProjectionOf(products, annotationsOf(products).rangeByNodeId, source.length).syntax, source }))

  // A Comment payload is its own subdocument under the document's options (R5).
  const payloadDiagnostics = (previous: DocumentRevision) => {
    const { schema: _schema, ...options } = currentStateOf(previous).markdownOptions
    return (payload: string) => createDocumentCore().open(payload, options).diagnostics
  }

  const core: DocumentCore = Object.freeze({
    planAuthor(previous: DocumentRevision, action: DocumentAuthorAction) {
      return planAuthor(core, previous, action, edits => previewSourceEdits(previous, edits), payloadDiagnostics(previous))
    },
    planCommentEdit(previous: DocumentRevision, action: DocumentCommentAction) {
      return planCommentEdit(previous, action, payloadDiagnostics(previous), edits => previewSourceEdits(previous, edits))
    },
    planClipboard(previous: DocumentRevision, action: DocumentClipboardAction) {
      // Cut and paste change only their own bytes, in a table too (ADR 0007;
      // owner decision 25 Sep, plan 0012 G24).
      const plan = planUnspelledClipboard(previous, commentedSpanSafeClipboard(previous, action, at => rootsAround(previous, at)))
      // A tracked plan was normalized before its suggestions were spelled.
      if (action.kind === 'table' || action.tracked) return plan
      const normalized = normalizeEdits(core, previous, plan.edits, action, normalizationReaders(previous))
      return normalized === undefined
        ? plan
        : Object.freeze({ edits: normalized.edits, selection: selectionAfterNormalization(plan.selection, normalized.normalized) })
    },
    normalizeEdits(previous: DocumentRevision, edits: readonly DocumentSourceEdit[], options: EditNormalizationOptions) {
      const stable = stableSourceEdits(edits)
      preflightSourceEdits(currentStateOf(previous).source.length, stable)
      return normalizeEdits(core, previous, stable, options, normalizationReaders(previous))?.edits ?? stable
    },
    planSourceInput(previous: DocumentRevision, action: DocumentSourceInputAction) {
      currentStateOf(previous)
      return planSourceInput(core, previous, action)
    },
    planFormat(previous: DocumentRevision, action: DocumentFormatAction) {
      currentStateOf(previous)
      // Formatting in a table cell changes only its own bytes (ADR 0007).
      return planFormat(core, previous, action, edits => previewSourceEdits(previous, edits),
        edits => withSourceEditPreview(previous, edits, (products, source) =>
          markupProjectionOf(products, annotationsOf(products).rangeByNodeId, source.length).syntax))
    },
    inputEdits(previous: DocumentRevision, action: DocumentInputAction, plan: DocumentInputPlan, tracked: boolean) {
      return keyBudget(previous, () => {
        const planOnce = (): readonly DocumentSourceEdit[] | undefined => {
          currentStateOf(previous)
          action = commentedSpanSafeInput(previous, action, at => rootsAround(previous, at))
          const joinSyntax = 'kind' in action && action.command === 'joinParagraphBackward' ? core.project(previous, 'markup').syntax : undefined
          const codeJoin = joinSyntax !== undefined && paragraphBackwardStructuralTarget(joinSyntax,
            joinSyntax.coordinates.toProjected(inputSourceRange(core, previous, action.selection).start, 'next')) !== undefined
          if ('kind' in action && (action.command === 'moveText' || action.command === 'moveBlock' || action.command === 'moveTableColumn' || action.command === 'moveTableRow')) {
            if (!tracked) {
              return createMarkupCompoundSourceEdits(core, previous, plan.edits,
                edits => previewSourceEdits(previous, edits), true, plan.editScope ?? 'structure')
            }
            const edits: DocumentSourceEdit[] = []
            for (const edit of plan.edits) {
              const pending = action.command === 'moveText'
                ? createTrackedPendingArmEdits(core, previous, [edit], edits =>
                  createMarkupCompoundSourceEdits(core, previous, edits,
                    candidate => previewSourceEdits(previous, candidate), true, plan.editScope ?? 'structure'))
                : undefined
              if (pending !== undefined) {
                edits.push(...pending)
                continue
              }
              const compiled = createTrackedSourceEdit(core, previous, edit,
                edits => previewSourceEdits(previous, edits), true) ??
                (action.command === 'moveText' ? retainedTrackedHistoryEdit(core, previous, edit) : undefined)
              if (compiled === undefined) return undefined
              edits.push(compiled)
            }
            return Object.freeze(edits)
          }
          const resetSyntax = 'kind' in action && (action.command === 'resetCodeBlock' || action.command === 'changeBlock' && action.change.type === 'reset') ? core.project(previous, 'markup').syntax : undefined
          const resetTarget = resetSyntax === undefined ? undefined : findBlockCommandTarget(syntaxPathAt(resetSyntax.ast.root, resetSyntax.coordinates.toProjected('kind' in action && action.command === 'changeBlock' ? action.change.at ?? inputSourceRange(core, previous, action.selection).start : inputSourceRange(core, previous, action.selection).start, 'next')), 'kind' in action && action.command === 'changeBlock' ? action.change.scope : 'leaf')
          if (resetSyntax !== undefined && resetTarget !== undefined && isLiteralBlock(resetTarget.kind)) {
            const first = plan.edits[0]
            const last = plan.edits.at(-1)
            if (first === undefined || last === undefined) return Object.freeze([])
            // A literal reset is one declared operation. Preserve its exact raw
            // payload while removing the parser-owned syntax spans atomically;
            // separate fence suggestions would change the literal context midway.
            const syntax = resetSyntax
            const code = resetTarget
            const start = first.start
            let end = Math.max(last.end, syntax.coordinates.toSource(code.range.end, 'previous'))
            for (const annotation of markupAnnotations(rootsOverlapping(previous, { start, end: last.end }))) {
              for (const arm of annotation.arms) {
                if (arm.range.start <= start && last.end <= arm.range.end) end = Math.min(end, arm.range.end)
              }
            }
            let insert = core.sourceSlice(previous, { start, end })
            for (const edit of [...plan.edits].reverse()) {
              insert = insert.slice(0, edit.start - start) + edit.insert + insert.slice(edit.end - start)
            }
            const replacement = { start, end, insert }
            if (!tracked) {
              return createMarkupCompoundSourceEdits(core, previous, [replacement],
                edits => previewSourceEdits(previous, edits), true)
            }
            const edit = createTrackedSourceEdit(core, previous, replacement,
              edits => previewSourceEdits(previous, edits), true)
            return edit === undefined ? undefined : Object.freeze([edit])
          }
          if (codeJoin || 'kind' in action && (action.command === 'changeBlock' || action.command === 'createFootnote' || action.command === 'setCodeLanguage' || action.command === 'createTable' || action.command === 'createFrontMatter' || action.command === 'changeThematicBreak' || action.command === 'createMathBlock' || action.command === 'createHtmlBlock' || action.command === 'createCodeBlock' || action.command === 'wrapCodeBlocks' || action.command === 'setTaskChecked' && action.autoMoveCheckedToEnd)) {
            if (!tracked) {
              return createMarkupCompoundSourceEdits(core, previous, plan.edits,
                edits => previewSourceEdits(previous, edits), true, 'structure')
            }
            const preview = (edits: readonly DocumentSourceEdit[]) => previewSourceEdits(previous, edits)
            if (plan.edits.length === 1) {
              const edit = createTrackedSourceEdit(core, previous, plan.edits[0]!, preview, true, 'structure')
              return edit === undefined ? undefined : Object.freeze([edit])
            }
            const separate = withDeferredEquivalence(core, () =>
              plan.edits.map(edit => createTrackedSourceEdit(core, previous, edit, preview, true, 'structure')))
            if (separate.every(edit => edit !== undefined) &&
                separate.every((edit, index) => index === 0 || separate[index - 1]!.end <= edit.start) &&
                trackedOperationEquivalent(core, previous,
                  createMarkupCompoundSourceEdits(core, previous, plan.edits, preview, true, 'structure'), separate, preview)) {
              return Object.freeze(separate)
            }
            // The command is one operation: its separate suggestions change
            // meaning, so its complete replacement widens as a single suggestion.
            const first = plan.edits[0]
            const last = plan.edits.at(-1)
            if (first === undefined || last === undefined) return Object.freeze([])
            let insert = core.sourceSlice(previous, { start: first.start, end: last.end })
            for (const edit of [...plan.edits].reverse()) {
              insert = insert.slice(0, edit.start - first.start) + edit.insert + insert.slice(edit.end - first.start)
            }
            const joined = createTrackedSourceEdit(core, previous, { start: first.start, end: last.end, insert }, preview, true, 'structure')
            return joined === undefined ? undefined : Object.freeze([joined])
          }
          if (!tracked && 'kind' in action && (action.command === 'removeTableRow' || action.command === 'removeTableColumn' || action.command === 'tableBoundaryBackspace' || (action.command === 'changeHeading' || action.command === 'changeBlockquote') && action.change.type === 'quick-insert')) {
            return createMarkupCompoundSourceEdits(core, previous, plan.edits,
              edits => previewSourceEdits(previous, edits), false, 'structure')
          }
          return planNativeEdits(previous, plan.edits, tracked,
            !('kind' in action) && typedInputTypes.has(action.inputType))
        }
        // Every keystroke is applied, with Track Changes on or off (owner
        // decision, 9 October 2026: always apply): one no compile reads as an
        // edit of the markup is applied as typed, breaking a suggestion's
        // markers into plain text where it must.
        // A tracked command no plan holds is applied as its plan writes it, as
        // a keystroke is: Core plans every tracked operation (B17).
        const keystroke = !('kind' in action)
        const appliesAsTyped = keystroke || tracked
        const asTyped = (): readonly DocumentSourceEdit[] | undefined => {
          if (!appliesAsTyped) return undefined
          inspection.keystrokesAppliedAsTyped += 1
          return Object.freeze(plan.edits.map(edit => Object.freeze({ ...edit })))
        }
        // An operation the compile refuses as an invalid edit of the markup is
        // one no plan holds.
        const tryPlan = (): readonly DocumentSourceEdit[] | undefined => {
          try {
            return planOnce()
          } catch (error) {
            if (appliesAsTyped && error instanceof RangeError) return undefined
            throw error
          }
        }
        // A tracked keystroke that cuts a suggestion's marker keeps a plan only
        // where Reject All still gives the document as it was: one that cuts no
        // marker itself and holds no whole suggestion in its arms, as one that
        // moves the typing out of a hidden marker, does; any other is read
        // whole. Otherwise the keystroke is recorded exactly or applied as
        // typed, the same way whichever planner reads it (vision principle 7).
        const cutting = (edits: readonly DocumentSourceEdit[]): boolean => edits.some(edit =>
          cutsMarker(rootsOverlapping(previous, { start: Math.max(0, edit.start - 3), end: Math.min(previous.sourceLength, edit.end + 3) }), edit))
        const splitting = tracked && keystroke && cutting(plan.edits)
        const rejectsExactly = (edits: readonly DocumentSourceEdit[]): boolean => {
          const holds = edits.some(edit => edit.start < edit.end &&
            rootsOverlapping(previous, edit).some(root => edit.start <= root.range.start && root.range.end <= edit.end))
          if (!holds && !cutting(edits)) return true
          const candidate = previewSourceEdits(previous, edits, false, true)
          return resolvedSuggestions(candidate.source, candidate.annotations, 'reject') ===
            resolvedSuggestions(previous.source, previous.annotations, 'reject')
        }
        const searched = tryPlan()
        const planned = splitting && searched !== undefined && searched.length > 0 && !rejectsExactly(searched) ? undefined : searched
        if (planned !== undefined || equivalenceDeferred(core)) return planned
        // An operation that changes no text, as Backspace the plan reads as
        // only moving the caret, is planned as no edit.
        if (plan.edits.every(edit => core.sourceSlice(previous, edit) === edit.insert)) return Object.freeze([])
        if (!tracked) return asTyped()
        // A tracked operation no plan holds takes the closest spelling of its
        // whole edit.
        const first = plan.edits[0]
        const last = plan.edits.at(-1)
        if (first === undefined || last === undefined) return undefined
        let insert = ''
        let cursor = first.start
        for (const edit of plan.edits) {
          insert += core.sourceSlice(previous, { start: cursor, end: edit.start }) + edit.insert
          cursor = edit.end
        }
        const whole = Object.freeze({ start: first.start, end: last.end, insert })
        const closest = splitting ? undefined : closestTrackedEdit(previous, whole)
        if (closest !== undefined) return Object.freeze([closest])
        // A search the key's budget stopped is run once more without it, so no
        // keystroke is applied as typed where a spelling exists.
        if (!splitting && documentSearchExhausted(core)) {
          const full = withoutDocumentSearchBudget(core, () => {
            const replanned = tryPlan()
            if (replanned !== undefined) return replanned
            const spelled = closestTrackedEdit(previous, whole)
            return spelled === undefined ? undefined : Object.freeze([spelled])
          })
          if (full !== undefined) return full
        }
        let recorded: DocumentSourceEdit | undefined
        try {
          // The record is weighed in full, so no keystroke is applied as typed
          // where one exists.
          recorded = withoutDocumentSearchBudget(core, () => closestTrackedEdit(previous, whole, true))
        } catch (error) {
          if (!appliesAsTyped || !(error instanceof RangeError)) throw error
        }
        // A record Reject All cannot undo is no record of the keystroke.
        if (recorded !== undefined && rejectsExactly([recorded])) return Object.freeze([recorded])
        // No record holds the keystroke at all, as `$$` typed inside an
        // opener re-pairs the math around a suggestion's markers: it is
        // applied as typed, which undo restores and Reject All cannot remove.
        return asTyped()
      })
    },
    planInput(previous: DocumentRevision, action: DocumentInputAction, options?: { readonly tracked?: boolean }) {
      const state = currentStateOf(previous)
      action = commentedSpanSafeInput(previous, action, at => rootsAround(previous, at))
      if ('inputType' in action) preflightSourceEdits(state.source.length, stableSourceEdits([{ ...inputSourceRange(core, previous, action.range), insert: action.data ?? '' }]))
      preflightSourceEdits(state.source.length, stableSourceEdits([{ ...inputSourceRange(core, previous, action.selection), insert: '' }]))
      // A plan read from a window may write only between the window's first
      // and last blocks, which read there as in the document; one that
      // writes beyond them, as a list rewritten as a whole, is planned
      // again from the document.
      const interiors: SourceRange[] = []
      const interiorOf = (syntax: MarkupSyntax): void => {
        const blocks = syntax.ast.root.children.flatMap(child => child.kind === 'list' ? child.children : [child])
        const first = blocks[0]
        const last = blocks.at(-1)
        // The window's own bounds include markers its projection elides.
        const start = syntax.coordinates.toSource(syntax.ast.root.range.start, 'previous')
        const end = syntax.coordinates.toSource(syntax.ast.root.range.end, 'next')
        // A window of one block is that block alone, proven as it reads in
        // place, as is a leaf read alone.
        const alone = blocks.length < 2 || wholeLeafSyntaxes.has(syntax)
        interiors.push({
          start: start === 0 || first === undefined ? 0 : alone || cleanStartSyntaxes.has(syntax) ? start : syntax.coordinates.toSource(first.range.end, 'previous'),
          end: end === state.source.length || last === undefined
            ? state.source.length
            : alone || cleanEndSyntaxes.has(syntax) ? end : syntax.coordinates.toSource(last.range.start, 'next')
        })
      }
      const planned = (regional: boolean) => planInput(core, previous, action, range => state.productStore.withProduct(products =>
        paragraphEnterConversion(products.editing().source, range.start, range.end, state.markdownOptions.texMathDollars)),
      () => state.productStore.withProduct(products => products.editing().markdown.lines),
      range => {
        if (!regional) return undefined
        const syntax = regionalInputSyntax(state, range)
        if (syntax !== undefined) interiorOf(syntax)
        return syntax
      }, options?.tracked === false, edits => tablePreview(previous, edits),
      position => {
        if (!regional) return undefined
        const context = regionalBlockContext(state, position)
        if (context?.cleanStart === true) cleanStartSyntaxes.add(context.syntax)
        if (context?.cleanEnd === true) cleanEndSyntaxes.add(context.syntax)
        if (context?.wholeLeaf === true) wholeLeafSyntaxes.add(context.syntax)
        if (context !== undefined) interiorOf(context.syntax)
        return context
      })
      let plan = planned(true)
      if ([...plan.edits, ...plan.reconciliation].some(edit =>
        interiors.some(interior => edit.start < interior.start || edit.end > interior.end))) plan = planned(false)
      // Normalizations read whole blocks and lists through their own readers,
      // so they follow the window check and never send a key to the document
      // parse; a tracked input suggests them with the edit.
      plan = normalizeInputPlan(core, previous, action, plan, normalizationReaders(previous))
      return options?.tracked === true ? trackedInputPlan(previous, action, plan) : plan
    },
    reconcileInput(previous: DocumentRevision, policy: DocumentInputPlan, commit: DocumentCommit | null, action: DocumentInputAction) {
      if (!stateByRevision.has(previous) || commit !== null && !stateByRevision.has(commit.revision)) throw new Error('Document revision belongs to another core')
      return reconcileInput(core, previous, policy, commit, commentedSpanSafeInput(previous, action, at => rootsAround(previous, at)))
    },
    editingReconciliation(previous: DocumentRevision, input: DocumentSourceEdit, commit: DocumentCommit) {
      const previousState = stateByRevision.get(previous)
      if (previousState === undefined || !stateByRevision.has(commit.revision)) throw new Error('Document revision belongs to another core')
      const edits = stableSourceEdits([input])
      preflightSourceEdits(previousState.source.length, edits)
      const edit = edits[0]
      if (edit === undefined) throw new Error('Editing reconciliation input is missing')
      return editingReconciliation(core, previous, edit, commit, 'visible')
    },
    markupEdits(previous: DocumentRevision, edits: readonly DocumentSourceEdit[]) {
      return planNativeEdits(previous, edits, false)
    },

    trackedEdits(previous: DocumentRevision, edits: readonly DocumentSourceEdit[]) {
      return planNativeEdits(previous, edits, true)
    },

    markupEdit(previous: DocumentRevision, edit: DocumentSourceEdit): readonly DocumentSourceEdit[] | undefined {
      const state = currentStateOf(previous)
      const edits = stableSourceEdits([edit])
      preflightSourceEdits(state.source.length, edits)
      const stableEdit = edits[0]
      if (stableEdit === undefined) throw new Error('Markup source edit is missing')
      const regional = regionalPayloadEdit(state, stableEdit, false) ??
        regionalUntrackedBreak(state, previous, stableEdit) ?? regionalUntrackedEmptied(state, previous, stableEdit) ??
        regionalUntrackedBeside(state, previous, stableEdit)
      if (regional !== undefined) return Object.freeze([regional])
      const windowed = windowedGeneralEdits(state, previous, [stableEdit], (windowCore, revision, [local], windowPreview) =>
        local === undefined ? undefined : createMarkupSourceEdits(windowCore, revision, local, windowPreview))
      if (windowed !== undefined) return windowed.edits
      return createMarkupSourceEdits(core, previous, stableEdit,
        candidateEdits => previewSourceEdits(previous, candidateEdits))
    },

    trackedEdit(
      previous: DocumentRevision,
      edit: DocumentSourceEdit
    ): DocumentSourceEdit | undefined {
      return keyBudget(previous, () => {
        const parts = trackedEditParts(previous, edit)
        if (parts !== undefined) return joinedTrackedEdit(core, previous, edit.start, parts)
        // A detached lineage weighing parts of one operation spells the whole
        // operation itself when a part has no spelling.
        return equivalenceDeferred(core) ? undefined : closestTrackedEdit(previous, edit)
      })
    },

    track(
      previous: DocumentRevision,
      edit: DocumentSourceEdit,
      options?: DocumentApplyOptions
    ): DocumentCommit {
      const planned = core.trackedEdit(previous, edit)
      if (planned === undefined) {
        throw new DocumentSourceEditError('Tracked edit crosses unsupported syntax boundaries')
      }
      return core.apply(previous, [planned], options)
    },

    open(
      source: string,
      options?: Readonly<Partial<MarkdownOptions>>
    ): DocumentRevision {
      if (typeof source !== 'string') {
        throw new TypeError('Document source must be a string')
      }
      const resolvedOptions = markdownOptions(options)
      demoteCurrentProductStore()
      reuseCache = createProfile1DocumentReuseCache()
      const products = parse(source, resolvedOptions)
      const canonical = createPersistentCanonicalSource(source, sourceRecorder)
      dollarFreeSources.set(canonical, !source.includes('$'))
      return publish(canonical, products, resolvedOptions)
    },

    apply(
      previous: DocumentRevision,
      edits: readonly DocumentSourceEdit[],
      options?: DocumentApplyOptions
    ): DocumentCommit {
      const previousState = currentStateOf(previous)
      const stableEdits = stableSourceEdits(edits)
      preflightSourceEdits(previousState.source.length, stableEdits)
      const projectionRequests = normalizeProjectionRequests(
        options?.projections
      )
      rejectSurrogateSplits(previousState.source, stableEdits)
      const writtenEdits = editsWithinOneList(previousState, stableEdits)
      let source: PersistentCanonicalSource
      try {
        source = previousState.source.applyExact(
          writtenEdits,
          'Document core source edit'
        )
      } catch (error) {
        if (error instanceof RangeError) {
          throw new DocumentSourceEditError(error.message)
        }
        throw error
      }
      const regional = tryRegionalApply(
        previousState,
        source,
        writtenEdits,
        options,
        projectionRequests
      )
      if (regional?.kind === 'applied') {
        return Object.freeze({
          revision: regional.revision,
          change: Object.freeze({
            appliedEdits: stableEdits,
            projections: withRegionContext(previousState, regional.projections)
          })
        })
      }
      const previewed = options?.markdown === undefined ? previewedCandidate(previous, stableEdits) : undefined
      previewedCandidates = undefined
      const revision = previewed !== undefined
        ? (demoteCurrentProductStore(), publish(source, previewed.products, previousState.markdownOptions))
        : applyCandidate(
          previousState,
          source,
          stableEdits,
          options?.markdown,
          regional?.kind === 'fallback' &&
          regional.reason === 'source-fragmentation-rebase'
            ? 'rebase'
            : 'fallback'
        )
      const resynchronizationReason = regional?.kind === 'fallback'
        ? regional.reason
        : projectionRequests === undefined
          ? undefined
          : 'structural-region-ineligible'
      return Object.freeze({
        revision,
        change: Object.freeze({
          appliedEdits: stableEdits,
          projections: regional?.kind === 'fallback'
            ? regional.projections
            : Object.freeze([]),
          ...(resynchronizationReason === undefined
            ? {}
            : {
              resynchronization: Object.freeze({
                kind: 'source' as const,
                scope: 'document' as const,
                reason: resynchronizationReason,
                source: revision.source
              })
            })
        })
      })
    },

    resolve(
      previous: DocumentRevision,
      annotation: CriticMarkupAnnotation,
      decision: DocumentResolutionDecision,
      options?: DocumentApplyOptions
    ): DocumentCommit {
      const previousState = currentStateOf(previous)
      if (annotation === null || typeof annotation !== 'object') {
        throw new TypeError('Document annotation is malformed')
      }
      const edit = resolutionEdit(previousState, annotation, decision)
      return core.apply(previous, commentPairPreservingResolution(previous.annotations, [edit],
        range => previousState.source.slice(range.start, range.end)), options)
    },

    sourceSlice(revision: DocumentRevision, range: SourceRange): string {
      const state = stateByRevision.get(revision)
      if (state === undefined) {
        throw new Error('Document revision belongs to another core')
      }
      if (
        range === null || typeof range !== 'object' ||
        !Number.isInteger(range.start) || !Number.isInteger(range.end) ||
        range.start < 0 || range.end < range.start ||
        range.end > state.source.length
      ) {
        throw new RangeError('Document source slice range is invalid')
      }
      return state.source.slice(range.start, range.end)
    },

    reopen(
      previous: DocumentRevision,
      source: string,
      edits: readonly DocumentSourceEdit[],
      options?: Readonly<Partial<MarkdownOptions>>
    ): DocumentRevision {
      const previousState = currentStateOf(previous)
      if (typeof source !== 'string') {
        throw new TypeError('Document source must be a string')
      }

      const stableEdits = stableSourceEdits(edits)
      preflightSourceEdits(previousState.source.length, stableEdits)
      rejectSurrogateSplits(previousState.source, stableEdits)
      let candidate: PersistentCanonicalSource
      try {
        candidate = previousState.source.applyExact(
          stableEdits,
          'Document core source edit'
        )
      } catch (error) {
        if (error instanceof RangeError) {
          throw new DocumentSourceEditError(error.message)
        }
        throw error
      }
      const reproduced = candidate.materialize('reopen')
      inspection.sourceReopenComparisonUnits += reproduced.length
      if (reproduced !== source) {
        throw new Error(
          'Document core reopen source does not match its exact edits'
        )
      }
      return applyCandidate(
        previousState,
        candidate,
        stableEdits,
        options,
        'reopen'
      )
    },

    sourceSyntax(revision: DocumentRevision) {
      const markup = projectRevision(revision, 'markup')
      const state = stateByRevision.get(revision)
      if (state === undefined) throw new Error('Document revision belongs to another core')
      return withFacts(state, facts => sourceSyntaxSpans(markup, revision.annotations, comment => {
        const nodeId = facts.nodeIdByAnnotation.get(comment)
        if (nodeId === undefined) throw new Error('Comment does not belong to this revision')
        const projected = facts.products.commentEditing(nodeId)
        return Object.freeze({
          kind: 'comment' as const,
          annotationRange: comment.range,
          markdown: projected.source,
          ast: markdownAstOf(projected),
          coordinates: projectionCoordinatesOf(projected, state.source.length)
        })
      }), revision === currentRevision)
    },
    project: projectRevision,
    projectComment: projectCommentView,
    intersectsProjection,
    projectAround
  })
  registerAnnotationsAround(core, { around: rootsAround, overlapping: rootsOverlapping })
  sourceEditPreviews.set(core, previewSourceEdits)
  nativeEditPlanners.set(core, planNativeEdits)
  registerRegionalLeaves(core, revision => {
    const state = stateByRevision.get(revision as DocumentRevision)
    const inventory = state === undefined ? undefined : state.regionalInventory ?? convertedRegionalInventory(state)
    return inventory === undefined ? undefined : regionalInventoryLeaves(inventory)
  })
  registerDocumentCoreInspection(core, () => {
    const documentPhysical = physicalRecorder.counts()
    const regionalPhysical = regionalPhysicalRecorder.counts()
    const currentState = currentRevision === undefined
      ? undefined
      : stateByRevision.get(currentRevision)
    return Object.freeze({
      ...inspection,
      sourceRopeCurrentHeight: currentState?.source.height ?? 0,
      sourceRopeCurrentPieces: currentState?.source.pieceCount ?? 0,
      sourceCurrentRetainedBufferUnitsUpperBound:
        currentState?.source.retainedBufferUnitsUpperBound ?? 0,
      intrinsicSourceUnits: documentPhysical.intrinsicSourceUnits,
      regionalIntrinsicSourceUnits: regionalPhysical.intrinsicSourceUnits,
      regionalCommentProjectionPreparationUnits:
        regionalPhysical.commentProjectionPreparationUnits,
      retainedFactInputStructuralUnits:
        documentPhysical.retainedFactInputStructuralUnits +
        regionalPhysical.retainedFactInputStructuralUnits,
      retainedFactOutputStructuralUnits:
        documentPhysical.retainedFactOutputStructuralUnits +
        regionalPhysical.retainedFactOutputStructuralUnits,
      documentRetainedFactOutputStructuralUnits:
        documentPhysical.retainedFactOutputStructuralUnits
    })
  })
  trackedRegionalReadings.set(core, trackedRegionalReading)
  // Projection text is not a revision of this core, so it reads on its own.
  trackedMarkdownSignatures.set(core, markdown => {
    const products = isolatedProducts(markdown, markdownOptions())
    return projectionSignature(markdownAstOf(products.revised).root)
  })
  // A window core previews a candidate by parsing its whole document, whose
  // annotations the intrinsic pass settles before any view is projected:
  // resolving one suggestion of a candidate is weighed by that pass alone.
  trackedRootCounts.set(core, (previous, edits) => {
    if (!windowCores.has(core) || previous.sourceLength > WINDOW_WHOLE_PREVIEW_UNITS || plansFromGeneralCompile(core)) return undefined
    const state = currentStateOf(previous)
    const stableEdits = stableSourceEdits(edits)
    preflightSourceEdits(state.source.length, stableEdits)
    const cached = previewedCandidate(previous, stableEdits)
    if (cached !== undefined) return cached.reader.criticMarkup.rootCount
    const source = state.source.applyExact(stableEdits, 'Authoring candidate').materialize('fallback')
    const reusable = !editsMayRepairMath(state.source, { length: source.length, slice: (start: number, end: number) => source.slice(start, end) }, stableEdits, state.markdownOptions)
    const retained = reusable ? state.productStore.withRetained(products => products.retainedIntrinsic) : undefined
    return profile1CriticMarkupRootCount(source, executionBudget, state.markdownOptions, physicalRecorder,
      retained === undefined ? undefined : { retained, edits: stableEdits })
  })
  trackedAnnotatedViews.set(core, source => {
    inspection.documentParses += 1
    inspection.documentParseSourceUnits += source.length
    inspection.documentProjectionPreparationUnits += source.length
    const products = parseProfile1Document(source, executionBudget, undefined, markdownOptions(), false, undefined,
      createProfile1DocumentReuseCache(), physicalRecorder, undefined, true, true)
    if (products.kind !== 'complete') throw documentCoreError(products.fatalDiagnostic)
    return Object.freeze({
      original: products.original.source,
      revised: products.revised.source,
      revisedView: projectionSignature(markdownAstOf(products.revised).root)
    })
  })
  return core
}
