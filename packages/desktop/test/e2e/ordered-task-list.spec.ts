import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

// Upstream #5597: an ordered task list renders checkboxes and keeps its start,
// Enter continues it with the next number and an unchecked task, and a click
// on a checkbox checks it in place.
test('an ordered task list renders, continues on Enter and checks in place', async() => {
  const { app, page, filePath } = await launchWithMarkdown('5. [x] aaa\n')
  try {
    const list = page.locator('.editor-component ol.mu-task-list')
    await expect(list).toHaveAttribute('start', '5')
    await expect(list.locator('.mu-task-list-checkbox')).toHaveCount(1)
    const first = list.locator('span.mu-paragraph-content').first()
    await first.click()
    await page.keyboard.press('Meta+ArrowRight')
    await page.keyboard.press('Enter')
    await page.keyboard.type('b', { delay: 0 })
    await expect(list.locator('.mu-task-list-checkbox')).toHaveCount(2)
    await expect(list.locator('span.mu-paragraph-content').nth(1)).toHaveText('b')
    await list.locator('.mu-task-list-checkbox').nth(1).click()
    await expect(list.locator('.mu-checkbox-checked')).toHaveCount(2)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('5. [x] aaa\n6. [x] b\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})
