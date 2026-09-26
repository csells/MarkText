import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

it.each([
  { name: 'math', source: '$$\na\n$$\n\nb{++c++}d{>>note<<}\n', expected: '$$\nab{++c++}d{>>note<<}\n$$\n', original: '$$\na\n$$\n\nbd\n', revised: '$$\nab{++c++}d{>>note<<}\n$$\n', caret: 4 },
  { name: 'diagram', source: '```mermaid\na\n```\n\nb{++c++}d{>>note<<}\n', expected: '```mermaid\nab{++c++}d{>>note<<}\n```\n', original: '```mermaid\na\n```\n\nbd\n', revised: '```mermaid\nab{++c++}d{>>note<<}\n```\n', caret: 12 },
  { name: 'front matter', source: '---\na\n---\n\nb{++c++}d{>>note<<}\n', expected: '---\nab{++c++}d{>>note<<}\n---\n', original: '---\na\n---\n\nbd\n', revised: '---\nab{++c++}d{>>note<<}\n---\n', caret: 5 },
  { name: 'HTML', source: '<div>a</div>\n\nb{++c++}d{>>note<<}\n', expected: '<div>a</div>b{++c++}d{>>note<<}\n', original: '<div>a</div>\n\nbd\n', revised: '<div>a</div>b{++c++}d{>>note<<}\n', caret: 12 },
  { name: 'table', source: '| h |\n|---|\n| a |\n\nb{++c++}d{>>note<<}\n', expected: '| h |\n|---|\n| ab{++c++}d{>>note<<} |\n', original: '| h |\n|---|\n| a |\n\nbd\n', revised: '| h |\n|---|\n| abcd |\n', caret: 15 }
].flatMap(example => [false, true].map(tracked => ({ ...example, tracked }))))('preserves $name semantics when joining annotated text (tracked=$tracked)', example => {
  const suffix = '\noutside{>>keep<<}\n'
  const core = createDocumentCore()
  const revision = core.open(example.source + suffix)
  const at = example.source.indexOf('b{++')
  const action: DocumentInputAction = { kind: 'command', command: 'joinParagraphBackward', selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, example.tracked)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  if (!example.tracked) expect(commit.revision.source).toBe(example.expected + suffix)
  else expect(core.project(commit.revision, 'original').markdown).toBe(example.original + '\noutside\n')
  expect(core.project(commit.revision, 'revised').markdown).toBe(example.revised + '\noutside\n')
  const result = core.reconcileInput(revision, plan, commit, action)
  expect(result.selection).toBeDefined()
  expect(commit.revision.source.endsWith('outside{>>keep<<}\n')).toBe(true)
  expect(core.open(commit.revision.source).source).toBe(commit.revision.source)
})

it.each([
  { name: 'a thematic break', source: '***\n\nb{++c++}d\n', expected: '***b{++c++}d\n', caret: 3 },
  { name: 'pipe spelling', source: '| h |\n|---|\n| a |\n\nb|c\n', expected: '| h |\n|---|\n| ab\\|c |\n', caret: 15 },
  { name: 'multiple soft lines', source: '| h |\n|---|\n| a |\n\nb\nc\n', expected: '| h |\n|---|\n| ab<br/>c |\n', caret: 15 },
  { name: 'a hard break', source: '| h |\n|---|\n| a |\n\nb\\\nc\n', expected: '| h |\n|---|\n| ab<br/>c |\n', caret: 15 },
  { name: 'a multiline hidden comment', source: '| h |\n|---|\n| a |\n\nb{>>multi\nline<<}c\nz\n', expected: '| h |\n|---|\n| ab{>>multi\nline<<}c<br/>z |\n', caret: 15 },
  { name: 'implicit final cell', source: '| a | b |\n|---|---|\n| c |\n\nd\n', expected: '| a | b |\n|---|---|\n| c | d |\n', caret: 26 }
])('joins a paragraph with $name', example => {
  const core = createDocumentCore()
  const revision = core.open(example.source)
  const at = example.source.lastIndexOf('\n\n') + 2
  const action: DocumentInputAction = { kind: 'command', command: 'joinParagraphBackward', selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  expect(commit.revision.source).toBe(example.expected)
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: example.caret, focus: example.caret }], primary: 0 })
})

it.each([
  { source: '> b{++c++}d\n', expected: 'b{++c++}d\n', after: 0 },
  { source: '> b{++c++}d\n> next\n>\n> tail\n', expected: 'b{++c++}d\nnext\n\n> tail\n', after: 0 },
  { source: '> > b{++c++}d\n> >\n> > tail\n', expected: '> b{++c++}d\n> \n> > tail\n', after: 2 },
  { source: '- > b{++c++}d\n  >\n  > tail\n', expected: '- b{++c++}d\n  \n  > tail\n', after: 2 }
].flatMap(example => ['\n', '\r\n', '\r'].map(ending => ({ ...example, ending }))))('unwraps the current quote paragraph without changing siblings: $source ($ending)', example => {
  const core = createDocumentCore()
  const source = example.source.replaceAll('\n', example.ending)
  const revision = core.open(source)
  const at = source.indexOf('b{++')
  const action: DocumentInputAction = { kind: 'command', command: 'joinParagraphBackward', selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits!)
  expect(commit.revision.source).toBe(example.expected.replaceAll('\n', example.ending))
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: example.after, focus: example.after }], primary: 0 })
})
