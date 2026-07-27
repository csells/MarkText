import { describe, expect, it } from 'vitest'
import {
  decodeProjectRelocateIntent
} from 'main_renderer/ipc/projectRelocationRuntimeCodec'

describe('closed project relocation IPC codec', () => {
  it('accepts only a relative entry identity and semantic replacement name', () => {
    expect(decodeProjectRelocateIntent({
      schema: 'project-relocate-intent-1',
      kind: 'file',
      entrySegments: ['guides', 'old.md'],
      targetParentSegments: ['archive'],
      newName: 'new.md'
    })).toEqual({
      schema: 'project-relocate-intent-1',
      kind: 'file',
      entrySegments: ['guides', 'old.md'],
      targetParentSegments: ['archive'],
      newName: 'new.md'
    })
  })

  it('rejects absolute/traversing segments, paths, source, revisions, and extras', () => {
    const base = {
      schema: 'project-relocate-intent-1',
      kind: 'file',
      entrySegments: ['old.md'],
      targetParentSegments: [],
      newName: 'new.md'
    }
    for (const value of [
      null,
      {},
      { ...base, pathname: '/project/old.md' },
      { ...base, sourcePathname: '/project/old.md' },
      { ...base, targetPathname: '/project/new.md' },
      { ...base, source: '# forged' },
      { ...base, revisionId: 'revision:forged' },
      { ...base, currentFile: {} },
      { ...base, entrySegments: [] },
      { ...base, entrySegments: ['..', 'old.md'] },
      { ...base, entrySegments: ['/absolute', 'old.md'] },
      { ...base, entrySegments: ['nested/old.md'] },
      { ...base, targetParentSegments: ['..'] },
      { ...base, targetParentSegments: ['/absolute'] },
      { ...base, targetParentSegments: ['nested/archive'] },
      { ...base, newName: '../escape.md' },
      { ...base, newName: 'nested/new.md' },
      { ...base, kind: 'link' },
      { ...base, schema: 'project-relocate-intent-2' }
    ]) {
      expect(() => decodeProjectRelocateIntent(value)).toThrow()
    }
  })
})
