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

const endOfFirst = (app: BoundMuya) => {
  const leaf = leaves(app)[0]
  if (leaf === undefined || !leaf.isContent()) throw new Error('Expected content leaf')
  leaf.setCursor(leaf.text.length, leaf.text.length, true)
}

// Upstream (8d6c198c) shows no block for a document's final blank line; the
// bytes stay as written.
describe('a document ending in a blank line', () => {
  it.each([
    { initial: 'a\n\n', texts: ['a'], typed: 'ax\n\n', entered: 'a\n\nx\n\n' },
    { initial: 'a\r\n\r\n', texts: ['a'], typed: 'ax\r\n\r\n', entered: 'a\r\n\r\nx\r\n\r\n' },
    { initial: '# a\n\n', texts: ['# a'], typed: '# ax\n\n', entered: '# a\n\nx\n\n' },
    { initial: 'a\n\nb\n\n', texts: ['a', 'b'], typed: 'ax\n\nb\n\n', entered: 'a\n\nx\n\nb\n\n' },
    { initial: '- a\n\n', texts: ['a'], typed: '- ax\n\n', entered: '- a\n- x\n\n' }
  ])('shows only the written blocks of $initial', async({ initial, texts, typed, entered }) => {
    const app = bootBoundMuya(initial)
    try {
      expect(leaves(app).map((leaf) => leaf.text)).toEqual(texts)
      endOfFirst(app)
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe(typed)
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(initial)
      endOfFirst(app)
      await input(app, 'insertParagraph')
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe(entered)
      expect(leaves(app).map((leaf) => leaf.text)).toEqual([texts[0], 'x', ...texts.slice(1)])
    } finally {
      app.dispose()
    }
  })

  it('keeps the empty paragraph that Enter at the end creates', async() => {
    const app = bootBoundMuya('a\n')
    try {
      endOfFirst(app)
      await input(app, 'insertParagraph')
      expect(source(app)).toBe('a\n\n\n')
      expect(leaves(app).map((leaf) => leaf.text)).toEqual(['a', ''])
      await input(app, 'insertText', 'x')
      expect(source(app)).toBe('a\n\nx\n')
    } finally {
      app.dispose()
    }
  })
})
