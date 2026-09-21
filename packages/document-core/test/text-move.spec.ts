import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }

it.each([
  { source: 'same same end\n', from: 5, end: 9, to: 0, expected: 'samesame  end\n', caret: 4 },
  { source: 'same same end\n', from: 0, end: 4, to: 13, expected: ' same endsame\n', caret: 13 },
  { source: 'same {++same++} end{>>keep<<}\n', from: 8, end: 12, to: 0, expected: '{++same++}same  end{>>keep<<}\n', caret: 10 },
  { source: 'same {++same++} end{>>keep<<}\n', from: 9, end: 11, to: 0, expected: '{++am++}same {++se++} end{>>keep<<}\n', caret: 8 },
  { source: 'same {~~old~>new~~} end\n', from: 13, end: 16, to: 0, expected: '{~~~>new~~}same {~~old~>~~} end\n', caret: 11 },
  { source: 'A{++bc++}D E\n', from: 5, end: 10, to: 12, expected: 'A{++b++} E{++c++}D\n', caret: 18 }
])('moves the actual selected text with its annotation context: $source ($from)', example => {
  const core = createDocumentCore()
  const revision = core.open(example.source)
  const action: DocumentInputAction = { kind: 'command', command: 'moveText', selection: { ranges: [{ anchor: example.end, focus: example.from }], primary: 0 }, target: { start: example.to, end: example.to }, copy: false, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  expect(commit.revision.source).toBe(example.expected)
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: example.caret, focus: example.caret }], primary: 0 })
  expect(core.open(commit.revision.source).source).toBe(example.expected)
})

it.each([false, true])('tracks the actual move/copy without changing Original (copy=%s)', copy => {
  const core = createDocumentCore()
  const source = 'one two end\n'
  const revision = core.open(source)
  const action: DocumentInputAction = { kind: 'command', command: 'moveText', selection: { ranges: [{ anchor: 4, focus: 7 }], primary: 0 }, target: { start: 0, end: 0 }, copy, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, true)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  expect(core.project(commit.revision, 'original').markdown).toBe(source)
  expect(core.project(commit.revision, 'revised').markdown).toBe(copy ? 'twoone two end\n' : 'twoone  end\n')
  const selection = core.reconcileInput(revision, plan, commit, action).selection
  expect(selection).toBeDefined()
  if (selection === undefined || !('ranges' in selection)) throw new Error('Expected moved text caret')
  const point = selection.ranges[selection.primary]!
  const typing: DocumentInputAction = { selection, range: { start: point.anchor, end: point.focus }, inputType: 'insertText', data: 'X', options }
  const nextPlan = core.planInput(commit.revision, typing)
  const next = core.apply(commit.revision, core.inputEdits(commit.revision, typing, nextPlan, true)!)
  expect(core.project(next.revision, 'original').markdown).toBe(source)
  expect(core.project(next.revision, 'revised').markdown).toBe(copy ? 'twoXone two end\n' : 'twoXone  end\n')
})

it.each([false, true])('moves or copies an intrinsic selection within its own value (copy=%s)', copy => {
  const core = createDocumentCore()
  const revision = core.open('A&fjlig;B tail\n')
  const text = { start: 0, end: 14 }
  const action: DocumentInputAction = { kind: 'command', command: 'moveText', selection: { kind: 'model-text', anchor: { text, offset: 1 }, focus: { text, offset: 2 } }, target: { kind: 'model-text', anchor: { text, offset: 3 }, focus: { text, offset: 3 } }, copy, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  expect(commit.revision.source).toBe(copy ? 'AfjfB tail\n' : 'AjfB tail\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: copy ? 4 : 3, focus: copy ? 4 : 3 }], primary: 0 })
})

it('moves into an intrinsic value without duplicating its source spelling', () => {
  const core = createDocumentCore()
  const revision = core.open('A\n\n&fjlig;B tail\n')
  const point = { text: { start: 3, end: 16 }, offset: 1 }
  const action: DocumentInputAction = { kind: 'command', command: 'moveText', selection: { ranges: [{ anchor: 0, focus: 1 }], primary: 0 }, target: { kind: 'model-text', anchor: point, focus: point }, copy: false, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  expect(commit.revision.source).toBe('\n\nfAjB tail\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 4, focus: 4 }], primary: 0 })
})

it.each([false, true])('moves literal text beside a shared normalized endpoint (copy=%s)', copy => {
  const core = createDocumentCore()
  const revision = core.open('  ```\n\tx\n  ```\n')
  const text = { start: 6, end: 7 }
  const action: DocumentInputAction = { kind: 'command', command: 'moveText', selection: { kind: 'model-text', anchor: { text, offset: 1 }, focus: 8 }, target: { kind: 'model-text', anchor: { text, offset: 0 }, focus: { text, offset: 0 } }, copy, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  expect(commit.revision.source).toBe(copy ? '  ```\n   x  x\n  ```\n' : '  ```\n   x \n  ```\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 10, focus: 10 }], primary: 0 })
})

it('moves literal payload within its surrounding suggestion without inserting literal CM delimiters', () => {
  const core = createDocumentCore()
  const revision = core.open('{++```\nword tail\n```++}\n')
  const action: DocumentInputAction = { kind: 'command', command: 'moveText', selection: { ranges: [{ anchor: 7, focus: 11 }], primary: 0 }, target: { start: 16, end: 16 }, copy: false, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  expect(commit.revision.source).toBe('{++```\n tailword\n```++}\n')
})

it('retains the tracked move caret when deleting a complete pending addition', () => {
  const core = createDocumentCore()
  const revision = core.open('one {++two++} end\n')
  const action: DocumentInputAction = { kind: 'command', command: 'moveText', selection: { ranges: [{ anchor: 7, focus: 10 }], primary: 0 }, target: { start: 0, end: 0 }, copy: false, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, true)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  expect(commit.revision.source).toBe('{++{++two++}++}one  end\n')
  expect(core.project(commit.revision, 'original').markdown).toBe('one  end\n')
  expect(core.project(commit.revision, 'revised').markdown).toBe('twoone  end\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 12, focus: 12 }], primary: 0 })
})

it('keeps an intrinsic spelling address relative to its own entity', () => {
  const core = createDocumentCore()
  const revision = core.open('A&fjlig;B{>>keep<<} end\n')
  const text = { start: 1, end: 8 }
  const action: DocumentInputAction = { kind: 'command', command: 'moveText', copy: false, options, selection: { kind: 'model-text', anchor: { text, offset: 0 }, focus: { text, offset: 1 } }, target: { kind: 'model-text', anchor: { text, offset: 2 }, focus: { text, offset: 2 } } }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  expect(commit.revision.source).toBe('AjfB{>>keep<<} end\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 3, focus: 3 }], primary: 0 })
})

it.each([false, true])('retains CRLF while spelling multiline literal movement at its target once (copy=%s)', copy => {
  const core = createDocumentCore()
  const source = '  ```\r\n\tone\r\n  two\r\n  three\r\n  ```\r\n'
  const revision = core.open(source)
  const from = source.indexOf('two')
  const end = source.indexOf('three') + 5
  const tab = source.indexOf('\t')
  const point = { text: { start: tab, end: tab + 1 }, offset: 1 }
  const action: DocumentInputAction = { kind: 'command', command: 'moveText', copy, options, selection: { ranges: [{ anchor: end, focus: from }], primary: 0 }, target: { kind: 'model-text', anchor: point, focus: point } }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  const expected = copy ? '  ```\r\n   two\r\n  three one\r\n  two\r\n  three\r\n  ```\r\n' : '  ```\r\n   two\r\n  three one\r\n  \r\n  ```\r\n'
  expect(commit.revision.source).toBe(expected)
  const caret = expected.indexOf(' one')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
})
