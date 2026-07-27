import { describe, expect, it } from 'vitest'
import {
  decodeDocumentImportBinaryRequest
} from 'main_renderer/ipc/documentImportBinaryRuntimeCodec'
import {
  decodeDocumentImportBinaryReceipt,
  MAX_DOCUMENT_IMPORT_BYTES
} from '@shared/types/documentImport'

describe('closed binary document-import IPC codec', () => {
  it('copies one bounded safe-name byte payload', () => {
    const bytes = new Uint8Array([0x23, 0x20, 0x4e, 0x6f, 0x74, 0x65, 0x73])
    const request = decodeDocumentImportBinaryRequest({
      schema: 'document-import-binary-request-1',
      name: 'notes.md',
      bytes
    })

    expect(request).toEqual({
      schema: 'document-import-binary-request-1',
      name: 'notes.md',
      bytes
    })
    expect(request.bytes).not.toBe(bytes)
  })

  it('rejects a renderer pathname before it can become filesystem authority', () => {
    expect(() => decodeDocumentImportBinaryRequest({
      schema: 'document-import-binary-request-1',
      name: 'notes.md',
      bytes: new TextEncoder().encode('# Notes'),
      pathname: '/private/attacker-selected/notes.md'
    })).toThrow(/closed|field/i)
  })

  it.each([
    { name: '../secret.md', bytes: new Uint8Array() },
    { name: '/private/secret.md', bytes: new Uint8Array() },
    { name: 'C:\\private\\secret.md', bytes: new Uint8Array() },
    { name: 'bad\u0000.md', bytes: new Uint8Array() },
    { name: 'notes.md', bytes: new Uint8Array(MAX_DOCUMENT_IMPORT_BYTES + 1) },
    { name: 'notes.md', bytes: [35, 32, 88] }
  ])('rejects unsafe or unbounded content intent %#', ({ name, bytes }) => {
    expect(() => decodeDocumentImportBinaryRequest({
      schema: 'document-import-binary-request-1',
      name,
      bytes
    })).toThrow()
  })

  it.each([
    'opened-markdown',
    'converted',
    'pandoc-unavailable'
  ] as const)('accepts only the closed %s receipt', disposition => {
    expect(decodeDocumentImportBinaryReceipt({
      schema: 'document-import-binary-receipt-1',
      disposition
    })).toEqual({
      schema: 'document-import-binary-receipt-1',
      disposition
    })
  })

  it.each([
    null,
    {},
    {
      schema: 'document-import-binary-receipt-1',
      disposition: 'converted',
      pathname: '/tmp/input.docx'
    },
    {
      schema: 'document-import-binary-receipt-1',
      disposition: 'unknown'
    }
  ])('rejects malformed or path-bearing receipts %#', value => {
    expect(() => decodeDocumentImportBinaryReceipt(value)).toThrow()
  })
})
