import { clipboard, ipcMain } from 'electron'
import {
  createUploaderDeletionClipboardAuthority
} from '../uploader/uploaderDeletionClipboardAuthority'
import type {
  UploaderDeletionClipboardCapability
} from '../../shared/types/clipboardTransactions'
import {
  decodeUploaderDeletionClipboardRequest
} from './uploaderDeletionClipboardRuntimeCodec'

export interface UploaderDeletionClipboardHandlerDependencies {
  readonly consume: (senderId: number, token: string) => string
}

const authority = createUploaderDeletionClipboardAuthority()

export function retainUploaderDeletionUrl(
  senderId: number,
  deletionUrl: string
): UploaderDeletionClipboardCapability {
  return authority.mint(senderId, deletionUrl)
}

export function revokeUploaderDeletionUrls(senderId: number): void {
  authority.revokeSender(senderId)
}

export function registerUploaderDeletionClipboardHandler(
  dependencies: UploaderDeletionClipboardHandlerDependencies = authority
): void {
  ipcMain.handle(
    'mt::uploader::copy-deletion-url',
    async(event, rawRequest: unknown) => {
      // Decode before capability consumption or the OS clipboard effect.
      const request = decodeUploaderDeletionClipboardRequest(rawRequest)
      const deletionUrl = dependencies.consume(
        event.sender.id,
        request.token
      )
      clipboard.writeText(deletionUrl)
      return Object.freeze({
        schema: 'uploader-deletion-clipboard-receipt-1',
        kind: 'written'
      })
    }
  )
}
