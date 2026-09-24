import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import type { DocumentCore, DocumentRevision } from '../src/index.js'

type Node = Readonly<{
  kind: string
  range: Readonly<{ start: number; end: number }>
  children: readonly Node[]
}>

function rootOf(core: DocumentCore, revision: DocumentRevision): Node {
  return core.project(revision, 'revised').ast.root as Node
}

function blocks(node: Node | undefined): unknown[] {
  return node?.children.map(child => [child.kind, child.range]) ?? []
}

function parse(source: string): Readonly<{ revision: DocumentRevision; root: Node }> {
  const core = createDocumentCore()
  const revision = core.open(source)
  return { revision, root: rootOf(core, revision) }
}

describe('indented code opened on a list item marker line (CommonMark 0.31.2 §4.4, §5.2)', () => {
  it('keeps a continuation line in the same code block of a bullet item', () => {
    const { root } = parse('-     code\n      more\n')
    expect(blocks(root)).toEqual([['list', { start: 0, end: 22 }]])
    const item = root.children[0]?.children[0]
    expect(item?.kind).toBe('list-item')
    expect(blocks(item)).toEqual([['code-block', { start: 6, end: 22 }]])
    expect(blocks(item?.children[0])).toEqual([
      ['text', { start: 6, end: 10 }],
      ['soft-break', { start: 10, end: 11 }],
      ['text', { start: 17, end: 21 }]
    ])
  })

  it('keeps the block whole in an ordered item', () => {
    const item = parse('1.     code\n       more\n').root.children[0]?.children[0]
    expect(blocks(item)).toEqual([['code-block', { start: 7, end: 24 }]])
  })

  it('keeps the block whole in a nested item', () => {
    const outer = parse('- -     code\n        more\n').root.children[0]?.children[0]
    expect(blocks(outer)).toEqual([['list', { start: 2, end: 26 }]])
    expect(blocks(outer?.children[0]?.children[0])).toEqual([
      ['code-block', { start: 8, end: 26 }]
    ])
  })

  it('keeps the block whole in an item inside a blockquote', () => {
    const item = parse('> -     a\n>       b\n').root.children[0]?.children[0]?.children[0]
    expect(blocks(item)).toEqual([['code-block', { start: 8, end: 20 }]])
  })

  it('keeps one block across a blank line followed by more indented code', () => {
    const item = parse('-     a\n\n      b\n').root.children[0]?.children[0]
    expect(blocks(item)).toEqual([['code-block', { start: 6, end: 17 }]])
  })

  it('ends the list item at an under-indented line because code has no lazy continuation', () => {
    const { root } = parse('-     code\nmore\n')
    expect(blocks(root)).toEqual([
      ['list', { start: 0, end: 11 }],
      ['paragraph', { start: 11, end: 15 }]
    ])
    expect(blocks(root.children[0]?.children[0])).toEqual([
      ['code-block', { start: 6, end: 11 }]
    ])
  })

  it('ends the block but not the item at a line indented only to the item content', () => {
    const item = parse('-     code\n  more\n').root.children[0]?.children[0]
    expect(blocks(item)).toEqual([
      ['code-block', { start: 6, end: 11 }],
      ['paragraph', { start: 13, end: 17 }]
    ])
  })

  it('ends the block at a sibling list marker', () => {
    const list = parse('-     a\n- b\n').root.children[0]
    expect(blocks(list)).toEqual([
      ['list-item', { start: 0, end: 8 }],
      ['list-item', { start: 8, end: 11 }]
    ])
    expect(blocks(list?.children[0])).toEqual([['code-block', { start: 6, end: 8 }]])
  })

  it('treats CriticMarkup-looking text inside the block as literal code (L1)', () => {
    const source = '-     {++x++}\n      {--y--}\n'
    const { revision, root } = parse(source)
    expect(revision.annotations).toEqual([])
    expect(blocks(root.children[0]?.children[0])).toEqual([
      ['code-block', { start: 6, end: source.length }]
    ])
  })

  it.each([
    ['inserts on the continuation line', '-     code\n      more\n', 19, 19, 'x'],
    ['inserts on the marker line', '-     code\n      more\n', 8, 8, 'x'],
    ['inserts CriticMarkup-looking text', '-     code\n      more\n', 17, 17, '{++y++}'],
    ['removes the blank line inside the block', '-     a\n\n      b\n', 8, 9, ''],
    ['indents an under-indented line into the block', '-     code\nmore\n', 11, 11, '      '],
    ['under-indents a continuation line', '-     code\n      more\n', 11, 17, ''],
    ['turns a paragraph item into indented code', '- code\n      more\n', 2, 2, '    ']
  ])('matches a full parse after an edit that %s', (_label, source, start, end, insert) => {
    const core = createDocumentCore()
    const opened = core.open(source)
    const commit = core.apply(opened, [{ start, end, insert }])
    const nextSource = source.slice(0, start) + insert + source.slice(end)
    const fresh = parse(nextSource)
    expect(rootOf(core, commit.revision)).toEqual(fresh.root)
    expect(commit.revision.annotations).toEqual(fresh.revision.annotations)
  })
})
