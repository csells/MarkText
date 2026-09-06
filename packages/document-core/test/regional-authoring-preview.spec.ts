import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

const denseSource = 'ordinary target\n\n' + Array.from({ length: 80 }, (_, index) =>
  `Block ${index}: {++added++} {--deleted--} {~~old~>new~~} {==marked==}{>>note<<}.\n\n`
).join('')

describe('Unpublished regional authoring validation', () => {
  for (const method of ['markupEdit', 'trackedEdit'] as const) {
    it(`${method} validates repeated added-text edits without full products or publication`, () => {
      const core = createDocumentCore()
      let revision = core.open(denseSource)
      let source = denseSource
      for (let turn = 0; turn < 2; turn += 1) {
        const start = source.indexOf('{++') + 5 + turn
        const requested = { start, end: start, insert: 'X' }
        const before = inspectDocumentCore(core)
        const planned = core[method](revision, requested)
        const after = inspectDocumentCore(core)
        expect(planned).toEqual(method === 'markupEdit' ? [requested] : requested)
        expect(after.documentParses - before.documentParses).toBe(0)
        expect(after.sourceMaterializations - before.sourceMaterializations).toBe(0)
        expect(after.documentMarkupEventUnits - before.documentMarkupEventUnits).toBe(0)
        expect(after.regionalInventoryAnnotationMaterializedNodes - before.regionalInventoryAnnotationMaterializedNodes).toBe(0)
        expect(after.regionalInventoryRootsCommitted).toBe(before.regionalInventoryRootsCommitted)
        expect(after.sourceRopeRootsCommitted).toBe(before.sourceRopeRootsCommitted)
        expect(after.fullProductStoreReleases).toBe(before.fullProductStoreReleases)
        if (planned === undefined) throw new Error('Expected a planned edit')
        revision = core.apply(revision, Array.isArray(planned) ? planned : [planned], { projections: ['markup'] }).revision
        source = source.slice(0, start) + 'X' + source.slice(start)
      }
      const oracle = createDocumentCore()
      const expected = oracle.open(source)
      expect(revision.source).toBe(source)
      expect(revision.annotations).toEqual(expected.annotations)
      expect(core.project(revision, 'markup').syntax.ast).toEqual(oracle.project(expected, 'markup').syntax.ast)
      expect(core.project(revision, 'original').markdown).toBe(oracle.project(expected, 'original').markdown)
      expect(core.project(revision, 'revised').markdown).toBe(oracle.project(expected, 'revised').markdown)
    })
  }

  it('validates ordinary replacement and partial deletion inside the pending new arm locally', () => {
    const core = createDocumentCore()
    let revision = core.open(denseSource)
    const start = denseSource.indexOf('new') + 1
    for (const insert of ['EW', '']) {
      const before = inspectDocumentCore(core)
      const requested = { start, end: start + 1, insert }
      const planned = core.trackedEdit(revision, requested)
      const after = inspectDocumentCore(core)
      expect(planned).toEqual(requested)
      expect(after.documentParses - before.documentParses).toBe(0)
      expect(after.sourceMaterializations - before.sourceMaterializations).toBe(0)
      if (planned === undefined) throw new Error('Expected an arm edit')
      revision = core.apply(revision, [planned], { projections: ['markup'] }).revision
    }
    expect(core.project(revision, 'original').markdown).toContain('old')
    expect(core.project(revision, 'revised').markdown).toContain('nWw')
  })

  it('preserves protected marker spelling and substitution equivalence cleanup', () => {
    const core = createDocumentCore()
    const revision = core.open(denseSource)
    const additionStart = denseSource.indexOf('added') + 2
    expect(core.trackedEdit(revision, { start: additionStart, end: additionStart, insert: '++}' }))
      .toEqual({ start: additionStart, end: additionStart, insert: '\\++}' })
    const newStart = denseSource.indexOf('new')
    const wrapperStart = denseSource.indexOf('{~~')
    const wrapperEnd = denseSource.indexOf('~~}', wrapperStart) + 3
    expect(core.trackedEdit(revision, { start: newStart, end: newStart + 3, insert: 'old' }))
      .toEqual({ start: wrapperStart, end: wrapperEnd, insert: 'old' })
    expect(revision.source).toBe(denseSource)
  })

  it('does not author into hidden comments or reinterpret tracked old/deleted text', () => {
    const core = createDocumentCore()
    const revision = core.open(denseSource)
    const before = inspectDocumentCore(core)
    const hidden = denseSource.indexOf('note') + 1
    expect(core.markupEdit(revision, { start: hidden, end: hidden, insert: 'X' })).toBeUndefined()
    for (const target of ['deleted', 'old']) {
      const start = denseSource.indexOf(target) + 1
      expect(core.trackedEdit(revision, { start, end: start, insert: 'X' })).toBeUndefined()
    }
    const after = inspectDocumentCore(core)
    expect(after.sourceRopeRootsCommitted).toBe(before.sourceRopeRootsCommitted)
    expect(after.regionalInventoryRootsCommitted).toBe(before.regionalInventoryRootsCommitted)
    expect(revision.source).toBe(denseSource)
    const start = denseSource.indexOf('added') + 2
    const accepted = core.trackedEdit(revision, { start, end: start, insert: 'X' })
    expect(accepted).toEqual({ start, end: start, insert: 'X' })
  })
})
