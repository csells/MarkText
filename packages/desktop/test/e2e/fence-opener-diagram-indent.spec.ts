import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithMarkdown, placeCaretInEditor, sendIpcToRenderer } from './helpers'

// Upstream MarkText #5600 with the real keyboard: a diagram fence opener
// becomes a diagram block written with backticks and its closer, and an
// opener indented one to three spaces is written without its indentation.
for (const { typed, saved } of [
  { typed: '```mermaid', saved: '```mermaid\n\n```\n' },
  { typed: '~~~mermaid', saved: '```mermaid\n\n```\n' },
  { typed: '  ```js', saved: '```js\n\n```\n' },
  { typed: '   ~~~', saved: '~~~\n\n~~~\n' }
]) {
  test(`typing ${JSON.stringify(typed)} + Enter saves ${JSON.stringify(saved)}`, async() => {
    const { app, page, filePath } = await launchWithMarkdown('\n')
    try {
      await placeCaretInEditor(page)
      await page.keyboard.type(typed, { delay: 30 })
      // Let the language picker settle, as a person typing would.
      await page.waitForTimeout(300)
      await page.keyboard.press('Enter')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(saved)
      if (typed.includes('mermaid')) {
        await expect(page.locator('.editor-component .mu-diagram-block').first()).toBeVisible()
      }
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}
