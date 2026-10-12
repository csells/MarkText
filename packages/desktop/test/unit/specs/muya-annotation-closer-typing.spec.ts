// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

// Typing an Addition by hand with bracket pairing on completes its closer one
// key early: `{` pairs a `}`, so the second `+` of `++}` closes the Addition
// while the caret sits inside the now hidden closer. The caret shows after the
// Addition and typing continues there, instead of the view faulting and the
// following keys reaching the DOM without the document.
it('keeps typing after an Addition whose closer a typed key completes', async() => {
  const app = bootBoundMuya('Start\n')
  try {
    const leaf = app.muya.editor.scrollPage!.firstContentInDescendant()!
    leaf.setCursor(5, 5, true)
    app.muya.flush()
    for (const key of ' {++crit++}x') {
      const target = app.muya.editor.selection.getSelection()?.anchor.block.domNode
      if (!target?.isConnected) throw new Error('Expected live selection')
      target.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: key, bubbles: true, cancelable: true }))
      app.muya.flush()
      await app.adapter.settled()
      expect(app.adapter.state().status, key).toBe('ready')
    }
    const reply = app.binding.sourceAtBarrier()
    if (reply.type !== 'source') throw new Error('Expected source')
    // The typed closing brace lands after the Addition, where the caret shows.
    expect(reply.source).toBe('Start {++crit++}}x\n')
    expect(leaf.text).toBe('Start crit}x')
  } finally {
    app.dispose()
  }
})
