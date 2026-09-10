import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'
import type { UnsavedFile } from '@shared/types/files'
import type { BrowserWindow } from 'electron'
import { isWindowPreparingToClose } from 'main_renderer/windows/prepareClose'

const {
  listeners,
  emit,
  fromWebContents,
  showMessageBox,
  showSaveDialog,
  writeMarkdownFile,
  send
} = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
  emit: vi.fn(),
  fromWebContents: vi.fn(),
  showMessageBox: vi.fn(),
  showSaveDialog: vi.fn(),
  writeMarkdownFile: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', quit: vi.fn() },
  BrowserWindow: { fromWebContents },
  dialog: {
    showMessageBox,
    showOpenDialog: vi.fn(),
    showSaveDialog
  },
  ipcMain: {
    emit,
    removeListener(channel: string, listener: (...args: unknown[]) => unknown) {
      if (listeners.get(channel) === listener) listeners.delete(channel)
    },
    on(channel: string, listener: (...args: unknown[]) => unknown) {
      listeners.set(channel, listener)
    }
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn() }
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

vi.mock('main_renderer/filesystem/markdown', () => ({ writeMarkdownFile }))
vi.mock('main_renderer/menu/actions/marktext', () => ({
  checkUpdates: vi.fn(),
  userSetting: vi.fn()
}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

await import('main_renderer/menu/actions/file')

const win = Object.freeze({
  id: 41,
  webContents: { send, once: vi.fn(), removeListener: vi.fn(), isDestroyed: () => false }
})
const event = Object.freeze({ sender: win.webContents })
const unsavedFile: UnsavedFile = Object.freeze({
  id: 'tab-1',
  filename: 'note.md',
  pathname: '/tmp/note.md',
  markdown: 'acknowledged source',
  options: {
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
    adjustLineEndingOnSave: false,
    trimTrailingNewline: 2
  }
})

let preparedFiles: UnsavedFile[] = []
const listener = (channel: string) => {
  const handler = listeners.get(channel)
  if (handler === undefined) throw new Error('Missing IPC listener: ' + channel)
  return handler
}

describe('mt::close-window-confirm save failure', () => {
  beforeEach(() => {
    emit.mockClear()
    send.mockReset()
    preparedFiles = [unsavedFile]
    send.mockImplementation((channel, requestId) => {
      if (channel === 'mt::prepare-window-close') {
        queueMicrotask(() => {
          listeners.get('mt::window-close-prepared')?.(event, {
            requestId,
            files: preparedFiles,
            requiresConfirmation: true
          })
        })
      }
    })
    fromWebContents.mockReset()
    fromWebContents.mockReturnValue(win)
    showMessageBox.mockReset()
    showMessageBox
      .mockResolvedValueOnce({ response: 0 }) // Save.
      .mockResolvedValueOnce({ response: 1 }) // Keep the window open after failure.
    showSaveDialog.mockReset()
    writeMarkdownFile.mockReset()
    writeMarkdownFile.mockRejectedValue(new Error('disk full'))
  })

  it('keeps the window open when a requested close cannot save every file', async() => {
    const handler = listeners.get('mt::close-window-confirm')
    if (handler === undefined) throw new Error('close-window-confirm handler was not registered')

    await handler(event, [unsavedFile])

    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith('mt::tab-save-failure', 'tab-1', 'disk full')
      expect(showMessageBox).toHaveBeenCalledTimes(2)
    })
    expect(emit).not.toHaveBeenCalledWith('window-close-by-id', win.id)
    expect(send).toHaveBeenCalledWith('mt::cancel-window-close', expect.any(Number))
  })

  it.each([false, true])(
    'keeps the window open when Save As is cancelled, with another saved document: %s',
    async(saveAnother) => {
      vi.useFakeTimers()
      try {
        const handler = listeners.get('mt::close-window-confirm')
        if (handler === undefined) { throw new Error('close-window-confirm handler was not registered') }
        showSaveDialog.mockResolvedValue({ canceled: true })
        writeMarkdownFile.mockResolvedValue(undefined)
        const files = [
          ...(saveAnother
            ? [{ ...unsavedFile, id: 'another-tab', markdown: 'another document' }]
            : []),
          { ...unsavedFile, pathname: '' }
        ]
        preparedFiles = files
        const closing = handler(event, files)
        await vi.runAllTimersAsync()
        await closing
        expect(showSaveDialog).toHaveBeenCalledTimes(1)
        expect(writeMarkdownFile).toHaveBeenCalledTimes(saveAnother ? 1 : 0)
        if (saveAnother) {
          expect(writeMarkdownFile).toHaveBeenCalledWith(
            '/tmp/note.md',
            'another document',
            unsavedFile.options
          )
        }
        expect(emit).not.toHaveBeenCalledWith('window-close-by-id', win.id)
        expect(send).toHaveBeenCalledWith('mt::cancel-window-close', expect.any(Number))
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it('closes after every requested file, including Save As, has saved', async() => {
    vi.useFakeTimers()
    try {
      const handler = listeners.get('mt::close-window-confirm')
      if (handler === undefined) throw new Error('close-window-confirm handler was not registered')
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/new-note.md' })
      writeMarkdownFile.mockResolvedValue(undefined)
      const files = [
        { ...unsavedFile, saveIdentity: { generation: 1, revision: 4 } },
        {
          ...unsavedFile,
          id: 'tab-2',
          pathname: '',
          markdown: 'new document',
          saveIdentity: { generation: 2, revision: 3 }
        }
      ]
      preparedFiles = files
      const closing = handler(event, files)
      await vi.runAllTimersAsync()
      await closing
      expect(writeMarkdownFile).toHaveBeenCalledTimes(2)
      expect(writeMarkdownFile).toHaveBeenCalledWith(
        '/tmp/note.md',
        'acknowledged source',
        unsavedFile.options
      )
      expect(writeMarkdownFile).toHaveBeenCalledWith(
        '/tmp/new-note.md',
        'new document',
        unsavedFile.options
      )
      expect(emit).toHaveBeenCalledWith('window-close-by-id', win.id)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retains the explicit Close choice after a save failure', async() => {
    vi.useFakeTimers()
    try {
      const handler = listeners.get('mt::close-window-confirm')
      if (handler === undefined) throw new Error('close-window-confirm handler was not registered')
      showMessageBox
        .mockReset()
        .mockResolvedValueOnce({ response: 0 }) // Save.
        .mockResolvedValueOnce({ response: 0 }) // Explicitly close despite the save failure.
      const closing = handler(event, [unsavedFile])
      await vi.runAllTimersAsync()
      await closing
      expect(send).toHaveBeenCalledWith('mt::tab-save-failure', 'tab-1', 'disk full')
      expect(showMessageBox).toHaveBeenCalledTimes(2)
      expect(emit).toHaveBeenCalledWith('window-close-by-id', win.id)
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves the current model after accepting input while native confirmation is pending', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
    })
    manager.open({ documentId: 'tab-1', source: 'seed\n', lineEnding: '\n' })
    const lease = manager.lease('tab-1')
    try {
      let confirm!: (answer: { response: number }) => void
      showMessageBox.mockReset().mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            confirm = resolve
          })
      )
      writeMarkdownFile.mockResolvedValue(undefined)
      send.mockImplementation((channel, requestId) => {
        if (channel !== 'mt::prepare-window-close') return
        return manager.saveBarrier('tab-1').then((snapshot) => {
          listeners.get('mt::window-close-prepared')?.(event, {
            requestId,
            requiresConfirmation: true,
            files: [{ ...unsavedFile, markdown: snapshot.source, saveIdentity: snapshot.identity }]
          })
        })
      })
      const snapshot = await manager.saveBarrier('tab-1')
      const closing = listener('mt::close-window-confirm')(event, [
        { ...unsavedFile, markdown: snapshot.source, saveIdentity: snapshot.identity }
      ])
      lease.binding.submit({ edits: [{ start: 4, end: 4, insert: ' late' }], projections: [] })
      confirm({ response: 0 })
      await closing
      await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('window-close-by-id', win.id))
      expect(writeMarkdownFile).toHaveBeenCalledWith(
        '/tmp/note.md',
        'seed late\n',
        unsavedFile.options
      )
    } finally {
      await manager.handoff(lease)
      await manager.close('tab-1')
    }
  })

  it('waits for this window and request before closing without a confirmation dialog', async() => {
    let requestId!: number
    send.mockImplementation((channel, id) => {
      if (channel === 'mt::prepare-window-close') requestId = id
    })
    const closing = listener('mt::close-window')(event)
    expect(emit).not.toHaveBeenCalledWith('window-close-by-id', win.id)
    const reply = listener('mt::window-close-prepared')
    const prepared = { requestId, files: [], requiresConfirmation: false }
    reply({ sender: {} }, prepared)
    reply(event, { ...prepared, requestId: requestId + 1 })
    await Promise.resolve()
    expect(emit).not.toHaveBeenCalledWith('window-close-by-id', win.id)
    reply(event, prepared)
    await closing
    expect(emit).toHaveBeenCalledWith('window-close-by-id', win.id)
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(listeners.has('mt::window-close-prepared')).toBe(false)
  })

  it('keeps the window open and releases preparation when preservation fails', async() => {
    send.mockImplementation((channel, requestId) => {
      if (channel === 'mt::prepare-window-close') {
        queueMicrotask(() => {
          listeners.get('mt::window-close-prepared')?.(event, {
            requestId,
            error: 'backup disk full'
          })
        })
      }
    })
    await listener('mt::close-window')(event)
    expect(emit).not.toHaveBeenCalledWith('window-close-by-id', win.id)
    expect(send).toHaveBeenCalledWith('mt::cancel-window-close', expect.any(Number))
    expect(send).toHaveBeenCalledWith(
      'mt::show-notification',
      expect.objectContaining({ message: 'backup disk full' })
    )
  })

  it('prompts for a newly unsaved document in the final close snapshot', async() => {
    showMessageBox.mockReset().mockResolvedValue({ response: 2 })
    await listener('mt::close-window')(event)
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(emit).not.toHaveBeenCalledWith('window-close-by-id', win.id)
    expect(send).toHaveBeenCalledWith('mt::cancel-window-close', expect.any(Number))
  })

  it('preserves restore-all closing without forcing a save dialog', async() => {
    send.mockImplementation((channel, requestId) => {
      if (channel === 'mt::prepare-window-close') {
        queueMicrotask(() => {
          listeners.get('mt::window-close-prepared')?.(event, {
            requestId,
            files: [unsavedFile],
            requiresConfirmation: false
          })
        })
      }
    })
    await listener('mt::close-window')(event)
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(writeMarkdownFile).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith('window-close-by-id', win.id)
  })

  it('renews the decision when another unsaved tab appears during confirmation', async() => {
    preparedFiles = [unsavedFile, { ...unsavedFile, id: 'new-tab', filename: 'new.md' }]
    showMessageBox
      .mockReset()
      .mockResolvedValueOnce({ response: 1 })
      .mockResolvedValueOnce({ response: 2 })
    await listener('mt::close-window-confirm')(event, [unsavedFile])
    expect(showMessageBox).toHaveBeenCalledTimes(2)
    expect(emit).not.toHaveBeenCalledWith('window-close-by-id', win.id)
    expect(send).toHaveBeenCalledWith('mt::cancel-window-close', expect.any(Number))
  })

  it('keeps close preparation held until every concurrent save settles after a failure', async() => {
    preparedFiles = [unsavedFile, { ...unsavedFile, id: 'tab-2', pathname: '/tmp/second.md' }]
    let completeSecond!: () => void
    writeMarkdownFile
      .mockReset()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            completeSecond = resolve
          })
      )
    const closing = listener('mt::close-window-confirm')(event, preparedFiles)
    try {
      await vi.waitFor(() => expect(writeMarkdownFile).toHaveBeenCalledTimes(2))
      expect(showMessageBox).toHaveBeenCalledTimes(1)
      expect(send).not.toHaveBeenCalledWith('mt::cancel-window-close', expect.any(Number))
    } finally {
      completeSecond()
      await closing
    }
    expect(showMessageBox).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith('mt::cancel-window-close', expect.any(Number))
    expect(emit).not.toHaveBeenCalledWith('window-close-by-id', win.id)
  })

  it('holds incoming-open routing until the matching renderer confirms restoration', async() => {
    let requestId!: number
    send.mockImplementation((channel, id) => {
      if (channel === 'mt::prepare-window-close') requestId = id
    })
    const closing = listener('mt::close-window')(event)
    const browserWindow = win as unknown as BrowserWindow
    expect(isWindowPreparingToClose(browserWindow)).toBe(true)
    listener('mt::window-close-prepared')(event, { requestId, error: 'remount failed' })
    await closing
    expect(isWindowPreparingToClose(browserWindow)).toBe(true)
    listener('mt::window-close-resumed')({ sender: {} }, requestId)
    listener('mt::window-close-resumed')(event, requestId + 1)
    expect(isWindowPreparingToClose(browserWindow)).toBe(true)
    listener('mt::window-close-resumed')(event, requestId)
    expect(isWindowPreparingToClose(browserWindow)).toBe(false)
  })
})
