import { containerContinuationPrefix } from './clipboardMarkdown.js'
import type { DocumentCore, DocumentRevision, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import type { DocumentInputAction, DocumentSourceInputPlan } from './inputPlanning.js'
import { syntaxPathAt } from './syntaxPath.js'

/**
 * The source position of a setext heading's underline, after its line's
 * container prefix. Upstream MarkText's soft break at the heading's end adds an
 * empty last line to the heading's text without changing its bytes; a caret
 * here is on that line, which the underline follows.
 */
export function setextUnderlineStart(
  syntax: MarkupSyntax, heading: MarkdownAstNode, sourceText: (start: number, end: number) => string
): number | undefined {
  const content = heading.children.at(-1)
  if (heading.kind !== 'heading' || heading.attributes.style !== 'setext' || content === undefined) return undefined
  const start = syntax.coordinates.toSource(content.range.end, 'previous')
  const marker = sourceText(start, syntax.coordinates.toSource(heading.range.end, 'next'))
  const underline = /(?:\r\n|\r|\n)[^=-]*[=-]/u.exec(marker)
  return underline === null ? undefined : start + underline.index + underline[0].length - 1
}

/**
 * Deleting a setext heading's text leaves its `---` underline after a blank
 * line, where upstream keeps the empty heading and its caret. The underline
 * now parses as a thematic break; returns the end of the blank line before
 * it, within the break's own containers, which is that caret's position.
 */
export function setextUnderlineLeadingLine(
  syntax: MarkupSyntax, rule: MarkdownAstNode, sourceText: (start: number, end: number) => string
): number | undefined {
  if (rule.kind !== 'thematic-break') return undefined
  const start = syntax.coordinates.toSource(rule.range.start, 'next')
  const lineStart = readerLineStartBefore(sourceText, start)
  if (lineStart === 0) return undefined
  const end = syntax.coordinates.toSource(rule.range.end, 'previous')
  if (!/^[ \t>]*-+[ \t]*$/u.test(sourceText(lineStart, end))) return undefined
  const previousEnd = lineStart - (sourceText(lineStart - 2, lineStart) === '\r\n' ? 2 : 1)
  const previous = sourceText(readerLineStartBefore(sourceText, previousEnd), previousEnd)
  const prefix = sourceText(lineStart, start)
  return /^[ \t>]*$/u.test(previous) && previous.trimEnd() === prefix.trimEnd() ? previousEnd : undefined
}

/** The underline whose empty setext heading `position` is the caret of, if any. */
function setextUnderlineAtLeadingLine(
  syntax: MarkupSyntax, sourceText: (start: number, end: number) => string, position: number
): MarkdownAstNode | undefined {
  const ending = /^(?:\r\n|\r|\n)/u.exec(sourceText(position, position + 2))?.[0]
  if (ending === undefined) return undefined
  const next = position + ending.length
  const indent = /^[ \t>]*/u.exec(sourceText(next, next + 256))?.[0].length ?? 0
  const rule = syntaxPathAt(syntax.ast.root, syntax.coordinates.toProjected(next + indent, 'next')).at(-1)
  return rule !== undefined && setextUnderlineLeadingLine(syntax, rule, sourceText) === position ? rule : undefined
}

/**
 * Where the line holding `position` starts, read back through `sourceText`,
 * which may be a view that leaves hidden delimiters out.
 */
function readerLineStartBefore(sourceText: (start: number, end: number) => string, position: number): number {
  let end = position
  while (end > 0) {
    const start = Math.max(0, end - 256)
    const text = sourceText(start, end)
    if (text.length === end - start) {
      const found = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'))
      if (found >= 0) return start + found + 1
    } else {
      // A view's text leaves hidden delimiters out, so offsets into it are
      // not source offsets: read the span one unit at a time instead.
      for (let offset = end; offset > start; offset -= 1) {
        const unit = sourceText(offset - 1, offset)
        if (unit === '\n' || unit === '\r') return offset
      }
    }
    end = start
  }
  return 0
}

/**
 * Upstream turns an empty setext heading into an empty paragraph on Enter or
 * Backspace at its start, dropping the underline that the heading's deleted
 * text left. A following block stays separated from that paragraph.
 */
export function planEmptiedSetextReset(
  core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, caret: number
): DocumentSourceInputPlan | undefined {
  const sourceText = (start: number, end: number) =>
    core.sourceSlice(revision, { start: Math.max(0, start), end: Math.min(revision.sourceLength, Math.max(start, end)) })
  const rule = setextUnderlineAtLeadingLine(syntax, sourceText, caret)
  if (rule === undefined) return undefined
  const end = syntax.coordinates.toSource(rule.range.end, 'previous')
  let lineEnd = end
  while (/^[ \t]$/u.test(sourceText(lineEnd, lineEnd + 1))) lineEnd++
  const ending = /^(?:\r\n|\r|\n)/u.exec(sourceText(lineEnd, lineEnd + 2))?.[0] ?? ''
  const edits = [{ start: caret, end: lineEnd, insert: '' }]
  const following = lineEnd + ending.length
  const nextLine = sourceText(following, following + 256).split(/\r\n|\r|\n/u)[0] ?? ''
  if (ending !== '' && following < revision.sourceLength && !/^[ \t>]*$/u.test(nextLine)) {
    const prefix = sourceText(readerLineStartBefore(sourceText, caret), caret).trimEnd()
    edits.push({ start: following, end: following, insert: prefix + ending })
  }
  // The input is prevented, so the native domain is the current source.
  return Object.freeze({ edits: Object.freeze(edits), selection: Object.freeze({ start: caret, end: caret }), reconciliation: Object.freeze(edits.map(edit => ({ ...edit }))) })
}

const typed = new Set(['insertText', 'insertReplacementText', 'insertCompositionText'])

/**
 * Plans upstream's soft break at a setext heading's end and input on the empty
 * line it presents: typing writes that line before the underline, Backspace
 * removes it, and Enter breaks the heading as at its text's end.
 */
export function planSetextTrailingLine(
  core: DocumentCore, revision: DocumentRevision, action: DocumentInputAction<SourceRange>, syntax: MarkupSyntax
): DocumentSourceInputPlan | { readonly moveTo: SourceRange, readonly paragraph?: true } | undefined {
  if ('kind' in action || action.selection.start !== action.selection.end) return undefined
  const { inputType } = action
  if (inputType !== 'insertLineBreak' && inputType !== 'insertParagraph' && inputType !== 'deleteContentBackward' && !typed.has(inputType)) return undefined
  const caret = action.selection.start
  const path = syntaxPathAt(syntax.ast.root, syntax.coordinates.toProjected(caret, 'next'))
  const index = path.findIndex(node => node.kind === 'heading' && node.attributes.style === 'setext')
  const heading = path[index]
  if (heading === undefined) return undefined
  const sourceText = (start: number, end: number) => core.sourceSlice(revision, { start, end })
  const underline = setextUnderlineStart(syntax, heading, sourceText)
  const content = heading.children.at(-1)
  if (underline === undefined || content === undefined) return undefined
  const contentEnd = syntax.coordinates.toSource(content.range.end, 'previous')
  const plan = (edits: DocumentSourceInputPlan['edits'], at: number): DocumentSourceInputPlan =>
    Object.freeze({ edits: Object.freeze(edits), selection: Object.freeze({ start: at, end: at }), reconciliation: Object.freeze([]) })
  if (caret === contentEnd) return inputType === 'insertLineBreak' ? plan([], underline) : undefined
  if (caret !== underline) return undefined
  switch (inputType) {
    // A second soft break would leave the empty line; it ends the heading as
    // Enter does instead (#5300).
    case 'insertLineBreak': return { moveTo: { start: contentEnd, end: contentEnd }, paragraph: true }
    case 'deleteContentBackward': return plan([], contentEnd)
    case 'insertParagraph': return { moveTo: { start: contentEnd, end: contentEnd } }
  }
  const data = action.data ?? ''
  const lineEnding = sourceText(contentEnd, underline).match(/\r\n|\r|\n/u)?.[0] ?? '\n'
  const insert = data + lineEnding + containerContinuationPrefix(core, revision, syntax, heading, path.slice(0, index))
  const raw = action.range.start === caret && action.range.end === caret
  if (!raw) return undefined
  return Object.freeze({
    edits: Object.freeze([Object.freeze({ start: caret, end: caret, insert })]),
    selection: Object.freeze({ start: caret + data.length, end: caret + data.length }),
    reconciliation: Object.freeze([Object.freeze({ start: caret, end: caret + data.length, insert })])
  })
}
