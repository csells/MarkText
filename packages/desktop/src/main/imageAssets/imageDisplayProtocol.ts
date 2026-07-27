import type {
  ImageAssetMediaType
} from '@shared/types/imageAsset'
import type {
  ImageDisplayGrant
} from './imageDisplayCapability'

export interface ImageDisplayProtocolDependencies {
  readonly resolveCapability: (url: string) => ImageDisplayGrant | null
  readonly assertRevision: (grant: ImageDisplayGrant) => Promise<void>
  readonly assertPath: (grant: ImageDisplayGrant) => Promise<void>
  readonly readImage: (
    pathname: string
  ) => Promise<Readonly<{
    bytes: Uint8Array
    mediaType: ImageAssetMediaType
  }>>
}

export function createImageDisplayProtocolHandler(
  dependencies: ImageDisplayProtocolDependencies
): (request: Request) => Promise<Response> {
  const rejected = (status: 404 | 405): Response => new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  })

  return async(request) => {
    if (request.method !== 'GET') return rejected(405)
    const grant = dependencies.resolveCapability(request.url)
    if (grant === null) return rejected(404)
    try {
      await dependencies.assertRevision(grant)
      await dependencies.assertPath(grant)
      const image = await dependencies.readImage(grant.pathname)
      return new Response(new Uint8Array(image.bytes), {
        status: 200,
        headers: {
          'Content-Type': image.mediaType,
          'Content-Length': String(image.bytes.byteLength),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox"
        }
      })
    } catch {
      return rejected(404)
    }
  }
}
