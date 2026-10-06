// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import type { MaybeContent } from '../helpers/muyaTypes'

type BoundMuya = ReturnType<typeof bootBoundMuya>

const leaves = (app: BoundMuya) => {
  const found = []
  for (
    let block: MaybeContent = app.muya.editor.scrollPage?.firstContentInDescendant();
    block != null;
    block = block.nextContentInContext()
  ) {
    found.push(block)
  }
  return found
}

const input = async(
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

const source = (app: BoundMuya) => {
  const reply = app.binding.sourceAtBarrier()
  if (reply.type !== 'source') throw new Error('Expected source')
  return reply.source
}

/** Places the caret with End at the end of the last content leaf. */
const endOfLast = (app: BoundMuya) => {
  const leaf = leaves(app).at(-1)
  if (leaf === undefined || !leaf.isContent()) throw new Error('Expected content leaf')
  leaf.setCursor(leaf.text.length, leaf.text.length, true)
  leaf.domNode?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })
  )
  app.muya.flush()
}

// Upstream (#5597) renders an ordered item's task marker as a checkbox in an
// ordered task list that draws no numbers, and continues it with the next
// number and an unchecked task.
describe('ordered task items', () => {
  it('renders an ordered task list with its start and a checkbox per item', () => {
    const app = bootBoundMuya('5. [x] a\n6. [ ] b\n')
    try {
      const root = app.muya.editor.scrollPage?.domNode
      if (!(root instanceof HTMLElement)) throw new Error('Expected rendered document')
      const list = root.querySelector('ol.mu-task-list')
      expect(list?.getAttribute('start')).toBe('5')
      expect(root.querySelectorAll('.mu-task-list-checkbox')).toHaveLength(2)
      expect(root.querySelectorAll('.mu-checkbox-checked')).toHaveLength(1)
      expect(leaves(app).map((leaf) => leaf.text)).toEqual(['a', 'b'])
    } finally {
      app.dispose()
    }
  })

  it.each([
    {
      initial: '1. [ ] c\n',
      typed: '1. [ ] cx\n',
      broken: '1. [ ] cx\n2. [ ] \n',
      last: '1. [ ] cx\n2. [ ] y\n'
    },
    {
      initial: '2) [x] c\n',
      typed: '2) [x] cx\n',
      broken: '2) [x] cx\n3) [ ] \n',
      last: '2) [x] cx\n3) [ ] y\n'
    },
    {
      initial: '- a\n  1. [ ] c\n',
      typed: '- a\n  1. [ ] cx\n',
      broken: '- a\n  1. [ ] cx\n  2. [ ] \n',
      last: '- a\n  1. [ ] cx\n  2. [ ] y\n'
    },
    {
      initial: '> 1. [ ] c\n',
      typed: '> 1. [ ] cx\n',
      broken: '> 1. [ ] cx\n> 2. [ ] \n',
      last: '> 1. [ ] cx\n> 2. [ ] y\n'
    },
    {
      initial: '1. [ ] c\r\n',
      typed: '1. [ ] cx\r\n',
      broken: '1. [ ] cx\r\n2. [ ] \r\n',
      last: '1. [ ] cx\r\n2. [ ] y\r\n'
    }
  ])('loads, renders and edits $initial', async({ initial, typed, broken, last }) => {
    const app = bootBoundMuya(initial)
    try {
      const root = app.muya.editor.scrollPage?.domNode
      if (!(root instanceof HTMLElement)) throw new Error('Expected rendered document')
      expect(root.querySelector('ol.mu-task-list')).not.toBeNull()
      expect(root.querySelectorAll('.mu-task-list-checkbox')).toHaveLength(1)
      expect(leaves(app).at(-1)?.text).toBe('c')
      endOfLast(app)
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe(typed)
      await input(app, 'insertParagraph')
      expect(source(app)).toBe(broken)
      expect(root.querySelectorAll('.mu-task-list-checkbox')).toHaveLength(2)
      await input(app, 'insertText', 'y')
      expect(source(app)).toBe(last)
      for (let undo = 0; undo < 3; undo += 1) await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(initial)
    } finally {
      app.dispose()
    }
  })

  it('loads and breaks an annotated ordered task item', async() => {
    const app = bootBoundMuya('1. [ ] {++c++}\n')
    try {
      expect(leaves(app).map((leaf) => leaf.text)).toEqual(['c'])
      endOfLast(app)
      await input(app, 'insertParagraph')
      expect(source(app)).toBe('1. [ ] {++c++}\n2. [ ] \n')
      await input(app, 'insertText', 'y')
      expect(source(app)).toBe('1. [ ] {++c++}\n2. [ ] y\n')
    } finally {
      app.dispose()
    }
  })

  it('renders bullet and ordered task items beside each other with checkboxes', async() => {
    const app = bootBoundMuya('- [x] a\n\n1. [ ] b\n')
    try {
      const root = app.muya.editor.scrollPage?.domNode
      if (!(root instanceof HTMLElement)) throw new Error('Expected rendered document')
      expect(root.querySelectorAll('.mu-task-list-checkbox')).toHaveLength(2)
      expect(leaves(app).map((leaf) => leaf.text)).toEqual(['a', 'b'])
    } finally {
      app.dispose()
    }
  })
})
