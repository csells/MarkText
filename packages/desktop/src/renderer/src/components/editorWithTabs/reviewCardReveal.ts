import type { CoreReviewOverviewEntry } from '../../documentAuthority/coreProtocol'

/** The part of a box between its top and bottom edges, in viewport pixels. */
export interface VerticalExtent {
  readonly top: number
  readonly bottom: number
}

/**
 * How far to scroll `view` so `card` is in it, as `scrollIntoView` does with
 * `block: 'nearest'`: nothing when the card is already in view, else the
 * least that shows it, its top first when it is taller than the view.
 */
export function nearestScrollDelta(view: VerticalExtent, card: VerticalExtent): number {
  if (card.top < view.top) return card.top - view.top
  if (card.bottom > view.bottom) return Math.min(card.bottom - view.bottom, card.top - view.top)
  return 0
}

/**
 * Whether the sidebar should bring the selected entry's card into view: it
 * does whenever another entry becomes selected, as Google Docs shows the card
 * of the suggestion or comment the author moves to. Typing inside the selected
 * entry keeps its position, and an edit before it moves the entry without
 * changing its passages; either way the same entry stays selected and the
 * sidebar stays where the author put it.
 */
export function revealsSelectedEntry(
  previous: Readonly<{ start?: number; entries: readonly CoreReviewOverviewEntry[] }>,
  next: Readonly<{ start?: number; entries: readonly CoreReviewOverviewEntry[] }>
): boolean {
  if (next.start === undefined || next.start === previous.start) return false
  if (previous.start === undefined || next.entries === previous.entries) return true
  const entryAt = (entries: readonly CoreReviewOverviewEntry[], start: number) =>
    entries.find((entry) => entry.item.range.start === start)
  const before = entryAt(previous.entries, previous.start)
  const after = entryAt(next.entries, next.start)
  const passage = (entry: CoreReviewOverviewEntry | undefined) =>
    entry?.excerpt ?? entry?.commentProjection ?? entry?.replacementExcerpt
  return passage(after) === undefined || passage(after) !== passage(before)
}
