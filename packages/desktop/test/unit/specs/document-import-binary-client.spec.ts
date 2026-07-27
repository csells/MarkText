import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_DOCUMENT_IMPORT_BYTES
} from '@shared/types/documentImport'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  reportAsyncFailure: vi.fn()
}))

vi.mock('@marktext/document-view', () => ({
  reportAsyncFailure: mocks.reportAsyncFailure
}))

const { importDroppedFile } = await import(
  '@/services/documentImportBinary'
)

describe('binary document-import renderer client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        ipcRenderer: {
          invoke: mocks.invoke
        }
      }
    })
  })

  it('sends a defensive byte copy and no pathname', async() => {
    const arrayBuffer = new Uint8Array([0x23, 0x20, 0x58]).buffer
    mocks.invoke.mockResolvedValue({
      schema: 'document-import-binary-receipt-1',
      disposition: 'opened-markdown'
    })

    await expect(importDroppedFile({
      name: 'notes.md',
      size: 3,
      arrayBuffer: vi.fn(async() => arrayBuffer)
    })).resolves.toBe(true)

    expect(mocks.invoke).toHaveBeenCalledWith(
      'mt::document-import::binary',
      {
        schema: 'document-import-binary-request-1',
        name: 'notes.md',
        bytes: new Uint8Array([0x23, 0x20, 0x58])
      }
    )
    expect(mocks.reportAsyncFailure).not.toHaveBeenCalled()
  })

  it('rejects oversized content before reading it or invoking main', async() => {
    const arrayBuffer = vi.fn()

    await expect(importDroppedFile({
      name: 'too-large.docx',
      size: MAX_DOCUMENT_IMPORT_BYTES + 1,
      arrayBuffer
    })).resolves.toBe(false)

    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.reportAsyncFailure).toHaveBeenCalledWith(
      expect.any(RangeError),
      'Dropped document import'
    )
  })

  it('reports a malformed main receipt instead of claiming admission', async() => {
    mocks.invoke.mockResolvedValue({
      disposition: 'opened-markdown',
      pathname: '/tmp/untrusted.md'
    })

    await expect(importDroppedFile({
      name: 'notes.md',
      size: 1,
      arrayBuffer: vi.fn(async() => new Uint8Array([0x23]).buffer)
    })).resolves.toBe(false)

    expect(mocks.reportAsyncFailure).toHaveBeenCalledWith(
      expect.any(TypeError),
      'Dropped document import'
    )
  })
})
