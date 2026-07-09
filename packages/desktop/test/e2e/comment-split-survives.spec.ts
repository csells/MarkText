// Regression: pressing Enter to split a paragraph at or before a commented
// span used to silently delete the whole comment thread while the commented
// text survived in the new paragraph (the anchors sat in the split-off suffix
// and the transform collapsed + pruned them). The comment must ride its text
// into the new block.
import { expect, test } from '@playwright/test'
import { focusEditor, getMarkdownContent, launchWithMarkdown } from './helpers'

test('splitting a paragraph before a comment keeps the comment', async() => {
  const md = [
    'Hello <!--MC:a-->reviewed<!--MC:~a--> world.',
    '',
    '[MC:a]: {"version":2,"status":"open"}',
    ''
  ].join('\n')
  const { app, page } = await launchWithMarkdown(md)
  try {
    await focusEditor(page)

    // Caret at offset 3 of the paragraph ("Hel|lo …"), before the comment.
    await page.locator('.mu-paragraph', { hasText: 'reviewed' }).first().click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')

    await page.keyboard.press('Enter')

    // The comment markers AND its metadata must survive the split — the thread
    // rode "reviewed" into the new paragraph.
    await expect
      .poll(() => getMarkdownContent(page), { timeout: 5000 })
      .toContain('<!--MC:a-->reviewed<!--MC:~a-->')
    const markdown = await getMarkdownContent(page)
    expect(markdown).toContain('[MC:a]:')
  } finally {
    await app.close()
  }
})
