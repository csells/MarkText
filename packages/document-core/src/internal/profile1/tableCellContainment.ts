/**
 * Profile rule R3b: inside a GFM table an unescaped `|` keeps delimiting
 * cells between CriticMarkup markers, so an annotation may not cut through a
 * cell. It forms when its opener and its other marker sit in one cell, or
 * when its opener begins a cell's text (or stands outside every cell) and
 * its other marker ends one (or stands outside), so it covers whole cells,
 * rows or tables. `| a {++ | b ++} |` does not form; `| x |{++ y |++}` adds
 * a whole cell.
 *
 * Table structure is read from the canonical source before CriticMarkup is
 * recognized. Delimiter runs at a row's start or end are not row text
 * (annotation delimiters are not text for block recognition), so an
 * annotation that wraps whole rows stays outside their cells.
 */
export interface TableCellContainment {
  /** Whether an opener at `open` may pair with the marker at `other`. */
  readonly pairs: (open: RowSpan, other: RowSpan) => boolean
}

const NO_CONTAINMENT: TableCellContainment = Object.freeze({
  pairs: (): boolean => true
})

const EDGE_DELIMITER = /^(?:\{\+\+|\{--|\{~~|\{==|\{>>|\+\+\}|--\}|~~\}|==\}|<<\}|~>)/u
const TRAILING_DELIMITER = /(?:\{\+\+|\{--|\{~~|\{==|\{>>|\+\+\}|--\}|~~\}|==\}|<<\}|~>)$/u

const DELIMITER = String.raw`(?:\{\+\+|\{--|\{~~|\{==|\{>>|\+\+\}|--\}|~~\}|==\}|<<\}|~>)`
const LEADING_EDGE = new RegExp(String.raw`^(?:[\s\S]*${DELIMITER})?[ \t]*$`, 'u')
const TRAILING_EDGE = new RegExp(String.raw`^[ \t]*(?:${DELIMITER}[\s\S]*)?$`, 'u')

export interface RowSpan {
  readonly start: number
  readonly end: number
}

function isSpaceOrTab(codeUnit: number): boolean {
  return codeUnit === 32 || codeUnit === 9
}

/** The row text of a line: container prefix, edge delimiters and blanks removed. */
function rowSpan(source: string, start: number, end: number): RowSpan {
  let from = start
  let to = end
  for (;;) {
    while (from < to && (isSpaceOrTab(source.charCodeAt(from)) || source.charCodeAt(from) === 62)) from += 1
    const leading = EDGE_DELIMITER.exec(source.slice(from, Math.min(to, from + 3)))
    if (leading === null) break
    from += leading[0].length
  }
  for (;;) {
    while (to > from && isSpaceOrTab(source.charCodeAt(to - 1))) to -= 1
    const trailing = TRAILING_DELIMITER.exec(source.slice(Math.max(from, to - 3), to))
    if (trailing === null) break
    to -= trailing[0].length
  }
  return Object.freeze({ start: from, end: to })
}

function unescapedPipes(source: string, span: RowSpan): number[] {
  const pipes: number[] = []
  for (let offset = span.start; offset < span.end; offset += 1) {
    if (source.charCodeAt(offset) !== 124) continue
    let backslashes = 0
    for (let back = offset - 1; back >= span.start && source.charCodeAt(back) === 92; back -= 1) {
      backslashes += 1
    }
    if (backslashes % 2 === 0) pipes.push(offset)
  }
  return pipes
}

/** Cell interiors of a row: text between its structural pipes. */
function rowCells(source: string, span: RowSpan): RowSpan[] {
  const pipes = unescapedPipes(source, span)
  const boundaries = [span.start - 1, ...pipes, span.end]
  const cells: RowSpan[] = []
  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const start = (boundaries[index] ?? span.start) + 1
    const end = boundaries[index + 1] ?? span.end
    const text = source.slice(start, end)
    // Before a row's first pipe or after its last, text that an annotation
    // delimiter separates from the pipe is not the row's: the annotation
    // boundary ends the row there, as it does in the views.
    const leadingEdge = index === 0 && pipes.length > 0 && LEADING_EDGE.test(text)
    const trailingEdge = index + 2 === boundaries.length && pipes.length > 0 && TRAILING_EDGE.test(text)
    if (!leadingEdge && !trailingEdge) cells.push(Object.freeze({ start, end }))
  }
  return cells
}

const DELIMITER_TOKEN = new RegExp(DELIMITER, 'gu')

/**
 * A delimiter standing alone between two pipes joins two rows from different
 * views (`| a |~>| b |`): each side of it is its own row.
 */
function rowPieces(source: string, span: RowSpan): RowSpan[] {
  const pieces: RowSpan[] = []
  let pieceStart = span.start
  const text = source.slice(span.start, span.end)
  for (const match of text.matchAll(DELIMITER_TOKEN)) {
    const start = span.start + (match.index ?? 0)
    const end = start + match[0].length
    let before = start - 1
    while (before >= span.start && isSpaceOrTab(source.charCodeAt(before))) before -= 1
    let after = end
    while (after < span.end && isSpaceOrTab(source.charCodeAt(after))) after += 1
    if (source.charCodeAt(before) === 124 && source.charCodeAt(after) === 124) {
      pieces.push(Object.freeze({ start: pieceStart, end: start }))
      pieceStart = end
    }
  }
  pieces.push(Object.freeze({ start: pieceStart, end: span.end }))
  return pieces
}

function delimiterCellCount(source: string, span: RowSpan): number | undefined {
  if (unescapedPipes(source, span).length === 0) return undefined
  const cells = rowCells(source, span)
  for (const cell of cells) {
    if (!/^[ \t]*:?-+:?[ \t]*$/u.test(source.slice(cell.start, cell.end))) return undefined
  }
  return cells.length === 0 ? undefined : cells.length
}

const BLOCK_START = /^[ \t]{0,3}(?:#{1,6}(?:[ \t]|$)|(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$|`{3,}|~{3,}|<[A-Za-z/!?])/u
const FENCE = /^[ \t>]*(`{3,}|~{3,})/u

export function createTableCellContainment(
  source: string,
  gfm: boolean
): TableCellContainment {
  if (!gfm || !source.includes('|')) return NO_CONTAINMENT
  // A comment's payload is its own subdocument: a line break inside it does
  // not end the host's table row.
  const commentBreaks = new Set<number>()
  let commentDepth = 0
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source.startsWith('{>>', offset) && source.includes('<<}', offset + 3)) {
      commentDepth += 1
      offset += 2
    } else if (commentDepth > 0 && source.startsWith('<<}', offset)) {
      commentDepth -= 1
      offset += 2
    } else if (commentDepth > 0 && (source.charCodeAt(offset) === 10 || source.charCodeAt(offset) === 13)) {
      commentBreaks.add(offset)
    }
  }
  const endsLine = (offset: number): boolean =>
    (source.charCodeAt(offset) === 10 || source.charCodeAt(offset) === 13) && !commentBreaks.has(offset)
  const lines: RowSpan[] = []
  for (let start = 0; start <= source.length;) {
    let end = start
    while (end < source.length && !endsLine(end)) end += 1
    lines.push(Object.freeze({ start, end }))
    if (end >= source.length) break
    start = end + (source.charCodeAt(end) === 13 && source.charCodeAt(end + 1) === 10 ? 2 : 1)
  }
  const cells: RowSpan[] = []
  let fence: string | undefined
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) break
    const text = source.slice(line.start, line.end)
    const fenceMatch = FENCE.exec(text)
    if (fence !== undefined) {
      if (fenceMatch?.[1] !== undefined && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = undefined
      continue
    }
    if (fenceMatch?.[1] !== undefined) {
      fence = fenceMatch[1]
      continue
    }
    const header = rowSpan(source, line.start, line.end)
    const next = lines[index + 1]
    if (header.start >= header.end || next === undefined) continue
    const columns = delimiterCellCount(source, rowSpan(source, next.start, next.end))
    const headerPipes = unescapedPipes(source, header)
    if (columns === undefined || headerPipes.length === 0 || rowCells(source, header).length !== columns) continue
    cells.push(...rowPieces(source, header).flatMap(piece => rowCells(source, piece)))
    let row = index + 2
    for (; row < lines.length; row += 1) {
      const body = lines[row]
      if (body === undefined) break
      const span = rowSpan(source, body.start, body.end)
      if (span.start >= span.end || BLOCK_START.test(source.slice(body.start, body.end))) break
      cells.push(...rowPieces(source, span).flatMap(piece => rowCells(source, piece)))
    }
    index = row - 1
  }
  if (cells.length === 0) return NO_CONTAINMENT
  const cellAt = (offset: number): number => {
    let low = 0
    let high = cells.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if ((cells[middle]?.start ?? Number.POSITIVE_INFINITY) <= offset) low = middle + 1
      else high = middle
    }
    const cell = cells[low - 1]
    return cell !== undefined && offset < cell.end ? low - 1 : -1
  }
  const blank = (start: number, end: number): boolean => /^[ \t]*$/u.test(source.slice(start, end))
  // An opener stands at the start of its cell's text, a closer at its end.
  const atEdge = (marker: RowSpan, side: 'start' | 'end'): boolean => {
    const cell = cells[cellAt(marker.start)]
    return cell === undefined || (side === 'start' ? blank(cell.start, marker.start) : blank(marker.end, cell.end))
  }
  return Object.freeze({
    pairs: (open: RowSpan, other: RowSpan): boolean =>
      cellAt(open.start) === cellAt(other.start) || (atEdge(open, 'start') && atEdge(other, 'end'))
  })
}
