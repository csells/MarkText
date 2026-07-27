import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import {
  expectNoRendererErrors,
  launchWithMarkdown,
  readCanonicalMarkdown
} from './helpers'

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
    await expect.poll(() => readCanonicalMarkdown(page)).toBe(source)
    await expectNoRendererErrors(app)
  })

  test('keeps a lone inline HTML image in its semantic paragraph', async() => {
    const source = '<img src=x>\n'
    const launched = await launchWithMarkdown(source)
    runningApp = launched.app
    const { app, page } = launched

    const paragraph = page.locator(
      '.editor-component p.document-view-paragraph'
    )
    await expect(paragraph).toHaveCount(1)
    await expect(paragraph).toContainText('<img src=x>')
    await expect(
      page.locator('.editor-component .document-view-html-block')
    ).toHaveCount(0)
    await expect.poll(() => readCanonicalMarkdown(page)).toBe(source)
    await expectNoRendererErrors(app)
  })
})
