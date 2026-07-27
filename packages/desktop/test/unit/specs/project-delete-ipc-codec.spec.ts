import { describe, expect, it } from 'vitest'
import {
  decodeProjectDeleteIntent
} from 'main_renderer/ipc/projectDeleteRuntimeCodec'

describe('closed project delete IPC codec', () => {
  it('accepts only a retained-root-relative entry identity', () => {
    expect(decodeProjectDeleteIntent({
      schema: 'project-delete-intent-1',
      kind: 'file',
      entrySegments: ['guides', 'old.md']
    })).toEqual({
      schema: 'project-delete-intent-1',
      kind: 'file',
      entrySegments: ['guides', 'old.md']
    })
  })

  it('rejects paths, traversal, document claims, source, and extras', () => {
    const base = {
      schema: 'project-delete-intent-1',
      kind: 'file',
      entrySegments: ['old.md']
    }
    for (const value of [
      null,
      {},
      { ...base, pathname: '/project/old.md' },
      { ...base, source: '# forged' },
      { ...base, documentId: 'document:forged' },
      { ...base, revisionId: 'revision:forged' },
      { ...base, entrySegments: [] },
      { ...base, entrySegments: ['..', 'old.md'] },
      { ...base, entrySegments: ['/absolute'] },
      { ...base, entrySegments: ['nested/old.md'] },
      { ...base, kind: 'link' }
    ]) {
      expect(() => decodeProjectDeleteIntent(value)).toThrow()
    }
  })
})
