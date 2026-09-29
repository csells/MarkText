import { shell, type BrowserWindow, type Input, type Menu, type MenuItemConstructorOptions } from 'electron'
import {
  reviewCommands,
  reviewCommandEnabled,
  type ReviewCommand,
  type ReviewCommandState
} from 'common/commands/review'
import { t } from '../../i18n'
import type { CommandManager } from '../../commands'
import type Keybindings from '../../keyboard/shortcutHandler'

const states = new WeakMap<BrowserWindow, ReviewCommandState>()
export const executeReviewCommand = (
  win: BrowserWindow | null | undefined,
  command: ReviewCommand
): void => {
  if (win && reviewCommandEnabled(command, states.get(win))) {
    win.webContents.send('mt::editor-review-action', command)
  }
}
export const reviewMenuItems = (
  keybindings?: Keybindings,
  win?: BrowserWindow
): MenuItemConstructorOptions[] =>
  reviewCommands.map((command) => ({
    id: `critic-${command.id}`,
    label: t(`editor.coreReview.${command.label}`),
    enabled: reviewCommandEnabled(command.id, win && states.get(win)),
    ...(['markup', 'original', 'revised'].includes(command.id)
      ? { type: 'radio' as const, checked: command.id === (win ? states.get(win)?.mode : 'markup') }
      : {}),
    ...(command.id === 'track-changes'
      ? { type: 'checkbox' as const, checked: win ? (states.get(win)?.tracking ?? false) : false }
      : {}),
    accelerator: keybindings?.getAccelerator(`review.${command.id}`) ?? undefined,
    click: (_item, target) =>
      executeReviewCommand(win ?? (target as BrowserWindow | undefined), command.id)
  }))
// Edit commands that change the document through the Markup editor. Format and
// Paragraph menus are disabled separately by the renderer's editor-mode state.
const markupEditMenuItems = [
  'pasteAsPlainTextMenuItem',
  'duplicateMenuItem',
  'createParagraphMenuItem',
  'deleteParagraphMenuItem',
  'replaceMenuItem'
]
export const updateReviewMenu = (
  menu: Menu,
  win: BrowserWindow,
  state: ReviewCommandState
): void => {
  states.set(win, state)
  const readerView = state.available && state.mode !== 'markup'
  for (const id of markupEditMenuItems) {
    const item = menu.getMenuItemById(id)
    if (item) item.enabled = !readerView
  }
  for (const command of reviewCommands) {
    const item = menu.getMenuItemById(`critic-${command.id}`)
    if (item) {
      item.enabled = reviewCommandEnabled(command.id, state)
      if (command.id === 'track-changes') item.checked = state.tracking
      if (command.id === state.mode) item.checked = true
    }
  }
}
/**
 * A rebuilt menu (theme, language or keybinding change) starts from the
 * template's defaults; give it back the window's last review state, which the
 * renderer sends only when that state changes.
 */
export const restoreReviewMenu = (menu: Menu, win: BrowserWindow | null | undefined): void => {
  const state = win ? states.get(win) : undefined
  if (win && state) updateReviewMenu(menu, win, state)
}
export const loadReviewCommands = (manager: CommandManager): void => {
  for (const command of reviewCommands) {
    manager.add(`review.${command.id}`, (win: BrowserWindow) =>
      executeReviewCommand(win, command.id)
    )
  }
}

const ACCELERATOR_CODES: Readonly<Record<string, string>> = {
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '-': 'Minus',
  '=': 'Equal',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  '`': 'Backquote'
}

/** Whether a key-down is the key and modifiers an Electron accelerator names. */
export const acceleratorMatchesInput = (accelerator: string, input: Input): boolean => {
  const parts = accelerator.split('+')
  const key = parts.pop()
  if (key === undefined || key === '') return false
  const modifiers = new Set(parts.map((part) => part.toLowerCase()))
  const meta = ['command', 'cmd', 'commandorcontrol', 'cmdorctrl', 'super', 'meta'].some((name) =>
    modifiers.has(name))
  const control = modifiers.has('control') || modifiers.has('ctrl')
  const alt = modifiers.has('alt') || modifiers.has('option')
  const shift = modifiers.has('shift')
  if (input.meta !== meta || input.control !== control || input.alt !== alt || input.shift !== shift) {
    return false
  }
  // Option and Shift change the character a key types, so match the physical key.
  const code = /^[a-z]$/iu.test(key)
    ? `Key${key.toUpperCase()}`
    : /^[0-9]$/u.test(key)
      ? `Digit${key}`
      : ACCELERATOR_CODES[key]
  return code === undefined ? input.key.toLowerCase() === key.toLowerCase() : input.code === code
}

/**
 * macOS answers a key equivalent whose command is unavailable with a beep. A
 * disabled Review command's shortcut reaches no menu item, so give the same
 * feedback; focus stays where it was. Returns whether it beeped.
 */
export const beepForDisabledReviewShortcut = (
  win: BrowserWindow,
  input: Input,
  keybindings: Keybindings
): boolean => {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return false
  for (const command of reviewCommands) {
    const accelerator = keybindings.getAccelerator(`review.${command.id}`)
    if (!accelerator || !acceleratorMatchesInput(accelerator, input)) continue
    if (reviewCommandEnabled(command.id, states.get(win))) return false
    shell.beep()
    return true
  }
  return false
}
