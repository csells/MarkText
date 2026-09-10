import type { MuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import type { MuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

export const tableInputOptions = {
  autoPairBracket: true,
  autoPairQuote: true,
  autoPairMarkdownSyntax: true
}

export const tableSelection = (view: MuyaMarkupView, row: number, column: number, offset = 0) => {
  const cell = view.bindings.find(
    (binding) => binding.tableCell?.row === row && binding.tableCell.column === column
  )?.tableCell
  if (cell === undefined) throw new Error(`Missing table cell ${row},${column}`)
  return { kind: 'table-cell' as const, cell, anchor: offset, focus: offset }
}

type TableCommand =
  | { command: 'insertTableRow' | 'insertTableColumn'; placement: 'before' | 'after' }
  | { command: 'removeTableRow' | 'removeTableColumn' }
  | { command: 'alignTableColumn'; alignment: 'left' | 'right' | 'center' }

/** Retained source/history cases submit the same commands as native table widgets. */
export const tableModelCommand = (
  adapter: MuyaPlainTextCoreAdapter,
  view: MuyaMarkupView,
  row: number,
  column: number,
  command: TableCommand,
  reconcile: Parameters<MuyaPlainTextCoreAdapter['input']>[1],
  tracked = false
) => {
  const selection = tableSelection(view, row, column)
  return adapter.input(
    {
      kind: 'command',
      ...(command.command === 'alignTableColumn'
        ? { ...command, target: selection.cell }
        : command),
      selection,
      options: tableInputOptions
    },
    reconcile,
    tracked
  )
}
