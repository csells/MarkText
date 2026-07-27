import { describe, expect, it } from 'vitest'
import {
  decodeProjectDocumentOpenRequest
} from 'main_renderer/ipc/projectDocumentOpenRuntimeCodec'
import {
  decodeProjectDocumentOpenReceipt
} from '@shared/types/projectDocumentOpen'

describe('closed project-document open IPC codec', () => {
  it('admits only one bounded renderer-selected candidate path', () => {
    expect(decodeProjectDocumentOpenRequest({
      schema: 'project-document-open-request-1',
      candidatePath: '/project/notes.md'
    })).toEqual({
      schema: 'project-document-open-request-1',
      candidatePath: '/project/notes.md'
    })
  })

  it.each([
    null,
    {},
    {
      schema: 'project-document-open-request-1',
      candidatePath: '/project/notes.md',
      windowId: 7
    },
    {
      schema: 'project-document-open-request-1',
      candidatePath: '/project/notes.md',
      root: '/project'
    },
    {
      schema: 'project-document-open-request-1',
      candidatePath: '/project/notes.md',
      options: {}
    },
    {
      schema: 'project-document-open-request-1',
      candidatePath: ''
    },
    {
      schema: 'project-document-open-request-1',
      candidatePath: 'x'.repeat(32_769)
    },
    {
      schema: 'project-document-open-request-1',
      candidatePath: '/project/bad\u0000.md'
    }
  ])('rejects open, authority-bearing, or unbounded input %#', value => {
    expect(() => decodeProjectDocumentOpenRequest(value)).toThrow()
  })
})

describe('closed project-document open receipt codec', () => {
  it.each([
    ['admitted', '/project/notes.md'],
    ['selected-existing', '/external/already-open.md']
  ] as const)('admits a bounded %s receipt', (disposition, pathname) => {
    expect(decodeProjectDocumentOpenReceipt({
      schema: 'project-document-open-receipt-1',
      disposition,
      pathname
    })).toEqual({
      schema: 'project-document-open-receipt-1',
      disposition,
      pathname
    })
  })

  it.each([
    null,
    {},
    {
      schema: 'project-document-open-receipt-1',
      disposition: 'admitted',
      pathname: '/project/notes.md',
      options: {}
    },
    {
      schema: 'project-document-open-receipt-1',
      disposition: 'forged',
      pathname: '/project/notes.md'
    },
    {
      schema: 'project-document-open-receipt-1',
      disposition: 'admitted',
      pathname: ''
    }
  ])('rejects malformed main receipts %#', value => {
    expect(() => decodeProjectDocumentOpenReceipt(value)).toThrow()
  })
})
