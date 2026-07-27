import type { MarkdownDocument } from './revision.js'

/**
 * The offsets in a document where block-parser state is canonical and empty —
 * nothing open, no container or leaf block in progress.
 *
 * This is one primitive serving two jobs. A CriticMarkup fork reconverges at the
 * next safe point: past it both resolutions are in identical block state, so the
 * remaining source parses the same for every view and is parsed once. An
 * incremental parse needs the same positions to pick a restart boundary after
 * an edit. ADR-0013 records the shared invariant; building it twice would risk
 * two answers to one question.
 *
 * It is *derived from the parse*, never re-scanned. A separate scanner deciding
 * where blocks begin would be a second authority disagreeing with the parser —
 * the architecture ADR-0009 forbids — and it would have to re-implement fence
 * and HTML-block tracking to boot. Between two top-level blocks the parser has
 * nothing open by construction, so every top-level block start is a safe point.
 *
 * The degenerate case falls out for free: an unclosed fence swallows the rest of
 * the document into one block, leaving no interior safe point, which is exactly
 * why such a fork runs to end of document.
 */
export function safePointsOf(document: MarkdownDocument): readonly number[] {
  const root = document.root
  const points: number[] = []
  for (let ordinal = 0; ordinal < root.childCount; ordinal += 1) {
    const start = root.childAt(ordinal).range.start
    // Guard against a parser that ever emits two blocks at one offset.
    if (points[points.length - 1] !== start) {
      points.push(start)
    }
  }
  return Object.freeze(points)
}
