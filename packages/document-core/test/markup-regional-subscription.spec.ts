import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

const denseSource = 'plain target\n\n' + Array.from({ length: 40 }, (_, index) =>
  `Paragraph ${index}: {++added++} {--removed--} {~~old~>new~~} {==highlight==} {>>note<<}.\n\n`
).join('')

describe('Markup-only regional subscriptions', () => {
  it('replaces a payload region when two top-level annotations share a paragraph', () => {
    const source = 'head\n\nbefore {++added text++} {--drop--} after\n\ntail\n\n'
    const core = createDocumentCore()
    const revision = core.open(source)
    const start = source.indexOf('text')
    const next = core.apply(revision, [{ start, end: start + 4, insert: 'TEXT' }], { projections: ['markup'] })
    expect(next.change.projections[0]?.scope).toBe('regions')
    const expectedSource = source.slice(0, start) + 'TEXT' + source.slice(start + 4)
    const freshCore = createDocumentCore()
    const fresh = freshCore.open(expectedSource)
    expect(next.revision.source).toBe(expectedSource)
    expect(core.project(next.revision, 'markup').events).toEqual(freshCore.project(fresh, 'markup').events)
    expect(core.project(next.revision, 'markup').syntax.ast).toEqual(freshCore.project(fresh, 'markup').syntax.ast)
  })
  for (const target of ['Paragraph', 'added']) {
    it(`reuses the dense document inventory for the first ${target} edit`, () => {
      const core = createDocumentCore()
      const opened = core.open(denseSource)
      const start = denseSource.indexOf(target) + 1
      const before = inspectDocumentCore(core)
      const result = core.apply(opened, [{ start, end: start, insert: 'X' }], { projections: ['markup'] })
      const after = inspectDocumentCore(core)
      expect(result.change.projections[0]?.scope).toBe('regions')
      expect(after.documentParses - before.documentParses).toBe(0)
      expect(after.sourceMaterializations - before.sourceMaterializations).toBe(0)
      const freshCore = createDocumentCore()
      const expectedSource = denseSource.slice(0, start) + 'X' + denseSource.slice(start)
      const expected = freshCore.open(expectedSource)
      expect(result.revision.source).toBe(expectedSource)
      expect(result.revision.annotations).toEqual(expected.annotations)
      expect(result.revision.diagnostics).toEqual(expected.diagnostics)
      const actualView = core.project(result.revision, 'markup')
      const expectedView = freshCore.project(expected, 'markup')
      expect(actualView.events).toEqual(expectedView.events)
      expect(actualView.syntax.ast).toEqual(expectedView.syntax.ast)
      for (const position of [0, start, start + 1, expectedSource.length]) {
        expect(actualView.syntax.coordinates.toProjected(position, 'next'))
          .toBe(expectedView.syntax.coordinates.toProjected(position, 'next'))
      }
    })
  }

  it('updates the first ordinary paragraph without reparsing the dense annotated document', () => {
    const core = createDocumentCore()
    const revision = core.open(denseSource)
    const start = denseSource.indexOf('target') + 1
    const before = inspectDocumentCore(core)
    const next = core.apply(revision, [{ start, end: start, insert: 'X' }], { projections: ['markup'] })
    const after = inspectDocumentCore(core)
    expect(next.change.projections[0]?.scope).toBe('regions')
    expect(after.documentParses - before.documentParses).toBe(0)
    expect(after.sourceMaterializations - before.sourceMaterializations).toBe(0)
    const expectedSource = denseSource.slice(0, start) + 'X' + denseSource.slice(start)
    const freshCore = createDocumentCore()
    const fresh = freshCore.open(expectedSource)
    expect(core.project(next.revision, 'markup').events).toEqual(freshCore.project(fresh, 'markup').events)
    expect(core.project(next.revision, 'markup').syntax.ast).toEqual(freshCore.project(fresh, 'markup').syntax.ast)
  })
})
