import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createDocumentState } from '@/store/help'
import { useEditorStore } from '@/store/editor'

const pathReceipt = Object.freeze({
  schema: 'document-core-path-receipt-1' as const,
  documentId: 'document:1',
  previousPathname: '/tmp/note.md',
  pathname: '/tmp/renamed.md',
  filename: 'renamed.md'
})

vi.hoisted(() => {
  const target = globalThis as unknown as {
    window?: Record<string, unknown>
  }
  target.window ??= {}
  Object.assign(target.window, {
    path: {
      sep: '/',
      basename: (pathname: string) => pathname.split('/').at(-1) ?? '',
      dirname: (pathname: string) =>
        pathname.slice(0, Math.max(0, pathname.lastIndexOf('/'))) || '/',
      join: (...parts: string[]) => parts.join('/'),
      relative: (root: string, pathname: string) =>
        pathname.startsWith(`${root}/`)
          ? pathname.slice(root.length + 1)
          : pathname
    },
    fileUtils: {
      isSamePathSync: (left: string, right: string) => left === right
    },
    electron: {
      clipboard: { writeText: () => {} },
      ipcRenderer: {
        invoke: async() => undefined,
        on: () => {},
        send: () => {}
      },
      process: { env: {} }
    }
  })
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

function seed() {
  const store = useEditorStore()
  const file = createDocumentState({
    filename: 'note.md',
    pathname: '/tmp/note.md',
    markdown: 'renderer cache',
    isSaved: true
  }, 'document:1')
  store.currentFile = file
  store.tabs = [file]
  store.updateTabIdToIndex()
  return store
}

describe('renderer document path relocation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renames with identity plus a semantic filename and applies only the main receipt', async() => {
    const store = seed()
    const invoke = vi.spyOn(window.electron.ipcRenderer, 'invoke')
      .mockResolvedValue(pathReceipt)

    store.RENAME('renamed.md')

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'mt::document-core::relocate',
      {
        documentId: 'document:1',
        intent: {
          kind: 'rename',
          filename: 'renamed.md'
        }
      }
    ))
    expect(store.currentFile).toMatchObject({
      id: 'document:1',
      pathname: '/tmp/renamed.md',
      filename: 'renamed.md'
    })
  })

  it('asks main to choose a Move To target without sending any path', async() => {
    const store = seed()
    const invoke = vi.spyOn(window.electron.ipcRenderer, 'invoke')
      .mockResolvedValue(pathReceipt)

    store.MOVE_FILE_TO()

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'mt::document-core::relocate',
      {
        documentId: 'document:1',
        intent: { kind: 'move-to' }
      }
    ))
    const request = invoke.mock.calls[0]?.[1]
    expect(request).not.toHaveProperty('pathname')
    expect(request).not.toHaveProperty('currentFile')
    expect(request).not.toHaveProperty('source')
    expect(request).not.toHaveProperty('revisionId')
  })
})
