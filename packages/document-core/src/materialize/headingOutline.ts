import type {
  CompleteDocumentRevision,
  MarkdownDocument,
  MarkdownNode,
  NodeId
} from '../revision.js'
import { githubHeadingSlug } from './headingSlug.js'
import { materializeMarkdownNodeTexts } from './textMaterializers.js'

type HeadingView = 'markup' | 'original' | 'revised'

export interface ParserHeadingAnchor {
  readonly node: MarkdownNode
  readonly nodeId: NodeId
  readonly level: number
  readonly text: string
  readonly slug: string
}

/**
 * Derive the one ordered heading outline from a parser-created Markdown
 * document.
 *
 * Live views, static HTML anchors/TOCs, and copy-heading-link consume this
 * result, so node identity, view projection, Unicode slugging, and duplicate
 * suffixes cannot diverge.
 */
export function markdownHeadingAnchors(
  document: MarkdownDocument
): readonly ParserHeadingAnchor[] {
  const headings: MarkdownNode[] = Array.from(
    { length: document.headings.count },
    (_, ordinal) => document.headings.at(ordinal).node
  )

  const texts = materializeMarkdownNodeTexts(document, headings)
  const slugCounts = new Map<string, number>()
  return Object.freeze(headings.map((node, ordinal) => {
    const heading = document.headings.at(ordinal)
    const text = texts[ordinal] ?? ''
    const base = githubHeadingSlug(text)
    const duplicateOrdinal = slugCounts.get(base) ?? 0
    slugCounts.set(base, duplicateOrdinal + 1)
    return Object.freeze({
      node,
      nodeId: node.nodeId,
      level: heading.level,
      text,
      slug: duplicateOrdinal === 0
        ? base
        : `${base}-${String(duplicateOrdinal)}`
    })
  }))
}

/**
 * Select a revision projection and expose its parser-owned heading outline.
 */
export function parserHeadingAnchors(
  revision: CompleteDocumentRevision,
  view: HeadingView
): readonly ParserHeadingAnchor[] {
  return markdownHeadingAnchors(revision.projection(
    view === 'markup' ? 'editing' : view
  ).markdown)
}
