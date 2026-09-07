/** Browser-side geometry check: a normal label word must remain on one line. */
export const reviewActionWordBreaks = (panel: Element): string[] => {
  const broken: string[] = []
  const actions = panel.querySelectorAll('.core-review-item-actions button')
  if (actions.length === 0) throw new Error('No review actions to measure')
  for (const button of actions) {
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      for (const match of (node.textContent ?? '').matchAll(/\S+/gu)) {
        const range = document.createRange()
        range.setStart(node, match.index)
        range.setEnd(node, match.index + match[0].length)
        const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)))
        if (lines.size > 1) broken.push(match[0])
      }
    }
  }
  return broken
}
