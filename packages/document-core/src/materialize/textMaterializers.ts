import type {
  DocumentRevision,
  MarkdownDocument,
  MarkdownNode,
  MarkdownReferenceIndex,
  ViewRange
} from '../revision.js'
import { markdownTextValue } from './htmlRender.js'

export type MaterializerView = 'markup' | 'original' | 'revised'

export interface SearchText<View extends MaterializerView = MaterializerView> {
  readonly kind: 'search-text'
  readonly view: View
  readonly text: string
}

export interface CountResult<View extends MaterializerView = MaterializerView> {
  readonly kind: 'count'
  readonly view: View
  readonly codeUnits: number
  readonly lineBreaks: number
  readonly words: number
}

export interface ProjectedText<
  View extends MaterializerView = MaterializerView
> {
  readonly kind: 'projected-text'
  readonly view: View
  readonly text: string
}

function sourceSlice(document: MarkdownDocument, node: MarkdownNode): string {
  return document.source.slice(node.range.start, node.range.end)
}

function selectedSourceSlice(
  document: MarkdownDocument,
  node: MarkdownNode,
  range: ViewRange | undefined
): string {
  if (range === undefined) {
    return sourceSlice(document, node)
  }
  return document.source.slice(
    Math.max(node.range.start, range.start),
    Math.min(node.range.end, range.end)
  )
}

function intersects(
  node: MarkdownNode,
  range: ViewRange | undefined
): boolean {
  return range === undefined ||
    (node.range.start < range.end && node.range.end > range.start)
}

function inlineCodeText(document: MarkdownDocument, node: MarkdownNode): string {
  const raw = sourceSlice(document, node)
  const markerLength = Number(node.attributes['markerLength'] ?? 1)
  let content = raw.slice(markerLength, raw.length - markerLength)
    .replace(/\r\n|\r|\n/g, ' ')
  if (
    content.length >= 2 &&
    content.startsWith(' ') &&
    content.endsWith(' ') &&
    content.trim() !== ''
  ) {
    content = content.slice(1, -1)
  }
  return content
}

interface PlainTextFootnotes {
  readonly references: MarkdownReferenceIndex
  readonly ordinals: ReadonlyMap<string, number>
}

function createPlainTextFootnotes(
  document: MarkdownDocument,
  range: ViewRange | undefined
): PlainTextFootnotes {
  const ordinals = new Map<string, number>()
  for (
    let ordinal = 0;
    ordinal < document.references.footnoteReferenceCount;
    ordinal += 1
  ) {
    const reference = document.references.footnoteReferenceAt(ordinal)
    if (
      reference.definition !== undefined &&
      intersects(reference.node, range) &&
      !ordinals.has(reference.label)
    ) {
      const label = reference.label
      ordinals.set(label, ordinals.size + 1)
    }
  }
  return { references: document.references, ordinals }
}

function blockLiteralText(node: MarkdownNode): string {
  const content = node.attributes['content']
  if (typeof content !== 'string') {
    return ''
  }
  return content.endsWith('\n') ? content.slice(0, -1) : content
}

function childText(
  document: MarkdownDocument,
  node: MarkdownNode,
  separator: string,
  footnotes: PlainTextFootnotes,
  range?: ViewRange
): string {
  const values: string[] = []
  for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
    const value = nodeText(
      document,
      node.childAt(ordinal),
      footnotes,
      range
    )
    if (value.length > 0) {
      values.push(value)
    }
  }
  return values.join(separator)
}

function nodeText(
  document: MarkdownDocument,
  node: MarkdownNode,
  footnotes: PlainTextFootnotes,
  range?: ViewRange
): string {
  if (!intersects(node, range)) {
    return ''
  }
  switch (node.kind) {
    case 'document':
    case 'blockquote':
    case 'list':
    case 'list-item':
    case 'table':
      return childText(document, node, '\n', footnotes, range)
    case 'table-row':
      return childText(document, node, '\t', footnotes, range)
    case 'paragraph':
    case 'heading':
    case 'emphasis':
    case 'strong':
    case 'strikethrough':
    case 'subscript':
    case 'superscript':
    case 'table-cell':
      return childText(document, node, '', footnotes, range)
    case 'link':
    case 'image':
      return document.references.linkForNode(node.nodeId) === undefined
        ? markdownTextValue(selectedSourceSlice(document, node, range))
        : childText(document, node, '', footnotes, range)
    case 'text':
      return markdownTextValue(selectedSourceSlice(document, node, range))
    case 'soft-break':
    case 'hard-break':
      return '\n'
    case 'inline-code':
      return inlineCodeText(document, node)
    case 'inline-math':
      return String(node.attributes['content'] ?? '')
    case 'code-block':
    case 'math-block':
    case 'diagram':
      return blockLiteralText(node)
    case 'inline-html':
    case 'html-block':
      return sourceSlice(document, node)
    case 'autolink':
      return sourceSlice(document, node).slice(1, -1)
    case 'footnote-reference': {
      const label = node.attributes['label']
      const ordinal = typeof label === 'string'
        ? footnotes.ordinals.get(label)
        : undefined
      return ordinal === undefined
        ? markdownTextValue(selectedSourceSlice(document, node, range))
        : `[${String(ordinal)}]`
    }
    case 'thematic-break':
    case 'definition':
    case 'front-matter':
    case 'footnote-definition':
      return ''
  }
  const unhandled: never = node.kind
  throw new TypeError(`Unhandled Markdown text node: ${String(unhandled)}`)
}

function semanticPlainText(
  document: MarkdownDocument,
  range?: ViewRange
): string {
  const footnotes = createPlainTextFootnotes(document, range)
  const body = nodeText(document, document.root, footnotes, range)
  const definitions = [...footnotes.ordinals.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([label, ordinal]) => {
      const definition =
        footnotes.references.footnoteDefinitionForLabel(label)?.node
      if (definition === undefined) {
        return ''
      }
      const content = childText(
        document,
        definition,
        '\n',
        footnotes
      )
      return `${String(ordinal)}. ${content}`
    })
    .filter((value) => value.length > 0)
  return [body, ...definitions]
    .filter((value) => value.length > 0)
    .join('\n')
}

/**
 * Materialize several parser-owned node subtrees against one shared semantic
 * text context. Heading-outline consumers use this to stay linear in the
 * document plus the total heading content instead of rescanning per heading.
 */
export function materializeMarkdownNodeTexts(
  document: MarkdownDocument,
  nodes: readonly MarkdownNode[]
): readonly string[] {
  return Object.freeze(nodes.map((node) => {
    const ordinals = new Map<string, number>()
    for (
      let ordinal = 0;
      ordinal < document.references.footnoteReferenceCount;
      ordinal += 1
    ) {
      const reference = document.references.footnoteReferenceAt(ordinal)
      if (
        reference.definition !== undefined &&
        reference.node.range.start >= node.range.start &&
        reference.node.range.end <= node.range.end &&
        !ordinals.has(reference.label)
      ) {
        ordinals.set(reference.label, ordinals.size + 1)
      }
    }
    return nodeText(document, node, {
      references: document.references,
      ordinals
    })
  }))
}

export function materializeProjectedText<View extends MaterializerView>(
  revision: DocumentRevision,
  view: View,
  range?: ViewRange
): ProjectedText<View> {
  if (revision.kind !== 'complete') {
    throw new Error(
      `SourceOnly revision cannot materialize semantic ${view} projected text`
    )
  }
  const projection = revision.projection(
    view === 'markup' ? 'editing' : view
  )
  if (range !== undefined && (
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start ||
    range.end > projection.source.length
  )) {
    throw new RangeError(
      `Projected text range must be inside [0, ${String(projection.source.length)}]`
    )
  }
  return Object.freeze({
    kind: 'projected-text' as const,
    view,
    text: semanticPlainText(projection.markdown, range)
  })
}

function countLineBreaks(source: string): number {
  let count = 0
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] === '\r') {
      count += 1
      if (source[offset + 1] === '\n') {
        offset += 1
      }
    } else if (source[offset] === '\n') {
      count += 1
    }
  }
  return count
}

export function materializeSearchText<View extends MaterializerView>(
  revision: DocumentRevision,
  view: View
): SearchText<View> {
  if (view === 'markup') {
    return Object.freeze({
      kind: 'search-text' as const,
      view,
      text: revision.source.text
    })
  }
  if (revision.kind !== 'complete') {
    throw new Error(
      `SourceOnly revision cannot materialize semantic ${view} search text`
    )
  }
  return Object.freeze({
    kind: 'search-text' as const,
    view,
    text: materializeProjectedText(revision, view).text
  })
}

export function materializeCount<View extends MaterializerView>(
  revision: DocumentRevision,
  view: View
): CountResult<View> {
  const source = revision.source.text
  return Object.freeze({
    kind: 'count' as const,
    view,
    codeUnits: source.length,
    lineBreaks: countLineBreaks(source),
    words: source.match(/[\p{L}\p{M}\p{N}_]+/gu)?.length ?? 0
  })
}
