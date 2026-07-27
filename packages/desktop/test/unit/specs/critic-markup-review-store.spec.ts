import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useCriticMarkupReviewStore } from '@/store/criticMarkupReview'

describe('CriticMarkup Review store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('holds only the current ephemeral document snapshot and clears atomically', () => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      documentId: 'document:1',
      revisionId: 'revision:1',
      available: true,
      items: [{
        id: 'critic-0-7',
        type: 'addition',
        path: [0],
        start: 0,
        end: 7,
        sourceStart: 0,
        sourceEnd: 7,
        raw: '{++x++}',
        content: 'x'
      }],
      currentItemId: 'critic-0-7',
      trackChanges: true,
      projection: 'marked'
    })

    expect(store.snapshot.documentId).toBe('document:1')
    expect(store.snapshot.revisionId).toBe('revision:1')
    expect(store.snapshot.items).toHaveLength(1)

    store.CLEAR()
    expect(store.snapshot).toEqual({
      documentId: null,
      revisionId: null,
      available: false,
      items: [],
      currentItemId: null,
      trackChanges: false,
      projection: 'marked'
    })
  })

  it('tracks whether a comment is being composed in the sidebar', () => {
    const store = useCriticMarkupReviewStore()
    // A fresh store is not composing; the compose box stays hidden.
    expect(store.composing).toBe(false)

    store.SET_COMPOSING(true)
    expect(store.composing).toBe(true)

    store.SET_COMPOSING(false)
    expect(store.composing).toBe(false)
  })

  it('stops composing when the document snapshot is cleared', () => {
    const store = useCriticMarkupReviewStore()
    store.SET_COMPOSING(true)

    // Switching files / tearing down the editor must not strand an open
    // compose box against a document that is gone.
    store.CLEAR()
    expect(store.composing).toBe(false)
  })
})
