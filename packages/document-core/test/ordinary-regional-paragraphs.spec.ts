import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

const suffix = Array.from({ length: 80 }, (_, index) =>
  `Block ${index}: {++added++} {--removed--} {~~old~>new~~} {==marked==}{>>note<<}.\n\n`
).join('')

describe('Ordinary paragraphs in the regional annotation inventory', () => {
  it('keeps repeated edits to separate ordinary paragraphs local and shifts retained annotation facts exactly', () => {
    let source = 'first target\n\nsecond target\n\n' + suffix
    const core = createDocumentCore()
    let revision = core.open(source)
    for (const target of ['first', 'second', 'first', 'second']) {
      const start = source.indexOf(target) + target.length
      const before = inspectDocumentCore(core)
      const result = core.apply(revision, [{ start, end: start, insert: ' more' }], { projections: ['markup'] })
      const after = inspectDocumentCore(core)
      expect(result.change.projections[0]?.scope).toBe('regions')
      expect(after.documentParses - before.documentParses).toBe(0)
      expect(after.sourceMaterializations - before.sourceMaterializations).toBe(0)
      expect(after.regionalInventoryChangedLeaves - before.regionalInventoryChangedLeaves).toBe(1)
      expect(after.regionalInventoryCandidateRegionParseSourceUnits - before.regionalInventoryCandidateRegionParseSourceUnits).toBeLessThan(40)
      source = source.slice(0, start) + ' more' + source.slice(start)
      revision = result.revision
    }
    const oracle = createDocumentCore()
    const expected = oracle.open(source)
    expect(revision.source).toBe(source)
    expect(revision.annotations).toEqual(expected.annotations)
    expect(revision.diagnostics).toEqual(expected.diagnostics)
    for (const name of ['original', 'revised', 'markup'] as const) {
      const actual = core.project(revision, name)
      const full = oracle.project(expected, name)
      if (actual.kind === 'markup' && full.kind === 'markup') {
        expect(actual.events).toEqual(full.events)
        expect(actual.syntax.ast).toEqual(full.syntax.ast)
        for (let position = 0; position <= source.length; position += 17) {
          for (const affinity of ['previous', 'next'] as const) {
            expect(actual.syntax.coordinates.toProjected(position, affinity)).toBe(full.syntax.coordinates.toProjected(position, affinity))
          }
        }
      } else if (actual.kind === 'markdown' && full.kind === 'markdown') {
        expect(actual).toMatchObject({ markdown: full.markdown, ast: full.ast })
      }
    }
  })

  it.each([
    { label: 'new annotation', insert: '{++new++}' },
    { label: 'new Markdown structure', insert: '\n\n# heading\n\n' },
    { label: 'reference dependency', insert: '[new][label]' }
  ])('uses a full parse when an ordinary edit introduces $label', ({ insert }) => {
    const source = 'ordinary target\n\n' + suffix
    const start = source.indexOf('target') + 2
    const core = createDocumentCore()
    const revision = core.open(source)
    const before = inspectDocumentCore(core)
    const result = core.apply(revision, [{ start, end: start, insert }], { projections: ['markup'] })
    const after = inspectDocumentCore(core)
    expect(result.change.projections[0]?.scope).toBe('document')
    expect(after.documentParses - before.documentParses).toBe(1)
    expect(after.regionalInventoryRootsCommitted - before.regionalInventoryRootsCommitted).toBe(0)
    const oracle = createDocumentCore()
    const expected = oracle.open(source.slice(0, start) + insert + source.slice(start))
    expect(result.revision.annotations).toEqual(expected.annotations)
    expect(core.project(result.revision, 'markup').syntax.ast).toEqual(oracle.project(expected, 'markup').syntax.ast)
  })

  it('does not admit an edit crossing the safe paragraph separator', () => {
    const source = 'first target\n\nsecond target\n\n' + suffix
    const start = source.indexOf('\n\n')
    const core = createDocumentCore()
    const result = core.apply(core.open(source), [{ start, end: start + 2, insert: ' ' }], { projections: ['markup'] })
    expect(result.change.projections[0]?.scope).toBe('document')
    expect(result.revision.source).toBe(source.slice(0, start) + ' ' + source.slice(start + 2))
  })
})
