import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IMAGE_EXTENSIONS } from 'common/filesystem/paths'

const {
  handlers,
  showOpenDialog,
  fromWebContents,
  mintImageSourceCapability
} = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showOpenDialog: vi.fn(),
  fromWebContents: vi.fn(),
  mintImageSourceCapability: vi.fn((
    _sender: unknown,
    pathname: string
  ) => ({
    schema: 'image-source-capability-1',
    token: `token-for:${pathname}`
  }))
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener)
    },
    on: () => {}
  },
  dialog: { showOpenDialog },
  BrowserWindow: { fromWebContents }
}))

vi.mock('main_renderer/imageAssets/imageSourceCapability', () => ({
  mintImageSourceCapability
}))
vi.mock('keytar', () => ({
  default: { getPassword: vi.fn(), setPassword: vi.fn() }
}))
vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn() }
}))
vi.mock('common/filesystem', () => ({ ensureDirSync: vi.fn() }))

vi.mock('electron-store', () => ({
  default: class {
    private data: Record<string, unknown> = {}
    get(key: string) {
      return this.data[key]
    }

    set(key: string | Record<string, unknown>, value?: unknown) {
      if (typeof key === 'string') this.data[key] = value
      else Object.assign(this.data, key)
    }

    get store() {
      return this.data
    }
  }
}))

const { default: DataCenter } = await import('main_renderer/dataCenter')

const FAKE_WIN = { id: 1 }
const sender = { id: 7, once: vi.fn() }
const fakeEvent = { sender } as never

function getHandler() {
  // eslint-disable-next-line no-new
  new DataCenter({ dataCenterPath: '/tmp/mt-dc', userDataPath: '/tmp/mt-ud' })
  const handler = handlers.get('mt::image-assets::select-native-source')
  if (!handler) throw new Error('Native image source handler was not registered')
  return handler
}

describe('native image source selection', () => {
  beforeEach(() => {
    handlers.clear()
    showOpenDialog.mockReset()
    fromWebContents.mockReset()
    mintImageSourceCapability.mockClear()
    fromWebContents.mockReturnValue(FAKE_WIN)
  })

  it('returns a main-minted capability without revealing filePaths[0]', async() => {
    const handler = getHandler()
    showOpenDialog.mockResolvedValue({
      filePaths: ['/abs/x.png'],
      canceled: false
    })

    const result = await handler(fakeEvent)

    expect(result).toEqual({
      schema: 'image-source-capability-1',
      token: 'token-for:/abs/x.png'
    })
    expect(mintImageSourceCapability).toHaveBeenCalledWith(
      sender,
      '/abs/x.png'
    )
  })

  it('returns null when the dialog is cancelled', async() => {
    const handler = getHandler()
    showOpenDialog.mockResolvedValue({ filePaths: [], canceled: true })

    await expect(handler(fakeEvent)).resolves.toBeNull()
    expect(mintImageSourceCapability).not.toHaveBeenCalled()
  })

  it('returns null when there is no owning BrowserWindow', async() => {
    const handler = getHandler()
    fromWebContents.mockReturnValue(null)

    await expect(handler(fakeEvent)).resolves.toBeNull()
    expect(showOpenDialog).not.toHaveBeenCalled()
  })

  it('uses a native open-file dialog with the closed image filter', async() => {
    const handler = getHandler()
    showOpenDialog.mockResolvedValue({
      filePaths: ['/abs/y.jpg'],
      canceled: false
    })

    await handler(fakeEvent)

    expect(showOpenDialog).toHaveBeenCalledWith(
      FAKE_WIN,
      expect.objectContaining({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: [...IMAGE_EXTENSIONS] }]
      })
    )
  })
})
