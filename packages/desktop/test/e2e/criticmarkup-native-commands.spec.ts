import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

for (const entry of ['context menu', 'command palette', 'keyboard shortcut']) {
  test(`${entry} authors a comment on the preserved document selection`, async() => {
    const { app, page, filePath } = await launchWithMarkdown('A selected passage.\n', {
      suppressErrorDialog: true,
      env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
    })
    try {
      const paragraph = page.locator('.mu-paragraph-content').first()
      await paragraph.click()
      await page.keyboard.press('Home')
      await page.keyboard.press('Shift+End')
      if (entry === 'context menu') {
        // Inspect and invoke the real menu without opening an OS popup on the user's desktop.
        await app.evaluate(({ Menu, BrowserWindow }) => {
          Menu.prototype.popup = function() {
            const item = this.getMenuItemById('critic-add-comment')
            const win = BrowserWindow.getAllWindows()[0]
            if (!item?.enabled) throw new Error('Context comment action is missing or disabled')
            item.click(undefined, win, win?.webContents)
          }
        })
        await paragraph.click({ button: 'right' })
      } else if (entry === 'command palette') {
        await sendIpcToRenderer(app, 'mt::show-command-palette')
        const input = page.locator('input.search').first()
        await input.pressSequentially('Add comment')
        await page.keyboard.press('Enter')
      } else {
        test.skip(process.platform !== 'darwin', 'This finishing pass targets the macOS shortcut')
        // CDP keyboard injection bypasses Electron's before-input-event, where
        // MarkText's existing shortcut manager runs. Inject at Electron's input boundary.
        await app.evaluate(({ BrowserWindow }) => {
          const webContents = BrowserWindow.getAllWindows()[0].webContents
          webContents.sendInputEvent({ type: 'keyDown', keyCode: 'M', modifiers: ['meta', 'alt', 'shift'] })
          webContents.sendInputEvent({ type: 'keyUp', keyCode: 'M', modifiers: ['meta', 'alt', 'shift'] })
        })
      }
      const composer = page.getByTestId('critic-review-comment-input')
      await expect(composer).toBeVisible()
      await composer.fill(`From ${entry}.`)
      await page.getByTestId('critic-review-comment-submit').click()
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(`{==A selected passage.==}{>>From ${entry}.<<}\n`)
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
      await expectNoRendererErrors(app)
    } finally { await app.close() }
  })
}

for (const action of [
  { id: 'add-comment', result: '{==A selected passage.==}{>>Toolbar note.<<}\n', composer: 'comment', text: 'Toolbar note.' },
  { id: 'mark-highlight', result: '{==A selected passage.==}\n' },
  { id: 'mark-addition', result: '{++A selected passage.++}\n' },
  { id: 'suggest-replacement', result: '{~~A selected passage.~>New wording.~~}\n', composer: 'replacement', text: 'New wording.' }
]) {
  test(`inline selection toolbar ${action.id} preserves exact source and undo`, async() => {
    const original = 'A selected passage.\n'
    const { app, page, filePath } = await launchWithMarkdown(original, {
      suppressErrorDialog: true,
      env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
    })
    try {
      await page.locator('.mu-paragraph-content').first().click()
      await page.keyboard.press('Home')
      await page.keyboard.press('Shift+End')
      const button = page.locator(`.mu-format-picker button[data-action="${action.id}"]`)
      await expect(button).toBeVisible()
      await button.click()
      if (action.composer) {
        await page.getByTestId(`critic-review-${action.composer}-input`).fill(action.text!)
        await page.getByTestId(`critic-review-${action.composer}-submit`).click()
      }
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(action.result)
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(original)
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
      await expectNoRendererErrors(app)
    } finally { await app.close() }
  })
}
