import type { SourceOffset, SourceRange } from '../../revision.js'

export function sourceOffset(value: number): SourceOffset {
  return value as SourceOffset
}

export function sourceRange(start: number, end: number): SourceRange {
  return Object.freeze({ start: sourceOffset(start), end: sourceOffset(end) })
}

export function sameRange(
  left: Readonly<{ readonly start: number; readonly end: number }>,
  right: Readonly<{ readonly start: number; readonly end: number }>
): boolean {
  return left.start === right.start && left.end === right.end
}
