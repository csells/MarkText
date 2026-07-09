// Adding a comment across a multi-paragraph selection must wrap the range in
// markers (open in the first block, close in the last). Regression guard for
// cross-block commenting; see comment-cross-block-keyboard.spec.ts for the
// menu-enabled-state bug that made "⌘⇧L does nothing" for keyboard selections.
import { expect, test } from '@playwright/test'
import { clickMenuById, focusEditor, getMarkdownContent, launchWithMarkdown } from './helpers'
import { waitForMenuItemEnabled } from './portable-comments-fixtures'

test('adding a comment across two paragraphs wraps the whole range', async() => {
  const md = 'hello world\n\nsecond line\n'
  const { app, page } = await launchWithMarkdown(md)
  try {
    await focusEditor(page)
    // Select from inside "hello world" (para 1) through inside "second line"
    // (para 2) — a genuine cross-block selection.
    await page.evaluate(() => {
      const paras = [...document.querySelectorAll('.mu-paragraph')]
      const textNode = (root: Element, needle: string) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let n: Node | null

        while ((n = w.nextNode())) if ((n.textContent ?? '').includes(needle)) return n
        return null
      }
      const p1 = paras.find(p => p.textContent?.includes('hello'))!
      const p2 = paras.find(p => p.textContent?.includes('second'))!
      const t1 = textNode(p1, 'hello')!
      const t2 = textNode(p2, 'second')!
      const sel = document.getSelection()!
      const range = document.createRange()
      range.setStart(t1, 6) // before "world"
      range.setEnd(t2, 6) // after "second"
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    // The engine committing the selection is observable as menu enablement.
    expect(await waitForMenuItemEnabled(app, 'review.add-comment', true)).toBe(true)
    await clickMenuById(app, 'review.add-comment')

    // Markers exist only in the SERIALIZED document (the runtime is clean);
    // the open marker lands in the first paragraph, the close in the second.
    await expect
      .poll(() => getMarkdownContent(page), { timeout: 5000 })
      .toMatch(/<!--MC:[^>]+-->/)
    const markdown = await getMarkdownContent(page)
    expect(markdown).toMatch(/hello <!--MC:[^~][^>]*-->world/)
    expect(markdown).toMatch(/second<!--MC:~[^>]*--> line/)
    // The rendered document never shows MC bytes.
    expect(await page.evaluate(() => document.querySelector('.editor-component')?.textContent ?? '')).not.toContain('MC:')
  } finally {
    await app.close()
  }
})
