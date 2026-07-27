import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@marktext/document-view', () => ({
  reportAsyncFailure: vi.fn()
}))

const { copyAdmittedDocumentPath } = await import(
  '@/services/documentPathClipboard'
)

describe('admitted document-path clipboard client', () => {
  beforeEach(() => {
    invoke.mockReset()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { ipcRenderer: { invoke } }
    })
  })

  it('names only an opaque document and accepts a closed main receipt', async() => {
    invoke.mockResolvedValue({
      schema: 'document-path-clipboard-receipt-1',
      kind: 'written'
    })

    await expect(copyAdmittedDocumentPath('document:owned'))
      .resolves.toBe(true)
    expect(invoke).toHaveBeenCalledWith('mt::document::copy-path', {
      schema: 'document-path-clipboard-1',
      documentId: 'document:owned'
    })
  })
})
