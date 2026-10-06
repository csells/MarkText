import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

// Upstream #5555: a delimiter run that closes one emphasis and opens the next
// pairs by its original length, as cmark does. Typing the last `*` of
// `*foo***bar*` with the real keyboard makes both emphases.
test('typing the closing asterisk of *foo***bar* renders two emphases', async() => {
  const { app, page, filePath } = await launchWithMarkdown('*foo***bar\n')
  try {
    const paragraph = page.locator('.editor-component span.mu-paragraph-content').first()
    await expect(paragraph).toContainText('bar')
    await paragraph.click()
    await page.keyboard.press('Meta+ArrowRight')
    await page.keyboard.type('*', { delay: 0 })
    await expect(paragraph.locator('em')).toHaveCount(2)
    await expect(paragraph.locator('em').nth(0)).toHaveText('foo')
    await expect(paragraph.locator('em').nth(1)).toHaveText('bar')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('*foo***bar*\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})
