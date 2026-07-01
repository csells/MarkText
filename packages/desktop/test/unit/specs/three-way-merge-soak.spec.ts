import { describe, expect, it } from 'vitest'
import { mergeMarkdownThreeWay } from '../../../src/renderer/src/util/threeWayMerge'

// Soak test for the realistic collaboration workflow this feature targets: a
// human edits one region of a large Markdown document while a CLI agent edits a
// distant region on disk, repeatedly, over many cycles. Each cycle merges the
// two disjoint edits and the merged result becomes the next base — mimicking the
// dirty-external-merge loop advancing diskBaseMarkdown. We assert that no content
// is lost or corrupted as the document churns, and that disjoint edits never
// spuriously conflict.
const rng = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const buildDoc = (paragraphs: number): string[] => {
  const lines: string[] = []
  for (let p = 0; p < paragraphs; p += 1) {
    lines.push(`## Section ${p}\n`)
    lines.push('\n')
    lines.push(`Prose for section ${p} with some detail and a [link](http://x/${p}).\n`)
    lines.push('\n')
    lines.push(`- point ${p}.a\n`)
    lines.push(`- point ${p}.b\n`)
    lines.push('\n')
  }
  return lines
}

describe('mergeMarkdownThreeWay soak — large doc, repeated disjoint edits', () => {
  it('preserves both parties edits across 300 merge cycles without corruption', { timeout: 60000 }, () => {
    const next = rng(0xa5a5f00d)
    const SECTIONS = 120 // ~840 lines
    let baseLines = buildDoc(SECTIONS)

    // Human sentinel lives near the top, agent sentinel near the bottom; both are
    // rewritten every cycle and must always survive the merge.
    for (let cycle = 0; cycle < 300; cycle += 1) {
      const humanLine = Math.floor(next() * 5) * 7 + 2 // a prose line in an early section
      const agentSection = SECTIONS - 1 - Math.floor(next() * 5)
      const agentLine = agentSection * 7 + 2

      const base = baseLines.join('')

      const local = [...baseLines]
      local[humanLine] = `Human edit @cycle ${cycle}.\n`

      const remote = [...baseLines]
      remote[agentLine] = `Agent edit @cycle ${cycle}.\n`

      const { mergedMarkdown, conflicts } = mergeMarkdownThreeWay({
        base,
        local: local.join(''),
        remote: remote.join('')
      })

      // Disjoint edits in distant regions must never conflict...
      expect(conflicts, `unexpected conflict @cycle ${cycle}`).toEqual([])
      // ...and both edits must be present, with nothing else lost.
      expect(mergedMarkdown).toContain(`Human edit @cycle ${cycle}.`)
      expect(mergedMarkdown).toContain(`Agent edit @cycle ${cycle}.`)

      const mergedLines = mergedMarkdown.match(/[^\n]*\n|[^\n]+/g) ?? []
      // No line drift: a two-line-change merge keeps the exact line count.
      expect(mergedLines.length, `line drift @cycle ${cycle}`).toBe(baseLines.length)
      // Structural anchors survive untouched.
      expect(mergedMarkdown).toContain('## Section 0\n')
      expect(mergedMarkdown).toContain(`## Section ${SECTIONS - 1}\n`)

      baseLines = mergedLines
    }
  })
})
