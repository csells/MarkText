import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  enterSourceMode, exitSourceMode, expectEditorNotFrontmost,
  expectEditorWindowHidden, expectNoRendererErrors, getMarkdownContent,
  launchWithMarkdown, sendIpcToRenderer
} from './helpers'

test('Source accepts immediate native input before deferred autofocus initialization', async() => {
  const { app, page, filePath } = await launchWithMarkdown('seed\n', {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: undefined,
      MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  try {
    await page.evaluate(() => {
      const schedule = window.setTimeout.bind(window)
      // Amplify CodeMirror 5's real 20 ms constructor-focus race. Its textarea
      // can already own DOM focus while input polling still considers it blurred.
      window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        const deferredFocus = delay === 20 &&
          String(callback).includes('.hasFocus()') && String(callback).includes('.state.focused')
        return schedule(callback, deferredFocus ? 1000 : delay, ...args)
      }) as typeof window.setTimeout
    })
    await enterSourceMode(page, app)
    await page.evaluate(() => {
      const cm = (document.querySelector('.source-code .CodeMirror') as Element & {
        CodeMirror: { setCursor(position: { line: number, ch: number }): void }
      }).CodeMirror
      cm.setCursor({ line: 0, ch: 4 })
    })
    await page.keyboard.type(' IMMEDIATE')
    await expect.poll(() => page.evaluate(() =>
      (document.querySelector('.source-code .CodeMirror') as Element & {
        CodeMirror: { getValue(): string }
      }).CodeMirror.getValue()
    )).toBe('seed IMMEDIATE\n')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('seed IMMEDIATE\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('seed\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await exitSourceMode(page, app)
    expect(await getMarkdownContent(page, app)).toBe('seed IMMEDIATE\n')
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})
