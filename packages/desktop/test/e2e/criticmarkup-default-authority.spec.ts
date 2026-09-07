import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  enterSourceMode, exitSourceMode, expectEditorNotFrontmost,
  expectEditorWindowHidden, expectNoRendererErrors, launchWithReviewMarkdown as launchWithMarkdown,
  sendIpcToRenderer, placeCaretInEditor
} from './helpers'

test('normal launch enables editable Review and exact history without feature or mutation flags', async() => {
  const { app, page, filePath } = await launchWithMarkdown('seed\n', {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: undefined,
      MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
      MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  try {
    expect(await page.evaluate(() => ({
      core: window.electron.process.env.MARKTEXT_DOCUMENT_CORE_MODE,
      controls: window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
    }))).toEqual({ core: undefined, controls: undefined })
    const tracking = page.getByTestId('critic-review-track-changes')
    await expect(tracking).toBeVisible()
    await tracking.click()
    await page.locator('.mu-paragraph-content').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' change')
    await enterSourceMode(page, app)
    await exitSourceMode(page, app)
    await expect(page.locator('.mu-paragraph-content').first()).toHaveText('seed change')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('seed{++ change++}\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('seed\n')
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('normal launch keeps quick-insert editable through heading creation and save', async() => {
  const { app, page, filePath } = await launchWithMarkdown('', {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: undefined,
      MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
      MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  try {
    await placeCaretInEditor(page)
    await page.keyboard.type('/')
    await page.locator('.mu-quick-insert [data-label="atx-heading 1"]').click()
    await expect(page.locator('.editor-component h1')).toBeVisible()
    await page.keyboard.type('Hello')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('# Hello')
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})
