import type { PersistentCanonicalSource } from './internal/persistentCanonicalSource.js'

interface SourceEditLike {
  readonly start: number
  readonly end: number
  readonly insert: string
}

const isHighSurrogate = (unit: number) => unit >= 0xD800 && unit <= 0xDBFF
const isLowSurrogate = (unit: number) => unit >= 0xDC00 && unit <= 0xDFFF

/** Whether `offset` falls between the two halves of one astral code point. */
function splitsPair(source: Pick<PersistentCanonicalSource, 'codeUnitAt'>, offset: number): boolean {
  return isHighSurrogate(source.codeUnitAt(offset - 1)) && isLowSurrogate(source.codeUnitAt(offset))
}

/**
 * The first edit that would leave a lone surrogate in well-formed text: its
 * start or end falls inside a surrogate pair of `source`, or its insert has
 * one of its own. Lone surrogates already in an opened source are not
 * repaired; edits beside them are admitted.
 */
export function surrogateSplittingEdit(
  source: Pick<PersistentCanonicalSource, 'codeUnitAt'>,
  edits: readonly SourceEditLike[]
): number | undefined {
  const index = edits.findIndex(edit =>
    splitsPair(source, edit.start) || (edit.end !== edit.start && splitsPair(source, edit.end)) ||
    !edit.insert.isWellFormed())
  return index < 0 ? undefined : index
}
