import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  clickMenuById,
  closeElectron,
  launchWithMarkdown,
  placeCaretInEditor,
  readCanonicalMarkdown,
  openUntitledTabWithMarkdown,
  sendIpcToRenderer,
  waitForEditor,
  waitForMenuReady
} from './helpers'

const tabSelector = '.tabs-container > li'

const readTabIds = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('.tabs-container > li')).map(
      tab => tab.getAttribute('data-id') ?? ''
    )
  )

const activeTabId = (page: Page): Promise<string | null> =>
  page.evaluate(
    () =>
      document.querySelector('.tabs-container > li.active')
        ?.getAttribute('data-id') ?? null
  )

const activeTabIsDirty = (page: Page): Promise<boolean> =>
  page.evaluate(
    () => !!document.querySelector('.tabs-container > li.active.unsaved')
  )

const historyMenuState = (
  app: ElectronApplication
): Promise<Readonly<{ canUndo: boolean; canRedo: boolean }>> =>
  app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    if (menu === null) throw new Error('Application menu is not built')
    const undo = menu.getMenuItemById('editUndoMenuItem')
    const redo = menu.getMenuItemById('editRedoMenuItem')
    if (undo === null || redo === null) {
      throw new Error('Document history menu items are missing')
    }
    return {
      canUndo: undo.enabled,
      canRedo: redo.enabled
    }
  })

const appendCharacter = async(
  page: Page,
  character: string
): Promise<void> => {
  await placeCaretInEditor(page)
  await page.keyboard.press('Escape')
  await page.keyboard.type(character, { delay: 0 })
}

test('renderer reload reattaches the same dirty sessions with their undo histories', async() => {
  const { app, page } = await launchWithMarkdown('alpha\n')
  await waitForMenuReady(app)

  try {
    await appendCharacter(page, 'A')
    await expect.poll(
      async() => (await readCanonicalMarkdown(page)).trim()
    ).toBe('alphaA')

    await openUntitledTabWithMarkdown(page, 'bravo\n')
    await expect.poll(() => page.locator(tabSelector).count()).toBe(2)
    await appendCharacter(page, 'B')
    await expect.poll(
      async() => (await readCanonicalMarkdown(page)).trim()
    ).toBe('bravoB')

    const beforeIds = await readTabIds(page)
    const beforeSelectedId = await activeTabId(page)
    expect(beforeIds).toHaveLength(2)
    expect(beforeSelectedId).toBe(beforeIds[1])

    const navigation = page.waitForNavigation({
      waitUntil: 'domcontentloaded'
    })
    await clickMenuById(app, 'view.dev-reload')
    await navigation
    await waitForEditor(page)
    await waitForMenuReady(app)

    await expect.poll(() => readTabIds(page)).toEqual(beforeIds)
    await expect.poll(() => activeTabId(page)).toBe(beforeSelectedId)
    await expect.poll(
      async() => (await readCanonicalMarkdown(page)).trim()
    ).toBe('bravoB')
    await expect.poll(() => activeTabIsDirty(page)).toBe(true)
    await expect.poll(() => historyMenuState(app)).toEqual({
      canUndo: true,
      canRedo: false
    })

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect.poll(
      async() => (await readCanonicalMarkdown(page)).trim()
    ).toBe('bravo')
    await expect.poll(() => activeTabIsDirty(page)).toBe(false)

    await sendIpcToRenderer(app, 'mt::switch-tab-by-index', 0)
    await expect.poll(
      async() => (await readCanonicalMarkdown(page)).trim()
    ).toBe('alphaA')
    await expect.poll(() => activeTabIsDirty(page)).toBe(true)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect.poll(
      async() => (await readCanonicalMarkdown(page)).trim()
    ).toBe('alpha')
    await expect.poll(() => activeTabIsDirty(page)).toBe(false)
  } finally {
    await closeElectron(app)
  }
})
