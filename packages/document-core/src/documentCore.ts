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
  createPlainParagraphRetainedIndex,
  type PlainParagraphIndexRecorder,
  type PlainParagraphRetainedIndex
} from './internal/profile1/plainParagraphRetainedIndex.js'
import { registerDocumentCoreInspection } from './internal/documentCoreInspection.js'
import { applyExactSourceEdits } from './exactSourceEdits.js'
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
  /** The exact decoded UTF-16 source supplied to open. */
  readonly source: string
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
   * Link, image, and autolink nodes use `rawDestination` and `rawTitle` to
   * retain Markdown source spelling. They are not decoded link targets;
   * decoding remains a future document-core responsibility. Resolved reference
   * links/images and footnote references use `resolvedDefinitionStart` and
   * `resolvedDefinitionEnd`; every footnote reference also has a `resolved`
   * boolean. Every numeric attribute whose name ends in `Start` or `End` is a
   * UTF-16 position in the projection, and each matching Start/End pair
   * describes a half-open subrange. Editor adapters may use those positions
   * directly without re-recognizing Markdown syntax.
   */
  readonly attributes: Readonly<Record<string, MarkdownAttribute>>
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

export type DocumentProjectionFallbackReason =
  | 'criticmarkup-facts-present'
  | 'definition-or-reference-facts'
  | 'markdown-options-changed'
  | 'structural-region-ineligible'

export interface MarkupDocumentProjectionChange {
  readonly name: 'markup'
  readonly scope: 'document'
  readonly reason: DocumentProjectionFallbackReason
}

export type DocumentProjectionChange =
  | MarkupRegionProjectionChange
  | MarkupDocumentProjectionChange

/**
 * One atomically admitted canonical-source transaction. The core owns source
 * reconstruction; callers retain the exact accepted edits for reconciliation
 * without carrying a second candidate source.
 */
export interface DocumentChange {
  readonly appliedEdits: readonly DocumentSourceEdit[]
  readonly projections: readonly DocumentProjectionChange[]
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
  readonly projections?: readonly ['markup']
}

export interface MarkdownOptions {
  readonly gfm: boolean
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
  }>> = [{ node: root, ready: false }]

  while (pending.length > 0) {
    const task = pending.pop()
    if (task === undefined) break

    if (!task.ready) {
      pending.push({ node: task.node, ready: true })
      for (let ordinal = task.node.childCount - 1; ordinal >= 0; ordinal -= 1) {
        pending.push({ node: task.node.childAt(ordinal), ready: false })
      }
      continue
    }

    const attributes: Record<string, MarkdownAttribute> = {
      ...task.node.attributes
    }
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
      if (link.title !== undefined) {
        attributes.rawTitle = link.title
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
    const origin = projection.provenance.originAt(projectedOffset)
    return origin.kind === 'canonical'
      ? Object.freeze({
        kind: 'source' as const,
        sourceOffset: origin.sourceOffset
      })
      : Object.freeze({
        kind: 'generated' as const,
        sourcePosition: origin.sourcePosition,
        affinity: origin.affinity
      })
  })
  const toSource = Object.freeze((
    projectedPosition: number,
    affinity: ProjectionAffinity
  ): number => {
    const projected = position(
      projectedPosition,
      projection.source.length,
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
    return followingSource?.projectedStart ?? projection.source.length
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
    return projection.provenance.canonicalSourceRangeIntersects(
      range.start,
      range.end
    )
  })
  return Object.freeze({ originAt, toSource, toProjected, intersectsSource })
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
    left.frontMatter === right.frontMatter &&
    left.math === right.math &&
    left.gitLabMath === right.gitLabMath &&
    left.footnotes === right.footnotes &&
    left.subscriptAndSuperscript === right.subscriptAndSuperscript
}

interface RevisionFacts {
  readonly products: Profile1DocumentProducts
  readonly annotationRangeByNodeId: ReadonlyMap<NodeId, SourceRange>
  readonly nodeIdByAnnotation: ReadonlyMap<CriticMarkupAnnotation, NodeId>
}

interface FullRevisionState extends RevisionFacts {
  readonly kind: 'full'
  readonly markdownOptions: MarkdownOptionsV1
  readonly retainedIndex: PlainParagraphRetainedIndex | undefined
}

interface RegionalRevisionState {
  readonly kind: 'regional'
  readonly markdownOptions: MarkdownOptionsV1
  readonly retainedIndex: PlainParagraphRetainedIndex
  readonly ensureProducts: () => RevisionFacts
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
  canonicalFactIndexUnits: number
  regionalProjectionPreparationUnits: number
  regionalMarkupEventUnits: number
  regionalAstMaterializedNodes: number
  regionalCoordinateSegments: number
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
  sourceReconstructionOutputUnits: number
}

export function createDocumentCore(): DocumentCore {
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
    canonicalFactIndexUnits: 0,
    regionalProjectionPreparationUnits: 0,
    regionalMarkupEventUnits: 0,
    regionalAstMaterializedNodes: 0,
    regionalCoordinateSegments: 0,
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
    sourceReconstructionOutputUnits: 0
  }
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
  let currentRevision: DocumentRevision | undefined

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
        EXECUTION_BUDGET,
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

  const publish = (
    source: string,
    products: Profile1DocumentProducts,
    resolvedOptions: MarkdownOptionsV1
  ): DocumentRevision => {
    try {
      const materializedAnnotations = annotationsOf(products)
      const retained = products.retainedIntrinsic
      const retainedIndex = retained !== undefined &&
        !retained.hasCriticMarkupCandidate &&
        retained.rootCount === 0 &&
        retained.markerDecisionCount === 0 &&
        retained.referenceDefinitionCount === 0 &&
        retained.diagnostics.length === 0 &&
        retained.markdownLiterals.length === 0
        ? createPlainParagraphRetainedIndex(
          retained.safePoints,
          source.length,
          retainedIndexRecorder
        )
        : undefined
      const revision = Object.freeze({
        source,
        annotations: materializedAnnotations.annotations,
        diagnostics: diagnosticsOf(products)
      })
      stateByRevision.set(revision, Object.freeze({
        kind: 'full',
        products,
        markdownOptions: resolvedOptions,
        retainedIndex,
        annotationRangeByNodeId: materializedAnnotations.rangeByNodeId,
        nodeIdByAnnotation: materializedAnnotations.nodeIdByAnnotation
      }))
      currentRevision = revision
      return revision
    } catch (error) {
      // Parsing updates provenance state before facade materialization. If
      // publication fails, discard that candidate state so the current head
      // can still be reopened safely.
      reuseCache = createProfile1DocumentReuseCache()
      throw error
    }
  }

  const isolatedFacts = (
    source: string,
    resolvedOptions: MarkdownOptionsV1
  ): RevisionFacts => {
    inspection.documentParses += 1
    inspection.documentParseSourceUnits += source.length
    inspection.documentProjectionPreparationUnits += source.length
    const result = parseProfile1Document(
      source,
      EXECUTION_BUDGET,
      undefined,
      resolvedOptions,
      false,
      undefined,
      createProfile1DocumentReuseCache(),
      physicalRecorder
    )
    if (result.kind !== 'complete') {
      throw documentCoreError(result.fatalDiagnostic)
    }
    inspection.canonicalFactIndexUnits +=
      result.retainedIntrinsic?.tape.length ?? 0
    const materialized = annotationsOf(result)
    return Object.freeze({
      products: result,
      annotationRangeByNodeId: materialized.rangeByNodeId,
      nodeIdByAnnotation: materialized.nodeIdByAnnotation
    })
  }

  const publishRegional = (
    source: string,
    retainedIndex: PlainParagraphRetainedIndex,
    resolvedOptions: MarkdownOptionsV1
  ): DocumentRevision => {
    const revision = Object.freeze({
      source,
      annotations: Object.freeze([]),
      diagnostics: Object.freeze([])
    })
    let facts: RevisionFacts | undefined
    const ensureProducts = Object.freeze((): RevisionFacts => {
      facts ??= isolatedFacts(source, resolvedOptions)
      return facts
    })
    stateByRevision.set(revision, Object.freeze({
      kind: 'regional',
      markdownOptions: resolvedOptions,
      retainedIndex,
      ensureProducts
    }))
    currentRevision = revision
    inspection.retainedCommittedUpdates += 1
    return revision
  }

  const factsOf = (state: RevisionState): RevisionFacts => state.kind === 'full'
    ? state
    : state.ensureProducts()

  const tryRegionalMarkupApply = (
    previous: DocumentRevision,
    previousState: RevisionState,
    source: string,
    stableEdits: readonly DocumentSourceEdit[],
    options: DocumentApplyOptions | undefined
  ): Readonly<{
    readonly kind: 'applied'
    readonly revision: DocumentRevision
    readonly projection: MarkupRegionProjectionChange
  }> | Readonly<{
    readonly kind: 'fallback'
    readonly reason: DocumentProjectionFallbackReason
  }> | undefined => {
    if (options?.projections === undefined) {
      return undefined
    }
    if (
      !Array.isArray(options.projections) ||
      options.projections.length !== 1 ||
      options.projections[0] !== 'markup'
    ) {
      throw new TypeError(
        'Document core projection request must be exactly ["markup"]'
      )
    }
    const resolvedOptions = options.markdown === undefined
      ? previousState.markdownOptions
      : markdownOptions(options.markdown, previousState.markdownOptions)
    if (!sameMarkdownOptions(previousState.markdownOptions, resolvedOptions)) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'markdown-options-changed'
      })
    }
    const retained = previousState.kind === 'full'
      ? previousState.products.retainedIntrinsic
      : undefined
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
    if (retained !== undefined && retained.referenceDefinitionCount !== 0) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'definition-or-reference-facts'
      })
    }
    const retainedIndex = previousState.retainedIndex
    if (retainedIndex === undefined) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'structural-region-ineligible'
      })
    }
    const admission = admitProfile1PlainParagraphRegion(
      previous.source,
      source,
      retainedIndex,
      stableEdits,
      EXECUTION_BUDGET,
      resolvedOptions,
      regionalPhysicalRecorder
    )
    if (admission === undefined) {
      return Object.freeze({
        kind: 'fallback',
        reason: 'structural-region-ineligible'
      })
    }
    const previousEventStart = admission.bracket.previousEventStart
    const previousEventEnd = admission.bracket.previousEventEnd
    const regionSource = source.slice(
      admission.bracket.start,
      admission.bracket.endNext
    )
    const regionalOptions = Object.freeze({
      ...resolvedOptions,
      frontMatter: false
    })
    const regionalResult = parseProfile1Document(
      regionSource,
      EXECUTION_BUDGET,
      undefined,
      regionalOptions,
      false,
      undefined,
      createProfile1DocumentReuseCache(),
      regionalPhysicalRecorder
    )
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
      admission.retainedIndex,
      resolvedOptions
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

    const facts = factsOf(state)
    if (projection === 'markup') {
      const result = markupProjectionOf(
        facts.products,
        facts.annotationRangeByNodeId,
        revision.source.length
      )
      inspection.documentMarkupEventUnits += result.events.length
      inspection.documentAstMaterializedNodes += countMarkdownAstNodes(
        result.syntax.ast.root
      )
      inspection.documentCoordinateSegments +=
        facts.products.editing().mappedTape.length
      cachedByName.set(projection, result)
      return result
    }
    const projected = projection === 'original'
      ? facts.products.original
      : facts.products.revised
    const result: MarkdownProjection = Object.freeze({
      kind: 'markdown',
      name: projection,
      markdown: projected.source,
      ast: markdownAstOf(projected),
      coordinates: projectionCoordinatesOf(projected, revision.source.length)
    })
    inspection.documentAstMaterializedNodes += countMarkdownAstNodes(
      result.ast.root
    )
    inspection.documentCoordinateSegments += projected.mappedTape.length
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
    const facts = factsOf(state)
    const nodeId = facts.nodeIdByAnnotation.get(comment)
    if (nodeId === undefined) {
      throw new Error('Comment does not belong to this revision')
    }

    let cachedByComment = commentProjectionCache.get(revision)
    if (cachedByComment === undefined) {
      cachedByComment = new WeakMap()
      commentProjectionCache.set(revision, cachedByComment)
    }
    const cached = cachedByComment.get(comment)
    if (cached !== undefined) return cached

    const result = commentProjectionOf(
      facts.products,
      nodeId,
      comment.range,
      revision.source.length
    )
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

  const applyCandidate = (
    previousState: RevisionState,
    source: string,
    stableEdits: readonly DocumentSourceEdit[],
    options?: Readonly<Partial<MarkdownOptions>>
  ): DocumentRevision => {
    const resolvedOptions = options === undefined
      ? previousState.markdownOptions
      : markdownOptions(options, previousState.markdownOptions)
    const retained = previousState.kind === 'full' && sameMarkdownOptions(
      previousState.markdownOptions,
      resolvedOptions
    )
      ? previousState.products.retainedIntrinsic
      : undefined
    const previousPass = retained === undefined
      ? undefined
      : Object.freeze({ retained, edits: stableEdits })
    return publish(
      source,
      parse(source, resolvedOptions, previousPass),
      resolvedOptions
    )
  }

  const core: DocumentCore = Object.freeze({
    open(
      source: string,
      options?: Readonly<Partial<MarkdownOptions>>
    ): DocumentRevision {
      if (typeof source !== 'string') {
        throw new TypeError('Document source must be a string')
      }
      const resolvedOptions = markdownOptions(options)
      return publish(source, parse(source, resolvedOptions), resolvedOptions)
    },

    apply(
      previous: DocumentRevision,
      edits: readonly DocumentSourceEdit[],
      options?: DocumentApplyOptions
    ): DocumentCommit {
      const previousState = currentStateOf(previous)
      const stableEdits = stableSourceEdits(edits)
      let source: string
      try {
        source = applyExactSourceEdits(
          previous.source,
          stableEdits,
          'Document core source edit'
        )
      } catch (error) {
        if (error instanceof RangeError) {
          throw new DocumentSourceEditError(error.message)
        }
        throw error
      }
      inspection.sourceReconstructionOutputUnits += source.length
      const regional = tryRegionalMarkupApply(
        previous,
        previousState,
        source,
        stableEdits,
        options
      )
      if (regional?.kind === 'applied') {
        return Object.freeze({
          revision: regional.revision,
          change: Object.freeze({
            appliedEdits: stableEdits,
            projections: Object.freeze([regional.projection])
          })
        })
      }
      const revision = applyCandidate(
        previousState,
        source,
        stableEdits,
        options?.markdown
      )
      return Object.freeze({
        revision,
        change: Object.freeze({
          appliedEdits: stableEdits,
          projections: regional?.kind === 'fallback'
            ? Object.freeze([Object.freeze({
              name: 'markup' as const,
              scope: 'document' as const,
              reason: regional.reason
            })])
            : Object.freeze([])
        })
      })
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
      const reproduced = applyExactSourceEdits(
        previous.source,
        stableEdits,
        'Document core source edit'
      )
      if (reproduced !== source) {
        throw new Error(
          'Document core reopen source does not match its exact edits'
        )
      }
      return applyCandidate(
        previousState,
        source,
        stableEdits,
        options
      )
    },

    project: projectRevision,
    projectComment
  })
  registerDocumentCoreInspection(core, () => {
    const documentPhysical = physicalRecorder.counts()
    const regionalPhysical = regionalPhysicalRecorder.counts()
    return Object.freeze({
      ...inspection,
      intrinsicSourceUnits: documentPhysical.intrinsicSourceUnits,
      regionalIntrinsicSourceUnits: regionalPhysical.intrinsicSourceUnits,
      retainedFactInputStructuralUnits:
        documentPhysical.retainedFactInputStructuralUnits +
        regionalPhysical.retainedFactInputStructuralUnits,
      retainedFactOutputStructuralUnits:
        documentPhysical.retainedFactOutputStructuralUnits +
        regionalPhysical.retainedFactOutputStructuralUnits
    })
  })
  return core
}
