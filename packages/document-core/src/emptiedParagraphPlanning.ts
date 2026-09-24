import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax } from './documentCore.js'
import { containerContinuationPrefix } from './clipboardMarkdown.js'
import { syntaxPathAt } from './syntaxPath.js'

const blankLine = /^[ \t>]*$/u

function lineStartAt(core: DocumentCore, revision: DocumentRevision, position: number): number {
  for (let span = 256; ; span *= 4) {
    const start = Math.max(0, position - span)
    const text = core.sourceSlice(revision, { start, end: position })
    const found = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'))
    if (found >= 0) return start + found + 1
    if (start === 0) return 0
  }
}

function lineEndAt(core: DocumentCore, revision: DocumentRevision, position: number): number {
  for (let span = 256; ; span *= 4) {
    const end = Math.min(revision.sourceLength, position + span)
    const found = core.sourceSlice(revision, { start: position, end }).search(/[\r\n]/u)
    if (found >= 0) return position + found
    if (end === revision.sourceLength) return end
  }
}

/** The line ending that ends the line at `end`, if any. */
function endingAt(core: DocumentCore, revision: DocumentRevision, end: number): string {
  return core.sourceSlice(revision, { start: end, end: Math.min(revision.sourceLength, end + 2) }).match(/^(?:\r\n|\r|\n)/u)?.[0] ?? ''
}

/** Joins edits that meet at a boundary into one, preserving their order. */
export function mergeAdjacentEdits(edits: readonly DocumentSourceEdit[]): DocumentSourceEdit[] {
  const merged: DocumentSourceEdit[] = []
  for (const edit of edits) {
    const last = merged.at(-1)
    if (last !== undefined && last.end === edit.start) merged[merged.length - 1] = { start: last.start, end: edit.end, insert: last.insert + edit.insert }
    else merged.push({ ...edit })
  }
  return merged
}

/**
 * Upstream MarkText keeps a paragraph whose text is deleted as an empty
 * paragraph and writes it on a line of its own between blank separator lines,
 * the last one ending the document with a line ending. When deleting a
 * paragraph's whole text in `edits`, or a thematic break's rule, leaves its
 * line without that separation, returns the separator insertions that keep
 * the empty paragraph in the editing parse; the caret stays on that line.
 */
export function planEmptiedParagraph(
  core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, paragraph: MarkdownAstNode, edits: readonly DocumentSourceEdit[]
): readonly DocumentSourceEdit[] | undefined {
  const edit = edits.length === 1 ? edits[0] : undefined
  if (edit === undefined || edit.insert !== '' || !['paragraph', 'thematic-break'].includes(paragraph.kind) || paragraph.range.start === paragraph.range.end) return undefined
  const path = syntaxPathAt(syntax.ast.root, paragraph.range.start)
  const depth = path.indexOf(paragraph)
  if (depth < 0) return undefined
  const containers = path.slice(1, depth)
  if (!containers.every(node => node.kind === 'blockquote' || node.kind === 'list-item')) return undefined
  // A list item's first paragraph shares its marker line, which stays an empty item.
  const item = containers.at(-1)
  if (item?.kind === 'list-item' && item.children[0] === paragraph) return undefined
  const start = syntax.coordinates.toSource(paragraph.range.start, 'next')
  const end = syntax.coordinates.toSource(paragraph.range.end, 'previous')
  if (edit.start > start || edit.end < end) return undefined
  if (revision.annotations.some(annotation => annotation.range.start < end && annotation.range.end > start)) return undefined
  const lineStart = lineStartAt(core, revision, start)
  const lineEnd = lineEndAt(core, revision, end)
  if (edit.start < lineStart || edit.end > lineEnd) return undefined
  const remaining = core.sourceSlice(revision, { start: lineStart, end: edit.start }) + core.sourceSlice(revision, { start: edit.end, end: lineEnd })
  if (!blankLine.test(remaining)) return undefined
  const ending = endingAt(core, revision, lineEnd)
  const lineEnding = ending || (core.sourceSlice(revision, { start: 0, end: lineStart }).match(/\r\n|\r|\n/u)?.[0] ?? '\n')
  const separator = (containers.length === 0 ? '' : containerContinuationPrefix(core, revision, syntax, paragraph, containers).trimEnd()) + lineEnding
  // Blank lines before the paragraph, and whether only blank lines precede it.
  let before = 0
  let atStart = true
  for (let at = lineStart; at > 0;) {
    const previousEnd = at - endingBefore(core, revision, at).length
    const previousStart = lineStartAt(core, revision, previousEnd)
    if (!blankLine.test(core.sourceSlice(revision, { start: previousStart, end: previousEnd }))) {
      atStart = false
      break
    }
    before += 1
    at = previousStart
  }
  // Blank lines after the paragraph, and whether only blank lines follow it.
  let after = 0
  let atEnd = true
  // A line without an ending ends the document.
  for (let at = ending === '' ? revision.sourceLength : lineEnd + ending.length; at < revision.sourceLength;) {
    const nextEnd = lineEndAt(core, revision, at)
    if (!blankLine.test(core.sourceSlice(revision, { start: at, end: nextEnd }))) {
      atEnd = false
      break
    }
    after += 1
    const next = endingAt(core, revision, nextEnd)
    if (next === '') break
    at = nextEnd + next.length
  }
  // A quote's first paragraph shares the quote's opening line.
  const opening = containers.at(-1)?.kind === 'blockquote' && containers.at(-1)?.children[0] === paragraph
  if (atStart && (containers.length > 0 && !opening || atEnd)) return undefined
  const inserted: DocumentSourceEdit[] = []
  // A blank run holds empty paragraphs on alternate lines, after a separator
  // following a block, or from its first line at the document's start.
  if (!opening && before % 2 === (atStart ? 1 : 0)) inserted.push({ start: lineStart, end: lineStart, insert: separator })
  if (atEnd && ending === '') inserted.push({ start: lineEnd, end: lineEnd, insert: lineEnding })
  if (!atEnd && after === 0) inserted.push({ start: lineEnd + ending.length, end: lineEnd + ending.length, insert: separator })
  return inserted.length === 0 ? undefined : inserted
}

function endingBefore(core: DocumentCore, revision: DocumentRevision, position: number): string {
  return core.sourceSlice(revision, { start: Math.max(0, position - 2), end: position }).match(/(?:\r\n|\r|\n)$/u)?.[0] ?? ''
}

const thematicBreakText = /^[ \t]*(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/u
const blankContainerLine = /^[ \t>]*$/u

/**
 * Upstream edits a thematic break's text as a paragraph and writes every block
 * apart from its neighbours. When `edits`, all on the rule's line, leave text
 * that no longer reads as a rule, returns the blank separator lines that keep
 * it apart from sibling blocks written on the lines beside it. Positions are in
 * the source after `edits`; `read` reads that source.
 */
export function planDemotedRuleSeparation(
  core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, rule: MarkdownAstNode,
  edits: readonly DocumentSourceEdit[], read: (start: number, end: number) => string
): DocumentSourceEdit[] {
  if (edits.length === 0) return []
  const path = syntaxPathAt(syntax.ast.root, rule.range.start)
  const depth = path.indexOf(rule)
  const parent = path[depth - 1]
  if (parent === undefined) return []
  const ruleStart = syntax.coordinates.toSource(rule.range.start, 'next')
  const lineStart = lineStartAt(core, revision, ruleStart)
  const lineEnd = lineEndAt(core, revision, ruleStart)
  if (edits.some(edit => edit.start < lineStart || edit.end > lineEnd)) return []
  const growth = edits.reduce((sum, edit) => sum + edit.insert.length - (edit.end - edit.start), 0)
  const text = edits.some(edit => edit.start < ruleStart) ? undefined : read(ruleStart, lineEnd + growth)
  if (text !== undefined && (thematicBreakText.test(text) || /^[ \t]*$/u.test(text))) return []
  const ending = endingAt(core, revision, lineEnd)
  const lineEnding = ending || (core.sourceSlice(revision, { start: 0, end: lineStart }).match(/\r\n|\r|\n/u)?.[0] ?? '\n')
  const separator = containerContinuationPrefix(core, revision, syntax, rule, path.slice(1, depth)).trimEnd() + lineEnding
  const index = parent.children.indexOf(rule)
  const separators: DocumentSourceEdit[] = []
  if (index > 0 && lineStart > 0) {
    const previousEnd = lineStart - endingBefore(core, revision, lineStart).length
    if (!blankContainerLine.test(core.sourceSlice(revision, { start: lineStartAt(core, revision, previousEnd), end: previousEnd }))) {
      separators.push({ start: lineStart, end: lineStart, insert: separator })
    }
  }
  const nextStart = lineEnd + ending.length
  if (index < parent.children.length - 1 && ending !== '' &&
    !blankContainerLine.test(core.sourceSlice(revision, { start: nextStart, end: lineEndAt(core, revision, nextStart) }))) {
    separators.push({ start: nextStart + growth, end: nextStart + growth, insert: separator })
  }
  return separators
}

/** Reads the source that results from applying `edits` to `revision`. */
export function editedSourceReader(core: DocumentCore, revision: DocumentRevision, edits: readonly DocumentSourceEdit[]): (start: number, end: number) => string {
  const sorted = [...edits].sort((a, b) => a.start - b.start)
  return (from, to) => {
    let out = ''
    let original = 0
    let written = 0
    const keep = (end: number): void => {
      const start = Math.max(from, written)
      const stop = Math.min(to, written + end - original)
      if (start < stop) out += core.sourceSlice(revision, { start: original + start - written, end: original + stop - written })
      written += end - original
      original = end
    }
    for (const edit of sorted) {
      keep(edit.start)
      const start = Math.max(from, written)
      const stop = Math.min(to, written + edit.insert.length)
      if (start < stop) out += edit.insert.slice(start - written, stop - written)
      written += edit.insert.length
      original = edit.end
    }
    keep(revision.sourceLength)
    return out
  }
}
