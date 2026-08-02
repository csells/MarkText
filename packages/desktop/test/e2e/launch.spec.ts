import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { closeElectron, launchElectron } from './helpers'

test.describe('Check Launch MarkText', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const { app: electronApp, page: firstPage } =
      await launchElectron(undefined, { openProjectFixture: true })
    app = electronApp
    page = firstPage
  })

  test.afterAll(async() => {
    await closeElectron(app)
  })

  test('Empty MarkText', async() => {
    const title = await page.title()
    expect(/^MarkText|Untitled-1 - MarkText$/.test(title)).toBeTruthy()
  })
})
