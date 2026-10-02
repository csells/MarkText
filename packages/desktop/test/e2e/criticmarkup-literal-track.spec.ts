import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown as launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

const literals = [
  {
    name: 'inline code',
    source: '`word`\n',
    selector: '.editor-component code',
    offset: 3,
    expected: '{~~`word`~>`woXYrd`~~}\n'
  },
  // Native Muya edits a rendered formula through its preview, which reveals its source.
  {
    name: 'inline math',
    activate: '.mu-math-render',
    source: '$word$\n',
    selector: '.mu-math-text',
    offset: 3,
    expected: '{~~$word$~>$woXYrd$~~}\n'
  },
  {
    name: 'math block',
    activate: '.mu-math-preview',
    source: '$$\nword\n$$\n',
    selector: '.mu-math-block .mu-codeblock-content',
    offset: 2,
    expected: '{~~$$\nword\n$$~>$$\nwoXYrd\n$$~~}\n'
  },
  {
    name: 'front matter',
    source: '---\ntitle: word\n---\n',
    selector: '.mu-frontmatter .mu-codeblock-content',
    offset: 9,
    expected: '{~~---\ntitle: word\n---\n~>---\ntitle: woXYrd\n---\n~~}'
  },
  {
    name: 'terminated HTML',
    activate: '.mu-html-preview',
    source: '<script>word</script>\n',
    selector: '.mu-html-block .mu-codeblock-content',
    offset: 10,
    expected: '{~~<script>word</script>\n~><script>woXYrd</script>\n~~}'
  },
  {
    name: 'fenced code',
    source: '~~~js\nword\n~~~\n',
    selector: '.mu-codeblock-content',
    offset: 2,
    expected: '{~~~~~js\nword\n~~~\n~>~~~js\nwoXYrd\n~~~\n~~}'
  },
  // Inner lines of longer blocks, which a later key reads alone in the
  // proposed block (Core's arm line windows).
  {
    name: 'an inner line of fenced code',
    source: '~~~js\none\nword\nthree\nfour\n~~~\n',
    selector: '.mu-codeblock-content',
    clickAt: { text: 'word', offset: 2 },
    offset: 0,
    expected: '{~~~~~js\none\nword\nthree\nfour\n~~~\n~>~~~js\none\nwoXYrd\nthree\nfour\n~~~\n~~}'
  },
  {
    name: 'an inner line of indented code',
    source: '    one\n    word\n    three\n    four\n',
    selector: '.mu-codeblock-content',
    clickAt: { text: 'word', offset: 2 },
    offset: 0,
    expected: '{~~    one\n    word\n    three\n    four\n~>    one\n    woXYrd\n    three\n    four\n~~}'
  }
]
for (const literal of literals) {
  // Core acknowledges each native operation synchronously; 'consecutive' types
  // the next key without first waiting for the editor to settle.
  for (const timing of ['settled', 'consecutive']) {
    test(`tracks continued typing inside ${literal.name}, ${timing}, with exact source and history`, async() => {
      const { source } = literal
      const { app, page, filePath } = await launchWithMarkdown(source, {
        suppressErrorDialog: true,
        env: {
          MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
          MARKTEXT_E2E_HIDDEN_WINDOW: '1'
        }
      })
      try {
        await page.getByTestId('critic-review-track-changes').click()
        if (
          literal.activate !== undefined &&
          (await page.locator(literal.activate).first().isVisible())
        ) {
          await page.locator(literal.activate).first().click({ timeout: 5000 })
        }
        if (literal.clickAt === undefined) {
          await page.locator(literal.selector).first().click()
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home')
        } else {
          // Click inside an inner line at the character the key goes before.
          const { text, offset } = literal.clickAt
          const point = await page.locator(literal.selector).first().evaluate((element, target) => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
              const at = node.textContent?.indexOf(target.text) ?? -1
              if (at < 0) continue
              const range = document.createRange()
              range.setStart(node, at + target.offset)
              range.setEnd(node, at + target.offset + 1)
              const rect = range.getBoundingClientRect()
              return { x: rect.left + 1, y: rect.top + rect.height / 2 }
            }
            return undefined
          }, { text, offset })
          if (point === undefined) throw new Error(`No ${text} to click`)
          await page.mouse.click(point.x, point.y)
        }
        for (let offset = 0; offset < literal.offset; offset++) {
          await page.keyboard.press('ArrowRight')
        }
        await page.keyboard.type('X')
        if (timing === 'settled') {
          await page.evaluate(() => window.__marktextDocumentCore?.settled())
        }
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
