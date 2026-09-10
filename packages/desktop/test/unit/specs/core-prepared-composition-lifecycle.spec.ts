import { expect, it } from 'vitest'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
function setup() {
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId: 'prepared-composition.md', source: 'abc\n' })
  const view = binding.plainTextViewAtBarrier()
  if (view.type !== 'plain-text-view') throw new Error('Missing initial model view')
  const adapter = createMuyaPlainTextCoreAdapter(view.view.bindings, binding)
  const reconcile = () => {
    const next = binding.plainTextViewAtBarrier()
    if (next.type !== 'plain-text-view') throw new Error('Missing model view')
    return next.view.bindings
  }
  return { binding, adapter, reconcile }
}

it.each(['dispose', 'sibling-failure', 'ambiguous-composition'] as const)(
  'drains an awaiting completion on %s without losing either draft',
  async(reason) => {
    const { adapter, binding, reconcile } = setup()
    const bytes = 'data:image/png;base64,AQIDBA=='
    try {
      const preparation = adapter.prepareClipboard(
        { selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }, tracked: false },
        { imageSource: bytes },
        reconcile
      )
      const sibling = adapter.prepareClipboard(
        { selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 }, tracked: false },
        { text: 'second resource' },
        reconcile
      )
      adapter.compositionStart({
        selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 },
        range: { start: 1, end: 1 },
        inputType: 'insertCompositionText',
        data: null,
        options
      })
      adapter.compositionUpdate('日本')
      let selectionCaptured = false
      const completion = preparation.complete('![](/uploaded.png)', {
        currentSelection: () => {
          selectionCaptured = true
          return { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }
        }
      })
      const completionRejected = expect(completion).rejects.toThrow()
      const settledRejected = expect(adapter.settled()).rejects.toThrow()
      if (reason === 'dispose') adapter.dispose()
      else if (reason === 'sibling-failure') sibling.fail(new Error('Sibling upload failed'))
      else adapter.compositionEnd({ kind: 'unavailable' }, reconcile)
      await completionRejected
      await settledRejected
      await preparation.finished
      await sibling.finished
      expect(selectionCaptured).toBe(false)
      expect(binding.sourceAtBarrier()).toMatchObject({
        source: 'abc\n',
        revision: 1,
        recoveryHistory: { undo: [], redo: [] }
      })
      const draft = JSON.stringify(adapter.recoveryDraft())
      expect(draft).toContain(bytes)
      expect(draft).toContain('/uploaded.png')
      expect(draft).toContain('日本')
      expect(draft).toContain('second resource')
    } finally {
      adapter.dispose()
      binding.dispose()
    }
  }
)

it('retains completion bytes when its post-composition selection can no longer be captured', async() => {
  const { adapter, binding, reconcile } = setup()
  try {
    const preparation = adapter.prepareClipboard(
      { selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }, tracked: false },
      { text: 'original clipboard' },
      reconcile
    )
    adapter.compositionStart({
      selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 },
      range: { start: 1, end: 1 },
      inputType: 'insertCompositionText',
      data: null,
      options
    })
    const completion = preparation.complete('**P**', {
      currentSelection: () => {
        throw new Error('View detached before selection capture')
      }
    })
    const rejected = expect(completion).rejects.toThrow('View detached')
    expect(adapter.compositionEnd({ kind: 'commit', data: 'X' }, reconcile)).toMatchObject({
      accepted: true
    })
    await rejected
    await preparation.finished
    await expect(adapter.settled()).rejects.toThrow('View detached')
    expect(binding.sourceAtBarrier()).toMatchObject({ source: 'aXbc\n', revision: 2 })
    const draft = JSON.stringify(adapter.recoveryDraft())
    expect(draft).toContain('original clipboard')
    expect(draft).toContain('**P**')
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})
