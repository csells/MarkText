// @vitest-environment jsdom

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import codeMirror from 'codemirror'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCoreRecoveryDraftStore } from '../../../src/main/coreRecoveryDraftStore'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'
import { createCodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'
import { createCodeMirrorRecoveryDraftCapture } from '@/documentAuthority/codeMirrorRecoveryDraftCapture'
import {
  createCoreTeardownDraftPreserver,
  teardownCoreDocumentSessions
} from '@/documentAuthority/coreDocumentSessionTeardown'

const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
beforeEach(() => {
  Object.defineProperties(Range.prototype, {
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
    getClientRects: { configurable: true, value: () => [] }
  })
})
afterEach(() => {
  for (const [name, descriptor] of [
    ['getBoundingClientRect', rangeRect],
    ['getClientRects', rangeRects]
  ] as const) {
    if (descriptor === undefined) Reflect.deleteProperty(Range.prototype, name)
    else Object.defineProperty(Range.prototype, name, descriptor)
  }
})

const typeSource = (editor: codeMirror.Editor, text: string): void => {
  const input = editor.getInputField() as HTMLTextAreaElement
  input.focus()
  for (const character of text) {
    input.setRangeText(character, input.selectionStart, input.selectionEnd, 'end')
    input.dispatchEvent(
      new InputEvent('input', { data: character, inputType: 'insertText', bubbles: true })
    )
  }
}

describe('Source native input through detached view teardown', () => {
  it.each(['accepted', 'rejected', 'backup failed'] as const)(
    'preserves pending input when %s',
    async(outcome) => {
      const scratch = mkdtempSync(join(tmpdir(), 'marktext-source-teardown-'))
      const store = createCoreRecoveryDraftStore(scratch)
      const actor = createCoreActor()
      let release: (() => void) | undefined
      const viewDrain = new Promise<void>((resolve) => {
        release = resolve
      })
      let rejectInput = false
      let historyPainting: Promise<unknown> | undefined
      let disposed = false
      const source = 'seed{++a++}\r\n'
      const manager = createCoreDocumentSessionManager({
        createBinding: () =>
          createEditorCoreBinding({
            request(request) {
              if (request.type === 'source-input' && rejectInput) { throw new Error('Worker disconnected') }
              return actor.handle(request)
            },
            dispose() {
              disposed = true
            }
          })
      })
      await manager.open({ documentId: 'source.md', source, lineEnding: '\r\n' })
      const lease = manager.lease('source.md')
      const host = document.body.appendChild(document.createElement('div'))
      const editor = codeMirror(host, { value: source, inputStyle: 'textarea' })
      const adapter = createCodeMirrorCoreAdapter(editor.getDoc(), lease.binding, {
        canonicalSource: source,
        insertedLineEnding: '\r\n'
      })
      const capture = createCodeMirrorRecoveryDraftCapture({
        editor,
        lease,
        pathname: '/scratch/source.md',
        initialSource: source,
        nativeIntent: () => adapter.recoveryDraft()
      })
      lease.setRecoveryDraftCapture(capture)
      lease.settleView(async() => {
        await viewDrain
        await adapter.settled()
      })
      lease.onHandoff(() => adapter.dispose())
      try {
        editor.setCursor({ line: 0, ch: 0 })
        if (outcome !== 'accepted') {
          typeSource(editor, 'q')
          historyPainting = adapter.history('undo')
          historyPainting.catch(() => {})
          // Native history is already admitted; its CodeMirror paint is deferred.
          await new Promise((resolve) => setTimeout(resolve, 0))
          editor.setCursor({ line: 0, ch: 0 })
          rejectInput = true
        }
        typeSource(editor, 'xyz')
        expect(editor.getValue()).toBe(
          outcome === 'accepted' ? 'xyzseed{++a++}\n' : 'xyzqseed{++a++}\n'
        )
        const save = outcome === 'accepted' ? manager.saveBarrier('source.md') : undefined
        const teardown = teardownCoreDocumentSessions({
          manager,
          transition: Promise.resolve(),
          finalLease: () => lease,
          clearFinalLease: () => {},
          documentIds: ['source.md'],
          preserveFailure: createCoreTeardownDraftPreserver({
            preserve(draft, failedLease) {
              expect(failedLease).toBe(lease)
              expect(disposed).toBe(false)
              if (outcome === 'backup failed') throw new Error('Backup unavailable')
              store.preserve(draft)
            }
          })
        })
        editor.getInputField().blur()
        host.remove()
        release?.()
        if (outcome === 'accepted') {
          const [saved] = await Promise.all([save, teardown])
          expect(saved).toMatchObject({ source: 'xyzseed{++a++}\r\n' })
          expect(disposed).toBe(true)
          expect(() => lease.captureRecoveryDraft(new Error('retired'))).toThrow(
            'lease is released'
          )
        } else {
          await expect(teardown).rejects.toThrow(
            outcome === 'rejected' ? 'Worker disconnected' : 'Backup unavailable'
          )
          expect(disposed).toBe(outcome === 'rejected')
          if (outcome === 'backup failed') store.preserve(capture(new Error('retry')))
          expect(store.list()[0]).toMatchObject({
            documentId: 'source.md',
            pathname: '/scratch/source.md',
            visibleText: 'xyzseed{++a++}\n',
            nativeState: {
              surface: 'source',
              text: 'xyzseed{++a++}\n',
              selections: [{ anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } }]
            },
            nativeIntent: {
              text: 'xyzseed{++a++}\n',
              commands: [
                { edits: [{ start: 0, end: 0, insert: 'x' }] },
                { edits: [{ start: 1, end: 1, insert: 'y' }] },
                { edits: [{ start: 2, end: 2, insert: 'z' }] }
              ]
            }
          })
        }
      } finally {
        release?.()
        await Promise.allSettled([historyPainting])
        editor.getInputField().blur()
        if (!disposed) manager.abort('source.md')
        host.remove()
        rmSync(scratch, { recursive: true, force: true })
      }
    }
  )
})

it.each(['tab', 'generation'] as const)(
  'preserves the final lease draft after a %s transition during teardown',
  async(kind) => {
    const scratch = mkdtempSync(join(tmpdir(), 'marktext-source-transition-'))
    const store = createCoreRecoveryDraftStore(scratch)
    const newDocumentId = kind === 'generation' ? 'old.md' : 'new.md'
    const documentIds = [...new Set(['old.md', newDocumentId])]
    const activeBindings = new Map<string, Set<number>>()
    let bindingNumber = 0
    let failingInput = false
    const manager = createCoreDocumentSessionManager({
      createBinding(documentId) {
        const actor = createCoreActor()
        const number = ++bindingNumber
        const bindings = activeBindings.get(documentId) ?? new Set<number>()
        bindings.add(number)
        activeBindings.set(documentId, bindings)
        return createEditorCoreBinding({
          request(request) {
            if (failingInput && request.type === 'source-input') { throw new Error('New view Worker disconnected') }
            return actor.handle(request)
          },
          dispose() {
            activeBindings.get(documentId)?.delete(number)
          }
        })
      }
    })
    await manager.open({ documentId: 'old.md', source: 'old text', lineEnding: '\n' })
    if (kind === 'tab') { await manager.open({ documentId: newDocumentId, source: 'new{++a++}', lineEnding: '\n' }) }
    const oldLease = manager.lease('old.md')
    const oldGeneration = oldLease.identity.generation
    let currentLease = oldLease
    const oldHost = document.body.appendChild(document.createElement('div'))
    const oldEditor = codeMirror(oldHost, { value: 'old text' })
    const oldCapture = createCodeMirrorRecoveryDraftCapture({
      editor: oldEditor,
      lease: oldLease,
      pathname: '/scratch/old.md',
      initialSource: 'old text',
      nativeIntent: () => undefined
    })
    oldLease.setRecoveryDraftCapture(oldCapture)
    const newHost = document.body.appendChild(document.createElement('div'))
    const newEditor = codeMirror(newHost, { value: 'new{++a++}' })
    let startTransition: (() => void) | undefined
    const transitionGate = new Promise<void>((resolve) => {
      startTransition = resolve
    })
    const transition = transitionGate.then(async() => {
      if (kind === 'generation') {
        currentLease = await manager.replace(oldLease, {
          documentId: newDocumentId,
          source: 'new{++a++}',
          lineEnding: '\n'
        })
      } else {
        await manager.handoff(oldLease)
        currentLease = manager.lease(newDocumentId)
      }
      failingInput = true
      const adapter = createCodeMirrorCoreAdapter(newEditor.getDoc(), currentLease.binding, {
        canonicalSource: 'new{++a++}',
        insertedLineEnding: '\n'
      })
      currentLease.setRecoveryDraftCapture(
        createCodeMirrorRecoveryDraftCapture({
          editor: newEditor,
          lease: currentLease,
          pathname: `/scratch/${newDocumentId}`,
          initialSource: 'new{++a++}',
          nativeIntent: () => adapter.recoveryDraft()
        })
      )
      currentLease.settleView(() => adapter.settled())
      currentLease.onHandoff(() => adapter.dispose())
      newEditor.setCursor({ line: 0, ch: 0 })
      typeSource(newEditor, 'xyz')
      expect(newEditor.getValue()).toBe('xyznew{++a++}')
    })
    const teardown = teardownCoreDocumentSessions({
      manager,
      transition,
      finalLease: () => currentLease,
      clearFinalLease: () => {},
      documentIds,
      preserveFailure: createCoreTeardownDraftPreserver({
        preserve: (draft) => {
          store.preserve(draft)
        }
      })
    })
    try {
      startTransition?.()
      await transition
      oldHost.remove()
      newEditor.getInputField().blur()
      newHost.remove()
      await expect(teardown).rejects.toThrow('New view Worker disconnected')
      expect(store.list()).toHaveLength(1)
      expect(store.list()[0]).toMatchObject({
        documentId: newDocumentId,
        pathname: `/scratch/${newDocumentId}`,
        generation: currentLease.identity.generation,
        visibleText: 'xyznew{++a++}'
      })
      if (kind === 'generation') expect(store.list()[0]?.generation).not.toBe(oldGeneration)
    } finally {
      startTransition?.()
      await Promise.allSettled([transition, teardown])
      oldEditor.getInputField().blur()
      newEditor.getInputField().blur()
      oldHost.remove()
      newHost.remove()
      for (const documentId of documentIds) { if ((activeBindings.get(documentId)?.size ?? 0) > 0) manager.abort(documentId) }
      rmSync(scratch, { recursive: true, force: true })
    }
  }
)

it('publishes every native Source edit and its lease revision before the input event returns', async() => {
  const actor = createCoreActor()
  const manager = createCoreDocumentSessionManager({
    createBinding: () =>
      createEditorCoreBinding({
        request: (request) => actor.handle(request),
        dispose: () => actor.dispose()
      })
  })
  await manager.open({
    documentId: 'synchronous-source.md',
    source: 'a{++a++}a\r\n',
    lineEnding: '\r\n'
  })
  const lease = manager.lease('synchronous-source.md')
  const host = document.body.appendChild(document.createElement('div'))
  const editor = codeMirror(host, { value: 'a{++a++}a\r\n', inputStyle: 'textarea' })
  const adapter = createCodeMirrorCoreAdapter(editor.getDoc(), lease.binding, {
    canonicalSource: 'a{++a++}a\r\n',
    insertedLineEnding: '\r\n'
  })
  const published: number[] = []
  lease.binding.observe((event) => {
    expect(lease.identity.revision).toBe(event.outcome.revision)
    published.push(event.outcome.revision)
  })
  lease.settleView(() => adapter.settled())
  lease.onHandoff(() => adapter.dispose())
  try {
    editor.setCursor({ line: 0, ch: 0 })
    typeSource(editor, 'xyz')
    expect(editor.getValue()).toBe('xyza{++a++}a\n')
    expect(lease.identity.revision).toBe(4)
    expect(published).toEqual([2, 3, 4])
    expect(await manager.saveBarrier('synchronous-source.md')).toMatchObject({
      source: 'xyza{++a++}a\r\n'
    })
    await manager.handoff(lease)
    await manager.close('synchronous-source.md')
  } finally {
    editor.getInputField().blur()
    adapter.dispose()
    host.remove()
  }
})
