import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
// Includes repeated code-fence and thematic-break lines so the git-oracle
// cross-check exercises the fence-corruption topology (a repeated line spliced
// into a code block) the position-blind reconciliation used to produce.
const LINES = ['a\n', 'a\n', 'b\n', '\n', 'c\n', '- item\n', '- item\n', 'x\n', '```\n', '```\n', '---\n']

const randomDoc = (next: () => number, maxLen: number): string => {
  const len = Math.floor(next() * maxLen)
  let out = ''
  for (let i = 0; i < len; i += 1) out += LINES[Math.floor(next() * LINES.length)]
  return out
}

// Derive an edited variant of base by randomly deleting / duplicating / mutating
// whole lines — the kind of edit an agent or a human makes.
const editDoc = (next: () => number, base: string): string => {
  const lines = base.length ? base.match(/[^\n]*\n|[^\n]+/g) ?? [] : []
  const out: string[] = []
  for (const line of lines) {
    const r = next()
    if (r < 0.15) continue // delete
    else if (r < 0.3) {
      out.push(line)
      out.push(line)
    } else if (r < 0.45) out.push(LINES[Math.floor(next() * LINES.length)]) // replace
    else out.push(line) // keep
  }
  if (next() < 0.3) out.push(LINES[Math.floor(next() * LINES.length)]) // append
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

      if (result.conflicts.length === 0) {
        // No fabrication: every merged line came from one of the three inputs.
        const known = new Set([...splitLines(base), ...splitLines(local), ...splitLines(remote)])
        for (const line of splitLines(result.mergedMarkdown)) {
          expect(known.has(line), `fabricated line ${JSON.stringify(line)} @${iter}`).toBe(true)
        }
      } else {
        // A conflict must carry both sides so nothing is silently discarded.
        for (const c of result.conflicts) {
          expect(result.mergedMarkdown).toContain(c.markerText)
        }
      }

      // Agreement: if both sides made the identical edit, it is not a conflict.
      const agree = mergeMarkdownThreeWay({ base, local, remote: local })
      expect(agree.conflicts, `agreement @${iter}`).toEqual([])
      expect(agree.mergedMarkdown, `agreement @${iter}`).toBe(local)
    }
  })
})

// Gold-standard cross-check against git's diff3 merge (the oracle the adversarial
// review used). Skipped gracefully where git is unavailable.
const gitAvailable = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe('mergeMarkdownThreeWay fuzz — git merge-file oracle', () => {
  it.skipIf(!gitAvailable)('never silently diverges from git clean merged bytes', () => {
    const next = rng(0x0feed99)
    const dir = mkdtempSync(join(tmpdir(), 'twm-fuzz-'))
    let compared = 0
    try {
      for (let iter = 0; iter < 400; iter += 1) {
        const base = randomDoc(next, 10)
        const local = editDoc(next, base)
        const remote = editDoc(next, base)
        if (local === remote || local === base || remote === base) continue

        const lp = join(dir, 'l')
        const bp = join(dir, 'b')
        const rp = join(dir, 'r')
        writeFileSync(lp, local)
        writeFileSync(bp, base)
        writeFileSync(rp, remote)

        let gitOut = ''
        let gitClean = false
        try {
          gitOut = execFileSync('git', ['merge-file', '-p', '--diff3', lp, bp, rp], {
            encoding: 'utf8'
          })
          gitClean = true
        } catch {
          // Non-zero exit = conflicts (or error); status is the conflict count.
          gitClean = false
        }

        const mine = mergeMarkdownThreeWay({ base, local, remote })

        if (gitClean) {
          compared += 1
          if (mine.conflicts.length === 0) {
            expect(mine.mergedMarkdown, `clean bytes differ @${iter}`).toBe(gitOut)
          } else {
            for (const conflict of mine.conflicts) {
              expect(mine.mergedMarkdown, `missing conflict marker @${iter}`).toContain(
                conflict.markerText
              )
              expect(conflict.localText.length + conflict.remoteText.length, `empty conflict @${iter}`)
                .toBeGreaterThan(0)
            }
          }
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect(compared).toBeGreaterThan(0)
  }, 30_000)
})
