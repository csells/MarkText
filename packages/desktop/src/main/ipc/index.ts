import { registerBootInfo } from './bootInfo'
import { registerPathHandlers } from './paths'
import { registerRipgrepHandlers } from './ripgrep'
import { registerUploaderHandlers } from './uploader'
import { registerFontsHandlers } from './fonts'
import {
  registerPresentationEffectHandlers
} from './presentationEffects'
import { registerWindowHandlers } from './window'
import { registerI18nHandlers } from './i18n'
import { registerDocumentCoreHandlers } from './documentCore'
import { registerImageAssetHandlers } from './imageAssets'
import {
  registerDocumentPathClipboardHandler
} from './documentPathClipboard'
import {
  registerUploaderDeletionClipboardHandler
} from './uploaderDeletionClipboard'
import {
  registerDocumentClipboardPasteHandler
} from './documentClipboardPaste'

export const registerSandboxIpcHandlers = (): void => {
  registerBootInfo()
  registerPathHandlers()
  registerRipgrepHandlers()
  registerUploaderHandlers()
  registerFontsHandlers()
  registerDocumentPathClipboardHandler()
  registerDocumentClipboardPasteHandler()
  registerUploaderDeletionClipboardHandler()
  registerPresentationEffectHandlers()
  registerWindowHandlers()
  registerI18nHandlers()
  registerDocumentCoreHandlers()
  registerImageAssetHandlers()
}
