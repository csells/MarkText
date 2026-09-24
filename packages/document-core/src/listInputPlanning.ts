import { listItemMarker, type ListChange, type ListKind, type ListMarkerOptions } from '@marktext/input-policy'
import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import type { MarkdownLineIndex } from './revision.js'
import { containerContinuationPrefix } from './clipboardMarkdown.js'
import { positionAfter } from './sourcePosition.js'
import { paragraphPrefixPosition } from './paragraphBoundary.js'
import { paragraphLeadingLine } from './paragraphJoinPlanning.js'

const kindOf = (list: MarkdownAstNode): ListKind => list.attributes.taskList === true ? 'task' : list.attributes.ordered === true ? 'ordered' : 'bullet'

/** List commands edit parser-owned markers and continuation trivia, never a reconstructed native tree. */
export function planListChange(core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, ancestors: readonly MarkdownAstNode[], lines: MarkdownLineIndex, selection: SourceRange, change: ListChange, options: ListMarkerOptions): { edits: DocumentSourceEdit[], selection: SourceRange } {
  if (!['-', '*', '+'].includes(options.bulletListMarker) || !['.', ')'].includes(options.orderListDelimiter) ||
      (options.preferLooseListItem !== undefined && typeof options.preferLooseListItem !== 'boolean')) throw new RangeError('Invalid list marker options')
  const lists = ancestors.filter(node => node.kind === 'list')
  const outermost = ancestors[1]?.kind === 'list' ? ancestors[1] : undefined
  let targets: readonly MarkdownAstNode[]
  let unwrap = false
  let boundaryItem: MarkdownAstNode | undefined
  let taskText = false
  if (change.type === 'backspace') {
    const list = lists.at(-1)
    const item = [...ancestors].reverse().find(node => node.kind === 'list-item')
    const paragraph = item?.children[0]
    // An ordered item's task marker without text is that item's text.
    const markerText = list?.attributes.ordered === true && paragraph?.range.start === paragraph?.range.end &&
      typeof item?.attributes.taskMarkerStart === 'number'
    const boundary = markerText
      ? Number(item.attributes.taskMarkerStart)
      : typeof item?.attributes.taskMarkerEnd === 'number' ? item.attributes.taskMarkerEnd + 1 : paragraph?.range.start
    // The marker line before an item's paragraph is that paragraph's leading line.
    const leading = paragraph === undefined || selection.start !== selection.end ? undefined : paragraphLeadingLine(core, revision, syntax, selection.start)
    const atLeadingLine = leading !== undefined && item !== undefined && leading.paragraph === paragraph &&
      leading.lineStart <= syntax.coordinates.toSource(item.range.start, 'next')
    if (list === undefined || item === undefined || !list.children.includes(item) || paragraph?.kind !== 'paragraph' ||
        selection.start !== selection.end || (syntax.coordinates.toProjected(selection.start, 'next') !== boundary &&
          syntax.coordinates.toProjected(selection.start, 'next') !== paragraph.range.start && !atLeadingLine)) {
      throw new RangeError('List boundary Backspace requires the start of its item')
    }
    targets = [list]
    boundaryItem = item
    taskText = markerText
    unwrap = true
  } else if (change.type === 'reset' || change.type === 'toggle-tight' || change.type === 'front') {
    targets = outermost === undefined ? [] : [outermost]
    unwrap = change.type === 'reset' || change.type === 'front' && outermost !== undefined && kindOf(outermost) === change.kind
  } else {
    targets = lists.filter(list => kindOf(list) === change.kind)
    unwrap = targets.length !== 0
    if (!unwrap) targets = lists.length === 0 ? [] : [lists.at(-1)!]
  }
  if (targets.length === 0) {
    if (change.type !== 'toggle' && change.type !== 'front') throw new RangeError('List command requires an existing list')
    return planListCreation(revision, syntax, ancestors, lines, selection, change.kind, options)
  }
  const edits: DocumentSourceEdit[] = []
  // A separator added after an item's content keeps an end-of-line caret on
  // that content; the blank line it creates has no rendered position.
  const trailingSeparators = new Set<DocumentSourceEdit>()
  const sourceAt = (offset: number) => syntax.coordinates.toSource(offset, 'next')
  const sourceEnd = (offset: number) => syntax.coordinates.toSource(offset, 'previous')
  const records = Array.from({ length: lines.count }, (_, index) => lines.at(index))
  const markers = new Map(records.flatMap(line => line.listMarkers).map(marker => [marker.start, marker]))
  const firstLineAt = (position: number): number => {
    let low = 0
    let high = records.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (records[middle]!.start < position) low = middle + 1
      else high = middle
    }
    return low
  }
  const linesBetween = (start: number, end: number) => records.slice(firstLineAt(start), firstLineAt(end))
  const ensureSeparator = (previous: MarkdownAstNode, next: MarkdownAstNode, containers: readonly MarkdownAstNode[]): void => {
    // A quoted marker line holding no content yet is the next block's own line.
    if (linesBetween(previous.range.end, next.range.start).some(line => line.blank && line.end <= next.range.start)) return
    const lineIndex = Math.max(0, firstLineAt(next.range.start + 1) - 1)
    const line = records[lineIndex]
    if (line === undefined) throw new RangeError('List boundary has no physical line')
    const endingLine = line.contentEnd < line.end ? line : records[Math.max(0, lineIndex - 1)]!
    const ending = core.sourceSlice(revision, { start: sourceAt(endingLine.contentEnd), end: sourceEnd(endingLine.end) })
    const prefix = containerContinuationPrefix(core, revision, syntax, next, containers).trimEnd()
    const at = sourceAt(line.start)
    edits.push({ start: at, end: at, insert: prefix + ending })
  }
  for (const list of targets) {
    const boundaryIndex = boundaryItem === undefined ? -1 : list.children.indexOf(boundaryItem)
    if (boundaryIndex === 0) {
      const parent = ancestors[ancestors.indexOf(list) - 1]
      const previous = parent?.children[parent.children.indexOf(list) - 1]
      if (previous?.kind === 'paragraph') ensureSeparator(previous, list, ancestors.slice(0, ancestors.indexOf(list)))
      const next = list.children[1]
      if (parent?.kind !== 'list-item' && next !== undefined && boundaryItem !== undefined) ensureSeparator(boundaryItem, next, ancestors.slice(0, ancestors.indexOf(list)))
      // An unwrapped empty paragraph stays a block of its own, as upstream
      // keeps it, apart from the item's next block.
      const [first, second] = boundaryItem?.children ?? []
      if (first?.kind === 'paragraph' && first.range.start === first.range.end && second !== undefined && boundaryItem !== undefined) {
        ensureSeparator(first, second, ancestors.slice(0, ancestors.indexOf(boundaryItem) + 1))
      }
    } else if (boundaryIndex > 0 && boundaryItem !== undefined) {
      ensureSeparator(list.children[boundaryIndex - 1]!, boundaryItem, ancestors.slice(0, ancestors.indexOf(boundaryItem)))
    }
    const items = boundaryItem === undefined ? list.children : [boundaryItem]
    const firstMarker = items[0] === undefined ? undefined : markers.get(items[0].range.start)
    if (firstMarker === undefined) throw new RangeError('List has no owned opening marker')
    for (const [index, item] of items.entries()) {
      const marker = markers.get(item.range.start)
      if (marker === undefined || marker.depth !== firstMarker.depth) throw new RangeError('List item has no owned opening marker')
      if (change.type !== 'toggle-tight') {
        const desired = 'kind' in change ? change.kind : kindOf(list)
        const bullet = change.type === 'front' && !marker.ordered ? String.fromCharCode(marker.delimiterCodeUnit) : options.bulletListMarker
        const spelling = listItemMarker({ bullet: desired === 'ordered' ? undefined : bullet, ordinal: desired === 'ordered' ? index + 1 : undefined, delimiter: options.orderListDelimiter, checked: desired === 'task' ? false : undefined })
        const taskEnd = item.attributes.taskMarkerEnd
        const contentStart = typeof taskEnd === 'number' && !taskText ? taskEnd + 1 : marker.contentOffset
        const previousMarker = boundaryIndex > 0 ? markers.get(list.children[boundaryIndex - 1]!.range.start) : undefined
        const mergedWidth = previousMarker === undefined ? 0 : previousMarker.contentOffset - previousMarker.start
        edits.push({ start: sourceAt(marker.start), end: sourceEnd(contentStart), insert: unwrap ? ' '.repeat(mergedWidth) : spelling.text })
        const oldWidth = marker.contentOffset - marker.start
        for (const line of linesBetween(item.range.start + 1, item.range.end)) {
          for (const indentation of line.listIndentations) {
            if (indentation.depth !== marker.depth) continue
            const width = unwrap ? boundaryIndex > 0 ? Math.max(0, indentation.columns + mergedWidth - oldWidth) : 0 : Math.max(0, indentation.columns + spelling.indentation - oldWidth)
            if (width !== indentation.columns) edits.push({ start: sourceAt(indentation.start), end: sourceEnd(indentation.end), insert: ' '.repeat(width) })
          }
        }
      }
      const next = items[index + 1]
      if (next === undefined || !unwrap && change.type !== 'toggle-tight') continue
      const blankLines = linesBetween(item.range.end, next.range.start).filter(line => line.end <= next.range.start && line.blank)
      const loose = unwrap || list.attributes.tight === true
      if (loose && blankLines.length === 0) {
        const endingLine = records[Math.max(0, firstLineAt(item.range.end + 1) - 1)]
        if (endingLine === undefined) throw new RangeError('List item has no line ending')
        const ending = core.sourceSlice(revision, { start: sourceAt(endingLine.contentEnd), end: sourceEnd(endingLine.end) })
        const at = sourceAt(item.range.end)
        const separator = { start: at, end: at, insert: ending }
        trailingSeparators.add(separator)
        edits.push(separator)
      } else if (!loose) {
        for (const line of blankLines) edits.push({ start: sourceAt(line.start), end: sourceEnd(line.end), insert: '' })
      }
    }
    if (boundaryIndex >= 0 && list.attributes.ordered === true) {
      const start = typeof list.attributes.start === 'number' ? list.attributes.start : 1
      for (let index = boundaryIndex + 1; index < list.children.length; index++) {
        const item = list.children[index]!
        const marker = markers.get(item.range.start)
        if (marker === undefined) throw new RangeError('Ordered list item has no owned marker')
        const spelling = listItemMarker({ ordinal: start + index - 1, delimiter: String.fromCharCode(marker.delimiterCodeUnit) })
        const range = { start: sourceAt(marker.start), end: sourceEnd(marker.contentOffset) }
        if (core.sourceSlice(revision, range) !== spelling.text) edits.push({ ...range, insert: spelling.text })
        const difference = spelling.indentation - (marker.contentOffset - marker.start)
        if (difference === 0) continue
        for (const line of linesBetween(item.range.start + 1, item.range.end)) {
          for (const indentation of line.listIndentations) {
            if (indentation.depth !== marker.depth) continue
            edits.push({ start: sourceAt(indentation.start), end: sourceEnd(indentation.end), insert: ' '.repeat(Math.max(0, indentation.columns + difference)) })
          }
        }
      }
    }
  }
  edits.sort((left, right) => left.start - right.start || left.end - right.end)
  const afterInsertion = (edit: DocumentSourceEdit) => !trailingSeparators.has(edit)
  return { edits, selection: { start: positionAfter(edits, selection.start, afterInsertion), end: positionAfter(edits, selection.end, afterInsertion) } }
}

/**
 * Wrap the selected sibling blocks of the caret's container as list items.
 * Each block receives a parser-owned marker, placed before any annotation
 * that owns the paragraph's exterior; continuation lines are indented past
 * the marker, as upstream MarkText writes them.
 */
function planListCreation(revision: DocumentRevision, syntax: MarkupSyntax, ancestors: readonly MarkdownAstNode[], lines: MarkdownLineIndex, selection: SourceRange, kind: ListKind, options: ListMarkerOptions): { edits: DocumentSourceEdit[], selection: SourceRange } {
  const sourceAt = (offset: number) => syntax.coordinates.toSource(offset, 'next')
  const sourceEnd = (offset: number) => syntax.coordinates.toSource(offset, 'previous')
  const spellingAt = (index: number) => listItemMarker({
    bullet: kind === 'ordered' ? undefined : options.bulletListMarker,
    ordinal: kind === 'ordered' ? index + 1 : undefined,
    delimiter: options.orderListDelimiter,
    checked: kind === 'task' ? false : undefined
  })
  const finish = (edits: DocumentSourceEdit[]) => {
    edits.sort((left, right) => left.start - right.start || left.end - right.end)
    return { edits, selection: { start: positionAfter(edits, selection.start, true), end: positionAfter(edits, selection.end, true) } }
  }
  const parent = [...ancestors].reverse().find(node => node === ancestors[0] || node.kind === 'blockquote')
  if (parent === undefined) throw new RangeError('List creation has no container')
  const from = syntax.coordinates.toProjected(selection.start, 'next')
  const to = syntax.coordinates.toProjected(selection.end, 'previous')
  const firstIndex = parent.children.findIndex(node => node.range.end >= from)
  let lastIndex = firstIndex
  if (firstIndex >= 0) {
    while (parent.children[lastIndex + 1] !== undefined && parent.children[lastIndex + 1]!.range.start <= to) lastIndex++
  }
  if (firstIndex < 0) {
    if (parent !== ancestors[0] || parent.children.length !== 0 || selection.start !== selection.end) throw new RangeError('List creation has no selected block')
    return finish([{ start: selection.start, end: selection.start, insert: spellingAt(0).text }])
  }
  const outerDepth = ancestors.slice(0, ancestors.indexOf(parent) + 1).filter(node => node.kind === 'blockquote' || node.kind === 'list-item').length
  const outer = <T extends { depth: number }>(markers: readonly T[]) => markers.filter(marker => marker.depth < outerDepth)
  const records = Array.from({ length: lines.count }, (_, index) => lines.at(index))
  const edits: DocumentSourceEdit[] = []
  const blocks = parent.children.slice(firstIndex, lastIndex + 1)
  if (options.preferLooseListItem === false) {
    for (const [index, block] of blocks.entries()) {
      const next = blocks[index + 1]
      if (next === undefined) continue
      for (const line of records) {
        if (line.blank && line.start >= block.range.end && line.end <= next.range.start) {
          edits.push({ start: sourceAt(line.start), end: sourceEnd(line.end), insert: '' })
        }
      }
    }
  }
  for (const [index, block] of blocks.entries()) {
    const spelling = spellingAt(index)
    const blockStart = sourceAt(block.range.start)
    const exterior = block.kind === 'paragraph' ? paragraphPrefixPosition(revision.annotations, { start: blockStart, end: sourceEnd(block.range.end) }) ?? blockStart : blockStart
    edits.push({ start: exterior, end: exterior, insert: spelling.text })
    for (const line of records) {
      if (line.start <= block.range.start || line.start >= block.range.end || line.blank) continue
      const prefixEnd = Math.max(line.start,
        ...outer(line.blockquoteMarkers).map(marker => marker.end),
        ...outer(line.listIndentations).map(marker => marker.end),
        ...outer(line.listMarkers).map(marker => marker.contentOffset))
      const at = sourceAt(prefixEnd)
      edits.push({ start: at, end: at, insert: ' '.repeat(spelling.indentation) })
    }
  }
  return finish(edits)
}
