export type RendererDocumentAuthority = 'core' | 'legacy'

/**
 * Bus/Pinia Markdown is a legacy renderer input. A mounted Core view is
 * replaced through its lease generation and must never ingest that snapshot.
 */
export const acceptsRendererDocumentPayload = (
  authority: RendererDocumentAuthority
): boolean => authority === 'legacy'
