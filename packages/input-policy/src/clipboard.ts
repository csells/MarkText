/** Existing native table cells store pasted lines as inline breaks. */
export const tableCellInlineBreak = '<br/>'
const tableCellLineEndings = /\r\n|\r|\n/gu

export function tableCellPaste(text: string): string {
  return text.trim().replace(tableCellLineEndings, tableCellInlineBreak)
}

/** The same paste policy maps an interior payload caret before cell escaping. */
export function tableCellPasteCaret(text: string, offset: number): number {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw new RangeError('Table paste caret is outside its payload')
  const value = text.trim()
  const start = text.length - text.trimStart().length
  return value.slice(0, Math.max(0, Math.min(value.length, offset - start))).replace(tableCellLineEndings, tableCellInlineBreak).length
}

/** Only the first soft line of a pasted paragraph remains in an ATX heading. */
export function headingPasteLines(text: string): Readonly<{ first: string; rest: string }> {
  const [first, ...rest] = text.split('\n')
  return { first: first ?? '', rest: rest.join('\n') }
}

/** Native plain HTML paste keeps its first line in the current content. */
export function plainHtmlPasteLines(text: string): Readonly<{ first: string; rest: string }> {
  const [first, ...rest] = text.trim().split('\n')
  return { first: first ?? '', rest: rest.join('\n') }
}
