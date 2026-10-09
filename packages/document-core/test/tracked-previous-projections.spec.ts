import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

// A blank line typed after a root `$$` re-pairs the math blocks below it, so
// the key's compile reads its candidates whole and compares their Original
// views with the previous revision's (B14). Each candidate read lets go of
// the previous revision's parse; the compile still parses that revision at
// most once, however many of its projections it reads afterwards.
const paragraph = 'Review {++new evidence++} alongside {--obsolete details--}, and {==a claim==}{>>Check this source.<<}.'

const regionalRevision = () => {
  const blocks = Array.from({ length: 120 }, () => paragraph)
  blocks[60] = 'x\n$$'
  blocks[81] = '$$\nz\n$$'
  const core = createDocumentCore()
  const opened = core.open(blocks.join('\n\n') + '\n')
  // Applied regionally, the revision holds no parse of its own.
  const { revision } = core.apply(opened, [{ start: 0, end: 0, insert: 'q' }], { projections: ['markup'] })
  const at = revision.source.indexOf('x\n$$') + 1
  return { core, revision, key: { start: at, end: at, insert: '\n\n' } }
}

const parsesOf = (core: ReturnType<typeof createDocumentCore>, compile: () => unknown) => {
  const before = inspectDocumentCore(core).documentParses
  compile()
  return inspectDocumentCore(core).documentParses - before
}

describe('a tracked key read against its candidates whole', () => {
  it('parses its previous revision at most once', () => {
    const cold = regionalRevision()
    const coldParses = parsesOf(cold.core, () => cold.core.trackedEdit(cold.revision, cold.key))

    // The same key once the previous revision's projections are all read.
    const warm = regionalRevision()
    for (const name of ['markup', 'original', 'revised'] as const) warm.core.project(warm.revision, name)
    const warmParses = parsesOf(warm.core, () => warm.core.trackedEdit(warm.revision, warm.key))

    expect(coldParses - warmParses).toBeLessThanOrEqual(1)
    expect(parsesOf(cold.core, () => {
      cold.core.project(cold.revision, 'original')
      cold.core.project(cold.revision, 'revised')
    })).toBe(0)
  })
})
