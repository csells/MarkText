// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

// Upstream History records cut and paste like typing: neither marks an input
// boundary, so each joins the undo step opened within the last second, and the
// key typed within a second of that step joins it too.

let clock = 0

beforeEach(() => {
  clock = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

type App = ReturnType<typeof bootBoundMuya>

const source = (app: App): string => {
  const barrier = app.binding.sourceAtBarrier()
  if (!('source' in barrier) || typeof barrier.source !== 'string') {
    throw new Error('Expected a settled source')
  }
  return barrier.source
}

const select = (app: App, anchor: number, focus = anchor): void => {
  const block = app.muya.editor.scrollPage?.firstContentInDescendant()
  if (!block) throw new Error('Expected the first paragraph')
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

const paste = (app: App, text: string, html = ''): Promise<void> =>
  app.muya.editor.clipboard.pasteHandler({
    preventDefault() {},
    stopPropagation() {},
    clipboardData: {
      getData: (type: string) => (type === 'text/plain' ? text : type === 'text/html' ? html : ''),
      files: [],
      items: []
    }
  } as unknown as ClipboardEvent)

const cases = [
  {
    name: 'Cut',
    command: async(app: App) => {
      select(app, 1, 3)
      app.muya.editor.clipboard.cutHandler()
    }
  },
  {
    name: 'plain-text Paste',
    command: (app: App) => paste(app, 'XY')
  },
  {
    name: 'rich-text Paste',
    command: (app: App) => paste(app, 'XY', '<strong>XY</strong>')
  }
] as const

for (const tracked of [false, true]) {
  for (const { name, command } of cases) {
    for (const gap of [100, 1500]) {
      it(`groups ${name} with keys ${gap}ms around it as upstream does (Track=${tracked})`, async() => {
        const app = bootBoundMuya('para\n\nafter\n')
        app.track(tracked)
        try {
          select(app, 4)
          const steps = [source(app)]
          type(app, 'a')
          steps.push(source(app))
          clock += 100
          await command(app)
          await app.adapter.settled()
          app.muya.flush()
          steps.push(source(app))
          clock += gap
          type(app, 'b')
          await app.adapter.settled()
          const typed = source(app)
          expect(new Set([...steps, typed]).size).toBe(4)
          app.muya.flush()
          expect(app.legacyChanges).toEqual([])

          const expected = gap < 1000 ? [steps[0]] : [steps[2], steps[0]]
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
