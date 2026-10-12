import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

// Upstream's opt-in `==highlight==`, GitLab inline diff and `>>>` fence, typed
// with the real keyboard into a Core-bound document beside CriticMarkup.
// Owner decision, 2026-10-12: `{++x++}`, `{--x--}` and `{==x==}` keep their
// CriticMarkup meaning with the upstream preferences on.

const lineEnd = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'

const setPreferences = async(page: Page, preferences: Record<string, unknown>): Promise<void> => {
  await page.evaluate((value) => {
    window.electron.ipcRenderer.send('mt::set-user-preference', value)
  }, preferences)
}

const save = async(app: ElectronApplication, page: Page, filePath: string, expected: string): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect.poll(() => readFileSync(filePath, 'utf8'), { timeout: 10000 }).toBe(expected)
  await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
}

const textOf = (page: Page, selector: string): Promise<string[]> =>
  page.locator(`.editor-component ${selector}`).allTextContents()

test.describe('upstream Markdown extensions typed beside CriticMarkup', () => {
  test('reads each spelling by its own syntax with the preferences on and off', async() => {
    const { app, page, filePath } = await launchWithMarkdown('Start\n', {
      env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
    })
    try {
      await setPreferences(page, { highlightSyntax: true, inlineDiff: true, autoPairBracket: true })
      await page.locator('.editor-component .mu-paragraph-content', { hasText: 'Start' }).click()
      await page.keyboard.press(lineEnd)
      await page.keyboard.type(' {+add+} {++crit++} [-del-] {--gone--} ==hi== {==note==}', { delay: 10 })

      const typed = 'Start {+add+} {++crit++} [-del-] {--gone--} ==hi== {==note==}\n'
      await save(app, page, filePath, typed)

      await expect.poll(() => textOf(page, 'ins.mu-inline-diff-addition')).toEqual(['add'])
      await expect.poll(() => textOf(page, 'del.mu-inline-diff-deletion')).toEqual(['del'])
      await expect.poll(() => textOf(page, 'mark.mu-inline-rule')).toEqual(['hi'])
      await expect.poll(() => textOf(page, '[data-critic-kind="addition"]')).toEqual(['crit'])
      await expect.poll(() => textOf(page, '[data-critic-kind="deletion"]')).toEqual(['gone'])
      await expect.poll(() => textOf(page, '[data-critic-kind="highlight"]')).toEqual(['note'])

      // Off again, upstream's spellings read as text and CriticMarkup is unchanged.
      await setPreferences(page, { highlightSyntax: false, inlineDiff: false })
      await expect.poll(() => textOf(page, 'ins.mu-inline-diff-addition, del.mu-inline-diff-deletion, mark.mu-inline-rule'))
        .toEqual([])
      await expect.poll(() => textOf(page, '[data-critic-kind="addition"]')).toEqual(['crit'])
      await expect.poll(() => textOf(page, '[data-critic-kind="highlight"]')).toEqual(['note'])
      await save(app, page, filePath, typed)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })

  test('opens a fenced quote with Enter on a typed >>> line', async() => {
    const { app, page, filePath } = await launchWithMarkdown('Start\n', {
      env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
    })
    try {
      await setPreferences(page, { multilineBlockquote: true })
      await page.locator('.editor-component .mu-paragraph-content', { hasText: 'Start' }).click()
      await page.keyboard.press(lineEnd)
      await page.keyboard.press('Enter')
      await page.keyboard.type('>>>', { delay: 20 })
      await page.keyboard.press('Enter')
      await page.keyboard.type('quoted', { delay: 10 })

      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8'), { timeout: 10000 }).toMatch(/^Start\n\n>>>\nquoted\n>>>\n?$/)
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
      await expect.poll(() => textOf(page, 'blockquote .mu-paragraph-content')).toEqual(['quoted'])
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })

  test('colours a selected word from the inline toolbar', async() => {
    const { app, page, filePath } = await launchWithMarkdown('hello world\n', {
      env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
    })
    try {
      await page.locator('.editor-component .mu-paragraph-content', { hasText: 'hello' }).dblclick({ position: { x: 8, y: 6 } })
      await expect(page.locator('.mu-format-picker')).toBeVisible()
      await page.locator('.mu-format-picker li.item.color i.caret').hover()
      await expect(page.locator('.mu-color-panel')).toBeVisible()
      await page.locator('.mu-color-panel .mu-color-swatch.text[data-color="#e64340"]').click()

      await save(app, page, filePath, '<span style="color:#e64340">hello</span> world\n')
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
})
