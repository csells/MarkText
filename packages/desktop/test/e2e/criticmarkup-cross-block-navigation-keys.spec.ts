import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'
import { expectDefaultCoreAuthority } from './installedArtifactProvenance'

// A documented deviation from upstream (plan 0012 G26): upstream removed a
// selection spanning paragraphs on any key but an arrow or modifier, so
// Shift+Down, Shift+Down, then End or Escape deleted two paragraphs.

const SOURCE = 'one\n\ntwo\n\nthree\n'

async function selectThreeParagraphs(page: Page): Promise<void> {
  // PageDown and PageUp scroll the editor with an animation. Click through the
  // paragraph, at a point relative to it, so the click waits until the
  // paragraph stops moving instead of landing where it was.
  const paragraph = page.locator('span.mu-paragraph-content').first()
  const position = await paragraph.evaluate((element) => {
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()
    if (!text) throw new Error('The first paragraph has no text')
    const range = document.createRange()
    range.setStart(text, 1)
    range.setEnd(text, 1)
    const rect = range.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    return { x: rect.left - box.left, y: rect.top - box.top + rect.height / 2 }
  })
  await paragraph.click({ position })
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toContain('two')
}

test('navigation keys and Escape keep a selection spanning paragraphs', async() => {
  const { app, page, filePath } = await launchWithMarkdown(SOURCE, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await expectDefaultCoreAuthority(page)
    await expectEditorWindowHidden(app)
    const paragraphs = page.locator('span.mu-paragraph-content')
    for (const key of [
      'End',
      'Home',
      'PageDown',
      'PageUp',
      'Shift+End',
      'Shift+Home',
      'Shift+PageDown',
      'Meta+Shift+ArrowRight',
      'Escape',
      'Tab',
      'F2'
    ]) {
      await selectThreeParagraphs(page)
      await page.keyboard.press(key)
      await expect(paragraphs, key).toHaveText(['one', 'two', 'three'])
    }
    // The document is unchanged: a later edit saves every paragraph.
    await paragraphs.last().click()
    await page.keyboard.press('Meta+ArrowRight')
    await page.keyboard.type('Z')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('one\n\ntwo\n\nthreeZ\n')
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('typing still replaces a selection spanning paragraphs, and undo restores it', async() => {
  const { app, page, filePath } = await launchWithMarkdown(SOURCE, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await expectDefaultCoreAuthority(page)
    await selectThreeParagraphs(page)
    await page.keyboard.type('x')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('oxhree\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(SOURCE)
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})
