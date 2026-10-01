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

describe('HTML blocks opened on a list item marker line (CommonMark 0.31.2 §4.6, §5.2)', () => {
  it('keeps a continuation-indented HTML block inside one list item (CommonMark type 6)', () => {
    const item = parse('- <div>\n  ab\n  </div>\n').root.children[0]?.children[0]
    expect(item?.kind).toBe('list-item')
    expect(blocks(item)).toEqual([['html-block', { start: 2, end: 22 }]])
  })

  it('keeps the block whole in a nested list item', () => {
    const outer = parse('- - <div>\n    ab\n    </div>\n').root.children[0]?.children[0]
    expect(blocks(outer)).toEqual([['list', { start: 2, end: 28 }]])
    const inner = outer?.children[0]?.children[0]
    expect(inner?.kind).toBe('list-item')
    expect(blocks(inner)).toEqual([['html-block', { start: 4, end: 28 }]])
  })

  it('keeps the block whole in an ordered list item with three-column continuation', () => {
    const item = parse('1. <div>\n   ab\n   </div>\n').root.children[0]?.children[0]
    expect(blocks(item)).toEqual([['html-block', { start: 3, end: 25 }]])
  })

  it('keeps the block whole in a list item inside a blockquote', () => {
    const quote = parse('> - <div>\n>   ab\n').root.children[0]
    const item = quote?.children[0]?.children[0]
    expect(blocks(item)).toEqual([['html-block', { start: 4, end: 17 }]])
  })

  it('ends the list item at an under-indented line because HTML blocks have no lazy continuation', () => {
    const { root } = parse('- <div>\nab\n')
    expect(blocks(root)).toEqual([
      ['list', { start: 0, end: 8 }],
      ['paragraph', { start: 8, end: 10 }]
    ])
    expect(blocks(root.children[0]?.children[0])).toEqual([
      ['html-block', { start: 2, end: 8 }]
    ])
  })

  it('ends a type 6 block at a blank line while the list item continues', () => {
    const item = parse('- <div>\n  ab\n\n  cd\n').root.children[0]?.children[0]
    expect(blocks(item)).toEqual([
      ['html-block', { start: 2, end: 13 }],
      ['paragraph', { start: 16, end: 18 }]
    ])
  })

  it.each([
    ['type 1 across a blank line', '- <script>\n  a\n\n  b\n  </script>\n'],
    ['type 2 comment', '- <!--\n  a\n  -->\n'],
    ['type 3 processing instruction', '- <?x\n  a\n  ?>\n'],
    ['type 4 declaration', '- <!DOCTYPE\n  x>\n'],
    ['type 5 CDATA', '- <![CDATA[\n  x\n  ]]>\n'],
    ['type 7 custom element', '- <custom-el>\n  a\n  </custom-el>\n']
  ])('keeps a %s whole inside the list item', (_label, source) => {
    const item = parse(source).root.children[0]?.children[0]
    expect(blocks(item)).toEqual([
      ['html-block', { start: 2, end: source.length }]
    ])
  })

  it('treats CriticMarkup-looking text inside the block as literal HTML (L1)', () => {
    const source = '- <div>\n  {++x++}\n  </div>\n'
    const { revision, root } = parse(source)
    expect(revision.annotations).toEqual([])
    expect(blocks(root.children[0]?.children[0])).toEqual([
      ['html-block', { start: 2, end: source.length }]
    ])
  })

  it.each([
    ['inserts inside the block', '- <div>\n  ab\n  </div>\n', 12, 12, 'c'],
    ['replaces the opening tag line content', '- <div>\n  ab\n  </div>\n', 3, 6, 'section'],
    ['removes the blank line that split the block', '- <div>\n  ab\n\n  cd\n  </div>\n', 13, 14, ''],
    ['indents a lazy line into the block', '- <div>\nab\n  </div>\n', 8, 8, '  ']
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

describe('HTML blocks indented past their container', () => {
  // CommonMark 0.31.2 §4.6: an HTML block's lines keep their indentation
  // past the container's, so its first line's text starts at that
  // indentation, and the block starts with its text.
  it('starts the block at its first line\'s indentation in a list item', () => {
    const core = createDocumentCore()
    const revision = core.open('- delta four\n   <div>\nhtml 0\n</div>\n')
    const item = core.project(revision, 'markup').syntax.ast.root.children[0]?.children[0] as Node | undefined
    const html = item?.children[1]
    expect(html?.kind).toBe('html-block')
    expect(html?.range.start).toBe(15)
    expect(html?.children[0]?.range).toEqual({ start: 15, end: 21 })
  })

  const literal: Record<string, readonly string[]> = {
    html: ['<div>', 'html 0', '</div>'],
    comment: ['<!--', 'comment 0', '-->'],
    fence: ['```js', 'code 0', '```'],
    math: ['$$', 'x 0', '$$']
  }
  const containers: Record<string, (lines: readonly string[], pad: string) => string> = {
    'list item': (lines, pad) => '- item\n' + lines.map(line => `  ${pad}${line}`).join('\n'),
    'lazy list item': (lines, pad) => '- item\n' + lines.map((line, index) => `${index === 0 ? '  ' : ''}${pad}${line}`).join('\n'),
    'ordered item': (lines, pad) => '1. item\n' + lines.map(line => `   ${pad}${line}`).join('\n'),
    quote: (lines, pad) => lines.map(line => `>${pad}${line}`).join('\n'),
    'list item in a quote': (lines, pad) => '> - item\n' + lines.map(line => `>   ${pad}${line}`).join('\n'),
    'quote in a list item': (lines, pad) => '- item\n' + lines.map(line => `  > ${pad}${line}`).join('\n'),
    'nested list item': (lines, pad) => '- a\n  - b\n' + lines.map(line => `    ${pad}${line}`).join('\n')
  }
  const within = (node: Node, label: string): void => {
    for (const child of node.children) {
      expect(child.range.start, label).toBeGreaterThanOrEqual(node.range.start)
      expect(child.range.end, label).toBeLessThanOrEqual(node.range.end)
      within(child, label)
    }
  }
  it.each(Object.keys(containers))('keeps every literal block\'s text within it in a %s', container => {
    for (const [kind, lines] of Object.entries(literal)) {
      for (const pad of ['', ' ', '  ', '   ', '\t', ' \t']) {
        const source = `Intro.\n\n${containers[container]!(lines, pad)}\n\nAfter.\n`
        const core = createDocumentCore()
        const revision = core.open(source)
        const label = `${kind} ${JSON.stringify(source)}`
        within(core.project(revision, 'markup').syntax.ast.root as Node, label)
        within(core.project(revision, 'revised').ast.root as Node, label)
        within(core.project(revision, 'original').ast.root as Node, label)
      }
    }
  })
})
