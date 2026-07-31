import { describe, expect, it } from 'vitest'
import {
  parseProfile1Document,
  replayShiftedCriticMarkupForest
} from '../../src/internal/profile1Document.js'
import { createProfile1SyntaxIdentityRegistry } from '../../src/internal/profile1/syntaxIdentity.js'

const BUDGET = {
  limitsProfile: 'desktop-v1',
  accountingSchema: 'syntax-accounting-1'
} as const

/**
 * The forest replayer must reproduce, into a fresh registry, exactly the
 * identity surface the pass emitted for the same forest: same ownership at
 * every marker and arm offset, same node kinds in the syntax graph. An
 * identity shift makes the two directly comparable; the splice then only
 * adds a coordinate delta.
 */
describe('shifted CriticMarkup forest replay', () => {
  const SOURCE = [
    'Plain {++added text++} here.',
    '',
    'A {~~worse~>better~~} swap and {--gone--} deletion.',
    '',
    'Nested {++outer {==inner==} tail++} forms.',
    '',
    'Anchored {==span==}{>>note<<} comment pair.',
    ''
  ].join('\n')

  it('reproduces ownership and node identity for a parsed forest', () => {
    const parsed = parseProfile1Document(SOURCE, BUDGET)
    if (parsed.kind === 'source-only') {
      throw new Error('Expected a complete parse')
    }
    const roots = Array.from(
      { length: parsed.criticMarkup.rootCount },
      (_, ordinal) => parsed.criticMarkup.rootAt(ordinal)
    )
    expect(roots.length).toBeGreaterThanOrEqual(5)

    const registry = createProfile1SyntaxIdentityRegistry(SOURCE.length)
    const replayed = replayShiftedCriticMarkupForest(
      registry,
      roots,
      (offset) => offset
    )
    const ownership = registry.finishOwnership(SOURCE)

    expect(replayed).toHaveLength(roots.length)
    for (const [ordinal, root] of roots.entries()) {
      const twin = replayed[ordinal]
      if (twin === undefined) throw new Error('Replay lost a root')
      expect(twin.kind).toBe(root.kind)
      expect(twin.range).toEqual(root.range)
      expect(twin.arms.length).toBe(root.arms.length)
      // Marker offsets resolve to critic-marker ownership naming the twin.
      const markerOffset = root.markers.open.start
      const owner = ownership.ownerAt(markerOffset).owner
      expect(owner.kind, `root ${String(ordinal)} marker owner`)
        .toBe('critic-marker')
      expect(Reflect.get(owner, 'nodeId')).toBe(twin.nodeId)
    }

    // The reference ownership from the real parse agrees at every marker.
    for (const [ordinal, root] of roots.entries()) {
      const reference = parsed.ownership.ownerAt(root.markers.open.start)
      const replayedOwner = ownership.ownerAt(root.markers.open.start)
      expect(replayedOwner.owner.kind, `root ${String(ordinal)}`)
        .toBe(reference.owner.kind)
      expect(replayedOwner.range).toEqual(reference.range)
    }
  })

  it('shifts every coordinate by the delta', () => {
    const parsed = parseProfile1Document(SOURCE, BUDGET)
    if (parsed.kind === 'source-only') {
      throw new Error('Expected a complete parse')
    }
    const roots = Array.from(
      { length: parsed.criticMarkup.rootCount },
      (_, ordinal) => parsed.criticMarkup.rootAt(ordinal)
    )
    const delta = 17
    const registry = createProfile1SyntaxIdentityRegistry(
      SOURCE.length + delta
    )
    const replayed = replayShiftedCriticMarkupForest(
      registry,
      roots,
      (offset) => offset + delta
    )
    for (const [ordinal, root] of roots.entries()) {
      const twin = replayed[ordinal]
      if (twin === undefined) throw new Error('Replay lost a root')
      expect(twin.range.start, `root ${String(ordinal)}`)
        .toBe(root.range.start + delta)
      expect(twin.range.end).toBe(root.range.end + delta)
      expect(twin.markers.open.start).toBe(root.markers.open.start + delta)
      for (const [armIndex, arm] of root.arms.entries()) {
        expect(twin.arms[armIndex]?.range.start).toBe(arm.range.start + delta)
      }
    }
  })
})
