import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  clickMenuById,
  closeElectron,
  enterSourceMode,
  exitSourceMode,
  expectNoCapturedErrors,
  launchWithMarkdown
} from './helpers'
import {
  expectCanonicalOnDisk,
  saveCanonicalSnapshot
} from './documentCoreReviewE2e'

const INITIAL = [
  '# Asynchronous source input',
  '',
  'The main-owned session outlives its Source adapter.',
  ''
].join('\n')

test.describe('document-core asynchronous Source input', () => {
  test.describe.configure({ timeout: 60_000 })

  let app: ElectronApplication
  let page: Page
  let documentPath = ''

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(INITIAL)
    app = launched.app
    page = launched.page
    documentPath = launched.filePath
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  test('settles one admitted browser gesture exactly once after its Source adapter unmounts', async() => {
    const token = 'admitted-once'
    const expected = INITIAL + token

    await enterSourceMode(page, app)
    const input = page.locator('.source-code-input')
    await input.focus()
    await input.evaluate((element: HTMLTextAreaElement) => {
      element.setSelectionRange(element.value.length, element.value.length)
      element.dispatchEvent(new Event('select', { bubbles: true }))
    })

    // insertText is one browser input gesture. Leave Source mode immediately:
    // the textarea and controller are destroyed while the asynchronous
    // main-owned edit may still be settling.
    await page.keyboard.insertText(token)
    await expect(input).toHaveValue(expected)
    await exitSourceMode(page, app)

    await expectCanonicalOnDisk(page, app, documentPath, expected)
    expect((await saveCanonicalSnapshot(page, app, documentPath)).split(token)).toHaveLength(2)

    // The gesture is one authoritative history entry, not a whole-document
    // handoff plus a second local-editor entry.
    await clickMenuById(app, 'editUndoMenuItem')
    await expectCanonicalOnDisk(page, app, documentPath, INITIAL)
    await clickMenuById(app, 'editRedoMenuItem')
    await expectCanonicalOnDisk(page, app, documentPath, expected)

    await enterSourceMode(page, app)
    await expect(page.locator('.source-code-input')).toHaveValue(expected)
    await exitSourceMode(page, app)
    await expectNoCapturedErrors(app)
  })
})
