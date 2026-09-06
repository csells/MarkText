// @vitest-environment happy-dom
import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { installMuyaInputDelivery } from '@/documentAuthority/muyaNativeInputDelivery'

it('publishes native input before the next animation frame and stops on handoff', async() => {
  const host = document.createElement('div')
  document.body.append(host)
  const muya = new Muya(host)
  muya.init()
  muya.setContent('seed\n')
  const changes: unknown[] = []
  muya.on('json-change', (change: unknown) => { changes.push(change) })
  const remove = installMuyaInputDelivery(muya.domNode, () => muya.flush())
  const type = (character: string) => {
    const block = muya.editor.scrollPage?.firstContentInDescendant()
    if (block == null) throw new Error('Expected paragraph')
    muya.editor.activeContentBlock = block
    const text = block.text + character
    block.domNode.textContent = text
    block.setCursor(text.length, text.length)
    block.domNode.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: character, bubbles: true }))
  }
  try {
    type('X')
    await Promise.resolve()
    expect(changes).toHaveLength(1)
    expect(muya.getMarkdown()).toBe('seedX\n')
    type('Y')
    remove()
    await Promise.resolve()
    expect(changes).toHaveLength(1)
    muya.flush()
    expect(muya.getMarkdown()).toBe('seedXY\n')
  } finally {
    remove()
    muya.destroy()
    muya.domNode.remove()
  }
})
