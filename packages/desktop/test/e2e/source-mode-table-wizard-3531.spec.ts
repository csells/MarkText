import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeElectron,
  launchWithMarkdown,
  focusEditor,
  enterSourceMode,
  exitSourceMode
} from './helpers'
import {
  expectCanonicalOnDisk,
  applicationMenuAccelerator,
  pressUserKeybinding
} from './documentCoreReviewE2e'

// #3531 — the paragraph edit commands (e.g. the "Insert Table" wizard) still
// fired in Source mode, where they target the hidden semantic surface instead
// of the visible source input. Like undo/redo/selectAll, these
// must be blocked while in source mode.

const TABLE_DIALOG = '.ag-insert-table-dialog'

test.describe('paragraph edit commands are suppressed in source mode (#3531)', () => {
  let app: ElectronApplication
  let page: Page
  let documentPath = ''
  let tableAccelerator: string

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Doc\n\nsome text\n')
    app = launched.app
    page = launched.page
    documentPath = launched.filePath
    await focusEditor(page)
    tableAccelerator = await applicationMenuAccelerator(app, 'tableMenuItem')
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  test('the Insert Table wizard does not open while in source-code mode', async() => {
    await enterSourceMode(page, app)
    await page.evaluate(() => {
      delete document.documentElement.dataset.tableActionReceived
      window.electron.ipcRenderer.once(
        'mt::editor-paragraph-action',
        (_event, action) => {
          document.documentElement.dataset.tableActionReceived = action.kind
        }
      )
    })

    await pressUserKeybinding(page, app, tableAccelerator)
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.dataset.tableActionReceived
    )).toBe('request-table')

    // The table wizard dialog must NOT appear in source mode.
    await expect(page.locator(TABLE_DIALOG)).toHaveCount(0)
    await expect(page.locator('.source-code-input')).toHaveValue(
      '# Doc\n\nsome text\n'
    )

    await exitSourceMode(page, app)

    // Sanity: in WYSIWYG mode the same action DOES open the wizard.
    await focusEditor(page)
    await pressUserKeybinding(page, app, tableAccelerator)
    const dialog = page.locator(TABLE_DIALOG)
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
  })

  test('opening Source mode cancels an outstanding table request', async() => {
    await focusEditor(page)
    await pressUserKeybinding(page, app, tableAccelerator)
    await expect(page.locator(TABLE_DIALOG)).toBeVisible({ timeout: 5000 })

    await enterSourceMode(page, app)
    await expect(page.locator(TABLE_DIALOG)).toBeHidden({ timeout: 5000 })

    const source = page.locator('.source-code-input')
    await expect(source).toHaveValue('# Doc\n\nsome text\n')
    await exitSourceMode(page, app)
  })

  test('switching documents cancels the request and mutates neither document', async() => {
    const original = '# Doc\n\nsome text\n'
    await focusEditor(page)
    await pressUserKeybinding(page, app, tableAccelerator)
    await expect(page.locator(TABLE_DIALOG)).toBeVisible({ timeout: 5000 })

    await pressUserKeybinding(page, app, 'CmdOrCtrl+T')
    await expect(page.locator('.tabs-container > li')).toHaveCount(2)
    await expect(page.locator(TABLE_DIALOG)).toBeHidden({ timeout: 5000 })
    // The fresh tab is untitled — it has no file to observe and saving it
    // would summon a dialog. Its emptiness is read through the source-mode
    // projection of the main-owned session instead.
    await enterSourceMode(page, app)
    await expect(page.locator('.source-code-input')).toHaveValue('')
    await exitSourceMode(page, app)

    await page.locator('.tabs-container > li').first().click()
    await expect(page.locator('.editor-component')).toContainText('some text')
    await expectCanonicalOnDisk(page, app, documentPath, original)
  })
})
