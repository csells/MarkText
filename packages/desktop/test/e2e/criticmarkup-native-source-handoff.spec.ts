import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  getMarkdownContent,
  launchWithMarkdown,
  sendIpcToRenderer,
  setSourceMarkdown
} from './helpers'
import { enterSourceMode, exitSourceMode } from './helpers'

test('preserves one native Source typing group through save, undo, redo and WYSIWYG handoff', async() => {
  const { app, page, filePath } = await launchWithMarkdown('seed\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    await enterSourceMode(page, app)
    await page.evaluate(() => {
      const host = document.querySelector('.source-code .CodeMirror') as Element & {
        CodeMirror: { focus(): void, setCursor(position: { line: number, ch: number }): void }
      }
      host.CodeMirror.focus()
      host.CodeMirror.setCursor({ line: 0, ch: 4 })
    })
    await page.keyboard.type(' EXTRA')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('seed EXTRA\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('seed\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await exitSourceMode(page, app)
    expect(await getMarkdownContent(page, app)).toBe('seed EXTRA\n')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('seed EXTRA\n')
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('an earlier acknowledgement preserves native input buffered for the next animation frame', async() => {
  const { app, page } = await launchWithMarkdown('seed\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    await expect.poll(() => page.evaluate(() => window.__marktextDocumentCore?.generation)).toEqual(expect.any(Number))
    const paragraph = page.locator('.mu-paragraph-content').first()
    await paragraph.click()
    await page.keyboard.press('End')
    await page.keyboard.type('X')
    await expect.poll(() => page.evaluate(() =>
      window.__marktextDocumentCore?.performanceEvents?.().some(event => event.phase === 'dispatch')
    ), { intervals: [5, 10, 20] }).toBe(true)
    await page.evaluate(() => {
      const request = window.requestAnimationFrame.bind(window)
      const cancel = window.cancelAnimationFrame.bind(window)
      const callbacks = new Map<number, FrameRequestCallback>()
      let identifier = 1000000000
      window.requestAnimationFrame = callback => {
        callbacks.set(++identifier, callback)
        return identifier
      }
      window.cancelAnimationFrame = id => {
        if (!callbacks.delete(id)) cancel(id)
      }
      ;(window as unknown as { releaseNativeFrames(): void }).releaseNativeFrames = () => {
        window.requestAnimationFrame = request
        window.cancelAnimationFrame = cancel
        for (const callback of callbacks.values()) request(callback)
        callbacks.clear()
      }
    })
    await page.keyboard.type('Y')
    await expect(paragraph).toHaveText('seedXY')
    expect(await page.evaluate(() =>
      window.__marktextDocumentCore?.performanceEvents?.().some(event => event.phase === 'ack')
    )).toBe(false)
    await expect.poll(() => page.evaluate(() =>
      window.__marktextDocumentCore?.performanceEvents?.().some(event => event.phase === 'reconcile')
    ), { intervals: [5, 10, 20] }).toBe(true)
    await expect(paragraph).toHaveText('seedXY')
    await page.evaluate(() => (window as unknown as { releaseNativeFrames(): void }).releaseNativeFrames())
    expect(await getMarkdownContent(page, app)).toBe('seedXY\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    // These consecutive keys share Muya's native typing group, even though an
    // authority acknowledgement arrived between their native frame flushes.
    expect(await getMarkdownContent(page, app)).toBe('seed\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    expect(await getMarkdownContent(page, app)).toBe('seedXY\n')
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('native fence language selection survives pending typing and Source handoff', async() => {
  const { app, page } = await launchWithMarkdown('seed\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    const errors: string[] = []
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await setSourceMarkdown(page, app, '\n')
    await page.locator('.mu-paragraph-content').first().click()
    await page.keyboard.type('```js', { delay: 30 })
    await expect(page.locator('.mu-list-picker').first()).toBeVisible()
    const before = await page.evaluate(() => ({
      latest: window.__marktextDocumentCore?.latest(),
      events: window.__marktextDocumentCore?.performanceEvents?.()
    }))
    await page.keyboard.press('Enter')
    await expect(page.locator('.mu-fenced-code .mu-language-input')).toHaveText('js')
    const after = await page.evaluate(() => ({
      latest: window.__marktextDocumentCore?.latest(),
      events: window.__marktextDocumentCore?.performanceEvents?.()
    }))
    const source = await getMarkdownContent(page, app)
    const diagnosticPath = test.info().outputPath('fence-native-transition.json')
    await writeFile(diagnosticPath, JSON.stringify({ before, after, errors, source }, null, 2))
    await test.info().attach('fence-native-transition', {
      path: diagnosticPath, contentType: 'application/json'
    })
    expect(source).toBe('```js\n\n```\n')
    expect(errors).toEqual([])
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('Source handoff preserves unacknowledged native typing and its history', async() => {
  const source = 'seed\n'
  const { app, page } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expect.poll(() => page.evaluate(() => window.__marktextDocumentCore?.generation)).toEqual(expect.any(Number))
    const generation = await page.evaluate(() => window.__marktextDocumentCore?.generation)
    await page.locator('.mu-paragraph-content').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type('X')
    await expect.poll(() => page.evaluate(() =>
      window.__marktextDocumentCore?.performanceEvents?.().some(event => event.phase === 'dispatch')
    ), { intervals: [5, 10, 20] }).toBe(true)
    expect(await page.evaluate(() =>
      window.__marktextDocumentCore?.performanceEvents?.().some(event => event.phase === 'ack')
    )).toBe(false)
    expect(await getMarkdownContent(page, app)).toBe('seedX\n')
    expect(await page.evaluate(() => window.__marktextDocumentCore?.generation)).toBe(generation)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    expect(await getMarkdownContent(page, app)).toBe(source)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    expect(await getMarkdownContent(page, app)).toBe('seedX\n')
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

for (const mode of ['direct', 'source-roundtrip'] as const) {
  test(`native list nesting reaches Source after ${mode}`, async() => {
    const source = '- one\n- two\n'
    const { app, page } = await launchWithMarkdown(mode === 'direct' ? source : 'seed\n', {
      suppressErrorDialog: true,
      env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
    })
    try {
      const errors: string[] = []
      page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text())
      })
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      if (mode === 'source-roundtrip') await setSourceMarkdown(page, app, source)
      await expect.poll(() => page.evaluate(() => window.__marktextDocumentCore?.generation)).toEqual(expect.any(Number))
      const generation = await page.evaluate(() => window.__marktextDocumentCore?.generation)
      await page.locator('.mu-paragraph-content').nth(1).click()
      await page.keyboard.press('End')
      await page.keyboard.press('Tab')
      await expect(page.locator('.editor-component li ul li')).toHaveText('two')
      // Deliberately enter Source before the test-held acknowledgement arrives.
      expect(await getMarkdownContent(page, app)).toBe('- one\n  - two\n')
      expect(await page.evaluate(() => window.__marktextDocumentCore?.generation)).toBe(generation)
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      expect(await getMarkdownContent(page, app)).toBe(source)
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
      expect(await getMarkdownContent(page, app)).toBe('- one\n  - two\n')
      expect(errors).toEqual([])
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}
