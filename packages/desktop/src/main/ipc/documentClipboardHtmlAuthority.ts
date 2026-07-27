import {
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto'

const AUTHORITY_KEY_BYTES = 32
const MARKER_NAMESPACE = '<!--marktext-private-source-'
const MARKER_PREFIX = `${MARKER_NAMESPACE}v1:`
const MARKER_SUFFIX = '-->'
const SIGNATURE_BYTES = 32
const BASE64URL = /^[A-Za-z0-9_-]*$/
const utf8 = new TextDecoder('utf-8', { fatal: true })

export type DocumentClipboardHtmlDecodeResult =
  | Readonly<{ readonly kind: 'absent' }>
  | Readonly<{ readonly kind: 'invalid' }>
  | Readonly<{ readonly kind: 'unauthenticated' }>
  | Readonly<{
    readonly kind: 'authenticated'
    readonly source: string
  }>

export interface DocumentClipboardHtmlAuthority {
  readonly encode: (source: string, visibleHtml?: string) => string
  readonly decode: (html: string) => DocumentClipboardHtmlDecodeResult
}

const escapeHtmlText = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const canonicalBase64Url = (
  encoded: string
): Buffer | null => {
  if (!BASE64URL.test(encoded)) return null
  const bytes = Buffer.from(encoded, 'base64url')
  return bytes.toString('base64url') === encoded ? bytes : null
}

export function createDocumentClipboardHtmlAuthority(
  rawKey: Uint8Array
): DocumentClipboardHtmlAuthority {
  if (rawKey.byteLength !== AUTHORITY_KEY_BYTES) {
    throw new RangeError(
      `Document clipboard HTML authority requires ${AUTHORITY_KEY_BYTES} key bytes`
    )
  }
  const key = Buffer.from(rawKey)
  const signature = (sourceBytes: Uint8Array): Buffer =>
    createHmac('sha256', key)
      .update('marktext-private-source-v1\0', 'utf8')
      .update(sourceBytes)
      .digest()

  const encode = (
    source: string,
    visibleHtml?: string
  ): string => {
    const sourceBytes = Buffer.from(source, 'utf8')
    const marker = [
      MARKER_PREFIX,
      sourceBytes.toString('base64url'),
      ':',
      signature(sourceBytes).toString('base64url'),
      MARKER_SUFFIX
    ].join('')
    const visible = visibleHtml ??
      `<pre>${escapeHtmlText(source)}</pre>`
    return `${marker}${visible}`
  }

  const decode = (html: string): DocumentClipboardHtmlDecodeResult => {
    if (!html.startsWith(MARKER_NAMESPACE)) {
      return Object.freeze({ kind: 'absent' as const })
    }
    if (!html.startsWith(MARKER_PREFIX)) {
      return Object.freeze({ kind: 'invalid' as const })
    }
    const markerEnd = html.indexOf(MARKER_SUFFIX, MARKER_PREFIX.length)
    if (
      markerEnd < 0 ||
      html.indexOf(MARKER_NAMESPACE, markerEnd + MARKER_SUFFIX.length) >= 0
    ) {
      return Object.freeze({ kind: 'invalid' as const })
    }
    const fields = html.slice(MARKER_PREFIX.length, markerEnd).split(':')
    if (fields.length !== 2) {
      return Object.freeze({ kind: 'invalid' as const })
    }
    const sourceBytes = canonicalBase64Url(fields[0] ?? '')
    const claimedSignature = canonicalBase64Url(fields[1] ?? '')
    if (
      sourceBytes === null ||
      claimedSignature === null ||
      claimedSignature.byteLength !== SIGNATURE_BYTES
    ) {
      return Object.freeze({ kind: 'invalid' as const })
    }
    if (!timingSafeEqual(signature(sourceBytes), claimedSignature)) {
      return Object.freeze({ kind: 'unauthenticated' as const })
    }
    let source: string
    try {
      source = utf8.decode(sourceBytes)
    } catch {
      return Object.freeze({ kind: 'invalid' as const })
    }
    return Object.freeze({
      kind: 'authenticated' as const,
      source
    })
  }

  return Object.freeze({ encode, decode })
}

const productionAuthority =
  createDocumentClipboardHtmlAuthority(randomBytes(AUTHORITY_KEY_BYTES))

export const encodeDocumentClipboardHtml = (
  source: string,
  visibleHtml?: string
): string => productionAuthority.encode(source, visibleHtml)

export const decodeDocumentClipboardHtml = (
  html: string
): DocumentClipboardHtmlDecodeResult =>
  productionAuthority.decode(html)
