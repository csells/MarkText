import type {
  DocumentRevision,
  MarkdownNode
} from '../revision.js'
import { materializeProjectedText } from './textMaterializers.js'

export interface DocumentStatistics {
  /** Unicode word tokens plus one word per Han ideograph. */
  readonly word: number
  /** Nonempty parser-emitted paragraph and heading blocks. */
  readonly paragraph: number
  /** Non-whitespace Unicode code points. */
  readonly character: number
  /** UTF-16 units in the semantic text projection. */
  readonly all: number
}

export interface DocumentFacts {
  readonly kind: 'document-facts'
  readonly recommendedTitle: string | null
  readonly statistics: DocumentStatistics
}

const cachedFacts = new WeakMap<DocumentRevision, DocumentFacts>()

const HAN = /\p{Script=Han}/gu
const WORD = /[\p{L}\p{M}\p{N}_]+/gu
const NON_WHITESPACE = /\S/gu

function statistics(
  text: string,
  paragraph: number
): DocumentStatistics {
  const han = text.match(HAN)?.length ?? 0
  const withoutHan = text.replace(HAN, ' ')
  return Object.freeze({
    word: han + (withoutHan.match(WORD)?.length ?? 0),
    paragraph,
    character: Array.from(text.matchAll(NON_WHITESPACE)).length,
    all: text.length
  })
}

function visit(
  node: MarkdownNode,
  callback: (node: MarkdownNode) => void
): void {
  callback(node)
  for (let index = 0; index < node.childCount; index += 1) {
    visit(node.childAt(index), callback)
  }
}

function completeFacts(
  revision: Extract<DocumentRevision, { kind: 'complete' }>
): DocumentFacts {
  const projection = revision.projection('editing')
  const paragraphNodes: MarkdownNode[] = []
  visit(projection.markdown.root, node => {
    if (node.kind === 'paragraph' || node.kind === 'heading') {
      paragraphNodes.push(node)
    }
  })
  const textAt = (node: MarkdownNode): string =>
    materializeProjectedText(
      revision,
      'markup',
      node.range
    ).text.trim()
  const paragraph = paragraphNodes.reduce(
    (count, node) => count + (textAt(node).length > 0 ? 1 : 0),
    0
  )
  const revised = revision.projection('revised')
  const revisedHeading = revised.markdown.headings.count === 0
    ? null
    : revised.markdown.headings.at(0).node
  const recommendedTitle = revisedHeading === null
    ? null
    : materializeProjectedText(
      revision,
      'revised',
      revisedHeading.range
    ).text.replace(/\s+/gu, ' ').trim() || null
  const semanticText = materializeProjectedText(revision, 'markup').text
  return Object.freeze({
    kind: 'document-facts' as const,
    recommendedTitle,
    statistics: statistics(semanticText, paragraph)
  })
}

function sourceOnlyParagraphCount(source: string): number {
  return source
    .split(/(?:\r\n|\r|\n)[\t ]*(?:\r\n|\r|\n)+/u)
    .filter(value => value.trim().length > 0)
    .length
}

/**
 * Derive product metadata from the parser-owned revision.
 *
 * Complete documents use the emitted editing meaning tree, so Markdown
 * delimiters, Comment payloads, and marker-looking text in code cannot become
 * prose or a filename heading. SourceOnly has no semantic tree; it reports
 * explicit exact-source statistics and deliberately has no inferred title.
 */
export function materializeDocumentFacts(
  revision: DocumentRevision
): DocumentFacts {
  const cached = cachedFacts.get(revision)
  if (cached !== undefined) {
    return cached
  }
  const facts = revision.kind === 'complete'
    ? completeFacts(revision)
    : Object.freeze({
      kind: 'document-facts' as const,
      recommendedTitle: null,
      statistics: statistics(
        revision.source.text,
        sourceOnlyParagraphCount(revision.source.text)
      )
    })
  cachedFacts.set(revision, facts)
  return facts
}

/**
 * Transfer already-proven semantic facts when the language engine reuses an
 * equivalent plain-text meaning tree.
 */
export function inheritEquivalentDocumentFacts(
  previous: DocumentRevision,
  next: DocumentRevision
): void {
  const facts = cachedFacts.get(previous)
  if (facts !== undefined) {
    cachedFacts.set(next, facts)
  }
}
