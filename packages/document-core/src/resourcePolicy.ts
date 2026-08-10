/**
 * Engine-owned document resource limits.
 *
 * Hosts select a supported execution profile; they cannot raise the limits
 * that protect the canonical source and durable session boundary.
 */
export const DOCUMENT_RESOURCE_POLICY_V1 = Object.freeze({
  schema: 'document-resource-policy-1' as const,
  maximumSourceUnits: 32_000_000,
  maximumSourceEditsPerTransaction: 16_384,
  maximumHistoryEntries: 256,
  maximumHistoryInsertUnits: 64_000_000,
  maximumJournalIngress: 4_096,
  maximumJournalOutcomes: 256
})
