import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, listeners } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((
      channel: string,
      handler: (...args: unknown[]) => unknown
    ) => handlers.set(channel, handler)),
    on: vi.fn((
      channel: string,
      listener: (...args: unknown[]) => unknown
    ) => listeners.set(channel, listener))
  }
}))

const { registerRipgrepHandlers } =
  await import('main_renderer/ipc/ripgrep')

describe('project-search IPC effect gate', () => {
  beforeEach(() => {
    handlers.clear()
    listeners.clear()
  })

  it('rejects renderer filesystem and process authority before root lookup or spawn', async() => {
    const resolveProjectRoot = vi.fn()
    const spawnSearch = vi.fn()
    registerRipgrepHandlers({
      resolveProjectRoot,
      readSettings: () => ({
        exclusions: [],
        maxFileSize: '',
        includeHidden: false,
        noIgnore: false
      }),
      spawnSearch,
      createSearchId: () => 'main-search-1',
      schedule: task => task()
    })
    const handler = handlers.get('mt::rg::start')

    expect(() => handler?.(
      { sender: { id: 7 } },
      {
        schema: 'project-search-request-1',
        mode: 'text',
        pattern: 'needle',
        options: {},
        directories: ['/tmp'],
        searchId: 'renderer-owned',
        executable: '/tmp/rg'
      }
    )).toThrow(/closed|field/i)

    expect(resolveProjectRoot).not.toHaveBeenCalled()
    expect(spawnSearch).not.toHaveBeenCalled()
  })

  it('uses the sender-retained project root and a main-generated search identity', async() => {
    const sender = {
      id: 41,
      once: vi.fn(),
      isDestroyed: () => false,
      send: vi.fn()
    }
    const spawnSearch = vi.fn(() => ({
      cancel: vi.fn()
    }))
    registerRipgrepHandlers({
      resolveProjectRoot: vi.fn(() => '/retained/project'),
      readSettings: () => ({
        exclusions: [],
        maxFileSize: '',
        includeHidden: false,
        noIgnore: false
      }),
      spawnSearch,
      createSearchId: () => 'main-search-2',
      schedule: task => task()
    })
    const handler = handlers.get('mt::rg::start')

    expect(handler?.(
      { sender },
      {
        schema: 'project-search-request-1',
        mode: 'files',
        pattern: '',
        options: {}
      }
    )).toEqual({ searchId: 'main-search-2' })

    expect(spawnSearch).toHaveBeenCalledWith(
      sender,
      'main-search-2',
      '/retained/project',
      expect.objectContaining({
        schema: 'project-search-request-1',
        mode: 'files'
      })
    )
  })

  it('does not let one renderer cancel another renderer search', async() => {
    const owner = {
      id: 1,
      once: vi.fn(),
      isDestroyed: () => false,
      send: vi.fn()
    }
    const stranger = {
      id: 2,
      once: vi.fn(),
      isDestroyed: () => false,
      send: vi.fn()
    }
    const cancel = vi.fn()
    registerRipgrepHandlers({
      resolveProjectRoot: vi.fn(() => '/retained/project'),
      readSettings: () => ({
        exclusions: [],
        maxFileSize: '',
        includeHidden: false,
        noIgnore: false
      }),
      spawnSearch: vi.fn(() => ({ cancel })),
      createSearchId: () => 'main-search-3',
      schedule: task => task()
    })
    await handlers.get('mt::rg::start')?.(
      { sender: owner },
      {
        schema: 'project-search-request-1',
        mode: 'files',
        pattern: '',
        options: {}
      }
    )

    listeners.get('mt::rg::cancel')?.(
      { sender: stranger },
      'main-search-3'
    )
    expect(cancel).not.toHaveBeenCalled()

    listeners.get('mt::rg::cancel')?.(
      { sender: owner },
      'main-search-3'
    )
    expect(cancel).toHaveBeenCalledOnce()
  })
})
