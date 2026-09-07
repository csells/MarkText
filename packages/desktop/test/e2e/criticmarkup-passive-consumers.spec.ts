import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown as launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

test('refreshes Review after deleting a prefix beyond its retained source anchor', async() => {
  const { app, page, filePath } = await launchWithMarkdown(`${'word '.repeat(40)}\n\n{++new++}\n`, {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    const accept = page.getByTestId('critic-review-accept')
    await expect(accept).toBeEnabled()
    await page.evaluate(() => {
      const events: unknown[] = []
      Reflect.set(window, '__prefixDeletionEvents', events)
      for (const type of ['keydown', 'beforeinput', 'input']) {
        document.addEventListener(type, event => events.push({
          type,
          key: event instanceof KeyboardEvent ? event.key : undefined,
          inputType: event instanceof InputEvent ? event.inputType : undefined,
          selected: window.getSelection()?.toString(),
          active: document.activeElement?.className
        }), true)
      }
    })
    const paragraph = page.locator('span.mu-paragraph-content').first()
    await paragraph.click()
    await paragraph.evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    await page.keyboard.press('Backspace')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    try {
      await expect(page.locator('.word-count .text-center-vertical')).toHaveText('W 1')
    } catch (error) {
      console.log('Prefix deletion state:', await page.evaluate(async() => ({
        source: await window.__marktextDocumentCore?.authoritySource?.(),
        selected: window.getSelection()?.toString(),
        active: document.activeElement?.outerHTML,
        paragraphs: [...document.querySelectorAll('.mu-paragraph-content')].map(element => element.textContent),
        state: window.__marktextDocumentCore?.latest(),
        nativeEvents: Reflect.get(window, '__prefixDeletionEvents'),
        events: window.__marktextDocumentCore?.performanceEvents?.()
      })))
      throw error
    }
    expect(await page.evaluate(() => window.__marktextDocumentCore?.authoritySource?.())).toBe('\n\n{++new++}\n')
    expect(await page.evaluate(() => window.electron.ipcRenderer.invoke('mt::core-draft::list'))).toEqual([])
    await expect(accept).toBeEnabled()
    await accept.click()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('\n\nnew\n')
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('disables stale Review during native input, then refreshes its range and Revised count', async() => {
  const { app, page, filePath } = await launchWithMarkdown('seed {++new++} {--old--}\n', {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: '1',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  try {
    const accept = page.getByTestId('critic-review-accept')
    const counter = page.locator('.word-count .text-center-vertical')
    await expect(accept).toBeEnabled()
    await expect(counter).toHaveText('W 2')
    const paragraph = page.locator('span.mu-paragraph-content').first()
    await paragraph.click()
    await page.keyboard.press('Home')
    await page.keyboard.type('a ')
    await expect(accept).toBeDisabled()
    expect(await page.evaluate(() => window.__marktextDocumentCore?.performanceEvents?.()
      .some(event => event.phase === 'ack'))).toBe(false)
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await expect(accept).toBeEnabled()
    await expect(counter).toHaveText('W 3')
    await accept.click()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('a seed new {--old--}\n')
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'deletion')
    await expect(counter).toHaveText('W 3')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'addition')
    await expect(accept).toBeEnabled()
    await page.getByTestId('critic-review-reject').click()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('a seed  {--old--}\n')
    await expect(counter).toHaveText('W 2')
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})
