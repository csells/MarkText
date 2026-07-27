import type {
  CompleteDocumentRevision,
  DocumentRevision,
  MarkdownDocument,
  NodeId
} from '../revision.js'
import { markdownTextValue } from './htmlRender.js'

export interface DocumentLinkTarget {
  readonly kind: 'document-link-target'
  readonly targetNodeId: NodeId
  readonly destination: string
}

function assertComplete(
  revision: DocumentRevision
): asserts revision is CompleteDocumentRevision {
  if (revision.kind !== 'complete') {
    throw new RangeError('SourceOnly revision has no semantic document links')
  }
}

function documentLinkTarget(
  document: MarkdownDocument,
  targetNodeId: NodeId
): DocumentLinkTarget | undefined {
  const target = document.references.linkForNode(targetNodeId)
  if (target === undefined || target.node.kind === 'image') return undefined
  const destination =
    target.node.kind === 'autolink' ||
    typeof target.node.attributes['destination'] === 'string'
      ? target.destination
      : markdownTextValue(target.destination)
  return Object.freeze({
    kind: 'document-link-target',
    targetNodeId,
    destination
  })
}

/**
 * Resolve a node in one parser-owned immutable Markdown document.
 *
 * Session hosts use this form because their current immutable snapshot exposes
 * the exact display document while deliberately hiding the revision kernel.
 */
export function resolveMarkdownDocumentLinkTarget(
  document: MarkdownDocument,
  targetNodeId: NodeId
): DocumentLinkTarget {
  const target = documentLinkTarget(document, targetNodeId)
  if (target !== undefined) {
    return target
  }
  throw new RangeError(
    `Parser node ${targetNodeId} is not a link in this revision`
  )
}

/**
 * Resolve one parser-issued live-node identity against this exact revision.
 *
 * The caller supplies no URL, path, source range, or view. The query searches
 * the revision's already-emitted fork documents and returns only the semantic
 * destination owned by the matching link/autolink node.
 */
export function resolveDocumentLinkTarget(
  revision: DocumentRevision,
  targetNodeId: NodeId
): DocumentLinkTarget {
  assertComplete(revision)
  const documents = new Set<MarkdownDocument>([
    revision.projection('editing').markdown,
    revision.projection('original').markdown,
    revision.projection('revised').markdown
  ])
  for (const document of documents) {
    const target = documentLinkTarget(document, targetNodeId)
    if (target !== undefined) return target
  }
  throw new RangeError(
    `Parser node ${targetNodeId} is not a link in this revision`
  )
}
