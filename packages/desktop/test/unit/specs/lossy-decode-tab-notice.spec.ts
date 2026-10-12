import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// A file whose bytes did not survive decoding says so on its tab
// when it opens or reloads, the way mixed line endings do.

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useEditorStore } from '@/store/editor'

const lossyDocument = {
  markdown: 'ok �( �\n',
  filename: 'legacy.md',
  pathname: '/docs/legacy.md',
  encoding: { encoding: 'utf8', isBom: false },
  lineEnding: 'lf',
  adjustLineEndingOnSave: false,
  trimTrailingNewline: 1,
  isMixedLineEndings: false,
  isLossyDecode: true
}

const lossyNotices = (store: ReturnType<typeof useEditorStore>) =>
  store.tabs
    .find((tab) => tab.pathname === lossyDocument.pathname)!
    .notifications.filter((n) => n.exclusiveType === 'lossy_decode')

describe('a tab whose file did not decode losslessly', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('warns when the file opens', async() => {
    const store = useEditorStore()
    await store.NEW_TAB_WITH_CONTENT({
      markdownDocument: lossyDocument as unknown as Parameters<
        typeof store.NEW_TAB_WITH_CONTENT
      >[0]['markdownDocument'],
      selected: false
    })

    const [notice] = lossyNotices(store)
    expect(notice?.style).toBe('warn')
    expect(notice?.msg).toContain('legacy.md')
    expect(notice?.msg).toContain('UTF-8')
  })

  it('warns once when the file reloads from disk, however often', async() => {
    const store = useEditorStore()
    await store.NEW_TAB_WITH_CONTENT({
      markdownDocument: { ...lossyDocument, isLossyDecode: false } as unknown as Parameters<
        typeof store.NEW_TAB_WITH_CONTENT
      >[0]['markdownDocument'],
      selected: false
    })

    await store.loadChange({ pathname: lossyDocument.pathname, data: lossyDocument })
    await store.loadChange({ pathname: lossyDocument.pathname, data: lossyDocument })

    expect(lossyNotices(store)).toHaveLength(1)
  })

  it('stays quiet for a file that decoded losslessly', async() => {
    const store = useEditorStore()
    await store.NEW_TAB_WITH_CONTENT({
      markdownDocument: { ...lossyDocument, isLossyDecode: false } as unknown as Parameters<
        typeof store.NEW_TAB_WITH_CONTENT
      >[0]['markdownDocument'],
      selected: false
    })

    expect(lossyNotices(store)).toHaveLength(0)
  })
})
