import { describe, expect, it } from 'vitest'
import { createDocumentState } from '@/store/help'

describe('createDocumentState', () => {
  it('uses saved restored markdown as the disk merge base instead of stale buffered base', () => {
    const state = createDocumentState({
      filename: 'review.md',
      pathname: '/docs/review.md',
      markdown: 'disk content after restart',
      diskBaseMarkdown: 'stale content from previous session',
      isSaved: true
    })

    expect(state.diskBaseMarkdown).toBe('disk content after restart')
  })

  it('preserves an unsaved restored tab merge base', () => {
    const state = createDocumentState({
      filename: 'review.md',
      pathname: '/docs/review.md',
      markdown: 'local unsaved content',
      diskBaseMarkdown: 'last clean disk content',
      isSaved: false
    })

    expect(state.diskBaseMarkdown).toBe('last clean disk content')
  })
})
