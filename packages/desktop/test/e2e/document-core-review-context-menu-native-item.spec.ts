import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeDocumentCore,
  launchDocumentCore,
  pointForText
} from './documentCoreReviewE2e'

const SOURCE =
  '{==outer {==inner==}{>>inner note<<}==}{>>outer note<<}\n'
const EDIT_COMMENT_MENU_ITEM_ID = 'editCriticMarkupCommentMenuItem'

async function installNativeMenuAppendObservation(
  app: ElectronApplication
): Promise<void> {
  await app.evaluate(({ Menu, MenuItem }, menuItemId) => {
    type Observation = {
      originalAppend: Electron.Menu['append']
      wrapper?: Electron.Menu['append']
      menu?: Electron.Menu
      item?: Electron.MenuItem
    }
    const target = globalThis as typeof globalThis & {
      __mtNativeMenuAppendObservation?: Observation
    }
    const previous = target.__mtNativeMenuAppendObservation
    if (
      previous?.wrapper !== undefined &&
      Menu.prototype.append === previous.wrapper
    ) {
      Menu.prototype.append = previous.originalAppend
    }

    const originalAppend = Menu.prototype.append
    const observation: Observation = { originalAppend }
    const wrapper: Electron.Menu['append'] = function(
      this: Electron.Menu,
      item: Electron.MenuItem
    ): void {
      originalAppend.call(this, item)
      if (item.id === menuItemId && item instanceof MenuItem) {
        observation.menu = this
        observation.item = item
      }
    }
    observation.wrapper = wrapper
    target.__mtNativeMenuAppendObservation = observation
    Menu.prototype.append = wrapper
  }, EDIT_COMMENT_MENU_ITEM_ID)
}

async function restoreNativeMenuAppendObservation(
  app: ElectronApplication
): Promise<void> {
  await app.evaluate(({ Menu }) => {
    type Observation = {
      originalAppend: Electron.Menu['append']
      wrapper?: Electron.Menu['append']
    }
    const target = globalThis as typeof globalThis & {
      __mtNativeMenuAppendObservation?: Observation
    }
    const observation = target.__mtNativeMenuAppendObservation
    if (
      observation?.wrapper !== undefined &&
      Menu.prototype.append === observation.wrapper
    ) {
      Menu.prototype.append = observation.originalAppend
    }
    delete target.__mtNativeMenuAppendObservation
  })
}

test.describe('document-core native Comment MenuItem integration', () => {
  test.describe.configure({ timeout: 120000 })
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchDocumentCore(SOURCE)
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) {
      try {
        await restoreNativeMenuAppendObservation(app)
      } finally {
        await closeDocumentCore(app)
      }
    }
  })

  test(
    'constructs the production context row as a real Electron MenuItem backed by the shared executor',
    async() => {
      await installNativeMenuAppendObservation(app)
      try {
        const point = await pointForText(page, 'inner')
        await page.mouse.click(point.x, point.y, { button: 'right' })

        await expect.poll(async() =>
          app.evaluate(({ Menu, MenuItem }, menuItemId) => {
            type Observation = {
              menu?: Electron.Menu
              item?: Electron.MenuItem
            }
            const observation = (
              globalThis as typeof globalThis & {
                __mtNativeMenuAppendObservation?: Observation
              }
            ).__mtNativeMenuAppendObservation
            return {
              exactItem:
                observation?.menu?.getMenuItemById(menuItemId) ===
                  observation?.item,
              menuItemIds:
                observation?.menu?.items.map(candidate => candidate.id) ?? [],
              realMenu: observation?.menu instanceof Menu,
              realMenuItem: observation?.item instanceof MenuItem
            }
          }, EDIT_COMMENT_MENU_ITEM_ID)
        ).toMatchObject({
          exactItem: true,
          menuItemIds: expect.arrayContaining([EDIT_COMMENT_MENU_ITEM_ID]),
          realMenu: true,
          realMenuItem: true
        })

        const invoked = await app.evaluate(
          ({ BrowserWindow, Menu, MenuItem }, menuItemId) => {
            type Observation = {
              menu?: Electron.Menu
              item?: Electron.MenuItem
            }
            const observation = (
              globalThis as typeof globalThis & {
                __mtNativeMenuAppendObservation?: Observation
              }
            ).__mtNativeMenuAppendObservation
            const { item, menu } = observation ?? {}
            if (!(menu instanceof Menu)) {
              throw new TypeError(
                'No production Electron context menu was observed.'
              )
            }
            if (
              !(item instanceof MenuItem) ||
              menu.getMenuItemById(menuItemId) !== item ||
              typeof item.click !== 'function'
            ) {
              throw new TypeError(
                'The production Comment MenuItem is unavailable.'
              )
            }
            item.click(
              item,
              BrowserWindow.getAllWindows()[0],
              {} as Electron.KeyboardEvent
            )
            return { id: item.id, label: item.label }
          },
          EDIT_COMMENT_MENU_ITEM_ID
        )
        expect(invoked.id).toBe(EDIT_COMMENT_MENU_ITEM_ID)
        expect(invoked.label.length).toBeGreaterThan(0)

        const innerCard = page.locator('.review-card.type-comment').filter({
          hasText: 'inner note'
        })
        const outerCard = page.locator('.review-card.type-comment').filter({
          hasText: 'outer note'
        })
        await expect(innerCard.locator('.comment-edit textarea')).toBeVisible()
        await expect(innerCard.locator('.comment-edit textarea')).toBeFocused()
        await expect(innerCard.locator('.comment-edit textarea'))
          .toHaveValue('inner note')
        await expect(outerCard.locator('.comment-edit')).toHaveCount(0)
      } finally {
        await restoreNativeMenuAppendObservation(app)
      }
    }
  )
})
