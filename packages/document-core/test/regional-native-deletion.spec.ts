import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
const prose = Array.from({ length: 100 }, (_, index) => `Paragraph ${index}: ordinary prose.`)

describe('Native deletion through retained canonical regions', () => {
  for (const fixture of [
    { name: 'plain prose', target: 'ordinary target payload', tracked: false, other: 'ordinary neighbor' },
    { name: 'one suggestion', target: 'Middle {++ordinary target payload++}', tracked: false, other: 'ordinary neighbor' },
    { name: 'pending tracked addition', target: 'Middle {++ordinary target payload++}', tracked: true, other: 'ordinary neighbor' },
    { name: 'substitution and comment', target: 'Middle {~~original~>ordinary target payload~~}{>>note<<}', tracked: false, other: '{++another++}' }
  ]) {
    for (const backward of [false, true]) {
      it(`plans and commits repeated ${backward ? 'backward' : 'forward'} deletion in ${fixture.name} without full document products`, () => {
        const initial = [...prose.slice(0, 50), fixture.target, fixture.other, ...prose.slice(50)].join('\n\n')
        const core = createDocumentCore()
        const original = core.open(initial)
        let revision = original
        let expected = initial
        let caret = initial.indexOf('target') + (backward ? 'target'.length : 0)
        for (let turn = 0; turn < 4; turn += 1) {
          const start = backward ? caret - 1 : caret
          const end = start + 1
          const action = { range: { start, end }, selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 }, inputType: backward ? 'deleteContentBackward' : 'deleteContentForward', data: null, options }
          const before = inspectDocumentCore(core)
          const plan = core.planInput(revision, action)
          const edits = core.inputEdits(revision, action, plan, fixture.tracked)
          expect(edits).toEqual([{ start, end, insert: '' }])
          expect(inspectDocumentCore(core).sourceRopeRootsCommitted).toBe(before.sourceRopeRootsCommitted)
          if (edits === undefined) throw new Error('Expected native deletion edits')
          const commit = core.apply(revision, edits, { projections: ['markup'] })
          const result = core.reconcileInput(revision, plan, commit, action)
          const after = inspectDocumentCore(core)
          expect(after.documentParses - before.documentParses).toBe(0)
          expect(after.sourceMaterializations - before.sourceMaterializations).toBe(0)
          expect(commit.change.projections[0]?.scope).toBe('regions')
          expected = expected.slice(0, start) + expected.slice(end)
          caret = start
          expect(result.selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
          revision = commit.revision
        }
        const oracle = createDocumentCore()
        const fresh = oracle.open(expected)
        expect(revision.source).toBe(expected)
        expect(revision.annotations).toEqual(fresh.annotations)
        expect(core.project(revision, 'markup').syntax.ast).toEqual(oracle.project(fresh, 'markup').syntax.ast)
        for (const mode of ['original', 'revised'] as const) expect(core.project(revision, mode).markdown).toBe(oracle.project(fresh, mode).markdown)
        const originalExpected = oracle.open(initial)
        expect(original.source).toBe(initial)
        expect(original.annotations).toEqual(originalExpected.annotations)
        expect(core.project(original, 'markup').syntax.ast).toEqual(oracle.project(originalExpected, 'markup').syntax.ast)
      })
    }
  }

  for (const marked of [false, true]) {
    it.each([false, true])(`keeps oversized browser deletion targets inside their code payload (marked=${marked}, backward=%s)`, backward => {
      const code = '```js\nsame same\n```'
      const initial = ['before {++suggestion++}', marked ? `{++${code}++}` : code, 'after {~~old~>new~~}'].join('\n\n')
      const core = createDocumentCore()
      const revision = core.open(initial)
      const start = initial.indexOf('same same')
      const end = start + 'same same'.length
      const caret = backward ? start : end
      const selection = { ranges: [{ anchor: caret, focus: caret }], primary: 0 }
      const action = { selection, range: backward ? { start: initial.indexOf('js') + 2, end: caret } : { start: caret, end: initial.indexOf('after') + 5 }, inputType: backward ? 'deleteWordBackward' : 'deleteHardLineForward', data: null, options }
      const plan = core.planInput(revision, action)
      expect(plan.edits.filter(edit => edit.start !== edit.end || edit.insert !== '')).toEqual([])
      expect(plan.selection).toEqual(selection)
      expect(core.inputEdits(revision, action, plan, false)).toEqual([])
      expect(revision.source).toBe(initial)
    })
  }

  it('preserves a hidden comment while deleting a visible pair from its actual browser target', () => {
    const initial = 'before {++suggestion++}\n\nMiddle ({>>note<<})\n\nafter {~~old~>new~~}'
    const core = createDocumentCore()
    const revision = core.open(initial)
    const open = initial.indexOf('(')
    const close = initial.indexOf(')')
    const action = { range: { start: open, end: close }, selection: { ranges: [{ anchor: close, focus: close }], primary: 0 }, inputType: 'deleteContentBackward', data: null, options }
    const plan = core.planInput(revision, action)
    expect(plan.edits).toEqual([{ start: open, end: open + 1, insert: '' }, { start: close, end: close + 1, insert: '' }])
    const edits = core.inputEdits(revision, action, plan, false)
    if (edits === undefined) throw new Error('Expected paired deletion')
    const commit = core.apply(revision, edits, { projections: ['markup'] })
    expect(commit.revision.source).toBe('before {++suggestion++}\n\nMiddle {>>note<<}\n\nafter {~~old~>new~~}')
    expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: open, focus: open }], primary: 0 })
  })
})
