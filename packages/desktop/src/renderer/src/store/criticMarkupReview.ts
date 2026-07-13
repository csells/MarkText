import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
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

  function UPDATE(next: CriticMarkupSidebarState): void {
    snapshot.value = next
  }

  function CLEAR(): void {
    snapshot.value = emptySnapshot()
  }

  return { snapshot, UPDATE, CLEAR }
})
