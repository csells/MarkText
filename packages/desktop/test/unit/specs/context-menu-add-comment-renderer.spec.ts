import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      electron?: { ipcRenderer: { send: (...a: unknown[]) => void; on: Mock } }
      path?: { sep: string; dirname: (p: string) => string }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
    }
  }
  w.window ??= {}
  w.window.electron ??= { ipcRenderer: { send: () => {}, on: vi.fn() } }
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve(true))
}))

import bus from '@/bus'
import { useEditorStore } from '@/store/editor'

const captureHandler = () => {
  const onMock = window.electron.ipcRenderer.on as Mock
  const call = onMock.mock.calls.find((c) => c[0] === 'mt::cm-add-comment')
  if (!call) throw new Error('mt::cm-add-comment handler was not registered')
  return call[1] as () => void
}

describe('renderer context-menu Add Comment gate', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ;(window.electron.ipcRenderer.on as Mock).mockReset()
    useEditorStore().addCommentEnabled = false
  })

  it('ignores stale context-menu IPC while Add Comment is disabled', () => {
    const store = useEditorStore()
    store.LISTEN_FOR_CONTEXT_MENU()
    const emitSpy = vi.spyOn(bus, 'emit')

    captureHandler()()

    expect(emitSpy).not.toHaveBeenCalledWith('comment:add')
  })

  it('emits Add Comment when the shared predicate is enabled', () => {
    const store = useEditorStore()
    store.LISTEN_FOR_CONTEXT_MENU()
    store.addCommentEnabled = true
    const emitSpy = vi.spyOn(bus, 'emit')

    captureHandler()()

    expect(emitSpy).toHaveBeenCalledWith('comment:add')
  })
})
