import { ipcMain, type WebContents } from 'electron'
import {
  decodeProjectDocumentOpenRequest
} from './projectDocumentOpenRuntimeCodec'
import {
  authorizeProjectDocumentOpen,
  type ProjectDocumentOpenAuthorityOptions,
  type ProjectDocumentOpenAuthorization
} from '../project/projectDocumentOpenAuthority'
import {
  decodeProjectDocumentOpenReceipt,
  type ProjectDocumentOpenReceipt
} from '@shared/types/projectDocumentOpen'

export interface ProjectDocumentOpenEditor {
  readonly openedRootDirectory: string | null
  readonly findOpenedDocumentPath: (
    candidatePath: string
  ) => string | null
  readonly selectOpenedDocumentByPath: (pathname: string) => void
  readonly admitProjectFile: (pathname: string) => Promise<void>
}

interface ProjectDocumentOpenHandlerDependencies {
  readonly resolveEditor: (
    sender: WebContents
  ) => ProjectDocumentOpenEditor | null
  readonly authorize?: (
    options: ProjectDocumentOpenAuthorityOptions
  ) => Promise<ProjectDocumentOpenAuthorization>
}

function receipt(
  disposition: ProjectDocumentOpenReceipt['disposition'],
  pathname: string
): ProjectDocumentOpenReceipt {
  return decodeProjectDocumentOpenReceipt({
    schema: 'project-document-open-receipt-1',
    disposition,
    pathname
  })
}

export function registerProjectDocumentOpenHandler({
  resolveEditor,
  authorize = authorizeProjectDocumentOpen
}: ProjectDocumentOpenHandlerDependencies): void {
  ipcMain.handle(
    'mt::project::open-document',
    async(event, rawRequest: unknown) => {
      // Decode before sender/root lookup so authority-bearing renderer fields
      // cannot reach any native or filesystem effect.
      const request = decodeProjectDocumentOpenRequest(rawRequest)
      const editor = resolveEditor(event.sender)
      if (editor === null) {
        throw new Error(
          'Project document open requires a sender-owned editor window'
        )
      }
      const authorization = await authorize({
        root: editor.openedRootDirectory,
        candidatePath: request.candidatePath,
        findOpenedPath: candidate =>
          editor.findOpenedDocumentPath(candidate)
      })
      if (authorization.kind === 'select-existing') {
        editor.selectOpenedDocumentByPath(authorization.pathname)
        return receipt('selected-existing', authorization.pathname)
      }
      await editor.admitProjectFile(authorization.pathname)
      return receipt('admitted', authorization.pathname)
    }
  )
}
