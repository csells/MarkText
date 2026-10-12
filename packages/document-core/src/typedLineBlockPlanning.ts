import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import { annotationsAround } from './internal/annotationsAround.js'
import { isAnnotationDelimiter } from './annotationDelimiter.js'
import { commonAffixes } from './textAffixes.js'
import { containerContinuationPrefix } from './clipboardMarkdown.js'
import { INLINE_UPDATE_REG, inlineUpdateLayout } from './inputPolicy.js'
import { syntaxPathAt } from './syntaxPath.js'
import { lineEndAt, lineStartAt } from './sourceLines.js'

interface ParagraphLine {
  /** Source start of the line, before any container prefix. */
  readonly start: number
  /** Source start of the line's paragraph text, before any annotation opener. */
  readonly content: number
  readonly projectedContent: number
}

function paragraphLines(syntax: MarkupSyntax, paragraph: MarkdownAstNode): ParagraphLine[] | undefined {
  const nodes: MarkdownAstNode[] = []
  const visit = (node: MarkdownAstNode): void => {
    for (const child of node.children) {
      nodes.push(child)
      visit(child)
    }
  }
  visit(paragraph)
  const first = syntax.coordinates.toSource(paragraph.range.start, 'previous')
  const lines: ParagraphLine[] = [{ start: first, content: first, projectedContent: paragraph.range.start }]
  for (const [index, node] of nodes.entries()) {
    if (node.kind !== 'soft-break' && node.kind !== 'hard-break') continue
    // Breaks are leaves, so the next node in document order begins the line's text.
    const text = nodes[index + 1]
    if (text === undefined) return undefined
    const start = syntax.coordinates.toSource(node.range.end, 'previous')
    const content = syntax.coordinates.toSource(text.range.start, 'previous')
    if (content < start) return undefined
    lines.push({ start, content, projectedContent: text.range.start })
  }
  return lines
}

/**
 * Upstream converts a paragraph whose text starts with four spaces into an
 * indented code block. Its text omits the container prefix and the single
 * space separating a quote or list marker from the paragraph. When a space
 * typed on the paragraph's first line completes that indentation, returns the
 * code block's line prefix and the end of the line's leading spaces, where
 * upstream leaves the caret.
 */
function indentedCodeLine(
  core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, paragraph: MarkdownAstNode,
  containers: readonly MarkdownAstNode[], caret: number, data: string | null, second: ParagraphLine | undefined
): { readonly prefix: string, readonly at: number } | undefined {
  if (data !== ' ' || second === undefined) return undefined
  const lineStart = lineStartAt(core, revision, caret)
  const line = core.sourceSlice(revision, { start: lineStart, end: second.start })
  let runStart = caret - lineStart
  while (line[runStart - 1] === ' ') runStart--
  let runEnd = caret - lineStart
  while (line[runEnd] === ' ') runEnd++
  const inner = containers.filter(node => node.kind === 'blockquote' || node.kind === 'list-item').at(-1)
  let separator = 0
  let prefix = ''
  if (runStart > 0) {
    // The quote or list marker is followed by one separating space.
    if (inner === undefined || !/[>*+\-.)]/u.test(line[runStart - 1] ?? '')) return undefined
    separator = 1
    prefix = containerContinuationPrefix(core, revision, syntax, paragraph, containers).slice(0, runStart)
  } else if (inner !== undefined) {
    // A later paragraph of a list item is indented to the item's content.
    if (inner.kind !== 'list-item') return undefined
    const content = inner.children[0]
    if (content === undefined) return undefined
    const start = syntax.coordinates.toSource(content.range.start, 'previous')
    const before = core.sourceSlice(revision, { start: 0, end: start })
    separator = start - (Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r')) + 1)
  }
  if (runEnd - runStart + 1 - separator !== 4 || /^[ \t]*$/u.test(line.slice(runEnd))) return undefined
  return { prefix: prefix + ' '.repeat(separator), at: lineStart + runEnd }
}

/**
 * Upstream converts a paragraph whose first line a typed space indents by four
 * into an indented code block and serializes it afresh: following lines already
 * indented as code join it and a blank line separates the first that is not.
 * Returns the other source edits and where the typed key lands, or nothing.
 */
export function planTypedIndentedCode(
  core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, paragraph: MarkdownAstNode, caret: number, data: string | null
): { readonly edits: readonly DocumentSourceEdit[], readonly at: number } | undefined {
  const lines = paragraphLines(syntax, paragraph)
  if (lines === undefined) return undefined
  const path = syntaxPathAt(syntax.ast.root, paragraph.range.start)
  const depth = path.indexOf(paragraph)
  if (depth < 0) return undefined
  const containers = path.slice(0, depth)
  const first = lines[0]
  if (first === undefined || caret < first.start || caret > (lines[1]?.start ?? caret)) return undefined
  const code = indentedCodeLine(core, revision, syntax, paragraph, containers, caret, data, lines[1])
  if (code === undefined) return undefined
  const continuation = code.prefix
  const lineEnding = (core.sourceSlice(revision, { start: 0, end: caret }).match(/\r\n|\r|\n/u) ??
    core.sourceSlice(revision, { start: caret, end: revision.sourceLength }).match(/\r\n|\r|\n/u))?.[0] ?? '\n'
  const following = lines.slice(1)
  const text = following.find((next, position) => {
    const end = following[position + 1]?.start ?? syntax.coordinates.toSource(paragraph.range.end, 'next')
    const head = core.sourceSlice(revision, { start: next.start, end })
    return !head.startsWith(continuation) || !/^ {4}/u.test(head.slice(continuation.length))
  })
  if (text === undefined) return { edits: [], at: code.at }
  const prefix = core.sourceSlice(revision, { start: text.start, end: text.content })
  const blankLine = continuation.trimEnd() + lineEnding
  if (prefix === continuation) return { edits: [{ start: text.start, end: text.start, insert: blankLine }], at: code.at }
  if (!/^[ \t>]*$/u.test(prefix)) return undefined
  return { edits: [{ start: text.start, end: text.content, insert: blankLine + continuation }], at: code.at }
}

const inlineUpdateContainers = new Set(['document', 'blockquote', 'list', 'list-item'])

/** Line starts and ends of source text, with the break after each line. */
function splitLines(text: string): Array<{ readonly start: number, readonly end: number, readonly separator: string }> {
  const lines: Array<{ start: number, end: number, separator: string }> = []
  let start = 0
  for (const match of text.matchAll(/\r\n|\r|\n/gu)) {
    lines.push({ start, end: match.index, separator: match[0] })
    start = match.index + match[0].length
  }
  lines.push({ start, end: text.length, separator: '' })
  return lines
}

function sourceLineOf(syntax: MarkupSyntax, node: MarkdownAstNode): SourceRange {
  const start = syntax.coordinates.toSource(node.range.start, 'previous')
  return { start, end: Math.max(start, syntax.coordinates.toSource(node.range.end, 'next')) }
}

/** Narrows an edit to the text it changes. */
function narrowed(edit: DocumentSourceEdit, current: string): DocumentSourceEdit | undefined {
  if (current === edit.insert) return undefined
  const { prefix: head, suffix: tail } = commonAffixes(current, edit.insert)
  return { start: edit.start + head, end: edit.end - tail, insert: edit.insert.slice(head, edit.insert.length - tail) }
}

export interface InlineUpdatePlan {
  /** Conversion edits, in the source that results from the input's edits. */
  readonly edits: readonly DocumentSourceEdit[]
  readonly selection: SourceRange
  /** Reads the input's result, where the conversion edits apply. */
  readonly result: (start: number, end: number) => string
}

/**
 * Upstream re-evaluates a paragraph's block type from its whole text after
 * every input (`checkInlineUpdate`): a line that reads as a list item, heading,
 * quote, thematic break or setext underline splits the paragraph into that
 * block, written afresh, and the caret moves as upstream places it. The text
 * is the paragraph's lines without container prefixes. As in block parsing,
 * annotation delimiters and comments are not part of it; a conversion keeps
 * them in place. Plans that conversion after the input's `edits`, which leave
 * `selection`.
 */
export function planInlineUpdate(
  core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, paragraph: MarkdownAstNode,
  edits: readonly DocumentSourceEdit[], selection: SourceRange
): InlineUpdatePlan | undefined {
  // An ATX heading's text includes its marker. Of its conversions only a
  // quote changes its bytes; the others reparse to the same source.
  const heading = paragraph.kind === 'heading'
  if (heading && !/^ {0,3}#/u.test(core.sourceSlice(revision, sourceLineOf(syntax, paragraph)))) return undefined
  const path = syntaxPathAt(syntax.ast.root, paragraph.range.start)
  const depth = path.indexOf(paragraph)
  if (depth < 0) return undefined
  const containers = path.slice(0, depth)
  if (!containers.every(node => inlineUpdateContainers.has(node.kind))) return undefined
  const start = syntax.coordinates.toSource(paragraph.range.start, 'previous')
  const end = lineEndAt(core, revision, syntax.coordinates.toSource(paragraph.range.end, 'previous'))
  if (edits.some(edit => edit.start < start || edit.end > end)) return undefined
  const original = core.sourceSlice(revision, { start, end })
  let text = original
  // Every annotation delimiter includes a brace or, between arms, a tilde.
  const annotated = /[{}~]/u.test(original)
  // The paragraph and its line prefixes lie in the blocks around its start.
  const roots = annotated ? annotationsAround(core, revision, start) : []
  let hidden = Array.from({ length: original.length }, (_, index) =>
    annotated && isAnnotationDelimiter(roots, start + index, true))
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edit.start - start) + edit.insert + text.slice(edit.end - start)
    hidden = [...hidden.slice(0, edit.start - start), ...Array.from({ length: edit.insert.length }, () => false), ...hidden.slice(edit.end - start)]
  }
  const growth = text.length - original.length
  if (selection.start < start || selection.end > end + growth) return undefined
  const lines = splitLines(text)
  if (lines.some(line => hidden[line.end] === true)) return undefined
  // Annotation syntax on the first line's prefix is not the container's.
  const spelled = containers.length > 1 ? containerContinuationPrefix(core, revision, syntax, paragraph, containers) : ''
  const continuation = /[{}~]/u.test(spelled)
    ? spelled.split('').filter((_, index) => !isAnnotationDelimiter(annotationsAround(core, revision, start), start - spelled.length + index, true)).join('')
    : spelled
  // Each later line's prefix spells the continuation around any annotation syntax.
  const prefixes = lines.map((line, index) => {
    let at = line.start
    let matched = 0
    if (index > 0) {
      while (at < line.end && matched < continuation.length) {
        if (hidden[at]) at++
        else if (text[at] === continuation[matched]) {
          at++
          matched++
        } else break
      }
      while (at > line.start && hidden[at - 1]) at--
    }
    return at - line.start
  })
  // Source offsets of each line's text.
  const visible = lines.map((line, index) => {
    const units: number[] = []
    for (let at = line.start + prefixes[index]!; at < line.end; at++) if (!hidden[at]) units.push(at)
    return units
  })
  const texts = visible.map(units => units.map(at => text[at]).join(''))
  const offsets: number[] = []
  let offset = 0
  for (const value of texts) {
    offsets.push(offset)
    offset += value.length + 1
  }
  const textOffset = (position: number): number => {
    const at = position - start
    const index = Math.max(0, lines.findIndex(line => at <= line.end))
    return offsets[index]! + visible[index]!.filter(unit => unit < at).length
  }
  const joined = texts.join('\n')
  if (!INLINE_UPDATE_REG.test(joined)) return undefined
  const layout = inlineUpdateLayout(joined, textOffset(selection.start), textOffset(selection.end))
  if (layout === undefined || heading && layout.kind !== 'blockquote') return undefined
  let rows = layout.lines
  const item = containers.at(-1)
  const list = containers.at(-2)
  if (layout.kind === 'task-list') {
    // Upstream makes a task item only of a bullet item's first paragraph.
    if (item?.kind !== 'list-item' || item.children[0] !== paragraph || item.attributes.task === true ||
      list?.kind !== 'list' || list.attributes.ordered === true) return undefined
  }
  if (layout.kind === 'list' && layout.line > 0) {
    // A list follows a paragraph inside a tight list item without a blank line.
    const tight = [...containers].reverse().find(node => node.kind === 'list')?.attributes.tight === true
    if (tight) rows = rows.map((row, index) => index === layout.line ? { ...row, blankBefore: false } : row)
  }
  // ADR 0007 (owner decision 25 Sep, plan 0012 G24): typing converts the line
  // it converts, and other lines keep their bytes unless their meaning needs
  // a change. Upstream's continuation leads, trimming and blank separations are
  // spelling: lazy continuation keeps those lines where they were. A lazy line
  // straight after a new heading or thematic break would leave its container,
  // so it takes the container's prefix.
  const dropped = rows.map((row, index) => index === layout.line ? 0 : row.lead.length)
  rows = rows.map((row, index) => index === layout.line
    ? { ...row, blankBefore: row.blankBefore && separationRequired(layout.kind, texts[index]!) }
    : { cut: 0, lead: '', blankBefore: false })
  const endsParagraph = layout.kind === 'atx-heading' || layout.kind === 'setext-heading' || layout.kind === 'thematic-break'
  const conversion: DocumentSourceEdit[] = []
  let written = 0
  const placed = rows.map((row, index) => {
    const line = lines[index]!
    const changed = row.cut > 0 || row.lead !== '' || row.keep !== undefined || row.blankBefore ||
      endsParagraph && index === layout.line + 1
    const prefixEnd = line.start + prefixes[index]!
    const prefix = text.slice(line.start, prefixEnd)
    // A lazy or partial prefix is respelled when the line changes.
    const respell = index > 0 && changed && prefix !== continuation
    if (respell && hidden.slice(line.start, prefixEnd).some(Boolean)) return undefined
    const blank = row.blankBefore ? continuation.trimEnd() + (lines[index - 1]?.separator ?? '\n') : ''
    // Primitive changes to this line; annotation syntax is never inside one.
    const changes: DocumentSourceEdit[] = [respell
      ? { start: line.start, end: prefixEnd, insert: blank + continuation }
      : { start: line.start, end: line.start, insert: blank }]
    let insert = blank + (respell ? continuation : prefix)
    // Where the line's lead and each kept text unit are written.
    let lead = insert.length
    const units: number[] = []
    if (row.cut === 0) {
      changes.push({ start: prefixEnd, end: prefixEnd, insert: row.lead })
      insert += row.lead
    }
    let unit = 0
    for (let at = prefixEnd; at < line.end; at++) {
      if (hidden[at]) {
        insert += text[at]
        continue
      }
      const position = unit++
      if (position < row.cut) {
        if (position === 0) {
          lead = insert.length
          insert += row.lead
          changes.push({ start: at, end: at, insert: row.lead })
        }
        changes.push({ start: at, end: at + 1, insert: '' })
        continue
      }
      if (row.keep !== undefined && position >= row.keep) {
        changes.push({ start: at, end: at + 1, insert: '' })
        continue
      }
      units.push(insert.length)
      insert += text[at]
    }
    const merged: DocumentSourceEdit[] = []
    for (const change of changes) {
      const last = merged.at(-1)
      if (last !== undefined && change.start === last.end) merged[merged.length - 1] = { start: last.start, end: change.end, insert: last.insert + change.insert }
      else merged.push(change)
    }
    for (const change of merged) {
      const edit = narrowed({ ...change, start: start + change.start, end: start + change.end }, text.slice(change.start, change.end))
      if (edit !== undefined) conversion.push(edit)
    }
    const origin = start + written
    written += insert.length + line.separator.length
    return { origin, lead, units, leadLength: row.lead.length }
  })
  if (placed.some(line => line === undefined)) return undefined
  // A caret between text units stays beside the unit before it, outside
  // annotation syntax that follows.
  const position = (point: { readonly line: number, readonly offset: number }): number => {
    const line = placed[point.line]!
    if (point.offset <= line.leadLength) return line.origin + line.lead + point.offset
    const unit = line.units[Math.min(point.offset - line.leadLength, line.units.length) - 1]
    return line.origin + (unit === undefined ? line.lead + line.leadLength : unit + 1)
  }
  const kept = (point: { readonly line: number, readonly offset: number }) => ({ line: point.line, offset: Math.max(0, point.offset - dropped[point.line]!) })
  let caret = { start: position(kept(layout.selection.start)), end: position(kept(layout.selection.end)) }
  if (layout.kind === 'task-list' && item !== undefined && list !== undefined) {
    // Upstream moves the item into a task list of its own; its siblings and
    // later children are written apart as loose blocks.
    const outside = taskListSeparation(core, revision, syntax, list, item, continuation)
    if (outside === undefined) return undefined
    for (const edit of outside) {
      if (edit.start <= start) {
        conversion.unshift(edit)
        caret = { start: caret.start + edit.insert.length, end: caret.end + edit.insert.length }
      } else {
        conversion.push({ ...edit, start: edit.start + growth, end: edit.end + growth })
      }
    }
  }
  if (conversion.length === 0 && paragraph.kind !== 'thematic-break') {
    // The source already has the converted blocks, as upstream parsed it,
    // unless this input wrote the marker. A thematic break's text always
    // becomes the converted block.
    const marked = visible[layout.line]!
    const markerStart = start + lines[layout.line]!.start
    const markerEnd = start + (marked[layout.markerEnd - 1] ?? lines[layout.line]!.start) + 1
    let shift = 0
    const touched = [...edits].sort((a, b) => a.start - b.start).some(edit => {
      const from = edit.start + shift
      shift += edit.insert.length - (edit.end - edit.start)
      return from <= markerEnd && from + edit.insert.length >= markerStart
    })
    if (!touched) return undefined
  }
  return {
    edits: conversion,
    selection: caret,
    result: (from, to) => {
      const after = start + text.length
      const before = from < start ? core.sourceSlice(revision, { start: from, end: Math.min(to, start) }) : ''
      const inside = text.slice(Math.max(from, start) - start, Math.max(Math.min(to, after), start) - start)
      const following = to > after ? core.sourceSlice(revision, { start: Math.max(from, after) - growth, end: to - growth }) : ''
      return before + inside + following
    }
  }
}

/**
 * Whether a converted line needs a blank line to stand apart from the
 * paragraph text before it (CommonMark): a list item interrupts a paragraph
 * only when it has text and, if ordered, starts at 1.
 */
function separationRequired(kind: string, text: string): boolean {
  if (kind !== 'list' && kind !== 'task-list') return false
  const marker = /^ {0,3}(?:[-+*]|(\d{1,9})[.)])(?:[ \t]+|$)/u.exec(text)
  if (marker === null) return false
  return marker[1] !== undefined && Number(marker[1]) !== 1 || text.slice(marker[0].length).trim() === ''
}

function taskListSeparation(
  core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, list: MarkdownAstNode, item: MarkdownAstNode, continuation: string
): DocumentSourceEdit[] | undefined {
  const index = list.children.indexOf(item)
  if (index < 0) return undefined
  const edits: DocumentSourceEdit[] = []
  const lineEnding = (position: number): string => {
    const before = core.sourceSlice(revision, { start: Math.max(0, position - 2), end: position })
    return before.endsWith('\r\n') ? '\r\n' : before.endsWith('\r') ? '\r' : '\n'
  }
  const separate = (node: MarkdownAstNode, prefix: string): void => {
    const at = lineStartAt(core, revision, syntax.coordinates.toSource(node.range.start, 'next'))
    if (at === 0) return
    const previous = core.sourceSlice(revision, { start: lineStartAt(core, revision, at - 1), end: at })
    if (/^[ \t>]*[\r\n]*$/u.test(previous)) return
    edits.push({ start: at, end: at, insert: prefix.trimEnd() + lineEnding(at) })
  }
  const marker = (node: MarkdownAstNode): string => {
    const at = syntax.coordinates.toSource(node.range.start, 'next')
    return core.sourceSlice(revision, { start: lineStartAt(core, revision, at), end: at })
  }
  const siblings = list.children
  if (index > 0) separate(item, marker(item))
  // Later items stay in the original list when the task item led it, and
  // form a new loose list when it split the list; that list's items also
  // separate their own blocks.
  for (const [position, sibling] of siblings.entries()) {
    if (position === index + 1 || position > index + 1 && index > 0) separate(sibling, marker(sibling))
    if (position > index && index > 0) for (const child of sibling.children.slice(1)) separate(child, marker(child))
  }
  for (const child of item.children.slice(1)) separate(child, continuation)
  return edits.sort((a, b) => a.start - b.start)
}
