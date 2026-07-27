import { describe, expect, it } from 'vitest'
import {
  MAX_UPLOADER_IMAGE_BYTES,
  decodeUploaderAvailabilityRequest,
  decodeUploaderUploadRequest
} from 'main_renderer/ipc/uploaderRuntimeCodec'

describe('uploader IPC codec', () => {
  it('decodes and freezes one narrow binary upload intent', () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a
    ])
    const decoded = decodeUploaderUploadRequest({
      schema: 'uploader-upload-1',
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'clipboard.png',
        mediaType: 'image/png',
        bytes
      }
    })

    expect(decoded).toEqual({
      schema: 'uploader-upload-1',
      documentId: 'document:owned',
      source: {
        kind: 'binary',
        name: 'clipboard.png',
        mediaType: 'image/png',
        bytes
      }
    })
    expect(Object.isFrozen(decoded)).toBe(true)
    expect(Object.isFrozen(decoded.source)).toBe(true)
    if (decoded.source.kind !== 'binary') {
      throw new Error('Expected binary upload source')
    }
    expect(decoded.source.bytes).not.toBe(bytes)
  })

  it.each([
    {
      name: 'renderer-authority payload',
      value: {
        pathname: '/notes/draft.md',
        image: '/tmp/cat.png',
        isPath: true,
        preferences: {
          currentUploader: 'cliScript',
          cliScript: '/tmp/attacker'
        }
      }
    },
    {
      name: 'extra CLI authority',
      value: {
        schema: 'uploader-upload-1',
        documentId: 'document:owned',
        source: {
          kind: 'local-file',
          pathname: 'cat.png'
        },
        cliScript: '/tmp/attacker'
      }
    },
    {
      name: 'extra uploader preference',
      value: {
        schema: 'uploader-upload-1',
        documentId: 'document:owned',
        source: {
          kind: 'local-file',
          pathname: 'cat.png'
        },
        currentUploader: 'picgo'
      }
    },
    {
      name: 'unsafe binary filename',
      value: {
        schema: 'uploader-upload-1',
        documentId: 'document:owned',
        source: {
          kind: 'binary',
          name: '../cat.png',
          mediaType: 'image/png',
          bytes: new Uint8Array([1])
        }
      }
    },
    {
      name: 'unknown media type',
      value: {
        schema: 'uploader-upload-1',
        documentId: 'document:owned',
        source: {
          kind: 'binary',
          name: 'cat.html',
          mediaType: 'text/html',
          bytes: new Uint8Array([1])
        }
      }
    },
    {
      name: 'oversize binary',
      value: {
        schema: 'uploader-upload-1',
        documentId: 'document:owned',
        source: {
          kind: 'binary',
          name: 'cat.png',
          mediaType: 'image/png',
          bytes: new Uint8Array(MAX_UPLOADER_IMAGE_BYTES + 1)
        }
      }
    },
    {
      name: 'unknown source kind',
      value: {
        schema: 'uploader-upload-1',
        documentId: 'document:owned',
        source: {
          kind: 'remote-url',
          url: 'https://attacker.invalid/cat.png'
        }
      }
    }
  ])('rejects $name', ({ value }) => {
    expect(() => decodeUploaderUploadRequest(value)).toThrow()
  })

  it.each([
    [
      { schema: 'uploader-availability-1', kind: 'picgo' },
      { schema: 'uploader-availability-1', kind: 'picgo' }
    ],
    [
      {
        schema: 'uploader-availability-1',
        kind: 'custom-cli'
      },
      {
        schema: 'uploader-availability-1',
        kind: 'custom-cli'
      }
    ]
  ])('decodes one closed uploader availability intent', (input, expected) => {
    const decoded = decodeUploaderAvailabilityRequest(input)
    expect(decoded).toEqual(expected)
    expect(Object.isFrozen(decoded)).toBe(true)
  })

  it.each([
    {
      schema: 'uploader-availability-1',
      kind: 'picgo',
      executablePath: '/renderer/authority'
    },
    {
      schema: 'uploader-availability-1',
      kind: 'custom-cli',
      executablePath: '/renderer/authority'
    },
    {
      schema: 'uploader-availability-1',
      kind: 'custom-cli',
      pathname: '/renderer/authority'
    },
    {
      schema: 'uploader-availability-1',
      kind: 'shell-command',
      command: 'curl attacker'
    }
  ])('rejects an open or invalid availability intent', value => {
    expect(() => decodeUploaderAvailabilityRequest(value)).toThrow()
  })
})
