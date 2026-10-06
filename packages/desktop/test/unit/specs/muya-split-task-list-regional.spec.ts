import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { applyMuyaMarkupChanges } from '@/documentAuthority/muyaMarkupChanges'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'

// A list mixing tasks and plain items renders a list per run, so one Core
// list holds several roots of the view. A view patched with a regional reply
// must still read exactly as the view of the whole new revision when edits
// split, join, extend or shorten those runs, or turn items into tasks.

const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

const blocks = [
  'Plain words here.',
  '- [ ] task a\n- plain b\n- [x] task c',
  '1. [x] one\n2. two\n3. [ ] three',
  '- [ ] task a\n- [x] task b\n- [ ] task c',
  '1. first step\n2. second step',
  '- alpha one\n- beta two',
  '- outer\n  - [x] inner a\n  - inner b\n- outer two',
  '5) [x] five\n6) six\n7) seven',
  '- [ ] loose a\n\n- loose b\n\n- [x] loose c'
]
const insertions = ['x', ' ', '\n', '\n\n', '[ ] ', '[x] ', '- ', '- [ ] ', '1. ', '2. [x] ']

const seeds = Number(process.env.MARKTEXT_SPLIT_LIST_FUZZ_SEEDS ?? 40)

describe('Patched Markup views of lists split into runs read as the whole view', () => {
  let patches = 0
  it.each(Array.from({ length: seeds }, (_, index) => index + 1))('seed %i', (seed) => {
    const random = lcg(seed * 4013)
    for (let documentIndex = 0; documentIndex < 5; documentIndex += 1) {
      const count = 2 + Math.floor(random() * 5)
      const source =
        Array.from({ length: count }, () => blocks[Math.floor(random() * blocks.length)]).join('\n\n') +
        (random() < 0.8 ? '\n' : '')
      const core = createDocumentCore()
      let revision = core.open(source)
      let view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations, revision.source)
      for (let edit = 0; edit < 8; edit += 1) {
        const text = revision.source
        // Favour item starts and ends, where tasks and breaks are typed.
        const anchors = [...text.matchAll(/(?<=^ *(?:[-*+]|\d{1,9}[.)]) )|(?=\r?\n)/gmu)].map((match) => match.index)
        const start =
          random() < 0.7 && anchors.length > 0
            ? anchors[Math.floor(random() * anchors.length)]
            : Math.floor(random() * (text.length + 1))
        const end = random() < 0.2 ? Math.min(text.length, start + 1 + Math.floor(random() * 4)) : start
        const insert = end > start && random() < 0.5 ? '' : insertions[Math.floor(random() * insertions.length)]
        const label = `${JSON.stringify(text)} [${start}, ${end}) ${JSON.stringify(insert)}`
        const commit = core.apply(revision, [{ start, end, insert }], { projections: ['markup'] })
        const expected = createMuyaMarkupView(
          core.project(commit.revision, 'markup'),
          commit.revision.annotations,
          commit.revision.source
        )
        const change = commit.change.projections[0]
        const patched =
          change?.name === 'markup' && change.scope === 'regions'
            ? applyMuyaMarkupChanges(view, structuredClone(change))
            : undefined
        if (patched !== undefined) {
          expect(patched, label).toEqual(expected)
          patches += 1
        }
        view = patched ?? expected
        revision = commit.revision
      }
    }
  })

  it('patched views regionally', () => {
    expect(patches).toBeGreaterThan(0)
  })
})
