import path from 'node:path'
import type {
  DocumentCoreExportOptions,
  DocumentCoreStaticSinkReceipt
} from '../../shared/types/documentCore'
import type {
  DocumentCoreResolvedStaticSinkRequest
} from './staticSinkHost'

type StaticSinkView = DocumentCoreResolvedStaticSinkRequest['view']

interface AcceptanceRequestBase {
  readonly documentId: string
  readonly revisionId: string
  readonly view: StaticSinkView
  readonly options: DocumentCoreExportOptions
}

export type DocumentCoreStaticSinkAcceptanceRequest =
  | Readonly<
    AcceptanceRequestBase & {
      readonly consumer: 'styled-html'
      readonly targetPath: string
    }
  >
  | Readonly<
    AcceptanceRequestBase & {
      readonly consumer: 'pdf'
      readonly targetPath: string
    }
  >
  | Readonly<
    AcceptanceRequestBase & {
      readonly consumer: 'print'
      readonly proofPath: string
    }
  >

export interface DocumentCoreStaticSinkAcceptanceSurface {
  /**
   * Exercise one real main-process static sink for an already attached
   * renderer owner. This surface is installed only for explicit automation
   * and is never exposed by preload or renderer IPC.
   */
  readonly execute: (
    ownerWebContentsId: number,
    request: DocumentCoreStaticSinkAcceptanceRequest
  ) => Promise<DocumentCoreStaticSinkReceipt>
  /**
   * Authenticate the owner and read the head revision id a sink request
   * must carry. Automation composes forged and legitimate requests from
   * this identity instead of reading renderer state.
   */
  readonly readIdentity: (
    ownerWebContentsId: number,
    documentId: string
  ) => Promise<Readonly<{
    readonly documentId: string
    readonly revisionId: string
  }>>
}

type ResolveOwner = (webContentsId: number) => string
type ExecuteStaticSink = (
  ownerId: string,
  request: DocumentCoreResolvedStaticSinkRequest
) => Promise<DocumentCoreStaticSinkReceipt>

/** Run one production print request against a proof-writing print adapter. */
type ExecutePrintToProof = (
  ownerId: string,
  request: DocumentCoreResolvedStaticSinkRequest,
  proofPath: string
) => Promise<DocumentCoreStaticSinkReceipt>

type ReadRevision = (
  ownerId: string,
  documentId: string
) => Promise<string>

function assertAbsoluteArtifactPath(
  artifactPath: string,
  label: string
): void {
  if (
    artifactPath.includes('\u0000') ||
    !path.isAbsolute(artifactPath) ||
    path.extname(artifactPath).length === 0
  ) {
    throw new TypeError(`${label} must be an absolute artifact file path`)
  }
}

/**
 * Create the main-only deterministic adapter used by Electron acceptance.
 *
 * The adapter delegates to the same static sink host as production. Its only
 * extra authority is choosing an artifact path without opening a native
 * dialog, and that authority never crosses a renderer boundary.
 */
export function createDocumentCoreStaticSinkAcceptanceSurface(
  resolveOwner: ResolveOwner,
  executeStaticSink: ExecuteStaticSink,
  executePrintToProof: ExecutePrintToProof,
  readRevision: ReadRevision
): DocumentCoreStaticSinkAcceptanceSurface {
  return Object.freeze({
    readIdentity: async(
      ownerWebContentsId: number,
      documentId: string
    ): Promise<Readonly<{
      readonly documentId: string
      readonly revisionId: string
    }>> => {
      if (
        !Number.isSafeInteger(ownerWebContentsId) ||
        ownerWebContentsId <= 0
      ) {
        throw new TypeError(
          'Static sink acceptance needs a live WebContents id'
        )
      }
      return Object.freeze({
        documentId,
        revisionId: await readRevision(
          resolveOwner(ownerWebContentsId),
          documentId
        )
      })
    },
    execute: async(
      ownerWebContentsId: number,
      request: DocumentCoreStaticSinkAcceptanceRequest
    ): Promise<DocumentCoreStaticSinkReceipt> => {
      if (
        !Number.isSafeInteger(ownerWebContentsId) ||
        ownerWebContentsId <= 0
      ) {
        throw new TypeError(
          'Static sink acceptance needs a live WebContents id'
        )
      }

      if (request.consumer === 'print') {
        const { proofPath, ...printRequest } = request
        assertAbsoluteArtifactPath(proofPath, 'Print proof path')
        // The proof path selects an *adapter*, never a production request
        // field: what reaches the sink host is the same print request the
        // application submits natively.
        return await executePrintToProof(
          resolveOwner(ownerWebContentsId),
          Object.freeze(printRequest),
          proofPath
        )
      }

      assertAbsoluteArtifactPath(request.targetPath, 'Static sink target path')
      return await executeStaticSink(
        resolveOwner(ownerWebContentsId),
        Object.freeze({ ...request })
      )
    }
  })
}
