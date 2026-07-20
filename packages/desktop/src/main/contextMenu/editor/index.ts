import {
  Menu,
  MenuItem,
  type BrowserWindow,
  type MenuItemConstructorOptions,
  type WebFrameMain
} from 'electron'
import log from 'electron-log'
import {
  isCriticMarkupCommentEditRequest,
  type CriticMarkupCommentEditRequest,
  type CriticMarkupEditorContextRequest,
  type CriticMarkupEditorContextResponse
} from '@shared/types/criticMarkup'
import {
  getCUT,
  getCOPY,
  getPASTE,
  getCopyAsRich,
  getCopyAsHtml,
  getPasteAsPlainText,
  SEPARATOR,
  getInsertBefore,
  getInsertAfter
} from './menuItems'
import spellcheckMenuBuilder from './spellcheck'
import { t } from '../../i18n'
import { presentationPolicy } from '../../presentationPolicy'

// Electron's ContextMenuParams shape we rely on. Kept narrow — the renderer
// supplies the full surface so we only annotate the fields we use.
interface ContextMenuParams {
  frame?: WebFrameMain | null
  isEditable: boolean
  hasImageContents?: boolean
  selectionText: string
  inputFieldType?: string
  editFlags: {
    canCut: boolean
    canCopy: boolean
    canPaste: boolean
    canEditRichly: boolean
  }
  misspelledWord?: string
  dictionarySuggestions?: string[]
  // Coordinates of the context-menu request. Electron names them `x`/`y` on
  // the params (not the event); the renderer passes them through unchanged.
  x: number
  y: number
}

const CONTEXT_QUERY_TIMEOUT_MS = 150
let contextRequestSequence = 0
const contextMenuEpoch = new WeakMap<BrowserWindow, number>()

// Electron `webContents.on('context-menu', (event, params) => ...)` provides
// a simple event object with preventDefault — nothing on it is consumed by
// this function, so we keep the type minimal.
type ContextMenuEvent = {
  preventDefault?: () => void
  readonly defaultPrevented?: boolean
}

// Dynamically fetch menu items to ensure correct translation
const getContextItems = (): MenuItemConstructorOptions[] => [
  getInsertBefore(),
  getInsertAfter(),
  SEPARATOR,
  getCUT(),
  getCOPY(),
  getPASTE(),
  SEPARATOR,
  getCopyAsRich(),
  getCopyAsHtml(),
  getPasteAsPlainText()
]

const isInsideEditor = (params: ContextMenuParams): boolean => {
  const { isEditable, editFlags, inputFieldType } = params
  // WORKAROUND for Electron#32102: `params.spellcheckEnabled` is always false. Try to detect the editor container via other information.
  return isEditable && !inputFieldType && !!editFlags.canEditRichly
}

const nextContextRequest = (params: ContextMenuParams): CriticMarkupEditorContextRequest => ({
  requestId: `critic-context-${Date.now()}-${++contextRequestSequence}`,
  x: params.x,
  y: params.y
})

const isContextResponse = (
  value: unknown,
  requestId: string
): value is CriticMarkupEditorContextResponse => {
  if (!value || typeof value !== 'object') return false
  const response = value as Partial<CriticMarkupEditorContextResponse>
  return response.requestId === requestId && (
    (response.fileId === null && response.target === null) ||
    isCriticMarkupCommentEditRequest(response)
  )
}

const queryEditorContext = (
  win: BrowserWindow,
  frame: WebFrameMain,
  request: CriticMarkupEditorContextRequest
): Promise<CriticMarkupEditorContextResponse | null> => new Promise((resolve) => {
  const ipc = frame.ipc
  let timer: ReturnType<typeof setTimeout> | null = null
  let settled = false

  const cleanup = (): void => {
    ipc.off('mt::cm-editor-context-response', onResponse)
    win.webContents.off('destroyed', onDestroyed)
    if (timer) clearTimeout(timer)
  }
  const settle = (response: CriticMarkupEditorContextResponse | null): void => {
    if (settled) return
    settled = true
    cleanup()
    resolve(response)
  }
  const onResponse = (_event: Electron.IpcMainEvent, response: unknown): void => {
    if (isContextResponse(response, request.requestId)) settle(response)
  }
  const onDestroyed = (): void => settle(null)

  ipc.on('mt::cm-editor-context-response', onResponse)
  win.webContents.once('destroyed', onDestroyed)
  timer = setTimeout(() => settle(null), CONTEXT_QUERY_TIMEOUT_MS)

  try {
    if (frame.isDestroyed()) {
      settle(null)
      return
    }
    frame.send('mt::cm-query-editor-context', request)
  } catch (error) {
    log.warn('Unable to query editor context for the native context menu.', error)
    settle(null)
  }
})

const editCommentMenuItem = (
  frame: WebFrameMain,
  request: CriticMarkupCommentEditRequest
): MenuItemConstructorOptions => ({
  id: 'editCriticMarkupCommentMenuItem',
  label: t('contextMenu.editComment'),
  click() {
    try {
      if (!frame.isDestroyed()) frame.send('mt::cm-edit-comment', request)
    } catch (error) {
      log.warn('Unable to open the selected CriticMarkup comment.', error)
    }
  }
})

const popupEditorContextMenu = (
  win: BrowserWindow,
  params: ContextMenuParams,
  isSpellcheckerEnabled: boolean,
  editCommentRequest: CriticMarkupCommentEditRequest | null
): void => {
  const {
    isEditable,
    selectionText,
    editFlags,
    misspelledWord,
    dictionarySuggestions
  } = params

  const hasText = selectionText.trim().length > 0
  const canCopy = hasText && editFlags.canCut && editFlags.canCopy
  const isMisspelled = isEditable && !!selectionText && !!misspelledWord

  const menu = new Menu()
  if (editCommentRequest && params.frame) {
    menu.append(new MenuItem(editCommentMenuItem(params.frame, editCommentRequest)))
    menu.append(new MenuItem(SEPARATOR))
  }
  if (isSpellcheckerEnabled) {
    const spellingSubmenu = spellcheckMenuBuilder(
      isMisspelled,
      misspelledWord,
      dictionarySuggestions
    )
    menu.append(
      new MenuItem({
        label: t('contextMenu.spelling'),
        submenu: spellingSubmenu as Electron.MenuItemConstructorOptions[]
      })
    )
    menu.append(new MenuItem(SEPARATOR))
  }

  const contextItems = getContextItems()
  const copyItems = [contextItems[3], contextItems[4], contextItems[8], contextItems[7]]
  copyItems.forEach((item) => {
    if (item) item.enabled = canCopy
  })
  contextItems.forEach((item) => {
    menu.append(new MenuItem(item))
  })
  presentationPolicy.popupMenu(menu, { window: win, x: params.x, y: params.y })
}

export const showEditorContextMenu = async(
  win: BrowserWindow,
  _event: ContextMenuEvent,
  params: ContextMenuParams,
  isSpellcheckerEnabled: boolean
): Promise<void> => {
  const { hasImageContents } = params
  const epoch = (contextMenuEpoch.get(win) ?? 0) + 1
  contextMenuEpoch.set(win, epoch)

  // NOTE: We have to get the word suggestions from this event because `webFrame.getWordSuggestions` and
  //       `webFrame.isWordMisspelled` doesn't work on Windows (Electron#28684).

  if (hasImageContents) return

  const ordinaryEditorContext = isInsideEditor(params)
  // Comment indicators are deliberately atomic (`contenteditable=false`), so
  // Chromium does not describe their native context-menu event as editable.
  // Ask the exact originating frame for parser-owned identity before deciding
  // whether that otherwise non-editor event belongs to a comment.
  if (!ordinaryEditorContext && !params.frame) return

  const response = params.frame
    ? await queryEditorContext(win, params.frame, nextContextRequest(params))
    : null
  if (contextMenuEpoch.get(win) !== epoch || win.webContents.isDestroyed()) return
  const editRequest = response?.fileId && response.target
    ? { fileId: response.fileId, target: response.target }
    : null
  if (!ordinaryEditorContext && !editRequest) return

  popupEditorContextMenu(win, params, isSpellcheckerEnabled, editRequest)
}
