import { describe, expect, it } from 'vitest'
import {
  mergeMarkdownThreeWay,
  resolveConflictMarker
} from '../../../src/renderer/src/util/threeWayMerge'

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
})
