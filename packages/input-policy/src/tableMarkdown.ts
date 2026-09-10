import stringWidth from './stringWidth.js'

export interface ITableMarkdownState {
  children: readonly { children: readonly { text: string; meta: { align: string } }[] }[];
}

export interface TableMarkdownCellPosition {
  readonly start: number;
  readonly end: number;
  readonly slotStart: number;
  readonly slotEnd: number;
  /** Input UTF-16 boundaries, after trimming/escaping, in output coordinates. */
  readonly offsets: readonly number[];
}

export interface TableMarkdownResult {
  readonly markdown: string;
  readonly delimiterCells: readonly { start: number; end: number; contentStart: number; contentEnd: number }[];
  readonly rows: readonly { start: number; end: number; cells: readonly TableMarkdownCellPosition[] }[];
}

function escapeText(input: string, positions: boolean) {
  const str = input.trim()
  const trimStart = input.length - input.trimStart().length
  let text = ''
  const offsets: number[] = []
  for (let index = 0; index <= str.length; index++) {
    if (positions) { offsets.push(text.length) }
    if (index === str.length) { break }
    if (str[index] === '|' && str[index - 1] !== '\\') { text += '\\' }
    text += str[index]
  }
  return { text, offsets: positions ? Array.from({ length: input.length + 1 }, (_, index) => offsets[Math.max(0, Math.min(str.length, index - trimStart))]!) : [] }
}

/** Native table fragment spelling, excluding its enclosing block's line ending. */
export function tableToMarkdown(state: ITableMarkdownState, indent?: string): string
export function tableToMarkdown(state: ITableMarkdownState, indent: string, maximumUnits: number): string | undefined
export function tableToMarkdown(state: ITableMarkdownState, indent = '', maximumUnits = Number.MAX_SAFE_INTEGER): string | undefined {
  return serializeTable(state, indent, maximumUnits, false)?.markdown
}

/** Same native spelling with exact positions for consumers of an existing syntax tree. */
export function tableToMarkdownWithPositions(state: ITableMarkdownState, indent?: string): TableMarkdownResult
export function tableToMarkdownWithPositions(state: ITableMarkdownState, indent: string, maximumUnits: number): TableMarkdownResult | undefined
export function tableToMarkdownWithPositions(state: ITableMarkdownState, indent = '', maximumUnits = Number.MAX_SAFE_INTEGER): TableMarkdownResult | undefined {
  return serializeTable(state, indent, maximumUnits, true)
}

function serializeTable(state: ITableMarkdownState, indent: string, maximumUnits: number, positions: boolean): TableMarkdownResult | undefined {
  const result: string[] = []
  const rows: { start: number; end: number; cells: TableMarkdownCellPosition[] }[] = []
  const delimiterCells: { start: number; end: number; contentStart: number; contentEnd: number }[] = []
  let outputOffset = 0
  const row = state.children.length
  const tableData = []

  for (const rowState of state.children) {
    tableData.push(
      rowState.children.map(cell => escapeText(cell.text, positions))
    )
  }

  const columnWidth = state.children[0]!.children.map(th => ({
    width: 5,
    align: th.meta.align,
  }))

  let i
  let j

  for (i = 0; i < row; i++) {
    const cells = Math.min(tableData[i]!.length, columnWidth.length)
    for (j = 0; j < cells; j++) {
      columnWidth[j]!.width = Math.max(
        columnWidth[j]!.width,
        stringWidth(tableData[i]![j]!.text) + 2
      ) // add 2, because have two space around text
    }
  }

    // Account for exact source units before padding expands a narrow cell to
    // another row's width. Display columns and UTF-16 units differ for Unicode.
  let outputUnits = row + indent.length + 1 +
        columnWidth.reduce((sum, column) => sum + column.width + 1, 0)
  for (const cells of tableData) {
    outputUnits += indent.length + 1
    for (let column = 0; column < Math.min(cells.length, columnWidth.length); column++) {
      const cell = cells[column]!.text
      const fill = Math.max(columnWidth[column]!.width - 1 - stringWidth(cell), 0)
      outputUnits += 1 + cell.length + fill + 1
    }
    if (outputUnits > maximumUnits) { return undefined }
  }

  tableData.forEach((r, i) => {
    const cells: TableMarkdownCellPosition[] = []
    let cellOffset = outputOffset + indent.length + 1
    const rowStart = outputOffset
    const rs =
            `${indent
            }|${
              r
                .slice(0, columnWidth.length)
                .map((data, j) => {
                  const cell = data.text
                        // Pad by visual column width, not code-unit length,
                        // so combining marks and wide characters stay
                        // aligned (#1983). One leading space + cell + fill.
                  const fill = columnWidth[j]!.width - 1 - stringWidth(cell)

                  const spelling = ` ${cell}${' '.repeat(Math.max(fill, 0))}`
                  if (positions) {
                    const contentStart = cellOffset + (cell === '' ? spelling.length : 1)
                    cells.push({ start: contentStart, end: contentStart + cell.length, slotStart: cellOffset, slotEnd: cellOffset + spelling.length, offsets: data.offsets.map(offset => contentStart + offset) })
                  }
                  cellOffset += spelling.length + 1
                  return spelling
                })
                .join('|')
            }|`
    result.push(rs)
    rows.push({ start: rowStart, end: rowStart + rs.length, cells })
    outputOffset += rs.length + 1
    if (i === 0) {
      let delimiterOffset = outputOffset + indent.length + 1
      const cutOff =
                `${indent
                }|${
                  columnWidth
                    .map(({ width, align }) => {
                      const raw = tableDelimiter(width, align)

                      if (positions) {
                        const markers = tableDelimiterMarkers(align)
                        delimiterCells.push({ start: delimiterOffset, end: delimiterOffset + raw.length, contentStart: delimiterOffset + (markers.start === '' ? 1 : 0), contentEnd: delimiterOffset + raw.length - (markers.end === '' ? 1 : 0) })
                      }
                      delimiterOffset += raw.length + 1
                      return raw
                    })
                    .join('|')
                }|`
      result.push(cutOff)
      outputOffset += cutOff.length + 1
    }
  })

  return { markdown: result.join('\n'), rows, delimiterCells }
}

/** Empty native row spelling and the first cell's content extent in that spelling. */
export function emptyTableRow(columns: number): { markdown: string; firstCellEnd: number } {
  const serialized = tableToMarkdown({ children: [{ children: Array.from({ length: columns }, () => ({ text: '', meta: { align: 'none' } })) }] })
  const markdown = serialized.slice(0, serialized.indexOf('\n'))
  return { markdown, firstCellEnd: markdown.indexOf('|', 1) }
}

/** Empty native column cells and their alignment delimiter, without outer pipes. */
export function emptyTableColumn(): { cell: string; delimiter: string } {
  const serialized = tableToMarkdown({ children: [{ children: [{ text: '', meta: { align: 'none' } }] }] })
  const newline = serialized.indexOf('\n')
  return { cell: serialized.slice(1, newline - 1), delimiter: serialized.slice(newline + 2, -1) }
}

export function toggleTableAlignment(current: string, requested: string): string {
  return current === requested ? 'none' : requested
}

/** Shared native delimiter spelling, including its two edge positions. */
export function tableDelimiter(width: number, alignment: string): string {
  const dashes = '-'.repeat(width - 2)
  const markers = tableDelimiterMarkers(alignment)
  return `${markers.start || ' '}${dashes}${markers.end || ' '}`
}

export function tableDelimiterMarkers(alignment: string): { readonly start: string; readonly end: string } {
  return {
    start: alignment === 'left' || alignment === 'center' ? ':' : '',
    end: alignment === 'right' || alignment === 'center' ? ':' : ''
  }
}

/** Dimensions accepted by the native table creation command. */
export function normalizeTableDimensions(rows: number, columns: number): { rows: number; columns: number } {
  return {
    rows: Math.max(2, Number.isFinite(rows) ? Math.floor(rows) : 0),
    columns: Math.max(1, Number.isFinite(columns) ? Math.floor(columns) : 0)
  }
}
