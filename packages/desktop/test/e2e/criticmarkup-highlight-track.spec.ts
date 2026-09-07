import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost, expectEditorWindowHidden, expectNoRendererErrors,
  launchWithReviewMarkdown as launchWithMarkdown, placeCaretInEditor, sendIpcToRenderer
} from './helpers'

test('tracks continued typing inside a highlight and preserves its comment through save and history', async() => {
  const source = '{==word==}{>>note<<}\n'
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: undefined,
      MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
      MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  try {
    await page.getByTestId('critic-review-track-changes').click()
    await placeCaretInEditor(page)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('X')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await page.keyboard.type('Y')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('{==wo{++XY++}rd==}{>>note<<}\n')
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

for (const timing of ['settled', 'queued']) {
  for (const action of ['delete', 'replace'] as const) {
    test(`tracks ${action} inside a highlight (${timing}) and keeps following typing editable`, async() => {
      const { app, page, filePath } = await launchWithMarkdown('{==word==}{>>note<<}\n', {
        suppressErrorDialog: true,
        env: {
          MARKTEXT_DOCUMENT_CORE_MODE: undefined,
          MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
          MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: timing === 'queued' ? '1' : undefined,
          MARKTEXT_E2E_HIDDEN_WINDOW: '1'
        }
      })
      try {
        await page.getByTestId('critic-review-track-changes').click()
        await placeCaretInEditor(page)
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home')
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('Shift+ArrowRight')
        await page.keyboard.press('Shift+ArrowRight')
        expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('or')
        if (action === 'delete') await page.keyboard.press('Backspace')
        else await page.keyboard.type('X')
        if (timing === 'settled') await page.evaluate(() => window.__marktextDocumentCore?.settled())
        else expect(await page.evaluate(() => window.__marktextDocumentCore?.performanceEvents?.().some(event => event.phase === 'ack'))).toBe(false)
        await page.keyboard.type('Y')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(action === 'delete'
          ? '{==w{--or--}{++Y++}d==}{>>note<<}\n'
          : '{==w{~~or~>XY~~}d==}{>>note<<}\n')
        await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
        await expectEditorWindowHidden(app)
        expectEditorNotFrontmost(app)
        await expectNoRendererErrors(app)
      } finally {
        await app.close()
      }
    })
  }
}
