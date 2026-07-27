import { describe, expect, it } from 'vitest'
import {
  createDocumentSearchQuery,
  findSearchMatches
} from '@marktext/document-core'

describe('document search query', () => {
  it('searches literal text case-insensitively by default', () => {
    const query = createDocumentSearchQuery('apple')

    expect(query).toEqual({
      schema: 'document-search-query-1',
      text: 'apple',
      syntax: 'literal',
      caseSensitive: false,
      wholeWord: false
    })
    expect(findSearchMatches('Apple and apple\n', query)).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 15 }
    ])
  })

  it('honors explicit case-sensitive literal matching', () => {
    const query = createDocumentSearchQuery('apple', {
      caseSensitive: true
    })

    expect(findSearchMatches('Apple and apple\n', query)).toEqual([
      { start: 10, end: 15 }
    ])
  })

  it('finds one literal that crosses a cooperative checkpoint boundary', () => {
    const query = createDocumentSearchQuery('needle', {
      caseSensitive: true
    })
    const source = `${'x'.repeat(4_094)}needle tail`

    expect(findSearchMatches(source, query)).toEqual([
      { start: 4_094, end: 4_100 }
    ])
  })

  it('accepts the fixed query boundary and rejects the first unit above it', () => {
    expect(() => createDocumentSearchQuery('x'.repeat(4_096)))
      .not.toThrow()
    expect(() => createDocumentSearchQuery('x'.repeat(4_097)))
      .toThrow(/query exceeds the search resource policy/i)
  })

  it('uses Unicode word boundaries for whole-word matching', () => {
    const query = createDocumentSearchQuery('猫', {
      wholeWord: true
    })

    expect(findSearchMatches('猫 猫咪\n', query)).toEqual([
      { start: 0, end: 1 }
    ])
  })

  it('matches valid regular expressions with the same query options', () => {
    const query = createDocumentSearchQuery('ap(ple|ricot)', {
      syntax: 'regexp'
    })

    expect(findSearchMatches('Apple apricot banana\n', query)).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 13 }
    ])
  })

  it('keeps bounded single-atom repetitions inside the safe regexp subset', () => {
    const query = createDocumentSearchQuery('\\d{2}', {
      syntax: 'regexp'
    })

    expect(findSearchMatches('7 42 314\n', query)).toEqual([
      { start: 2, end: 4 },
      { start: 5, end: 7 }
    ])
  })

  it('accepts the fixed match-width boundary and rejects the first unit above it', () => {
    const query = createDocumentSearchQuery('a+', {
      syntax: 'regexp',
      caseSensitive: true
    })

    expect(findSearchMatches('a'.repeat(4_096), query)).toEqual([
      { start: 0, end: 4_096 }
    ])
    expect(() => findSearchMatches('a'.repeat(4_097), query))
      .toThrow(/match exceeds the search resource policy/i)
  })

  it('accepts the fixed match-count boundary and rejects the first match above it', () => {
    const query = createDocumentSearchQuery('a', {
      caseSensitive: true
    })

    expect(findSearchMatches('a '.repeat(16_384), query)).toHaveLength(16_384)
    expect(() => findSearchMatches('a '.repeat(16_385), query))
      .toThrow(/match set exceeds the search resource policy/i)
  })

  it('rejects a regular expression that can produce an empty match', () => {
    expect(() => createDocumentSearchQuery('a*', {
      syntax: 'regexp'
    }))
      .toThrow(/regular expression matches empty text/i)
  })

  it('rejects a regular expression with catastrophic backtracking structure', () => {
    expect(() => createDocumentSearchQuery('(a+)+$', {
      syntax: 'regexp'
    }))
      .toThrow(/regular expression exceeds the search resource policy/i)
  })
})
