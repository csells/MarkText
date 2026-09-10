import { listItemMarker, listTabAction } from '@marktext/input-policy'
import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import type { MarkdownLineIndex } from './revision.js'
import { listItemGroups } from './documentListGroups.js'
import { inlineHtmlPairs } from './documentFormatContext.js'
import { positionAfter } from './sourcePosition.js'

/** Paragraph Tab uses intrinsic inline boundaries and list/container line facts. */
export function planParagraphTab(core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, ancestors: readonly MarkdownAstNode[], lines: MarkdownLineIndex, selection: SourceRange, shift: boolean, tabSize: number): { edits: DocumentSourceEdit[], selection: SourceRange } {
  if (typeof shift !== 'boolean' || !Number.isSafeInteger(tabSize) || tabSize < 1) throw new RangeError('Invalid paragraph Tab options')
  const { start, end } = selection
  const projected = syntax.coordinates.toProjected(start, 'next')
  const sourceAt = (position: number) => syntax.coordinates.toSource(position, 'next')
  const sourceEnd = (position: number) => syntax.coordinates.toSource(position, 'previous')
  const finish = (edits: DocumentSourceEdit[]) => ({ edits, selection: { start: positionAfter(edits, start, true), end: positionAfter(edits, end, true) } })
  const paragraph = [...ancestors].reverse().find(node => node.kind === 'paragraph')
  const item = [...ancestors].reverse().find(node => node.kind === 'list-item')
  const list = item === undefined ? undefined : ancestors[ancestors.indexOf(item) - 1]
  const outerItem = list === undefined ? undefined : ancestors[ancestors.indexOf(list) - 1]
  if (!shift && start === end && paragraph !== undefined) {
    let jump: number | undefined
    const visit = (node: MarkdownAstNode): void => {
      if (projected <= node.range.start || projected >= node.range.end) return
      const contentEnd = typeof node.attributes.contentEnd === 'number' ? node.attributes.contentEnd : node.children.at(-1)?.range.end
      if (['strong', 'emphasis', 'strikethrough', 'inline-code', 'inline-math'].includes(node.kind) && contentEnd === projected) jump = node.range.end
      if ((node.kind === 'link' || node.kind === 'image') && typeof node.attributes.labelEnd === 'number') {
        if ((node.attributes.referenceKind === undefined || node.attributes.referenceKind === 'full') && node.attributes.labelEnd === projected) jump = Math.min(node.range.end, projected + 2)
        if (node.range.end - 1 === projected) jump = node.range.end
      }
      for (const pair of inlineHtmlPairs(node)) if (pair.close.range.start === projected) jump = pair.close.range.end
      for (const child of node.children) visit(child)
    }
    visit(paragraph)
    if (jump !== undefined) return { edits: [], selection: { start: sourceAt(jump), end: sourceAt(jump) } }
  }
  const itemIndex = list?.children.indexOf(item as MarkdownAstNode) ?? -1
  const groups = listItemGroups(list)
  const group = groups.find(group => item !== undefined && group.includes(item))
  const groupIndex = item === undefined ? -1 : group?.indexOf(item) ?? -1
  const action = listTabAction({ shift, collapsed: start === end, paragraphInItem: item !== undefined && paragraph !== undefined && item.children.includes(paragraph), previousItem: groupIndex > 0, nestedList: item !== undefined && paragraph !== undefined && item.children.includes(paragraph) && outerItem?.kind === 'list-item', previousBlock: outerItem !== undefined && list !== undefined && (outerItem.children.indexOf(list) > 0 || group !== undefined && groups.indexOf(group) > 0) })
  if (action === 'none') return finish([])
  if (action === 'insert') return finish([{ start, end, insert: ' '.repeat(tabSize) }])
  if (item === undefined || list?.kind !== 'list') throw new RangeError('List Tab has no owned item')
  const records = Array.from({ length: lines.count }, (_, index) => lines.at(index))
  const markers = records.flatMap(line => line.listMarkers)
  const marker = markers.find(marker => marker.start === item.range.start)
  if (marker === undefined) throw new RangeError('List Tab item has no opening marker')
  const edits: DocumentSourceEdit[] = []
  const contentStart = typeof item.attributes.taskMarkerEnd === 'number' ? item.attributes.taskMarkerEnd + 1 : marker.contentOffset
  const markerFor = (target: MarkdownAstNode, group: readonly MarkdownAstNode[], index: number) => {
    const firstItem = group[0]
    const first = markers.find(candidate => candidate.start === firstItem?.range.start)
    if (first === undefined || firstItem === undefined) throw new RangeError('Target list has no opening marker')
    return listItemMarker({
      bullet: target.attributes.ordered === true ? undefined : String.fromCharCode(first.delimiterCodeUnit),
      ordinal: target.attributes.ordered === true ? Number(target.attributes.startNumber ?? 1) + target.children.indexOf(firstItem) + index : undefined,
      delimiter: String.fromCharCode(first.delimiterCodeUnit),
      checked: firstItem.attributes.task === true ? item.attributes.checked === true : undefined
    })
  }
  const oldWidth = marker.contentOffset - marker.start
  const replaceMarker = (prefix: string, spelling: ReturnType<typeof listItemMarker>) => {
    const existing = core.sourceSlice(revision, { start: sourceAt(marker.start), end: sourceEnd(contentStart) })
    if (existing === spelling.text) {
      if (prefix !== '') edits.push({ start: sourceAt(marker.start), end: sourceAt(marker.start), insert: prefix })
    } else edits.push({ start: sourceAt(marker.start), end: sourceEnd(contentStart), insert: prefix + spelling.text })
  }
  if (action === 'indent') {
    const previous = list.children[itemIndex - 1]
    const previousMarker = markers.find(marker => marker.start === previous?.range.start)
    if (previousMarker === undefined || previous === undefined) throw new RangeError('List indentation has no previous marker')
    const width = previousMarker.contentOffset - previousMarker.start
    const previousLast = previous.children.at(-1)
    const nested = previousLast?.kind === 'list' ? previousLast : undefined
    const nestedGroup = listItemGroups(nested).at(-1)
    const spelling = nested === undefined || nestedGroup === undefined ? undefined : markerFor(nested, nestedGroup, nestedGroup.length)
    if (spelling !== undefined) replaceMarker(' '.repeat(width), spelling)
    for (const line of records) {
      if (line.end <= item.range.start || line.start >= item.range.end || line.blank) continue
      const first = line.listMarkers.some(candidate => candidate.start === item.range.start)
      if (first && spelling !== undefined) continue
      const position = first ? marker.start : line.listIndentations.find(indent => indent.depth === marker.depth)?.start ?? line.start
      const at = sourceAt(position)
      const additional = width + (first || spelling === undefined ? 0 : spelling.indentation - oldWidth)
      edits.push({ start: at, end: at, insert: ' '.repeat(additional) })
    }
  } else if (action === 'outdent') {
    const outerMarker = markers.find(marker => marker.start === outerItem?.range.start)
    if (outerMarker === undefined) throw new RangeError('List outdent has no outer marker')
    const outerList = outerItem === undefined ? undefined : ancestors[ancestors.indexOf(outerItem) - 1]
    if (outerList?.kind !== 'list' || outerItem === undefined) throw new RangeError('List outdent has no outer list')
    const outerGroup = listItemGroups(outerList).find(group => group.includes(outerItem))
    if (outerGroup === undefined) throw new RangeError('List outdent has no outer native group')
    const spelling = markerFor(outerList, outerGroup, outerGroup.indexOf(outerItem) + 1)
    replaceMarker('', spelling)
    for (const line of records) {
      if (line.end <= item.range.start || line.start >= item.range.end || line.blank) continue
      const indentation = line.listIndentations.find(indent => indent.depth === outerMarker.depth)
      if (indentation === undefined) throw new RangeError('List outdent line has no owned indentation')
      edits.push({ start: sourceAt(indentation.start), end: sourceEnd(indentation.end), insert: '' })
      if (spelling.indentation !== oldWidth) {
        const own = line.listIndentations.find(indent => indent.depth === marker.depth)
        if (own !== undefined) edits.push({ start: sourceAt(own.start), end: sourceEnd(own.end), insert: ' '.repeat(Math.max(0, own.columns + spelling.indentation - oldWidth)) })
      }
    }
  } else {
    if (paragraph === undefined || outerItem === undefined) throw new RangeError('List paragraph promotion has no owned container')
    const firstLine = records.find(line => line.listMarkers.some(candidate => candidate.start === item.range.start))
    const lastLine = [...records].reverse().find(line => line.start < item.range.end && line.end > item.range.start)
    if (firstLine === undefined || lastLine === undefined) throw new RangeError('List paragraph promotion has no physical lines')
    if (itemIndex === 0) {
      edits.push({ start: sourceAt(marker.start), end: sourceEnd(contentStart), insert: '' })
      for (const line of records) {
        if (line.start <= firstLine.start || line.start >= item.range.end) continue
        const own = line.listIndentations.find(indent => indent.depth === marker.depth)
        if (own !== undefined) edits.push({ start: sourceAt(own.start), end: sourceEnd(own.end), insert: '' })
      }
      return finish(edits)
    }
    const from = sourceAt(firstLine.start)
    const to = sourceEnd(lastLine.end)
    const itemEdits: DocumentSourceEdit[] = [{ start: from, end: sourceEnd(contentStart), insert: '' }]
    for (const line of records) {
      if (line.start <= firstLine.start || line.start >= item.range.end) continue
      const own = line.listIndentations.find(indent => indent.depth === marker.depth)
      if (own !== undefined) itemEdits.push({ start: sourceAt(own.start), end: sourceEnd(own.end), insert: '' })
    }
    let payload = core.sourceSlice(revision, { start: from, end: to })
    for (const edit of [...itemEdits].reverse()) payload = payload.slice(0, edit.start - from) + edit.insert + payload.slice(edit.end - from)
    const insertion = sourceAt(list.range.start)
    const outerMarker = markers.find(candidate => candidate.start === outerItem.range.start)
    if (outerMarker === undefined) throw new RangeError('List paragraph promotion has no outer marker')
    const prefix = ' '.repeat(outerMarker.contentOffset - outerMarker.start)
    edits.push({ start: insertion, end: insertion, insert: payload + prefix }, { start: from, end: to, insert: '' })
    const moved = insertion + positionAfter(itemEdits, start, true) - from
    return { edits, selection: { start: moved, end: moved } }
  }
  edits.sort((left, right) => left.start - right.start)
  return finish(edits)
}
