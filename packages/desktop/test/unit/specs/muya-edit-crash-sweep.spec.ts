// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bootBoundMuya, yieldToEventLoop } from '../helpers/boundMuyaDocument'
import type { MaybeContent } from '../helpers/muyaTypes'
import { separateUndoSteps } from '../helpers/separateUndoSteps'

separateUndoSteps()

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

const source = (app: BoundMuya) => {
  const reply = app.binding.sourceAtBarrier()
  if (reply.type !== 'source') throw new Error('Expected source')
  return reply.source
}

/** Dispatches a key as the browser does: keydown, then beforeinput if not handled. */
const press = async({ muya, adapter }: BoundMuya, key: string) => {
  const target = muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('No live selection')
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
  const inputType = {
    Enter: 'insertParagraph',
    ShiftEnter: 'insertLineBreak',
    Backspace: 'deleteContentBackward',
    Delete: 'deleteContentForward'
  }[key]
  target.dispatchEvent(
    new InputEvent('beforeinput', {
      inputType: inputType ?? 'insertText',
      data: inputType === undefined ? key : null,
      bubbles: true,
      cancelable: true
    })
  )
  muya.flush()
  await adapter.settled()
}

// Edge documents: empty and blank documents, lone markers, nested containers,
// ragged tables, every kind of task item, literal blocks, front matter, CRLF
// and annotations at block and line boundaries.
const documents = [
  '',
  '\n',
  '   \n',
  '\n\n\n',
  'no eol',
  '-',
  '- ',
  '1.',
  '>',
  '> ',
  '#',
  '# ',
  '```',
  '$$',
  '---',
  '|',
  '[ ]',
  '- [ ]',
  '- [ ] ',
  '* ',
  '+ ',
  '1) ',
  '> - a\n>   - b\n>     > c\n',
  '- a\n  - b\n    - c\n',
  '> > a\n> > b\n',
  '1. a\n   > b\n   > c\n',
  '- a\n\n  b\n',
  '| a | b |\n| --- | --- |\n| c |\n',
  '| a |\n| - |\n| b | c | d |\n',
  '| a | b |\n|---|---|\n',
  'a|b\n-|-\n',
  '| a | b |\n| :-: | --: |\n| c | d |\n',
  '|  |  |\n| - | - |\n|  |  |\n',
  '| a |\n|---|\n| b\n',
  '- [ ] a\n- [x] b\n',
  '1. [ ] a\n2. [x] b\n',
  '2) [x] c\n',
  '- a\n  - [ ] b\n',
  '> - [ ] a\n',
  '> 1. [ ] a\n',
  '- [ ] {++a++}\n',
  '1. [ ] {--a--}\n',
  '- [ ]\n',
  '- [ ] \n  b\n',
  '1. [ ] a\n   b\n',
  '- [x] a\n  - [ ] b\n',
  '3) [ ] a\n\n   b\n',
  '<div>\na\n</div>\n',
  '```js\ncode\n```\n',
  '```\n```\n',
  '    indented\n',
  '      deeper\n',
  '$$\nx\n$$\n',
  '$$\n$$\n',
  '```mermaid\ngraph\n```\n',
  '<!-- c -->\n',
  '> ```\n> x\n> ```\n',
  '- $$\n  x\n  $$\n',
  '> <div>\n> a\n> </div>\n',
  '- a\n\n      code\n',
  '---\ntitle: x\n---\n\nbody\n',
  '+++\na = 1\n+++\n',
  'a\r\nb\r\n',
  '- a\r\n  b\r\n',
  '| a |\r\n| - |\r\n| b |\r\n',
  '> a\r\n> b\r\n',
  '1. [ ] a\r\n',
  '```\r\nx\r\n```\r\n',
  '{++a++}\n',
  'a {++b++} c\n',
  '{--a--}\nb\n',
  '{~~a~>b~~}\n',
  '{==a==}{>>c<<}\n',
  'a{>>c<<}\n',
  '{++a\nb++}\n',
  '- {++a++}\n',
  '> {--a--}\n',
  '| {++a++} | b |\n| - | - |\n| c | d |\n',
  '# {++h++}\n',
  'a\n{++b++}\n',
  'a {++x++}\nb\n',
  '{++a++}\n{++b++}\n',
  '- {++a\n  b++}\n',
  'a\n\n{++b\n\nc++}\n',
  'a  \nb\n',
  'a\\\nb\n',
  '# h\n',
  'h\n===\n',
  '[x]: /u\n',
  '[^1]: note\n',
  'a\n\n\n\nb\n',
  '![i](u)\n',
  'a\nb\n',
  '- a\n  b\n',
  '> a\n> b\n',
  'a <b>c</b> d\n',
  '`a` b\n',
  'a **b** c\n',
  '[a](b) c\n',
  '&amp; a\n',
  // Thematic breaks, setext underlines and the paragraphs around them.
  '***',
  '***\n',
  '***\na',
  '***\na\n',
  'a\n***',
  '- - -',
  '___\n',
  'a\n---',
  'a\n---\n',
  'a\n---\nb\n',
  'x\n\na\n---\n',
  '> a\n> ---\n',
  '- a\n  ---\n',
  'a\n===\n',
  'a\nb\n---\n',
  '---\n---\n',
  'a\n\n---\n\nb\n',
  '# h\na',
  '# h\na\n# j\n',
  'a\n# h\n',
  '$$\nc\n$$\na',
  '<div>\n</div>\n\na',
  '```js\na\n```\n---\n',
  // Indented code and its language box.
  '    a\n\n    b\n',
  '- x\n\n      code\n',
  '>     code\n',
  '    a\r\n',
  '    a',
  'p\n\n    code\n\nq\n',
  // Lone markers, whitespace-only lines and empty task paragraphs.
  '*',
  '>',
  '1)',
  '> a  \n> b\n',
  'x\n\na  \nb\n',
  '- [ ] \n\n  b\n',
  '1. [ ] \n',
  '3) [x] \n\n   b\n',
  // Item text on the marker's next line, empty paragraphs before later blocks,
  // rules beside lazy lines and bare markers.
  '- \n  b\n',
  '> - \n>   b\n',
  '- \n  - c\n',
  '- [x] \n  - [ ] c\n',
  '- x\na\n---\n',
  '> x\n> ***\n> y\n',
  '-\n',
  '1)\n',
  '- [x]\n'
]

const keys = ['Enter', 'ShiftEnter', 'Backspace', 'Delete', 'x']

describe('editing edge documents with real key events', () => {
  it.each(documents)(
    'keeps %j editable and undoable at every line and block boundary',
    async(initial) => {
      const probe = bootBoundMuya(initial)
      const carets: Array<[number, number]> = []
      try {
        leaves(probe).forEach((leaf, index) => {
          const text = leaf.text
          for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)) {
            const line = match[0].replace(/(?:\r\n|\r|\n)$/u, '')
            for (const at of new Set([
              match.index,
              match.index + Math.floor(line.length / 2),
              match.index + line.length
            ])) {
              carets.push([index, at])
            }
            if (!/[\r\n]$/u.test(match[0])) break
          }
        })
      } finally {
        probe.dispose()
      }
      const failures: string[] = []
      for (const [leaf, at] of carets) {
        for (const key of keys) {
          const errors: string[] = []
          const onError = (event: ErrorEvent) => {
            errors.push(String(event.error ?? event.message))
            event.preventDefault()
          }
          window.addEventListener('error', onError)
          const app = bootBoundMuya(initial)
          try {
            const block = leaves(app)[leaf]
            if (block === undefined || !block.isContent()) throw new Error('No content leaf')
            block.setCursor(at, at, true)
            await press(app, key)
            // The resulting caret is live: typing continues there.
            await press(app, 'z')
            for (let undo = 0; undo < 12 && source(app) !== initial; undo += 1) {
              await app.adapter.history('undo', app.reconcile)
            }
            if (errors.length > 0) throw new Error(errors.join('; '))
            if (source(app) !== initial) throw new Error(`undo left ${JSON.stringify(source(app))}`)
            if (app.adapter.state().status !== 'ready') throw new Error('adapter faulted')
          } catch (error) {
            failures.push(`leaf ${leaf} at ${at} ${key}: ${String(error).split('\n')[0]}`)
          } finally {
            window.removeEventListener('error', onError)
            app.dispose()
            await yieldToEventLoop()
          }
        }
      }
      expect(failures).toEqual([])
    }
  )
})

/** Dispatches a clipboard event over the live selection, as the browser does. */
const clipboardEvent = async(
  { muya, adapter }: BoundMuya,
  type: 'cut' | 'copy' | 'paste',
  text = ''
) => {
  const selection = muya.editor.selection.getSelection()
  const target = selection?.anchor.block.domNode
  if (selection === null || selection === undefined || !target?.isConnected) {
    throw new Error('No live selection')
  }
  // Clipboard events belong to the focused editor.
  const host = muya.domNode as HTMLElement
  host.tabIndex = -1
  host.focus()
  muya.editor.selection.setSelection(selection.anchor, selection.focus)
  const data = new Map<string, string>([['text/plain', text]])
  const event = new Event(type, { bubbles: true, cancelable: true })
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

// Ragged rows, alignment, wide characters, escaped pipes, code spans with
// pipes, annotations in cells, tables in containers and tables beside text.
const tableDocuments = [
  '| a | bb |\n|---|:-:|\n| ccc | d |\n\npara\n',
  'para\n\n| a | bb |\n|---|:-:|\n| ccc | d |\n',
  '| a | b |\n| --- | --- |\n| c |\n',
  '| a |\n| - |\n| b | c | d |\n',
  '| a | b |\n| :-: | --: |\n| c | d |\n',
  '| 中文 | b |\n| --- | --- |\n| 日本 | d |\n',
  '| a\\|z | b |\n| --- | --- |\n| c | d |\n',
  '| `a\\|b` | c |\n| --- | --- |\n| d | e |\n',
  '| {++a++} | b |\n| - | - |\n| c | d |\n',
  '| a{==b==}{>>c<<} | d |\n| - | - |\n| e | f |\n',
  '| {--x--}y | z |\n| - | - |\n',
  '- | a | b |\n  | --- | --- |\n  | c | d |\n',
  '> | a | b |\n> | --- | --- |\n> | c | d |\n',
  '|  |  |\n| - | - |\n|  |  |\n',
  '| a | b |\n|---|---|\n',
  'a|b\n-|-\nc|d\n',
  '| &amp; | b |\n| - | - |\n| c | d |\n',
  '| **a** | b |\n| --- | --- |\n| c | d |\n\n# h\n',
  '| a | b |\r\n| - | - |\r\n| c | d |\r\n'
]

type TableOperation =
  | { key: string }
  | { clipboard: 'cut' | 'copy' | 'paste' }
  | { format: 'strong' }

const tableOperations: TableOperation[] = [
  ...['Enter', 'ShiftEnter', 'Backspace', 'Delete', 'x', '|'].map((key) => ({ key })),
  { clipboard: 'cut' },
  { clipboard: 'copy' },
  { clipboard: 'paste' },
  { format: 'strong' }
]

describe('editing table documents with real events', () => {
  it.each(tableDocuments)(
    'keeps %j editable, one undo step per command, at every cell boundary and selection',
    async(initial) => {
      const probe = bootBoundMuya(initial)
      const selections: Array<[number, number, number, number]> = []
      try {
        const texts = leaves(probe).map((leaf) => leaf.text)
        texts.forEach((text, index) => {
          for (const at of new Set([0, Math.floor(text.length / 2), text.length])) {
            selections.push([index, at, index, at])
          }
          if (text.length > 0) selections.push([index, 0, index, text.length])
          if (index + 1 < texts.length) {
            selections.push([
              index,
              Math.floor(text.length / 2),
              index + 1,
              Math.floor((texts[index + 1]?.length ?? 0) / 2)
            ])
          }
        })
      } finally {
        probe.dispose()
      }
      const failures: string[] = []
      for (const [from, fromOffset, to, toOffset] of selections) {
        for (const operation of tableOperations) {
          const errors: string[] = []
          const onError = (event: ErrorEvent) => {
            errors.push(String(event.error ?? event.message))
            event.preventDefault()
          }
          window.addEventListener('error', onError)
          const app = bootBoundMuya(initial)
          try {
            const all = leaves(app)
            const start = all[from]
            const end = all[to]
            if (
              start === undefined ||
              end === undefined ||
              !start.isContent() ||
              !end.isContent()
            ) {
              throw new Error('No content leaf')
            }
            app.muya.editor.selection.setSelection(
              { block: start, path: start.path, offset: fromOffset },
              { block: end, path: end.path, offset: toOffset }
            )
            if ('key' in operation) await press(app, operation.key)
            else if ('clipboard' in operation) await clipboardEvent(app, operation.clipboard, 'p|q')
            else {
              app.muya.format(operation.format)
              app.muya.flush()
              await app.adapter.settled()
            }
            if (errors.length > 0) throw new Error(errors.join('; '))
            if (app.adapter.state().status !== 'ready') throw new Error('adapter faulted')
            const edited = source(app)
            // The view is what reopening the saved source shows. A line break
            // at a paragraph's end stays visible until the next edit.
            const reopened = bootBoundMuya(edited)
            try {
              const shown = leaves(app).map((leaf) => leaf.text)
              const expected = leaves(reopened).map((leaf) => leaf.text)
              if (
                JSON.stringify(shown) !== JSON.stringify(expected) &&
                !('key' in operation && operation.key === 'ShiftEnter')
              ) {
                throw new Error(`view ${JSON.stringify(shown)} is not ${JSON.stringify(expected)}`)
              }
            } finally {
              reopened.dispose()
            }
            // The resulting caret is live: typing continues there.
            if (app.muya.editor.selection.getSelection()?.anchor.block.domNode?.isConnected) {
              await press(app, 'z')
            }
            await app.adapter.history('undo', app.reconcile)
            if (source(app) !== edited && edited !== initial) {
              await app.adapter.history('undo', app.reconcile)
            }
            if (errors.length > 0) throw new Error(errors.join('; '))
            if (source(app) !== initial) {
              throw new Error(`one undo per command left ${JSON.stringify(source(app))}`)
            }
          } catch (error) {
            failures.push(
              `${from}:${fromOffset}-${to}:${toOffset} ${JSON.stringify(operation)}: ${String(error).split('\n')[0]}`
            )
          } finally {
            window.removeEventListener('error', onError)
            app.dispose()
            await yieldToEventLoop()
          }
        }
      }
      expect(failures).toEqual([])
    },
    120_000
  )
})
