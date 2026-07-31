import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  expectCanonicalOnDisk,
  closeDocumentCore,
  launchDocumentCore,
  redo,
  undo
} from './documentCoreReviewE2e'

const SOURCE = [
  '| a | b | c |',
  '| --- | :---: | ---: |',
  '| one | two | three |',
  '| four | five | six |',
  ''
].join('\n')

test.describe('document-core live table tools', () => {
  let app: ElectronApplication
  let page: Page
  let documentPath = ''

  test.beforeAll(async() => {
    const launched = await launchDocumentCore(SOURCE)
    app = launched.app
    page = launched.page
    documentPath = launched.filePath
  })

  test.afterAll(async() => closeDocumentCore(app))

  test('moves a column through the mounted localized toolbar with exact history', async() => {
    const selected = page.locator('.editor-component tbody td').filter({
      hasText: /^five$/
    })
    await expect(selected).toHaveCount(1)
    await selected.click()

    const tools = page.locator('.document-view-table-tools')
    await expect(tools).toBeVisible()
    await expect(tools.getByRole('button', {
      name: 'Move Column Left'
    })).toBeVisible()
    await tools.getByRole('button', { name: 'Move Column Left' }).click()

    const moved = [
      '| b | a | c |',
      '| :---: | --- | ---: |',
      '| two | one | three |',
      '| five | four | six |',
      ''
    ].join('\n')
    await expectCanonicalOnDisk(page, app, documentPath, moved)

    await undo(app)
    await expectCanonicalOnDisk(page, app, documentPath, SOURCE)
    await redo(app)
    await expectCanonicalOnDisk(page, app, documentPath, moved)
    await undo(app)
    await expectCanonicalOnDisk(page, app, documentPath, SOURCE)
  })

  test('cuts a pointer-selected rectangle through the OS clipboard', async() => {
    await app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'))
    const cells = page.locator('.editor-component tbody td')
    await cells.nth(1).dispatchEvent('pointerdown', {
      bubbles: true,
      buttons: 1
    })
    await cells.nth(5).dispatchEvent('pointerover', {
      bubbles: true,
      buttons: 1
    })
    await cells.nth(5).dispatchEvent('pointerup', {
      bubbles: true,
      buttons: 0
    })
    await expect(page.locator(
      '.editor-component td[data-table-selected="true"]'
    )).toHaveCount(4)

    await page.locator('.document-view-table-tools').getByRole('button', {
      name: 'Cut Cells'
    }).click()

    await expect.poll(() =>
      app.evaluate(({ clipboard }) => clipboard.readText())
    ).toBe('two\tthree\nfive\tsix')
    const cleared = [
      '| a | b | c |',
      '| --- | :---: | ---: |',
      '| one |   |   |',
      '| four |   |   |',
      ''
    ].join('\n')
    await expectCanonicalOnDisk(page, app, documentPath, cleared)

    await undo(app)
    await expectCanonicalOnDisk(page, app, documentPath, SOURCE)
    await redo(app)
    await expectCanonicalOnDisk(page, app, documentPath, cleared)
  })
})
