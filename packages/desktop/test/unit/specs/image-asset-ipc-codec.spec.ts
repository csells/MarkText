import { describe, expect, it } from 'vitest'
import {
  MAX_IMAGE_ASSET_BYTES,
  decodeImageAssetActivationRequest,
  decodeImageAssetInsertRequest,
  decodeImageDisplayRequest
} from 'main_renderer/ipc/imageAssetRuntimeCodec'

describe('image-asset IPC codec', () => {
  const target = Object.freeze({
    session: 'session:owned',
    revision: 'revision:one',
    view: 'markup' as const,
    anchor: Object.freeze({ offset: 4, affinity: 'next' as const }),
    focus: Object.freeze({ offset: 4, affinity: 'next' as const })
  })

  it('freezes one revision/selection-bound native capability insertion', () => {
    const decoded = decodeImageAssetInsertRequest({
      schema: 'image-asset-insert-1',
      documentId: 'document:owned',
      baseSnapshotId: 'snapshot:one',
      revisionId: 'revision:one',
      target,
      source: {
        kind: 'native-capability',
        token: 'image-capability:opaque'
      },
      storage: 'document-relative',
      alt: 'cat'
    })

    expect(decoded).toEqual({
      schema: 'image-asset-insert-1',
      documentId: 'document:owned',
      baseSnapshotId: 'snapshot:one',
      revisionId: 'revision:one',
      target,
      source: {
        kind: 'native-capability',
        token: 'image-capability:opaque'
      },
      storage: 'document-relative',
      alt: 'cat'
    })
    expect(Object.isFrozen(decoded)).toBe(true)
    expect(Object.isFrozen(decoded.source)).toBe(true)
    expect(Object.isFrozen(decoded.target)).toBe(true)
    expect(decoded).not.toHaveProperty('targetPath')
  })

  it('freezes a bounded binary image insertion', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const decoded = decodeImageAssetInsertRequest({
      schema: 'image-asset-insert-1',
      documentId: 'document:owned',
      baseSnapshotId: 'snapshot:one',
      revisionId: 'revision:one',
      target,
      source: {
        kind: 'binary',
        name: 'clipboard.png',
        mediaType: 'image/png',
        bytes
      },
      storage: 'configured-folder',
      alt: ''
    })

    expect(decoded.source.kind).toBe('binary')
    if (decoded.source.kind !== 'binary') throw new Error('expected binary source')
    expect(decoded.source.bytes).toEqual(bytes)
    expect(decoded.source.bytes).not.toBe(bytes)
    bytes[0] = 0
    expect(decoded.source.bytes[0]).toBe(0x89)
  })

  it.each([
    {
      label: 'a renderer pathname source',
      value: {
        schema: 'image-asset-insert-1',
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:one',
        revisionId: 'revision:one',
        target,
        source: {
          kind: 'local-file',
          pathname: '/private/attacker-chosen.png'
        },
        storage: 'configured-folder',
        alt: ''
      }
    },
    {
      label: 'unknown top-level destination',
      value: {
        schema: 'image-asset-insert-1',
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:one',
        revisionId: 'revision:one',
        target,
        source: {
          kind: 'binary',
          name: 'cat.png',
          mediaType: 'image/png',
          bytes: new Uint8Array([1])
        },
        storage: 'configured-folder',
        alt: '',
        targetPath: '/tmp/attacker-chosen'
      }
    },
    {
      label: 'unknown source destination',
      value: {
        schema: 'image-asset-insert-1',
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:one',
        revisionId: 'revision:one',
        target,
        source: {
          kind: 'binary',
          name: 'cat.png',
          mediaType: 'image/png',
          bytes: new Uint8Array([1]),
          outputDir: '/tmp/attacker-chosen'
        },
        storage: 'configured-folder',
        alt: ''
      }
    },
    {
      label: 'traversal filename',
      value: {
        schema: 'image-asset-insert-1',
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:one',
        revisionId: 'revision:one',
        target,
        source: {
          kind: 'binary',
          name: '../cat.png',
          mediaType: 'image/png',
          bytes: new Uint8Array([1])
        },
        storage: 'configured-folder',
        alt: ''
      }
    },
    {
      label: 'absolute filename',
      value: {
        schema: 'image-asset-insert-1',
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:one',
        revisionId: 'revision:one',
        target,
        source: {
          kind: 'binary',
          name: '/tmp/cat.png',
          mediaType: 'image/png',
          bytes: new Uint8Array([1])
        },
        storage: 'configured-folder',
        alt: ''
      }
    },
    {
      label: 'empty document identity',
      value: {
        schema: 'image-asset-insert-1',
        documentId: '',
        baseSnapshotId: 'snapshot:one',
        revisionId: 'revision:one',
        target,
        source: {
          kind: 'native-capability',
          token: 'image-capability:opaque'
        },
        storage: 'reference',
        alt: ''
      }
    },
    {
      label: 'unknown storage policy',
      value: {
        schema: 'image-asset-insert-1',
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:one',
        revisionId: 'revision:one',
        target,
        source: {
          kind: 'native-capability',
          token: 'image-capability:opaque'
        },
        storage: 'renderer-path',
        alt: ''
      }
    },
    {
      label: 'unsupported binary type',
      value: {
        schema: 'image-asset-insert-1',
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:one',
        revisionId: 'revision:one',
        target,
        source: {
          kind: 'binary',
          name: 'payload.html',
          mediaType: 'text/html',
          bytes: new Uint8Array([1])
        },
        storage: 'configured-folder',
        alt: ''
      }
    },
    {
      label: 'oversized binary',
      value: {
        schema: 'image-asset-insert-1',
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:one',
        revisionId: 'revision:one',
        target,
        source: {
          kind: 'binary',
          name: 'large.png',
          mediaType: 'image/png',
          bytes: new Uint8Array(MAX_IMAGE_ASSET_BYTES + 1)
        },
        storage: 'configured-folder',
        alt: ''
      }
    },
    {
      label: 'revision mismatched from the parser selection',
      value: {
        schema: 'image-asset-insert-1',
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:one',
        revisionId: 'revision:two',
        target,
        source: {
          kind: 'native-capability',
          token: 'image-capability:opaque'
        },
        storage: 'reference',
        alt: ''
      }
    }
  ])('rejects $label', ({ value }) => {
    expect(() => decodeImageAssetInsertRequest(value)).toThrow()
  })

  it('decodes one closed active-document declaration', () => {
    expect(decodeImageAssetActivationRequest({
      schema: 'image-asset-activation-1',
      documentId: 'document:owned'
    })).toEqual({
      schema: 'image-asset-activation-1',
      documentId: 'document:owned'
    })
  })

  it('decodes one closed revision-bound image display reference', () => {
    const decoded = decodeImageDisplayRequest({
      schema: 'image-display-1',
      documentId: 'document:owned',
      revisionId: 'revision:one',
      reference: 'assets/cat.png'
    })

    expect(decoded).toEqual({
      schema: 'image-display-1',
      documentId: 'document:owned',
      revisionId: 'revision:one',
      reference: 'assets/cat.png'
    })
    expect(Object.isFrozen(decoded)).toBe(true)
  })

  it.each([
    {
      schema: 'image-display-1',
      documentId: 'document:owned',
      revisionId: 'revision:one',
      reference: 'assets/cat.png',
      pathname: '/private/renderer-chosen.png'
    },
    {
      schema: 'image-display-1',
      documentId: 'document:owned',
      revisionId: '',
      reference: 'assets/cat.png'
    },
    {
      schema: 'image-display-1',
      documentId: 'document:owned',
      revisionId: 'revision:one',
      reference: ''
    }
  ])('rejects a malformed display request %#', value => {
    expect(() => decodeImageDisplayRequest(value)).toThrow()
  })
})
