import { randomUUID } from 'node:crypto'
import type {
  UploaderDeletionClipboardCapability
} from '../../shared/types/clipboardTransactions'

interface RetainedDeletionUrl {
  readonly senderId: number
  readonly url: string
  readonly expiresAt: number
}

export interface UploaderDeletionClipboardAuthority {
  readonly mint: (
    senderId: number,
    deletionUrl: string
  ) => UploaderDeletionClipboardCapability
  readonly consume: (senderId: number, token: string) => string
  readonly revokeSender: (senderId: number) => void
}

export interface UploaderDeletionClipboardAuthorityOptions {
  readonly createToken?: () => string
  readonly now?: () => number
  readonly lifetimeMs?: number
  readonly maxEntriesPerSender?: number
}

const DEFAULT_LIFETIME_MS = 10 * 60 * 1_000
const DEFAULT_MAX_ENTRIES_PER_SENDER = 32

function verifiedSenderId(senderId: number): number {
  if (!Number.isSafeInteger(senderId) || senderId <= 0) {
    throw new TypeError('Uploader deletion capability sender is invalid')
  }
  return senderId
}

function verifiedDeletionUrl(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    /\s/.test(value)
  ) {
    throw new TypeError('Uploader deletion URL is invalid')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new TypeError('Uploader deletion URL is invalid')
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.hostname.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new TypeError(
      'Uploader deletion URL must be an HTTP URL without credentials'
    )
  }
  return value
}

function verifiedToken(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value.includes('\0')
  ) {
    throw new TypeError('Uploader deletion capability token is invalid')
  }
  return value
}

export function createUploaderDeletionClipboardAuthority({
  createToken = randomUUID,
  now = Date.now,
  lifetimeMs = DEFAULT_LIFETIME_MS,
  maxEntriesPerSender = DEFAULT_MAX_ENTRIES_PER_SENDER
}: UploaderDeletionClipboardAuthorityOptions = {}):
  UploaderDeletionClipboardAuthority {
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0) {
    throw new TypeError('Uploader deletion capability lifetime is invalid')
  }
  if (
    !Number.isSafeInteger(maxEntriesPerSender) ||
    maxEntriesPerSender <= 0
  ) {
    throw new TypeError('Uploader deletion capability capacity is invalid')
  }

  const retained = new Map<string, RetainedDeletionUrl>()

  const pruneExpired = (currentTime: number): void => {
    for (const [token, entry] of retained) {
      if (entry.expiresAt <= currentTime) retained.delete(token)
    }
  }

  const mint = (
    rawSenderId: number,
    rawDeletionUrl: string
  ): UploaderDeletionClipboardCapability => {
    const senderId = verifiedSenderId(rawSenderId)
    const url = verifiedDeletionUrl(rawDeletionUrl)
    const currentTime = now()
    pruneExpired(currentTime)

    const senderTokens = [...retained]
      .filter(([, entry]) => entry.senderId === senderId)
      .map(([token]) => token)
    while (senderTokens.length >= maxEntriesPerSender) {
      const oldest = senderTokens.shift()
      if (oldest !== undefined) retained.delete(oldest)
    }

    const token = verifiedToken(createToken())
    if (retained.has(token)) {
      throw new Error('Uploader deletion capability token collision')
    }
    retained.set(token, Object.freeze({
      senderId,
      url,
      expiresAt: currentTime + lifetimeMs
    }))
    return Object.freeze({
      schema: 'uploader-deletion-clipboard-capability-1',
      token
    })
  }

  const consume = (rawSenderId: number, rawToken: string): string => {
    const senderId = verifiedSenderId(rawSenderId)
    const token = verifiedToken(rawToken)
    const entry = retained.get(token)
    if (entry === undefined) {
      throw new Error('Uploader deletion capability is unknown or already used')
    }
    if (entry.expiresAt <= now()) {
      retained.delete(token)
      throw new Error('Uploader deletion capability expired')
    }
    if (entry.senderId !== senderId) {
      throw new Error('Uploader deletion capability belongs to another sender')
    }
    retained.delete(token)
    return entry.url
  }

  const revokeSender = (rawSenderId: number): void => {
    const senderId = verifiedSenderId(rawSenderId)
    for (const [token, entry] of retained) {
      if (entry.senderId === senderId) retained.delete(token)
    }
  }

  return Object.freeze({
    mint: Object.freeze(mint),
    consume: Object.freeze(consume),
    revokeSender: Object.freeze(revokeSender)
  })
}
