import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

describe('native replacement inside an existing pending arm with nested annotations', () => {
  it.each([
    { selected: 'a{++a++}a', insert: 'X', expected: 'X' },
    { selected: 'a{++a++}{>>note<<}a', insert: 'X', expected: 'X{>>note<<}' },
    { selected: 'a{++a++}a', insert: '{++literal++}', expected: '\\{++literal\\++}' }
  ])('replaces $selected while retaining the outer Original and literal input', ({ selected, insert, expected }) => {
    const core = createDocumentCore()
    const source = `{~~a{++a++}a~>**${selected}**~~}\n`
    const revision = core.open(source)
    const range = { start: 16, end: 16 + selected.length }
    const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: range.start, focus: range.end }], primary: 0 }, range, inputType: 'insertText', data: insert, options }
    const plan = core.planInput(revision, inputAction)
    const edits = core.inputEdits(revision, inputAction, plan, true)
    expect(edits).toBeDefined()
    if (edits === undefined) throw new Error('Pending-arm replacement was rejected')
    const commit = core.apply(revision, edits)
    const expectedSource = `{~~a{++a++}a~>**${expected}**~~}\n`
    expect(commit.revision.source).toBe(expectedSource)
    expect(core.project(commit.revision, 'original').markdown).toBe('aa\n')
    const result = core.reconcileInput(revision, plan, commit, inputAction)
    expect(result.compilerReconciliation).toBeDefined()
    const caret = 16 + (insert === 'X' ? 1 : expected.length)
    expect(result.selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
    const reopened = createDocumentCore()
    expect(reopened.open(commit.revision.source).source).toBe(expectedSource)
  })

  it('uses the same pending-arm semantics through the singular tracking API', () => {
    const core = createDocumentCore()
    const revision = core.open('{~~a{++a++}a~>**a{++a++}{>>note<<}a**~~}\n')
    expect(core.track(revision, { start: 16, end: 35, insert: 'X' }).revision.source)
      .toBe('{~~a{++a++}a~>**X{>>note<<}**~~}\n')
  })

  it('does not change a nested old arm when typing belongs to its proposed sibling', () => {
    const core = createDocumentCore()
    const source = '{~~old~>a{~~old~>new~~}z~~}\n'
    const revision = core.open(source)
    const edit = core.trackedEdit(revision, { start: 12, end: 15, insert: 'X' })
    expect(edit).toBeUndefined()
    expect(revision.source).toBe(source)
  })
})
