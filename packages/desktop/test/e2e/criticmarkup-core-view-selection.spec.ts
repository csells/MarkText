import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  enterSourceMode,
  exitSourceMode,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

test('Core preserves a backward annotation-adjacent selection through both Source handoffs and history', async() => {
  const source = 'a{++b++}c\n'
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    await page.locator('.mu-paragraph-content').first().click()
    await page.evaluate(() => {
      const body = document.querySelector('.mu-paragraph-content')!
      const last = body.lastChild!
      if (last.textContent !== 'c') throw new Error('Expected final source-owned text')
      window.getSelection()!.setBaseAndExtent(last, 1, last, 0)
      body.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }))
    })
    await enterSourceMode(page, app)
    expect(
      await page.evaluate(() => {
        const host = document.querySelector('.source-code .CodeMirror') as Element & {
          CodeMirror: { listSelections(): unknown }
        }
        return host.CodeMirror.listSelections()
      })
    ).toEqual([{ anchor: { line: 0, ch: 9 }, head: { line: 0, ch: 8 } }])
    await exitSourceMode(page, app)
    expect(
      await page.evaluate(() => {
        const selection = window.getSelection()!
        const range = selection.getRangeAt(0)
        return {
          text: selection.toString(),
          backward:
            selection.anchorNode === range.endContainer &&
            selection.anchorOffset === range.endOffset
        }
      })
    ).toEqual({ text: 'c', backward: true })
    await page.keyboard.type('X')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('a{++b++}X\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('a{++b++}X\n')
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('Core retains a caret inside normalized literal text through an unchanged Source view', async() => {
  const source = '  ```math\n\tx\n  ```\n'
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    await page.evaluate(() =>
      window.electron.ipcRenderer.send('mt::set-user-preference', {
        isGitlabCompatibilityEnabled: true
      })
    )
    await page.locator('.mu-math-preview').first().click()
    const content = page.locator('.mu-math-block .mu-codeblock-content').first()
    await content.click()
    await content.evaluate((body) => {
      const first = body.firstChild!
      if (first.textContent !== '  x') throw new Error('Expected normalized literal text')
      window.getSelection()!.setBaseAndExtent(first, 1, first, 1)
      body.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
    })
    await enterSourceMode(page, app)
    await exitSourceMode(page, app)
    await page.keyboard.type('y')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('  ```math\n   y x\n  ```\n')
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
