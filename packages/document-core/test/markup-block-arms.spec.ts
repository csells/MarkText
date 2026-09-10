import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

describe('Markup replacement block arms', () => {
  it.each(['\n', '\r\n', '\r'])('retains each arm-owned nested task marker when moving a checked sibling (%j)', ending => {
    const source = '- [{~~x~> ~~}] parent{>>p<<}\n\n  {~~- [x] {++same++}{>>first<<}~>- [ ] same{>>second<<}~~}\n  {~~- [x] same{>>second<<}~>- [x] {++same++}{>>first<<}~~}\n'.replaceAll('\n', ending)
    const core = createDocumentCore()
    const revision = core.open(source)
    const prefix = 'before' + ending + ending
    const shifted = core.apply(revision, [{ start: 0, end: 0, insert: prefix }]).revision
    for (const current of [revision, shifted]) {
      const pending = [...core.project(current, 'markup').syntax.ast.root.children]
      const checked: unknown[] = []
      while (pending.length > 0) {
        const node = pending.shift()
        if (node === undefined) throw new Error('Expected task tree node')
        if (node.attributes.task === true) checked.push(node.attributes.checked)
        pending.unshift(...node.children)
      }
      expect(checked).toEqual([false, true, false, true, true])
    }
    expect(core.project(revision, 'original').markdown).toBe('- [x] parent\n\n  - [x] \n  - [x] same\n'.replaceAll('\n', ending))
    expect(core.project(revision, 'revised').markdown).toBe('- [ ] parent\n\n  - [ ] same\n  - [x] same\n'.replaceAll('\n', ending))
    expect(revision.source).toBe(source)
    expect(shifted.source).toBe(prefix + source)
  })
  for (const ending of ['\n', '\r\n', '\r']) {
    for (const [prefix, kind] of [['> ', 'blockquote'], ['- ', 'list']] as const) {
      it(`keeps inline replacement arms in one inherited ${kind} paragraph (${JSON.stringify(ending)})`, () => {
        const core = createDocumentCore()
        const source = prefix + '{~~old~>new~~}' + ending
        const revision = core.open(source)
        const roots = core.project(revision, 'markup').syntax.ast.root.children
        expect(roots.map(node => node.kind)).toEqual([kind])
        const contents = kind === 'list' ? roots[0]?.children[0]?.children : roots[0]?.children
        expect(contents?.map(node => node.kind)).toEqual(['paragraph'])
        expect(contents?.[0]?.children.map(node => node.attributes.semanticText).join('')).toBe('oldnew')
        expect(core.project(revision, 'original').markdown).toBe(prefix + 'old' + ending)
        expect(core.project(revision, 'revised').markdown).toBe(prefix + 'new' + ending)
        expect(revision.source).toBe(source)
      })
    }
  }
  for (const [old, replacement, kinds] of [
    ['plain', '# title', ['paragraph', 'heading']],
    ['# title', 'plain', ['heading', 'paragraph']],
    ['seed', '| a | b |\n| - | - |\n| 1 | 2 |', ['paragraph', 'table']],
    ['seed', '- item', ['paragraph', 'list']],
    ['seed', '> quote', ['paragraph', 'blockquote']]
  ] as const) {
    it(`retains independent ${kinds.join('/')} structure and both source arms`, () => {
      const source = `{~~${old}~>${replacement}~~}\n`
      const core = createDocumentCore()
      const revision = core.open(source)
      const markup = core.project(revision, 'markup')
      expect(markup.syntax.ast.root.children.map(node => node.kind)).toEqual(kinds)
      expect(markup.events.filter(event => event.kind === 'text').map(event => event.text).join(''))
        .toBe(old + replacement + '\n')
      expect(core.project(revision, 'original').markdown).toBe(old + '\n')
      expect(core.project(revision, 'revised').markdown).toBe(replacement + '\n')
      expect(revision.source).toBe(source)
    })
  }

  for (const [replacement, kind] of [['# title', 'heading'], ['- item', 'list']] as const) {
    it(`retains an independently introduced ${kind} inside an inherited quote`, () => {
      const core = createDocumentCore()
      const revision = core.open('> {~~old~>' + replacement + '~~}\n')
      const roots = core.project(revision, 'markup').syntax.ast.root.children
      expect(roots.map(node => node.kind)).toEqual(['blockquote'])
      expect(roots[0]?.children.map(node => node.kind)).toEqual(['paragraph', kind])
      expect(core.project(revision, 'original').markdown).toBe('> old\n')
      expect(core.project(revision, 'revised').markdown).toBe('> ' + replacement + '\n')
    })
  }

  it('retains a shared heading and ordinary inline replacement without introducing blocks', () => {
    const core = createDocumentCore()
    for (const source of [
      '# {~~old~>new~~}\n', 'a{~~old~>new~~}z\n',
      '{~~old~>`new`~~}', '{~~old~><https://example.com>~~}', '{~~old~>$new$~~}'
    ]) {
      const revision = core.open(source)
      expect(core.project(revision, 'markup').syntax.ast.root.children).toHaveLength(1)
    }
  })
})

it('keeps unary multiline paragraph text continuous outside the suggestion', () => {
  const core = createDocumentCore()
  const revision = core.open('{--a\nb--}{++X++}\n')
  expect(core.project(revision, 'markup').syntax.ast.root.children.map(node => node.kind)).toEqual(['paragraph'])
})

it.each(['\n', '\r\n', '\r'])('retains deleted table and following live input at its arm boundary (%j)', (ending) => {
  const core = createDocumentCore()
  const table = '| | |' + ending + '| --- | --- |' + ending + '| | |'
  const source = '{--' + table + '--}{++X++}' + ending
  const revision = core.open(source)
  const markup = core.project(revision, 'markup')
  expect(markup.syntax.ast.root.children.map(node => node.kind)).toEqual(['table', 'paragraph'])
  expect(markup.events.filter(event => event.kind === 'text').map(event => event.text).join('')).toBe(table + 'X' + ending)
  expect(core.project(revision, 'original').markdown).toBe(table + ending)
  expect(core.project(revision, 'revised').markdown).toBe('X' + ending)
  expect(revision.source).toBe(source)
})

for (const ending of ['\n', '\r\n', '\r']) {
  it(`keeps tracked list-prefix replacement in its inherited container (${JSON.stringify(ending)})`, () => {
    const source = '- same' + ending + '{~~- ~>' + ending + '  ~~}{++sa++}me{>>keep<<}' + ending + '- final' + ending
    const core = createDocumentCore()
    const revision = core.open(source)
    const markup = core.project(revision, 'markup')
    expect(markup.syntax.ast.root.children.map(node => node.kind)).toEqual(['list'])
    const items = markup.syntax.ast.root.children[0]?.children ?? []
    expect(items.map(item => item.children.map(node => node.kind))).toEqual([
      ['paragraph'], ['paragraph'], ['paragraph']
    ])
    expect(items[1]?.children[0]?.children.map(node => node.attributes.semanticText ?? node.kind)).toEqual(['same'])
    expect(core.project(revision, 'original').markdown).toBe('- same' + ending + '- me' + ending + '- final' + ending)
    expect(core.project(revision, 'revised').markdown).toBe('- same' + ending + ending + '  same' + ending + '- final' + ending)
    expect(revision.source).toBe(source)
  })
}

it('retains an independent heading interruption after an existing paragraph or list', () => {
  const core = createDocumentCore()
  for (const [prefix, first] of [['before\n', 'paragraph'], ['- before\n', 'list']]) {
    const revision = core.open(prefix + '{~~old~># new~~}\n')
    expect(core.project(revision, 'markup').syntax.ast.root.children.map(node => node.kind)).toEqual([first, 'heading'])
  }
})

it('retains independent empty heading and list prefixes before shared content', () => {
  const core = createDocumentCore()
  for (const [prefix, kind] of [['# ', 'heading'], ['- ', 'list']]) {
    const revision = core.open('{~~old~>' + prefix + '~~}shared\n')
    expect(core.project(revision, 'markup').syntax.ast.root.children.map(node => node.kind)).toEqual(['paragraph', kind])
    expect(core.project(revision, 'revised').markdown).toBe(prefix + 'shared\n')
  }
})

for (const ending of ['\n', '\r\n', '\r']) {
  for (const tracked of [false, true]) {
    it(`does not make task-marker-only content into an initial soft break (${JSON.stringify(ending)}, tracked=${tracked})`, () => {
      const source = tracked
        ? '- [x] same' + ending + '{~~- [ ] ~>' + ending + '  ~~}{++sa++}me{>>keep<<}' + ending + '- [x] final' + ending
        : '- [x] same' + ending + '- [ ] ' + ending + '  same' + ending + '- [x] final' + ending
      const core = createDocumentCore()
      const revision = core.open(source)
      const markup = core.project(revision, 'markup')
      expect(markup.syntax.ast.root.children.map(node => node.kind)).toEqual(['list'])
      const items = markup.syntax.ast.root.children[0]?.children ?? []
      expect(items.map(item => item.children.map(node => node.kind))).toEqual([
        ['paragraph'], ['paragraph'], ['paragraph']
      ])
      expect(items[1]?.attributes).toMatchObject({ task: true, checked: false })
      expect(items[1]?.children[0]?.children.map(node => node.attributes.semanticText ?? node.kind)).toEqual(['same'])
      expect(revision.source).toBe(source)
    })
  }
}

for (const ending of ['\n', '\r\n', '\r']) {
  it(`keeps imported replacement arms in their intrinsic ordered-list context (${JSON.stringify(ending)})`, () => {
    const source = ['8) same', '{~~9) {++sa++}me{>>keep<<}', '10) ~>', '   {++sa++}me{>>keep<<}', '9) ~~}final', ''].join(ending)
    const core = createDocumentCore()
    const revision = core.open(source)
    const markup = core.project(revision, 'markup')
    const nodes = [...markup.syntax.ast.root.children]
    const texts: string[] = []
    const ordinals: number[] = []
    while (nodes.length > 0) {
      const node = nodes.shift()
      if (node === undefined) throw new Error('Expected a pending AST node')
      if (node.kind === 'text') texts.push(String(node.attributes.semanticText))
      if (node.kind === 'list-item') ordinals.push(Number(node.attributes.ordinal))
      nodes.unshift(...node.children)
    }
    expect(texts).toEqual(['same', 'same', 'same', 'final'])
    expect(ordinals).toEqual([8, 9, 10, 8, 9])
    expect(core.project(revision, 'original').markdown).toBe(['8) same', '9) me', '10) final', ''].join(ending))
    expect(core.project(revision, 'revised').markdown).toBe(['8) same', '', '   same', '9) final', ''].join(ending))
    expect(core.open(revision.source).source).toBe(source)
  })
}

for (const ending of ['\n', '\r\n', '\r']) {
  for (const [prefix, continuation, kind] of [['- ', '  ', 'list'], ['> ', '> ', 'blockquote']] as const) {
    it(`retains a replacement math block inside its inherited ${kind} (${JSON.stringify(ending)})`, () => {
      const core = createDocumentCore()
      const body = '$$' + ending + continuation + ending + continuation + '$$'
      const source = prefix + '{~~/m{++a++}th~>' + body + '~~}' + ending
      const revision = core.open(source)
      const children = core.project(revision, 'markup').syntax.ast.root.children
      expect(children.map(node => node.kind)).toEqual([kind])
      const contents = kind === 'list' ? children[0]?.children[0]?.children : children[0]?.children
      expect(contents?.map(node => node.kind)).toEqual(['paragraph', 'math-block'])
      expect(core.project(revision, 'original').markdown).toBe(prefix + '/mth' + ending)
      expect(core.project(revision, 'revised').markdown).toBe(prefix + body + ending)
      expect(revision.source).toBe(source)
    })
  }
}
