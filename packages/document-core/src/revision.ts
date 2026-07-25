import type { SourceSnapshot } from './sourceSnapshot.js'

declare const sourceOffsetBrand: unique symbol

export type SourceOffset = number & {
  readonly [sourceOffsetBrand]: 'SourceOffset'
}

export interface SourceRange {
  /** Inclusive UTF-16 code-unit offset. */
  readonly start: SourceOffset
  /** Exclusive UTF-16 code-unit offset. */
  readonly end: SourceOffset
}

export interface CriticMarkupArm<Name extends 'content' | 'old' | 'new' | 'comment'> {
  readonly name: Name
  readonly range: SourceRange
  readonly children: readonly CriticMarkupNode[]
}

export interface UnaryCriticNode<
  Kind extends 'addition' | 'deletion' | 'highlight' | 'comment',
  Arm extends 'content' | 'comment'
> {
  readonly kind: Kind
  readonly range: SourceRange
  readonly markers: Readonly<{
    readonly open: SourceRange
    readonly close: SourceRange
  }>
  readonly arms: readonly [CriticMarkupArm<Arm>]
}

export interface SubstitutionNode {
  readonly kind: 'substitution'
  readonly range: SourceRange
  readonly markers: Readonly<{
    readonly open: SourceRange
    readonly separator: SourceRange
    readonly close: SourceRange
  }>
  readonly arms: readonly [CriticMarkupArm<'old'>, CriticMarkupArm<'new'>]
}

export type CriticMarkupNode =
  | UnaryCriticNode<'addition', 'content'>
  | UnaryCriticNode<'deletion', 'content'>
  | SubstitutionNode
  | UnaryCriticNode<'highlight', 'content'>
  | UnaryCriticNode<'comment', 'comment'>

export interface CriticMarkupForest {
  readonly rootCount: number
  /** @throws RangeError outside [0, rootCount). */
  readonly rootAt: (ordinal: number) => CriticMarkupNode
}

export type SyntaxDiagnosticCode =
  | 'CM_UNMATCHED_CLOSER'
  | 'CM_NON_TOP_CLOSER'
  | 'CM_UNTERMINATED_OPENER'
  | 'CM_SUBSTITUTION_SEPARATOR_MISSING'

export interface SyntaxDiagnostic {
  readonly code: SyntaxDiagnosticCode
  readonly range: SourceRange
  readonly metadata: Readonly<Record<string, string>>
}

export interface DiagnosticIndex {
  readonly count: number
  /** @throws RangeError when the ordinal is not an available integer. */
  readonly at: (ordinal: number) => SyntaxDiagnostic
}

export interface ProjectionProvenance {
  /**
   * Returns the origin of one projected UTF-16 code unit.
   *
   * @throws RangeError when the offset is not an integer in the projection.
   */
  readonly originAt: (projectedOffset: number) => ProjectedCodeUnitOrigin
}

interface CanonicalProjectedCodeUnitOrigin {
  readonly kind: 'canonical'
  readonly sourceOffset: SourceOffset
}

interface GeneratedProjectedCodeUnitOrigin {
  readonly kind: 'generated'
  readonly sourcePosition: SourceOffset
  readonly affinity: 'previous' | 'next'
}

export type ProjectedCodeUnitOrigin =
  | CanonicalProjectedCodeUnitOrigin
  | GeneratedProjectedCodeUnitOrigin

export interface ViewRange {
  readonly start: number
  readonly end: number
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

export interface MarkdownNode {
  readonly kind: MarkdownNodeKind
  readonly range: ViewRange
  readonly attributes: Readonly<Record<string, string | number | boolean>>
  readonly childCount: number
  /** @throws RangeError when the ordinal is not an available integer. */
  readonly childAt: (ordinal: number) => MarkdownNode
}

export interface MarkdownDocument {
  readonly source: string
  readonly root: MarkdownNode
  /** @throws RangeError when the offset is not a position in this document. */
  readonly nodeAt: (
    projectedOffset: number,
    affinity: 'previous' | 'next'
  ) => readonly MarkdownNode[]
}

export interface ProjectedMarkdown {
  /** Boundary-safe projected Markdown source, before Markdown rendering. */
  readonly source: string
  readonly provenance: ProjectionProvenance
  readonly markdown: MarkdownDocument
}

export type MarkupMark =
  | Readonly<{ readonly kind: 'addition' }>
  | Readonly<{ readonly kind: 'deletion' }>
  | Readonly<{ readonly kind: 'substitution'; readonly arm: 'old' | 'new' }>
  | Readonly<{ readonly kind: 'highlight' }>

export interface MarkupProjectionRun {
  readonly text: string
  readonly sourceRange: SourceRange
  /** Ordered outermost to innermost. */
  readonly marks: readonly MarkupMark[]
}

export interface MarkupProjection {
  /**
   * Ordered, source-mapped display runs. This is deliberately not one Markdown
   * source lane: Comment elisions and Substitution alternatives remain typed
   * discontinuities and must not be reparsed as concatenated text.
   */
  readonly runCount: number
  /** @throws RangeError outside [0, runCount). */
  readonly runAt: (ordinal: number) => MarkupProjectionRun
}

export type MarkdownLiteralProvider =
  | 'inline-code'
  | 'fenced-code'
  | 'indented-code'
  | 'html-block'
  | 'inline-html'
  | 'autolink'
  | 'link-destination'
  | 'definition'
  | 'front-matter'
  | 'math'
  | 'diagram'

export type SourceOwner =
  | Readonly<{
    readonly kind: 'critic-marker'
    readonly form: CriticMarkupNode['kind']
    readonly role: 'open' | 'separator' | 'close'
    readonly nodeRange: SourceRange
  }>
  | Readonly<{
    readonly kind: 'markdown-literal'
    readonly provider: MarkdownLiteralProvider
    readonly ownerRange: SourceRange
  }>
  | Readonly<{ readonly kind: 'markdown-text' }>
  | Readonly<{
    readonly kind: 'trivia'
    readonly role: 'virtual-bom' | 'line-ending'
    readonly spelling?: 'lf' | 'cr' | 'crlf'
  }>

export interface SourceOwnershipRun {
  readonly range: SourceRange
  readonly owner: SourceOwner
}

export interface SourceOwnershipIndex {
  readonly count: number
  /** @throws RangeError when the ordinal is not an available integer. */
  readonly at: (ordinal: number) => SourceOwnershipRun
  /** @throws RangeError when the offset is not a canonical UTF-16 code unit. */
  readonly ownerAt: (sourceOffset: number) => SourceOwnershipRun
}

export type CriticMarkupProfileId = string
export type MarkdownProfileId = string
export type LiveHtmlSafetyProfileId = string

export interface ExecutionBudgetId {
  readonly limitsProfile: string
  readonly accountingSchema: string
}

export interface ParseConfiguration {
  readonly criticMarkupProfile: CriticMarkupProfileId
  readonly markdownProfile: MarkdownProfileId
  readonly liveHtmlSafetyProfile: LiveHtmlSafetyProfileId
  readonly executionBudget: ExecutionBudgetId
}

export interface CompleteDocumentRevision {
  readonly kind: 'complete'
  readonly source: SourceSnapshot
  readonly configuration: ParseConfiguration
  readonly criticMarkup: CriticMarkupForest
  readonly diagnostics: DiagnosticIndex
  readonly ownership: SourceOwnershipIndex
  readonly markup: MarkupProjection
  readonly projection: (view: 'original' | 'revised' | 'editing') => ProjectedMarkdown
}

export type ResourceDiagnosticCode =
  | 'CM_RESOURCE_SOURCE_UNITS_EXCEEDED'
  | 'CM_RESOURCE_LOGICAL_NODES_EXCEEDED'
  | 'CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED'
  | 'CM_RESOURCE_CM_DEPTH_EXCEEDED'

export interface ResourceDiagnostic {
  readonly kind: 'resource'
  readonly code: ResourceDiagnosticCode
  readonly range: SourceRange
  readonly metadata: Readonly<Record<string, string>>
}

export interface SourceOnlyDocumentRevision {
  readonly kind: 'source-only'
  readonly source: SourceSnapshot
  readonly configuration: ParseConfiguration
  readonly fatalDiagnostic: ResourceDiagnostic
}

export type DocumentRevision = CompleteDocumentRevision | SourceOnlyDocumentRevision
