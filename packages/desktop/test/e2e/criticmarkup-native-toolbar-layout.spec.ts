import { expect, test } from '@playwright/test'
import { clickMenuById, expectEditorWindowHidden, expectNoRendererErrors, launchWithMarkdown } from './helpers'

test('native selection tools remain readable and reachable in a narrow light and dark Mac window', async() => {
  const { app, page } = await launchWithMarkdown('Select this passage.\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 640))
    for (const theme of ['light', 'dracula']) {
      if (theme === 'dracula') await clickMenuById(app, theme)
      await page.locator('.mu-paragraph-content').first().click()
      await page.keyboard.press('Home')
      await page.keyboard.press('Shift+End')
      const toolbar = page.locator('.mu-format-picker')
      await expect(toolbar.locator('..')).toHaveCSS('opacity', '1')
      await expect(toolbar).toBeInViewport({ ratio: 1 })
      for (const id of ['add-comment', 'mark-highlight', 'mark-addition', 'suggest-replacement']) {
        const action = toolbar.locator(`button[data-action="${id}"]`)
        await expect(action).toBeVisible()
        await expect(action).toBeEnabled()
        await expect(action).toBeInViewport({ ratio: 1 })
      }
      expect(await toolbar.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`selection-tools-${theme}.png`), animations: 'disabled' })
    }
    await expectEditorWindowHidden(app)
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})
