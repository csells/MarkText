import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

// Owner decision (plan 0012 G24): typing in a cell pads the table as upstream
// does, but a row's text beyond the header's columns stays where upstream
// drops it.
test('typing in a header cell changes only the typed bytes, keeping extra cells, and undo restores them', async() => {
  const source = '|a|b|\n|-|-|\n|c|d|extra|\n|{++e++}|f|x \\| {>>y<<}|\n'
  const typed = '|aZ|b|\n|-|-|\n|c|d|extra|\n|{++e++}|f|x \\| {>>y<<}|\n'
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    const header = page.locator('.editor-component .mu-table-cell-content').first()
    await expect(header).toHaveText('a')
    const box = await header.boundingBox()
    if (box === null) throw new Error('Expected a rendered header cell')
    await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2)
    await page.keyboard.type('Z')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(typed)
    // Chromium keyboard injection does not invoke the hidden window's native
    // menu accelerator. Exercise the same command delivered by Edit > Undo.
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})
