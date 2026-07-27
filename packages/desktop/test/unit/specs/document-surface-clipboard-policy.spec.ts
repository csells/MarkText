import { describe, expect, it } from 'vitest'
import {
  decodeDocumentClipboardMenuState,
  decodeDocumentSurfaceContextRequest,
  decodeDocumentSurfaceContextResponse,
  documentClipboardConsumerPolicy
} from '@shared/types/documentSurface'

describe('authenticated document-surface clipboard policy', () => {
  it.each([
    ['markup', true, true, true],
    ['markup', false, false, true],
    ['source', true, false, false],
    ['source', false, false, false],
    ['original', true, true, false],
    ['original', false, false, false],
    ['revised', true, true, false],
    ['revised', false, false, false]
  ] as const)(
    '%s with selection=%s enables semanticCopy=%s and paste=%s',
    (surface, hasSelection, semanticCopy, pasteAsPlainText) => {
      expect(documentClipboardConsumerPolicy({
        surface,
        hasSelection
      })).toEqual({
        copyAsRich: semanticCopy,
        copyAsHtml: semanticCopy,
        pasteAsPlainText
      })
    }
  )

  it('decodes one exact correlated surface response', () => {
    expect(decodeDocumentSurfaceContextRequest({
      requestId: 'surface:1',
      x: 17,
      y: 29
    })).toEqual({
      requestId: 'surface:1',
      x: 17,
      y: 29
    })
    expect(decodeDocumentSurfaceContextResponse({
      requestId: 'surface:1',
      documentId: 'document:1',
      revisionId: 'revision:1',
      surface: 'original'
    })).toEqual({
      requestId: 'surface:1',
      documentId: 'document:1',
      revisionId: 'revision:1',
      surface: 'original'
    })
    expect(decodeDocumentSurfaceContextResponse({
      requestId: 'surface:2',
      documentId: null,
      revisionId: null,
      surface: null
    })).toEqual({
      requestId: 'surface:2',
      documentId: null,
      revisionId: null,
      surface: null
    })
  })

  it.each([
    {
      requestId: 'surface:1',
      documentId: 'document:1',
      revisionId: 'revision:1',
      surface: 'preview'
    },
    {
      requestId: 'surface:1',
      documentId: null,
      revisionId: 'revision:1',
      surface: null
    },
    {
      requestId: 'surface:1',
      documentId: 'document:1',
      revisionId: null,
      surface: 'markup'
    },
    {
      requestId: 'surface:1',
      documentId: 'document:1',
      revisionId: 'revision:1',
      surface: 'markup',
      executablePath: '/tmp/attacker'
    },
    Object.assign(Object.create(null), {
      requestId: 'surface:1',
      documentId: 'document:1',
      revisionId: 'revision:1',
      surface: 'markup'
    })
  ])('rejects forged or incoherent surface response %#', value => {
    expect(() => decodeDocumentSurfaceContextResponse(value)).toThrow()
  })

  it.each([
    { surface: 'markup', hasSelection: true, windowId: 7 },
    { surface: 'preview', hasSelection: true },
    { surface: 'original', hasSelection: 1 },
    Object.assign(Object.create(null), {
      surface: 'revised',
      hasSelection: true
    })
  ])('rejects forged clipboard menu state %#', value => {
    expect(() => decodeDocumentClipboardMenuState(value)).toThrow()
  })
})
