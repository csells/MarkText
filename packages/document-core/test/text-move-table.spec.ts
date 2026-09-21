import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }

for (const copy of [false, true]) {
  it.each([
    { donor: 'a|b', inserted: 'a\\|b' },
    { donor: 'a\\|b', inserted: 'a\\|b' },
    { donor: 'one\nnext', inserted: 'one<br/>next' },
    { donor: 'one\r\nnext', inserted: 'one<br/>next' },
    { donor: 'one\rnext', inserted: 'one<br/>next' },
    { donor: 'a{++|++}b', inserted: 'a{++\\|++}b' }
  ])(`spells a text ${copy ? 'copy' : 'move'} into its owned cell: $donor`, example => {
    const core = createDocumentCore()
    const source = example.donor + '\n\n| target |\n| --- |\n'
    const revision = core.open(source)
    const syntax = core.project(revision, 'markup').syntax
    const table = syntax.ast.root.children.find(node => node.kind === 'table')!
    const action: DocumentInputAction = {
      kind: 'command',
      command: 'moveText',
      copy,
      options,
      selection: { ranges: [{ anchor: example.donor.length, focus: 0 }], primary: 0 },
      target: { kind: 'table-cell', cell: { table: { start: syntax.coordinates.toSource(table.range.start, 'previous'), end: syntax.coordinates.toSource(table.range.end, 'next') }, row: 0, column: 0 }, anchor: 0, focus: 0 }
    }
    const plan = core.planInput(revision, action)
    const edits = core.inputEdits(revision, action, plan, false)
    expect(edits).toBeDefined()
    const commit = core.apply(revision, edits!)
    const expected = (copy ? example.donor : '') + '\n\n| ' + example.inserted + 'target |\n| --- |\n'
    expect(commit.revision.source).toBe(expected)
    const rendered = core.project(commit.revision, 'revised').ast.root.children.find(node => node.kind === 'table')!
    expect(rendered.kind).toBe('table')
    expect(rendered.children[0]!.children).toHaveLength(1)
    const selection = core.reconcileInput(revision, plan, commit, action).selection
    const caret = expected.indexOf('target')
    expect(selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
    if (!selection) throw new Error('Missing text drop caret')
    const typing: DocumentInputAction = { selection, range: { start: caret, end: caret }, inputType: 'insertText', data: 'X', options }
    const typed = core.planInput(commit.revision, typing)
    const next = core.apply(commit.revision, core.inputEdits(commit.revision, typing, typed, false)!)
    expect(next.revision.source).toBe(expected.replace('target', 'Xtarget'))
    expect(core.open(next.revision.source).source).toBe(next.revision.source)
  })
}

it('materializes only the target missing cell when copying a pipe payload', () => {
  const core = createDocumentCore()
  const source = 'a|b\n\n| h1 | h2 |\n| --- | --- |\n| row |\n'
  const revision = core.open(source)
  const table = core.project(revision, 'markup').syntax.ast.root.children[1]!
  const action: DocumentInputAction = { kind: 'command', command: 'moveText', copy: true, options, selection: { ranges: [{ anchor: 0, focus: 3 }], primary: 0 }, target: { kind: 'table-cell', cell: { table: table.range, row: 1, column: 1 }, anchor: 0, focus: 0 } }
  const plan = core.planInput(revision, action)
  const commit = core.apply(revision, core.inputEdits(revision, action, plan, false)!)
  expect(commit.revision.source).toBe('a|b\n\n| h1 | h2 |\n| --- | --- |\n| row |     a\\|b|\n')
  const caret = commit.revision.source.indexOf('a\\|b|') + 4
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
})

it.each([false, true])('retains independent tracked cell semantics and the next caret (copy=%s)', copy => {
  const core = createDocumentCore()
  const source = 'a|b\n\n| target |\n| --- |\n'
  const revision = core.open(source)
  const table = core.project(revision, 'markup').syntax.ast.root.children[1]!
  const action: DocumentInputAction = { kind: 'command', command: 'moveText', copy, options, selection: { ranges: [{ anchor: 0, focus: 3 }], primary: 0 }, target: { kind: 'table-cell', cell: { table: table.range, row: 0, column: 0 }, anchor: 0, focus: 0 } }
  const plan = core.planInput(revision, action)
  const commit = core.apply(revision, core.inputEdits(revision, action, plan, true)!)
  const expected = (copy ? 'a|b' : '') + '\n\n| a\\|btarget |\n| --- |\n'
  expect(core.project(commit.revision, 'original').markdown).toBe(source)
  expect(core.project(commit.revision, 'revised').markdown).toBe(expected)
  const selection = core.reconcileInput(revision, plan, commit, action).selection
  if (selection === undefined || !('ranges' in selection)) throw new Error('Expected exact source caret')
  const point = selection.ranges[selection.primary]!
  const typing: DocumentInputAction = { selection, range: { start: point.anchor, end: point.focus }, inputType: 'insertText', data: 'X', options }
  const typed = core.planInput(commit.revision, typing)
  const next = core.apply(commit.revision, core.inputEdits(commit.revision, typing, typed, true)!)
  expect(core.project(next.revision, 'original').markdown).toBe(source)
  expect(core.project(next.revision, 'revised').markdown).toBe(expected.replace('target', 'Xtarget'))
})

it('spells a pipe payload inside an intrinsic cell value without rounding its target', () => {
  const core = createDocumentCore()
  const revision = core.open('a|b\n\n| &fjlig; target |\n| --- |\n')
  const text = core.project(revision, 'markup').syntax.ast.root.children[1]!.children[0]!.children[0]!.children[0]!.range
  const point = { text, offset: 1 }
  const action: DocumentInputAction = { kind: 'command', command: 'moveText', copy: true, options, selection: { ranges: [{ anchor: 0, focus: 3 }], primary: 0 }, target: { kind: 'model-text', anchor: point, focus: point } }
  const plan = core.planInput(revision, action)
  const commit = core.apply(revision, core.inputEdits(revision, action, plan, false)!)
  expect(commit.revision.source).toBe('a|b\n\n| fa\\|bj target |\n| --- |\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 12, focus: 12 }], primary: 0 })
})

it.each(['source', 'model-text'] as const)('recognizes a physical cell at a %s target', kind => {
  const core = createDocumentCore()
  const revision = core.open('a|b\n\n| target |\n| --- |\n')
  const target = kind === 'source' ? { start: 7, end: 7 } : { kind, anchor: 7, focus: 7 }
  const action: DocumentInputAction = { kind: 'command', command: 'moveText', copy: true, options, selection: { ranges: [{ anchor: 0, focus: 3 }], primary: 0 }, target }
  const plan = core.planInput(revision, action)
  const commit = core.apply(revision, core.inputEdits(revision, action, plan, false)!)
  expect(commit.revision.source).toBe('a|b\n\n| a\\|btarget |\n| --- |\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 11, focus: 11 }], primary: 0 })
})

it('keeps table spelling when copying within the same normalized pipe value', () => {
  const core = createDocumentCore()
  const revision = core.open('| &vert; target |\n| --- |\n')
  const text = core.project(revision, 'markup').syntax.ast.root.children[0]!.children[0]!.children[0]!.children[0]!.range
  const action: DocumentInputAction = { kind: 'command', command: 'moveText', copy: true, options, selection: { kind: 'model-text', anchor: { text, offset: 0 }, focus: { text, offset: 1 } }, target: { kind: 'model-text', anchor: { text, offset: 1 }, focus: { text, offset: 1 } } }
  const plan = core.planInput(revision, action)
  const commit = core.apply(revision, core.inputEdits(revision, action, plan, false)!)
  expect(commit.revision.source).toBe('| \\|\\| target |\n| --- |\n')
  expect(core.project(commit.revision, 'revised').ast.root.children[0]!.kind).toBe('table')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 6, focus: 6 }], primary: 0 })
})
