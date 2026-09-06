import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expectEditorNotFrontmost, expectEditorWindowHidden, launchWithMarkdown, sendIpcToRenderer } from './helpers'

test('keeps a fresh Core view noneditable until its first authoritative lease is mounted', async() => {
  const { app, page, filePath } = await launchWithMarkdown('seed\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  const targetPath = join(dirname(filePath), 'initial-authority-target.md')
  writeFileSync(targetPath, 'seed\n', { flag: 'wx' })
  try {
    console.log('[initial authority] fixture loaded; installing first-open hold')
    await page.addInitScript(() => {
      const held: Array<() => void> = []
      let holding = true
      const host = window as typeof window & { releaseInitialCore?: () => void, heldInitialCore?: () => number }
      host.releaseInitialCore = () => { holding = false; held.splice(0).forEach(release => release()) }
      host.heldInitialCore = () => held.length
      const NativeWorker = Worker
      window.Worker = class extends NativeWorker {
        override postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]): void {
          const request = message as { request?: { type?: string } }
          const send = () => Array.isArray(options) ? super.postMessage(message, options) : super.postMessage(message, options)
          if (holding && request?.request?.type === 'open') held.push(send)
          else send()
        }
      }
    })
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 })
    // Main sends bootstrap only once per window. Re-enter that same production
    // boundary after reload so the hold is installed before the first document.
    await sendIpcToRenderer(app, 'mt::bootstrap-editor', {
      addBlankTab: true,
      markdownList: [],
      lineEnding: '\n',
      sideBarVisibility: false,
      tabBarVisibility: true,
      sourceCodeModeEnabled: false
    })
    console.log('[initial authority] renderer reloaded; waiting for held open')
    await page.waitForFunction(() => (window as typeof window & { heldInitialCore?: () => number }).heldInitialCore?.(), undefined, { timeout: 5000 })
    const paragraph = page.locator('span.mu-paragraph-content').first()
    await expect(paragraph).toBeAttached()
    await expect(page.locator('.editor-component [contenteditable="true"]')).toHaveCount(0)
    const before = await paragraph.textContent()
    await paragraph.evaluate(element => (element as HTMLElement).focus())
    await page.keyboard.type('early')
    await expect(paragraph).toHaveText(before ?? '')
    await page.evaluate(() => (window as typeof window & { releaseInitialCore?: () => void }).releaseInitialCore?.())
    await expect(paragraph).toHaveAttribute('contenteditable', 'true')
    await page.evaluate(path => window.electron.ipcRenderer.send('mt::open-file', path), targetPath)
    await expect(paragraph).toHaveText('seed')
    await paragraph.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' later')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(targetPath, 'utf8')).toBe('seed later\n')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await page.evaluate(() => (window as typeof window & { releaseInitialCore?: () => void }).releaseInitialCore?.()).catch(() => {})
    await app.close()
  }
})
