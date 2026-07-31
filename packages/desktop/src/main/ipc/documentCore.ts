import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  webContents,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  DocumentCoreMainDispatchRequest,
  DocumentCoreExecutionReport,
  DocumentCorePublication,
  DocumentCorePathReceipt,
  DocumentCoreRelocateRequest,
  DocumentCoreStaticSinkReceipt,
  DocumentCoreStaticSinkRequest
} from '../../shared/types/documentCore'
import {
  isDangerousExecutableFile,
  isMarkdownFile
} from '../../common/filesystem/paths'
import { createFileDocumentSessionJournalStorage } from '../documentCore/durableSessionJournalStorage'
import { createDurableDocumentFileMetadataStorage } from '../documentCore/durableDocumentFileMetadataStorage'
import {
  createDocumentCoreFileHost,
  type DocumentCoreFileHost,
  type DocumentCoreFileDescription,
  type DocumentCoreOpenFileRequest,
  type DocumentCoreOpenedFile,
  type DocumentCoreRecoverFileRequest,
  type DocumentCoreRecoveredFile,
  type DocumentCoreRecoveryWindow,
  type DocumentCoreSaveReceipt,
  type DocumentCoreSaveRequest
} from '../documentCore/documentFileHost'
import { createElectronDocumentCoreFileSurface } from '../documentCore/electronDocumentFileSurface'
import { coordinateDocumentPathRelocation } from '../documentCore/documentPathCoordinator'
import {
  createDocumentCorePerformanceSurface,
  type DocumentCorePerformanceSurface
} from '../documentCore/documentCorePerformanceSurface'
import {
  createElectronDocumentCoreStaticSinkSurface,
  createPrintProofStaticSinkSurface
} from '../documentCore/electronStaticSinkSurface'
import { createDocumentCoreExportDecorator } from '../documentCore/exportDecorator'
import {
  createFileDocumentCoreExportThemeSource,
  type DocumentCoreExportThemeCatalog
} from '../documentCore/exportThemeSource'
import {
  consumeDocumentCoreHostHtml,
  createDocumentCoreMainSessionHost,
  type DocumentCoreMainSessionHost
} from '../documentCore/mainSessionHost'
import {
  createDocumentCoreStaticSinkHost,
  type DocumentCoreResolvedStaticSinkRequest,
  type DocumentCoreStaticSinkHost
} from '../documentCore/staticSinkHost'
import {
  createDocumentCoreStaticSinkAcceptanceSurface,
  type DocumentCoreStaticSinkAcceptanceSurface
} from '../documentCore/staticSinkAcceptanceSurface'
import {
  decodeDocumentCoreCancelDispatchRequest,
  decodeDocumentCoreClipboardWriteRequest,
  decodeDocumentCoreCompleteDispatchRequest,
  decodeDocumentCoreMainDispatchRequest,
  decodeDocumentCoreAwaitSettledRequest,
  decodeDocumentCoreMainSelectRequest,
  decodeDocumentCoreOpenLinkRequest,
  decodeDocumentCoreReconfigureMarkdownOptionsRequest,
  decodeDocumentCoreStaticSinkRequest
} from './documentCoreRuntimeCodec'
import { encodeDocumentClipboardHtml } from './documentClipboardHtmlAuthority'
import {
  coordinateDocumentCoreLinkOpen,
  type DocumentCoreLinkCoordinatorDependencies
} from './documentLink'
import { presentationPolicy } from '../presentationPolicy'
import { t } from '../i18n'
import {
  decodeDocumentCoreAttachRequest,
  decodeDocumentCoreRelocateRequest,
  decodeDocumentCoreResolveExternalChangeRequest,
  decodeDocumentCoreSaveRequest
} from './documentFileRuntimeCodec'
import { retainStaticOutput } from '../presentation/staticOutputAuthority'
import { emitInternalChannel } from '../utils/internalIpc'

let host: DocumentCoreMainSessionHost | undefined
let files: DocumentCoreFileHost | undefined
let staticSinks: DocumentCoreStaticSinkHost | undefined
let exportThemes: DocumentCoreExportThemeCatalog | undefined
const attachedSenders = new Set<number>()
let performanceSurfaceInstalled = false
let staticSinkAcceptanceSurfaceInstalled = false

function mainHost(): DocumentCoreMainSessionHost {
  host ??= createDocumentCoreMainSessionHost(
    createFileDocumentSessionJournalStorage(
      path.join(app.getPath('userData'), 'document-core-sessions')
    )
  )
  return host
}

function staticSinkHost(): DocumentCoreStaticSinkHost {
  staticSinks ??= createDocumentCoreStaticSinkHost(
    mainHost(),
    createElectronDocumentCoreStaticSinkSurface(),
    createDocumentCoreExportDecorator(exportThemeCatalog())
  )
  return staticSinks
}

function exportThemeCatalog(): DocumentCoreExportThemeCatalog {
  exportThemes ??= createFileDocumentCoreExportThemeSource(
    path.join(app.getPath('userData'), 'themes', 'export')
  )
  return exportThemes
}

function documentFileHost(): DocumentCoreFileHost {
  files ??= createDocumentCoreFileHost(
    mainHost(),
    createElectronDocumentCoreFileSurface(),
    () => `document:${randomUUID()}`,
    documentId => `journal:${documentId}`,
    createDurableDocumentFileMetadataStorage(
      path.join(app.getPath('userData'), 'document-core-files')
    )
  )
  return files
}

type DocumentCoreSender = Pick<WebContents, 'id' | 'once'>
type DocumentCoreFileSender = Pick<WebContents, 'id' | 'once' | 'send'>
type DocumentCoreSenderEvent = Pick<IpcMainInvokeEvent, 'sender'>

function ownerOfSender(sender: DocumentCoreSender): string {
  const id = sender.id
  if (!attachedSenders.has(id)) {
    attachedSenders.add(id)
    sender.once('destroyed', () => {
      attachedSenders.delete(id)
      host?.detach(`renderer:${id}`)
    })
  }
  return `renderer:${id}`
}

function ownerOf(event: DocumentCoreSenderEvent): string {
  return ownerOfSender(event.sender)
}

/**
 * Admit decoded file/new-document state before notifying its renderer.
 *
 * This is called only by main window/file code. It is intentionally not an
 * IPC handler: renderer input cannot choose source, parser configuration,
 * durability identity, encoding, path, or the document id.
 */
export async function openDocumentCoreFile(
  sender: DocumentCoreSender,
  durableWindowId: string,
  request: DocumentCoreOpenFileRequest
): Promise<DocumentCoreOpenedFile> {
  return await documentFileHost().open(
    ownerOfSender(sender),
    durableWindowId,
    request
  )
}

/**
 * Rebuild main's in-memory file/session binding from durable main-owned
 * metadata. Window state contributes only the opaque document identity.
 */
export async function recoverDocumentCoreFile(
  sender: DocumentCoreSender,
  durableWindowId: string,
  request: DocumentCoreRecoverFileRequest
): Promise<DocumentCoreRecoveredFile> {
  return await documentFileHost().recover(
    ownerOfSender(sender),
    durableWindowId,
    request
  )
}

export async function listDocumentCoreRecoveryWindows():
Promise<readonly DocumentCoreRecoveryWindow[]> {
  return await documentFileHost().recoveryWindows()
}

/**
 * Execute the one main-owned save transaction and publish its file metadata.
 */
export async function saveDocumentCoreFile(
  sender: DocumentCoreFileSender,
  request: DocumentCoreSaveRequest
): Promise<DocumentCoreSaveReceipt> {
  const ownerId = ownerOfSender(sender)
  const before = documentFileHost().describe(ownerId, request.documentId)
  const receipt = await documentFileHost().save(ownerId, request)
  if (receipt.kind !== 'written') return receipt

  const window = BrowserWindow.fromWebContents(sender as WebContents)
  if (window !== null) {
    if (before.pathname === null) {
      emitInternalChannel('window-add-file-path', window.id, receipt.pathname)
      emitInternalChannel('menu-add-recently-used', receipt.pathname)
    } else if (before.pathname !== receipt.pathname) {
      emitInternalChannel(
        'window-change-file-path',
        window.id,
        receipt.pathname,
        before.pathname
      )
    } else {
      emitInternalChannel('window-file-saved', window.id, receipt.pathname)
    }
  }
  sender.send('mt::document-core::saved', receipt)
  return receipt
}

/**
 * Commit one main-owned path transition and then retarget window bookkeeping
 * from the closed host receipt. No watcher or renderer state changes before
 * FileHost has moved the file and durably committed its metadata.
 */
export async function relocateDocumentCoreFileToPath(
  sender: DocumentCoreFileSender,
  documentId: string,
  targetPathname: string
): Promise<DocumentCorePathReceipt> {
  const window = BrowserWindow.fromWebContents(sender as WebContents)
  const fileHost = documentFileHost()
  return await coordinateDocumentPathRelocation({
    ownerId: ownerOfSender(sender),
    documentId,
    targetPathname,
    relocate: fileHost.relocate,
    retarget: receipt => {
      if (
        window !== null &&
        receipt.pathname !== receipt.previousPathname
      ) {
        emitInternalChannel(
          'window-change-file-path',
          window.id,
          receipt.pathname,
          receipt.previousPathname
        )
      }
    }
  })
}

export async function relocateDocumentCoreFile(
  sender: DocumentCoreFileSender,
  request: DocumentCoreRelocateRequest
): Promise<DocumentCorePathReceipt | null> {
  const description = documentFileHost().describe(
    ownerOfSender(sender),
    request.documentId
  )
  if (description.pathname === null) {
    throw new Error(
      `Untitled document ${request.documentId} must be saved before relocation`
    )
  }

  let targetPathname: string
  if (request.intent.kind === 'rename') {
    targetPathname = path.join(
      path.dirname(description.pathname),
      request.intent.filename
    )
  } else {
    const window = BrowserWindow.fromWebContents(sender as WebContents)
    const options = {
      buttonLabel: 'Move to',
      nameFieldLabel: 'Filename:',
      defaultPath: description.pathname
    }
    const response = window === null
      ? await presentationPolicy.showSaveDialog(options)
      : await presentationPolicy.showSaveDialog(window, options)
    if (response.canceled || response.filePath === undefined) {
      return null
    }
    targetPathname = response.filePath
  }
  return await relocateDocumentCoreFileToPath(
    sender,
    request.documentId,
    targetPathname
  )
}

export function describeDocumentCoreFile(
  sender: DocumentCoreSender,
  documentId: string
): DocumentCoreFileDescription {
  return documentFileHost().describe(ownerOfSender(sender), documentId)
}

/**
 * PERF_TESTING-only per-document record of the latest execution report main
 * returned to a renderer, keyed for the automation performance surface. The
 * owner id rides along so main-only reads can authenticate follow-up host
 * queries for the same document.
 */
const lastExecutionByDocument = new Map<string, Readonly<{
  readonly ownerId: string
  readonly execution: DocumentCoreExecutionReport
  readonly dispatchExecution: DocumentCoreExecutionReport | null
  readonly attachExecution: DocumentCoreExecutionReport | null
}>>()

function recordDocumentExecution(
  ownerId: string,
  documentId: string,
  execution: DocumentCoreExecutionReport
): void {
  if (process.env.PERF_TESTING !== 'true') return
  // Dispatches and attaches are retained on their own lanes so a follow-up
  // select cannot mask either report from a poll that runs after the fact.
  const previous = lastExecutionByDocument.get(documentId)
  lastExecutionByDocument.set(
    documentId,
    Object.freeze({
      ownerId,
      execution,
      dispatchExecution: execution.operationKind === 'dispatch'
        ? execution
        : previous?.dispatchExecution ?? null,
      attachExecution: execution.operationKind === 'attach'
        ? execution
        : previous?.attachExecution ?? null
    })
  )
}

function recordPublicationExecution(
  ownerId: string,
  publication: DocumentCorePublication
): DocumentCorePublication {
  recordDocumentExecution(
    ownerId,
    publication.documentId,
    publication.execution
  )
  return publication
}

/**
 * Narrow main-only bridge for compound authorities such as image insertion.
 * Renderer IPC still reaches the document engine only through a closed,
 * caller-specific handler.
 */
export async function dispatchDocumentCoreIntent(
  sender: DocumentCoreSender,
  request: DocumentCoreMainDispatchRequest
): Promise<DocumentCorePublication> {
  const ownerId = ownerOfSender(sender)
  return recordPublicationExecution(
    ownerId,
    await mainHost().dispatch(ownerId, request)
  )
}

export async function assertDocumentCoreRevision(
  sender: DocumentCoreSender,
  documentId: string,
  revisionId: string
): Promise<void> {
  await mainHost().assertRevision(
    ownerOfSender(sender),
    documentId,
    revisionId
  )
}

export async function inspectDocumentCoreFiles(
  sender: DocumentCoreSender
) {
  return await documentFileHost().inspectOwned(ownerOfSender(sender))
}

export function documentCoreIdForPath(
  sender: DocumentCoreSender,
  pathname: string
): string | null {
  return documentFileHost().documentIdForPath(
    ownerOfSender(sender),
    pathname
  )
}

export function describeDocumentCoreFilesUnderPath(
  sender: DocumentCoreSender,
  directoryPathname: string
): readonly DocumentCoreFileDescription[] {
  return documentFileHost().descriptionsUnderPath(
    ownerOfSender(sender),
    directoryPathname
  )
}

export async function closeDocumentCoreFile(
  sender: DocumentCoreSender,
  documentId: string
): Promise<void> {
  const ownerId = ownerOfSender(sender)
  const description = documentFileHost().describe(ownerId, documentId)
  await documentFileHost().close(ownerId, documentId)
  if (description.pathname === null) return
  const window = BrowserWindow.fromWebContents(sender as WebContents)
  if (window !== null) {
    emitInternalChannel(
      'window-remove-file-path',
      window.id,
      description.pathname
    )
  }
}

/**
 * Apply one file-watcher observation through the owning main session.
 *
 * The watcher contributes only the retained native path. FileHost reads and
 * decodes bytes itself, checks the session's saved identity, and publishes an
 * identity-only result to the renderer.
 */
export async function handleDocumentCoreExternalFileChange(
  sender: DocumentCoreFileSender,
  pathname: string
): Promise<void> {
  const ownerId = ownerOfSender(sender)
  const documentId = documentFileHost().documentIdForPath(ownerId, pathname)
  if (documentId === null) return
  const result = await documentFileHost().reload(ownerId, {
    documentId,
    force: false
  })
  sender.send('mt::document-core::external-change', result)
}

/**
 * Main-process bridge for menu IPC that owns native save dialogs. The
 * materialized HTML capability remains inside main; callers get only a sink
 * receipt.
 */
export async function executeDocumentCoreStaticSink(
  event: DocumentCoreSenderEvent,
  request: DocumentCoreResolvedStaticSinkRequest
) {
  return await staticSinkHost().execute(ownerOf(event), request)
}

function staticSinkExtension(
  consumer: 'styled-html' | 'pdf'
): '.html' | '.pdf' {
  return consumer === 'styled-html' ? '.html' : '.pdf'
}

async function resolveDocumentCoreStaticSinkRequest(
  event: DocumentCoreSenderEvent,
  request: DocumentCoreStaticSinkRequest
): Promise<
  DocumentCoreResolvedStaticSinkRequest | DocumentCoreStaticSinkReceipt
  > {
  if (request.consumer === 'print') return request

  const extension = staticSinkExtension(request.consumer)
  const suggestedName = request.suggestedName
  const filename = suggestedName.toLowerCase().endsWith(extension)
    ? suggestedName
    : `${suggestedName}${extension}`
  const options = {
    defaultPath: path.join(app.getPath('documents'), filename),
    filters: request.consumer === 'pdf'
      ? [{
        name: 'Portable Document Format',
        extensions: ['pdf']
      }]
      : [{
        name: 'Hypertext Markup Language',
        extensions: ['html']
      }]
  }
  const win = BrowserWindow.fromWebContents(event.sender)
  const response = win === null
    ? await presentationPolicy.showSaveDialog(options)
    : await presentationPolicy.showSaveDialog(win, options)
  if (response.canceled || response.filePath === undefined) {
    return Object.freeze({
      schema: 'document-core-static-sink-receipt-1',
      kind: 'cancelled',
      consumer: request.consumer,
      view: request.view,
      revisionId: request.revisionId
    })
  }
  const {
    suggestedName: _suggestedName,
    ...resolved
  } = request
  return Object.freeze({
    ...resolved,
    targetPath: path.resolve(response.filePath)
  })
}

function isStaticSinkReceipt(
  value: DocumentCoreResolvedStaticSinkRequest | DocumentCoreStaticSinkReceipt
): value is DocumentCoreStaticSinkReceipt {
  return 'schema' in value
}

/**
 * The only production mutation boundary for a document-core desktop tab.
 *
 * Electron derives ownership from the authenticated WebContents sender. A
 * renderer cannot choose another owner id in its payload.
 */
export function registerDocumentCoreHandlers(): void {
  if (
    process.env.PERF_TESTING === 'true' &&
    !performanceSurfaceInstalled
  ) {
    performanceSurfaceInstalled = true
    const target = globalThis as typeof globalThis & {
      __mtDocumentCorePerformance?: DocumentCorePerformanceSurface
    }
    Object.defineProperty(target, '__mtDocumentCorePerformance', {
      configurable: false,
      enumerable: false,
      value: createDocumentCorePerformanceSurface(
        mainHost(),
        documentFileHost(),
        documentId => lastExecutionByDocument.get(documentId)
      ),
      writable: false
    })
  }
  if (
    process.env.PERF_TESTING === 'true' &&
    !staticSinkAcceptanceSurfaceInstalled
  ) {
    staticSinkAcceptanceSurfaceInstalled = true
    const target = globalThis as typeof globalThis & {
      __mtDocumentCoreStaticSinkAcceptance?:
      DocumentCoreStaticSinkAcceptanceSurface
    }
    Object.defineProperty(
      target,
      '__mtDocumentCoreStaticSinkAcceptance',
      {
        configurable: false,
        enumerable: false,
        value: createDocumentCoreStaticSinkAcceptanceSurface(
          webContentsId => {
            const sender = webContents.fromId(webContentsId)
            if (sender === undefined) {
              throw new Error(
                `Static sink acceptance owner ${webContentsId} is unavailable`
              )
            }
            return ownerOfSender(sender)
          },
          async(ownerId, request) =>
            await staticSinkHost().execute(ownerId, request),
          async(ownerId, request, proofPath) =>
            await createDocumentCoreStaticSinkHost(
              mainHost(),
              createPrintProofStaticSinkSurface(
                createElectronDocumentCoreStaticSinkSurface(),
                proofPath
              ),
              createDocumentCoreExportDecorator(exportThemeCatalog())
            ).execute(ownerId, request),
          async(ownerId, documentId) => {
            // The persistence lease is the main-only surface that
            // authenticates the owner and returns the head revision id. It
            // is released without markPersisted — the same compensation
            // path a failed save takes — so the read leaves history and
            // saved identity untouched.
            const lease = await mainHost().preparePersistence(
              ownerId,
              documentId,
              'save'
            )
            await mainHost().releasePersistence(
              ownerId,
              documentId,
              lease.leaseId
            )
            return lease.revisionId
          }
        ),
        writable: false
      }
    )
  }
  ipcMain.handle(
    'mt::document-core::list-export-themes',
    async() => await exportThemeCatalog().listCustomThemes()
  )
  ipcMain.handle(
    'mt::document-core::attach',
    async(event, rawRequest: unknown) => {
      const request = decodeDocumentCoreAttachRequest(rawRequest)
      const ownerId = ownerOf(event)
      return recordPublicationExecution(
        ownerId,
        await documentFileHost().attach(ownerId, request.documentId)
      )
    }
  )
  ipcMain.handle(
    'mt::document-core::save',
    async(event, rawRequest: unknown) => {
      const request = decodeDocumentCoreSaveRequest(rawRequest)
      return await saveDocumentCoreFile(event.sender, request)
    }
  )
  ipcMain.handle(
    'mt::document-core::relocate',
    async(event, rawRequest: unknown) => {
      const request = decodeDocumentCoreRelocateRequest(rawRequest)
      return await relocateDocumentCoreFile(event.sender, request)
    }
  )
  ipcMain.handle(
    'mt::document-core::resolve-external-change',
    async(event, rawRequest: unknown) => {
      const request =
        decodeDocumentCoreResolveExternalChangeRequest(rawRequest)
      return await documentFileHost().resolveExternalChange(
        ownerOf(event),
        request.documentId,
        request.resolution
      )
    }
  )
  ipcMain.handle(
    'mt::document-core::write-clipboard',
    async(event, rawRequest: unknown) => {
      const request = decodeDocumentCoreClipboardWriteRequest(rawRequest)
      const result = await mainHost().materializeClipboard(
        ownerOf(event),
        request.documentId,
        request.revisionId,
        request.consumer === 'copy-heading-link'
          ? {
            view: request.view,
            consumer: request.consumer,
            targetNodeId: request.targetNodeId
          }
          : {
            view: request.view,
            consumer: request.consumer,
            selection: request.selection
          }
      )
      if (result.kind === 'unavailable') {
        return Object.freeze({
          kind: 'unavailable' as const,
          reason: result.reason
        })
      }
      const artifact = result.artifact
      if (result.revision.id !== request.revisionId) {
        if (artifact.kind === 'cut-preparation') {
          try {
            await mainHost().completeCut(
              ownerOf(event),
              request.documentId,
              artifact.ticketId,
              false
            )
          } catch {
            // Sender teardown independently revokes every retained cut.
          }
        }
        throw new Error(
          `Clipboard requested stale revision ${request.revisionId}; ` +
          `main owns ${result.revision.id}`
        )
      }
      if (artifact.kind === 'disabled') {
        return Object.freeze({
          kind: 'disabled' as const,
          consumer: artifact.consumer,
          reason: artifact.reason
        })
      }
      const writable = artifact.kind === 'cut-preparation'
        ? artifact.bundle
        : artifact
      try {
        if (writable.kind === 'clipboard-text') {
          clipboard.writeText(writable.plainText)
        } else if (writable.kind === 'clipboard-bundle') {
          const visibleHtml = writable.html === undefined
            ? undefined
            : consumeDocumentCoreHostHtml(
              writable.html,
              'clipboard'
            )
          const html = writable.privateSource === undefined
            ? visibleHtml
            : encodeDocumentClipboardHtml(
              writable.privateSource.text,
              visibleHtml
            )
          clipboard.write({
            text: writable.plainText,
            ...(html === undefined ? {} : { html })
          })
        } else {
          const impossible: never = writable
          throw new Error(`Clipboard writer received unsupported ${
            String((impossible as { kind?: unknown }).kind)
          }`)
        }
      } catch (error) {
        if (artifact.kind === 'cut-preparation') {
          try {
            await mainHost().completeCut(
              ownerOf(event),
              request.documentId,
              artifact.ticketId,
              false
            )
          } catch {
            // Preserve the clipboard failure; detach performs the same revoke.
          }
        }
        throw error
      }
      if (artifact.kind === 'cut-preparation') {
        const publication = await mainHost().completeCut(
          ownerOf(event),
          request.documentId,
          artifact.ticketId,
          true
        )
        if (!('envelope' in publication)) {
          throw new Error('Written cut did not produce a document publication')
        }
        return Object.freeze({
          kind: 'cut-committed' as const,
          consumer: request.consumer as 'cut' | 'cut-table',
          publication
        })
      }
      return Object.freeze({
        kind: 'written' as const,
        consumer: request.consumer as Exclude<
          typeof request.consumer,
          'cut' | 'cut-table'
        >
      })
    }
  )
  ipcMain.handle(
    'mt::document-core::open-link',
    async(event, rawRequest: unknown) => {
      // Decode before sender attachment, host lookup, file lookup, or any
      // native effect. Extra renderer URL/path fields are rejected here.
      const request = decodeDocumentCoreOpenLinkRequest(rawRequest)
      const ownerId = ownerOf(event)
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win === null) {
        throw new Error('Document link navigation requires an editor window')
      }
      const dependencies = Object.freeze({
        resolveTarget: async(authenticatedOwnerId, admitted) =>
          await mainHost().resolveDocumentLink(
            authenticatedOwnerId,
            admitted.documentId,
            admitted.revisionId,
            admitted.targetNodeId
          ),
        describeDocument: (authenticatedOwnerId, documentId) =>
          documentFileHost().describe(
            authenticatedOwnerId,
            documentId
          ),
        isMarkdownPath: isMarkdownFile,
        isDangerousPath: isDangerousExecutableFile,
        openExternal: async(destination) =>
          await presentationPolicy.openExternal(destination),
        openMarkdownPath: (pathname) => {
          emitInternalChannel('app-open-file-by-id', win.id, pathname)
        },
        openPath: async(pathname) => {
          await presentationPolicy.openPath(pathname)
        },
        confirmDangerousPath: async(pathname) => {
          const { response } =
            await presentationPolicy.showMessageBox(win, {
              type: 'warning',
              buttons: [
                t('dialog.cancel'),
                t('dialog.openAnyway')
              ],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
              title: t('dialog.unsafeFileTitle'),
              message: t('dialog.unsafeFileMessage'),
              detail: t('dialog.unsafeFileDetail', {
                name: path.basename(pathname)
              })
            })
          return response === 1
        }
      } satisfies DocumentCoreLinkCoordinatorDependencies)
      return await coordinateDocumentCoreLinkOpen(
        request,
        ownerId,
        dependencies
      )
    }
  )
  ipcMain.handle(
    'mt::document-core::dispatch-start',
    (event, rawRequest: unknown) => {
      const request = decodeDocumentCoreMainDispatchRequest(rawRequest)
      return mainHost().startDispatch(ownerOf(event), request)
    }
  )
  ipcMain.handle(
    'mt::document-core::reconfigure-markdown-options',
    async(event, rawRequest: unknown) => {
      const request =
        decodeDocumentCoreReconfigureMarkdownOptionsRequest(rawRequest)
      const ownerId = ownerOf(event)
      return recordPublicationExecution(
        ownerId,
        await mainHost().reconfigureMarkdownOptions(ownerId, request)
      )
    }
  )
  ipcMain.handle(
    'mt::document-core::dispatch-complete',
    async(event, rawRequest: unknown) => {
      const request = decodeDocumentCoreCompleteDispatchRequest(rawRequest)
      const ownerId = ownerOf(event)
      return recordPublicationExecution(
        ownerId,
        await mainHost().completeDispatch(
          ownerId,
          request.documentId,
          request.ticketId
        )
      )
    }
  )
  ipcMain.handle(
    'mt::document-core::dispatch-cancel',
    (event, rawRequest: unknown) => {
      const request = decodeDocumentCoreCancelDispatchRequest(rawRequest)
      return mainHost().cancelDispatch(
        ownerOf(event),
        request.documentId,
        request.ticketId
      )
    }
  )
  ipcMain.handle(
    'mt::document-core::select',
    async(event, rawRequest: unknown) => {
      const request = decodeDocumentCoreMainSelectRequest(rawRequest)
      const ownerId = ownerOf(event)
      return recordPublicationExecution(
        ownerId,
        await mainHost().select(ownerId, request)
      )
    }
  )
  ipcMain.handle(
    'mt::document-core::await-settled',
    async(event, rawRequest: unknown) => {
      const request = decodeDocumentCoreAwaitSettledRequest(rawRequest)
      await mainHost().awaitSettled(ownerOf(event), request.documentId)
      return Object.freeze({ kind: 'settled' as const })
    }
  )
  ipcMain.handle(
    'mt::document-core::materialize-static',
    async(event, rawRequest: unknown) => {
      const request = decodeDocumentCoreStaticSinkRequest(rawRequest)
      const ownerId = ownerOf(event)
      await mainHost().assertRevision(
        ownerId,
        request.documentId,
        request.revisionId
      )
      const resolved = await resolveDocumentCoreStaticSinkRequest(event, request)
      if (isStaticSinkReceipt(resolved)) return resolved
      const receipt = await executeDocumentCoreStaticSink(event, resolved)
      if (
        receipt.kind === 'written' ||
        receipt.kind === 'proof-written'
      ) {
        retainStaticOutput(
          event.sender,
          {
            schema: 'static-output-reveal-1',
            documentId: request.documentId,
            revisionId: receipt.revisionId,
            consumer: receipt.consumer,
            view: receipt.view
          },
          receipt.targetPath
        )
      }
      return receipt
    }
  )
}
