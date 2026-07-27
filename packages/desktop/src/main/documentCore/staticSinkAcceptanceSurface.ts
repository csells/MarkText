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
}

type ResolveOwner = (webContentsId: number) => string
type ExecuteStaticSink = (
  ownerId: string,
  request: DocumentCoreResolvedStaticSinkRequest
) => Promise<DocumentCoreStaticSinkReceipt>

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
  executeStaticSink: ExecuteStaticSink
): DocumentCoreStaticSinkAcceptanceSurface {
  return Object.freeze({
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
        assertAbsoluteArtifactPath(request.proofPath, 'Print proof path')
        return await executeStaticSink(
          resolveOwner(ownerWebContentsId),
          Object.freeze({ ...request })
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
