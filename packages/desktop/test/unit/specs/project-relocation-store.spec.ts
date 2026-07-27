import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import bus from '@/bus'

const mocks = vi.hoisted(() => ({
  applyPathReceipt: vi.fn(),
  invoke: vi.fn(),
  notify: vi.fn()
}))

vi.hoisted(() => {
  const target = globalThis as unknown as {
    window?: Record<string, unknown>
  }
  target.window ??= {}
  target.window.path = {
    sep: '/',
    normalize: (value: string) => value,
    basename: (value: string) => value.split('/').filter(Boolean).at(-1) ?? '',
    dirname: (value: string) => value.slice(0, value.lastIndexOf('/')) || '/',
    join: (...parts: string[]) => parts.join('/').replace(/\/+/gu, '/'),
    relative: (from: string, to: string) =>
      to.startsWith(`${from}/`) ? to.slice(from.length + 1) : `../${to}`
  }
  target.window.electron = {
    ipcRenderer: {
      invoke: mocks.invoke,
      on: vi.fn(),
      send: vi.fn()
    },
    process: { env: { NODE_ENV: 'test' } }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: mocks.notify, name: 'notify' }
}))

vi.mock('@/store/editor', () => ({
  useEditorStore: () => ({
    APPLY_PATH_RECEIPT: mocks.applyPathReceipt
  })
}))

import { useProjectStore } from '@/store/project'

function seed() {
  const store = useProjectStore()
  store.projectTree = {
    pathname: '/project',
    name: 'project',
    isDirectory: true,
    isFile: false,
    isMarkdown: false,
    folders: [],
    files: []
  }
  return store
}

describe('renderer project relocation intent', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('sends only root-relative entry segments and applies an open-document host receipt', async() => {
    const document = {
      schema: 'document-core-path-receipt-1',
      documentId: 'document:1',
      previousPathname: '/project/guides/old.md',
      pathname: '/project/guides/new.md',
      filename: 'new.md'
    }
    mocks.invoke.mockResolvedValue({
      schema: 'project-relocate-receipt-1',
      kind: 'file',
      previousPathname: '/project/guides/old.md',
      entry: {
        pathname: '/project/guides/new.md',
        name: 'new.md',
        isFile: true,
        isDirectory: false,
        isMarkdown: true
      },
      document
    })
    const store = seed()
    store.activeItem = {
      pathname: '/project/guides/old.md',
      isFile: true,
      isDirectory: false
    }
    store.renameCache = '/project/guides/old.md'

    await store.RENAME_IN_SIDEBAR('new.md')

    expect(mocks.invoke).toHaveBeenCalledWith('mt::project::relocate', {
      schema: 'project-relocate-intent-1',
      kind: 'file',
      entrySegments: ['guides', 'old.md'],
      targetParentSegments: ['guides'],
      newName: 'new.md'
    })
    const intent = mocks.invoke.mock.calls[0]?.[1]
    expect(intent).not.toHaveProperty('pathname')
    expect(intent).not.toHaveProperty('sourcePathname')
    expect(intent).not.toHaveProperty('targetPathname')
    expect(intent).not.toHaveProperty('source')
    expect(mocks.applyPathReceipt).toHaveBeenCalledWith(document)
    expect(store.renameCache).toBeNull()
  })

  it('reports a main preflight rejection without applying a renderer path', async() => {
    mocks.invoke.mockRejectedValueOnce(
      new Error('Close every open descendant before renaming this directory')
    )
    const store = seed()
    store.activeItem = {
      pathname: '/project/guides',
      isFile: false,
      isDirectory: true
    }
    store.renameCache = '/project/guides'

    await store.RENAME_IN_SIDEBAR('manual')

    expect(mocks.applyPathReceipt).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: expect.stringMatching(/open descendant/i)
    }))
  })

  it('routes sidebar cut/paste through the same retained-root transaction', async() => {
    mocks.invoke.mockResolvedValue({
      schema: 'project-relocate-receipt-1',
      kind: 'file',
      previousPathname: '/project/guides/old.md',
      entry: {
        pathname: '/project/archive/old.md',
        name: 'old.md',
        isFile: true,
        isDirectory: false,
        isMarkdown: true
      },
      document: null
    })
    const store = seed()
    store.clipboard = {
      type: 'cut',
      src: '/project/guides/old.md',
      kind: 'file'
    }
    store.activeItem = {
      pathname: '/project/archive',
      isFile: false,
      isDirectory: true
    }
    store.LISTEN_FOR_SIDEBAR_CONTEXT_MENU()

    bus.emit('SIDEBAR::paste')

    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      'mt::project::relocate',
      {
        schema: 'project-relocate-intent-1',
        kind: 'file',
        entrySegments: ['guides', 'old.md'],
        targetParentSegments: ['archive'],
        newName: 'old.md'
      }
    ))
    expect(store.clipboard).toBeNull()
  })

  it('deletes through a retained-root-relative main intent', async() => {
    mocks.invoke.mockResolvedValue({
      schema: 'project-delete-receipt-1',
      kind: 'file',
      pathname: '/project/guides/old.md'
    })
    const store = seed()
    store.activeItem = {
      pathname: '/project/guides/old.md',
      isFile: true,
      isDirectory: false
    }
    store.LISTEN_FOR_SIDEBAR_CONTEXT_MENU()

    bus.emit('SIDEBAR::remove')

    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      'mt::project::delete',
      {
        schema: 'project-delete-intent-1',
        kind: 'file',
        entrySegments: ['guides', 'old.md']
      }
    ))
  })

  it('copies through a retained-root-relative exclusive main intent', async() => {
    mocks.invoke.mockResolvedValue({
      schema: 'project-copy-receipt-1',
      kind: 'file',
      sourcePathname: '/project/guides/old.md',
      entry: {
        pathname: '/project/archive/old.md',
        name: 'old.md',
        isFile: true,
        isDirectory: false,
        isMarkdown: true
      }
    })
    const store = seed()
    store.clipboard = {
      type: 'copy',
      src: '/project/guides/old.md',
      kind: 'file'
    }
    store.activeItem = {
      pathname: '/project/archive',
      isFile: false,
      isDirectory: true
    }
    store.LISTEN_FOR_SIDEBAR_CONTEXT_MENU()

    bus.emit('SIDEBAR::paste')

    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      'mt::project::copy',
      {
        schema: 'project-copy-intent-1',
        kind: 'file',
        entrySegments: ['guides', 'old.md'],
        targetParentSegments: ['archive']
      }
    ))
    expect(store.clipboard).toBeNull()
  })
})
