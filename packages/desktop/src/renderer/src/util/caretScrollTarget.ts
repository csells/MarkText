/** Native caret rectangles and editor bounds must share viewport coordinates. */
export const caretScrollTarget = (
  viewport: Readonly<{ top: number; height: number; scrollTop: number }>,
  caretY: number
): number => {
  const localY = caretY - viewport.top
  const margin = Math.min(100, viewport.height / 2)
  const delta = localY < margin
    ? localY - margin
    : localY > viewport.height - margin ? localY - viewport.height + margin : 0
  return Math.max(0, viewport.scrollTop + delta)
}
