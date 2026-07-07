import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// Real-mount component spec per specs/architecture/test-infrastructure.md:
// the component under test is mounted with @vue/test-utils; stores are real
// Pinia instances with state written directly and actions spied; only the
// module boundaries (CodeMirror, i18n) are mocked.

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      marktext?: { env: { windowId: number } }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.marktext ??= { env: { windowId: 1 } }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({ default: { notify: vi.fn(), name: 'notify' } }))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve(true))
}))

interface FakeCM {
  getValue: Mock
  setValue: Mock
  setOption: Mock
  getWrapperElement: Mock
}

const { codeMirrorMock, createdEditors } = vi.hoisted(() => {
  const createdEditors: Array<{ options: Record<string, unknown>; cm: FakeCM }> = []
  const codeMirrorMock = vi.fn((_parent: HTMLElement, options: Record<string, unknown>) => {
    const cm: FakeCM = {
      getValue: vi.fn(() => String(options.value ?? '')),
      setValue: vi.fn(),
      setOption: vi.fn(),
      getWrapperElement: vi.fn(() => document.createElement('div'))
    }
    createdEditors.push({ options, cm })
    return cm
  })
  return { codeMirrorMock, createdEditors }
})
vi.mock('@/codeMirror', () => ({ default: codeMirrorMock }))
vi.mock('@/i18n', () => ({ t: (key: string, _args?: unknown) => key }))

import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import MergeConflictDialog from '@/components/editorWithTabs/mergeConflictDialog.vue'

const elementStubs = {
  'el-dialog': {
    props: ['modelValue', 'title'],
    template:
      '<div class="el-dialog-stub"><h2 class="dialog-title">{{ title }}</h2><slot /><slot name="footer" /></div>'
  },
  'el-button': {
    props: ['disabled'],
    template:
      '<button type="button" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
  },
  'el-icon': true
}

const makeConflict = (overrides: Record<string, unknown> = {}) => ({
  session: 1,
  expectedMarkdown: 'local',
  expectedDiskBase: 'base',
  tabId: 'tab-1',
  pathname: '/tmp/doc.md',
  filename: 'doc.md',
  baseMarkdown: 'base',
  localMarkdown: 'local',
  remoteMarkdown: 'remote',
  resultMarkdown: 'bad',
  conflicts: [],
  fileChange: { pathname: '/tmp/doc.md', data: { filename: 'doc.md', markdown: 'remote' } },
  validationError: undefined,
  ...overrides
})

const mountDialog = () =>
  mount(MergeConflictDialog, {
    global: { stubs: elementStubs },
    attachTo: document.body
  })

describe('merge conflict dialog', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    setActivePinia(createPinia())
    createdEditors.length = 0
    codeMirrorMock.mockClear()
    wrapper?.unmount()
    wrapper = null
  })

  it('keeps the result editor mounted when comment validation rejects accept', async() => {
    const store = useEditorStore()
    const accept = vi
      .spyOn(store, 'ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT')
      .mockImplementation(() => {
        store.mergeConflict = makeConflict({
          validationError: 'The merge result introduces invalid MarkText comment syntax.'
        }) as never
      })

    wrapper = mountDialog()
    // The dialog is mounted globally; panes mount when a conflict ARRIVES.
    store.mergeConflict = makeConflict() as never
    await vi.waitFor(() => {
      expect(createdEditors.length).toBe(3)
    })
    const resultEditor = createdEditors[2].cm

    const acceptButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('acceptMerge'))!
    await acceptButton.trigger('click')

    expect(accept).toHaveBeenCalledWith('bad')
    // The dialog stays open on the SAME panes: no editors were torn down or
    // recreated, and the result pane was re-synced to the rejected text.
    expect(createdEditors.length).toBe(3)
    expect(resultEditor.setValue).toHaveBeenCalledWith('bad')
    expect(wrapper.text()).toContain('invalid MarkText comment syntax')
  })

  it('maps the app theme to the same CodeMirror theme the source editor uses', async() => {
    // 24 of the 25 dark themes are railscasts-family; only a literal 'dark'
    // check would regress the dialog to a light editor under all the others.
    const store = useEditorStore()
    const preferences = usePreferencesStore()
    preferences.theme = 'dracula'

    wrapper = mountDialog()
    store.mergeConflict = makeConflict() as never
    await vi.waitFor(() => {
      expect(createdEditors.length).toBe(3)
    })

    expect(createdEditors.every(({ options }) => options.theme === 'railscasts')).toBe(true)

    preferences.theme = 'one-dark'
    await vi.waitFor(() => {
      expect(createdEditors[0].cm.setOption).toHaveBeenCalledWith('theme', 'one-dark')
    })

    preferences.theme = 'light'
    await vi.waitFor(() => {
      expect(createdEditors[0].cm.setOption).toHaveBeenCalledWith('theme', 'default')
    })
  })

  it('titles the dialog with the file being resolved', async() => {
    const store = useEditorStore()
    wrapper = mountDialog()
    store.mergeConflict = makeConflict({ filename: 'notes.md' }) as never
    await vi.waitFor(() => {
      expect(wrapper!.find('.dialog-title').text()).toContain('notes.md')
    })
  })
})
