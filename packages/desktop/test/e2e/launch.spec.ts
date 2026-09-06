import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchElectron, waitForEditor } from './helpers'

test.describe('Check Launch MarkText', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const { app: electronApp, page: firstPage } = await launchElectron()
    app = electronApp
    page = firstPage
  })

  test.afterAll(async() => {
    await app.close()
  })

  test('Empty MarkText', async() => {
    await waitForEditor(page)
    await expect(page).toHaveTitle(/^(?:MarkText|Untitled-1)$/)
  })
})
