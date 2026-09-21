import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

it('owns the authoring value and normalized spellings independently of standard fence info', () => {
  const core = createDocumentCore()
  const source = '```  j&#115; title=\\*  \nbody\n```\n'
  const node = core.project(core.open(source), 'revised').ast.root.children[0]!
  expect(node.attributes['semanticInfo']).toBe('js title=*')
  expect(node.attributes['infoInputValue']).toBe('  js title=*  ')
  expect(node.semanticTextSegments?.map(segment => ({ raw: source.slice(segment.range.start, segment.range.end), value: segment.value }))).toEqual([{ raw: '&#115;', value: 's' }, { raw: '\\*', value: '*' }])
})

it.each([
  { data: '&', expected: '\\&', visible: '&' },
  { data: '\\', expected: '\\\\', visible: '\\' },
  { data: '`', expected: '&#96;', visible: '`' },
  { data: ' ', expected: ' ', visible: ' ' },
  { data: 'a\r\nb', expected: 'a b', visible: 'a b' }
])('direct code info input preserves its authored value for $data', ({ data, expected, visible }) => {
  const core = createDocumentCore()
  const source = '```js\nbody\n```\n'
  const revision = core.open(source)
  const selection = { kind: 'model-text' as const, anchor: 5, focus: 5 }
  const plan = core.planInput(revision, { selection, range: selection, inputType: 'insertFromPaste', data, options: { autoPairBracket: false, autoPairMarkdownSyntax: false, autoPairQuote: false } })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe('```js' + expected + '\nbody\n```\n')
  expect(core.project(next, 'revised').ast.root.children[0]!.attributes['infoInputValue']).toBe('js' + visible)
})

it('clamps a collapsed browser deletion to the info value before the body newline', () => {
  const core = createDocumentCore()
  const revision = core.open('```js\nbody\n```\n')
  const plan = core.planInput(revision, { selection: { kind: 'model-text', anchor: 4, focus: 4 }, range: { start: 4, end: 8 }, inputType: 'deleteHardLineForward', data: null, options: { autoPairBracket: false, autoPairMarkdownSyntax: false, autoPairQuote: false } })
  expect(core.apply(revision, plan.edits).revision.source).toBe('```j\nbody\n```\n')
})
