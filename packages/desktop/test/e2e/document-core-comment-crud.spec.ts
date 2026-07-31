import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  authorComment,
  closeDocumentCore,
  expectCanonicalOnDisk,
  launchDocumentCoreWithKeybindings,
  openReviewSidebar,
  pressApplicationMenuAccelerator
} from './documentCoreReviewE2e'

const ADD_COMMENT_ACCELERATOR = 'CmdOrCtrl+Alt+Shift+C'

test.describe('document-core Comment CRUD', () => {
  let app: ElectronApplication
  let page: Page
  let documentPath = ''

  test.beforeAll(async() => {
    const launched = await launchDocumentCoreWithKeybindings(
      'alpha target omega\n',
      { 'review.add-comment': ADD_COMMENT_ACCELERATOR }
    )
    app = launched.app
    page = launched.page
    documentPath = launched.filePath
  })

  test.afterAll(async() => closeDocumentCore(app))

  test('completes one contiguous no-modal Comment lifecycle', async() => {
    await authorComment(page, app, 'target', 'first note')
    await expectCanonicalOnDisk(
      page,
      app,
      documentPath,
      'alpha {==target==}{>>first note<<} omega\n'
    )
    await openReviewSidebar(page, app)
    const card = page.locator('.review-card.type-comment')
    await expect(card).toHaveCount(1)
    await card.getByRole('button', { name: 'Edit' }).click()
    const editor = card.locator('.comment-edit textarea')
    await expect(editor).toHaveValue('first note')
    await editor.fill('edited note')
    await card.locator('.comment-edit .submit').click()
    await expectCanonicalOnDisk(
      page,
      app,
      documentPath,
      'alpha {==target==}{>>edited note<<} omega\n'
    )
    await card.getByRole('button', { name: 'Remove comment' }).click()
    await expectCanonicalOnDisk(page, app, documentPath, 'alpha target omega\n')
    await pressApplicationMenuAccelerator(page, app, 'editUndoMenuItem')
    await expectCanonicalOnDisk(
      page,
      app,
      documentPath,
      'alpha {==target==}{>>edited note<<} omega\n'
    )
  })
})
