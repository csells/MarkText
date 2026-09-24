import type { Muya } from '@muyajs/core'
import type { DocumentSelection, DocumentTableCellSelection } from '@marktext/document-core'
import type { MuyaMarkupState, MuyaMarkupView } from './muyaMarkupView'
import isEqual from 'lodash/isEqual'

import type { CoreAppliedReply } from './coreProtocol'
import type { MuyaPlainTextViewResult } from './muyaPlainTextView'
import { createMuyaModelSelection } from './muyaModelSelection'
import type { MuyaPlainTextSourceBinding } from './muyaPlainTextCoreAdapter'

/** Replaces the presented block state at `path`. */
function replaceState(
  state: MuyaMarkupState[],
  path: readonly (string | number)[],
  block: MuyaMarkupState
): void {
  let parent: unknown = state
  for (const part of path.slice(0, -1)) parent = (parent as Record<string | number, unknown>)[part]
  const key = path[path.length - 1]
  if (key !== undefined) (parent as Record<string | number, unknown>)[key] = block
}

/**
 * A soft break at a paragraph's end, or Enter on an earlier line of one,
 * leaves the caret on a line that no block owns. Show that line as the
 * paragraph's last or first line, as upstream does, without dispatching an
 * editing operation; the next view replaces it.
 */
function presentUnownedLines(muya: Muya, view: MuyaMarkupView, points: readonly number[]): void {
  const { modelPointToDOM, snapCaret } = createMuyaModelSelection(muya, view)
  const missing = points.filter((point) => modelPointToDOM(point) === undefined)
  const unowned = missing.map((point) => snapCaret(point) ?? point)
  if (unowned.length === 0) return
  const blank = view.bindings.filter(
    (binding) =>
      binding.blankLineText !== undefined &&
      missing.some(
        (point) =>
          point > binding.sourceRange.end &&
          point <= binding.sourceRange.end + (binding.blankLineText?.length ?? 0)
      )
  )
  const trailing = view.bindings.filter(
    (binding) =>
      binding.trailingLinePosition !== undefined && unowned.includes(binding.trailingLinePosition)
  )
  // A blank line between two paragraphs ends the first before it begins the second.
  const leading = view.bindings.filter(
    (binding) =>
      binding.leadingLinePosition !== undefined &&
      unowned.includes(binding.leadingLinePosition) &&
      !trailing.some((line) => line.trailingLinePosition === binding.leadingLinePosition)
  )
  if (trailing.length === 0 && leading.length === 0 && blank.length === 0) return
  const state = structuredClone([...view.state]) as MuyaMarkupState[]
  const present = (binding: MuyaMarkupView['bindings'][number], text: string) => {
    let leaf: unknown = state
    for (const part of binding.path.slice(0, -1)) {
      leaf = (leaf as Record<string | number, unknown>)[part]
    }
    ;(leaf as MuyaMarkupState).text = text
  }
  for (const binding of blank) present(binding, binding.blankLineText ?? '')
  for (const binding of trailing) present(binding, `${binding.text}\n`)
  for (const binding of leading) {
    if (binding.syntax.kind !== 'thematic-break') {
      present(binding, `${binding.leadingLineText ?? ''}\n${binding.text}`)
      continue
    }
    // The underline left by deleting a setext heading's text shows that
    // empty heading, as upstream keeps it.
    replaceState(state, binding.path.slice(0, -1), {
      name: 'setext-heading',
      meta: { level: 2, underline: '---' },
      text: ''
    })
  }
  muya.reconcileContent(state)
  for (const binding of [...blank, ...trailing, ...leading]) {
    const block = muya.editor.scrollPage?.queryBlock([...binding.path])
    if (block?.isContent()) block.update()
  }
}

/**
 * Upstream keeps a lone list or quote marker that was typed or left by a
 * deletion as paragraph text until more is typed, and places a caret before
 * a marker only in such text. While the model selection is there, show the
 * line as that paragraph. A caret at a container's content is inside it.
 */
function presentMarkerLines(muya: Muya, view: MuyaMarkupView, points: readonly number[]): void {
  const lines = view.bindings.flatMap(({ markerLine: line, text }) =>
    line !== undefined &&
    points.some(
      (point) =>
        line.start <= point &&
        (point < line.content || (text === '' && point <= line.end && !/[ \t]$/u.test(line.text)))
    )
      ? [line]
      : []
  )
  if (lines.length === 0) return
  const state = structuredClone([...view.state]) as MuyaMarkupState[]
  for (const line of lines) {
    replaceState(state, line.statePath, { name: 'paragraph', text: line.text })
  }
  muya.reconcileContent(state)
  for (const line of lines) {
    const block = muya.editor.scrollPage?.queryBlock([...line.statePath, 'text'])
    if (block?.isContent()) block.update()
  }
}

/**
 * A space typed after a cell's text becomes the table's padding, and the
 * caret follows it there. Show those spaces after the cell's text, as
 * upstream keeps them in the cell, until the next view replaces them.
 */
function presentCellPadding(
  muya: Muya,
  view: MuyaMarkupView,
  selection: DocumentTableCellSelection
): void {
  const binding = view.bindings.find(
    (item) =>
      item.tableCell !== undefined &&
      item.tableCell.table.start === selection.cell.table.start &&
      item.tableCell.table.end === selection.cell.table.end &&
      item.tableCell.row === selection.cell.row &&
      item.tableCell.column === selection.cell.column
  )
  const content = binding?.tableCellContent
  if (binding?.tableCellPadding === undefined || content === undefined) return
  const spaces = content.start + Math.max(selection.anchor, selection.focus) - content.end
  if (spaces <= 0 || spaces > binding.tableCellPadding) return
  const state = structuredClone([...view.state]) as MuyaMarkupState[]
  let leaf: unknown = state
  for (const part of binding.path.slice(0, -1)) {
    leaf = (leaf as Record<string | number, unknown>)[part]
  }
  ;(leaf as MuyaMarkupState).text = binding.text + ' '.repeat(spaces)
  muya.reconcileContent(state)
  const block = muya.editor.scrollPage?.queryBlock([...binding.path])
  if (block?.isContent()) block.update()
}

/** Restores the same model positions for edits, history and view handoff. */
export function restoreMuyaDocumentSelection(
  muya: Muya,
  view: MuyaMarkupView,
  documentSelection: DocumentSelection,
  options: { projectSource?: boolean } = {}
): void {
  if (options.projectSource && 'ranges' in documentSelection) {
    const { projectSourcePoint } = createMuyaModelSelection(muya, view)
    documentSelection = {
      ...documentSelection,
      ranges: documentSelection.ranges.map(({ anchor, focus }) => ({
        anchor: projectSourcePoint(anchor),
        focus: projectSourcePoint(focus)
      }))
    }
  }
  const primaryRange =
    'ranges' in documentSelection ? documentSelection.ranges[documentSelection.primary] : undefined
  const inputSelection =
    primaryRange === undefined ? undefined : { start: primaryRange.anchor, end: primaryRange.focus }
  const cellSelection = documentSelection.kind === 'table-cell' ? documentSelection : undefined
  const modelTextSelection = documentSelection.kind === 'model-text' ? documentSelection : undefined
  if (documentSelection?.kind === 'table') {
    if (!('state' in view)) {
      throw new Error('Core table selection requires its model-owned native projection')
    }
    const minRow = Math.min(documentSelection.anchor.row, documentSelection.focus.row)
    const maxRow = Math.max(documentSelection.anchor.row, documentSelection.focus.row)
    const minColumn = Math.min(documentSelection.anchor.column, documentSelection.focus.column)
    const maxColumn = Math.max(documentSelection.anchor.column, documentSelection.focus.column)
    const ranges = []
    let primary = 0
    for (let row = minRow; row <= maxRow; row++) {
      for (let column = minColumn; column <= maxColumn; column++) {
        const binding = view.bindings.find(
          (item) =>
            item.tableCell?.table.start === documentSelection.table.start &&
            item.tableCell.table.end === documentSelection.table.end &&
            item.tableCell.row === row &&
            item.tableCell.column === column
        )
        const block = binding && muya.editor.scrollPage?.queryBlock([...binding.path])
        const node = block?.isContent() ? block.domNode : undefined
        if (!node?.isConnected) {
          throw new Error('The accepted model table selection has no native cell boundary')
        }
        if (row === documentSelection.anchor.row && column === documentSelection.anchor.column) {
          primary = ranges.length
        }
        ranges.push({
          anchor: { node, offset: 0 },
          focus: { node, offset: node.childNodes.length }
        })
      }
    }
    muya.editor.selection.table.setDOMSelection(ranges, primary)
  } else if (
    inputSelection !== undefined ||
    cellSelection !== undefined ||
    modelTextSelection !== undefined
  ) {
    if (!('state' in view)) throw new Error('Core input requires its model-owned native projection')
    const { modelPointToDOM, modelPointToText, modelCellPointToDOM, modelCellPointToText } =
      createMuyaModelSelection(muya, view)
    const collapsed =
      cellSelection !== undefined
        ? cellSelection.anchor === cellSelection.focus
        : isEqual(
          modelTextSelection?.anchor ?? inputSelection!.start,
          modelTextSelection?.focus ?? inputSelection!.end
        )
    const domPoint = (edge: 'anchor' | 'focus') =>
      cellSelection !== undefined
        ? modelCellPointToDOM(cellSelection, cellSelection[edge], collapsed)
        : modelPointToDOM(
          modelTextSelection?.[edge] ?? inputSelection![edge === 'anchor' ? 'start' : 'end'],
          undefined,
          collapsed
        )
    const textPoint = (edge: 'anchor' | 'focus') =>
      cellSelection !== undefined
        ? modelCellPointToText(cellSelection, cellSelection[edge])
        : modelPointToText(
          modelTextSelection?.[edge] ?? inputSelection![edge === 'anchor' ? 'start' : 'end']
        )
    if (inputSelection !== undefined) {
      presentUnownedLines(muya, view, [inputSelection.start, inputSelection.end])
      presentMarkerLines(muya, view, [inputSelection.start, inputSelection.end])
    }
    if (cellSelection !== undefined) presentCellPadding(muya, view, cellSelection)
    let anchor = domPoint('anchor')
    let focus = domPoint('focus')
    const insideImage = (point: typeof anchor) => {
      const element = point?.node instanceof Element ? point.node : point?.node.parentElement
      return element?.closest('.mu-inline-image[contenteditable="false"]') != null
    }
    // Source history can select the interior of an atomic widget. Present its
    // owned editing text using the existing active-syntax cursor before placing
    // the browser selection; hidden widget source cannot receive native keys.
    if (insideImage(anchor) || insideImage(focus)) {
      const anchorText = textPoint('anchor')
      const focusText = textPoint('focus')
      const paths = [anchorText?.path, focusText?.path].filter(
        (path): path is NonNullable<typeof path> => path !== undefined
      )
      const rendered = new Set<string>()
      for (const path of paths) {
        const key = JSON.stringify(path)
        if (rendered.has(key)) continue
        rendered.add(key)
        const block = muya.editor.scrollPage?.queryBlock([...path])
        if (!block?.isContent()) continue
        block.update({
          block,
          ...(anchorText !== undefined && isEqual(anchorText.path, path)
            ? { anchor: { offset: anchorText.offset } }
            : {}),
          ...(focusText !== undefined && isEqual(focusText.path, path)
            ? { focus: { offset: focusText.offset } }
            : {})
        })
      }
      anchor = domPoint('anchor')
      focus = domPoint('focus')
    }
    if (anchor === undefined || focus === undefined) {
      throw new Error('The accepted model selection has no rendered native boundary')
    }
    muya.editor.selection.setDOMSelection(anchor, focus)
  }
}

/** Installs an acknowledged native view and restores its document selection. */
export function reconcileMuyaDocumentView({
  muya,
  view,
  outcome,
  dirtyPaths,
  applyEditability
}: {
  muya: Muya
  view: MuyaPlainTextViewResult
  outcome: CoreAppliedReply
  dirtyPaths: Iterable<readonly (string | number)[]>
  applyEditability: (bindings: readonly MuyaPlainTextSourceBinding[]) => void
}): void {
  const selection = muya.getSelection()
  const clipboardSelection = outcome.clipboardResult?.selection
  const formatSelection = outcome.formatResult?.selection
  const documentSelection =
    outcome.historyResult?.selection ??
    outcome.inputResult?.selection ??
    clipboardSelection ??
    formatSelection
  const primaryRange =
    documentSelection !== undefined && 'ranges' in documentSelection
      ? documentSelection.ranges[documentSelection.primary]
      : undefined
  const inputSelection =
    (primaryRange === undefined
      ? undefined
      : { start: primaryRange.anchor, end: primaryRange.focus }) ?? outcome.authorResult?.selection
  // A native structural command may differ only in container metadata (for
  // example a one-item list's loose flag). Replacing that presentation must
  // retain the native caret when both endpoint leaves still have the same text.
  const retainSelection =
    selection !== null &&
    [selection.anchor, selection.focus].every((endpoint) =>
      view.bindings.some(
        (binding) =>
          isEqual(binding.path, endpoint.path) &&
          binding.text === endpoint.block.text &&
          endpoint.offset <= binding.text.length
      )
    )
  const unchanged = 'state' in view && !muya.reconcileContent(view.state)
  if (!('state' in view)) muya.setContent(view.markdown, false, { preserveInputGrouping: true })
  applyEditability(view.bindings)
  // A retained root can have changed inline meaning without changed native
  // state, such as a reference resolved by an edited definition elsewhere.
  // Native composition can also mutate DOM without changing the view state.
  const paths =
    unchanged && outcome.inputResult !== undefined
      ? view.bindings.map((binding) => binding.path)
      : dirtyPaths
  for (const path of paths) {
    const block = muya.editor.scrollPage?.queryBlock([...path])
    if (block?.isContent()) block.update()
  }
  if (documentSelection !== undefined || inputSelection !== undefined) {
    if (!('state' in view)) {
      throw new Error('Core selection requires its model-owned native projection')
    }
    restoreMuyaDocumentSelection(
      muya,
      view,
      documentSelection ?? {
        ranges: [{ anchor: inputSelection!.start, focus: inputSelection!.end }],
        primary: 0
      }
    )
  } else if (retainSelection && selection !== null) {
    const anchorBlock = muya.editor.scrollPage?.queryBlock([...selection.anchor.path])
    const focusBlock = muya.editor.scrollPage?.queryBlock([...selection.focus.path])
    if (anchorBlock?.isContent() && focusBlock?.isContent()) {
      if (anchorBlock === focusBlock) {
        anchorBlock.setCursor(selection.anchor.offset, selection.focus.offset, true)
      } else {
        muya.editor.selection.setSelection(
          { block: anchorBlock, path: anchorBlock.path, offset: selection.anchor.offset },
          { block: focusBlock, path: focusBlock.path, offset: selection.focus.offset }
        )
      }
    }
  } else if (!unchanged) {
    const appliedEdit = outcome.change.appliedEdits.at(-1)
    if (appliedEdit !== undefined) {
      const caret = appliedEdit.start + appliedEdit.insert.length
      const binding =
        view.bindings.find(
          (item) => item.sourceRange.start <= caret && caret <= item.sourceRange.end
        ) ?? view.bindings.at(-1)
      if (binding !== undefined) {
        const block = muya.editor.scrollPage?.queryBlock([...binding.path])
        const segments = 'segments' in binding ? binding.segments : undefined
        const segment = segments?.find(
          (item) => item.source.start <= caret && caret <= item.source.end
        )
        const offset =
          segment === undefined
            ? Math.min(binding.text.length, Math.max(0, caret - binding.sourceRange.start))
            : segment.text.start + caret - segment.source.start
        if (block?.isContent()) block.setCursor(offset, offset, true)
      }
    }
  }
  if (outcome.inputResult !== undefined) {
    const current = muya.editor.selection.getSelection()?.anchor.block
    if (current?.blockName === 'paragraph.content' && current.domNode?.isConnected) {
      muya.eventCenter.emit('content-change', { block: current })
    }
  }
}
