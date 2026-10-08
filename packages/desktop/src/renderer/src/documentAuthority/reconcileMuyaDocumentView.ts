import type { IReconcileRegion, Muya } from '@muyajs/core'
import type { DocumentSelection, DocumentTableCellSelection } from '@marktext/document-core'
import { asMuyaStates, type MuyaMarkupState, type MuyaMarkupView } from './muyaMarkupView'
import isEqual from 'lodash/isEqual'

import type { CoreAppliedReply } from './coreProtocol'
import { createMuyaModelSelection } from './muyaModelSelection'
import {
  muyaViewBindingsInRoots,
  muyaViewBindingsNear,
  muyaViewFindNear,
  muyaViewItemAtPath,
  muyaViewLastBinding
} from './muyaMarkupViewLookup'

/**
 * Editors presenting lines or cell padding that their acknowledged view does
 * not hold, until a whole-document reconcile replaces them.
 */
const presentingUnownedText = new WeakSet<Muya>()

/** Presents `state`, which differs from the acknowledged view it was cloned from. */
function presentDeviation(muya: Muya, state: MuyaMarkupState[]): void {
  presentingUnownedText.add(muya)
  muya.reconcileContent(asMuyaStates(state))
}

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
  const missing = [...new Set(points)].filter((point) => modelPointToDOM(point) === undefined)
  const unowned = missing.map((point) => snapCaret(point) ?? point)
  if (unowned.length === 0) return
  // Only bindings of roots around the points can own their lines.
  const near = [
    ...muyaViewBindingsNear(view, Math.min(...missing, ...unowned), Math.max(...missing, ...unowned))
  ]
  const blank = near.filter(
    (binding) =>
      binding.blankLineText !== undefined &&
      missing.some(
        (point) =>
          point > binding.sourceRange.end &&
          point <= binding.sourceRange.end + (binding.blankLineText?.length ?? 0)
      )
  )
  const trailing = near.filter(
    (binding) =>
      binding.trailingLinePosition !== undefined && unowned.includes(binding.trailingLinePosition)
  )
  // A blank line between two paragraphs ends the first before it begins the second.
  const leading = near.filter(
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
  presentDeviation(muya, state)
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
  if (points.length === 0) return
  const lines: NonNullable<MuyaMarkupView['bindings'][number]['markerLine']>[] = []
  for (const { markerLine: line, text } of muyaViewBindingsNear(
    view,
    Math.min(...points),
    Math.max(...points)
  )) {
    if (
      line !== undefined &&
      points.some(
        (point) =>
          line.start <= point &&
          (point < line.content ||
            (text === '' &&
              point <= line.end &&
              !/[ \t]$/u.test(line.text.slice(0, line.content - line.start))))
      )
    ) {
      lines.push(line)
    }
  }
  if (lines.length === 0) return
  const state = structuredClone([...view.state]) as MuyaMarkupState[]
  for (const line of lines) {
    replaceState(state, line.statePath, { name: 'paragraph', text: line.text })
  }
  presentDeviation(muya, state)
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
  const binding = muyaViewFindNear(
    view,
    'bindings',
    selection.cell.table.start,
    selection.cell.table.start,
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
  presentDeviation(muya, state)
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
    const minRow = Math.min(documentSelection.anchor.row, documentSelection.focus.row)
    const maxRow = Math.max(documentSelection.anchor.row, documentSelection.focus.row)
    const minColumn = Math.min(documentSelection.anchor.column, documentSelection.focus.column)
    const maxColumn = Math.max(documentSelection.anchor.column, documentSelection.focus.column)
    const ranges = []
    let primary = 0
    for (let row = minRow; row <= maxRow; row++) {
      for (let column = minColumn; column <= maxColumn; column++) {
        const binding = muyaViewFindNear(
          view,
          'bindings',
          documentSelection.table.start,
          documentSelection.table.start,
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
    const { modelPointToDOM, modelPointToText, modelCellPointToDOM, modelCellPointToText, projectSourcePoint } =
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
    // A caret's two ends are one point.
    let focus = collapsed ? anchor : domPoint('focus')
    const insideImage = (point: typeof anchor) => {
      const element = point?.node instanceof Element ? point.node : point?.node.parentElement
      return element?.closest('.mu-inline-image[contenteditable="false"]') != null
    }
    const anchorText = textPoint('anchor')
    const focusText = collapsed ? anchorText : textPoint('focus')
    // As after Muya's own edits, a caret within one leaf shows the markers of
    // the syntax it is in, so present that leaf with it before placing the
    // browser selection. Source history can also select the interior of an
    // atomic widget, whose hidden source cannot receive native keys.
    const caretLeaf =
      anchorText !== undefined && focusText !== undefined && isEqual(anchorText.path, focusText.path)
        ? muya.editor.scrollPage?.queryBlock([...anchorText.path])
        : undefined
    // Only inline presentation draws hidden syntax or images. A code block's
    // highlighting draws neither, and scanning a long one costs every key.
    const mayHideSyntax = caretLeaf?.blockName !== 'codeblock.content'
    if (
      insideImage(anchor) ||
      insideImage(focus) ||
      (mayHideSyntax &&
        caretLeaf?.domNode?.querySelector('.mu-hide, .mu-gray, .mu-inline-image') != null)
    ) {
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
    // A caret in hidden syntax with no text of its own (a paragraph broken
    // inside one's own Addition leaves only the arm's end on the new line)
    // shows at the nearest rendered model boundary.
    if (
      (anchor === undefined || focus === undefined) &&
      collapsed &&
      inputSelection !== undefined &&
      cellSelection === undefined &&
      modelTextSelection === undefined
    ) {
      // Resolve through text so the caret stays on the line that follows.
      const shown = modelPointToText(projectSourcePoint(inputSelection.start))
      anchor = focus = shown === undefined ? undefined : (muya.editor.selection.getDOMPoint(shown) ?? undefined)
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
  applyEditability,
  region
}: {
  muya: Muya
  view: MuyaMarkupView
  outcome: CoreAppliedReply
  dirtyPaths: Iterable<readonly (string | number)[]>
  applyEditability: (
    view: MuyaMarkupView,
    roots?: readonly [number, number],
    items?: readonly [number, number]
  ) => void
  /**
   * The only roots whose presentation can differ from `view` since the
   * editor last presented a view; other roots are neither read nor replaced.
   */
  region?: IReconcileRegion
}): void {
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
  // The native selection is kept only where the outcome selects nothing.
  const selection = documentSelection === undefined && inputSelection === undefined ? muya.getSelection() : null
  // A native structural command may differ only in container metadata (for
  // example a one-item list's loose flag). Replacing that presentation must
  // retain the native caret when both endpoint leaves still have the same text.
  const retainSelection =
    selection !== null &&
    [selection.anchor, selection.focus].every((endpoint) => {
      const binding = muyaViewItemAtPath(view, 'bindings', endpoint.path)
      return (
        binding !== undefined &&
        binding.text === endpoint.block.text &&
        endpoint.offset <= binding.text.length
      )
    })
  // Presented unowned text can sit in any root; only a whole reconcile finds it.
  const regional = region !== undefined && !presentingUnownedText.has(muya)
  if (!regional) presentingUnownedText.delete(muya)
  const unchanged = !muya.reconcileContent(
    asMuyaStates(view.state),
    regional ? region : undefined
  )
  applyEditability(
    view,
    regional ? [region.start, region.nextEnd] : undefined,
    regional && region.items !== undefined ? [region.items.start, region.items.nextEnd] : undefined
  )
  // A retained root can have changed inline meaning without changed native
  // state, such as a reference resolved by an edited definition elsewhere.
  // Native composition can also mutate DOM without changing the view state.
  // A regional view changed no other root's meaning.
  const paths =
    unchanged && outcome.inputResult !== undefined
      ? (regional
        ? muyaViewBindingsInRoots(view, region.start, region.nextEnd)
        : view.bindings
      ).map((binding) => binding.path)
      : dirtyPaths
  for (const path of paths) {
    const block = muya.editor.scrollPage?.queryBlock([...path])
    if (block?.isContent()) block.update()
  }
  if (documentSelection !== undefined || inputSelection !== undefined) {
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
        muyaViewFindNear(
          view,
          'bindings',
          caret,
          caret,
          (item) => item.sourceRange.start <= caret && caret <= item.sourceRange.end
        ) ?? muyaViewLastBinding(view)
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
