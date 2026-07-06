import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { encodeCommentMetadata } from '@muyajs/core/comments'
import { editCommentReply, patchCommentMetadata, replyToComment, setCommentStatus } from '../src/edit'
import { readMarkdownComments, stableJson } from '../src/parse'

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
  it('reads comments through the authoritative analyzer', () => {
    const source = readFileSync(new URL('../src/parse.ts', import.meta.url), 'utf8')

    expect(source).toContain('analyzeMarkdownComments')
    expect(source).not.toContain('parseMarkdownComments')
  })

  it('parses comments with deterministic ordering', () => {
    expect(readMarkdownComments(markdown)).toMatchObject({
      threads: [{ id: 'a', status: 'open' }],
      ranges: [{ id: 'a' }],
      diagnostics: []
    })
  })

  it('uses ordinal key ordering for deterministic JSON output', () => {
    expect(stableJson({ z: 1, ä: 2, a: 3 })).toBe([
      '{',
      '  "a": 3,',
      '  "z": 1,',
      '  "ä": 2',
      '}',
      ''
    ].join('\n'))
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

  it('skips malformed duplicate metadata and updates the first valid definition', () => {
    const badLine = '[MC:a]: data:application/json;base64,%%%%'
    const next = setCommentStatus(
      [
        'A <!--MC:a-->reviewed<!--MC:~a--> line.',
        '',
        badLine,
        `[MC:a]: ${metadata}`,
        ''
      ].join('\n'),
      'a',
      'resolved',
      '2026-06-30T16:00:00.000Z'
    )
    const metadataLines = next.split('\n').filter(line => line.startsWith('[MC:a]:'))
    expect(metadataLines[0]).toBe(badLine)

    const updatedDataUri = metadataLines[1].replace('[MC:a]: ', '')
    const updatedMetadata = JSON.parse(
      Buffer.from(updatedDataUri.replace('data:application/json;base64,', ''), 'base64')
        .toString('utf8')
    ) as { status?: string; updatedAt?: string }
    expect(updatedMetadata).toMatchObject({
      status: 'resolved',
      updatedAt: '2026-06-30T16:00:00.000Z'
    })
  })

  it('skips metadata-looking definitions in ignored Markdown blocks', () => {
    const document = [
      '---',
      `[MC:a]: ${metadata}`,
      '---',
      '',
      '$$',
      `[MC:a]: ${metadata}`,
      '$$',
      '',
      '<section>',
      `[MC:a]: ${metadata}`,
      '</section>',
      '',
      `    [MC:a]: ${metadata}`,
      '',
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      '',
      `[MC:a]: ${metadata}`,
      ''
    ].join('\n')

    const next = setCommentStatus(document, 'a', 'resolved', '2026-06-30T17:00:00.000Z')
    const statuses = next
      .split('\n')
      .filter(line => line.trimStart().startsWith('[MC:a]: '))
      .map((line) => {
        const dataUri = line.trim().replace('[MC:a]: ', '')
        return JSON.parse(
          Buffer.from(dataUri.replace('data:application/json;base64,', ''), 'base64')
            .toString('utf8')
        ) as { status?: string }
      })
      .map(thread => thread.status)

    expect(statuses).toEqual(['open', 'open', 'open', 'open', 'resolved'])
  })

  it('edits an existing reply by index without replacing the whole thread', () => {
    const withReplies = replyToComment(
      replyToComment(markdown, 'a', {
        author: 'Grace',
        body: 'First reply.',
        createdAt: '2026-06-30T14:00:00.000Z'
      }),
      'a',
      {
        author: 'Linus',
        body: 'Second reply.',
        createdAt: '2026-06-30T14:05:00.000Z'
      }
    )

    const next = editCommentReply(withReplies, 'a', 1, {
      body: 'Updated second reply.',
      author: 'Linus',
      updatedAt: '2026-06-30T15:00:00.000Z'
    })

    expect(readMarkdownComments(next).threads[0]).toMatchObject({
      updatedAt: '2026-06-30T15:00:00.000Z',
      replies: [
        { author: 'Grace', body: 'First reply.' },
        { author: 'Linus', body: 'Updated second reply.' }
      ]
    })
  })
})
