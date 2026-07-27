import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const IMAGE_DISPLAY_SCHEME = 'marktext-image'

export interface ImageDisplayGrant {
  readonly senderId: number
  readonly documentId: string
  readonly revisionId: string
  readonly reference: string
  readonly pathname: string
}

export interface ImageDisplayCapabilityAuthority {
  readonly mint: (grant: ImageDisplayGrant) => string
  readonly resolve: (url: string) => ImageDisplayGrant | null
  readonly revokeSender: (senderId: number) => void
}

export function createImageDisplayCapabilityAuthority(
  createToken: () => string = randomUUID
): ImageDisplayCapabilityAuthority {
  const grants = new Map<string, ImageDisplayGrant>()
  const tokensBySender = new Map<number, Set<string>>()

  const mint = (grant: ImageDisplayGrant): string => {
    if (!Number.isSafeInteger(grant.senderId) || grant.senderId <= 0) {
      throw new TypeError('Image display sender identity is invalid')
    }
    for (const [value, label] of [
      [grant.documentId, 'document'],
      [grant.revisionId, 'revision']
    ] as const) {
      if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.includes('\0')
      ) {
        throw new TypeError(`Image display ${label} identity is invalid`)
      }
    }
    if (
      typeof grant.reference !== 'string' ||
      grant.reference.length === 0 ||
      grant.reference.length > 8192 ||
      grant.reference.includes('\0')
    ) {
      throw new TypeError('Image display reference is invalid')
    }
    if (
      typeof grant.pathname !== 'string' ||
      grant.pathname.length === 0 ||
      grant.pathname.includes('\0') ||
      !path.isAbsolute(grant.pathname)
    ) {
      throw new TypeError('Image display pathname is invalid')
    }
    const senderTokens = tokensBySender.get(grant.senderId) ?? new Set()
    for (const retainedToken of [...senderTokens]) {
      const retained = grants.get(retainedToken)
      if (retained === undefined) {
        senderTokens.delete(retainedToken)
        continue
      }
      if (
        retained.documentId === grant.documentId &&
        retained.revisionId === grant.revisionId &&
        retained.reference === grant.reference &&
        retained.pathname === grant.pathname
      ) {
        return `${IMAGE_DISPLAY_SCHEME}://asset/${retainedToken}`
      }
      if (
        retained.documentId === grant.documentId &&
        retained.revisionId !== grant.revisionId
      ) {
        grants.delete(retainedToken)
        senderTokens.delete(retainedToken)
      }
    }
    const token = createToken()
    if (
      typeof token !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,256}$/.test(token)
    ) {
      throw new TypeError('Image display capability token is invalid')
    }
    if (grants.has(token)) {
      throw new Error('Image display capability token collision')
    }
    const retained = Object.freeze({ ...grant })
    grants.set(token, retained)
    senderTokens.add(token)
    tokensBySender.set(grant.senderId, senderTokens)
    return `${IMAGE_DISPLAY_SCHEME}://asset/${token}`
  }

  const resolve = (url: string): ImageDisplayGrant | null => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    if (
      parsed.protocol !== `${IMAGE_DISPLAY_SCHEME}:` ||
      parsed.hostname !== 'asset' ||
      parsed.port !== '' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      !/^\/[a-zA-Z0-9_-]{1,256}$/.test(parsed.pathname)
    ) {
      return null
    }
    return grants.get(parsed.pathname.slice(1)) ?? null
  }

  const revokeSender = (senderId: number): void => {
    const tokens = tokensBySender.get(senderId)
    if (tokens === undefined) return
    tokensBySender.delete(senderId)
    for (const token of tokens) grants.delete(token)
  }

  return Object.freeze({ mint, resolve, revokeSender })
}

export const imageDisplayCapabilities =
  createImageDisplayCapabilityAuthority()
