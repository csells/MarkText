import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  copyUploaderDeletionUrl,
  inspectConfiguredUploader,
  uploadImage
} from '@/services/uploaderClient'
import type { UploaderUploadSource } from '@shared/types/uploader'

const uploadImageFn = vi.fn((payload: {
  documentId: string
}): Promise<unknown> => Promise.resolve({
  schema: 'uploader-upload-receipt-1',
  documentId: payload.documentId,
  url: 'https://cdn.example/cat.png',
  deletionClipboard: null
}))
const availabilityFn = vi.fn((payload: {
  kind: 'picgo' | 'custom-cli'
}): Promise<unknown> => Promise.resolve({
  schema: 'uploader-availability-receipt-1',
  kind: payload.kind,
  available: true
}))

const win = window as unknown as {
  uploader: {
    uploadImage: typeof uploadImageFn
    inspectAvailability: typeof availabilityFn
    copyDeletionUrl: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  uploadImageFn.mockClear()
  availabilityFn.mockClear()
  win.uploader = {
    uploadImage: uploadImageFn,
    inspectAvailability: availabilityFn,
    copyDeletionUrl: vi.fn()
  }
})

describe('typed uploader renderer client', () => {
  const source = (
    bytes: Uint8Array = Uint8Array.of(1, 2, 3)
  ): UploaderUploadSource => Object.freeze({
    kind: 'binary',
    name: 'cat.png',
    mediaType: 'image/png',
    bytes
  })

  it('sends a bounded semantic binary source without uploader settings', async() => {
    await expect(uploadImage('document:owned', source())).resolves.toEqual({
      schema: 'uploader-upload-receipt-1',
      documentId: 'document:owned',
      url: 'https://cdn.example/cat.png',
      deletionClipboard: null
    })

    const payload = uploadImageFn.mock.calls[0][0] as {
      schema: string
      documentId: string
      source: {
        kind: string
        name: string
        mediaType: string
        bytes: Uint8Array
      }
    }
    expect(payload).toMatchObject({
      schema: 'uploader-upload-1',
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'cat.png',
        mediaType: 'image/png'
      }
    })
    expect(payload.source.bytes).toBeInstanceOf(Uint8Array)
    expect([...payload.source.bytes]).toEqual([1, 2, 3])
  })

  it('rejects unsupported browser media before invoking IPC', async() => {
    await expect(uploadImage('document:owned', {
      ...source(),
      name: 'cat.html',
      mediaType: 'text/html'
    } as never))
      .rejects.toThrow(/media type/i)
    expect(uploadImageFn).not.toHaveBeenCalled()
  })

  it('rejects an open or mismatched main receipt', async() => {
    uploadImageFn.mockResolvedValueOnce({
      schema: 'uploader-upload-receipt-1',
      documentId: 'document:foreign',
      url: 'https://cdn.example/cat.png',
      rendererOverride: true
    })

    await expect(uploadImage(
      'document:owned',
      source(Uint8Array.of(1))
    ))
      .rejects.toThrow(/receipt|document|closed/i)
  })

  it('copies an uploader deletion URL using only its opaque capability', async() => {
    const copyDeletionUrl = vi.fn(async() => ({
      schema: 'uploader-deletion-clipboard-receipt-1',
      kind: 'written'
    }))
    win.uploader.copyDeletionUrl = copyDeletionUrl

    await expect(copyUploaderDeletionUrl({
      schema: 'uploader-deletion-clipboard-capability-1',
      token: 'token:owned'
    })).resolves.toBe(true)

    expect(copyDeletionUrl).toHaveBeenCalledWith({
      schema: 'uploader-deletion-clipboard-request-1',
      token: 'token:owned'
    })
  })

  it('inspects only a main-retained uploader kind with no path oracle', async() => {
    await expect(inspectConfiguredUploader('custom-cli')).resolves.toBe(true)

    expect(availabilityFn).toHaveBeenCalledWith({
      schema: 'uploader-availability-1',
      kind: 'custom-cli'
    })
    expect(availabilityFn.mock.calls[0][0]).not.toHaveProperty(
      'executablePath'
    )
  })
})
