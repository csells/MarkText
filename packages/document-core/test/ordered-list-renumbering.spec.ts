import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentSourceEdit } from '../src/index.js'
import { regional } from './support/inputDriver.js'

// Upstream MarkText writes an ordered list afresh after an edit changes its
// items: a run of task or plain items keeps its ordinals while it holds the
// items it was read with, and otherwise numbers from its start in the list.
// Every edit path renumbers the lists it changes in the same operation; a
// tracked edit proposes the renumbering with it. The expected bytes are an
// upstream c054632f build's for the same gestures.

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
const caret = (at: number) => ({ ranges: [{ anchor: at, focus: at }], primary: 0 })
const applied = (source: string, edits: readonly DocumentSourceEdit[]): string => {
  let result = source
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    result = result.slice(0, edit.start) + edit.insert + result.slice(edit.end)
  }
  return result
}
const normalized = (source: string, edits: DocumentSourceEdit[]): string => {
  const core = createDocumentCore()
  return applied(source, core.normalizeEdits(core.open(source), edits, {}))
}
/** Plans `action` in both modes: the untracked bytes, and the tracked bytes' Revised and Original. */
const planned = (source: string, action: DocumentInputAction) => {
  const plan = (tracked: boolean) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const edits = core.inputEdits(revision, action, core.planInput(revision, action, { tracked }), tracked)
    if (edits === undefined) throw new Error('Expected edits')
    return applied(source, edits)
  }
  const tracked = plan(true)
  const reader = createDocumentCore()
  const read = reader.open(tracked)
  return { untracked: plan(false), revised: reader.project(read, 'revised').markdown, original: reader.project(read, 'original').markdown }
}
const at = (source: string, text: string) => source.indexOf(text)

describe('ordered list renumbering', () => {
  it('renumbers a list an item was deleted from', () => {
    const source = '1. a\n2. b\n3. c\n'
    expect(normalized(source, [{ start: at(source, '\n2.'), end: at(source, '\n3.'), insert: '' }])).toBe('1. a\n2. c\n')
  })

  it('renumbers after an item inserted mid-list', () => {
    const source = '1. a\n2. b\n3. c\n'
    expect(normalized(source, [{ start: at(source, '\n2.'), end: at(source, '\n2.'), insert: '\n2. n' }])).toBe('1. a\n2. n\n3. b\n4. c\n')
  })

  it('keeps a run of a mixed list that kept its items', () => {
    const source = '1. [x] a\n2. b\n3. [ ] c\n'
    expect(normalized(source, [{ start: at(source, '\n3.'), end: at(source, '\n3.'), insert: '\n3. d' }])).toBe('1. [x] a\n2. b\n3. d\n3. [ ] c\n')
  })

  it('renumbers the run that lost an item, from its start in the list', () => {
    const source = '1. [x] a\n2. b\n3. d\n3. [ ] c\n'
    expect(normalized(source, [{ start: at(source, '\n2. b'), end: at(source, '\n3. d'), insert: 'X' }])).toBe('1. [x] aX\n2. d\n3. [ ] c\n')
  })

  it('leaves untouched lists, text edits and its own output alone', () => {
    const source = '1. a\n3. b\n\npara\n\n5. x\n7. y\n'
    expect(normalized(source, [{ start: at(source, 'para') + 4, end: at(source, 'para') + 4, insert: ' more' }])).toBe('1. a\n3. b\n\npara more\n\n5. x\n7. y\n')
    expect(normalized(source, [{ start: at(source, 'b') + 1, end: at(source, 'b') + 1, insert: 'c' }])).toBe('1. a\n3. bc\n\npara\n\n5. x\n7. y\n')
    expect(normalized('1. a\n2. b\n3. c\n', [{ start: 4, end: 14, insert: '\n2. n\n3. b\n4. c' }])).toBe('1. a\n2. n\n3. b\n4. c\n')
  })

  it.each([
    ['Enter mid-list', '1. a\n2. b\n3. c\n', [4, 4], 'insertParagraph', null, '1. a\n2. \n3. b\n4. c\n'],
    ['typing over a selection across items', '1. a\n2. b\n3. c\n', [4, 9], 'insertText', 'X', '1. aX\n2. c\n']
  ] as const)('%s renumbers alike untracked and tracked', (_name, source, [start, end], inputType, data, expected) => {
    const action = { selection: { ranges: [{ anchor: start, focus: end }], primary: 0 }, range: { start, end }, inputType, data, options } as DocumentInputAction
    const result = planned(source, action)
    expect(result.untracked).toBe(expected)
    expect(result.revised).toBe(result.untracked)
    expect(result.original).toBe(source)
  })

  it.each([false, true])('cutting an item renumbers its list (tracked %s)', (tracked) => {
    const source = '1. a\n2. b\n3. c\n'
    const core = createDocumentCore()
    const revision = core.open(source)
    const plan = core.planClipboard(revision, { kind: 'cut', tracked, selection: { ranges: [{ anchor: 4, focus: 9 }], primary: 0 } })
    const result = applied(source, plan.edits)
    if (!tracked) {
      expect(result).toBe('1. a\n2. c\n')
      return
    }
    const reader = createDocumentCore()
    const read = reader.open(result)
    expect(reader.project(read, 'revised').markdown).toBe('1. a\n2. c\n')
    expect(reader.project(read, 'original').markdown).toBe(source)
    // Each renumbered ordinal is its own suggestion, not one replacement of the list.
    expect(result).toContain('{~~3~>2~~}. c')
  })

  it('renumbers a long list to its end after Enter mid-list', () => {
    const source = 'Intro.\n\n' + Array.from({ length: 300 }, (_, index) => `${String(index + 1)}. item ${String(index)}`).join('\n') + '\n\nTail.\n'
    const core = createDocumentCore()
    const revision = regional(core, source)
    const position = revision.source.indexOf('item 150') + 'item 150'.length
    const action = { selection: caret(position), range: { start: position, end: position }, inputType: 'insertParagraph', data: null, options } as DocumentInputAction
    const edits = core.inputEdits(revision, action, core.planInput(revision, action, { tracked: false }), false)
    if (edits === undefined) throw new Error('Expected edits')
    const next = core.apply(revision, edits, { projections: ['markup'] }).revision.source
    expect(next).toContain('151. item 150\n152. \n153. item 151\n')
    expect(next).toContain('301. item 299\n')
  })
})
