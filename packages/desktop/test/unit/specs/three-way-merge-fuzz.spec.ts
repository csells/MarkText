import { describe, expect, it } from 'vitest'
import { mergeMarkdownThreeWay } from '../../../src/renderer/src/util/threeWayMerge'

// Deterministic PRNG (mulberry32) so any failure is reproducible from the seed.
const rng = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Small alphabet with deliberate repeats and blank lines — the exact conditions
// that triggered the false-clean data-loss bug (Finding 1).
// Includes repeated code-fence and thematic-break lines so the count-bounds
// fuzz exercises the fence-corruption topology (a repeated line spliced into
// a code block) the position-blind reconciliation used to produce. There is
// no git oracle: correctness is the engine-independent properties below.
// The MC marker/metadata lines, CRLF/CR endings, and non-ASCII text are the
// payloads this merge exists for — agent edits to comment-bearing documents.
const MC_DEF = '[MC:a]: data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119\n'
const PRESERVE_LINES = [
  'a\n', 'a\n', 'b\n', '\n', 'c\n', '- item\n', '- item\n', 'x\n', '```\n', '```\n', '---\n',
  '<!--MC:a-->reviewed<!--MC:~a--> text\n',
  'open <!--MC:b-->starts here\n',
  'and ends<!--MC:~b--> there\n',
  MC_DEF,
  MC_DEF,
  '[MC:c]: not-a-data-uri\n',
  'crlf line\r\n',
  '汉字 と かな ✓\n',
  'astral \u{1F600}\u{1F680} pair\n'
]
// The structural-invariants corpus additionally mixes bare-CR line endings,
// which the engine's line splitter treats as their own lines; the count-bounds
// fuzz below sticks to PRESERVE_LINES because its \n-based test-side splitter
// must agree with the engine about what a "line" is.
const LINES = [...PRESERVE_LINES, 'bare-cr\r', '\r']

const randomDoc = (next: () => number, maxLen: number, corpus: string[] = LINES): string => {
  const len = Math.floor(next() * maxLen)
  let out = ''
  for (let i = 0; i < len; i += 1) out += corpus[Math.floor(next() * corpus.length)]
  return out
}

// Derive an edited variant of base by randomly deleting / duplicating / mutating
// whole lines — the kind of edit an agent or a human makes.
const editDoc = (next: () => number, base: string, corpus: string[] = LINES): string => {
  const lines = base.length ? base.match(/[^\n]*\n|[^\n]+/g) ?? [] : []
  const out: string[] = []
  for (const line of lines) {
    const r = next()
    if (r < 0.15) continue // delete
    else if (r < 0.3) {
      out.push(line)
      out.push(line)
    } else if (r < 0.45) out.push(corpus[Math.floor(next() * corpus.length)]) // replace
    else out.push(line) // keep
  }
  if (next() < 0.3) out.push(corpus[Math.floor(next() * corpus.length)]) // append
  return out.join('')
}

const splitLines = (text: string): string[] => (text.length ? text.match(/[^\n]*\n|[^\n]+/g) ?? [] : [])

describe('mergeMarkdownThreeWay fuzz — invariants', () => {
  it('holds structural invariants across 8000 random triples', () => {
    const next = rng(0x1234abcd)
    for (let iter = 0; iter < 8000; iter += 1) {
      const base = randomDoc(next, 12)
      const local = editDoc(next, base)
      const remote = editDoc(next, base)

      const result = mergeMarkdownThreeWay({ base, local, remote })

      // Determinism: same inputs → same output.
      const again = mergeMarkdownThreeWay({ base, local, remote })
      expect(again.mergedMarkdown, `determinism @${iter}`).toBe(result.mergedMarkdown)

      // A conflict must carry both sides so nothing is silently discarded.
      // (No-fabrication is asserted rigorously by the count-bounds fuzz below;
      // a set-membership check could never fail for a line-based diff3.)
      for (const c of result.conflicts) {
        expect(result.mergedMarkdown).toContain(c.markerText)
      }
    }
  })

  it('identical edits on both sides never conflict (agreement contract)', () => {
    const next = rng(0x51deca11)
    for (let iter = 0; iter < 200; iter += 1) {
      const base = randomDoc(next, 12)
      const local = editDoc(next, base)

      const agree = mergeMarkdownThreeWay({ base, local, remote: local })
      expect(agree.conflicts, `agreement @${iter}`).toEqual([])
      expect(agree.mergedMarkdown, `agreement @${iter}`).toBe(local)
    }
  })
})

// The merge contract is DATA PRESERVATION, not byte-parity with git (git's
// diff3 is one valid algorithm among several; matching it is not a correctness
// requirement). node-diff3 does the merge; our safety net escalates to a
// conflict if its clean output ever loses or fabricates a line. This fuzz
// asserts that invariant directly over a large random corpus, no git needed:
// for every clean auto-merge, each line's copy count is within
// [min(local, remote), local + remote].
describe('mergeMarkdownThreeWay fuzz — data preservation (no loss / no fabrication)', () => {
  const countLineIn = (text: string, line: string): number =>
    splitLines(text).filter((l) => l === line).length

  it('a clean auto-merge never drops a line both sides kept nor fabricates content', () => {
    const next = rng(0x0feed99)
    let checked = 0
    let mcChecked = 0
    for (let iter = 0; iter < 5000; iter += 1) {
      const base = randomDoc(next, 12, PRESERVE_LINES)
      const local = editDoc(next, base, PRESERVE_LINES)
      const remote = editDoc(next, base, PRESERVE_LINES)
      if (local === remote || local === base || remote === base) continue

      const mine = mergeMarkdownThreeWay({ base, local, remote })
      if (mine.conflicts.length !== 0) continue
      checked += 1

      const lines = new Set([...splitLines(local), ...splitLines(remote)])
      for (const line of lines) {
        const inLocal = countLineIn(local, line)
        const inRemote = countLineIn(remote, line)
        const inBase = countLineIn(base, line)
        const lo = Math.min(inLocal, inRemote)
        // Upper bound: hunk arithmetic gives local + remote - base copies;
        // agreeing hunks can dedup down toward max(local, remote), never up
        // past the arithmetic — so a merge duplicating a line both sides
        // hold once (arithmetic 1) is fabrication even though the old
        // local+remote bound (2) would have allowed it.
        const hi = Math.max(Math.max(inLocal, inRemote), inLocal + inRemote - inBase)
        const merged = countLineIn(mine.mergedMarkdown, line)
        expect(merged, `data loss @${iter} line=${JSON.stringify(line)}`).toBeGreaterThanOrEqual(lo)
        expect(merged, `fabrication @${iter} line=${JSON.stringify(line)}`).toBeLessThanOrEqual(hi)
        if (line.includes('MC:')) mcChecked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
    // The corpus must actually exercise comment payloads, not just prose.
    expect(mcChecked).toBeGreaterThan(0)
  }, 30_000)
})

// Property 3 (external-merge.md §Merge engine): order preservation — a clean
// auto-merge never scrambles content. When one side deliberately reorders
// lines the output cannot agree with BOTH sides at once, so the sound
// formulation is: for lines whose relative order base, local, and remote all
// agree on, the output keeps that order. Restricted to lines appearing
// exactly once everywhere (repeated lines have no well-defined position).
describe('mergeMarkdownThreeWay fuzz — order preservation', () => {
  // First-occurrence position + count per line: repeated lines participate
  // in the order check through their first occurrence (restricted to lines
  // whose COUNT is equal in all four texts), so relocating a copy of a
  // repeated line — blank lines, list bullets, fences — is caught too.
  const lineProfile = (text: string): Map<string, { first: number; count: number }> => {
    const profile = new Map<string, { first: number; count: number }>()
    splitLines(text).forEach((line, index) => {
      const entry = profile.get(line)
      if (entry) entry.count += 1
      else profile.set(line, { first: index, count: 1 })
    })
    return profile
  }

  it('lines whose order all three inputs agree on keep that order in a clean merge', () => {
    const next = rng(0x0d3e40e5)
    let checked = 0
    let pairsChecked = 0
    for (let iter = 0; iter < 5000; iter += 1) {
      const base = randomDoc(next, 12, PRESERVE_LINES)
      const local = editDoc(next, base, PRESERVE_LINES)
      const remote = editDoc(next, base, PRESERVE_LINES)
      if (local === remote || local === base || remote === base) continue

      const mine = mergeMarkdownThreeWay({ base, local, remote })
      if (mine.conflicts.length !== 0) continue
      checked += 1

      const inBase = lineProfile(base)
      const inLocal = lineProfile(local)
      const inRemote = lineProfile(remote)
      const inMerged = lineProfile(mine.mergedMarkdown)
      // Lines whose count agrees in all four texts participate via their
      // first occurrence; unique lines are the count===1 special case.
      const everywhere = [...inBase.keys()].filter((line) => {
        const b = inBase.get(line)!
        const l = inLocal.get(line)
        const r = inRemote.get(line)
        const m = inMerged.get(line)
        return !!l && !!r && !!m &&
          l.count === b.count && r.count === b.count && m.count === b.count
      })
      for (let i = 0; i < everywhere.length; i += 1) {
        for (let j = i + 1; j < everywhere.length; j += 1) {
          const a = everywhere[i]
          const b = everywhere[j]
          const baseSays = inBase.get(a)!.first < inBase.get(b)!.first
          if (inLocal.get(a)!.first < inLocal.get(b)!.first !== baseSays) continue
          if (inRemote.get(a)!.first < inRemote.get(b)!.first !== baseSays) continue
          pairsChecked += 1
          expect(
            inMerged.get(a)!.first < inMerged.get(b)!.first,
            `order flip @${iter}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
          ).toBe(baseSays)
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
    expect(pairsChecked).toBeGreaterThan(0)
  }, 30_000)
})
