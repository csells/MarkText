export type ColorFormatType = 'color' | 'bg_color'

export interface IColorStyle {
  color: string | null
  backgroundColor: string | null
}

/** A colour span the owning parser recognized, in the text's own offsets. */
export interface IColorSpan {
  openStart: number
  contentStart: number
  contentEnd: number
  closeEnd: number
  style: IColorStyle
}

const COLOR_PROPERTY = 'color'
const BACKGROUND_COLOR_PROPERTY = 'background-color'

export const COLOR_SPAN_CLOSE_TAG = '</span>'

const COLOR_PROPERTY_BY_TYPE: Record<ColorFormatType, string> = {
  color: COLOR_PROPERTY,
  bg_color: BACKGROUND_COLOR_PROPERTY
}

export function colorPropertyOf(type: ColorFormatType): string {
  return COLOR_PROPERTY_BY_TYPE[type]
}

// `null` for a style that carries anything other than colour declarations —
// such a span (pasted or hand-written) is not ours to rewrite.
export function parseColorStyle(
  style: string | null | undefined
): IColorStyle | null {
  if (!style || !style.trim()) { return null }

  const result: IColorStyle = { color: null, backgroundColor: null }
  let matched = false

  for (const declaration of style.split(';')) {
    const fragment = declaration.trim()
    if (!fragment) { continue }

    const colonIndex = fragment.indexOf(':')
    if (colonIndex < 0) { return null }

    const name = fragment.slice(0, colonIndex).trim().toLowerCase()
    if (name !== COLOR_PROPERTY && name !== BACKGROUND_COLOR_PROPERTY) { return null }

    const value = fragment.slice(colonIndex + 1).trim().toLowerCase()
    if (!value) { continue }

    if (name === COLOR_PROPERTY) { result.color = value } else { result.backgroundColor = value }
    matched = true
  }

  return matched ? result : null
}

export function isColorStyleEmpty(style: IColorStyle): boolean {
  return !style.color && !style.backgroundColor
}

export function serializeColorStyle(style: IColorStyle): string {
  const parts: string[] = []
  if (style.color) { parts.push(`${COLOR_PROPERTY}:${style.color}`) }
  if (style.backgroundColor) { parts.push(`${BACKGROUND_COLOR_PROPERTY}:${style.backgroundColor}`) }

  return parts.join(';')
}

export function colorSpanOpenTag(style: IColorStyle): string {
  return `<span style="${serializeColorStyle(style)}">`
}

/**
 * Re-colours `[start, end)` of `text`: replaces, toggles or clears one colour
 * declaration, merging both declarations into one span and keeping the other
 * declaration where only part of a span is re-coloured. Returns the new text
 * and where the selected text now sits, or `undefined` for an empty range.
 */
export function recolorText(
  text: string,
  start: number,
  end: number,
  colorSpans: readonly IColorSpan[],
  type: ColorFormatType,
  requested: string | null
): { text: string, start: number, end: number } | undefined {
  if (start === end) { return undefined }
  const property = colorPropertyOf(type)
  // Spans the range does not touch keep their spelling.
  const spans = colorSpans
    .filter(span => span.closeEnd > start && span.openStart < end)
    .sort((a, b) => a.openStart - b.openStart)

  const representative = spans
    .filter(s => s.contentStart <= start && s.contentEnd >= end)
    .sort((a, b) => a.contentEnd - a.contentStart - (b.contentEnd - b.contentStart))[0]
  const currentValue = property === COLOR_PROPERTY
    ? representative?.style.color ?? null
    : representative?.style.backgroundColor ?? null

  const value = requested !== null && requested === currentValue ? null : requested

  const targetStyle: IColorStyle = { color: null, backgroundColor: null }
  if (value !== null) {
    if (property === COLOR_PROPERTY) { targetStyle.color = value } else { targetStyle.backgroundColor = value }
  }

  const mergeStyle = (base: IColorStyle): IColorStyle => {
    const style: IColorStyle = { color: null, backgroundColor: null }
    if (property === COLOR_PROPERTY) { style.backgroundColor = base.backgroundColor } else { style.color = base.color }
    if (value !== null) {
      if (property === COLOR_PROPERTY) { style.color = value } else { style.backgroundColor = value }
    }
    return style
  }

  let output = ''
  let newStart = start
  let newEnd = end
  let placedStart = false

  const emit = (a: number, b: number, style: IColorStyle) => {
    if (a >= b) { return }
    // Chunks are emitted in source order and align with the selection edges,
    // so mapping start/end by "which chunks the selection covers" stays
    // correct even when an edge lands on a span's tag boundary.
    const inSelection = b > start && a < end
    const tag = isColorStyleEmpty(style) ? '' : colorSpanOpenTag(style)
    if (tag) { output += tag }
    if (inSelection && !placedStart) {
      newStart = output.length
      placedStart = true
    }
    output += text.slice(a, b)
    if (inSelection) { newEnd = output.length }
    if (tag) { output += COLOR_SPAN_CLOSE_TAG }
  }

  const empty: IColorStyle = { color: null, backgroundColor: null }
  const emitGap = (a: number, b: number) => {
    if (a >= b) { return }
    if (b <= start || a >= end) {
      emit(a, b, empty)
      return
    }
    if (a < start) { emit(a, start, empty) }
    emit(Math.max(a, start), Math.min(b, end), targetStyle)
    if (b > end) { emit(Math.min(b, end), b, empty) }
  }

  let pos = 0
  for (const span of spans) {
    if (span.openStart < pos) { continue }
    emitGap(pos, span.openStart)
    const leftEnd = Math.min(Math.max(start, span.contentStart), span.contentEnd)
    const midEnd = Math.min(Math.max(end, span.contentStart), span.contentEnd)
    emit(span.contentStart, leftEnd, span.style)
    emit(leftEnd, midEnd, mergeStyle(span.style))
    emit(midEnd, span.contentEnd, span.style)
    pos = span.closeEnd
  }
  emitGap(pos, text.length)

  return { text: output, start: newStart, end: newEnd }
}
