import type { BrowserWindow, Menu } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import { restoreReviewMenu, updateReviewMenu } from 'main_renderer/menu/actions/review'
import { reviewCommands, type ReviewCommandState } from '../../../src/common/commands/review'

const fakeMenu = () => {
  const items = new Map(reviewCommands.map(command => [`critic-${command.id}`, { enabled: false, checked: false }]))
  return { menu: { getMenuItemById: (id: string) => items.get(id) ?? null } as unknown as Menu, items }
}

const state: ReviewCommandState = {
  available: true,
  editable: true,
  canAuthor: true,
  canTrack: true,
  tracking: true,
  hasItem: false,
  targeted: false,
  hasComment: false,
  removable: false,
  busy: false,
  mode: 'markup'
}

// A theme, language or keybinding change rebuilds the menu from its template;
// the renderer resends review state only when it changes, so the rebuilt menu
// must take the window's last state back (the Review menu was left disabled).
describe('rebuilt Review menu', () => {
  it('takes back the window\'s last review state', () => {
    const win = {} as BrowserWindow
    updateReviewMenu(fakeMenu().menu, win, state)
    const rebuilt = fakeMenu()
    restoreReviewMenu(rebuilt.menu, win)
    expect(rebuilt.items.get('critic-add-comment')?.enabled).toBe(true)
    expect(rebuilt.items.get('critic-track-changes')?.checked).toBe(true)
    expect(rebuilt.items.get('critic-markup')?.checked).toBe(true)
  })

  it('leaves a window without review state alone', () => {
    const rebuilt = fakeMenu()
    restoreReviewMenu(rebuilt.menu, {} as BrowserWindow)
    restoreReviewMenu(rebuilt.menu, null)
    expect(rebuilt.items.get('critic-add-comment')?.enabled).toBe(false)
  })
})
