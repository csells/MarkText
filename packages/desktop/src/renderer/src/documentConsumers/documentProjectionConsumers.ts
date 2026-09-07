import type {
  MarkdownAst,
  MarkdownAstNode,
  MarkdownProjectionName,
  MarkupCoordinateSegment,
  SourceRange
} from '@marktext/document-core'
import { buildRegexValue, matchString, wordCount, type ISearchQueryOptions } from '@muyajs/core'

import { renderMarkdownProjectionToSafeHtml } from './markdownProjectionHtml'

export type ProjectedSearchOptions = ISearchQueryOptions

export interface ProjectedSearchMatch {
  /** Public AST path of the independently searchable rendered block. */
  readonly path: readonly number[]
  /** Half-open offsets in that block's rendered semantic text. */
  readonly start: number
  readonly end: number
  readonly match: string
  readonly subMatches: readonly string[]
  /** Canonical pieces of this match, excluding omitted annotation arms. */
  readonly sourceRanges?: readonly SourceRange[]
  /** Renderer-relative range proven from this same projection, when supported. */
  readonly presentation?: Readonly<{
    readonly path: readonly (number | string)[]
    readonly start: number
    readonly end: number
  }>
}

export interface ProjectedSearchResult {
  readonly index: number
  readonly matches: readonly ProjectedSearchMatch[]
  readonly value: string
}

export interface ProjectedSearchReplacement {
  readonly match: Readonly<{
    readonly path: readonly number[]
    readonly start: number
    readonly end: number
    readonly match: string
  }>
  readonly insert: string
}

export interface ProjectedSearchReplacementOptions {
  readonly isSingle: boolean
  readonly isRegexp: boolean
}

export interface ProjectedDocumentCount {
  readonly paragraph: number
  readonly word: number
  readonly character: number
  readonly all: number
}

export interface ProjectedTocEntry {
  readonly lvl: number
  readonly content: string
  readonly [key: string]: unknown
}

export type ProjectedClipboardFlavor = 'markdown' | 'html' | 'rich'

/** The minimal public projection surface consumed outside document-core. */
export interface DocumentConsumerProjection {
  readonly name: MarkdownProjectionName
  readonly markdown: string
  readonly ast: MarkdownAst
  readonly sourceSegments?: readonly MarkupCoordinateSegment[]
}

const sourceRangesForMatch = (
  semantic: SemanticProjection,
  start: number,
  end: number,
  runs: readonly MarkupCoordinateSegment[]
): readonly SourceRange[] | undefined => {
  const ranges: SourceRange[] = []
  let cursor = start
  for (const segment of semantic.segments) {
    if (segment.semanticEnd <= cursor || segment.semanticStart >= end) continue
    if (
      segment.semanticStart > cursor ||
      segment.semanticEnd - segment.semanticStart !==
        segment.projectionEnd - segment.projectionStart
    ) { return undefined }
    const localEnd = Math.min(end, segment.semanticEnd)
    const projectedEnd = segment.projectionStart + localEnd - segment.semanticStart
    let projectedCursor = segment.projectionStart + cursor - segment.semanticStart
    for (const run of runs) {
      if (run.projected.end <= projectedCursor || run.projected.start >= projectedEnd) continue
      if (run.projected.start > projectedCursor) return undefined
      const next = Math.min(projectedEnd, run.projected.end)
      ranges.push({
        start: run.source.start + projectedCursor - run.projected.start,
        end: run.source.start + next - run.projected.start
      })
      projectedCursor = next
      if (projectedCursor === projectedEnd) break
    }
    if (projectedCursor !== projectedEnd) return undefined
    cursor = localEnd
    if (cursor === end) break
  }
  return cursor === end ? Object.freeze(ranges) : undefined
}

export type ProjectedClipboardScope =
  | Readonly<{ readonly kind: 'document' }>
  | Readonly<{
    readonly kind: 'selection'
    readonly projection?: DocumentConsumerProjection
  }>

export interface ProjectedClipboardPayload {
  readonly text: string
  readonly html: string
}

const searchableBlockKinds = new Set<MarkdownAstNode['kind']>([
  'paragraph',
  'heading',
  'code-block',
  'html-block',
  'front-matter',
  'math-block',
  'diagram',
  'table-cell'
])

const stringAttribute = (node: MarkdownAstNode, name: string): string | undefined => {
  const value = node.attributes[name]
  return typeof value === 'string' ? value : undefined
}

type SemanticSegment = Readonly<{
  readonly semanticStart: number
  readonly semanticEnd: number
  readonly projectionStart: number
  readonly projectionEnd: number
}>

type SemanticProjection = Readonly<{
  readonly text: string
  readonly segments: readonly SemanticSegment[]
}>

const semanticProjectionOf = (node: MarkdownAstNode, markdown?: string): SemanticProjection => {
  const leaf = (text: string): SemanticProjection => {
    const raw = markdown?.slice(node.range.start, node.range.end)
    const suffix = raw?.slice(text.length)
    const isDirect = raw === text || (raw?.startsWith(text) === true && /^\s*$/u.test(suffix ?? ''))
    return Object.freeze({
      text,
      segments: isDirect
        ? Object.freeze([
          Object.freeze({
            semanticStart: 0,
            semanticEnd: text.length,
            projectionStart: node.range.start,
            projectionEnd: node.range.start + text.length
          })
        ])
        : Object.freeze([])
    })
  }
  switch (node.kind) {
    case 'text':
      return leaf(stringAttribute(node, 'semanticText') ?? '')
    case 'soft-break':
    case 'hard-break':
      return leaf('\n')
    case 'inline-code':
      return leaf(
        stringAttribute(node, 'semanticContent') ?? stringAttribute(node, 'content') ?? ''
      )
    case 'code-block':
    case 'html-block':
    case 'front-matter':
    case 'math-block':
    case 'diagram':
      return leaf(stringAttribute(node, 'content') ?? '')
    case 'definition':
      return leaf('')
    default: {
      let text = ''
      const segments: SemanticSegment[] = []
      for (const child of node.children) {
        const projected = semanticProjectionOf(child, markdown)
        const offset = text.length
        text += projected.text
        segments.push(
          ...projected.segments.map((segment) =>
            Object.freeze({
              semanticStart: segment.semanticStart + offset,
              semanticEnd: segment.semanticEnd + offset,
              projectionStart: segment.projectionStart,
              projectionEnd: segment.projectionEnd
            })
          )
        )
      }
      return Object.freeze({ text, segments: Object.freeze(segments) })
    }
  }
}

const semanticTextOf = (node: MarkdownAstNode): string => semanticProjectionOf(node).text

const searchableBlocksOf = (
  root: MarkdownAstNode,
  markdown: string
): readonly Readonly<{
  node: MarkdownAstNode
  path: readonly number[]
  semantic: SemanticProjection
}>[] => {
  const blocks: Array<
    Readonly<{
      node: MarkdownAstNode
      path: readonly number[]
      semantic: SemanticProjection
    }>
  > = []
  const pending: Array<
    Readonly<{
      node: MarkdownAstNode
      path: readonly number[]
    }>
  > = [{ node: root, path: Object.freeze([]) }]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break
    if (searchableBlockKinds.has(current.node.kind)) {
      blocks.push(
        Object.freeze({
          node: current.node,
          path: current.path,
          semantic: semanticProjectionOf(current.node, markdown)
        })
      )
      continue
    }
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      const child = current.node.children[index]
      if (child !== undefined) {
        pending.push(
          Object.freeze({
            node: child,
            path: Object.freeze([...current.path, index])
          })
        )
      }
    }
  }
  return Object.freeze(blocks)
}

const presentationForMatch = (
  block: Readonly<{
    node: MarkdownAstNode
    path: readonly number[]
    semantic: SemanticProjection
  }>,
  start: number,
  end: number
): ProjectedSearchMatch['presentation'] => {
  const blockIndex = block.path[0]
  if (
    block.path.length !== 1 ||
    typeof blockIndex !== 'number' ||
    !Number.isSafeInteger(blockIndex) ||
    blockIndex < 0 ||
    end <= start
  ) { return undefined }

  let cursor = start
  let projectionStart: number | undefined
  let projectionEnd: number | undefined
  for (const segment of block.semantic.segments) {
    if (segment.semanticEnd <= cursor || segment.semanticStart >= end) continue
    if (segment.semanticStart > cursor) return undefined
    const localStart = Math.max(cursor, segment.semanticStart)
    const localEnd = Math.min(end, segment.semanticEnd)
    const segmentLength = segment.semanticEnd - segment.semanticStart
    if (segmentLength !== segment.projectionEnd - segment.projectionStart) {
      return undefined
    }
    projectionStart ??= segment.projectionStart + localStart - segment.semanticStart
    projectionEnd = segment.projectionStart + localEnd - segment.semanticStart
    cursor = localEnd
    if (cursor === end) break
  }
  if (
    cursor !== end ||
    projectionStart === undefined ||
    projectionEnd === undefined ||
    projectionStart < block.node.range.start ||
    projectionEnd > block.node.range.end
  ) { return undefined }
  return Object.freeze({
    path: Object.freeze([blockIndex, 'text'] as const),
    start: projectionStart - block.node.range.start,
    end: projectionEnd - block.node.range.start
  })
}

/**
 * Searches rendered semantic block text from one declared Core projection.
 * It never observes canonical source, Muya state, Pinia, or the document DOM.
 */
export function searchProjectedDocument(
  projection: DocumentConsumerProjection,
  value: string,
  options: ProjectedSearchOptions = {}
): ProjectedSearchResult {
  const matches: ProjectedSearchMatch[] = []
  if (value !== '') {
    for (const block of searchableBlocksOf(projection.ast.root, projection.markdown)) {
      for (const match of matchString(block.semantic.text, value, options)) {
        const start = match.index
        const end = start + match.match.length
        const presentation = presentationForMatch(block, start, end)
        const sourceRanges =
          projection.sourceSegments === undefined
            ? undefined
            : sourceRangesForMatch(block.semantic, start, end, projection.sourceSegments)
        matches.push(
          Object.freeze({
            path: block.path,
            start,
            end,
            match: match.match,
            subMatches: Object.freeze(match.subMatches.map((value) => value ?? '')),
            ...(sourceRanges === undefined ? {} : { sourceRanges }),
            ...(presentation === undefined ? {} : { presentation })
          })
        )
      }
    }
  }
  return Object.freeze({
    index: matches.length === 0 ? -1 : 0,
    matches: Object.freeze(matches),
    value
  })
}

/**
 * Carries exact match identities from one search result into Core authority.
 * The plan contains no source coordinates and never observes renderer state.
 */
export function createProjectedSearchReplacementPlan(
  result: ProjectedSearchResult,
  value: string,
  options: ProjectedSearchReplacementOptions
): readonly ProjectedSearchReplacement[] | undefined {
  if (
    !Number.isSafeInteger(result.index) ||
    result.index < 0 ||
    result.index >= result.matches.length ||
    result.matches.length === 0
  ) { return undefined }
  const selected = result.matches[result.index]
  if (selected === undefined) return undefined
  const matches = options.isSingle ? [selected] : result.matches
  return Object.freeze(
    matches.map((selected) =>
      Object.freeze({
        match: Object.freeze({
          path: Object.freeze([...selected.path]),
          start: selected.start,
          end: selected.end,
          match: selected.match
        }),
        insert: options.isRegexp ? buildRegexValue(selected, value) : value
      })
    )
  )
}

/**
 * Preserves MarkText's shipped count algorithm while changing its authority
 * input from a renderer serialization to the explicitly selected projection.
 */
export function countProjectedDocument(
  projection: DocumentConsumerProjection
): ProjectedDocumentCount {
  return Object.freeze(wordCount(projection.markdown))
}

/** Derives the export/navigation TOC from heading nodes in projection order. */
export function tocProjectedDocument(
  projection: DocumentConsumerProjection
): readonly ProjectedTocEntry[] {
  const entries: ProjectedTocEntry[] = []
  const visit = (node: MarkdownAstNode): void => {
    if (node.kind === 'heading') {
      const level = node.attributes['level']
      if (typeof level !== 'number' || !Number.isSafeInteger(level) || level < 1 || level > 6) { throw new Error('Projected Markdown heading has no valid level') }
      entries.push(Object.freeze({ lvl: level, content: semanticTextOf(node) }))
    }
    for (const child of node.children) visit(child)
  }
  visit(projection.ast.root)
  return Object.freeze(entries)
}

export const renderProjectedDocumentHtml = renderMarkdownProjectionToSafeHtml

/**
 * Maps one already-selected projection to MarkText's three copy commands.
 * Selection scoping belongs to the projection producer; this policy never
 * falls back to renderer state or canonical source for a second payload.
 */
export function createProjectedClipboardPayload(
  projection: DocumentConsumerProjection,
  flavor: ProjectedClipboardFlavor,
  scope: ProjectedClipboardScope
): ProjectedClipboardPayload | undefined {
  const selectedProjection = scope.kind === 'selection' ? scope.projection : projection
  if (selectedProjection === undefined) return undefined
  if (flavor === 'markdown') {
    return Object.freeze({ text: selectedProjection.markdown, html: '' })
  }
  const html = renderProjectedDocumentHtml(selectedProjection)
  return flavor === 'html'
    ? Object.freeze({ text: html, html: '' })
    : Object.freeze({ text: selectedProjection.markdown, html })
}
