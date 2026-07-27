import { describe, expect, it, vi } from 'vitest'
import {
  coordinateDocumentPathRelocation
} from 'main_renderer/documentCore/documentPathCoordinator'

const receipt = Object.freeze({
  schema: 'document-core-path-receipt-1' as const,
  documentId: 'document:1',
  previousPathname: '/tmp/note.md',
  pathname: '/tmp/renamed.md',
  filename: 'renamed.md'
})

describe('main document path coordinator', () => {
  it('retargets window and watcher state only from the committed host receipt', async() => {
    const relocate = vi.fn(async() => receipt)
    const retarget = vi.fn()

    await expect(coordinateDocumentPathRelocation({
      ownerId: 'renderer:1',
      documentId: 'document:1',
      targetPathname: '/tmp/renderer-cannot-publish-this.md',
      relocate,
      retarget
    })).resolves.toBe(receipt)

    expect(retarget).toHaveBeenCalledOnce()
    expect(retarget).toHaveBeenCalledWith(receipt)
  })

  it('does not mutate window, watcher, or renderer state when the host transaction fails', async() => {
    const relocate = vi.fn(async() => {
      throw new Error('collision')
    })
    const retarget = vi.fn()

    await expect(coordinateDocumentPathRelocation({
      ownerId: 'renderer:1',
      documentId: 'document:1',
      targetPathname: '/tmp/taken.md',
      relocate,
      retarget
    })).rejects.toThrow('collision')
    expect(retarget).not.toHaveBeenCalled()
  })
})
