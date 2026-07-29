import type {
  SourceHashV1,
  StaticHtmlStructure
} from '@marktext/document-core'
import type {
  DocumentCorePdfSinkRequest,
  DocumentCorePrintSinkRequest,
  DocumentCoreStyledHtmlSinkRequest,
  DocumentCoreStaticSinkReceipt,
} from '../../shared/types/documentCore'
import {
  consumeDocumentCoreHostHtml,
  type DocumentCoreMainSessionHost
} from './mainSessionHost'
import type {
  DocumentCoreExportDecorator,
  DocumentCorePdfPageOptions
} from './exportDecorator'

export type DocumentCoreResolvedStaticSinkRequest =
  | Readonly<
    Omit<DocumentCoreStyledHtmlSinkRequest, 'suggestedName'> & {
      readonly targetPath: string
    }
  >
  | Readonly<
    Omit<DocumentCorePdfSinkRequest, 'suggestedName'> & {
      readonly targetPath: string
    }
  >
  | Readonly<DocumentCorePrintSinkRequest>

/**
 * Where a print actually goes. The adapter decides — native submission in
 * production, a written proof under automation — so the host never branches on
 * whether it is under test.
 */
export type DocumentCorePrintSubmission =
  | Readonly<{ readonly kind: 'submitted' }>
  | Readonly<{
    readonly kind: 'proof-written'
    readonly targetPath: string
    readonly bytes: number
  }>

export interface DocumentCoreStaticSinkSurface {
  readonly writeStyledHtml: (
    targetPath: string,
    html: string
  ) => Promise<number>
  readonly writePdf: (
    targetPath: string,
    html: string,
    pageOptions: DocumentCorePdfPageOptions
  ) => Promise<number>
  readonly submitPrint: (
    html: string,
    pageOptions: DocumentCorePdfPageOptions
  ) => Promise<DocumentCorePrintSubmission>
}

export interface DocumentCoreStaticSinkHost {
  readonly execute: (
    ownerId: string,
    request: DocumentCoreResolvedStaticSinkRequest
  ) => Promise<DocumentCoreStaticSinkReceipt>
}

function receiptBase<Request extends DocumentCoreResolvedStaticSinkRequest>(
  request: Request,
  revision: Readonly<{
    readonly id: string
    readonly sourceHash: SourceHashV1
  }>
): Readonly<{
    readonly schema: 'document-core-static-sink-receipt-1'
    readonly consumer: Request['consumer']
    readonly view: Request['view']
    readonly revisionId: string
    readonly sourceHash: SourceHashV1
  }> {
  return {
    schema: 'document-core-static-sink-receipt-1' as const,
    consumer: request.consumer,
    view: request.view,
    revisionId: revision.id,
    sourceHash: revision.sourceHash
  }
}

function assertRequestedRevision(
  request: DocumentCoreResolvedStaticSinkRequest,
  revision: Readonly<{ readonly id: string }>
): void {
  if (revision.id !== request.revisionId) {
    throw new Error(
      `Static sink requested stale revision ${request.revisionId}; ` +
      `main owns ${revision.id}`
    )
  }
}

function staticStructure(
  request: DocumentCoreResolvedStaticSinkRequest
): StaticHtmlStructure {
  return Object.freeze({
    headingAnchors: 'github-slug-v1',
    tableOfContents: Object.freeze({
      title: request.options.toc.title,
      includeTopHeading: request.options.toc.includeTopHeading
    })
  })
}

/**
 * Consume session-authenticated HTML directly into an Electron main sink.
 *
 * `TrustedHtml` never leaves this process and never appears in the returned
 * receipt. The renderer can ask for an operation and learn which immutable
 * revision completed it; it cannot become an HTML authority.
 */
export function createDocumentCoreStaticSinkHost(
  sessions: DocumentCoreMainSessionHost,
  surface: DocumentCoreStaticSinkSurface,
  decorator: DocumentCoreExportDecorator
): DocumentCoreStaticSinkHost {
  const execute = async(
    ownerId: string,
    request: DocumentCoreResolvedStaticSinkRequest
  ): Promise<DocumentCoreStaticSinkReceipt> => {
    if (request.consumer === 'styled-html') {
      const result = await sessions.materializeStatic(
        ownerId,
        request.documentId,
        {
          consumer: 'styled-html',
          view: request.view,
          structure: staticStructure(request)
        }
      )
      assertRequestedRevision(request, result.revision)
      if (result.kind === 'unavailable') {
        return Object.freeze({
          schema: 'document-core-static-sink-receipt-1',
          kind: 'unavailable',
          consumer: request.consumer,
          view: request.view,
          reason: result.reason,
          revisionId: result.revision.id
        })
      }
      const materializedHtml = consumeDocumentCoreHostHtml(
        result.artifact.html,
        'styled'
      )
      const decorated = await decorator.decorate(
        materializedHtml,
        request.consumer,
        request.options
      )
      const bytes = await surface.writeStyledHtml(
        request.targetPath,
        decorated.html
      )
      return Object.freeze({
        ...receiptBase(request, result.revision),
        kind: 'written',
        targetPath: request.targetPath,
        bytes
      })
    }

    if (request.consumer === 'pdf') {
      const result = await sessions.materializeStatic(
        ownerId,
        request.documentId,
        {
          consumer: 'pdf',
          view: request.view,
          structure: staticStructure(request)
        }
      )
      assertRequestedRevision(request, result.revision)
      if (result.kind === 'unavailable') {
        return Object.freeze({
          schema: 'document-core-static-sink-receipt-1',
          kind: 'unavailable',
          consumer: request.consumer,
          view: request.view,
          reason: result.reason,
          revisionId: result.revision.id
        })
      }
      const materializedHtml = consumeDocumentCoreHostHtml(
        result.artifact.html,
        'pdf'
      )
      const decorated = await decorator.decorate(
        materializedHtml,
        request.consumer,
        request.options
      )
      if (decorated.pdfPageOptions === undefined) {
        throw new Error('PDF export decoration omitted page options')
      }
      const bytes = await surface.writePdf(
        request.targetPath,
        decorated.html,
        decorated.pdfPageOptions
      )
      return Object.freeze({
        ...receiptBase(request, result.revision),
        kind: 'written',
        targetPath: request.targetPath,
        bytes
      })
    }

    const result = await sessions.materializeStatic(
      ownerId,
      request.documentId,
      {
        consumer: 'print',
        view: request.view,
        structure: staticStructure(request)
      }
    )
    assertRequestedRevision(request, result.revision)
    if (result.kind === 'unavailable') {
      return Object.freeze({
        schema: 'document-core-static-sink-receipt-1',
        kind: 'unavailable',
        consumer: request.consumer,
        view: request.view,
        reason: result.reason,
        revisionId: result.revision.id
      })
    }
    const materializedHtml = consumeDocumentCoreHostHtml(
      result.artifact.html,
      'print'
    )
    const decorated = await decorator.decorate(
      materializedHtml,
      request.consumer,
      request.options
    )
    if (decorated.pdfPageOptions === undefined) {
      throw new Error('Print export decoration omitted page options')
    }
    const submission = await surface.submitPrint(
      decorated.html,
      decorated.pdfPageOptions
    )
    if (submission.kind === 'proof-written') {
      return Object.freeze({
        ...receiptBase(request, result.revision),
        kind: 'proof-written',
        targetPath: submission.targetPath,
        bytes: submission.bytes
      })
    }
    return Object.freeze({
      ...receiptBase(request, result.revision),
      kind: 'submitted'
    })
  }

  return Object.freeze({ execute })
}
