import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type MarkdownAstNode } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

/** Applies one action and returns the resulting source and collapsed caret. */
const apply = (source: string, action: DocumentInputAction): { source: string, caret: number } => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  if (edits === undefined) throw new Error('Expected untracked edits')
  const commit = core.apply(previous, edits)
  const selection = core.reconcileInput(previous, plan, commit, action).selection
  if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a text selection')
  const range = selection.ranges[selection.primary]
  expect(range?.anchor).toBe(range?.focus)
  return { source: commit.revision.source, caret: range?.anchor ?? -1 }
}

const caret = (at: number) => ({ ranges: [{ anchor: at, focus: at }], primary: 0 })
const backspace = (at: number): DocumentInputAction => ({ selection: caret(at), range: { start: at - 1, end: at }, inputType: 'deleteContentBackward', data: null, options })
const deleteForward = (at: number): DocumentInputAction => ({ selection: caret(at), range: { start: at, end: at + 1 }, inputType: 'deleteContentForward', data: null, options })
const type = (at: number, data: string): DocumentInputAction => ({ selection: caret(at), range: { start: at, end: at }, inputType: 'insertText', data, options })
// Command shapes are checked by planning itself.
const command = (at: number, action: Record<string, unknown>) => ({ kind: 'command', selection: caret(at), options, ...action }) as unknown as DocumentInputAction

const editingBlocks = (source: string): string[] => {
  const core = createDocumentCore()
  const names: string[] = []
  const visit = (node: MarkdownAstNode): void => {
    if (node.kind !== 'document') names.push(`${node.kind}@${node.range.start}`)
    node.children.filter(child => !['text', 'soft-break', 'hard-break'].includes(child.kind)).forEach(visit)
  }
  visit(core.project(core.open(source), 'markup').syntax.ast.root)
  return names
}

// Expected bytes and carets are upstream MarkText's (8d6c198c), except where
// untouched bytes, such as a missing final line ending, are kept.
describe('emptied paragraphs keep upstream separation', () => {
  it.each([
    ['***\na', backspace(5), '***\n\n\n', 5],
    ['***\na\n', deleteForward(4), '***\n\n\n', 5],
    ['# h\na\n# j\n', backspace(5), '# h\n\n\n\n# j\n', 5],
    ['x\n\na', backspace(4), 'x\n\n\n', 3],
    ['a\n# h\n', backspace(1), '\n\n# h\n', 0],
    ['a\r\n# h\r\n', backspace(1), '\r\n\r\n# h\r\n', 0],
    ['> x\n> # h\n> a\n', backspace(13), '> x\n> # h\n>\n> \n', 14],
    ['x\n\na\n\ny\n', backspace(4), 'x\n\n\n\ny\n', 3],
    ['> x\n> # h\n', backspace(3), '> \n>\n> # h\n', 2],
    ['# h\n> x\n> # j\n', backspace(7), '# h\n> \n>\n> # j\n', 6]
  ])('%j', (source, action, expected, at) => {
    expect(apply(source, action)).toEqual({ source: expected, caret: at })
    expect(editingBlocks(expected).filter(block => block === `paragraph@${at}`)).toHaveLength(1)
  })

  it('writes a reset thematic break after a fence as that empty paragraph', () => {
    const reset = command(12, { command: 'changeThematicBreak', change: { type: 'reset' } })
    expect(apply('```js\na\n```\n---\n', reset)).toEqual({ source: '```js\na\n```\n\n\n', caret: 13 })
  })
})

describe('an emptied setext heading', () => {
  it('keeps its underline after its text is deleted', () => {
    expect(apply('a\n---', backspace(1))).toEqual({ source: '\n---', caret: 0 })
  })

  it.each([
    ['\n---\n', '\n'],
    ['\n---\nb\n', '\n\nb\n'],
    ['x\n\n\n---\n', 'x\n\n\n']
  ])('becomes an empty paragraph on Backspace at %j', (source, expected) => {
    const at = source.indexOf('---') - 1
    const reset = command(at, { command: 'changeBlock', change: { type: 'reset', scope: 'leaf', selectionMode: 'preserve' } })
    expect(apply(source, reset)).toEqual({ source: expected, caret: at })
  })

  it('becomes an empty paragraph on Enter', () => {
    const enter = { selection: caret(0), range: { start: 0, end: 0 }, inputType: 'insertParagraph', data: '\n', options }
    expect(apply('\n---\n', enter)).toEqual({ source: '\n', caret: 0 })
  })
})

describe('thematic break text', () => {
  it.each([
    ['- - -', deleteForward(0), '- -', 2],
    ['- - -', backspace(5), '- - ', 2],
    ['- - -', type(5, 'x'), '- - -x', 2],
    ['***', backspace(2), '*', 1],
    ['***', backspace(1), '*', 0]
  ])('%j is re-read as upstream re-reads a paragraph', (source, action, expected, at) => {
    expect(apply(source, action)).toEqual({ source: expected, caret: at })
  })

  it('moves a typed key after a lone quote marker past its space', () => {
    expect(apply('>', type(1, 'z'))).toEqual({ source: '> z', caret: 3 })
  })
})

describe('indented code', () => {
  it.each([
    ['    indented\n', 'js', 1, '```js\nindented\n```\n', 4],
    ['    a\n\n    b\n', 'j', 1, '```j\na\n\nb\n```\n', 4],
    ['- x\n\n      code\n', 'j', 1, '- x\n\n  ```j\n  code\n  ```\n', 11],
    ['>     code\n', 'j', 1, '> ```j\n> code\n> ```\n', 6],
    ['    a\r\n', 'j', 1, '```j\r\na\r\n```\r\n', 4]
  ])('%j is fenced with a typed language', (source, language, infoOffset, expected, at) => {
    // The language box addresses its code block at the code's last word.
    const code = source.search(/[a-z]+\s*$/u)
    expect(apply(source, command(code, { command: 'setCodeLanguage', language, infoOffset }))).toEqual({ source: expected, caret: at })
  })

  it('drops the indentation that its deleted text left on Backspace', () => {
    expect(apply('    \n', backspace(4))).toEqual({ source: '\n', caret: 0 })
  })
})

describe('task items', () => {
  it.each([
    ['- [ ] \n\n  b\n', ['list@0', 'list-item@0', 'paragraph@6', 'paragraph@10']],
    ['3) [ ] \n\n   b\n', ['list@0', 'list-item@0', 'paragraph@7', 'paragraph@12']],
    ['3) [ ] \n\n   \n\n   b\n', ['list@0', 'list-item@0', 'paragraph@7', 'paragraph@12', 'paragraph@17']]
  ])('%j begins with its empty marker-line paragraph', (source, blocks) => {
    expect(editingBlocks(source)).toEqual(blocks)
  })

  it('keeps an unwrapped empty paragraph apart from its nested list on Backspace', () => {
    const backspaceAtStart = command(6, { command: 'changeList', change: { type: 'backspace' }, listOptions: { bulletListMarker: '-', orderListDelimiter: '.' } })
    expect(apply('- [x] \n  - [ ] c\n', backspaceAtStart)).toEqual({ source: '\n\n- [ ] c\n', caret: 0 })
  })

  it('keeps an ordered item\'s task marker without text as paragraph text on Backspace', () => {
    const backspaceAtStart = command(3, { command: 'changeList', change: { type: 'backspace' }, listOptions: { bulletListMarker: '-', orderListDelimiter: '.' } })
    expect(apply('3) [x] \n\n   b\n', backspaceAtStart)).toEqual({ source: '[x] \n\nb\n', caret: 0 })
  })
})

const enter = (at: number): DocumentInputAction => ({ selection: caret(at), range: { start: at, end: at }, inputType: 'insertParagraph', data: null, options })

/** Applies one tracked action; returns its source, caret and both review projections. */
const applyTracked = (source: string, action: DocumentInputAction) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, true)
  if (edits === undefined) throw new Error('Expected tracked edits')
  const commit = core.apply(previous, edits)
  const selection = core.reconcileInput(previous, plan, commit, action).selection
  if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a text selection')
  return {
    source: commit.revision.source,
    caret: selection.ranges[selection.primary]?.anchor,
    original: core.project(commit.revision, 'original').markdown,
    revised: core.project(commit.revision, 'revised').markdown
  }
}

// Upstream MarkText's (8d6c198c) bytes and carets; untouched bytes, such as a
// lazy continuation line, are kept.
describe('Enter splits a list item as upstream does', () => {
  it.each([
    ['- [ ] \n  b\n', enter(9), '- [ ] \n- [ ] b\n', 13],
    ['- \n  b\n', enter(5), '- \n- b\n', 5],
    ['-\n  b\n', enter(4), '-\n- b\n', 4],
    ['1. \n   b\n', enter(7), '1. \n2. b\n', 7],
    ['> - \n>   b\n', enter(9), '> - \n> - b\n', 9],
    ['- a\n  - \n    b\n', enter(13), '- a\n  - \n  - b\n', 13],
    ['- \n  ab\n', enter(6), '- \n  a\n- b\n', 9],
    ['- [ ] \n\n  b\n', enter(6), '- [ ] \n\n- [ ] b\n', 14],
    ['- \n  - c\n  - d\n', enter(2), '- \n- - c\n  - d\n', 7],
    ['1. \n   - c\n', enter(3), '1. \n2. - c\n', 9],
    ['- [x] \n  - [ ] c\n', enter(6), '- [x] \n- [ ] \n  - [ ] c\n', 22],
    ['- a\n\n  \n\n  b\n', enter(7), '- a\n\n- \n\n  b\n', 7]
  ])('%j', (source, action, expected, at) => {
    expect(apply(source, action)).toEqual({ source: expected, caret: at })
  })

  it.each([
    ['- [ ] \n\n  b\n', enter(6), '- [ ] \n\n{~~  ~>- [ ] ~~}b\n', '- [ ] \n\n- [ ] b\n'],
    ['- \n  b\n', enter(5), '- \n{~~  ~>- ~~}b\n', '- \n- b\n'],
    ['- [x] \n  - [ ] c\n', enter(6), '- [x] \n{++- [ ] \n++}  - [ ] c\n', '- [x] \n- [ ] \n  - [ ] c\n']
  ])('tracks %j as a review change', (source, action, expected, revised) => {
    expect(applyTracked(source, action)).toMatchObject({ source: expected, original: source, revised })
  })
})

describe('an edited thematic break that no longer reads as a rule', () => {
  it.each([
    ['- x\na\n---\n', backspace(9), '- x\na\n\n--\n', 9],
    ['- x\n---\n', deleteForward(4), '- x\n\n--\n', 5],
    ['> x\n> ***\n> y\n', backspace(9), '> x\n>\n> **\n>\n> y\n', 10],
    ['***\nx\n', backspace(3), '**\n\nx\n', 2],
    ['x\n***\n', type(5, 'x'), 'x\n\n***x\n', 7],
    ['- x\n  ***\n', backspace(9), '- x\n\n  **\n', 9],
    ['x\n****\n', backspace(6), 'x\n***\n', 5]
  ])('%j is written apart from its neighbours', (source, action, expected, at) => {
    expect(apply(source, action)).toEqual({ source: expected, caret: at })
  })

  it('tracks the separation with the edit', () => {
    expect(applyTracked('- x\na\n---\n', backspace(9))).toMatchObject({ original: '- x\na\n---\n', revised: '- x\na\n\n--\n' })
  })
})
