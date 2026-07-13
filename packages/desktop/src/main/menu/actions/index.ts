import { loadEditCommands } from './edit'
import { loadFileCommands } from './file'
import { loadFormatCommands } from './format'
import { loadMarktextCommands } from './marktext'
import { loadParagraphCommands } from './paragraph'
import { loadReviewCommands } from './review'
import { loadViewCommands } from './view'
import { loadWindowCommands } from './window'
import type { CommandManager } from '../../commands'

export const loadMenuCommands = (commandManager: CommandManager): void => {
  loadEditCommands(commandManager)
  loadFileCommands(commandManager)
  loadFormatCommands(commandManager)
  loadMarktextCommands(commandManager)
  loadParagraphCommands(commandManager)
  loadReviewCommands(commandManager)
  loadViewCommands(commandManager)
  loadWindowCommands(commandManager)
}
