import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentRevision, type MarkdownAstNode } from '../src/index.js'

// Expected bytes and carets were recorded from upstream MarkText (8d6c198c):
// paragraphContent._enterConvert for Enter and updateParagraph('html') for the
// Paragraph menu. Container prefixes follow its serializer on every new line.

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
const caretAt = (at: number) => ({ ranges: [{ anchor: at, focus: at }], primary: 0 })
const kinds = (node: MarkdownAstNode): string[] => [node.kind, ...node.children.flatMap(kinds)]
const emptyParagraphs = (node: MarkdownAstNode): MarkdownAstNode[] => [
  ...(node.kind === 'paragraph' && node.range.start === node.range.end ? [node] : []),
  ...node.children.flatMap(emptyParagraphs)
]

function run(source: string, action: DocumentInputAction, tracked = false, revision?: DocumentRevision) {
  const core = createDocumentCore()
  const previous = revision ?? core.open(source)
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, tracked)
  if (edits === undefined) throw new Error('The model rejected the input')
  const commit = core.apply(previous, edits)
  const selection = core.reconcileInput(previous, plan, commit, action).selection
  if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a source selection')
  return { core, previous, commit, revision: commit.revision, caret: selection.ranges[0]?.focus }
}

const enter = (at: number, inputType: 'insertParagraph' | 'insertLineBreak' = 'insertParagraph'): DocumentInputAction =>
  ({ selection: caretAt(at), range: { start: at, end: at }, inputType, data: null, options })
const type = (at: number, data: string): DocumentInputAction =>
  ({ selection: caretAt(at), range: { start: at, end: at }, inputType: 'insertText', data, options })
const menu = (at: number, replace: boolean, selectionMode: 'content' | 'end' = 'content'): DocumentInputAction =>
  ({ kind: 'command', command: 'createHtmlBlock', replace, selectionMode, selection: caretAt(at), options })

it.each([
  ['a bare opener', '<div>', 5, '<div>\n\n</div>', 6],
  ['a bare opener before its EOL', '<div>\n', 5, '<div>\n\n</div>\n', 6],
  ['a caret inside the opener', '<div>\n', 2, '<div>\n\n</div>\n', 6],
  ['another block tag', '<section>\n', 9, '<section>\n\n</section>\n', 10],
  ['an inline tag', '<span>\n', 6, '<span>\n\n</span>\n', 7],
  ['an opener with attributes', '<div class="x">\n', 15, '<div>\n\n</div>\n', 6],
  ['a list item', '- <div>\n', 7, '- <div>\n  \n  </div>\n', 10],
  ['an ordered list item', '1. <div>\n', 8, '1. <div>\n   \n   </div>\n', 12],
  ['a blockquote', '> <div>\n', 7, '> <div>\n> \n> </div>\n', 10],
  ['a list inside a blockquote', '> - <div>\n', 9, '> - <div>\n>   \n>   </div>\n', 14],
  ['a CRLF document', '<div>\r\n', 5, '<div>\r\n\r\n</div>\r\n', 7],
  ['surrounding blocks', 'a\n\n<div>\n\nb\n', 8, 'a\n\n<div>\n\n</div>\n\nb\n', 9]
] as const)('Enter in %s writes the upstream HTML template', (_name, source, at, expected, caret) => {
  const { core, revision, caret: selected } = run(source, enter(at))
  expect(revision.source).toBe(expected)
  expect(selected).toBe(caret)
  // The one parser owns two HTML blocks; the blank line between them is an
  // editable insertion point exactly where upstream placed the caret.
  const markup = core.project(revision, 'markup').syntax
  expect(kinds(markup.ast.root).filter(kind => kind === 'html-block')).toHaveLength(2)
  expect(emptyParagraphs(markup.ast.root).map(node => markup.coordinates.toSource(node.range.start, 'next'))).toContain(caret)
  for (const mode of ['original', 'revised'] as const) {
    expect(emptyParagraphs(core.project(revision, mode).ast.root)).toEqual([])
    expect(core.project(revision, mode).markdown).toBe(expected)
  }
})

it.each([
  ['a void tag', '<br>\n', 4, '<br>\n\n\n', 6],
  ['an uppercase tag', '<DIV>\n', 5, '<DIV>\n\n\n', 7],
  ['an unknown custom element', '<custom-el>\n', 11, '<custom-el>\n\n\n', 13],
  ['ordinary text', 'hello\n', 5, 'hello\n\n\n', 7]
] as const)('Enter after %s keeps paragraph Enter', (_name, source, at, expected, caret) => {
  const { revision, caret: selected } = run(source, enter(at))
  expect(revision.source).toBe(expected)
  expect(selected).toBe(caret)
})

it('Shift+Enter in a bare opener does not create the template', () => {
  expect(run('<div>\n', enter(5, 'insertLineBreak')).revision.source).not.toContain('</div>')
})

it.each([
  ['', '<div>\n\n</div>', 6, '<div>\nx\n</div>', 7],
  ['- ', '- <div>\n  \n  </div>\n', 10, '- <div>\n  x\n  </div>\n', 11],
  ['> ', '> <div>\n> \n> </div>\n', 10, '> <div>\n> x\n> </div>\n', 11],
  ['CRLF ', '<div>\r\n\r\n</div>\r\n', 7, '<div>\r\nx\r\n</div>\r\n', 8]
] as const)('%styping on the template gap joins one HTML block with the caret after the text', (_name, source, at, expected, caret) => {
  const { core, revision, caret: selected } = run(source, type(at, 'x'))
  expect(revision.source).toBe(expected)
  expect(selected).toBe(caret)
  const markup = core.project(revision, 'markup').syntax
  expect(kinds(markup.ast.root).filter(kind => kind === 'html-block')).toHaveLength(1)
  expect(emptyParagraphs(markup.ast.root)).toEqual([])
})

it('reopening the template shows the gap only between consecutive HTML blocks', () => {
  const core = createDocumentCore()
  const gap = (source: string) => {
    const markup = core.project(core.open(source), 'markup').syntax
    return emptyParagraphs(markup.ast.root).map(node => markup.coordinates.toSource(node.range.start, 'next'))
  }
  expect(gap('<div>\n\n</div>\n')).toEqual([6])
  expect(gap('<div>\n\n<p>x</p>\n')).toEqual([6])
  expect(gap('a\n\nb\n')).toEqual([])
  expect(gap('<div>\n\nb\n')).toEqual([])
  expect(gap('a\n\n<div>\n')).toEqual([])
  expect(gap('```\n```\n\n<div>\n')).toEqual([])
  // Every middle line of a template is editable; other pairs keep their rules.
  expect(gap('<div>\n\n\n</div>\n')).toEqual([6, 7])
  expect(gap('a\n\n\nb\n')).toEqual([])
  expect(gap('a\n\n\n\nb\n')).toEqual([3])
})

const del = (start: number, end: number, inputType: 'deleteContentBackward' | 'deleteContentForward'): DocumentInputAction =>
  ({ selection: caretAt(inputType === 'deleteContentBackward' ? end : start), range: { start, end }, inputType, data: null, options })

const join = (at: number, command: 'joinParagraphForward' | 'joinParagraphBackward'): DocumentInputAction =>
  ({ kind: 'command', command, selection: caretAt(at), options })

it.each([
  ['Enter', '<div>\n\n</div>\n', enter(6), '<div>\n\n\n</div>\n', 7, true],
  ['Enter in a list item', '- <div>\n  \n  </div>\n', enter(10), '- <div>\n  \n  \n  </div>\n', 13, true],
  ['Enter in a blockquote', '> <div>\n> \n> </div>\n', enter(10), '> <div>\n> \n> \n> </div>\n', 13, true],
  ['Enter in a CRLF document', '<div>\r\n\r\n</div>\r\n', enter(7), '<div>\r\n\r\n\r\n</div>\r\n', 9, true],
  ['Backspace', '<div>\n\n</div>\n', del(5, 6, 'deleteContentBackward'), '<div>\n</div>\n', 5, false],
  ['Delete', '<div>\n\n</div>\n', del(6, 7, 'deleteContentForward'), '<div>\n</div>\n', 6, false],
  ['Forward join', '<div>\n\n</div>\n', join(6, 'joinParagraphForward'), '<div>\n</div>\n', 6, false],
  ['Forward join in a list item', '- <div>\n  \n  </div>\n', join(10, 'joinParagraphForward'), '- <div>\n  </div>\n', 10, false],
  ['Forward join in a blockquote', '> <div>\n> \n> </div>\n', join(10, 'joinParagraphForward'), '> <div>\n> </div>\n', 10, false],
  ['Backward join in a list item', '- <div>\n  \n  </div>\n', join(10, 'joinParagraphBackward'), '- <div>\n  </div>\n', 7, false],
  ['Backward join in a blockquote', '> <div>\n> \n> </div>\n', join(10, 'joinParagraphBackward'), '> <div>\n> </div>\n', 7, false],
  ['Backspace on a second middle line', '<div>\n\n\n</div>\n', del(6, 7, 'deleteContentBackward'), '<div>\n\n</div>\n', 6, true]
] as const)('%s on a template middle line edits it like upstream\'s HTML widget', (_name, source, action, expected, caret, gap) => {
  const { core, revision, caret: selected } = run(source, action)
  expect(revision.source).toBe(expected)
  expect(selected).toBe(caret)
  const markup = core.project(revision, 'markup').syntax
  const gaps = emptyParagraphs(markup.ast.root).map(node => markup.coordinates.toSource(node.range.start, 'next'))
  if (gap) expect(gaps).toContain(caret)
  else expect(gaps).toEqual([])
})

it.each([
  ['an empty paragraph', '', 0, true, 'content', '<div>\n\n</div>', 6],
  ['an empty paragraph from the Paragraph menu', '', 0, true, 'end', '<div>\n\n</div>', 13],
  ['a paragraph', 'hello\n', 5, false, 'content', 'hello\n\n<div>\n\n</div>\n', 13],
  ['a heading', '# head\n', 6, false, 'content', '# head\n\n<div>\n\n</div>\n', 14],
  ['a list item', '- hello\n', 7, false, 'content', '- hello\n\n  <div>\n  \n  </div>\n', 19],
  ['an empty list item', '- ', 2, true, 'end', '- <div>\n  \n  </div>', 19],
  ['a blockquote', '> hello\n', 7, false, 'content', '> hello\n>\n> <div>\n> \n> </div>\n', 20],
  ['an empty blockquote', '> ', 2, true, 'end', '> <div>\n> \n> </div>', 19],
  ['between paragraphs', 'a\n\nb\n', 1, false, 'content', 'a\n\n<div>\n\n</div>\n\nb\n', 9],
  ['a CRLF paragraph', 'hello\r\n\r\nworld\r\n', 5, false, 'content', 'hello\r\n\r\n<div>\r\n\r\n</div>\r\n\r\nworld\r\n', 16]
] as const)('Paragraph → HTML Block in %s', (_name, source, at, replace, selectionMode, expected, caret) => {
  const { revision, caret: selected } = run(source, menu(at, replace, selectionMode))
  expect(revision.source).toBe(expected)
  expect(selected).toBe(caret)
})

// Track Changes compiles the same template as one suggestion: accepting it
// reproduces the untracked result and rejecting it the untouched source.
it.each([
  ['Enter in an opener', '<div>\n', enter(5), '{~~<div>\n~><div>\n\n</div>\n~~}'],
  ['the Paragraph menu below a paragraph', 'hello\n', menu(5, false), 'hello\n{++\n<div>\n\n</div>\n++}'],
  ['the Paragraph menu in an empty paragraph', '', menu(0, true, 'end'), '{++<div>\n\n</div>\n++}'],
  ['typing on the template gap', '<div>\n\n</div>\n', type(6, 'x'), '{~~<div>\n\n~><div>\nx\n~~}</div>\n']
] as const)('Track Changes suggests %s', (_name, source, action, expected) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, true)
  expect(edits).toBeDefined()
  const next = core.apply(revision, edits!).revision
  expect(next.source).toBe(expected)
  expect(core.project(next, 'original').markdown.trimEnd()).toBe(source.trimEnd())
  const untracked = run(source, action).revision
  const reparsed = (value: string) => {
    const other = createDocumentCore()
    return kinds(other.project(other.open(value), 'revised').ast.root)
  }
  expect(reparsed(core.project(next, 'revised').markdown)).toEqual(reparsed(untracked.source))
})
