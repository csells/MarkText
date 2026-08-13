export type MuyaTableSourceResult =
  | Readonly<{ readonly kind: 'source'; readonly markdown: string }>
  | Readonly<{ readonly kind: 'unsupported' }>

type Alignment = 'none' | 'left' | 'right' | 'center'

const unsupported = (): MuyaTableSourceResult => Object.freeze({
  kind: 'unsupported'
})

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined

const separator = (alignment: Alignment, width: number): string => {
  switch (alignment) {
    case 'left': return `:${'-'.repeat(width - 1)}`
    case 'right': return `${'-'.repeat(width - 1)}:`
    case 'center': return `:${'-'.repeat(width - 2)}:`
    case 'none': return '-'.repeat(width)
  }
}

/**
 * Encodes the bounded, plain-cell table state emitted by Muya's native
 * Markdown paste path. Rich/multiline cells remain explicit fallback work.
 */
export function canonicalSourceForMuyaTable(
  value: unknown,
  maximumSourceUnits: number
): MuyaTableSourceResult {
  if (!Number.isSafeInteger(maximumSourceUnits) || maximumSourceUnits <= 0) {
    throw new RangeError('Muya table source limit is invalid')
  }
  const table = record(value)
  if (table?.name !== 'table' || !Array.isArray(table.children) ||
      table.children.length === 0 || table.children.length > maximumSourceUnits) {
    return unsupported()
  }

  const rows: string[][] = []
  const alignments: Alignment[] = []
  let columns = -1
  for (const [rowIndex, rowValue] of table.children.entries()) {
    const row = record(rowValue)
    if (row?.name !== 'table.row' || !Array.isArray(row.children) ||
        row.children.length === 0) return unsupported()
    if (columns === -1) columns = row.children.length
    if (row.children.length !== columns || columns > maximumSourceUnits) {
      return unsupported()
    }
    const cells: string[] = []
    for (const [columnIndex, cellValue] of row.children.entries()) {
      const cell = record(cellValue)
      const meta = record(cell?.meta)
      const alignment = meta?.align
      if (
        cell?.name !== 'table.cell' || typeof cell.text !== 'string' ||
        /[\r\n|]/.test(cell.text) ||
        !['none', 'left', 'right', 'center'].includes(String(alignment))
      ) return unsupported()
      if (rowIndex === 0) alignments.push(alignment as Alignment)
      else if (alignment !== alignments[columnIndex]) return unsupported()
      cells.push(cell.text)
    }
    rows.push(cells)
  }

  const widths = Array.from({ length: columns }, (_, column) => Math.max(
    3,
    ...rows.map(row => row[column]?.length ?? 0)
  ))
  const lineUnits = widths.reduce((total, width) => total + width, 0) +
    3 * (columns - 1) + 4
  const totalUnits = lineUnits * (rows.length + 1) + rows.length
  if (totalUnits > maximumSourceUnits) return unsupported()
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((cell, column) =>
      cell.padEnd(widths[column] ?? 3)
    ).join(' | ')} |`
  const output = [
    line(rows[0] ?? []),
    line(alignments.map((alignment, column) =>
      separator(alignment, widths[column] ?? 3)
    )),
    ...rows.slice(1).map(line)
  ].join('\n')
  return Object.freeze({ kind: 'source', markdown: output })
}
