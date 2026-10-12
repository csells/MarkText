import type { BrowserWindow, Input, Menu } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const beep = vi.fn()
vi.mock('electron', () => ({ shell: { beep: () => beep() } }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import {
  acceleratorMatchesInput,
  beepForDisabledReviewShortcut,
  updateReviewMenu
} from 'main_renderer/menu/actions/review'
import { reviewCommands, type ReviewCommandState } from '../../../src/common/commands/review'
import type Keybindings from '../../../src/main/keyboard/shortcutHandler'

// macOS answers a key equivalent whose command is unavailable
// with a beep. A disabled Review command's shortcut gives the same feedback.

const input = (overrides: Partial<Input>): Input => ({
  type: 'keyDown',
  key: '',
  code: '',
  isAutoRepeat: false,
  isComposing: false,
  shift: false,
  control: false,
  alt: false,
  meta: false,
  location: 0,
  modifiers: [],
  ...overrides
} as Input)
const addComment = input({ key: 'Dead', code: 'KeyM', meta: true, alt: true, shift: true })
const keybindings = {
  getAccelerator: (id: string) =>
    ({ 'review.add-comment': 'Command+Alt+Shift+M', 'review.next': 'Command+Alt+]' })[id] ?? null
} as unknown as Keybindings
const menu = { getMenuItemById: () => null } as unknown as Menu
const state = (canAuthor: boolean): ReviewCommandState => ({
  available: true,
  editable: true,
  canAuthor,
  canTrack: true,
  tracking: false,
  hasItem: false,
  targeted: false,
  hasComment: false,
  removable: false,
  busy: false,
  mode: 'markup'
})

beforeEach(() => beep.mockClear())

describe('Review shortcuts of unavailable commands', () => {
  it('match accelerators by the physical key Option and Shift change', () => {
    expect(acceleratorMatchesInput('Command+Alt+Shift+M', addComment)).toBe(true)
    expect(acceleratorMatchesInput('Command+Alt+]', input({ key: '‘', code: 'BracketRight', meta: true, alt: true }))).toBe(true)
    expect(acceleratorMatchesInput('Command+Alt+Shift+M', { ...addComment, shift: false })).toBe(false)
    expect(acceleratorMatchesInput('Command+Shift+E', input({ key: 'E', code: 'KeyE', control: true, shift: true }))).toBe(false)
  })

  it('beep when the command is disabled, once per press', () => {
    const win = {} as BrowserWindow
    updateReviewMenu(menu, win, state(false))
    expect(beepForDisabledReviewShortcut(win, addComment, keybindings)).toBe(true)
    expect(beepForDisabledReviewShortcut(win, { ...addComment, isAutoRepeat: true }, keybindings)).toBe(false)
    expect(beepForDisabledReviewShortcut(win, { ...addComment, type: 'keyUp' }, keybindings)).toBe(false)
    expect(beep).toHaveBeenCalledTimes(1)
  })

  it('stay silent when the command runs, and for other keys', () => {
    const win = {} as BrowserWindow
    updateReviewMenu(menu, win, state(true))
    expect(beepForDisabledReviewShortcut(win, addComment, keybindings)).toBe(false)
    expect(beepForDisabledReviewShortcut(win, input({ key: 'm', code: 'KeyM', meta: true }), keybindings)).toBe(false)
    expect(beep).not.toHaveBeenCalled()
    expect(reviewCommands.some(command => command.id === 'add-comment')).toBe(true)
  })
})
