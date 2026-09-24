// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

type BoundMuya = ReturnType<typeof bootBoundMuya>

const leaves = (app: BoundMuya) => {
  const found = []
  for (
    let block = app.muya.editor.scrollPage?.firstContentInDescendant();
    block != null;
    block = block.nextContentInContext()
  ) {
    found.push(block)
  }
  return found
}

const dispatch = async(
  { muya, adapter }: BoundMuya,
  inputType: string,
  data: string | null = null
) => {
  const target = muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  const event = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  muya.flush()
  await adapter.settled()
}

/** Backspace at a block's start is Muya's keydown boundary command. */
const backspace = async({ muya, adapter }: BoundMuya) => {
  const target = muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  muya.flush()
  await adapter.settled()
}

const source = (app: BoundMuya) => {
  const reply = app.binding.sourceAtBarrier()
  if (reply.type !== 'source') throw new Error('Expected source')
  return reply.source
}

const caretText = ({ muya }: BoundMuya) => {
  const anchor = muya.editor.selection.getSelection()?.anchor
  if (anchor === undefined) throw new Error('Expected selection')
  return `${anchor.block.text.slice(0, anchor.offset)}|${anchor.block.text.slice(anchor.offset)}`
}

const place = (app: BoundMuya, leaf: number, offset: number) => {
  const block = leaves(app)[leaf]
  if (block === undefined || !block.isContent()) throw new Error('Expected content leaf')
  block.setCursor(offset, offset, true)
}

// Upstream (8d6c198c) bytes and carets. Enter on an earlier line of a
// paragraph starts a paragraph whose first line is empty; its caret is there.
const cases = [
  { initial: 'a\nb\n', leaf: 0, at: 1, broken: 'a\n\n\nb\n', typed: 'a\n\nx\nb\n' },
  { initial: 'a\nb\nc\n', leaf: 0, at: 3, broken: 'a\nb\n\n\nc\n', typed: 'a\nb\n\nx\nc\n' },
  { initial: 'a\nb\nc\n', leaf: 0, at: 1, broken: 'a\n\n\nb\nc\n', typed: 'a\n\nx\nb\nc\n' },
  {
    initial: '# h\n\na\nb\n',
    leaf: 1,
    at: 1,
    broken: '# h\n\na\n\n\nb\n',
    typed: '# h\n\na\n\nx\nb\n'
  },
  { initial: '- a\n  b\n', leaf: 0, at: 1, broken: '- a\n- \n  b\n', typed: '- a\n- x\n  b\n' },
  {
    initial: '1. a\n   b\n',
    leaf: 0,
    at: 1,
    broken: '1. a\n2. \n   b\n',
    typed: '1. a\n2. x\n   b\n'
  },
  {
    initial: '- [ ] a\n  b\n',
    leaf: 0,
    at: 1,
    broken: '- [ ] a\n- [ ] \n  b\n',
    typed: '- [ ] a\n- [ ] x\n  b\n'
  },
  {
    initial: '> a\n> b\n',
    leaf: 0,
    at: 1,
    broken: '> a\n>\n> \n> b\n',
    typed: '> a\n>\n> x\n> b\n'
  },
  {
    initial: '> - a\n>   b\n',
    leaf: 0,
    at: 1,
    broken: '> - a\n> - \n>   b\n',
    typed: '> - a\n> - x\n>   b\n'
  },
  {
    initial: '- a\n\n  b\n  c\n',
    leaf: 1,
    at: 1,
    broken: '- a\n\n  b\n\n  \n  c\n',
    typed: '- a\n\n  b\n\n  x\n  c\n'
  },
  // CRLF documents keep CRLF; upstream mixes in LF here.
  {
    initial: 'a\r\nb\r\n',
    leaf: 0,
    at: 1,
    broken: 'a\r\n\r\n\r\nb\r\n',
    typed: 'a\r\n\r\nx\r\nb\r\n'
  }
]

describe('Enter on an earlier line of a paragraph', () => {
  it.each(cases)(
    'breaks $initial at $at and types on the new first line',
    async({ initial, leaf, at, broken, typed }) => {
      const app = bootBoundMuya(initial)
      try {
        place(app, leaf, at)
        await dispatch(app, 'insertParagraph')
        expect(source(app)).toBe(broken)
        expect(caretText(app).replace('\r', '')).toMatch(/^\|\n/u)
        await dispatch(app, 'insertText', 'x')
        expect(source(app)).toBe(typed)
        expect(caretText(app)).toMatch(/^x\|(?:\r?\n)/u)
        await app.adapter.history('undo', app.reconcile)
        expect(source(app)).toBe(broken)
        // The restored caret is on the empty first line again.
        await dispatch(app, 'insertText', 'y')
        expect(source(app)).toBe(typed.replace('x', 'y'))
        await app.adapter.history('undo', app.reconcile)
        await app.adapter.history('undo', app.reconcile)
        expect(source(app)).toBe(initial)
      } finally {
        app.dispose()
      }
    }
  )

  it('breaks the same line twice as upstream', async() => {
    const app = bootBoundMuya('a\nb\n')
    try {
      place(app, 0, 1)
      await dispatch(app, 'insertParagraph')
      await dispatch(app, 'insertParagraph')
      expect(source(app)).toBe('a\n\n\n\n\nb\n')
      expect(caretText(app)).toBe('|\nb')
      await backspace(app)
      expect(source(app)).toBe('a\n\n\nb\n')
      expect(caretText(app)).toBe('|\nb')
    } finally {
      app.dispose()
    }
  })

  // Upstream Backspace on the empty first line joins its paragraph back.
  it.each([
    { initial: 'a\nb\n', at: 1, steps: [['a\nb\n', 'a|\nb']], typed: 'ax\nb\n' },
    { initial: 'a\nb\nc\n', at: 3, steps: [['a\nb\nc\n', 'a\nb|\nc']], typed: 'a\nbx\nc\n' },
    { initial: '> a\n> b\n', at: 1, steps: [['> a\n> b\n', 'a|\nb']], typed: '> ax\n> b\n' },
    {
      initial: '- a\n  b\n',
      at: 1,
      steps: [
        ['- a\n\n  \n  b\n', '|\nb'],
        ['- a\n  b\n', 'a|\nb']
      ],
      typed: '- ax\n  b\n'
    },
    {
      initial: '1. a\n   b\n',
      at: 1,
      steps: [
        ['1. a\n\n   \n   b\n', '|\nb'],
        ['1. a\n   b\n', 'a|\nb']
      ],
      typed: '1. ax\n   b\n'
    },
    {
      initial: '- [ ] a\n  b\n',
      at: 1,
      steps: [
        ['- [ ] a\n\n  \n  b\n', '|\nb'],
        ['- [ ] a\n  b\n', 'a|\nb']
      ],
      typed: '- [ ] ax\n  b\n'
    },
    {
      initial: '> - a\n>   b\n',
      at: 1,
      steps: [
        ['> - a\n>\n>   \n>   b\n', '|\nb'],
        ['> - a\n>   b\n', 'a|\nb']
      ],
      typed: '> - ax\n>   b\n'
    }
  ])('joins $initial back with Backspace', async({ initial, at, steps, typed }) => {
    const app = bootBoundMuya(initial)
    try {
      place(app, 0, at)
      await dispatch(app, 'insertParagraph')
      for (const [expected, caret] of steps) {
        await backspace(app)
        expect(source(app)).toBe(expected)
        expect(caretText(app)).toBe(caret)
      }
      await dispatch(app, 'insertText', 'x')
      expect(source(app)).toBe(typed)
    } finally {
      app.dispose()
    }
  })
})
