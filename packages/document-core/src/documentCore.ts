import { createTrackedLiteralSourceEdit, createTrackedSourceEdit, protectNativeCriticText } from './trackedAuthoring.js'
import { createMarkupSourceEdits } from './markupEditing.js'
import {
  admitProfile1PlainParagraphRegion,
  createProfile1DocumentReuseCache,
  parseProfile1Document,
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
  createRegionalInventory,
  materializeRegionalInventoryAnnotations,
  previewRegionalInventory,
  referenceDependencyPrefixEnd,
  type RegionalInventory,
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
  type PersistentCanonicalSource,
  type PersistentCanonicalSourceRecorder
} from './internal/persistentCanonicalSource.js'
import { registerDocumentCoreInspection } from './internal/documentCoreInspection.js'
import {
  createRevisionProductStore,
  type RevisionProductStore
} from './internal/revisionProductStore.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from './resourcePolicy.js'
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
   * Text nodes expose their decoded CommonMark value as `semanticText` while
   * retaining the exact authored spelling through `range`. Inline-code nodes
   * expose `semanticContent`; this differs from `content` when a containing
   * GFM table consumes an escaped pipe. Fenced code blocks expose decoded
   * `semanticInfo` separately from exact `info`. GFM strong nodes expose
   * `semanticFlattenStrongChildren` when directly nested strong wrappers are
   * transparent under the pinned GFM semantics; the delimiter tree and ranges
   * remain lossless.
   *
   * Link, image, and autolink nodes use `rawDestination` and `rawTitle` to
   * retain Markdown source spelling. Their renderer-ready decoded values are
   * exposed as `semanticDestination` and `semanticTitle`. Resolved reference
   * links/images and footnote references use `resolvedDefinitionStart` and
   * `resolvedDefinitionEnd`; every footnote reference also has a `resolved`
   * boolean. Every numeric attribute whose name ends in `Start` or `End` is a
   * UTF-16 position in the projection, and each matching Start/End pair
   * describes a half-open subrange. Editor adapters may use those positions
   * directly without re-recognizing Markdown syntax.
   */
  readonly attributes: Readonly<Record<string, MarkdownAttribute>>
  /** Decoded entity/escape spellings; ranges use the same coordinates as this node. */
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
  readonly math: boolean
  readonly gitLabMath: boolean
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
}

const DEFAULT_MARKDOWN_OPTIONS: MarkdownOptions = Object.freeze({
  gfm: true,
  gfmAutolinks: true,
  gfmTagFilter: true,
  frontMatter: true,
  math: true,
  gitLabMath: false,
  footnotes: false,
  subscriptAndSuperscript: false
})

// Resource and accounting profiles remain private transitional inputs to the
// research parser. They are deliberately absent from the MarkText facade.
const EXECUTION_BUDGET: ExecutionBudgetId = Object.freeze({
  limitsProfile: 'desktop-v1',
  accountingSchema: 'syntax-accounting-1'
})

function markdownOptions(
  options: Readonly<Partial<MarkdownOptions>> = {},
  inherited: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS
): MarkdownOptionsV1 {
  const resolved = Object.freeze({
    gfm: inherited.gfm,
    gfmAutolinks: inherited.gfmAutolinks,
    gfmTagFilter: inherited.gfmTagFilter,
    frontMatter: inherited.frontMatter,
    math: inherited.math,
    gitLabMath: inherited.gitLabMath,
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

function annotationsOf(
  products: Profile1DocumentProducts
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
  }>> = [{ node: root, ready: false, inTable: false }]

  while (pending.length > 0) {
    const task = pending.pop()
    if (task === undefined) break

    if (!task.ready) {
      pending.push({ ...task, ready: true })
      const inTable = task.inTable || task.node.kind === 'table'
      for (let ordinal = task.node.childCount - 1; ordinal >= 0; ordinal -= 1) {
        pending.push({
          node: task.node.childAt(ordinal),
          ready: false,
          inTable
        })
      }
      continue
    }

    const attributes: Record<string, MarkdownAttribute> = {
      ...task.node.attributes
    }
    const semanticTextSegments: Array<{ readonly range: SourceRange, readonly value: string }> = []
    if (task.node.kind === 'text') {
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
      if (typeof info === 'string') {
        attributes.semanticInfo = decodeMarkdownSemanticText(info)
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
  sourceLength: number
): MarkupProjection {
  const publicMarks = new WeakMap<object, MarkupMark>()
  const safePoints = products.retainedIntrinsic?.safePoints ?? Object.freeze([])
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
  products: Profile1DocumentProducts
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
    left.math === right.math &&
    left.gitLabMath === right.gitLabMath &&
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
  fullProductStoresStrongCurrent: number
  fullProductStoresStrongPeak: number
  fullProductStoreReleases: number
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
  let reuseCache: Profile1DocumentReuseCache =
    createProfile1DocumentReuseCache()
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
    fullProductStoresStrongCurrent: 0,
    fullProductStoresStrongPeak: 0,
    fullProductStoreReleases: 0,
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

  const demoteCurrentProductStore = <Result>(
    select?: (products: Profile1DocumentProducts) => Result
  ): Result | undefined => {
    if (currentRevision === undefined) return
    const state = stateByRevision.get(currentRevision)
    if (state === undefined) return
    return state.productStore.demoteStrong(products => select?.(products))
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
        reuseCache,
        physicalRecorder,
        previousPass
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
    return result
  }

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
        dependencyPrefixEnd
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
          if (revision !== currentRevision) demoteCurrentProductStore()
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
        regionalInventory
      }))
      currentRevision = revision
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
    regionalInventory: RegionalInventory | undefined = undefined
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
      productStore,
      annotations: revisionAnnotations
    }))
    currentRevision = revision
    inspection.sourceRopeRootsCommitted += 1
    inspection.retainedCommittedUpdates += 1
    return revision
  }

  const publishInventoryRegional = (
    source: PersistentCanonicalSource,
    resolvedOptions: MarkdownOptionsV1,
    inventory: RegionalInventory,
    regionalComments: RegionalRevisionState['regionalComments'] = Object.freeze([])
  ): DocumentRevision => {
    demoteCurrentProductStore()
    let annotations: readonly CriticMarkupAnnotation[] | undefined
    const inventoryAnnotations = Object.freeze(
      (): readonly CriticMarkupAnnotation[] => {
        if (annotations !== undefined) return annotations
        annotations = materializeRegionalInventoryAnnotations(inventory) as
          readonly CriticMarkupAnnotation[]
        return annotations
      }
    )
    const revision = Object.freeze({
      get source(): string {
        return source.materialize('getter')
      },
      sourceLength: source.length,
      get annotations(): readonly CriticMarkupAnnotation[] {
        return inventoryAnnotations()
      },
      diagnostics: Object.freeze([])
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
      productStore,
      annotations: inventoryAnnotations
    }))
    currentRevision = revision
    inspection.sourceRopeRootsCommitted += 1
    regionalInventoryRecorder.recordRootCommitted()
    return revision
  }

  const withFacts = <Result>(
    state: RevisionState,
    use: (facts: RevisionFacts) => Result,
    retain: boolean = false
  ): Result => {
    return state.productStore.withProduct(products => {
      const annotations = state.annotations(products)
      const materialized = annotationFactsForMaterialized(
        products,
        annotations
      )
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

  const tryInventoryRegionalApply = (
    previousState: RevisionState,
    source: PersistentCanonicalSource,
    stableEdits: readonly DocumentSourceEdit[],
    resolvedOptions: MarkdownOptionsV1,
    requests: NormalizedProjectionRequests
  ): Readonly<{
    readonly kind: 'applied'
    readonly revision: DocumentRevision
    readonly projections: readonly DocumentProjectionChange[]
  }> | Readonly<{
    readonly kind: 'fallback'
    readonly reason: DocumentProjectionFallbackReason
  }> | undefined => {
    const inventory = previousState.regionalInventory
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
    const materialized = materializedFor(admission.nextProducts)
    const markup = markupProjectionOf(
      admission.nextProducts,
      materialized.rangeByNodeId,
      admission.nextWindow.length
    )
    const events = shiftRegionalMarkupEvents(
      markup.events,
      admission.next.source.start
    )
    const syntaxBlocks = Object.freeze(markup.syntax.ast.root.children.map(
      child => shiftMarkdownAstNode(child, admission.next.syntax.start)
    ))
    const markupCoordinates: MarkupCoordinateSegment[] = []
    for (const segment of admission.nextProducts.editing().mappedTape) {
      if (segment.kind !== 'canonical') {
        return Object.freeze({
          kind: 'fallback',
          reason: 'structural-region-ineligible'
        })
      }
      const length = segment.projectedEnd - segment.projectedStart
      markupCoordinates.push(Object.freeze({
        projected: Object.freeze({
          start: admission.next.syntax.start + segment.projectedStart,
          end: admission.next.syntax.start + segment.projectedEnd
        }),
        source: Object.freeze({
          start: admission.next.source.start + segment.sourceStart,
          end: admission.next.source.start + segment.sourceStart + length
        })
      }))
    }
    const projections: DocumentProjectionChange[] = []
    if (requests.markup) {
      const replacement = Object.freeze({
        previous: admission.previous,
        next: Object.freeze({
          source: admission.next.source,
          syntax: admission.next.syntax,
          events: Object.freeze({
            start: admission.previous.events.start,
            end: admission.previous.events.start + events.length
          })
        }),
        events,
        syntaxBlocks,
        coordinates: Object.freeze(markupCoordinates)
      }) satisfies MarkupRegionReplacement
      projections.push(Object.freeze({
        name: 'markup',
        scope: 'regions',
        replacements: Object.freeze([replacement])
      }))
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
    inspection.regionalMarkupEventUnits += events.reduce(
      (total, event) => total + (event.kind === 'text' ? event.text.length : 1),
      0
    )
    inspection.regionalAstMaterializedNodes += syntaxBlocks.reduce(
      (total, block) => total + countMarkdownAstNodes(block),
      0
    )
    inspection.regionalCoordinateSegments += markupCoordinates.length
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
      coordinates: Object.freeze(coordinates)
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
      annotations
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
        coordinates: Object.freeze(coordinates)
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
      coordinates: Object.freeze(coordinates)
    }) satisfies MarkupRegionReplacement
    const revision = publishRegional(
      source,
      resolvedOptions,
      admission.retainedIndex,
      undefined
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
      undefined
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
    if (requests === undefined) return undefined
    const resolvedOptions = options?.markdown === undefined
      ? previousState.markdownOptions
      : markdownOptions(options.markdown, previousState.markdownOptions)
    let fallbackReason: DocumentProjectionFallbackReason | undefined
    if (!sameMarkdownOptions(previousState.markdownOptions, resolvedOptions)) {
      fallbackReason = 'markdown-options-changed'
    } else if (source.requiresFragmentationRebase) {
      fallbackReason = 'source-fragmentation-rebase'
    }
    if (fallbackReason !== undefined) {
      return Object.freeze({
        kind: 'fallback',
        reason: fallbackReason,
        projections: fallbackProjectionChanges(requests, fallbackReason)
      })
    }
    const inventoryApplied = (
      previousState.kind === 'regional' &&
      previousState.regionalInventory !== undefined
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
    if (markup?.kind === 'fallback') {
      return Object.freeze({
        kind: 'fallback',
        reason: markup.reason,
        projections: fallbackProjectionChanges(requests, markup.reason)
      })
    }
    return undefined
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
    if (revision !== currentRevision) demoteCurrentProductStore()

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
    if (revision !== currentRevision) demoteCurrentProductStore()

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
      if (!sameMarkdownOptions(previousState.markdownOptions, resolvedOptions)) {
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

  // Authoring validates the complete candidate in the acknowledged parser
  // context, but cannot publish, demote, or alter the live reuse cache. Only
  // detached facts leave this callback; candidate parser products are discarded.
  const previewSourceEdits = (
    previous: DocumentRevision,
    edits: readonly DocumentSourceEdit[]
  ): DocumentRevision => {
    const state = currentStateOf(previous)
    const stableEdits = stableSourceEdits(edits)
    preflightSourceEdits(state.source.length, stableEdits)
    const source = state.source.applyExact(stableEdits, 'Authoring candidate')
      .materialize('fallback')
    return state.productStore.withProduct(previousProducts => {
      const retained = previousProducts.retainedIntrinsic
      const products = isolatedProducts(source, state.markdownOptions,
        retained === undefined ? undefined : { retained, edits: stableEdits })
      return Object.freeze({
        source,
        sourceLength: source.length,
        annotations: annotationsOf(products).annotations,
        diagnostics: diagnosticsOf(products)
      })
    })
  }

  // A same-shape regional preview proves marker ownership, diagnostics and
  // Markdown context without publishing or opening the revision's full products.
  // The general planners remain responsible for changing suggestion structure.
  const regionalPayloadEdit = (
    state: RevisionState,
    edit: DocumentSourceEdit,
    tracked: boolean
  ): DocumentSourceEdit | undefined => {
    if (state.regionalInventory === undefined || edit.start === edit.end && edit.insert.length === 0) return undefined
    const edits = Object.freeze([edit])
    const source = state.source.applyExact(edits, 'Authoring regional candidate')
    const candidate = previewRegionalInventory(
      state.regionalInventory, state.source, source, edits, [], executionBudget,
      state.markdownOptions, regionalPhysicalRecorder
    )
    if (candidate.kind === 'resource-failure') throw documentCoreError(candidate.fatalDiagnostic)
    if (candidate.kind !== 'validated') return undefined
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
      if (node.range.start < start && node.range.end > start &&
          (owner === undefined || node.range.end - node.range.start < owner.range.end - owner.range.start)) owner = node
      for (const arm of node.arms) pending.push(...arm.children)
    }
    if (tracked) {
      if (owner?.kind !== 'addition' && owner?.kind !== 'substitution') return undefined
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

  const planNativeEdits = (
    previous: DocumentRevision,
    input: readonly DocumentSourceEdit[],
    tracked: boolean
  ): readonly DocumentSourceEdit[] | undefined => {
    const state = currentStateOf(previous)
    const edits = stableSourceEdits(input)
    preflightSourceEdits(state.source.length, edits)
    if (edits.length === 0) return Object.freeze([])
    const edit = edits[0]
    if (edits.length === 1 && edit !== undefined) {
      if (!tracked) return core.markupEdit(previous, edit)
      const planned = core.trackedEdit(previous, edit)
      return planned === undefined ? undefined : Object.freeze([planned])
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
      const flatten = (roots: readonly CriticMarkupAnnotation[]): CriticMarkupAnnotation[] => {
        const result: CriticMarkupAnnotation[] = []
        const pending = [...roots].reverse()
        while (pending.length > 0) {
          const annotation = pending.pop()!
          result.push(annotation)
          for (const arm of [...annotation.arms].reverse()) pending.push(...[...arm.annotations].reverse())
        }
        return result
      }
      const retained = flatten(previous.annotations).filter(annotation =>
        annotation.range.start >= start && annotation.range.end <= end &&
        !edits.some(edit => edit.start <= annotation.range.start && edit.end >= annotation.range.end))
      const offset = (position: number, after: boolean): number => position - start + protectedEdits.reduce((delta, edit) =>
        delta + (edit.end < position || (edit.end === position && (after || edit.start < edit.end))
          ? edit.insert.length - (edit.end - edit.start)
          : 0), 0)
      const candidate = previewSourceEdits(previous, [planned])
      const wrapper = flatten(candidate.annotations).find(annotation => annotation.range.start === planned.start &&
        annotation.range.end === planned.start + planned.insert.length)
      const arm = wrapper?.arms.find(arm => arm.name === 'new')
      if (arm === undefined) return undefined
      const actual = flatten(arm.annotations)
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
    const { schema: _schema, ...options } = state.markdownOptions
    let candidate = candidateCore.open(previous.source, options)
    const result: DocumentSourceEdit[] = []
    let boundary = previous.sourceLength + 1
    for (const edit of [...edits].reverse()) {
      if (edit.start >= boundary || edit.end > boundary) return compoundSuggestion()
      if (candidateCore.sourceSlice(candidate, edit) === edit.insert) continue
      const trackedEdit = tracked ? candidateCore.trackedEdit(candidate, edit) : undefined
      const planned = tracked
        ? trackedEdit === undefined ? undefined : [trackedEdit]
        : candidateCore.markupEdit(candidate, edit)
      if (planned === undefined || planned.some(item => item.start >= boundary || item.end > boundary)) return compoundSuggestion()
      if (planned.length === 0) continue
      candidate = candidateCore.apply(candidate, planned).revision
      boundary = Math.min(...planned.map(item => item.start))
      result.unshift(...planned)
    }
    return Object.freeze(result.map(edit => Object.freeze({ ...edit })))
  }

  const core: DocumentCore = Object.freeze({
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
      const regional = regionalPayloadEdit(state, stableEdit, false)
      if (regional !== undefined) return Object.freeze([regional])
      return createMarkupSourceEdits(core, previous, stableEdit,
        candidateEdits => previewSourceEdits(previous, candidateEdits))
    },

    trackedEdit(
      previous: DocumentRevision,
      edit: DocumentSourceEdit
    ): DocumentSourceEdit | undefined {
      const state = currentStateOf(previous)
      const edits = stableSourceEdits([edit])
      preflightSourceEdits(state.source.length, edits)
      const stableEdit = edits[0]
      if (stableEdit === undefined) throw new Error('Tracked source edit is missing')
      const regional = regionalPayloadEdit(state, stableEdit, true)
      if (regional !== undefined) return regional
      return createTrackedSourceEdit(
        core, previous, stableEdit,
        candidateEdits => previewSourceEdits(previous, candidateEdits)
      ) ?? createTrackedLiteralSourceEdit(
        core, previous, stableEdit,
        candidateEdits => previewSourceEdits(previous, candidateEdits)
      )
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
      return publish(
        createPersistentCanonicalSource(source, sourceRecorder),
        products,
        resolvedOptions
      )
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
      let source: PersistentCanonicalSource
      try {
        source = previousState.source.applyExact(
          stableEdits,
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
        stableEdits,
        options,
        projectionRequests
      )
      if (regional?.kind === 'applied') {
        return Object.freeze({
          revision: regional.revision,
          change: Object.freeze({
            appliedEdits: stableEdits,
            projections: regional.projections
          })
        })
      }
      const revision = applyCandidate(
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
      return core.apply(previous, Object.freeze([edit]), options)
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

    project: projectRevision,
    projectComment
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
  return core
}
