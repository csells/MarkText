import { expect, it } from 'vitest'
import * as model from '../src/index.js'

const point = (offset: number) => ({ text: { start: 6, end: 7 }, offset })
it.each([[1, 2], [2, 1]])('copies precisely the intrinsic selected value (%s,%s) without changing source', (anchor, focus) => {
  const core = model.createDocumentCore()
  const revision = core.open('  ```\n\tbody\n  ```\n')
  const result = model.projectModelTextSelection(core, revision, { kind: 'model-text', anchor: point(anchor), focus: point(focus) })
  expect(result.name).toBe('revised')
  expect(result.markdown).toBe(' ')
  expect(result.ast.root.children).toMatchObject([{ kind: 'paragraph', children: [{ kind: 'text', attributes: { semanticText: ' ' } }] }])
  expect(revision.source).toBe('  ```\n\tbody\n  ```\n')
})
it('rejects a stale semantic offset without materializing it', () => {
  const core = model.createDocumentCore()
  const revision = core.open('  ```\n\tbody\n  ```\n')
  expect(() => model.projectModelTextSelection(core, revision, { kind: 'model-text', anchor: point(3), focus: point(3) })).toThrow(RangeError)
  expect(revision.source).toBe('  ```\n\tbody\n  ```\n')
})

it('projects the owned source spelling while retaining an intrinsic history address', () => {
  const core = model.createDocumentCore()
  const revision = core.open('  ```\n\tbody\n  ```\n')
  const selection = { kind: 'model-text' as const, anchor: point(1), focus: point(1) }
  expect(model.projectSourceSelection(core, revision, selection)).toEqual({ ranges: [{ anchor: 6, focus: 7 }], primary: 0 })
  expect(model.copyDocumentSelection(selection, revision.sourceLength)).toEqual(selection)
  expect(revision.source).toBe('  ```\n\tbody\n  ```\n')
})

it('rebases an untouched intrinsic spelling and rejects replacement of that owner', () => {
  const core = model.createDocumentCore()
  const revision = core.open('  ```\n\tbody\n  ```\n')
  const selection = { kind: 'model-text' as const, anchor: point(1), focus: point(1) }
  const shifted = core.apply(revision, [{ start: 0, end: 0, insert: '\n' }])
  expect(model.rebaseDocumentInputSelection(core, revision, shifted, selection, { affinity: 'after', operation: { kind: 'edits' } })).toEqual({ kind: 'mapped', selection: { kind: 'model-text', anchor: { text: { start: 7, end: 8 }, offset: 1 }, focus: { text: { start: 7, end: 8 }, offset: 1 } } })
  const second = model.createDocumentCore()
  const original = second.open(revision.source)
  const changed = second.apply(original, [{ start: 6, end: 7, insert: '    ' }])
  expect(model.rebaseDocumentInputSelection(second, original, changed, selection, { affinity: 'after', operation: { kind: 'edits' } })).toEqual({ kind: 'conflict' })
})

it('keeps numeric Source endpoints exact even when their adjacent value is normalized', () => {
  const core = model.createDocumentCore()
  const revision = core.open('  ```\n\tbody\n  ```\n')
  expect(model.projectSourceSelection(core, revision, { kind: 'model-text', anchor: 7, focus: 7 })).toEqual({ ranges: [{ anchor: 7, focus: 7 }], primary: 0 })
  expect(model.projectSourceSelection(core, revision, { kind: 'model-text', anchor: 7, focus: point(1) })).toEqual({ ranges: [{ anchor: 7, focus: 6 }], primary: 0 })
  expect(model.projectModelTextSelection(core, revision, { kind: 'model-text', anchor: point(1), focus: 10 }).markdown).toBe(' bod')
  expect(model.projectModelTextSelection(core, revision, { kind: 'model-text', anchor: 10, focus: point(1) }).markdown).toBe(' bod')
  expect(revision.source).toBe('  ```\n\tbody\n  ```\n')
})
