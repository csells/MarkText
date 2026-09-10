import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const table = '|     |     |\n| --- | --- |\n|     |     |'

it.each([
  { source: '/ta{++b++}le\n\noutside{>>keep<<}\n', at: 12, replace: true, expected: table + '\n\noutside{>>keep<<}\n', first: 6 },
  { source: '', at: 0, replace: false, expected: table, first: 6 },
  { source: '# \n', at: 2, replace: false, expected: table + '\n', first: 6 },
  { source: '# {>>keep<<}\n', at: 2, replace: false, expected: '# {>>keep<<}\n\n' + table + '\n', first: 20 },
  ...['\n', '\r\n', '\r'].flatMap(eol => [
    ['```md', 'a{++a++}a', '```'].join(eol) + eol,
    '<div>a{++a++}a</div>' + eol
  ].map(source => ({ source, at: source.indexOf('a{'), replace: false, expected: source + eol + table.replace(/\n/gu, eol) + eol, first: source.length + eol.length + 6 }))),
  { source: 'hello{>>keep<<}\n', at: 2, replace: false, expected: 'hello{>>keep<<}\n\n' + table + '\n', first: 23 },
  { source: '- item text\n', at: 5, replace: false, expected: '- item text\n\n  |     |     |\n  | --- | --- |\n  |     |     |\n', first: 21 }
])('creates the owned table at the native insertion boundary: $source', ({ source, at, replace, expected, first }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const action: DocumentInputAction = { kind: 'command', command: 'createTable', rows: 2, columns: 2, replace, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true } }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits!)
  expect(commit.revision.source).toBe(expected)
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: first, focus: first }], primary: 0 })
})
