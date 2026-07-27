import { describe, expect, it } from 'vitest'
import {
  decodeProjectCopyIntent
} from 'main_renderer/ipc/projectCopyRuntimeCodec'

describe('closed project copy IPC codec', () => {
  it('accepts only relative source and target-parent identities', () => {
    expect(decodeProjectCopyIntent({
      schema: 'project-copy-intent-1',
      kind: 'file',
      entrySegments: ['guides', 'note.md'],
      targetParentSegments: ['archive']
    })).toEqual({
      schema: 'project-copy-intent-1',
      kind: 'file',
      entrySegments: ['guides', 'note.md'],
      targetParentSegments: ['archive']
    })
  })

  it('rejects absolute paths, traversal, source/revision claims, and extras', () => {
    const base = {
      schema: 'project-copy-intent-1',
      kind: 'file',
      entrySegments: ['note.md'],
      targetParentSegments: ['archive']
    }
    for (const value of [
      null,
      {},
      { ...base, sourcePathname: '/project/note.md' },
      { ...base, targetPathname: '/project/archive/note.md' },
      { ...base, source: '# forged' },
      { ...base, revisionId: 'revision:forged' },
      { ...base, entrySegments: [] },
      { ...base, entrySegments: ['..', 'note.md'] },
      { ...base, targetParentSegments: ['..'] },
      { ...base, targetParentSegments: ['/absolute'] },
      { ...base, kind: 'link' }
    ]) {
      expect(() => decodeProjectCopyIntent(value)).toThrow()
    }
  })
})
