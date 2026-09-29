<template>
  <ul
    ref="list"
    class="core-review-list"
    data-testid="critic-review-list"
    :aria-label="t('editor.coreReview.sidebarTitle')"
    :style="{ paddingTop: `${placement.before}px`, paddingBottom: `${placement.after}px` }"
    @focusin="focusedKey = keyOfTarget($event.target)"
    @focusout="focusedKey = undefined"
  >
    <li
      v-for="{ row, index, detached } in visibleRows"
      :key="row.key"
      :ref="measure"
      v-memo="[...(row.entry === undefined ? [{}] : rowMemo(row.entry)), index, rows.length, detached]"
      class="core-review-entry"
      :class="
        row.entry === undefined
          ? 'active draft'
          : { active: row.entry.item.range.start === activeStart || row.entry.item.range.start === composerStart }
      "
      :data-index="index"
      :data-row-key="row.key"
      :data-detached="detached || undefined"
      :aria-setsize="rows.length"
      :aria-posinset="index + 1"
      :data-testid="row.entry === undefined ? 'critic-review-draft-entry' : 'critic-review-entry'"
    >
      <slot
        v-if="row.entry === undefined"
        name="composer"
      />
      <template v-else>
        <button
          type="button"
          :aria-pressed="row.entry.item.range.start === activeStart"
          :aria-label="entryName(row.entry)"
          :disabled="busy"
          @click="select(row.entry)"
        >
          <span
            class="core-review-entry-kind"
            :data-testid="row.entry.item.range.start === activeStart ? 'critic-review-kind' : undefined"
            :data-kind="row.entry.item.kind"
          >{{ t(`editor.coreReview.kinds.${row.entry.item.kind}`) }}</span>
          <span
            v-if="row.entry.excerpt !== undefined"
            :dir="textDirection"
            class="core-review-excerpt"
            v-html="rendered(row.entry.excerpt).html"
          />
          <span
            v-if="row.entry.replacementExcerpt !== undefined"
            :dir="textDirection"
            class="core-review-excerpt"
            v-html="rendered(row.entry.replacementExcerpt).html"
          />
        </button>
        <div
          v-if="row.entry.commentProjection"
          class="core-review-comment"
          :dir="textDirection"
        >
          <CoreDocumentProjection
            :projection="row.entry.commentProjection"
            kind="comment"
            :label="t('editor.coreReview.commentPrompt')"
          />
        </div>
        <slot
          v-if="composing && row.entry.item.range.start === composerStart"
          name="composer"
        />
        <slot
          v-else-if="row.entry.item.range.start === activeStart"
          name="actions"
        />
      </template>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onBeforeUpdate, onMounted, onUpdated, ref, shallowRef, watch, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { t } from '@/i18n'
import type { CoreReviewOverviewEntry } from '../../documentAuthority/coreProtocol'
import {
  renderMarkupPassageExcerpt,
  type MarkupPassageExcerpt
} from '../../documentConsumers/markdownProjectionHtml'
import type { MarkupPassage } from '../../documentConsumers/markupPassage'
import CoreDocumentProjection from './CoreDocumentProjection.vue'
import { nearestScrollDelta, revealsSelectedEntry } from './reviewCardReveal'

const props = defineProps<{
  entries: readonly CoreReviewOverviewEntry[]
  activeStart?: number
  busy: boolean
  textDirection: string
  /** An open composer is in place of this entry's actions (Google Docs keeps it on its card). */
  composerStart?: number
  /** An open composer for a new item is a draft card at this source position. */
  draftStart?: number
  composing?: boolean
  /**
   * Changes when a click or selection gesture on an annotation in the text
   * asks to see its card, even when that card is already the selected one.
   */
  revealRequest?: number
}>()
const emit = defineEmits<{ select: [start: number] }>()

const draftIndex = computed(() => {
  if (props.draftStart === undefined || props.composerStart !== undefined) return -1
  const start = props.draftStart
  const index = props.entries.findIndex((entry) => entry.item.range.start > start)
  return index < 0 ? props.entries.length : index
})

// An edit elsewhere moves an entry without changing its passages, so the
// rendering and the row of an unchanged entry are found by its passage.
const renderedPassages = new WeakMap<MarkupPassage, MarkupPassageExcerpt>()
const rendered = (passage: MarkupPassage): MarkupPassageExcerpt => {
  let excerpt = renderedPassages.get(passage)
  if (excerpt === undefined) {
    excerpt = renderMarkupPassageExcerpt(passage)
    renderedPassages.set(passage, excerpt)
  }
  return excerpt
}
const rowKeys = new WeakMap<MarkupPassage, number>()
let nextRowKey = 0
const rowKey = (entry: CoreReviewOverviewEntry): number | string => {
  const passage = entry.excerpt ?? entry.commentProjection ?? entry.replacementExcerpt
  if (passage === undefined) return `${entry.item.range.start}:${entry.item.range.end}`
  let key = rowKeys.get(passage)
  if (key === undefined) {
    key = nextRowKey++
    rowKeys.set(passage, key)
  }
  return key
}

// A row that is neither selected nor composing renders only from its
// entry's passages, so after an edit elsewhere it is not rendered again.
// The selected row renders its actions slot, which may change at any time.
const rowMemo = (entry: CoreReviewOverviewEntry): unknown[] => {
  const start = entry.item.range.start
  const live = start === props.activeStart || start === props.composerStart
  return [rowKey(entry), entry.item.kind, live ? {} : false, props.busy, props.textDirection]
}
// A kept row's handler belongs to the entry it was rendered for; select the
// entry now in its place.
const select = (entry: CoreReviewOverviewEntry): void => {
  const key = rowKey(entry)
  const current = props.entries.find((candidate) => rowKey(candidate) === key) ?? entry
  emit('select', current.item.range.start)
}

// A draft card for a new item stands before the entry at `draftIndex`.
const rows = computed(() => {
  const list: { key: number | string; entry?: CoreReviewOverviewEntry }[] = props.entries.map(
    (entry) => ({ key: rowKey(entry), entry })
  )
  if (props.composing && draftIndex.value >= 0) list.splice(draftIndex.value, 0, { key: 'draft' })
  return list
})

// A long list mounts only the cards in and near the sidebar's view, so a
// refresh renders and lays out a few cards however many the document has.
// Up to `WHOLE_LIST_CARDS` cards are all mounted, as before: that costs less
// than a frame, and the list then reads whole to assistive technology and
// find in page. The selected card, the composer's and a focused card stay
// mounted wherever they are, and while the sidebar is hidden, so focus, the
// composer and the selected entry never lose their element.
const WHOLE_LIST_CARDS = 200
const list = ref<HTMLUListElement>()
const scrollElement = shallowRef<HTMLElement | null>(null)
const listOffset = ref(0)
const focusedKey = ref<number | string>()
const keyOfTarget = (target: EventTarget | null): number | string | undefined => {
  const row = target instanceof Element ? target.closest<HTMLElement>('[data-row-key]') : null
  const key = row?.dataset.rowKey
  return key === undefined ? undefined : rows.value.find((candidate) => String(candidate.key) === key)?.key
}
const pinnedIndexes = computed(() => {
  const pinned: number[] = []
  rows.value.forEach((row, index) => {
    const start = row.entry?.item.range.start
    if (
      row.entry === undefined ||
      start === props.activeStart ||
      start === props.composerStart ||
      row.key === focusedKey.value
    ) {
      pinned.push(index)
    }
  })
  return pinned
})
const virtualizer = useVirtualizer<HTMLElement, HTMLLIElement>(computed(() => ({
  count: rows.value.length,
  getScrollElement: () => scrollElement.value,
  // Before the scroll box is measured, assume it is as tall as the window,
  // so the first render already shows the cards in view.
  initialRect: { width: 0, height: window.innerHeight },
  estimateSize: () => 72,
  // Cards are laid out at fractional heights; place them as the browser
  // would stack them, without rounding.
  measureElement: (element: HTMLLIElement) => element.getBoundingClientRect().height,
  overscan: 8,
  scrollMargin: listOffset.value,
  getItemKey: (index: number) => rows.value[index]?.key ?? index
})))
// Cards in and near the view are laid out in flow between the list's padding,
// which stands for the cards before and after them, so they read and stack
// as the whole list did. A pinned card outside that run is placed at its own
// position, out of flow.
// The list keeps the view in place as cards above it resize (below); the
// virtualizer must not move it again.
virtualizer.value.shouldAdjustScrollPositionOnItemSizeChange = () => false
const placed = computed(() => {
  const instance = virtualizer.value
  // Reading the items in view also brings the measurements up to date.
  const inView = instance.getVirtualItems()
  const measurements = instance.measurementsCache
  const run = rows.value.length <= WHOLE_LIST_CARDS ? measurements : inView
  const first = run[0]?.index ?? 0
  const last = run.at(-1)?.index ?? -1
  const items = run.map((item) => ({ item, detached: false }))
  for (const index of pinnedIndexes.value) {
    const item = measurements[index]
    if (item !== undefined && (index < first || index > last)) items.push({ item, detached: true })
  }
  items.sort((left, right) => left.item.index - right.item.index)
  const offset = listOffset.value
  const total = measurements.at(-1)?.end ?? offset
  return {
    rows: items.flatMap(({ item, detached }) => {
      const row = rows.value[item.index]
      return row === undefined ? [] : [{ row, index: item.index, start: item.start - offset, detached }]
    }),
    before: last < first ? 0 : (measurements[first]?.start ?? offset) - offset,
    after: last < first ? 0 : total - (measurements[last]?.end ?? total)
  }
})
const visibleRows = computed(() => placed.value.rows)
const placement = computed(() => placed.value)

// Mounting and measuring cards, and entries added or resized above the view,
// change the list above the cards in view; keep the first card in view where
// it was, as the browser does for a list laid out whole.
// The first card in view is found before a render and put back where it was
// after it. Measuring newly mounted cards can render the list again before
// `onUpdated` runs, once, for both renders; the first render's anchor stands.
let anchor: { key: string; top: number } | undefined
onBeforeUpdate(() => {
  // A card being brought into view places the view itself.
  if (anchor !== undefined || revealKey !== undefined) return
  const scroller = scrollElement.value
  if (scroller === null || scroller.scrollTop <= listOffset.value) return
  const top = scroller.getBoundingClientRect().top
  for (const element of list.value?.children ?? []) {
    const card = element as HTMLElement
    if (card.dataset.detached !== undefined) continue
    const rect = card.getBoundingClientRect()
    if (rect.bottom > top) {
      anchor = { key: card.dataset.rowKey ?? '', top: rect.top }
      return
    }
  }
})
onUpdated(() => {
  const scroller = scrollElement.value
  const kept = anchor
  anchor = undefined
  if (scroller !== null && kept !== undefined) {
    for (const element of list.value?.children ?? []) {
      const card = element as HTMLElement
      if (card.dataset.rowKey !== kept.key) continue
      const moved = card.getBoundingClientRect().top - kept.top
      if (moved !== 0) scroller.scrollTop += moved
      break
    }
  }
  revealSelectedCard()
})

// When another entry becomes selected, by navigation, the caret or a click,
// or a click in the text asks to see the selected one, its card is brought
// into view as `scrollIntoView({ block: 'nearest' })` would, without moving
// focus. A card outside the mounted cards is placed at an estimated position;
// mounting and measuring the cards around it moves it, so it is brought into
// view again after each render until it stays.
let revealKey: string | undefined
let revealPasses = 0
let revealFrame: number | undefined
const stopReveal = (): void => {
  revealKey = undefined
  if (revealFrame !== undefined) cancelAnimationFrame(revealFrame)
  revealFrame = undefined
}
const revealSelectedCard = (): void => {
  if (revealKey === undefined) return
  const scroller = scrollElement.value
  revealPasses += 1
  if (scroller === null || scroller.clientHeight === 0 || revealPasses > 30) {
    revealKey = undefined
    return
  }
  const card = [...(list.value?.children ?? [])].find(
    (element) => (element as HTMLElement).dataset.rowKey === revealKey
  ) as HTMLElement | undefined
  if (card !== undefined) {
    const delta = nearestScrollDelta(scroller.getBoundingClientRect(), card.getBoundingClientRect())
    if (delta === 0) {
      // A card in view but still placed apart from the mounted cards is
      // checked again when the render that mounts its neighbours runs.
      if (card.dataset.detached === undefined) revealKey = undefined
      return
    }
    scroller.scrollTop += delta
  }
  // Rendering after the scroll mounts and measures the cards around it; a
  // card not mounted yet is looked for again, a bounded number of times.
  if (revealFrame !== undefined) cancelAnimationFrame(revealFrame)
  revealFrame = requestAnimationFrame(() => {
    revealFrame = undefined
    revealSelectedCard()
  })
}
watch(
  () => ({ start: props.activeStart, entries: props.entries }),
  (next, previous) => {
    if (!revealsSelectedEntry(previous, next)) return
    const entry = next.entries.find((candidate) => candidate.item.range.start === next.start)
    if (entry === undefined) return
    revealKey = String(rowKey(entry))
    revealPasses = 0
  },
  { flush: 'pre' }
)
watch(
  () => props.revealRequest,
  () => {
    const entry = props.entries.find((candidate) => candidate.item.range.start === props.activeStart)
    if (entry === undefined) return
    revealKey = String(rowKey(entry))
    revealPasses = 0
    revealSelectedCard()
  },
  { flush: 'post' }
)
onBeforeUnmount(() => {
  if (revealFrame !== undefined) cancelAnimationFrame(revealFrame)
})
const measure = (element: Element | ComponentPublicInstance | null): void => {
  if (element instanceof HTMLLIElement) virtualizer.value.measureElement(element)
}

// Out-of-flow cards are placed directly, so moving one is not a render of it.
const placeCards = (): void => {
  const starts = new Map(
    visibleRows.value.filter(({ detached }) => detached).map(({ row, start }) => [String(row.key), start])
  )
  for (const element of list.value?.children ?? []) {
    const card = element as HTMLElement
    const start = starts.get(card.dataset.rowKey ?? '')
    card.style.top = start === undefined ? '' : `${start}px`
  }
}
watch(visibleRows, placeCards, { flush: 'post' })

// The list starts below the sidebar's other content in the same scroll box.
const measureListOffset = (): void => {
  const scroller = scrollElement.value
  if (scroller === null || list.value === undefined) return
  const offset = list.value.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
  if (Math.abs(offset - listOffset.value) >= 1) listOffset.value = offset
}
let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  let scroller = list.value?.parentElement ?? null
  while (scroller !== null && !/(auto|scroll)/u.test(getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement
  }
  scrollElement.value = scroller
  measureListOffset()
  placeCards()
  // The author scrolling the sidebar takes over from a card being brought
  // into view.
  for (const type of ['wheel', 'pointerdown', 'keydown', 'touchstart']) {
    scroller?.addEventListener(type, stopReveal, { passive: true })
  }
  if (scroller !== null && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(measureListOffset)
    for (const child of scroller.children) if (child !== list.value) resizeObserver.observe(child)
  }
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  for (const type of ['wheel', 'pointerdown', 'keydown', 'touchstart']) {
    scrollElement.value?.removeEventListener(type, stopReveal)
  }
})

// The visible kind and excerpt are separate elements; join them into one
// readable accessible name.
const entryName = (entry: CoreReviewOverviewEntry): string => {
  const kind = t(`editor.coreReview.kinds.${entry.item.kind}`)
  const text = [entry.excerpt, entry.replacementExcerpt]
    .map((passage) => passage && rendered(passage).text)
    .filter((part) => part)
    .join(' → ')
  return text ? `${kind}: ${text}` : kind
}
</script>

<style scoped>
.core-review-list {
  position: relative;
  list-style: none;
  padding: 0;
  margin: 12px 0;
}
.core-review-entry {
  border-left: 2px solid transparent;
  padding: 6px;
}
.core-review-entry[data-detached] {
  position: absolute;
  left: 0;
  right: 0;
}
.core-review-entry.draft {
  padding: 6px 0;
}
.core-review-entry.active {
  border-left-color: var(--themeColor);
  background: var(--sideBarItemHoverBgColor);
}
.core-review-entry > button {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  text-align: left;
  border: 0;
  padding: 4px;
  color: var(--sideBarColor);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.core-review-entry > button:hover {
  background: var(--sideBarItemHoverBgColor);
}
.core-review-entry > button:focus-visible {
  background: var(--sideBarItemHoverBgColor);
}
.core-review-entry-kind {
  font-weight: 600;
  font-size: 13px;
}
.core-review-excerpt {
  text-align: start;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  max-height: 5em;
  overflow: auto;
}
/* Review marks read as they do in the editor. */
.core-review-list :deep(.core-critic-addition),
.core-review-list :deep(.core-critic-substitution-new) {
  background: color-mix(in srgb, #3b9959 18%, transparent);
  text-decoration: underline;
  text-decoration-color: #3b9959;
}
.core-review-list :deep(.core-critic-deletion),
.core-review-list :deep(.core-critic-substitution-old) {
  background: color-mix(in srgb, #ce5555 14%, transparent);
  text-decoration: line-through;
  text-decoration-color: #ce5555;
}
.core-review-list :deep(.core-critic-highlight) {
  background: color-mix(in srgb, #d4ac33 26%, transparent);
}
.core-review-entry > .core-review-comment {
  color: var(--sideBarTextColor);
  font-size: 12px;
  padding: 0 4px;
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
