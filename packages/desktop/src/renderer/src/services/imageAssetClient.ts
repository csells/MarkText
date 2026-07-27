import type {
  ImageAssetMediaType,
  ImageAssetSource
} from '@shared/types/imageAsset'
import {
  MAX_IMAGE_ASSET_BYTES
} from '@shared/types/imageAsset'

const CANONICAL_EXTENSION: Readonly<Record<ImageAssetMediaType, string>> =
  Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg'
  })

const EXTENSION_MEDIA_TYPE: Readonly<Record<string, ImageAssetMediaType>> =
  Object.freeze({
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml'
  })

function assertMediaType(value: string): ImageAssetMediaType {
  switch (value) {
    case 'image/jpeg':
    case 'image/png':
    case 'image/gif':
    case 'image/webp':
    case 'image/svg+xml':
      return value
    default:
      throw new TypeError('Clipboard file has an unsupported image media type')
  }
}

function fileMediaType(file: File): ImageAssetMediaType {
  if (file.type.length > 0) return assertMediaType(file.type)
  const match = /\.([^.]+)$/.exec(file.name)
  const extension = match?.[1]
  const inferred = extension === undefined
    ? undefined
    : EXTENSION_MEDIA_TYPE[extension.toLowerCase()]
  if (inferred === undefined) {
    throw new TypeError('Clipboard file has no supported image media type')
  }
  return inferred
}

/**
 * Copy browser File data into the closed, bounded value contract. A File never
 * grants renderer-selected pathname authority to main.
 */
export async function imageAssetSourceFromFile(
  file: File
): Promise<ImageAssetSource> {
  const mediaType = fileMediaType(file)
  const name = file.name || `clipboard.${CANONICAL_EXTENSION[mediaType]}`
  if (file.size < 1 || file.size > MAX_IMAGE_ASSET_BYTES) {
    throw new RangeError('Image file bytes are outside the supported size')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_IMAGE_ASSET_BYTES) {
    throw new RangeError('Image file bytes are outside the supported size')
  }
  return Object.freeze({
    kind: 'binary',
    name,
    mediaType,
    bytes
  })
}
