import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  closeElectron,
  getMarkdownContent,
  launchWithMarkdown,
  placeCaretInEditor,
  readCanonicalMarkdown,
  sendIpcToRenderer,
  typeIntoEditor
} from './helpers'

test.describe('document-core sole production authority', () => {
  let app: ElectronApplication
  let page: Page
  let filePath: string

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(
      '# Authority\n\nExact {++tracked++} source.\n'
    )
    app = launched.app
    page = launched.page
    filePath = launched.filePath
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  test('uses exact revision source as the only production editor authority', async() => {
    await expect(
      page.locator('.editor-component.document-view-container')
    ).toHaveAttribute(
      'data-document-mode',
      'semantic'
    )
    expect(await readCanonicalMarkdown(page)).toContain('{++tracked++}')

    const canonicalBeforeDomTamper = await readCanonicalMarkdown(page)
    await page.evaluate(() => {
      const run = document.querySelector('.document-view-run')
      if (run === null) throw new Error('No document-core run is mounted')
      run.textContent = 'renderer-only counterfeit'
    })
    await expect(page.locator('.editor-component')).toContainText(
      'renderer-only counterfeit'
    )
    expect(await readCanonicalMarkdown(page)).toBe(canonicalBeforeDomTamper)

    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(
      canonicalBeforeDomTamper
    )

    await placeCaretInEditor(page)
    await typeIntoEditor(page, 'Owned ')
    await expect.poll(() => readCanonicalMarkdown(page)).toContain('Owned ')
    await expect(page.locator('.editor-component')).not.toContainText(
      'renderer-only counterfeit'
    )
    expect(await getMarkdownContent(page, app)).toBe(
      await readCanonicalMarkdown(page)
    )
  })
})
