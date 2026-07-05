// Adding a comment across a multi-paragraph selection must wrap the range in
// markers (open in the first block, close in the last). Regression guard for
// cross-block commenting; see comment-cross-block-keyboard.spec.ts for the
// menu-enabled-state bug that made "⌘⇧L does nothing" for keyboard selections.
import { expect, test } from '@playwright/test'
import { clickMenuById, focusEditor, launchWithMarkdown } from './helpers'

test('adding a comment across two paragraphs wraps the whole range', async() => {
  const md = 'hello world\n\nsecond line\n'
  const { app, page } = await launchWithMarkdown(md, { suppressErrorDialog: true })
  try {
    await focusEditor(page)
    // Select from inside "hello world" (para 1) through inside "second line"
    // (para 2) — a genuine cross-block selection.
    await page.evaluate(() => {
      const paras = [...document.querySelectorAll('.mu-paragraph')]
      const textNode = (root: Element, needle: string) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let n: Node | null
        // eslint-disable-next-line no-cond-assign
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
    await page.waitForTimeout(120)
    await clickMenuById(app, 'review.add-comment')
    await page.waitForTimeout(200)

    // Both paragraphs should now carry marker syntax (open in p1, close in p2).
    const texts = await page.evaluate(() =>
      [...document.querySelectorAll('.mu-paragraph')].map(p => p.textContent ?? ''))
    const joined = texts.join('\n')
    expect(joined, `after cross-block comment:\n${joined}`).toMatch(/<!--MC:[^>]+-->/)
    // Open marker in the first paragraph, close marker in the second.
    expect(texts.find(t => t.includes('hello'))).toMatch(/<!--MC:[^~][^>]*-->/)
    expect(texts.find(t => t.includes('second'))).toMatch(/<!--MC:~/)
  } finally {
    await app.close()
  }
})
