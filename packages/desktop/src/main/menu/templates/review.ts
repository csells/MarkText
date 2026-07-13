import { type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import {
  REVIEW_COMMAND_DESCRIPTORS,
  type ReviewCommand,
  type ReviewCommandDescriptor,
  type ReviewCommandGroup
} from '../../../common/commands/review'
import { executeReviewCommand } from '../actions/review'
import { t } from '../../i18n'
import type Keybindings from '../../keyboard/shortcutHandler'

const commandsIn = (group: ReviewCommandGroup): readonly ReviewCommand[] =>
  REVIEW_COMMAND_DESCRIPTORS.filter((descriptor) => descriptor.group === group)

export default function(keybindings: Keybindings): MenuItemConstructorOptions {
  const item = (descriptor: ReviewCommand): MenuItemConstructorOptions => {
    const metadata: ReviewCommandDescriptor = descriptor
    return {
      id: metadata.menuId,
      label: t(metadata.menuLabelKey),
      type: metadata.menuType,
      ...(metadata.checkedState ? { checked: false } : {}),
      ...(metadata.projection ? { checked: metadata.projection === 'marked' } : {}),
      // Review capabilities depend on a live WYSIWYG document and selection.
      // Fail closed until the renderer publishes the first engine snapshot.
      enabled: false,
      accelerator: keybindings.getAccelerator(metadata.id) ?? undefined,
      click(_menuItem, focusedWindow) {
        executeReviewCommand(focusedWindow as BrowserWindow | undefined, descriptor.id)
      }
    }
  }

  const tracking = commandsIn('tracking')
  const authoring = commandsIn('authoring')
  const navigation = commandsIn('navigation')
  const resolution = commandsIn('resolution')
  const projection = commandsIn('projection')

  return {
    id: 'reviewMenuItem',
    label: t('menu.review.review'),
    submenu: [
      ...tracking.map(item),
      { type: 'separator' },
      ...authoring.map(item),
      { type: 'separator' },
      ...navigation.map(item),
      { type: 'separator' },
      ...resolution.map(item),
      { type: 'separator' },
      {
        id: 'reviewDisplayMenuItem',
        label: t('menu.review.display'),
        enabled: false,
        submenu: projection.map(item)
      }
    ]
  }
}
