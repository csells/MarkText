import { describe, expect, it, vi } from 'vitest'
import {
  createImageDisplayProtocolHandler
} from 'main_renderer/imageAssets/imageDisplayProtocol'

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
])

const grant = Object.freeze({
  senderId: 41,
  documentId: 'document:owned',
  revisionId: 'revision:one',
  reference: 'assets/cat.png',
  pathname: '/private/main-only/cat.png'
})

function dependencies() {
  return {
    resolveCapability: vi.fn((): typeof grant | null => grant),
    assertRevision: vi.fn(async() => {}),
    assertPath: vi.fn(async() => {}),
    readImage: vi.fn(async() => ({
      bytes: PNG,
      mediaType: 'image/png' as const
    }))
  }
}

describe('image display protocol effect gate', () => {
  it('serves verified bytes only after capability and revision authentication', async() => {
    const deps = dependencies()
    const handle = createImageDisplayProtocolHandler(deps)

    const response = await handle(new Request(
      'marktext-image://asset/opaque-token'
    ))

    expect(deps.resolveCapability)
      .toHaveBeenCalledWith('marktext-image://asset/opaque-token')
    expect(deps.assertRevision).toHaveBeenCalledWith(grant)
    expect(deps.assertPath).toHaveBeenCalledWith(grant)
    expect(deps.readImage).toHaveBeenCalledWith(grant.pathname)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
  })

  it('rejects unknown capabilities before revision or filesystem effects', async() => {
    const deps = dependencies()
    deps.resolveCapability.mockReturnValue(null)
    const handle = createImageDisplayProtocolHandler(deps)

    const response = await handle(new Request(
      'marktext-image://asset/renderer-invented'
    ))

    expect(response.status).toBe(404)
    expect(deps.assertRevision).not.toHaveBeenCalled()
    expect(deps.assertPath).not.toHaveBeenCalled()
    expect(deps.readImage).not.toHaveBeenCalled()
  })

  it('rejects a stale revision before reading the retained pathname', async() => {
    const deps = dependencies()
    deps.assertRevision.mockRejectedValue(new Error('stale revision'))
    const handle = createImageDisplayProtocolHandler(deps)

    const response = await handle(new Request(
      'marktext-image://asset/stale-token'
    ))

    expect(response.status).toBe(404)
    expect(deps.assertPath).not.toHaveBeenCalled()
    expect(deps.readImage).not.toHaveBeenCalled()
  })

  it('rejects a grant whose document-relative path changed after minting', async() => {
    const deps = dependencies()
    deps.assertPath.mockRejectedValue(new Error('document path changed'))
    const handle = createImageDisplayProtocolHandler(deps)

    const response = await handle(new Request(
      'marktext-image://asset/relocated-token'
    ))

    expect(response.status).toBe(404)
    expect(deps.assertRevision).toHaveBeenCalledWith(grant)
    expect(deps.assertPath).toHaveBeenCalledWith(grant)
    expect(deps.readImage).not.toHaveBeenCalled()
  })

  it('fails closed when retained image bytes no longer verify', async() => {
    const deps = dependencies()
    deps.readImage.mockRejectedValue(new Error('unsupported image'))
    const handle = createImageDisplayProtocolHandler(deps)

    const response = await handle(new Request(
      'marktext-image://asset/changed-token'
    ))

    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain(grant.pathname)
  })

  it('rejects non-GET requests without any capability lookup', async() => {
    const deps = dependencies()
    const handle = createImageDisplayProtocolHandler(deps)

    const response = await handle(new Request(
      'marktext-image://asset/opaque-token',
      { method: 'POST' }
    ))

    expect(response.status).toBe(405)
    expect(deps.resolveCapability).not.toHaveBeenCalled()
  })
})
