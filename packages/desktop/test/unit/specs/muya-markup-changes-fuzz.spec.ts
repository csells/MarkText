import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { applyMuyaMarkupChanges } from '@/documentAuthority/muyaMarkupChanges'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'

// Plan 0012 G35: a view patched with a regional reply reads exactly as the
// view of the whole new revision, whatever the edit: blank-line runs and
// whitespace-only lines included, where Enter at a paragraph's end lands.

const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

const blocks = [
  'Plain words here.',
  'Another ordinary sentence with more words.',
  'Text with {++added++} inside.',
  'Text {--deleted--} and {~~old~>new~~} too.',
  'Note {==marked==}{>>comment<<} end.',
  '{++Whole paragraph addition.++}',
  'Line one\nline two of one paragraph.',
  '# Heading',
  '- item one\n- item two',
  '> quoted line',
  '   ',
  '',
  '\t'
]
const insertions = ['x', ' ', '\n', '\n\n', '\n\n\n\n', '   ', '{++n++}', '# ', '- ']

const seeds = Number(process.env.MARKTEXT_VIEW_FUZZ_SEEDS ?? 40)
const first = Number(process.env.MARKTEXT_VIEW_FUZZ_FIRST ?? 1)

describe('Patched Markup views read as the whole view', () => {
  it.each(Array.from({ length: seeds }, (_, index) => first + index))('seed %i', (seed) => {
    const random = lcg(seed * 7919)
    for (let documentIndex = 0; documentIndex < 6; documentIndex += 1) {
      const count = 3 + Math.floor(random() * 8)
      const source =
        Array.from({ length: count }, () => blocks[Math.floor(random() * blocks.length)]).join(
          '\n\n'
        ) + (random() < 0.8 ? '\n' : '')
      const core = createDocumentCore()
      let revision = core.open(source)
      let view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
      for (let edit = 0; edit < 6; edit += 1) {
        const text = revision.source
        // Favour paragraph ends and blank lines, where Enter lands.
        const ends = [...text.matchAll(/(?=\r?\n)/gu)].map((match) => match.index)
        const start =
          random() < 0.6 && ends.length > 0
            ? ends[Math.floor(random() * ends.length)]
            : Math.floor(random() * (text.length + 1))
        const end = random() < 0.2 ? Math.min(text.length, start + 1 + Math.floor(random() * 3)) : start
        const insert = end > start && random() < 0.5 ? '' : insertions[Math.floor(random() * insertions.length)]
        const label = `${JSON.stringify(text)} [${start}, ${end}) ${JSON.stringify(insert)}`
        const commit = core.apply(revision, [{ start, end, insert }], { projections: ['markup'] })
        const expected = createMuyaMarkupView(
          core.project(commit.revision, 'markup'),
          commit.revision.annotations
        )
        const change = commit.change.projections[0]
        const patched =
          change?.name === 'markup' && change.scope === 'regions'
            ? applyMuyaMarkupChanges(view, structuredClone(change))
            : undefined
        if (patched !== undefined) expect(patched, label).toEqual(expected)
        view = patched ?? expected
        revision = commit.revision
      }
    }
  })
})
