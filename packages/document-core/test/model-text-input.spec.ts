import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

it('edits a point inside normalized code indentation in one owned operation', () => {
  const core = createDocumentCore()
  const previous = core.open('  ```\n\tbody\n  ```\n')
  const selection = { kind: 'model-text' as const, anchor: { text: { start: 6, end: 7 }, offset: 1 }, focus: { text: { start: 6, end: 7 }, offset: 1 } }
  const action = { selection, range: selection, inputType: 'insertText', data: 'x', options }
  const policy = core.planInput(previous, action)
  expect(policy.edits).toEqual([{ start: 6, end: 7, insert: '   x ' }])
  const edits = core.inputEdits(previous, action, policy, false)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits ?? [])
  expect(commit.revision.source).toBe('  ```\n   x body\n  ```\n')
  expect(core.reconcileInput(previous, policy, commit, action).selection).toEqual({ ranges: [{ anchor: 10, focus: 10 }], primary: 0 })
  expect(previous.source).toBe('  ```\n\tbody\n  ```\n')
})

it('preserves source and intrinsic selection for cancellation and literal format no-op', () => {
  const core = createDocumentCore()
  const previous = core.open('  ```\n\tbody\n  ```\n')
  const selection = { kind: 'model-text' as const, anchor: { text: { start: 6, end: 7 }, offset: 1 }, focus: { text: { start: 6, end: 7 }, offset: 1 } }
  const action = { selection, range: selection, inputType: 'cancelComposition', data: null, options }
  const policy = core.planInput(previous, action)
  expect(policy.edits).toEqual([])
  expect(core.reconcileInput(previous, policy, null, action).selection).toEqual(selection)
  expect(core.planFormat(previous, { format: 'strong', selection, tracked: false })).toEqual({ edits: [], selection })
  expect(previous.source).toBe('  ```\n\tbody\n  ```\n')
})

it('deletes one rendered tab column when the actual caret is an ordinary source endpoint', () => {
  const core = createDocumentCore()
  const previous = core.open('  ```\n\tbody\n  ```\n')
  const selection = { ranges: [{ anchor: 7, focus: 7 }], primary: 0 }
  const range = { kind: 'model-text' as const, anchor: { text: { start: 6, end: 7 }, offset: 1 }, focus: 7 }
  const action = { selection, range, inputType: 'deleteContentBackward', data: null, options }
  const policy = core.planInput(previous, action)
  expect(policy.edits).toEqual([{ start: 6, end: 7, insert: '   ' }])
  expect(policy.selection).toEqual({ ranges: [{ anchor: 9, focus: 9 }], primary: 0 })
  const edits = core.inputEdits(previous, action, policy, false)
  expect(edits).toBeDefined()
  expect(core.apply(previous, edits ?? []).revision.source).toBe('  ```\n   body\n  ```\n')
})

it.each(['ordinary', 'tracked'])('keeps directional wrapping inside a normalized value (%s)', mode => {
  const core = createDocumentCore()
  const previous = core.open('  ```\n\tbody\n  ```\n')
  const selection = { kind: 'model-text' as const, anchor: { text: { start: 6, end: 7 }, offset: 2 }, focus: { text: { start: 6, end: 7 }, offset: 1 } }
  const action = { selection, range: selection, inputType: 'insertText', data: '(', options }
  const policy = core.planInput(previous, action)
  expect(policy.edits).toEqual([{ start: 6, end: 7, insert: '   ( )' }])
  expect(policy.selection).toEqual({ ranges: [{ anchor: 11, focus: 10 }], primary: 0 })
  const edits = core.inputEdits(previous, action, policy, mode === 'tracked')
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits ?? [])
  expect(core.project(commit.revision, 'revised').markdown).toBe('  ```\n   ( )body\n  ```\n')
  if (mode === 'tracked') expect(core.project(commit.revision, 'original').markdown).toBe(previous.source)
  const selected = core.reconcileInput(previous, policy, commit, action).selection
  expect(selected).toBeDefined()
})

it.each([false, true])('pastes and cuts intrinsic literal text through the same compiler (tracked=%s)', tracked => {
  const core = createDocumentCore()
  const previous = core.open('  ```\n\tbody\n  ```\n')
  const selection = { kind: 'model-text' as const, anchor: { text: { start: 6, end: 7 }, offset: 1 }, focus: { text: { start: 6, end: 7 }, offset: 1 } }
  const plan = core.planClipboard(previous, { kind: 'paste', selection, markdown: '**x**', plainText: 'x', tracked })
  const commit = core.apply(previous, plan.edits)
  expect(core.project(commit.revision, 'revised').markdown).toBe('  ```\n   x body\n  ```\n')
  const caret = core.project(commit.revision, 'revised').coordinates.toSource(10, 'next')
  expect(plan.selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
  if (tracked) expect(core.project(commit.revision, 'original').markdown).toBe(previous.source)
  const cutCore = createDocumentCore()
  const cutPrevious = cutCore.open(previous.source)
  const cutSelection = { ...selection, focus: { text: { start: 6, end: 7 }, offset: 2 } }
  const cut = cutCore.planClipboard(cutPrevious, { kind: 'cut', selection: cutSelection, tracked })
  const removed = cutCore.apply(cutPrevious, cut.edits)
  expect(cutCore.project(removed.revision, 'revised').markdown).toBe('  ```\n   body\n  ```\n')
  if (tracked) expect(cutCore.project(removed.revision, 'original').markdown).toBe(previous.source)
})

it.each([
  { command: 'tab' as const, shift: false, source: '  ```\n        body\n  ```\n', caret: 13 },
  { command: 'resetCodeBlock' as const, selectionMode: 'preserve' as const, source: '  body\n', caret: 1 }
])('applies $command using the intrinsic value position', example => {
  const core = createDocumentCore()
  const revision = core.open('  ```\n\tbody\n  ```\n')
  const selection = { kind: 'model-text' as const, anchor: { text: { start: 6, end: 7 }, offset: 1 }, focus: { text: { start: 6, end: 7 }, offset: 1 } }
  const action = { kind: 'command' as const, ...example, selection, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(commit.revision.source).toBe(example.source)
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: example.caret, focus: example.caret }], primary: 0 })
})

it.each(['table-cell', 'table'] as const)('retains later %s selection when intrinsic clipboard completion arrives', kind => {
  const core = createDocumentCore()
  const prefix = '  ```\n\tbody\n  ```\n\n'
  const tableSource = '| a | b |\n| --- | --- |\n| c | d |\n'
  const revision = core.open(prefix + tableSource)
  const tableNode = core.project(revision, 'markup').syntax.ast.root.children.find(node => node.kind === 'table')
  if (tableNode === undefined) throw new Error('Expected fixture table')
  const table = tableNode.range
  expect(table.start).toBe(prefix.length)
  const currentSelection = kind === 'table-cell'
    ? { kind, cell: { table, row: 1, column: 1 }, anchor: 0, focus: 1 }
    : { kind, table, anchor: { row: 1, column: 1 }, focus: { row: 0, column: 0 } }
  const point = { text: { start: 6, end: 7 }, offset: 1 }
  const plan = core.planClipboard(revision, { kind: 'paste', selection: { kind: 'model-text', anchor: point, focus: point }, currentSelection, markdown: 'x', tracked: false })
  const shifted = { start: table.start + 4, end: table.end + 4 }
  expect(plan.selection).toEqual(kind === 'table-cell' ? { ...currentSelection, cell: { table: shifted, row: 1, column: 1 } } : { ...currentSelection, table: shifted })
  expect(core.apply(revision, plan.edits).revision.source).toBe('  ```\n   x body\n  ```\n\n' + tableSource)
})

it.each(['\n', '\r\n', '\r'])('inserts Enter and multiline clipboard text at the intrinsic literal position (%j)', eol => {
  for (const kind of ['enter', 'paste'] as const) {
    const core = createDocumentCore()
    const source = ['  ```', '\tbody', '  ```', ''].join(eol)
    const previous = core.open(source)
    const tab = 5 + eol.length
    const point = { text: { start: tab, end: tab + 1 }, offset: 1 }
    const selection = { kind: 'model-text' as const, anchor: point, focus: point }
    const action = { selection, range: selection, inputType: 'insertParagraph', data: null, options }
    const policy = kind === 'enter' ? core.planInput(previous, action) : undefined
    const plan = kind === 'paste' ? core.planClipboard(previous, { kind: 'paste', selection, markdown: 'x' + eol + 'y', tracked: false }) : undefined
    if (policy === undefined && plan === undefined) throw new Error('Expected an input or clipboard plan')
    const edits = plan?.edits ?? (policy === undefined ? undefined : core.inputEdits(previous, action, policy, false))
    expect(edits).toBeDefined()
    const commit = core.apply(previous, edits ?? [])
    expect(commit.revision.source).toBe(kind === 'enter' ? ['  ```', '   ', '     body', '  ```', ''].join(eol) : ['  ```', '   x', '  y body', '  ```', ''].join(eol))
    const caret = tab + 7 + eol.length
    expect(plan?.selection ?? (policy === undefined ? undefined : core.reconcileInput(previous, policy, commit, action).selection)).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
    expect(previous.source).toBe(source)
  }
})

it.each([false, true])('preserves literal indentation when replacing from a numeric edge to an intrinsic point (backward=%s)', backward => {
  const core = createDocumentCore()
  const previous = core.open('  ```\n\tbody\n  ```\n')
  const point = { text: { start: 6, end: 7 }, offset: 1 }
  const selection = { kind: 'model-text' as const, anchor: backward ? point : 6, focus: backward ? 6 : point }
  const action = { selection, range: selection, inputType: 'insertText', data: 'x', options }
  const policy = core.planInput(previous, action)
  expect(policy.edits).toEqual([{ start: 6, end: 7, insert: '  x ' }])
  const edits = core.inputEdits(previous, action, policy, false)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits ?? [])
  expect(commit.revision.source).toBe('  ```\n  x body\n  ```\n')
  expect(core.reconcileInput(previous, policy, commit, action).selection).toEqual({ ranges: [{ anchor: 9, focus: 9 }], primary: 0 })
})

it.each(['tab', 'resetCodeBlock', 'enter'] as const)('tracks %s from the same intrinsic source position', command => {
  const core = createDocumentCore()
  const source = '  ```\n\tbody\n  ```\n'
  const previous = core.open(source)
  const point = { text: { start: 6, end: 7 }, offset: 1 }
  const selection = { kind: 'model-text' as const, anchor: point, focus: point }
  const action = command === 'enter'
    ? { selection, range: selection, inputType: 'insertParagraph', data: null, options }
    : command === 'tab'
      ? { kind: 'command' as const, command, shift: false, selection, options }
      : { kind: 'command' as const, command, selectionMode: 'preserve' as const, selection, options }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, true)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits ?? [])
  const revised = core.project(commit.revision, 'revised')
  expect(revised.markdown).toBe(command === 'tab' ? '  ```\n        body\n  ```\n' : command === 'resetCodeBlock' ? '  body\n' : '  ```\n   \n     body\n  ```\n')
  expect(core.project(commit.revision, 'original').markdown).toBe(source)
  const result = core.reconcileInput(previous, plan, commit, action).selection
  expect(result).toBeDefined()
  if (result === undefined || !('ranges' in result)) throw new Error('Expected numeric compiled caret')
  const offset = command === 'tab' ? 13 : command === 'resetCodeBlock' ? 1 : 14
  expect(revised.coordinates.toProjected(result.ranges[0]?.anchor ?? -1, 'next')).toBe(offset)
  expect(result.ranges[0]?.focus).toBe(result.ranges[0]?.anchor)
})

it('uses the next owned literal character at a normalized value boundary', () => {
  const core = createDocumentCore()
  const previous = core.open('  ```\n\t)body\n  ```\n')
  const point = { text: { start: 6, end: 7 }, offset: 2 }
  const selection = { kind: 'model-text' as const, anchor: point, focus: point }
  const action = { selection, range: selection, inputType: 'insertText', data: ')', options }
  const policy = core.planInput(previous, action)
  expect(policy.edits).toEqual([])
  expect(core.reconcileInput(previous, policy, null, action).selection).toEqual({ kind: 'model-text', anchor: 8, focus: 8 })
  expect(previous.source).toBe('  ```\n\t)body\n  ```\n')
})

it('wraps a mixed intrinsic selection without copying or replacing intervening annotation source', () => {
  const core = createDocumentCore()
  const prefix = '  ```\n\tbody\n  ```\n\n'
  const source = prefix + 'out{++side++}{>>keep<<}\n'
  const revision = core.open(source)
  const end = source.indexOf('{>>')
  const selection = { kind: 'model-text' as const, anchor: { text: { start: 6, end: 7 }, offset: 1 }, focus: end }
  const action = { selection, range: selection, inputType: 'insertText', data: '(', options }
  const plan = core.planInput(revision, action)
  expect(plan.edits).toEqual([{ start: 6, end: 7, insert: '   ( ' }, { start: end, end, insert: ')' }])
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(commit.revision.source).toBe('  ```\n   ( body\n  ```\n\nout{++side++}){>>keep<<}\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 10, focus: end + 4 }], primary: 0 })
})

it('keeps inherited fence indentation in both Markup substitution arms', () => {
  const core = createDocumentCore()
  const source = '  {~~```\n\tbody\n  ```\n~>```\n   ( )body\n  ```\n~~}'
  const revision = core.open(source)
  const codes = core.project(revision, 'markup').syntax.ast.root.children.filter(node => node.kind === 'code-block')
  expect(codes.map(node => node.attributes.content)).toEqual(['  body\n', ' ( )body\n'])
  expect(codes.map(node => node.children.filter(child => child.kind === 'text').map(child => child.attributes.semanticText).join(''))).toEqual(['  body', ' ( )body'])
  expect(core.project(revision, 'revised').markdown).toBe('  ```\n   ( )body\n  ```\n')
  expect(core.project(revision, 'original').markdown).toBe('  ```\n\tbody\n  ```\n')
  expect(revision.source).toBe(source)
})

it('keeps whitespace-only inline arms on their inherited paragraph', () => {
  const core = createDocumentCore()
  const source = '  {~~a~> ~~}tail\n'
  const revision = core.open(source)
  expect(core.project(revision, 'markup').syntax.ast.root.children.map(node => node.kind)).toEqual(['paragraph'])
  expect(core.project(revision, 'original').markdown).toBe('  atail\n')
  expect(core.project(revision, 'revised').markdown).toBe('   tail\n')
  expect(revision.source).toBe(source)
})
