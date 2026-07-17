import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { CriticMarkupSidebarState } from '@shared/types/criticMarkup'

const emptySnapshot = (): CriticMarkupSidebarState => ({
  fileId: null,
  available: false,
  items: [],
  currentItemId: null,
  trackChanges: false,
  projection: 'marked'
})

export const useCriticMarkupReviewStore = defineStore('criticMarkupReview', () => {
  const snapshot = shallowRef<CriticMarkupSidebarState>(emptySnapshot())
  // Whether the sidebar is currently composing a new comment. Drives the
  // compose box's visibility; the editor's composer owns the value.
  const composing = ref(false)

  function UPDATE(next: CriticMarkupSidebarState): void {
    snapshot.value = next
  }

  function CLEAR(): void {
    snapshot.value = emptySnapshot()
    // A cleared document can have no open compose box to submit against.
    composing.value = false
  }

  function SET_COMPOSING(value: boolean): void {
    composing.value = value
  }

  return { snapshot, composing, UPDATE, CLEAR, SET_COMPOSING }
})
