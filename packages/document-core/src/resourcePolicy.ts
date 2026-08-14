/**
 * Engine-owned document resource limits.
 *
 * Hosts select a supported execution profile; they cannot raise the limits
 * that protect the canonical source and durable session boundary.
 */
export const DOCUMENT_RESOURCE_POLICY_V1 = Object.freeze({
  schema: 'document-resource-policy-1' as const,
  maximumSourceUnits: 32_000_000,
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
