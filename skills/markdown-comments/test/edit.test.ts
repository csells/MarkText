import { describe, expect, it } from 'vitest'
import { encodeCommentMetadata } from '../src/metadata'
import { patchCommentMetadata, replyToComment, setCommentStatus } from '../src/edit'
import { readMarkdownComments } from '../src/parse'

const metadata = encodeCommentMetadata({
  version: 1,
  status: 'open',
  authors: ['Ada'],
  createdAt: '2026-06-30T12:00:00.000Z',
  updatedAt: '2026-06-30T12:00:00.000Z',
  replies: []
})

const markdown = [
  'A <!--MC:a-->reviewed<!--MC:~a--> line.',
  '',
  `[MC:a]: ${metadata}`,
  ''
].join('\n')

describe('markdown-comments skill helpers', () => {
  it('parses comments with deterministic ordering', () => {
    expect(readMarkdownComments(markdown)).toMatchObject({
      threads: [{ id: 'a', status: 'open' }],
      ranges: [{ id: 'a' }],
      diagnostics: []
    })
  })

  it('updates only the target metadata definition', () => {
    const next = setCommentStatus(markdown, 'a', 'resolved', '2026-06-30T13:00:00.000Z')
    expect(next).toContain('A <!--MC:a-->reviewed<!--MC:~a--> line.')
    expect(readMarkdownComments(next).threads[0]).toMatchObject({
      id: 'a',
      status: 'resolved',
      updatedAt: '2026-06-30T13:00:00.000Z'
    })
  })

  it('appends replies and preserves existing authors', () => {
    const next = replyToComment(markdown, 'a', {
      author: 'Grace',
      body: 'Looks good.',
      createdAt: '2026-06-30T14:00:00.000Z'
    })
    expect(readMarkdownComments(next).threads[0]).toMatchObject({
      authors: ['Ada', 'Grace'],
      replies: [{ author: 'Grace', body: 'Looks good.' }]
    })
  })

  it('applies explicit metadata patches', () => {
    const next = patchCommentMetadata(markdown, 'a', {
      authors: ['Grace'],
      updatedAt: '2026-06-30T15:00:00.000Z'
    })
    expect(readMarkdownComments(next).threads[0]).toMatchObject({
      authors: ['Grace'],
      updatedAt: '2026-06-30T15:00:00.000Z'
    })
  })
})
