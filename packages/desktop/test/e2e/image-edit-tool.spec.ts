import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeElectron,
  launchWithMarkdown,
  placeCaretInEditor,
  sendIpcToRenderer,
  setSourceMarkdown,
  expectNoRendererErrors,
  clearRendererErrors
} from './helpers'
import {
  expectCanonicalOnDisk,
  pointForText,
  pressApplicationMenuAccelerator,
  redo,
  undo
} from './documentCoreReviewE2e'

// Format -> Image target-owned workflow.
//
// The menu/IPC chain opens a draft owned by the document view. No placeholder
// or source edit exists until the form submits:
//
//   Format -> Image menu  (main: menu/actions/format.ts `image`)
//     -> ipc 'mt::editor-command' 'format-image'
//     -> renderer store/listenForMain.ts re-emits bus 'format'
//     -> editor.vue delegates to the document view's Image selector
//     -> submit dispatches one typed `insert-image` intent.
//
// These tests drive the real built Electron app and assert the float renders
// with a focused src input, exact source, and exact one-step history.

const srcInput = '.document-view-image-selector input.src'

// Whether the ImageEditTool's src input currently exists and is the focused
// element. Checking activeElement directly avoids racing the rAF that
// Playwright's toBeFocused can hit.
const isSrcInputFocused = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    return (
      !!active &&
      active.tagName === 'INPUT' &&
      active.classList.contains('src') &&
      !!active.closest('.document-view-image-selector')
    )
  })

// The image tool writes inline `opacity: 1` once positioned. Playwright's
// toBeVisible ignores opacity, so the inline opacity is the reliable signal.
const toolShown = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const tool = document.querySelector('.document-view-image-selector')
    const wrapper = tool?.closest('.document-view-float-wrapper') as HTMLElement | null
    return Number.parseFloat(wrapper?.style.opacity || '0') > 0
  })

// Reset the editor to a single empty paragraph and dismiss any open edit tool,
// so each test starts from a clean state. The tool is launched in beforeAll;
// resetting via source mode also moves focus out of any prior float.
const resetToEmpty = async(page: Page, app: ElectronApplication): Promise<void> => {
  // A neutral document click dismisses an open tool even while its input owns
  // focus.
  if (await toolShown(page)) {
    await page.mouse.click(5, 5)
    await expect.poll(() => toolShown(page), { timeout: 5000 }).toBe(false)
  }
  await setSourceMarkdown(page, app, '\n')
  await placeCaretInEditor(page)
  await clearRendererErrors(app)
}

test.describe('Format -> Image edit tool wiring', () => {
  let app: ElectronApplication
  let page: Page
  let documentPath = ''

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('\n')
    app = launched.app
    page = launched.page
    documentPath = launched.filePath
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  test.beforeEach(async() => {
    await resetToEmpty(page, app)
  })

  test('IPC mt::editor-command format-image opens the edit tool with a focused src input', async() => {
    await sendIpcToRenderer(app, 'mt::editor-command', 'format-image')

    // Opening creates only target-owned draft UI.
    await page.waitForSelector(srcInput, { state: 'attached', timeout: 5000 })
    await expect(page.locator('.document-view-image-selector input.src')).toHaveCount(1)
    await expect.poll(() => toolShown(page), { timeout: 5000 }).toBe(true)
    await expectCanonicalOnDisk(page, app, documentPath, '\n')

    await expect.poll(() => isSrcInputFocused(page), { timeout: 5000 }).toBe(true)

    await expectNoRendererErrors(app)
  })

  test('Format -> Image menu item opens the edit tool with a focused src input', async() => {
    await pressApplicationMenuAccelerator(page, app, 'imageMenuItem')

    await page.waitForSelector(srcInput, { state: 'attached', timeout: 5000 })
    await expect.poll(() => toolShown(page), { timeout: 5000 }).toBe(true)
    await expect.poll(() => isSrcInputFocused(page), { timeout: 5000 }).toBe(true)

    // The action did not crash the renderer.
    const crashed = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.isCrashed()
    )
    expect(crashed).toBe(false)
    await expectNoRendererErrors(app)
  })

  test('The opened edit tool is the empty link/embed editor (src input, no value)', async() => {
    await sendIpcToRenderer(app, 'mt::editor-command', 'format-image')

    await page.waitForSelector(srcInput, { state: 'attached', timeout: 5000 })
    await expect.poll(() => toolShown(page), { timeout: 5000 }).toBe(true)

    // A new draft starts empty and has not inserted `![]()`.
    await expect.poll(
      () =>
        page.evaluate(() => {
          const input = document.querySelector(
            '.document-view-image-selector input.src'
          ) as HTMLInputElement | null
          return input ? input.value : null
        }),
      { timeout: 5000 }
    ).toBe('')
    await expectCanonicalOnDisk(page, app, documentPath, '\n')

    await expectNoRendererErrors(app)
  })

  test('Escape cancels a populated draft without mutating the document', async() => {
    await pressApplicationMenuAccelerator(page, app, 'imageMenuItem')
    const src = page.locator(srcInput)
    await expect(src).toBeFocused()
    await src.fill('images/not-committed.png')
    await page.locator('.document-view-image-selector input.alt')
      .fill('not committed')

    await src.press('Escape')

    await expect(page.locator('.document-view-image-selector')).toHaveCount(0)
    await expectCanonicalOnDisk(page, app, documentPath, '\n')
    await expect(page.locator('.editor-component')).toBeFocused()
    await expectNoRendererErrors(app)
  })

  test('submit commits exact Image source in one undo/redo step', async() => {
    await pressApplicationMenuAccelerator(page, app, 'imageMenuItem')
    const selector = page.locator('.document-view-image-selector')
    await selector.locator('input.src').fill('images/cat.png')
    await selector.locator('input.alt').fill('cat')
    await selector.locator('input.title').fill('Cat')
    await selector.locator('input.title').press('Enter')

    const inserted = '![cat](images/cat.png "Cat")\n'
    await expectCanonicalOnDisk(page, app, documentPath, inserted)
    await expect(selector).toHaveCount(0)
    await expect(page.locator('.editor-component')).toBeFocused()

    await undo(app)
    await expectCanonicalOnDisk(page, app, documentPath, '\n')
    await redo(app)
    await expectCanonicalOnDisk(page, app, documentPath, inserted)
    await undo(app)
    await expectCanonicalOnDisk(page, app, documentPath, '\n')
    await expectNoRendererErrors(app)
  })

  test('clicking an existing Image edits its parser-owned canonical reference', async() => {
    const source = 'A ![old](assets/old.png "Old") Z\n'
    await setSourceMarkdown(page, app, source)
    const image = page.locator('img.document-view-image')
    await expect(image).toHaveCount(1)
    await image.click()

    const selector = page.locator('.document-view-image-selector')
    await expect(selector.locator('input.src')).toHaveValue('assets/old.png')
    await expect(selector.locator('input.alt')).toHaveValue('old')
    await expect(selector.locator('input.title')).toHaveValue('Old')
    await selector.locator('input.src').fill('assets/new.png')
    await selector.locator('input.alt').fill('new')
    await selector.locator('input.title').fill('New')
    await selector.locator('button[type="submit"]').click()

    const edited = 'A ![new](assets/new.png "New") Z\n'
    await expectCanonicalOnDisk(page, app, documentPath, edited)
    await expect(page.locator('.editor-component')).toBeFocused()
    await undo(app)
    await expectCanonicalOnDisk(page, app, documentPath, source)
    await redo(app)
    await expectCanonicalOnDisk(page, app, documentPath, edited)
    await expectNoRendererErrors(app)
  })

  test('captures a no-delay browser selection before the Image accelerator', async() => {
    await setSourceMarkdown(page, app, 'First\n\nSecond\n')
    await expect(page.locator('.editor-component')).toContainText('Second')
    const point = await pointForText(page, 'Second')
    await page.mouse.dblclick(point.x, point.y)
    await pressApplicationMenuAccelerator(page, app, 'imageMenuItem')

    const selector = page.locator('.document-view-image-selector')
    await selector.locator('input.src').fill('images/live.png')
    await selector.locator('button[type="submit"]').click()

    await expectCanonicalOnDisk(page, app, documentPath, 
      'First\n\n![](images/live.png)\n'
    )
    await undo(app)
    await expectCanonicalOnDisk(page, app, documentPath, 
      'First\n\nSecond\n'
    )
  })
})
