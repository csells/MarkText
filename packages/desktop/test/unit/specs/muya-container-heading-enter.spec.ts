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

/** The caret's block text with `|` at the caret. */
const caretText = ({ muya }: BoundMuya) => {
  const anchor = muya.editor.selection.getSelection()?.anchor
  if (anchor === undefined) throw new Error('Expected selection')
  const { text } = anchor.block
  return `${text.slice(0, anchor.offset)}|${text.slice(anchor.offset)}`
}

const place = (app: BoundMuya, index: number, at: number) => {
  const leaf = leaves(app)[index]
  if (leaf === undefined || !leaf.isContent()) throw new Error('Expected content leaf')
  const offset = at < 0 ? leaf.text.length + 1 + at : at
  leaf.setCursor(offset, offset, true)
}

// Upstream (8d6c198c) bytes and caret for Enter, and the same for Shift+Enter,
// in a heading followed by typing `x`. `at` is the offset in the heading's text
// (`-1` is its end).
const cases = [
  {
    initial: '- # first\n',
    at: -1,
    broken: '- # first\n\n  \n',
    caret: '|',
    typed: '- # first\n\n  x\n'
  },
  {
    initial: '- # first\n',
    at: 4,
    broken: '- # fi\n\n  rst\n',
    caret: '|rst',
    typed: '- # fi\n\n  xrst\n'
  },
  // Under CommonMark, as upstream's own reload reads it, the emptied item
  // ends at the blank line and the indented heading follows the list.
  {
    initial: '- # first\n',
    at: 2,
    broken: '- \n\n  # first\n',
    caret: '  # |first',
    typed: '- \n\n  # xfirst\n'
  },
  {
    initial: '- # first\n',
    at: 0,
    broken: '- \n\n  # first\n',
    caret: '  |# first',
    typed: '- \n\n  x# first\n'
  },
  {
    initial: '- ## first\n',
    at: -1,
    broken: '- ## first\n\n  \n',
    caret: '|',
    typed: '- ## first\n\n  x\n'
  },
  {
    initial: '1. # first\n',
    at: -1,
    broken: '1. # first\n\n   \n',
    caret: '|',
    typed: '1. # first\n\n   x\n'
  },
  {
    initial: '1. # first\n',
    at: 0,
    broken: '1. \n\n   # first\n',
    caret: '   |# first',
    typed: '1. \n\n   x# first\n'
  },
  {
    initial: '> # first\n',
    at: -1,
    broken: '> # first\n>\n> \n',
    caret: '|',
    typed: '> # first\n>\n> x\n'
  },
  {
    initial: '> # first\n',
    at: 4,
    broken: '> # fi\n>\n> rst\n',
    caret: '|rst',
    typed: '> # fi\n>\n> xrst\n'
  },
  {
    initial: '> # first\n',
    at: 2,
    broken: '> \n>\n> # first\n',
    caret: '# |first',
    typed: '> \n>\n> # xfirst\n'
  },
  {
    initial: '> > # first\n',
    at: -1,
    broken: '> > # first\n> >\n> > \n',
    caret: '|',
    typed: '> > # first\n> >\n> > x\n'
  },
  {
    initial: '> - # first\n',
    at: -1,
    broken: '> - # first\n>\n>   \n',
    caret: '|',
    typed: '> - # first\n>\n>   x\n'
  },
  {
    initial: '> - # first\n',
    at: 0,
    broken: '> - \n>\n>   # first\n',
    caret: '|# first',
    typed: '> - \n>\n>   x# first\n'
  },
  {
    initial: '- > # first\n',
    at: -1,
    broken: '- > # first\n  >\n  > \n',
    caret: '|',
    typed: '- > # first\n  >\n  > x\n'
  },
  {
    initial: '- a\n  - # first\n',
    index: 1,
    at: -1,
    broken: '- a\n  - # first\n\n    \n',
    caret: '|',
    typed: '- a\n  - # first\n\n    x\n'
  },
  {
    initial: '- # first\n- b\n',
    at: -1,
    broken: '- # first\n\n  \n- b\n',
    caret: '|',
    typed: '- # first\n\n  x\n- b\n'
  },
  {
    initial: '- # first\n\n  b\n',
    at: -1,
    broken: '- # first\n\n  \n\n  b\n',
    caret: '|',
    typed: '- # first\n\n  x\n\n  b\n'
  },
  {
    initial: '- a\n\n  # h\n',
    index: 1,
    at: -1,
    broken: '- a\n\n  # h\n\n  \n',
    caret: '|',
    typed: '- a\n\n  # h\n\n  x\n'
  },
  // A paragraph written directly under the heading stays a separate block.
  {
    initial: '# first\nb\n',
    at: -1,
    broken: '# first\n\n\n\nb\n',
    caret: '|',
    typed: '# first\n\nx\n\nb\n'
  },
  {
    initial: '# first\nb\n',
    at: 0,
    broken: '\n\n# first\n\nb\n',
    caret: '|# first',
    typed: '\n\nx# first\n\nb\n'
  },
  {
    initial: '# first\nb\n===\n',
    at: -1,
    broken: '# first\n\n\n\nb\n===\n',
    caret: '|',
    typed: '# first\n\nx\n\nb\n===\n'
  },
  {
    initial: '- # first\n  b\n',
    at: -1,
    broken: '- # first\n\n  \n\n  b\n',
    caret: '|',
    typed: '- # first\n\n  x\n\n  b\n'
  },
  {
    initial: '> # first\n> b\n',
    at: -1,
    broken: '> # first\n>\n> \n>\n> b\n',
    caret: '|',
    typed: '> # first\n>\n> x\n>\n> b\n'
  },
  {
    initial: '> # first\n> b\n',
    at: 4,
    broken: '> # fi\n>\n> rst\n>\n> b\n',
    caret: '|rst',
    typed: '> # fi\n>\n> xrst\n>\n> b\n'
  },
  {
    initial: '> # first\n>\n> b\n',
    at: -1,
    broken: '> # first\n>\n> \n>\n> b\n',
    caret: '|',
    typed: '> # first\n>\n> x\n>\n> b\n'
  },
  // CRLF documents keep CRLF.
  {
    initial: '- # first\r\n',
    at: 4,
    broken: '- # fi\r\n\r\n  rst\r\n',
    caret: '|rst',
    typed: '- # fi\r\n\r\n  xrst\r\n'
  },
  {
    initial: '> # first\r\n',
    at: -1,
    broken: '> # first\r\n>\r\n> \r\n',
    caret: '|',
    typed: '> # first\r\n>\r\n> x\r\n'
  }
]

describe('Enter in a heading inside containers', () => {
  for (const inputType of ['insertParagraph', 'insertLineBreak']) {
    it.each(cases)(
      `${inputType} at $at of $initial`,
      async({ initial, index, at, broken, caret, typed }) => {
        const app = bootBoundMuya(initial)
        try {
          place(app, index ?? 0, at)
          await input(app, inputType)
          expect(source(app)).toBe(broken)
          expect(caretText(app)).toBe(caret)
          await input(app, 'insertText', 'x')
          expect(source(app)).toBe(typed)
          await app.adapter.history('undo', app.reconcile)
          await app.adapter.history('undo', app.reconcile)
          expect(source(app)).toBe(initial)
        } finally {
          app.dispose()
        }
      }
    )
  }
})

// Upstream bytes for Enter in a setext heading inside containers, then `x`.
describe('Enter in a setext heading inside containers', () => {
  it.each([
    {
      initial: '> first\n> ===\n',
      at: -1,
      broken: '> first\n> ===\n>\n> \n',
      caret: '|',
      typed: '> first\n> ===\n>\n> x\n'
    },
    {
      initial: '> first\n> ===\n',
      at: 2,
      broken: '> fi\n> ===\n>\n> rst\n',
      caret: '|rst',
      typed: '> fi\n> ===\n>\n> xrst\n'
    },
    {
      initial: '> first\n> ===\n',
      at: 0,
      broken: '> \n>\n> first\n> ===\n',
      caret: '|first',
      typed: '> \n>\n> xfirst\n> ===\n'
    },
    {
      initial: '- first\n  ===\n',
      at: -1,
      broken: '- first\n  ===\n\n  \n',
      caret: '|',
      typed: '- first\n  ===\n\n  x\n'
    },
    {
      initial: '- first\n  ===\n',
      at: 2,
      broken: '- fi\n  ===\n\n  rst\n',
      caret: '|rst',
      typed: '- fi\n  ===\n\n  xrst\n'
    },
    {
      initial: '- first\n  ===\n',
      at: 0,
      broken: '- \n\n  first\n  ===\n',
      caret: '|first',
      typed: '- \n\n  xfirst\n  ===\n'
    },
    {
      initial: 'first\n===\nb\n',
      at: -1,
      broken: 'first\n===\n\n\n\nb\n',
      caret: '|',
      typed: 'first\n===\n\nx\n\nb\n'
    }
  ])('at $at of $initial', async({ initial, at, broken, caret, typed }) => {
    const app = bootBoundMuya(initial)
    try {
      place(app, 0, at)
      await input(app, 'insertParagraph')
      expect(source(app)).toBe(broken)
      expect(caretText(app)).toBe(caret)
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe(typed)
    } finally {
      app.dispose()
    }
  })
})

// Upstream spells the blank line splitting a quoted paragraph as `>`.
describe('Enter in a quoted paragraph', () => {
  it.each([
    { initial: '> a\n', at: -1, broken: '> a\n>\n> \n', typed: '> a\n>\n> x\n' },
    { initial: '> aaa\n', at: 1, broken: '> a\n>\n> aa\n', typed: '> a\n>\n> xaa\n' },
    { initial: '> > a\n', at: -1, broken: '> > a\n> >\n> > \n', typed: '> > a\n> >\n> > x\n' },
    { initial: '- > a\n', at: -1, broken: '- > a\n  >\n  > \n', typed: '- > a\n  >\n  > x\n' },
    {
      initial: '1. a\n\n   b\n',
      at: -1,
      broken: '1. a\n\n   \n\n   b\n',
      typed: '1. a\n\n   x\n\n   b\n'
    },
    {
      initial: '- a\n  - b\n\n    c\n',
      index: 1,
      at: -1,
      broken: '- a\n  - b\n\n    \n\n    c\n',
      typed: '- a\n  - b\n\n    x\n\n    c\n'
    }
  ])('at $at of $initial', async({ initial, index, at, broken, typed }) => {
    const app = bootBoundMuya(initial)
    try {
      place(app, index ?? 0, at)
      await input(app, 'insertParagraph')
      expect(source(app)).toBe(broken)
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe(typed)
    } finally {
      app.dispose()
    }
  })
})
