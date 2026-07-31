import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeElectron,
  launchWithMarkdown,
  openUntitledTabWithMarkdown,
  placeCaretInEditor,
  sendIpcToRenderer,
  waitForMenuReady
} from './helpers'

const tabSelector = '.tabs-container > li'

// These documents are marker-free, so the mounted projection's visible text
// IS the canonical content; asserting it observes what the user sees without
// pressing Save, which would flip the dirty state this test is about.
const editorText = async(page: Page): Promise<string> =>
  (await page.locator('.editor-component').innerText()).trim()

const activeTabIsDirty = (page: Page): Promise<boolean> =>
  page.evaluate(
    () => !!document.querySelector('.tabs-container > li.active.unsaved')
  )

const historyMenuState = (
  app: ElectronApplication
): Promise<Readonly<{ canUndo: boolean; canRedo: boolean }>> =>
  app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    if (!menu) throw new Error('Application menu is not built')
    const undo = menu.getMenuItemById('editUndoMenuItem')
    const redo = menu.getMenuItemById('editRedoMenuItem')
    if (!undo || !redo) throw new Error('Document history menu items are missing')
    return { canUndo: undo.enabled, canRedo: redo.enabled }
  })

const appendCharacter = async(page: Page, character: string): Promise<void> => {
  await placeCaretInEditor(page)
  await page.keyboard.press('Escape')
  await page.keyboard.type(character, { delay: 0 })
}

test('main-owned A and B sessions retain isolated undo, redo, and dirty state', async() => {
  const { app, page } = await launchWithMarkdown('alpha\n')
  await waitForMenuReady(app)

  try {
    await appendCharacter(page, 'A')
    await expect.poll(() => editorText(page)).toBe('alphaA')
    await expect.poll(() => activeTabIsDirty(page)).toBe(true)
    await expect.poll(() => historyMenuState(app)).toEqual({
      canUndo: true,
      canRedo: false
    })

    await openUntitledTabWithMarkdown(page, 'bravo\n')
    await expect.poll(() => page.locator(tabSelector).count()).toBe(2)
    await expect.poll(() => editorText(page)).toBe('bravo')

    await appendCharacter(page, 'B')
    await expect.poll(() => editorText(page)).toBe('bravoB')
    await expect.poll(() => activeTabIsDirty(page)).toBe(true)

    await sendIpcToRenderer(app, 'mt::switch-tab-by-index', 0)
    await expect.poll(() => editorText(page)).toBe('alphaA')
    await expect.poll(() => activeTabIsDirty(page)).toBe(true)

    await sendIpcToRenderer(app, 'mt::editor-command', 'undo')
    await expect.poll(() => editorText(page)).toBe('alpha')
    await expect.poll(() => activeTabIsDirty(page)).toBe(false)
    await expect.poll(() => historyMenuState(app)).toEqual({
      canUndo: false,
      canRedo: true
    })

    await sendIpcToRenderer(app, 'mt::editor-command', 'redo')
    await expect.poll(() => editorText(page)).toBe('alphaA')
    await expect.poll(() => activeTabIsDirty(page)).toBe(true)
    await expect.poll(() => historyMenuState(app)).toEqual({
      canUndo: true,
      canRedo: false
    })

    await sendIpcToRenderer(app, 'mt::switch-tab-by-index', 1)
    await expect.poll(() => editorText(page)).toBe('bravoB')
    await expect.poll(() => activeTabIsDirty(page)).toBe(true)
  } finally {
    await closeElectron(app)
  }
})
