import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useCriticMarkupReviewStore } from '@/store/criticMarkupReview'

describe('CriticMarkup Review store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('holds only the current ephemeral document snapshot and clears atomically', () => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      fileId: 'file-1',
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

    expect(store.snapshot.fileId).toBe('file-1')
    expect(store.snapshot.items).toHaveLength(1)

    store.CLEAR()
    expect(store.snapshot).toEqual({
      fileId: null,
      available: false,
      items: [],
      currentItemId: null,
      trackChanges: false,
      projection: 'marked'
    })
  })
})
