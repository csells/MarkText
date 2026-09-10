import { describe, expect, it } from 'vitest'
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
    expect(core.editingReconciliation(previous, input, commit)).toEqual(mapping)
    for (const invalid of [{ ...edit, insert: 'Y' }, { start: edit.start + 1, end: edit.start + 1, insert: 'X' }]) {
      const independent = createDocumentCore()
      const before = independent.open(previous.source)
      const altered = independent.apply(before, [invalid])
      expect(independent.editingReconciliation(before, input, altered)).toBeUndefined()
    }
  })
  it('leaves an unchanged native payload in the same coordinate domain', () => {
    const core = createDocumentCore()
    const previous = core.open('seed')
    const input = { start: 4, end: 4, insert: 'x' }
    const commit = core.apply(previous, core.markupEdit(previous, input)!)
    expect(commit.revision.source).toBe('seedx')
    expect(core.editingReconciliation(previous, input, commit)).toEqual([])
  })

  it('reports the exact protective spelling inserted inside an existing arm', () => {
    const core = createDocumentCore()
    const previous = core.open('{++seed++}')
    const input = { start: 7, end: 7, insert: '++}{--x--}' }
    const commit = core.apply(previous, core.markupEdit(previous, input)!)
    expect(commit.revision.source).toBe('{++seed\\++}\\{--x\\--}++}')
    expect(core.editingReconciliation(previous, input, commit)).toEqual([
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
    expect(core.editingReconciliation(previous, input, commit)).toEqual([
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
    expect(core.editingReconciliation(previous, input, commit)).toEqual([
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
    expect(core.editingReconciliation(previous, input, commit)).toEqual([
      { start: 1, end: 1, insert: '{--bc--}' }
    ])
  })

  it('does not invent a mapping for a different accepted payload', () => {
    const core = createDocumentCore()
    const previous = core.open('seed')
    const input = { start: 4, end: 4, insert: 'x' }
    const commit = core.apply(previous, [{ ...input, insert: 'y' }])
    expect(core.editingReconciliation(previous, input, commit)).toBeUndefined()
  })

  it('leaves unsupported compound topology explicit', () => {
    const core = createDocumentCore()
    const previous = core.open('abcdef')
    const input = { start: 1, end: 3, insert: 'X' }
    const commit = core.apply(previous, [input, { start: 5, end: 6, insert: 'Y' }])
    expect(core.editingReconciliation(previous, input, commit)).toBeUndefined()
  })

  it('rejects revision handles from another document owner', () => {
    const core = createDocumentCore()
    const other = createDocumentCore()
    const previous = core.open('seed')
    const foreign = other.open('seed')
    const input = { start: 4, end: 4, insert: 'x' }
    const commit = core.apply(previous, [input])
    const foreignCommit = other.apply(foreign, [input])
    expect(() => core.editingReconciliation(foreign, input, commit)).toThrow('another core')
    expect(() => core.editingReconciliation(previous, input, foreignCommit)).toThrow('another core')
  })
})

it('maps ordinary replacement when compilation removes the remaining annotation wrapper', () => {
  const core = createDocumentCore()
  const previous = core.open('a{++a++}a')
  const input = { start: 0, end: 5, insert: 'a' }
  const commit = core.apply(previous, core.markupEdit(previous, input)!)
  expect(commit.revision.source).toBe('aa')
  expect(core.editingReconciliation(previous, input, commit)).toEqual([
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
  expect(core.editingReconciliation(previous, input, commit)).toEqual([
    { start: 5, end: 5, insert: '{>>note<<}' }
  ])
})
