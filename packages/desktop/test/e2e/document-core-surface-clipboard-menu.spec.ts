import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeDocumentCore,
  launchDocumentCore,
  openReviewSidebar,
  pointForText,
  selectDomText
} from './documentCoreReviewE2e'
import {
  clickMenuById,
  enterSourceMode,
  exitSourceMode,
  readCanonicalMarkdown
} from './helpers'

const SOURCE =
  'prefix {++added++} {--removed--} {~~before~>after~~} suffix\n'
const CONTEXT_COPY_ID = 'copyMenuItem'

type SemanticClipboardPolicy = Readonly<{
  copyAsRich: boolean
  copyAsHtml: boolean
  pasteAsPlainText: boolean
}>

const applicationClipboardPolicy = (
  app: ElectronApplication
): Promise<SemanticClipboardPolicy> =>
  app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    if (menu === null) throw new TypeError('Application menu is unavailable')
    const enabled = (id: string): boolean => {
      const item = menu.getMenuItemById(id)
      if (item === null) throw new TypeError(`Menu item is unavailable: ${id}`)
      return item.enabled
    }
    return {
      copyAsRich: enabled('editCopyAsRichMenuItem'),
      copyAsHtml: enabled('editCopyAsHtmlMenuItem'),
      pasteAsPlainText: enabled('editPasteAsPlainTextMenuItem')
    }
  })

const writeClipboard = (
  app: ElectronApplication,
  text: string
): Promise<void> =>
  app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text)

const readClipboard = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ clipboard }) => clipboard.readText())

async function installNativeMenuObservation(
  app: ElectronApplication
): Promise<void> {
  await app.evaluate(({ Menu, MenuItem }, copyId) => {
    type Observation = {
      originalAppend: Electron.Menu['append']
      wrapper?: Electron.Menu['append']
      menu?: Electron.Menu
    }
    const target = globalThis as typeof globalThis & {
      __mtSurfaceClipboardMenuObservation?: Observation
    }
    const previous = target.__mtSurfaceClipboardMenuObservation
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
      if (item.id === copyId && item instanceof MenuItem) {
        observation.menu = this
      }
    }
    observation.wrapper = wrapper
    target.__mtSurfaceClipboardMenuObservation = observation
    Menu.prototype.append = wrapper
  }, CONTEXT_COPY_ID)
}

async function resetNativeMenuObservation(
  app: ElectronApplication
): Promise<void> {
  await app.evaluate(() => {
    const observation = (
      globalThis as typeof globalThis & {
        __mtSurfaceClipboardMenuObservation?: { menu?: Electron.Menu }
      }
    ).__mtSurfaceClipboardMenuObservation
    if (observation !== undefined) delete observation.menu
  })
}

async function restoreNativeMenuObservation(
  app: ElectronApplication
): Promise<void> {
  await app.evaluate(({ Menu }) => {
    type Observation = {
      originalAppend: Electron.Menu['append']
      wrapper?: Electron.Menu['append']
    }
    const target = globalThis as typeof globalThis & {
      __mtSurfaceClipboardMenuObservation?: Observation
    }
    const observation = target.__mtSurfaceClipboardMenuObservation
    if (
      observation?.wrapper !== undefined &&
      Menu.prototype.append === observation.wrapper
    ) {
      Menu.prototype.append = observation.originalAppend
    }
    delete target.__mtSurfaceClipboardMenuObservation
  })
}

async function invokeObservedNativeCopy(
  app: ElectronApplication,
  expected: Readonly<{ cut: boolean; copy: boolean; paste: boolean }>
): Promise<void> {
  await expect.poll(() =>
    app.evaluate(({ Menu, MenuItem }, input) => {
      const observation = (
        globalThis as typeof globalThis & {
          __mtSurfaceClipboardMenuObservation?: { menu?: Electron.Menu }
        }
      ).__mtSurfaceClipboardMenuObservation
      const menu = observation?.menu
      const item = menu?.getMenuItemById(input.copyId)
      return {
        copy: item?.enabled ?? null,
        cut: menu?.getMenuItemById('cutMenuItem')?.enabled ?? null,
        paste: menu?.getMenuItemById('pasteMenuItem')?.enabled ?? null,
        realMenu: menu instanceof Menu,
        realMenuItem: item instanceof MenuItem,
        role: item?.role ?? null,
        expected: input.policy
      }
    }, { policy: expected, copyId: CONTEXT_COPY_ID })
  ).toMatchObject({
    ...expected,
    realMenu: true,
    realMenuItem: true,
    role: 'copy'
  })

  await app.evaluate(({ BrowserWindow, Menu, MenuItem }, copyId) => {
    const observation = (
      globalThis as typeof globalThis & {
        __mtSurfaceClipboardMenuObservation?: { menu?: Electron.Menu }
      }
    ).__mtSurfaceClipboardMenuObservation
    const menu = observation?.menu
    const copy = menu?.getMenuItemById(copyId)
    const win = BrowserWindow.getAllWindows()[0]
    if (
      !(menu instanceof Menu) ||
      !(copy instanceof MenuItem) ||
      copy.enabled !== true ||
      win === undefined
    ) {
      throw new TypeError('Production native Copy row is unavailable')
    }
    // Electron does not expose an API for selecting an OS-native role row.
    // Exercise the exact native `copy` role action after the real right-click
    // constructed and enabled that production MenuItem.
    win.webContents.copy()
  }, CONTEXT_COPY_ID)
}

async function rightClickSelectedText(
  page: Page,
  text: string
): Promise<void> {
  expect(await selectDomText(page, text)).toBe(text)
  const point = await pointForText(page, text)
  await page.mouse.click(point.x, point.y, { button: 'right' })
}

async function rightClickSelectedSource(page: Page): Promise<void> {
  const input = page.locator('.source-code-input')
  await input.focus()
  await input.evaluate((element: HTMLTextAreaElement) => {
    element.select()
    element.dispatchEvent(new Event('select', { bubbles: true }))
  })
  await expect.poll(() => input.evaluate(
    (element: HTMLTextAreaElement) =>
      element.value.slice(element.selectionStart, element.selectionEnd)
  )).toBe(SOURCE)
  const box = await input.boundingBox()
  if (box === null) throw new TypeError('Source input has no layout box')
  await page.mouse.click(box.x + 24, box.y + 16, { button: 'right' })
}

test.describe('document-surface clipboard menu integration', () => {
  test.describe.configure({ timeout: 120000 })
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchDocumentCore(SOURCE)
    app = launched.app
    page = launched.page
    await installNativeMenuObservation(app)
  })

  test.afterAll(async() => {
    if (app) {
      try {
        await restoreNativeMenuObservation(app)
      } finally {
        await closeDocumentCore(app)
      }
    }
  })

  test(
    'uses authenticated Markup/Source/Original/Revised policy and copies read-only projections without mutation',
    async() => {
      const canonical = await readCanonicalMarkdown(page)
      expect(canonical).toBe(SOURCE)

      await rightClickSelectedText(page, 'prefix')
      await expect.poll(() => applicationClipboardPolicy(app)).toEqual({
        copyAsRich: true,
        copyAsHtml: true,
        pasteAsPlainText: true
      })
      await resetNativeMenuObservation(app)
      await openReviewSidebar(page, app)
      const projectionGroup = page.getByRole('region', {
        name: 'Review'
      }).getByRole('group', { name: 'Display' })

      for (const projection of [
        {
          label: 'Original',
          attribute: 'original',
          selected: 'removed'
        },
        {
          label: 'Revised',
          attribute: 'revised',
          selected: 'added'
        }
      ] as const) {
        await projectionGroup.getByRole('button', {
          name: projection.label
        }).click()
        await expect(page.locator('.editor-component')).toHaveAttribute(
          'data-critic-projection',
          projection.attribute
        )
        await rightClickSelectedText(page, projection.selected)
        await expect.poll(() => applicationClipboardPolicy(app)).toEqual({
          copyAsRich: true,
          copyAsHtml: true,
          pasteAsPlainText: false
        })

        await writeClipboard(app, `sentinel-${projection.attribute}`)
        await resetNativeMenuObservation(app)
        await rightClickSelectedText(page, projection.selected)
        await invokeObservedNativeCopy(app, {
          cut: false,
          copy: true,
          paste: false
        })
        await expect.poll(() => readClipboard(app)).toBe(projection.selected)
        expect(await readCanonicalMarkdown(page)).toBe(SOURCE)

        await writeClipboard(app, `forbidden-${projection.attribute}-paste`)
        await clickMenuById(app, 'editPasteAsPlainTextMenuItem')
        await page.waitForTimeout(250)
        expect(await readCanonicalMarkdown(page)).toBe(SOURCE)
      }

      await enterSourceMode(page, app)
      await expect(page.locator('.editor-component')).toHaveAttribute(
        'aria-hidden',
        'true'
      )
      expect(await page.locator('.editor-component').evaluate(
        (element: HTMLElement) => element.inert
      )).toBe(true)
      await expect.poll(() => applicationClipboardPolicy(app)).toEqual({
        copyAsRich: false,
        copyAsHtml: false,
        pasteAsPlainText: false
      })
      await writeClipboard(app, 'source-copy-sentinel')
      await resetNativeMenuObservation(app)
      await rightClickSelectedSource(page)
      await invokeObservedNativeCopy(app, {
        cut: true,
        copy: true,
        paste: true
      })
      await expect.poll(() => readClipboard(app)).toBe(SOURCE)
      await exitSourceMode(page, app)
      await expect(page.locator('.editor-component')).not.toHaveAttribute(
        'aria-hidden'
      )
      expect(await page.locator('.editor-component').evaluate(
        (element: HTMLElement) => element.inert
      )).toBe(false)
      expect(await readCanonicalMarkdown(page)).toBe(SOURCE)
    }
  )
})
