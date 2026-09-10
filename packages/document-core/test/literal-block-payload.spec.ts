import { expect, it } from 'vitest'
import { createDocumentCore, projectModelTextSelection } from '../src/index.js'

it('exposes the normalized fenced-math payload as intrinsic literal text', () => {
  const core = createDocumentCore()
  const source = '  ```math\n\tx\n  ```\n'
  const revision = core.open(source, { gitLabMath: true })
  const syntax = core.project(revision, 'markup').syntax
  const math = syntax.ast.root.children[0]
  expect(math?.kind).toBe('math-block')
  expect(math?.attributes.content).toBe('  x\n')
  expect(math?.children.map(node => ({ kind: node.kind, range: node.range, text: node.attributes.semanticText }))).toEqual([
    { kind: 'text', range: { start: 10, end: 11 }, text: '  ' },
    { kind: 'text', range: { start: 11, end: 12 }, text: 'x' }
  ])
  expect(revision.source).toBe(source)
})

it('retains an ordinary code block when GitLab math is disabled', () => {
  const core = createDocumentCore()
  const revision = core.open('  ```math\n\tx\n  ```\n')
  const syntax = core.project(revision, 'markup').syntax
  expect(syntax.ast.root.children[0]?.kind).toBe('code-block')
  expect(syntax.ast.root.children[0]?.children.map(node => node.attributes.semanticText)).toEqual(['  ', 'x'])
})

it('uses the intrinsic math value for copy, no-op and one accepted input', () => {
  const core = createDocumentCore()
  const source = '  ```math\n\tx\n  ```\n'
  const revision = core.open(source, { gitLabMath: true })
  const point = { text: { start: 10, end: 11 }, offset: 1 }
  const selection = { kind: 'model-text' as const, anchor: point, focus: point }
  const copied = projectModelTextSelection(core, revision, { ...selection, focus: { ...point, offset: 2 } })
  expect(copied.markdown).toBe(' ')
  expect(copied.ast.root.children).toMatchObject([{ kind: 'paragraph', attributes: {}, children: [{ kind: 'text', attributes: { semanticText: ' ' } }] }])
  expect(core.planFormat(revision, { format: 'strong', selection, tracked: false })).toEqual({ edits: [], selection })
  const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
  const action = { selection, range: selection, inputType: 'insertText', data: 'y', options }
  const plan = core.planInput(revision, action)
  expect(plan.edits).toEqual([{ start: 10, end: 11, insert: '   y ' }])
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(commit.revision.source).toBe('  ```math\n   y x\n  ```\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 14, focus: 14 }], primary: 0 })
  expect(revision.source).toBe(source)
})

it.each([
  { name: 'diagram', source: '  ```mermaid\n\tgraph TD\n  ```\n', value: '  graph TD' },
  { name: 'dollar math', source: '$$\n  &amp;\\*{++x++}\n$$\n', value: '&amp;\\*{++x++}' },
  { name: 'front matter', source: '---\n  key: "&amp;\\*{++x++}"\n---\n', value: 'key: "&amp;\\*{++x++}"' },
  { name: 'HTML', source: '<div>\n\t&amp;\\*{++x++}\n</div>\n', value: '<div>\n\t&amp;\\*{++x++}\n</div>' },
  { name: 'quoted HTML', source: '> <div>\n> \t&amp;\\*{++x++}\n> </div>\n', value: '<div>\n  &amp;\\*{++x++}\n</div>' }
].flatMap(example => ['\n', '\r\n', '\r'].map(eol => ({ ...example, eol, source: example.source.replace(/\n/g, eol) }))))('exposes $name as literal children without decoding its payload, $eol', example => {
  const core = createDocumentCore()
  const revision = core.open(example.source)
  const first = core.project(revision, 'markup').syntax.ast.root.children[0]
  const literal = first?.kind === 'blockquote' ? first.children[0] : first
  expect(literal?.attributes.content).toBe(example.value + '\n')
  expect(literal?.children.map(node => node.kind === 'soft-break' ? '\n' : node.attributes.semanticText).join('')).toBe(example.value)
  expect(revision.source).toBe(example.source)
})

it.each([
  { source: '$$\n$$\n', kind: 'math-block', value: '' },
  { source: '```mermaid\n```\n', kind: 'diagram', value: '' },
  { source: '---\n---\n', kind: 'front-matter', value: '' },
  { source: '```mermaid\ngraph TD', kind: 'diagram', value: 'graph TD' },
  { source: '<div>\nx', kind: 'html-block', value: '<div>\nx' }
])('retains an editable literal payload for $source', example => {
  const core = createDocumentCore()
  const revision = core.open(example.source)
  const literal = core.project(revision, 'markup').syntax.ast.root.children[0]
  expect(literal?.kind).toBe(example.kind)
  expect(literal?.children.map(node => node.kind === 'soft-break' ? '\n' : node.attributes.semanticText).join('')).toBe(example.value)
  expect(literal?.children.some(node => node.kind === 'text')).toBe(true)
  expect(revision.source).toBe(example.source)
})

it('keeps unmatched dollar delimiters as ordinary Markdown', () => {
  const core = createDocumentCore()
  const revision = core.open('$$\nx')
  const paragraph = core.project(revision, 'markup').syntax.ast.root.children[0]
  expect(paragraph?.kind).toBe('paragraph')
  expect(paragraph?.children.map(node => node.kind === 'soft-break' ? '\n' : node.attributes.semanticText).join('')).toBe('$$\nx')
  expect(revision.source).toBe('$$\nx')
})
