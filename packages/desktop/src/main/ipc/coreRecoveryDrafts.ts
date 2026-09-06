import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { createCoreRecoveryDraftStore } from '../coreRecoveryDraftStore'
import type { CoreRecoveryDraftInput } from '../../shared/types/coreRecoveryDraft'

export const registerCoreRecoveryDraftHandlers = (): void => {
  const store = () => createCoreRecoveryDraftStore(join(app.getPath('userData'), 'core-recovery-drafts'))
  ipcMain.on('mt::core-draft::preserve', (event, draft: CoreRecoveryDraftInput) => {
    try {
      event.returnValue = { ok: true, record: store().preserve(draft) }
    } catch (error) {
      event.returnValue = { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('mt::core-draft::list', () => store().list())
  ipcMain.handle('mt::core-draft::archive', (_event, id: string) => store().archive(id))
}
