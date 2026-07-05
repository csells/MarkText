// The comment box is non-modal: closing it (submit or Esc) returns DOM focus to
// the editor WITHOUT changing the editor's selection. In particular, if the user
// moved/edited in the document while the box was open, dismissing the box must
// NOT restore an old selection — it leaves the editor exactly as the user left
// it. And focus must land back in the editor, not stay in the textarea.
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { clickMenuById, focusEditor, launchWithMarkdown } from './helpers'

const state = (page: Page) => page.evaluate(() => {
  const sel = document.getSelection()
  const node = sel?.anchorNode ?? null
  const el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null)
  return {
    activeIsTextarea: document.activeElement?.tagName === 'TEXTAREA',
    inEditor: !!el?.closest('.mu-editor, [contenteditable="true"]'),
    anchorParagraph: el?.closest('.mu-paragraph')?.textContent ?? null,
    anchorOffset: sel?.anchorOffset ?? -1,
  }
})

async function selectWorldThenComment(page: Page, app: ElectronApplication) {
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.mu-paragraph')].find(el => el.textContent?.includes('hello'))!
    const t = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode()!
    const sel = document.getSelection()!
    const r = document.createRange()
    r.setStart(t, 6); r.setEnd(t, 11)
    sel.removeAllRanges(); sel.addRange(r)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await clickMenuById(app, 'review.add-comment')
  await page.waitForTimeout(200)
}

test('dismissing the comment box does not clobber the editor selection the user moved to', async() => {
  const { app, page } = await launchWithMarkdown('hello world\n\nsecond line\n', { suppressErrorDialog: true })
  try {
    await focusEditor(page)
    await selectWorldThenComment(page, app)

    // While the (non-modal) box is open, the user clicks back into the doc and
    // puts the caret in the SECOND paragraph (a real click so the engine caches
    // the new selection, as it would in the app).
    await page.locator('.mu-paragraph', { hasText: 'second' }).first().click()
    await page.waitForTimeout(80)

    // Now submit the comment from the box.
    const box = page.locator('.reply-box textarea').first()
    await box.fill('a note')
    await box.press('Meta+Enter')
    await page.waitForTimeout(200)

    const s = await state(page)
    // eslint-disable-next-line no-console
    console.log('after submit (moved to 2nd para):', JSON.stringify(s))
    expect(s.activeIsTextarea, 'focus should leave the compose box').toBe(false)
    expect(s.inEditor, 'focus should return to the editor').toBe(true)
    // The caret must stay where the user put it (2nd paragraph), NOT be restored
    // to the commented word.
    expect(s.anchorParagraph, 'the editor selection must not be clobbered').toContain('second')
  } finally {
    await app.close()
  }
})

test('Esc closes the compose box, discards the new comment, and returns focus to the editor', async() => {
  const { app, page } = await launchWithMarkdown('hello world\n\nsecond line\n', { suppressErrorDialog: true })
  try {
    await focusEditor(page)
    await selectWorldThenComment(page, app)
    const box = page.locator('.reply-box textarea').first()
    await box.press('Escape')
    await page.waitForTimeout(200)

    const s = await state(page)
    const text = await page.evaluate(() =>
      [...document.querySelectorAll('.mu-paragraph')].map(p => p.textContent ?? '').join('\n'))
    expect(s.activeIsTextarea, 'the compose box should be closed').toBe(false)
    expect(s.inEditor, 'focus should return to the editor').toBe(true)
    expect(text.includes('<!--MC:'), 'Esc discards the brand-new comment markers').toBe(false)
  } finally {
    await app.close()
  }
})
