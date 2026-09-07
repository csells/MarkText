import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost, expectEditorWindowHidden, expectNoRendererErrors,
  launchElectron, launchWithReviewMarkdown as launchWithMarkdown, sendIpcToRenderer, waitForEditor, waitForMenuReady
} from './helpers'

const options = {
  suppressErrorDialog: true,
  env: {
    MARKTEXT_DOCUMENT_CORE_MODE: undefined,
    MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
    MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
    MARKTEXT_E2E_HIDDEN_WINDOW: '1'
  }
}

for (const anchored of [true, false]) {
  test(`edits a visible nested Comment through history and reopen, anchored=${anchored}`, async() => {
    const source = anchored
      ? 'A {==outer {==text==}{>>note<<}==} Z\n'
      : 'A {==outer {>>note<<} tail==} Z\n'
    const edited = source.replace('{>>note<<}', '{>>new **note**<<}')
    const { app, page, filePath } = await launchWithMarkdown(source, options)
    let reopened: Awaited<ReturnType<typeof launchElectron>> | undefined
    try {
      await page.getByTestId('critic-review-edit-comment').click()
      const input = page.getByTestId('critic-review-comment-input')
      await expect(input).toHaveValue('note')
      await input.fill('new **note**')
      await page.getByTestId('critic-review-comment-submit').click()
      await expect(input).not.toBeVisible()
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(edited)
      for (const [action, expected] of [['undo', source], ['redo', edited]] as const) {
        await sendIpcToRenderer(app, 'mt::editor-edit-action', action)
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
      }
      await expectNoRendererErrors(app)
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      await app.close()
      reopened = await launchElectron([filePath], options)
      await waitForEditor(reopened.page)
      await waitForMenuReady(reopened.app)
      await reopened.page.getByRole('button', { name: 'Review', exact: true }).click()
      await reopened.page.getByTestId('critic-review-edit-comment').click()
      await expect(reopened.page.getByTestId('critic-review-comment-input')).toHaveValue('new **note**')
      await reopened.page.getByTestId('critic-review-comment-cancel').click()
      await expectNoRendererErrors(reopened.app)
      await expectEditorWindowHidden(reopened.app)
      expectEditorNotFrontmost(reopened.app)
    } finally {
      await (reopened?.app ?? app).close().catch(() => {})
    }
  })
}
