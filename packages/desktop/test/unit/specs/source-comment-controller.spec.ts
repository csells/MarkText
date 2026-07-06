import { describe, expect, it } from 'vitest'
import { analyzeMarkdownComments, encodeCommentMetadata } from '@muyajs/core'
import {
  createSourceCommentAnalysis,
  getSourceCommentCandidate,
  sourceCommentDiscardRanges,
  sourceCommentMarkdown,
  type SourceCommentParserOptions
} from '@/components/editorWithTabs/sourceCommentController'

const parserOptions: SourceCommentParserOptions = {
  footnote: false,
  math: true,
  isGitlabCompatibilityEnabled: true,
  trimUnnecessaryCodeBlockEmptyLines: false,
  frontMatter: true
}

describe('source comment controller', () => {
  it('wraps a valid source selection and appends portable metadata', () => {
    const markdown = 'A reviewed span.\n'
    const start = markdown.indexOf('reviewed')
    const end = start + 'reviewed'.length

    const candidate = getSourceCommentCandidate(markdown, start, end, parserOptions)

    expect(candidate).toEqual({ id: 'cmt_1', startIndex: start, endIndex: end })
    if (!candidate) throw new Error('Expected a source comment candidate')
    const nextMarkdown = sourceCommentMarkdown(markdown, start, end, candidate.id)
    const comments = analyzeMarkdownComments(nextMarkdown, parserOptions).comments
    expect(comments.ranges).toEqual([expect.objectContaining({ id: 'cmt_1', preview: 'reviewed' })])
    expect(nextMarkdown).toContain('[MC:cmt_1]: data:application/json;base64,')
  })

  it('rejects selections that are not valid comment ranges', () => {
    expect(getSourceCommentCandidate('A reviewed span.\n', 2, 3, parserOptions)).not.toBeNull()
    expect(getSourceCommentCandidate('A reviewed span.\n', 1, 1, parserOptions)).toBeNull()
    expect(getSourceCommentCandidate('A   span.\n', 1, 4, parserOptions)).toBeNull()

    const commented = sourceCommentMarkdown('A reviewed span.\n', 2, 10, 'cmt_1')
    expect(
      getSourceCommentCandidate(commented, 0, commented.indexOf('span'), parserOptions)
    ).toBeNull()

    const metadataStart = commented.indexOf('[MC:cmt_1]:')
    expect(
      getSourceCommentCandidate(
        commented,
        metadataStart,
        metadataStart + '[MC:cmt_1]:'.length,
        parserOptions
      )
    ).toBeNull()

    expect(
      getSourceCommentCandidate('# Heading\n', 0, '# Heading'.length, parserOptions)
    ).toBeNull()
    expect(getSourceCommentCandidate('- [ ] task\n', 2, 10, parserOptions)).toBeNull()
  })

  it('computes active source comment ids from source indexes', () => {
    const markdown = sourceCommentMarkdown('A reviewed span.\n', 2, 10, 'cmt_1')
    const analysis = createSourceCommentAnalysis(markdown, parserOptions)

    expect(analysis.sourceIndex.commentRanges).toEqual([expect.objectContaining({ id: 'cmt_1' })])
    expect(analysis.sourceMaps.ranges).toEqual([
      expect.objectContaining({
        id: 'cmt_1',
        sourceRange: analysis.sourceIndex.commentRanges[0],
        metadataDefinition: expect.objectContaining({ id: 'cmt_1' }),
        syntaxRemovalRanges: expect.any(Array)
      })
    ])
  })

  it('derives discard ranges from source maps and requires an empty open thread', () => {
    const markdown = sourceCommentMarkdown('A reviewed span.\n', 2, 10, 'cmt_1')
    const analysis = createSourceCommentAnalysis(markdown, parserOptions)

    expect(sourceCommentDiscardRanges(analysis, 'cmt_1')).toEqual(
      analysis.sourceMaps.ranges[0].syntaxRemovalRanges
    )

    const repliedMetadata = encodeCommentMetadata({
      version: 1,
      status: 'open',
      replies: [
        {
          author: 'A',
          createdAt: '2026-01-01T00:00:00.000Z',
          body: 'Note'
        }
      ]
    })
    const replied = sourceCommentMarkdown('A reviewed span.\n', 2, 10, 'cmt_1').replace(
      /data:application\/json;base64,\S+/u,
      repliedMetadata
    )
    expect(sourceCommentDiscardRanges(createSourceCommentAnalysis(replied, parserOptions), 'cmt_1'))
      .toEqual([])
  })
})
