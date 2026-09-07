import type { CoreReviewOverviewEntry } from './coreProtocol'

export function reviewContextSelection(entries: readonly CoreReviewOverviewEntry[], start: number) {
  const deepest = entries.find(entry => entry.item.range.start === start ||
    (entry.item.kind === 'commented-span' && entry.item.commentRange.start === start))
  if (!deepest) return undefined
  const comments = entries.filter(entry => entry.item.kind === 'commented-span' &&
    entry.item.highlightRange.start <= deepest.item.range.start &&
    entry.item.highlightRange.end >= deepest.item.range.end)
  comments.sort((a, b) => (a.item.range.end - a.item.range.start) - (b.item.range.end - b.item.range.start))
  const comment = deepest.item.kind === 'comment' || deepest.item.kind === 'commented-span' ? deepest : comments[0]
  return { deepest, comment }
}

export interface ReviewContextIdentity { documentId: string; revision: number; lease: object }

/** A native menu owns one consumable target, never the application menu's current selection. */
export function createReviewContextSession<T>() {
  let active: { requestId: number; identity: ReviewContextIdentity; value: T } | undefined
  return {
    set(requestId: number, identity: ReviewContextIdentity, value: T): void { active = { requestId, identity, value } },
    clear(requestId?: number): void { if (requestId === undefined || active?.requestId === requestId) active = undefined },
    take(requestId: number, identity: ReviewContextIdentity): T | undefined {
      if (active?.requestId !== requestId) return undefined
      const captured = active
      active = undefined
      return captured.identity.documentId === identity.documentId && captured.identity.revision === identity.revision &&
        captured.identity.lease === identity.lease
        ? captured.value
        : undefined
    }
  }
}
