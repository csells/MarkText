import deepEqual from 'deep-equal'
import { serializeNativeState } from '@muyajs/core'
import type { DocumentSourceEdit } from '@marktext/document-core'
import type { MuyaSourceStructure } from './muyaMarkupView'

type NativeNode = { name: string, text?: string, meta?: Record<string, unknown>, children?: NativeNode[] }

/** Unwrap the native list as a whole, retaining each parser-owned item body. */
export function sourceEditForMuyaUnwrappedList(
  owner: MuyaSourceStructure, previous: unknown, next: readonly unknown[]
): MuyaStructuralSourceEdit | undefined {
  const before = previous as NativeNode
  if (!['bullet-list', 'order-list', 'task-list'].includes(before.name) || !before.children?.length ||
      !deepEqual(before.children.flatMap(item => item.children ?? []), next)) return undefined
  const root = owner.nodes[0].path
  const edits: DocumentSourceEdit[] = []
  let previousEnd: number | undefined
  for (const [index, item] of before.children.entries()) {
    if (!item.children?.length) return undefined
    const itemPath = [...root, 'children', index]
    const node = owner.nodes.find(node => deepEqual(node.path, itemPath))
    const content = owner.nodes.find(node => deepEqual(node.path, [...itemPath, 'children', 0]))
    if (!node || !content) return undefined
    const localStart = node.range.start - owner.range.start
    const taskSpace = node.checkboxRange !== undefined && /^[ \t]$/u.test(owner.source[content.range.start - owner.range.start] ?? '') ? 1 : 0
    const contentStart = content.range.start + taskSpace
    const prefix = owner.source.slice(localStart, contentStart - owner.range.start)
    const marker = /^((?:[*+-]|\d+[.)]) +)(?:\[[ xX]\] +)?$/u.exec(prefix)
    if (!marker) return undefined
    edits.push({ start: node.range.start, end: contentStart, insert: '' })
    // A continued body may contain headings, fences, tables or nested lists.
    // Remove only its enclosing item's indentation; lazy lines retain theirs.
    const body = owner.source.slice(contentStart - owner.range.start, node.range.end - owner.range.start)
    const indent = ' '.repeat(marker[1].length)
    for (const ending of body.matchAll(/\r\n|\r|\n/gu)) {
      const offset = ending.index + ending[0].length
      if (body.startsWith(indent, offset)) {
        const start = contentStart + offset
        edits.push({ start, end: start + indent.length, insert: '' })
      }
    }
    if (previousEnd !== undefined) {
      const gap = owner.source.slice(previousEnd - owner.range.start, localStart)
      if (!/^[ \t\r\n]+$/u.test(gap)) return undefined
      const endings = [...gap.matchAll(/\r\n|\r|\n/gu)]
      if (endings.length === 1) edits.push({ start: previousEnd, end: previousEnd, insert: endings[0][0] })
    }
    previousEnd = node.range.end - (body.match(/(?:\r\n|\r|\n)+$/u)?.[0].length ?? 0)
  }
  return combinedEdit(owner, edits)
}

const combinedEdit = (owner: MuyaSourceStructure, edits: readonly DocumentSourceEdit[]): MuyaStructuralSourceEdit | undefined => {
  if (edits.length === 0) return undefined
  if (edits.length === 1) return edits[0]
  const ordered = [...edits].sort((left, right) => left.start - right.start)
  const start = ordered[0].start
  const end = ordered.at(-1)!.end
  if (start < owner.range.start || end > owner.range.end) return undefined
  let insert = owner.source.slice(start - owner.range.start, end - owner.range.start)
  for (const edit of [...ordered].reverse()) insert = insert.slice(0, edit.start - start) + edit.insert + insert.slice(edit.end - start)
  return { start, end, insert, structuralEdits: ordered }
}

const listIndentationEdit = (owner: MuyaSourceStructure, before: NativeNode, after: NativeNode, maximumUnits?: number): MuyaStructuralSourceEdit | undefined => {
  const leaves = (node: NativeNode, path: (string | number)[]): Array<{ node: NativeNode, path: (string | number)[] }> =>
    node.children ? node.children.flatMap((child, index) => leaves(child, [...path, 'children', index])) : [{ node, path }]
  const root = owner.nodes[0].path[0]
  const oldLeaves = leaves(before, [root])
  const newLeaves = leaves(after, [root])
  if (oldLeaves.some(leaf => !['paragraph', 'code-block', 'atx-heading', 'setext-heading', 'math-block', 'html-block', 'table.cell', 'thematic-break', 'diagram'].includes(leaf.node.name)) || !deepEqual(oldLeaves.map(leaf => leaf.node), newLeaves.map(leaf => leaf.node))) return undefined
  const placeholder = (node: NativeNode, index: { value: number }): NativeNode => {
    if (node.children) return { ...node, children: node.children.map(child => placeholder(child, index)) }
    const prefix = node.name === 'atx-heading' ? '#'.repeat(Number(node.meta?.level)) + ' ' : ''
    const text = prefix + (node.text ?? '').split('\n').map((_line, line) => `MTLeaf${index.value}Line${line}`).join('\n')
    index.value += 1
    return { ...node, text }
  }
  const oldSpelling = serializeNativeState([placeholder(before, { value: 0 })], { maximumUnits })
  const newSpelling = serializeNativeState([placeholder(after, { value: 0 })], { maximumUnits })
  if (oldSpelling === undefined || newSpelling === undefined) return undefined
  const prefix = (source: string, token: string): string => {
    const position = source.indexOf(token)
    return source.slice(source.lastIndexOf('\n', position - 1) + 1, position)
  }
  const edits = new Map<number, DocumentSourceEdit>()
  const lineStart = (position: number): number => {
    const local = position - owner.range.start
    return owner.range.start + Math.max(owner.source.lastIndexOf('\n', local - 1), owner.source.lastIndexOf('\r', local - 1)) + 1
  }
  for (const [index, leaf] of oldLeaves.entries()) {
    const node = owner.nodes.find(node => deepEqual(node.path, leaf.path))
    if (node === undefined) return undefined
    const token = `MTLeaf${index}Line0`
    const oldPrefix = prefix(oldSpelling, token)
    const newPrefix = prefix(newSpelling, token)
    if (oldPrefix === newPrefix) continue
    const offset = lineStart(node.range.start)
    const starts = [offset, ...(node.lineStarts ?? [])]
    if (leaf.node.name === 'table.cell') {
      const table = owner.nodes.find(node => node.kind === 'table' && deepEqual(node.path, leaf.path.slice(0, -4)))
      if (!table?.delimiterRange) return undefined
      starts.push(lineStart(table.delimiterRange.start))
    }
    const add = (edit: DocumentSourceEdit): boolean => {
      const previous = edits.get(edit.start)
      if (previous && !deepEqual(previous, edit)) return false
      edits.set(edit.start, edit)
      return true
    }
    if (newPrefix.endsWith(oldPrefix)) {
      const insert = newPrefix.slice(0, newPrefix.length - oldPrefix.length)
      if (!/^[ \t]+$/u.test(insert)) return undefined
      for (const start of starts) if (!add({ start, end: start, insert })) return undefined
    } else if (oldPrefix.endsWith(newPrefix)) {
      const removed = oldPrefix.slice(0, oldPrefix.length - newPrefix.length)
      if (!/^[ \t]+$/u.test(removed) || owner.source.slice(offset - owner.range.start, offset - owner.range.start + removed.length) !== removed) return undefined
      for (const start of starts) {
        if (owner.source.slice(start - owner.range.start, start - owner.range.start + removed.length) !== removed) return undefined
        if (!add({ start, end: start + removed.length, insert: '' })) return undefined
      }
    } else return undefined
  }
  return combinedEdit(owner, [...edits.values()])
}

const tableAlignmentEdit = (owner: MuyaSourceStructure, before: NativeNode, after: NativeNode): MuyaStructuralSourceEdit | undefined => {
  const rows = before.children!
  const changed = after.children!
  const delimiters = owner.nodes[0].delimiterCells
  const stripAlignment = (node: NativeNode): NativeNode => node.children
    ? { ...node, children: node.children.map(stripAlignment) }
    : { ...node, meta: { ...node.meta, align: 'none' } }
  if (!delimiters || !deepEqual(stripAlignment(before), stripAlignment(after))) return undefined
  const edits: DocumentSourceEdit[] = []
  for (const [column, range] of delimiters.entries()) {
    const align = changed[0].children?.[column]?.meta?.align
    if (align === rows[0].children?.[column]?.meta?.align) continue
    if (!['none', 'left', 'right', 'center'].includes(String(align)) || changed.some(row => row.children?.[column]?.meta?.align !== align)) return undefined
    const spelling = owner.source.slice(range.start - owner.range.start, range.end - owner.range.start)
    if (!/^:?-+:?$/u.test(spelling)) return undefined
    const left = align === 'left' || align === 'center'
    const right = align === 'right' || align === 'center'
    if (left !== spelling.startsWith(':')) edits.push({ start: range.start, end: range.start + (left ? 0 : 1), insert: left ? ':' : '' })
    if (right !== spelling.endsWith(':')) edits.push({ start: range.end - (right ? 0 : 1), end: range.end, insert: right ? ':' : '' })
  }
  return combinedEdit(owner, edits)
}

const tableColumnRemoval = (owner: MuyaSourceStructure, before: NativeNode, after: NativeNode): MuyaStructuralSourceEdit | undefined => {
  const rows = before.children!
  const changed = after.children!
  const columns = rows[0].children?.length ?? 0
  if (rows.length !== changed.length || columns < 2) return undefined
  const candidates = Array.from({ length: columns }, (_value, column) => column).filter(column => rows.every((row, index) =>
    row.children?.length === columns && changed[index].children?.length === columns - 1 &&
    deepEqual(row.children.filter((_cell, index) => index !== column), changed[index].children)
  ))
  if (candidates.length !== 1) return undefined
  const column = candidates[0]
  const removal = (cells: readonly { start: number, end: number }[]): DocumentSourceEdit | undefined => {
    if (cells.length !== columns) return undefined
    return column < columns - 1
      ? { start: cells[column].start, end: cells[column + 1].start, insert: '' }
      : { start: cells[column - 1].end, end: cells[column].end, insert: '' }
  }
  const edits: DocumentSourceEdit[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const edit = removal(owner.nodes.filter(node => node.kind === 'table-cell' && node.path.length === 5 && node.path[2] === index).map(node => node.range))
    if (edit === undefined) return undefined
    edits.push(edit)
  }
  const delimiter = removal(owner.nodes[0].delimiterCells ?? [])
  if (delimiter === undefined) return undefined
  edits.push(delimiter)
  return combinedEdit(owner, edits)
}

const tableColumnEdit = (owner: MuyaSourceStructure, before: NativeNode, after: NativeNode): MuyaStructuralSourceEdit | undefined => {
  const rows = before.children!
  const changed = after.children!
  const columns = rows[0].children?.length ?? 0
  if (rows.length !== changed.length || columns === 0 || rows.some(row => row.children?.length !== columns)) return undefined
  const candidates = Array.from({ length: columns + 1 }, (_value, column) => column).filter(column => rows.every((row, index) => {
    const next = changed[index].children
    return next?.length === columns + 1 && next[column].name === 'table.cell' && next[column].text === '' &&
      next[column].meta?.align === 'none' && deepEqual(row.children, next.filter((_cell, index) => index !== column))
  }))
  if (candidates.length !== 1) return undefined
  const column = candidates[0]
  const edits: DocumentSourceEdit[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const cells = owner.nodes.filter(node => node.kind === 'table-cell' && node.path.length === 5 && node.path[2] === index)
    const offset = cells[column]?.range.start ?? cells.at(-1)?.range.end
    if (offset === undefined) return undefined
    edits.push({ start: offset, end: offset, insert: ' | ' })
  }
  const delimiters = owner.nodes[0].delimiterCells
  if (delimiters?.length !== columns) return undefined
  const offset = delimiters[column]?.start ?? delimiters.at(-1)!.end
  edits.push({ start: offset, end: offset, insert: column === columns ? ' | ---' : '--- | ' })
  return combinedEdit(owner, edits)
}

/** Edit parser-owned container syntax while retaining canonical leaf spelling. */
export function sourceEditForMuyaContainerChange(
  owner: MuyaSourceStructure, previous: unknown, next: unknown, maximumUnits?: number
): MuyaStructuralSourceEdit | undefined {
  const before = previous as NativeNode
  const after = next as NativeNode
  const checkbox = checkboxEdit(owner, before, after)
  if (checkbox !== undefined) return checkbox
  if (before.name !== 'table') {
    const nested = nestedTableEdit(owner, before, after, owner.nodes[0].path, maximumUnits)
    if (nested !== undefined) return nested
  }
  if (['bullet-list', 'order-list', 'task-list'].includes(before.name) && before.name === after.name) return listIndentationEdit(owner, before, after, maximumUnits)
  if (before.name !== 'table' || after.name !== 'table' || !before.children || !after.children) return undefined
  const alignment = tableAlignmentEdit(owner, before, after)
  if (alignment !== undefined) return alignment
  const removal = tableColumnRemoval(owner, before, after)
  if (removal !== undefined) return removal
  const column = tableColumnEdit(owner, before, after)
  if (column !== undefined) return column
  let first = 0
  while (first < before.children.length && first < after.children.length && deepEqual(before.children[first], after.children[first])) first += 1
  let oldEnd = before.children.length
  let newEnd = after.children.length
  while (oldEnd > first && newEnd > first && deepEqual(before.children[oldEnd - 1], after.children[newEnd - 1])) {
    oldEnd -= 1
    newEnd -= 1
  }
  const rows = owner.nodes.filter(node => node.kind === 'table-row' && node.path.length === 3)
  if (first === 0) {
    const header = rows[oldEnd]
    const delimiter = owner.nodes[0].delimiterRange
    if (newEnd !== 0 || oldEnd === 0 || header === undefined || delimiter === undefined) return undefined
    const ending = owner.source.match(/\r\n|\r|\n/u)?.[0] ?? '\n'
    const spelling = owner.source.slice(delimiter.start - owner.range.start, delimiter.end - owner.range.start)
    return combinedEdit(owner, [
      { start: owner.range.start, end: header.range.start, insert: '' },
      { start: header.range.end, end: header.range.end, insert: ending + (owner.linePrefix ?? '') + spelling }
    ])
  }
  if (newEnd === first && oldEnd > first) {
    const rowStart = rows[first]?.range.start
    if (rowStart === undefined) return undefined
    const prefixLength = owner.linePrefix?.length ?? 0
    const start = rowStart - prefixLength
    const end = rows[oldEnd] === undefined ? owner.range.end : rows[oldEnd].range.start - prefixLength
    const precedingEnding = owner.source.slice(0, start - owner.range.start).match(/(?:\r\n|\r|\n)$/u)?.[0] ?? ''
    return { start: rows[oldEnd] === undefined ? start - precedingEnding.length : start, end, insert: '' }
  }
  if (oldEnd !== first || newEnd === first) return undefined
  const row = rows[first] ?? rows.at(-1)
  if (row === undefined) return undefined
  const ending = owner.source.match(/\r\n|\r|\n/u)?.[0] ?? '\n'
  const generated = serializeNativeState([{ name: 'table', children: [before.children[0], ...after.children.slice(first, newEnd)] }], { maximumUnits })
  if (generated === undefined) return undefined
  const prefix = owner.linePrefix ?? ''
  const inserted = generated.trimEnd().split('\n').slice(2).join(ending + prefix)
  const offset = rows[first]?.range.start ?? row.range.end
  const insert = rows[first] === undefined ? ending + prefix + inserted : inserted + ending + prefix
  return { start: offset, end: offset, insert }
}

const nestedTableEdit = (
  owner: MuyaSourceStructure, before: NativeNode, after: NativeNode,
  path: readonly (string | number)[], maximumUnits?: number
): MuyaStructuralSourceEdit | undefined => {
  if (before.name !== after.name) return undefined
  if (before.name === 'table') {
    const table = owner.nodes.find(node => node.kind === 'table' && deepEqual(node.path, path))
    if (!table?.delimiterRange) return undefined
    const local = table.delimiterRange.start - owner.range.start
    const start = Math.max(owner.source.lastIndexOf('\n', local - 1), owner.source.lastIndexOf('\r', local - 1)) + 1
    return sourceEditForMuyaContainerChange({
      range: table.range,
      source: owner.source.slice(table.range.start - owner.range.start, table.range.end - owner.range.start),
      linePrefix: owner.source.slice(start, local),
      nodes: owner.nodes.filter(node => deepEqual(node.path.slice(0, path.length), path))
        .map(node => ({ ...node, path: [0, ...node.path.slice(path.length)] }))
    }, before, after, maximumUnits)
  }
  if (!before.children || !after.children || before.children.length !== after.children.length) return undefined
  const changed = before.children.flatMap((child, index) => deepEqual(child, after.children?.[index]) ? [] : [index])
  if (changed.length !== 1) return undefined
  const index = changed[0]
  return nestedTableEdit(owner, before.children[index], after.children[index], [...path, 'children', index], maximumUnits)
}

const checkboxEdit = (owner: MuyaSourceStructure, before: NativeNode, after: NativeNode): MuyaStructuralSourceEdit | undefined => {
  const stripChecked = (node: NativeNode): NativeNode => ({
    ...node,
    ...(node.name === 'task-list-item' ? { meta: { ...node.meta, checked: false } } : {}),
    ...(node.children ? { children: node.children.map(stripChecked) } : {})
  })
  if (!deepEqual(stripChecked(before), stripChecked(after))) return undefined
  const edits: DocumentSourceEdit[] = []
  const visit = (previous: NativeNode, next: NativeNode, path: readonly (string | number)[]): boolean => {
    if (previous.name === 'task-list-item' && previous.meta?.checked !== next.meta?.checked) {
      const range = owner.nodes.find(node => deepEqual(node.path, path))?.checkboxRange
      if (!range || typeof next.meta?.checked !== 'boolean') return false
      const spelling = owner.source.slice(range.start - owner.range.start, range.end - owner.range.start)
      if (!/^[ xX\t]$/u.test(spelling)) return false
      edits.push({ ...range, insert: next.meta.checked ? 'x' : ' ' })
    }
    return previous.children?.every((child, index) => visit(child, next.children![index], [...path, 'children', index])) ?? true
  }
  return visit(before, after, owner.nodes[0].path) ? combinedEdit(owner, edits) : undefined
}

export type MuyaStructuralSourceEdit = DocumentSourceEdit & Readonly<{
  structuralEdits?: readonly DocumentSourceEdit[]
}>

export const muyaSourceEdits = (edit: DocumentSourceEdit): readonly DocumentSourceEdit[] =>
  (edit as MuyaStructuralSourceEdit).structuralEdits ?? [edit]

export function advanceMuyaSourceStructure(owner: MuyaSourceStructure, edit: DocumentSourceEdit): MuyaSourceStructure | undefined {
  const delta = edit.insert.length - (edit.end - edit.start)
  const shiftRange = (range: MuyaSourceStructure['range']): MuyaSourceStructure['range'] => ({
    start: range.start + (edit.end <= range.start && edit.start < range.start ? delta : 0),
    end: range.end + (edit.start <= range.end ? delta : 0)
  })
  if (edit.start > owner.range.end) return owner
  if (edit.start < owner.range.start && edit.end > owner.range.start || edit.start < owner.range.end && edit.end > owner.range.end) return undefined
  const source = edit.end <= owner.range.start && edit.start < owner.range.start
    ? owner.source
    : owner.source.slice(0, edit.start - owner.range.start) + edit.insert + owner.source.slice(edit.end - owner.range.start)
  return {
    range: shiftRange(owner.range),
    source,
    nodes: owner.nodes.map(node => ({
      ...node,
      range: shiftRange(node.range),
      ...(node.lineStarts === undefined ? {} : { lineStarts: node.lineStarts.map(offset => offset + (edit.end <= offset ? delta : 0)) }),
      ...(node.delimiterRange === undefined ? {} : { delimiterRange: shiftRange(node.delimiterRange) }),
      ...(node.delimiterCells === undefined ? {} : { delimiterCells: node.delimiterCells.map(shiftRange) }),
      ...(node.checkboxRange === undefined ? {} : { checkboxRange: shiftRange(node.checkboxRange) })
    }))
  }
}
