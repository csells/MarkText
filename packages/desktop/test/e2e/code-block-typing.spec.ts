import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  launchWithMarkdown,
  getMarkdownContent,
  setSourceMarkdown,
  placeCaretInEditor
} from './helpers'

// Item 95 — the live REAL-keyboard path that converts a paragraph into a
// fenced code block with an applied language.
//
// The language selector can intercept keys after the opening fence. This
// desktop spec covers the complete real-keyboard path in the built app.
//
// Typing a complete opening fence and pressing Enter reparses the canonical
// source into a target-owned code block with the exact info string.
test.describe('Code block typing — real-keyboard fenced conversion (item 95)', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('seed paragraph\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test.beforeEach(async() => {
    // Reset to a single empty paragraph and drop the caret into it.
    await setSourceMarkdown(page, app, '\n')
    await placeCaretInEditor(page)
  })

  test('typing ```js + Enter creates a fenced code block with language js', async() => {
    await page.click('.editor-component', { timeout: 5000 })
    // Type the full opening fence WITH the language token, then Enter. Typing
    // the language token before Enter is what lets the picker capture 'js' and
    // apply it on selection.
    await page.keyboard.type('```js', { delay: 30 })
    await page.keyboard.press('Enter')

    const fenced = page.locator('.editor-component pre.document-view-code-block').first()
    await expect(fenced).toBeVisible({ timeout: 5000 })

    await expect(fenced.locator('code[data-language="js"]')).toBeAttached()

    // Round-trip: serializes back to a fenced block tagged with the language.
    await expect.poll(() => getMarkdownContent(page, app)).toContain('```js')
  })
})
