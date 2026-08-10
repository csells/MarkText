import {
  createProfile1DocumentReuseCache,
  parseProfile1Document,
  type PreviousIntrinsicPass,
  type Profile1DocumentProducts,
  type Profile1DocumentReuseCache
} from './internal/profile1Document.js'
import { createPhysicalTraversalRecorderV1 } from './internal/profile1/physicalTraversalAccounting.js'
import { registerDocumentCoreInspection } from './internal/documentCoreInspection.js'
import { applyExactSourceEdits } from './exactSourceEdits.js'
import type {
  CriticMarkupNode,
  ExecutionBudgetId,
  MarkdownNode as ParserMarkdownNode,
  MarkdownOptionsV1,
  NodeId,
  ProjectedMarkdown,
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

/**
 * One document lineage. Successful open and reopen calls advance its current
 * revision. Older revisions remain projectable but cannot be reopened.
 */
export interface DocumentCore {
  open(
    source: string,
    options?: Readonly<Partial<MarkdownOptions>>
  ): DocumentRevision
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
    materialized.set(task.annotation, Object.freeze({
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
    }))
  }

  const annotations = Object.freeze(roots.map(root => {
    const annotation = materialized.get(root)
    if (annotation === undefined) {
      throw new Error('CriticMarkup root was not materialized')
    }
    return annotation
  }))
  return Object.freeze({ annotations, rangeByNodeId })
}

function sourceRangeOf(range: {
  readonly start: number
  readonly end: number
}): SourceRange {
  return Object.freeze({ start: range.start, end: range.end })
}

function markdownAstOf(projection: ProjectedMarkdown): MarkdownAst {
  const root = projection.markdown.root
  const materialized = new Map<ParserMarkdownNode, MarkdownAstNode>()
  const footnoteReferenceByNode = new Map<ParserMarkdownNode, Readonly<{
    readonly definition?: Readonly<{ readonly node: ParserMarkdownNode }>
  }>>()
  for (
    let ordinal = 0;
    ordinal < projection.markdown.references.footnoteReferenceCount;
    ordinal += 1
  ) {
    const reference = projection.markdown.references.footnoteReferenceAt(ordinal)
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
    delete attributes.destination
    delete attributes.title
    const link = projection.markdown.references.linkForNode(task.node.nodeId)
    if (link !== undefined) {
      attributes.rawDestination = task.node.kind === 'autolink'
        ? projection.markdown.source.slice(
          Math.min(task.node.range.end, task.node.range.start + 1),
          Math.max(task.node.range.start + 1, task.node.range.end - 1)
        )
        : task.node.attributes['extendedAutolink'] === true
          ? projection.markdown.source.slice(
            task.node.range.start,
            task.node.range.end
          )
          : link.destination
      if (link.title !== undefined) {
        attributes.rawTitle = link.title
      }
      if (link.definition !== undefined) {
        attributes.resolvedDefinitionStart = link.definition.node.range.start
        attributes.resolvedDefinitionEnd = link.definition.node.range.end
      }
    }
    if (task.node.kind === 'footnote-reference') {
      const definition = footnoteReferenceByNode.get(task.node)?.definition
      attributes.resolved = definition !== undefined
      if (definition !== undefined) {
        attributes.resolvedDefinitionStart = definition.node.range.start
        attributes.resolvedDefinitionEnd = definition.node.range.end
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
      range: sourceRangeOf(task.node.range),
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
  const events = Object.freeze(Array.from(
    { length: products.markup.eventCount },
    (_, ordinal): MarkupEvent => {
      const event = products.markup.eventAt(ordinal)
      if (event.kind === 'text') {
        return Object.freeze({
          kind: 'text',
          text: event.text,
          sourceRange: sourceRangeOf(event.sourceRange)
        })
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
      return Object.freeze({ kind: event.kind, mark })
    }
  ))
  const editing = products.editing()
  const syntax = Object.freeze({
    ast: markdownAstOf(editing),
    coordinates: projectionCoordinatesOf(editing, sourceLength)
  })
  return Object.freeze({
    kind: 'markup',
    name: 'markup',
    events,
    syntax
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

interface RevisionState {
  readonly products: Profile1DocumentProducts
  readonly markdownOptions: MarkdownOptionsV1
  readonly annotationRangeByNodeId: ReadonlyMap<NodeId, SourceRange>
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
  let reuseCache: Profile1DocumentReuseCache =
    createProfile1DocumentReuseCache()
  const physicalRecorder = createPhysicalTraversalRecorderV1()
  let currentRevision: DocumentRevision | undefined

  const parse = (
    source: string,
    resolvedOptions: MarkdownOptionsV1,
    previousPass?: PreviousIntrinsicPass
  ): Profile1DocumentProducts => {
    let products
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
    return products
  }

  const publish = (
    source: string,
    products: Profile1DocumentProducts,
    resolvedOptions: MarkdownOptionsV1
  ): DocumentRevision => {
    try {
      const materializedAnnotations = annotationsOf(products)
      const revision = Object.freeze({
        source,
        annotations: materializedAnnotations.annotations,
        diagnostics: diagnosticsOf(products)
      })
      stateByRevision.set(revision, Object.freeze({
        products,
        markdownOptions: resolvedOptions,
        annotationRangeByNodeId: materializedAnnotations.rangeByNodeId
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

    if (projection === 'markup') {
      const result = markupProjectionOf(
        state.products,
        state.annotationRangeByNodeId,
        revision.source.length
      )
      cachedByName.set(projection, result)
      return result
    }
    const projected = projection === 'original'
      ? state.products.original
      : state.products.revised
    const result: MarkdownProjection = Object.freeze({
      kind: 'markdown',
      name: projection,
      markdown: projected.source,
      ast: markdownAstOf(projected),
      coordinates: projectionCoordinatesOf(projected, revision.source.length)
    })
    cachedByName.set(projection, result)
    return result
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

    reopen(
      previous: DocumentRevision,
      source: string,
      edits: readonly DocumentSourceEdit[],
      options?: Readonly<Partial<MarkdownOptions>>
    ): DocumentRevision {
      const previousState = stateByRevision.get(previous)
      if (previousState === undefined) {
        throw new Error('Document revision belongs to another core')
      }
      if (previous !== currentRevision) {
        throw new Error('Document revision is not the current core revision')
      }
      if (typeof source !== 'string') {
        throw new TypeError('Document source must be a string')
      }

      const stableEdits = Object.freeze(edits.map(edit => Object.freeze({
        start: edit.start,
        end: edit.end,
        insert: edit.insert
      })))
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

      const resolvedOptions = options === undefined
        ? previousState.markdownOptions
        : markdownOptions(options, previousState.markdownOptions)
      const retained = sameMarkdownOptions(
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
    },

    project: projectRevision
  })
  registerDocumentCoreInspection(core, () => Object.freeze({
    intrinsicSourceUnits: physicalRecorder.counts().intrinsicSourceUnits
  }))
  return core
}
