import { protocol, webContents, type WebContents } from 'electron'
import {
  assertDocumentCoreRevision,
  describeDocumentCoreFile
} from '../ipc/documentCore'
import {
  imageDisplayCapabilities,
  type ImageDisplayGrant,
  IMAGE_DISPLAY_SCHEME
} from './imageDisplayCapability'
import { readVerifiedImageFile } from './imageAssetService'
import { resolveImageDisplayPath } from './imageDisplayService'
import {
  createImageDisplayProtocolHandler
} from './imageDisplayProtocol'

let schemeRegistered = false
let protocolRegistered = false

export function registerImageDisplayScheme(): void {
  if (schemeRegistered) return
  protocol.registerSchemesAsPrivileged([{
    scheme: IMAGE_DISPLAY_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: false,
      allowServiceWorkers: false,
      supportFetchAPI: false,
      corsEnabled: false,
      stream: false,
      codeCache: false,
      allowExtensions: false
    }
  }])
  schemeRegistered = true
}

export function registerImageDisplayProtocol(): void {
  if (protocolRegistered) return
  const senderFor = (grant: ImageDisplayGrant): WebContents => {
    const sender = webContents.fromId(grant.senderId)
    if (sender === undefined || sender.isDestroyed()) {
      throw new Error('Image display sender no longer exists')
    }
    return sender as WebContents
  }
  protocol.handle(
    IMAGE_DISPLAY_SCHEME,
    createImageDisplayProtocolHandler({
      resolveCapability: url => imageDisplayCapabilities.resolve(url),
      assertRevision: async(grant) => {
        const sender = senderFor(grant)
        await assertDocumentCoreRevision(
          sender,
          grant.documentId,
          grant.revisionId
        )
      },
      assertPath: async(grant) => {
        const sender = senderFor(grant)
        const document = describeDocumentCoreFile(
          sender,
          grant.documentId
        )
        const resolution = await resolveImageDisplayPath(
          document,
          grant.reference
        )
        if (
          resolution.kind !== 'resolved' ||
          resolution.pathname !== grant.pathname
        ) {
          throw new Error('Image display path authority changed')
        }
      },
      readImage: async(pathname) => {
        const verified = await readVerifiedImageFile(pathname)
        return Object.freeze({
          bytes: verified.bytes,
          mediaType: verified.mediaType
        })
      }
    })
  )
  protocolRegistered = true
}
