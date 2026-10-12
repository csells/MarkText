interface SourceText {
  readonly length: number
  slice(start: number, end: number): string
}

interface SourceEdit {
  readonly start: number
  readonly end: number
  readonly insert: string
}

const LINE_PROBE = 256

/** Where the line holding `offset` starts, read back from `source` in probes. */
function slicedLineStartBefore(source: SourceText, offset: number): number {
  for (let end = offset; end > 0; end -= LINE_PROBE) {
    const start = Math.max(0, end - LINE_PROBE)
    const chunk = source.slice(start, end)
    const at = Math.max(chunk.lastIndexOf('\n'), chunk.lastIndexOf('\r'))
    if (at >= 0) return start + at + 1
  }
  return 0
}

function lineEndAfter(source: SourceText, offset: number): number {
  for (let start = offset; start < source.length; start += LINE_PROBE) {
    const chunk = source.slice(start, Math.min(source.length, start + LINE_PROBE))
    const newline = chunk.search(/[\n\r]/u)
    if (newline >= 0) return start + newline
  }
  return source.length
}

/**
 * A `$$` alone on its line opens a math block that closes at the next `$$`
 * anywhere later, across blank lines, so its extent is not local to any
 * paragraph. An edit that adds or removes a `$` (or the backslash escaping
 * one), or that changes a line holding a `$`, can pair that block with a
 * different closer far outside the blocks the edit touches. Such an edit is
 * reparsed whole whenever the document spells a `$$` at all.
 */
export function editsMayRepairDollarMath(
  previous: SourceText,
  next: SourceText,
  edits: readonly SourceEdit[]
): boolean {
  const touchesDollar = edits.some(edit =>
    edit.insert.includes('$') ||
    previous.slice(
      slicedLineStartBefore(previous, edit.start),
      lineEndAfter(previous, edit.end)
    ).includes('$')
  )
  return touchesDollar && (
    previous.slice(0, previous.length).includes('$$') ||
    next.slice(0, next.length).includes('$$')
  )
}
