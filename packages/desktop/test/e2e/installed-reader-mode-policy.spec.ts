import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import {
  clickMenuByLabelIfEnabled as menu,
  closeWithoutRendererErrors as close,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  launchInstalled,
  showReviewSidebar
} from './helpers'

const original = 'alpha {++beta++} alpha.\n\nSecond alpha paragraph.\n'

async function launch() {
  const root = test.info().outputPath('fixture')
  fs.mkdirSync(root, { recursive: true })
  const file = path.join(root, 'reader.md')
  fs.writeFileSync(file, original, { flag: 'wx' })
  const { app, page } = await launchInstalled([file], { userDataDir: path.join(root, 'profile') })
  await expectEditorWindowHidden(app)
  expectEditorNotFrontmost(app)
  return { app, page, file }
}

async function selectFirstWord(page: Page) {
  await page.locator('.editor-component p').first().click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home')
  await page.keyboard.press('Shift+Alt+ArrowRight')
}

async function saveAndRead(app: ElectronApplication, file: string): Promise<string> {
  await menu(app, 'File', 'Save')
  // Saving an unchanged document is a no-op; allow any pending write to land.
  await new Promise((resolve) => setTimeout(resolve, 300))
  return fs.readFileSync(file, 'utf8')
}

for (const mode of ['original', 'revised'] as const) {
  test(`${mode} view refuses document mutations while Find keeps working`, async() => {
    const { app, page, file } = await launch()
    try {
      await showReviewSidebar(app)
      // A retained Markup selection gives Format and paragraph commands a target.
      // A DOM click switches views without moving that selection.
      await selectFirstWord(page)
      await page
        .getByTestId(`critic-review-${mode}`)
        .evaluate((button) => (button as HTMLElement).click())
      await expect(page.locator(`[data-projection="${mode}"]`)).toBeVisible()

      const mutations: Record<string, boolean> = {
        replace: await menu(app, 'Edit', 'Replace'),
        bold: await menu(app, 'Format', 'Bold'),
        deleteParagraph: await menu(app, 'Edit', 'Delete Paragraph'),
        duplicate: await menu(app, 'Edit', 'Duplicate')
      }
      await page.keyboard.press('Escape')
      expect.soft(await saveAndRead(app, file)).toBe(original)
      expect.soft(mutations).toEqual({
        replace: false,
        bold: false,
        deleteParagraph: false,
        duplicate: false
      })

      // Find remains available; its bar must not offer replacement here.
      expect(await menu(app, 'Edit', 'Find')).toBe(true)
      const findInput = page.locator('.search-bar .search input')
      await expect(findInput).toBeVisible()
      await findInput.fill('alpha')
      await expect(page.locator('.search-bar .search-result')).toHaveText(/\/\s*3$/)
      const replaceToggle = page.locator('.search-bar .left-arrow')
      expect.soft(await replaceToggle.count()).toBe(0)
      if ((await replaceToggle.count()) > 0) await replaceToggle.click()
      const exposedReplace = page.locator('.search-bar .replace')
      expect.soft(await exposedReplace.count()).toBe(0)
      if ((await exposedReplace.count()) > 0) {
        // Exercise the exposed control: it must not reach the document.
        await exposedReplace.locator('input').fill('CHANGED')
        await exposedReplace.locator('.button-group .button.right').click({ force: true })
      }
      await page.keyboard.press('Escape')

      await expect(page.locator(`[data-projection="${mode}"]`)).toBeVisible()
      expect(await saveAndRead(app, file)).toBe(original)
      await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)

      // Returning to Markup restores the ordinary editable commands.
      await page.getByTestId('critic-review-markup').click()
      await expect(page.locator('.editor-component')).toBeVisible()
      expect(await menu(app, 'Edit', 'Replace')).toBe(true)
      const replaceInput = page.locator('.search-bar .replace input')
      await expect(replaceInput).toBeVisible()
      await findInput.fill('alpha')
      await expect(page.locator('.search-bar .search-result')).toHaveText(/\/\s*3$/)
      await replaceInput.fill('CHANGED')
      await page.locator('.search-bar .replace .button-group .button.right').click({ force: true })
      await expect
        .poll(() => saveAndRead(app, file))
        .toBe('CHANGED {++beta++} CHANGED.\n\nSecond CHANGED paragraph.\n')
      await page.keyboard.press('Escape')
      await menu(app, 'Edit', 'Undo')
      await expect.poll(() => saveAndRead(app, file)).toBe(original)
    } finally {
      await close(app)
    }
  })
}
