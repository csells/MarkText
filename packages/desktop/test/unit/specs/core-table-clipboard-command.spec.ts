import { expect, it } from 'vitest'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'

const source = '| a | b | c |\n| --- | --- | --- |\n| {++a++} | b{>>note<<} | d |\n| e | f | g |\n'
const cleared = '|  |  | c |\n| --- | --- | --- |\n|  |  | d |\n| e | f | g |\n'
const selection = () => ({
  kind: 'table' as const,
  table: { start: 0, end: source.length - 1 },
  anchor: { row: 0, column: 0 },
  focus: { row: 1, column: 1 }
})

it('retains the actual table rectangle through the same owner, history, and recovery journal', async() => {
  const manager = createCoreDocumentSessionManager({
    createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
  })
  await manager.open({ documentId: 'table-clipboard.md', source, lineEnding: '\n' })
  let lease = manager.lease('table-clipboard.md')
  try {
    const action = {
      kind: 'table' as const,
      operation: 'delete' as const,
      tracked: false,
      selection: selection()
    }
    const outcome = lease.binding.submit({
      kind: 'clipboard',
      action,
      projections: []
    }).acknowledged
    expect(outcome).toMatchObject({
      type: 'applied',
      clipboardResult: {
        selection: { kind: 'table', anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } }
      }
    })
    expect(await manager.saveBarrier(lease.documentId)).toMatchObject({ source: cleared })
    action.selection.anchor.row = 999
    lease.faultView(new Error('Disconnected table view'))
    lease = await manager.recover(lease)
    expect(await manager.saveBarrier(lease.documentId)).toMatchObject({ source: cleared })
    const undone = lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged
    expect(undone).toMatchObject({ type: 'applied', historyResult: { selection: selection() } })
    expect(await manager.saveBarrier(lease.documentId)).toMatchObject({ source })
    const redone = lease.binding.submit({ kind: 'redo', projections: [] }).acknowledged
    expect(redone).toMatchObject({
      type: 'applied',
      historyResult: {
        selection: {
          kind: 'table',
          table: { start: 0, end: cleared.length - 1 },
          anchor: { row: 0, column: 0 },
          focus: { row: 1, column: 1 }
        }
      }
    })
    expect(await manager.saveBarrier(lease.documentId)).toMatchObject({ source: cleared })
  } finally {
    await manager.handoff(lease)
    await manager.close(lease.documentId)
  }
})

it('projects distinct owned addresses for physical and omitted cells without changing source', () => {
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  const source = '| a | b | c |\n| --- | --- | --- |\n| x |\n'
  try {
    binding.open({ documentId: 'table-cell-projection.md', source })
    const view = binding.plainTextViewAtBarrier()
    if (view.type !== 'plain-text-view' || !('state' in view.view)) { throw new Error('Missing model table view') }
    expect(
      view.view.bindings
        .filter((item) => item.syntax.kind === 'table-cell')
        .map((item) => item.tableCell)
    ).toEqual([
      { table: { start: 0, end: source.length - 1 }, row: 0, column: 0 },
      { table: { start: 0, end: source.length - 1 }, row: 0, column: 1 },
      { table: { start: 0, end: source.length - 1 }, row: 0, column: 2 },
      { table: { start: 0, end: source.length - 1 }, row: 1, column: 0 },
      { table: { start: 0, end: source.length - 1 }, row: 1, column: 1 },
      { table: { start: 0, end: source.length - 1 }, row: 1, column: 2 }
    ])
    expect(binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    binding.dispose()
  }
})

it('provides a selected table projection through the same live clipboard barrier', () => {
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  try {
    binding.open({ documentId: 'selected-table.md', source })
    const reply = binding.selectionProjectionAtBarrier(selection())
    expect(reply).toMatchObject({
      type: 'selection-projection',
      accepted: true,
      projection: {
        name: 'revised',
        markdown: '| a   | b   |\n| --- | --- |\n| a   | b   |'
      }
    })
    expect(binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    binding.dispose()
  }
})

it('returns a typed clipboard resource refusal while keeping source and save available', () => {
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  const source = `| ${'x'.repeat(100_000)} |\n| --- |\n${'| y |\n'.repeat(400)}`
  try {
    binding.open({ documentId: 'table-clipboard-budget.md', source })
    const view = binding.plainTextViewAtBarrier()
    if (view.type !== 'plain-text-view' || !('state' in view.view)) { throw new Error('Missing table view') }
    expect(
      binding.selectionProjectionAtBarrier({
        kind: 'table',
        table: { start: 0, end: source.length - 1 },
        anchor: { row: 0, column: 0 },
        focus: { row: 400, column: 0 }
      })
    ).toMatchObject({
      type: 'resource',
      accepted: false,
      resource: { code: 'CM_RESOURCE_SOURCE_UNITS_EXCEEDED' }
    })
    expect(binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    binding.dispose()
  }
})
