import type { Muya } from '@muyajs/core'
import isEqual from 'lodash/isEqual'

import type { CoreAppliedReply } from './coreProtocol'
import type { MuyaPlainTextViewResult } from './muyaPlainTextView'
import type { MuyaMarkupDecoration } from './muyaMarkupView'
import { createMuyaModelSelection } from './muyaModelSelection'
import type {
  MuyaPlainTextAuthorSelection,
  MuyaPlainTextSourceBinding
} from './muyaPlainTextCoreAdapter'

/** Installs an acknowledged native view and restores its document selection. */
export function reconcileMuyaDocumentView({
  muya,
  view,
  outcome,
  sourcePosition,
  dirtyPaths,
  applyEditability
}: {
  muya: Muya
  view: MuyaPlainTextViewResult
  outcome: CoreAppliedReply
  sourcePosition?: (point: MuyaPlainTextAuthorSelection['focus']) => number | undefined
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
  const cellSelection = documentSelection?.kind === 'table-cell' ? documentSelection : undefined
  const modelTextSelection =
    documentSelection?.kind === 'model-text' ? documentSelection : undefined
  const inputSelection =
    (primaryRange === undefined
      ? undefined
      : { start: primaryRange.anchor, end: primaryRange.focus }) ?? outcome.authorResult?.selection
  const reconciledAnchor =
    inputSelection?.start ?? (selection === null ? undefined : sourcePosition?.(selection.anchor))
  const reconciledFocus =
    inputSelection?.end ?? (selection === null ? undefined : sourcePosition?.(selection.focus))
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
  const unchanged = 'state' in view && isEqual(muya.getState(), view.state)
  if (!unchanged) {
    muya.setContent(
      'state' in view
        ? (structuredClone([...view.state]) as Parameters<Muya['setContent']>[0])
        : view.markdown,
      false,
      {
        preserveInputGrouping: true
      }
    )
  }
  applyEditability(view.bindings)
  if (unchanged) {
    // Native composition can mutate browser DOM without changing the view state.
    // A same-source input result (including cancellation) must reinstall that
    // acknowledged presentation before restoring its model-owned selection.
    const paths =
      outcome.inputResult === undefined ? dirtyPaths : view.bindings.map((binding) => binding.path)
    for (const path of paths) {
      const block = muya.editor.scrollPage?.queryBlock([...path])
      if (block?.isContent()) block.update()
    }
  }
  if (documentSelection?.kind === 'table') {
    if (!('state' in view)) { throw new Error('Core table selection requires its model-owned native projection') }
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
        if (!node?.isConnected) { throw new Error('The accepted model table selection has no native cell boundary') }
        if (row === documentSelection.anchor.row && column === documentSelection.anchor.column) { primary = ranges.length }
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
    const domPoint = (edge: 'anchor' | 'focus') =>
      cellSelection !== undefined
        ? modelCellPointToDOM(cellSelection, cellSelection[edge])
        : modelPointToDOM(
          modelTextSelection?.[edge] ?? inputSelection![edge === 'anchor' ? 'start' : 'end']
        )
    const textPoint = (edge: 'anchor' | 'focus') =>
      cellSelection !== undefined
        ? modelCellPointToText(cellSelection, cellSelection[edge])
        : modelPointToText(
          modelTextSelection?.[edge] ?? inputSelection![edge === 'anchor' ? 'start' : 'end']
        )
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
  } else if (
    (inputSelection !== undefined || !unchanged) &&
    reconciledAnchor !== undefined &&
    reconciledFocus !== undefined
  ) {
    const endpoint = (source: number) => {
      // Elided annotation delimiters and comment bodies still have model-owned
      // boundary positions. Their existing render anchors map those boundaries
      // even when no visible text segment remains.
      if ('state' in view) {
        const comment = view.comments.find(
          (item) => item.annotationRange.start === source || item.annotationRange.end === source
        )
        const opening = view.decorations.find((item) => item.mark.annotationRange.start === source)
        let closing: MuyaMarkupDecoration | undefined
        for (const item of view.decorations) {
          if (item.mark.annotationRange.end === source) closing = item
        }
        const marker = comment ?? opening ?? closing
        const offset = comment?.offset ?? opening?.range.start ?? closing?.range.end
        if (marker !== undefined && offset !== undefined) {
          const block = muya.editor.scrollPage?.queryBlock([...marker.path])
          if (block?.isContent()) return { block, path: block.path, offset }
        }
      }
      for (const binding of view.bindings) {
        const segments =
          'segments' in binding
            ? binding.segments
            : [{ text: { start: 0, end: binding.text.length }, source: binding.sourceRange }]
        const segment = segments.find(
          (item) => item.source.start <= source && source <= item.source.end
        )
        // Empty model leaves have a caret boundary but no text segment.
        const emptyCaret = binding.text.length === 0 && source === binding.sourceRange.end
        if (segment === undefined && !emptyCaret) continue
        const block = muya.editor.scrollPage?.queryBlock([...binding.path])
        if (block?.isContent()) {
          return {
            block,
            path: block.path,
            offset:
              segment === undefined
                ? 0
                : source === segment.source.end
                  ? segment.text.end
                  : segment.text.start + source - segment.source.start
          }
        }
      }
      return undefined
    }
    const anchor = endpoint(reconciledAnchor)
    const focus = endpoint(reconciledFocus)
    if (anchor !== undefined && focus !== undefined) {
      muya.editor.selection.setSelection(anchor, focus)
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
