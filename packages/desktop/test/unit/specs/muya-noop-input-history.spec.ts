// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

// Typing a selection's own text through the bound editor changes nothing and
// adds no undo step: ⌘Z then reverts the previous real change.

type BoundMuya = ReturnType<typeof bootBoundMuya>

const type = async(app: BoundMuya, data: string) => {
  const target = app.muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Missing live selection')
  const event = new InputEvent('beforeinput', { data, inputType: 'insertText', bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  await app.adapter.settled()
}

it.each([
  { lane: 'tracked', source: 'x{++abc++}y\n' },
  { lane: 'ordinary', source: 'x{++abc++}y\n' },
  { lane: 'ordinary', source: 'xabcy\n' }
] as const)('adds no $lane undo step for typing selected text over itself in $source', async({ lane, source }) => {
  const app = bootBoundMuya(source)
  app.track(lane === 'tracked')
  try {
    const block = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (block == null || !block.isContent()) throw new Error('Missing text')
    block.setCursor(0, 0, true)
    await type(app, 'Q')
    const changed = lane === 'tracked' ? `{++Q++}${source}` : `Q${source}`
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: changed })
    // A separate step: select the visible "b" and type "b".
    app.muya.editor.history.cutoff()
    const current = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (current == null || !current.isContent()) throw new Error('Missing text')
    current.setCursor(3, 4, true)
    await type(app, 'b')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: changed })
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    app.dispose()
  }
})
