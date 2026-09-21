import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }

it.each([
  { source: 'A{++&fjlig;++}B end\n', copy: false, expected: 'A{++jf++}B end\n', caret: 6 },
  { source: 'A{++&fjlig;++}B end\n', copy: true, expected: 'A{++fjf++}B end\n', caret: 7 },
  { source: 'A&fjlig;{++B++} end\n', copy: false, expected: 'Ajf{++B++} end\n', caret: 3 },
  { source: 'A&fjlig;{++B++} end\n', copy: true, expected: 'Afjf{++B++} end\n', caret: 4 },
  { source: 'A&fjlig;B{>>keep<<} end\n', copy: false, expected: 'AjfB{>>keep<<} end\n', caret: 3 },
  { source: 'A&fjlig;B{>>keep<<} end\n', copy: true, expected: 'AfjfB{>>keep<<} end\n', caret: 4 }
])('retains owned annotation and comment source during normalized text movement: $source (copy=$copy)', ({ source, copy, expected, caret }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  // The parser owns one semantic text value across the entity and elided CM.
  // A request using that valid wide address must preserve unrelated carriers.
  const text = { start: 0, end: source.length - 1 }
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'moveText',
    copy,
    options,
    selection: { kind: 'model-text', anchor: { text, offset: 1 }, focus: { text, offset: 2 } },
    target: { kind: 'model-text', anchor: { text, offset: 3 }, focus: { text, offset: 3 } }
  }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  if (edits === undefined) throw new Error('Expected owned text movement')
  const commit = core.apply(revision, edits)
  expect(commit.revision.source).toBe(expected)
  const selection = { ranges: [{ anchor: caret, focus: caret }], primary: 0 }
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual(selection)
  const typing: DocumentInputAction = { selection, range: { start: caret, end: caret }, inputType: 'insertText', data: 'X', options }
  const typedPlan = core.planInput(commit.revision, typing)
  const typedEdits = core.inputEdits(commit.revision, typing, typedPlan, false)
  expect(typedEdits).toBeDefined()
  if (typedEdits === undefined) throw new Error('Expected typing after text movement')
  const typed = core.apply(commit.revision, typedEdits)
  const expectedTyped = expected.slice(0, caret) + 'X' + expected.slice(caret)
  expect(typed.revision.source).toBe(expectedTyped)
  expect(core.open(expectedTyped).source).toBe(expectedTyped)
})

it.each([false, true])('spells a multiline literal payload once at a normalized target (copy=%s)', copy => {
  const core = createDocumentCore()
  const source = '  ```\n\tone\n  two\n  three\n  ```\n'
  const expected = copy ? '  ```\n   two\n  three one\n  two\n  three\n  ```\n' : '  ```\n   two\n  three one\n  \n  ```\n'
  const revision = core.open(source)
  const point = { text: { start: 6, end: 7 }, offset: 1 }
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'moveText',
    copy,
    options,
    selection: { ranges: [{ anchor: 13, focus: 24 }], primary: 0 },
    target: { kind: 'model-text', anchor: point, focus: point }
  }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  if (edits === undefined) throw new Error('Expected owned literal movement')
  const commit = core.apply(revision, edits)
  expect(commit.revision.source).toBe(expected)
  expect(core.project(commit.revision, 'markup').syntax.ast.root.children[0]?.attributes.content).toBe(copy ? ' two\nthree one\ntwo\nthree\n' : ' two\nthree one\n\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 20, focus: 20 }], primary: 0 })
  expect(core.open(expected).source).toBe(expected)
})
