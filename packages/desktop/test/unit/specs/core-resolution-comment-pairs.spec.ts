import { describe, expect, it } from 'vitest'
import { createLocalCoreOwner } from '../../../src/renderer/src/documentAuthority/localCoreOwner'

// Profile 1 V6 (plan 0012 G39): resolution keeps the Highlight/Comment
// relation meaningful for single and bulk resolution, and one Undo restores it.
type Request =
  | { readonly kind: 'one'; readonly annotation: { kind: 'addition' | 'deletion'; range: { start: number; end: number } }; readonly decision: 'accept' | 'reject' }
  | { readonly kind: 'all'; readonly decision: 'accept' | 'reject' }

const resolve = (source: string, request: Request) => {
  const port = createLocalCoreOwner()
  try {
    const opened = port.request({ type: 'open', session: 1, sequence: 1, source })
    if (opened.type !== 'opened') throw new Error('open was rejected')
    const applied = port.request(
      request.kind === 'one'
        ? { type: 'resolve', session: 1, sequence: 2, baseRevision: opened.revision, annotation: request.annotation, decision: request.decision, projections: [] }
        : { type: 'resolve-all', session: 1, sequence: 2, baseRevision: opened.revision, decision: request.decision, projections: [] }
    )
    if (applied.type !== 'applied') throw new Error(`resolution was ${applied.type}`)
    const saved = port.request({ type: 'source-at-barrier', session: 1, sequence: 3, baseRevision: applied.revision })
    if (saved.type !== 'source') throw new Error('source barrier was rejected')
    const undone = port.request({ type: 'undo', session: 1, sequence: 4, baseRevision: applied.revision, projections: [] })
    if (undone.type !== 'applied') throw new Error(`undo was ${undone.type}`)
    const restored = port.request({ type: 'source-at-barrier', session: 1, sequence: 5, baseRevision: undone.revision })
    if (restored.type !== 'source') throw new Error('source barrier was rejected')
    return { resolved: saved.source, restored: restored.source }
  } finally {
    port.dispose()
  }
}

describe('resolution around commented spans', () => {
  it.each([
    { source: 'x {=={++new++}==}{>>n<<} y\n', request: { kind: 'one', annotation: { kind: 'addition', range: { start: 5, end: 14 } }, decision: 'reject' } as const, expected: 'x {>>n<<} y\n' },
    { source: 'x {=={--old--}==}{>>n<<} y\n', request: { kind: 'all', decision: 'accept' } as const, expected: 'x {>>n<<} y\n' },
    { source: '{==a==}{++x++}{>>n<<} y\n', request: { kind: 'one', annotation: { kind: 'addition', range: { start: 7, end: 14 } }, decision: 'reject' } as const, expected: '{==a{>>n<<}==} y\n' },
    { source: '{==a==}{--x--}{>>n<<} y\n', request: { kind: 'all', decision: 'accept' } as const, expected: '{==a{>>n<<}==} y\n' },
    { source: '{==a==}{++x++}{>>n<<} y\n', request: { kind: 'all', decision: 'accept' } as const, expected: '{==a==}x{>>n<<} y\n' }
  ])('$request.kind $request.decision in $source', ({ source, request, expected }) => {
    expect(resolve(source, request)).toEqual({ resolved: expected, restored: source })
  })
})
