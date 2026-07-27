import { describe, expect, it, vi } from 'vitest'
import type { UploaderUploadReceipt } from '@shared/types/uploader'
import {
  admitImageInsertion,
  completeAsyncImageInsertion,
  completeUploadedImageInsertion,
  type ImageInsertionContext,
  type ImageReferenceInsertionHost
} from '@/services/asyncImageInsertion'

interface TestHost extends ImageReferenceInsertionHost {
  readonly insertImage: (
    image: Readonly<{ readonly src: string }>
  ) => Promise<void>
  readonly insertSourceImage: (
    image: Readonly<{ readonly src: string }>
  ) => Promise<void>
}

function uploaderReceipt(documentId: string): UploaderUploadReceipt {
  return Object.freeze({
    schema: 'uploader-upload-receipt-1',
    documentId,
    url: 'https://cdn.example/cat.png',
    deletionClipboard: null
  })
}

function deferred<Result>(): Readonly<{
  promise: Promise<Result>
  resolve: (value: Result) => void
}> {
  let resolveDeferred: ((value: Result) => void) | undefined
  const promise = new Promise<Result>(resolve => {
    resolveDeferred = resolve
  })
  return Object.freeze({
    promise,
    resolve: value => {
      if (resolveDeferred === undefined) {
        throw new Error('Deferred is unavailable')
      }
      resolveDeferred(value)
    }
  })
}

describe('async image insertion admission', () => {
  it('rejects a deferred upload after a tab switch without inserting its URL', async() => {
    const host: TestHost = {
      settled: async() => {},
      snapshot: () => ({
        revisionId: 'revision:1',
        sourceSelection: { anchor: 0, focus: 0 }
      }),
      selection: () => ({
        anchor: { offset: 3 },
        focus: { offset: 3 }
      }),
      insertImage: vi.fn(async() => {}),
      insertSourceImage: vi.fn(async() => {})
    }
    let current: ImageInsertionContext<TestHost> = {
      documentId: 'document:a',
      surface: 'markup',
      host
    }
    const readContext = (): ImageInsertionContext<TestHost> => current
    const admission = await admitImageInsertion(readContext)
    const upload = deferred<UploaderUploadReceipt>()
    const insertion = completeUploadedImageInsertion(
      admission,
      upload.promise,
      readContext
    )

    current = {
      documentId: 'document:b',
      surface: 'markup',
      host
    }
    upload.resolve(uploaderReceipt('document:a'))

    await expect(insertion).rejects.toThrow(/admission|document|changed/i)
    expect(host.insertImage).not.toHaveBeenCalled()
    expect(host.insertSourceImage).not.toHaveBeenCalled()
  })

  it('rejects a mismatched uploader receipt before insertion', async() => {
    const host: TestHost = {
      settled: async() => {},
      snapshot: () => ({
        revisionId: 'revision:1',
        sourceSelection: { anchor: 0, focus: 0 }
      }),
      selection: () => ({
        anchor: { offset: 3 },
        focus: { offset: 3 }
      }),
      insertImage: vi.fn(async() => {}),
      insertSourceImage: vi.fn(async() => {})
    }
    const context: ImageInsertionContext<TestHost> = {
      documentId: 'document:a',
      surface: 'markup',
      host
    }
    const admission = await admitImageInsertion(() => context)

    await expect(completeUploadedImageInsertion(
      admission,
      Promise.resolve(uploaderReceipt('document:b')),
      () => context
    )).rejects.toThrow(/receipt|document/i)
    expect(host.insertImage).not.toHaveBeenCalled()
    expect(host.insertSourceImage).not.toHaveBeenCalled()
  })

  it('rejects a local File result when selection changed while bytes loaded', async() => {
    let anchor = 3
    const host: TestHost = {
      settled: async() => {},
      snapshot: () => ({
        revisionId: 'revision:1',
        sourceSelection: { anchor: 0, focus: 0 }
      }),
      selection: () => ({
        anchor: { offset: anchor },
        focus: { offset: anchor }
      }),
      insertImage: vi.fn(async() => {}),
      insertSourceImage: vi.fn(async() => {})
    }
    const context: ImageInsertionContext<TestHost> = {
      documentId: 'document:a',
      surface: 'markup',
      host
    }
    const admission = await admitImageInsertion(() => context)
    const fileRead = deferred<Uint8Array>()
    const insertion = completeAsyncImageInsertion(
      admission,
      fileRead.promise,
      () => context,
      async(target, _surface, bytes) => {
        await target.insertImage({ src: String(bytes.byteLength) })
      }
    )

    anchor = 8
    fileRead.resolve(Uint8Array.of(1, 2, 3))

    await expect(insertion).rejects.toThrow(/admission|revision|selection/i)
    expect(host.insertImage).not.toHaveBeenCalled()
    expect(host.insertSourceImage).not.toHaveBeenCalled()
  })

  it('rejects an upload returned for a superseded revision', async() => {
    let revisionId = 'revision:1'
    const host: TestHost = {
      settled: async() => {},
      snapshot: () => ({
        revisionId,
        sourceSelection: { anchor: 0, focus: 0 }
      }),
      selection: () => ({
        anchor: { offset: 3 },
        focus: { offset: 3 }
      }),
      insertImage: vi.fn(async() => {}),
      insertSourceImage: vi.fn(async() => {})
    }
    const context: ImageInsertionContext<TestHost> = {
      documentId: 'document:a',
      surface: 'markup',
      host
    }
    const admission = await admitImageInsertion(() => context)
    revisionId = 'revision:2'

    await expect(completeUploadedImageInsertion(
      admission,
      Promise.resolve(uploaderReceipt('document:a')),
      () => context
    )).rejects.toThrow(/admission|revision|changed/i)
    expect(host.insertImage).not.toHaveBeenCalled()
    expect(host.insertSourceImage).not.toHaveBeenCalled()
  })

  it('inserts only after the exact document, revision, surface, and selection survive', async() => {
    const insertImage = vi.fn(async() => {})
    const insertSourceImage = vi.fn(async() => {})
    const host: TestHost = {
      settled: async() => {},
      snapshot: () => ({
        revisionId: 'revision:1',
        sourceSelection: { anchor: 2, focus: 4 }
      }),
      selection: () => ({
        anchor: { offset: 9 },
        focus: { offset: 9 }
      }),
      insertImage,
      insertSourceImage
    }
    const context: ImageInsertionContext<TestHost> = {
      documentId: 'document:a',
      surface: 'source',
      host
    }
    const admission = await admitImageInsertion(() => context)

    await expect(completeUploadedImageInsertion(
      admission,
      Promise.resolve(uploaderReceipt('document:a')),
      () => context
    )).resolves.toEqual(uploaderReceipt('document:a'))

    expect(insertImage).not.toHaveBeenCalled()
    expect(insertSourceImage).toHaveBeenCalledWith({
      src: 'https://cdn.example/cat.png'
    })
  })
})
