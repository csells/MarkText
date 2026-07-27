import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeDocumentCore,
  launchDocumentCore,
  pointForText,
  pressApplicationMenuAccelerator
} from './documentCoreReviewE2e'

test.describe('document-core pointer Review access', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchDocumentCore('before {++added++} after\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => closeDocumentCore(app))

  test('opens Review by pointer with panel and rail hidden', async() => {
    const sideBar = page.locator('.side-bar')
    if (await sideBar.isVisible()) {
      await pressApplicationMenuAccelerator(page, app, 'sideBarMenuItem')
    }
    await expect(sideBar).toBeHidden()
    const point = await pointForText(page, 'added')
    await page.mouse.click(point.x, point.y)
    const tool = page.locator('.document-view-critic-markup-review-tool')
    await expect(tool).toBeVisible()
    await tool.getByRole('button', { name: /review/i }).click()
    await expect(page.locator('.side-bar-review')).toBeVisible()
    await expect(page.locator('.review-card.type-addition')).toHaveCount(1)
  })
})
