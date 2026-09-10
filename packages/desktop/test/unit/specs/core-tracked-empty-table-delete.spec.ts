import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'

it.each([
  {
    name: 'table',
    populated: '| {++z++} |  |\n| --- | --- |\n|  |  |\n',
    source: '|  |  |\n| --- | --- |\n|  |  |\n',
    anchor: { row: 0, column: 0 },
    focus: { row: 1, column: 1 },
    deleted: '{--|  |  |\n| --- | --- |\n|  |  |--}\n',
    typed: '{++X++}{--|  |  |\n| --- | --- |\n|  |  |--}\n',
    revised: 'X\n'
  },
  {
    name: 'row',
    populated: '| a | b |\n| --- | --- |\n| {++z++} |  |\n| c | d |\n',
    source: '| a | b |\n| --- | --- |\n|  |  |\n| c | d |\n',
    anchor: { row: 1, column: 0 },
    focus: { row: 1, column: 1 },
    deleted: '| a | b |\n| --- | --- |{--\n|  |  |--}\n| c | d |\n',
    typed: '| a | b |\n| --- | --- |{--\n|  |  |--}\n| {++X++}c | d |\n',
    revised: '| a | b |\n| --- | --- |\n| Xc | d |\n'
  },
  {
    name: 'column',
    populated: '| a | {++z++} | c |\n| --- | --- | --- |\n| x |\n',
    source: '| a |  | c |\n| --- | --- | --- |\n| x |\n',
    anchor: { row: 0, column: 1 },
    focus: { row: 1, column: 1 },
    deleted: '| a |{--  |--} c |\n| --- |{-- --- |--} --- |\n| x |\n',
    typed: '| a |{--  |--} {++X++}c |\n| --- |{-- --- |--} --- |\n| x |\n',
    revised: '| a | Xc |\n| --- | --- |\n| x |\n'
  }
])(
  'keeps tracked empty $name Delete selection, next input, and history in the sole owner',
  ({ source, populated, anchor, focus, deleted, typed, revised }) => {
    const binding = createEditorCoreBinding(createLocalCoreOwner())
    const original = {
      kind: 'table' as const,
      table: { start: 0, end: source.length - 1 },
      anchor,
      focus
    }
    binding.open({ documentId: 'tracked-empty-delete.md', source: populated })
    try {
      const cleared = binding.submit({
        kind: 'clipboard',
        action: {
          kind: 'table',
          operation: 'delete',
          tracked: true,
          selection: { ...original, table: { start: 0, end: populated.length - 1 } }
        },
        projections: []
      }).acknowledged
      expect(cleared).toMatchObject({ type: 'applied', clipboardResult: { selection: original } })
      expect(binding.sourceAtBarrier()).toMatchObject({ source })
      const result = binding.submit({
        kind: 'clipboard',
        action: { kind: 'table', operation: 'delete', tracked: true, selection: original },
        projections: []
      }).acknowledged
      expect(result.type).toBe('applied')
      if (result.type !== 'applied' || result.clipboardResult === undefined) { throw new Error('Missing accepted clipboard selection') }
      const after = result.clipboardResult.selection
      const selection = (() => {
        if (!('ranges' in after)) return after
        const text = after.ranges[after.primary]
        if (text === undefined) throw new Error('Missing primary text selection')
        return { start: text.anchor, end: text.focus }
      })()
      if ('kind' in selection && selection.kind === 'table') { throw new Error('Structural removal retained its deleted rectangle') }
      expect(binding.sourceAtBarrier()).toMatchObject({ source: deleted })
      expect(
        binding.submit({
          kind: 'input',
          action: {
            selection:
              'start' in selection
                ? { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }
                : selection,
            range: selection,
            inputType: 'insertText',
            data: 'X',
            options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
          },
          tracked: true,
          projections: []
        }).acknowledged.type
      ).toBe('applied')
      expect(binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({
        type: 'applied',
        historyResult: { selection: after }
      })
      expect(binding.sourceAtBarrier()).toMatchObject({ source: deleted })
      expect(binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({
        type: 'applied',
        historyResult: { selection: original }
      })
      expect(binding.sourceAtBarrier()).toMatchObject({ source })
      expect(binding.submit({ kind: 'redo', projections: [] }).acknowledged).toMatchObject({
        type: 'applied',
        historyResult: { selection: after }
      })
      expect(binding.submit({ kind: 'redo', projections: [] }).acknowledged.type).toBe('applied')
      expect(binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const reopened = createDocumentCore()
      const reopenedRevision = reopened.open(typed)
      expect(reopened.project(reopenedRevision, 'original').markdown).toBe(source)
      expect(reopened.project(reopenedRevision, 'revised').markdown).toBe(revised)
    } finally {
      binding.dispose()
    }
  }
)
