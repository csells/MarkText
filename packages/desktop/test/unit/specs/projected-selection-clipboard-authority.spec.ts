import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it, vi } from 'vitest'

import { createCoreActor } from '@/documentAuthority/coreActor'
import {
  createMuyaPlainTextCoreAdapter,
  type MuyaPlainTextAuthorSelection
} from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { createMuyaPlainTextView } from '@/documentAuthority/muyaPlainTextView'
import type { EditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
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

  it('prepares one contextual Revised rich payload across bound blocks in either direction', async() => {
    const source =
      'alpha # copied\n\n{--gone--}{++new++}\n\nbeta\n'
    const core = createDocumentCore()
    const view = createMuyaPlainTextView(core.project(core.open(source), 'revised'))
    const adapter = createMuyaPlainTextCoreAdapter(
      view.bindings,
      {} as Pick<EditorCoreBinding, 'submit'>
    )
    const actor = createCoreActor()
    const session = 51
    let sequence = 1
    actor.handle({ type: 'open', session, sequence, source })
    const authority = createProjectedSelectionClipboardAuthority({
      settle: () => adapter.settled(),
      selectionSourceRange: selection => adapter.selectionSourceRange(selection),
      selectionProjectionAtBarrier: async(range) => {
        sequence += 1
        const reply = actor.handle({
          type: 'selection-projection-at-barrier',
          session,
          sequence,
          baseRevision: 1,
          range
        })
        if (reply.type !== 'selection-projection') {
          throw new Error('Core selection projection was rejected')
        }
        return reply.projection
      }
    })
    const forward: MuyaPlainTextAuthorSelection = Object.freeze({
      anchor: Object.freeze({ path: Object.freeze([0, 'text']), offset: 6 }),
      focus: Object.freeze({ path: Object.freeze([2, 'text']), offset: 2 })
    })
    const reverse: MuyaPlainTextAuthorSelection = Object.freeze({
      anchor: forward.focus,
      focus: forward.anchor
    })
    const expected = {
      text: '# copied\n\nnew\n\nbe',
      html: '<p># copied</p>\n<p>new</p>\n<p>be</p>\n'
    }

    await expect(authority.prepare(forward, 'rich')).resolves.toEqual(expected)
    await expect(authority.prepare(reverse, 'rich')).resolves.toEqual(expected)

    adapter.dispose()
    actor.dispose()
  })
})
