import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

// Owner decision: Undo returns the caret to where it was when the
// undone command ran, for Markdown and CriticMarkup commands alike. This
// deliberately differs from upstream MarkText, whose History restores the
// caret saved after the previous change (here, just after the first `x`).

const options = {
  suppressErrorDialog: true,
  env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
}

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

const caret = (page: Page) => page.evaluate(() => {
  const selection = window.getSelection()
  const content = document.querySelector('.mu-content')
  if (!selection?.anchorNode || !content?.contains(selection.anchorNode) || !selection.isCollapsed) return null
  const range = document.createRange()
  range.setStart(content, 0)
  range.setEnd(selection.anchorNode, selection.anchorOffset)
  return range.toString().length
})

const settled = (page: Page) => page.evaluate(() => window.__marktextDocumentCore?.settled())

test('Undo restores the caret where the undone typing began, not the previous change', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Alpha beta gamma.\n', options)
  try {
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await clickAt(page, 6)
    await page.keyboard.type('x')
    await settled(page)
    // Past the one-second window in which History joins changes.
    await page.waitForTimeout(1_200)
    await clickAt(page, 14)
    await page.keyboard.type('y')
    await settled(page)
    expect(await caret(page)).toBe(15)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await settled(page)
    await expect.poll(() => caret(page)).toBe(14)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('Alpha xbeta gamma.\n')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await settled(page)
    await expect.poll(() => caret(page)).toBe(15)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})
