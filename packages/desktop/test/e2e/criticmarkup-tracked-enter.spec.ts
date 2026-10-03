import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown,
  sendIpcToRenderer
} from './helpers'

// Tracked Enter inside a paragraph of a document with more paragraphs is
// presented by patching the view regionally (a76a05de). Its text, caret,
// saved bytes, Review list and undo and redo must be what they were when
// every such key rebuilt the whole view.

const options = {
  suppressErrorDialog: true,
  env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
}

const source = 'Alpha beta gamma.\n\nSecond paragraph.\n\nThird paragraph.\n'

/** Clicks before the character at `offset` of the first paragraph. */
const clickAt = async(page: Page, offset: number): Promise<void> => {
  const point = await page.evaluate((at) => {
    const content = document.querySelector('.mu-content')
    const text = content?.firstChild
    if (!content || !text || text.nodeType !== Node.TEXT_NODE) throw new Error('No paragraph text')
    const range = document.createRange()
    range.setStart(text, at)
    range.setEnd(text, at + 1)
    const rect = range.getBoundingClientRect()
    return { x: rect.left + 0.5, y: rect.top + rect.height / 2 }
  }, offset)
  await page.mouse.click(point.x, point.y)
}

/** The collapsed caret as the paragraph's index and its text offset there. */
const caret = (page: Page) => page.evaluate(() => {
  const selection = window.getSelection()
  if (!selection?.anchorNode || !selection.isCollapsed) return null
  const paragraphs = [...document.querySelectorAll('span.mu-paragraph-content')]
  const index = paragraphs.findIndex((paragraph) => paragraph.contains(selection.anchorNode))
  if (index < 0) return null
  const range = document.createRange()
  range.setStart(paragraphs[index]!, 0)
  range.setEnd(selection.anchorNode, selection.anchorOffset)
  return [index, range.toString().length]
})

const settled = (page: Page) => page.evaluate(() => window.__marktextDocumentCore?.settled())
const paragraphs = (page: Page) => page.locator('span.mu-paragraph-content').allTextContents()

test('tracked Enter inside a paragraph keeps its text, caret, bytes, Review list and history', async() => {
  test.setTimeout(120_000)
  const { app, page, filePath } = await launchWithReviewMarkdown(source, options)
  const saved = async() => {
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  }
  try {
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    const toggle = page.getByTestId('critic-review-track-changes')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await clickAt(page, 6)
    await page.keyboard.press('Enter')
    await settled(page)
    await expect.poll(() => paragraphs(page)).toEqual(['Alpha ', 'beta gamma.', 'Second paragraph.', 'Third paragraph.'])
    await expect.poll(() => caret(page)).toEqual([1, 0])
    // Past the one-second window in which History joins changes.
    await page.waitForTimeout(1_200)
    await page.keyboard.type('x')
    await settled(page)
    await expect.poll(() => paragraphs(page)).toEqual(['Alpha ', 'xbeta gamma.', 'Second paragraph.', 'Third paragraph.'])
    await expect.poll(() => caret(page)).toEqual([1, 1])
    await expect(page.locator('[data-critic-kind="addition"]').last()).toContainText('x')

    await saved()
    const tracked = 'Alpha {++\n\nx++}beta gamma.\n\nSecond paragraph.\n\nThird paragraph.\n'
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)

    const entries = page.getByTestId('critic-review-list').getByTestId('critic-review-entry')
    await expect(entries).toHaveCount(1)
    await expect(entries.first()).toContainText('x')

    await page.waitForTimeout(1_200)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await settled(page)
    await expect.poll(() => paragraphs(page)).toEqual(['Alpha ', 'beta gamma.', 'Second paragraph.', 'Third paragraph.'])
    await expect.poll(() => caret(page)).toEqual([1, 0])
    await saved()
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('Alpha {++\n\n++}beta gamma.\n\nSecond paragraph.\n\nThird paragraph.\n')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await settled(page)
    await expect.poll(() => paragraphs(page)).toEqual(['Alpha beta gamma.', 'Second paragraph.', 'Third paragraph.'])
    await expect.poll(() => caret(page)).toEqual([0, 6])
    await expect(entries).toHaveCount(0)
    await saved()
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await settled(page)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await settled(page)
    await expect.poll(() => paragraphs(page)).toEqual(['Alpha ', 'xbeta gamma.', 'Second paragraph.', 'Third paragraph.'])
    await expect.poll(() => caret(page)).toEqual([1, 1])
    await expect(entries).toHaveCount(1)
    await saved()
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})
