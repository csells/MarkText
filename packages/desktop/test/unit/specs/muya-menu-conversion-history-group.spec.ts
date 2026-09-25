// @vitest-environment jsdom
import { ParagraphFrontMenu, ParagraphQuickInsertMenu } from '@muyajs/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

// Upstream History groups every change by time alone: a change within one
// second of the one that opened the current undo step joins it. A menu
// conversion therefore undoes together with the `/` query before it and the
// key typed right after it.

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

const placeCaret = (app: App, offset: number): void => {
  const content = app.muya.editor.scrollPage?.firstContentInDescendant()
  if (!content) throw new Error('Expected the first paragraph')
  content.setCursor(offset, offset, true)
}

const type = (app: App, data: string): void => {
  const target = app.muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Missing live selection')
  target.dispatchEvent(
    new InputEvent('beforeinput', { inputType: 'insertText', data, bubbles: true, cancelable: true })
  )
}

const history = async(app: App, kind: 'undo' | 'redo'): Promise<void> => {
  await app.adapter.history(kind, app.reconcile)
}

const quickInsert = (app: App, label: string): void => {
  const menu = new ParagraphQuickInsertMenu(app.muya)
  if (menu.container) menu.container.scrollTo = () => {}
  const block = app.muya.editor.selection.getSelection()?.anchor.block
  if (!block?.isContent()) throw new Error('Expected the quick-insert trigger')
  app.muya.eventCenter.emit('content-change', { block })
  const entry = menu.renderArray.find((item: { label: string }) => item.label === label)
  if (!entry) throw new Error(`Expected the ${label} quick-insert entry`)
  let pick: ((row: number, column: number) => void) | undefined
  const picker = (_: unknown, __: unknown, handler: (row: number, column: number) => void) => {
    pick = handler
  }
  app.muya.eventCenter.on('muya-table-picker', picker)
  try {
    menu.selectItem(entry)
  } finally {
    app.muya.eventCenter.off('muya-table-picker', picker)
  }
  if (label === 'table') {
    if (!pick) throw new Error('Expected the table picker')
    clock += 100
    pick(1, 2)
  }
}

const turnInto = async(app: App, label: string): Promise<void> => {
  const menu = new ParagraphFrontMenu(app.muya)
  const block = app.muya.editor.scrollPage?.firstContentInDescendant()
  if (!block) throw new Error('Expected the front-menu paragraph')
  app.muya.eventCenter.emit('muya-front-menu', { reference: block.domNode, block: block.parent })
  await new Promise((resolve) => setTimeout(resolve, 0))
  menu.selectItem(new MouseEvent('click'), { label })
}

const conversions = [
  { label: 'atx-heading 1', query: '/hea', key: 'd', shape: /^(?:\{~~[^~]*~>)?# / },
  { label: 'block-quote', query: '/quot', key: 'e', shape: /^(?:\{~~[^~]*~>)?> / },
  { label: 'table', query: '/tabl', key: 'e', shape: /\|/ }
] as const

for (const tracked of [false, true]) {
  for (const { label, query, key, shape } of conversions) {
    it(`groups quick-insert ${label} with its query and the next key (Track=${tracked})`, async() => {
      const seed = `${query}\n\nafter\n`
      const app = bootBoundMuya(seed)
      app.track(tracked)
      try {
        placeCaret(app, query.length)
        type(app, key)
        clock += 100
        quickInsert(app, label)
        const converted = source(app)
        expect(converted).toMatch(shape)
        if (tracked) expect(converted).toMatch(/\{~~|\{\+\+/)
        clock += 100
        type(app, 'X')
        const typed = source(app)
        expect(typed).not.toBe(converted)
        expect(typed).toContain('X')
        expect(app.legacyChanges).toEqual([])

        await history(app, 'undo')
        expect(source(app)).toBe(seed)
        await history(app, 'redo')
        expect(source(app)).toBe(typed)
      } finally {
        app.dispose()
      }
    })

    it(`keeps quick-insert ${label} apart from a key typed over a second later (Track=${tracked})`, async() => {
      const seed = `${query}\n\nafter\n`
      const app = bootBoundMuya(seed)
      app.track(tracked)
      try {
        placeCaret(app, query.length)
        type(app, key)
        clock += 100
        quickInsert(app, label)
        const converted = source(app)
        clock += 1500
        type(app, 'X')
        const typed = source(app)
        expect(typed).not.toBe(converted)

        await history(app, 'undo')
        expect(source(app)).toBe(converted)
        await history(app, 'undo')
        expect(source(app)).toBe(seed)
        await history(app, 'redo')
        await history(app, 'redo')
        expect(source(app)).toBe(typed)
      } finally {
        app.dispose()
      }
    })
  }

  for (const { label, shape } of [
    { label: 'atx-heading 2', shape: /^(?:\{\+\+)?## / },
    { label: 'block-quote', shape: /^(?:\{\+\+)?> / }
  ]) {
    it(`groups the front menu's turn-into ${label} with the keys around it (Track=${tracked})`, async() => {
      const seed = 'para\n\nafter\n'
      const app = bootBoundMuya(seed)
      app.track(tracked)
      try {
        placeCaret(app, 4)
        type(app, 'Y')
        clock += 100
        await turnInto(app, label)
        const converted = source(app)
        expect(converted).toMatch(shape)
        if (tracked) expect(converted).toMatch(/\{\+\+/)
        clock += 100
        type(app, 'X')
        const typed = source(app)
        expect(typed).not.toBe(converted)
        expect(typed).toContain('X')
        expect(app.legacyChanges).toEqual([])

        await history(app, 'undo')
        expect(source(app)).toBe(seed)
        await history(app, 'redo')
        expect(source(app)).toBe(typed)
      } finally {
        app.dispose()
      }
    })

    it(`keeps the front menu's turn-into ${label} apart from a key typed over a second later (Track=${tracked})`, async() => {
      const seed = 'para\n\nafter\n'
      const app = bootBoundMuya(seed)
      app.track(tracked)
      try {
        placeCaret(app, 4)
        await turnInto(app, label)
        const converted = source(app)
        expect(converted).toMatch(shape)
        clock += 1500
        type(app, 'X')
        const typed = source(app)

        await history(app, 'undo')
        expect(source(app)).toBe(converted)
        await history(app, 'undo')
        expect(source(app)).toBe(seed)
        await history(app, 'redo')
        await history(app, 'redo')
        expect(source(app)).toBe(typed)
      } finally {
        app.dispose()
      }
    })
  }
}
