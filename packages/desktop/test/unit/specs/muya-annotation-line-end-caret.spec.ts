// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createMuyaModelSelection } from '@/documentAuthority/muyaModelSelection'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

type BoundMuya = ReturnType<typeof bootBoundMuya>

const content = (app: BoundMuya) => {
  const block = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
  if (block == null || !block.isContent()) throw new Error('Expected content leaf')
  return block
}

const source = (app: BoundMuya) => {
  const reply = app.binding.sourceAtBarrier()
  if (reply.type !== 'source') throw new Error('Expected source')
  return reply.source
}

const type = async({ muya, adapter }: BoundMuya, text: string) => {
  for (const data of text) {
    const target = muya.editor.selection.getSelection()?.anchor.block.domNode
    if (!target?.isConnected) throw new Error('Expected live selection')
    const event = new InputEvent('beforeinput', { inputType: 'insertText', data, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    muya.flush()
  }
  await adapter.settled()
}

/** Where the browser's ⌘→ or End lands: the end of the line's last text node. */
const lastTextEnd = (app: BoundMuya) => {
  const root = content(app).domNode!
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let last: Node | null = null
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent !== '') last = node
  }
  if (last === null) throw new Error('Expected rendered text')
  return { node: last, offset: last.textContent!.length }
}

const lineEndStep = (app: BoundMuya) =>
  createMuyaModelSelection(app.muya, app.view()).lineEndStep(lastTextEnd(app))

// Owner decision (plan 0012 G38): the visible line end is after the closers of
// annotations that end the line, as its start is before leading openers.
describe('visible line-end caret after a trailing annotation', () => {
  it.each([
    ['Alpha {++beta++}\n', 'Alpha {++beta++}Z\n'],
    ['Alpha {--beta--}\n', 'Alpha {--beta--}Z\n'],
    ['Alpha {==beta==}\n', 'Alpha {==beta==}Z\n'],
    ['Alpha {~~old~>new~~}\n', 'Alpha {~~old~>new~~}Z\n'],
    // The outer closer has no rendered position of its own; typing leaves the highlight.
    ['Alpha {++{==beta==}++}\n', 'Alpha {++{==beta==}Z++}\n']
  ])('types after the closer of %s', async(initial, expected) => {
    const app = bootBoundMuya(initial)
    try {
      content(app).setCursor(1, 1, true)
      const exterior = lineEndStep(app)
      expect(exterior).toBeDefined()
      app.muya.editor.selection.setDOMSelection(exterior!, exterior!)
      await type(app, 'Z')
      expect(source(app)).toBe(expected)
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(initial)
    } finally {
      app.dispose()
    }
  })

  it('extends the trailing addition when Track Changes is on', async() => {
    const app = bootBoundMuya('Alpha {++beta++}\n')
    try {
      app.track(true)
      content(app).setCursor(1, 1, true)
      const exterior = lineEndStep(app)
      app.muya.editor.selection.setDOMSelection(exterior!, exterior!)
      await type(app, 'Z')
      expect(source(app)).toBe('Alpha {++betaZ++}\n')
    } finally {
      app.dispose()
    }
  })

  it.each([
    'Alpha {++beta++} tail\n',
    'Alpha beta\n'
  ])('leaves the native line end of %s alone', (initial) => {
    const app = bootBoundMuya(initial)
    try {
      expect(lineEndStep(app)).toBeUndefined()
    } finally {
      app.dispose()
    }
  })

  it('keeps typing inside an addition whose end the caret reached by typing', async() => {
    const app = bootBoundMuya('Alpha {++beta++}\n')
    try {
      const end = lastTextEnd(app)
      app.muya.editor.selection.setDOMSelection(end, end)
      await type(app, 'Z')
      expect(source(app)).toBe('Alpha {++betaZ++}\n')
    } finally {
      app.dispose()
    }
  })
})
