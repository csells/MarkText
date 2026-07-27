import { describe, expect, it } from 'vitest'
import { decodeProjectSearchRequest } from 'main_renderer/ipc/projectSearchRuntimeCodec'

describe('closed project-search IPC codec', () => {
  it('admits a bounded search intent without any filesystem location or process identity', () => {
    expect(decodeProjectSearchRequest({
      schema: 'project-search-request-1',
      mode: 'text',
      pattern: 'needle',
      options: {
        isRegexp: false,
        isCaseSensitive: true,
        isWholeWord: false,
        leadingContextLineCount: 1,
        trailingContextLineCount: 2,
        inclusions: ['*.md']
      }
    })).toEqual({
      schema: 'project-search-request-1',
      mode: 'text',
      pattern: 'needle',
      options: {
        isRegexp: false,
        isCaseSensitive: true,
        isWholeWord: false,
        leadingContextLineCount: 1,
        trailingContextLineCount: 2,
        inclusions: ['*.md']
      }
    })
  })

  it.each([
    null,
    {},
    {
      schema: 'project-search-request-1',
      mode: 'text',
      pattern: 'needle',
      options: {},
      directories: ['/tmp']
    },
    {
      schema: 'project-search-request-1',
      mode: 'text',
      pattern: 'needle',
      options: {},
      root: '/tmp'
    },
    {
      schema: 'project-search-request-1',
      mode: 'text',
      pattern: 'needle',
      options: {},
      searchId: 'renderer-owned'
    },
    {
      schema: 'project-search-request-1',
      mode: 'text',
      pattern: 'needle',
      options: { followSymlinks: true }
    },
    {
      schema: 'project-search-request-1',
      mode: 'text',
      pattern: 'needle',
      options: { exclusions: ['renderer-owned'] }
    },
    {
      schema: 'project-search-request-1',
      mode: 'text',
      pattern: 'needle',
      options: { maxFileSize: '10G' }
    },
    {
      schema: 'project-search-request-1',
      mode: 'unknown',
      pattern: 'needle',
      options: {}
    },
    {
      schema: 'project-search-request-1',
      mode: 'text',
      pattern: 'x'.repeat(4097),
      options: {}
    },
    {
      schema: 'project-search-request-1',
      mode: 'text',
      pattern: 'needle',
      options: { inclusions: ['safe', 'bad\u0000glob'] }
    }
  ])('rejects open, authority-bearing, or unbounded input %#', (value) => {
    expect(() => decodeProjectSearchRequest(value)).toThrow()
  })
})
