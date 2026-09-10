import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'

import { createMuyaMarkupView, mappedMuyaSourceRange } from '@/documentAuthority/muyaMarkupView'

describe('Muya Markup editing view', () => {
  it('renders following tracked input outside a deleted table', () => {
    const core = createDocumentCore()
    const revision = core.open('{--| | |\n| --- | --- |\n| | |--}{++X++}\n')
    const projection = core.project(revision, 'markup')
    const view = createMuyaMarkupView(projection, revision.annotations)
    expect(projection.syntax.ast.root.children.map((node) => node.kind)).toEqual([
      'table',
      'paragraph'
    ])
    expect(view.state).toEqual([
      {
        name: 'table',
        children: [
          {
            name: 'table.row',
            children: [
              { name: 'table.cell', text: '', meta: { align: 'none' } },
              { name: 'table.cell', text: '', meta: { align: 'none' } }
            ]
          },
          {
            name: 'table.row',
            children: [
              { name: 'table.cell', text: '', meta: { align: 'none' } },
              { name: 'table.cell', text: '', meta: { align: 'none' } }
            ]
          }
        ]
      },
      { name: 'paragraph', text: 'X' }
    ])
    expect(view.bindings.at(-1)?.text).toBe('X')
    expect(mappedMuyaSourceRange(view.bindings.at(-1)!, { start: 1, end: 1 })).toEqual({
      start: 35,
      end: 35
    })
  })

  it('presents tracked heading conversion as old paragraph and editable new heading', () => {
    const core = createDocumentCore()
    const revision = core.open('{~~plain~># title~~}\n')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    expect(view.state).toEqual([
      { name: 'paragraph', text: 'plain' },
      { name: 'atx-heading', text: '# title', meta: { level: 1 } }
    ])
    expect(view.bindings.map((binding) => [binding.path, binding.text])).toEqual([
      [[0, 'text'], 'plain'],
      [[1, 'text'], '# title']
    ])
    expect(mappedMuyaSourceRange(view.bindings[1], { start: 7, end: 7 })).toEqual({
      start: 17,
      end: 17
    })
    expect(
      view.decorations.map((item) => [item.path, 'arm' in item.mark && item.mark.arm])
    ).toEqual([
      [[0, 'text'], 'old'],
      [[1, 'text'], 'new']
    ])
  })

  it('presents a tracked table paste with native cells and retains the old paragraph', () => {
    const core = createDocumentCore()
    const revision = core.open('{~~seed~>| a | b |\n| - | - |\n| 1 | 2 |~~}\n')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    expect(view.state.map((block) => block.name)).toEqual(['paragraph', 'table'])
    expect(view.bindings.map((binding) => binding.text)).toEqual(['seed', 'a', 'b', '1', '2'])
    for (const binding of view.bindings) expect(binding.editable).not.toBe(false)
    expect(
      view.decorations.filter((item) => 'arm' in item.mark && item.mark.arm === 'old')
    ).toHaveLength(1)
    const proposed = view.decorations.filter(
      (item) => 'arm' in item.mark && item.mark.arm === 'new'
    )
    expect(proposed.filter((item) => item.range.end > item.range.start)).toHaveLength(4)
    expect(
      proposed
        .filter((item) => item.range.end === item.range.start)
        .map((item) => item.sourcePosition)
    ).toEqual([9, 38])
    expect(revision.source).toBe('{~~seed~>| a | b |\n| - | - |\n| 1 | 2 |~~}\n')
  })

  it('retains both suggestion arms and maps continued typing inside an Addition', () => {
    const core = createDocumentCore()
    const revision = core.open('A {++new++} {--old--} {~~left~>right~~} {==focus==}{>>note<<} Z\n')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)

    expect(view.state).toEqual([{ name: 'paragraph', text: 'A new old leftright focus Z' }])
    expect(view.bindings[0].text).toBe('A new old leftright focus Z')
    expect(view.bindings[0].editable).not.toBe(false)
    expect(
      view.decorations.map((item) => [
        item.mark.kind,
        'arm' in item.mark ? item.mark.arm : null,
        view.bindings[0].text.slice(item.range.start, item.range.end)
      ])
    ).toEqual([
      ['addition', null, 'new'],
      ['deletion', null, 'old'],
      ['substitution', 'old', 'left'],
      ['substitution', 'new', 'right'],
      ['highlight', null, 'focus']
    ])
    expect(mappedMuyaSourceRange(view.bindings[0], { start: 5, end: 5 })).toEqual({
      start: 8,
      end: 8
    })
    expect(mappedMuyaSourceRange(view.bindings[0], { start: 3, end: 5 })).toEqual({
      start: 6,
      end: 8
    })
    expect(mappedMuyaSourceRange(view.bindings[0], { start: 1, end: 4 })).toBeUndefined()
    expect(view.comments).toEqual([
      { annotationRange: { start: 51, end: 61 }, path: [0, 'text'], offset: 25 }
    ])
    expect(structuredClone(view)).toEqual(view)
  })

  it('keeps the Core inline meaning when substitution arms would invent emphasis', () => {
    const core = createDocumentCore()
    const revision = core.open('{~~*old~>new*~~}')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)

    expect(view.bindings[0].text).toBe('*oldnew*')
    expect(view.bindings[0].syntax.children).toEqual([
      {
        kind: 'text',
        range: { start: 0, end: 9 },
        attributes: { semanticText: '*oldnew*' },
        children: []
      }
    ])
    expect(view.bindings[0].segments[0]).toEqual({
      text: { start: 0, end: 4 },
      source: { start: 3, end: 7 },
      syntax: { start: 1, end: 5 }
    })
  })

  it('provides a review anchor and editable empty paragraph for a Comment-only document', () => {
    const core = createDocumentCore()
    const revision = core.open('{>>note<<}')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)

    expect(view.state).toEqual([{ name: 'paragraph', text: '' }])
    expect(view.comments).toEqual([
      { annotationRange: { start: 0, end: 10 }, path: [0, 'text'], offset: 0 }
    ])
    expect(mappedMuyaSourceRange(view.bindings[0], { start: 0, end: 0 })).toEqual({
      start: 10,
      end: 10
    })
  })

  it('carries typed headings, nested list paragraphs and literal blocks without re-recognition', () => {
    const core = createDocumentCore()
    const revision = core.open(
      '# Heading {++new++}\n\n- {--old--} item\n\n```js\n{++literal++}\n```\n'
    )
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)

    expect(view.state).toEqual([
      { name: 'atx-heading', text: '# Heading new', meta: { level: 1 } },
      {
        name: 'bullet-list',
        meta: { marker: '-', loose: false },
        children: [{ name: 'list-item', children: [{ name: 'paragraph', text: 'old item' }] }]
      },
      { name: 'code-block', text: '{++literal++}', meta: { type: 'fenced', lang: 'js' } }
    ])
    expect(view.bindings.map((binding) => binding.path)).toEqual([
      [0, 'text'],
      [1, 'children', 0, 'children', 0, 'text'],
      [2, 'text']
    ])
    expect(view.decorations.map((decoration) => decoration.path)).toEqual([
      [0, 'text'],
      [1, 'children', 0, 'children', 0, 'text']
    ])
  })

  it('retains annotations in quotes, task lists and tables alongside math presentation', () => {
    const core = createDocumentCore()
    const revision = core.open(
      '> {++quote++}\n\n- [x] {==done==}\n\n| A |\n| - |\n| {--old--} |\n\n$$\nx^2\n$$'
    )
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)

    expect(view.state).toEqual([
      { name: 'block-quote', children: [{ name: 'paragraph', text: 'quote' }] },
      {
        name: 'task-list',
        meta: { marker: '-', loose: false },
        children: [
          {
            name: 'task-list-item',
            meta: { checked: true },
            children: [{ name: 'paragraph', text: 'done' }]
          }
        ]
      },
      {
        name: 'table',
        children: [
          {
            name: 'table.row',
            children: [{ name: 'table.cell', text: 'A', meta: { align: 'none' } }]
          },
          {
            name: 'table.row',
            children: [{ name: 'table.cell', text: 'old', meta: { align: 'none' } }]
          }
        ]
      },
      { name: 'math-block', text: 'x^2', meta: { mathStyle: '' } }
    ])
    expect(view.decorations.map((item) => item.mark.kind)).toEqual([
      'addition',
      'highlight',
      'deletion'
    ])
    expect(view.bindings.find((binding) => binding.text === 'old')?.path).toEqual([
      2,
      'children',
      1,
      'children',
      0,
      'text'
    ])
  })

  it('keeps empty suggestions reviewable at their exact visible position', () => {
    const core = createDocumentCore()
    const revision = core.open('A{++++}{~~old~>~~}Z')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)

    expect(view.bindings[0].text).toBe('AoldZ')
    expect(
      view.decorations.map((item) => [
        item.mark.kind,
        'arm' in item.mark ? item.mark.arm : null,
        item.range
      ])
    ).toEqual([
      ['addition', null, { start: 1, end: 1 }],
      ['substitution', 'old', { start: 1, end: 4 }],
      ['substitution', 'new', { start: 4, end: 4 }]
    ])
  })

  it('adapts remaining block presentation from the intrinsic AST', () => {
    const core = createDocumentCore()
    const revision = core.open(
      '---\ntitle: review\n---\n\n<div>raw</div>\n\n---\n\n```mermaid\ngraph TD\nA-->B\n```\n\n[ref]: https://example.com\n\nnote[^a]\n\n[^a]: words',
      { footnotes: true }
    )
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)

    expect(view.state.map((state) => state.name)).toEqual([
      'frontmatter',
      'html-block',
      'thematic-break',
      'diagram',
      'paragraph',
      'paragraph',
      'footnote'
    ])
    expect(view.state[0]).toEqual({
      name: 'frontmatter',
      text: 'title: review',
      meta: { lang: 'yaml', style: '-' }
    })
    expect(view.state[3]).toEqual({
      name: 'diagram',
      text: 'graph TD\nA-->B',
      meta: { type: 'mermaid', lang: 'yaml' }
    })
    expect(view.state[6]).toEqual({
      name: 'footnote',
      meta: { identifier: 'a' },
      children: [{ name: 'paragraph', text: 'words' }]
    })
  })

  it('does not insert container prefixes into a nested paragraph or indented literal text', () => {
    const core = createDocumentCore()
    const revision = core.open('> first {++new++}\n> second\n\n    code\n    next\n')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)

    expect(view.state).toEqual([
      { name: 'block-quote', children: [{ name: 'paragraph', text: 'first new\nsecond' }] },
      { name: 'code-block', text: 'code\nnext', meta: { type: 'indented', lang: '' } }
    ])
    const binding = view.bindings[0]
    expect(mappedMuyaSourceRange(binding, { start: 10, end: 16 })).toEqual({ start: 20, end: 26 })
  })

  it('preserves setext heading presentation and literal content without a physical final newline', () => {
    const core = createDocumentCore()
    for (const [source, expected] of [
      [
        'Title\n=====\n',
        { name: 'setext-heading', text: 'Title', meta: { level: 1, underline: '===' } }
      ],
      [
        '\tcode\n\tmore',
        { name: 'code-block', text: 'code\nmore', meta: { type: 'indented', lang: '' } }
      ],
      [
        '> ```js\n> x\n> y\n> ```',
        {
          name: 'block-quote',
          children: [{ name: 'code-block', text: 'x\ny', meta: { type: 'fenced', lang: 'js' } }]
        }
      ]
    ] as const) {
      const revision = core.open(source)
      expect(
        createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations).state
      ).toEqual([expected])
    }
  })

  it('keeps an empty block quote editable rather than publishing a childless container', () => {
    const core = createDocumentCore()
    const revision = core.open('>\n')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)

    expect(view.state).toEqual([
      { name: 'block-quote', children: [{ name: 'paragraph', text: '' }] }
    ])
    expect(view.bindings).toHaveLength(1)
    expect(view.bindings[0].path).toEqual([0, 'children', 0, 'text'])
  })

  it('retains the trailing paragraph created by Enter without inventing one for a final newline', () => {
    const core = createDocumentCore()
    const ordinary = core.open('seed\n')
    expect(
      createMuyaMarkupView(core.project(ordinary, 'markup'), ordinary.annotations).state
    ).toEqual([{ name: 'paragraph', text: 'seed' }])
    const entered = core.open('seed\n\n\n')
    const view = createMuyaMarkupView(core.project(entered, 'markup'), entered.annotations)
    expect(view.state).toEqual([
      { name: 'paragraph', text: 'seed' },
      { name: 'paragraph', text: '' }
    ])
    expect(view.bindings[1].path).toEqual([1, 'text'])
    expect(mappedMuyaSourceRange(view.bindings[1], { start: 0, end: 0 })).toEqual({
      start: 6,
      end: 6
    })
    const edit = mappedMuyaSourceRange(view.bindings[1], { start: 0, end: 0 })
    if (edit === undefined) throw new Error('Trailing caret has no canonical source position')
    expect(core.apply(entered, [{ ...edit, insert: 'next' }]).revision.source).toBe(
      'seed\n\nnext\n'
    )
  })

  it('retains a code exit paragraph when the literal AST includes its final line ending', () => {
    const core = createDocumentCore()
    const ordinary = core.open('```js\naaa\n```\n')
    expect(
      createMuyaMarkupView(core.project(ordinary, 'markup'), ordinary.annotations).state
    ).toHaveLength(1)
    const entered = core.open('```js\naaa\n```\n\n')
    const view = createMuyaMarkupView(core.project(entered, 'markup'), entered.annotations)
    expect(view.state.at(-1)).toEqual({ name: 'paragraph', text: '' })
    expect(view.state).toHaveLength(2)
    const binding = view.bindings.at(-1)
    if (binding === undefined) throw new Error('Missing code exit paragraph binding')
    expect(mappedMuyaSourceRange(binding, { start: 0, end: 0 })).toEqual({ start: 15, end: 15 })
  })

  it('maps trailing paragraph insertion through CriticMarkup and CRLF without rewriting either', () => {
    const core = createDocumentCore()
    const source = '{++seed++}\r\n\r\n\r\n'
    const revision = core.open(source)
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    expect(view.state.map((block) => block.text)).toEqual(['seed', ''])
    const range = mappedMuyaSourceRange(view.bindings[1], { start: 0, end: 0 })
    expect(range).toEqual({ start: 14, end: 14 })
    if (range === undefined) throw new Error('CRLF trailing caret is unbound')
    expect(core.apply(revision, [{ ...range, insert: 'next' }]).revision.source).toBe(
      '{++seed++}\r\n\r\nnext\r\n'
    )
  })

  it('retains end Enter when the original file has no final newline', () => {
    const core = createDocumentCore()
    const revision = core.open('# Heading\n\n')
    const view = createMuyaMarkupView(core.project(revision, 'markup'))
    expect(view.state.at(-1)).toEqual({ name: 'paragraph', text: '' })
    expect(mappedMuyaSourceRange(view.bindings.at(-1)!, { start: 0, end: 0 })).toEqual({
      start: revision.sourceLength,
      end: revision.sourceLength
    })
  })

  it('marks annotation context for empty marks and hidden comments as well as visible payloads', () => {
    for (const source of ['a{++++}b', 'a{>>note<<}b', 'a{++new++}b']) {
      const core = createDocumentCore()
      const revision = core.open(source + '\n\nplain')
      const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
      expect(view.bindings[0].annotationContext).toBe(true)
      expect(view.bindings[1].annotationContext).toBeUndefined()
    }
  })
})

it('anchors the native empty table cell after its serialized padding', () => {
  const core = createDocumentCore()
  const original = core.open('| aa | bb |\n| --- | --- |\n| cc | dd |\n')
  const plan = core.planInput(original, {
    kind: 'command',
    command: 'insertTableRow',
    placement: 'after',
    selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 },
    options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  })
  expect(plan.selection).toEqual({ ranges: [{ anchor: 32, focus: 32 }], primary: 0 })
  const revision = core.apply(original, plan.edits).revision
  const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
  const empty = view.bindings.find((binding) => binding.text === '')
  if (empty === undefined) throw new Error('Missing inserted empty cell')
  expect(mappedMuyaSourceRange(empty, { start: 0, end: 0 })).toEqual({ start: 32, end: 32 })
})
