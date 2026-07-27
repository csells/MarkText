import { ipcMain, type WebContents } from 'electron'
import type {
  UploaderDocumentDescription,
  UploaderExecutionResult,
  UploaderSettings
} from '../uploader/uploaderService'
import {
  createUploaderService,
  inspectUploaderAvailability,
  resolveMainPicgoExecutable
} from '../uploader/uploaderService'
import {
  readUploaderSettings
} from '../uploader/uploaderSettings'
import { describeDocumentCoreFile } from './documentCore'
import {
  decodeUploaderAvailabilityRequest,
  decodeUploaderUploadRequest
} from './uploaderRuntimeCodec'
import {
  retainUploaderDeletionUrl
} from './uploaderDeletionClipboard'
import type {
  UploaderDeletionClipboardCapability
} from '../../shared/types/clipboardTransactions'

export interface UploaderIpcSender {
  readonly id: number
}

export interface UploaderHandlerDependencies {
  readonly describeDocument: (
    sender: UploaderIpcSender,
    documentId: string
  ) => UploaderDocumentDescription
  readonly readSettings: () => UploaderSettings
  readonly resolvePicgoExecutable: () => Promise<string | null>
  readonly executeFile?: (
    executablePath: string,
    args: readonly string[]
  ) => Promise<UploaderExecutionResult>
  readonly retainDeletionUrl?: (
    senderId: number,
    deletionUrl: string
  ) => UploaderDeletionClipboardCapability
  readonly temporaryRoot?: string
}

const productionDependencies: UploaderHandlerDependencies = Object.freeze({
  describeDocument: (
    sender: UploaderIpcSender,
    documentId: string
  ) => describeDocumentCoreFile(sender as WebContents, documentId),
  readSettings: readUploaderSettings,
  resolvePicgoExecutable: resolveMainPicgoExecutable,
  retainDeletionUrl: retainUploaderDeletionUrl
})

export function registerUploaderHandlers(
  dependencies: UploaderHandlerDependencies = productionDependencies
): void {
  ipcMain.handle('mt::uploader::upload', async(event, rawRequest: unknown) => {
    // Closed decoding precedes document lookup, settings reads, and effects.
    const request = decodeUploaderUploadRequest(rawRequest)
    const retainDeletionUrl = dependencies.retainDeletionUrl
    const service = createUploaderService({
      describeDocument: documentId =>
        dependencies.describeDocument(event.sender, documentId),
      readSettings: dependencies.readSettings,
      resolvePicgoExecutable: dependencies.resolvePicgoExecutable,
      ...(dependencies.executeFile === undefined
        ? {}
        : { executeFile: dependencies.executeFile }),
      ...(retainDeletionUrl === undefined
        ? {}
        : {
          retainDeletionUrl: (deletionUrl: string) =>
            retainDeletionUrl(event.sender.id, deletionUrl)
        }),
      ...(dependencies.temporaryRoot === undefined
        ? {}
        : { temporaryRoot: dependencies.temporaryRoot })
    })
    return await service.upload(request)
  })

  ipcMain.handle(
    'mt::uploader::availability',
    async(_event, rawRequest: unknown) => {
      const request = decodeUploaderAvailabilityRequest(rawRequest)
      return await inspectUploaderAvailability(
        request,
        dependencies.readSettings,
        dependencies.resolvePicgoExecutable
      )
    }
  )
}
