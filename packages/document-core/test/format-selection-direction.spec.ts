import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

it.each([
  { format: 'strong', marker: '**', tracked: false },
  { format: 'strong', marker: '**', tracked: true },
  { format: 'em', marker: '*', tracked: false },
  { format: 'em', marker: '*', tracked: true }
] as const)('preserves backward $format selection through the owned planner with Track=$tracked', ({ format, marker, tracked }) => {
  const core = createDocumentCore()
  const source = 'a{++a++}a\n'
  const previous = core.open(source)
  const plan = core.planFormat(previous, { format, tracked, selection: { ranges: [{ anchor: 9, focus: 0 }], primary: 0 } })
  const payload = `${marker}${source.slice(0, -1)}${marker}`
  const expected = tracked ? `{~~${source.slice(0, -1)}~>${payload}~~}\n` : `${payload}\n`
  const revision = core.apply(previous, plan.edits).revision
  expect(revision.source).toBe(expected)
  const shift = (tracked ? 14 : 0) + marker.length
  expect(plan.selection).toEqual({ ranges: [{ anchor: 9 + shift, focus: shift }], primary: 0 })
})

it('preserves a backward selection when formatting is a no-op over a literal block', () => {
  const core = createDocumentCore()
  const previous = core.open('```\naaa\n```\n')
  const selection = { ranges: [{ anchor: 7, focus: 4 }], primary: 0 }
  const plan = core.planFormat(previous, { format: 'strong', tracked: false, selection })
  expect(plan.edits).toEqual([])
  expect(plan.selection).toEqual(selection)
})

it('rejects multiple formatting selections instead of dropping a range', () => {
  const core = createDocumentCore()
  const previous = core.open('abc\n')
  expect(() => core.planFormat(previous, { format: 'strong', tracked: false, selection: { ranges: [{ anchor: 3, focus: 1 }, { anchor: 1, focus: 0 }], primary: 0 } })).toThrow('exactly one')
})
