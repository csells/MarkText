/** Deliver the completed native input turn without waiting for a render frame. */
export function installMuyaInputDelivery(root: HTMLElement, flush: () => void): () => void {
  let active = true
  let scheduled = false
  const deliver = (): void => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (active) flush()
    })
  }
  root.addEventListener('input', deliver)
  return () => {
    active = false
    root.removeEventListener('input', deliver)
  }
}
