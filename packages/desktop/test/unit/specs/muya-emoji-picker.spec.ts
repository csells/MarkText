// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createDocumentCore } from '@marktext/document-core'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each([false, true])(
  'completes the parser-owned emoji target before next input (annotated=%s)',
  async(annotated) => {
    const source = annotated ? 'before {++:sm++}{>>keep<<} tail\n' : 'before :sm tail\n'
    const completed = annotated
      ? 'before {++:smiley:++}{>>keep<<} tail\n'
      : 'before :smiley: tail\n'
    const app = bootBoundMuya(source)
    try {
      const content = app.muya.editor.scrollPage!.firstContentInDescendant()!
      content.setCursor(10, 10, true)
      const suggestions: string[] = []
      app.muya.eventCenter.on('muya-emoji-picker', ({ emojiText }: { emojiText: string }) =>
        suggestions.push(emojiText)
      )
      content.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'i',
          bubbles: true,
          cancelable: true
        })
      )
      const current = app.muya.editor.scrollPage!.firstContentInDescendant()!
      current.domNode!.dispatchEvent(new KeyboardEvent('keyup', { key: 'i', bubbles: true }))
      expect(suggestions).toContain('smi')
      current.setEmoji('smiley')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: completed })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: 15 },
        focus: { offset: 15 }
      })
      app.muya.editor.selection
        .getSelection()!
        .anchor.block.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: completed.replace(':smiley:', ':smiley:x')
      })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: source.replace(':sm', ':smi') })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: 11 },
        focus: { offset: 11 }
      })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      const reopened = bootBoundMuya(completed.replace(':smiley:', ':smiley:x'))
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({
          source: completed.replace(':smiley:', ':smiley:x')
        })
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)

it('tracks completion of a complete alias without changing Original semantics or an unrelated comment', async() => {
  const source = 'before :smile: tail{>>keep<<}\n'
  const completed = 'before {~~:smile:~>:smiley:~~} tail{>>keep<<}\n'
  const app = bootBoundMuya(source)
  try {
    const body = app.muya.editor.scrollPage!.firstContentInDescendant()!
    body.setCursor(10, 10, true)
    app.track(true)
    body.setEmoji('smiley')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: completed })
    const core = createDocumentCore()
    const revision = core.open(completed)
    expect(core.project(revision, 'original').markdown).toBe('before :smile: tail\n')
    expect(core.project(revision, 'revised').markdown).toBe('before :smiley: tail\n')
    app.muya.editor.selection
      .getSelection()!
      .anchor.block.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: completed.replace(':smiley:', ':smiley:x')
    })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 10 }, focus: { offset: 10 } })
  } finally {
    app.dispose()
  }
})
