import { describe, expect, it } from 'vitest'
import {
  imageAssetSourceFromFile
} from '@/services/imageAssetClient'
import { MAX_IMAGE_ASSET_BYTES } from '@shared/types/imageAsset'

describe('renderer image asset source', () => {
  it('copies clipboard File bytes without exposing a pathname', async() => {
    const file = new File([
      new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
      ])
    ], '', { type: 'image/png' })

    const source = await imageAssetSourceFromFile(file)

    expect(source).toEqual({
      kind: 'binary',
      name: 'clipboard.png',
      mediaType: 'image/png',
      bytes: new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
      ])
    })
    expect(source).not.toHaveProperty('pathname')
  })

  it('rejects unsupported clipboard types before any IPC is possible', async() => {
    const file = new File(['<html>'], 'payload.html', {
      type: 'text/html'
    })

    await expect(imageAssetSourceFromFile(file)).rejects.toThrow(/image|media/i)
  })

  it('derives a missing drag-file media type from its closed image extension', async() => {
    const source = await imageAssetSourceFromFile(new File([
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    ], 'picked.jpg'))

    expect(source).toMatchObject({
      kind: 'binary',
      name: 'picked.jpg',
      mediaType: 'image/jpeg'
    })
  })

  it('rejects empty and oversized Files before reading their bytes', async() => {
    let reads = 0
    const file = {
      name: 'large.png',
      type: 'image/png',
      size: MAX_IMAGE_ASSET_BYTES + 1,
      arrayBuffer: async() => {
        reads += 1
        return new ArrayBuffer(0)
      }
    } as File

    await expect(imageAssetSourceFromFile(file)).rejects.toThrow(/size/i)
    expect(reads).toBe(0)
  })
})
