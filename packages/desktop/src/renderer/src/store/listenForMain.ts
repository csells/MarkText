import { defineStore } from 'pinia'
import bus from '../bus'
import { useLayoutStore } from './layout'
import { decodeParagraphDocumentAction } from '@shared/types/paragraphDocumentAction'

type EditorEditAction =
  | 'undo'
  | 'redo'
  | 'copyAsRich'
  | 'copyAsHtml'
  | 'pasteAsPlainText'
  | 'selectAll'
  | 'duplicate'
  | 'createParagraph'
  | 'deleteParagraph'
  | 'find'
  | 'findNext'
  | 'findPrev'
  | 'replace'
  | 'findInFolder'

const decodeEditorEditAction = (value: unknown): EditorEditAction => {
  switch (value) {
    case 'undo':
    case 'redo':
    case 'copyAsRich':
    case 'copyAsHtml':
    case 'pasteAsPlainText':
    case 'selectAll':
    case 'duplicate':
    case 'createParagraph':
    case 'deleteParagraph':
    case 'find':
    case 'findNext':
    case 'findPrev':
    case 'replace':
    case 'findInFolder':
      return value
    default:
      throw new TypeError(`Unknown editor edit action: ${String(value)}`)
  }
}

const actionTypeFromClosedEnvelope = (
  value: unknown,
  label: string
): unknown => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} action must be a closed record`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.length !== 1 || keys[0] !== 'type') {
    throw new TypeError(`${label} action fields are not closed`)
  }
  return (value as Readonly<{ type?: unknown }>).type
}

type InlineFormatAction =
  | 'clear'
  | 'em'
  | 'mark'
  | 'link'
  | 'image'
  | 'inline_code'
  | 'inline_math'
  | 'del'
  | 'strong'
  | 'sub'
  | 'sup'
  | 'u'

const decodeInlineFormatAction = (value: unknown): InlineFormatAction => {
  const type = actionTypeFromClosedEnvelope(value, 'Inline format')
  switch (type) {
    case 'clear':
    case 'em':
    case 'mark':
    case 'link':
    case 'image':
    case 'inline_code':
    case 'inline_math':
    case 'del':
    case 'strong':
    case 'sub':
    case 'sup':
    case 'u':
      return type
    default:
      throw new TypeError(`Unknown inline format action: ${String(type)}`)
  }
}

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
  function EDITOR_EDIT_ACTION(value: unknown): void {
    const type = decodeEditorEditAction(value)
    const layoutStore = useLayoutStore()
    if (type === 'findInFolder') {
      layoutStore.SET_LAYOUT({
        rightColumn: 'search',
        showSideBar: true
      })
    }
    switch (type) {
      case 'undo': bus.emit('undo', 'undo'); break
      case 'redo': bus.emit('redo', 'redo'); break
      case 'copyAsRich': bus.emit('copyAsRich', 'copyAsRich'); break
      case 'copyAsHtml': bus.emit('copyAsHtml', 'copyAsHtml'); break
      case 'pasteAsPlainText': bus.emit('pasteAsPlainText', 'pasteAsPlainText'); break
      case 'selectAll': bus.emit('selectAll', 'selectAll'); break
      case 'duplicate': bus.emit('duplicate', 'duplicate'); break
      case 'createParagraph': bus.emit('createParagraph', 'createParagraph'); break
      case 'deleteParagraph': bus.emit('deleteParagraph', 'deleteParagraph'); break
      case 'find': bus.emit('find', 'find'); break
      case 'findNext': bus.emit('findNext', 'findNext'); break
      case 'findPrev': bus.emit('findPrev', 'findPrev'); break
      case 'replace': bus.emit('replace', 'replace'); break
      case 'findInFolder': bus.emit('findInFolder', 'findInFolder'); break
    }
  }

  function LISTEN_FOR_EDIT(): void {
    window.electron.ipcRenderer.on('mt::editor-edit-action', (_e, type) => {
      EDITOR_EDIT_ACTION(type)
    })
    bus.on('mt::editor-edit-action', (type: unknown) => {
      EDITOR_EDIT_ACTION(type)
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

  function LISTEN_FOR_PARAGRAPH_INLINE_STYLE(): void {
    window.electron.ipcRenderer.on('mt::editor-paragraph-action', (_e, value) => {
      bus.emit('paragraph', decodeParagraphDocumentAction(value))
    })
    window.electron.ipcRenderer.on('mt::editor-format-action', (_e, value) => {
      bus.emit('format', decodeInlineFormatAction(value))
    })
  }

  return {
    EDITOR_EDIT_ACTION,
    LISTEN_FOR_EDIT,
    LISTEN_FOR_SHOW_DIALOG,
    LISTEN_FOR_PARAGRAPH_INLINE_STYLE
  }
})
