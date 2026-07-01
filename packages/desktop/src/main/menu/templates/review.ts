import { type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import * as actions from '../actions/edit'
import { COMMANDS } from '../../commands'
import { t } from '../../i18n'
import type Keybindings from '../../keyboard/shortcutHandler'

export default function(keybindings: Keybindings): MenuItemConstructorOptions {
  return {
    label: t('menu.review.review'),
    submenu: [
      {
        label: t('menu.review.addComment'),
        id: COMMANDS.REVIEW_ADD_COMMENT,
        enabled: false,
        accelerator: keybindings.getAccelerator(COMMANDS.REVIEW_ADD_COMMENT) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.editorAddComment(browserWindow as BrowserWindow | undefined)
        }
      }
    ]
  }
}
