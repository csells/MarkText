import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

test('keeps a fresh Core view noneditable until its first authoritative lease is mounted', async() => {
  const { app, page, filePath } = await launchWithMarkdown('seed\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  const targetPath = join(dirname(filePath), 'initial-authority-target.md')
  writeFileSync(targetPath, 'seed\n', { flag: 'wx' })
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 })
    // The model opens synchronously now. Before Main supplies the initial
    // document there is no editable legacy view that can consume early input.
    await expect(page.locator('.editor-component [contenteditable="true"]')).toHaveCount(0)
    await page.keyboard.type('early')
    // Main sends bootstrap only once per window. Re-enter that same production
    // boundary after reload, then exercise the normal incoming-file route.
    await sendIpcToRenderer(app, 'mt::bootstrap-editor', {
      addBlankTab: true,
      markdownList: [],
      lineEnding: '\n',
      sideBarVisibility: false,
      tabBarVisibility: true,
      sourceCodeModeEnabled: false
    })
    const paragraph = page.locator('span.mu-paragraph-content').first()
    await expect(paragraph).toHaveAttribute('contenteditable', 'true')
    await expect(paragraph).toHaveText('')
    await page.evaluate(
      (path) => window.electron.ipcRenderer.send('mt::open-file', path),
      targetPath
    )
    await expect(paragraph).toHaveText('seed')
    await paragraph.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' later')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(targetPath, 'utf8')).toBe('seed later\n')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})
