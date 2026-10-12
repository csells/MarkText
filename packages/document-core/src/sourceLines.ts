import type { DocumentCore, DocumentRevision } from './documentCore.js'
import type { MarkdownLineIndex } from './revision.js'

type SourceReader = Pick<DocumentCore, 'sourceSlice'>

/** Where the source line holding `position` starts, read back in widening chunks. */
export function lineStartAt(core: SourceReader, revision: DocumentRevision, position: number): number {
  for (let span = 256; ; span *= 4) {
    const start = Math.max(0, position - span)
    const text = core.sourceSlice(revision, { start, end: position })
    const found = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'))
    if (found >= 0) return start + found + 1
    if (start === 0) return 0
  }
}

/** Where the source line holding `position` ends, before its line ending, read on in widening chunks. */
export function lineEndAt(core: SourceReader, revision: DocumentRevision, position: number): number {
  for (let span = 256; ; span *= 4) {
    const end = Math.min(revision.sourceLength, position + span)
    const found = core.sourceSlice(revision, { start: position, end }).search(/[\r\n]/u)
    if (found >= 0) return position + found
    if (end === revision.sourceLength) return end
  }
}

/**
 * Where the line of `text` holding offset `at` starts. At offset 0 a line
 * ending at index 0 still counts, as `lastIndexOf` reads a negative start as 0.
 */
export function lineStartBefore(text: string, at: number): number {
  return Math.max(text.lastIndexOf('\n', at - 1), text.lastIndexOf('\r', at - 1)) + 1
}

/** The line of `lines` holding `offset`. */
export function physicalLineAt(lines: MarkdownLineIndex, offset: number) {
  let low = 0
  let high = lines.count
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2)
    if (lines.at(mid).start <= offset) low = mid + 1
    else high = mid
  }
  return lines.at(Math.max(0, low - 1))
}
