import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  handle: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: mocks.fromWebContents
  },
  ipcMain: {
    handle: mocks.handle
  }
}))

const { default: EditorBufferStore } = await import(
  'main_renderer/editorBufferStore'
)
const { authorizeWindowUiCheckpoint } = await import(
  'main_renderer/editorBufferStore/windowUiCheckpointAuthority'
)

const directories: string[] = []

afterEach(() => {
  vi.clearAllMocks()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const makeStore = () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mt-checkpoint-'))
  directories.push(directory)
  const store = new EditorBufferStore({
    editorBufferStorePath: directory
  })
  const authorize = vi.fn((windowId, rendererIntent) => {
    if (windowId !== 17) {
      throw new Error('Wrong sender-owned editor window')
    }
    return authorizeWindowUiCheckpoint(rendererIntent, {
      rootDirectory: '/main/project',
      retainedDocumentIds: ['document:1']
    })
  })
  store.configureCheckpointAuthority(authorize)
  const browserWindow = {
    id: 17,
    restoreBufferId: 'buffer:1'
  }
  mocks.fromWebContents.mockReturnValue(browserWindow)
  return {
    browserWindow,
    authorize,
    directory,
    store
  }
}

const validIntent = () => ({
  schema: 'document-core-window-ui-intent-1',
  currentDocumentId: 'document:1',
  tabs: [{
    documentId: 'document:1',
    scrollTop: 42
  }],
  layout: {
    rightColumn: 'files',
    showSideBar: true,
    showTabBar: true,
    sideBarWidth: 280
  }
})

describe('EditorBufferStore renderer checkpoint boundary', () => {
  it('persists only the checkpoint authorized for the sender-owned window', () => {
    const { authorize, directory, store } = makeStore()

    expect(store.updateBufferState(
      { sender: { id: 88 } } as never,
      validIntent()
    )).toBe(true)
    expect(authorize).toHaveBeenCalledWith(
      17,
      validIntent()
    )

    const stored = JSON.parse(readFileSync(
      path.join(directory, 'buffer:1_editor_buffer_store.json'),
      'utf8'
    )) as unknown
    expect(stored).toEqual({
      schema: 'document-core-window-ui-1',
      currentDocumentId: 'document:1',
      tabs: [{
        documentId: 'document:1',
        scrollTop: 42
      }],
      project: {
        rootDirectory: '/main/project'
      },
      layout: validIntent().layout
    })
  })

  it('rejects a forged root before persistence or restore effects', () => {
    const { directory, store } = makeStore()

    expect(() => store.updateBufferState(
      { sender: { id: 88 } } as never,
      {
        ...validIntent(),
        project: {
          rootDirectory: '/forged/project'
        }
      }
    )).toThrow(/closed/)

    expect(() => readFileSync(
      path.join(directory, 'buffer:1_editor_buffer_store.json'),
      'utf8'
    )).toThrow()
  })

  it('rejects forged document identities before persistence or recovery', () => {
    const { directory, store } = makeStore()

    expect(() => store.updateBufferState(
      { sender: { id: 88 } } as never,
      {
        ...validIntent(),
        currentDocumentId: 'document:forged',
        tabs: [{
          documentId: 'document:forged',
          scrollTop: 42
        }]
      }
    )).toThrow(/exact permutation/i)

    expect(() => readFileSync(
      path.join(directory, 'buffer:1_editor_buffer_store.json'),
      'utf8'
    )).toThrow()
  })
})
