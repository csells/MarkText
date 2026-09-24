// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { muyaClipboardCurrentSelection } from '@/documentAuthority/muyaModelSelection'
import { restoreMuyaDocumentSelection } from '@/documentAuthority/reconcileMuyaDocumentView'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import { asMuyaStates } from '../helpers/muyaTypes'

it('restores a directed annotation selection without native Markdown serialization or parsing', () => {
  const app = bootBoundMuya('a{++b++}c\n')
  try {
    const body = app.muya.editor.scrollPage!.firstContentInDescendant()!
    const finalText = body.domNode!.lastChild!
    window.getSelection()!.setBaseAndExtent(finalText, 1, finalText, 0)
    body.domNode!.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }))
    const selection = muyaClipboardCurrentSelection(app.muya, app.view())
    expect(selection).toEqual({ ranges: [{ anchor: 9, focus: 8 }], primary: 0 })
    vi.spyOn(app.muya, 'getMarkdown').mockImplementation(() => {
      throw new Error('Unexpected serialization')
    })
    vi.spyOn(app.muya.editor.jsonState, 'markdownToState').mockImplementation(() => {
      throw new Error('Unexpected Markdown parser')
    })
    body.setCursor(0, 0, true)
    restoreMuyaDocumentSelection(app.muya, app.view(), selection!)
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 3 }, focus: { offset: 2 } })
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'a{++b++}c\n', revision: 1 })
  } finally {
    app.dispose()
  }
})

it.each(['mouseup', 'mouseleave', 'shift-click'])(
  'retains cross-block native %s endpoints at an annotation boundary',
  (event) => {
    const app = bootBoundMuya('a{++b++}c\n\nlast\n')
    try {
      const first = app.muya.editor.scrollPage!.firstContentInDescendant()!
      const last = first.nextContentInContext()!
      const host = app.muya.domNode
      host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      window
        .getSelection()!
        .setBaseAndExtent(last.domNode!.lastChild!, 4, first.domNode!.lastChild!, 0)
      if (event === 'shift-click') {
        host.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
      } else {
        host.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
        host.dispatchEvent(new MouseEvent(event, { bubbles: true }))
      }
      expect(muyaClipboardCurrentSelection(app.muya, app.view())).toEqual({
        ranges: [{ anchor: 15, focus: 8 }],
        primary: 0
      })
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: 'a{++b++}c\n\nlast\n',
        revision: 1
      })
    } finally {
      app.dispose()
    }
  }
)

it.each(['\n', '\r\n', '\r'])(
  'retains a normalized literal position through remount and the next key (%j)',
  async(eol) => {
    const source = ['{++  ```math', '\tx', '  ```', '++}'].join(eol)
    const app = bootBoundMuya(source, { gitLabMath: true })
    try {
      const body = app.muya.editor.scrollPage!.queryBlock([0, 'text'])!
      if (!body.isContent()) throw new Error('Expected literal body')
      body.setCursor(1, 1, true)
      const selection = muyaClipboardCurrentSelection(app.muya, app.view())
      expect(selection).toMatchObject({
        kind: 'model-text',
        anchor: { offset: 1 },
        focus: { offset: 1 }
      })
      app.muya.setContent(asMuyaStates(structuredClone([...app.view().state])))
      restoreMuyaDocumentSelection(app.muya, app.view(), selection!)
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
      app.muya.editor.selection.getSelection()!.anchor.block.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'y',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: ['{++  ```math', '   y x', '  ```', '++}'].join(eol)
      })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
    } finally {
      app.dispose()
    }
  }
)

it('projects an omitted terminal newline onto the final owned editing boundary', () => {
  const app = bootBoundMuya('a{++b++}c\n')
  try {
    restoreMuyaDocumentSelection(
      app.muya,
      app.view(),
      { ranges: [{ anchor: 10, focus: 10 }], primary: 0 },
      { projectSource: true }
    )
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 3 }, focus: { offset: 3 } })
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'a{++b++}c\n', revision: 1 })
  } finally {
    app.dispose()
  }
})
