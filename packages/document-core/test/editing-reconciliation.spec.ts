import { describe, expect, it } from 'vitest'
import { editingReconciliation } from '../src/editingReconciliation.js'
import { createDocumentCore } from '../src/index.js'

describe('common editing operation reconciliation', () => {
  it.each([
    { at: 0, source: '{++Xseed++}', mapping: [{ start: 0, end: 0, insert: '{++' }, { start: 1, end: 4, insert: '' }] },
    { at: 10, source: '{++seedX++}', mapping: [{ start: 7, end: 10, insert: '' }, { start: 11, end: 11, insert: '++}' }] }
  ])('proves insertion coalescing across the owned addition boundary at $at', ({ at, source, mapping }) => {
    const core = createDocumentCore()
    const previous = core.open('{++seed++}')
    const input = { start: at, end: at, insert: 'X' }
    const edit = core.trackedEdit(previous, input)
    if (edit === undefined) throw new Error('Expected tracked insertion')
    const commit = core.apply(previous, [edit])
    expect(commit.revision.source).toBe(source)
    expect(editingReconciliation(core, previous, input, commit, 'visible')).toEqual(mapping)
    for (const invalid of [{ ...edit, insert: 'Y' }, { start: edit.start + 1, end: edit.start + 1, insert: 'X' }]) {
      const independent = createDocumentCore()
      const before = independent.open(previous.source)
      const altered = independent.apply(before, [invalid])
      expect(editingReconciliation(independent, before, input, altered, 'visible')).toBeUndefined()
    }
  })
  it('leaves an unchanged native payload in the same coordinate domain', () => {
    const core = createDocumentCore()
    const previous = core.open('seed')
    const input = { start: 4, end: 4, insert: 'x' }
    const commit = core.apply(previous, core.markupEdit(previous, input)!)
    expect(commit.revision.source).toBe('seedx')
    expect(editingReconciliation(core, previous, input, commit, 'visible')).toEqual([])
  })

  it('reports the exact protective spelling inserted inside an existing arm', () => {
    const core = createDocumentCore()
    const previous = core.open('{++seed++}')
    const input = { start: 7, end: 7, insert: '++}{--x--}' }
    const commit = core.apply(previous, core.markupEdit(previous, input)!)
    expect(commit.revision.source).toBe('{++seed\\++}\\{--x\\--}++}')
    expect(editingReconciliation(core, previous, input, commit, 'visible')).toEqual([
      { start: 7, end: 7, insert: '\\' },
      { start: 10, end: 10, insert: '\\' },
      { start: 14, end: 14, insert: '\\' }
    ])
  })

  it('maps a tracked replacement into the owned new arm', () => {
    const core = createDocumentCore()
    const previous = core.open('abcdef')
    const input = { start: 1, end: 3, insert: 'X' }
    const commit = core.apply(previous, [core.trackedEdit(previous, input)!])
    expect(commit.revision.source).toBe('a{~~bc~>X~~}def')
    expect(editingReconciliation(core, previous, input, commit, 'visible')).toEqual([
      { start: 1, end: 1, insert: '{~~bc~>' },
      { start: 2, end: 2, insert: '~~}' }
    ])
  })

  it('combines tracked wrapper and escape spelling at the same payload boundary', () => {
    const core = createDocumentCore()
    const previous = core.open('seed')
    const input = { start: 4, end: 4, insert: '++}' }
    const commit = core.apply(previous, [core.trackedEdit(previous, input)!])
    expect(commit.revision.source).toBe('seed{++\\++}++}')
    expect(editingReconciliation(core, previous, input, commit, 'visible')).toEqual([
      { start: 4, end: 4, insert: '{++\\' },
      { start: 7, end: 7, insert: '++}' }
    ])
  })

  it('maps an empty tracked replacement around its retained deleted text', () => {
    const core = createDocumentCore()
    const previous = core.open('abcdef')
    const input = { start: 1, end: 3, insert: '' }
    const commit = core.apply(previous, [core.trackedEdit(previous, input)!])
    expect(commit.revision.source).toBe('a{--bc--}def')
    expect(editingReconciliation(core, previous, input, commit, 'visible')).toEqual([
      { start: 1, end: 1, insert: '{--bc--}' }
    ])
  })

  it('does not invent a mapping for a different accepted payload', () => {
    const core = createDocumentCore()
    const previous = core.open('seed')
    const input = { start: 4, end: 4, insert: 'x' }
    const commit = core.apply(previous, [{ ...input, insert: 'y' }])
    expect(editingReconciliation(core, previous, input, commit, 'visible')).toBeUndefined()
  })

  it('leaves unsupported compound topology explicit', () => {
    const core = createDocumentCore()
    const previous = core.open('abcdef')
    const input = { start: 1, end: 3, insert: 'X' }
    const commit = core.apply(previous, [input, { start: 5, end: 6, insert: 'Y' }])
    expect(editingReconciliation(core, previous, input, commit, 'visible')).toBeUndefined()
  })
})

it('maps ordinary replacement when compilation removes the remaining annotation wrapper', () => {
  const core = createDocumentCore()
  const previous = core.open('a{++a++}a')
  const input = { start: 0, end: 5, insert: 'a' }
  const commit = core.apply(previous, core.markupEdit(previous, input)!)
  expect(commit.revision.source).toBe('aa')
  expect(editingReconciliation(core, previous, input, commit, 'visible')).toEqual([
    { start: 1, end: 4, insert: '' }
  ])
})

it('maps retained hidden comments into a whole-document raw replacement domain', () => {
  const core = createDocumentCore()
  const source = 'a{==mark==}{>>note<<}\n\nlast\n'
  const previous = core.open(source)
  const input = { start: 0, end: source.length - 1, insert: 'hello' }
  const commit = core.apply(previous, core.markupEdit(previous, input)!)
  expect(commit.revision.source).toBe('hello{>>note<<}\n')
  expect(editingReconciliation(core, previous, input, commit, 'visible')).toEqual([
    { start: 5, end: 5, insert: '{>>note<<}' }
  ])
})
