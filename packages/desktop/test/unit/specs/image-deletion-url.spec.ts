import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// `@/store/editor` transitively imports `@/config`, which reads
// `window.path.sep` at module load (normally injected by the preload bridge).
// Stub the preload surfaces before the hoisted imports run.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      electron?: {
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.electron ??= {
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

// The notification service touches the DOM / template HTML; stub it so we can
// observe `notify` without rendering a toast. The capability action chains a
// `.then()` off `notify(...)`, so the stub must resolve a Promise.
vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(() => Promise.resolve()), name: 'notify' }
}))
vi.mock('@/services/uploaderClient', () => ({
  copyUploaderDeletionUrl: vi.fn(() => Promise.resolve(true))
}))

import { useEditorStore } from '@/store/editor'
import notice from '@/services/notification'
import {
  copyUploaderDeletionUrl
} from '@/services/uploaderClient'

const capability = Object.freeze({
  schema: 'uploader-deletion-clipboard-capability-1' as const,
  token: 'token:owned'
})

describe('useEditorStore SHOW_IMAGE_DELETION_CAPABILITY', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ;(notice.notify as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  })

  it('notifies with a confirm toast without exposing the retained URL', () => {
    const store = useEditorStore()

    store.SHOW_IMAGE_DELETION_CAPABILITY(capability)

    expect(notice.notify).toHaveBeenCalledTimes(1)
    expect(notice.notify).toHaveBeenCalledWith(
      expect.objectContaining({ showConfirm: true, time: 20000 })
    )
    const opts = (notice.notify as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(typeof opts.title).toBe('string')
    expect(opts.title.length).toBeGreaterThan(0)
    expect(opts.message).not.toContain('https://')
    expect(opts.message).not.toContain(capability.token)
  })

  it('consumes only the opaque capability after confirm resolves', async() => {
    const store = useEditorStore()

    store.SHOW_IMAGE_DELETION_CAPABILITY(capability)

    expect(copyUploaderDeletionUrl).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(copyUploaderDeletionUrl).toHaveBeenCalledWith(capability)
  })
})
