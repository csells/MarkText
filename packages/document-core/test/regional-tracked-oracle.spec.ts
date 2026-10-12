import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { inspectDocumentCore, planFromDocumentParse } from '../src/internal/documentCoreInspection.js'
import { regional } from './support/inputDriver.js'

// Plan 0012 G35: a tracked key validates each candidate it considers as
// apply() would read it. Where the regional inventory admits a candidate,
// the candidate is read from its blocks, unpublished, and compared with the
// others around the source they replace, so the key parses no document.

const paragraph = (ordinal: number): string =>
  `Review ${ordinal} {++new evidence++} alongside {--obsolete details--}, ` +
  '{~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.'
const source = Array.from({ length: 300 }, (_, ordinal) => paragraph(ordinal)).join('\n\n') + '\n'
const target = source.indexOf(paragraph(150))

const after = (text: string, offset = 0): number => source.indexOf(text, target) + 1 + offset

describe('tracked keys validated from the blocks they change', () => {
  it.each([
    { label: 'typing inside an Addition', start: after('evidence', 1), length: 0, insert: 'x' },
    { label: 'typing inside a Deletion', start: after('obsolete', 2), length: 0, insert: 'x' },
    { label: 'a space before a closer', start: after('--}'), length: 0, insert: ' ' },
    { label: 'a paragraph split', start: after('alongside'), length: 0, insert: '\n\n' },
    { label: 'typed marker spellings', start: after('alongside'), length: 0, insert: '{++n++}' },
    { label: 'typed Comment spellings', start: after('alongside'), length: 0, insert: '{==h==}{>>c<<}' },
    { label: 'a deleted word', start: after('alongside'), length: 9, insert: '' }
  ])('compiles $label with no document parse, as the document parse does', ({ start, length, insert }) => {
    const core = createDocumentCore()
    const revision = regional(core, source)
    const before = inspectDocumentCore(core).documentParses
    const actual = core.trackedEdit(revision, { start, end: start + length, insert })
    expect(inspectDocumentCore(core).documentParses - before).toBe(0)
    const control = createDocumentCore()
    planFromDocumentParse(control)
    expect(actual).toEqual(control.trackedEdit(regional(control, source), { start, end: start + length, insert }))
  }, 30_000)
})

describe('tracked keys in a literal block beside suggestions', () => {
  it.each([
    { label: 'fenced code', block: '```js\n' + Array.from({ length: 8 }, (_, line) => `const value${line} = ${line}`).join('\n') + '\n```' },
    { label: 'display math', block: '$$\n' + Array.from({ length: 5 }, (_, line) => `x_{${line}} + y`).join('\n') + '\n$$' }
  ])('suggests replacing a $label block with no document parse', ({ block }) => {
    // A block of the same kind before it pairs its own delimiters.
    const text = source.slice(0, target) + block + '\n\n' + paragraph(0) + '\n\n' + block + '\n\n' + source.slice(target)
    const start = text.lastIndexOf(block) + block.indexOf('\n', block.indexOf('\n') + 1) + 3
    for (const insert of ['x', ' ', '\n', '{--d--}']) {
      const core = createDocumentCore()
      const revision = regional(core, text)
      const before = inspectDocumentCore(core).documentParses
      const actual = core.trackedEdit(revision, { start, end: start, insert })
      expect(inspectDocumentCore(core).documentParses - before).toBe(0)
      const control = createDocumentCore()
      planFromDocumentParse(control)
      expect(actual).toEqual(control.trackedEdit(regional(control, text), { start, end: start, insert }))
    }
  }, 60_000)
})
