import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

it.each(['', '\n'])('keeps repeated first/middle/last punctuated Unicode prose edits regional with EOF %j', ending => {
  const paragraphs = Array.from({ length: 100 }, (_, index) => `Paragraph ${index}: “Café, 中文 — ordinary prose.”`)
  let source = paragraphs.join('\n\n') + ending
  const core = createDocumentCore()
  let revision = core.open(source)
  for (const index of [0, 50, 99, 0, 50, 99]) {
    const paragraph = paragraphs[index]!
    const start = source.indexOf(paragraph) + paragraph.length
    const before = inspectDocumentCore(core)
    const result = core.apply(revision, [{ start, end: start, insert: '!' }], { projections: ['markup'] })
    const after = inspectDocumentCore(core)
    expect(result.change.projections[0]?.scope).toBe('regions')
    expect(after.documentParses - before.documentParses).toBe(0)
    expect(after.sourceMaterializations - before.sourceMaterializations).toBe(0)
    expect(after.retainedInitialBuildUnits - before.retainedInitialBuildUnits).toBe(0)
    paragraphs[index] += '!'
    source = source.slice(0, start) + '!' + source.slice(start)
    revision = result.revision
  }
  const reference = createDocumentCore()
  const expected = reference.open(source)
  expect(revision.source).toBe(source)
  expect(core.project(revision, 'markup').syntax.ast).toEqual(reference.project(expected, 'markup').syntax.ast)
  expect(core.project(revision, 'original').markdown).toBe(source)
  expect(core.project(revision, 'revised').markdown).toBe(source)
})

it('updates a sole punctuated paragraph without constructing an EOF overlay', () => {
  const core = createDocumentCore()
  let source = 'Ordinary prose.'
  let revision = core.open(source)
  for (const insert of ['!', 'é', '🙂']) {
    const result = core.apply(revision, [{ start: source.length, end: source.length, insert }], { projections: ['markup'] })
    expect(result.change.projections[0]?.scope).toBe('regions')
    source += insert
    revision = result.revision
  }
  expect(revision.source).toBe(source)
  expect(inspectDocumentCore(core).retainedOverlayNodesAllocated).toBe(0)
})

it.each([
  { label: 'heading', insert: '# changed' },
  { label: 'inline structure', insert: '**changed**' },
  { label: 'annotation', insert: '{++changed++}' },
  { label: 'reference definition', insert: '[label]: /url' },
  { label: 'front matter at BOF', insert: '---\ntitle: changed\n---' }
])('falls back when first-paragraph editing creates $label', ({ insert }) => {
  const core = createDocumentCore()
  const source = 'ordinary sentence.\n\nsecond paragraph.\n'
  const result = core.apply(core.open(source), [{ start: 0, end: 18, insert }], { projections: ['markup'] })
  expect(result.change.projections[0]?.scope).toBe('document')
  expect(result.revision.source).toBe(insert + source.slice(18))
})

it('falls back when editing a paragraph separator', () => {
  const core = createDocumentCore()
  const source = 'first.\n\nlast.'
  const result = core.apply(core.open(source), [{ start: 6, end: 8, insert: ' ' }], { projections: ['markup'] })
  expect(result.change.projections[0]?.scope).toBe('document')
  expect(result.revision.source).toBe('first. last.')
})
