import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentRevision } from '../src/index.js'
import { denseSuggestionParagraph, lcg } from './support/inputDriver.js'

// Typing inside one's own suggestion extends it, as in Google Docs, even where
// the text typed beside a fence would read otherwise once the suggestion is
// accepted (Profile rule L2c, ADR-0014). These keys of the tracked sweep used
// to compile into Substitutions running to the end of the document.

const blocks = [
  denseSuggestionParagraph, 'Plain words here.', 'Text {==marked *text*==}{>>see **this** {++and that++}<<} end.',
  '{==outer {==inner==}{>>nested<<} text==}{>>outer comment<<}', '{=={--gone--}==}{>>only deleted<<} tail.',
  '- item {++one++}\n- item {--two--}', '> quoted {~~a~>b~~} line', '# Heading {++added++}', 'Line one {++x++}\nline two {--y--}.', '', '   ',
  '```js\n' + Array.from({ length: 8 }, (_, i) => `const value${i} = ${i}`).join('\n') + '\n```',
  '$$\n' + Array.from({ length: 5 }, (_, i) => `x_{${i}} + y`).join('\n') + '\n$$',
  '<div>\n' + Array.from({ length: 5 }, (_, i) => `html ${i}`).join('\n') + '\n</div>',
  Array.from({ length: 6 }, (_, i) => `    indented ${i}`).join('\n'),
  '{++```js\nconst added = 1\n```\n++}',
  '{~~```js\nconst value0 = 0\nconst value1 = 1\n```\n~>```js\nconst value0 = 0\nconst {--d--}value1 = 1\n```\n~~}'
]
const insertions = ['x', 'word', ' ', 'q', 'x', '\n', '\n\n', '{++n++}', '{--d--}', '{==h==}{>>c<<}']

describe('tracked keys beside a fence in a suggestion one is writing', () => {
  it.each([[29, 4], [8, 15], [20, 7], [21, 1], [21, 12], [13, 3]])('compiles seed %i key %i beside the key', (seed, target) => {
    const random = lcg(seed * 7727)
    const goal = 1000 + Math.floor(random() * 9000)
    const parts: string[] = []
    let length = 0
    while (length < goal) {
      const block = blocks[Math.floor(random() * blocks.length)]!
      parts.push(block)
      length += block.length + 2
    }
    const core = createDocumentCore()
    let revision: DocumentRevision = core.open(parts.join('\n\n') + '\n')
    for (let key = 0; key <= target; key += 1) {
      const text = revision.source
      const boundaries = [...text.matchAll(/(?<= )|(?=\r?\n)/gu)].map(match => match.index)
      const start = random() < 0.8 && boundaries.length > 0 ? boundaries[Math.floor(random() * boundaries.length)]! : Math.floor(random() * (text.length + 1))
      const reach = random() < 0.3 ? Math.min(text.length, start + 1 + Math.floor(random() * 4)) : start
      const end = /^[\p{L} ]*$/u.test(text.slice(start, reach)) ? reach : start
      const insert = end > start && random() < 0.5 ? '' : insertions[Math.floor(random() * insertions.length)]!
      let tracked
      try { tracked = core.trackedEdit(revision, { start, end, insert }) } catch { /* refused */ }
      if (key === target) {
        expect(tracked).toBeDefined()
        // The edit stays beside the key, in the suggestion it extends or the
        // block it is in.
        expect(Math.max(tracked!.end, start) - Math.min(tracked!.start, start)).toBeLessThan(200)
        const next = core.apply(revision, [tracked!]).revision
        expect(next.diagnostics.length).toBeLessThanOrEqual(revision.diagnostics.length)
        return
      }
      try { revision = core.apply(revision, [tracked ?? { start, end, insert }], { projections: ['markup'] }).revision } catch { /* refused */ }
    }
  }, 60_000)
})
