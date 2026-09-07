import { type BrowserWindow, type Menu, type MenuItemConstructorOptions } from 'electron'
import { reviewCommands, reviewCommandEnabled, type ReviewCommand, type ReviewCommandState } from 'common/commands/review'
import { t } from '../../i18n'
import type { CommandManager } from '../../commands'
import type Keybindings from '../../keyboard/shortcutHandler'

const states = new WeakMap<BrowserWindow, ReviewCommandState>()
export const executeReviewCommand = (win: BrowserWindow | null | undefined, command: ReviewCommand): void => {
  if (win && reviewCommandEnabled(command, states.get(win))) win.webContents.send('mt::editor-review-action', command)
}
export const reviewMenuItems = (keybindings?: Keybindings, win?: BrowserWindow): MenuItemConstructorOptions[] => reviewCommands.map(command => ({
  id: `critic-${command.id}`,
  label: t(`editor.coreReview.${command.label}`),
  enabled: reviewCommandEnabled(command.id, win && states.get(win)),
  ...(['markup', 'original', 'revised'].includes(command.id) ? { type: 'radio' as const, checked: command.id === (win ? states.get(win)?.mode : 'markup') } : {}),
  ...(command.id === 'track-changes' ? { type: 'checkbox' as const, checked: win ? states.get(win)?.tracking ?? false : false } : {}),
  accelerator: keybindings?.getAccelerator(`review.${command.id}`) ?? undefined,
  click: (_item, target) => executeReviewCommand(win ?? target as BrowserWindow | undefined, command.id)
}))
export const updateReviewMenu = (menu: Menu, win: BrowserWindow, state: ReviewCommandState): void => {
  states.set(win, state)
  for (const command of reviewCommands) {
    const item = menu.getMenuItemById(`critic-${command.id}`)
    if (item) {
      item.enabled = reviewCommandEnabled(command.id, state)
      if (command.id === 'track-changes') item.checked = state.tracking
      if (command.id === state.mode) item.checked = true
    }
  }
}
export const loadReviewCommands = (manager: CommandManager): void => {
  for (const command of reviewCommands) manager.add(`review.${command.id}`, (win: BrowserWindow) => executeReviewCommand(win, command.id))
}
