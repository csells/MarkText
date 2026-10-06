import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentRevision } from '../src/index.js'
import { inspectDocumentCore, planFromDocumentParse } from '../src/internal/documentCoreInspection.js'

// A tracked key in a literal block is compiled on a window holding that block
// and the four blocks after it that a literal can absorb. When a closed math block
// follows those blocks, the window ends at them, and its last block must be
// seen to end there. A fenced code or math block that its own closer ends
// holds that closer's line ending, as an HTML block does; reading it as left
// open sent the key to a whole-document parse (2,000-block sweep key 2/15).

const filler = Array.from({ length: 40 }, (_, index) => `Plain paragraph ${index} with {++an addition++} in it.`).join('\n\n')

/** A math block long enough that the inventory records it as a literal run. */
const math = `$$\n${Array.from({ length: 5 }, (_, index) => `x_{${index}} + y`).join('\n')}\n$$`

const literals = [
  '<div>\nhtml 0\nhtml 1\n</div>',
  '```js\nconst a = 0\nconst b = 1\n```',
  '~~~~\ntilde 0\ntilde 1\n~~~~',
  '$$\nx_{0} + y\nx_{1} + y\n$$'
]

const lastRuns = ['```js\nconst c = 2\n```', '~~~\nc\n~~~', '$$\nz\n$$', '<div>\nh\n</div>', 'Plain words.', '```\nnot closed\n``']

/** A revision reached by a regional edit, so it holds no document parse. */
function regional(core: DocumentCore, source: string): DocumentRevision {
  const opened = core.open(source)
  return core.apply(opened, [{ start: 0, end: 0, insert: 'q' }], { projections: ['markup'] }).revision
}

describe('a literal block window ending before a closed math block', () => {
  for (const literal of literals) {
    for (const last of lastRuns) {
      it(`reads ${JSON.stringify(literal.slice(0, 6))} before ${JSON.stringify(last)} as the document does`, () => {
        const source = `${filler}\n\n${literal}\n\n# Heading\n\nWords.\n\nMore words.\n\n${last}\n\n${math}\n\n${filler}\n`
        const caret = source.indexOf(literal) + literal.indexOf('\n', literal.indexOf('\n') + 1)
        for (const insert of ['x', '{==h==}{>>c<<}']) {
          const core = createDocumentCore()
          const revision = regional(core, source)
          const before = inspectDocumentCore(core).documentParses
          const planned = core.trackedEdit(revision, { start: caret + 1, end: caret + 1, insert })
          const parses = inspectDocumentCore(core).documentParses - before
          const control = createDocumentCore()
          planFromDocumentParse(control)
          const expected = control.trackedEdit(regional(control, source), { start: caret + 1, end: caret + 1, insert })
          expect(planned).toEqual(expected)
          if (/^(?:```|~~~|\$\$)[\s\S]*\n(?:```|~~~|\$\$)$/u.test(last)) expect(parses).toBe(0)
        }
      })
    }
  }
})
