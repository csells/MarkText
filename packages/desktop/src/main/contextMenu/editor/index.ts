import { Menu, MenuItem, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import {
  getCUT,
  getCOPY,
  getPASTE,
  getCopyAsRich,
  getCopyAsHtml,
  getPasteAsPlainText,
  getLookUp,
  SEPARATOR,
  getInsertBefore,
  getInsertAfter
} from './menuItems'
import spellcheckMenuBuilder from './spellcheck'
import type { ReviewContextReply } from '../../../common/commands/review'
import { reviewCommands } from '../../../common/commands/review'
import { reviewMenuItems } from '../../menu/actions/review'
import { t } from '../../i18n'
import { isOsx } from '../../config'

// Electron's ContextMenuParams shape we rely on. Kept narrow — the renderer
// supplies the full surface so we only annotate the fields we use.
interface ContextMenuParams {
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

export const showEditorContextMenu = (
  win: BrowserWindow,
  event: ContextMenuEvent,
  params: ContextMenuParams,
  isSpellcheckerEnabled: boolean,
  reviewContext?: ReviewContextReply
): void => {
  const {
    isEditable,
    hasImageContents,
    selectionText,
    editFlags,
    misspelledWord,
    dictionarySuggestions
  } = params

  // NOTE: We have to get the word suggestions from this event because `webFrame.getWordSuggestions` and
  //       `webFrame.isWordMisspelled` doesn't work on Windows (Electron#28684).

  // Make sure that the request comes from a contenteditable inside the editor container.
  if ((isInsideEditor(params) || (reviewContext?.commands?.length ?? 0) > 0) && !hasImageContents) {
    const hasText = selectionText.trim().length > 0
    const canCopy = hasText && editFlags.canCut && editFlags.canCopy
    // const canPaste = hasText && editFlags.canPaste
    const isMisspelled = isEditable && !!selectionText && !!misspelledWord

    const menu = new Menu()
    if (isOsx && hasText) {
      menu.append(new MenuItem(getLookUp(selectionText)))
      menu.append(new MenuItem(SEPARATOR))
    }

    if (isSpellcheckerEnabled && isInsideEditor(params)) {
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

    const authorItems = reviewMenuItems(undefined, win).filter(item =>
      ['critic-show', 'critic-add-comment', 'critic-mark-highlight', 'critic-mark-addition', 'critic-suggest-replacement'].includes(item.id ?? '')
    )
    for (const command of reviewContext?.commands ?? []) {
      const descriptor = reviewCommands.find(item => item.id === command)!
      authorItems.push({
        id: `critic-${command}`,
        label: t(`editor.coreReview.${descriptor.label}`),
        enabled: true,
        click: () => win.webContents.send('mt::editor-review-context-action', { requestId: reviewContext!.requestId, command })
      })
    }
    menu.append(new MenuItem({ label: t('editor.coreReview.panelTitle'), submenu: authorItems }))
    menu.append(new MenuItem(SEPARATOR))
    const contextItems = isInsideEditor(params) ? getContextItems() : []
    const copyItemIds = new Set([
      'cutMenuItem',
      'copyMenuItem',
      'copyAsHtmlMenuItem',
      'copyAsRichMenuItem'
    ])
    contextItems.forEach((item) => {
      if (item.id && copyItemIds.has(item.id)) {
        item.enabled = canCopy
      }
      menu.append(new MenuItem(item))
    })
    // The original JS passes an array literal here, which Electron treats as
    // the options object. Cast to satisfy the typed overload.
    // The original JS passed an array literal — Electron tolerated it. The
    // typed overload wants an options object, so produce one explicitly.
    // `event` is intentionally unused (params carries x/y); the function
    // signature keeps it to mirror the webContents.on('context-menu', ...)
    // (event, params) shape.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    event
    menu.popup({
      window: win,
      x: params.x,
      y: params.y,
      ...(reviewContext
        ? {
          callback: () => {
            if (!win.webContents.isDestroyed()) win.webContents.send('mt::editor-review-context-closed', reviewContext.requestId)
          }
        }
        : {})
    })
  }
}
