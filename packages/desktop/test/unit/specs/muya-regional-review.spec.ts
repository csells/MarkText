// @vitest-environment jsdom
import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import { muyaInputToModel } from '@/documentAuthority/muyaModelSelection'
import { resolveMuyaViewAcknowledgement } from '@/documentAuthority/resolveMuyaViewAcknowledgement'
import { reconcileMuyaDocumentView } from '@/documentAuthority/reconcileMuyaDocumentView'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'

async function mountOwnedDocument(source: string) {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const manager = createCoreDocumentSessionManager({
    createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
  })
  manager.open({ documentId: 'regional-review.md', source, lineEnding: '\n' })
  const initial = await manager.plainTextViewBarrier('regional-review.md')
  if (!('state' in initial.view)) throw new Error('Missing typed initial view')
  const lease = manager.lease('regional-review.md')
  const host = document.body.appendChild(document.createElement('div'))
  const muya = new Muya(host)
  let view = initial.view
  let revision = initial.revision
  let presentation = createMuyaMarkupPresentationIndex(view)
  const outcomes: CoreAppliedReply[] = []
  const reconcile = (outcome: CoreAppliedReply) => {
    const acknowledged = resolveMuyaViewAcknowledgement({
      lease,
      outcome,
      previousView: view,
      previousRevision: revision,
      currentEditor: () => muya
    })
    if (!('state' in acknowledged.view)) throw new Error('Missing typed acknowledged view')
    view = acknowledged.view
    revision = outcome.revision
    presentation = createMuyaMarkupPresentationIndex(view, presentation)
    muya.setInlinePresentation(presentation.render)
    reconcileMuyaDocumentView({
      muya,
      view,
      outcome,
      sourcePosition: adapter.reconciledSourcePosition,
      dirtyPaths: presentation.changedPaths,
      applyEditability: (bindings) =>
        muya.setEditablePaths(
          bindings.filter((item) => item.editable !== false).map((item) => item.path)
        )
    })
    outcomes.push(outcome)
    return view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(
    view.bindings,
    lease.binding,
    undefined,
    reconcile,
    revision,
    true
  )
  const unexpected = (): never => {
    throw new Error('Unexpected command in regional Review fixture')
  }
  muya.setInlinePresentation(presentation.render)
  muya.init()
  muya.setContent(structuredClone([...view.state]))
  muya.editor.bindDocumentEditing({
    emojiContext: () => undefined,
    codeLanguage: () => undefined,
    activeFormats: () => [],
    prepareImage: unexpected,
    prepareClipboard: unexpected,
    clipboard: unexpected,
    compositionStart: unexpected,
    compositionUpdate: unexpected,
    compositionEnd: unexpected,
    format: unexpected,
    input(operation) {
      return adapter.input(muyaInputToModel(muya, view, operation), reconcile).changed
    }
  })
  lease.settleView(
    () => adapter.settled(),
    () => adapter.isSettled()
  )
  lease.onHandoff(() => {
    muya.editor.unbindDocumentEditing()
    adapter.dispose()
  })
  return {
    muya,
    lease,
    adapter,
    reconcile,
    outcomes,
    async dispose() {
      await manager.handoff(lease)
      await manager.close(lease.documentId)
      muya.destroy()
      host.remove()
      document.getSelection()?.removeAllRanges()
    }
  }
}

it('uses eligible common-model regions for native input, undo and redo before the next key', async() => {
  const app = await mountOwnedDocument('same\n\nbase\n\nsame\n')
  try {
    const paragraph = app.muya.editor.scrollPage?.queryBlock([1, 'text'])
    if (!paragraph?.isContent()) throw new Error('Missing target paragraph')
    const first = app.muya.domNode.querySelector('.mu-paragraph-content')
    paragraph.setCursor(4, 4, true)
    paragraph.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'X',
        bubbles: true,
        cancelable: true
      })
    )
    expect(await app.lease.sourceAtBarrier()).toBe('same\n\nbaseX\n\nsame\n')
    expect(app.outcomes.at(-1)?.change.projections).toMatchObject([
      { name: 'markup', scope: 'regions' }
    ])
    const undone = await app.adapter.history('undo', app.reconcile)
    expect(undone?.change.projections).toMatchObject([{ name: 'markup', scope: 'regions' }])
    expect(await app.lease.sourceAtBarrier()).toBe('same\n\nbase\n\nsame\n')
    expect(app.muya.getSelection()).toMatchObject({ anchor: { path: [1, 'text'], offset: 4 } })
    const redone = await app.adapter.history('redo', app.reconcile)
    expect(redone?.change.projections).toMatchObject([{ name: 'markup', scope: 'regions' }])
    expect(await app.lease.sourceAtBarrier()).toBe('same\n\nbaseX\n\nsame\n')
    const caret = app.muya.editor.selection.getSelection()?.anchor.block
    if (!caret) throw new Error('Missing redo caret')
    caret.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'Y',
        bubbles: true,
        cancelable: true
      })
    )
    expect(await app.lease.sourceAtBarrier()).toBe('same\n\nbaseXY\n\nsame\n')
    expect(app.muya.editor.selection.getSelection()?.anchor.block.text).toBe('baseXY')
    expect(app.muya.domNode.querySelector('.mu-paragraph-content')).toBe(first)
  } finally {
    await app.dispose()
  }
})

it('keeps complete canonical rendering when Review resolution and its history require document fallback', async() => {
  const source = '[same][id]\n\n{++new++} text\n\n[id]: /target\n'
  const accepted = '[same][id]\n\nnew text\n\n[id]: /target\n'
  const app = await mountOwnedDocument(source)
  try {
    const review = app.lease.binding.reviewItemAtBarrier('next', 0)
    if (review.type !== 'review-item' || !review.item) throw new Error('Missing Review addition')
    const resolved = await app.adapter.resolve(
      review.item,
      review.revision,
      'accept',
      app.reconcile
    )
    expect(resolved?.change.projections).toMatchObject([{ name: 'markup', scope: 'document' }])
    expect(await app.lease.sourceAtBarrier()).toBe(accepted)
    expect(app.muya.domNode.querySelectorAll('[data-critic-kind="addition"]')).toHaveLength(0)
    expect(app.muya.domNode.querySelector('a.mu-link')?.getAttribute('href')).toBe('/target')
    const undone = await app.adapter.history('undo', app.reconcile)
    expect(undone?.change.projections).toMatchObject([{ name: 'markup', scope: 'document' }])
    expect(await app.lease.sourceAtBarrier()).toBe(source)
    expect(app.muya.domNode.querySelector('[data-critic-kind="addition"]')?.textContent).toBe('new')
    const redone = await app.adapter.history('redo', app.reconcile)
    expect(redone?.change.projections).toMatchObject([{ name: 'markup', scope: 'document' }])
    expect(await app.lease.sourceAtBarrier()).toBe(accepted)
    expect(app.muya.domNode.querySelectorAll('[data-critic-kind="addition"]')).toHaveLength(0)
    expect(app.muya.domNode.querySelector('a.mu-link')?.getAttribute('href')).toBe('/target')
  } finally {
    await app.dispose()
  }
})
