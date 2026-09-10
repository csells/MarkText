import { describe, expect, it } from 'vitest'
import CodeMirror from '@/codeMirror'
import { createCodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'
import { createLocalCoreOwner, type CoreModelTestControl } from '@/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'

const selectionSet = (start: number, end: number) => ({
  ranges: [{ anchor: start, focus: end }],
  primary: 0
})
const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
const boot = (source: string) => {
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId: 'history-selection.md', source })
  return binding
}
const typing = (start: number, end: number, data: string) => ({
  kind: 'input' as const,
  tracked: false,
  projections: [],
  action: {
    range: { start, end },
    selection: selectionSet(start, end),
    data,
    inputType: 'insertText',
    options
  }
})

describe('canonical transaction history selection', () => {
  it('applies the same stale-owner rejection to primary Source transactions', () => {
    let control: CoreModelTestControl | undefined
    const owner = createLocalCoreOwner({
      registerTestControl: (value) => {
        control = value
      }
    })
    const binding = createEditorCoreBinding(owner)
    try {
      const opened = binding.open({ documentId: 'stale-source.md', source: 'abc' })
      if (opened.type !== 'opened') throw new Error('Missing source document')
      if (control === undefined) throw new Error('Missing test control')
      control.staleNextTransaction()
      expect(
        binding.submit({
          kind: 'source-input',
          projections: [],
          action: {
            edits: [{ start: 0, end: 3, insert: 'X' }],
            beforeSelection: selectionSet(0, 3),
            afterSelection: selectionSet(1, 1)
          }
        }).acknowledged
      ).toMatchObject({ type: 'rejected', reason: 'stale-base' })
      expect(() => binding.sourceAtBarrier()).toThrow('reconciliation')
      expect(
        owner.request({
          type: 'source-at-barrier',
          session: opened.session,
          sequence: 100,
          baseRevision: opened.revision
        })
      ).toMatchObject({ source: 'abc', recoveryHistory: { undo: [], redo: [] } })
    } finally {
      binding.dispose()
    }
  })

  it('restores selected source on undo and the planned caret on redo', () => {
    const binding = boot('abc')
    try {
      binding.submit(typing(0, 3, 'X'))
      expect(binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({
        type: 'applied',
        historyResult: { selection: selectionSet(0, 3) }
      })
      expect(binding.submit({ kind: 'redo', projections: [] }).acknowledged).toMatchObject({
        type: 'applied',
        historyResult: { selection: selectionSet(1, 1) }
      })
    } finally {
      binding.dispose()
    }
  })

  it('groups the first before-selection and final paired caret', () => {
    const binding = boot('abc')
    try {
      binding.submit({ ...typing(0, 3, 'x'), nativeHistoryGroup: 'typing' })
      binding.submit({ ...typing(1, 1, '('), nativeHistoryGroup: 'typing' })
      expect(binding.sourceAtBarrier()).toMatchObject({ source: 'x()' })
      expect(binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({
        historyResult: { selection: selectionSet(0, 3) }
      })
      expect(binding.submit({ kind: 'redo', projections: [] }).acknowledged).toMatchObject({
        historyResult: { selection: selectionSet(2, 2) }
      })
    } finally {
      binding.dispose()
    }
  })

  it('persists formatting and input selections through a canonical recovery checkpoint', () => {
    const binding = boot('a{++a++}a\n')
    const recovered = createEditorCoreBinding(createLocalCoreOwner())
    try {
      const format = binding.submit({
        kind: 'format',
        action: { format: 'inline_math', selection: selectionSet(0, 9), tracked: false },
        projections: []
      }).acknowledged
      if (
        format.type !== 'applied' ||
        !format.formatResult ||
        !('ranges' in format.formatResult.selection)
      ) { throw new Error('Missing format result') }
      const selected = format.formatResult.selection.ranges[0]
      binding.submit(typing(selected.anchor, selected.focus, 'X'))
      const checkpoint = binding.sourceAtBarrier()
      if (checkpoint.type !== 'source') throw new Error('Missing checkpoint')
      recovered.open({
        documentId: 'recovered.md',
        source: checkpoint.source,
        recoveryHistory: checkpoint.recoveryHistory
      })
      expect(recovered.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({
        historyResult: { selection: selectionSet(selected.anchor, selected.focus) }
      })
      expect(recovered.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({
        historyResult: { selection: selectionSet(0, 9) }
      })
      expect(recovered.submit({ kind: 'redo', projections: [] }).acknowledged).toMatchObject({
        historyResult: { selection: selectionSet(selected.anchor, selected.focus) }
      })
    } finally {
      binding.dispose()
      recovered.dispose()
    }
  })

  it('restores shared Markup history selection after handing the source to CodeMirror', async() => {
    const binding = boot('abc')
    binding.submit(typing(0, 3, 'X'))
    const doc = new CodeMirror.Doc('X')
    const adapter = createCodeMirrorCoreAdapter(doc, binding, {
      canonicalSource: 'X',
      insertedLineEnding: '\n'
    })
    try {
      await adapter.history('undo')
      expect(doc.getValue()).toBe('abc')
      expect(doc.listSelections()).toMatchObject([
        { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 3 } }
      ])
      await adapter.history('redo')
      expect(doc.getValue()).toBe('X')
      expect(doc.listSelections()).toMatchObject([
        { anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 1 } }
      ])
    } finally {
      adapter.dispose()
      binding.dispose()
    }
  })

  it('leaves transaction history unchanged when input only skips a paired closer', () => {
    const binding = boot('')
    try {
      binding.submit(typing(0, 0, '('))
      const before = binding.sourceAtBarrier()
      binding.submit(typing(1, 1, ')'))
      const after = binding.sourceAtBarrier()
      if (before.type !== 'source' || after.type !== 'source') throw new Error('Missing source')
      expect(after.revision).toBe(before.revision)
      expect(after.recoveryHistory).toEqual(before.recoveryHistory)
      expect(binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({
        historyResult: { selection: selectionSet(0, 0) }
      })
    } finally {
      binding.dispose()
    }
  })

  it.each([
    { beforeSelection: selectionSet(0, 4), afterSelection: selectionSet(1, 1) },
    { beforeSelection: selectionSet(0, 3), afterSelection: selectionSet(2, 2) },
    { beforeSelection: selectionSet(0, 3) },
    { beforeSelection: selectionSet(Number.NaN, 3), afterSelection: selectionSet(1, 1) }
  ])('rejects invalid checkpoint transaction selection $beforeSelection', (selection) => {
    const binding = createEditorCoreBinding(createLocalCoreOwner())
    try {
      expect(
        binding.open({
          documentId: 'invalid.md',
          source: 'X',
          recoveryHistory: {
            undo: [
              {
                undo: [{ start: 0, end: 1, insert: 'abc' }],
                redo: [{ start: 0, end: 3, insert: 'X' }],
                ...selection
              }
            ],
            redo: []
          }
        })
      ).toMatchObject({ type: 'rejected', reason: 'recovery-history-invalid' })
    } finally {
      binding.dispose()
    }
  })
})
