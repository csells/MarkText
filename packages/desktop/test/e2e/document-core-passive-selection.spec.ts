import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeDocumentCore,
  launchDocumentCore,
  openReviewSidebar,
  selectWordByPointer
} from './documentCoreReviewE2e'

test.describe('document-core passive Review selection', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const prefix = Array.from(
      { length: 20 },
      (_, index) => `{++item ${String(index)}++}`
    ).join('\n\n')
    const launched = await launchDocumentCore(
      `${prefix}\n\n{==outer {++deep++}==}{>>note<<}\n`
    )
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => closeDocumentCore(app))

  test('selects deepest visible Review ownership without UI side effects', async() => {
    await openReviewSidebar(page, app)
    const sidebar = page.locator('.side-bar-review')
    await sidebar.hover()
    await page.mouse.wheel(0, 160)
    await expect.poll(() =>
      sidebar.evaluate(element => element.scrollTop)
    ).toBeGreaterThan(0)
    const before = await sidebar.evaluate(element => element.scrollTop)
    await selectWordByPointer(page, 'deep')
    await expect(page.locator('.review-card.type-addition.active')).toHaveCount(1)
    await expect(page.locator('.comment-edit')).toHaveCount(0)
    expect(await sidebar.evaluate((element) => element.scrollTop)).toBe(before)
    await expect.poll(() => page.evaluate(() =>
      document.activeElement?.classList.contains('editor-component') ?? false
    )).toBe(true)
  })
})
