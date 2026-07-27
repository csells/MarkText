import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeDocumentCore,
  launchDocumentCore,
  openReviewSidebar
} from './documentCoreReviewE2e'

test.describe('document-core Review cards', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchDocumentCore(
      '{==anchor==}{>>note<<}\n\n{>>point<<}\n\n{~~old~>new~~}\n'
    )
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => closeDocumentCore(app))

  test('shows one anchored or point card without duplicate Highlight', async() => {
    await openReviewSidebar(page, app)
    await expect(page.locator('.review-card')).toHaveCount(3)
    await expect(page.locator('.review-card.type-highlight')).toHaveCount(0)
    const comments = page.locator('.review-card.type-comment')
    await expect(comments).toHaveCount(2)
    await expect(comments.nth(0).locator('.comment-anchor')).toHaveText('anchor')
    await expect(comments.nth(1).locator('.comment-anchor')).toHaveCount(0)
    const substitution = page.locator('.review-card.type-substitution')
    await expect(substitution.locator('.old-content')).toContainText('old')
    await expect(substitution.locator('.new-content')).toContainText('new')
  })
})
