import { defineStore } from 'pinia'
import bus from '../bus'
import { useLayoutStore } from './layout'
import { decodeEditorCommandId } from '@shared/types/editorCommands'

type ExportDialogAction = 'pdf' | 'styledHtml' | 'print'

const decodeExportDialogAction = (value: unknown): ExportDialogAction => {
  switch (value) {
    case 'pdf':
    case 'styledHtml':
    case 'print':
      return value
    default:
      throw new TypeError(`Unknown export-dialog action: ${String(value)}`)
  }
}

export const useListenForMainStore = defineStore('listenForMain', () => {
  function EDITOR_COMMAND(value: unknown): void {
    bus.emit('editor-command', decodeEditorCommandId(value))
  }

  function LISTEN_FOR_EDITOR_COMMAND(): void {
    window.electron.ipcRenderer.on('mt::editor-command', (_e, command) => {
      EDITOR_COMMAND(command)
    })
    // The store owns this command's layout side effect so the sidebar opens
    // whether the command arrives from main or from the palette's bus emit.
    bus.on('editor-command', (command: unknown) => {
      if (command === 'find-in-folder') {
        useLayoutStore().SET_LAYOUT({
          rightColumn: 'search',
          showSideBar: true
        })
      }
    })
  }

  function LISTEN_FOR_SHOW_DIALOG(): void {
    window.electron.ipcRenderer.on('mt::about-dialog', () => {
      bus.emit('aboutDialog')
    })
    window.electron.ipcRenderer.on('mt::show-export-dialog', (_e, type) => {
      bus.emit('showExportDialog', decodeExportDialogAction(type))
    })
  }

  return {
    EDITOR_COMMAND,
    LISTEN_FOR_EDITOR_COMMAND,
    LISTEN_FOR_SHOW_DIALOG
  }
})
