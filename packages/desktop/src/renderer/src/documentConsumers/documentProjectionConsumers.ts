import type {
  MarkdownAst,
  MarkdownAstNode,
  MarkdownProjectionName
} from '@marktext/document-core'
import { wordCount } from '@muyajs/core'

import { renderMarkdownProjectionToSafeHtml } from './markdownProjectionHtml'

export interface ProjectedSearchOptions {
  readonly isCaseSensitive?: boolean
  readonly isWholeWord?: boolean
  readonly isRegexp?: boolean
}

export interface ProjectedSearchMatch {
  /** Public AST path of the independently searchable rendered block. */
  readonly path: readonly number[]
  /** Half-open offsets in that block's rendered semantic text. */
  readonly start: number
  readonly end: number
  readonly match: string
  readonly subMatches: readonly string[]
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

const stringAttribute = (
  node: MarkdownAstNode,
  name: string
): string | undefined => {
  const value = node.attributes[name]
  return typeof value === 'string' ? value : undefined
}

const semanticTextOf = (node: MarkdownAstNode): string => {
  switch (node.kind) {
    case 'text':
      return stringAttribute(node, 'semanticText') ?? ''
    case 'soft-break':
    case 'hard-break':
      return '\n'
    case 'inline-code':
      return stringAttribute(node, 'semanticContent') ??
        stringAttribute(node, 'content') ?? ''
    case 'code-block':
    case 'html-block':
    case 'front-matter':
    case 'math-block':
    case 'diagram':
      return stringAttribute(node, 'content') ?? ''
    case 'definition':
      return ''
    default:
      return node.children.map(semanticTextOf).join('')
  }
}

const searchableBlocksOf = (
  root: MarkdownAstNode
): readonly Readonly<{ path: readonly number[]; text: string }>[] => {
  const blocks: Array<Readonly<{ path: readonly number[]; text: string }>> = []
  const pending: Array<Readonly<{
    node: MarkdownAstNode
    path: readonly number[]
  }>> = [{ node: root, path: Object.freeze([]) }]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break
    if (searchableBlockKinds.has(current.node.kind)) {
      blocks.push(Object.freeze({
        path: current.path,
        text: semanticTextOf(current.node)
      }))
      continue
    }
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      const child = current.node.children[index]
      if (child !== undefined) {
        pending.push(Object.freeze({
          node: child,
          path: Object.freeze([...current.path, index])
        }))
      }
    }
  }
  return Object.freeze(blocks)
}

const searchExpression = (
  value: string,
  options: ProjectedSearchOptions
): RegExp | undefined => {
  let expression = value
  if (options.isRegexp !== true) {
    expression = value.replace(/[[\]\\^$.|?*+()/]/gu, token =>
      token === '\\' ? '\\\\' : `\\${token}`
    )
  }
  if (options.isWholeWord === true) expression = `\\b${expression}\\b`
  try {
    return new RegExp(expression, options.isCaseSensitive === true ? 'gu' : 'giu')
  } catch {
    return undefined
  }
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
  const expression = value === '' ? undefined : searchExpression(value, options)
  const matches: ProjectedSearchMatch[] = []
  if (expression !== undefined) {
    for (const block of searchableBlocksOf(projection.ast.root)) {
      for (const match of block.text.matchAll(expression)) {
        const start = match.index
        matches.push(Object.freeze({
          path: block.path,
          start,
          end: start + match[0].length,
          match: match[0],
          subMatches: Object.freeze(match.slice(1).map(value => value ?? ''))
        }))
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
    !Number.isSafeInteger(result.index) || result.index < 0 ||
    result.index >= result.matches.length || result.matches.length === 0
  ) return undefined
  const selected = result.matches[result.index]
  if (selected === undefined) return undefined
  const matches = options.isSingle ? [selected] : result.matches
  const replaceValue = (match: ProjectedSearchMatch): string => {
    if (!options.isRegexp) return value
    let expanded = value
    const groups = expanded.match(/(?<!\\)\$\d/gu) ?? []
    for (const group of groups) {
      const index = Number.parseInt(group.slice(1), 10)
      if (index === 0) expanded = expanded.replace(group, match.match)
      else if (index <= match.subMatches.length) {
        expanded = expanded.replace(group, match.subMatches[index - 1] ?? '')
      }
    }
    return expanded
  }
  return Object.freeze(matches.map(selected => Object.freeze({
    match: Object.freeze({
      path: Object.freeze([...selected.path]),
      start: selected.start,
      end: selected.end,
      match: selected.match
    }),
    insert: replaceValue(selected)
  })))
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
      if (
        typeof level !== 'number' || !Number.isSafeInteger(level) ||
        level < 1 || level > 6
      ) throw new Error('Projected Markdown heading has no valid level')
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
  const selectedProjection = scope.kind === 'selection'
    ? scope.projection
    : projection
  if (selectedProjection === undefined) return undefined
  if (flavor === 'markdown') {
    return Object.freeze({ text: selectedProjection.markdown, html: '' })
  }
  const html = renderProjectedDocumentHtml(selectedProjection)
  return flavor === 'html'
    ? Object.freeze({ text: html, html: '' })
    : Object.freeze({ text: selectedProjection.markdown, html })
}
