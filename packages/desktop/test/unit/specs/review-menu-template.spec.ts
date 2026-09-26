import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('main_renderer/menu/actions/format', () => ({}))
vi.mock('main_renderer/config', () => ({ isOsx: true }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import formatMenuTemplate from 'main_renderer/menu/templates/format'
import reviewMenuTemplate from 'main_renderer/menu/templates/review'

const keybindings = { getAccelerator: (id: string) => (id === 'review.add-comment' ? 'Command+Alt+Shift+M' : undefined) }

describe('Review menu', () => {
  it('is a top-level menu grouping authoring, tracking, navigation, resolution and views', () => {
    const menu = reviewMenuTemplate(keybindings as never)
    expect(menu.label).toBe('editor.coreReview.panelTitle')
    const items = menu.submenu as MenuItemConstructorOptions[]
    expect(items.map(item => item.type === 'separator' ? '---' : item.id)).toEqual([
      'critic-add-comment',
      'critic-mark-highlight',
      'critic-mark-addition',
      'critic-suggest-replacement',
      '---',
      'critic-track-changes',
      '---',
      'critic-previous',
      'critic-next',
      '---',
      'critic-edit-comment',
      'critic-accept',
      'critic-reject',
      'critic-remove',
      'critic-accept-all',
      'critic-reject-all',
      '---',
      'critic-markup',
      'critic-original',
      'critic-revised',
      '---',
      'critic-show'
    ])
    expect(items.find(item => item.id === 'critic-add-comment')?.accelerator).toBe('Command+Alt+Shift+M')
  })

  it('no longer nests Review inside Format', () => {
    const format = formatMenuTemplate(keybindings as never)
    const items = format.submenu as MenuItemConstructorOptions[]
    expect(items.some(item => item.label === 'editor.coreReview.panelTitle')).toBe(false)
  })
})
