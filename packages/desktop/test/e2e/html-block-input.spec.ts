import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  launchWithMarkdown,
  setSourceMarkdown,
  getMarkdownContent,
  typeIntoEditor,
  placeCaretInEditor,
  sendIpcToRenderer
} from './helpers'

// Reset the document to a single empty paragraph and place a collapsed caret
// inside it, so typing the HTML shortcut runs against a clean, focused block.
const resetToEmpty = async(page: Page, app: ElectronApplication) => {
  await setSourceMarkdown(page, app, '\n')
  await placeCaretInEditor(page)
}

test.describe('HTML block typing shortcut and single-image lowering', () => {
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

  test('typing "<div>" then Enter writes the upstream template with the caret between the tags', async() => {
    await resetToEmpty(page, app)

    // Type the open tag into the empty paragraph, then commit with Enter.
    await typeIntoEditor(page, '<div>')
    await page.keyboard.press('Enter')

    // Upstream MarkText writes `<div>`, a blank line and `</div>`. CommonMark
    // (and upstream's own parser on reopen) reads that as two html blocks with
    // an editable blank line between them, where the caret now sits.
    await expect
      .poll(async() => await getMarkdownContent(page, app), { timeout: 5000 })
      .toBe('<div>\n\n</div>\n')
    await expect(page.locator('.editor-component .mu-html-block')).toHaveCount(2)

    // Typing on that line fills the element, exactly as upstream saved it, and
    // the parser rejoins the text into one html block.
    await page.keyboard.type('x')
    await expect
      .poll(async() => await getMarkdownContent(page, app), { timeout: 5000 })
      .toBe('<div>\nx\n</div>\n')
    await expect(page.locator('.editor-component .mu-html-block')).toHaveCount(1)
    await expect(page.locator('.editor-component p.mu-paragraph')).toHaveCount(0)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect
      .poll(async() => await getMarkdownContent(page, app), { timeout: 5000 })
      .toBe('<div>\n\n</div>\n')
  })

  test('"<img src=x>" stays a paragraph, not an html-block', async() => {
    // Loading a lone <img> exercises the isSingleImage lowering branch in
    // markdownToState: it must remain a paragraph rather than become a block.
    await setSourceMarkdown(page, app, '<img src=x>\n')
    await page.waitForSelector('.editor-component p.mu-paragraph', {
      state: 'attached',
      timeout: 5000
    })

    // A paragraph is present and NO html-block was created.
    await expect(page.locator('.editor-component p.mu-paragraph')).toHaveCount(1)
    await expect(page.locator('.editor-component .mu-html-block')).toHaveCount(0)

    // Content round-trips losslessly back to the raw image markup.
    // (Source-mode serialization appends a trailing newline.)
    await expect
      .poll(async() => await getMarkdownContent(page, app), { timeout: 5000 })
      .toBe('<img src=x>\n')
  })
})
