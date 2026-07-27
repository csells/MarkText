import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  launchWithMarkdown,
  setSourceMarkdown,
  placeCaretInEditor,
  getMarkdownContent
} from './helpers'

// Item 49 — the quick-insert accelerator shortcuts that convert an EMPTY
// paragraph into a block, driven by the REAL built Electron app.
//
// The accelerators belong to the document-view paragraph quick-insert menu and
// are dispatched from its keydown handler.
//
// The typed command only fires for a collapsed selection in an empty
// parser-owned paragraph. The exact accelerators are:
//   - Code Block:  altKey:true metaKey:true shiftKey:false code:'KeyC'  (⌥⌘C)
//   - Quote Block: altKey:true metaKey:true shiftKey:false code:'KeyQ'  (⌥⌘Q)
//
// Hint configuration and diagram entries have focused view coverage, and the
// i18n hint refresh has desktop coverage; this file exercises
// the keyboard accelerators actually inserting a block. This spec covers that
// live path: empty paragraph + caret -> press the accelerator -> assert the
// resulting block DOM and the markdown round-trip.

test.describe('Quick-insert accelerators (item 49)', () => {
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
    // Reset to one empty paragraph with a collapsed caret.
    await setSourceMarkdown(page, app, '\n')
    await placeCaretInEditor(page)
    await page.click('.editor-component', { timeout: 5000 })
    await placeCaretInEditor(page)
  })

  test('⌥⌘C converts the empty paragraph into a code block', async() => {
    await page.keyboard.press('Meta+Alt+c')

    const codeBlock = page.locator('.editor-component pre.document-view-code-block').first()
    await expect(codeBlock).toBeAttached({ timeout: 5000 })
    await expect(codeBlock.locator('code').first()).toBeAttached()

    // It round-trips to a fenced code block in the serialized markdown.
    await expect.poll(() => getMarkdownContent(page, app)).toContain('```')

    // The blockquote accelerator must NOT have also fired.
    await expect(page.locator('.editor-component blockquote.document-view-blockquote')).toHaveCount(0)
  })

  test('⌥⌘Q converts the empty paragraph into a blockquote', async() => {
    await page.keyboard.press('Meta+Alt+q')

    const quote = page.locator('.editor-component blockquote.document-view-blockquote').first()
    await expect(quote).toBeAttached({ timeout: 5000 })

    // It round-trips to a `>` blockquote in the serialized markdown.
    await expect.poll(() => getMarkdownContent(page, app)).toMatch(/^>/m)

    // The code-block accelerator must NOT have also fired.
    await expect(page.locator('.editor-component pre.document-view-code-block')).toHaveCount(0)
  })
})
