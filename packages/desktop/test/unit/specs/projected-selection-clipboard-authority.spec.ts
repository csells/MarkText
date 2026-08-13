import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it, vi } from 'vitest'

import { createProjectedSelectionClipboardAuthority } from '@/documentConsumers/projectedSelectionClipboardAuthority'

const selection = Object.freeze({
  anchor: Object.freeze({ path: Object.freeze([0, 'text']), offset: 1 }),
  focus: Object.freeze({ path: Object.freeze([0, 'text']), offset: 5 })
})

const projectionOf = (source: string) => {
  const core = createDocumentCore()
  return core.project(core.open(source), 'revised')
}

describe('projected selection clipboard authority', () => {
  it('prepares one Core selection projection without a document fallback', async() => {
    const settle = vi.fn(async() => {})
    const selectionSourceRange = vi.fn(() => ({ start: 8, end: 20 }))
    const selectionProjectionAtBarrier = vi.fn(async() => projectionOf('**new**'))
    const authority = createProjectedSelectionClipboardAuthority({
      settle,
      selectionSourceRange,
      selectionProjectionAtBarrier
    })

    await expect(authority.prepare(selection, 'rich')).resolves.toEqual({
      text: '**new**',
      html: '<p><strong>new</strong></p>\n'
    })
    expect(settle).toHaveBeenCalledOnce()
    expect(selectionSourceRange).toHaveBeenCalledWith(selection)
    expect(selectionProjectionAtBarrier).toHaveBeenCalledWith({ start: 8, end: 20 })
    expect(authority.payload()).toEqual({
      text: '**new**',
      html: '<p><strong>new</strong></p>\n'
    })
  })

  it('fails closed for an unproven selection and invalidates an in-flight result', async() => {
    let resolveProjection: ((projection: ReturnType<typeof projectionOf>) => void) | undefined
    const pending = new Promise<ReturnType<typeof projectionOf>>(resolve => {
      resolveProjection = resolve
    })
    const selectionSourceRange = vi.fn()
      .mockReturnValueOnce({ start: 0, end: 4 })
      .mockReturnValueOnce(undefined)
    const authority = createProjectedSelectionClipboardAuthority({
      settle: async() => {},
      selectionSourceRange,
      selectionProjectionAtBarrier: () => pending
    })

    const first = authority.prepare(selection, 'rich')
    await Promise.resolve()
    await expect(authority.prepare(selection, 'rich')).resolves.toBeUndefined()
    resolveProjection?.(projectionOf('late'))
    await expect(first).resolves.toBeUndefined()
    expect(authority.payload()).toBeUndefined()
  })
})
