// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Muya } from '@muyajs/core'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

// Upstream History groups changes by time alone. Only the key handlers that
// call `markInputBoundary` start a new step: Enter through `Format.enterHandler`
// (a plain paragraph, a quote line with text, a heading after its marker, a list
// item holding more than one block) and Shift+Enter on a blank line both mark a
// word boundary; a forward Delete join marks a delete. Every other structural key
// (list, code and table Enter, Shift+Enter, Tab, Backspace at a block start) joins
// the step of the keys typed within one second around it.

let clock = 0

beforeEach(() => {
  clock = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

type App = ReturnType<typeof bootBoundMuya>
type Content = NonNullable<ReturnType<NonNullable<Muya['editor']['scrollPage']>['firstContentInDescendant']>>

const source = (app: App): string => {
  const barrier = app.binding.sourceAtBarrier()
  if (!('source' in barrier) || typeof barrier.source !== 'string') {
    throw new Error('Expected a settled source')
  }
  return barrier.source
}

const contents = (app: App): Content[] => {
  const found: Content[] = []
  let block = app.muya.editor.scrollPage?.firstContentInDescendant() ?? null
  while (block) {
    found.push(block)
    block = block.nextContentInContext() as Content | null
  }
  return found
}

const caret = (app: App, pick: (blocks: Content[]) => Content, offset: 'end' | number): void => {
  const block = pick(contents(app))
  const at = offset === 'end' ? block.text.length : offset
  app.muya.editor.activeContentBlock = block
  block.setCursor(at, at, true)
}

const live = (app: App) => {
  const target = app.muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Missing live selection')
  return target
}

const input = (app: App, inputType: string, data: string | null): void => {
  live(app).dispatchEvent(
    new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true })
  )
}

const key = (app: App, init: KeyboardEventInit): void => {
  live(app).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
}

/** How upstream History splits `before`, the key and `after` into undo steps. */
type Boundary = 'none' | 'before-key' | 'around-key'

interface Case {
  readonly name: string
  readonly seed: string
  readonly at: (app: App) => void
  readonly before?: (app: App) => void
  readonly press: (app: App) => void
  readonly boundary: Boundary
}

const last = (blocks: Content[]) => blocks[blocks.length - 1]!
const first = (blocks: Content[]) => blocks[0]!
const enter = (app: App) => input(app, 'insertParagraph', null)
const shiftEnter = (app: App) => input(app, 'insertLineBreak', null)

const cases: Case[] = [
  {
    name: 'Enter in a paragraph',
    seed: 'seed\n',
    at: (app) => caret(app, first, 'end'),
    press: enter,
    boundary: 'before-key'
  },
  {
    name: 'Enter at the end of a heading',
    seed: '# head\n',
    at: (app) => caret(app, first, 'end'),
    press: enter,
    boundary: 'before-key'
  },
  {
    name: 'Enter in a quote line',
    seed: '> quote\n',
    at: (app) => caret(app, first, 'end'),
    press: enter,
    boundary: 'before-key'
  },
  {
    name: 'Enter in a list item',
    seed: '- one\n',
    at: (app) => caret(app, first, 'end'),
    press: enter,
    boundary: 'none'
  },
  {
    name: 'Enter in a code block',
    seed: '```\ncode\n```\n',
    at: (app) => caret(app, last, 'end'),
    press: enter,
    boundary: 'none'
  },
  {
    name: 'Enter in a table cell',
    seed: '| a | b |\n| --- | --- |\n| c | d |\n',
    at: (app) => caret(app, last, 'end'),
    press: enter,
    boundary: 'none'
  },
  {
    name: 'Shift+Enter in a paragraph',
    seed: 'seed\n',
    at: (app) => caret(app, first, 'end'),
    press: shiftEnter,
    boundary: 'none'
  },
  {
    name: 'Backspace joining two paragraphs',
    seed: 'seed\n\nnext\n',
    at: (app) => caret(app, last, 0),
    before: (app) => {
      input(app, 'insertText', 'a')
      caret(app, last, 0)
    },
    press: (app) => key(app, { key: 'Backspace' }),
    boundary: 'none'
  },
  {
    name: 'Delete joining two paragraphs',
    seed: 'seed\n\nnext\n',
    at: (app) => caret(app, first, 'end'),
    press: (app) => key(app, { key: 'Delete' }),
    boundary: 'around-key'
  },
  {
    name: 'Tab indenting a list item',
    seed: '- one\n- two\n',
    at: (app) => caret(app, last, 'end'),
    press: (app) => key(app, { key: 'Tab' }),
    boundary: 'none'
  },
  {
    name: 'Shift+Tab outdenting a list item',
    seed: '- one\n  - two\n',
    at: (app) => caret(app, last, 'end'),
    press: (app) => key(app, { key: 'Tab', shiftKey: true }),
    boundary: 'none'
  }
]

/** Sources reached by undo from after `after`, for a key pressed 100ms after `before`. */
const expectedUndo = (boundary: Boundary, gap: number, [seed, typed, pressed]: string[]) => {
  if (boundary === 'around-key') return [pressed, typed, seed]
  if (boundary === 'before-key') return gap < 1000 ? [typed, seed] : [pressed, typed, seed]
  return gap < 1000 ? [seed] : [pressed, seed]
}

for (const tracked of [false, true]) {
  for (const { name, seed, at, before, press, boundary } of cases) {
    for (const gap of [100, 1500]) {
      it(`groups ${name} as upstream does with a key ${gap}ms later (Track=${tracked})`, async() => {
        const app = bootBoundMuya(seed)
        app.track(tracked)
        try {
          at(app)
          const steps = [source(app)]
          if (before) before(app)
          else input(app, 'insertText', 'a')
          steps.push(source(app))
          clock += 100
          press(app)
          steps.push(source(app))
          clock += gap
          input(app, 'insertText', 'b')
          const typed = source(app)
          expect(new Set([...steps, typed]).size).toBe(4)
          app.muya.flush()
          expect(app.legacyChanges).toEqual([])

          const undone: string[] = []
          for (const _ of expectedUndo(boundary, gap, steps)) {
            await app.adapter.history('undo', app.reconcile)
            undone.push(source(app))
          }
          expect(undone).toEqual(expectedUndo(boundary, gap, steps))
          while (source(app) !== typed) {
            const before = source(app)
            await app.adapter.history('redo', app.reconcile)
            expect(source(app)).not.toBe(before)
          }
        } finally {
          app.dispose()
        }
      })
    }
  }
}
