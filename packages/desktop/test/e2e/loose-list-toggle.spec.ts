import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeElectron,
  launchWithMarkdown,
  clickMenuById,
  setSourceMarkdown,
  getMarkdownContent,
  placeCaretInEditor,
  waitForMenuReady
} from './helpers'

// Item 41 — desktop e2e half of the loose/tight list-item toggle.
//
// The typed toggle intent has focused engine coverage, while this file owns
// its real menu action and menu-state reflection. What was not covered is the
// end-to-end "menu click flips the source blank-lines" path: a user with the
// caret inside a tight list invokes Paragraph → Loose List Item and the
// serialized markdown gains (or loses) the blank line between items.
//
// `looseListItemMenuItem` is a checkbox menu item wired to
// actions.looseListItem (src/main/menu/templates/paragraph.ts line 166), which
// drives the engine's loose/tight toggle on the current list.

// The loose-list toggle acts on the parser-owned selection. With only
// the list in the document, its first item's content is the first
// `.document-view-run`, so `placeCaretInEditor` reliably lands the caret in
// the list, including under xvfb.
test.describe('Loose/tight list-item toggle', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('seed\n')
    app = launched.app
    page = launched.page
    await waitForMenuReady(app)
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  // FIXME(headless): the loose/tight menu toggle acts on the engine's active
  // content block, which under xvfb is not reliably established for a caret
  // placed inside a list item (neither a synthetic click nor the keyup-based
  // placeCaretInEditor settles it), so the toggle no-ops and the source never
  // gains/loses the blank line. The typed action has focused unit coverage;
  // this row must prove the actual desktop menu path.
  test('menu click toggles a tight list loose (blank line) and back to tight', async() => {
    // Start from a tight 2-item bullet list — no blank line between items.
    await setSourceMarkdown(page, app, '- one\n- two\n')
    await expect(page.locator('.document-view-bullet-list .document-view-run').first()).toBeAttached()

    // Sanity: the list serializes tight before any toggle.
    const tightBefore = await getMarkdownContent(page, app)
    expect(tightBefore).toMatch(/- one\n- two/)

    // Caret inside the first item, then toggle Loose List Item → loose.
    await placeCaretInEditor(page)
    await clickMenuById(app, 'looseListItemMenuItem')

    // The serialized source now separates the items with a blank line.
    await expect
      .poll(async() => getMarkdownContent(page, app), { timeout: 5000 })
      .toMatch(/- one\n\n- two/)

    // Toggle again → tight: the blank line between items is removed.
    await placeCaretInEditor(page)
    await clickMenuById(app, 'looseListItemMenuItem')

    await expect
      .poll(async() => getMarkdownContent(page, app), { timeout: 5000 })
      .toMatch(/- one\n- two/)
    // And it is genuinely tight again (no blank line slipped through).
    const tightAgain = await getMarkdownContent(page, app)
    expect(tightAgain).not.toMatch(/- one\n\n- two/)
  })
})
