import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { closeElectron, launchWithMarkdown } from './helpers'

// Coverage for the "Wrap Code Blocks" editor preference.
//
// The wrap preference toggles a .document-view-code-wrap class on the editor
// root; the static view stylesheet then applies `white-space: pre-wrap` to
// code blocks. These tests prove the main-store-to-live-view round trip. The
// muya-era codeBlockLineNumbers preference was retired with the engine
// replacement and has no production surface to test.

const CODE_DOC =
  '# wrap smoke\n\n```js\nconst aVeryLongUnbrokenStringWithNoSpacesAtAllToForceHorizontalOverflow = 1\nconst b = 2\n```\n'

const CODE_SELECTOR = 'pre.document-view-code-block > code'

const setPreference = async(
  app: ElectronApplication,
  page: Page,
  prefs: Record<string, unknown>
): Promise<void> => {
  await page.evaluate((payload) => {
    window.electron.ipcRenderer.send('mt::set-user-preference', payload)
  }, prefs)
}

const readWhiteSpace = async(page: Page): Promise<string> => {
  return await page.evaluate((selector) => {
    const el = document.querySelector(selector)
    return el ? getComputedStyle(el).whiteSpace : ''
  }, CODE_SELECTOR)
}

test.describe('Code block wrap preference', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(CODE_DOC)
    app = launched.app
    page = launched.page
    // The fenced code block renders into pre.document-view-code-block > code.document-view-code.
    await page.waitForSelector(CODE_SELECTOR, { state: 'attached', timeout: 15000 })
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  // Item 99: wrap preference toggles white-space on .document-view-code-block .document-view-code.
  test('wrapCodeBlocks toggles computed white-space on the rendered code block', async() => {
    // The shipped default is wrapCodeBlocks: true, so a fresh profile renders
    // code with `pre-wrap`. Prove the round trip both ways and land back on
    // the default so no preference drift escapes the suite.
    await expect.poll(() => readWhiteSpace(page), { timeout: 10000 }).toBe('pre-wrap')

    await setPreference(app, page, { wrapCodeBlocks: false })
    await expect.poll(() => readWhiteSpace(page), { timeout: 10000 }).toBe('pre')

    await setPreference(app, page, { wrapCodeBlocks: true })
    await expect.poll(() => readWhiteSpace(page), { timeout: 10000 }).toBe('pre-wrap')
  })
})
