import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readCanonicalMarkdown } from './helpers'
import {
  closeDocumentCore,
  launchDocumentCoreWithKeybindings,
  pointForText,
  pressApplicationMenuAccelerator,
  pressUserKeybinding,
  reviewMenuEnabled
} from './documentCoreReviewE2e'

const SOURCE =
  '{==outer {==inner==}{>>inner note<<}==}{>>outer note<<}\n'
const EDIT_CONTEXT_COMMENT_ACCELERATOR = 'CmdOrCtrl+Alt+Shift+E'

test.describe('document-core Review native context identity', () => {
  test.describe.configure({ timeout: 120000 })
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchDocumentCoreWithKeybindings(SOURCE, {
      'review.edit-context-comment': EDIT_CONTEXT_COMMENT_ACCELERATOR
    })
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await closeDocumentCore(app)
  })

  test(
    'right-clicks the nested Comment and invokes its exact one-shot edit command through real input',
    async() => {
      const point = await pointForText(page, 'inner')
      await page.mouse.click(point.x, point.y, { button: 'right' })

      const innerCard = page.locator('.review-card.type-comment').filter({
        hasText: 'inner note'
      })
      const outerCard = page.locator('.review-card.type-comment').filter({
        hasText: 'outer note'
      })
      const editor = innerCard.locator('.comment-edit textarea')
      await page.waitForTimeout(200)
      await pressUserKeybinding(
        page,
        app,
        EDIT_CONTEXT_COMMENT_ACCELERATOR
      )
      await expect(editor).toBeVisible()
      await expect(editor).toBeFocused()
      await expect(editor).toHaveValue('inner note')
      await expect(outerCard.locator('.comment-edit')).toHaveCount(0)

      await editor.fill('edited inner note')
      await innerCard.locator('.comment-edit .submit').click()
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(
        SOURCE.replace('inner note', 'edited inner note')
      )

      await pressUserKeybinding(
        page,
        app,
        EDIT_CONTEXT_COMMENT_ACCELERATOR
      )
      await expect(innerCard.locator('.comment-edit')).toHaveCount(0)
      await expect(outerCard.locator('.comment-edit')).toHaveCount(0)

      await expect.poll(() =>
        reviewMenuEnabled(app, 'editUndoMenuItem')
      ).toBe(true)
      await pressApplicationMenuAccelerator(page, app, 'editUndoMenuItem')
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(SOURCE)
    }
  )
})
