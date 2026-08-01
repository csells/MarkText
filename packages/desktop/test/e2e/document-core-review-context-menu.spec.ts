import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  expectCanonicalOnDisk,
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
const EDIT_COMMENT_MENU_ITEM_ID = 'editCriticMarkupCommentMenuItem'

// The one-shot edit command binds to the comment the right-click captured;
// the settled fact that capture completed is main constructing the context
// menu with the edit row. Observe the construction instead of sleeping.
async function observeContextMenuBuilds(
  app: ElectronApplication
): Promise<void> {
  await app.evaluate(({ Menu, MenuItem }, menuItemId) => {
    const target = globalThis as typeof globalThis & {
      __mtContextEditRowAppends?: number
      __mtContextEditRowHooked?: boolean
    }
    target.__mtContextEditRowAppends = 0
    if (target.__mtContextEditRowHooked) return
    target.__mtContextEditRowHooked = true
    const originalAppend = Menu.prototype.append
    Menu.prototype.append = function(
      this: Electron.Menu,
      item: Electron.MenuItem
    ): void {
      originalAppend.call(this, item)
      if (item.id === menuItemId && item instanceof MenuItem) {
        target.__mtContextEditRowAppends =
          (target.__mtContextEditRowAppends ?? 0) + 1
      }
    }
  }, EDIT_COMMENT_MENU_ITEM_ID)
}

const contextEditRowAppends = (app: ElectronApplication): Promise<number> =>
  app.evaluate(() =>
    (globalThis as typeof globalThis & { __mtContextEditRowAppends?: number })
      .__mtContextEditRowAppends ?? 0
  )

test.describe('document-core Review native context identity', () => {
  test.describe.configure({ timeout: 120000 })
  let app: ElectronApplication
  let page: Page
  let documentPath = ''

  test.beforeAll(async() => {
    const launched = await launchDocumentCoreWithKeybindings(SOURCE, {
      'review.edit-context-comment': EDIT_CONTEXT_COMMENT_ACCELERATOR
    })
    app = launched.app
    page = launched.page
    documentPath = launched.filePath
  })

  test.afterAll(async() => {
    if (app) await closeDocumentCore(app)
  })

  test(
    'right-clicks the nested Comment and invokes its exact one-shot edit command through real input',
    async() => {
      await observeContextMenuBuilds(app)
      const point = await pointForText(page, 'inner')
      await page.mouse.click(point.x, point.y, { button: 'right' })

      const innerCard = page.locator('.review-card.type-comment').filter({
        hasText: 'inner note'
      })
      const outerCard = page.locator('.review-card.type-comment').filter({
        hasText: 'outer note'
      })
      const editor = innerCard.locator('.comment-edit textarea')
      await expect.poll(() => contextEditRowAppends(app)).toBeGreaterThan(0)
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
      await expectCanonicalOnDisk(page, app, documentPath,
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
      await expectCanonicalOnDisk(page, app, documentPath, SOURCE)
    }
  )
})
