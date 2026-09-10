import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it, vi } from 'vitest'

import { createCoreActor } from '@/documentAuthority/coreActor'
import {
  createMuyaPlainTextCoreAdapter,
  type MuyaPlainTextAuthorSelection
} from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { createMuyaPlainTextView } from '@/documentAuthority/muyaPlainTextView'
import { createProjectedSelectionClipboardAuthority } from '@/documentConsumers/projectedSelectionClipboardAuthority'

const projectionOf = (source: string) => {
  const core = createDocumentCore()
  return core.project(core.open(source), 'revised')
}

describe('projected selection clipboard authority', () => {
  it('prepares one Core selection projection without a document fallback', async() => {
    const settle = vi.fn(async() => {})
    const currentSelection = vi.fn(() => ({ range: { start: 8, end: 20 }, revision: 1 }))
    const selectionProjectionAtBarrier = vi.fn(async() => projectionOf('**new**'))
    const authority = createProjectedSelectionClipboardAuthority({
      settle,
      currentSelection,
      selectionProjectionAtBarrier
    })

    await expect(authority.prepare('rich')).resolves.toEqual({
      text: '**new**',
      html: '<p><strong>new</strong></p>\n'
    })
    expect(settle).toHaveBeenCalledOnce()
    expect(currentSelection).toHaveBeenCalled()
    expect(selectionProjectionAtBarrier).toHaveBeenCalledWith({ start: 8, end: 20 })
    expect(authority.payload()).toEqual({
      text: '**new**',
      html: '<p><strong>new</strong></p>\n'
    })
  })

  it('fails closed for an unproven selection and invalidates an in-flight result', async() => {
    let resolveProjection: ((projection: ReturnType<typeof projectionOf>) => void) | undefined
    const pending = new Promise<ReturnType<typeof projectionOf>>((resolve) => {
      resolveProjection = resolve
    })
    let current: { range: { start: number; end: number }; revision: number } | undefined = {
      range: { start: 0, end: 4 },
      revision: 1
    }
    const authority = createProjectedSelectionClipboardAuthority({
      settle: async() => {},
      currentSelection: () => current,
      selectionProjectionAtBarrier: () => pending
    })

    const first = authority.prepare('rich')
    await Promise.resolve()
    current = undefined
    await expect(authority.prepare('rich')).resolves.toBeUndefined()
    resolveProjection?.(projectionOf('late'))
    await expect(first).resolves.toBeUndefined()
    expect(authority.payload()).toBeUndefined()
  })

  it('prepares one contextual Revised rich payload across bound blocks in either direction', async() => {
    const source = 'alpha # copied\n\n{--gone--}{++new++}\n\nbeta\n'
    const core = createDocumentCore()
    const view = createMuyaPlainTextView(core.project(core.open(source), 'revised'))
    const adapter = createMuyaPlainTextCoreAdapter(view.bindings, {
      submit: () => {
        throw new Error('Unexpected submission')
      },
      retainSelection: () => {
        throw new Error('Unexpected resource preparation')
      },
      retainedSelectionAtBarrier: () => {
        throw new Error('Unexpected resource preparation')
      },
      releaseSelection: () => {
        throw new Error('Unexpected resource preparation')
      }
    })
    const actor = createCoreActor()
    const session = 51
    let sequence = 1
    actor.handle({ type: 'open', session, sequence, source })
    let live: MuyaPlainTextAuthorSelection
    const authority = createProjectedSelectionClipboardAuthority({
      settle: () => adapter.settled(),
      currentSelection: () => {
        const range = adapter.selectionSourceRange(live)
        return range === undefined ? undefined : { range, revision: 1 }
      },
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

    live = forward
    await expect(authority.prepare('rich')).resolves.toEqual(expected)
    live = reverse
    await expect(authority.prepare('rich')).resolves.toEqual(expected)

    adapter.dispose()
    actor.dispose()
  })
})

it('invalidates a prepared table clipboard when another rectangle is selected at the same revision', async() => {
  let range = {
    kind: 'table' as const,
    table: { start: 0, end: 25 },
    anchor: { row: 0, column: 0 },
    focus: { row: 1, column: 0 }
  }
  const authority = createProjectedSelectionClipboardAuthority({
    settle: async() => {},
    currentSelection: () => ({ range, revision: 1 }),
    selectionProjectionAtBarrier: async() => projectionOf('| a |\n| --- |\n| b |\n')
  })
  expect(await authority.prepare('rich')).toBeDefined()
  range = {
    kind: 'table',
    table: { start: 0, end: 25 },
    anchor: { row: 0, column: 1 },
    focus: { row: 1, column: 1 }
  }
  expect(authority.payload()).toBeUndefined()
})

it('does not reuse a clipboard projection after in-place table selection mutation during preparation', async() => {
  const range = {
    kind: 'table' as const,
    table: { start: 0, end: 25 },
    anchor: { row: 0, column: 0 },
    focus: { row: 0, column: 0 }
  }
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const project = vi.fn(async() => projectionOf('a'))
  const authority = createProjectedSelectionClipboardAuthority({
    settle: () => pending,
    currentSelection: () => ({ range, revision: 1 }),
    selectionProjectionAtBarrier: project
  })
  const prepared = authority.prepare('rich')
  range.anchor.column = 1
  range.focus.column = 1
  release?.()
  expect(await prepared).toBeUndefined()
  expect(project).not.toHaveBeenCalled()
  expect(authority.payload()).toBeUndefined()
})

it('retains cloned semantic text addresses and invalidates a changed displayed offset', async() => {
  let range = {
    kind: 'model-text' as const,
    anchor: { text: { start: 6, end: 7 }, offset: 1 },
    focus: { text: { start: 6, end: 7 }, offset: 2 }
  }
  const project = vi.fn(async() => projectionOf(' '))
  const authority = createProjectedSelectionClipboardAuthority({
    settle: async() => {},
    currentSelection: () => ({ range: structuredClone(range), revision: 1 }),
    selectionProjectionAtBarrier: project
  })
  expect(await authority.prepare('markdown')).toEqual({ text: ' ', html: '' })
  expect(project).toHaveBeenCalledWith(range)
  expect(authority.payload()).toEqual({ text: ' ', html: '' })
  range = { ...range, anchor: { ...range.anchor, offset: 0 } }
  expect(authority.payload()).toBeUndefined()
})

it('does not reuse a semantic text projection after in-place mutation during preparation', async() => {
  const range = {
    kind: 'model-text' as const,
    anchor: { text: { start: 6, end: 7 }, offset: 1 },
    focus: { text: { start: 6, end: 7 }, offset: 2 }
  }
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const project = vi.fn(async() => projectionOf(' '))
  const authority = createProjectedSelectionClipboardAuthority({
    settle: () => pending,
    currentSelection: () => ({ range, revision: 1 }),
    selectionProjectionAtBarrier: project
  })
  const prepared = authority.prepare('markdown')
  range.anchor.offset = 0
  release?.()
  expect(await prepared).toBeUndefined()
  expect(project).not.toHaveBeenCalled()
  expect(authority.payload()).toBeUndefined()
})
