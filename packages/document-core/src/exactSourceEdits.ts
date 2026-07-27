export interface ExactSourceEdit {
  readonly start: number
  readonly end: number
  readonly insert: string
}

/**
 * Validate base-coordinate edits and apply them with one left-to-right source
 * pass. The result is assembled once, so work does not multiply by edit count.
 */
export function applyExactSourceEdits(
  source: string,
  edits: readonly ExactSourceEdit[],
  label: string
): string {
  const pieces: string[] = []
  let sourceOffset = 0
  for (const [index, edit] of edits.entries()) {
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < sourceOffset ||
      edit.end < edit.start ||
      edit.end > source.length ||
      typeof edit.insert !== 'string'
    ) {
      throw new RangeError(`${label} ${String(index)} is invalid`)
    }
    pieces.push(source.slice(sourceOffset, edit.start), edit.insert)
    sourceOffset = edit.end
  }
  pieces.push(source.slice(sourceOffset))
  return pieces.join('')
}
