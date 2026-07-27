import { reportAsyncFailure } from '@marktext/document-view'
import {
  decodeProjectDocumentOpenReceipt
} from '@shared/types/projectDocumentOpen'

export async function requestProjectDocumentOpen(
  candidatePath: string
): Promise<boolean> {
  try {
    const rawReceipt = await window.electron.ipcRenderer.invoke(
      'mt::project::open-document',
      {
        schema: 'project-document-open-request-1',
        candidatePath
      }
    )
    decodeProjectDocumentOpenReceipt(rawReceipt)
    return true
  } catch (error) {
    reportAsyncFailure(error, 'Project document open')
    return false
  }
}
