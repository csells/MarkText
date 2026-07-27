import path from 'node:path'
import type { NodeId } from '@marktext/document-core'
import type {
  DocumentCoreOpenLinkReceipt,
  DocumentCoreOpenLinkRequest
} from '../../shared/types/documentCore'
import { decodeDocumentCoreOpenLinkRequest } from './documentCoreRuntimeCodec'

interface ResolvedDocumentLinkTarget {
  readonly kind: 'document-link-target'
  readonly revisionId: string
  readonly targetNodeId: NodeId
  readonly destination: string
}

export interface DocumentCoreLinkCoordinatorDependencies {
  readonly resolveTarget: (
    ownerId: string,
    request: DocumentCoreOpenLinkRequest
  ) => Promise<ResolvedDocumentLinkTarget>
  readonly describeDocument: (
    ownerId: string,
    documentId: string
  ) => Readonly<{ pathname: string | null }>
  readonly isMarkdownPath: (pathname: string) => boolean
  readonly isDangerousPath: (pathname: string) => boolean
  readonly openExternal: (destination: string) => void | Promise<void>
  readonly openMarkdownPath: (pathname: string) => void | Promise<void>
  readonly openPath: (pathname: string) => void | Promise<void>
  readonly confirmDangerousPath: (
    pathname: string
  ) => boolean | Promise<boolean>
}

const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function unavailable(
  reason: Extract<
    DocumentCoreOpenLinkReceipt,
    { kind: 'unavailable' }
  >['reason']
): DocumentCoreOpenLinkReceipt {
  return Object.freeze({ kind: 'unavailable', reason })
}

function assertResolvedTarget(
  target: ResolvedDocumentLinkTarget,
  request: DocumentCoreOpenLinkRequest
): void {
  if (
    target === null ||
    typeof target !== 'object' ||
    Reflect.ownKeys(target).length !== 4 ||
    target.kind !== 'document-link-target' ||
    target.revisionId !== request.revisionId ||
    target.targetNodeId !== request.targetNodeId ||
    typeof target.destination !== 'string'
  ) {
    throw new TypeError(
      'Document-core worker returned an invalid link target'
    )
  }
}

function decodedLocalPath(destination: string): string | null {
  try {
    const decoded = decodeURIComponent(destination)
    if (
      decoded.length === 0 ||
      [...decoded].some(character => {
        const point = character.codePointAt(0) ?? 0
        return point === 0 || (point >= 0x7f && point <= 0x9f)
      })
    ) {
      return null
    }
    return decoded
  } catch {
    return null
  }
}

/**
 * Admit a closed renderer request, resolve it against the main-owned immutable
 * revision, and only then choose a native effect from the parser destination.
 */
export async function coordinateDocumentCoreLinkOpen(
  rawRequest: unknown,
  ownerId: string,
  dependencies: DocumentCoreLinkCoordinatorDependencies
): Promise<DocumentCoreOpenLinkReceipt> {
  const request = decodeDocumentCoreOpenLinkRequest(rawRequest)
  const target = await dependencies.resolveTarget(ownerId, request)
  assertResolvedTarget(target, request)
  const destination = target.destination

  if (destination.length === 0) {
    return unavailable('empty-destination')
  }
  if (destination.startsWith('#')) {
    const fragment = destination.slice(1)
    return fragment.length === 0
      ? unavailable('empty-destination')
      : Object.freeze({ kind: 'anchor', fragment })
  }

  if (URI_SCHEME.test(destination) && !path.isAbsolute(destination)) {
    let parsed: URL
    try {
      parsed = new URL(destination)
    } catch {
      return unavailable('invalid-destination')
    }
    if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return unavailable('unsupported-scheme')
    }
    await dependencies.openExternal(destination)
    return Object.freeze({ kind: 'opened', target: 'external' })
  }

  const decoded = decodedLocalPath(destination)
  if (decoded === null) {
    return unavailable('invalid-destination')
  }
  let pathname: string
  if (path.isAbsolute(decoded)) {
    pathname = path.normalize(decoded)
  } else {
    const document = dependencies.describeDocument(
      ownerId,
      request.documentId
    )
    if (document.pathname === null) {
      return unavailable('document-path-unavailable')
    }
    pathname = path.normalize(path.join(
      path.dirname(document.pathname),
      decoded
    ))
  }

  if (dependencies.isMarkdownPath(pathname)) {
    await dependencies.openMarkdownPath(pathname)
    return Object.freeze({ kind: 'opened', target: 'markdown' })
  }
  if (
    dependencies.isDangerousPath(pathname) &&
    !await dependencies.confirmDangerousPath(pathname)
  ) {
    return Object.freeze({ kind: 'cancelled' })
  }
  await dependencies.openPath(pathname)
  return Object.freeze({ kind: 'opened', target: 'path' })
}
