import { describe, expect, it } from 'vitest'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'

const cases = [
  {
    kind: 'cut' as const,
    source: 'a{++a++}a\n',
    selection: { ranges: [{ anchor: 0, focus: 5 }], primary: 0 },
    markdown: undefined,
    tracked: false,
    expected: 'a\n',
    caret: 0
  },
  {
    kind: 'paste' as const,
    source: 'abc\n',
    selection: { ranges: [{ anchor: 1, focus: 2 }], primary: 0 },
    markdown: '**X**',
    tracked: false,
    expected: 'a**X**c\n',
    caret: 6
  },
  {
    kind: 'paste' as const,
    source: 'abc\n',
    selection: { ranges: [{ anchor: 1, focus: 2 }], primary: 0 },
    markdown: '{++X++}',
    tracked: false,
    expected: 'a{++X++}c\n',
    caret: 8
  },
  {
    kind: 'paste' as const,
    source: 'abc\n',
    selection: { ranges: [{ anchor: 1, focus: 2 }], primary: 0 },
    markdown: 'X',
    tracked: true,
    expected: 'a{~~b~>X~~}c\n',
    caret: 8
  }
]

describe('first-class clipboard actions through the document owner', () => {
  it.each(cases)(
    '$kind selected source with tracked=$tracked: $markdown',
    ({ source, expected, caret, ...action }) => {
      const binding = createEditorCoreBinding(createLocalCoreOwner())
      try {
        binding.open({ documentId: 'clipboard.md', source })
        const result = binding.submit({ kind: 'clipboard', action, projections: [] }).acknowledged
        expect(result).toMatchObject({
          type: 'applied',
          clipboardResult: { selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 } }
        })
        expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
        binding.submit({ kind: 'undo', projections: [] })
        expect(binding.sourceAtBarrier()).toMatchObject({ source })
        binding.submit({ kind: 'redo', projections: [] })
        expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      } finally {
        binding.dispose()
      }
    }
  )

  it('does not add history when cutting a collapsed selection', () => {
    const binding = createEditorCoreBinding(createLocalCoreOwner())
    try {
      const opened = binding.open({ documentId: 'empty-cut.md', source: 'abc\n' })
      const result = binding.submit({
        kind: 'clipboard',
        action: {
          kind: 'cut',
          selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 },
          tracked: false
        },
        projections: []
      }).acknowledged
      expect(result).toMatchObject({
        type: 'applied',
        revision: opened.revision,
        clipboardResult: { selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 } }
      })
      expect(binding.sourceAtBarrier()).toMatchObject({
        source: 'abc\n',
        recoveryHistory: { undo: [], redo: [] }
      })
    } finally {
      binding.dispose()
    }
  })

  it('replays the captured clipboard action through recovery with its history', async() => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
    })
    await manager.open({ documentId: 'clipboard-recovery.md', source: 'abc\n', lineEnding: '\n' })
    let lease = manager.lease('clipboard-recovery.md')
    try {
      const action = {
        kind: 'paste' as const,
        selection: { ranges: [{ anchor: 1, focus: 2 }], primary: 0 },
        markdown: 'X',
        tracked: false
      }
      expect(
        lease.binding.submit({ kind: 'clipboard', action, projections: [] }).acknowledged.type
      ).toBe('applied')
      action.markdown = 'later unrelated clipboard'
      lease.faultView(new Error('Disconnected clipboard view'))
      lease = await manager.recover(lease)
      expect(await manager.saveBarrier(lease.documentId)).toMatchObject({ source: 'aXc\n' })
      lease.binding.submit({ kind: 'undo', projections: [] })
      expect(await manager.saveBarrier(lease.documentId)).toMatchObject({ source: 'abc\n' })
    } finally {
      await manager.handoff(lease)
      await manager.close(lease.documentId)
    }
  })
})

describe('clipboard admission and failed presentation', () => {
  it.each(['invalid selection', 'history limit'] as const)(
    'preserves rejected clipboard intent and blocks settlement after %s',
    async(reason) => {
      const actor = createCoreActor(undefined, { maximumHistoryInsertUnits: 4 })
      const binding = createEditorCoreBinding(
        reason === 'history limit'
          ? { request: (request) => actor.handle(request), dispose: () => actor.dispose() }
          : createLocalCoreOwner()
      )
      binding.open({ documentId: 'clipboard-rejected.md', source: 'abc\n' })
      const view = binding.plainTextViewAtBarrier()
      if (view.type !== 'plain-text-view') throw new Error('Missing model view')
      const adapter = createMuyaPlainTextCoreAdapter(view.view.bindings, binding)
      const action = {
        kind: 'paste' as const,
        selection: {
          ranges: [{ anchor: 1, focus: reason === 'invalid selection' ? 99 : 2 }],
          primary: 0
        },
        markdown: 'complete clipboard draft',
        tracked: false
      }
      try {
        expect(
          adapter.clipboard(action, () => {
            throw new Error('Rejected paste must not render an accepted view')
          })
        ).toEqual({ accepted: false, changed: false })
        await expect(adapter.settled()).rejects.toThrow()
        expect(adapter.recoveryDraft()).toMatchObject({ nativeChange: action })
        expect(binding.sourceAtBarrier()).toMatchObject({
          source: 'abc\n',
          recoveryHistory: { undo: [], redo: [] }
        })
      } finally {
        adapter.dispose()
        binding.dispose()
        actor.dispose()
      }
    }
  )

  it('does not replay an accepted paste when its presentation fails', async() => {
    const binding = createEditorCoreBinding(createLocalCoreOwner())
    binding.open({ documentId: 'clipboard-render-fault.md', source: 'abc\n' })
    const view = binding.plainTextViewAtBarrier()
    if (view.type !== 'plain-text-view') throw new Error('Missing model view')
    const adapter = createMuyaPlainTextCoreAdapter(view.view.bindings, binding)
    const action = {
      kind: 'paste' as const,
      selection: { ranges: [{ anchor: 1, focus: 2 }], primary: 0 },
      markdown: 'X',
      tracked: false
    }
    try {
      expect(
        adapter.clipboard(action, () => {
          throw new Error('Paste presentation unavailable')
        })
      ).toEqual({ accepted: true, changed: true })
      await expect(adapter.settled()).rejects.toThrow('Paste presentation unavailable')
      expect(binding.sourceAtBarrier()).toMatchObject({ source: 'aXc\n' })
      expect(adapter.recoveryDraft()).toMatchObject({ nativeChange: action })
      binding.submit({ kind: 'undo', projections: [] })
      expect(binding.sourceAtBarrier()).toMatchObject({ source: 'abc\n' })
    } finally {
      adapter.dispose()
      binding.dispose()
    }
  })
})
