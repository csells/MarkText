/**
 * Resolve a TOC target through the document view's parser-created registry.
 *
 * Queryable DOM classes and attributes are presentation, not proof of
 * ownership: hostile document content can imitate them. The owner supplied
 * here retains the exact element created from the parser snapshot.
 */
export interface TocHeadingOwner {
  readonly resolveHeadingElement: (nodeId: string) => HTMLElement | null
}

export const resolveTocHeadingElement = (
  owner: TocHeadingOwner,
  nodeId: unknown
): HTMLElement | null => {
  if (typeof nodeId !== 'string' || nodeId.length === 0) return null
  return owner.resolveHeadingElement(nodeId)
}
