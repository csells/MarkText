// @vitest-environment jsdom

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Muya } from '@muyajs/core'
import { beforeEach, describe, expect, it } from 'vitest'

import { createCoreRecoveryDraftStore } from '../../../src/main/coreRecoveryDraftStore'
import { createMuyaRecoveryDraftCapture } from '@/documentAuthority/muyaRecoveryDraftCapture'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'
import { handoffCoreDocumentView } from '@/documentAuthority/coreDocumentViewHandoff'
import { teardownCoreDocumentSessions } from '@/documentAuthority/coreDocumentSessionTeardown'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import {
  createMuyaPlainTextCoreAdapter,
  type MuyaPlainTextCoreAdapter
} from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { resolveMuyaViewAcknowledgement } from '@/documentAuthority/resolveMuyaViewAcknowledgement'
import { reconcileMuyaDocumentView } from '@/documentAuthority/reconcileMuyaDocumentView'
import {
  muyaActiveFormats,
  muyaInputToModel,
  muyaFormatToModel
} from '@/documentAuthority/muyaModelSelection'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'

beforeEach(() => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
})

describe('native pending input through desktop document lifecycle', () => {
  it.each(
    (['tab handoff', 'source handoff', 'final teardown'] as const).flatMap((route) =>
      (['before view drain', 'during view drain'] as const).map((timing) => ({ route, timing }))
    )
  )(
    'preserves queued native typing through $route destroyed $timing',
    async({ route, timing }) => {
      const actor = createCoreActor()
      let release: (() => void) | undefined
      let reportHeld: (() => void) | undefined
      const firstHeld = new Promise<void>((resolve) => {
        reportHeld = resolve
      })
      let held = false
      let bindingDisposed = false
      const manager = createCoreDocumentSessionManager({
        createBinding: () =>
          createEditorCoreBinding({
            request: (request) => actor.handle(request),
            dispose() {
              bindingDisposed = true
            }
          })
      })
      await manager.open({ documentId: 'lifecycle.md', source: 'a{++a++}a\n', lineEnding: '\n' })
      const initial = await manager.plainTextViewBarrier('lifecycle.md')
      if (!('state' in initial.view)) throw new Error('Missing native Core view')
      const lease = manager.lease('lifecycle.md')
      const host = document.body.appendChild(document.createElement('div'))
      const muya = new Muya(host)
      let currentEditor: Muya | null = muya
      let presentation = createMuyaMarkupPresentationIndex(initial.view)
      let acknowledgedView = initial.view
      let viewReleased = false
      let sessionClosed = false
      const reconcile = (outcome: CoreAppliedReply) => {
        const acknowledged = resolveMuyaViewAcknowledgement({
          lease,
          outcome,
          previousView: undefined,
          previousRevision: undefined,
          currentEditor: () => currentEditor
        })
        expect(acknowledged.muya).toBe(currentEditor)
        if (!('state' in acknowledged.view)) throw new Error('Missing acknowledged view')
        acknowledgedView = acknowledged.view
        if (acknowledged.muya === null) return acknowledged.view.bindings
        presentation = createMuyaMarkupPresentationIndex(acknowledged.view, presentation)
        muya.setInlinePresentation(presentation.render)
        if (!adapter.hasPendingEdits()) {
          reconcileMuyaDocumentView({
            muya,
            view: acknowledged.view,
            outcome,
            sourcePosition: adapter.reconciledSourcePosition,
            dirtyPaths: presentation.changedPaths,
            applyEditability: (bindings) =>
              muya.setEditablePaths(
                bindings
                  .filter((binding) => binding.editable !== false)
                  .map((binding) => binding.path)
              )
          })
        }
        return acknowledged.view.bindings
      }
      const adapter: MuyaPlainTextCoreAdapter = createMuyaPlainTextCoreAdapter(
        initial.view.bindings,
        lease.binding,
        undefined,
        reconcile,
        lease.identity.revision,
        true
      )
      try {
        muya.setInlinePresentation(presentation.render)
        muya.init()
        muya.setContent(structuredClone([...initial.view.state]))
        const detach = muya.editor.bindDocumentEditing({
          prepareImage() {
            throw new Error('Unexpected image preparation')
          },
          prepareClipboard() {
            throw new Error('Unexpected async clipboard preparation in this test')
          },
          activeFormats: (selection) => muyaActiveFormats(muya, acknowledgedView, selection),
          clipboard() {
            throw new Error('Unexpected clipboard action in this input test')
          },
          compositionStart() {
            throw new Error('Unexpected composition in this input test')
          },
          compositionUpdate() {
            throw new Error('Unexpected composition in this input test')
          },
          compositionEnd() {
            throw new Error('Unexpected composition in this input test')
          },
          format: (operation) =>
            adapter.format(muyaFormatToModel(muya, acknowledgedView, operation, false), reconcile)
              .changed,
          input(operation, present) {
            const result = adapter.input(
              muyaInputToModel(muya, acknowledgedView, operation),
              reconcile
            )
            expect(result).toEqual({ accepted: true, changed: true })
            if (!result.accepted) present()
            return result.changed
          }
        })
        const drain = new Promise<void>((resolve) => {
          release = resolve
        })
        lease.settleView(async() => {
          if (!held) {
            held = true
            reportHeld?.()
          }
          await drain
          if (currentEditor !== null) currentEditor.flush()
          await adapter.settled()
        })
        lease.onHandoff(() => {
          detach()
          adapter.dispose()
          viewReleased = true
        })
        const block = muya.editor.scrollPage?.firstContentInDescendant()
        if (block?.domNode == null) throw new Error('Missing native paragraph')
        block.setCursor(0, 0)
        for (const text of ['a', 'a', 'a']) {
          const block = muya.editor.scrollPage?.firstContentInDescendant()
          if (block?.domNode == null) throw new Error('Missing current native paragraph')
          block.domNode.dispatchEvent(
            new KeyboardEvent('keydown', { key: text, bubbles: true, cancelable: true })
          )
          const input = new InputEvent('beforeinput', {
            data: text,
            inputType: 'insertText',
            bubbles: true,
            cancelable: true
          })
          block.domNode.dispatchEvent(input)
          expect(input.defaultPrevented).toBe(true)
        }
        expect(muya.editor.scrollPage?.firstContentInDescendant()?.domNode?.textContent).toBe(
          'aaaaaa'
        )
        if (timing === 'before view drain') {
          muya.destroy()
          currentEditor = null
        }
        const saved = manager.saveBarrier('lifecycle.md')
        const reconciled: string[] = []
        const transition =
          route === 'tab handoff'
            ? manager.handoff(lease)
            : route === 'source handoff'
              ? handoffCoreDocumentView({
                manager,
                lease,
                reconcile: (_documentId, source) => reconciled.push(source),
                setState: () => {}
              })
              : teardownCoreDocumentSessions({
                manager,
                transition: Promise.resolve(),
                finalLease: () => lease,
                clearFinalLease: () => {},
                documentIds: ['lifecycle.md']
              })
        await firstHeld
        if (timing === 'during view drain') {
          muya.destroy()
          currentEditor = null
        }
        expect(viewReleased).toBe(false)
        expect(bindingDisposed).toBe(false)
        release?.()
        const [snapshot] = await Promise.all([saved, transition])
        expect(snapshot).toMatchObject({ source: 'aaaa{++a++}a\n' })
        expect(viewReleased).toBe(true)
        if (route === 'source handoff') expect(reconciled).toEqual(['aaaa{++a++}a\n'])
        if (route === 'final teardown') {
          sessionClosed = true
          expect(bindingDisposed).toBe(true)
        } else {
          expect(await manager.saveBarrier('lifecycle.md')).toMatchObject({
            source: 'aaaa{++a++}a\n'
          })
          await manager.close('lifecycle.md')
          sessionClosed = true
        }
      } finally {
        release?.()
        if (!sessionClosed && !bindingDisposed) manager.abort('lifecycle.md')
        muya.destroy()
        host.remove()
        document.getSelection()?.removeAllRanges()
      }
    }
  )
})

describe('native draft recovery during desktop teardown', () => {
  it.each([false, true, undefined])(
    'preserves accepted typing and a rejected native input before abort (backup failure: %s; undefined means no recovery handler)',
    async(backupFails) => {
      const scratch = mkdtempSync(join(tmpdir(), 'marktext-native-teardown-'))
      const store = createCoreRecoveryDraftStore(scratch)
      const actor = createCoreActor()
      let fail: (() => void) | undefined
      let reportHeld: (() => void) | undefined
      const held = new Promise<void>((resolve) => {
        reportHeld = resolve
      })
      let inputCount = 0
      let disposed = false
      const manager = createCoreDocumentSessionManager({
        createBinding: () =>
          createEditorCoreBinding({
            request(request) {
              if (request.type === 'input' && ++inputCount === 3) { throw new Error('Test authority unavailable') }
              return actor.handle(request)
            },
            dispose() {
              disposed = true
            }
          })
      })
      await manager.open({ documentId: 'recovery.md', source: 'a{++a++}a\n', lineEnding: '\n' })
      const initial = await manager.plainTextViewBarrier('recovery.md')
      if (!('state' in initial.view)) throw new Error('Missing initial Core view')
      const lease = manager.lease('recovery.md')
      const host = document.body.appendChild(document.createElement('div'))
      const muya = new Muya(host)
      let currentEditor: Muya | null = muya
      let presentation = createMuyaMarkupPresentationIndex(initial.view)
      let acknowledgedView = initial.view
      const reconcile = (outcome: CoreAppliedReply) => {
        const acknowledged = resolveMuyaViewAcknowledgement({
          lease,
          outcome,
          previousView: undefined,
          previousRevision: undefined,
          currentEditor: () => currentEditor
        })
        if (!('state' in acknowledged.view)) throw new Error('Missing acknowledged view')
        acknowledgedView = acknowledged.view
        presentation = createMuyaMarkupPresentationIndex(acknowledged.view, presentation)
        muya.setInlinePresentation(presentation.render)
        reconcileMuyaDocumentView({
          muya,
          view: acknowledged.view,
          outcome,
          dirtyPaths: presentation.changedPaths,
          applyEditability: () => {}
        })
        return acknowledged.view.bindings
      }
      const adapter = createMuyaPlainTextCoreAdapter(
        initial.view.bindings,
        lease.binding,
        undefined,
        reconcile,
        lease.identity.revision,
        true
      )
      const capture = createMuyaRecoveryDraftCapture({
        muya,
        lease,
        pathname: undefined,
        nativeIntent: () => adapter.recoveryDraft(),
        acknowledgedView: () => acknowledgedView
      })
      try {
        muya.setInlinePresentation(presentation.render)
        muya.init()
        muya.setContent(structuredClone([...initial.view.state]))
        muya.editor.bindDocumentEditing({
          prepareImage() {
            throw new Error('Unexpected image preparation')
          },
          prepareClipboard() {
            throw new Error('Unexpected async clipboard preparation in this test')
          },
          activeFormats: (selection) => muyaActiveFormats(muya, acknowledgedView, selection),
          clipboard() {
            throw new Error('Unexpected clipboard action in this input test')
          },
          compositionStart() {
            throw new Error('Unexpected composition in this input test')
          },
          compositionUpdate() {
            throw new Error('Unexpected composition in this input test')
          },
          compositionEnd() {
            throw new Error('Unexpected composition in this input test')
          },
          format: (operation) =>
            adapter.format(muyaFormatToModel(muya, acknowledgedView, operation, false), reconcile)
              .changed,
          input(operation, present) {
            const result = adapter.input(
              muyaInputToModel(muya, acknowledgedView, operation),
              reconcile
            )
            if (!result.accepted) {
              present()
              lease.faultView(new Error('Test authority unavailable'))
            }
            return result.changed
          }
        })
        const drain = new Promise<void>((resolve) => {
          fail = resolve
        })
        lease.settleView(async() => {
          reportHeld?.()
          await drain
          await adapter.settled()
        })
        lease.onHandoff(() => adapter.dispose())
        const block = muya.editor.scrollPage?.firstContentInDescendant()
        if (block?.domNode == null) throw new Error('Missing native paragraph')
        block.setCursor(0, 0)
        for (const text of ['x', 'y', 'z']) {
          const block = muya.editor.scrollPage?.firstContentInDescendant()
          if (block?.domNode == null) throw new Error('Missing current native paragraph')
          block.domNode.dispatchEvent(
            new KeyboardEvent('keydown', { key: text, bubbles: true, cancelable: true })
          )
          const input = new InputEvent('beforeinput', {
            data: text,
            inputType: 'insertText',
            bubbles: true,
            cancelable: true
          })
          block.domNode.dispatchEvent(input)
          expect(input.defaultPrevented).toBe(true)
        }
        expect(muya.editor.scrollPage?.firstContentInDescendant()?.domNode?.textContent).toBe(
          'xyzaaa'
        )
        expect(lease.identity.revision).toBe(3)
        const teardown = teardownCoreDocumentSessions({
          manager,
          transition: Promise.resolve(),
          finalLease: () => lease,
          clearFinalLease: () => {},
          documentIds: ['recovery.md'],
          preserveFailure:
            backupFails === undefined
              ? undefined
              : (error) => {
                expect(disposed).toBe(false)
                const draft = capture(error)
                if (draft === undefined) throw new Error('Pending native draft unavailable')
                if (backupFails) throw new Error('Test backup storage unavailable')
                store.preserve(draft)
              }
        })
        await held
        muya.destroy()
        currentEditor = null
        fail?.()
        await expect(teardown).rejects.toThrow(
          backupFails ? 'Test backup storage unavailable' : 'Test authority unavailable'
        )
        if (backupFails !== false) {
          expect(disposed).toBe(false)
          const draft = capture(new Error('retry'))
          expect(draft?.visibleText).toBe('xyzaaa')
          if (draft === undefined) throw new Error('Retained recovery draft unavailable')
          store.preserve(draft)
          expect(store.list()[0]?.visibleText).toBe('xyzaaa')
        } else {
          expect(disposed).toBe(true)
          const recovered = store.list()
          expect(recovered).toHaveLength(1)
          expect(recovered[0]).toMatchObject({
            documentId: 'recovery.md',
            visibleText: 'xyzaaa',
            nativeState: [{ name: 'paragraph', text: 'xyzaaa' }]
          })
          expect(recovered[0].nativeIntent).toMatchObject({
            commands: [
              {
                input: {
                  data: 'z',
                  selection: { ranges: [{ anchor: 2, focus: 2 }], primary: 0 },
                  range: { start: 2, end: 2 }
                }
              }
            ]
          })
        }
      } finally {
        fail?.()
        if (!disposed) manager.abort('recovery.md')
        muya.destroy()
        host.remove()
        document.getSelection()?.removeAllRanges()
        rmSync(scratch, { recursive: true, force: true })
      }
    }
  )
})

it('retains accepted paired deletion when presentation fails without replaying input into the detached block', async() => {
  const actor = createCoreActor()
  const manager = createCoreDocumentSessionManager({
    createBinding: () =>
      createEditorCoreBinding({
        request: (request) => actor.handle(request),
        dispose: () => actor.dispose()
      })
  })
  manager.open({
    documentId: 'accepted-presentation-failure.md',
    source: 'seed()\n',
    lineEnding: '\n'
  })
  const lease = manager.lease('accepted-presentation-failure.md')
  const initial = lease.projectAcknowledgedPlainTextView(lease.identity.revision)
  if (!('state' in initial.view)) throw new Error('Missing initial Core view')
  let acknowledgedView = initial.view
  const host = document.body.appendChild(document.createElement('div'))
  const muya = new Muya(host)
  let presentation = createMuyaMarkupPresentationIndex(acknowledgedView)
  const presentationFailure = new Error(
    'Test presentation failed after replacing the document view'
  )
  const reconcile = (outcome: CoreAppliedReply) => {
    const acknowledged = lease.projectAcknowledgedPlainTextView(outcome.revision)
    if (!('state' in acknowledged.view)) throw new Error('Missing acknowledged Core view')
    acknowledgedView = acknowledged.view
    presentation = createMuyaMarkupPresentationIndex(acknowledgedView, presentation)
    muya.setInlinePresentation(presentation.render)
    // The real native installation destroys the selected block. A later failure
    // must not invoke the beforeinput echo closure over that former block.
    muya.setContent(structuredClone([...acknowledgedView.state]))
    throw presentationFailure
  }
  const adapter = createMuyaPlainTextCoreAdapter(
    initial.view.bindings,
    lease.binding,
    undefined,
    reconcile,
    lease.identity.revision,
    true
  )
  const capture = createMuyaRecoveryDraftCapture({
    muya,
    lease,
    pathname: undefined,
    nativeIntent: () => adapter.recoveryDraft(),
    acknowledgedView: () => acknowledgedView
  })
  const errors: unknown[] = []
  const onError = (event: ErrorEvent) => {
    errors.push(event.error)
    event.preventDefault()
  }
  window.addEventListener('error', onError)
  let rawEchoes = 0
  try {
    muya.setInlinePresentation(presentation.render)
    muya.init()
    muya.setContent(structuredClone([...initial.view.state]))
    muya.editor.bindDocumentEditing({
      prepareImage() {
        throw new Error('Unexpected image preparation')
      },
      prepareClipboard() {
        throw new Error('Unexpected async clipboard preparation in this test')
      },
      activeFormats: (selection) => muyaActiveFormats(muya, acknowledgedView, selection),
      clipboard() {
        throw new Error('Unexpected clipboard action in this input test')
      },
      compositionStart() {
        throw new Error('Unexpected composition in this input test')
      },
      compositionUpdate() {
        throw new Error('Unexpected composition in this input test')
      },
      compositionEnd() {
        throw new Error('Unexpected composition in this input test')
      },
      format: (operation) =>
        adapter.format(muyaFormatToModel(muya, acknowledgedView, operation, false), reconcile)
          .changed,
      input(operation, present) {
        const result = adapter.input(muyaInputToModel(muya, acknowledgedView, operation), reconcile)
        if (!result.accepted) {
          rawEchoes += 1
          present()
        }
        return result.changed
      }
    })
    const original = muya.editor.scrollPage?.firstContentInDescendant()
    if (original?.domNode == null) throw new Error('Missing original paragraph')
    original.setCursor(5, 5)
    original.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    )
    const input = new InputEvent('beforeinput', {
      data: null,
      inputType: 'deleteContentBackward',
      bubbles: true,
      cancelable: true
    })
    original.domNode.dispatchEvent(input)
    expect(input.defaultPrevented).toBe(true)
    expect(await manager.saveBarrier('accepted-presentation-failure.md')).toMatchObject({
      source: 'seed\n'
    })
    expect(muya.editor.scrollPage?.firstContentInDescendant()).not.toBe(original)
    expect.soft(rawEchoes).toBe(0)
    expect(errors).toEqual([])
    expect(muya.editor.scrollPage?.firstContentInDescendant()?.domNode?.textContent).toBe('seed')
    await expect(adapter.settled()).rejects.toThrow(presentationFailure.message)
    const draft = capture(presentationFailure)
    expect(draft).toMatchObject({
      documentId: 'accepted-presentation-failure.md',
      revision: 2,
      visibleText: 'seed',
      nativeState: [{ name: 'paragraph', text: 'seed' }]
    })
    expect(draft?.nativeIntent).toMatchObject({
      revision: 2,
      nativeChange: { inputType: 'deleteContentBackward', range: { start: 4, end: 5 } }
    })
  } finally {
    window.removeEventListener('error', onError)
    adapter.dispose()
    manager.abort('accepted-presentation-failure.md')
    muya.destroy()
    host.remove()
    document.getSelection()?.removeAllRanges()
  }
})

describe('other document work during final desktop teardown', () => {
  it('waits for an inactive document save before releasing its authority', async() => {
    let release: (() => void) | undefined
    let reportHeld: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      reportHeld = resolve
    })
    const disposed = new Set<string>()
    const manager = createCoreDocumentSessionManager({
      createBinding(documentId) {
        const actor = createCoreActor()
        return createEditorCoreBinding({
          request: (request) => actor.handle(request),
          dispose() {
            disposed.add(documentId)
          }
        })
      }
    })
    await manager.open({ documentId: 'foreground.md', source: 'foreground\n', lineEnding: '\n' })
    await manager.open({
      documentId: 'background.md',
      source: 'accepted background edit\n',
      lineEnding: '\n'
    })
    const lease = manager.lease('foreground.md')
    const backgroundLease = manager.lease('background.md')
    const backgroundDrain = new Promise<void>((resolve) => {
      release = resolve
    })
    backgroundLease.settleView(async() => {
      reportHeld?.()
      await backgroundDrain
    })
    const save = manager.saveBarrier('background.md')
    await held
    const backgroundHandoff = manager.handoff(backgroundLease)
    let finished = false
    const teardown = teardownCoreDocumentSessions({
      manager,
      transition: backgroundHandoff,
      finalLease: () => lease,
      clearFinalLease: () => {},
      documentIds: ['foreground.md', 'background.md']
    }).then(() => {
      finished = true
    })
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(disposed.has('background.md')).toBe(false)
      expect(finished).toBe(false)
      release?.()
      expect(await save).toMatchObject({ source: 'accepted background edit\n' })
      await teardown
      expect([...disposed].sort()).toEqual(['background.md', 'foreground.md'])
    } finally {
      release?.()
      await Promise.allSettled([save, teardown])
      for (const documentId of ['foreground.md', 'background.md']) {
        if (!disposed.has(documentId)) manager.abort(documentId)
      }
    }
  })
})
