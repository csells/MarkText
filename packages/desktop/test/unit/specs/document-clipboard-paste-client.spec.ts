import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  RevisionId,
  SessionId
} from '@marktext/document-core'

const invoke = vi.fn()
const { pasteDocumentClipboard } = await import(
  '@/services/documentClipboardPaste'
)

describe('document clipboard paste client', () => {
  beforeEach(() => {
    invoke.mockReset()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { ipcRenderer: { invoke } }
    })
  })

  it('sends only an authenticated document target and receives a publication', async() => {
    const target = Object.freeze({
      session: 'session:owned' as SessionId,
      revision: 'revision:current' as RevisionId,
      view: 'source' as const,
      anchor: Object.freeze({ offset: 2, affinity: 'previous' as const }),
      focus: Object.freeze({ offset: 2, affinity: 'next' as const })
    })
    const publication = Object.freeze({
      documentId: 'document:owned',
      baseSnapshotId: 'snapshot:current',
      envelope: Object.freeze({}),
      execution: Object.freeze({}),
      capabilities: Object.freeze({})
    })
    invoke.mockResolvedValue(publication)

    const received = await pasteDocumentClipboard({
      schema: 'document-clipboard-paste-1',
      documentId: 'document:owned',
      baseSnapshotId: 'snapshot:current',
      target
    })
    expect(received).toEqual(publication)
    expect(received).not.toBe(publication)

    expect(invoke).toHaveBeenCalledWith(
      'mt::document::paste-clipboard',
      {
        schema: 'document-clipboard-paste-1',
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:current',
        target
      }
    )
    expect(invoke.mock.calls[0][1]).not.toHaveProperty('text')
  })

  it.each([
    {
      description: 'an unknown outer field',
      publication: {
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:current',
        envelope: {},
        execution: {},
        capabilities: {},
        rendererOverride: true
      }
    },
    {
      description: 'a missing execution report',
      publication: {
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:current',
        envelope: {},
        capabilities: {}
      }
    },
    {
      description: 'a substituted outer key with the same key count',
      publication: {
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:current',
        envelope: {},
        capabilities: {},
        report: {}
      }
    },
    {
      description: 'a mismatched document',
      publication: {
        documentId: 'document:other',
        baseSnapshotId: 'snapshot:current',
        envelope: {},
        execution: {},
        capabilities: {}
      }
    },
    {
      description: 'a mismatched base snapshot',
      publication: {
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:other',
        capabilities: {},
        envelope: {},
        execution: {}
      }
    }
  ])('rejects a paste publication with $description', async({
    publication
  }) => {
    invoke.mockResolvedValue(publication)
    const target = Object.freeze({
      session: 'session:owned' as SessionId,
      revision: 'revision:current' as RevisionId,
      view: 'source' as const,
      anchor: Object.freeze({ offset: 2, affinity: 'previous' as const }),
      focus: Object.freeze({ offset: 2, affinity: 'next' as const })
    })

    await expect(pasteDocumentClipboard({
      schema: 'document-clipboard-paste-1',
      documentId: 'document:owned',
      baseSnapshotId: 'snapshot:current',
      target
    })).rejects.toThrow(/invalid document clipboard paste publication/i)
  })
})
