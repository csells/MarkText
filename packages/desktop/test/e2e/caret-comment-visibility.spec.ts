// Arrowing the caret into a comment must leave a VISIBLE caret. Comment markers
// render as hidden zero-width spans, so a caret landing at/inside one has a
// zero-height (invisible) rect. Regression guard for that: the caret must snap
// into the visible commented text.
import { expect, test } from '@playwright/test'
import { focusEditor, launchWithMarkdown, placeCaretInEditor } from './helpers'

const META = 'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119'

test('caret stays visible when arrowing right into a line-start comment', async() => {
  const md = `one\n\n<!--MC:a-->header<!--MC:~a--> ddd\n\n[MC:a]: ${META}\n`
  const { app, page } = await launchWithMarkdown(md, { suppressErrorDialog: true })
  const readSel = () => page.evaluate(() => {
    const sel = document.getSelection()
    if (!sel || sel.rangeCount === 0) return { inMarker: true, caretHeight: 0, anchorText: null }
    const node = sel.anchorNode
    const el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null)
    const range = sel.getRangeAt(0).cloneRange()
    range.collapse(true)
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
    return {
      inMarker: !!el?.closest('.mu-comment-marker'),
      caretHeight: rect ? Math.round(rect.height) : 0,
      anchorText: node?.textContent ?? null,
    }
  })
  try {
    await focusEditor(page)
    await placeCaretInEditor(page)
    // Caret at the end of "one", then arrow right into the comment that starts
    // the following paragraph.
    await page.locator('.mu-paragraph', { hasText: 'one' }).first().click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowRight')
    // The caret snap is the positive observable; poll it instead of a clock.
    await expect
      .poll(async() => (await readSel()).anchorText ?? '', { timeout: 5000 })
      .toContain('header')

    const sel = await readSel()
    expect(sel.inMarker).toBe(false)
    expect(sel.caretHeight).toBeGreaterThan(0)
    expect(sel.anchorText).toContain('header')
  } finally {
    await app.close()
  }
})
