/**
 * Upstream MarkText re-evaluates a text block's type from its whole text after
 * every input: a line that reads as a list item, heading, quote, thematic break
 * or setext underline splits the paragraph into that block. These patterns and
 * their order are upstream's (8d6c198c `block/base/format.ts`); the first
 * alternative matching at the leftmost position decides the conversion.
 */
export const INLINE_UPDATE_FRAGMENTS = [
  '(?:^|\n) {0,3}([*+-] {1,4})', // Bullet list
  '^(\\[[x ]\\] {1,4})', // Task list **match from beginning**
  '(?:^|\n) {0,3}(\\d{1,9}(?:\\.|\\)) {1,4})', // Order list
  '(?:^|\n) {0,3}(#{1,6})(?=\\s+|$)', // ATX headings
  '^[\\s\\S]+?\\n {0,3}(={3,}|-{3,})(?= +|$)', // Setext headings **match from beginning**
  '(?:^|\n) {0,3}(>).+', // Block quote
  '^( {4,})', // Indent code **match from beginning**
  // '^(\\[\\^[^\\^\\[\\]\\s]+?(?<!\\\\)\\]: )', // Footnote **match from beginning**
  '(?:^|\n) {0,3}((?:\\* *\\* *\\*|- *- *-|_ *_ *_)[ *_-]*)(?=\n|$)' // Thematic break
] as const

export const INLINE_UPDATE_REG = new RegExp(INLINE_UPDATE_FRAGMENTS.join('|'), 'i')

/** The line patterns each conversion splits its block's lines by. */
export const INLINE_UPDATE_LIST_REG = /^([\s\S]*\n)? {0,3}([*+-]|\d{1,9}(?:\.|\))) {1,4}([\s\S]*)$/
export const INLINE_UPDATE_TASK_REG = /^\[([x ])\] {1,4}([\s\S]*)$/i
export const INLINE_UPDATE_ATX_LINE_REG = /^ {0,3}#{1,6}(?=\s+|$)/
export const INLINE_UPDATE_SETEXT_LINE_REG = /^ {0,3}(?:={3,}|-{3,})(?= +|$)/
export const INLINE_UPDATE_QUOTE_LINE_REG = /^ {0,3}>/
export const INLINE_UPDATE_QUOTE_MARKER_REG = /( *> *)(.*)/
// Unanchored, as upstream's own line test is.
export const INLINE_UPDATE_THEMATIC_LINE_REG = / {0,3}(?:\* *\* *\*|- *- *-|_ *_ *_)[ *\-_]*$/

export type InlineUpdateMatch =
  | { readonly kind: 'thematic-break' | 'list' | 'task-list' | 'blockquote' | 'indented-code' | 'paragraph' }
  | { readonly kind: 'atx-heading', readonly marker: string }
  | { readonly kind: 'setext-heading', readonly underline: string }

/** The block upstream converts a text block with this text into. */
export function matchInlineUpdate(text: string): InlineUpdateMatch {
  const [, bulletList, taskList, orderList, atxHeading, setextHeading, blockquote, indentedCode, thematicBreak] =
    text.match(INLINE_UPDATE_REG) ?? []
  if (thematicBreak && new Set(thematicBreak.split('').filter(char => /\S/.test(char))).size === 1) return { kind: 'thematic-break' }
  if (bulletList || orderList) return { kind: 'list' }
  if (taskList) return { kind: 'task-list' }
  if (atxHeading) return { kind: 'atx-heading', marker: atxHeading }
  if (setextHeading) return { kind: 'setext-heading', underline: setextHeading }
  if (blockquote) return { kind: 'blockquote' }
  if (indentedCode) return { kind: 'indented-code' }
  // No match, or a thematic run that mixes its characters.
  return { kind: 'paragraph' }
}

/**
 * How one line of a converted paragraph is written afresh: `cut` characters
 * of its text become `lead`, and text from `keep` on is dropped. A line with
 * `blankBefore` starts a new block after a blank line.
 */
export interface InlineUpdateLine {
  readonly cut: number
  readonly lead: string
  readonly keep?: number
  readonly blankBefore: boolean
}

export interface InlineUpdateLayout {
  readonly kind: 'thematic-break' | 'list' | 'task-list' | 'atx-heading' | 'setext-heading' | 'blockquote'
  /** The line whose marker triggers the conversion. */
  readonly line: number
  /** End of that marker in the line's text. */
  readonly markerEnd: number
  /** The list line's content also began a task item. */
  readonly task?: boolean
  readonly lines: readonly InlineUpdateLine[]
  /** Caret line and offset within the line's written text. */
  readonly selection: { readonly start: InlineUpdatePoint, readonly end: InlineUpdatePoint }
}

export interface InlineUpdatePoint { readonly line: number, readonly offset: number }

const unchanged: InlineUpdateLine = { cut: 0, lead: '', blankBefore: false }

/**
 * Upstream's conversion of a paragraph with `text` (lines joined by `\n`) and
 * the caret `start`/`end` offsets in that text, as line rewrites. Indented
 * code and unmatched text are left to the caller.
 */
export function inlineUpdateLayout(text: string, start: number, end: number): InlineUpdateLayout | undefined {
  const match = matchInlineUpdate(text)
  const lines = text.split('\n')
  const layout = lines.map((): InlineUpdateLine => unchanged)
  const lengthBefore = (line: number) => lines.slice(0, line).reduce((sum, value) => sum + value.length + 1, 0)
  const point = (line: number, offset: number): InlineUpdatePoint => ({ line, offset })
  const shifted = (line: number, offset: number, cut: number) => {
    const at = Math.min(Math.max(0, offset - lengthBefore(line)), lines[line]!.length)
    return point(line, Math.max(0, at - cut))
  }
  const separate = (line: number) => {
    if (line > 0) layout[line] = { ...layout[line]!, blankBefore: true }
    if (line + 1 < lines.length) layout[line + 1] = { ...layout[line + 1]!, blankBefore: true }
  }
  switch (match.kind) {
    case 'list': {
      const found = INLINE_UPDATE_LIST_REG.exec(text)
      if (found === null) return undefined
      const [, pre, marker] = found as unknown as [string, string | undefined, string, string]
      const line = pre === undefined ? 0 : pre.split('\n').length - 1
      if (pre !== undefined) {
        // Upstream trims the text that stays paragraph.
        const leading = pre.length - pre.trimStart().length
        let consumed = 0
        for (let index = 0; index < line; index++) {
          const length = lines[index]!.length
          const cut = Math.min(length, Math.max(0, leading - consumed))
          consumed += length + 1
          const keep = index === line - 1 ? Math.max(cut, lines[index]!.trimEnd().length) : undefined
          layout[index] = { ...layout[index]!, cut, ...(keep === undefined || keep === length ? {} : { keep }) }
        }
      }
      const current = lines[line]!
      let cut = /^ {0,3}(?:[*+-]|\d{1,9}[.)]) {1,4}/.exec(current)![0].length
      let lead = `${marker} `
      const task = /^[*+-]$/.test(marker) ? INLINE_UPDATE_TASK_REG.exec(current.slice(cut)) : null
      if (task !== null) {
        cut += task[0].length - task[2]!.length
        lead += `[${task[1] === ' ' ? ' ' : 'x'}] `
      }
      layout[line] = { cut, lead, blankBefore: line > 0 }
      for (let index = line + 1; index < lines.length; index++) layout[index] = { cut: 0, lead: ' '.repeat(marker.length + 1), blankBefore: false }
      const caret = point(line, lead.length)
      return { kind: 'list', line, markerEnd: cut, ...(task === null ? {} : { task: true }), lines: layout, selection: { start: caret, end: caret } }
    }
    case 'task-list': {
      const found = INLINE_UPDATE_TASK_REG.exec(text)!
      layout[0] = { cut: found[0].length - found[2]!.length, lead: `[${found[1] === ' ' ? ' ' : 'x'}] `, blankBefore: false }
      const caret = point(0, 4)
      return { kind: 'task-list', line: 0, markerEnd: found[0].length - found[2]!.length, lines: layout, selection: { start: caret, end: caret } }
    }
    case 'atx-heading': {
      const line = lines.findIndex(value => INLINE_UPDATE_ATX_LINE_REG.test(value))
      if (line < 0) return undefined
      const indent = lines[line]!.length - lines[line]!.trimStart().length
      layout[line] = { cut: indent, lead: '', blankBefore: false }
      separate(line)
      return {
        kind: 'atx-heading',
        line,
        markerEnd: INLINE_UPDATE_ATX_LINE_REG.exec(lines[line]!)![0].length,
        lines: layout,
        selection: { start: shifted(line, start, indent), end: shifted(line, end, indent) }
      }
    }
    case 'setext-heading': {
      const line = lines.findIndex(value => INLINE_UPDATE_SETEXT_LINE_REG.test(value))
      // Upstream writes an empty heading for an underline on the first line.
      if (line < 1) return undefined
      layout[line] = { cut: 0, keep: 0, lead: match.underline, blankBefore: false }
      if (line + 1 < lines.length) layout[line + 1] = { ...layout[line + 1]!, blankBefore: true }
      const caret = point(line - 1, lines[line - 1]!.length)
      return { kind: 'setext-heading', line, markerEnd: lines[line]!.length, lines: layout, selection: { start: caret, end: caret } }
    }
    case 'blockquote': {
      const line = lines.findIndex(value => INLINE_UPDATE_QUOTE_LINE_REG.test(value))
      if (line < 0) return undefined
      const delta = INLINE_UPDATE_QUOTE_MARKER_REG.exec(lines[line]!)![1]!.length
      layout[line] = { cut: delta, lead: '> ', blankBefore: line > 0 }
      for (let index = line + 1; index < lines.length; index++) layout[index] = { cut: 0, lead: '> ', blankBefore: false }
      // The caret keeps its place in the typed line, less the marker. Upstream
      // measures from the paragraph's start instead, which moves a later
      // line's caret into the quoted text; that slip is not kept.
      const quoted = [lines[line]!.slice(delta), ...lines.slice(line + 1)]
      const inQuote = (offset: number): InlineUpdatePoint => {
        let rest = Math.min(Math.max(0, offset - lengthBefore(line) - delta), quoted.join('\n').length)
        for (const [index, value] of quoted.entries()) {
          if (rest <= value.length) return point(line + index, 2 + rest)
          rest -= value.length + 1
        }
        return point(lines.length - 1, 2 + quoted[quoted.length - 1]!.length)
      }
      return { kind: 'blockquote', line, markerEnd: delta, lines: layout, selection: { start: inQuote(start), end: inQuote(end) } }
    }
    case 'thematic-break': {
      const line = lines.findIndex(value => INLINE_UPDATE_THEMATIC_LINE_REG.test(value))
      if (line < 0) return undefined
      separate(line)
      return {
        kind: 'thematic-break',
        line,
        markerEnd: lines[line]!.length,
        lines: layout,
        selection: { start: shifted(line, start, 0), end: shifted(line, end, 0) }
      }
    }
    default:
      return undefined
  }
}
