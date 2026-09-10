import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

it.each(['plain', 'plain\nsecond'].flatMap(text => [false, true].map(tracked => ({ text, tracked }))))('quotes a complete addition without rewriting its owned paragraph ($text tracked=$tracked)', ({ text, tracked }) => {
  const core = createDocumentCore()
  const previous = core.open(`{++${text}++}\n`)
  const caret = 3 + text.length
  const action: DocumentInputAction = { kind: 'command', command: 'changeBlockquote', change: { type: 'toggle' }, selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 }, options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true } }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, tracked)
  if (edits === undefined) throw new Error('Expected quote command')
  const commit = core.apply(previous, edits)
  expect(commit.revision.source).toBe(tracked ? `{++> ${text}++}\n` : `> {++${text}++}\n`)
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: caret + 2, focus: caret + 2 }], primary: 0 })
  expect(core.project(commit.revision, 'markup').syntax.ast.root.children[0]?.kind).toBe('blockquote')
})

it.each([
  { change: 'quick-insert', source: '', caret: 0, expected: '> ', after: 2 },
  { change: 'set', source: 'a{++a++}a\n\noutside{>>keep<<}\n', caret: 9, expected: '> a{++a++}a\n\noutside{>>keep<<}\n', after: 11 },
  { change: 'set', source: 'a{>>inside\ncomment<<}b\r\nc\r\n', caret: 24, expected: '> a{>>inside\ncomment<<}b\r\n> c\r\n', after: 28 },
  { change: 'set', source: 'a{++a\nb++}c\n\noutside{>>keep<<}\n', caret: 11, expected: '> a{++a\n> b++}c\n\noutside{>>keep<<}\n', after: 15 },
  { change: 'quick-insert', source: '/qu{++o++}te\n\noutside{>>keep<<}\n', caret: 12, expected: '> \n\noutside{>>keep<<}\n', after: 2 },
  { change: 'quick-insert', source: '/qu{>>inside<<}ote\n\noutside{>>keep<<}\n', caret: 18, expected: '> \n\noutside{>>keep<<}\n', after: 2 }
] as const)('owns the paragraph for blockquote $change: $source', ({ change, source, caret, expected, after }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'changeBlockquote',
    change: { type: change },
    selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
    options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits!)
  expect(commit.revision.source).toBe(expected)
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: after, focus: after }], primary: 0 })
  expect(core.project(commit.revision, 'markup').syntax.ast.root.children[0]?.kind).toBe('blockquote')
  expect(core.open(commit.revision.source).source).toBe(expected)
})

it.each([
  { change: 'set', source: 'a{++a++}a', expected: '{++> ++}a{++a++}a', after: 17, original: 'aa' },
  { change: 'quick-insert', source: '/qu{++o++}te', expected: '{~~/qu{++o++}te~>> ~~}', after: 19, original: '/qute' },
  { change: 'quick-insert', source: '/qu{++o++}t{++e++}', expected: '{~~/qu{++o++}t{++e++}~>> ~~}', after: 25, original: '/qut' },
  { change: 'quick-insert', source: '/qu{>>inside<<}ote', expected: '{~~/qu{>>inside<<}ote~>> ~~}', after: 25, original: '/quote' }
] as const)('tracks blockquote $change without losing existing review ownership: $source', ({ change, source, expected, after, original }) => {
  const tail = '\n\noutside{>>keep<<}\n'
  const core = createDocumentCore()
  const previous = core.open(source + tail)
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'changeBlockquote',
    change: { type: change },
    selection: { ranges: [{ anchor: source.length, focus: source.length }], primary: 0 },
    options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, true)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits!)
  expect(commit.revision.source).toBe(expected + tail)
  expect(core.project(commit.revision, 'original').markdown).toBe(original + '\n\noutside\n')
  expect(core.project(commit.revision, 'revised').markdown).toBe((change === 'set' ? '> aaa' : '> ') + '\n\noutside\n')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: after, focus: after }], primary: 0 })
  if (change === 'quick-insert') {
    const suggestion = commit.revision.annotations.find(annotation => annotation.kind === 'substitution')!
    expect(core.resolve(commit.revision, suggestion, 'reject').revision.source).toBe(previous.source)
  }
})

it('toggles the owned quote while retaining the second identical child selection', () => {
  const core = createDocumentCore()
  const source = '> a{++a++}a\n>\n> a{++a++}a\n\noutside{>>keep<<}\n'
  const previous = core.open(source)
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'changeBlockquote',
    change: { type: 'toggle' },
    selection: { ranges: [{ anchor: 17, focus: 17 }], primary: 0 },
    options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits!)
  expect(commit.revision.source).toBe('a{++a++}a\n\na{++a++}a\n\noutside{>>keep<<}\n')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 12, focus: 12 }], primary: 0 })
})

it.each([
  { source: '> first\n>\n> > inner\n', at: 3, expected: 'first\n\n> inner\n', after: 1 },
  { source: '> first\n>\n> > inner\n', at: 17, expected: 'first\n\ninner\n', after: 10 },
  { source: '> first\nlazy\n> next\n', at: 3, expected: 'first\nlazy\nnext\n', after: 1 },
  { source: '> - first\n>   > inner\n', at: 19, expected: '- first\n  inner\n', after: 13 }
])('unwraps only selected quote ancestors and literal prefixes: $source', ({ source, at, expected, after }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const action: DocumentInputAction = { kind: 'command', command: 'changeBlockquote', change: { type: 'toggle' }, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true } }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits!)
  expect(commit.revision.source).toBe(expected)
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: after, focus: after }], primary: 0 })
})

it('preserves a backward cross-paragraph quote command selection', () => {
  const core = createDocumentCore()
  const previous = core.open('a{++a++}a\n\na{++a++}a\n')
  const action: DocumentInputAction = { kind: 'command', command: 'changeBlockquote', change: { type: 'toggle' }, selection: { ranges: [{ anchor: 19, focus: 1 }], primary: 0 }, options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true } }
  const plan = core.planInput(previous, action)
  const commit = core.apply(previous, core.inputEdits(previous, action, plan, false)!)
  expect(commit.revision.source).toBe('> a{++a++}a\n>\n> a{++a++}a\n')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 25, focus: 2 }], primary: 0 })
})
