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

const source = (app: BoundMuya) => {
  const reply = app.binding.sourceAtBarrier()
  if (reply.type !== 'source') throw new Error('Expected source')
  return reply.source
}

/** Dispatches a key as the browser does: keydown, then beforeinput if not handled. */
const press = async({ muya, adapter }: BoundMuya, key: string) => {
  const target = muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  const inputType = {
    Enter: 'insertParagraph',
    ShiftEnter: 'insertLineBreak',
    Backspace: 'deleteContentBackward',
    Delete: 'deleteContentForward'
  }[key]
  if (key === 'Backspace' || key === 'Delete' || key === 'Enter' || key === 'ShiftEnter') {
    const down = new KeyboardEvent('keydown', {
      key: key === 'ShiftEnter' ? 'Enter' : key,
      shiftKey: key === 'ShiftEnter',
      bubbles: true,
      cancelable: true
    })
    target.dispatchEvent(down)
    if (down.defaultPrevented) {
      muya.flush()
      await adapter.settled()
      return
    }
  }
  const event = new InputEvent('beforeinput', {
    inputType: inputType ?? 'insertText',
    data: inputType === undefined ? key : null,
    bubbles: true,
    cancelable: true
  })
  target.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  muya.flush()
  await adapter.settled()
}

// Upstream (8d6c198c) bytes where upstream writes the same document; CRLF,
// CriticMarkup and untouched bytes follow the owner rules instead.
const cases = [
  {
    name: 'Enter in an empty document',
    initial: '',
    leaf: 0,
    at: 0,
    key: 'Enter',
    changed: '\n\n\n',
    typed: '\n\nz\n'
  },
  {
    name: 'Enter in an empty fenced code block',
    initial: '```\n```\n',
    leaf: 1,
    at: 0,
    key: 'Enter',
    changed: '```\n\n\n```\n',
    typed: '```\n\nz\n```\n'
  },
  {
    name: 'Enter in a quoted fenced code block',
    initial: '> ```\n> x\n> ```\n',
    leaf: 1,
    at: 1,
    key: 'Enter',
    changed: '> ```\n> x\n> \n> ```\n',
    typed: '> ```\n> x\n> z\n> ```\n'
  },
  {
    name: 'Enter in a listed fenced code block',
    initial: '- ```\n  x\n  ```\n',
    leaf: 1,
    at: 0,
    key: 'Enter',
    changed: '- ```\n  \n  x\n  ```\n',
    typed: '- ```\n  \n  zx\n  ```\n'
  },
  {
    name: 'Enter at the end of math',
    initial: '$$\nx\n$$\n',
    leaf: 0,
    at: 1,
    key: 'Enter',
    changed: '$$\nx\n\n$$\n',
    typed: '$$\nx\nz\n$$\n'
  },
  {
    name: 'Shift+Enter at the end of math',
    initial: '$$\nx\n$$\n',
    leaf: 0,
    at: 1,
    key: 'ShiftEnter',
    changed: '$$\nx\n$$\n\n\n',
    typed: '$$\nx\n$$\n\nz\n'
  },
  {
    name: 'Enter at the end of an HTML block',
    initial: '<div>\na\n</div>\n',
    leaf: 0,
    at: 14,
    key: 'Enter',
    changed: '<div>\na\n</div>\n\n',
    typed: '<div>\na\n</div>\nz\n'
  },
  {
    name: 'Shift+Enter at the end of an HTML block',
    initial: '<div>\na\n</div>\n',
    leaf: 0,
    at: 14,
    key: 'ShiftEnter',
    changed: '<div>\na\n</div>\n\n\n',
    typed: '<div>\na\n</div>\n\nz\n'
  },
  {
    name: 'Shift+Enter after an HTML comment',
    initial: '<!-- c -->\n',
    leaf: 0,
    at: 10,
    key: 'ShiftEnter',
    changed: '<!-- c -->\n\n\n',
    typed: '<!-- c -->\n\nz\n'
  },
  {
    name: 'Enter at the end of indented code',
    initial: '    indented\n',
    leaf: 1,
    at: 8,
    key: 'Enter',
    changed: '    indented\n    \n',
    typed: '    indented\n    z\n'
  },
  {
    name: 'Shift+Enter after a thematic break',
    initial: '---',
    leaf: 0,
    at: 3,
    key: 'ShiftEnter',
    changed: '---\n\n\n',
    typed: '---\n\nz\n'
  },
  {
    name: 'Shift+Enter at the end of a CRLF paragraph',
    initial: 'a\r\nb\r\n',
    leaf: 0,
    at: 4,
    key: 'ShiftEnter',
    changed: 'a\r\nb\r\n\r\n',
    typed: 'a\r\nb\r\nz\r\n'
  },
  {
    name: 'Shift+Enter at the end of a definition',
    initial: '[x]: /u\n',
    leaf: 0,
    at: 7,
    key: 'ShiftEnter',
    changed: '[x]: /u\n\n',
    typed: '[x]: /u\nz\n'
  },
  {
    name: 'Delete of a list item text before its nested list',
    initial: '- a\n  - b\n',
    leaf: 0,
    at: 0,
    key: 'Delete',
    changed: '- \n  - b\n',
    typed: '- z\n  - b\n'
  },
  {
    name: 'Delete of a task item text before its nested list',
    initial: '- [x] a\n  - [ ] b\n',
    leaf: 0,
    at: 0,
    key: 'Delete',
    changed: '- [x] \n  - [ ] b\n',
    typed: '- [x] z\n  - [ ] b\n'
  },
  {
    name: 'Delete of an ordered item text before a blank line',
    initial: '3) a\n\n   b\n',
    leaf: 0,
    at: 0,
    key: 'Delete',
    changed: '3) \n\n   b\n',
    typed: '3) z\n\n   b\n'
  },
  {
    name: 'Delete of the text of a list item written on its next line',
    initial: '- \n  b\n',
    leaf: 0,
    at: 0,
    key: 'Delete',
    changed: '- \n  \n',
    typed: '- \n  z\n'
  },
  {
    name: 'Backspace of a hard-broken line text',
    initial: 'a  \nb\n',
    leaf: 0,
    at: 1,
    key: 'Backspace',
    changed: '  \nb\n',
    typed: 'z  \nb\n'
  },
  {
    name: 'Backspace of a quoted hard-broken line text',
    initial: '> a  \n> b\n',
    leaf: 0,
    at: 1,
    key: 'Backspace',
    changed: '>   \n> b\n',
    typed: '> z  \n> b\n'
  },
  {
    name: "Backspace after a thematic break's first marker",
    initial: '***',
    leaf: 0,
    at: 1,
    key: 'Backspace',
    changed: '*',
    typed: 'z*'
  },
  {
    name: "Backspace after a thematic break's second marker",
    initial: '***',
    leaf: 0,
    at: 2,
    key: 'Backspace',
    changed: '*',
    typed: '*z'
  },
  {
    name: "Backspace of a spaced thematic break's last marker",
    initial: '- - -',
    leaf: 0,
    at: 5,
    key: 'Backspace',
    changed: '- - ',
    typed: '- z- '
  },
  {
    name: 'Typing after a spaced thematic break',
    initial: '- - -',
    leaf: 0,
    at: 5,
    key: 'x',
    changed: '- - -x',
    typed: '- z- -x'
  },
  {
    name: 'Typing after a lone quote marker',
    initial: '>',
    leaf: 0,
    at: 0,
    key: 'z',
    changed: '> z',
    typed: '> zz'
  },
  {
    name: 'Backspace of a setext heading text',
    initial: 'a\n---',
    leaf: 0,
    at: 1,
    key: 'Backspace',
    changed: '\n---',
    typed: 'z\n---'
  },
  {
    name: 'Backspace twice in a setext heading',
    initial: 'a\n---\nb\n',
    leaf: 0,
    at: 1,
    key: 'Backspace',
    then: 'Backspace',
    changed: '\n\nb\n',
    typed: 'z\n\nb\n'
  },
  {
    name: 'Backspace of the first line of a setext heading',
    initial: 'a\nb\n---\n',
    leaf: 0,
    at: 1,
    key: 'Backspace',
    changed: '\nb\n---\n',
    typed: 'z\nb\n---\n'
  },
  {
    name: 'Delete of a paragraph after a thematic break',
    initial: '***\na',
    leaf: 1,
    at: 0,
    key: 'Delete',
    changed: '***\n\n\n',
    typed: '***\n\nz\n'
  },
  {
    name: 'Backspace of a paragraph between headings',
    initial: '# h\na\n# j\n',
    leaf: 1,
    at: 1,
    key: 'Backspace',
    changed: '# h\n\n\n\n# j\n',
    typed: '# h\n\nz\n\n# j\n'
  },
  {
    name: 'Backspace of a quoted paragraph after a heading',
    initial: '> x\n> # h\n> a\n',
    leaf: 2,
    at: 1,
    key: 'Backspace',
    changed: '> x\n> # h\n>\n> \n',
    typed: '> x\n> # h\n>\n> z\n'
  },
  {
    name: 'Backspace at a thematic break after a fence',
    initial: '```js\na\n```\n---\n',
    leaf: 2,
    at: 0,
    key: 'Backspace',
    changed: '```js\na\n```\n\n\n',
    typed: '```js\na\n```\n\nz\n'
  },
  {
    name: "Typing in indented code's language box",
    initial: '    indented\n',
    leaf: 0,
    at: 0,
    key: 'j',
    changed: '```j\nindented\n```\n',
    typed: '```jz\nindented\n```\n'
  },
  {
    name: "Typing in a listed indented code's language box",
    initial: '- x\n\n      code\n',
    leaf: 1,
    at: 0,
    key: 'j',
    changed: '- x\n\n  ```j\n  code\n  ```\n',
    typed: '- x\n\n  ```jz\n  code\n  ```\n'
  },
  {
    name: 'Backspace of indented code text',
    initial: '    a\n',
    leaf: 1,
    at: 1,
    key: 'Backspace',
    changed: '    \n',
    typed: '    z\n'
  },
  {
    name: 'Typing before an ordered empty task marker',
    initial: '3) [ ] \n\n   b\n',
    leaf: 0,
    at: 0,
    key: 'x',
    changed: '3) x[ ] \n\n   b\n',
    typed: '3) xz[ ] \n\n   b\n'
  },
  {
    name: 'Backspace after an ordered empty task marker',
    initial: '3) [ ] \n\n   b\n',
    leaf: 0,
    at: 4,
    key: 'Backspace',
    changed: '3) [ ]\n\n   b\n',
    typed: '3) [ ]z\n\n   b\n'
  },
  {
    name: 'Delete of an empty task paragraph before a later one',
    initial: '- [ ] \n\n  b\n',
    leaf: 0,
    at: 0,
    key: 'Delete',
    changed: '- [ ] b\n',
    typed: '- [ ] zb\n'
  },
  {
    name: 'Delete of a substitution old arm',
    initial: '{~~a~>b~~}\n',
    leaf: 0,
    at: 0,
    key: 'Delete',
    changed: '{~~~>b~~}\n',
    typed: '{~~z~>b~~}\n'
  },
  // Enter at the start of item text written after its marker line, or in an
  // empty first paragraph before later blocks, splits the item as upstream does.
  {
    name: 'Enter before a task item text on its next line',
    initial: '- [ ] \n  b\n',
    leaf: 0,
    at: 0,
    key: 'Enter',
    changed: '- [ ] \n- [ ] b\n',
    typed: '- [ ] \n- [ ] zb\n'
  },
  {
    name: 'Enter before a bullet item text on its next line',
    initial: '- \n  b\n',
    leaf: 0,
    at: 0,
    key: 'Enter',
    changed: '- \n- b\n',
    typed: '- \n- zb\n'
  },
  {
    name: 'Enter before an ordered item text on its next line',
    initial: '1. \n   b\n',
    leaf: 0,
    at: 0,
    key: 'Enter',
    changed: '1. \n2. b\n',
    typed: '1. \n2. zb\n'
  },
  {
    name: 'Enter before a later ordered item text on its next line',
    initial: '1. a\n2. \n   b\n',
    leaf: 1,
    at: 0,
    key: 'Enter',
    changed: '1. a\n2. \n3. b\n',
    typed: '1. a\n2. \n3. zb\n'
  },
  {
    name: 'Enter before a quoted item text on its next line',
    initial: '> - \n>   b\n',
    leaf: 0,
    at: 0,
    key: 'Enter',
    changed: '> - \n> - b\n',
    typed: '> - \n> - zb\n'
  },
  {
    name: 'Enter before a nested item text on its next line',
    initial: '- a\n  - \n    b\n',
    leaf: 1,
    at: 0,
    key: 'Enter',
    changed: '- a\n  - \n  - b\n',
    typed: '- a\n  - \n  - zb\n'
  },
  {
    name: 'Enter in an empty task paragraph before a later paragraph',
    initial: '- [ ] \n\n  b\n',
    leaf: 0,
    at: 0,
    key: 'Enter',
    changed: '- [ ] \n\n- [ ] b\n',
    typed: '- [ ] \n\n- [ ] zb\n'
  },
  {
    name: 'Enter in an empty quoted task paragraph before a later paragraph',
    initial: '> - [ ] \n>\n>   b\n',
    leaf: 0,
    at: 0,
    key: 'Enter',
    changed: '> - [ ] \n>\n> - [ ] b\n',
    typed: '> - [ ] \n>\n> - [ ] zb\n'
  },
  {
    name: 'Enter in an empty item paragraph before a nested list',
    initial: '- \n  - c\n  - d\n',
    leaf: 0,
    at: 0,
    key: 'Enter',
    changed: '- \n- - c\n  - d\n',
    typed: '- \n- - zc\n  - d\n'
  },
  {
    name: 'Enter in an empty ordered item paragraph before a nested list',
    initial: '1. \n   - c\n',
    leaf: 0,
    at: 0,
    key: 'Enter',
    changed: '1. \n2. - c\n',
    typed: '1. \n2. - zc\n'
  },
  {
    name: 'Enter in an empty task paragraph before a nested task list',
    initial: '- [x] \n  - [ ] c\n',
    leaf: 0,
    at: 0,
    key: 'Enter',
    changed: '- [x] \n- [ ] \n  - [ ] c\n',
    typed: '- [x] \n- [ ] \n  - [ ] zc\n'
  },
  {
    name: 'Enter twice after an item paragraph before a later one',
    initial: '- a\n\n  b\n',
    leaf: 0,
    at: 1,
    key: 'Enter',
    then: 'Enter',
    changed: '- a\n\n- \n\n  b\n',
    typed: '- a\n\n- z\n\n  b\n'
  },
  // A thematic break whose edited text no longer reads as a rule is written
  // apart from the blocks beside it, as upstream writes the paragraph.
  {
    name: 'Backspace of a rule after a lazy list line',
    initial: '- x\na\n---\n',
    leaf: 1,
    at: 3,
    key: 'Backspace',
    changed: '- x\na\n\n--\n',
    typed: '- x\na\n\n--z\n'
  },
  {
    name: 'Backspace of a quoted rule between paragraphs',
    initial: '> x\n> ***\n> y\n',
    leaf: 1,
    at: 3,
    key: 'Backspace',
    changed: '> x\n>\n> **\n>\n> y\n',
    typed: '> x\n>\n> **z\n>\n> y\n'
  },
  {
    name: 'Backspace of a rule before a paragraph',
    initial: '***\nx\n',
    leaf: 0,
    at: 3,
    key: 'Backspace',
    changed: '**\n\nx\n',
    typed: '**z\n\nx\n'
  },
  {
    name: 'Typing after a rule below a paragraph',
    initial: 'x\n***\n',
    leaf: 1,
    at: 3,
    key: 'x',
    changed: 'x\n\n***x\n',
    typed: 'x\n\n***xz\n'
  },
  {
    name: "Delete of a rule's first marker after a list",
    initial: '- x\n---\n',
    leaf: 1,
    at: 0,
    key: 'Delete',
    changed: '- x\n\n--\n',
    typed: '- x\n\nz--\n'
  },
  {
    name: 'Backspace of a spaced rule after a list',
    initial: '- x\n- - -\n',
    leaf: 1,
    at: 5,
    key: 'Backspace',
    changed: '- x\n\n- - \n',
    typed: '- x\n\n- z- \n'
  },
  // An emptied first paragraph keeps its own line apart from the next block.
  {
    name: 'Backspace in an empty task paragraph before a nested task list',
    initial: '- [x] \n  - [ ] c\n',
    leaf: 0,
    at: 0,
    key: 'Backspace',
    changed: '\n\n- [ ] c\n',
    typed: 'z\n\n- [ ] c\n'
  },
  {
    name: "Backspace of a quote's first paragraph text before a heading",
    initial: '> x\n> # h\n',
    leaf: 0,
    at: 1,
    key: 'Backspace',
    changed: '> \n>\n> # h\n',
    typed: '> z\n>\n> # h\n'
  },
  {
    name: "Delete of a quote's first paragraph text before a rule",
    initial: '> x\n> ***\n> y\n',
    leaf: 0,
    at: 0,
    key: 'Delete',
    changed: '> \n>\n> ***\n> y\n',
    typed: '> z\n>\n> ***\n> y\n'
  },
  // Enter keeps the split-off text as a paragraph, indentation included,
  // with the caret before that indentation, even where it reads as a marker.
  {
    name: 'Enter before an indented bullet marker in a paragraph',
    initial: 'a - b\n',
    leaf: 0,
    at: 1,
    key: 'Enter',
    changed: 'a\n\n - b\n',
    typed: 'a\n\nz - b\n'
  },
  {
    name: 'Enter before an indented bullet marker at the document end',
    initial: 'a - b',
    leaf: 0,
    at: 1,
    key: 'Enter',
    changed: 'a\n\n - b',
    typed: 'a\n\nz - b'
  },
  {
    name: 'Enter before an indented ordered marker in a paragraph',
    initial: 'a 1. b\n',
    leaf: 0,
    at: 1,
    key: 'Enter',
    changed: 'a\n\n 1. b\n',
    typed: 'a\n\nz 1. b\n'
  },
  {
    name: 'Enter before an indented quote marker in a paragraph',
    initial: 'a > b\n',
    leaf: 0,
    at: 1,
    key: 'Enter',
    changed: 'a\n\n > b\n',
    typed: 'a\n\nz > b\n'
  },
  {
    name: 'Enter before a bullet marker in a paragraph',
    initial: 'a - b\n',
    leaf: 0,
    at: 2,
    key: 'Enter',
    changed: 'a \n\n- b\n',
    typed: 'a \n\nz- b\n'
  }
]

describe('editing edge documents', () => {
  it.each(cases)('$name', async({ initial, leaf, at, key, changed, typed, ...rest }) => {
    const app = bootBoundMuya(initial)
    try {
      const block = leaves(app)[leaf]
      if (block === undefined || !block.isContent()) throw new Error('Expected content leaf')
      block.setCursor(at, at, true)
      await press(app, key)
      if ('then' in rest) await press(app, rest.then as string)
      expect(source(app)).toBe(changed)
      await press(app, 'z')
      expect(source(app)).toBe(typed)
      for (let undo = 0; undo < 6 && source(app) !== initial; undo += 1) {
        await app.adapter.history('undo', app.reconcile)
      }
      expect(source(app)).toBe(initial)
      expect(app.adapter.state().status).toBe('ready')
    } finally {
      app.dispose()
    }
  })
})

/** Dispatches a cut over the live selection, as the browser does. */
const cut = async({ muya, adapter }: BoundMuya) => {
  const selection = muya.editor.selection.getSelection()
  const target = selection?.anchor.block.domNode
  if (selection === null || selection === undefined || !target?.isConnected) {
    throw new Error('Expected live selection')
  }
  const host = muya.domNode as HTMLElement
  host.tabIndex = -1
  host.focus()
  muya.editor.selection.setSelection(selection.anchor, selection.focus)
  const data = new Map<string, string>()
  const event = new Event('cut', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (kind: string, value: string) => data.set(kind, value),
      getData: (kind: string) => data.get(kind) ?? '',
      files: [],
      items: []
    }
  })
  target.dispatchEvent(event)
  for (let turn = 0; turn < 4; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    muya.flush()
    await adapter.settled()
  }
}

// Upstream (8d6c198c) keeps a paragraph whose whole text is cut as an empty
// paragraph on a line of its own, as it does when that text is deleted.
describe("cutting a paragraph's whole text", () => {
  it.each([
    {
      name: 'before a list',
      initial: 'a\n- b\n',
      leaf: 0,
      changed: '\n\n- b\n',
      typed: 'z\n\n- b\n'
    },
    {
      name: 'before a quote',
      initial: 'a\n> b\n',
      leaf: 0,
      changed: '\n\n> b\n',
      typed: 'z\n\n> b\n'
    },
    {
      name: 'before a heading',
      initial: 'a\n# b\n',
      leaf: 0,
      changed: '\n\n# b\n',
      typed: 'z\n\n# b\n'
    },
    {
      name: 'between a paragraph and a list',
      initial: 'x\n\na\n- b\n',
      leaf: 1,
      changed: 'x\n\n\n\n- b\n',
      typed: 'x\n\nz\n\n- b\n'
    },
    // A paragraph with more text keeps its lines.
    {
      name: 'of a line before another',
      initial: 'a\nb\n',
      leaf: 0,
      end: 1,
      changed: '\nb\n',
      typed: 'z\nb\n'
    }
  ])('$name', async({ initial, leaf, changed, typed, ...rest }) => {
    const app = bootBoundMuya(initial)
    try {
      const block = leaves(app)[leaf]
      if (block === undefined || !block.isContent()) throw new Error('Expected content leaf')
      const end = 'end' in rest ? (rest.end as number) : block.text.length
      app.muya.editor.selection.setSelection(
        { block, path: block.path, offset: 0 },
        { block, path: block.path, offset: end }
      )
      await cut(app)
      expect(app.adapter.state().status).toBe('ready')
      expect(source(app)).toBe(changed)
      await press(app, 'z')
      expect(source(app)).toBe(typed)
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(initial)
    } finally {
      app.dispose()
    }
  })
})
