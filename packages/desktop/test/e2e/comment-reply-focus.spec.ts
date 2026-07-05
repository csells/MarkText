// Replying to a thread that already has a comment must, after submit, return
// focus to the document and clear the reply box — not re-open/re-focus the box
// for "another reply".
import { expect, test } from '@playwright/test'
import { focusEditor, launchWithMarkdown, selectWorldThenComment } from './helpers'

test('submitting a reply returns focus to the editor and clears the reply box', async() => {
  const { app, page } = await launchWithMarkdown('hello world\n\nsecond line\n', { suppressErrorDialog: true })
  try {
    await focusEditor(page)
    // Add a comment on "world" and submit the comment body (first reply).
    await selectWorldThenComment(page, app)
    let box = page.locator('.reply-box textarea').first()
    await box.fill('hello!')
    await box.press('Meta+Enter')
    await page.waitForTimeout(250)

    // Now reply AGAIN to the same (now non-composing) thread — the scenario.
    box = page.locator('.reply-box textarea').first()
    await box.click()
    await box.fill('greetings')
    await box.press('Meta+Enter')
    await page.waitForTimeout(300)

    const s = await page.evaluate(() => ({
      activeIsTextarea: document.activeElement?.tagName === 'TEXTAREA',
      inEditor: (() => {
        const n = document.getSelection()?.anchorNode
        const el = n && n.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element | null)
        return !!el?.closest('.mu-editor, [contenteditable="true"]')
      })(),
      replyBoxText: document.querySelector<HTMLTextAreaElement>('.reply-box textarea')?.value ?? null,
    }))
    expect(s.activeIsTextarea, 'focus should return to the editor, not stay in the reply box').toBe(false)
    expect(s.inEditor, 'the caret should be in the editor').toBe(true)
    expect(s.replyBoxText, 'the reply box should be cleared after submit').toBe('')
  } finally {
    await app.close()
  }
})
