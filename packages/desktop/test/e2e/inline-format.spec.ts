import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, clickMenuById } from './helpers'

// Inline formatting requires a live selection established through public
// editor gestures. This file owns the real menu and IPC path; focused core
// tests own the exact typed transformation.

const formatMenuIds = [
  'strongMenuItem',
  'emphasisMenuItem',
  'underlineMenuItem',
  'superscriptMenuItem',
  'subscriptMenuItem',
  'highlightMenuItem',
  'inlineCodeMenuItem',
  'inlineMathMenuItem',
  'strikeMenuItem'
]

test.describe('Inline format menu wiring', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('format wiring target\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  for (const id of formatMenuIds) {
    test(`Menu ${id} invokes without crash`, async() => {
      await clickMenuById(app, id)
      const crashed = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.isCrashed()
      )
      expect(crashed).toBe(false)
      const editorVisible = await page.locator('.editor-component').isVisible()
      expect(editorVisible).toBe(true)
    })
  }
})
