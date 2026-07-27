import {
  Menu,
  MenuItem,
  type BrowserWindow,
  type MenuItemConstructorOptions,
  type WebFrameMain
} from 'electron'
import log from 'electron-log'
import {
  decodeCriticMarkupEditorContextResponse,
  type CriticMarkupCommentEditRequest,
  type CriticMarkupEditorContextRequest,
  type CriticMarkupEditorContextResponse
} from '@shared/types/criticMarkup'
import {
  decodeDocumentSurfaceContextResponse,
  documentClipboardConsumerPolicy,
  type DocumentSurface,
  type DocumentSurfaceContextRequest,
  type DocumentSurfaceContextResponse
} from '@shared/types/documentSurface'
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
import {
  armCriticMarkupCommentEdit,
  clearCriticMarkupCommentEdit,
  executePendingCriticMarkupCommentEdit
} from './criticMarkupContextEditCommand'

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

const nextContextRequest = (params: ContextMenuParams): CriticMarkupEditorContextRequest => ({
  requestId: `critic-context-${Date.now()}-${++contextRequestSequence}`,
  x: params.x,
  y: params.y
})

const nextSurfaceContextRequest = (
  params: ContextMenuParams
): DocumentSurfaceContextRequest => ({
  requestId: `document-surface-${Date.now()}-${++contextRequestSequence}`,
  x: params.x,
  y: params.y
})

const isContextResponse = (
  value: unknown,
  requestId: string
): value is CriticMarkupEditorContextResponse => {
  try {
    return decodeCriticMarkupEditorContextResponse(value).requestId === requestId
  } catch {
    return false
  }
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

const isSurfaceContextResponse = (
  value: unknown,
  requestId: string
): value is DocumentSurfaceContextResponse => {
  try {
    return decodeDocumentSurfaceContextResponse(value).requestId === requestId
  } catch {
    return false
  }
}

const queryDocumentSurfaceContext = (
  win: BrowserWindow,
  frame: WebFrameMain,
  request: DocumentSurfaceContextRequest
): Promise<DocumentSurfaceContextResponse | null> => new Promise((resolve) => {
  const ipc = frame.ipc
  let timer: ReturnType<typeof setTimeout> | null = null
  let settled = false

  const cleanup = (): void => {
    ipc.off('mt::document-surface-context-response', onResponse)
    win.webContents.off('destroyed', onDestroyed)
    if (timer) clearTimeout(timer)
  }
  const settle = (
    response: DocumentSurfaceContextResponse | null
  ): void => {
    if (settled) return
    settled = true
    cleanup()
    resolve(response)
  }
  const onResponse = (_event: Electron.IpcMainEvent, response: unknown): void => {
    if (isSurfaceContextResponse(response, request.requestId)) {
      settle(response)
    }
  }
  const onDestroyed = (): void => settle(null)

  ipc.on('mt::document-surface-context-response', onResponse)
  win.webContents.once('destroyed', onDestroyed)
  timer = setTimeout(() => settle(null), CONTEXT_QUERY_TIMEOUT_MS)

  try {
    if (frame.isDestroyed()) {
      settle(null)
      return
    }
    frame.send('mt::query-document-surface-context', request)
  } catch (error) {
    log.warn(
      'Unable to query the authenticated document surface context.',
      error
    )
    settle(null)
  }
})

const editCommentMenuItem = (
  win: BrowserWindow
): MenuItemConstructorOptions => ({
  id: 'editCriticMarkupCommentMenuItem',
  label: t('contextMenu.editComment'),
  click() {
    executePendingCriticMarkupCommentEdit(win)
  }
})

const popupEditorContextMenu = (
  win: BrowserWindow,
  params: ContextMenuParams,
  surface: Exclude<DocumentSurface, 'source'>,
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

  const hasText = selectionText.length > 0
  const canMutate = surface === 'markup'
  const canCut = canMutate && hasText && editFlags.canCut
  const canCopy = hasText && editFlags.canCopy
  const canPaste = canMutate && editFlags.canPaste
  const consumerPolicy = documentClipboardConsumerPolicy({
    surface,
    hasSelection: hasText
  })
  const isMisspelled =
    canMutate && isEditable && !!selectionText && !!misspelledWord

  const menu = new Menu()
  if (editCommentRequest && params.frame) {
    menu.append(new MenuItem(editCommentMenuItem(win)))
    menu.append(new MenuItem(SEPARATOR))
  }
  if (isSpellcheckerEnabled && canMutate) {
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
  const availability = new Map<string, boolean>([
    ['insertParagraphBeforeMenuItem', canMutate],
    ['insertParagraphAfterMenuItem', canMutate],
    ['cutMenuItem', canCut],
    ['copyMenuItem', canCopy],
    ['pasteMenuItem', canPaste],
    ['copyAsRichMenuItem', consumerPolicy.copyAsRich],
    ['copyAsHtmlMenuItem', consumerPolicy.copyAsHtml],
    [
      'pasteAsPlainTextMenuItem',
      consumerPolicy.pasteAsPlainText && editFlags.canPaste
    ]
  ])
  contextItems.forEach((item) => {
    if (item.id) item.enabled = availability.get(item.id) ?? item.enabled
    menu.append(new MenuItem(item))
  })
  presentationPolicy.popupMenu(menu, { window: win, x: params.x, y: params.y })
}

const popupPlainTextContextMenu = (
  win: BrowserWindow,
  params: ContextMenuParams
): void => {
  const menu = new Menu()
  const cut = getCUT()
  const copy = getCOPY()
  const paste = getPASTE()
  cut.enabled =
    params.selectionText.length > 0 && params.editFlags.canCut
  copy.enabled =
    params.selectionText.length > 0 && params.editFlags.canCopy
  paste.enabled = params.editFlags.canPaste
  for (const item of [cut, copy, paste]) {
    menu.append(new MenuItem(item))
  }
  presentationPolicy.popupMenu(menu, {
    window: win,
    x: params.x,
    y: params.y
  })
}

export const showEditorContextMenu = async(
  win: BrowserWindow,
  _event: ContextMenuEvent,
  params: ContextMenuParams,
  isSpellcheckerEnabled: boolean
): Promise<void> => {
  const { hasImageContents } = params
  clearCriticMarkupCommentEdit(win)
  const epoch = (contextMenuEpoch.get(win) ?? 0) + 1
  contextMenuEpoch.set(win, epoch)

  // NOTE: We have to get the word suggestions from this event because `webFrame.getWordSuggestions` and
  //       `webFrame.isWordMisspelled` doesn't work on Windows (Electron#28684).

  if (hasImageContents) return
  if (!params.frame) return

  // The exact originating frame authenticates both the document surface and
  // any parser-owned Comment target. Electron edit flags are capabilities
  // only; they never decide whether this is Markup, Source, Original, Revised,
  // or an unrelated renderer target.
  const [surfaceResponse, commentResponse] = await Promise.all([
    queryDocumentSurfaceContext(
      win,
      params.frame,
      nextSurfaceContextRequest(params)
    ),
    queryEditorContext(win, params.frame, nextContextRequest(params))
  ])
  if (contextMenuEpoch.get(win) !== epoch || win.webContents.isDestroyed()) return
  if (surfaceResponse?.surface === null || surfaceResponse === null) return

  const editRequest =
    commentResponse?.documentId === surfaceResponse.documentId &&
    commentResponse.target?.revisionId === surfaceResponse.revisionId
      ? {
        documentId: commentResponse.documentId,
        target: commentResponse.target
      }
      : null
  if (editRequest !== null && params.frame) {
    armCriticMarkupCommentEdit(win, params.frame, editRequest)
  }

  if (surfaceResponse.surface === 'source') {
    popupPlainTextContextMenu(win, params)
    return
  }
  popupEditorContextMenu(
    win,
    params,
    surfaceResponse.surface,
    isSpellcheckerEnabled,
    editRequest
  )
}
