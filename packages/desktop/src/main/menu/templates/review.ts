import { type MenuItemConstructorOptions } from 'electron'
import { reviewMenuItems } from '../actions/review'
import { t } from '../../i18n'
import type Keybindings from '../../keyboard/shortcutHandler'

// Commands are grouped as authoring, tracking, navigation, resolution, views,
// then the sidebar tab, with a separator before each group after the first.
const groupStarts = new Set([
  'critic-track-changes',
  'critic-previous',
  'critic-edit-comment',
  'critic-markup',
  'critic-show'
])

export default function(keybindings: Keybindings): MenuItemConstructorOptions {
  const items = reviewMenuItems(keybindings)
  const order = [
    'critic-add-comment',
    'critic-mark-highlight',
    'critic-mark-addition',
    'critic-suggest-replacement',
    'critic-track-changes',
    'critic-previous',
    'critic-next',
    'critic-edit-comment',
    'critic-accept',
    'critic-reject',
    'critic-remove',
    'critic-accept-all',
    'critic-reject-all',
    'critic-markup',
    'critic-original',
    'critic-revised',
    'critic-show'
  ]
  const submenu: MenuItemConstructorOptions[] = []
  for (const id of order) {
    const item = items.find((candidate) => candidate.id === id)
    if (item === undefined) continue
    if (submenu.length > 0 && groupStarts.has(id)) submenu.push({ type: 'separator' })
    submenu.push(item)
  }
  return { id: 'reviewMenuEntry', label: t('editor.coreReview.panelTitle'), submenu }
}
