import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { expectNoRendererErrors } from './helpers'
import {
  closeDocumentCore,
  expectCanonicalOnDisk,
  launchDocumentCoreWithKeybindings,
  openReviewSidebar,
  pointForText,
  pressApplicationMenuAccelerator,
  pressUserKeybinding,
  selectWordByPointer
} from './documentCoreReviewE2e'

const COMMAND_PALETTE_ACCELERATOR = 'CmdOrCtrl+Alt+Shift+K'

test.describe('document-core Review command surfaces', () => {
  let app: ElectronApplication
  let page: Page
  let documentPath = ''
  const source = 'before {++target++} after\n'

  test.beforeAll(async() => {
    const launched = await launchDocumentCoreWithKeybindings(source, {
      'review.accept-current': 'CmdOrCtrl+Alt+Shift+A',
      'view.command-palette': COMMAND_PALETTE_ACCELERATOR
    })
    app = launched.app
    page = launched.page
    documentPath = launched.filePath
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
    await expectCanonicalOnDisk(page, app, documentPath, 'before target after\n')
    await expect.poll(() =>
      page.locator('.editor-notifications').allTextContents()
    ).toEqual([])
    await pressApplicationMenuAccelerator(page, app, 'editUndoMenuItem')
    await expectCanonicalOnDisk(page, app, documentPath, source)

    await selectWordByPointer(page, 'target')
    await pressUserKeybinding(page, app, COMMAND_PALETTE_ACCELERATOR)
    const search = page.locator('.command-palette input.search')
    await expect(search).toBeVisible()
    await search.fill('Accept Change')
    await search.press('Enter')
    await expectCanonicalOnDisk(page, app, documentPath, 'before target after\n')
    await pressApplicationMenuAccelerator(page, app, 'editUndoMenuItem')
    await expectCanonicalOnDisk(page, app, documentPath, source)

    await openReviewSidebar(page, app)
    await page.locator('.review-card.type-addition .card-actions .accept').click()
    await expectCanonicalOnDisk(page, app, documentPath, 'before target after\n')

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
    await expectCanonicalOnDisk(page, app, documentPath, 'before target after\n')
    await expectNoRendererErrors(app)
  })
})

test('an immediate pointer selection is settled before Accept Current', async() => {
  const source = 'one {++first++} two {++second++}\n'
  const launched = await launchDocumentCoreWithKeybindings(source, {
    'review.accept-current': 'CmdOrCtrl+Alt+Shift+A'
  })
  try {
    const point = await pointForText(launched.page, 'second')
    await launched.page.mouse.dblclick(point.x, point.y)
    await pressUserKeybinding(
      launched.page,
      launched.app,
      'CmdOrCtrl+Alt+Shift+A'
    )

    await expectCanonicalOnDisk(
      launched.page,
      launched.app,
      launched.filePath,
      'one {++first++} two second\n'
    )
    await pressApplicationMenuAccelerator(
      launched.page,
      launched.app,
      'editUndoMenuItem'
    )
    await expectCanonicalOnDisk(
      launched.page,
      launched.app,
      launched.filePath,
      source
    )
    await expectNoRendererErrors(launched.app)
  } finally {
    await closeDocumentCore(launched.app)
  }
})
