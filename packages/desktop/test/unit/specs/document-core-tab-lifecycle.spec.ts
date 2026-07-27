import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { IFileState } from '@shared/types/files'

const mocks = vi.hoisted(() => ({
  closeDocumentCoreTab: vi.fn<() => Promise<void>>(),
  debouncedSendBufferedState: vi.fn(),
  send: vi.fn()
}))

vi.hoisted(() => {
  const root = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (value: string) => string }
      fileUtils?: { isSamePathSync: (left: string, right: string) => boolean }
      electron?: {
        ipcRenderer: {
          invoke: ReturnType<typeof vi.fn>
          on: ReturnType<typeof vi.fn>
          send: ReturnType<typeof vi.fn>
        }
      }
    }
  }
  root.window ??= {}
  root.window.path ??= { sep: '/', dirname: value => value }
  root.window.fileUtils ??= {
    isSamePathSync: (left, right) => left === right
  }
  root.window.electron = {
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      send: mocks.send
    }
  }
})

vi.mock('@/components/editorWithTabs/documentCoreTabLifecycle', () => ({
  closeDocumentCoreTab: mocks.closeDocumentCoreTab
}))
vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: mocks.debouncedSendBufferedState,
  sendBufferedState: vi.fn()
}))

import { useEditorStore } from '@/store/editor'

describe('document-core tab lifetime', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('removes renderer tab state only after its local attachment is released', async() => {
    let release: (() => void) | undefined
    mocks.closeDocumentCoreTab.mockReturnValue(new Promise<void>((resolve) => {
      release = resolve
    }))
    const store = useEditorStore()
    const file = {
      id: 'tab-a',
      isSaved: true,
      pathname: '',
      markdown: 'alpha'
    } as IFileState
    store.tabs = [file]
    store.currentFile = file

    const closed = store.CLOSE_TABS(['tab-a'])
    expect(mocks.closeDocumentCoreTab).toHaveBeenCalledWith('tab-a')
    expect(store.tabs).toEqual([file])

    let settled = false
    const observed = closed.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    release?.()
    await observed
    expect(settled).toBe(true)
    expect(store.tabs).toEqual([])
  })
})
