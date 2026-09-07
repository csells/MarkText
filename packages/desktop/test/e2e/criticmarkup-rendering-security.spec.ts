import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost, expectEditorWindowHidden,
  launchWithMarkdown, sendIpcToRenderer
} from './helpers'

test('keeps untrusted markup inert in editable text, Comments and reader projections', async() => {
  const hostile = '<img src="invalid-local-image" onerror="window.__criticExecuted=true">'
  const source = 'Text {++[unsafe](javascript:alert%281%29)++}.\n\n' +
    '{>>## Comment\n\n[unsafe](javascript:alert%281%29)\n\n' + hostile +
    '\n\n<script>window.__criticExecuted=true</script>\n<<}\n\n' + hostile + '\n'
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    const inert = async() => {
      const editor = page.locator('.editor-component')
      await expect(editor.locator('script, [onerror], [onclick], a[href^="javascript:"]')).toHaveCount(0)
      expect(await page.evaluate(() =>
        (window as unknown as { __criticExecuted?: boolean }).__criticExecuted
      )).toBeUndefined()
    }
    await expect(page.locator('[data-critic-kind="addition"]')).toBeVisible()
    await inert()
    await page.getByTestId('critic-review-next').click()
    await expect(page.locator('[data-projection="comment"] h2')).toHaveText('Comment')
    await inert()
    for (const projection of ['original', 'revised']) {
      await page.getByTestId(`critic-review-${projection}`).click()
      await expect(page.locator(`[data-projection="${projection}"]`)).toBeVisible()
      await inert()
    }
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

const hostileArchitecture = '```mermaid\narchitecture-beta\n' +
    'group marktextMermaidPollution(cloud)[Marker]\n' +
    'service a(server)[A] in __proto__\n' +
    'service b(server)[B] in marktextMermaidPollution\n' +
    'a:R -- L:b\n```\n\nSafe {++text++}.\n'

for (const [name, source, diagram] of [
  ['normal document', 'Safe {++text++}.\n', false],
  ['normal architecture diagram', hostileArchitecture.replace('__proto__', 'marktextMermaidPollution'), true],
  ['hostile architecture diagram', hostileArchitecture, true]
] as const) {
  test(`keeps ${name} responsive without changing object prototypes or document bytes`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(source, {
      suppressErrorDialog: true,
      env: {
        MARKTEXT_DOCUMENT_CORE_MODE: undefined,
        MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
        MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
        MARKTEXT_E2E_HIDDEN_WINDOW: '1'
      }
    })
    try {
      if (diagram) {
        const preview = name === 'normal architecture diagram' ? '.mu-diagram-preview svg' : '.mu-diagram-error'
        await expect(page.locator(preview).first()).toBeAttached()
      }
      expect(await page.evaluate(() => Object.hasOwn(Object.prototype, 'marktextMermaidPollution'))).toBe(false)
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
    } finally {
      await app.close()
    }
  })
}
