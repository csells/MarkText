import { documentActiveFormats } from '@marktext/document-core'
import isEqual from 'lodash/isEqual'
import type {
  DocumentClipboardInput,
  DocumentDOMPoint,
  DocumentFormatInput,
  DocumentTextInput,
  DocumentInput,
  Muya
} from '@muyajs/core'

import type {
  DocumentClipboardAction,
  DocumentSelection,
  DocumentInputTarget,
  DocumentInputSelection,
  DocumentFormatAction,
  DocumentModelTextPoint,
  DocumentModelTextSelection,
  DocumentTableCellSelection,
  DocumentTableSelection,
  SourceRange
} from '@marktext/document-core'

import type { MuyaMarkupBinding, MuyaMarkupView } from './muyaMarkupView'
import {
  mappedMuyaModelPoint,
  mappedMuyaSourceRange,
  isMuyaNormalizedTextSegment
} from './muyaMarkupView'
import type { MuyaModelInput } from './muyaPlainTextCoreAdapter'

const samePath = (left: readonly (string | number)[], right: readonly (string | number)[]) =>
  left.length === right.length && left.every((part, index) => part === right[index])

const sameCell = (left: MuyaMarkupBinding['tableCell'], right: MuyaMarkupBinding['tableCell']) =>
  left !== undefined &&
  right !== undefined &&
  left.table.start === right.table.start &&
  left.table.end === right.table.end &&
  left.row === right.row &&
  left.column === right.column

const nativeOffsetAtSource = (segment: MuyaMarkupBinding['segments'][number], source: number) =>
  source === segment.source.end
    ? segment.text.end
    : source === segment.source.start
      ? segment.text.start
      : segment.source.end - segment.source.start === segment.text.end - segment.text.start
        ? segment.text.start + source - segment.source.start
        : undefined

/** The model projection is the only source of semantic DOM boundary positions. */
export function createMuyaModelSelection(muya: Muya, view: MuyaMarkupView) {
  const native = muya.editor.selection
  const bindingFor = (point: DocumentDOMPoint): MuyaMarkupBinding | undefined => {
    const text = native.getTextPoint(point)
    return text == null
      ? undefined
      : view.bindings.find((binding) => samePath(binding.path, text.path))
  }
  const anchorFor = (node: Node, binding: MuyaMarkupBinding) => {
    if (!(node instanceof HTMLElement) || !node.hasAttribute('data-critic-start')) return undefined
    const start = Number(node.dataset.criticStart) + binding.sourceRange.start
    const end = Number(node.dataset.criticEnd) + binding.sourceRange.start
    const comment = view.comments.find(
      (item) =>
        samePath(item.path, binding.path) &&
        item.annotationRange.start === start &&
        item.annotationRange.end === end &&
        node.dataset.criticKind === 'comment'
    )
    const decoration = view.decorations.find(
      (item) =>
        samePath(item.path, binding.path) &&
        item.mark.annotationRange.start === start &&
        item.mark.annotationRange.end === end &&
        item.mark.kind === node.dataset.criticKind &&
        (item.sourcePosition === undefined
          ? !node.hasAttribute('data-critic-position')
          : item.sourcePosition ===
            Number(node.dataset.criticPosition) + binding.sourceRange.start) &&
        (item.mark.kind !== 'substitution' || item.mark.arm === node.dataset.criticArm)
    )
    return comment === undefined && decoration === undefined
      ? undefined
      : {
        start: decoration?.sourcePosition ?? start,
        end: decoration?.sourcePosition ?? end,
        decoration
      }
  }
  const domPointToModel = (point: DocumentDOMPoint): DocumentModelTextPoint | undefined => {
    const binding = bindingFor(point)
    if (binding === undefined) return undefined
    // Element child boundaries distinguish outside an annotation from inside
    // its payload even when both have the same paragraph text offset.
    if (point.node.nodeType === Node.ELEMENT_NODE) {
      const following = point.node.childNodes[point.offset]
      const preceding = point.node.childNodes[point.offset - 1]
      const next = following === undefined ? undefined : anchorFor(following, binding)
      const previous = preceding === undefined ? undefined : anchorFor(preceding, binding)
      // The two rendered arms share an annotation identity. Their common DOM
      // boundary is inside that annotation, not before its entire source range.
      if (
        next !== undefined &&
        previous !== undefined &&
        next.start === previous.start &&
        next.end === previous.end &&
        previous.decoration?.mark.kind === 'substitution' &&
        previous.decoration.mark.arm === 'old' &&
        next.decoration?.mark.kind === 'substitution' &&
        next.decoration.mark.arm === 'new'
      ) {
        const offset = next.decoration.range.start
        return mappedMuyaSourceRange(binding, { start: offset, end: offset }, 'next')?.start
      }
      if (next !== undefined) return next.start
      if (previous !== undefined) return previous.end
    }
    const text = native.getTextPoint(point)
    if (text == null) return undefined
    let segments = binding.segments
    for (
      let node = point.node.parentNode;
      node !== null && node !== muya.domNode;
      node = node.parentNode
    ) {
      const anchor = anchorFor(node, binding)
      if (anchor?.decoration !== undefined) {
        const range = anchor.decoration.range
        segments = segments.filter(
          (segment) => segment.text.start < range.end && segment.text.end > range.start
        )
      }
    }
    return mappedMuyaModelPoint(
      { ...binding, segments },
      text.offset,
      point.node.nodeType === Node.TEXT_NODE && point.offset === 0 ? 'next' : 'previous'
    )
  }
  const edge = (node: Node, after: boolean): DocumentDOMPoint | undefined => {
    const parent = node.parentNode
    if (parent === null) return undefined
    return {
      node: parent,
      offset: Array.prototype.indexOf.call(parent.childNodes, node) + (after ? 1 : 0)
    }
  }
  const modelPointToText = (
    source: DocumentModelTextPoint,
    cell?: DocumentTableCellSelection['cell']
  ) => {
    if (typeof source !== 'number') {
      for (const binding of view.bindings) {
        const segment = binding.segments.find(
          (item) =>
            item.source.start === source.text.start &&
            item.source.end === source.text.end &&
            isMuyaNormalizedTextSegment(binding, item)
        )
        if (
          segment !== undefined &&
          source.offset >= 0 &&
          source.offset <= segment.text.end - segment.text.start
        ) { return { path: binding.path, offset: segment.text.start + source.offset } }
      }
      return undefined
    }
    for (const binding of view.bindings) {
      if (cell !== undefined && !sameCell(binding.tableCell, cell)) continue
      for (const segment of binding.segments) {
        if (source < segment.source.start || source > segment.source.end) continue
        const offset = nativeOffsetAtSource(segment, source)
        if (offset !== undefined) return { path: binding.path, offset }
      }
      if (binding.text.length === 0 && binding.sourceRange.end === source) { return { path: binding.path, offset: 0 } }
    }
    return undefined
  }
  const modelPointToDOM = (
    source: DocumentModelTextPoint,
    cell?: DocumentTableCellSelection['cell']
  ): DocumentDOMPoint | undefined => {
    if (typeof source !== 'number') {
      const text = modelPointToText(source, cell)
      return text === undefined ? undefined : (native.getDOMPoint(text) ?? undefined)
    }
    for (const binding of view.bindings) {
      if (cell !== undefined && !sameCell(binding.tableCell, cell)) continue
      const block = muya.editor.scrollPage?.queryBlock([...binding.path])
      const root = block?.isContent() ? block.domNode : undefined
      if (!(root instanceof HTMLElement)) continue
      let closing: DocumentDOMPoint | undefined
      for (const node of root.querySelectorAll('[data-critic-start]')) {
        const anchor = anchorFor(node, binding)
        if (anchor?.start === source) return edge(node, false)
        if (anchor?.end === source) closing = edge(node, true)
      }
      if (closing !== undefined) return closing
      for (const segment of binding.segments) {
        if (source < segment.source.start || source > segment.source.end) continue
        const offset = nativeOffsetAtSource(segment, source)
        if (offset === undefined) continue
        const ordinary = native.getDOMPoint({ path: binding.path, offset })
        if (ordinary != null && isEqual(domPointToModel(ordinary), source)) return ordinary
        // Coincident visible offsets can belong to different substitution arms
        // or nested spans. Select the actual text node whose model map agrees.
        const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const start = native.getTextPoint({ node, offset: 0 })
          if (start == null) continue
          const local = offset - start.offset
          if (local < 0 || local > (node.textContent?.length ?? 0)) continue
          const candidate = { node, offset: local }
          if (isEqual(domPointToModel(candidate), source)) return candidate
        }
      }
      if (binding.text.length === 0 && binding.sourceRange.end === source) {
        const point = native.getDOMPoint({ path: binding.path, offset: 0 })
        if (point != null && domPointToModel(point) === source) return point
      }
    }
    return undefined
  }
  const domSelectionToModel = (selection: {
    anchor: DocumentDOMPoint
    focus: DocumentDOMPoint
  }): DocumentInputSelection | undefined => {
    const anchorBinding = bindingFor(selection.anchor)
    const focusBinding = bindingFor(selection.focus)
    const anchor = domPointToModel(selection.anchor)
    const focus = domPointToModel(selection.focus)
    if (anchor === undefined || focus === undefined) return undefined
    if (typeof anchor !== 'number' || typeof focus !== 'number') { return { kind: 'model-text', anchor, focus } }
    const content = anchorBinding?.tableCellContent
    // Annotation exterior anchors may be rendered beside a cell's text while
    // identifying a document position outside that cell.
    if (
      anchorBinding === focusBinding &&
      anchorBinding?.tableCell !== undefined &&
      content !== undefined &&
      Math.min(anchor, focus) >= content.start &&
      Math.max(anchor, focus) <= content.end
    ) {
      return {
        kind: 'table-cell',
        cell: anchorBinding.tableCell,
        anchor: anchor - content.start,
        focus: focus - content.start
      }
    }
    return { ranges: [{ anchor, focus }], primary: 0 }
  }
  const domSelectionToTarget = (selection: {
    anchor: DocumentDOMPoint
    focus: DocumentDOMPoint
  }): DocumentInputTarget | undefined => {
    const model = domSelectionToModel(selection)
    if (model === undefined || model.kind === 'table-cell' || model.kind === 'model-text') { return model }
    const range = model.ranges[model.primary]
    return range === undefined
      ? undefined
      : { start: Math.min(range.anchor, range.focus), end: Math.max(range.anchor, range.focus) }
  }
  const modelCellPointToDOM = (selection: DocumentTableCellSelection, offset: number) => {
    const binding = view.bindings.find((item) => sameCell(item.tableCell, selection.cell))
    if (binding?.tableCellContent === undefined) return undefined
    return modelPointToDOM(binding.tableCellContent.start + offset, selection.cell)
  }
  const modelCellPointToText = (selection: DocumentTableCellSelection, offset: number) => {
    const binding = view.bindings.find((item) => sameCell(item.tableCell, selection.cell))
    return binding?.tableCellContent === undefined
      ? undefined
      : modelPointToText(binding.tableCellContent.start + offset, selection.cell)
  }
  return {
    domPointToModel,
    domPointToTableCell: (point: DocumentDOMPoint) => bindingFor(point)?.tableCell,
    domSelectionToModel,
    domSelectionToTarget,
    modelPointToDOM,
    modelPointToText,
    modelCellPointToDOM,
    modelCellPointToText
  }
}

/** Resolve the live browser action before any presentation or model mutation. */
export function muyaInputToModel(
  muya: Muya,
  view: MuyaMarkupView,
  input: DocumentTextInput
): Extract<MuyaModelInput, { inputType: string }>
export function muyaInputToModel(
  muya: Muya,
  view: MuyaMarkupView,
  input: DocumentInput
): MuyaModelInput
export function muyaInputToModel(
  muya: Muya,
  view: MuyaMarkupView,
  input: DocumentInput
): MuyaModelInput {
  const { domSelectionToModel, domSelectionToTarget, domPointToTableCell } =
    createMuyaModelSelection(muya, view)
  const selection = domSelectionToModel(input.selection)
  if (selection === undefined) { throw new Error('The current model has no position for the native input selection') }
  if ('kind' in input) {
    if (
      input.command === 'alignTableColumn' ||
      input.command === 'moveTableColumn' ||
      input.command === 'moveTableRow'
    ) {
      const target = domPointToTableCell(input.target)
      if (target === undefined) { throw new Error('The current model has no cell for the table command target') }
      return {
        kind: input.kind,
        ...(input.command === 'alignTableColumn'
          ? { command: input.command, alignment: input.alignment }
          : input.command === 'moveTableColumn'
            ? { command: input.command, column: input.column }
            : { command: input.command, row: input.row }),
        target,
        selection,
        options: input.options,
        ...(input.historyGroup === undefined ? {} : { historyGroup: input.historyGroup })
      }
    }
    return {
      kind: input.kind,
      ...(input.command === 'tab'
        ? { command: input.command, shift: input.shift }
        : input.command === 'setTaskChecked'
          ? {
            command: input.command,
            checked: input.checked,
            autoCheck: input.autoCheck,
            autoMoveCheckedToEnd: input.autoMoveCheckedToEnd
          }
          : input.command === 'resetCodeBlock'
            ? { command: input.command, selectionMode: input.selectionMode }
            : input.command === 'createMathBlock' || input.command === 'createCodeBlock'
              ? { command: input.command, replace: input.replace }
              : input.command === 'changeThematicBreak'
                ? { command: input.command, change: Object.freeze({ ...input.change }) }
                : input.command === 'createFrontMatter'
                  ? { command: input.command, replace: input.replace, style: input.style }
                  : input.command === 'createTable'
                    ? {
                      command: input.command,
                      rows: input.rows,
                      columns: input.columns,
                      replace: input.replace
                    }
                    : input.command === 'changeList'
                      ? {
                        command: input.command,
                        change: Object.freeze({ ...input.change }),
                        listOptions: Object.freeze({ ...input.listOptions })
                      }
                      : input.command === 'changeHeading'
                        ? { command: input.command, change: Object.freeze({ ...input.change }) }
                        : input.command === 'changeBlockquote'
                          ? { command: input.command, change: Object.freeze({ ...input.change }) }
                          : 'placement' in input
                            ? { command: input.command, placement: input.placement }
                            : { command: input.command }),
      selection,
      options: input.options,
      ...(input.historyGroup === undefined ? {} : { historyGroup: input.historyGroup })
    }
  }
  const range = domSelectionToTarget(input.range)
  if (range === undefined) { throw new Error('The current model has no position for the native input boundary') }
  return {
    selection,
    range,
    inputType: input.inputType,
    data: input.data,
    options: input.options,
    ...(input.historyGroup === undefined ? {} : { historyGroup: input.historyGroup })
  }
}

/** Formatting receives the same exact live DOM selection as native input. */
export function muyaFormatToModel(
  muya: Muya,
  view: MuyaMarkupView,
  input: DocumentFormatInput,
  tracked: boolean
): DocumentFormatAction {
  const { domPointToModel } = createMuyaModelSelection(muya, view)
  const anchor = domPointToModel(input.selection.anchor)
  const focus = domPointToModel(input.selection.focus)
  if (anchor === undefined || focus === undefined) { throw new Error('The current model has no source position for the native formatting selection') }
  if (typeof anchor !== 'number' || typeof focus !== 'number') {
    if (input.format === 'image-properties') { throw new Error('Image properties require an image source selection') }
    return { format: input.format, selection: { kind: 'model-text', anchor, focus }, tracked }
  }
  return input.format === 'image-properties'
    ? {
      format: input.format,
      selection: { start: Math.min(anchor, focus), end: Math.max(anchor, focus) },
      tracked,
      properties: { ...input.properties }
    }
    : { format: input.format, selection: { ranges: [{ anchor, focus }], primary: 0 }, tracked }
}

/** Prepared clipboard payloads use the same live selection mapping as typing. */
function muyaTableSelectionToModel(
  muya: Muya,
  view: MuyaMarkupView,
  selection: Extract<DocumentClipboardInput, { kind: 'table' }>['selection']
): DocumentTableSelection {
  const cells = selection.ranges.map((range) => {
    const anchor = muya.editor.selection.getTextPoint(range.anchor)
    const focus = muya.editor.selection.getTextPoint(range.focus)
    const binding =
      anchor && focus && samePath(anchor.path, focus.path)
        ? view.bindings.find((item) => samePath(item.path, anchor.path))
        : undefined
    if (binding?.tableCell === undefined) { throw new Error('The current model has no address for a selected table cell') }
    return binding.tableCell
  })
  const anchor = cells[selection.primary]
  if (
    anchor === undefined ||
    cells.some(
      (cell) => cell.table.start !== anchor.table.start || cell.table.end !== anchor.table.end
    )
  ) {
    throw new Error('The current selection does not identify one model table')
  }
  const rows = cells.map((cell) => cell.row)
  const columns = cells.map((cell) => cell.column)
  const minRow = Math.min(...rows)
  const maxRow = Math.max(...rows)
  const minColumn = Math.min(...columns)
  const maxColumn = Math.max(...columns)
  if (
    new Set(cells.map((cell) => `${cell.row}:${cell.column}`)).size !==
    (maxRow - minRow + 1) * (maxColumn - minColumn + 1)
  ) {
    throw new Error('The selected model cells are not a rectangle')
  }
  return {
    kind: 'table',
    table: anchor.table,
    anchor: { row: anchor.row, column: anchor.column },
    focus: {
      row: anchor.row === minRow ? maxRow : minRow,
      column: anchor.column === minColumn ? maxColumn : minColumn
    }
  }
}

export function muyaClipboardToModel(
  muya: Muya,
  view: MuyaMarkupView,
  input: Extract<DocumentClipboardInput, { kind: 'paste' }>,
  tracked: boolean
): Extract<DocumentClipboardAction, { kind: 'paste' }>
export function muyaClipboardToModel(
  muya: Muya,
  view: MuyaMarkupView,
  input: DocumentClipboardInput,
  tracked: boolean
): DocumentClipboardAction
export function muyaClipboardToModel(
  muya: Muya,
  view: MuyaMarkupView,
  input: DocumentClipboardInput,
  tracked: boolean
): DocumentClipboardAction {
  if (input.kind === 'table') {
    return { ...input, tracked, selection: muyaTableSelectionToModel(muya, view, input.selection) }
  }
  const selection = createMuyaModelSelection(muya, view).domSelectionToModel(input.selection)
  if (selection === undefined) { throw new Error('The current model has no position for the clipboard selection') }
  return input.kind === 'paste'
    ? {
      kind: 'paste',
      markdown: input.markdown,
      pasteAsPlainText: input.pasteAsPlainText,
      selection,
      tracked
    }
    : { kind: 'cut', selection, tracked }
}

/** Present active formats from owned syntax; never tokenize the displayed text. */
export function muyaActiveFormats(
  muya: Muya,
  view: MuyaMarkupView,
  selection: { anchor: DocumentDOMPoint; focus: DocumentDOMPoint }
): readonly { type: string; tag?: string }[] {
  const { domPointToModel } = createMuyaModelSelection(muya, view)
  const anchor = domPointToModel(selection.anchor)
  const focus = domPointToModel(selection.focus)
  if (anchor === undefined || focus === undefined) return []
  const start = Math.min(
    typeof anchor === 'number' ? anchor : anchor.text.start,
    typeof focus === 'number' ? focus : focus.text.start
  )
  const end = Math.max(
    typeof anchor === 'number' ? anchor : anchor.text.end,
    typeof focus === 'number' ? focus : focus.text.end
  )
  const formats: { type: string; tag?: string }[] = []
  for (const binding of view.bindings) {
    const first =
      binding.segments.find(
        (segment) => segment.source.start <= start && start < segment.source.end
      ) ?? binding.segments.find((segment) => segment.source.end === start)
    const last =
      binding.segments.find((segment) => segment.source.start < end && end <= segment.source.end) ??
      binding.segments.find((segment) => segment.source.start === end)
    if (first === undefined || last === undefined) continue
    const syntaxStart = first.syntax.start + start - first.source.start
    const syntaxEnd = last.syntax.start + end - last.source.start
    formats.push(...documentActiveFormats(binding.syntax, { start: syntaxStart, end: syntaxEnd }))
  }
  return formats
}

/** Capture input identity while an asynchronous clipboard or image operation completes. */
export function muyaClipboardInputSelection(
  muya: Muya,
  view: MuyaMarkupView
): DocumentInputSelection | undefined {
  const native = muya.editor.selection
  if (native.table.hasSelection) return undefined
  const selection = native.image ? native.getImageDOMSelection() : native.getDOMSelection()
  return selection === null
    ? undefined
    : createMuyaModelSelection(muya, view).domSelectionToModel(selection)
}

/** Capture the actual current rectangle or text target after resource preparation. */
export function muyaClipboardCurrentSelection(
  muya: Muya,
  view: MuyaMarkupView
): DocumentSelection | undefined {
  const rectangle = muya.editor.selection.table.getDOMSelection()
  return rectangle === null
    ? muyaClipboardInputSelection(muya, view)
    : muyaTableSelectionToModel(muya, view, rectangle)
}

/** Capture the current clipboard target, including the native selected-image widget. */
export function muyaClipboardSourceRange(
  muya: Muya,
  view: MuyaMarkupView
): { start: number; end: number } | undefined {
  const native = muya.editor.selection
  if (native.table.hasSelection) return undefined
  const selection = native.image ? native.getImageDOMSelection() : native.getDOMSelection()
  if (selection === null) return undefined
  const { domPointToModel } = createMuyaModelSelection(muya, view)
  const anchor = domPointToModel(selection.anchor)
  const focus = domPointToModel(selection.focus)
  if (typeof anchor !== 'number' || typeof focus !== 'number') return undefined
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }
}

/** Capture the model selection for copy without flattening a native rectangle. */
export function muyaClipboardSelection(
  muya: Muya,
  view: MuyaMarkupView
): SourceRange | DocumentTableSelection | DocumentModelTextSelection | undefined {
  const native = muya.editor.selection
  if (!native.table.hasSelection) {
    const selection = native.image ? native.getImageDOMSelection() : native.getDOMSelection()
    if (selection === null) return undefined
    const model = createMuyaModelSelection(muya, view).domSelectionToModel(selection)
    if (model?.kind === 'model-text') return model
    return muyaClipboardSourceRange(muya, view)
  }
  const selection = native.table.getDOMSelection()
  return selection === null ? undefined : muyaTableSelectionToModel(muya, view, selection)
}
