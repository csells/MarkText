// @vitest-environment jsdom
import { createDocumentCore, type MarkdownAstNode } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

type BoundMuya = ReturnType<typeof bootBoundMuya>

const typeAt = async(
  source: string,
  offset: number,
  typed: string,
  tracked = false,
  block = 0
): Promise<string> => {
  const app = bootBoundMuya(source)
  app.track(tracked)
  try {
    const content = app.muya.editor.scrollPage?.queryBlock([block, 'text'])
    if (content == null || !content.isContent()) throw new Error('Expected content leaf')
    content.setCursor(offset, offset, true)
    for (const data of typed) dispatchText(app, data)
    // A refused keystroke faults the adapter and rejects here.
    await app.adapter.settled()
    const reply = app.binding.sourceAtBarrier()
    if (reply.type !== 'source') throw new Error('Expected source')
    return reply.source
  } finally {
    app.dispose()
  }
}

const dispatchText = ({ muya }: BoundMuya, data: string): void => {
  const target = muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  const event = new InputEvent('beforeinput', {
    inputType: 'insertText',
    data,
    bubbles: true,
    cancelable: true
  })
  target.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  muya.flush()
}

const dispatchInput = ({ muya }: BoundMuya, inputType: string): void => {
  const target = muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  muya.flush()
}

const keys = [
  '`',
  '```',
  '*',
  '**',
  '_',
  '~',
  '$',
  '# ',
  '- ',
  '[',
  '<',
  '<div>',
  '|',
  '\\',
  '{',
  '    '
]

// Bytes produced by upstream MarkText (pre-integration 8d6c198c) for the same
// keystrokes, including its default auto-pairing.
const upstream: ReadonlyArray<{ source: string; offset: number; results: Record<string, string> }> =
  [
    {
      source: 'plain tail\n',
      offset: 0,
      results: {
        '`': '`plain tail\n',
        '```': '```plain tail\n',
        '*': '**plain tail\n',
        '**': '****plain tail\n',
        _: '__plain tail\n',
        '~': '~~plain tail\n',
        $: '$$plain tail\n',
        '# ': '# plain tail\n',
        '- ': '- plain tail\n',
        '[': '[plain tail\n',
        '<': '<plain tail\n',
        '<div>': '<div>plain tail\n',
        '|': '|plain tail\n',
        '\\': '\\plain tail\n',
        '{': '{plain tail\n',
        '    ': '    plain tail\n'
      }
    },
    {
      source: 'lead add tail\n',
      offset: 6,
      results: {
        '`': 'lead a`dd tail\n',
        '```': 'lead a```dd tail\n',
        '*': 'lead a*dd tail\n',
        '**': 'lead a***dd tail\n',
        _: 'lead a_dd tail\n',
        '~': 'lead a~dd tail\n',
        $: 'lead a$dd tail\n',
        '# ': 'lead a# dd tail\n',
        '- ': 'lead a- dd tail\n',
        '[': 'lead a[dd tail\n',
        '<': 'lead a<dd tail\n',
        '<div>': 'lead a<div>dd tail\n',
        '|': 'lead a|dd tail\n',
        '\\': 'lead a\\dd tail\n',
        '{': 'lead a{dd tail\n',
        '    ': 'lead a    dd tail\n'
      }
    }
  ]

/**
 * Annotated lines and their plain equivalents with the same visible text.
 * `sourceOffset` is where the caret at visible `offset` lives in source.
 */
const annotated: ReadonlyArray<{
  name: string
  source: string
  plain: string
  offset: number
  sourceOffset: number
  /** Upstream bytes where the delimiter beside the caret changes its pairing. */
  upstream?: Readonly<Record<string, string>>
}> = [
  // Upstream treats the annotation as literal text, so its visible line start
  // is before the opener; one ArrowRight enters the annotation.
  {
    name: 'line start before an addition',
    source: '{++add++} tail\n',
    plain: 'add tail\n',
    offset: 0,
    sourceOffset: 0
  },
  {
    name: 'line-leading addition after text',
    source: '{++add++} tail\n',
    plain: 'add tail\n',
    offset: 1,
    sourceOffset: 4
  },
  {
    name: 'addition',
    source: 'lead {++add++} tail\n',
    plain: 'lead add tail\n',
    offset: 6,
    sourceOffset: 9
  },
  // Upstream sees the closer's `+` after the caret, which touches a bracket,
  // just as a Markdown closer such as `**` does.
  {
    name: 'addition end',
    source: 'lead {++add++} tail\n',
    plain: 'lead add tail\n',
    offset: 8,
    sourceOffset: 11,
    upstream: { '[': '[', '{': '{' }
  },
  {
    name: 'deletion',
    source: 'lead {--add--} tail\n',
    plain: 'lead add tail\n',
    offset: 6,
    sourceOffset: 9
  },
  {
    name: 'highlight',
    source: 'lead {==add==} tail\n',
    plain: 'lead add tail\n',
    offset: 6,
    sourceOffset: 9
  },
  {
    name: 'substitution old arm',
    source: 'lead {~~add~>new~~} tail\n',
    plain: 'lead addnew tail\n',
    offset: 6,
    sourceOffset: 9
  },
  {
    name: 'substitution new arm',
    source: 'lead {~~old~>add~~} tail\n',
    plain: 'lead oldadd tail\n',
    offset: 9,
    sourceOffset: 14
  }
]

const insertedAt = (before: string, after: string, offset: number): string => {
  const inserted = after.slice(offset, offset + after.length - before.length)
  expect(before.slice(0, offset) + inserted + before.slice(offset)).toBe(after)
  return inserted
}

const view = (source: string, name: 'original' | 'revised'): string => {
  const core = createDocumentCore()
  return core.project(core.open(source), name).markdown
}

/**
 * Rendering identity of a view: its Markdown tree without spelling. A tracked
 * final escape or a block literal ending at its arm's end is spelled
 * differently from, but renders the same as, the untracked text.
 */
const rendered = (source: string, name: 'original' | 'revised'): string => {
  const markdown = view(source, name)
  const core = createDocumentCore()
  const tree = (node: MarkdownAstNode): unknown => [
    node.kind,
    Object.entries(node.attributes).filter(
      ([key, value]) => !(typeof value === 'number' && /(?:Start|End)$/u.test(key))
    ),
    node.children.map(tree)
  ]
  return JSON.stringify(tree(core.project(core.open(markdown), 'revised').ast.root))
}

describe('native typing of Markdown syntax is admitted', () => {
  for (const { source, offset, results } of upstream) {
    it.each(keys)(`types %j into ${JSON.stringify(source)} with upstream bytes`, async(typed) => {
      expect(await typeAt(source, offset, typed)).toBe(results[typed])
    })
  }

  for (const context of annotated) {
    it.each(keys)(`types %j in the ${context.name} as upstream types its text`, async(typed) => {
      const plain = await typeAt(context.plain, context.offset, typed)
      const inserted = context.upstream?.[typed] ?? insertedAt(context.plain, plain, context.offset)
      expect(await typeAt(context.source, context.offset, typed)).toBe(
        context.source.slice(0, context.sourceOffset) +
          inserted +
          context.source.slice(context.sourceOffset)
      )
    })
  }

  // Accepting a tracked keystroke yields ordinary typing; rejecting it yields
  // the text before the keystroke.
  const trackedContexts = [
    { name: 'mid-line text', source: 'lead add tail\n', offset: 6, keys, suggests: true },
    // An author's own proposed text is edited in place.
    { name: 'own addition', source: 'lead {++add++} tail\n', offset: 6, keys, suggests: false },
    { name: 'highlight', source: 'lead {==add==} tail\n', offset: 6, keys, suggests: true },
    {
      name: 'substitution new arm',
      source: 'lead {~~old~>add~~} tail\n',
      offset: 9,
      keys,
      suggests: false
    },
    // Block-literal openers and a trailing backslash widen over the retained
    // text whose meaning they change.
    { name: 'line start', source: 'plain tail\n', offset: 0, keys, suggests: true },
    { name: 'line end', source: 'plain tail\n', offset: 10, keys, suggests: true },
    {
      name: 'line start after a paragraph',
      source: 'lead\n\nplain tail\n',
      offset: 0,
      keys,
      suggests: true,
      block: 1
    }
  ]
  for (const context of trackedContexts) {
    it.each(context.keys)(`tracks %j in the ${context.name} with ordinary bytes`, async(typed) => {
      const ordinary = await typeAt(context.source, context.offset, typed, false, context.block)
      const tracked = await typeAt(context.source, context.offset, typed, true, context.block)
      expect(tracked !== ordinary).toBe(context.suggests)
      expect(rendered(tracked, 'revised')).toBe(rendered(ordinary, 'revised'))
      expect(rendered(tracked, 'original')).toBe(rendered(context.source, 'original'))
    })
  }

  // Typing inside tracked history splits it at the caret: the typed text is a
  // new Addition between the retained deleted or old text.
  for (const context of [
    { name: 'deletion', source: 'lead {--add--} tail\n', offset: 6 },
    { name: 'substitution old arm', source: 'lead {~~add~>new~~} tail\n', offset: 6 }
  ]) {
    it.each(keys)(`tracks %j typed inside the ${context.name} as a split`, async(typed) => {
      const tracked = await typeAt(context.source, context.offset, typed, true)
      expect(tracked).toMatch(/\{\+\+[^]*\+\+\}/u)
      expect(view(tracked, 'original')).toBe(view(context.source, 'original'))
      expect(view(tracked, 'revised')).not.toBe(view(context.source, 'revised'))
    })

    it(`rejoins the ${context.name} when Backspace removes the split text`, async() => {
      const app = bootBoundMuya(context.source)
      app.track(true)
      try {
        const content = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
        if (content == null || !content.isContent()) throw new Error('Expected content leaf')
        content.setCursor(context.offset, context.offset, true)
        dispatchText(app, 'X')
        dispatchText(app, 'Y')
        await app.adapter.settled()
        const typed = app.binding.sourceAtBarrier()
        if (typed.type !== 'source') throw new Error('Expected source')
        expect(typed.source).toContain('{++XY++}')
        for (let index = 0; index < 2; index += 1) dispatchInput(app, 'deleteContentBackward')
        await app.adapter.settled()
        const reply = app.binding.sourceAtBarrier()
        if (reply.type !== 'source') throw new Error('Expected source')
        expect(reply.source).toBe(context.source)
      } finally {
        app.dispose()
      }
    })
  }
})

const typeOnLine = async(source: string, offset: number, typed: string, tracked = false) => {
  const app = bootBoundMuya(source)
  app.track(tracked)
  try {
    const content = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (content == null || !content.isContent()) throw new Error('Expected content leaf')
    content.setCursor(offset, offset, true)
    for (const data of typed) dispatchText(app, data)
    await app.adapter.settled()
    const reply = app.binding.sourceAtBarrier()
    if (reply.type !== 'source') throw new Error('Expected source')
    const anchor = app.muya.editor.selection.getSelection()?.anchor
    return { source: reply.source, text: anchor?.block.text, offset: anchor?.offset }
  } finally {
    app.dispose()
  }
}

describe('native typing of a block marker on a later paragraph line', () => {
  // The blocks upstream (8d6c198c) makes of the same keys, with the other
  // lines' bytes kept where upstream re-spells them (ADR 0007; plan 0012 G24);
  // `offset` is within the multi-line paragraph's text. A converted quote's caret stays before
  // the quoted text, as on a first line; upstream's measure from the
  // paragraph's start slips it into a later line's text.
  it.each([
    {
      source: 'first\nsecond\n',
      offset: 6,
      typed: '>x',
      expected: 'first\n> xsecond\n',
      text: 'xsecond',
      caret: 1
    },
    {
      source: 'first\nsecond\nthird\n',
      offset: 6,
      typed: '>',
      expected: 'first\n> second\nthird\n',
      text: 'second\nthird',
      caret: 0
    },
    {
      source: 'first\nsecond\nthird\n',
      offset: 6,
      typed: '# x',
      expected: 'first\n# xsecond\nthird\n',
      text: '# xsecond',
      caret: 3
    },
    {
      source: 'first\nsecond\nthird\n',
      offset: 6,
      typed: '- x',
      expected: 'first\n- xsecond\nthird\n',
      text: 'xsecond\nthird',
      caret: 1
    },
    {
      source: 'first\nsecond\nthird\n',
      offset: 6,
      typed: '1. x',
      expected: 'first\n1. xsecond\nthird\n',
      text: 'xsecond\nthird',
      caret: 1
    },
    {
      source: 'first\nsecond\n',
      offset: 6,
      typed: '2. x',
      expected: 'first\n\n2. xsecond\n',
      text: 'xsecond',
      caret: 1
    },
    {
      source: 'first\nsecond\nthird\n',
      offset: 0,
      typed: '>x',
      expected: '> xfirst\nsecond\nthird\n',
      text: 'xfirst\nsecond\nthird',
      caret: 1
    },
    {
      source: 'first\nsecond\n',
      offset: 0,
      typed: '# x',
      expected: '# xfirst\nsecond\n',
      text: '# xfirst',
      caret: 3
    },
    {
      source: 'first\nsecond\n',
      offset: 0,
      typed: '- x',
      expected: '- xfirst\nsecond\n',
      text: 'xfirst\nsecond',
      caret: 1
    }
  ])(
    'types $typed at $offset of $source',
    async({ source, offset, typed, expected, text, caret }) => {
      expect(await typeOnLine(source, offset, typed)).toEqual({
        source: expected,
        text,
        offset: caret
      })
    }
  )

  // Upstream converts the paragraph's first line to an indented code block on
  // its fourth leading space, separating the lines that stay paragraph text.
  it.each([
    { source: 'first\nsecond\n', typed: '    ', expected: '    first\n\nsecond\n' },
    { source: 'first\nsecond\nthird\n', typed: '    ', expected: '    first\n\nsecond\nthird\n' },
    { source: 'first\n    second\n', typed: '    ', expected: '    first\n    second\n' },
    {
      source: 'first\n    second\nthird\n',
      typed: '    ',
      expected: '    first\n    second\n\nthird\n'
    },
    { source: '  first\nsecond\n', typed: '  ', expected: '    first\n\nsecond\n' },
    { source: 'first\r\nsecond\r\n', typed: '    ', expected: '    first\r\n\r\nsecond\r\n' },
    { source: '> first\n> second\n', typed: '    ', expected: '>     first\n>\n> second\n' },
    { source: '- first\n  second\n', typed: '    ', expected: '-     first\n\n  second\n' },
    { source: '1. first\n   second\n', typed: '    ', expected: '1.     first\n\n   second\n' },
    { source: 'first\nsecond\n', typed: '   ', expected: '   first\nsecond\n' }
  ])('types $typed at the start of $source as upstream', async({ source, typed, expected }) => {
    expect((await typeOnLine(source, 0, typed)).source).toBe(expected)
  })

  it('keeps the caret at the converted code line start as upstream', async() => {
    expect(await typeOnLine('first\nsecond\n', 0, '    x')).toEqual({
      source: '    xfirst\n\nsecond\n',
      text: 'xfirst',
      offset: 1
    })
  })

  it('keeps four spaces typed on a later line as paragraph text', async() => {
    expect((await typeOnLine('first\nsecond\n', 6, '    ')).source).toBe('first\n    second\n')
  })

  it.each([
    // Container lines are covered in muya-container-line-start-caret.spec.ts.
    {
      source: 'first\n{++second++}\n',
      offset: 6,
      typed: '>',
      expected: 'first\n> {++second++}\n'
    },
    {
      source: '{++first\nsecond++}\nthird\n',
      offset: 6,
      typed: '# ',
      expected: '{++first\n# second++}\nthird\n'
    }
  ])(
    'types $typed on an annotated line of $source',
    async({ source, offset, typed, expected }) => {
      expect((await typeOnLine(source, offset, typed)).source).toBe(expected)
    }
  )

  it.each([
    { source: 'first\nsecond\nthird\n', offset: 6, typed: '>' },
    { source: 'first\nsecond\nthird\n', offset: 6, typed: '# ' },
    { source: 'first\nsecond\nthird\n', offset: 6, typed: '- ' },
    { source: 'first\nsecond\nthird\n', offset: 0, typed: '1. ' }
  ])(
    'tracks $typed at $offset of $source as the ordinary conversion',
    async({ source, offset, typed }) => {
      const ordinary = (await typeOnLine(source, offset, typed)).source
      const tracked = (await typeOnLine(source, offset, typed, true)).source
      expect(tracked).not.toBe(ordinary)
      expect(view(tracked, 'revised')).toBe(view(ordinary, 'revised'))
      expect(view(tracked, 'original')).toBe(view(source, 'original'))
    }
  )
})

const editAt = async(
  source: string,
  offset: number,
  keys: string,
  tracked = false,
  path: Array<number | string> = [0, 'text']
) => {
  const app = bootBoundMuya(source)
  app.track(tracked)
  try {
    const content = app.muya.editor.scrollPage?.queryBlock(path)
    if (content == null || !content.isContent()) throw new Error('Expected content leaf')
    content.setCursor(offset, offset, true)
    for (const key of keys) {
      if (key === '\b') dispatchInput(app, 'deleteContentBackward')
      else dispatchText(app, key)
    }
    await app.adapter.settled()
    const reply = app.binding.sourceAtBarrier()
    if (reply.type !== 'source') throw new Error('Expected source')
    const anchor = app.muya.editor.selection.getSelection()?.anchor
    return { source: reply.source, text: anchor?.block.text, offset: anchor?.offset }
  } finally {
    app.dispose()
  }
}

describe('native input re-evaluates a paragraph as upstream', () => {
  // The blocks upstream (8d6c198c) makes of the same input anywhere in the
  // paragraph, with the other lines' bytes kept where upstream re-spells them
  // (ADR 0007); `\b` is Backspace. `offset` is within the edited block's text.
  it.each([
    { source: 'a\n2. b\n', offset: 1, keys: 'x', expected: 'ax\n\n2. b\n', text: 'b', caret: 0 },
    { source: 'a\n2. b\n', offset: 6, keys: 'x', expected: 'a\n\n2. bx\n', text: 'bx', caret: 0 },
    {
      source: 'a\n1999. It\n',
      offset: 0,
      keys: 'x',
      expected: 'xa\n\n1999. It\n',
      text: 'It',
      caret: 0
    },
    { source: 'ab\n2. b\n', offset: 2, keys: '\b', expected: 'a\n\n2. b\n', text: 'b', caret: 0 },
    {
      source: 'a\n2. b\n3. c\nd\n',
      offset: 1,
      keys: 'x',
      expected: 'ax\n2. b\n\n3. c\nd\n',
      text: 'c\nd',
      caret: 0
    },
    { source: 'a\n**\n', offset: 4, keys: '*', expected: 'a\n****\n', text: '****', caret: 3 },
    {
      source: 'a\n=== x\nb\n',
      offset: 1,
      keys: 'y',
      expected: 'ay\n===\nb\n',
      text: 'ay',
      caret: 2
    },
    // Upstream's quote caret slips into the quoted text; it stays before it.
    {
      source: 'aaaa\nb\nccccccc\n',
      offset: 5,
      keys: '>',
      expected: 'aaaa\n> b\nccccccc\n',
      text: 'b\nccccccc',
      caret: 0
    },
    // Upstream parses a later list line in a list item as a nested list already.
    {
      source: '- a\n  2. b\n',
      offset: 1,
      keys: 'x',
      expected: '- ax\n  2. b\n',
      text: 'ax',
      caret: 2,
      path: [0, 'children', 0, 'children', 0, 'text']
    },
    {
      source: '> a\n> 2. b\n',
      offset: 1,
      keys: 'x',
      expected: '> ax\n>\n> 2. b\n',
      text: 'b',
      caret: 0,
      path: [0, 'children', 0, 'text']
    },
    // A task item is written apart from its list.
    {
      source: '- a\n- [ ]b\n- c\n',
      offset: 3,
      keys: ' ',
      expected: '- a\n\n- [ ] b\n\n- c\n',
      text: 'b',
      caret: 0,
      path: [0, 'children', 1, 'children', 0, 'text']
    }
  ])(
    '$keys at $offset of $source',
    async({ source, offset, keys, expected, text, caret, path }) => {
      expect(await editAt(source, offset, keys, false, path)).toEqual({
        source: expected,
        text,
        offset: caret
      })
    }
  )

  it('tracks the conversion as a suggestion of the same text', async() => {
    const tracked = (await editAt('a\n2. b\n', 1, 'x', true)).source
    expect(view(tracked, 'original')).toBe('a\n2. b\n')
    expect(view(tracked, 'revised')).toBe('ax\n\n2. b\n')
  })
})
