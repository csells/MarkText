import { expect, it } from 'vitest'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'

it.each([false, true])(
  'commits tracked whole-table Cut and next input through the sole history owner (following=%s)',
  (following) => {
    const binding = createEditorCoreBinding(createLocalCoreOwner())
    const table = '| a | b |\n| --- | --- |\n| c | d |'
    const source = `${table}\n${following ? '\nafter\n' : ''}`
    const selection = {
      kind: 'table' as const,
      table: { start: 0, end: table.length },
      anchor: { row: 0, column: 0 },
      focus: { row: 1, column: 1 }
    }
    binding.open({ documentId: 'tracked-whole-table.md', source })
    try {
      const cut = binding.submit({
        kind: 'clipboard',
        action: { kind: 'table', operation: 'cut', tracked: true, selection },
        projections: []
      }).acknowledged
      const cutSource = `{--${table}--}\n${following ? '\nafter\n' : ''}`
      const point = following ? cutSource.indexOf('after') : 0
      expect(cut).toMatchObject({
        type: 'applied',
        clipboardResult: { selection: { ranges: [{ anchor: point, focus: point }], primary: 0 } }
      })
      expect(binding.sourceAtBarrier()).toMatchObject({ source: cutSource })
      const typed = binding.submit({
        kind: 'input',
        action: {
          selection: { ranges: [{ anchor: point, focus: point }], primary: 0 },
          range: { start: point, end: point },
          inputType: 'insertText',
          data: 'X',
          options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
        },
        tracked: true,
        projections: []
      }).acknowledged
      expect(typed.type).toBe('applied')
      const typedSource = following ? `{--${table}--}\n\n{++X++}after\n` : `{++X++}{--${table}--}\n`
      expect(binding.sourceAtBarrier()).toMatchObject({ source: typedSource })
      expect(binding.submit({ kind: 'undo', projections: [] }).acknowledged.type).toBe('applied')
      expect(binding.sourceAtBarrier()).toMatchObject({ source: cutSource })
      expect(binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({
        type: 'applied',
        historyResult: { selection }
      })
      expect(binding.sourceAtBarrier()).toMatchObject({ source })
      expect(binding.submit({ kind: 'redo', projections: [] }).acknowledged).toMatchObject({
        type: 'applied',
        historyResult: { selection: { ranges: [{ anchor: point, focus: point }], primary: 0 } }
      })
      expect(binding.submit({ kind: 'redo', projections: [] }).acknowledged.type).toBe('applied')
      expect(binding.sourceAtBarrier()).toMatchObject({ source: typedSource })
    } finally {
      binding.dispose()
    }
  }
)
