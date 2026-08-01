import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { clickMenuById } from './helpers'
import {
  closeDocumentCore,
  expectCanonicalOnDisk,
  launchDocumentCoreWithKeybindings,
  pressApplicationMenuAccelerator,
  pressUserKeybinding,
  reviewMenuEnabled,
  selectTextByKeyboard
} from './documentCoreReviewE2e'

const SOURCE = 'alpha target omega\n'
const EDIT_CONTEXT_COMMENT_ACCELERATOR = 'CmdOrCtrl+Alt+Shift+E'
const REVIEW_KEYBINDINGS = {
  'review.mark-deletion': 'CmdOrCtrl+Alt+Shift+D',
  'review.add-comment': 'CmdOrCtrl+Alt+Shift+C',
  'review.edit-context-comment': EDIT_CONTEXT_COMMENT_ACCELERATOR
}

test.describe('document-core complete Review workflow', () => {
  let app: ElectronApplication
  let page: Page
  let documentPath = ''

  test.beforeAll(async() => {
    const launched = await launchDocumentCoreWithKeybindings(
      SOURCE,
      REVIEW_KEYBINDINGS
    )
    app = launched.app
    page = launched.page
    documentPath = launched.filePath
  })

  test.afterAll(async() => {
    if (app) await closeDocumentCore(app)
  })

  test('completes the Review and Comment workflow through real app events', async() => {
    await selectTextByKeyboard(page, SOURCE.trimEnd(), 'target')
    await expect.poll(() =>
      reviewMenuEnabled(app, 'reviewMarkDeletionMenuItem')
    ).toBe(true)
    await pressApplicationMenuAccelerator(
      page,
      app,
      'reviewMarkDeletionMenuItem'
    )
    await expectCanonicalOnDisk(
      page,
      app,
      documentPath,
      'alpha {--target--} omega\n'
    )

    await pressApplicationMenuAccelerator(page, app, 'editUndoMenuItem')
    await expectCanonicalOnDisk(page, app, documentPath, SOURCE)

    await selectTextByKeyboard(page, SOURCE.trimEnd(), 'target')
    await pressApplicationMenuAccelerator(
      page,
      app,
      'reviewAddCommentMenuItem'
    )
    const composer = page.locator('.comment-compose-input')
    await expect(composer).toBeVisible()
    await expect(composer).toBeFocused()
    await composer.pressSequentially('workflow note')
    await page.locator('.comment-compose-actions .submit').click()
    await expect(composer).toBeHidden()

    const comment = page.locator('.review-card.type-comment')
    await expect(comment.locator('.comment-anchor')).toHaveText('target')
    const indicator = page.locator('.document-view-critic-comment-indicator')
    await expect(indicator).toHaveCount(1)
    await indicator.click({ button: 'right' })

    const editor = comment.locator('textarea')
    await expect.poll(async() => {
      if (!(await editor.isVisible())) {
        await pressUserKeybinding(
          page,
          app,
          EDIT_CONTEXT_COMMENT_ACCELERATOR
        )
      }
      return editor.isVisible()
    }).toBe(true)
    await expect(editor).toBeVisible()
    await expect(editor).toBeFocused()
    await editor.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await editor.pressSequentially('edited workflow note')
    await comment.locator('.submit').click()
    await expectCanonicalOnDisk(
      page,
      app,
      documentPath,
      'alpha {==target==}{>>edited workflow note<<} omega\n'
    )
    await comment.getByRole('button', { name: 'Remove comment' }).click()
    await expectCanonicalOnDisk(page, app, documentPath, 'alpha target omega\n')

    // Accept All must apply accept semantics, not merely resolve: accepting
    // the deletion removes its content, while a reject would restore it.
    // The two outcomes produce distinct canonical bytes, so this assertion
    // discriminates the resolution direction end to end.
    await selectTextByKeyboard(page, SOURCE.trimEnd(), 'target')
    await pressApplicationMenuAccelerator(
      page,
      app,
      'reviewMarkDeletionMenuItem'
    )
    await expectCanonicalOnDisk(
      page,
      app,
      documentPath,
      'alpha {--target--} omega\n'
    )
    await expect.poll(() =>
      reviewMenuEnabled(app, 'reviewAcceptAllMenuItem')
    ).toBe(true)
    await clickMenuById(app, 'reviewAcceptAllMenuItem')
    await expectCanonicalOnDisk(page, app, documentPath, 'alpha  omega\n')
  })
})
