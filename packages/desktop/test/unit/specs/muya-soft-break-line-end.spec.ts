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

const dispatchInput = ({ muya }: BoundMuya, inputType: string, data: string | null): void => {
  const target = muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  const event = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  muya.flush()
}

const input = async(app: BoundMuya, inputType: string, data: string | null = null) => {
  dispatchInput(app, inputType, data)
  await app.adapter.settled()
}

const source = (app: BoundMuya) => {
  const reply = app.binding.sourceAtBarrier()
  if (reply.type !== 'source') throw new Error('Expected source')
  return reply.source
}

/** Places the caret with End at the end of the `index`th content leaf. */
const endOf = (app: BoundMuya, index = 0) => {
  const leaf = leaves(app)[index]
  if (leaf === undefined || !leaf.isContent()) throw new Error('Expected content leaf')
  leaf.setCursor(leaf.text.length, leaf.text.length, true)
  const target = leaf.domNode
  target?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })
  )
  app.muya.flush()
}

// Upstream (8d6c198c) bytes for Shift+Enter at the end of the first line, then `x`.
const cases = [
  { initial: 'first\n', broken: 'first\n\n', typed: 'first\nx\n' },
  { initial: 'first\r\n', broken: 'first\r\n\r\n', typed: 'first\r\nx\r\n' },
  { initial: 'first', broken: 'first\n', typed: 'first\nx' },
  { initial: 'first  \n', broken: 'first  \n\n', typed: 'first  \nx\n' },
  { initial: 'zero\nfirst\n', broken: 'zero\nfirst\n\n', typed: 'zero\nfirst\nx\n' },
  { initial: 'first\n\nsecond\n', broken: 'first\n\n\nsecond\n', typed: 'first\nx\n\nsecond\n' },
  { initial: '> first\n', broken: '> first\n> \n', typed: '> first\n> x\n' },
  { initial: '> first\r\n', broken: '> first\r\n> \r\n', typed: '> first\r\n> x\r\n' },
  { initial: '- first\n', broken: '- first\n  \n', typed: '- first\n  x\n' },
  { initial: '1. first\n', broken: '1. first\n   \n', typed: '1. first\n   x\n' },
  { initial: '> - first\n', broken: '> - first\n>   \n', typed: '> - first\n>   x\n' },
  { initial: '- a\n- b\n', broken: '- a\n  \n- b\n', typed: '- a\n  x\n- b\n' },
  // The End rule puts the caret after trailing closers, as upstream's literal text.
  { initial: 'first {++a++}\n', broken: 'first {++a++}\n\n', typed: 'first {++a++}\nx\n' },
  { initial: 'first {>>c<<}\n', broken: 'first {>>c<<}\n\n', typed: 'first {>>c<<}\nx\n' },
  { initial: 'first {~~a~>b~~}\n', broken: 'first {~~a~>b~~}\n\n', typed: 'first {~~a~>b~~}\nx\n' },
  { initial: '> {++first++}\n', broken: '> {++first++}\n> \n', typed: '> {++first++}\n> x\n' },
  // Upstream Shift+Enter at a heading's end starts a paragraph, as Enter does.
  { initial: '# first\n', broken: '# first\n\n\n', typed: '# first\n\nx\n' }
]

describe('Shift+Enter at the end of a line', () => {
  it.each(cases)(
    'breaks $initial and types on the new line',
    async({ initial, broken, typed }) => {
      const app = bootBoundMuya(initial)
      try {
        endOf(app)
        await input(app, 'insertLineBreak')
        expect(source(app)).toBe(broken)
        await input(app, 'insertText', 'x')
        expect(source(app)).toBe(typed)
        await input(app, 'insertText', 'y')
        expect(source(app)).toBe(typed.replace('x', 'xy'))
        await app.adapter.history('undo', app.reconcile)
        expect(source(app)).toBe(broken)
        // The restored caret is on the new line again.
        await input(app, 'insertText', 'z')
        expect(source(app)).toBe(typed.replace('x', 'z'))
        await app.adapter.history('undo', app.reconcile)
        await app.adapter.history('undo', app.reconcile)
        expect(source(app)).toBe(initial)
        await app.adapter.history('redo', app.reconcile)
        expect(source(app)).toBe(broken)
        await input(app, 'insertText', 'x')
        expect(source(app)).toBe(typed)
      } finally {
        app.dispose()
      }
    }
  )

  it.each([
    { initial: 'first\n', broken: 'first\n\n' },
    { initial: '> first\n', broken: '> first\n> \n' },
    { initial: '- first\r\n', broken: '- first\r\n  \r\n' }
  ])(
    'removes the new line of $initial with Backspace and types at the end again',
    async({ initial, broken }) => {
      const app = bootBoundMuya(initial)
      try {
        endOf(app)
        await input(app, 'insertLineBreak')
        expect(source(app)).toBe(broken)
        await input(app, 'deleteContentBackward')
        expect(source(app)).toBe(initial)
        await input(app, 'insertText', 'x')
        expect(source(app)).toBe(initial.replace('first', 'firstx'))
      } finally {
        app.dispose()
      }
    }
  )

  it('breaks twice at the end and types on the last line', async() => {
    const app = bootBoundMuya('first\n')
    try {
      endOf(app)
      await input(app, 'insertLineBreak')
      await input(app, 'insertLineBreak')
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe('first\n\nx\n')
    } finally {
      app.dispose()
    }
  })

  // Upstream: a heading's soft break splits it as Enter does; a setext
  // heading's continues its text.
  it.each([
    { initial: '# first\n', at: 4, typed: '# fi\n\nxrst\n' },
    { initial: '## first\r\n', at: 8, typed: '## first\r\n\r\nx\r\n' },
    { initial: 'first\n===\n', at: 2, typed: 'fi\nxrst\n===\n' }
  ])('breaks the heading $initial at $at and types', async({ initial, at, typed }) => {
    const app = bootBoundMuya(initial)
    try {
      const leaf = leaves(app)[0]
      if (leaf === undefined || !leaf.isContent()) throw new Error('Expected heading')
      leaf.setCursor(at, at, true)
      await input(app, 'insertLineBreak')
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe(typed)
    } finally {
      app.dispose()
    }
  })

  // Upstream: a soft break in a quoted or listed setext heading continues
  // its containers on the new line.
  it.each([
    {
      initial: '> first\n> ===\n',
      at: 2,
      broken: '> fi\n> rst\n> ===\n',
      typed: '> fi\n> xrst\n> ===\n'
    },
    {
      initial: '- first\n  ===\n',
      at: 2,
      broken: '- fi\n  rst\n  ===\n',
      typed: '- fi\n  xrst\n  ===\n'
    },
    {
      initial: '> - first\n>   ===\n',
      at: 2,
      broken: '> - fi\n>   rst\n>   ===\n',
      typed: '> - fi\n>   xrst\n>   ===\n'
    }
  ])(
    'breaks the contained setext heading $initial at $at',
    async({ initial, at, broken, typed }) => {
      const app = bootBoundMuya(initial)
      try {
        const leaf = leaves(app)[0]
        if (leaf === undefined || !leaf.isContent()) throw new Error('Expected heading')
        leaf.setCursor(at, at, true)
        await input(app, 'insertLineBreak')
        expect(source(app)).toBe(broken)
        expect(leaves(app)[0]?.text).toBe('fi\nrst')
        await input(app, 'insertText', 'x')
        expect(source(app)).toBe(typed)
      } finally {
        app.dispose()
      }
    }
  )

  // Upstream: a soft break at a setext heading's end keeps its bytes and shows
  // an empty last line of the heading's text; typing there writes that line.
  it.each([
    { initial: 'first\n===\n', typed: 'first\nx\n===\n' },
    { initial: 'first\n---\n', typed: 'first\nx\n---\n' },
    { initial: 'first\r\n===\r\n', typed: 'first\r\nx\r\n===\r\n' },
    { initial: 'first\nsecond\n===\n', typed: 'first\nsecond\nx\n===\n' },
    { initial: '> first\n> ===\n', typed: '> first\n> x\n> ===\n' },
    { initial: '- first\n  ===\n', typed: '- first\n  x\n  ===\n' },
    { initial: '> - first\n>   ===\n', typed: '> - first\n>   x\n>   ===\n' }
  ])(
    'breaks the end of the setext heading $initial and types on its new line',
    async({ initial, typed }) => {
      const app = bootBoundMuya(initial)
      try {
        endOf(app)
        const text = leaves(app)[0]?.text
        await input(app, 'insertLineBreak')
        expect(source(app)).toBe(initial)
        expect(leaves(app)[0]?.text).toBe(`${text}\n`)
        expect(app.muya.editor.selection.getSelection()?.anchor.offset).toBe(`${text}\n`.length)
        await input(app, 'insertText', 'x')
        expect(source(app)).toBe(typed)
        expect(leaves(app)[0]?.text.replace('\r\n', '\n')).toBe(`${text}\nx`)
        await input(app, 'insertText', 'y')
        expect(source(app)).toBe(typed.replace('x', 'xy'))
        await app.adapter.history('undo', app.reconcile)
        expect(source(app)).toBe(initial)
      } finally {
        app.dispose()
      }
    }
  )

  it('removes the empty last line of a setext heading with Backspace', async() => {
    const app = bootBoundMuya('first\n===\n')
    try {
      endOf(app)
      await input(app, 'insertLineBreak')
      await input(app, 'deleteContentBackward')
      expect(source(app)).toBe('first\n===\n')
      expect(leaves(app)[0]?.text).toBe('first')
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe('firstx\n===\n')
    } finally {
      app.dispose()
    }
  })

  it('types at the end of a later line of a CRLF paragraph', async() => {
    const app = bootBoundMuya('first\r\nsecond\r\n')
    try {
      endOf(app)
      await input(app, 'insertText', 'x')
      await input(app, 'insertText', 'y')
      expect(source(app)).toBe('first\r\nsecondxy\r\n')
    } finally {
      app.dispose()
    }
  })

  it('breaks at the end of a table cell as upstream', async() => {
    const app = bootBoundMuya('| a |\n| - |\n| b |\n')
    try {
      endOf(app)
      await input(app, 'insertLineBreak')
      await input(app, 'insertText', 'x')
      // Upstream writes the table afresh, padding each column to its widest cell.
      expect(source(app)).toBe('| a<br/>x |\n| ------- |\n| b       |\n')
    } finally {
      app.dispose()
    }
  })
})
