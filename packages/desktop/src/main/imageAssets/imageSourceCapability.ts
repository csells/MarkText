import { randomUUID } from 'node:crypto'
import type { ImageSourceCapability } from '@shared/types/imageAsset'

interface RetainedImageSource {
  readonly senderId: number
  readonly pathname: string
}

export interface ImageSourceCapabilityAuthority {
  readonly mint: (
    senderId: number,
    pathname: string
  ) => ImageSourceCapability
  readonly consume: (
    senderId: number,
    token: string
  ) => Readonly<{ pathname: string }>
  readonly revokeSender: (senderId: number) => void
}

function assertSenderId(senderId: number): void {
  if (!Number.isSafeInteger(senderId) || senderId < 0) {
    throw new TypeError('Image source capability sender is invalid')
  }
}

function assertPathname(pathname: string): void {
  if (
    typeof pathname !== 'string' ||
    pathname.length === 0 ||
    pathname.includes('\0')
  ) {
    throw new TypeError('Image source capability pathname is invalid')
  }
}

function assertToken(token: string): void {
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 1_024 ||
    [...token].some(character => (character.codePointAt(0) ?? 0) <= 0x1f)
  ) {
    throw new TypeError('Image source capability token is invalid')
  }
}

export function createImageSourceCapabilityAuthority(
  createToken: () => string = () => `image-capability:${randomUUID()}`
): ImageSourceCapabilityAuthority {
  const retained = new Map<string, RetainedImageSource>()

  const mint = (
    senderId: number,
    pathname: string
  ): ImageSourceCapability => {
    assertSenderId(senderId)
    assertPathname(pathname)
    const token = createToken()
    assertToken(token)
    if (retained.has(token)) {
      throw new Error('Image source capability token was reused')
    }
    retained.set(token, Object.freeze({ senderId, pathname }))
    return Object.freeze({
      schema: 'image-source-capability-1',
      token
    })
  }

  const consume = (
    senderId: number,
    token: string
  ): Readonly<{ pathname: string }> => {
    assertSenderId(senderId)
    assertToken(token)
    const source = retained.get(token)
    if (source === undefined) {
      throw new Error('Unknown or consumed image source capability')
    }
    if (source.senderId !== senderId) {
      throw new Error('Image source capability belongs to another sender')
    }
    retained.delete(token)
    return Object.freeze({ pathname: source.pathname })
  }

  const revokeSender = (senderId: number): void => {
    assertSenderId(senderId)
    for (const [token, source] of retained) {
      if (source.senderId === senderId) retained.delete(token)
    }
  }

  return Object.freeze({ mint, consume, revokeSender })
}

export const imageSourceCapabilities =
  createImageSourceCapabilityAuthority()

interface ImageSourceSender {
  readonly id: number
  readonly once: (event: 'destroyed', listener: () => void) => unknown
}

const retainedSenders = new Set<number>()

export function mintImageSourceCapability(
  sender: ImageSourceSender,
  pathname: string
): ImageSourceCapability {
  if (!retainedSenders.has(sender.id)) {
    retainedSenders.add(sender.id)
    sender.once('destroyed', () => {
      retainedSenders.delete(sender.id)
      imageSourceCapabilities.revokeSender(sender.id)
    })
  }
  return imageSourceCapabilities.mint(sender.id, pathname)
}
