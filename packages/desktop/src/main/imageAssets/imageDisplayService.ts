import path from 'node:path'
import { lstat, realpath } from 'node:fs/promises'
import type { ImageAssetDocumentDescription } from './imageAssetService'
import type { ImageDisplayReceipt } from '@shared/types/imageAsset'

export type ImageDisplayPathResolution =
  | Readonly<{
    readonly kind: 'resolved'
    readonly pathname: string
  }>
  | Readonly<{
    readonly kind: 'unavailable'
    readonly reason: Extract<
      ImageDisplayReceipt,
      { kind: 'unavailable' }
    >['reason']
  }>

export async function resolveImageDisplayPath(
  document: ImageAssetDocumentDescription,
  reference: string
): Promise<ImageDisplayPathResolution> {
  const unavailable = (
    reason: Extract<
      ImageDisplayReceipt,
      { kind: 'unavailable' }
    >['reason']
  ): ImageDisplayPathResolution => Object.freeze({
    kind: 'unavailable',
    reason
  })

  const windowsAbsoluteReference = /^[a-zA-Z]:[\\/]/.test(reference)
  if (
    reference.length === 0 ||
    reference.includes('\0') ||
    (
      !windowsAbsoluteReference &&
      /^[a-z][a-z\d+.-]*:/i.test(reference)
    ) ||
    /^(?:\\\\|\/\/)/.test(reference)
  ) {
    return unavailable('unsafe-reference')
  }

  const suffix = reference.search(/[?#]/)
  const pathnameReference = suffix === -1
    ? reference
    : reference.slice(0, suffix)
  let decoded: string
  try {
    decoded = decodeURIComponent(pathnameReference)
  } catch {
    return unavailable('unsafe-reference')
  }
  if (
    decoded.length === 0 ||
    decoded.includes('\0') ||
    /^(?:\\\\|\/\/)/.test(decoded)
  ) {
    return unavailable('unsafe-reference')
  }

  if (
    /^[a-zA-Z]:[\\/]/.test(decoded) &&
    process.platform !== 'win32'
  ) {
    return unavailable('unsafe-reference')
  }
  const absolute = path.isAbsolute(decoded)
  let candidate: string
  let canonicalRoot: string | null = null
  if (absolute) {
    candidate = path.resolve(decoded)
  } else {
    const segments = decoded.split(/[\\/]/)
    if (
      segments.some(segment =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..'
      )
    ) {
      return unavailable('unsafe-reference')
    }
    if (document.pathname === null) {
      return unavailable('untitled-document')
    }
    try {
      canonicalRoot = await realpath(
        path.dirname(path.resolve(document.pathname))
      )
    } catch {
      return unavailable('missing-image')
    }
    candidate = path.resolve(canonicalRoot, ...segments)
    if (!pathIsWithin(canonicalRoot, candidate)) {
      return unavailable('unsafe-reference')
    }
  }

  const extension = path.extname(candidate).toLowerCase()
  if (
    extension !== '.jpeg' &&
    extension !== '.jpg' &&
    extension !== '.png' &&
    extension !== '.gif' &&
    extension !== '.webp' &&
    extension !== '.svg'
  ) {
    return unavailable('unsupported-image')
  }

  try {
    const canonical = await realpath(candidate)
    if (
      canonicalRoot !== null &&
      !pathIsWithin(canonicalRoot, canonical)
    ) {
      return unavailable('unsafe-reference')
    }
    const stats = await lstat(canonical)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return unavailable('unsupported-image')
    }
    return Object.freeze({
      kind: 'resolved',
      pathname: canonical
    })
  } catch {
    return unavailable('missing-image')
  }
}

function pathIsWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (
      !path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`)
    )
  )
}
