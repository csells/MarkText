import { describe, expect, it } from 'vitest'
import {
  decodeDocumentCoreStaticSinkReceipt
} from '@/components/editorWithTabs/documentCoreStaticSinkClientCodec'

const sourceHash = 'a'.repeat(64)

describe('renderer static-sink receipt codec', () => {
  it('accepts and freezes each closed main-owned terminal receipt', () => {
    for (const receipt of [
      {
        schema: 'document-core-static-sink-receipt-1',
        kind: 'written',
        consumer: 'pdf',
        view: 'revised',
        revisionId: 'revision:1',
        sourceHash,
        targetPath: '/tmp/review.pdf',
        bytes: 401
      },
      {
        schema: 'document-core-static-sink-receipt-1',
        kind: 'proof-written',
        consumer: 'print',
        view: 'markup',
        revisionId: 'revision:1',
        sourceHash,
        targetPath: '/tmp/print-proof.pdf',
        bytes: 902
      },
      {
        schema: 'document-core-static-sink-receipt-1',
        kind: 'submitted',
        consumer: 'print',
        view: 'original',
        revisionId: 'revision:1',
        sourceHash
      },
      {
        schema: 'document-core-static-sink-receipt-1',
        kind: 'unavailable',
        consumer: 'styled-html',
        view: 'markup',
        reason: 'source-only-revision',
        revisionId: 'revision:1'
      },
      {
        schema: 'document-core-static-sink-receipt-1',
        kind: 'cancelled',
        consumer: 'pdf',
        view: 'markup',
        revisionId: 'revision:1'
      }
    ] as const) {
      const decoded = decodeDocumentCoreStaticSinkReceipt(receipt)
      expect(decoded).toEqual(receipt)
      expect(Object.isFrozen(decoded)).toBe(true)
    }
  })

  it('rejects forged bytes, paths, identities, and discriminator pairings', () => {
    const written = {
      schema: 'document-core-static-sink-receipt-1',
      kind: 'written',
      consumer: 'styled-html',
      view: 'markup',
      revisionId: 'revision:1',
      sourceHash,
      targetPath: '/tmp/review.html',
      bytes: 401
    } as const

    for (const receipt of [
      { ...written, html: '<script>forged()</script>' },
      { ...written, targetPath: '' },
      { ...written, revisionId: '' },
      { ...written, sourceHash: 'forged' },
      { ...written, bytes: -1 },
      { ...written, consumer: 'print' },
      { ...written, kind: 'proof-written', consumer: 'pdf' },
      {
        schema: 'document-core-static-sink-receipt-1',
        kind: 'submitted',
        consumer: 'pdf',
        view: 'markup',
        revisionId: 'revision:1',
        sourceHash
      },
      {
        schema: 'document-core-static-sink-receipt-1',
        kind: 'cancelled',
        consumer: 'print',
        view: 'markup',
        revisionId: 'revision:1'
      }
    ]) {
      expect(() => decodeDocumentCoreStaticSinkReceipt(receipt)).toThrow(
        /static|receipt|closed|invalid/i
      )
    }
  })
})
