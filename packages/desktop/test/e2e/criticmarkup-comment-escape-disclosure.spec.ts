import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown as launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

test('discloses MarkText-only escaping while a comment draft needs it', async() => {
  const { app, page, filePath } = await launchWithMarkdown('seed\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    const paragraph = page.locator('span.mu-paragraph-content').first()
    await paragraph.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await page.getByTestId('critic-review-add-comment').click()
    const input = page.getByTestId('critic-review-comment-input')
    const notice = page.getByTestId('critic-review-comment-escape-notice')
    await expect(input).toBeFocused()
    await page.keyboard.type('a plain note')
    await expect(notice).toHaveCount(0)
    await page.keyboard.type(' <<} b')
    await expect(notice).toHaveText(
      'Contains CriticMarkup-like text; MarkText escaped it with backslashes, which other CriticMarkup tools may show literally.'
    )
    await page.getByTestId('critic-review-comment-submit').click()
    await expect(input).not.toBeVisible()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(
      '{==seed==}{>>a plain note \\<<} b<<}\n'
    )

    // Editing shows the payload source, whose escape is already the author's.
    await page.getByTestId('critic-review-edit-comment').click()
    await expect(input).toHaveValue('a plain note \\<<} b')
    await expect(notice).toHaveCount(0)
    await input.focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('ends in C:\\')
    await expect(notice).toBeVisible()
    await page.getByTestId('critic-review-comment-submit').click()
    await expect(input).not.toBeVisible()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(
      '{==seed==}{>>ends in C:\\\\<<}\n'
    )
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})
