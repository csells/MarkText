import { expect, test } from '@playwright/test'
import * as fs from 'node:fs'

import { launchWithMarkdown, placeCaretInEditor, sendIpcToRenderer } from './helpers'

// The launch switches that restored Muya-owned parsing and saving
// (`MARKTEXT_DOCUMENT_CORE_MODE=0`) or ran the diagnostic Shadow parser beside
// it (`MARKTEXT_DOCUMENT_CORE_SHADOW=1`) are retired. Setting them changes
// nothing: Core still owns the document, its view, and what is saved.

test('retired engine switches still launch the Core document', async() => {
  const { app, page, filePath } = await launchWithMarkdown('alpha {++beta++} omega\n', {
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '0', MARKTEXT_DOCUMENT_CORE_SHADOW: '1' }
  })
  try {
    expect(await page.evaluate(() => window.__marktextDocumentCore?.mode)).toBe('core')
    expect(
      await page.evaluate(() => Object.keys(window).filter((key) => key.includes('Shadow')))
    ).toEqual([])
    expect(
      await page.evaluate(() => [
        window.electron.process.env.MARKTEXT_DOCUMENT_CORE_MODE,
        window.electron.process.env.MARKTEXT_DOCUMENT_CORE_SHADOW
      ])
    ).toEqual([undefined, undefined])

    await placeCaretInEditor(page)
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type(' gamma')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect
      .poll(() => fs.readFileSync(filePath, 'utf8'), { timeout: 15_000 })
      .toContain('gamma')
    // Core keeps CriticMarkup byte for byte; the retired Muya serializer did not.
    expect(fs.readFileSync(filePath, 'utf8')).toContain('{++beta++}')
  } finally {
    await app.close()
  }
})
