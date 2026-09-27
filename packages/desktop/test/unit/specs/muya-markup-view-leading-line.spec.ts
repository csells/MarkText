import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '@marktext/document-core'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'

const leadingLines = (source: string) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations, source)
  return view.bindings.map((binding) => [binding.text, binding.leadingLinePosition])
}

describe('Markup view leading line of a contained paragraph', () => {
  it.each([
    { source: '-\n  next\n', expected: [['next', 1]] },
    { source: '1.\n   next\n', expected: [['next', 2]] },
    { source: '> a\n>\n> next\n', expected: [['a', undefined], ['next', 5]] },
    { source: '- a\n-\n  next\n', expected: [['a', undefined], ['next', 5]] }
  ])('is the paragraph container\'s own marker or blank line in $source', ({ source, expected }) => {
    expect(leadingLines(source)).toEqual(expected)
  })

  // The parser gives the `-` line to an empty sibling list item, so it is not
  // a line of the quote or item that holds the paragraph.
  it.each([
    { source: '> -\n> next\n', expected: [['', undefined], ['next', undefined]] },
    {
      source: '> a\n>\n> -\n> next\n',
      expected: [['a', undefined], ['', undefined], ['next', undefined]]
    },
    {
      source: '- a\n\n  1)\n  next\n',
      expected: [['a', undefined], ['', undefined], ['next', undefined]]
    }
  ])('is not a line owned by a sibling block in $source', ({ source, expected }) => {
    expect(leadingLines(source)).toEqual(expected)
  })
})
