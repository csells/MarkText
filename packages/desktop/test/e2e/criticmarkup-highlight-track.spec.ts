import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown as launchWithMarkdown,
  placeCaretInEditor,
  sendIpcToRenderer
} from './helpers'

// Google Docs keeps text typed at the edge of commented text out of the
// comment (plan 0012 G39), so tracked typing there follows the comment.
test('tracks typing at the end of commented text after its comment through save and history', async() => {
  const source = '{==word==}{>>note<<}\n'
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  try {
    await page.getByTestId('critic-review-track-changes').click()
    await placeCaretInEditor(page)
    // End lands after the comment marker; ArrowLeft reaches the highlight's end.
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('X')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await page.keyboard.type('Y')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('{==word==}{>>note<<}{++XY++}\n')
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

// Core acknowledges each native operation synchronously; 'consecutive' types
// the next key without first waiting for the editor to settle.
for (const timing of ['settled', 'consecutive']) {
  for (const action of ['delete', 'replace'] as const) {
    test(`tracks ${action} inside a highlight (${timing}) and keeps following typing editable`, async() => {
      const { app, page, filePath } = await launchWithMarkdown('{==word==}{>>note<<}\n', {
        suppressErrorDialog: true,
        env: {
          MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
          MARKTEXT_E2E_HIDDEN_WINDOW: '1'
        }
      })
      try {
        await page.getByTestId('critic-review-track-changes').click()
        await placeCaretInEditor(page)
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home')
        // The line start is before the highlight's hidden opener, as upstream
        // places it before literal `{==`. The first ArrowRight enters the
        // highlight without moving visibly; the second passes `w`.
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('Shift+ArrowRight')
        await page.keyboard.press('Shift+ArrowRight')
        expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('or')
        if (action === 'delete') await page.keyboard.press('Backspace')
        else await page.keyboard.type('X')
        if (timing === 'settled') {
          await page.evaluate(() => window.__marktextDocumentCore?.settled())
        }
        await page.keyboard.type('Y')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect
          .poll(() => readFileSync(filePath, 'utf8'))
          .toBe(
            action === 'delete'
              ? '{==w{--or--}{++Y++}d==}{>>note<<}\n'
              : '{==w{~~or~>XY~~}d==}{>>note<<}\n'
          )
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
