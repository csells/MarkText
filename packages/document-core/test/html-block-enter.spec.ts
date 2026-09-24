import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

function enter(source: string, at: number) {
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection = { ranges: [{ anchor: at, focus: at }], primary: 0 }
  const action: DocumentInputAction = { selection, range: { start: at, end: at }, inputType: 'insertParagraph', data: null, options }
  const policy = core.planInput(previous, action)
  const commit = core.apply(previous, core.inputEdits(previous, action, policy, false) ?? [])
  return { core, revision: commit.revision, selection: policy.selection }
}

// Expected bytes and carets follow MarkText's HTML code widget before the shared
// model (muya codeBlockContent.enterHandler): one line ending, the first line's
// indentation, and an opened line between a tag or bracket pair.
it.each([
  ['inside a line', '<div>\nab\n</div>\n', 7, '<div>\na\nb\n</div>\n', 8],
  ['at a line end', '<div>\nab\n</div>\n', 8, '<div>\nab\n\n</div>\n', 9],
  ['after the closing tag', '<div>\nab\n</div>\n', 15, '<div>\nab\n</div>\n\n', 16],
  ['in a CRLF document', '<div>\r\nab\r\n</div>\r\n', 8, '<div>\r\na\r\nb\r\n</div>\r\n', 10],
  ['inside a blockquote', '> <div>\n> ab\n> </div>\n', 11, '> <div>\n> a\n> b\n> </div>\n', 14],
  ['in a terminated script block', '<script>\nab\n</script>\n', 10, '<script>\na\nb\n</script>\n', 11],
  ['between a tag pair', '<div>\n<p></p>\n</div>\n', 9, '<div>\n<p>\n    \n</p>\n</div>\n', 14],
  ['between a quoted tag pair', '> <div>\n> <p></p>\n> </div>\n', 13, '> <div>\n> <p>\n>     \n> </p>\n> </div>\n', 20],
  ['on an indented line', '<div>\n  <p>ab</p>\n</div>\n', 12, '<div>\n  <p>a\nb</p>\n</div>\n', 13]
] as const)('Enter %s of a multi-line HTML block inserts one literal line ending', (_name, source, at, expected, caret) => {
  const { core, revision, selection } = enter(source, at)
  expect(revision.source).toBe(expected)
  expect(selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
  // A blank line ends these HTML blocks, exactly as it did before editing.
  if (!/\n[ \t>]*\r?\n/u.test(expected)) {
    const kinds = (node: { kind: string, children: readonly { kind: string, children: readonly unknown[] }[] }): string[] =>
      [node.kind, ...node.children.flatMap(child => kinds(child as typeof node))]
    expect(kinds(core.project(revision, 'markup').syntax.ast.root).filter(kind => kind === 'html-block')).toHaveLength(1)
  }
})

it('Enter in a single-line HTML opener writes the upstream template', () => {
  const { revision, selection } = enter('<div>\n', 5)
  expect(revision.source).toBe('<div>\n\n</div>\n')
  expect(selection).toEqual({ ranges: [{ anchor: 6, focus: 6 }], primary: 0 })
})
