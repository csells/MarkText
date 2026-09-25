// @vitest-environment jsdom
import { TableRowColumMenu } from '@muyajs/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import type { Content } from '../helpers/muyaTypes'

// Upstream History records a command's json change like any other change: it
// joins the undo step opened within the last second, and so does the key typed
// within a second of that step. The menu-bar Paragraph and Format commands, the
// table row menu, task checkboxes and Cmd/Ctrl+Enter row insertion therefore
// undo together with the keys typed around them.

let clock = 0

beforeEach(() => {
  clock = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

type App = ReturnType<typeof bootBoundMuya>

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

const select = (app: App, block: Content, anchor: number, focus = anchor): void => {
  app.muya.editor.activeContentBlock = block
  block.setCursor(anchor, focus, true)
}

const type = (app: App, data: string): void => {
  const target = app.muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Missing live selection')
  target.dispatchEvent(
    new InputEvent('beforeinput', { inputType: 'insertText', data, bubbles: true, cancelable: true })
  )
}

interface Case {
  readonly name: string
  readonly seed: string
  readonly at: (app: App) => void
  readonly command: (app: App) => void
  readonly after?: (app: App) => void
}

const endOf = (pick: (blocks: Content[]) => Content) => (app: App) => {
  const block = pick(contents(app))
  select(app, block, block.text.length)
}
const firstBlock = (blocks: Content[]) => blocks[0]!
const lastBlock = (blocks: Content[]) => blocks[blocks.length - 1]!

const cases: Case[] = [
  {
    name: 'Paragraph > Heading 1',
    seed: 'para\n\nafter\n',
    at: endOf(firstBlock),
    command: (app) => app.muya.updateParagraph('heading 1')
  },
  {
    name: 'Paragraph > Quote Block',
    seed: 'para\n\nafter\n',
    at: endOf(firstBlock),
    command: (app) => app.muya.updateParagraph('blockquote')
  },
  {
    name: 'Paragraph > Bullet List',
    seed: 'para\n\nafter\n',
    at: endOf(firstBlock),
    command: (app) => app.muya.updateParagraph('ul-bullet')
  },
  {
    name: 'Paragraph > Insert Paragraph After',
    seed: 'para\n\nafter\n',
    at: endOf(firstBlock),
    command: (app) => app.muya.insertParagraph('after', '', true)
  },
  {
    name: 'Paragraph > Duplicate',
    seed: 'para\n\nafter\n',
    at: endOf(firstBlock),
    command: (app) => app.muya.duplicate()
  },
  {
    name: 'Format > Strong',
    seed: 'para\n\nafter\n',
    at: endOf(firstBlock),
    command: (app) => {
      const block = firstBlock(contents(app))
      select(app, block, 0, block.text.length)
      app.muya.format('strong')
    },
    after: endOf(firstBlock)
  },
  {
    name: 'Format > Emphasis',
    seed: 'para\n\nafter\n',
    at: endOf(firstBlock),
    command: (app) => {
      const block = firstBlock(contents(app))
      select(app, block, 0, block.text.length)
      app.muya.format('em')
    },
    after: endOf(firstBlock)
  },
  {
    name: 'the table menu Insert Row Below',
    seed: '| a | b |\n| --- | --- |\n| c | d |\n',
    at: endOf(lastBlock),
    command: (app) => {
      const menu = new TableRowColumMenu(app.muya)
      const content = lastBlock(contents(app))
      app.muya.eventCenter.emit('muya-table-bar', {
        reference: content.domNode,
        tableInfo: { barType: 'right' },
        block: content.parent
      })
      menu.selectItem(new MouseEvent('click'), {
        label: 'insert-row-below',
        action: 'insert',
        target: 'row',
        location: 'next'
      } as Parameters<TableRowColumMenu['selectItem']>[1])
    },
    after: endOf(lastBlock)
  },
  {
    name: 'Cmd/Ctrl+Enter row insertion',
    seed: '| a | b |\n| --- | --- |\n| c | d |\n',
    at: endOf(lastBlock),
    command: (app) => {
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
    }
  },
  {
    name: 'a task checkbox toggle',
    seed: '- [ ] task\n\nafter\n',
    at: endOf(firstBlock),
    command: (app) => {
      const checkbox = app.muya.domNode.querySelector<HTMLInputElement>('.mu-task-list-checkbox')
      if (!checkbox) throw new Error('Expected a task checkbox')
      checkbox.click()
    },
    after: endOf(firstBlock)
  }
]

/** Sources reached by undo when the command follows `a` by 100ms and precedes `b` by `gap`. */
const expectedUndo = (gap: number, [seed, , commanded]: string[]) =>
  gap < 1000 ? [seed] : [commanded, seed]

for (const tracked of [false, true]) {
  for (const { name, seed, at, command, after } of cases) {
    for (const gap of [100, 1500]) {
      it(`groups ${name} with keys ${gap}ms around it as upstream does (Track=${tracked})`, async() => {
        const app = bootBoundMuya(seed)
        app.track(tracked)
        try {
          at(app)
          const steps = [source(app)]
          type(app, 'a')
          steps.push(source(app))
          clock += 100
          command(app)
          app.muya.flush()
          steps.push(source(app))
          clock += gap
          after?.(app)
          type(app, 'b')
          const typed = source(app)
          expect(new Set([...steps, typed]).size).toBe(4)
          app.muya.flush()
          expect(app.legacyChanges).toEqual([])

          const expected = expectedUndo(gap, steps)
          const undone: string[] = []
          for (const _ of expected) {
            await app.adapter.history('undo', app.reconcile)
            undone.push(source(app))
          }
          expect(undone).toEqual(expected)
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
