import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown
} from './helpers'

test('reader headings retain unique native anchors through chained collisions', async() => {
  const source = '# heading\n\n## heading\n\n## heading-1\n\nReview {++addition++}.\n'
  const { app, page, filePath } = await launchWithReviewMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    for (const mode of ['original', 'revised'] as const) {
      await page.getByTestId(`critic-review-${mode}`).click()
      const reader = page.locator(`.editor-wrapper > [data-projection="${mode}"]`)
      await expect(reader).toBeVisible()
      await expect
        .poll(() => reader.locator('h1, h2').evaluateAll((nodes) => nodes.map((node) => node.id)))
        .toEqual(['heading', 'heading-1', 'heading-1-1'])
    }
    expect(readFileSync(filePath, 'utf8')).toBe(source)
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})
