// @vitest-environment jsdom

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCoreRecoveryDraftStore } from '../../../src/main/coreRecoveryDraftStore'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'
import { createMuyaRecoveryDraftCapture } from '@/documentAuthority/muyaRecoveryDraftCapture'
import {
  createCoreTeardownDraftPreserver,
  teardownCoreDocumentSessions
} from '@/documentAuthority/coreDocumentSessionTeardown'
import { Muya } from '@muyajs/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import {
  muyaActiveFormats,
  muyaInputToModel,
  muyaFormatToModel
} from '@/documentAuthority/muyaModelSelection'
import { reconcileMuyaDocumentView } from '@/documentAuthority/reconcileMuyaDocumentView'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

beforeEach(() => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
})

interface CompositionCase {
  source: string
  end: number
  data: string
  expected: string
  tracked?: boolean
  caret?: number
  followup?: boolean
  cancel?: boolean
  unavailable?: boolean
  imeKey?: string
}

describe('actual native composition on the shared model', () => {
  it.each<CompositionCase>([
    { source: 'a{++a++}a\n', end: 2, data: 'a', expected: 'aa\n' },
    { source: 'a{++a++}a\n', end: 2, data: '你', expected: '你a\n' },
    { source: 'aaa\n', end: 2, data: 'a', expected: 'aa\n' },
    ...['Enter', 'Backspace', 'Delete', 'Tab'].map((imeKey) => ({
      source: 'aaa\n',
      end: 2,
      data: '你',
      expected: '你a\n',
      imeKey
    })),
    { source: 'aaa\n', end: 2, data: '你', expected: '{~~aa~>你~~}a\n', tracked: true, caret: 3 },
    { source: 'a{++a++}a\n', end: 2, data: 'a', expected: 'aa\n', followup: true },
    { source: 'a{++a++}a\n', end: 2, data: '', expected: 'a{++a++}a\n', cancel: true },
    { source: 'a{++a++}a\n', end: 2, data: '', expected: 'a{++a++}a\n', unavailable: true }
  ])(
    'replaces the selected composition range in $source with $data',
    async({
      source,
      end,
      data,
      expected,
      tracked = false,
      caret = data.length,
      followup = false,
      cancel = false,
      unavailable = false,
      imeKey = undefined
    }) => {
      const binding = createEditorCoreBinding(createLocalCoreOwner())
      binding.open({ documentId: 'composition.md', source })
      const initial = binding.plainTextViewAtBarrier()
      if (initial.type !== 'plain-text-view' || !('state' in initial.view)) { throw new Error('Missing native Core view') }
      let current = initial.view
      let presentation = createMuyaMarkupPresentationIndex(current)
      const host = document.body.appendChild(document.createElement('div'))
      const muya = new Muya(host)
      const reconcile = (outcome: CoreAppliedReply) => {
        const next = binding.plainTextViewAtBarrier()
        if (next.type !== 'plain-text-view' || !('state' in next.view)) { throw new Error('Missing native Core view') }
        current = next.view
        presentation = createMuyaMarkupPresentationIndex(current, presentation)
        muya.setInlinePresentation(presentation.render)
        reconcileMuyaDocumentView({
          muya,
          view: current,
          outcome,
          sourcePosition: adapter.reconciledSourcePosition,
          dirtyPaths: presentation.changedPaths,
          applyEditability: () => {}
        })
        return current.bindings
      }
      const adapter = createMuyaPlainTextCoreAdapter(
        initial.view.bindings,
        binding,
        undefined,
        reconcile
      )
      try {
        muya.setInlinePresentation(presentation.render)
        muya.init()
        muya.setContent(structuredClone([...current.state]))
        muya.editor.bindDocumentEditing({
          prepareImage() {
            throw new Error('Unexpected image preparation')
          },
          prepareClipboard() {
            throw new Error('Unexpected async clipboard preparation in this test')
          },
          activeFormats: (selection) => muyaActiveFormats(muya, current, selection),
          clipboard() {
            throw new Error('Unexpected clipboard in composition test')
          },
          compositionStart: (operation) =>
            adapter.compositionStart(muyaInputToModel(muya, current, operation)),
          compositionUpdate: (data) => adapter.compositionUpdate(data),
          compositionEnd(outcome, present) {
            const result = adapter.compositionEnd(outcome, reconcile, tracked)
            if (!result.accepted) present()
            return result.changed
          },
          format: (operation) =>
            adapter.format(muyaFormatToModel(muya, current, operation, false), reconcile).changed,
          input(operation, present) {
            const result = adapter.input(muyaInputToModel(muya, current, operation), reconcile)
            if (!result.accepted) present()
            return result.changed
          }
        })
        muya.on('json-change', (change: { source: string }) => {
          if (change.source === 'user') adapter.accept(change)
        })
        const block = muya.editor.scrollPage?.firstContentInDescendant()
        if (!block?.domNode) throw new Error('Missing native content')
        muya.editor.activeContentBlock = block
        block.setCursor(0, end)
        block.domNode.dispatchEvent(
          new CompositionEvent('compositionstart', { bubbles: true, data: '' })
        )
        expect(adapter.isSettled()).toBe(false)
        let settled = false
        let barrierError: unknown
        const barrier = adapter.settled().then(
          () => {
            settled = true
          },
          (error) => {
            barrierError = error
          }
        )
        for (const candidate of ['n', '你', ...(data ? [data] : [])]) {
          block.domNode.dispatchEvent(
            new CompositionEvent('compositionupdate', { bubbles: true, data: candidate })
          )
          block.domNode.dispatchEvent(
            new InputEvent('beforeinput', {
              bubbles: true,
              inputType: 'insertCompositionText',
              data: candidate,
              isComposing: true
            })
          )
          block.domNode.textContent = candidate + 'a'
          block.setCursor(candidate.length, candidate.length)
          block.domNode.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              inputType: 'insertCompositionText',
              data: candidate,
              isComposing: true
            })
          )
        }
        if (imeKey !== undefined) {
          const key = new KeyboardEvent('keydown', {
            key: imeKey,
            bubbles: true,
            cancelable: true,
            isComposing: true
          })
          block.domNode.dispatchEvent(key)
          expect(key.defaultPrevented).toBe(false)
        }
        expect(binding.sourceAtBarrier()).toMatchObject({ source })
        await Promise.resolve()
        expect(settled).toBe(false)
        if (cancel) {
          block.domNode.dispatchEvent(
            new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', isComposing: true })
          )
        }
        block.domNode.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data }))
        // The model result and caret must be installed before the next key.
        expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
        if (followup) {
          const next = muya.editor.scrollPage?.firstContentInDescendant()
          next?.domNode?.dispatchEvent(
            new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: 'x'
            })
          )
          expect(binding.sourceAtBarrier()).toMatchObject({ source: 'axa\n' })
        }
        await barrier
        if (unavailable) {
          expect(barrierError).toBeInstanceOf(Error)
          expect(adapter.state().status).toBe('faulted')
          expect(adapter.recoveryDraft()?.composition).toMatchObject({ data: '你' })
          expect(muya.editor.scrollPage?.firstContentInDescendant()?.text).toBe('你a')
          return
        }
        expect(adapter.isSettled()).toBe(true)
        expect(barrierError).toBeUndefined()
        if (cancel) {
          expect(binding.sourceAtBarrier()).toMatchObject({
            source,
            recoveryHistory: { undo: [], redo: [] }
          })
          expect(muya.editor.scrollPage?.firstContentInDescendant()?.domNode?.textContent).toBe(
            'aaa'
          )
          expect(muya.getSelection()).toMatchObject({
            anchor: { offset: 0 },
            focus: { offset: end }
          })
          return
        }
        if (followup) await adapter.history('undo', reconcile)
        else {
          expect(muya.getSelection()).toMatchObject({
            anchor: { offset: caret },
            focus: { offset: caret }
          })
        }
        expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
        await adapter.history('undo', reconcile)
        expect(binding.sourceAtBarrier()).toMatchObject({ source })
        await adapter.history('redo', reconcile)
        expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      } finally {
        muya.destroy()
        adapter.dispose()
        binding.dispose()
        muya.domNode.remove()
        host.remove()
        document.getSelection()?.removeAllRanges()
      }
    }
  )
})

describe('active native composition teardown', () => {
  it.each(['destroy', 'unbind'] as const)(
    'preserves the candidate durably and terminates save/handoff when the view must %s',
    async(route) => {
      const scratch = mkdtempSync(join(tmpdir(), 'marktext-composition-teardown-'))
      const store = createCoreRecoveryDraftStore(scratch)
      const owner = createLocalCoreOwner()
      let disposed = false
      const authority = createEditorCoreBinding({
        request: (request) => owner.request(request),
        dispose() {
          disposed = true
          owner.dispose()
        }
      })
      const manager = createCoreDocumentSessionManager({ createBinding: () => authority })
      const documentId = 'composition-teardown.md'
      const source = 'a{++a++}a\n'
      manager.open({ documentId, source, lineEnding: '\n' })
      const lease = manager.lease(documentId)
      const projection = lease.projectAcknowledgedPlainTextView(lease.identity.revision)
      if (projection.type !== 'plain-text-view' || !('state' in projection.view)) { throw new Error('Missing native model view') }
      const view = projection.view
      const host = document.body.appendChild(document.createElement('div'))
      const muya = new Muya(host)
      const adapter = createMuyaPlainTextCoreAdapter(view.bindings, lease.binding)
      const capture = createMuyaRecoveryDraftCapture({
        muya,
        lease,
        pathname: undefined,
        nativeIntent: () => adapter.recoveryDraft(),
        acknowledgedView: () => view
      })
      try {
        muya.setInlinePresentation(createMuyaMarkupPresentationIndex(view).render)
        muya.init()
        muya.setContent(structuredClone([...view.state]))
        muya.editor.bindDocumentEditing({
          prepareImage() {
            throw new Error('Unexpected image preparation')
          },
          prepareClipboard() {
            throw new Error('Unexpected async clipboard preparation in this test')
          },
          activeFormats: (selection) => muyaActiveFormats(muya, view, selection),
          clipboard() {
            throw new Error('Unexpected clipboard in composition test')
          },
          compositionStart: (operation) =>
            adapter.compositionStart(muyaInputToModel(muya, view, operation)),
          compositionUpdate: (data) => adapter.compositionUpdate(data),
          compositionEnd(outcome, present) {
            const result = adapter.compositionEnd(outcome, () => {
              throw new Error('Interrupted composition cannot commit')
            })
            if (!result.accepted) present()
            return result.changed
          },
          format() {
            throw new Error('Unexpected format')
          },
          input() {
            throw new Error('Unexpected input')
          }
        })
        lease.settleView(() => adapter.settled())
        lease.setRecoveryDraftCapture(capture)
        lease.onHandoff(() => adapter.dispose())
        const block = muya.editor.scrollPage?.firstContentInDescendant()
        if (!block?.domNode) throw new Error('Missing native content')
        block.setCursor(0, 2)
        block.domNode.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        block.domNode.dispatchEvent(
          new CompositionEvent('compositionupdate', { bubbles: true, data: '日本' })
        )
        block.domNode.textContent = '日本a'
        block.setCursor(2, 2)
        block.domNode.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: '日本',
            inputType: 'insertCompositionText',
            isComposing: true
          })
        )
        let saveFinished = false
        const save = manager.saveBarrier(documentId).then(
          () => {
            saveFinished = true
            return undefined
          },
          (error) => {
            saveFinished = true
            return error
          }
        )
        const teardown = teardownCoreDocumentSessions({
          manager,
          transition: Promise.resolve(),
          finalLease: () => lease,
          clearFinalLease: () => {},
          documentIds: [documentId],
          preserveFailure: createCoreTeardownDraftPreserver({
            preserve(draft) {
              expect(disposed).toBe(false)
              expect(authority.sourceAtBarrier()).toMatchObject({
                source,
                recoveryHistory: { undo: [], redo: [] }
              })
              store.preserve(draft)
            }
          })
        })
        const teardownResult = teardown.catch((error) => error)
        await Promise.resolve()
        expect(saveFinished).toBe(false)
        if (route === 'destroy') muya.destroy()
        else muya.editor.unbindDocumentEditing()
        expect(await save).toMatchObject({ message: expect.stringContaining('ambiguous') })
        expect(await teardownResult).toMatchObject({
          message: expect.stringContaining('ambiguous')
        })
        expect(disposed).toBe(true)
        expect(store.list()).toHaveLength(1)
        expect(store.list()[0]).toMatchObject({
          documentId,
          revision: 1,
          visibleText: '日本a',
          nativeState: [{ name: 'paragraph', text: '日本a' }],
          nativeIntent: {
            composition: {
              data: '日本',
              input: { selection: { ranges: [{ anchor: 0, focus: 5 }], primary: 0 } }
            }
          }
        })
      } finally {
        if (!disposed) manager.abort(documentId)
        muya.destroy()
        host.remove()
        document.getSelection()?.removeAllRanges()
        rmSync(scratch, { recursive: true, force: true })
      }
    }
  )
})
