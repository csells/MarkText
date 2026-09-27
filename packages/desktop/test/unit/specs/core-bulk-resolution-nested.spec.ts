import { describe, expect, it } from 'vitest'
import { createLocalCoreOwner } from '../../../src/renderer/src/documentAuthority/localCoreOwner'

// Profile 1 §10: Accept All yields the Revised column and Reject All the
// Original column, with nested annotations resolved recursively. Highlights
// and Comments are not suggestions; bulk resolution keeps them.
const cases = [
  { source: '{++foo{--bat--}bar++}\n', accepted: 'foobar\n', rejected: '\n' },
  { source: '{--a{++b++}c--}\n', accepted: '\n', rejected: 'ac\n' },
  { source: '{~~o{++x++}ld~>n{--y--}ew~~}\n', accepted: 'new\n', rejected: 'old\n' },
  { source: '{++a{++b{--c--}++}d++}\n', accepted: 'abd\n', rejected: '\n' },
  {
    source: '{++keep {==mark {--gone--}==}{>>note {++n++}<<} end++}\n',
    accepted: 'keep {==mark ==}{>>note {++n++}<<} end\n',
    rejected: '\n'
  },
  {
    source: 'x {==hi {++there {--old--}++}==} y\n',
    accepted: 'x {==hi there ==} y\n',
    rejected: 'x {==hi ==} y\n'
  }
] as const

const resolveAll = (source: string, decision: 'accept' | 'reject') => {
  const port = createLocalCoreOwner()
  try {
    const opened = port.request({ type: 'open', session: 1, sequence: 1, source })
    if (opened.type !== 'opened') throw new Error('open was rejected')
    const applied = port.request({
      type: 'resolve-all',
      session: 1,
      sequence: 2,
      baseRevision: opened.revision,
      decision,
      projections: []
    })
    if (applied.type !== 'applied') throw new Error(`resolve-all was ${applied.type}`)
    const saved = port.request({
      type: 'source-at-barrier',
      session: 1,
      sequence: 3,
      baseRevision: applied.revision
    })
    if (saved.type !== 'source') throw new Error('source barrier was rejected')
    return saved.source
  } finally {
    port.dispose()
  }
}

describe('bulk resolution of nested suggestions', () => {
  it.each(cases)('Accept All and Reject All resolve every suggestion in $source', ({ source, accepted, rejected }) => {
    expect(resolveAll(source, 'accept')).toBe(accepted)
    expect(resolveAll(source, 'reject')).toBe(rejected)
  })
})
