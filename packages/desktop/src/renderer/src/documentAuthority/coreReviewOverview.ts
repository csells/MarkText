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
import { literalChildText, markupRegionCoordinates } from './muyaMarkupChanges'
import type { MarkupPassage } from '../documentConsumers/markupPassage'

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

const shiftedNode = (node: MarkdownAstNode, at: number, delta: number): MarkdownAstNode => {
  const moved = (position: number): number => position >= at ? position + delta : position
  let attributes: Record<string, MarkdownAstNode['attributes'][string]> | undefined
  for (const key in node.attributes) {
    const value = node.attributes[key]
    if (typeof value !== 'number' || !/(?:Start|End)$/u.test(key) || moved(value) === value) continue
    attributes ??= { ...node.attributes }
    attributes[key] = moved(value)
  }
  return Object.freeze({
    ...node,
    range: Object.freeze({ start: moved(node.range.start), end: moved(node.range.end) }),
    attributes: attributes === undefined ? node.attributes : Object.freeze(attributes),
    ...(node.semanticTextSegments === undefined
      ? {}
      : {
        semanticTextSegments: Object.freeze(node.semanticTextSegments.map((segment) =>
          Object.freeze({ ...segment, range: Object.freeze({ start: moved(segment.range.start), end: moved(segment.range.end) }) })))
      }),
    children: Object.freeze(node.children.map((child) => shiftedNode(child, at, delta)))
  })
}

/**
 * An arm's passage after a literal lines replacement inside the arm's one
 * block: its other lines stay, the replaced ones read from the reply, and
 * the block and marks end later. Undefined when the passage holds more than
 * that block.
 */
function armLinesPassage(
  passage: MarkupPassage,
  replacement: MarkupRegionReplacement,
  base: number
): MarkupPassage | undefined {
  const lines = replacement.literalLines
  const block = passage.ast.root.children[0]
  if (lines?.sourceStart === undefined || passage.range === undefined || block === undefined ||
      passage.ast.root.children.length !== 1) return undefined
  const at = replacement.previous.syntax.start + lines.sourceStart - replacement.previous.source.start - base
  const delta = replacement.next.syntax.end - replacement.previous.syntax.end
  const inserted = replacement.syntaxBlocks.map((child) => shiftedNode(child, -Infinity, -base))
  // The passage holds the children of its own arm's lines, which an indented
  // code block shared by both arms may not count the replaced lines among.
  const previousEnd = at + lines.source.length - delta
  let first = 0
  while (first < block.children.length && (block.children[first]?.range.start ?? at) < at) first += 1
  const holds = block.children.some((child) => child.range.start >= at && child.range.start < previousEnd)
  const last = holds ? first + lines.previousChildren : first
  if (last > block.children.length) return undefined
  // The block's text holds every line, two children each, a line break
  // after each but the last.
  const content = block.attributes['content']
  let textStart = 0
  let textEnd = 0
  if (typeof content === 'string') {
    // Where the text `count` lines after position `from` starts.
    const linesAfter = (from: number, count: number): number => {
      let at = from
      for (let line = 0; line < count; line += 1) {
        const next = content.indexOf('\n', at)
        if (next < 0) return content.length
        at = next + 1
      }
      return at
    }
    textStart = linesAfter(0, Math.floor(lines.childrenBefore / 2))
    textEnd = linesAfter(textStart, lines.previousLines)
    // Lines ending the block, the last without a break child, keep the
    // line break the block's text ends with.
    if (lines.previousChildren % 2 === 1 && content.charAt(textEnd - 1) === '\n') textEnd -= 1
  }
  // The lines' own start stays, as the block's content start may be.
  const shifted = shiftedNode({ ...block, children: [] }, at + 1, delta)
  const moved = (position: number): number => position > at ? position + delta : position
  // Replaced lines that begin the block begin its content, after any
  // indentation of its first line.
  const contentStart = holds && first === 0 && typeof block.attributes['contentStart'] === 'number'
    ? inserted[0]?.range.start
    : undefined
  const patched: MarkdownAstNode = Object.freeze({
    ...shifted,
    attributes: Object.freeze({
      ...shifted.attributes,
      ...(typeof content === 'string'
        ? { content: content.slice(0, textStart) + inserted.map(literalChildText).join('') + content.slice(textEnd) }
        : {}),
      ...(contentStart === undefined ? {} : { contentStart })
    }),
    children: Object.freeze([
      ...block.children.slice(0, first),
      ...(holds ? inserted : []),
      ...block.children.slice(last).map((child) => shiftedNode(child, -Infinity, delta))
    ])
  })
  const end = passage.ast.root.range.end + delta
  return Object.freeze({
    ast: Object.freeze({
      root: Object.freeze({ ...passage.ast.root, range: Object.freeze({ start: 0, end }), children: Object.freeze([patched]) })
    }),
    marks: Object.freeze(passage.marks.map((mark) => mark.end > at
      ? Object.freeze({ ...mark, start: moved(mark.start), end: moved(mark.end) })
      : mark)),
    range: Object.freeze({ start: moved(passage.range.start), end: moved(passage.range.end) })
  })
}

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

  /**
   * Follows lines replaced inside a suggestion arm's literal block: the
   * suggestion's entry keeps its place and its arm's passage takes the lines.
   */
  const replaceArmLines = (replacement: MarkupRegionReplacement, next: DocumentRevision): boolean => {
    const lines = replacement.literalLines
    if (tracked === undefined || lines?.sourceStart === undefined) return false
    const { slots } = tracked
    const shift = replacement.next.source.end - replacement.previous.source.end
    const from = lines.sourceStart
    const to = from + lines.source.length - shift
    const index = slots.findIndex((slot) => slotRange(slot).start <= from && to <= slotRange(slot).end)
    const slot = slots[index]
    if (slot === undefined) return false
    if (slot.kind === 'region') {
      slots.splice(index, 1, ...entrySlots(regionEntries(tracked.core, slot), slot.delta))
      return replaceArmLines(replacement, next)
    }
    // The suggestion holding the lines, and the arm they are in.
    const annotation = next.annotations.find((candidate) => candidate.range.start <= from && to + shift <= candidate.range.end)
    const arm = annotation?.arms.find((candidate) => candidate.range.start <= from && to + shift <= candidate.range.end)
    if (annotation === undefined || arm === undefined) return false
    const { entry } = slot
    const key = arm.name === 'new' ? 'replacementExcerpt' : 'excerpt'
    const other = arm.name === 'new' ? 'excerpt' : 'replacementExcerpt'
    const passage = entry[key]
    if (passage?.range === undefined) return false
    // Positions are relative to the arm's first block; the arm starts the event.
    const base = replacement.previous.syntax.start - passage.range.start
    const patched = armLinesPassage(passage, replacement, base)
    if (patched === undefined) return false
    // An indented code block reads both arms of a Substitution as one, so
    // the other arm's passage holds the lines too.
    const otherPassage = entry[other]
    const shared = otherPassage?.range !== undefined &&
      (otherPassage.range.end <= passage.range.start || passage.range.end <= otherPassage.range.start)
    const otherPatched = shared && otherPassage !== undefined ? armLinesPassage(otherPassage, replacement, base) : otherPassage
    if (shared && otherPatched === undefined) return false
    // A block that other suggestions' passages also read, as an indented
    // code block holding several, would change in their entries too.
    const block = passage.ast.root.children[0]
    const ranges = [passage.range, ...(shared && otherPassage?.range !== undefined ? [otherPassage.range] : [])]
    if (block === undefined || Math.min(...ranges.map((range) => range.start)) !== 0 ||
        Math.max(...ranges.map((range) => range.end)) < block.range.end - 1) return false
    // The suggestion holding the lines keeps its start and moves its end.
    const moved = (range: SourceRange): SourceRange =>
      Object.freeze({ start: range.start, end: range.end >= to ? range.end + shift : range.end })
    const item = entry.item
    slots[index] = {
      kind: 'entry',
      delta: 0,
      entry: Object.freeze({
        ...shiftedEntry(entry, slot.delta),
        [key]: patched,
        ...(otherPatched === undefined ? {} : { [other]: otherPatched }),
        item: Object.freeze(item.kind === 'commented-span'
          ? {
            ...item,
            range: moved(shiftedRange(item.range, slot.delta)),
            highlightRange: moved(shiftedRange(item.highlightRange, slot.delta)),
            commentRange: shiftedRange(item.commentRange, slot.delta + shift)
          }
          : { ...item, range: moved(shiftedRange(item.range, slot.delta)) })
      })
    }
    for (let later = index + 1; later < slots.length; later += 1) {
      const moving = slots[later]
      if (moving !== undefined) moving.delta += shift
    }
    return true
  }

  const replace = (replacement: MarkupRegionReplacement, next: DocumentRevision, offset: number): boolean => {
    if (tracked === undefined) return false
    if (replacement.literalLines?.sourceStart !== undefined) return offset === 0 && replaceArmLines(replacement, next)
    // Suggestions in items replaced inside a list read with the whole list
    // around them, which the region does not hold.
    if (replacement.listItems !== undefined && replacement.annotations.length > 0) return false
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
