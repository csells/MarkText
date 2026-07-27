import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  expectNoRendererErrors,
  readCanonicalMarkdown
} from './helpers'
import {
  closeDocumentCore,
  launchDocumentCoreWithKeybindings,
  openReviewSidebar,
  pressApplicationMenuAccelerator,
  pressUserKeybinding,
  selectWordByPointer
} from './documentCoreReviewE2e'

const COMMAND_PALETTE_ACCELERATOR = 'CmdOrCtrl+Alt+Shift+K'

test.describe('document-core Review command surfaces', () => {
  let app: ElectronApplication
  let page: Page
  const source = 'before {++target++} after\n'

  test.beforeAll(async() => {
    const launched = await launchDocumentCoreWithKeybindings(source, {
      'review.accept-current': 'CmdOrCtrl+Alt+Shift+A',
      'view.command-palette': COMMAND_PALETTE_ACCELERATOR
    })
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => closeDocumentCore(app))

  test('sidebar projection controls dispatch through the command center', async() => {
    await openReviewSidebar(page, app)
    const display = page.getByRole('group', { name: 'Display' })

    await display.getByRole('button', { name: 'Original' }).click()
    await expect(page.locator('.editor-component')).toHaveAttribute(
      'data-critic-projection',
      'original'
    )

    await display.getByRole('button', { name: 'Markup' }).click()
    await expect(page.locator('.editor-component')).toHaveAttribute(
      'data-critic-projection',
      'marked'
    )
    await expectNoRendererErrors(app)
  })

  test('menu palette and contextual tool dispatch the same intent', async() => {
    await selectWordByPointer(page, 'target')
    await pressApplicationMenuAccelerator(
      page,
      app,
      'reviewAcceptCurrentMenuItem'
    )
    await expectNoRendererErrors(app)
    await expect.poll(async() => ({
      markdown: await readCanonicalMarkdown(page),
      notifications: await page.locator('.editor-notifications').allTextContents()
    })).toEqual({
      markdown: 'before target after\n',
      notifications: []
    })
    await pressApplicationMenuAccelerator(page, app, 'editUndoMenuItem')
    await expect.poll(() => readCanonicalMarkdown(page)).toBe(source)

    await selectWordByPointer(page, 'target')
    await pressUserKeybinding(page, app, COMMAND_PALETTE_ACCELERATOR)
    const search = page.locator('.command-palette input.search')
    await expect(search).toBeVisible()
    await search.fill('Accept Change')
    await search.press('Enter')
    await expect.poll(() => readCanonicalMarkdown(page)).toBe(
      'before target after\n'
    )
    await pressApplicationMenuAccelerator(page, app, 'editUndoMenuItem')
    await expect.poll(() => readCanonicalMarkdown(page)).toBe(source)

    await openReviewSidebar(page, app)
    await page.locator('.review-card.type-addition .card-actions .accept').click()
    await expect.poll(() => readCanonicalMarkdown(page)).toBe(
      'before target after\n'
    )

    await pressUserKeybinding(page, app, COMMAND_PALETTE_ACCELERATOR)
    const exhaustedSearch = page.locator('.command-palette input.search')
    await expect(exhaustedSearch).toBeVisible()
    await exhaustedSearch.fill('Accept Change')
    await expect(page.locator('.command-palette .commands li')).toHaveCount(0)
    await exhaustedSearch.press('Escape')

    await pressUserKeybinding(
      page,
      app,
      'CmdOrCtrl+Alt+Shift+A'
    )
    await expect(page.locator('.editor-notifications')).toContainText(
      'This Review action is no longer available'
    )
    await expect.poll(() => readCanonicalMarkdown(page)).toBe(
      'before target after\n'
    )
    await expectNoRendererErrors(app)
  })
})
