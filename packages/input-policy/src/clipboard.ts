/** Existing native table cells store pasted lines as inline breaks. */
export function tableCellPaste(text: string): string {
  return text.trim().replace(/\n/g, '<br/>')
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
