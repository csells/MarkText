import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as FsExtra from 'fs-extra'
import nativeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const { listeners, emit, fromWebContents, showSaveDialog, writeMarkdownFile, rename, send } =
  vi.hoisted(() => ({
    listeners: new Map<string, (...args: unknown[]) => unknown>(),
    emit: vi.fn(),
    fromWebContents: vi.fn(),
    showSaveDialog: vi.fn(),
    writeMarkdownFile: vi.fn(),
    rename: vi.fn(),
    send: vi.fn()
  }))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', quit: vi.fn() },
  BrowserWindow: { fromWebContents },
  dialog: { showMessageBox: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog },
  ipcMain: {
    handle: () => {},
    emit,
    on(channel: string, listener: (...args: unknown[]) => unknown) {
      listeners.set(channel, listener)
    }
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn() }
}))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('main_renderer/filesystem/markdown', () => ({ writeMarkdownFile }))
vi.mock('fs-extra', async(importOriginal) => ({
  ...(await importOriginal<typeof FsExtra>()),
  rename
}))
vi.mock('main_renderer/menu/actions/marktext', () => ({
  checkUpdates: vi.fn(),
  userSetting: vi.fn()
}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

await import('main_renderer/menu/actions/file')
const { isSameSaveDestination, withSaveDestination } =
  await import('main_renderer/windows/saveDestination')

const win = { id: 41, webContents: { send } }
const event = { sender: win.webContents }
const options = { encoding: { encoding: 'utf8', isBom: false }, lineEnding: 'lf' }
const identity = { generation: 3, revision: 1 }
const dispatch = (
  channel: string,
  pathname: string | undefined = '/tmp/source.md',
  id = 'source'
) => {
  const handler = listeners.get(channel)
  if (!handler) throw new Error(`Missing ${channel}`)
  return handler(event, id, 'source.md', pathname, 'source {++edit++}\n', options, '/tmp', identity)
}

describe('Save destination ownership through the file IPC callers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromWebContents.mockReturnValue(win)
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/destination.md' })
    writeMarkdownFile.mockResolvedValue(undefined)
    emit.mockImplementation((channel, _pathname, reply) => {
      if (channel === 'window-check-save-destination') reply(true)
    })
  })

  it.each(['mt::response-file-save-as', 'mt::response-file-save'])(
    'refuses %s onto another open document before changing the file or its owner',
    async(channel) => {
      await dispatch(channel, channel.endsWith('save-as') ? '/tmp/source.md' : '')
      await vi.waitFor(() =>
        expect(send).toHaveBeenCalledWith(
          'mt::tab-save-failure',
          'source',
          expect.stringContaining('already open')
        )
      )
      expect(writeMarkdownFile).not.toHaveBeenCalled()
      expect(send.mock.calls.some(([name]) => name === 'mt::set-pathname')).toBe(false)
      expect(emit.mock.calls.some(([name]) => name === 'window-change-file-path')).toBe(false)
    }
  )

  it('still saves to the current pathname without treating its own tab as a collision', async() => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/source.md' })
    await dispatch('mt::response-file-save-as')
    expect(writeMarkdownFile).toHaveBeenCalledExactlyOnceWith(
      '/tmp/source.md',
      'source {++edit++}\n',
      options
    )
    expect(send).toHaveBeenCalledWith('mt::tab-saved', 'source', identity, 'source {++edit++}\n')
  })

  it.each(['mt::rename', 'mt::response-file-move-to'])(
    'also rejects the shared pathname owner change through %s',
    async(channel) => {
      const handler = listeners.get(channel)!
      await handler(event, {
        id: 'source',
        pathname: '/tmp/source.md',
        newPathname: '/tmp/destination.md'
      })
      expect(rename).not.toHaveBeenCalled()
      expect(send).toHaveBeenCalledWith(
        'mt::show-notification',
        expect.objectContaining({
          message: expect.stringContaining('already open')
        })
      )
      expect(send.mock.calls.some(([name]) => name === 'mt::set-pathname')).toBe(false)
    }
  )

  it('does not change either pathname or write when the picker is cancelled', async() => {
    showSaveDialog.mockResolvedValue({ canceled: true })
    await dispatch('mt::response-file-save-as')
    expect(writeMarkdownFile).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('registers the Markdown extension that the existing writer adds to a bare Save As name', async() => {
    emit.mockImplementation((channel, _pathname, reply) => {
      if (channel === 'window-check-save-destination') reply(false)
    })
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/bare' })
    await dispatch('mt::response-file-save-as')
    expect(writeMarkdownFile).toHaveBeenCalledWith('/tmp/bare.md', 'source {++edit++}\n', options)
    expect(send).toHaveBeenCalledWith(
      'mt::set-pathname',
      expect.objectContaining({
        pathname: '/tmp/bare.md',
        filename: 'bare.md'
      })
    )
  })

  it('serializes destination claims and releases the destination after an IO failure', async() => {
    emit.mockImplementation((channel, _pathname, reply) => {
      if (channel === 'window-check-save-destination') reply(false)
    })
    let fail!: (error: Error) => void
    writeMarkdownFile.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        })
    )
    const first = dispatch('mt::response-file-save-as')
    await vi.waitFor(() => expect(writeMarkdownFile).toHaveBeenCalledTimes(1))
    await dispatch('mt::response-file-save-as', '/tmp/another.md', 'another')
    expect(writeMarkdownFile).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      'mt::tab-save-failure',
      'another',
      expect.stringContaining('being saved')
    )
    fail(new Error('disk full'))
    await first
    await dispatch('mt::response-file-save-as')
    expect(writeMarkdownFile).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith('mt::set-pathname', {
      id: 'source',
      pathname: '/tmp/destination.md',
      filename: 'destination.md',
      saveIdentity: identity,
      savedSource: 'source {++edit++}\n'
    })
  })

  it('uses the destination filesystem case policy for concurrent names that do not exist yet', async() => {
    emit.mockImplementation((channel, _pathname, reply) => {
      if (channel === 'window-check-save-destination') reply(false)
    })
    const scratch = nativeFs.mkdtempSync(join(tmpdir(), 'marktext-pending-save-case-'))
    nativeFs.writeFileSync(join(scratch, 'case-probe'), 'preserved fixture', { flag: 'wx' })
    const insensitive = nativeFs.existsSync(join(scratch, 'CASE-PROBE'))
    let finish!: () => void
    const first = withSaveDestination(
      join(scratch, 'New.md'),
      undefined,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const secondWrite = vi.fn(async() => {})
    try {
      const second = withSaveDestination(join(scratch, 'new.md'), undefined, secondWrite)
      if (insensitive) {
        await expect(second).rejects.toThrow('being saved')
        expect(secondWrite).not.toHaveBeenCalled()
      } else {
        await second
        expect(secondWrite).toHaveBeenCalledOnce()
      }
    } finally {
      finish()
      await first
    }
    // An open document retains its filename claim after an external deletion.
    emit.mockImplementation((channel, pathname, reply) => {
      if (channel === 'window-check-save-destination') {
        reply(isSameSaveDestination(join(scratch, 'New.md'), pathname))
      }
    })
    if (insensitive) {
      await expect(
        withSaveDestination(join(scratch, 'new.md'), undefined, secondWrite)
      ).rejects.toThrow('already open')
      expect(secondWrite).not.toHaveBeenCalled()
    }
  })

  it('allows distinct pending names when the existing directory has case-sensitive lookup', async() => {
    emit.mockImplementation((channel, _pathname, reply) => {
      if (channel === 'window-check-save-destination') reply(false)
    })
    const scratch = nativeFs.realpathSync(
      nativeFs.mkdtempSync(join(tmpdir(), 'marktext-sensitive-save-'))
    )
    const alternate = join(dirname(scratch), basename(scratch).replace('m', 'M'))
    const lstat = nativeFs.lstatSync
    const lookup = vi.spyOn(nativeFs, 'lstatSync').mockImplementation((pathname, options) => {
      if (pathname === alternate) {
        throw Object.assign(new Error('Case-sensitive directory entry was not found'), {
          code: 'ENOENT'
        })
      }
      return lstat(pathname, options as never)
    })
    let finish!: () => void
    const first = withSaveDestination(
      join(scratch, 'New.md'),
      undefined,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const secondWrite = vi.fn(async() => {})
    try {
      await withSaveDestination(join(scratch, 'new.md'), undefined, secondWrite)
      expect(secondWrite).toHaveBeenCalledOnce()
      expect(lookup).toHaveBeenCalledWith(alternate)
    } finally {
      lookup.mockRestore()
      finish()
      await first
    }
  })

  it('keeps an ambiguous pending claim exclusive if the directory lookup fails', async() => {
    emit.mockImplementation((channel, _pathname, reply) => {
      if (channel === 'window-check-save-destination') reply(false)
    })
    const scratch = nativeFs.mkdtempSync(join(tmpdir(), 'marktext-unreadable-save-'))
    let finish!: () => void
    const first = withSaveDestination(
      join(scratch, 'New.md'),
      undefined,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const lookup = vi.spyOn(nativeFs, 'lstatSync').mockImplementation(() => {
      throw Object.assign(new Error('Directory became unavailable'), { code: 'EACCES' })
    })
    const secondWrite = vi.fn(async() => {})
    try {
      await expect(
        withSaveDestination(join(scratch, 'new.md'), undefined, secondWrite)
      ).rejects.toThrow('being saved')
      expect(secondWrite).not.toHaveBeenCalled()
      expect(lookup).toHaveBeenCalled()
    } finally {
      lookup.mockRestore()
      finish()
      await first
    }
  })
})
