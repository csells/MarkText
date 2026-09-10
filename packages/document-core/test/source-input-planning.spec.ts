import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentSelection } from '../src/index.js'

const selection = (anchor: number, focus = anchor): DocumentSelection => ({ ranges: [{ anchor, focus }], primary: 0 })
describe('Source input on the shared document model', () => {
  it('admits exact literal edits with canonical multiline selection sets', () => {
    const core = createDocumentCore()
    const revision = core.open('abc\r\ndef')
    const beforeSelection = { ranges: [{ anchor: 3, focus: 0 }, { anchor: 8, focus: 5 }], primary: 1 }
    const afterSelection = { ranges: [{ anchor: 1, focus: 1 }, { anchor: 4, focus: 4 }], primary: 1 }
    const plan = core.planSourceInput(revision, {
      edits: [{ start: 0, end: 3, insert: 'X' }, { start: 5, end: 8, insert: 'Y' }], beforeSelection, afterSelection
    })
    const commit = core.apply(revision, plan.edits)
    expect(commit.revision.source).toBe('X\r\nY')
    expect(plan.beforeSelection).toEqual(beforeSelection)
    expect(plan.afterSelection).toEqual(afterSelection)
    if (!('ranges' in plan.afterSelection)) throw new Error('Source control requires text selections')
    expect(Object.isFrozen(plan.afterSelection.ranges[0])).toBe(true)
  })

  it.each([
    { beforeSelection: selection(4), afterSelection: selection(1) },
    { beforeSelection: selection(0, 3), afterSelection: selection(2) },
    { beforeSelection: { ranges: [], primary: 0 }, afterSelection: selection(1) },
    { beforeSelection: { ranges: [{ anchor: 0, focus: 3 }], primary: 1 }, afterSelection: selection(1) }
  ])('rejects invalid selections before source mutation', selections => {
    const core = createDocumentCore()
    const revision = core.open('abc')
    expect(() => core.planSourceInput(revision, { edits: [{ start: 0, end: 3, insert: 'X' }], ...selections })).toThrow(RangeError)
    expect(revision.source).toBe('abc')
  })

  it('requires a revision owned by the same document stack', () => {
    const core = createDocumentCore()
    const revision = createDocumentCore().open('abc')
    expect(() => core.planSourceInput(revision, { edits: [], beforeSelection: selection(0), afterSelection: selection(0) })).toThrow()
  })
})
