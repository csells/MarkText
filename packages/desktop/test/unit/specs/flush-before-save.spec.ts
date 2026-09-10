import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// `@/store/editor` reads `window.path` at module load and `window.electron`
// at runtime; stub those surfaces before the hoisted imports run.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      fileUtils?: { isSamePathSync: (left: string, right: string) => boolean }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: {
          send: (...a: unknown[]) => void
          on: (...a: unknown[]) => void
          invoke: (...a: unknown[]) => Promise<unknown>
        }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.fileUtils ??= { isSamePathSync: (left, right) => left === right }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {}, invoke: async() => true }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import bus from '@/bus'
import { coreDocumentSaveAuthority } from '@/documentAuthority/coreDocumentSaveAuthority'
import { sendBufferedState } from '@/store/bufferedState'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'

// #3803: the store snapshots `currentFile.markdown` (refreshed only on the
// engine's deferred rAF `json-change`) to send to the main process. A keystroke
// typed in the same frame as Cmd+S was therefore dropped from the saved file.
// The save/move/rename paths now emit `flush-active-editor` first, which the
// editor synchronously commits into `currentFile.markdown` before it is read.
//
// The bug lives at the `const { …, markdown } = this.currentFile` READ, which
// sits between the flush and the send — so an emit-order assertion (flush < send)
// alone would still pass if a regression moved the flush past the read. These
// tests instead wire a real `flush-active-editor` listener that commits the
// pending keystroke (mirroring editor.vue → `editor.flush()` → `json-change` →
// LISTEN_FOR_CONTENT_CHANGE) and assert the SENT PAYLOAD carries it: a flush
// moved after the read would send the stale snapshot and fail here.

const STALE = 'hello' // what the pre-flush snapshot holds
const FLUSHED = 'hello world!' // the last keystroke the editor commits on flush
const MARKDOWN_ARG = 4 // send(channel, id, filename, pathname, markdown, …)

function seedCurrentFile(
  store: ReturnType<typeof useEditorStore>,
  overrides: Record<string, unknown> = {}
) {
  store.currentFile = {
    id: 'tab-1',
    filename: 'note.md',
    pathname: '/tmp/note.md',
    markdown: STALE,
    isSaved: false,
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
    adjustLineEndingOnSave: false,
    trimTrailingNewline: 2,
    ...overrides
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// Mirror editor.vue's listener: commit the pending keystroke into the store on
// flush. Returns a detach fn (the bus is a module singleton — listeners leak
// across tests otherwise).
function onFlushCommit(store: ReturnType<typeof useEditorStore>) {
  const handler = () => {
    if (store.currentFile) store.currentFile.markdown = FLUSHED
  }
  bus.on('flush-active-editor', handler)
  return () => bus.off('flush-active-editor', handler)
}

// Global invocation order of a given emitted event, located by event name (not
// array position) so an unrelated earlier emit can't mask a moved flush.
function emitOrderOf(emitSpy: ReturnType<typeof vi.spyOn>, event: string): number | undefined {
  const i = emitSpy.mock.calls.findIndex((c: unknown[]) => c[0] === event)
  return i === -1 ? undefined : emitSpy.mock.invocationCallOrder[i]
}

describe('editor store — flush pending edits before saving (#3803)', () => {
  let detach: (() => void) | undefined
  let detachCoreAuthority: (() => void) | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    detach?.()
    detach = undefined
    detachCoreAuthority?.()
    detachCoreAuthority = undefined
  })

  it('prepares the latest live owner and holds admission until matching close cancellation', async() => {
    usePreferencesStore().startUpAction = 'blank'
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'seed\n' })
    store.tabs = [store.currentFile!]
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
    })
    manager.open({ documentId: 'tab-1', source: 'seed\n', lineEnding: '\n' })
    let lease = manager.lease('tab-1')
    detachCoreAuthority = coreDocumentSaveAuthority.register(
      'tab-1',
      () => manager.saveBarrier('tab-1'),
      (identity) => manager.isSaveSnapshotCurrent('tab-1', identity)
    )
    let resumed!: () => void
    const restored = new Promise<void>((resolve) => {
      resumed = resolve
    })
    const unregisterClose = coreDocumentSaveAuthority.registerClose(() => {
      let release!: () => void
      const ready = manager
        .prepareClose(() => manager.handoff(lease))
        .then((value) => {
          release = value
        })
      return {
        ready,
        async resume() {
          await ready
          release()
          lease = manager.lease('tab-1')
          resumed()
        }
      }
    })
    vi.spyOn(window.electron.ipcRenderer, 'invoke').mockResolvedValue(true)
    let prepared!: () => void
    const replied = new Promise<void>((resolve) => {
      prepared = resolve
    })
    const send = vi.spyOn(window.electron.ipcRenderer, 'send').mockImplementation((...args) => {
      if (args[0] === 'mt::window-close-prepared') prepared()
    })
    const on = vi.spyOn(window.electron.ipcRenderer, 'on')
    store.LISTEN_FOR_CLOSE()
    const prepare = on.mock.calls.find((call) => call[0] === 'mt::prepare-window-close')?.[1] as
      | ((event: unknown, id: number) => void)
      | undefined
    const cancel = on.mock.calls.find((call) => call[0] === 'mt::cancel-window-close')?.[1] as
      | ((event: unknown, id: number) => void)
      | undefined
    try {
      expect(prepare).toBeTypeOf('function')
      expect(cancel).toBeTypeOf('function')
      lease.binding.submit({ edits: [{ start: 4, end: 4, insert: ' late' }], projections: [] })
      prepare!(undefined, 7)
      await replied
      expect(send).toHaveBeenCalledWith(
        'mt::window-close-prepared',
        expect.objectContaining({
          requestId: 7,
          requiresConfirmation: true,
          files: [
            expect.objectContaining({ markdown: 'seed late\n', saveIdentity: lease.identity })
          ]
        })
      )
      expect(() =>
        lease.binding.submit({ edits: [{ start: 4, end: 4, insert: ' dropped' }], projections: [] })
      ).toThrow(/released/i)
      cancel!(undefined, 6)
      expect(() => manager.lease('tab-1')).toThrow(/clos/i)
      cancel!(undefined, 7)
      await restored
      lease.binding.submit({ kind: 'undo', projections: [] })
      expect((await manager.saveBarrier('tab-1')).source).toBe('seed\n')
    } finally {
      unregisterClose()
      await manager.handoff(lease)
      await manager.close('tab-1')
    }
  })

  it('reports failed remount without acknowledging resumed input and retries restoration on cancellation', async() => {
    const store = useEditorStore()
    seedCurrentFile(store)
    store.tabs = [store.currentFile!]
    const restore = vi
      .fn()
      .mockRejectedValueOnce(new Error('Remount failed'))
      .mockResolvedValue(undefined)
    const unregister = coreDocumentSaveAuthority.registerClose(() => ({
      ready: Promise.reject(new Error('Input drain failed')),
      resume: restore
    }))
    const on = vi.spyOn(window.electron.ipcRenderer, 'on')
    const send = vi.spyOn(window.electron.ipcRenderer, 'send')
    store.LISTEN_FOR_CLOSE()
    const prepare = on.mock.calls.find((call) => call[0] === 'mt::prepare-window-close')![1] as (
      event: unknown,
      id: number
    ) => void
    const cancel = on.mock.calls.find((call) => call[0] === 'mt::cancel-window-close')![1] as (
      event: unknown,
      id: number
    ) => void
    try {
      prepare(undefined, 11)
      await vi.waitFor(() =>
        expect(send).toHaveBeenCalledWith('mt::window-close-prepared', {
          requestId: 11,
          error: 'Input drain failed'
        })
      )
      expect(send).not.toHaveBeenCalledWith('mt::window-close-resumed', 11)
      cancel(undefined, 11)
      await vi.waitFor(() => expect(send).toHaveBeenCalledWith('mt::window-close-resumed', 11))
      expect(restore).toHaveBeenCalledTimes(2)
    } finally {
      unregister()
    }
  })

  it('serializes cancelled input restoration before preparing another close request', async() => {
    const store = useEditorStore()
    seedCurrentFile(store)
    store.tabs = [store.currentFile!]
    vi.spyOn(window.electron.ipcRenderer, 'invoke').mockResolvedValue(true)
    let release!: () => void
    const remounting = new Promise<void>((resolve) => {
      release = resolve
    })
    const prepareOwner = vi.fn(() => ({ ready: Promise.resolve(), resume: () => remounting }))
    const unregister = coreDocumentSaveAuthority.registerClose(prepareOwner)
    const on = vi.spyOn(window.electron.ipcRenderer, 'on')
    const send = vi.spyOn(window.electron.ipcRenderer, 'send')
    store.LISTEN_FOR_CLOSE()
    const prepare = on.mock.calls.find((call) => call[0] === 'mt::prepare-window-close')![1] as (
      event: unknown,
      id: number
    ) => void
    const cancel = on.mock.calls.find((call) => call[0] === 'mt::cancel-window-close')![1] as (
      event: unknown,
      id: number
    ) => void
    try {
      prepare(undefined, 1)
      await vi.waitFor(() =>
        expect(send).toHaveBeenCalledWith(
          'mt::window-close-prepared',
          expect.objectContaining({ requestId: 1 })
        )
      )
      cancel(undefined, 1)
      prepare(undefined, 2)
      await Promise.resolve()
      expect(prepareOwner).toHaveBeenCalledTimes(1)
      expect(send).not.toHaveBeenCalledWith('mt::window-close-resumed', 1)
      release()
      await vi.waitFor(() =>
        expect(send).toHaveBeenCalledWith(
          'mt::window-close-prepared',
          expect.objectContaining({ requestId: 2 })
        )
      )
      expect(prepareOwner).toHaveBeenCalledTimes(2)
      expect(send).toHaveBeenCalledWith('mt::window-close-resumed', 1)
      cancel(undefined, 2)
    } finally {
      release()
      unregister()
    }
  })

  it('refuses close before its first source barrier when the live input owner is composing', () => {
    const store = useEditorStore()
    seedCurrentFile(store)
    store.tabs = [store.currentFile!]
    const owner = vi.fn(() => ({ ready: Promise.resolve(), resume: async() => {} }))
    const unregister = coreDocumentSaveAuthority.registerClose(owner, () => {
      throw new Error('Finish composition')
    })
    const on = vi.spyOn(window.electron.ipcRenderer, 'on')
    const invoke = vi.spyOn(window.electron.ipcRenderer, 'invoke')
    const send = vi.spyOn(window.electron.ipcRenderer, 'send')
    store.LISTEN_FOR_CLOSE()
    const ask = on.mock.calls.find((call) => call[0] === 'mt::ask-for-close')![1] as () => void
    try {
      ask()
      expect(invoke).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
      expect(owner).not.toHaveBeenCalled()
    } finally {
      unregister()
    }
  })

  it('does not admit a new blank tab while the live close owner has retired input', () => {
    const store = useEditorStore()
    seedCurrentFile(store)
    store.tabs = [store.currentFile!]
    const unregister = coreDocumentSaveAuthority.registerClose(
      () => ({ ready: Promise.resolve(), resume: async() => {} }),
      undefined,
      () => true
    )
    try {
      store.NEW_UNTITLED_TAB({})
      expect(store.tabs.map((tab) => tab.id)).toEqual(['tab-1'])
      expect(store.currentFile?.id).toBe('tab-1')
    } finally {
      unregister()
    }
  })

  it('FILE_SAVE sends the flushed markdown, not the stale pre-flush snapshot', () => {
    const store = useEditorStore()
    seedCurrentFile(store)
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.FILE_SAVE()

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(call).toBeDefined()
    expect(call?.[MARKDOWN_ARG]).toBe(FLUSHED)
  })

  it('waits for Core authority and saves its acknowledged source instead of Pinia', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'poisoned Pinia snapshot' })
    let release: ((source: string) => void) | undefined
    detachCoreAuthority = coreDocumentSaveAuthority.register(
      'tab-1',
      () =>
        new Promise((resolve) => {
          release = (source) =>
            resolve({
              documentId: 'tab-1',
              identity: { generation: 1, revision: 2 },
              source
            })
        })
    )
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    const saving = store.FILE_SAVE()
    expect(sendSpy).not.toHaveBeenCalledWith(
      'mt::response-file-save',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )

    release?.('actor acknowledged source')
    await saving

    const call = sendSpy.mock.calls.find((call) => call[0] === 'mt::response-file-save')
    expect(call?.[MARKDOWN_ARG]).toBe('actor acknowledged source')
  })

  it('uses the same Core save barrier for Save As', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'poisoned Pinia snapshot' })
    detachCoreAuthority = coreDocumentSaveAuthority.register('tab-1', async() => ({
      documentId: 'tab-1',
      identity: { generation: 1, revision: 2 },
      source: 'actor source for Save As'
    }))
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    await store.FILE_SAVE_AS()

    const call = sendSpy.mock.calls.find((call) => call[0] === 'mt::response-file-save-as')
    expect(call?.[MARKDOWN_ARG]).toBe('actor source for Save As')
  })

  it('buffers acknowledged Core bytes instead of the stale recovery snapshot', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'poisoned recovery snapshot' })
    store.tabs = [store.currentFile!]
    store.updateTabIdToIndex()
    let release: ((source: string) => void) | undefined
    detachCoreAuthority = coreDocumentSaveAuthority.register(
      'tab-1',
      () =>
        new Promise((resolve) => {
          release = (source) =>
            resolve({
              documentId: 'tab-1',
              identity: { generation: 1, revision: 2 },
              source
            })
        })
    )
    const invokeSpy = vi.spyOn(window.electron.ipcRenderer, 'invoke').mockResolvedValue(true)

    const buffering = sendBufferedState()
    expect(invokeSpy).not.toHaveBeenCalled()
    release?.('actor recovery checkpoint')
    await buffering

    expect(invokeSpy).toHaveBeenCalledWith(
      'update-buffer-state',
      expect.objectContaining({
        tabs: [expect.objectContaining({ id: 'tab-1', markdown: 'actor recovery checkpoint' })]
      })
    )
  })

  it('buffers the live dirty state when Core acknowledges during its source barrier', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      markdown: 'poisoned recovery snapshot',
      isSaved: true
    })
    store.tabs = [store.currentFile!]
    store.updateTabIdToIndex()
    let release: ((source: string) => void) | undefined
    detachCoreAuthority = coreDocumentSaveAuthority.register(
      'tab-1',
      () =>
        new Promise((resolve) => {
          release = (source) =>
            resolve({
              documentId: 'tab-1',
              identity: { generation: 1, revision: 2 },
              source
            })
        })
    )
    const invokeSpy = vi.spyOn(window.electron.ipcRenderer, 'invoke').mockResolvedValue(true)

    const buffering = sendBufferedState()
    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1', { generation: 1, revision: 2 })
    release?.('actor recovery checkpoint')
    await buffering

    expect(invokeSpy).toHaveBeenCalledWith(
      'update-buffer-state',
      expect.objectContaining({
        tabs: [
          expect.objectContaining({
            id: 'tab-1',
            markdown: 'actor recovery checkpoint',
            isSaved: false
          })
        ]
      })
    )
  })

  it.each(['rejects', 'returns false'])(
    'does not close the window when the authoritative recovery checkpoint %s',
    async(failure) => {
      const store = useEditorStore()
      seedCurrentFile(store, { markdown: 'poisoned recovery snapshot' })
      store.tabs = [store.currentFile!]
      store.updateTabIdToIndex()
      detachCoreAuthority = coreDocumentSaveAuthority.register('tab-1', async() => ({
        documentId: 'tab-1',
        identity: { generation: 1, revision: 2 },
        source: 'actor recovery checkpoint'
      }))
      const persist = vi.spyOn(window.electron.ipcRenderer, 'invoke')
      if (failure === 'rejects') persist.mockRejectedValue(new Error('recovery persistence failed'))
      else persist.mockResolvedValue(false)
      const onSpy = vi.spyOn(window.electron.ipcRenderer, 'on')
      const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')
      store.LISTEN_FOR_CLOSE()
      const listener = onSpy.mock.calls.find((call) => call[0] === 'mt::ask-for-close')?.[1] as
        | (() => void)
        | undefined

      listener?.()
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(
        sendSpy.mock.calls.some(
          (call) => call[0] === 'mt::close-window' || call[0] === 'mt::close-window-confirm'
        )
      ).toBe(false)
    }
  )

  it.each([1, 2])(
    'persists input during %s consecutive writes before authorizing window destruction',
    async(lateWrites) => {
      const store = useEditorStore()
      seedCurrentFile(store, { markdown: 'stale view snapshot' })
      store.tabs = [store.currentFile!]
      store.updateTabIdToIndex()
      usePreferencesStore().startUpAction = 'restoreAll'
      const manager = createCoreDocumentSessionManager({
        createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
      })
      manager.open({ documentId: 'tab-1', source: 'seed\n', lineEnding: '\n' })
      const lease = manager.lease('tab-1')
      detachCoreAuthority = coreDocumentSaveAuthority.register(
        'tab-1',
        () => manager.saveBarrier('tab-1'),
        (identity) => manager.isSaveSnapshotCurrent('tab-1', identity)
      )

      let enteredPersistence!: () => void
      const persistenceStarted = new Promise<void>((resolve) => {
        enteredPersistence = resolve
      })
      let releasePersistence!: () => void
      const firstPersistence = new Promise<void>((resolve) => {
        releasePersistence = resolve
      })
      let didClose!: () => void
      const closed = new Promise<void>((resolve) => {
        didClose = resolve
      })
      let persistedSource: string | undefined
      let sourceAtClose: string | undefined
      let writes = 0
      const invokeSpy = vi
        .spyOn(window.electron.ipcRenderer, 'invoke')
        .mockImplementation(async(channel, ...args) => {
          if (channel !== 'update-buffer-state') throw new Error(`Unexpected IPC ${channel}`)
          const snapshot = args[0] as { tabs: Array<{ id: string; markdown: string }> }
          const submittedSource = snapshot.tabs.find((tab) => tab.id === 'tab-1')?.markdown
          if (++writes === 2 && lateWrites === 2) {
            const accepted = lease.binding.submit({
              edits: [{ start: 9, end: 9, insert: ' again' }],
              projections: []
            })
            expect(accepted.acknowledged).toMatchObject({ type: 'applied', revision: 3 })
          }
          if (writes === 1) {
            enteredPersistence()
            await firstPersistence
          }
          persistedSource = submittedSource
          return true
        })
      const sendSpy = vi
        .spyOn(window.electron.ipcRenderer, 'send')
        .mockImplementation((...args) => {
          const [channel] = args
          if (channel === 'mt::close-window') {
            sourceAtClose = persistedSource
            didClose()
          }
        })
      const onSpy = vi.spyOn(window.electron.ipcRenderer, 'on')
      store.LISTEN_FOR_CLOSE()
      const listener = onSpy.mock.calls.find((call) => call[0] === 'mt::ask-for-close')?.[1] as
        | (() => void)
        | undefined
      if (listener === undefined) throw new Error('Missing production window close listener')
      try {
        listener()
        await persistenceStarted
        expect(invokeSpy).toHaveBeenCalledWith(
          'update-buffer-state',
          expect.objectContaining({
            tabs: [expect.objectContaining({ id: 'tab-1', markdown: 'seed\n' })]
          })
        )
        // The real model still admits this input while the first durable buffer
        // checkpoint is in flight. Quit must preserve its accepted result too.
        const accepted = lease.binding.submit({
          edits: [{ start: 4, end: 4, insert: ' late' }],
          projections: []
        })
        expect(accepted.acknowledged).toMatchObject({ type: 'applied', revision: 2 })
        releasePersistence()
        await closed
        expect(sourceAtClose).toBe(lateWrites === 1 ? 'seed late\n' : 'seed late again\n')
        expect(sendSpy).not.toHaveBeenCalledWith('mt::close-window-confirm', expect.anything())
      } finally {
        releasePersistence()
        invokeSpy.mockRestore()
        sendSpy.mockRestore()
        onSpy.mockRestore()
        detachCoreAuthority?.()
        detachCoreAuthority = undefined
        await manager.handoff(lease)
        await manager.close('tab-1')
      }
    }
  )

  it.each(['accepted input', 'pending view work', 'deferred native delivery'] as const)(
    'rechecks %s in an earlier tab while another tab holds the final quit barrier',
    async(scenario) => {
      const store = useEditorStore()
      seedCurrentFile(store)
      store.tabs = [store.currentFile!, { ...store.currentFile!, id: 'tab-2', filename: 'two.md' }]
      store.updateTabIdToIndex()
      usePreferencesStore().startUpAction = 'restoreAll'
      const manager = createCoreDocumentSessionManager({
        createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
      })
      manager.open({ documentId: 'tab-1', source: 'one\n', lineEnding: '\n' })
      manager.open({ documentId: 'tab-2', source: 'two\n', lineEnding: '\n' })
      const leases = ['tab-1', 'tab-2'].map((id) => manager.lease(id))
      let releaseSecond!: () => void
      const heldSecond = new Promise<void>((resolve) => {
        releaseSecond = resolve
      })
      let firstSettled!: () => void
      const settledFirst = new Promise<void>((resolve) => {
        firstSettled = resolve
      })
      let pendingViewWork = false
      const acceptLateInput = () => {
        const accepted = leases[0]!.binding.submit({
          edits: [{ start: 3, end: 3, insert: ' late' }],
          projections: []
        })
        expect(accepted.acknowledged).toMatchObject({ type: 'applied', revision: 2 })
      }
      leases[0]!.settleView(
        async() => {
          if (!pendingViewWork) return
          pendingViewWork = false
          acceptLateInput()
        },
        () => {
          if (pendingViewWork && scenario === 'deferred native delivery') {
            pendingViewWork = false
            acceptLateInput()
          }
          return !pendingViewWork
        }
      )
      const calls = [0, 0]
      const unregister = leases.map((lease, index) =>
        coreDocumentSaveAuthority.register(
          lease.documentId,
          async() => {
            const call = ++calls[index]!
            const snapshot = await manager.saveBarrier(lease.documentId)
            if (call === 2) {
              if (index === 0) firstSettled()
              else await heldSecond
            }
            return snapshot
          },
          (identity) => manager.isSaveSnapshotCurrent(lease.documentId, identity)
        )
      )
      let persisted: string[] = []
      let atClose: string[] = []
      let closed!: () => void
      const didClose = new Promise<void>((resolve) => {
        closed = resolve
      })
      const invoke = vi
        .spyOn(window.electron.ipcRenderer, 'invoke')
        .mockImplementation(async(channel, ...args) => {
          if (channel !== 'update-buffer-state') throw new Error(`Unexpected IPC ${channel}`)
          persisted = (args[0] as { tabs: Array<{ markdown: string }> }).tabs.map(
            (tab) => tab.markdown
          )
          return true
        })
      const send = vi.spyOn(window.electron.ipcRenderer, 'send').mockImplementation((...args) => {
        const [channel] = args
        if (channel === 'mt::close-window') {
          atClose = persisted
          closed()
        }
      })
      const on = vi.spyOn(window.electron.ipcRenderer, 'on')
      store.LISTEN_FOR_CLOSE()
      const listener = on.mock.calls.find(
        (call) => call[0] === 'mt::ask-for-close'
      )?.[1] as () => void
      try {
        listener()
        await settledFirst
        if (scenario === 'accepted input') acceptLateInput()
        else pendingViewWork = true
        releaseSecond()
        await didClose
        expect(atClose).toEqual(['one late\n', 'two\n'])
      } finally {
        releaseSecond()
        invoke.mockRestore()
        send.mockRestore()
        on.mockRestore()
        unregister.forEach((detach) => detach())
        for (const lease of leases) {
          await manager.handoff(lease)
          await manager.close(lease.documentId)
        }
      }
    }
  )

  it('uses acknowledged Core sources for save-all without publishing stale tab snapshots', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'poisoned Pinia snapshot' })
    store.tabs = [store.currentFile!]
    let release: ((source: string) => void) | undefined
    detachCoreAuthority = coreDocumentSaveAuthority.register(
      'tab-1',
      () =>
        new Promise((resolve) => {
          release = (source) =>
            resolve({
              documentId: 'tab-1',
              identity: { generation: 1, revision: 2 },
              source
            })
        })
    )
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    const saving = store.ASK_FOR_SAVE_ALL(false)
    expect(sendSpy.mock.calls.some((call) => call[0] === 'mt::save-tabs')).toBe(false)

    release?.('actor source for save-all')
    await saving

    const call = sendSpy.mock.calls.find((call) => call[0] === 'mt::save-tabs')
    expect(call?.[1]).toEqual([
      expect.objectContaining({ id: 'tab-1', markdown: 'actor source for save-all' })
    ])
  })

  it('drains Core before Save All classifies and closes a seemingly-saved tab', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'poisoned Pinia snapshot', isSaved: true })
    store.tabs = [store.currentFile!]
    store.updateTabIdToIndex()
    let barrierCalls = 0
    let release: ((source: string) => void) | undefined
    detachCoreAuthority = coreDocumentSaveAuthority.register('tab-1', () => {
      barrierCalls += 1
      return new Promise((resolve) => {
        release = (source) =>
          resolve({
            documentId: 'tab-1',
            identity: { generation: 1, revision: 2 },
            source
          })
      })
    })
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    const savingAndClosing = store.ASK_FOR_SAVE_ALL(true)

    expect(barrierCalls).toBe(1)
    expect(store.tabs.map((tab) => tab.id)).toEqual(['tab-1'])
    expect(
      sendSpy.mock.calls.some(
        (call) => call[0] === 'mt::save-tabs' || call[0] === 'mt::save-and-close-tabs'
      )
    ).toBe(false)

    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1', { generation: 1, revision: 2 })
    release?.('actor source accepted before Save All')
    await savingAndClosing

    expect(store.tabs.map((tab) => tab.id)).toEqual(['tab-1'])
    expect(sendSpy.mock.calls.find((call) => call[0] === 'mt::save-and-close-tabs')?.[1]).toEqual([
      expect.objectContaining({
        id: 'tab-1',
        markdown: 'actor source accepted before Save All',
        saveIdentity: { generation: 1, revision: 2 }
      })
    ])
  })

  it('keeps legacy Save All synchronous when no Core authority is registered', () => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'legacy tab source' })
    store.tabs = [store.currentFile!]
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    const result = store.ASK_FOR_SAVE_ALL(false)

    expect(result).toBeUndefined()
    expect(sendSpy.mock.calls.find((call) => call[0] === 'mt::save-tabs')?.[1]).toEqual([
      expect.objectContaining({
        id: 'tab-1',
        markdown: 'legacy tab source'
      })
    ])
  })

  it('uses acknowledged Core source when saving and closing one unsaved tab', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'poisoned Pinia snapshot' })
    detachCoreAuthority = coreDocumentSaveAuthority.register('tab-1', async() => ({
      documentId: 'tab-1',
      identity: { generation: 1, revision: 2 },
      source: 'actor source for close'
    }))
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    await store.CLOSE_UNSAVED_TAB(store.currentFile!)

    const call = sendSpy.mock.calls.find((call) => call[0] === 'mt::save-and-close-tabs')
    expect(call?.[1]).toEqual([
      expect.objectContaining({ id: 'tab-1', markdown: 'actor source for close' })
    ])
  })

  it('drains Core before classifying a just-edited tab for close', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'poisoned Pinia snapshot', isSaved: true })
    store.tabs = [store.currentFile!]
    store.updateTabIdToIndex()
    let release: ((source: string) => void) | undefined
    detachCoreAuthority = coreDocumentSaveAuthority.register(
      'tab-1',
      () =>
        new Promise((resolve) => {
          release = (source) =>
            resolve({
              documentId: 'tab-1',
              identity: { generation: 1, revision: 2 },
              source
            })
        })
    )
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    const closing = store.CLOSE_TAB(store.currentFile)
    expect(store.tabs).toHaveLength(1)
    expect(sendSpy.mock.calls.some((call) => call[0] === 'mt::save-and-close-tabs')).toBe(false)

    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1', { generation: 1, revision: 2 })
    release?.('actor source accepted before close')
    await closing

    expect(store.tabs).toHaveLength(1)
    expect(sendSpy.mock.calls.find((call) => call[0] === 'mt::save-and-close-tabs')?.[1]).toEqual([
      expect.objectContaining({
        id: 'tab-1',
        markdown: 'actor source accepted before close',
        saveIdentity: { generation: 1, revision: 2 }
      })
    ])
  })

  it('keeps an aggregate close-all atomic when one Core barrier rejects', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, { id: 'legacy-tab', isSaved: true })
    const legacyTab = store.currentFile!
    const coreTab = {
      ...legacyTab,
      id: 'core-tab',
      filename: 'core.md',
      pathname: '/tmp/core.md',
      markdown: 'poisoned Core snapshot'
    }
    store.tabs = [legacyTab, coreTab]
    store.currentFile = legacyTab
    store.updateTabIdToIndex()
    let rejectBarrier: ((error: Error) => void) | undefined
    detachCoreAuthority = coreDocumentSaveAuthority.register(
      'core-tab',
      () =>
        new Promise((_resolve, reject) => {
          rejectBarrier = reject
        })
    )
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    const closing = store.CLOSE_ALL_TABS()

    expect(store.tabs.map((tab) => tab.id)).toEqual(['legacy-tab', 'core-tab'])
    expect(closing).toBeInstanceOf(Promise)
    expect(sendSpy.mock.calls.some((call) => call[0] === 'mt::save-and-close-tabs')).toBe(false)

    rejectBarrier?.(new Error('Core close barrier failed'))
    await expect(closing).rejects.toThrow(/Core close barrier failed/)

    expect(store.tabs.map((tab) => tab.id)).toEqual(['legacy-tab', 'core-tab'])
    expect(sendSpy.mock.calls.some((call) => call[0] === 'mt::save-and-close-tabs')).toBe(false)
  })

  it('drains every Core target before close-others commits one aggregate result', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, { id: 'kept-tab', isSaved: true })
    const keptTab = store.currentFile!
    const legacyTab = {
      ...keptTab,
      id: 'legacy-tab',
      filename: 'legacy.md',
      pathname: '/tmp/legacy.md'
    }
    const firstCoreTab = {
      ...keptTab,
      id: 'core-a',
      filename: 'a.md',
      pathname: '/tmp/a.md',
      markdown: 'poisoned A snapshot'
    }
    const secondCoreTab = {
      ...keptTab,
      id: 'core-b',
      filename: 'b.md',
      pathname: '/tmp/b.md',
      markdown: 'poisoned B snapshot'
    }
    store.tabs = [keptTab, legacyTab, firstCoreTab, secondCoreTab]
    store.currentFile = keptTab
    store.updateTabIdToIndex()
    let releaseFirst: (() => void) | undefined
    let releaseSecond: (() => void) | undefined
    const detachFirst = coreDocumentSaveAuthority.register(
      'core-a',
      () =>
        new Promise((resolve) => {
          releaseFirst = () =>
            resolve({
              documentId: 'core-a',
              identity: { generation: 1, revision: 2 },
              source: 'actor source A'
            })
        })
    )
    const detachSecond = coreDocumentSaveAuthority.register(
      'core-b',
      () =>
        new Promise((resolve) => {
          releaseSecond = () =>
            resolve({
              documentId: 'core-b',
              identity: { generation: 1, revision: 3 },
              source: 'actor source B'
            })
        })
    )
    detachCoreAuthority = () => {
      detachFirst()
      detachSecond()
    }
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    const closing = store.CLOSE_OTHER_TABS(keptTab)

    expect(store.tabs.map((tab) => tab.id)).toEqual(['kept-tab', 'legacy-tab', 'core-a', 'core-b'])
    expect(closing).toBeInstanceOf(Promise)
    store.LISTEN_FOR_CORE_CONTENT_CHANGE('core-a', { generation: 1, revision: 2 })
    store.LISTEN_FOR_CORE_CONTENT_CHANGE('core-b', { generation: 1, revision: 3 })
    releaseSecond?.()
    await Promise.resolve()
    expect(store.tabs.map((tab) => tab.id)).toContain('legacy-tab')
    expect(sendSpy.mock.calls.some((call) => call[0] === 'mt::save-and-close-tabs')).toBe(false)

    releaseFirst?.()
    await closing

    expect(store.tabs.map((tab) => tab.id)).toEqual(['kept-tab', 'core-a', 'core-b'])
    expect(sendSpy.mock.calls.find((call) => call[0] === 'mt::save-and-close-tabs')?.[1]).toEqual([
      expect.objectContaining({
        id: 'core-a',
        markdown: 'actor source A',
        saveIdentity: { generation: 1, revision: 2 }
      }),
      expect.objectContaining({
        id: 'core-b',
        markdown: 'actor source B',
        saveIdentity: { generation: 1, revision: 3 }
      })
    ])
  })

  it('reclassifies a pending Core edit before close-saved mutates any tab', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, { id: 'legacy-tab', isSaved: true })
    const legacyTab = store.currentFile!
    const coreTab = {
      ...legacyTab,
      id: 'core-tab',
      filename: 'core.md',
      pathname: '/tmp/core.md',
      markdown: 'poisoned Core snapshot'
    }
    store.tabs = [legacyTab, coreTab]
    store.currentFile = legacyTab
    store.updateTabIdToIndex()
    let release: (() => void) | undefined
    detachCoreAuthority = coreDocumentSaveAuthority.register(
      'core-tab',
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              documentId: 'core-tab',
              identity: { generation: 1, revision: 2 },
              source: 'actor pending edit'
            })
        })
    )
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    const closing = store.CLOSE_SAVED_TABS()

    expect(store.tabs.map((tab) => tab.id)).toEqual(['legacy-tab', 'core-tab'])
    expect(closing).toBeInstanceOf(Promise)
    store.LISTEN_FOR_CORE_CONTENT_CHANGE('core-tab', { generation: 1, revision: 2 })
    release?.()
    await closing

    expect(store.tabs.map((tab) => tab.id)).toEqual(['core-tab'])
    expect(sendSpy.mock.calls.some((call) => call[0] === 'mt::save-and-close-tabs')).toBe(false)
  })

  it.each([
    {
      command: 'close others',
      keptIsSaved: true,
      invoke: (store: ReturnType<typeof useEditorStore>, kept: typeof store.currentFile) =>
        store.CLOSE_OTHER_TABS(kept!),
      remaining: ['kept-tab']
    },
    {
      command: 'close saved',
      keptIsSaved: false,
      invoke: (store: ReturnType<typeof useEditorStore>) => store.CLOSE_SAVED_TABS(),
      remaining: ['kept-tab']
    },
    {
      command: 'close all',
      keptIsSaved: true,
      invoke: (store: ReturnType<typeof useEditorStore>) => store.CLOSE_ALL_TABS(),
      remaining: []
    }
  ])(
    'keeps legacy $command synchronous without Core authority',
    ({ keptIsSaved, invoke, remaining }) => {
      setActivePinia(createPinia())
      const store = useEditorStore()
      seedCurrentFile(store, { id: 'kept-tab', isSaved: keptIsSaved })
      const keptTab = store.currentFile!
      const closedTab = {
        ...keptTab,
        id: 'closed-tab',
        filename: 'closed.md',
        pathname: '/tmp/closed.md',
        isSaved: true
      }
      store.tabs = [keptTab, closedTab]
      store.currentFile = keptTab
      store.updateTabIdToIndex()

      const result = invoke(store, keptTab)

      expect(result).toBeUndefined()
      expect(store.tabs.map((tab) => tab.id)).toEqual(remaining)
    }
  )

  it('drains Core before replacing an apparently clean untitled tab', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      markdown: '',
      pathname: '',
      filename: 'Untitled-1',
      isSaved: true
    })
    store.tabs = [store.currentFile!]
    store.updateTabIdToIndex()
    let release!: () => void
    detachCoreAuthority = coreDocumentSaveAuthority.register(
      'tab-1',
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              documentId: 'tab-1',
              identity: { generation: 1, revision: 2 },
              source: 'pending untitled edit'
            })
        })
    )

    const opening = store.NEW_TAB_WITH_CONTENT({
      markdownDocument: {
        markdown: 'opened file',
        filename: 'opened.md',
        pathname: '/tmp/opened.md'
      },
      selected: true
    })
    expect(store.tabs.map((tab) => tab.id)).toEqual(['tab-1'])

    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1', { generation: 1, revision: 2 })
    release()
    await opening

    expect(store.tabs).toHaveLength(2)
    expect(store.tabs.find((tab) => tab.id === 'tab-1')?.isSaved).toBe(false)
    expect(store.currentFile?.pathname).toBe('/tmp/opened.md')
  })

  it('handles a rejected Core barrier through the installed open-tab listener', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      markdown: '',
      pathname: '',
      filename: 'Untitled-1',
      isSaved: true
    })
    store.tabs = [store.currentFile!]
    store.updateTabIdToIndex()
    let rejectBarrier!: (error: Error) => void
    detachCoreAuthority = coreDocumentSaveAuthority.register(
      'tab-1',
      () =>
        new Promise((_resolve, reject) => {
          rejectBarrier = reject
        })
    )
    const onSpy = vi.spyOn(window.electron.ipcRenderer, 'on')
    store.LISTEN_FOR_NEW_TAB()
    const listener = onSpy.mock.calls.find((call) => call[0] === 'mt::open-new-tab')?.[1] as
      | ((
        event: unknown,
        document: unknown,
        options: unknown,
        selected: boolean
      ) => void | Promise<void>)
      | undefined
    if (listener === undefined) throw new Error('Open-tab listener was not installed')

    const opening = listener(
      {},
      {
        markdown: 'opened file',
        filename: 'opened.md',
        pathname: '/tmp/opened.md'
      },
      {},
      true
    )
    expect(opening).toBeInstanceOf(Promise)
    rejectBarrier(new Error('Core document requires reconciliation'))
    await expect(opening).resolves.toBeUndefined()

    expect(console.error).toHaveBeenCalledWith(
      'Core document save barrier failed',
      expect.objectContaining({ message: 'Core document requires reconciliation' })
    )
    expect(store.tabs.map((tab) => tab.id)).toEqual(['tab-1'])
    expect(store.currentFile?.id).toBe('tab-1')
  })

  it('uses acknowledged Core source when an untitled tab is moved or renamed', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, { pathname: '', markdown: 'poisoned Pinia snapshot' })
    detachCoreAuthority = coreDocumentSaveAuthority.register('tab-1', async() => ({
      documentId: 'tab-1',
      identity: { generation: 1, revision: 2 },
      source: 'actor source for untitled save'
    }))
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    await store.MOVE_FILE_TO()
    await store.RESPONSE_FOR_RENAME()

    const calls = sendSpy.mock.calls.filter((call) => call[0] === 'mt::response-file-save')
    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call[MARKDOWN_ARG])).toEqual([
      'actor source for untitled save',
      'actor source for untitled save'
    ])
  })

  it('blocks persistence when the Core save barrier rejects', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'pending draft' })
    detachCoreAuthority = coreDocumentSaveAuthority.register('tab-1', () =>
      Promise.reject(new Error('Core document requires reconciliation'))
    )
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    await expect(store.FILE_SAVE()).rejects.toThrow(/requires reconciliation/)
    expect(sendSpy.mock.calls.some((call) => call[0] === 'mt::response-file-save')).toBe(false)
  })

  it('handles a Core save failure from the installed menu listener', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'pending draft' })
    detachCoreAuthority = coreDocumentSaveAuthority.register('tab-1', () =>
      Promise.reject(new Error('Core save failed'))
    )
    store.LISTEN_FOR_SAVE()
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    bus.emit('mt::editor-ask-file-save')
    await Promise.resolve()

    expect(sendSpy.mock.calls.some((call) => call[0] === 'mt::response-file-save')).toBe(false)
    expect(store.currentFile?.isSaved).toBe(false)
  })

  it('marks an acknowledged Core edit dirty without copying source into Pinia', () => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'unchanged Pinia checkpoint', isSaved: true })

    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1')

    expect(store.currentFile?.isSaved).toBe(false)
    expect(store.currentFile?.markdown).toBe('unchanged Pinia checkpoint')
  })

  it('clears Core dirty state when an authoritative undo restores the opened source', () => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'saved\n', isSaved: true })
    store.REGISTER_CORE_SAVE_IDENTITY('tab-1', { generation: 70, revision: 1 })
    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1', { generation: 70, revision: 2 })
    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1', { generation: 70, revision: 3 })
    store.RECONCILE_CORE_SAVED_SOURCE('tab-1', { generation: 70, revision: 3 }, 'saved\n')
    expect(store.currentFile?.isSaved).toBe(true)
    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1', { generation: 70, revision: 4 })
    store.RECONCILE_CORE_SAVED_SOURCE('tab-1', { generation: 70, revision: 3 }, 'saved\n')
    expect(store.currentFile?.isSaved).toBe(false)
    store.RECONCILE_CORE_SAVED_SOURCE('tab-1', { generation: 70, revision: 4 }, 'divergent\n')
    expect(store.currentFile?.isSaved).toBe(false)
  })

  it('uses acknowledged disk source as the undo baseline without cleaning a newer revision', () => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'opened\n', isSaved: true })
    store.tabs = [store.currentFile!]
    store.REGISTER_CORE_SAVE_IDENTITY('tab-1', { generation: 71, revision: 1 })
    const onSpy = vi.spyOn(window.electron.ipcRenderer, 'on')
    store.LISTEN_FOR_SET_PATHNAME()
    const saved = onSpy.mock.calls.find((call) => call[0] === 'mt::tab-saved')?.[1] as unknown as (
      event: unknown,
      id: string,
      identity: { generation: number; revision: number },
      source: string
    ) => void
    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1', { generation: 71, revision: 3 })
    saved({}, 'tab-1', { generation: 71, revision: 2 }, 'saved edit\n')
    expect(store.currentFile?.isSaved).toBe(false)
    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1', { generation: 71, revision: 4 })
    store.RECONCILE_CORE_SAVED_SOURCE('tab-1', { generation: 71, revision: 4 }, 'saved edit\n')
    expect(store.currentFile?.isSaved).toBe(true)
    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1', { generation: 71, revision: 5 })
    store.RECONCILE_CORE_SAVED_SOURCE('tab-1', { generation: 71, revision: 5 }, 'opened\n')
    expect(store.currentFile?.isSaved).toBe(false)
  })

  it('does not let an older Core disk acknowledgement mark a newer revision clean', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'stale Pinia source', isSaved: true })
    store.tabs = [store.currentFile!]
    store.updateTabIdToIndex()
    const onSpy = vi.spyOn(window.electron.ipcRenderer, 'on')
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')
    store.LISTEN_FOR_SET_PATHNAME()
    const saved = onSpy.mock.calls.find((call) => call[0] === 'mt::tab-saved')?.[1] as
      | ((
        event: unknown,
        id: string,
        identity?: {
          generation: number
          revision: number
        }
      ) => void)
      | undefined
    detachCoreAuthority = coreDocumentSaveAuthority.register('tab-1', async() => ({
      documentId: 'tab-1',
      identity: { generation: 1, revision: 2 },
      source: 'actor revision two'
    }))

    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1', { generation: 1, revision: 2 })
    await store.FILE_SAVE()
    const request = sendSpy.mock.calls.find((call) => call[0] === 'mt::response-file-save')
    expect(request?.at(-1)).toEqual({ generation: 1, revision: 2 })

    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1', { generation: 1, revision: 3 })
    saved?.({}, 'tab-1', { generation: 1, revision: 2 })
    expect(store.currentFile?.isSaved).toBe(false)
  })

  it('does not let an old Core generation with the same revision clean a replacement', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      id: 'generation-collision-tab',
      markdown: 'replacement generation bytes',
      isSaved: true,
      history: { stack: [], lastEditIndex: -1, lastInitIndex: -1 }
    })
    store.tabs = [store.currentFile!]
    store.updateTabIdToIndex()
    const onSpy = vi.spyOn(window.electron.ipcRenderer, 'on')
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')
    store.LISTEN_FOR_SET_PATHNAME()
    const saved = onSpy.mock.calls.find((call) => call[0] === 'mt::tab-saved')?.[1] as
      | ((
        event: unknown,
        id: string,
        identity?: {
          generation: number
          revision: number
        }
      ) => void)
      | undefined

    store.LISTEN_FOR_CORE_CONTENT_CHANGE('generation-collision-tab', {
      generation: 41,
      revision: 2
    })
    detachCoreAuthority = coreDocumentSaveAuthority.register(
      'generation-collision-tab',
      async() => ({
        documentId: 'generation-collision-tab',
        identity: { generation: 41, revision: 2 },
        source: 'old generation bytes'
      })
    )
    await store.FILE_SAVE()
    expect(sendSpy.mock.calls.find((call) => call[0] === 'mt::response-file-save')?.at(-1)).toEqual(
      { generation: 41, revision: 2 }
    )

    store.REGISTER_CORE_SAVE_IDENTITY('generation-collision-tab', { generation: 42, revision: 2 })
    expect(store.currentFile?.isSaved).toBe(false)

    saved?.({}, 'generation-collision-tab', { generation: 41, revision: 2 })
    expect(store.currentFile?.isSaved).toBe(false)
    store.CLOSE_TABS([
      {
        id: 'generation-collision-tab',
        saveIdentity: { generation: 41, revision: 2 }
      }
    ])
    expect(store.tabs.map((tab) => tab.id)).toEqual(['generation-collision-tab'])

    saved?.({}, 'generation-collision-tab', { generation: 42, revision: 2 })
    expect(store.currentFile?.isSaved).toBe(true)
    store.CLOSE_TABS([
      {
        id: 'generation-collision-tab',
        saveIdentity: { generation: 42, revision: 2 }
      }
    ])
    expect(store.tabs).toEqual([])
  })

  it('keeps save identity across Core handoff so a late acknowledgement cannot clean newer WYSIWYG content', async() => {
    const store = useEditorStore()
    seedCurrentFile(store, {
      markdown: 'stale projection',
      isSaved: true,
      history: { stack: [], lastEditIndex: -1, lastInitIndex: -1 },
      lastSavedHistoryId: -1
    })
    store.tabs = [store.currentFile!]
    store.updateTabIdToIndex()
    const onSpy = vi.spyOn(window.electron.ipcRenderer, 'on')
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')
    store.LISTEN_FOR_SET_PATHNAME()
    const saved = onSpy.mock.calls.find((call) => call[0] === 'mt::tab-saved')?.[1] as
      | ((
        event: unknown,
        id: string,
        identity?: {
          generation: number
          revision: number
        }
      ) => void)
      | undefined
    detachCoreAuthority = coreDocumentSaveAuthority.register('tab-1', async() => ({
      documentId: 'tab-1',
      identity: { generation: 1, revision: 2 },
      source: 'actor revision two'
    }))

    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1', { generation: 1, revision: 2 })
    await store.FILE_SAVE()
    store.RECONCILE_CORE_SOURCE_AT_HANDOFF('tab-1', 'actor revision two')
    detachCoreAuthority()
    detachCoreAuthority = undefined
    store.LISTEN_FOR_CONTENT_CHANGE({
      id: 'tab-1',
      markdown: 'newer WYSIWYG content'
    })

    saved?.({}, 'tab-1', { generation: 1, revision: 2 })
    expect(store.currentFile?.markdown).toBe('newer WYSIWYG content')
    expect(store.currentFile?.isSaved).toBe(false)

    store.FILE_SAVE()
    const laterSave = sendSpy.mock.calls
      .filter((call) => call[0] === 'mt::response-file-save')
      .at(-1)
    expect(laterSave?.at(-1)).toEqual({ generation: 1, revision: 3 })
    saved?.({}, 'tab-1', { generation: 1, revision: 3 })
    expect(store.currentFile?.isSaved).toBe(true)
  })

  it('does not force-close a newer Core revision after saving an older one', () => {
    const store = useEditorStore()
    seedCurrentFile(store, { markdown: 'stale Pinia source', isSaved: false })
    store.tabs = [store.currentFile!]
    store.updateTabIdToIndex()
    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1', { generation: 1, revision: 3 })

    store.CLOSE_TABS([
      {
        id: 'tab-1',
        saveIdentity: { generation: 1, revision: 2 }
      }
    ])

    expect(store.tabs.map((tab) => tab.id)).toEqual(['tab-1'])
    expect(store.currentFile?.isSaved).toBe(false)

    store.CLOSE_TABS([
      {
        id: 'tab-1',
        saveIdentity: { generation: 1, revision: 3 }
      }
    ])
    expect(store.tabs).toEqual([])
  })

  it('autosaves an acknowledged Core edit from the actor barrier', async() => {
    vi.useFakeTimers()
    const store = useEditorStore()
    const preferences = usePreferencesStore()
    preferences.autoSave = true
    preferences.autoSaveDelay = 25
    seedCurrentFile(store, { markdown: 'stale Pinia source', isSaved: true })
    detachCoreAuthority = coreDocumentSaveAuthority.register('tab-1', async() => ({
      documentId: 'tab-1',
      identity: { generation: 1, revision: 2 },
      source: 'actor autosave source'
    }))
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.LISTEN_FOR_CORE_CONTENT_CHANGE('tab-1')
    await vi.advanceTimersByTimeAsync(25)

    const call = sendSpy.mock.calls.find((call) => call[0] === 'mt::response-file-save')
    expect(call?.[MARKDOWN_ARG]).toBe('actor autosave source')
  })

  it('fails over legacy autosave callers to the registered Core authority', async() => {
    vi.useFakeTimers()
    const store = useEditorStore()
    const preferences = usePreferencesStore()
    preferences.autoSaveDelay = 25
    seedCurrentFile(store, { markdown: 'poisoned legacy autosave source', isSaved: false })
    store.tabs = [store.currentFile!]
    detachCoreAuthority = coreDocumentSaveAuthority.register('tab-1', async() => ({
      documentId: 'tab-1',
      identity: { generation: 1, revision: 2 },
      source: 'actor source for legacy autosave caller'
    }))
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.HANDLE_AUTO_SAVE({
      id: 'tab-1',
      filename: 'note.md',
      pathname: '/tmp/note.md',
      markdown: 'poisoned legacy autosave argument',
      options: {
        encoding: { encoding: 'utf8', isBom: false },
        lineEnding: 'lf',
        adjustLineEndingOnSave: false,
        trimTrailingNewline: 2
      }
    })
    await vi.advanceTimersByTimeAsync(25)

    const call = sendSpy.mock.calls.find((call) => call[0] === 'mt::response-file-save')
    expect(call?.[MARKDOWN_ARG]).toBe('actor source for legacy autosave caller')
  })

  it('moves the acknowledged Core source into Pinia only at an authority handoff', () => {
    const store = useEditorStore()
    const cursor = { anchor: { line: 1, ch: 2 }, focus: { line: 1, ch: 2 } }
    seedCurrentFile(store, {
      markdown: 'stale projection',
      isSaved: false,
      muyaIndexCursor: cursor
    })
    const emitSpy = vi.spyOn(bus, 'emit')

    store.RECONCILE_CORE_SOURCE_AT_HANDOFF('tab-1', 'acknowledged source')

    expect(store.currentFile?.markdown).toBe('acknowledged source')
    expect(store.currentFile?.isSaved).toBe(false)
    expect(emitSpy).toHaveBeenCalledWith('file-changed', {
      id: 'tab-1',
      markdown: 'acknowledged source',
      muyaIndexCursor: cursor,
      renderCursor: true
    })
  })

  it('FILE_SAVE_AS sends the flushed markdown, not the stale pre-flush snapshot', () => {
    const store = useEditorStore()
    seedCurrentFile(store)
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.FILE_SAVE_AS()

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save-as')
    expect(call).toBeDefined()
    expect(call?.[MARKDOWN_ARG]).toBe(FLUSHED)
  })

  // MOVE_FILE_TO / RESPONSE_FOR_RENAME only transmit `markdown` in their untitled
  // (no-pathname) branch, which reuses `mt::response-file-save` — that is where
  // the flush actually matters, so assert the payload there too.
  it('MOVE_FILE_TO (untitled) sends the flushed markdown', () => {
    const store = useEditorStore()
    seedCurrentFile(store, { pathname: '' })
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.MOVE_FILE_TO()

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(call).toBeDefined()
    expect(call?.[MARKDOWN_ARG]).toBe(FLUSHED)
  })

  it('RESPONSE_FOR_RENAME (untitled) sends the flushed markdown', () => {
    const store = useEditorStore()
    seedCurrentFile(store, { pathname: '' })
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.RESPONSE_FOR_RENAME()

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(call).toBeDefined()
    expect(call?.[MARKDOWN_ARG]).toBe(FLUSHED)
  })

  // The existing-file rename branch emits 'rename' (no markdown payload); guard
  // that the flush still precedes it so it can't be silently dropped later.
  it('RESPONSE_FOR_RENAME (existing file) flushes before emitting rename', () => {
    const store = useEditorStore()
    seedCurrentFile(store, { pathname: '/tmp/note.md' })
    const emitSpy = vi.spyOn(bus, 'emit')

    store.RESPONSE_FOR_RENAME()

    const flushOrder = emitOrderOf(emitSpy, 'flush-active-editor')
    const renameOrder = emitOrderOf(emitSpy, 'rename')
    expect(flushOrder).toBeDefined()
    expect(renameOrder).toBeDefined()
    expect(flushOrder as number).toBeLessThan(renameOrder as number)
  })
})
