import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost, expectEditorWindowHidden, expectNoRendererErrors,
  launchWithMarkdown, sendIpcToRenderer
} from './helpers'

const literals = [
  { name: 'inline code', source: '`word`\n', selector: '.editor-component code', offset: 3, expected: '{~~`word`~>`woXYrd`~~}\n' },
  { name: 'inline math', source: '$word$\n', selector: '.mu-paragraph-content', offset: 3, expected: '{~~$word$~>$woXYrd$~~}\n' },
  { name: 'math block', activate: '.mu-math-preview', source: '$$\nword\n$$\n', selector: '.mu-math-block .mu-codeblock-content', offset: 2, expected: '{~~$$\nword\n$$~>$$\nwoXYrd\n$$~~}\n' },
  { name: 'front matter', source: '---\ntitle: word\n---\n', selector: '.mu-frontmatter .mu-codeblock-content', offset: 9, expected: '{~~---\ntitle: word\n---\n~>---\ntitle: woXYrd\n---\n~~}' },
  { name: 'terminated HTML', activate: '.mu-html-preview', source: '<script>word</script>\n', selector: '.mu-html-block .mu-codeblock-content', offset: 10, expected: '{~~<script>word</script>\n~><script>woXYrd</script>\n~~}' },
  { name: 'fenced code', source: '~~~js\nword\n~~~\n', selector: '.mu-codeblock-content', offset: 2, expected: '{~~~~~js\nword\n~~~\n~>~~~js\nwoXYrd\n~~~\n~~}' }
]
for (const literal of literals) {
  for (const timing of ['settled', 'queued']) {
    test(`tracks continued typing inside ${literal.name}, ${timing}, with exact source and history`, async() => {
      const { source } = literal
      const { app, page, filePath } = await launchWithMarkdown(source, {
        suppressErrorDialog: true,
        env: {
          MARKTEXT_DOCUMENT_CORE_MODE: undefined,
          MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
          MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: timing === 'queued' ? '1' : undefined,
          MARKTEXT_E2E_HIDDEN_WINDOW: '1'
        }
      })
      try {
        await page.getByTestId('critic-review-track-changes').click()
        if (literal.activate !== undefined && await page.locator(literal.activate).first().isVisible()) {
          await page.locator(literal.activate).first().click({ timeout: 5000 })
        }
        await page.locator(literal.selector).first().click()
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home')
        for (let offset = 0; offset < literal.offset; offset++) await page.keyboard.press('ArrowRight')
        await page.keyboard.type('X')
        if (timing === 'settled') await page.evaluate(() => window.__marktextDocumentCore?.settled())
        else expect(await page.evaluate(() => window.__marktextDocumentCore?.performanceEvents?.().some(event => event.phase === 'ack'))).toBe(false)
        await page.keyboard.type('Y')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(literal.expected)
        await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
        await expectEditorWindowHidden(app)
        expectEditorNotFrontmost(app)
        await expectNoRendererErrors(app)
      } finally {
        await app.close()
      }
    })
  }
}
