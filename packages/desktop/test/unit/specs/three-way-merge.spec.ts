import { describe, expect, it } from 'vitest'
import {
  mergeMarkdownThreeWay,
  resolveConflictMarker
} from '../../../src/renderer/src/util/threeWayMerge'

const metadata = (body: string): string =>
  `data:application/json;base64,${Buffer.from(JSON.stringify({
    version: 1,
    status: 'open',
    replies: [
      {
        author: 'Agent',
        createdAt: '2026-06-30T12:00:00.000Z',
        body
      }
    ]
  })).toString('base64')}`

describe('mergeMarkdownThreeWay', () => {
  it('auto-merges non-overlapping line changes', () => {
    const result = mergeMarkdownThreeWay({
      base: ['one\n', 'two\n', 'three\n'].join(''),
      local: ['one local\n', 'two\n', 'three\n'].join(''),
      remote: ['one\n', 'two\n', 'three remote\n'].join('')
    })

    expect(result.conflicts).toEqual([])
    expect(result.mergedMarkdown).toBe(['one local\n', 'two\n', 'three remote\n'].join(''))
  })

  it('emits conflict markers for overlapping line changes', () => {
    const result = mergeMarkdownThreeWay({
      base: 'one\nshared\nthree\n',
      local: 'one\nlocal\nthree\n',
      remote: 'one\nremote\nthree\n'
    })

    expect(result.conflicts).toHaveLength(1)
    expect(result.mergedMarkdown).toContain('<<<<<<< MARKTEXT_LOCAL c1')
    expect(result.mergedMarkdown).toContain('||||||| MARKTEXT_BASE c1')
    expect(result.mergedMarkdown).toContain('>>>>>>> MARKTEXT_REMOTE c1')
  })

  it('preserves CRLF line endings in generated conflict markers', () => {
    const result = mergeMarkdownThreeWay({
      base: 'one\r\nshared\r\nthree\r\n',
      local: 'one\r\nlocal\r\nthree\r\n',
      remote: 'one\r\nremote\r\nthree\r\n'
    })

    expect(result.conflicts).toHaveLength(1)
    expect(result.mergedMarkdown).toContain('<<<<<<< MARKTEXT_LOCAL c1\r\n')
    expect(result.mergedMarkdown).toContain('||||||| MARKTEXT_BASE c1\r\n')
    expect(result.mergedMarkdown).toContain('=======\r\n')
    expect(result.mergedMarkdown).toContain('>>>>>>> MARKTEXT_REMOTE c1\r\n')
    expect(result.mergedMarkdown).not.toMatch(/(?<!\r)\n/)
  })

  it('can resolve a generated conflict marker', () => {
    const result = mergeMarkdownThreeWay({
      base: 'one\nshared\nthree\n',
      local: 'one\nlocal\nthree\n',
      remote: 'one\nremote\nthree\n'
    })
    const [conflict] = result.conflicts

    expect(resolveConflictMarker(result.mergedMarkdown, conflict, 'remote')).toBe(
      'one\nremote\nthree\n'
    )
  })

  it('auto-merges non-overlapping prose and comment metadata edits without changing marker bytes', () => {
    const base = [
      'A <!--MC:a-->reviewed<!--MC:~a--> span.',
      '',
      `[MC:a]: ${metadata('Base note.')}`,
      ''
    ].join('\n')
    const local = base.replace(' span.', ' span with local edits.')
    const remote = base.replace(metadata('Base note.'), metadata('Agent note.'))

    const result = mergeMarkdownThreeWay({ base, local, remote })

    expect(result.conflicts).toEqual([])
    expect(result.mergedMarkdown).toContain('<!--MC:a-->reviewed<!--MC:~a-->')
    expect(result.mergedMarkdown).toContain('span with local edits.')
    expect(result.mergedMarkdown).toContain(`[MC:a]: ${metadata('Agent note.')}`)
  })

  it('escalates overlapping comment range edits to conflict markers', () => {
    const result = mergeMarkdownThreeWay({
      base: 'A <!--MC:a-->reviewed<!--MC:~a--> span.\n',
      local: 'A <!--MC:a-->locally reviewed<!--MC:~a--> span.\n',
      remote: 'A <!--MC:a-->agent reviewed<!--MC:~a--> span.\n'
    })

    expect(result.conflicts).toHaveLength(1)
    expect(result.mergedMarkdown).toContain('<<<<<<< MARKTEXT_LOCAL c1')
    expect(result.mergedMarkdown).toContain('<!--MC:a-->locally reviewed<!--MC:~a-->')
    expect(result.mergedMarkdown).toContain('<!--MC:a-->agent reviewed<!--MC:~a-->')
  })
})
