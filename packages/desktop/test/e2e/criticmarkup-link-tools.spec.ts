import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost, expectEditorWindowHidden, expectNoRendererErrors,
  launchWithMarkdown, sendIpcToRenderer
} from './helpers'

test('unlinks an annotated link through its native popover and restores it with one undo', async() => {
  const source = 'prefix {++[name](https://example.com)++} tail\n'
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await page.locator('.editor-component a.mu-link').hover()
    await page.locator('.mu-link-tools-container li.item.unlink').click()
    await expect(page.locator('span.mu-paragraph-content').first()).toHaveText('prefix name tail')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('prefix {++name++} tail\n')
    // Chromium keyboard injection does not invoke the hidden window's native
    // menu accelerator. Exercise the same command delivered by Edit > Undo.
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(page.locator('.editor-component a.mu-link')).toHaveText('name')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})
