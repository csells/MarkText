export interface ProjectedSelectionClipboardPayload {
  readonly text: string
  readonly html: string
}

export function installProjectedSelectionClipboardGuard(
  target: EventTarget,
  payload: () => ProjectedSelectionClipboardPayload | undefined
): () => void {
  const guard = (event: Event): void => {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.type !== 'copy') return
    const projected = payload()
    const clipboardData = (event as ClipboardEvent).clipboardData
    if (projected === undefined || clipboardData === null) return
    clipboardData.setData('text/plain', projected.text)
    clipboardData.setData('text/html', projected.html)
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
