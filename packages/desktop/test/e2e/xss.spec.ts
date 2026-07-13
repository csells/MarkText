import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { isBackgroundTestRun, launchElectron } from './helpers'

test.describe('Test XSS Vulnerabilities', () => {
  let app: ElectronApplication

  let page: Page

  test.beforeAll(async() => {
    const { app: electronApp, page: firstPage } = await launchElectron(['test/e2e/data/xss.md'])
    app = electronApp
    page = firstPage

    // Wait to parse and render the document.
    await new Promise((resolve) => setTimeout(resolve, 3000))
  })

  test.afterAll(async() => {
    await app.close()
  })

  test('Load malicious document', async() => {
    const { isVisible, isDestroyed, isCrashed } = await app.evaluate(async(process) => {
      const mainWindow = process.BrowserWindow.getAllWindows()[0]
      return {
        isVisible: mainWindow.isVisible(),
        isDestroyed: mainWindow.isDestroyed(),
        isCrashed: mainWindow.webContents.isCrashed()
      }
    })

    if (isBackgroundTestRun) {
      expect(isVisible).toBeFalsy()
      expect(isDestroyed).toBeFalsy()
    } else {
      expect(isVisible).toBeTruthy()
    }
    expect(isCrashed).toBeFalsy()
  })
})
