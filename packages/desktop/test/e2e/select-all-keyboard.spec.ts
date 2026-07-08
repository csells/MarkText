import { expect, test } from '@playwright/test'
import { focusEditor, launchWithMarkdown } from './helpers'

// editing-invariants.md §Select-all semantics: keyboard Cmd/Ctrl+A gives
// ONE-press whole-document selection (selection.selectWholeDocument());
// the progressive block-first escalation belongs to the menu/toolbar
// selectAll() only. The desktop intercepts the accelerator in the main
// process, so this must be pinned through the real keystroke path — the
// engine-level pins cannot see the interception.
test('one Cmd/Ctrl+A press selects the whole document, not just the current block', async() => {
  const { app, page } = await launchWithMarkdown('first para\n\nsecond para\n\nthird para here\n')
  try {
    await focusEditor(page)
    await page.locator('.mu-paragraph', { hasText: 'second para' }).first().click()

    // sendInputEvent goes through the RenderWidgetHost pipeline, so the
    // main-process accelerator interception (before-input-event) fires —
    // Playwright's CDP-injected keyboard.press bypasses it and would pin
    // the wrong path (the engine handler production never reaches).
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const modifiers: Array<'meta' | 'control'> =
        process.platform === 'darwin' ? ['meta'] : ['control']
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'a', modifiers })
      win.webContents.sendInputEvent({ type: 'char', keyCode: 'a', modifiers })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'a', modifiers })
    })

    await expect
      .poll(async() => page.evaluate(() => document.getSelection()?.toString() ?? ''), {
        timeout: 5000
      })
      .toContain('first para')
    const selectionText = await page.evaluate(() => document.getSelection()?.toString() ?? '')
    expect(selectionText).toContain('second para')
    expect(selectionText).toContain('third para here')
  } finally {
    await app.close()
  }
})

test('the Select All menu action stays progressive: first press selects the block', async() => {
  const { app, page } = await launchWithMarkdown('first para\n\nsecond para\n\nthird para here\n')
  try {
    await focusEditor(page)
    await page.locator('.mu-paragraph', { hasText: 'second para' }).first().click()

    // Drive the menu path (the mt::editor-edit-action IPC the menu click
    // sends), not the keyboard accelerator.
    await app.evaluate(async({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.send('mt::editor-edit-action', 'selectAll')
    })

    await expect
      .poll(async() => page.evaluate(() => document.getSelection()?.toString() ?? ''), {
        timeout: 5000
      })
      .toContain('second para')
    const selectionText = await page.evaluate(() => document.getSelection()?.toString() ?? '')
    expect(selectionText).not.toContain('first para')
    expect(selectionText).not.toContain('third para here')
  } finally {
    await app.close()
  }
})
