import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { launchWithMarkdown, placeCaretInEditor, sendIpcToRenderer } from './helpers'

// Upstream MarkText #5600 with the real keyboard: typing `~~~` and Enter makes
// a tilde-fenced code block that is saved with tildes and draws `~~~` in its
// active marker.
test('typing ~~~ + Enter makes and saves a tilde-fenced code block', async() => {
  const { app, page, filePath } = await launchWithMarkdown('\n')
  try {
    await placeCaretInEditor(page)
    await page.keyboard.type('~~~', { delay: 30 })
    await page.keyboard.press('Enter')

    const block = page.locator('.editor-component pre.mu-code-block.mu-fenced-code').first()
    await expect(block).toBeVisible({ timeout: 5000 })
    await expect(block).toHaveClass(/mu-tilde-fence/)
    await block.locator('.mu-codeblock-content').first().click()
    await expect.poll(() => block.evaluate(element => getComputedStyle(element, '::before').content))
      .toBe('"~~~"')

    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('~~~\n\n~~~\n')
  } finally {
    await app.close()
  }
})

test('a backtick fence keeps its backtick marker', async() => {
  const { app, page, filePath } = await launchWithMarkdown('\n')
  try {
    await placeCaretInEditor(page)
    await page.keyboard.type('```', { delay: 30 })
    await page.keyboard.press('Enter')

    const block = page.locator('.editor-component pre.mu-code-block.mu-fenced-code').first()
    await expect(block).toBeVisible({ timeout: 5000 })
    await expect(block).not.toHaveClass(/mu-tilde-fence/)

    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('```\n\n```\n')
  } finally {
    await app.close()
  }
})
