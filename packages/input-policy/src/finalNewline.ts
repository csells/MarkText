/**
 * Upstream MarkText's per-file "Trailing newline" modes, detected when a file
 * opens and chosen from the command palette: 0 trims every final line break,
 * 1 ensures exactly one, 2 (several detected) and 3 (disabled) keep the text
 * as it is.
 */
export type TrailingNewlineMode = 0 | 1 | 2 | 3

export interface FinalNewlineEdit {
  readonly start: number
  readonly end: number
  readonly insert: string
}

/**
 * The edit that writes a document's final line breaks in `mode`, as upstream
 * writes a file it saves, or undefined when they already conform. `tail` is
 * the document's end, starting at `tailStart`; it holds the whole final run
 * of line breaks and, unless it starts the document, a character before it.
 * Unlike upstream's `/[\r?\n]+$/`, only line breaks are trimmed, never a
 * final `?`.
 */
export function finalNewlineEdit(tail: string, tailStart: number, mode: number | undefined): FinalNewlineEdit | undefined {
  if (mode !== 0 && mode !== 1) return undefined
  const run = /(?:\r\n|\r|\n)*$/u.exec(tail)?.[0] ?? ''
  const runStart = tailStart + tail.length - run.length
  const end = tailStart + tail.length
  // Upstream writes a document of only line breaks as empty.
  if (mode === 0 || runStart === 0) return run.length === 0 ? undefined : { start: runStart, end, insert: '' }
  if (run.length === 0) return { start: end, end, insert: '\n' }
  const first = /^(?:\r\n|\r|\n)/u.exec(run)?.[0] ?? ''
  return first.length === run.length ? undefined : { start: runStart + first.length, end, insert: '' }
}
