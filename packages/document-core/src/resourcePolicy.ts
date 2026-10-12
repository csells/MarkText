/**
 * Engine-owned document resource limits.
 *
 * Hosts select a supported execution profile; they cannot raise the limits
 * that protect the canonical source and durable session boundary.
 */
export const DOCUMENT_RESOURCE_POLICY_V1 = Object.freeze({
  maximumSourceUnits: 32_000_000,
  // Recoverable desktop ceiling that admits every document the renderer can
  // hold. From the 2 GiB V8 heap an Electron renderer gets on an 8 GB Mac
  // (larger machines get more), reserve 25% for the view and the full
  // 64,000,000-byte UTF-16 source, charge the measured 2 KiB peak per logical
  // node (open, three projections and a whole-document reparse), then round the
  // remaining 755,181-node budget down to a power of two. Nesting is bounded
  // separately by the Markdown and CriticMarkup depth limits.
  maximumLogicalNodes: 524_288,
  // The first v1 rope-shape boundary matches the recovery-journal outcome
  // cadence so monotonic piece growth exposes a maintenance opportunity before
  // that journal fills. The policies remain independently named and enforced.
  maximumSourceRopePieces: 256,
  maximumSourceEditsPerTransaction: 16_384,
  maximumHistoryEntries: 256,
  maximumHistoryInsertUnits: 64_000_000,
  maximumHistoryEditRecords: 8_192,
  maximumHistoryEditsPerEntry: 256,
  maximumJournalIngress: 4_096,
  maximumJournalOutcomes: 256
})
