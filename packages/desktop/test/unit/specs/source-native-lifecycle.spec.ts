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
              if (request.type === 'source-input' && rejectInput) {
                throw new Error('Worker disconnected')
              }
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
        canonicalRevision: 1,
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
          await historyPainting
          editor.setCursor({ line: 0, ch: 0 })
          rejectInput = true
        }
        typeSource(editor, 'xyz')
        expect(editor.getValue()).toBe('xyzseed{++a++}\n')
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
              text: 'xseed{++a++}\n',
              commands: [{ edits: [{ start: 0, end: 0, insert: 'x' }] }]
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
            if (failingInput && request.type === 'source-input') {
              throw new Error('New view Worker disconnected')
            }
            return actor.handle(request)
          },
          dispose() {
            activeBindings.get(documentId)?.delete(number)
          }
        })
      }
    })
    await manager.open({ documentId: 'old.md', source: 'old text', lineEnding: '\n' })
    if (kind === 'tab') {
      await manager.open({ documentId: newDocumentId, source: 'new{++a++}', lineEnding: '\n' })
    }
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
        canonicalRevision: currentLease.identity.revision,
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
      for (const documentId of documentIds) {
        if ((activeBindings.get(documentId)?.size ?? 0) > 0) manager.abort(documentId)
      }
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
    canonicalRevision: 1,
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

const sourcePresentation = (source: string) => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  binding.open({ documentId: 'source-presentation.md', source })
  const host = document.body.appendChild(document.createElement('div'))
  const editor = codeMirror(host, {
    value: source,
    inputStyle: 'textarea',
    viewportMargin: Infinity
  })
  Object.defineProperty(editor.getScrollerElement(), 'clientHeight', {
    configurable: true,
    value: 500
  })
  Object.defineProperties(editor.getWrapperElement(), {
    clientWidth: { configurable: true, value: 800 },
    offsetWidth: { configurable: true, value: 800 }
  })
  const adapter = createCodeMirrorCoreAdapter(editor.getDoc(), binding, {
    canonicalSource: source,
    canonicalRevision: 1,
    insertedLineEnding: '\r\n',
    nativeHistoryScope: 'source-presentation'
  })
  editor.setSize(800, 500)
  editor.refresh()
  const rendered: Array<{ line: number; text: string; source: string; revision: number }> = []
  editor.on('renderLine', (_editor, line) => {
    const canonical = binding.sourceAtBarrier()
    if (canonical.type !== 'source') throw new Error('Expected canonical Source input')
    const lineNumber = editor.getLineNumber(line)
    if (lineNumber === null) throw new Error('Expected an attached rendered line')
    rendered.push({
      line: lineNumber,
      text: line.text,
      source: canonical.source,
      revision: canonical.revision
    })
  })
  return {
    editor,
    adapter,
    binding,
    rendered,
    dispose() {
      editor.getInputField().blur()
      adapter.dispose()
      binding.dispose()
      host.remove()
    }
  }
}

it.each(['seed **word**\r\n', 'seed {++word++}\r\n'])(
  'admits native Source typing before rendering its text and retains selection through history: %s',
  async(source) => {
    const app = sourcePresentation(source)
    try {
      app.editor.setCursor({ line: 0, ch: 0 })
      typeSource(app.editor, 'X')
      expect(app.rendered).toContainEqual({
        line: 0,
        text: `X${source.trimEnd()}`,
        source: `X${source}`,
        revision: 2
      })
      expect(app.editor.getCursor()).toMatchObject({ line: 0, ch: 1 })
      await app.adapter.history('undo')
      expect(app.editor.getCursor()).toMatchObject({ line: 0, ch: 0 })
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo')
      expect(app.editor.getCursor()).toMatchObject({ line: 0, ch: 1 })
      typeSource(app.editor, 'Y')
      await app.adapter.settled()
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: `XY${source}` })
      expect(
        app.rendered.every((entry) => entry.text === entry.source.split('\r\n')[entry.line])
      ).toBe(true)
    } finally {
      app.dispose()
    }
  }
)

it('admits the complete multi-selection operation before rendering, including later cancellation and update', async() => {
  const source = 'same\r\nsame\r\nsame {++word++}\r\n'
  const app = sourcePresentation(source)
  const selections = [0, 1, 2].map((line) => ({
    anchor: { line, ch: 4 },
    head: { line, ch: 0 }
  }))
  const beforeChange = (_editor: codeMirror.Editor, change: codeMirror.EditorChangeCancellable) => {
    if (change.from.line === 0) change.cancel()
    if (change.from.line === 2) change.update?.(undefined, undefined, ['Y'])
  }
  try {
    app.editor.setSelections(selections, 1)
    app.editor.on('beforeChange', beforeChange)
    typeSource(app.editor, 'X')
    app.editor.off('beforeChange', beforeChange)
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: 'same\r\nX\r\nY {++word++}\r\n',
      revision: 2
    })
    expect(app.rendered.length).toBeGreaterThan(0)
    expect(app.rendered.every((entry) => entry.source === 'same\r\nX\r\nY {++word++}\r\n')).toBe(
      true
    )
    const afterSelection = app.editor.listSelections()
    await app.adapter.history('undo')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.editor.listSelections()).toMatchObject(selections)
    expect(app.editor.getCursor()).toMatchObject({ line: 1, ch: 0 })
    await app.adapter.history('redo')
    expect(app.editor.listSelections()).toEqual(afterSelection)
    typeSource(app.editor, 'Z')
    await app.adapter.settled()
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: 'Z\r\nXZ\r\nYZ {++word++}\r\n'
    })
  } finally {
    app.editor.off('beforeChange', beforeChange)
    app.dispose()
  }
})

it('uses the admitted history result before rendering the next native Source input', async() => {
  const app = sourcePresentation('seed {++word++}\r\n')
  try {
    app.editor.setCursor({ line: 0, ch: 0 })
    typeSource(app.editor, 'X')
    const stop = app.binding.observe(() => {
      stop()
      queueMicrotask(() => typeSource(app.editor, 'Y'))
    })
    await app.adapter.history('undo')
    await app.adapter.settled()
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'Yseed {++word++}\r\n' })
    expect(
      app.rendered.every((entry) => entry.text === entry.source.split('\r\n')[entry.line])
    ).toBe(true)
    await app.adapter.history('undo')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'seed {++word++}\r\n' })
    await app.adapter.history('redo')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'Yseed {++word++}\r\n' })
  } finally {
    app.dispose()
  }
})
