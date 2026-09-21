import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
const prose = Array.from({ length: 100 }, (_, index) => `Paragraph ${index}: ordinary prose.`)

describe('Native input through retained canonical regions', () => {
  for (const fixture of [
    { name: 'plain prose', target: 'ordinary target', tracked: false, other: 'ordinary neighbor' },
    { name: 'one suggestion', target: 'Middle {++ordinary target++}', tracked: false, other: 'ordinary neighbor' },
    { name: 'pending tracked addition', target: 'Middle {++ordinary target++}', tracked: true, other: 'ordinary neighbor' },
    { name: 'multiple suggestions and comments', target: '{++ordinary target++}{>>note<<}', tracked: false, other: '{~~old~>new~~}' }
  ]) {
    it(`plans, validates and commits repeated ${fixture.name} without opening whole-document products`, () => {
      const initial = [...prose.slice(0, 50), fixture.target, fixture.other, ...prose.slice(50)].join('\n\n')
      const core = createDocumentCore()
      const original = core.open(initial)
      let revision = original
      let expected = initial
      let at = initial.indexOf('target') + 3
      for (const data of ['a', 'é', '🙂', 'z']) {
        const action = { range: { start: at, end: at }, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, inputType: 'insertText', data, options }
        const before = inspectDocumentCore(core)
        const plan = core.planInput(revision, action)
        const edits = core.inputEdits(revision, action, plan, fixture.tracked)
        expect(edits).toEqual([{ start: at, end: at, insert: data }])
        const planned = inspectDocumentCore(core)
        expect(planned.sourceRopeRootsCommitted).toBe(before.sourceRopeRootsCommitted)
        expect(planned.regionalInventoryRootsCommitted).toBe(before.regionalInventoryRootsCommitted)
        if (edits === undefined) throw new Error('Expected native input edits')
        const commit = core.apply(revision, edits, { projections: ['markup'] })
        const result = core.reconcileInput(revision, plan, commit, action)
        const after = inspectDocumentCore(core)
        expect(after.documentParses - before.documentParses).toBe(0)
        expect(after.sourceMaterializations - before.sourceMaterializations).toBe(0)
        expect(commit.change.projections[0]?.scope).toBe('regions')
        expected = expected.slice(0, at) + data + expected.slice(at)
        at += data.length
        expect(result.selection).toEqual({ ranges: [{ anchor: at, focus: at }], primary: 0 })
        revision = commit.revision
      }
      const oracle = createDocumentCore()
      const fresh = oracle.open(expected)
      expect(revision.source).toBe(expected)
      expect(revision.annotations).toEqual(fresh.annotations)
      for (const mode of ['original', 'revised'] as const) {
        expect(core.project(revision, mode).markdown).toBe(oracle.project(fresh, mode).markdown)
        expect(core.project(revision, mode).ast).toEqual(oracle.project(fresh, mode).ast)
      }
      expect(core.project(revision, 'markup').syntax.ast).toEqual(oracle.project(fresh, 'markup').syntax.ast)
      expect(original.source).toBe(initial)
      const originalExpected = oracle.open(initial)
      expect(original.annotations).toEqual(originalExpected.annotations)
      expect(core.project(original, 'markup').syntax.ast).toEqual(oracle.project(originalExpected, 'markup').syntax.ast)
    })
  }

  it.each(['first', 'last'] as const)('keeps pairing at the %s paragraph boundary on the common input policy', location => {
    const initial = prose.join('\n\n')
    const at = location === 'first' ? initial.indexOf('\n') : initial.length
    const core = createDocumentCore()
    const revision = core.open(initial)
    const action = { range: { start: at, end: at }, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, inputType: 'insertText', data: '(', options }
    const before = inspectDocumentCore(core)
    const plan = core.planInput(revision, action)
    expect(plan.edits).toEqual([{ start: at, end: at, insert: '()' }])
    const edits = core.inputEdits(revision, action, plan, false)
    if (edits === undefined) throw new Error('Expected paired input')
    const commit = core.apply(revision, edits, { projections: ['markup'] })
    expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: at + 1, focus: at + 1 }], primary: 0 })
    expect(inspectDocumentCore(core).documentParses - before.documentParses).toBe(0)
    expect(commit.revision.source).toBe(initial.slice(0, at) + '()' + initial.slice(at))
  })

  it.each([
    { source: 'target [link][ref]\n\n[ref]: /url\n\nlast', at: 3, data: 'X', insert: 'X' },
    { source: 'before\n\n```js\nx\n```\n\nlast', at: 15, data: '*', insert: '*' },
    { source: 'target\n\nlast', at: 0, data: '# ', insert: '# ' }
  ])('preserves full-context admission for references, literals and syntax changes: $source', ({ source, at, data, insert }) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const action = { range: { start: at, end: at }, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, inputType: 'insertText', data, options }
    const plan = core.planInput(revision, action)
    expect(plan.edits).toEqual([{ start: at, end: at, insert }])
    const edits = core.inputEdits(revision, action, plan, false)
    if (edits === undefined) throw new Error('Expected common input compilation')
    const commit = core.apply(revision, edits, { projections: ['markup'] })
    const expected = source.slice(0, at) + insert + source.slice(at)
    const oracle = createDocumentCore()
    const fresh = oracle.open(expected)
    expect(commit.revision.source).toBe(expected)
    expect(core.project(commit.revision, 'markup').syntax.ast).toEqual(oracle.project(fresh, 'markup').syntax.ast)
    expect(revision.source).toBe(source)
  })
})
