import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { CriticMarkupSidebarState } from '@shared/types/criticMarkup'
import type { CriticMarkupCommentEditRequest } from '@shared/types/criticMarkup'

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
  const commentEditRequest = shallowRef<CriticMarkupCommentEditRequest | null>(null)

  function UPDATE(next: CriticMarkupSidebarState): void {
    snapshot.value = next
  }

  function CLEAR(): void {
    snapshot.value = emptySnapshot()
    // A cleared document can have no open compose box to submit against.
    composing.value = false
    commentEditRequest.value = null
  }

  function SET_COMPOSING(value: boolean): void {
    composing.value = value
  }

  function REQUEST_COMMENT_EDIT(request: CriticMarkupCommentEditRequest): void {
    commentEditRequest.value = request
  }

  function TAKE_COMMENT_EDIT(): CriticMarkupCommentEditRequest | null {
    const request = commentEditRequest.value
    commentEditRequest.value = null
    return request
  }

  return {
    snapshot,
    composing,
    commentEditRequest,
    UPDATE,
    CLEAR,
    SET_COMPOSING,
    REQUEST_COMMENT_EDIT,
    TAKE_COMMENT_EDIT
  }
})
