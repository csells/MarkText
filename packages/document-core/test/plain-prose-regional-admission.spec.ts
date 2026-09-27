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
  { label: 'reference definition', insert: '[label]: /url' },
  { label: 'front matter at BOF', insert: '---\ntitle: changed\n---' }
])('falls back when first-paragraph editing creates $label', ({ insert }) => {
  const core = createDocumentCore()
  const source = 'ordinary sentence.\n\nsecond paragraph.\n'
  const result = core.apply(core.open(source), [{ start: 0, end: 18, insert }], { projections: ['markup'] })
  expect(result.change.projections[0]?.scope).toBe('document')
  expect(result.revision.source).toBe(insert + source.slice(18))
})

// Plan 0012 G35: an edit that only restructures paragraphs, or adds a
// suggestion inside one, reparses just those paragraphs.
it.each([
  { label: 'inline structure in the first paragraph', source: 'ordinary sentence.\n\nsecond paragraph.\n', start: 0, end: 18, insert: '**changed**' },
  { label: 'an annotation in the first paragraph', source: 'ordinary sentence.\n\nsecond paragraph.\n', start: 0, end: 18, insert: '{++changed++}' },
  { label: 'a joined paragraph separator', source: 'first.\n\nlast.', start: 6, end: 8, insert: ' ' }
])('reparses only the paragraphs changed by $label', ({ source, start, end, insert }) => {
  const core = createDocumentCore()
  const opened = core.open(source)
  const before = inspectDocumentCore(core)
  const result = core.apply(opened, [{ start, end, insert }], { projections: ['markup'] })
  expect(inspectDocumentCore(core).documentParses - before.documentParses).toBe(0)
  expect(result.change.projections[0]?.scope).toBe('regions')
  const expectedSource = source.slice(0, start) + insert + source.slice(end)
  expect(result.revision.source).toBe(expectedSource)
  const reference = createDocumentCore()
  const expected = reference.open(expectedSource)
  expect(result.revision.annotations).toEqual(expected.annotations)
  expect(core.project(result.revision, 'markup').events).toEqual(reference.project(expected, 'markup').events)
  expect(core.project(result.revision, 'markup').syntax.ast).toEqual(reference.project(expected, 'markup').syntax.ast)
})
