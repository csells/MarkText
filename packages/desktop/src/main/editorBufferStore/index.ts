import fs from 'fs'
import path from 'path'
import writeFileAtomic from 'write-file-atomic'
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { TypedEmitter } from '@shared/types/typedEmitter'
import {
  decodeBufferedState,
  decodeWindowUiCheckpointIntent,
  type BufferedState,
  type WindowUiCheckpointIntent
} from '@shared/types/bufferedState'
import type BaseWindow from '../windows/base'

interface EditorBufferStorePaths {
  editorBufferStorePath: string
}

interface BufferStoreEntry {
  id: string
  filePath: string
}

interface EditorWindow {
  id: number
  win: BaseWindow
}

// The store owns no instance-level events today; the empty map satisfies the
// shared TypedEmitter contract used by main-process services.
type EditorBufferStoreEvents = Record<string, unknown[]>

type CheckpointAuthority = (
  windowId: number,
  intent: WindowUiCheckpointIntent
) => BufferedState

class EditorBufferStore extends TypedEmitter<EditorBufferStoreEvents> {
  editorBufferStorePath: string
  bufferStores: Record<string, BufferStoreEntry> | null
  serviceName: string
  encryptKeys: string[]
  private checkpointAuthority: CheckpointAuthority | null

  constructor(paths: EditorBufferStorePaths) {
    super()

    const { editorBufferStorePath } = paths
    this.editorBufferStorePath = editorBufferStorePath
    // Object of paths to buffer stores. Buffer stores are NOT held in memory
    // for performance reasons — they are read from disk when needed and
    // written to disk when updated.
    this.bufferStores = null
    this.serviceName = 'marktext'
    this.encryptKeys = []
    this.checkpointAuthority = null

    this.init()
  }

  configureCheckpointAuthority(authority: CheckpointAuthority): void {
    if (this.checkpointAuthority !== null) {
      throw new Error('Window UI checkpoint authority is already configured')
    }
    this.checkpointAuthority = authority
  }

  init(): void {
    if (!fs.existsSync(this.editorBufferStorePath)) {
      fs.mkdirSync(this.editorBufferStorePath, { recursive: true })
    }
    this._listenForIpcMain()
  }

  getAll(): Record<string, BufferStoreEntry> {
    return this.getAllBufferStores()
  }

  getAllBufferStores(): Record<string, BufferStoreEntry> {
    if (!this.bufferStores) {
      this.bufferStores = this.findEditorBufferStores(this.editorBufferStorePath)
    }

    return this.bufferStores
  }

  clearEmptyBufferStores(): void {
    this.bufferStores = this.getAllBufferStores()

    for (const id in this.bufferStores) {
      try {
        const buffer = this.readBufferStoreFile(this.bufferStores[id].filePath)
        if (buffer.tabs.length === 0) {
          try {
            fs.unlinkSync(this.bufferStores[id].filePath)
          } catch (e) {
            console.error('Failed to delete buffer store file during clear', e)
          }
        }
      } catch (e) {
        console.error('Failed to read buffer store file during clear', e)
      }
    }
  }

  handleClose(restoreBufferId: string | undefined, editorWindows: EditorWindow[]): void {
    // If > 1 window is present, and the window being closed has all files
    // saved, we can delete its saved buffer.

    if (!restoreBufferId) {
      console.warn('No restoreBufferId found for window, skipping buffer cleanup')
      return
    }

    if (!this.bufferStores) {
      this.bufferStores = this.findEditorBufferStores(this.editorBufferStorePath)
    }

    if (!(restoreBufferId in this.bufferStores)) {
      console.warn('No buffer store found for restoreBufferId, skipping buffer cleanup')
      return
    }

    if (editorWindows.length > 1) {
      if (!fs.existsSync(this.bufferStores[restoreBufferId].filePath)) {
        return
      }
      try {
        const buffer = this.readBufferStoreFile(this.bufferStores[restoreBufferId].filePath)
        if (buffer.tabs.length === 0) {
          fs.unlinkSync(this.bufferStores[restoreBufferId].filePath)
          delete this.bufferStores[restoreBufferId]
        }
      } catch (e) {
        console.error('Failed to read or parse buffer store file during cleanup', e)
      }
    }
  }

  findEditorBufferStores(dir: string): Record<string, BufferStoreEntry> {
    const results: Record<string, BufferStoreEntry> = {}
    if (!fs.existsSync(dir)) {
      return results
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isFile() && entry.name.endsWith('_editor_buffer_store.json')) {
        const id = entry.name.replace('_editor_buffer_store.json', '')
        results[id] = { id, filePath: fullPath }
      }
    }

    return results
  }

  getBufferStoreInfo(restoreBufferId: string): BufferStoreEntry {
    if (!this.bufferStores) {
      this.bufferStores = this.findEditorBufferStores(this.editorBufferStorePath)
    }

    if (!this.bufferStores[restoreBufferId]) {
      this.bufferStores[restoreBufferId] = {
        id: restoreBufferId,
        filePath: path.join(
          this.editorBufferStorePath,
          `${restoreBufferId}_editor_buffer_store.json`
        )
      }
    }

    return this.bufferStores[restoreBufferId]
  }

  readBufferStoreFile(filePath: string): BufferedState {
    const content = fs.readFileSync(filePath, 'utf8')
    if (!content.trim()) {
      throw new Error('Buffer store file is empty.')
    }

    return decodeBufferedState(JSON.parse(content) as unknown)
  }

  writeBufferStoreFile(filePath: string, newState: unknown): void {
    const decoded = decodeBufferedState(newState)
    writeFileAtomic.sync(filePath, JSON.stringify(decoded), 'utf8')
  }

  updateBufferState(e: IpcMainInvokeEvent, newState: unknown): boolean {
    const intent = decodeWindowUiCheckpointIntent(newState)
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) {
      throw new Error(
        'Window UI checkpoint requires a sender-owned BrowserWindow'
      )
    }
    const restoreBufferId =
      (win as unknown as { restoreBufferId?: string }).restoreBufferId

    if (!restoreBufferId) {
      console.warn('No restoreBufferId found for window, skipping buffer state update')
      return false
    }
    if (this.checkpointAuthority === null) {
      throw new Error('Window UI checkpoint authority is not configured')
    }

    const authorized = this.checkpointAuthority(win.id, intent)
    const bufferStore = this.getBufferStoreInfo(restoreBufferId)
    this.writeBufferStoreFile(bufferStore.filePath, authorized)
    return true
  }

  getUnUsedBufferUUID(): string {
    if (!this.bufferStores) {
      this.bufferStores = this.findEditorBufferStores(this.editorBufferStorePath)
    }

    let uuid: string
    do {
      uuid = crypto.randomUUID()
    } while (uuid in this.bufferStores)

    return uuid
  }

  _listenForIpcMain(): void {
    ipcMain.handle('update-buffer-state', (e, newState) => {
      return this.updateBufferState(e, newState)
    })
  }
}

export default EditorBufferStore
