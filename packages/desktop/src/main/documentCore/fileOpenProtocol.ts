import type { ParseConfiguration } from '@marktext/document-core'
import type { DocumentCoreMainSessionHost } from './mainSessionHost'

export interface StagedFileOpen {
  readonly ticketId: string
  readonly executionThreadId: number
  readonly ticketAdmissionMs: number
  readonly maximumMainStageMs: number
}

/**
 * The one caller-side file-open staging: ticket admission and the chunk
 * loop, timed. Production file hosting and the measurement surface both
 * stage through here, so a second open protocol cannot exist; completion
 * or cancellation stays with the caller, whose scenario it is.
 */
export async function stageFileOpenThroughProtocol(
  sessions: DocumentCoreMainSessionHost,
  ownerId: string,
  request: Readonly<{
    documentId: string
    durabilityKey: string
    sourceText: string
    parseConfiguration: ParseConfiguration
  }>
): Promise<StagedFileOpen> {
  const ticketStartedAt = performance.now()
  const ticket = await sessions.startOpen(ownerId, {
    documentId: request.documentId,
    durabilityKey: request.durabilityKey,
    sourceLength: request.sourceText.length,
    parseConfiguration: request.parseConfiguration
  })
  const ticketAdmissionMs = performance.now() - ticketStartedAt
  if (!ticket.requiresSource) {
    throw new Error('A new file open unexpectedly reused a session')
  }
  let ordinal = 0
  let maximumMainStageMs = 0
  for (
    let start = 0;
    start < request.sourceText.length;
    start += ticket.chunkUnits
  ) {
    const callerStageStartedAt = performance.now()
    const staged = sessions.appendOpenChunk(
      ownerId,
      request.documentId,
      ticket.ticketId,
      ordinal,
      request.sourceText.slice(start, start + ticket.chunkUnits)
    )
    const callerStageMs = performance.now() - callerStageStartedAt
    const receipt = await staged
    maximumMainStageMs = Math.max(
      maximumMainStageMs,
      callerStageMs,
      receipt.mainStageMs
    )
    ordinal += 1
  }
  return Object.freeze({
    ticketId: ticket.ticketId,
    executionThreadId: ticket.executionThreadId,
    ticketAdmissionMs,
    maximumMainStageMs
  })
}
