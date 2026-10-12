import { describe, expect, it } from 'vitest'
import { createLocalCoreOwner } from '../../../src/renderer/src/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '../../../src/renderer/src/documentAuthority/editorCoreBinding'

// Undo of a review command returns to the selection it ran with, as upstream
// undo and Google Docs do; no review item is selected unless that selection
// is inside one. Redo places the caret as the command did.

const source = 'A {++new++} B {--old--} C {~~left~>right~~}\n'
const selectionSet = (anchor: number, focus = anchor) => ({ ranges: [{ anchor, focus }], primary: 0 })

const boot = () => {
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId: 'review-history-selection.md', source })
  return binding
}

describe('review command history selection', () => {
  it.each(['accept', 'reject'] as const)('restores the selection before %s all on undo', (decision) => {
    const binding = boot()
    try {
      expect(binding.submit({ kind: 'resolve-all', decision, selection: selectionSet(0), projections: [] }).acknowledged)
        .toMatchObject({ type: 'applied' })
      const undone = binding.submit({ kind: 'undo', projections: [] }).acknowledged
      expect(undone).toMatchObject({ type: 'applied', historyResult: { selection: selectionSet(0) } })
      const redone = binding.submit({ kind: 'redo', projections: [] }).acknowledged
      expect(redone).toMatchObject({ type: 'applied' })
      expect(redone).not.toHaveProperty('historyResult')
    } finally {
      binding.dispose()
    }
  })

  it('restores a selected range in its own direction after a single resolution', () => {
    const binding = boot()
    try {
      expect(binding.submit({
        kind: 'resolve',
        authoredRevision: 1,
        annotation: { kind: 'deletion', range: { start: 14, end: 23 } },
        decision: 'accept',
        selection: selectionSet(26, 24),
        projections: []
      }).acknowledged).toMatchObject({ type: 'applied' })
      expect(binding.submit({ kind: 'undo', projections: [] }).acknowledged)
        .toMatchObject({ type: 'applied', historyResult: { selection: selectionSet(26, 24) } })
    } finally {
      binding.dispose()
    }
  })

  it('restores the selection before a Comment edit on undo', () => {
    const binding = createEditorCoreBinding(createLocalCoreOwner())
    binding.open({ documentId: 'comment-history-selection.md', source: 'Text {>>note<<} after.\n' })
    try {
      expect(binding.submit({
        kind: 'edit-comment',
        authoredRevision: 1,
        annotation: { kind: 'comment', range: { start: 5, end: 15 } },
        text: 'edited note',
        selection: selectionSet(2),
        projections: []
      }).acknowledged).toMatchObject({ type: 'applied' })
      expect(binding.submit({ kind: 'undo', projections: [] }).acknowledged)
        .toMatchObject({ type: 'applied', historyResult: { selection: selectionSet(2) } })
    } finally {
      binding.dispose()
    }
  })

  it('leaves the caret to the view when a command recorded no selection', () => {
    const binding = boot()
    try {
      binding.submit({ kind: 'resolve-all', decision: 'accept', projections: [] })
      expect(binding.submit({ kind: 'undo', projections: [] }).acknowledged).not.toHaveProperty('historyResult')
    } finally {
      binding.dispose()
    }
  })

  it('recovers a review command entry that keeps only its undo selection', () => {
    const binding = createEditorCoreBinding(createLocalCoreOwner())
    try {
      expect(binding.open({
        documentId: 'recovered-review.md',
        source: 'A new\n',
        recoveryHistory: {
          undo: [{
            undo: [{ start: 2, end: 5, insert: '{++new++}' }],
            redo: [{ start: 2, end: 11, insert: 'new' }],
            beforeSelection: selectionSet(1)
          }],
          redo: []
        }
      })).toMatchObject({ type: 'opened' })
      expect(binding.submit({ kind: 'undo', projections: [] }).acknowledged)
        .toMatchObject({ type: 'applied', historyResult: { selection: selectionSet(1) } })
    } finally {
      binding.dispose()
    }
  })
})
