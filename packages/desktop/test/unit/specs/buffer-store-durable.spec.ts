import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The store registers ipcMain handlers in its constructor; stub electron so the
// module imports without a real main process. writeBufferStoreFile no longer
// touches `this`, so we exercise it via the prototype without booting the store.
vi.mock('electron', () => ({}))

const { default: EditorBufferStore } = await import('main_renderer/editorBufferStore')

const writeBufferStoreFile = EditorBufferStore.prototype.writeBufferStoreFile

const state = (documentId: string) => ({
  schema: 'document-core-window-ui-1',
  currentDocumentId: documentId,
  tabs: [{ documentId, scrollTop: 0 }],
  project: { rootDirectory: '' },
  layout: {
    rightColumn: 'files',
    showSideBar: true,
    showTabBar: true,
    sideBarWidth: 280
  }
})

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'mt-buf-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('EditorBufferStore.writeBufferStoreFile — durable atomic write (#4852 follow-up)', () => {
  it('writes the state as JSON and leaves no temp file behind', () => {
    const dir = tempDir()
    const target = path.join(dir, 'buffer.json')
    const value = state('document:1')

    writeBufferStoreFile(target, value)

    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(value)
    // The temp file was renamed over the target — nothing left in the dir.
    expect(readdirSync(dir)).toEqual(['buffer.json'])
  })

  it('overwrites an existing buffer file', () => {
    const dir = tempDir()
    const target = path.join(dir, 'buffer.json')

    writeBufferStoreFile(target, state('document:old'))
    writeBufferStoreFile(target, state('document:new'))

    expect(JSON.parse(readFileSync(target, 'utf8')))
      .toEqual(state('document:new'))
    expect(readdirSync(dir)).toEqual(['buffer.json'])
  })
})
