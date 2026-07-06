import { describe, expect, it, vi } from 'vitest'
import type * as MuyaCore from '@muyajs/core'

vi.mock('@muyajs/core', async(importOriginal) => {
  const actual = await importOriginal<typeof MuyaCore>()
  return {
    ...actual,
    analyzeMarkdownComments: vi.fn(actual.analyzeMarkdownComments)
  }
})

const parserOptions = {
  footnote: false,
  math: true,
  isGitlabCompatibilityEnabled: true,
  trimUnnecessaryCodeBlockEmptyLines: false,
  frontMatter: true
}

describe('source comment controller analyzer wiring', () => {
  it('validates source comment candidates through the authoritative analyzer', async() => {
    const core = await import('@muyajs/core')
    const { getSourceCommentCandidate } = await import(
      '@/components/editorWithTabs/sourceCommentController'
    )
    const markdown = 'A reviewed span.\n'

    expect(getSourceCommentCandidate(markdown, 2, 10, parserOptions)).toEqual({
      id: 'cmt_1',
      startIndex: 2,
      endIndex: 10
    })

    expect(vi.mocked(core.analyzeMarkdownComments)).toHaveBeenCalled()
  })
})
