import { describe, expect, it } from 'vitest'
import {
  analyzeMarkdownComments,
  appendCommentReplyMetadata,
  updateCommentMetadataInMarkdown
} from '@muyajs/core'

import { mergeMarkdownThreeWay } from '@/util/threeWayMerge'

const parseMarkdownComments = (markdown: string) => analyzeMarkdownComments(markdown).comments

// Pinned property 3 of the comment wire format v2
// (specs/architecture/comment-format.md): the format exists so plain
// line-oriented Git merges of parallel comment work come out right. Our own
// diff3 engine is the oracle — the same engine the dirty-external merge
// pipeline runs.

const HEAD =
  '[MC:a]: {"version":2,"status":"open","authors":["Ada"],"createdAt":"2026-07-07T09:00:00.000Z"}'
const REPLY_0 = '[MC:a.0]: {"author":"Ada","createdAt":"2026-07-07T09:00:00.000Z","body":"First"}'
const REPLY_1 = '[MC:a.1]: {"author":"Agent","createdAt":"2026-07-07T09:05:00.000Z","body":"Second"}'

const base = ['Hello <!--MC:a-->reviewed<!--MC:~a--> world.', '', HEAD, REPLY_0, REPLY_1, ''].join(
  '\n'
)

const editReply = (markdown: string, index: number, body: string): string => {
  const next = updateCommentMetadataInMarkdown(markdown, 'a', (metadata) => ({
    ...metadata,
    replies: metadata.replies.map((reply, i) => (i === index ? { ...reply, body } : reply))
  }))
  if (!next) throw new Error('edit failed')
  return next
}

const appendReply = (markdown: string, author: string, body: string, createdAt: string): string => {
  const next = updateCommentMetadataInMarkdown(markdown, 'a', (metadata) =>
    appendCommentReplyMetadata(metadata, { author, body, createdAt })
  )
  if (!next) throw new Error('append failed')
  return next
}

describe('comment format v2 under three-way line merge', () => {
  it('parallel edits to different replies of one thread merge cleanly', () => {
    const local = editReply(base, 0, 'First (edited locally)')
    const remote = editReply(base, 1, 'Second (edited remotely)')

    const result = mergeMarkdownThreeWay({ base, local, remote })

    expect(result.conflicts).toEqual([])
    const thread = parseMarkdownComments(result.mergedMarkdown).threads[0]
    expect(thread.replies.map((reply) => reply.body)).toEqual([
      'First (edited locally)',
      'Second (edited remotely)'
    ])
  })

  it('a status change concurrent with a new reply merges cleanly', () => {
    const local = updateCommentMetadataInMarkdown(base, 'a', (metadata) => ({
      ...metadata,
      status: 'resolved',
      updatedAt: '2026-07-07T10:00:00.000Z'
    }))
    if (!local) throw new Error('status change failed')
    const remote = appendReply(base, 'Zoe', 'A third note', '2026-07-07T10:05:00.000Z')

    const result = mergeMarkdownThreeWay({ base, local, remote })

    expect(result.conflicts).toEqual([])
    const parsed = parseMarkdownComments(result.mergedMarkdown)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.threads[0]).toMatchObject({
      status: 'resolved',
      // Thread updatedAt derives from the newest of head and replies.
      updatedAt: '2026-07-07T10:05:00.000Z'
    })
    expect(parsed.threads[0].replies).toHaveLength(3)
  })

  it('replies to different threads merge cleanly', () => {
    const twoThreads = [
      'Hello <!--MC:a-->one<!--MC:~a--> and <!--MC:b-->two<!--MC:~b-->.',
      '',
      HEAD,
      REPLY_0,
      '[MC:b]: {"version":2,"status":"open"}',
      ''
    ].join('\n')
    const local = appendReply(twoThreads, 'Ada', 'On thread a', '2026-07-07T10:00:00.000Z')
    const remote = updateCommentMetadataInMarkdown(twoThreads, 'b', (metadata) =>
      appendCommentReplyMetadata(metadata, {
        author: 'Zoe',
        body: 'On thread b',
        createdAt: '2026-07-07T10:01:00.000Z'
      })
    )
    if (!remote) throw new Error('append failed')

    const result = mergeMarkdownThreeWay({ base: twoThreads, local, remote })

    expect(result.conflicts).toEqual([])
    const parsed = parseMarkdownComments(result.mergedMarkdown)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.threads.find((t) => t.id === 'a')?.replies.map((r) => r.body)).toEqual([
      'First',
      'On thread a'
    ])
    expect(parsed.threads.find((t) => t.id === 'b')?.replies.map((r) => r.body)).toEqual([
      'On thread b'
    ])
  })

  it('parallel new replies at the same point conflict legibly and their union parses', () => {
    const local = appendReply(base, 'Ada', 'Local addition', '2026-07-07T10:00:00.000Z')
    const remote = appendReply(base, 'Zoe', 'Remote addition', '2026-07-07T10:01:00.000Z')

    const result = mergeMarkdownThreeWay({ base, local, remote })

    expect(result.conflicts).toHaveLength(1)
    const conflict = result.conflicts[0]
    // Legible: each side of the conflict is one readable reply line.
    expect(conflict.localText.trim()).toContain('"body":"Local addition"')
    expect(conflict.remoteText.trim()).toContain('"body":"Remote addition"')

    // The union of both sides parses as a valid two-new-reply thread.
    const union = result.mergedMarkdown.replace(
      conflict.markerText,
      `${conflict.localText}${conflict.remoteText}`
    )
    const parsed = parseMarkdownComments(union)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.threads[0].replies.map((reply) => reply.body)).toEqual([
      'First',
      'Second',
      'Local addition',
      'Remote addition'
    ])
  })
})
