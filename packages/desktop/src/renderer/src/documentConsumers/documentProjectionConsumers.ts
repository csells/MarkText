import type {
  MarkdownAst,
  MarkdownAstNode,
  MarkdownProjectionName,
  MarkupCoordinateSegment,
  SourceRange
} from '@marktext/document-core'
import { buildRegexValue, matchString, wordCount, type ISearchQueryOptions } from '@muyajs/core'

import { renderMarkdownProjectionToSafeHtml } from './markdownProjectionHtml'
import { tocInlineHtmlOf } from './tocInlineHtml'
import { projectedHeadingNodes, type ProjectedHeadingNode } from './projectedHeadings'
import {
  searchableBlockKinds,
  semanticProjectionOf,
  type SemanticProjection
} from './semanticProjection'

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
  /** An ATX heading's text as the Revised Markdown spells it, inline syntax included. */
  readonly source?: string
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
  return countProjectedText(projection.markdown)
}

/**
 * Counts projected text as MarkText always has, over LF line endings: its
 * editor held a CRLF document's text with LF breaks.
 */
export function countProjectedText(text: string): ProjectedDocumentCount {
  return Object.freeze(wordCount(text.replace(/\r\n?/gu, '\n')))
}

/** Derives the export/navigation TOC from heading nodes in projection order. */
export function tocProjectedDocument(
  projection: DocumentConsumerProjection
): readonly ProjectedTocEntry[] {
  return Object.freeze(projectedHeadingNodes(projection).map(tocEntryOf))
}

/** The TOC entry of one projected heading. */
export function tocEntryOf(heading: ProjectedHeadingNode): ProjectedTocEntry {
  const level = heading.node.attributes['level']
  if (typeof level !== 'number' || !Number.isSafeInteger(level) || level < 1 || level > 6) { throw new Error('Projected Markdown heading has no valid level') }
  return Object.freeze({
    lvl: level,
    content: semanticTextOf(heading.node),
    contentHtml: tocInlineHtmlOf(heading.node),
    ...(heading.source === undefined ? {} : { source: heading.source })
  })
}

/**
 * The name Save suggests for a new file: the text of the shallowest ATX heading,
 * the first of them at that level, as MarkText has always chosen it.
 */
export function recommendedDocumentTitle(
  toc: readonly Readonly<{ lvl: number | null; source?: string }>[]
): string {
  let title: Readonly<{ lvl: number | null; source?: string }> | undefined
  for (const entry of toc) {
    if (!entry.source || entry.lvl === null) continue
    if (title === undefined || entry.lvl < (title.lvl ?? 0)) title = entry
  }
  return title?.source ?? ''
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
