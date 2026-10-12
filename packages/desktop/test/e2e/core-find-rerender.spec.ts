import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

// Upstream #5651 (#5652): a preference that re-renders every block kept the
// find bar's count while every highlight disappeared, and a parse-affecting
// one left a stale count and index. Core find keeps both: the highlights, the
// active match and the count follow the document as it now reads.

const FIND_INPUT = '.search-bar .search input'
const counterText = (page: Page): Promise<string> => page.locator('.search-bar .search-result').innerText()

const setPreferences = async(page: Page, preferences: Record<string, unknown>): Promise<void> => {
  await page.evaluate((value) => {
    window.electron.ipcRenderer.send('mt::set-user-preference', value)
  }, preferences)
}

/** Each highlighted match's text, and which of them is the active one. */
const highlights = (page: Page): Promise<{ texts: string[], active: number[] }> => page.evaluate(() => {
  const spans = [...document.querySelectorAll<HTMLElement>('.editor-component .mu-highlight, .editor-component .mu-selection')]
  return {
    texts: spans.map((span) => span.textContent ?? ''),
    active: spans.flatMap((span, index) => span.classList.contains('mu-highlight') ? [index] : [])
  }
})

const findText = async(page: Page, query: string): Promise<void> => {
  await page.locator(FIND_INPUT).click()
  await page.keyboard.type(query, { delay: 20 })
}

test.describe('Core find across a full re-render', () => {
  test('keeps the highlights and the active match when every block re-renders', async() => {
    const { app, page } = await launchWithMarkdown('apple banana apple\n\n```js\napple()\n```\n', {
      env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
    })
    try {
      await setPreferences(page, { codeBlockLineNumbers: false })
      await page.locator('.editor-component .mu-paragraph-content', { hasText: 'banana' }).click()
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'find')
      await findText(page, 'apple')
      await expect.poll(() => counterText(page)).toContain('1 / 3')
      await page.keyboard.press('Enter')
      await expect.poll(() => counterText(page)).toContain('2 / 3')
      await expect.poll(() => highlights(page)).toEqual({ texts: ['apple', 'apple', 'apple'], active: [1] })

      // Line numbers re-render every block (Muya's forced render).
      await setPreferences(page, { codeBlockLineNumbers: true })
      await expect(page.locator('.editor-component .mu-code-block.mu-line-numbers')).toHaveCount(1)
      await expect.poll(() => counterText(page)).toContain('2 / 3')
      await expect.poll(() => highlights(page)).toEqual({ texts: ['apple', 'apple', 'apple'], active: [1] })
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })

  test('recounts and clamps the active match when a preference changes the parse', async() => {
    const { app, page } = await launchWithMarkdown('{+x+} {+y+} plain+\n', {
      env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
    })
    try {
      await setPreferences(page, { inlineDiff: false })
      await page.locator('.editor-component .mu-paragraph-content', { hasText: 'plain' }).click()
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'find')
      await findText(page, '+')
      await expect.poll(() => counterText(page)).toContain('1 / 5')
      for (const step of [2, 3, 4, 5]) {
        await page.keyboard.press('Enter')
        await expect.poll(() => counterText(page)).toContain(`${step} / 5`)
      }

      // Inline diff reads `{+x+}` as an insertion: only `plain+` keeps a `+`.
      await setPreferences(page, { inlineDiff: true })
      await expect(page.locator('.editor-component ins.mu-inline-diff-addition')).toHaveCount(2)
      await expect.poll(() => counterText(page)).toContain('1 / 1')
      await expect.poll(() => highlights(page)).toEqual({ texts: ['+'], active: [0] })
      await expect(page.locator('.editor-component .mu-highlight')).toHaveCount(1)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })

  test('keeps the active match a parse-affecting preference leaves in place, and replaces it', async() => {
    const { app, page, filePath } = await launchWithMarkdown('apple {+x+} apple {+y+} apple\n', {
      env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
    })
    try {
      await setPreferences(page, { inlineDiff: false })
      await page.locator('.editor-component .mu-paragraph-content', { hasText: 'apple' }).click()
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'replace')
      await findText(page, 'apple')
      await expect.poll(() => counterText(page)).toContain('1 / 3')
      await page.keyboard.press('Enter')
      await expect.poll(() => counterText(page)).toContain('2 / 3')

      await setPreferences(page, { inlineDiff: true })
      await expect(page.locator('.editor-component ins.mu-inline-diff-addition')).toHaveCount(2)
      await expect.poll(() => counterText(page)).toContain('2 / 3')
      await expect.poll(() => highlights(page)).toEqual({ texts: ['apple', 'apple', 'apple'], active: [1] })

      // Replace One acts on the active match, not the first.
      await page.locator('.search-bar .replace .input-wrapper input').click()
      await page.keyboard.type('pear', { delay: 20 })
      await page.locator('.search-bar .replace .button-group .button:not(.right)').click()
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8'), { timeout: 10000 }).toBe('apple {+x+} pear {+y+} apple\n')
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
})
