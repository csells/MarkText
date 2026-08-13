import { describe, expect, it, vi } from 'vitest'

import {
  executeProjectedSearchReplacement,
  type ProjectedSearchSnapshot
} from '@/documentConsumers/projectedSearchReplacementAuthority'

const snapshot: ProjectedSearchSnapshot = Object.freeze({
  identity: Object.freeze({ generation: 7, revision: 3 }),
  result: Object.freeze({
    index: 0,
    value: 'cat',
    matches: Object.freeze([Object.freeze({
      path: Object.freeze([0]),
      start: 0,
      end: 3,
      match: 'cat',
      subMatches: Object.freeze([])
    })])
  }),
  options: Object.freeze({})
})

describe('projected search replacement authority', () => {
  it('settles and submits the exact cached match identity without document bytes', async() => {
    const calls: string[] = []
    const replace = vi.fn(async(_identity, _replacements) => {
      calls.push('replace')
      return {
        type: 'applied' as const,
        session: 7,
        sequence: 4,
        revision: 4,
        accepted: true as const,
        sourceLength: 3,
        diagnosticCount: 0,
        diagnostics: [],
        change: { appliedEdits: [], projections: [] }
      }
    })

    await expect(executeProjectedSearchReplacement({
      snapshot,
      value: 'dog',
      options: { isSingle: true, isRegexp: false },
      settle: async() => { calls.push('settle') },
      isCurrent: () => true,
      replace
    })).resolves.toMatchObject({ type: 'applied', revision: 4 })

    expect(calls).toEqual(['settle', 'replace'])
    expect(replace).toHaveBeenCalledWith(
      { generation: 7, revision: 3 },
      [{
        match: { path: [0], start: 0, end: 3, match: 'cat' },
        insert: 'dog'
      }]
    )
    expect(replace.mock.calls[0]?.flat(Infinity)).not.toContain('source')
  })

  it('fails closed when settlement invalidates the cached search', async() => {
    const replace = vi.fn()

    await expect(executeProjectedSearchReplacement({
      snapshot,
      value: 'dog',
      options: { isSingle: true, isRegexp: false },
      settle: async() => {},
      isCurrent: () => false,
      replace
    })).resolves.toBeUndefined()
    expect(replace).not.toHaveBeenCalled()
  })
})
