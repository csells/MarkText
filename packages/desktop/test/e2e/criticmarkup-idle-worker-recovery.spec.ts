import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  enterSourceMode, expectEditorNotFrontmost, expectEditorWindowHidden,
  launchWithMarkdown, sendIpcToRenderer, waitForMenuReady
} from './helpers'

for (const surface of ['wysiwyg', 'source', 'inactive tab'] as const) {
  test(`recovers acknowledged unsaved text after an idle Worker failure in ${surface}`, async() => {
    const { app, page, filePath } = await launchWithMarkdown('seed\n', {
      suppressErrorDialog: true,
      env: {
        MARKTEXT_DOCUMENT_CORE_MODE: undefined,
        MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
        MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: '1',
        MARKTEXT_E2E_HIDDEN_WINDOW: '1'
      }
    })
    try {
      await waitForMenuReady(app)
      await page.locator('.mu-paragraph-content').first().fill('acknowledged unsaved')
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      const generation = await page.evaluate(() => {
        const host = window as typeof window & { idleWorkerCrash?: () => void }
        host.idleWorkerCrash = window.__marktextDocumentCore?.crashWorker
        return window.__marktextDocumentCore?.generation
      })
      if (surface === 'source') await enterSourceMode(page, app)
      if (surface === 'inactive tab') {
        await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, 'other tab body\n')
        await expect(page.locator('.mu-paragraph-content').first()).toHaveText('other tab body')
        await page.evaluate(() => window.__marktextDocumentCore?.settled())
      }
      await page.evaluate(() => {
        const crash = (window as typeof window & { idleWorkerCrash?: () => void }).idleWorkerCrash
        if (crash === undefined) throw new Error('Missing Worker fault control')
        crash()
      })
      if (surface === 'inactive tab') {
        await expect(page.locator('.mu-paragraph-content').first()).toHaveText('other tab body')
        await sendIpcToRenderer(app, 'mt::switch-tab-by-index', 0)
        await expect(page.locator('.mu-paragraph-content').first()).toHaveText('acknowledged unsaved')
      }
      await page.waitForFunction(previous => {
        const current = window.__marktextDocumentCore?.generation
        return typeof current === 'number' && current !== previous
      }, generation)
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('acknowledged unsaved\n')
      for (const [action, expected] of [['undo', 'seed\n'], ['redo', 'acknowledged unsaved\n']] as const) {
        await sendIpcToRenderer(app, 'mt::editor-edit-action', action)
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
      }
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
    } finally {
      await app.close()
    }
  })
}
