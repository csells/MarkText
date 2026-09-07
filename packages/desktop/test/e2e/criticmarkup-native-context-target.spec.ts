import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expectEditorWindowHidden, expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

for (const command of ['critic-accept', 'critic-edit-comment']) {
  test(`right-click inside an anchored comment routes ${command} to its own target`, async() => {
    const original = 'First {--old--}.\n\n{==outer {++inner++} text==}{>>Outer note<<}\n'
    const { app, page, filePath } = await launchWithMarkdown(original, {
      suppressErrorDialog: true,
      env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
    })
    try {
      // Capture the actual native menu without presenting an OS popup.
      await app.evaluate(({ Menu, BrowserWindow }) => {
        const state = globalThis as unknown as {
          reviewContextItems: Record<string, boolean>
          reviewContextClick: (id: string) => void
        }
        Menu.prototype.popup = function() {
          state.reviewContextItems = Object.fromEntries(['critic-accept', 'critic-reject', 'critic-edit-comment'].map(id => [id, this.getMenuItemById(id)?.enabled === true]))
          state.reviewContextClick = (id) => {
            const item = this.getMenuItemById(id)
            const win = BrowserWindow.getAllWindows()[0]
            if (!item?.enabled) throw new Error(`Unavailable context action: ${id}`)
            item.click(undefined, win, win?.webContents)
          }
        }
      })
      await page.locator('[data-critic-kind="addition"]').click({ button: 'right' })
      await expect.poll(() => app.evaluate(() =>
        (globalThis as unknown as { reviewContextItems: Record<string, boolean> }).reviewContextItems)).toEqual({
        'critic-accept': true,
        'critic-reject': true,
        'critic-edit-comment': true
      })
      await app.evaluate((_electron, id) =>
        (globalThis as unknown as { reviewContextClick: (id: string) => void }).reviewContextClick(id), command)
      if (command === 'critic-edit-comment') {
        const input = page.getByTestId('critic-review-comment-input')
        await expect(input).toHaveValue('Outer note')
        await input.fill('Edited outer note')
        await page.getByTestId('critic-review-comment-submit').click()
      }
      const expected = command === 'critic-accept'
        ? 'First {--old--}.\n\n{==outer inner text==}{>>Outer note<<}\n'
        : 'First {--old--}.\n\n{==outer {++inner++} text==}{>>Edited outer note<<}\n'
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(original)
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
      await expectEditorWindowHidden(app)
      await expectNoRendererErrors(app)
    } catch (error) {
      console.log('Context action failure state', await page.evaluate(() => ({
        additions: Array.from(document.querySelectorAll('[data-critic-kind="addition"]'), node => node.textContent),
        body: document.body.innerText,
        recovery: document.querySelector('[data-testid="core-recovery-draft"]')?.textContent
      })))
      throw error
    } finally { await app.close() }
  })
}

test('right-clicking a standalone comment marker offers its edit and removal actions', async() => {
  const original = 'First {--old--}.\n\nA note{>>Standalone note<<}.\n'
  const { app, page, filePath } = await launchWithMarkdown(original, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const state = globalThis as unknown as {
        reviewContextItems: Record<string, boolean>
        removeContextComment: () => void
      }
      Menu.prototype.popup = function() {
        state.reviewContextItems = Object.fromEntries(['critic-accept', 'critic-reject', 'critic-remove', 'critic-edit-comment'].map(id => [id, this.getMenuItemById(id)?.enabled === true]))
        state.removeContextComment = () => {
          const win = BrowserWindow.getAllWindows()[0]
          this.getMenuItemById('critic-remove')!.click(undefined, win, win?.webContents)
        }
      }
    })
    await page.locator('.mu-critic-comment-marker').click({ button: 'right' })
    await expect.poll(() => app.evaluate(() =>
      (globalThis as unknown as { reviewContextItems: Record<string, boolean> }).reviewContextItems)).toEqual({
      'critic-accept': false,
      'critic-reject': false,
      'critic-remove': true,
      'critic-edit-comment': true
    })
    await app.evaluate(() => (globalThis as unknown as { removeContextComment: () => void }).removeContextComment())
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('First {--old--}.\n\nA note.\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(original)
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await expectEditorWindowHidden(app)
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})
