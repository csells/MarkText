import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '@marktext/document-core'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'

const bindings = (source: string) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  return createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations, source).bindings
}

describe('Markup view trailing line of a block', () => {
  it.each([
    { source: 'a\n\n', expected: [['a', 2]] },
    { source: 'a\n', expected: [['a', 2]] },
    { source: '> a\n>\n', expected: [['a', 5]] },
    { source: '> a\n>  \n', expected: [['a', 7]] },
    { source: '> a\r\n>\r\n', expected: [['a', 6]] },
    { source: '- a\n  \n', expected: [['a', 6]] }
  ])('is the blank line within its containers in $source', ({ source, expected }) => {
    expect(bindings(source).map((binding) => [binding.text, binding.trailingLinePosition])).toEqual(
      expected
    )
  })

  // The `>` line opens a new, empty quote, so it is that quote's line, not a
  // blank line after the block.
  it.each([
    { source: 'a\n>\n', expected: [['a', undefined], ['', 4]] },
    { source: 'a\n> \n', expected: [['a', undefined], ['', 5]] },
    { source: '> a\n>>\n', expected: [['a', undefined], ['', 7]] },
    { source: '- a\n>\n', expected: [['a', undefined], ['', 6]] },
    { source: '    code\n>\n', expected: [['code', undefined], ['', 11]] }
  ])('is not a line that opens another block in $source', ({ source, expected }) => {
    expect(bindings(source).map((binding) => [binding.text, binding.trailingLinePosition])).toEqual(
      expected
    )
  })
})

describe('Markup view container prefix of a later line', () => {
  const prefixSnaps = (source: string) =>
    bindings(source)[0]?.caretSnaps?.filter((snap) => snap.from === snap.at + 1) ?? []

  it.each([
    { source: '> a\n> b\n', expected: [{ from: 5, to: 7, at: 4 }] },
    { source: '- a\n  b\n', expected: [{ from: 5, to: 7, at: 4 }] },
    // Hidden annotation syntax that begins the line is not container prefix.
    { source: '> a\n> {++b++}\n', expected: [{ from: 5, to: 7, at: 4 }] },
    // An empty last line holds only its prefix, never the closing fence.
    { source: '> ```\n> a\n>\n> ```\n', expected: [{ from: 11, to: 12, at: 10 }] },
    { source: '$$\nx\n\n$$\n', expected: [] },
    { source: '```\n\n\n```\n', expected: [] }
  ])('is the quote marker or indentation in $source', ({ source, expected }) => {
    expect(prefixSnaps(source)).toEqual(expected)
  })

  // Literal text that looks like a quote marker or indentation belongs to the
  // block, so the caret there stays in the text.
  it.each([
    { source: '> ```\n> a\n> > b\n> ```\n', expected: [{ from: 11, to: 13, at: 10 }] },
    { source: '> ```\n> a\n>   b\n> ```\n', expected: [{ from: 11, to: 13, at: 10 }] },
    { source: '- ```\n  a\n    b\n  ```\n', expected: [{ from: 11, to: 13, at: 10 }] },
    { source: '>     a\n>       b\n', expected: [{ from: 9, to: 15, at: 8 }] },
    { source: '> <div>\n>  > b\n', expected: [{ from: 9, to: 11, at: 8 }] }
  ])('ends where the block\'s own text begins in $source', ({ source, expected }) => {
    expect(prefixSnaps(source)).toEqual(expected)
  })
})
