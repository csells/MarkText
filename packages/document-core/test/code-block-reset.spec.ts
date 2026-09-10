import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

it('resets owned code fences while preserving the next-key selection', () => {
  const core = createDocumentCore()
  const previous = core.open('```\ncode here\n```\n')
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'resetCodeBlock',
    selectionMode: 'preserve',
    selection: { ranges: [{ anchor: 6, focus: 6 }], primary: 0 },
    options
  }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  expect(plan.edits).toEqual([{ start: 0, end: 4, insert: '' }, { start: 13, end: 17, insert: '' }])
  expect(edits).toEqual([{ start: 0, end: 18, insert: 'code here\n' }])
  const commit = core.apply(previous, edits ?? [])
  expect(commit.revision.source).toBe('code here\n')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 2, focus: 2 }], primary: 0 })
  expect(core.apply(commit.revision, [{ start: 2, end: 2, insert: 'x' }]).revision.source).toBe('coxde here\n')
})

it.each([
  { source: '    aa\n      bb\n', expected: 'aa\n  bb\n', at: 5, caret: 1 },
  { source: '> ```\n> aa\n> bb\n> ```\n', expected: '> aa\n> bb\n', at: 9, caret: 3 },
  { source: '- ```\n  aa\n  bb\n  ```\n- tail\n', expected: '- aa\n  bb\n- tail\n', at: 9, caret: 3 },
  { source: '  ```\n  aa\n    bb\n  ```\n', expected: 'aa\n  bb\n', at: 9, caret: 1 }
])('resets code indentation and containers from the owned payload: $source', ({ source, expected, at, caret }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'resetCodeBlock',
    selectionMode: 'preserve',
    selection: { ranges: [{ anchor: at, focus: at }], primary: 0 },
    options
  }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits ?? [])
  expect(commit.revision.source).toBe(expected)
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
})

it.each([
  { source: '```\n&amp; \\* {++literal++}\n```\n', payload: '&amp; \\* {++literal++}' },
  { source: '  ```\n\taa\n  ```\n', payload: '  aa' },
  { source: '> ```\r\n> aa\r\n> bb\r\n> ```\r\n', payload: 'aa\nbb' },
  { source: '```\n```\n', payload: '' }
])('owns literal payload text and exact source ranges: $source', ({ source, payload }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const syntax = core.project(revision, 'markup').syntax
  const all = (node: typeof syntax.ast.root): readonly typeof syntax.ast.root[] => [node, ...node.children.flatMap(all)]
  const code = all(syntax.ast.root).find(node => node.kind === 'code-block')
  expect(code).toBeDefined()
  expect(code?.children.map(node => node.kind === 'soft-break' ? '\n' : node.attributes.semanticText).join('')).toBe(payload)
  expect(code?.children.every(node => node.kind === 'text' || node.kind === 'soft-break')).toBe(true)
  for (const node of code?.children ?? []) {
    expect(node.range.start).toBeLessThanOrEqual(node.range.end)
    expect(node.range.start).toBeGreaterThanOrEqual(code?.range.start ?? 0)
    expect(node.range.end).toBeLessThanOrEqual(code?.range.end ?? 0)
  }
  expect(revision.source).toBe(source)
})

for (const ending of ['\n', '\r\n', '\r']) {
  for (const example of [
    { source: '```\n\n```\n', expected: '\n', at: 4 },
    { source: '```\n```\n', expected: '\n', at: 4 },
    { source: '```\naa', expected: 'aa', at: 5 },
    { source: '```\naa\n', expected: 'aa\n', at: 5 },
    { source: '  ```\n\taa\n  ```\n', expected: '  aa\n', at: 8 },
    { source: '    aa\n\n    bb\n', expected: 'aa\n\nbb\n', at: 5 },
    { source: '>     aa\n>     bb\n', expected: '> aa\n> bb\n', at: 7 },
    { source: '```\n&amp; \\* {++literal++}\n```\n', expected: '&amp; \\* {++literal++}\n', at: 4 },
    { source: '{++```\naa\n```++}\n', expected: '{++aa++}\n', at: 8 }
  ]) {
    it(`retains reset payload bytes and EOL (${JSON.stringify(ending)}): ${JSON.stringify(example.source)}`, () => {
      const eol = (text: string) => text.replaceAll('\n', ending)
      const core = createDocumentCore()
      const revision = core.open(eol(example.source))
      const at = eol(example.source.slice(0, example.at)).length
      const action: DocumentInputAction = { kind: 'command', command: 'resetCodeBlock', selectionMode: 'end', selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options }
      const plan = core.planInput(revision, action)
      const edits = core.inputEdits(revision, action, plan, false)
      expect(edits).toBeDefined()
      const commit = core.apply(revision, edits ?? [])
      expect(commit.revision.source).toBe(eol(example.expected))
      const selection = core.reconcileInput(revision, plan, commit, action).selection
      if (selection === undefined || !('ranges' in selection)) throw new Error('Expected text selection after reset')
      const caret = selection.ranges[0]?.anchor
      if (caret === undefined) throw new Error('Missing reset caret')
      const expectedCaret = eol(example.expected).length - (example.expected.endsWith('\n') ? ending.length : 0) - (example.expected.includes('{++aa++}') ? 3 : 0)
      expect(caret).toBe(expectedCaret)
      expect(selection.ranges[0]?.focus).toBe(expectedCaret)
      const next = core.apply(commit.revision, [{ start: caret, end: caret, insert: 'x' }]).revision
      expect(next.source).toBe(commit.revision.source.slice(0, caret) + 'x' + commit.revision.source.slice(caret))
    })
  }
  for (const example of [
    { source: '```\naa\n```\n', expected: 'aa\n', at: 5 },
    { source: '> ```\n> aa\n> bb\n> ```\n', expected: '> aa\n> bb\n', at: 9 },
    { source: '    aa\n    bb\n', expected: 'aa\nbb\n', at: 5 }
  ]) {
    it(`tracks reset source and reader projections (${JSON.stringify(ending)}): ${JSON.stringify(example.source)}`, () => {
      const eol = (text: string) => text.replaceAll('\n', ending)
      const core = createDocumentCore()
      const revision = core.open(eol(example.source))
      const at = eol(example.source.slice(0, example.at)).length
      const action: DocumentInputAction = { kind: 'command', command: 'resetCodeBlock', selectionMode: 'preserve', selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options }
      const plan = core.planInput(revision, action)
      const edits = core.inputEdits(revision, action, plan, true)
      expect(edits).toBeDefined()
      const commit = core.apply(revision, edits ?? [])
      expect(core.project(commit.revision, 'original').markdown).toBe(eol(example.source))
      const revised = core.project(commit.revision, 'revised')
      expect(revised.markdown).toBe(eol(example.expected))
      const selection = core.reconcileInput(revision, plan, commit, action).selection
      const caret = revised.coordinates.toSource(eol(example.expected.slice(0, example.expected.indexOf('aa') + 1)).length, 'next')
      expect(selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
      if (example.source === '```\naa\n```\n') expect(commit.revision.source).toBe(eol('{~~```\naa\n```\n~>aa\n~~}'))
    })
  }
}
