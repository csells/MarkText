import { describe, expect, it } from 'vitest'
import { decodeProjectCreateIntent } from 'main_renderer/ipc/projectCreateRuntimeCodec'

describe('closed project-create IPC codec', () => {
  it('admits only a file or directory intent made of relative path segments', () => {
    expect(decodeProjectCreateIntent({
      schema: 'project-create-intent-1',
      kind: 'file',
      parentSegments: ['guides', 'drafts'],
      name: 'intro'
    })).toEqual({
      schema: 'project-create-intent-1',
      kind: 'file',
      parentSegments: ['guides', 'drafts'],
      name: 'intro'
    })

    expect(decodeProjectCreateIntent({
      schema: 'project-create-intent-1',
      kind: 'directory',
      parentSegments: [],
      name: 'notes'
    }).kind).toBe('directory')
  })

  it.each([
    null,
    {},
    {
      schema: 'project-create-intent-1',
      kind: 'file',
      parentSegments: [],
      name: 'notes',
      pathname: '/project/notes.md'
    },
    {
      schema: 'project-create-intent-1',
      kind: 'file',
      parentSegments: [],
      name: 'notes',
      source: ''
    },
    {
      schema: 'project-create-intent-1',
      kind: 'file',
      parentSegments: [],
      name: 'notes',
      documentId: 'renderer-invented'
    },
    {
      schema: 'project-create-intent-1',
      kind: 'other',
      parentSegments: [],
      name: 'notes'
    },
    {
      schema: 'project-create-intent-1',
      kind: 'file',
      parentSegments: 'guides',
      name: 'notes'
    }
  ])('rejects open, malformed, or authority-bearing input %#', (value) => {
    expect(() => decodeProjectCreateIntent(value)).toThrow()
  })
})
