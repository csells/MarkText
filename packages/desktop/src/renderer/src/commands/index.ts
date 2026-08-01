// List of all static commands that are loaded into command center.
import bus from '../bus'
import { delay, isOsx } from '@/util'
import { isUpdatable } from './utils'
import getCommandDescriptionById from './descriptions'
import { t } from '../i18n'
import { openExternalResource } from '../services/presentationEffects'
import {
  REVIEW_COMMAND_DESCRIPTORS,
  isReviewCommandAvailable,
  type CriticMarkupReviewAction
} from '../../../common/commands/review'
import { useCriticMarkupReviewStore } from '@/store/criticMarkupReview'
import {
  useDocumentCapabilityStore
} from '@/store/documentCapabilities'
import type { EditorCommandId } from '@shared/types/editorCommands'

export { default as QuickOpenCommand } from './quickOpen'
export { default as SpellcheckerLanguageCommand } from './spellcheckerLanguage'

// Command shapes here are heterogeneous (some have `execute`, some have
// `subcommands` + `executeSubcommand`, some have `shortcut`, etc.). Mirrors
// the broad `CommandCallback = (...args: any[]) => any` style used in
// src/main/commands/index.ts.
export interface CommandSubcommand {
  id: string
  description?: string
  value?: unknown
  execute?: () => void | Promise<void>
  isAvailable?: () => boolean
}

export interface CommandDescriptor {
  id: string
  description?: string
  shortcut?: string[]
  subcommands?: CommandSubcommand[]
  execute?: () => void | Promise<void>
  isAvailable?: () => boolean
  executeSubcommand?: (commandId: string, value?: unknown) => void | Promise<void>
}

export class RootCommand {
  id: string
  description: string
  subcommands: CommandSubcommand[]
  subcommandSelectedIndex: number

  constructor(subcommands: CommandSubcommand[] = []) {
    this.id = '#'
    this.description = '#'
    this.subcommands = subcommands
    this.subcommandSelectedIndex = -1
  }

  async run(): Promise<void> {}
  async unload(): Promise<void> {}

  // Execute the command.
  async execute(): Promise<void> {
    throw new Error('Root command.')
  }
}

/**
 * G5: an intent-backed palette entry — one declaration carries the emit and
 * the availability predicate over the published capability snapshot.
 */
const editorCommand = (
  id: string,
  command: EditorCommandId
): CommandDescriptor => ({
  id,
  execute: async() => {
    focusEditorAndExecute(() => bus.emit('editor-command', command))
  },
  isAvailable: () => useDocumentCapabilityStore().commandEnabled(command)
})

const focusEditorAndExecute = (fn: () => void): void => {
  bus.emit('editor-focus')
  fn()
}

const executeReviewAction = (action: CriticMarkupReviewAction): void => {
  // Review actions are document-scoped. Capture their target in the
  // controller before a delayed callback could observe a different active tab.
  // Projection switches are exempt: they rebuild the editor and manage focus
  // themselves, and the pre-focus would force an O(document) cursor render
  // that the rebuild immediately discards.
  if (!action.startsWith('show-')) {
    bus.emit('editor-focus')
  }
  bus.emit('critic-markup-review', action)
}

const commands: CommandDescriptor[] = [
  // --------------------------------------------------------------------------
  // File

  {
    id: 'file.new-tab',
    execute: async() => {
      window.electron.ipcRenderer.send('mt::cmd-new-tab')
    }
  },
  {
    id: 'file.new-window',
    execute: async() => {
      window.electron.ipcRenderer.send('mt::cmd-new-editor-window')
    }
  },
  {
    id: 'file.open-file',
    execute: async() => {
      window.electron.ipcRenderer.send('mt::cmd-open-file')
    }
  },
  {
    id: 'file.open-folder',
    execute: async() => {
      window.electron.ipcRenderer.send('mt::cmd-open-folder')
    }
  },
  {
    id: 'file.save',
    execute: async() => {
      bus.emit('mt::editor-ask-file-save')
    }
  },
  {
    id: 'file.save-as',
    execute: async() => {
      bus.emit('mt::editor-ask-file-save-as')
    }
  },
  {
    id: 'file.print',
    execute: async() => {
      await delay(50)
      bus.emit('showExportDialog', 'print')
    }
  },
  {
    id: 'file.close-tab',
    execute: async() => {
      bus.emit('mt::editor-close-tab', null)
    }
  },
  {
    id: 'file.close-window',
    execute: async() => {
      window.electron.ipcRenderer.send('mt::cmd-close-window')
    }
  },

  {
    id: 'file.toggle-auto-save',
    execute: async() => {
      window.electron.ipcRenderer.send('mt::cmd-toggle-autosave')
    }
  },
  {
    id: 'file.move-file',
    execute: async() => {
      bus.emit('mt::editor-move-file', null)
    }
  },
  {
    id: 'file.rename-file',
    execute: async() => {
      await delay(50)
      bus.emit('mt::editor-rename-file', null)
    }
  },
  {
    id: 'file.import-file',
    execute: async() => {
      window.electron.ipcRenderer.send('mt::cmd-import-file')
    }
  },
  {
    id: 'file.export-file',
    subcommands: [
      {
        id: 'file.export-file-html',
        description: 'Export as HTML',
        execute: async() => {
          await delay(50)
          bus.emit('showExportDialog', 'styledHtml')
        }
      },
      {
        id: 'file.export-file-pdf',
        description: 'Export as PDF',
        execute: async() => {
          await delay(50)
          bus.emit('showExportDialog', 'pdf')
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // Edit

  editorCommand('edit.undo', 'undo'),
  editorCommand('edit.redo', 'redo'),
  editorCommand('edit.duplicate', 'duplicate-block'),
  editorCommand('edit.create-paragraph', 'insert-paragraph'),
  editorCommand('edit.delete-paragraph', 'delete-block'),
  {
    id: 'edit.find',
    execute: async() => {
      bus.emit('editor-command', 'find')
    }
  },
  {
    id: 'edit.find-next',
    execute: async() => {
      bus.emit('editor-command', 'find-next')
    }
  },
  {
    id: 'edit.find-previous',
    execute: async() => {
      bus.emit('editor-command', 'find-previous')
    }
  },
  {
    id: 'edit.replace',
    execute: async() => {
      bus.emit('editor-command', 'replace')
    }
  },
  {
    id: 'edit.find-in-folder',
    execute: async() => {
      bus.emit('editor-command', 'find-in-folder')
    }
  },

  // --------------------------------------------------------------------------
  // Paragraph

  editorCommand('paragraph.heading-1', 'heading-1'),
  editorCommand('paragraph.heading-2', 'heading-2'),
  editorCommand('paragraph.heading-3', 'heading-3'),
  editorCommand('paragraph.heading-4', 'heading-4'),
  editorCommand('paragraph.heading-5', 'heading-5'),
  editorCommand('paragraph.heading-6', 'heading-6'),
  editorCommand('paragraph.upgrade-heading', 'upgrade-heading'),
  editorCommand('paragraph.degrade-heading', 'degrade-heading'),
  editorCommand('paragraph.table', 'insert-table'),
  editorCommand('paragraph.code-fence', 'code-fence'),
  editorCommand('paragraph.quote-block', 'quote-block'),
  editorCommand('paragraph.math-formula', 'math-block'),
  editorCommand('paragraph.html-block', 'html-block'),
  editorCommand('paragraph.order-list', 'ordered-list'),
  editorCommand('paragraph.bullet-list', 'bullet-list'),
  editorCommand('paragraph.task-list', 'task-list'),
  editorCommand('paragraph.loose-list-item', 'loose-list-item'),
  editorCommand('paragraph.paragraph', 'paragraph'),
  editorCommand('paragraph.reset-paragraph', 'paragraph'),
  editorCommand('paragraph.horizontal-line', 'thematic-break'),
  editorCommand('paragraph.front-matter', 'front-matter'),

  // --------------------------------------------------------------------------
  // Format

  // NOTE: Focus editor to restore selection and try to apply the commmand.

  editorCommand('format.strong', 'format-strong'),
  editorCommand('format.emphasis', 'format-emphasis'),
  editorCommand('format.underline', 'format-underline'),
  editorCommand('format.highlight', 'format-highlight'),
  editorCommand('format.superscript', 'format-superscript'),
  editorCommand('format.subscript', 'format-subscript'),
  editorCommand('format.inline-code', 'format-inline-code'),
  editorCommand('format.inline-math', 'format-inline-math'),
  editorCommand('format.strike', 'format-strikethrough'),
  editorCommand('format.hyperlink', 'format-link'),
  editorCommand('format.image', 'format-image'),
  editorCommand('format.clear-format', 'format-clear'),

  // --------------------------------------------------------------------------
  // CriticMarkup Review

  ...REVIEW_COMMAND_DESCRIPTORS.map((descriptor) => ({
    id: descriptor.id,
    isAvailable: () => isReviewCommandAvailable(
      descriptor,
      useCriticMarkupReviewStore().commandState
    ),
    execute: async() => executeReviewAction(descriptor.action)
  })),

  // --------------------------------------------------------------------------
  // Window

  {
    id: 'window.minimize',
    execute: async() => {
      window.electron.windowControl.minimize()
    }
  },
  {
    id: 'window.toggle-always-on-top',
    execute: async() => {
      window.electron.ipcRenderer.send('mt::window-toggle-always-on-top')
    }
  },
  {
    id: 'window.toggle-full-screen',
    execute: async() => {
      window.electron.windowControl.toggleFullScreen()
    }
  },

  {
    id: 'file.zoom',
    shortcut: [isOsx ? 'Cmd' : 'Ctrl', 'Scroll'],
    subcommands: [
      {
        id: 'file.zoom-0',
        description: '62.5%',
        value: 0.625
      },
      {
        id: 'file.zoom-1',
        description: '75%',
        value: 0.75
      },
      {
        id: 'file.zoom-2',
        description: '87.5%',
        value: 0.875
      },
      {
        id: 'file.zoom-3',
        description: '100%',
        value: 1.0
      },
      {
        id: 'file.zoom-4',
        description: '112.5%',
        value: 1.125
      },
      {
        id: 'file.zoom-5',
        description: '125%',
        value: 1.25
      },
      {
        id: 'file.zoom-6',
        description: '137.5%',
        value: 1.375
      },
      {
        id: 'file.zoom-7',
        description: '150%',
        value: 1.5
      },
      {
        id: 'file.zoom-8',
        description: '162.5%',
        value: 1.625
      },
      {
        id: 'file.zoom-9',
        description: '175%',
        value: 1.75
      },
      {
        id: 'file.zoom-10',
        description: '187.5%',
        value: 1.875
      },
      {
        id: 'file.zoom-11',
        description: '200%',
        value: 2.0
      }
    ],
    executeSubcommand: async(_, value) => {
      bus.emit('mt::window-zoom', value)
    }
  },

  // --------------------------------------------------------------------------
  // Window

  {
    id: 'window.change-theme',
    subcommands: [
      {
        id: 'window.change-theme-light',
        description: 'Cadmium Light',
        value: 'light'
      },
      {
        id: 'window.change-theme-dark',
        description: 'Dark',
        value: 'dark'
      },
      {
        id: 'window.change-theme-graphite',
        description: 'Graphite',
        value: 'graphite'
      },
      {
        id: 'window.change-theme-material-dark',
        description: 'Material Dark',
        value: 'material-dark'
      },
      {
        id: 'window.change-theme-one-dark',
        description: 'One Dark',
        value: 'one-dark'
      },
      {
        id: 'window.change-theme-ulysses',
        description: 'Ulysses',
        value: 'ulysses'
      }
    ],
    executeSubcommand: async(_, theme) => {
      if (typeof theme !== 'string') {
        throw new TypeError('Theme command requires a theme id')
      }
      window.electron.ipcRenderer.send('mt::set-user-preference', { theme })
    }
  },

  // --------------------------------------------------------------------------
  // View

  {
    id: 'view.source-code-mode',
    execute: async() => {
      bus.emit('view:toggle-view-entry', 'sourceCode')
    }
  },
  {
    id: 'view.typewriter-mode',
    execute: async() => {
      focusEditorAndExecute(() => bus.emit('view:toggle-view-entry', 'typewriter'))
    }
  },
  {
    id: 'view.focus-mode',
    execute: async() => {
      focusEditorAndExecute(() => bus.emit('view:toggle-view-entry', 'focus'))
    }
  },
  {
    id: 'view.toggle-sidebar',
    execute: async() => {
      bus.emit('view:toggle-layout-entry', 'showSideBar')
    }
  },
  {
    id: 'view.toggle-tabbar',
    execute: async() => {
      bus.emit('view:toggle-layout-entry', 'showTabBar')
    }
  },

  {
    id: 'view.text-direction',
    subcommands: [
      {
        id: 'view.text-direction-ltr',
        description: 'Left to Right',
        value: 'ltr'
      },
      {
        id: 'view.text-direction-rtl',
        description: 'Right to Left',
        value: 'rtl'
      }
    ],
    executeSubcommand: async(_, value) => {
      if (value !== 'ltr' && value !== 'rtl') {
        throw new TypeError('Text direction must be ltr or rtl')
      }
      window.electron.ipcRenderer.send('mt::set-user-preference', { textDirection: value })
    }
  },

  // --------------------------------------------------------------------------
  // MarkText

  {
    id: 'file.preferences',
    execute: async() => {
      window.electron.ipcRenderer.send('mt::open-setting-window')
    }
  },
  {
    id: 'file.quit',
    execute: async() => {
      window.electron.ipcRenderer.send('mt::app-try-quit')
    }
  },
  {
    id: 'docs.user-guide',
    execute: async() => {
      await openExternalResource('documentation-basics')
    }
  },
  {
    id: 'docs.markdown-syntax',
    execute: async() => {
      await openExternalResource('documentation-markdown-syntax')
    }
  },

  // --------------------------------------------------------------------------
  // Misc

  {
    id: 'tabs.cycleForward',
    execute: async() => {
      bus.emit('mt::tabs-cycle-right')
    }
  },
  {
    id: 'tabs.cycleBackward',
    execute: async() => {
      bus.emit('mt::tabs-cycle-left')
    }
  }
]

// --------------------------------------------------------------------------
// etc

if (isUpdatable()) {
  commands.push({
    id: 'file.check-update',
    description: getCommandDescriptionById('file.check-update'),
    execute: async() => {
      window.electron.ipcRenderer.send('mt::check-for-update')
    }
  })
}

if (isOsx) {
  commands.push({
    id: 'edit.screenshot',
    execute: async() => {
      window.electron.ipcRenderer.send('mt::make-screenshot')
    }
  })
}

// Function to get commands with updated descriptions
export const getCommandsWithDescriptions = async(): Promise<CommandDescriptor[]> => {
  // Update descriptions for all commands
  const updateDescriptions = (commandList: Array<CommandDescriptor | CommandSubcommand>): void => {
    for (const item of commandList) {
      const { id } = item
      const subcommands = (item as CommandDescriptor).subcommands
      // Always update description for commands with ID, regardless of existing description
      if (id) {
        item.description = getCommandDescriptionById(id)
      }

      // Special handling for theme subcommands
      if (id === 'window.change-theme' && subcommands && Array.isArray(subcommands)) {
        for (const subcommand of subcommands) {
          const { value } = subcommand
          if (value === 'light') {
            subcommand.description = t('menu.theme.cadmiumLight')
          } else if (value === 'dark') {
            subcommand.description = t('menu.theme.dark')
          } else if (value === 'graphite') {
            subcommand.description = t('menu.theme.graphiteLight')
          } else if (value === 'material-dark') {
            subcommand.description = t('menu.theme.materialDark')
          } else if (value === 'one-dark') {
            subcommand.description = t('menu.theme.oneDark')
          } else if (value === 'ulysses') {
            subcommand.description = t('menu.theme.ulyssesLight')
          }
        }
      }

      // Also update other subcommands descriptions
      if (subcommands && Array.isArray(subcommands)) {
        updateDescriptions(subcommands)
      }
    }
  }

  updateDescriptions(commands)
  return commands
}

// Complete all command descriptions for initial load.
for (const item of commands) {
  const { id, description } = item
  if (id && !description) {
    item.description = getCommandDescriptionById(id)
  }
}

export default commands
