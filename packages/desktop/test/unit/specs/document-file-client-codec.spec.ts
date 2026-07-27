import { describe, expect, it } from 'vitest'
import {
  decodeDocumentCoreExternalChangeResult,
  decodeDocumentCorePathReceipt,
  decodeDocumentCoreSavedReceipt,
  decodeDocumentCoreTabDescriptor
} from '@/components/editorWithTabs/documentFileClientCodec'

const historyState = Object.freeze({
  canUndo: true,
  canRedo: false,
  dirty: false,
  headIdentity: 'semantic-sha256:head',
  savedIdentity: 'semantic-sha256:head'
})

describe('renderer document-file receipt codec', () => {
  it('accepts only main-created opaque tab metadata', () => {
    expect(decodeDocumentCoreTabDescriptor({
      schema: 'document-core-tab-1',
      documentId: 'document:1',
      filename: 'note.md',
      pathname: '/tmp/note.md',
      selected: true
    })).toEqual({
      schema: 'document-core-tab-1',
      documentId: 'document:1',
      filename: 'note.md',
      pathname: '/tmp/note.md',
      selected: true
    })

    for (const forbidden of [
      { source: '# forged' },
      { markdown: '# forged' },
      { durabilityKey: 'forged' },
      { parseConfiguration: {} },
      { options: {} }
    ]) {
      expect(() => decodeDocumentCoreTabDescriptor({
        schema: 'document-core-tab-1',
        documentId: 'document:1',
        filename: 'note.md',
        pathname: '/tmp/note.md',
        selected: true,
        ...forbidden
      })).toThrow(/closed|fields/i)
    }
  })

  it('accepts only one written main save receipt with frozen history', () => {
    expect(decodeDocumentCoreSavedReceipt({
      schema: 'document-core-save-receipt-1',
      kind: 'written',
      documentId: 'document:1',
      pathname: '/tmp/note.md',
      revisionId: 'revision:1',
      historyState
    })).toEqual({
      schema: 'document-core-save-receipt-1',
      kind: 'written',
      documentId: 'document:1',
      pathname: '/tmp/note.md',
      revisionId: 'revision:1',
      historyState
    })

    for (const request of [
      null,
      {},
      {
        schema: 'document-core-save-receipt-1',
        kind: 'written',
        documentId: 'document:1',
        pathname: '/tmp/note.md',
        revisionId: 'revision:1',
        historyState,
        markdown: '# forged'
      },
      {
        schema: 'document-core-save-receipt-1',
        kind: 'cancelled',
        documentId: 'document:1'
      }
    ]) {
      expect(() => decodeDocumentCoreSavedReceipt(request)).toThrow()
    }
  })

  it('accepts only closed main-owned external-change results', () => {
    expect(decodeDocumentCoreExternalChangeResult({
      schema: 'document-core-file-reload-1',
      kind: 'reloaded',
      documentId: 'document:1',
      revisionId: 'revision:2',
      historyState
    })).toMatchObject({
      kind: 'reloaded',
      documentId: 'document:1',
      historyState: { dirty: false }
    })
    expect(decodeDocumentCoreExternalChangeResult({
      schema: 'document-core-file-reload-1',
      kind: 'removed',
      documentId: 'document:1'
    })).toEqual({
      schema: 'document-core-file-reload-1',
      kind: 'removed',
      documentId: 'document:1'
    })
    expect(() => decodeDocumentCoreExternalChangeResult({
      schema: 'document-core-file-reload-1',
      kind: 'reloaded',
      documentId: 'document:1',
      revisionId: 'revision:2',
      historyState,
      source: 'forged'
    })).toThrow(/closed/)
  })

  it('accepts only a closed ID-keyed path receipt', () => {
    const receipt = {
      schema: 'document-core-path-receipt-1',
      documentId: 'document:1',
      previousPathname: '/tmp/note.md',
      pathname: '/tmp/renamed.md',
      filename: 'renamed.md'
    }
    expect(decodeDocumentCorePathReceipt(receipt)).toEqual(receipt)

    for (const forbidden of [
      { source: '# forged' },
      { revisionId: 'revision:forged' },
      { encoding: 'utf-8' },
      { currentFile: {} }
    ]) {
      expect(() => decodeDocumentCorePathReceipt({
        ...receipt,
        ...forbidden
      })).toThrow(/closed/i)
    }
  })
})
