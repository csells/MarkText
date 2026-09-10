// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it('keeps tracked list padding separate from unchanged fenced content through input and history', async() => {
  const source = '- {++first++}{>>keep<<}\n\n  ```js\n  let x = 1\n  ```\n- second\n'
  const converted =
    '{~~- ~>1. ~~}{++first++}{>>keep<<}\n\n{~~  ~>   ~~}```js\n{~~  ~>   ~~}let x = 1\n{~~  ~>   ~~}```\n{~~- ~>2. ~~}second\n'
  const typed =
    '{~~- ~>1. ~~}{++Xfirst++}{>>keep<<}\n\n{~~  ~>   ~~}```js\n{~~  ~>   ~~}let x = 1\n{~~  ~>   ~~}```\n{~~- ~>2. ~~}second\n'
  const app = bootBoundMuya(source)
  const { muya, binding, adapter, reconcile, legacyChanges } = app
  app.track(true)
  try {
    const first = muya.editor.scrollPage?.firstContentInDescendant()
    if (!first) throw new Error('Expected first list item')
    first.setCursor(0, 0, true)
    muya.updateParagraph('ol-order')
    expect(binding.sourceAtBarrier()).toMatchObject({ source: converted })
    expect(muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    const live = muya.editor.selection.getSelection()?.anchor.block.domNode
    if (!live?.isConnected) throw new Error('The resulting selection is not live')
    live.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'X',
        bubbles: true,
        cancelable: true
      })
    )
    expect(binding.sourceAtBarrier()).toMatchObject({ source: typed })
    expect(muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
    expect(legacyChanges).toEqual([])
    expect(muya.getState()).toEqual(app.view().state)
    await adapter.history('undo', reconcile)
    expect(binding.sourceAtBarrier()).toMatchObject({ source: converted })
    await adapter.history('undo', reconcile)
    expect(binding.sourceAtBarrier()).toMatchObject({ source })
    await adapter.history('redo', reconcile)
    expect(binding.sourceAtBarrier()).toMatchObject({ source: converted })
    await adapter.history('redo', reconcile)
    expect(binding.sourceAtBarrier()).toMatchObject({ source: typed })
    const core = createDocumentCore()
    const reopened = core.open(typed)
    expect(core.project(reopened, 'original').markdown).toBe(
      '- \n\n  ```js\n  let x = 1\n  ```\n- second\n'
    )
    expect(core.project(reopened, 'revised').markdown).toBe(
      '1. Xfirst\n\n   ```js\n   let x = 1\n   ```\n2. second\n'
    )
  } finally {
    app.dispose()
  }
})
