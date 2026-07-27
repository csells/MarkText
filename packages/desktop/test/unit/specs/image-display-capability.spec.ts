import { describe, expect, it } from 'vitest'
import {
  createImageDisplayCapabilityAuthority
} from 'main_renderer/imageAssets/imageDisplayCapability'

const grant = Object.freeze({
  senderId: 41,
  documentId: 'document:owned',
  revisionId: 'revision:one',
  reference: 'assets/cat.png',
  pathname: '/private/main-only/cat.png'
})

describe('main-owned image display capabilities', () => {
  it('mints an opaque URL without revealing the native pathname', () => {
    const authority = createImageDisplayCapabilityAuthority(
      () => 'opaque-token'
    )

    const src = authority.mint(grant)

    expect(src).toBe('marktext-image://asset/opaque-token')
    expect(src).not.toContain(grant.pathname)
    expect(authority.resolve(src)).toEqual(grant)
  })

  it('rejects malformed, unknown, and renderer-invented URLs', () => {
    const authority = createImageDisplayCapabilityAuthority(
      () => 'known-token'
    )
    authority.mint(grant)

    expect(authority.resolve('file:///private/main-only/cat.png')).toBeNull()
    expect(authority.resolve('marktext-image://other/known-token')).toBeNull()
    expect(authority.resolve('marktext-image://asset/unknown-token')).toBeNull()
    expect(authority.resolve(
      'marktext-image://asset/known-token/extra'
    )).toBeNull()
  })

  it('revokes every outstanding URL when its sender deactivates', () => {
    let ordinal = 0
    const authority = createImageDisplayCapabilityAuthority(
      () => `token-${++ordinal}`
    )
    const first = authority.mint(grant)
    const second = authority.mint({
      ...grant,
      revisionId: 'revision:two'
    })
    const other = authority.mint({
      ...grant,
      senderId: 42,
      documentId: 'document:other'
    })

    authority.revokeSender(41)

    expect(authority.resolve(first)).toBeNull()
    expect(authority.resolve(second)).toBeNull()
    expect(authority.resolve(other)?.senderId).toBe(42)
  })

  it('reuses an identical grant and drops an older document revision', () => {
    let ordinal = 0
    const authority = createImageDisplayCapabilityAuthority(
      () => `token-${++ordinal}`
    )
    const first = authority.mint(grant)
    expect(authority.mint(grant)).toBe(first)

    const current = authority.mint({
      ...grant,
      revisionId: 'revision:two'
    })

    expect(current).toBe('marktext-image://asset/token-2')
    expect(authority.resolve(first)).toBeNull()
    expect(authority.resolve(current)?.revisionId).toBe('revision:two')
  })

  it('rejects invalid identities and token collisions', () => {
    const authority = createImageDisplayCapabilityAuthority(
      () => 'same-token'
    )

    expect(() => authority.mint({
      ...grant,
      revisionId: ''
    })).toThrow(/revision/i)
    expect(() => authority.mint({
      ...grant,
      reference: ''
    })).toThrow(/reference/i)
    authority.mint(grant)
    expect(() => authority.mint({
      ...grant,
      pathname: '/private/main-only/dog.png'
    })).toThrow(/collision/i)
  })
})
