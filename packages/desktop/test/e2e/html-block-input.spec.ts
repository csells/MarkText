import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import {
  expectNoRendererErrors,
  launchWithMarkdown
} from './helpers'
import {
  expectCanonicalOnDisk
} from './documentCoreReviewE2e'

test.describe('Profile 1 HTML block and inline HTML classification', () => {
  let runningApp: ElectronApplication | undefined

  test.afterEach(async() => {
    await runningApp?.close()
    runningApp = undefined
  })

  test('mounts a raw HTML block as inert code without changing its source', async() => {
    const source = '<div>\ncontent\n</div>\n'
    const launched = await launchWithMarkdown(source)
    runningApp = launched.app
    const { app, page } = launched

    const block = page.locator(
      '.editor-component pre.document-view-html-block'
    )
    await expect(block).toHaveCount(1)
    await expect(block.locator('code')).toHaveText(
      '<div>\ncontent\n</div>\n'
    )
    await expect(
      page.locator('.editor-component p.document-view-paragraph')
    ).toHaveCount(0)
    await expectCanonicalOnDisk(page, app, launched.filePath, source)
    await expectNoRendererErrors(app)
  })

  // CommonMark HTML block type 7: a line that is one complete open tag (any
  // name except pre/script/style/textarea) followed by only whitespace starts
  // an HTML block — a lone '<img src=x>' line therefore IS an HTML block
  // under Profile 1, where muya deliberately deviated. Trailing text defeats
  // the whitespace-only requirement, so an image amid prose stays inline in
  // its paragraph; both readings round-trip byte-exactly.
  test('classifies a lone HTML image line as an HTML block', async() => {
    const source = '<img src=x>\n'
    const launched = await launchWithMarkdown(source)
    runningApp = launched.app
    const { app, page } = launched

    await expect(
      page.locator('.editor-component pre.document-view-html-block')
    ).toHaveCount(1)
    await expect(
      page.locator('.editor-component p.document-view-paragraph')
    ).toHaveCount(0)
    await expectCanonicalOnDisk(page, app, launched.filePath, source)
    await expectNoRendererErrors(app)
  })

  test('keeps an inline HTML image inside its semantic paragraph', async() => {
    const source = 'An image <img src=x> inline.\n'
    const launched = await launchWithMarkdown(source)
    runningApp = launched.app
    const { app, page } = launched

    const paragraph = page.locator(
      '.editor-component p.document-view-paragraph'
    )
    await expect(paragraph).toHaveCount(1)
    await expect(paragraph).toContainText('inline.')
    await expect(
      page.locator('.editor-component .document-view-html-block')
    ).toHaveCount(0)
    await expectCanonicalOnDisk(page, app, launched.filePath, source)
    await expectNoRendererErrors(app)
  })
})
