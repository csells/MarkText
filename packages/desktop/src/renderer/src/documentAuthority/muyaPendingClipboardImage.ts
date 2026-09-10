import { PendingImage } from '@muyajs/core'
import type { Muya } from '@muyajs/core'
import type { MuyaMarkupView } from './muyaMarkupView'
import type { MuyaClipboardPreparation } from './muyaPlainTextCoreAdapter'
import { createMuyaModelSelection } from './muyaModelSelection'

/** The resource widget follows the prepared command's current model position. */
export function presentPendingClipboardImage(
  muya: Muya,
  preparation: Pick<MuyaClipboardPreparation, 'finished' | 'modelSelection'>,
  currentView: () => MuyaMarkupView | undefined,
  initialPayload: unknown
): (payload: unknown) => void {
  let widget: PendingImage | undefined
  let finished = false
  preparation.finished.then(() => {
    finished = true
    widget?.destroy()
  })
  const reference = {
    contextElement: muya.domNode,
    getBoundingClientRect(): DOMRect {
      const view = currentView()
      const selection = preparation.modelSelection()
      const bridge = view === undefined ? undefined : createMuyaModelSelection(muya, view)
      const primary = 'ranges' in selection ? selection.ranges[selection.primary] : undefined
      if ('ranges' in selection && primary === undefined) { throw new Error('Pending clipboard selection has no primary range') }
      const point =
        primary !== undefined
          ? bridge?.modelPointToDOM(Math.min(primary.anchor, primary.focus))
          : 'start' in selection
            ? bridge?.modelPointToDOM(selection.start)
            : selection.kind === 'table'
              ? bridge?.modelCellPointToDOM(
                {
                  kind: 'table-cell',
                  cell: { table: selection.table, ...selection.anchor },
                  anchor: 0,
                  focus: 0
                },
                0
              )
              : selection.kind === 'table-cell'
                ? bridge?.modelCellPointToDOM(
                  selection,
                  Math.min(selection.anchor, selection.focus)
                )
                : undefined
      if (point === undefined) return new DOMRect()
      const range = document.createRange()
      range.setStart(point.node, point.offset)
      range.collapse(true)
      return range.getBoundingClientRect()
    }
  }
  const present = (payload: unknown): void => {
    if (
      finished ||
      payload === null ||
      typeof payload !== 'object' ||
      !('imageSource' in payload) ||
      typeof payload.imageSource !== 'string'
    ) { return }
    widget ??= new PendingImage(muya)
    widget.present(payload.imageSource, reference)
  }
  present(initialPayload)
  return present
}
