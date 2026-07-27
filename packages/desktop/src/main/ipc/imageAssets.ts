import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { WireEnvelopeCodecV1 } from '@marktext/document-core'
import type { ImageAssetDocumentDescription } from '../imageAssets/imageAssetService'
import { createImageAssetService } from '../imageAssets/imageAssetService'
import {
  coordinateImageAssetInsert,
  createImageAssetActiveDocumentAuthority,
  type ImageAssetActiveDocumentAuthority,
  type ImageAssetDispatchResult
} from '../imageAssets/imageAssetTransaction'
import {
  imageSourceCapabilities,
  type ImageSourceCapabilityAuthority
} from '../imageAssets/imageSourceCapability'
import {
  imageDisplayCapabilities,
  type ImageDisplayCapabilityAuthority
} from '../imageAssets/imageDisplayCapability'
import {
  resolveImageDisplayPath,
  type ImageDisplayPathResolution
} from '../imageAssets/imageDisplayService'
import {
  readImageAssetProjectRoot,
  readImageAssetSettings
} from '../imageAssets/imageAssetSettings'
import type {
  DocumentCoreMainDispatchRequest,
  DocumentCorePublication
} from '@shared/types/documentCore'
import {
  assertDocumentCoreRevision,
  describeDocumentCoreFile,
  dispatchDocumentCoreIntent
} from './documentCore'
import {
  decodeImageAssetActivationRequest,
  decodeImageAssetInsertRequest,
  decodeImageDisplayRequest
} from './imageAssetRuntimeCodec'

export interface ImageAssetIpcSender {
  readonly id: number
  readonly once?: (event: 'destroyed', listener: () => void) => unknown
}

export interface ImageAssetHandlerDependencies {
  readonly describeDocument: (
    sender: ImageAssetIpcSender,
    documentId: string
  ) => ImageAssetDocumentDescription
  readonly readSettings: typeof readImageAssetSettings
  readonly assertRevision: (
    sender: ImageAssetIpcSender,
    documentId: string,
    revisionId: string
  ) => Promise<void>
  readonly dispatchDocument: (
    sender: ImageAssetIpcSender,
    request: DocumentCoreMainDispatchRequest
  ) => Promise<DocumentCorePublication>
  readonly sourceCapabilities: ImageSourceCapabilityAuthority
  readonly displayCapabilities?: ImageDisplayCapabilityAuthority
  readonly resolveDisplayPath?: (
    document: ImageAssetDocumentDescription,
    reference: string
  ) => Promise<ImageDisplayPathResolution>
  readonly activeDocuments?: ImageAssetActiveDocumentAuthority
}

const productionDependencies: ImageAssetHandlerDependencies = Object.freeze({
  describeDocument: (
    sender: ImageAssetIpcSender,
    documentId: string
  ) => {
    const description = describeDocumentCoreFile(
      sender as WebContents,
      documentId
    )
    const browserWindow = BrowserWindow.fromWebContents(
      sender as WebContents
    )
    return Object.freeze({
      ...description,
      projectRoot: browserWindow === null
        ? null
        : readImageAssetProjectRoot(browserWindow.id)
    })
  },
  readSettings: readImageAssetSettings,
  assertRevision: (
    sender: ImageAssetIpcSender,
    documentId: string,
    revisionId: string
  ) =>
    assertDocumentCoreRevision(
      sender as WebContents,
      documentId,
      revisionId
    ),
  dispatchDocument: (
    sender: ImageAssetIpcSender,
    request: DocumentCoreMainDispatchRequest
  ) =>
    dispatchDocumentCoreIntent(sender as WebContents, request),
  sourceCapabilities: imageSourceCapabilities,
  displayCapabilities: imageDisplayCapabilities,
  resolveDisplayPath: resolveImageDisplayPath
})

const decoder = new TextDecoder('utf-8', { fatal: true })

function dispatchResult(
  publication: DocumentCorePublication
): ImageAssetDispatchResult {
  const verified = new WireEnvelopeCodecV1().publish(
    publication.envelope,
    publication.baseSnapshotId
  )
  if (verified.kind !== 'published') {
    throw new Error(
      `Image insertion publication failed verification: ${verified.reason}`
    )
  }
  const bytes = verified.members.terminalOutcomeDelta
  if (bytes === undefined) {
    throw new TypeError('Image insertion publication has no terminal outcome')
  }
  const value = JSON.parse(decoder.decode(bytes)) as unknown
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Image insertion terminal outcome is invalid')
  }
  const record = value as Record<string, unknown>
  const outcome = record.kind
  if (outcome === 'committed') {
    return Object.freeze({ publication, outcome })
  }
  if (
    outcome === 'rejected' ||
    outcome === 'noop' ||
    outcome === 'cancelled'
  ) {
    return Object.freeze({ publication, outcome })
  }
  throw new TypeError(`Unexpected image insertion outcome ${String(outcome)}`)
}

export function registerImageAssetHandlers(
  dependencies: ImageAssetHandlerDependencies = productionDependencies
): void {
  const activeDocuments = dependencies.activeDocuments ??
    createImageAssetActiveDocumentAuthority()
  const displayCapabilities = dependencies.displayCapabilities ??
    imageDisplayCapabilities
  const resolveDisplayPath = dependencies.resolveDisplayPath ??
    resolveImageDisplayPath
  const retainedSenders = new Set<number>()
  const retainSender = (sender: ImageAssetIpcSender): void => {
    if (retainedSenders.has(sender.id)) return
    retainedSenders.add(sender.id)
    sender.once?.('destroyed', () => {
      retainedSenders.delete(sender.id)
      activeDocuments.revokeSender(sender.id)
      dependencies.sourceCapabilities.revokeSender(sender.id)
      displayCapabilities.revokeSender(sender.id)
    })
  }

  ipcMain.handle(
    'mt::image-assets::activate-document',
    (event, rawRequest: unknown) => {
      const request = decodeImageAssetActivationRequest(rawRequest)
      dependencies.describeDocument(event.sender, request.documentId)
      retainSender(event.sender)
      displayCapabilities.revokeSender(event.sender.id)
      const active = activeDocuments.activate(
        event.sender.id,
        request.documentId
      )
      return Object.freeze({
        schema: 'image-asset-activation-receipt-1',
        documentId: active.documentId,
        generation: active.generation
      })
    }
  )

  ipcMain.handle(
    'mt::image-assets::resolve-display',
    async(event, rawRequest: unknown) => {
      // Decode before ownership, revision, or filesystem lookup. The renderer
      // never supplies or receives a native pathname.
      const request = decodeImageDisplayRequest(rawRequest)
      retainSender(event.sender)
      const active = activeDocuments.capture(
        event.sender.id,
        request.documentId
      )
      const document = dependencies.describeDocument(
        event.sender,
        request.documentId
      )
      await dependencies.assertRevision(
        event.sender,
        request.documentId,
        request.revisionId
      )
      if (!activeDocuments.isCurrent(event.sender.id, active)) {
        throw new Error('Image display document was deactivated')
      }
      const resolution = await resolveDisplayPath(
        document,
        request.reference
      )
      // A relocation, revision advance, or tab switch while path resolution
      // was pending invalidates the candidate before capability minting.
      const currentDocument = dependencies.describeDocument(
        event.sender,
        request.documentId
      )
      if (currentDocument.pathname !== document.pathname) {
        throw new Error('Image display document path changed')
      }
      await dependencies.assertRevision(
        event.sender,
        request.documentId,
        request.revisionId
      )
      if (!activeDocuments.isCurrent(event.sender.id, active)) {
        throw new Error('Image display document was deactivated')
      }
      if (resolution.kind === 'unavailable') {
        return Object.freeze({
          schema: 'image-display-receipt-1',
          kind: 'unavailable',
          documentId: request.documentId,
          revisionId: request.revisionId,
          reference: request.reference,
          reason: resolution.reason
        })
      }
      return Object.freeze({
        schema: 'image-display-receipt-1',
        kind: 'resolved',
        documentId: request.documentId,
        revisionId: request.revisionId,
        reference: request.reference,
        src: displayCapabilities.mint(Object.freeze({
          senderId: event.sender.id,
          documentId: request.documentId,
          revisionId: request.revisionId,
          reference: request.reference,
          pathname: resolution.pathname
        }))
      })
    }
  )

  ipcMain.handle('mt::image-assets::insert', async(event, rawRequest: unknown) => {
    // Decode the entire closed request before ownership lookup or any effect.
    const request = decodeImageAssetInsertRequest(rawRequest)
    retainSender(event.sender)
    const service = createImageAssetService({
      describeDocument: documentId =>
        dependencies.describeDocument(event.sender, documentId),
      readSettings: dependencies.readSettings,
      resolveNativeSource: token =>
        dependencies.sourceCapabilities.consume(
          event.sender.id,
          token
        ).pathname
    })
    return await coordinateImageAssetInsert({
      senderId: event.sender.id,
      request,
      authority: activeDocuments,
      assertRevision: (documentId, revisionId) =>
        dependencies.assertRevision(
          event.sender,
          documentId,
          revisionId
        ),
      prepare: () => service.prepare({
        documentId: request.documentId,
        source: request.source,
        storage: request.storage
      }),
      dispatch: async(dispatchRequest) => dispatchResult(
        await dependencies.dispatchDocument(event.sender, dispatchRequest)
      )
    })
  })
}
