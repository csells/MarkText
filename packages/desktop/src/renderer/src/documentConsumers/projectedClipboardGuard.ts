export interface ProjectedSelectionClipboardPayload {
  readonly text: string
  readonly html: string
}

export type ProjectedSelectionClipboardOperation = 'copy' | 'cut'

export function installProjectedSelectionClipboardGuard(
  target: EventTarget,
  payload: () => ProjectedSelectionClipboardPayload | undefined,
  onCut?: () => void,
  onPayloadMissing?: (operation: ProjectedSelectionClipboardOperation) => void
): () => void {
  const guard = (event: Event): void => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const projected = payload()
    const clipboardData = (event as ClipboardEvent).clipboardData
    if (projected === undefined) {
      onPayloadMissing?.(event.type as ProjectedSelectionClipboardOperation)
      return
    }
    if (clipboardData === null) return
    clipboardData.setData('text/plain', projected.text)
    clipboardData.setData('text/html', projected.html)
    if (event.type === 'cut') onCut?.()
  }
  target.addEventListener('copy', guard, { capture: true })
  target.addEventListener('cut', guard, { capture: true })
  return () => {
    target.removeEventListener('copy', guard, { capture: true })
    target.removeEventListener('cut', guard, { capture: true })
  }
}

/**
 * Prevents a Core-backed editor from silently falling through to Muya/DOM
 * selection serialization while no selection-scoped Core projection exists.
 */
export const installUnprovenSelectionClipboardGuard = (
  target: EventTarget
): (() => void) => installProjectedSelectionClipboardGuard(target, () => undefined)
