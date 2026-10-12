import { describe, expect, it } from 'vitest'

import { createDocumentCore, type MarkdownAstNode } from '../src/index.js'

// Exports that keep an ordered list's `1)` or `1.` (pandoc's OneParen and
// Period) read the delimiter from the parse rather than from source text.

const lists = (node: MarkdownAstNode): MarkdownAstNode[] => [
  ...(node.kind === 'list' ? [node] : []),
  ...node.children.flatMap(lists)
]

const SOURCE = '1) one\n2) two\n\n- x\n  3. y\n\n> 7) q\n\n{++8) added++}\n'

describe('ordered list delimiter', () => {
  it('names the delimiter of every ordered list and none for bullets', () => {
    const core = createDocumentCore()
    const revision = core.open(SOURCE)
    const found = lists(core.project(revision, 'revised').ast.root).map((list) => list.attributes['delimiter'])
    expect(found).toEqual([')', undefined, '.', ')', ')'])
    expect(lists(core.project(revision, 'markup').syntax.ast.root).map((list) => list.attributes['delimiter']))
      .toEqual(found)
  })

  it('keeps the delimiter through an incremental edit', () => {
    const core = createDocumentCore()
    const revision = core.open(SOURCE)
    const at = SOURCE.indexOf('two')
    const next = `${SOURCE.slice(0, at)}2${SOURCE.slice(at)}`
    const reopened = core.apply(revision, [{ start: at, end: at, insert: '2' }]).revision
    expect(reopened.source).toBe(next)
    expect(lists(core.project(reopened, 'revised').ast.root).map((list) => list.attributes['delimiter']))
      .toEqual([')', undefined, '.', ')', ')'])
  })
})
