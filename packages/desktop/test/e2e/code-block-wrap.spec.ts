import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

// Coverage for the "Wrap Code Blocks" and "Code Block Line Numbers"
// editor preferences.
//
// The wrap preference toggles a .document-view-code-wrap class on the editor
// root. The view stylesheet then applies `white-space: pre-wrap` to code
// blocks. These tests prove the main-store-to-live-view round trip.
//
// The actual visual wrapping / horizontal scroll behaviour is not asserted here
// (that remains manual); we assert the load-bearing computed style + class.

const CODE_DOC =
  '# wrap smoke\n\n```js\nconst aVeryLongUnbrokenStringWithNoSpacesAtAllToForceHorizontalOverflow = 1\nconst b = 2\n```\n'

const CODE_SELECTOR = '.document-view-code-block .document-view-code'

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

test.describe('Code block wrap + line-numbers preferences', () => {
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
    if (app) await app.close()
  })

  // Item 99: wrap preference toggles white-space on .document-view-code-block .document-view-code.
  test('wrapCodeBlocks toggles computed white-space on .document-view-code-block .document-view-code', async() => {
    // Default preference is wrapCodeBlocks: false, so the editor root has no
    // .document-view-code-wrap class and white-space is pre. Establish the baseline first.
    await expect.poll(() => readWhiteSpace(page), { timeout: 10000 }).toBe('pre')

    // Enable wrapping -> selector should resolve to `pre-wrap`.
    await setPreference(app, page, { wrapCodeBlocks: true })
    await expect.poll(() => readWhiteSpace(page), { timeout: 10000 }).toBe('pre-wrap')

    // Disable wrapping again -> back to `pre`. This proves the toggle is live
    // and the #ag-code-wrap selector still matches the rendered code DOM.
    await setPreference(app, page, { wrapCodeBlocks: false })
    await expect.poll(() => readWhiteSpace(page), { timeout: 10000 }).toBe('pre')
  })

  // Item 44: the line-numbers preference toggles
  // `document-view-line-numbers` on the live code block.
  test('codeBlockLineNumbers toggles the document-view-line-numbers class on the code block', async() => {
    const hasLineNumbers = async(): Promise<boolean> => {
      return await page.evaluate(() => {
        const pre = document.querySelector('.document-view-code-block')
        return !!pre && pre.classList.contains('document-view-line-numbers')
      })
    }

    // Default is codeBlockLineNumbers: false.
    await expect.poll(hasLineNumbers, { timeout: 10000 }).toBe(false)

    // Enabling forces a re-render that re-creates the code block with the
    // `document-view-line-numbers` class on the pre.
    await setPreference(app, page, { codeBlockLineNumbers: true })
    await expect.poll(hasLineNumbers, { timeout: 10000 }).toBe(true)

    // And toggling back off removes it.
    await setPreference(app, page, { codeBlockLineNumbers: false })
    await expect.poll(hasLineNumbers, { timeout: 10000 }).toBe(false)
  })

  // Item 44 (continued): both preferences take effect together and live — assert
  // the wrap CSS still resolves after a line-numbers forceRender re-creates the
  // code DOM (regression guard: a re-render must not orphan the injected style).
  test('wrap CSS still matches the code DOM after a line-numbers re-render', async() => {
    await setPreference(app, page, { wrapCodeBlocks: true })
    await expect.poll(() => readWhiteSpace(page), { timeout: 10000 }).toBe('pre-wrap')

    // Force a full re-render of the code block via the line-numbers option.
    await setPreference(app, page, { codeBlockLineNumbers: true })
    await page.waitForFunction(
      () => {
        const pre = document.querySelector('.document-view-code-block')
        return !!pre && pre.classList.contains('document-view-line-numbers')
      },
      null,
      { timeout: 10000 }
    )

    // A newly rendered code block must still pick up the live wrap CSS.
    await expect.poll(() => readWhiteSpace(page), { timeout: 10000 }).toBe('pre-wrap')

    // Restore defaults so the suite leaves no global preference state behind.
    await setPreference(app, page, { codeBlockLineNumbers: false, wrapCodeBlocks: false })
    await expect.poll(() => readWhiteSpace(page), { timeout: 10000 }).toBe('pre')
  })
})
