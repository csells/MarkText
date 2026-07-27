import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  closeElectron,
  clickMenuById,
  enterSourceMode,
  getMarkdownContent,
  launchWithMarkdown,
  waitForMenuReady
} from './helpers'

test.describe('External disk reload', () => {
  test('the first undo restores the pre-reload document', async() => {
    const { app, page, filePath } = await launchWithMarkdown('old content here\n')
    try {
      await waitForMenuReady(app)

      await writeFile(filePath, 'new content here\n', 'utf8')

      await expect
        .poll(async() => (await getMarkdownContent(page, app)).trim())
        .toBe('new content here')
      await expect
        .poll(() =>
          page.evaluate(() => !!document.querySelector('.editor-tabs li.unsaved'))
        )
        .toBe(false)

      await clickMenuById(app, 'editUndoMenuItem')

      await expect
        .poll(async() => (await getMarkdownContent(page, app)).trim())
        .toBe('old content here')
      await expect
        .poll(() =>
          page.evaluate(() => !!document.querySelector('.editor-tabs li.unsaved'))
        )
        .toBe(true)
    } finally {
      await closeElectron(app)
    }
  })

  test('a same-document reload preserves source-mode scroll position', async() => {
    const longBody = 'line\n'.repeat(400)
    const { app, page, filePath } = await launchWithMarkdown(longBody)
    try {
      await waitForMenuReady(app)
      await enterSourceMode(page, app)

      const captured = await page.evaluate(() => {
        const input = document.querySelector(
          '.source-code-input'
        ) as HTMLTextAreaElement | null
        if (input) input.scrollTop = 4000
        return input?.scrollTop ?? 0
      })
      expect(captured).toBeGreaterThan(0)

      await writeFile(filePath, longBody + 'tail line\n', 'utf8')

      await expect
        .poll(async() => (await getMarkdownContent(page, app)).trim().endsWith('tail line'))
        .toBe(true)
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const input = document.querySelector(
                '.source-code-input'
              ) as HTMLTextAreaElement | null
              return input?.scrollTop ?? 0
            }),
          { timeout: 4000 }
        )
        .toBeGreaterThan(captured * 0.5)
    } finally {
      await closeElectron(app)
    }
  })
})
