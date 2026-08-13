import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { register } = vi.hoisted(() => ({
  register: vi.fn()
}))

vi.mock('electron', () => ({
  shell: { openPath: vi.fn() }
}))

vi.mock('@hfelix/electron-localshortcut', () => ({
  electronLocalshortcut: {
    register,
    unregister: vi.fn(),
    setKeyboardLayout: vi.fn()
  },
  isValidElectronAccelerator: () => true
}))

vi.mock('main_renderer/keyboard', () => ({
  getKeyboardInfo: () => ({ layout: {}, keymap: {} }),
  keyboardLayoutMonitor: { addListener: vi.fn() }
}))

import { COMMANDS, type CommandCallback } from 'main_renderer/commands'
import keybindingsDarwin from 'main_renderer/keyboard/keybindingsDarwin'
import keybindingsLinux from 'main_renderer/keyboard/keybindingsLinux'
import Keybindings from 'main_renderer/keyboard/shortcutHandler'
import keybindingsWindows from 'main_renderer/keyboard/keybindingsWindows'
import { loadFormatCommands } from 'main_renderer/menu/actions/format'
import { loadParagraphCommands } from 'main_renderer/menu/actions/paragraph'

type ActionExpectation = Readonly<{
  channel: 'mt::editor-format-action' | 'mt::editor-paragraph-action'
  type: string
}>

const actionByCommand: Readonly<Record<string, ActionExpectation>> = Object.freeze({
  [COMMANDS.PARAGRAPH_HEADING_1]: {
    channel: 'mt::editor-paragraph-action',
    type: 'heading 1'
  },
  [COMMANDS.PARAGRAPH_HEADING_2]: {
    channel: 'mt::editor-paragraph-action',
    type: 'heading 2'
  },
  [COMMANDS.PARAGRAPH_HEADING_3]: {
    channel: 'mt::editor-paragraph-action',
    type: 'heading 3'
  },
  [COMMANDS.PARAGRAPH_HEADING_4]: {
    channel: 'mt::editor-paragraph-action',
    type: 'heading 4'
  },
  [COMMANDS.PARAGRAPH_HEADING_5]: {
    channel: 'mt::editor-paragraph-action',
    type: 'heading 5'
  },
  [COMMANDS.PARAGRAPH_HEADING_6]: {
    channel: 'mt::editor-paragraph-action',
    type: 'heading 6'
  },
  [COMMANDS.PARAGRAPH_INCREASE_HEADING]: {
    channel: 'mt::editor-paragraph-action',
    type: 'upgrade heading'
  },
  [COMMANDS.PARAGRAPH_DEGRADE_HEADING]: {
    channel: 'mt::editor-paragraph-action',
    type: 'degrade heading'
  },
  [COMMANDS.PARAGRAPH_TABLE]: {
    channel: 'mt::editor-paragraph-action',
    type: 'table'
  },
  [COMMANDS.PARAGRAPH_CODE_FENCE]: {
    channel: 'mt::editor-paragraph-action',
    type: 'pre'
  },
  [COMMANDS.PARAGRAPH_QUOTE_BLOCK]: {
    channel: 'mt::editor-paragraph-action',
    type: 'blockquote'
  },
  [COMMANDS.PARAGRAPH_MATH_FORMULA]: {
    channel: 'mt::editor-paragraph-action',
    type: 'mathblock'
  },
  [COMMANDS.PARAGRAPH_HTML_BLOCK]: {
    channel: 'mt::editor-paragraph-action',
    type: 'html'
  },
  [COMMANDS.PARAGRAPH_ORDERED_LIST]: {
    channel: 'mt::editor-paragraph-action',
    type: 'ol-order'
  },
  [COMMANDS.PARAGRAPH_BULLET_LIST]: {
    channel: 'mt::editor-paragraph-action',
    type: 'ul-bullet'
  },
  [COMMANDS.PARAGRAPH_TASK_LIST]: {
    channel: 'mt::editor-paragraph-action',
    type: 'ul-task'
  },
  [COMMANDS.PARAGRAPH_LOOSE_LIST_ITEM]: {
    channel: 'mt::editor-paragraph-action',
    type: 'loose-list-item'
  },
  [COMMANDS.PARAGRAPH_PARAGRAPH]: {
    channel: 'mt::editor-paragraph-action',
    type: 'paragraph'
  },
  [COMMANDS.PARAGRAPH_HORIZONTAL_LINE]: {
    channel: 'mt::editor-paragraph-action',
    type: 'hr'
  },
  [COMMANDS.PARAGRAPH_FRONT_MATTER]: {
    channel: 'mt::editor-paragraph-action',
    type: 'front-matter'
  },
  [COMMANDS.FORMAT_STRONG]: { channel: 'mt::editor-format-action', type: 'strong' },
  [COMMANDS.FORMAT_EMPHASIS]: { channel: 'mt::editor-format-action', type: 'em' },
  [COMMANDS.FORMAT_UNDERLINE]: { channel: 'mt::editor-format-action', type: 'u' },
  [COMMANDS.FORMAT_HIGHLIGHT]: { channel: 'mt::editor-format-action', type: 'mark' },
  [COMMANDS.FORMAT_INLINE_CODE]: { channel: 'mt::editor-format-action', type: 'inline_code' },
  [COMMANDS.FORMAT_INLINE_MATH]: { channel: 'mt::editor-format-action', type: 'inline_math' },
  [COMMANDS.FORMAT_STRIKE]: { channel: 'mt::editor-format-action', type: 'del' },
  [COMMANDS.FORMAT_HYPERLINK]: { channel: 'mt::editor-format-action', type: 'link' },
  [COMMANDS.FORMAT_IMAGE]: { channel: 'mt::editor-format-action', type: 'image' },
  [COMMANDS.FORMAT_CLEAR_FORMAT]: { channel: 'mt::editor-format-action', type: 'clear' }
})

const commonWindowsLinuxAccelerators = {
  [COMMANDS.PARAGRAPH_INCREASE_HEADING]: 'Ctrl+Plus',
  [COMMANDS.PARAGRAPH_DEGRADE_HEADING]: 'Ctrl+-',
  [COMMANDS.PARAGRAPH_TABLE]: 'Ctrl+Shift+T',
  [COMMANDS.PARAGRAPH_CODE_FENCE]: 'Ctrl+Shift+K',
  [COMMANDS.PARAGRAPH_QUOTE_BLOCK]: 'Ctrl+Shift+Q',
  [COMMANDS.PARAGRAPH_HTML_BLOCK]: 'Ctrl+Alt+H',
  [COMMANDS.PARAGRAPH_ORDERED_LIST]: 'Ctrl+G',
  [COMMANDS.PARAGRAPH_BULLET_LIST]: 'Ctrl+H',
  [COMMANDS.PARAGRAPH_PARAGRAPH]: 'Ctrl+Shift+0',
  [COMMANDS.FORMAT_STRONG]: 'Ctrl+B',
  [COMMANDS.FORMAT_EMPHASIS]: 'Ctrl+I',
  [COMMANDS.FORMAT_UNDERLINE]: 'Ctrl+U',
  [COMMANDS.FORMAT_HIGHLIGHT]: 'Ctrl+Shift+H',
  [COMMANDS.FORMAT_INLINE_MATH]: 'Ctrl+Shift+M',
  [COMMANDS.FORMAT_STRIKE]: 'Ctrl+D',
  [COMMANDS.FORMAT_HYPERLINK]: 'Ctrl+L',
  [COMMANDS.FORMAT_IMAGE]: 'Ctrl+Shift+I',
  [COMMANDS.FORMAT_CLEAR_FORMAT]: 'Ctrl+Shift+R'
} as const

const platformCases = [
  {
    name: 'macOS',
    defaults: keybindingsDarwin,
    expected: {
      [COMMANDS.PARAGRAPH_HEADING_1]: 'Command+1',
      [COMMANDS.PARAGRAPH_HEADING_2]: 'Command+2',
      [COMMANDS.PARAGRAPH_HEADING_3]: 'Command+3',
      [COMMANDS.PARAGRAPH_HEADING_4]: 'Command+4',
      [COMMANDS.PARAGRAPH_HEADING_5]: 'Command+5',
      [COMMANDS.PARAGRAPH_HEADING_6]: 'Command+6',
      [COMMANDS.PARAGRAPH_INCREASE_HEADING]: 'Command+=',
      [COMMANDS.PARAGRAPH_DEGRADE_HEADING]: 'Command+-',
      [COMMANDS.PARAGRAPH_TABLE]: 'Command+Shift+T',
      [COMMANDS.PARAGRAPH_CODE_FENCE]: 'Command+Option+C',
      [COMMANDS.PARAGRAPH_QUOTE_BLOCK]: 'Command+Option+Q',
      [COMMANDS.PARAGRAPH_MATH_FORMULA]: 'Command+Option+M',
      [COMMANDS.PARAGRAPH_HTML_BLOCK]: 'Command+Option+J',
      [COMMANDS.PARAGRAPH_ORDERED_LIST]: 'Command+Option+O',
      [COMMANDS.PARAGRAPH_BULLET_LIST]: 'Command+Option+U',
      [COMMANDS.PARAGRAPH_TASK_LIST]: 'Command+Option+X',
      [COMMANDS.PARAGRAPH_LOOSE_LIST_ITEM]: 'Command+Option+L',
      [COMMANDS.PARAGRAPH_PARAGRAPH]: 'Command+0',
      [COMMANDS.PARAGRAPH_HORIZONTAL_LINE]: 'Command+Option+-',
      [COMMANDS.PARAGRAPH_FRONT_MATTER]: 'Command+Option+Y',
      [COMMANDS.FORMAT_STRONG]: 'Command+B',
      [COMMANDS.FORMAT_EMPHASIS]: 'Command+I',
      [COMMANDS.FORMAT_UNDERLINE]: 'Command+U',
      [COMMANDS.FORMAT_HIGHLIGHT]: 'Shift+Command+H',
      [COMMANDS.FORMAT_INLINE_CODE]: 'Command+`',
      [COMMANDS.FORMAT_INLINE_MATH]: 'Shift+Command+M',
      [COMMANDS.FORMAT_STRIKE]: 'Command+D',
      [COMMANDS.FORMAT_HYPERLINK]: 'Command+L',
      [COMMANDS.FORMAT_IMAGE]: 'Command+Shift+I',
      [COMMANDS.FORMAT_CLEAR_FORMAT]: 'Shift+Command+R'
    }
  },
  {
    name: 'Linux',
    defaults: keybindingsLinux,
    expected: {
      ...commonWindowsLinuxAccelerators,
      [COMMANDS.PARAGRAPH_HEADING_1]: 'Ctrl+Alt+1',
      [COMMANDS.PARAGRAPH_HEADING_2]: 'Ctrl+Alt+2',
      [COMMANDS.PARAGRAPH_HEADING_3]: 'Ctrl+Alt+3',
      [COMMANDS.PARAGRAPH_HEADING_4]: 'Ctrl+Alt+4',
      [COMMANDS.PARAGRAPH_HEADING_5]: 'Ctrl+Alt+5',
      [COMMANDS.PARAGRAPH_HEADING_6]: 'Ctrl+Alt+6',
      [COMMANDS.PARAGRAPH_MATH_FORMULA]: 'Ctrl+Alt+M',
      [COMMANDS.PARAGRAPH_TASK_LIST]: 'Ctrl+Shift+X',
      [COMMANDS.PARAGRAPH_LOOSE_LIST_ITEM]: 'Ctrl+Shift+L',
      [COMMANDS.PARAGRAPH_HORIZONTAL_LINE]: 'Ctrl+_',
      [COMMANDS.PARAGRAPH_FRONT_MATTER]: 'Ctrl+Shift+Y',
      [COMMANDS.FORMAT_INLINE_CODE]: 'Ctrl+Y'
    }
  },
  {
    name: 'Windows',
    defaults: keybindingsWindows,
    expected: {
      ...commonWindowsLinuxAccelerators,
      [COMMANDS.PARAGRAPH_MATH_FORMULA]: 'Ctrl+Alt+N',
      [COMMANDS.PARAGRAPH_TASK_LIST]: 'Ctrl+Alt+X',
      [COMMANDS.PARAGRAPH_LOOSE_LIST_ITEM]: 'Ctrl+Alt+L',
      [COMMANDS.PARAGRAPH_HORIZONTAL_LINE]: 'Ctrl+Shift+U',
      [COMMANDS.PARAGRAPH_FRONT_MATTER]: 'Ctrl+Alt+Y',
      [COMMANDS.FORMAT_INLINE_CODE]: 'Ctrl+`'
    }
  }
] as const

const commandCallbacks = new Map<string, CommandCallback>()
const commandManager = {
  add(id: string, callback: CommandCallback): void {
    if (commandCallbacks.has(id)) {
      throw new Error(`Duplicate test command registration: ${id}`)
    }
    commandCallbacks.set(id, callback)
  },
  has(id: string): boolean {
    return commandCallbacks.has(id)
  },
  execute(id: string, ...args: unknown[]): unknown {
    const callback = commandCallbacks.get(id)
    if (!callback) {
      throw new Error(`No test command registered for ${id}`)
    }
    return callback(...args)
  }
}

loadParagraphCommands(commandManager as never)
loadFormatCommands(commandManager as never)

const send = vi.fn()
const fakeWindow = {
  webContents: { send }
} as unknown as BrowserWindow

describe('CriticMarkup paragraph and inline shortcut production surface', () => {
  beforeEach(() => {
    register.mockClear()
    send.mockClear()
  })

  it.each(platformCases)(
    'registers and dispatches every declared $name paragraph and inline-style accelerator',
    ({ defaults, expected }) => {
      const keybindings = new Keybindings(commandManager as never, {
        paths: { userDataPath: '/path/that/does/not/exist' },
        isDevMode: false
      } as never)
      keybindings.keys = new Map(defaults)
      keybindings.registerEditorKeyHandlers(fakeWindow)

      const productionIds = [...defaults]
        .filter(([id, accelerator]) =>
          (id.startsWith('paragraph.') || id.startsWith('format.')) && accelerator.length > 1
        )
        .map(([id]) => id)
        .sort()
      expect(productionIds).toEqual(Object.keys(expected).sort())

      for (const [commandId, accelerator] of Object.entries(expected)) {
        expect(defaults.get(commandId), commandId).toBe(accelerator)
        const registration = register.mock.calls.find(
          ([registeredWindow, registeredAccelerator]) =>
            registeredWindow === fakeWindow && registeredAccelerator === accelerator
        )
        expect(registration, `${commandId} (${accelerator})`).toBeDefined()
        if (!registration) {
          throw new Error(`Missing local shortcut registration for ${commandId} (${accelerator})`)
        }

        send.mockClear()
        const handled = (registration[2] as () => boolean)()
        expect(handled, commandId).toBe(true)
        const action = actionByCommand[commandId]
        expect(action, commandId).toBeDefined()
        expect(send.mock.calls, commandId).toEqual([[action.channel, { type: action.type }]])
      }
    }
  )
})
