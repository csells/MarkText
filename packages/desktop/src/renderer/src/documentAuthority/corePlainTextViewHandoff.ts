import type {
  CoreDocumentSessionManager,
  CoreDocumentViewLease
} from './coreDocumentSessionManager'
import type { MuyaPlainTextViewResult } from './muyaPlainTextView'

type PlainTextView = Extract<MuyaPlainTextViewResult, { kind: 'view' }>

export type CorePlainTextViewHandoffResult = Readonly<{
  readonly lease: CoreDocumentViewLease
  readonly view: PlainTextView
}>

/**
 * Acquires the first renderer lease for an already-open Core document only
 * after the actor has proven that its acknowledged revision can back the
 * bounded plain-text Muya view.
 */
export async function leaseCorePlainTextView(
  manager: Pick<
    CoreDocumentSessionManager,
    'plainTextViewBarrier' | 'activate' | 'lease'
  >,
  documentId: string
): Promise<CorePlainTextViewHandoffResult> {
  const reply = await manager.plainTextViewBarrier(documentId)
  if (reply.view.kind !== 'view') {
    throw new Error('Core plain-text WYSIWYG projection is unsupported')
  }
  await manager.activate(documentId)
  return Object.freeze({
    lease: manager.lease(documentId),
    view: reply.view
  })
}

/**
 * Projects an acknowledged Core revision before transferring the one live
 * view lease from Source to the bounded plain-text Muya adapter.
 */
export async function handoffCorePlainTextView(
  manager: Pick<
    CoreDocumentSessionManager,
    'plainTextViewBarrier' | 'handoff' | 'activate' | 'lease'
  >,
  sourceLease: CoreDocumentViewLease
): Promise<CorePlainTextViewHandoffResult> {
  const reply = await manager.plainTextViewBarrier(sourceLease.documentId)
  if (reply.view.kind !== 'view') {
    throw new Error('Core plain-text WYSIWYG projection is unsupported')
  }
  await manager.handoff(sourceLease)
  await manager.activate(sourceLease.documentId)
  return Object.freeze({
    lease: manager.lease(sourceLease.documentId),
    view: reply.view
  })
}
