// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import { tableInputOptions, tableModelCommand, tableSelection } from '../helpers/tableModelCommand'
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

const caretText = ({ muya }: BoundMuya) => {
  const anchor = muya.editor.selection.getSelection()?.anchor
  if (anchor === undefined) throw new Error('Expected selection')
  return `${anchor.block.text.slice(0, anchor.offset)}|${anchor.block.text.slice(anchor.offset)}`
}

const endOf = (app: BoundMuya, index: number) => {
  const leaf = leaves(app)[index]
  if (leaf === undefined || !leaf.isContent()) throw new Error('Expected cell')
  leaf.setCursor(leaf.text.length, leaf.text.length, true)
}

const table = '| a | b |\n| --- | --- |\n| c | d |\n'

// Upstream (8d6c198c) writes the whole table afresh after each cell edit.
describe('editing a table cell', () => {
  it.each([
    {
      initial: table,
      cell: 0,
      typed: '| ax  | b   |\n| --- | --- |\n| c   | d   |\n',
      caret: 'ax|'
    },
    {
      initial: table,
      cell: 2,
      typed: '| a   | b   |\n| --- | --- |\n| cx  | d   |\n',
      caret: 'cx|'
    },
    {
      initial: '|a|b|\n|-|-|\n|c|d|\n',
      cell: 0,
      typed: '| ax  | b   |\n| --- | --- |\n| c   | d   |\n',
      caret: 'ax|'
    },
    {
      initial: '| a | b |\n|:-|-:|\n| c | d |\n',
      cell: 0,
      typed: '| ax  | b   |\n|:--- | ---:|\n| c   | d   |\n',
      caret: 'ax|'
    },
    {
      initial: '| abcdefg | b |\n| --- | --- |\n| c | d |\n',
      cell: 0,
      typed: '| abcdefgx | b   |\n| -------- | --- |\n| c        | d   |\n',
      caret: 'abcdefgx|'
    },
    {
      initial: '| abcdefg | b |\n| --- | --- |\n| c | d |\n',
      cell: 2,
      typed: '| abcdefg | b   |\n| ------- | --- |\n| cx      | d   |\n',
      caret: 'cx|'
    },
    {
      initial: '> | a | b |\n> | --- | --- |\n> | c | d |\n',
      cell: 0,
      typed: '> | ax  | b   |\n> | --- | --- |\n> | c   | d   |\n',
      caret: 'ax|'
    },
    {
      initial: '- | a | b |\n  | --- | --- |\n  | c | d |\n',
      cell: 0,
      typed: '- | ax  | b   |\n  | --- | --- |\n  | c   | d   |\n',
      caret: 'ax|'
    },
    {
      initial: 'a | b\n--- | ---\nc | d\n',
      cell: 0,
      typed: '| ax  | b   |\n| --- | --- |\n| c   | d   |\n',
      caret: 'ax|'
    },
    {
      initial: '| a | b |\n| --- | --- |\n| c |\n',
      cell: 0,
      typed: '| ax  | b   |\n| --- | --- |\n| c   |     |\n',
      caret: 'ax|'
    },
    // Owner decision (plan 0012 G24): padding keeps a row's text beyond the
    // header's columns, which upstream drops.
    {
      initial: '| a | b |\n| --- | --- |\n| c | d | e |\n',
      cell: 0,
      typed: '| ax  | b   |\n| --- | --- |\n| c   | d   | e |\n',
      caret: 'ax|'
    },
    {
      initial: '| 中文 | b |\n| --- | --- |\n| c | d |\n',
      cell: 1,
      typed: '| 中文 | bx  |\n| ---- | --- |\n| c    | d   |\n',
      caret: 'bx|'
    },
    {
      initial: '| a\\|z | b |\n| --- | --- |\n| c | d |\n',
      cell: 1,
      typed: '| a\\|z | bx  |\n| ---- | --- |\n| c    | d   |\n',
      caret: 'bx|'
    },
    {
      initial: '| **a** | b |\n| --- | --- |\n| c | d |\n',
      cell: 1,
      typed: '| **a** | bx  |\n| ----- | --- |\n| c     | d   |\n',
      caret: 'bx|'
    },
    {
      initial: '|a|b|\n|-|-|\n|c|d|extra|\n|e|\n',
      cell: 0,
      typed: '| ax  | b   |\n| --- | --- |\n| c   | d   |extra|\n| e   |     |\n',
      caret: 'ax|'
    },
    {
      initial: '|a|b|\n|-|-|\n|{++c++}|d|x \\| {>>y<<}|\n',
      cell: 0,
      typed: '| ax      | b   |\n| ------- | --- |\n| {++c++} | d   |x \\| {>>y<<}|\n',
      caret: 'ax|'
    },
    // CRLF documents keep CRLF.
    {
      initial: table.replaceAll('\n', '\r\n'),
      cell: 0,
      typed: '| ax  | b   |\r\n| --- | --- |\r\n| c   | d   |\r\n',
      caret: 'ax|'
    }
  ])('types in cell $cell of $initial', async({ initial, cell, typed, caret }) => {
    const app = bootBoundMuya(initial)
    try {
      endOf(app, cell)
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe(typed)
      expect(caretText(app)).toBe(caret)
      await input(app, 'insertText', 'y')
      expect(caretText(app)).toBe(caret.replace('|', 'y|'))
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(initial)
    } finally {
      app.dispose()
    }
  })

  it('leaves a tracked edit unpadded and keeps text beyond the header', async() => {
    const initial = '|a|b|\n|-|-|\n|c|d|extra|\n'
    const app = bootBoundMuya(initial)
    try {
      app.track(true)
      endOf(app, 0)
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe('|a{++x++}|b|\n|-|-|\n|c|d|extra|\n')
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(initial)
    } finally {
      app.dispose()
    }
  })

  it('pads a cell emptied with Backspace and types into it', async() => {
    const app = bootBoundMuya(table)
    try {
      endOf(app, 0)
      await input(app, 'deleteContentBackward')
      expect(source(app)).toBe('|     | b   |\n| --- | --- |\n| c   | d   |\n')
      expect(caretText(app)).toBe('|')
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe('| x   | b   |\n| --- | --- |\n| c   | d   |\n')
      expect(caretText(app)).toBe('x|')
    } finally {
      app.dispose()
    }
  })

  // Upstream keeps a space typed after a cell's text in the cell, with the
  // caret after it, while the written table's padding absorbs it.
  it.each([
    {
      initial: table,
      cell: 0,
      steps: [
        [' ', '| a   | b   |\n| --- | --- |\n| c   | d   |\n', 'a |'],
        [' ', '| a   | b   |\n| --- | --- |\n| c   | d   |\n', 'a  |'],
        ['x', '| a  x | b   |\n| ---- | --- |\n| c    | d   |\n', 'a  x|']
      ]
    },
    {
      initial: '| abc | b |\n| --- | --- |\n| c | d |\n',
      cell: 0,
      steps: [
        [' ', '| abc | b   |\n| --- | --- |\n| c   | d   |\n', 'abc |'],
        ['x', '| abc x | b   |\n| ----- | --- |\n| c     | d   |\n', 'abc x|']
      ]
    },
    {
      initial: table,
      cell: 3,
      steps: [
        [' ', '| a   | b   |\n| --- | --- |\n| c   | d   |\n', 'd |'],
        ['x', '| a   | b   |\n| --- | --- |\n| c   | d x |\n', 'd x|']
      ]
    },
    {
      initial: '| **a** | b |\n| --- | --- |\n| c | d |\n',
      cell: 0,
      steps: [
        [' ', '| **a** | b   |\n| ----- | --- |\n| c     | d   |\n', '**a** |'],
        ['x', '| **a** x | b   |\n| ------- | --- |\n| c       | d   |\n', '**a** x|']
      ]
    }
  ])('types a trailing space in cell $cell of $initial', async({ initial, cell, steps }) => {
    const app = bootBoundMuya(initial)
    try {
      endOf(app, cell)
      for (const [data, expected, caret] of steps) {
        await input(app, 'insertText', data)
        expect(source(app)).toBe(expected)
        expect(caretText(app)).toBe(caret)
      }
      for (const _step of steps) await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(initial)
    } finally {
      app.dispose()
    }
  })

  it('removes a typed trailing space with Backspace', async() => {
    const app = bootBoundMuya(table)
    try {
      endOf(app, 0)
      await input(app, 'insertText', ' ')
      await input(app, 'deleteContentBackward')
      expect(source(app)).toBe('| a   | b   |\n| --- | --- |\n| c   | d   |\n')
      expect(caretText(app)).toBe('a|')
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe('| ax  | b   |\n| --- | --- |\n| c   | d   |\n')
    } finally {
      app.dispose()
    }
  })

  // Padding fits the cell's written text, delimiters included, as upstream
  // pads the literal CriticMarkup it sees. Deleting an insertion's only text
  // removes the insertion, so the column is as wide as for an empty cell,
  // exactly as when that text is cut.
  it.each([
    { name: 'Delete', leaf: 0, start: 0, end: 1, inputType: 'deleteContentForward' },
    { name: 'Backspace', leaf: 0, start: 1, end: 1, inputType: 'deleteContentBackward' },
    {
      name: 'Delete over the selected text',
      leaf: 0,
      start: 0,
      end: 1,
      inputType: 'deleteContentBackward'
    }
  ])('pads a cell whose insertion $name empties', async({ leaf, start, end, inputType }) => {
    const initial = '| {++a++} | b |\n| - | - |\n| c | d |\n'
    const app = bootBoundMuya(initial)
    try {
      const block = leaves(app)[leaf]
      if (block === undefined || !block.isContent()) throw new Error('Expected cell')
      block.setCursor(start, end, true)
      await input(app, inputType)
      expect(source(app)).toBe('|     | b   |\n| --- | --- |\n| c   | d   |\n')
      expect(caretText(app)).toBe('|')
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe('| x   | b   |\n| --- | --- |\n| c   | d   |\n')
      expect(caretText(app)).toBe('x|')
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(initial)
    } finally {
      app.dispose()
    }
  })

  // A cell left holding only a comment has no text of its own. Its caret stays
  // where the deleted text was, before the comment's marker, as a paragraph's
  // caret does and as upstream's caret does before the literal `{>>c<<}`;
  // typing continues the cell's text there.
  it.each([
    {
      name: 'Delete of the text before a comment',
      initial: '| a{==b==}{>>c<<} | d |\n| - | - |\n| e | f |\n',
      start: 0,
      end: 2,
      inputType: 'deleteContentForward',
      changed: '| {>>c<<} | d |\n| - | - |\n| e | f |\n'
    },
    {
      name: 'Backspace of the text before a comment',
      initial: '| a{>>c<<} | d |\n| - | - |\n| e | f |\n',
      start: 1,
      end: 1,
      inputType: 'deleteContentBackward',
      changed: '| {>>c<<} | d   |\n| ------- | --- |\n| e       | f   |\n'
    }
  ])('keeps a live caret after $name', async({ initial, start, end, inputType, changed }) => {
    const app = bootBoundMuya(initial)
    try {
      const block = leaves(app)[0]
      if (block === undefined || !block.isContent()) throw new Error('Expected cell')
      block.setCursor(start, end, true)
      await input(app, inputType)
      expect(app.adapter.state().status).toBe('ready')
      expect(source(app)).toBe(changed)
      expect(caretText(app)).toBe('|')
      await input(app, 'insertText', 'z')
      expect(source(app)).toBe('| z{>>c<<} | d   |\n| -------- | --- |\n| e        | f   |\n')
      expect(caretText(app)).toBe('z|')
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(initial)
    } finally {
      app.dispose()
    }
  })

  it('escapes a pipe typed into a cell holding only a comment', async() => {
    const app = bootBoundMuya('| {>>c<<} | d |\n| - | - |\n| e | f |\n')
    try {
      leaves(app)[0]?.setCursor(0, 0, true)
      await input(app, 'insertText', '|')
      expect(source(app)).toBe('| \\|{>>c<<} | d   |\n| --------- | --- |\n| e         | f   |\n')
      expect(caretText(app)).toBe('\\||')
    } finally {
      app.dispose()
    }
  })

  it('leaves a table alone while editing outside it', async() => {
    const app = bootBoundMuya('|a|b|\n|-|-|\n|c|d|\n\npara\n')
    try {
      endOf(app, 4)
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe('|a|b|\n|-|-|\n|c|d|\n\nparax\n')
    } finally {
      app.dispose()
    }
  })
})

const unpadded = '| a | bb |\n|---|:-:|\n| ccc | d |\n'

const caretCell = ({ muya }: BoundMuya) => {
  const anchor = muya.editor.selection.getSelection()?.anchor
  const cell = anchor?.block.closestBlock('table.cell') as
    | { rowOffset: number; columnOffset: number }
    | undefined
  if (anchor === undefined || cell == null) throw new Error('Expected a cell selection')
  return { row: cell.rowOffset, column: cell.columnOffset, offset: anchor.offset }
}

const undoOnce = async(app: BoundMuya, initial: string) => {
  await app.adapter.history('undo', app.reconcile)
  expect(source(app)).toBe(initial)
}

// Upstream (8d6c198c) writes the whole table afresh after every table command.
describe('a table command', () => {
  it('Cmd+Enter inserts a row into the table written afresh', async() => {
    const app = bootBoundMuya(unpadded)
    try {
      endOf(app, 2)
      const target = app.muya.editor.selection.getSelection()?.anchor.block.domNode
      target?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      )
      await app.adapter.settled()
      expect(source(app)).toBe('| a   | bb  |\n| --- |:---:|\n| ccc | d   |\n|     |     |\n')
      expect(caretCell(app)).toEqual({ row: 2, column: 0, offset: 0 })
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe('| a   | bb  |\n| --- |:---:|\n| ccc | d   |\n| x   |     |\n')
      await app.adapter.history('undo', app.reconcile)
      await undoOnce(app, unpadded)
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
  })

  it.each([
    {
      name: 'insert row above',
      row: 1,
      column: 0,
      command: { command: 'insertTableRow', placement: 'before' },
      expected: '| a   | bb  |\n| --- |:---:|\n|     |     |\n| ccc | d   |\n',
      caret: { row: 1, column: 0, offset: 0 }
    },
    {
      name: 'insert column right',
      row: 0,
      column: 0,
      command: { command: 'insertTableColumn', placement: 'after' },
      expected: '| a   |     | bb  |\n| --- | --- |:---:|\n| ccc |     | d   |\n',
      caret: { row: 0, column: 1, offset: 0 }
    },
    {
      name: 'remove row',
      row: 1,
      column: 0,
      command: { command: 'removeTableRow' },
      expected: '| a   | bb  |\n| --- |:---:|\n',
      caret: { row: 0, column: 0, offset: 0 }
    },
    {
      name: 'remove header row',
      row: 0,
      column: 0,
      command: { command: 'removeTableRow' },
      expected: '| ccc | d   |\n| --- |:---:|\n',
      caret: { row: 0, column: 0, offset: 0 }
    },
    {
      name: 'remove column',
      row: 0,
      column: 1,
      command: { command: 'removeTableColumn' },
      expected: '| a   |\n| --- |\n| ccc |\n',
      caret: { row: 0, column: 0, offset: 0 }
    },
    {
      name: 'align column',
      row: 1,
      column: 0,
      command: { command: 'alignTableColumn', alignment: 'right' },
      expected: '| a   | bb  |\n| ---:|:---:|\n| ccc | d   |\n',
      caret: { row: 1, column: 0, offset: 0 }
    }
  ] as const)(
    '$name writes the table afresh as one undoable operation',
    async({ row, column, command, expected, caret }) => {
      const app = bootBoundMuya(unpadded)
      try {
        await tableModelCommand(app.adapter, app.view(), row, column, command, app.reconcile)
        await app.adapter.settled()
        expect(source(app)).toBe(expected)
        expect(caretCell(app)).toEqual(caret)
        await undoOnce(app, unpadded)
        await app.adapter.history('redo', app.reconcile)
        expect(source(app)).toBe(expected)
      } finally {
        app.dispose()
      }
    }
  )

  it.each([
    {
      name: 'row',
      move: { command: 'moveTableRow', row: 0 },
      expected: '| ccc | d   |\n| --- |:---:|\n| a   | bb  |\n',
      caret: { row: 0, column: 0, offset: 2 }
    },
    {
      name: 'column',
      move: { command: 'moveTableColumn', column: 1 },
      expected: '| bb  | a   |\n|:---:| --- |\n| d   | ccc |\n',
      caret: { row: 1, column: 1, offset: 2 }
    }
  ] as const)(
    'dragging a $name writes the table afresh as one undoable operation',
    async({ move, expected, caret }) => {
      const app = bootBoundMuya(unpadded)
      try {
        const selection = tableSelection(app.view(), 1, 0, 2)
        await app.adapter.input(
          {
            kind: 'command',
            ...move,
            target: selection.cell,
            selection,
            options: tableInputOptions
          },
          app.reconcile,
          false
        )
        await app.adapter.settled()
        expect(source(app)).toBe(expected)
        expect(caretCell(app)).toEqual(caret)
        await undoOnce(app, unpadded)
      } finally {
        app.dispose()
      }
    }
  )

  it('leaves padding out of a tracked command', async() => {
    const app = bootBoundMuya(unpadded)
    try {
      await tableModelCommand(
        app.adapter,
        app.view(),
        1,
        0,
        { command: 'insertTableRow', placement: 'after' },
        app.reconcile,
        true
      )
      await app.adapter.settled()
      expect(source(app)).not.toContain('| a   |')
      await undoOnce(app, unpadded)
    } finally {
      app.dispose()
    }
  })

  it('pastes into a cell and writes the table afresh', async() => {
    const app = bootBoundMuya(unpadded)
    try {
      endOf(app, 2)
      await app.muya.editor.clipboard.pasteHandler({
        preventDefault() {},
        stopPropagation() {},
        clipboardData: {
          getData: (type: string) => (type === 'text/plain' ? 'xyz' : ''),
          files: [],
          items: []
        }
      } as unknown as ClipboardEvent)
      await app.adapter.settled()
      expect(source(app)).toBe('| a      | bb  |\n| ------ |:---:|\n| cccxyz | d   |\n')
      expect(caretText(app)).toBe('cccxyz|')
      await undoOnce(app, unpadded)
    } finally {
      app.dispose()
    }
  })

  it("formats a cell's text and writes the table afresh", async() => {
    const app = bootBoundMuya(unpadded)
    try {
      const cell = leaves(app)[2]
      if (cell === undefined || !cell.isContent()) throw new Error('Expected cell')
      cell.setCursor(0, 3, true)
      app.muya.format('strong')
      await app.adapter.settled()
      expect(source(app)).toBe('| a       | bb  |\n| ------- |:---:|\n| **ccc** | d   |\n')
      await undoOnce(app, unpadded)
    } finally {
      app.dispose()
    }
  })
})

/** Dispatches the browser's cut event over the live selection, as Cmd+X does. */
const cut = async(app: BoundMuya) => {
  const host = app.muya.domNode as HTMLElement
  const selection = app.muya.editor.selection.getSelection()
  if (selection === null || selection === undefined) throw new Error('Expected live selection')
  // Cut belongs to the focused editor.
  host.tabIndex = -1
  host.focus()
  app.muya.editor.selection.setSelection(selection.anchor, selection.focus)
  const copied = new Map<string, string>()
  const event = new Event('cut', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (type: string, value: string) => copied.set(type, value),
      getData: (type: string) => copied.get(type) ?? ''
    }
  })
  selection.anchor.block.domNode?.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  app.muya.flush()
  await app.adapter.settled()
  return copied
}

const key = async({ muya, adapter }: BoundMuya, name: 'Backspace' | 'Delete') => {
  const target = muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  const down = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
  target.dispatchEvent(down)
  if (!down.defaultPrevented) {
    target.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: name === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward',
        bubbles: true,
        cancelable: true
      })
    )
  }
  muya.flush()
  await adapter.settled()
}

const select = (app: BoundMuya, index: number, start: number, end: number) => {
  const leaf = leaves(app)[index]
  if (leaf === undefined || !leaf.isContent()) throw new Error('Expected leaf')
  leaf.setCursor(start, end, true)
}

/** The whole source and the caret's cell must be what reopening shows. */
const expectRespelled = async(
  app: BoundMuya,
  initial: string,
  expected: string,
  caret: string,
  cell: { row: number; column: number } | null
) => {
  expect(source(app)).toBe(expected)
  expect(caretText(app)).toBe(caret)
  const anchor = app.muya.editor.selection.getSelection()?.anchor
  const owner = anchor?.block.closestBlock('table.cell') as
    | { rowOffset: number; columnOffset: number }
    | undefined
  expect(
    owner === undefined || owner === null
      ? null
      : { row: owner.rowOffset, column: owner.columnOffset }
  ).toEqual(cell)
  const reopened = bootBoundMuya(expected)
  try {
    expect(leaves(app).map((leaf) => leaf.text)).toEqual(leaves(reopened).map((leaf) => leaf.text))
  } finally {
    reopened.dispose()
  }
  await app.adapter.history('undo', app.reconcile)
  expect(source(app)).toBe(initial)
}

// Upstream (8d6c198c) writes the whole table afresh after a text cut in a cell.
describe("cutting a cell's text", () => {
  it.each([
    {
      name: 'the whole text of a body cell',
      initial: unpadded,
      leaf: 2,
      start: 0,
      end: 3,
      expected: '| a   | bb  |\n| --- |:---:|\n|     | d   |\n',
      caret: '|',
      cell: { row: 1, column: 0 }
    },
    {
      name: 'part of a body cell',
      initial: unpadded,
      leaf: 2,
      start: 1,
      end: 3,
      expected: '| a   | bb  |\n| --- |:---:|\n| c   | d   |\n',
      caret: 'c|',
      cell: { row: 1, column: 0 }
    },
    {
      name: 'the whole text of a header cell',
      initial: unpadded,
      leaf: 0,
      start: 0,
      end: 1,
      expected: '|     | bb  |\n| --- |:---:|\n| ccc | d   |\n',
      caret: '|',
      cell: { row: 0, column: 0 }
    },
    {
      name: 'a cell of a table without outer pipes',
      initial: 'a|b\n-|-\nc|d\n',
      leaf: 0,
      start: 0,
      end: 1,
      expected: '|     | b   |\n| --- | --- |\n| c   | d   |\n',
      caret: '|',
      cell: { row: 0, column: 0 }
    },
    {
      name: 'a body cell of a table without outer pipes',
      initial: 'a|b\n-|-\nc|d\n',
      leaf: 2,
      start: 0,
      end: 1,
      expected: '| a   | b   |\n| --- | --- |\n|     | d   |\n',
      caret: '|',
      cell: { row: 1, column: 0 }
    },
    {
      name: 'a cell in a quote',
      initial: '> | a | b |\n> | --- | --- |\n> | c | d |\n',
      leaf: 3,
      start: 0,
      end: 1,
      expected: '> | a   | b   |\n> | --- | --- |\n> | c   |     |\n',
      caret: '|',
      cell: { row: 1, column: 1 }
    }
  ])(
    'cuts $name as one undoable operation',
    async({ initial, leaf, start, end, expected, caret, cell }) => {
      const app = bootBoundMuya(initial)
      try {
        select(app, leaf, start, end)
        await cut(app)
        expect(app.adapter.state().status).toBe('ready')
        await expectRespelled(app, initial, expected, caret, cell)
      } finally {
        app.dispose()
      }
    }
  )
})

// Upstream (8d6c198c) moves a paragraph's text into the last cell before it and
// writes the table afresh.
describe('joining a paragraph into a table cell', () => {
  const joined = '| a   | bb    |\n| --- |:-----:|\n| ccc | dpara |\n'
  const initial = `${unpadded}\npara\n`

  it('Backspace at the paragraph start', async() => {
    const app = bootBoundMuya(initial)
    try {
      select(app, 4, 0, 0)
      await key(app, 'Backspace')
      await expectRespelled(app, initial, joined, 'd|para', { row: 1, column: 1 })
    } finally {
      app.dispose()
    }
  })

  it('Delete at the cell end', async() => {
    const app = bootBoundMuya(initial)
    try {
      select(app, 3, 1, 1)
      await key(app, 'Delete')
      await expectRespelled(app, initial, joined, 'd|para', { row: 1, column: 1 })
    } finally {
      app.dispose()
    }
  })
})

// A caret beside an escape addresses the cell's text by its model value.
describe('editing escaped text in a cell', () => {
  const initial = '| a\\|z | b |\n| --- | --- |\n| c | d |\n'

  it('types between a backslash and its pipe', async() => {
    const app = bootBoundMuya(initial)
    try {
      select(app, 0, 2, 2)
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe('| a\\x\\|z | b   |\n| ------ | --- |\n| c      | d   |\n')
      expect(app.muya.editor.selection.getSelection()?.anchor.offset).toBe(3)
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(initial)
    } finally {
      app.dispose()
    }
  })

  it('removes an escaping backslash', async() => {
    const app = bootBoundMuya(initial)
    try {
      select(app, 0, 2, 2)
      await key(app, 'Backspace')
      expect(source(app)).toBe('| a\\|z | b   |\n| ---- | --- |\n| c    | d   |\n')
      expect(app.muya.editor.selection.getSelection()?.anchor.offset).toBe(1)
    } finally {
      app.dispose()
    }
  })
})

const selectAcross = (
  app: BoundMuya,
  from: number,
  fromOffset: number,
  to: number,
  toOffset: number
) => {
  const all = leaves(app)
  const start = all[from]
  const end = all[to]
  if (start === undefined || end === undefined || !start.isContent() || !end.isContent()) {
    throw new Error('Expected leaves')
  }
  app.muya.editor.selection.setSelection(
    { block: start, path: start.path, offset: fromOffset },
    { block: end, path: end.path, offset: toOffset }
  )
}

const paste = async(app: BoundMuya, text: string) => {
  const target = app.muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  const host = app.muya.domNode as HTMLElement
  host.tabIndex = -1
  const selection = app.muya.editor.selection.getSelection()
  host.focus()
  if (selection) app.muya.editor.selection.setSelection(selection.anchor, selection.focus)
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : ''), files: [], items: [] }
  })
  target.dispatchEvent(event)
  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    app.muya.flush()
    await app.adapter.settled()
  }
}

// Upstream (8d6c198c) keeps a table's grid when a selection reaches into it:
// the start keeps its text before the selection and then the end's text after
// it, the cells after the start are emptied, and the table is written afresh.
describe('a selection reaching across table cells', () => {
  const withParagraph = `${unpadded}\npara\n`
  const before = `para\n\n${unpadded}`

  it.each([
    {
      name: 'cuts from a header cell into the next',
      initial: withParagraph,
      from: [0, 0],
      to: [1, 1],
      expected: '| b   |     |\n| --- |:---:|\n| ccc | d   |\n\npara\n',
      caret: '|b',
      cell: { row: 0, column: 0 }
    },
    {
      name: 'cuts from a header cell into the next row',
      initial: withParagraph,
      from: [1, 1],
      to: [2, 1],
      expected: '| a   | bcc |\n| --- |:---:|\n|     | d   |\n\npara\n',
      caret: 'b|cc',
      cell: { row: 0, column: 1 }
    },
    {
      name: 'cuts from a cell into the following paragraph',
      initial: withParagraph,
      from: [3, 0],
      to: [4, 2],
      expected: '| a   | bb  |\n| --- |:---:|\n| ccc | ra  |\n',
      caret: '|ra',
      cell: { row: 1, column: 1 }
    },
    {
      // The cell keeps the text after the selection, as upstream does (#5405).
      name: 'cuts from a paragraph into the following table',
      initial: before,
      from: [0, 2],
      to: [1, 0],
      expected: 'pa\n\n| a   | bb  |\n| --- |:---:|\n| ccc | d   |\n',
      caret: 'pa|',
      cell: null
    },
    {
      name: 'cuts into the cell a short row lacks',
      initial: '| a | b |\n| --- | --- |\n| c |\n',
      from: [2, 0],
      to: [3, 0],
      expected: '| a   | b   |\n| --- | --- |\n|     |     |\n',
      caret: '|',
      cell: { row: 1, column: 0 }
    }
  ])('$name', async({ initial, from, to, expected, caret, cell }) => {
    const app = bootBoundMuya(initial)
    try {
      selectAcross(app, ...(from as [number, number]), ...(to as [number, number]))
      await cut(app)
      expect(app.adapter.state().status).toBe('ready')
      await expectRespelled(app, initial, expected, caret, cell)
    } finally {
      app.dispose()
    }
  })

  it('types over the selection', async() => {
    const app = bootBoundMuya(withParagraph)
    try {
      selectAcross(app, 1, 1, 2, 1)
      await input(app, 'insertText', 'x')
      await expectRespelled(
        app,
        withParagraph,
        '| a   | bxcc |\n| --- |:----:|\n|     | d    |\n\npara\n',
        'bx|cc',
        { row: 0, column: 1 }
      )
    } finally {
      app.dispose()
    }
  })

  it('pastes over the selection, escaping a pasted pipe', async() => {
    const app = bootBoundMuya(withParagraph)
    try {
      selectAcross(app, 0, 0, 1, 1)
      await paste(app, 'p|q')
      await expectRespelled(
        app,
        withParagraph,
        '| p\\|qb |     |\n| ----- |:---:|\n| ccc   | d   |\n\npara\n',
        'p\\|q|b',
        { row: 0, column: 0 }
      )
    } finally {
      app.dispose()
    }
  })

  it('copies a selection across the cells of a table in a list', async() => {
    const initial = '- | a | b |\n  | --- | --- |\n  | c | d |\n'
    const app = bootBoundMuya(initial)
    const errors: unknown[] = []
    const onError = (event: ErrorEvent) => {
      errors.push(event.error)
      event.preventDefault()
    }
    window.addEventListener('error', onError)
    try {
      selectAcross(app, 0, 0, 1, 0)
      const copied = app.muya.editor.clipboard.getClipboardData()
      expect(errors).toEqual([])
      expect(copied.text).toBe('- | a   | b   |\n  | --- | --- |\n  | c   | d   |\n')
      expect(source(app)).toBe(initial)
    } finally {
      window.removeEventListener('error', onError)
      app.dispose()
    }
  })
})

// Upstream (8d6c198c) writes the whole table afresh when a short row gains a cell.
describe('writing into the cell a short row lacks', () => {
  const initial = '| a | b |\n| --- | --- |\n| c |\n'

  it('types text', async() => {
    const app = bootBoundMuya(initial)
    try {
      select(app, 3, 0, 0)
      await input(app, 'insertText', 'x')
      await expectRespelled(app, initial, '| a   | b   |\n| --- | --- |\n| c   | x   |\n', 'x|', {
        row: 1,
        column: 1
      })
    } finally {
      app.dispose()
    }
  })

  it('pastes text with a pipe', async() => {
    const app = bootBoundMuya(initial)
    try {
      select(app, 3, 0, 0)
      await paste(app, 'p|q')
      await expectRespelled(
        app,
        initial,
        '| a   | b    |\n| --- | ---- |\n| c   | p\\|q |\n',
        'p\\|q|',
        { row: 1, column: 1 }
      )
    } finally {
      app.dispose()
    }
  })
})

// Upstream (8d6c198c) writes the table afresh when Enter in its last row starts
// a paragraph after it.
it("Enter in a table's last row starts a paragraph and writes the table afresh", async() => {
  const app = bootBoundMuya(unpadded)
  try {
    select(app, 2, 1, 1)
    const target = app.muya.editor.selection.getSelection()?.anchor.block.domNode
    const down = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    target?.dispatchEvent(down)
    if (!down.defaultPrevented) {
      target?.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertParagraph',
          bubbles: true,
          cancelable: true
        })
      )
    }
    app.muya.flush()
    await app.adapter.settled()
    await expectRespelled(
      app,
      unpadded,
      '| a   | bb  |\n| --- |:---:|\n| ccc | d   |\n\n\n',
      '|',
      null
    )
  } finally {
    app.dispose()
  }
})
