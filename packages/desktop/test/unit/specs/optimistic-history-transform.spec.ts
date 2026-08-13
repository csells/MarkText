import { describe, expect, it } from 'vitest'

import { transformOptimisticHistory } from '@/documentAuthority/optimisticHistoryTransform'

describe('optimistic history transform', () => {
  const applyEdits = (
    source: string,
    edits: readonly Readonly<{ start: number; end: number; insert: string }>[]
  ): string => {
    let offset = 0
    const output: string[] = []
    for (const edit of edits) {
      output.push(source.slice(offset, edit.start), edit.insert)
      offset = edit.end
    }
    output.push(source.slice(offset))
    return output.join('')
  }

  const transformSources = (
    base: string,
    history: readonly Readonly<{ start: number; end: number; insert: string }>[],
    queued: readonly (readonly Readonly<{
      start: number
      end: number
      insert: string
    }>[])[]
  ) => {
    const transformed = transformOptimisticHistory({
      baseSourceLength: base.length,
      appliedEdits: history,
      queuedTransactions: queued
    })
    if (transformed.kind === 'conflict') return transformed
    let optimistic = base
    for (const transaction of queued) {
      optimistic = applyEdits(optimistic, transaction)
    }
    let authoritative = applyEdits(base, history)
    for (const transaction of transformed.rebasedTransactions) {
      authoritative = applyEdits(authoritative, transaction)
    }
    return {
      transformed,
      optimistic,
      authoritative,
      reconciled: applyEdits(optimistic, transformed.reconciliationEdits)
    }
  }

  it('orders a pending insertion after earlier actor history at the same point', () => {
    const result = transformOptimisticHistory({
      baseSourceLength: 4,
      appliedEdits: [{ start: 2, end: 2, insert: 'H' }],
      queuedTransactions: [[{ start: 2, end: 2, insert: 'P' }]]
    })

    expect(result).toEqual({
      kind: 'transformed',
      rebasedTransactions: [[{ start: 3, end: 3, insert: 'P' }]],
      reconciliationEdits: [{ start: 2, end: 2, insert: 'H' }]
    })
    expect(structuredClone(result)).toEqual(result)
  })

  it('preserves sequential P then Q after an earlier replacement at their boundary', () => {
    const result = transformOptimisticHistory({
      baseSourceLength: 6,
      appliedEdits: [{ start: 1, end: 4, insert: 'X' }],
      queuedTransactions: [
        [{ start: 1, end: 1, insert: 'P' }],
        [{ start: 2, end: 2, insert: 'Q' }]
      ]
    })

    expect(result).toEqual({
      kind: 'transformed',
      rebasedTransactions: [
        [{ start: 2, end: 2, insert: 'P' }],
        [{ start: 3, end: 3, insert: 'Q' }]
      ],
      reconciliationEdits: [
        { start: 1, end: 1, insert: 'X' },
        { start: 3, end: 6, insert: '' }
      ]
    })
  })

  it('tracks a pending insertion when a later pending transaction deletes it', () => {
    const result = transformOptimisticHistory({
      baseSourceLength: 6,
      appliedEdits: [{ start: 1, end: 4, insert: 'X' }],
      queuedTransactions: [
        [{ start: 1, end: 1, insert: 'P' }],
        [{ start: 1, end: 2, insert: '' }]
      ]
    })

    expect(result).toEqual({
      kind: 'transformed',
      rebasedTransactions: [
        [{ start: 2, end: 2, insert: 'P' }],
        [{ start: 2, end: 3, insert: '' }]
      ],
      reconciliationEdits: [{ start: 1, end: 4, insert: 'X' }]
    })
  })

  it('maps optimistic EOF after an earlier queued deletion', () => {
    const result = transformOptimisticHistory({
      baseSourceLength: 5,
      appliedEdits: [{ start: 0, end: 0, insert: 'H' }],
      queuedTransactions: [
        [{ start: 1, end: 2, insert: '' }],
        [{ start: 4, end: 4, insert: 'X' }]
      ]
    })

    expect(result).toEqual({
      kind: 'transformed',
      rebasedTransactions: [
        [{ start: 2, end: 3, insert: '' }],
        [{ start: 5, end: 5, insert: 'X' }]
      ],
      reconciliationEdits: [{ start: 0, end: 0, insert: 'H' }]
    })
  })

  it('maps an interior base range after an earlier queued deletion', () => {
    const result = transformOptimisticHistory({
      baseSourceLength: 5,
      appliedEdits: [{ start: 0, end: 0, insert: 'H' }],
      queuedTransactions: [
        [{ start: 1, end: 2, insert: '' }],
        [{ start: 2, end: 3, insert: 'X' }]
      ]
    })

    expect(result).toEqual({
      kind: 'transformed',
      rebasedTransactions: [
        [{ start: 2, end: 3, insert: '' }],
        [{ start: 3, end: 4, insert: 'X' }]
      ],
      reconciliationEdits: [{ start: 0, end: 0, insert: 'H' }]
    })
  })

  it('maps optimistic EOF when history deleted its left base anchor', () => {
    const result = transformOptimisticHistory({
      baseSourceLength: 4,
      appliedEdits: [
        { start: 1, end: 1, insert: '\uD83D\uDE00' },
        { start: 3, end: 4, insert: '' }
      ],
      queuedTransactions: [
        [{ start: 1, end: 2, insert: '' }],
        [{ start: 3, end: 3, insert: 'X' }]
      ]
    })

    expect(result).toEqual({
      kind: 'transformed',
      rebasedTransactions: [
        [{ start: 3, end: 4, insert: '' }],
        [{ start: 4, end: 4, insert: 'X' }]
      ],
      reconciliationEdits: [
        { start: 1, end: 1, insert: '\uD83D\uDE00' },
        { start: 2, end: 3, insert: '' }
      ]
    })
  })

  it('orders an actor insertion before later optimistic input at EOF', () => {
    const result = transformOptimisticHistory({
      baseSourceLength: 3,
      appliedEdits: [{ start: 3, end: 3, insert: 'H' }],
      queuedTransactions: [[{ start: 3, end: 3, insert: 'P' }]]
    })

    expect(result).toEqual({
      kind: 'transformed',
      rebasedTransactions: [[{ start: 4, end: 4, insert: 'P' }]],
      reconciliationEdits: [{ start: 3, end: 3, insert: 'H' }]
    })
  })

  it('preserves history inserted at the end boundary of a later deletion', () => {
    const result = transformOptimisticHistory({
      baseSourceLength: 3,
      appliedEdits: [{ start: 2, end: 2, insert: 'H' }],
      queuedTransactions: [[{ start: 1, end: 2, insert: '' }]]
    })

    expect(result).toEqual({
      kind: 'transformed',
      rebasedTransactions: [[{ start: 1, end: 2, insert: '' }]],
      reconciliationEdits: [{ start: 1, end: 1, insert: 'H' }]
    })
  })

  it('reconciles crossed pending insertion provenance in command order', () => {
    const result = transformSources(
      'ab',
      [
        { start: 0, end: 0, insert: 'JK' },
        { start: 1, end: 2, insert: 'JK' }
      ],
      [
        [{ start: 2, end: 2, insert: 'YZ' }],
        [{ start: 1, end: 1, insert: 'P' }]
      ]
    )

    expect(result).not.toHaveProperty('kind', 'conflict')
    if ('kind' in result) return
    expect(result.transformed.rebasedTransactions).toEqual([
      [{ start: 5, end: 5, insert: 'YZ' }],
      [{ start: 7, end: 7, insert: 'P' }]
    ])
    expect(result.authoritative).toBe('JKaJKYZP')
    expect(result.reconciled).toBe(result.authoritative)
  })

  it('rebases an edit within text inserted by a prior pending transaction', () => {
    const result = transformOptimisticHistory({
      baseSourceLength: 2,
      appliedEdits: [{ start: 1, end: 1, insert: 'H' }],
      queuedTransactions: [
        [{ start: 1, end: 1, insert: '\uD83D\uDE00' }],
        [{ start: 2, end: 3, insert: 'Z' }]
      ]
    })

    expect(result).toEqual({
      kind: 'transformed',
      rebasedTransactions: [
        [{ start: 2, end: 2, insert: '\uD83D\uDE00' }],
        [{ start: 3, end: 4, insert: 'Z' }]
      ],
      reconciliationEdits: [{ start: 1, end: 1, insert: 'H' }]
    })
  })

  it('returns a typed conflict for a pending boundary inside deleted base text', () => {
    const result = transformOptimisticHistory({
      baseSourceLength: 6,
      appliedEdits: [{ start: 1, end: 5, insert: '' }],
      queuedTransactions: [[{ start: 2, end: 4, insert: 'P' }]]
    })

    expect(result).toEqual({
      kind: 'conflict',
      reason: 'pending-boundary-deleted',
      transactionIndex: 0,
      editIndex: 0,
      boundary: 'start',
      position: 2
    })
    expect(structuredClone(result)).toEqual(result)
  })

  it('rebases disjoint history and pending edit sets in one source pass', () => {
    const result = transformOptimisticHistory({
      baseSourceLength: 10,
      appliedEdits: [
        { start: 1, end: 2, insert: 'HH' },
        { start: 7, end: 9, insert: '' }
      ],
      queuedTransactions: [[
        { start: 0, end: 1, insert: 'A' },
        { start: 5, end: 6, insert: 'B' },
        { start: 9, end: 9, insert: 'P' }
      ]]
    })

    expect(result).toEqual({
      kind: 'transformed',
      rebasedTransactions: [[
        { start: 0, end: 1, insert: 'A' },
        { start: 6, end: 7, insert: 'B' },
        { start: 8, end: 8, insert: 'P' }
      ]],
      reconciliationEdits: [
        { start: 1, end: 2, insert: 'HH' },
        { start: 7, end: 9, insert: '' }
      ]
    })
  })

  it('handles the actor interactive history limit without base-source materialization', () => {
    const appliedEdits = Array.from({ length: 256 }, (_, index) => ({
      start: index * 2,
      end: index * 2 + 1,
      insert: 'X'
    }))
    const result = transformOptimisticHistory({
      baseSourceLength: 512,
      appliedEdits,
      queuedTransactions: [[{ start: 512, end: 512, insert: '!' }]]
    })

    expect(result.kind).toBe('transformed')
    if (result.kind === 'conflict') return
    expect(result.rebasedTransactions).toEqual([
      [{ start: 512, end: 512, insert: '!' }]
    ])
    expect(result.reconciliationEdits).toHaveLength(256)
    expect(result.reconciliationEdits[0]).toEqual({
      start: 0,
      end: 1,
      insert: 'X'
    })
    expect(result.reconciliationEdits.at(-1)).toEqual({
      start: 510,
      end: 511,
      insert: 'X'
    })
  })

  it('preserves UTF-16 source units and reconciliation across worked cases', () => {
    const cases = [
      {
        base: 'a\uD83D\uDE00bcd',
        history: [{ start: 1, end: 3, insert: '\u65E5' }],
        queued: [
          [{ start: 1, end: 1, insert: 'P' }],
          [{ start: 2, end: 2, insert: 'Q' }]
        ]
      },
      {
        base: '0123456789',
        history: [
          { start: 1, end: 2, insert: 'HH' },
          { start: 7, end: 9, insert: '' }
        ],
        queued: [[
          { start: 0, end: 1, insert: 'A' },
          { start: 5, end: 6, insert: 'B' },
          { start: 9, end: 9, insert: 'P' }
        ]]
      }
    ] as const

    for (const row of cases) {
      const result = transformSources(row.base, row.history, row.queued)
      expect(result).not.toHaveProperty('kind', 'conflict')
      if ('kind' in result) continue
      expect(result.reconciled).toBe(result.authoritative)
    }
  })
})
