import type { SourceSnapshot } from './sourceSnapshot.js'
import type {
  RevisionSemanticHashV1,
  SourceHashV1
} from './hashCodec.js'

declare const sourceOffsetBrand: unique symbol
declare const nodeIdBrand: unique symbol

export type SourceOffset = number & {
  readonly [sourceOffsetBrand]: 'SourceOffset'
}

/**
 * Opaque identity of one parser-emitted node within a Document revision.
 *
 * NodeId values are comparable only inside their owning revision. Views retain
 * a NodeId when they read the same emitted structure at different projected
 * offsets; a structurally divergent fork receives distinct values.
 */
export type NodeId = string & {
  readonly [nodeIdBrand]: 'NodeId'
}

export interface SourceRange {
  /** Inclusive UTF-16 code-unit offset. */
  readonly start: SourceOffset
  /** Exclusive UTF-16 code-unit offset. */
  readonly end: SourceOffset
}

export interface CriticMarkupArm<Name extends 'content' | 'old' | 'new' | 'comment'> {
  readonly nodeId: NodeId
  readonly name: Name
  readonly range: SourceRange
  readonly children: readonly CriticMarkupNode[]
}

export interface UnaryCriticNode<
  Kind extends 'addition' | 'deletion' | 'highlight' | 'comment',
  Arm extends 'content' | 'comment'
> {
  readonly nodeId: NodeId
  readonly kind: Kind
  readonly range: SourceRange
  readonly markers: Readonly<{
    readonly open: SourceRange
    readonly close: SourceRange
  }>
  readonly arms: readonly [CriticMarkupArm<Arm>]
}

export interface SubstitutionNode {
  readonly nodeId: NodeId
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
  /**
   * Reports whether any canonical source code unit in the half-open range is
   * retained by this projection.
   *
   * This range query is parser-emitted provenance authority. Consumers must
   * not recover it by walking every projected code unit.
   *
   * @throws RangeError when either boundary is not a nonnegative integer or
   * when `sourceEnd` precedes `sourceStart`.
   */
  readonly canonicalSourceRangeIntersects: (
    sourceStart: number,
    sourceEnd: number
  ) => boolean
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

export type Profile1SyntaxNodeKind =
  | MarkdownNodeKind
  | CriticMarkupNode['kind']
  | 'critic-arm'
  | 'source-leaf'

export interface Profile1SyntaxNode {
  readonly nodeId: NodeId
  readonly kind: Profile1SyntaxNodeKind
  readonly range: SourceRange
}

export type Profile1SyntaxEdgeKind =
  | 'contains'
  | 'critic-arm'
  | 'marker'
  | 'fork-alternative'
  | 'reference'

export interface Profile1SyntaxEdge {
  readonly kind: Profile1SyntaxEdgeKind
  readonly from: NodeId
  readonly to: NodeId
  readonly role?: string
}

/**
 * Lossless parser-emitted graph. Semantic forests, projected Markdown trees,
 * ownership, and Review products retain identities from this graph.
 */
export interface Profile1SyntaxGraph {
  readonly root: NodeId
  readonly nodeCount: number
  /** @throws RangeError when the ordinal is not available. */
  readonly nodeAt: (ordinal: number) => Profile1SyntaxNode
  readonly edgeCount: number
  /** @throws RangeError when the ordinal is not available. */
  readonly edgeAt: (ordinal: number) => Profile1SyntaxEdge
}

export interface MarkdownNode {
  readonly nodeId: NodeId
  readonly kind: MarkdownNodeKind
  readonly range: ViewRange
  readonly attributes: Readonly<Record<string, string | number | boolean>>
  readonly childCount: number
  /** @throws RangeError when the ordinal is not an available integer. */
  readonly childAt: (ordinal: number) => MarkdownNode
}

export interface MarkdownReferenceDefinitionFact {
  readonly label: string
  readonly node: MarkdownNode
  /** Parser-owned destination content, before Markdown text decoding. */
  readonly destination: string
  /** Parser-owned title content, before Markdown text decoding. */
  readonly title?: string
}

export interface MarkdownLinkFact {
  readonly node: MarkdownNode
  /** Parser-owned destination content, before Markdown text decoding. */
  readonly destination: string
  /** Parser-owned title content, before Markdown text decoding. */
  readonly title?: string
  /** Present exactly when this link/image resolves through a definition. */
  readonly definition?: MarkdownReferenceDefinitionFact
}

export interface MarkdownFootnoteDefinitionFact {
  readonly label: string
  readonly node: MarkdownNode
}

export interface MarkdownFootnoteReferenceFact {
  readonly label: string
  readonly node: MarkdownNode
  /** Present exactly when this reference resolves in this projection. */
  readonly definition?: MarkdownFootnoteDefinitionFact
}

/**
 * Parser-emitted, projection-specific reference facts.
 *
 * The accessors close over immutable parser products rather than exposing
 * mutable Map instances. Definition selection, link resolution, and footnote
 * encounter order therefore have one authority for every consumer.
 */
export interface MarkdownReferenceIndex {
  readonly definitionCount: number
  /** @throws RangeError when the ordinal is not available. */
  readonly definitionAt: (ordinal: number) => MarkdownReferenceDefinitionFact
  readonly definitionForLabel: (
    normalizedLabel: string
  ) => MarkdownReferenceDefinitionFact | undefined
  readonly linkCount: number
  /** @throws RangeError when the ordinal is not available. */
  readonly linkAt: (ordinal: number) => MarkdownLinkFact
  readonly linkForNode: (nodeId: NodeId) => MarkdownLinkFact | undefined
  readonly footnoteDefinitionCount: number
  /** @throws RangeError when the ordinal is not available. */
  readonly footnoteDefinitionAt: (
    ordinal: number
  ) => MarkdownFootnoteDefinitionFact
  readonly footnoteDefinitionForLabel: (
    normalizedLabel: string
  ) => MarkdownFootnoteDefinitionFact | undefined
  readonly footnoteReferenceCount: number
  /** @throws RangeError when the ordinal is not available. */
  readonly footnoteReferenceAt: (
    ordinal: number
  ) => MarkdownFootnoteReferenceFact
}

export interface MarkdownHeadingFact {
  readonly node: MarkdownNode
  readonly nodeId: NodeId
  readonly level: number
}

/** Parser-emitted heading encounter order for one projection. */
export interface MarkdownHeadingIndex {
  readonly count: number
  /** @throws RangeError when the ordinal is not available. */
  readonly at: (ordinal: number) => MarkdownHeadingFact
  readonly forNode: (nodeId: NodeId) => MarkdownHeadingFact | undefined
}

/**
 * One physical line as the parser consumed it. `contentOffset` is where
 * content begins after every block-container prefix on the line — the
 * blockquote markers and list markers the grammar recognized — so consumers
 * never re-derive a prefix with their own recognizer (non-negotiable 2).
 */
export interface MarkdownPhysicalLine {
  readonly start: number
  readonly contentOffset: number
  /** End of content, before the line terminator. */
  readonly contentEnd: number
  /** End including the line terminator. */
  readonly end: number
  readonly blank: boolean
}

export interface MarkdownLineIndex {
  readonly count: number
  /** @throws RangeError when the ordinal is not an available integer. */
  readonly at: (ordinal: number) => MarkdownPhysicalLine
}

export interface MarkdownDocument {
  readonly source: string
  readonly root: MarkdownNode
  readonly references: MarkdownReferenceIndex
  readonly headings: MarkdownHeadingIndex
  /** Parser-emitted physical line structure over this document's source. */
  readonly lines: MarkdownLineIndex
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
  | Readonly<{ readonly nodeId: NodeId; readonly kind: 'addition' }>
  | Readonly<{ readonly nodeId: NodeId; readonly kind: 'deletion' }>
  | Readonly<{
    readonly nodeId: NodeId
    readonly kind: 'substitution'
    readonly arm: 'old' | 'new'
  }>
  | Readonly<{ readonly nodeId: NodeId; readonly kind: 'highlight' }>

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
    readonly nodeId: NodeId
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
export type LiveHtmlSafetyProfileId = 'live-html-sanitized-v1'

export interface MarkdownOptionsV1 {
  readonly schema: 'markdown-options-1'
  readonly gfm: boolean
  readonly frontMatter: boolean
  readonly math: boolean
  readonly gitLabMath: boolean
  readonly footnotes: boolean
  readonly subscriptAndSuperscript: boolean
}

export interface ExecutionBudgetId {
  readonly limitsProfile: string
  readonly accountingSchema: string
}

export interface ParseConfiguration {
  readonly criticMarkupProfile: CriticMarkupProfileId
  readonly markdownProfile: MarkdownProfileId
  readonly markdownOptions: MarkdownOptionsV1
  readonly liveHtmlSafetyProfile: LiveHtmlSafetyProfileId
  readonly executionBudget: ExecutionBudgetId
}

export interface CompleteDocumentRevision {
  readonly kind: 'complete'
  readonly source: SourceSnapshot
  readonly sourceHash: SourceHashV1
  readonly semanticHash: RevisionSemanticHashV1
  readonly configuration: ParseConfiguration
  readonly syntax: Profile1SyntaxGraph
  readonly criticMarkup: CriticMarkupForest
  readonly diagnostics: DiagnosticIndex
  readonly ownership: SourceOwnershipIndex
  readonly markup: MarkupProjection
  /**
   * Lazily reads the Revised display of one Comment payload.
   *
   * @throws RangeError when the identity is not a Comment in this revision.
   */
  readonly commentDisplay: (
    comment: NodeId | UnaryCriticNode<'comment', 'comment'>
  ) => ProjectedMarkdown
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
  readonly sourceHash: SourceHashV1
  readonly semanticHash: RevisionSemanticHashV1
  readonly configuration: ParseConfiguration
  readonly fatalDiagnostic: ResourceDiagnostic
}

export type DocumentRevision = CompleteDocumentRevision | SourceOnlyDocumentRevision
