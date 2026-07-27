import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type * as TreeCtrlModule from '@/store/treeCtrl'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  notify: vi.fn(),
  addFile: vi.fn(),
  updateCurrentFile: vi.fn()
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
    relative: (from: string, to: string) => {
      if (to === from) return ''
      return to.startsWith(`${from}/`) ? to.slice(from.length + 1) : `../${to}`
    }
  }
  target.window.electron = {
    ipcRenderer: {
      invoke: mocks.invoke,
      on: mocks.on,
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
    UPDATE_CURRENT_FILE: mocks.updateCurrentFile
  })
}))

vi.mock('@/store/treeCtrl', async(importOriginal) => {
  const actual = await importOriginal<typeof TreeCtrlModule>()
  return { ...actual, addFile: mocks.addFile }
})

import { useProjectStore } from '@/store/project'

function prepareProjectStore() {
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

describe('main-owned sidebar project creation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    window.path.relative = (from: string, to: string): string => {
      if (to === from) return ''
      return to.startsWith(`${from}/`) ? to.slice(from.length + 1) : `../${to}`
    }
    mocks.invoke.mockResolvedValue({
      schema: 'project-create-receipt-1',
      kind: 'file',
      entry: {
        pathname: '/project/guides/fresh.md',
        name: 'fresh.md',
        isFile: true,
        isDirectory: false,
        isMarkdown: true
      }
    })
  })

  it('sends only relative file intent to the one typed main transaction', async() => {
    const store = prepareProjectStore()
    store.createCache = { dirname: '/project/guides', type: 'file' }

    await store.CREATE_FILE_DIRECTORY('fresh')

    expect(mocks.invoke).toHaveBeenCalledOnce()
    expect(mocks.invoke).toHaveBeenCalledWith('mt::project::create', {
      schema: 'project-create-intent-1',
      kind: 'file',
      parentSegments: ['guides'],
      name: 'fresh'
    })
    const request = mocks.invoke.mock.calls[0][1]
    expect(request).not.toHaveProperty('pathname')
    expect(request).not.toHaveProperty('source')
    expect(request).not.toHaveProperty('documentId')
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('encodes a Windows relative parent as separate closed path segments', async() => {
    const store = prepareProjectStore()
    window.path.relative = vi.fn(() => 'guides\\drafts')
    store.createCache = {
      dirname: 'C:\\project\\guides\\drafts',
      type: 'file'
    }

    await store.CREATE_FILE_DIRECTORY('fresh')

    expect(mocks.invoke).toHaveBeenCalledWith('mt::project::create', {
      schema: 'project-create-intent-1',
      kind: 'file',
      parentSegments: ['guides', 'drafts'],
      name: 'fresh'
    })
  })

  it('reports a main-owned collision without renderer preflight or creation', async() => {
    mocks.invoke.mockRejectedValueOnce(
      Object.assign(new Error('entry exists'), { code: 'EEXIST' })
    )
    const store = prepareProjectStore()
    store.createCache = { dirname: '/project', type: 'directory' }

    await store.CREATE_FILE_DIRECTORY('drafts')

    expect(mocks.invoke).toHaveBeenCalledWith('mt::project::create', {
      schema: 'project-create-intent-1',
      kind: 'directory',
      parentSegments: [],
      name: 'drafts'
    })
    expect(mocks.notify).toHaveBeenCalledOnce()
  })

  it('updates only the tree when a watcher add arrives, even with hostile extra data', () => {
    const store = prepareProjectStore()
    store.LISTEN_FOR_UPDATE_PROJECT()
    const listener = mocks.on.mock.calls.find(
      ([channel]) => channel === 'mt::update-object-tree'
    )?.[1] as ((event: unknown, payload: unknown) => void) | undefined

    expect(listener).toBeTypeOf('function')
    listener?.({}, {
      type: 'add',
      change: {
        pathname: '/project/note.md',
        name: 'note.md',
        isFile: true,
        isDirectory: false,
        isMarkdown: true,
        data: { markdown: 'renderer must ignore me', id: 'invented' }
      }
    })

    expect(mocks.addFile).toHaveBeenCalledOnce()
    expect(mocks.updateCurrentFile).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
