/**
 * Profile rule R3b: inside a GFM table an unescaped `|` keeps delimiting
 * cells between CriticMarkup markers, so an annotation may not cut through a
 * cell. It forms when its opener and its other marker sit in one cell, or
 * when each stands on a cell boundary (touching a pipe, beginning or ending
 * its cell's text, or outside every cell), so it covers whole cells with
 * their pipes, whole rows or whole tables, as tracked column and row edits
 * spell them. `| a {++ | b ++} |` does not form; `| x |{++ y |++}` adds a
 * cell and `| x {--| y --}|` removes one.
 *
 * Table structure is read from the canonical source before CriticMarkup is
 * recognized. Delimiter runs at a row's start or end are not row text
 * (annotation delimiters are not text for block recognition), so an
 * annotation that wraps whole rows stays outside their cells.
 */
export interface TableCellContainment {
  /** Whether an opener at `open` may pair with the marker at `other`. */
  readonly pairs: (open: RowSpan, other: RowSpan) => boolean
  /**
   * Whether an opener at `open` may pair with any closer starting at one of
   * `closerStarts` (ascending; every closer is three code units) at or
   * after `open.end`. Answered without visiting each later closer, so a
   * document with many unfinished openers and stray closers stays linear.
   */
  readonly pairsAnyCloser: (open: RowSpan, closerStarts: readonly number[]) => boolean
}

const CLOSER_LENGTH = 3

/** The first index of ascending `offsets` at or after `start`. */
function firstOffsetAtOrAfter(offsets: readonly number[], start: number): number {
  let low = 0
  let high = offsets.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((offsets[middle] ?? Number.POSITIVE_INFINITY) < start) low = middle + 1
    else high = middle
  }
  return low
}

const NO_CONTAINMENT: TableCellContainment = Object.freeze({
  pairs: (): boolean => true,
  pairsAnyCloser: (open: RowSpan, closerStarts: readonly number[]): boolean =>
    firstOffsetAtOrAfter(closerStarts, open.end) < closerStarts.length
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

function hasOddBackslashRunBefore(source: string, offset: number): boolean {
  let backslashes = 0
  for (let back = offset - 1; back >= 0 && source.charCodeAt(back) === 92; back -= 1) backslashes += 1
  return backslashes % 2 === 1
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
    // Delimiters are not row text: `| :--- |{++ --- |++}` is a delimiter row.
    const text = source.slice(cell.start, cell.end).replace(DELIMITER_TOKEN, '')
    if (!/^[ \t]*:?-+:?[ \t]*$/u.test(text)) return undefined
  }
  return cells.length === 0 ? undefined : cells.length
}

const BLOCK_START = /^[ \t]{0,3}(?:#{1,6}(?:[ \t]|$)|(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$|`{3,}|~{3,}|<[A-Za-z/!?])/u
const FENCE = /^[ \t>]*(`{3,}|~{3,})/u
// An arm boundary token beginning a line ends a fence its arm opened (L2c).
const ARM_BOUNDARY_LINE = /^(?:[ \t]{0,3}>)*[ \t]*(?:~>|\+\+\}|--\}|~~\}|==\}|<<\})/u

export function createTableCellContainment(
  source: string,
  gfm: boolean
): TableCellContainment {
  if (!gfm || !source.includes('|')) return NO_CONTAINMENT
  // A comment's payload is its own subdocument: a line break inside it does
  // not end the host's table row.
  const commentBreaks = new Set<number>()
  const lastCommentCloser = source.lastIndexOf('<<}')
  let commentDepth = 0
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source.startsWith('{>>', offset) && lastCommentCloser >= offset + 3) {
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
      // A closing fence is the run alone on its line (CommonMark 4.5).
      if (fenceMatch?.[1] !== undefined && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length &&
          /^[ \t]*$/u.test(text.slice(fenceMatch[0].length))) {
        fence = undefined
        continue
      }
      if (!ARM_BOUNDARY_LINE.test(text)) continue
      fence = undefined
    }
    // A backtick fence's info string holds no backtick (CommonMark 4.5).
    if (fenceMatch?.[1] !== undefined && !(fenceMatch[1][0] === '`' && text.slice(fenceMatch[0].length).includes('`'))) {
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
  // The first and last text (neither space nor tab) of each cell, found once
  // per cell, so a cell holding many markers is not rescanned for each.
  const textBounds = new Map<number, Readonly<{ first: number, last: number }>>()
  const cellTextBounds = (ordinal: number, cell: RowSpan): Readonly<{ first: number, last: number }> => {
    let bounds = textBounds.get(ordinal)
    if (bounds === undefined) {
      let first = cell.start
      while (first < cell.end && isSpaceOrTab(source.charCodeAt(first))) first += 1
      let last = cell.end - 1
      while (last >= cell.start && isSpaceOrTab(source.charCodeAt(last))) last -= 1
      bounds = Object.freeze({ first, last })
      textBounds.set(ordinal, bounds)
    }
    return bounds
  }
  // A marker stands on a cell boundary when it touches a pipe, or when an
  // opener begins its cell's text or a closer ends it: the annotation then
  // takes all of that cell's text or none of it.
  const onBoundary = (marker: RowSpan, role: 'open' | 'close'): boolean => {
    const ordinal = cellAt(marker.start)
    const cell = cells[ordinal]
    if (cell === undefined ||
      (source.charCodeAt(marker.start - 1) === 124 && !hasOddBackslashRunBefore(source, marker.start - 1)) ||
      source.charCodeAt(marker.end) === 124) {
      return true
    }
    const bounds = cellTextBounds(ordinal, cell)
    return role === 'open' ? bounds.first >= marker.start : bounds.last < marker.end
  }
  // For each closer list, the index of the next closer at or after each
  // position that stands on a cell boundary (or outside every cell), or -1.
  const boundaryClosers = new Map<readonly number[], Int32Array>()
  const nextBoundaryCloser = (closerStarts: readonly number[], from: number): number => {
    let next = boundaryClosers.get(closerStarts)
    if (next === undefined) {
      next = new Int32Array(closerStarts.length)
      let following = -1
      for (let index = closerStarts.length - 1; index >= 0; index -= 1) {
        const start = closerStarts[index] ?? 0
        if (onBoundary({ start, end: start + CLOSER_LENGTH }, 'close')) following = index
        next[index] = following
      }
      boundaryClosers.set(closerStarts, next)
    }
    return next[from] ?? -1
  }
  return Object.freeze({
    pairs: (open: RowSpan, other: RowSpan): boolean =>
      cellAt(open.start) === cellAt(other.start) || (onBoundary(open, 'open') && onBoundary(other, 'close')),
    pairsAnyCloser: (open: RowSpan, closerStarts: readonly number[]): boolean => {
      const first = firstOffsetAtOrAfter(closerStarts, open.end)
      const firstStart = closerStarts[first]
      if (firstStart === undefined) return false
      // A cell is contiguous, so only the first later closer can share the
      // opener's cell.
      if (cellAt(open.start) === cellAt(firstStart)) return true
      return onBoundary(open, 'open') && nextBoundaryCloser(closerStarts, first) !== -1
    }
  })
}
