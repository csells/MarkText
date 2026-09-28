import type {
  CommentMarkupProjection,
  CriticMarkupAnnotation,
  DocumentChange,
  DocumentCore,
  DocumentRevision,
  MarkdownAstNode,
  MarkupRegionReplacement,
  MarkupSyntax,
  SourceRange
} from '@marktext/document-core'
import type { CoreReviewItemLocator, CoreReviewOverviewEntry } from './coreProtocol'
import { commentPassage, documentArmPassage } from '../documentConsumers/markupPassage'
import { markupRegionCoordinates } from './muyaMarkupChanges'

/**
 * What the Review overview reads of a revision: its whole document, or the
 * blocks a regional change replaced, with the same syntax, Revised coverage
 * and Comment projections Core reads there.
 */
interface ReviewReading {
  /** Top-level annotations in source order. */
  readonly roots: readonly CriticMarkupAnnotation[]
  readonly syntax: () => MarkupSyntax
  readonly revisedIntersects: (range: SourceRange) => boolean
  readonly commentMarkup: (comment: CriticMarkupAnnotation) => CommentMarkupProjection
  readonly sourceSlice: (range: SourceRange) => string
}

const documentReading = (core: DocumentCore, revision: DocumentRevision): ReviewReading => {
  let revised: ((range: SourceRange) => boolean) | undefined
  return {
    roots: revision.annotations,
    syntax: () => core.project(revision, 'markup').syntax,
    revisedIntersects: (range) => {
      if (revised === undefined) {
        const coordinates = core.project(revision, 'revised').coordinates
        revised = (range) => coordinates.intersectsSource(range)
      }
      return revised(range)
    },
    commentMarkup: (comment) => core.projectComment(revision, comment, 'markup'),
    sourceSlice: (range) => core.sourceSlice(revision, range)
  }
}

const regionReading = (
  core: DocumentCore,
  revision: DocumentRevision,
  replacement: MarkupRegionReplacement
): ReviewReading => ({
  roots: replacement.annotations,
  syntax: () => ({
    ast: {
      root: {
        kind: 'document',
        range: replacement.next.syntax,
        attributes: {},
        children: replacement.syntaxBlocks
      } satisfies MarkdownAstNode
    },
    coordinates: markupRegionCoordinates(replacement)
  }),
  revisedIntersects: (range) => core.intersectsProjection(revision, 'revised', range),
  commentMarkup: (comment) => core.projectComment(revision, comment, 'markup'),
  sourceSlice: (range) => core.sourceSlice(revision, range)
})

/** Review items in overview order: nested items precede the item holding them. */
const reviewItemsOf = (reading: ReviewReading): readonly CoreReviewItemLocator[] => {
  const items: CoreReviewItemLocator[] = []
  const annotations = reading.roots
  const appendVisibleNestedItems = (annotation: CriticMarkupAnnotation): void => {
    if (annotation.kind !== 'highlight') return
    const content = annotation.arms.find((arm) => arm.name === 'content')
    if (content === undefined) return
    type PendingVisible =
      | Readonly<{
        readonly kind: 'annotations'
        readonly annotations: readonly CriticMarkupAnnotation[]
      }>
      | Readonly<{
        readonly kind: 'item'
        readonly annotation: CriticMarkupAnnotation
      }>
      | Readonly<{
        readonly kind: 'pair'
        readonly highlight: CriticMarkupAnnotation
        readonly comment: CriticMarkupAnnotation
      }>
    const pending: PendingVisible[] = [
      {
        kind: 'annotations',
        annotations: content.annotations
      }
    ]
    while (pending.length > 0) {
      const next = pending.pop()
      if (next === undefined) break
      if (next.kind === 'annotations') {
        for (let index = next.annotations.length - 1; index >= 0; index -= 1) {
          const current = next.annotations[index]
          if (current === undefined) continue
          const prior = next.annotations[index - 1]
          const pair =
            current.kind === 'comment' &&
            prior?.kind === 'highlight' &&
            prior.range.end === current.range.start
          if (pair) {
            pending.push({ kind: 'pair', highlight: prior, comment: current })
            const nestedContent = prior.arms.find((arm) => arm.name === 'content')
            if (nestedContent !== undefined) {
              pending.push({
                kind: 'annotations',
                annotations: nestedContent.annotations
              })
            }
            index -= 1
            continue
          }
          pending.push({ kind: 'item', annotation: current })
          if (current.kind === 'highlight') {
            const nestedContent = current.arms.find((arm) => arm.name === 'content')
            if (nestedContent !== undefined) {
              pending.push({
                kind: 'annotations',
                annotations: nestedContent.annotations
              })
            }
          }
        }
        continue
      }
      if (next.kind === 'pair') {
        const nestedContent = next.highlight.arms.find((arm) => arm.name === 'content')
        if (nestedContent !== undefined && reading.revisedIntersects(nestedContent.range)) {
          items.push(
            Object.freeze({
              kind: 'commented-span',
              range: Object.freeze({
                start: next.highlight.range.start,
                end: next.comment.range.end
              }),
              highlightRange: Object.freeze({ ...next.highlight.range }),
              commentRange: Object.freeze({ ...next.comment.range })
            })
          )
          continue
        }
      }
      const visible = next.kind === 'pair' ? next.highlight : next.annotation
      items.push(
        Object.freeze({
          kind: visible.kind,
          range: Object.freeze({ ...visible.range })
        })
      )
    }
  }
  for (let index = 0; index < annotations.length; index += 1) {
    const annotation = annotations[index]
    if (annotation === undefined) continue
    const next = annotations[index + 1]
    const content =
      annotation.kind === 'highlight'
        ? annotation.arms.find((arm) => arm.name === 'content')
        : undefined
    if (
      annotation.kind === 'highlight' &&
      next?.kind === 'comment' &&
      annotation.range.end === next.range.start &&
      content !== undefined &&
      reading.revisedIntersects(content.range)
    ) {
      appendVisibleNestedItems(annotation)
      items.push(
        Object.freeze({
          kind: 'commented-span',
          range: Object.freeze({
            start: annotation.range.start,
            end: next.range.end
          }),
          highlightRange: Object.freeze({ ...annotation.range }),
          commentRange: Object.freeze({ ...next.range })
        })
      )
      index += 1
      continue
    }
    appendVisibleNestedItems(annotation)
    items.push(
      Object.freeze({
        kind: annotation.kind,
        range: Object.freeze({ ...annotation.range })
      })
    )
  }
  return Object.freeze(items)
}

const annotationKey = (kind: CriticMarkupAnnotation['kind'], range: SourceRange): string =>
  `${kind}:${range.start}:${range.end}`

const readingEntries = (reading: ReviewReading): CoreReviewOverviewEntry[] => {
  const items = reviewItemsOf(reading)
  if (items.length === 0) return []
  const index = new Map<string, CriticMarkupAnnotation>()
  const pending = [...reading.roots]
  while (pending.length > 0) {
    const annotation = pending.pop()
    if (annotation === undefined) continue
    const key = annotationKey(annotation.kind, annotation.range)
    if (!index.has(key)) index.set(key, annotation)
    for (const arm of annotation.arms) pending.push(...arm.annotations)
  }
  let syntax: MarkupSyntax | undefined
  return items.map((item) => {
    const comment =
      item.kind === 'comment'
        ? index.get(annotationKey('comment', item.range))
        : item.kind === 'commented-span'
          ? index.get(annotationKey('comment', item.commentRange))
          : undefined
    const payload = comment?.arms.find((arm) => arm.name === 'comment')
    const annotation =
      item.kind === 'commented-span'
        ? index.get(annotationKey('highlight', item.highlightRange))
        : index.get(annotationKey(item.kind, item.range))
    const content = annotation?.arms.find((arm) => arm.name === 'content' || arm.name === 'old')
    const replacement = annotation?.arms.find((arm) => arm.name === 'new')
    // Excerpts read as the editor's Markup view does, nested suggestions included.
    if (annotation !== undefined && (content !== undefined || replacement !== undefined)) {
      syntax ??= reading.syntax()
    }
    return Object.freeze({
      ...(annotation === undefined || content === undefined || syntax === undefined
        ? {}
        : { excerpt: documentArmPassage(syntax, annotation, content) }),
      ...(annotation === undefined || replacement === undefined || syntax === undefined
        ? {}
        : { replacementExcerpt: documentArmPassage(syntax, annotation, replacement) }),
      item,
      ...(payload === undefined ? {} : { commentText: reading.sourceSlice(payload.range) }),
      ...(comment === undefined
        ? {}
        : { commentProjection: commentPassage(reading.commentMarkup(comment), comment) })
    })
  })
}

const shiftedRange = (range: SourceRange, delta: number): SourceRange =>
  Object.freeze({ start: range.start + delta, end: range.end + delta })

const shiftedEntry = (entry: CoreReviewOverviewEntry, delta: number): CoreReviewOverviewEntry => {
  if (delta === 0) return entry
  const { item } = entry
  return Object.freeze({
    ...entry,
    item: Object.freeze(
      item.kind === 'commented-span'
        ? {
          ...item,
          range: shiftedRange(item.range, delta),
          highlightRange: shiftedRange(item.highlightRange, delta),
          commentRange: shiftedRange(item.commentRange, delta)
        }
        : { ...item, range: shiftedRange(item.range, delta) }
    )
  })
}

/**
 * Entries of an overview in source order, as groups per top-level annotation.
 * A region slot stands for the entries of blocks a regional change replaced,
 * read from that change's revision when the overview is next asked for.
 */
type OverviewSlot = (
  | Readonly<{ kind: 'entry'; entry: CoreReviewOverviewEntry }>
  | Readonly<{
    kind: 'region'
    revision: DocumentRevision
    replacement: MarkupRegionReplacement
  }>
) & {
  /** Source offset from the slot's own revision to the tracked one. */
  delta: number
}

const slotRange = (slot: OverviewSlot): SourceRange => {
  const range = slot.kind === 'entry' ? slot.entry.item.range : slot.replacement.next.source
  return { start: range.start + slot.delta, end: range.end + slot.delta }
}

const entrySlots = (entries: readonly CoreReviewOverviewEntry[], delta: number): OverviewSlot[] =>
  entries.map((entry) => ({ kind: 'entry', entry, delta }))

export interface ReviewOverviewTracker {
  /**
   * The overview of `revision`. After regional changes only the entries of
   * the blocks they replaced are read again; the rest move with their text.
   */
  overview(core: DocumentCore, revision: DocumentRevision): readonly CoreReviewOverviewEntry[]
  /** Follows a committed change so the next overview reads only what it replaced. */
  committed(previous: DocumentRevision, next: DocumentRevision, change: DocumentChange): void
  reset(): void
}

export const createReviewOverviewTracker = (): ReviewOverviewTracker => {
  let tracked:
    | {
      revision: DocumentRevision
      core: DocumentCore
      slots: OverviewSlot[]
      overview?: readonly CoreReviewOverviewEntry[]
    }
    | undefined

  const regionEntries = (
    core: DocumentCore,
    slot: Extract<OverviewSlot, { kind: 'region' }>
  ): CoreReviewOverviewEntry[] => readingEntries(regionReading(core, slot.revision, slot.replacement))

  const replace = (replacement: MarkupRegionReplacement, next: DocumentRevision, offset: number): boolean => {
    if (tracked === undefined) return false
    const { slots } = tracked
    const start = replacement.previous.source.start + offset
    const end = replacement.previous.source.end + offset
    // Groups lie within whole blocks, so every slot is before, inside or
    // after the replaced blocks.
    let low = 0
    let high = slots.length
    while (low < high) {
      const middle = (low + high) >> 1
      const slot = slots[middle]
      if (slot !== undefined && slotRange(slot).end <= start) low = middle + 1
      else high = middle
    }
    let last = low
    for (let slot = slots[last]; slot !== undefined && slotRange(slot).start < end; slot = slots[last]) {
      const range = slotRange(slot)
      if (range.start < start || range.end > end) {
        if (slot.kind === 'entry') return false
        // An earlier region only partly replaced: read it, then retry.
        slots.splice(last, 1, ...entrySlots(regionEntries(tracked.core, slot), slot.delta))
        return replace(replacement, next, offset)
      }
      last += 1
    }
    const inserted: OverviewSlot[] =
      replacement.annotations.length === 0
        ? []
        : [{ kind: 'region', revision: next, replacement, delta: 0 }]
    slots.splice(low, last - low, ...inserted)
    const shift =
      replacement.next.source.end - replacement.next.source.start - (end - start)
    if (shift !== 0) {
      for (let index = low + inserted.length; index < slots.length; index += 1) {
        const slot = slots[index]
        if (slot !== undefined) slot.delta += shift
      }
    }
    return true
  }

  return {
    overview(core, revision) {
      if (tracked?.revision === revision && tracked.core === core) {
        if (tracked.overview === undefined) {
          const entries: CoreReviewOverviewEntry[] = []
          for (const slot of tracked.slots) {
            if (slot.kind === 'entry') entries.push(shiftedEntry(slot.entry, slot.delta))
            else for (const entry of regionEntries(core, slot)) entries.push(shiftedEntry(entry, slot.delta))
          }
          const overview = Object.freeze(entries)
          tracked.slots = entrySlots(entries, 0)
          tracked.overview = overview
          return overview
        }
        return tracked.overview
      }
      const entries = readingEntries(documentReading(core, revision))
      const overview = Object.freeze(entries)
      tracked = {
        revision,
        core,
        slots: entrySlots(entries, 0),
        overview
      }
      return overview
    },
    committed(previous, next, change) {
      if (tracked === undefined) return
      if (tracked.revision !== previous) {
        tracked = undefined
        return
      }
      const markup = change.projections.find((projection) => projection.name === 'markup')
      if (markup === undefined || markup.scope !== 'regions') {
        tracked = undefined
        return
      }
      const replacements = [...markup.replacements].sort(
        (left, right) => left.previous.source.start - right.previous.source.start
      )
      let offset = 0
      for (const replacement of replacements) {
        if (!replace(replacement, next, offset)) {
          tracked = undefined
          return
        }
        offset +=
          replacement.next.source.end -
          replacement.next.source.start -
          (replacement.previous.source.end - replacement.previous.source.start)
      }
      tracked.revision = next
      tracked.overview = undefined
    },
    reset() {
      tracked = undefined
    }
  }
}
