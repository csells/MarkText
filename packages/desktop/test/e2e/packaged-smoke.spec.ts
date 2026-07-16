import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'
import { expect, test } from '@playwright/test'

// Wave 7 packaged-artifact smoke (plan 0006): the installed/mounted native
// distributable — not the electron-vite out/ tree — must complete a
// CriticMarkup review workflow hidden and without focus takeover. The
// packaged binary path arrives via MARKTEXT_PACKAGED_APP (set by the runner
// that mounted the DMG in an isolated location); without it the smoke is
// skipped so ordinary E2E runs stay packaged-artifact-free.

const packagedBinary = process.env.MARKTEXT_PACKAGED_APP

const SMOKE_DOC = [
  '# Packaged smoke',
  '',
  'keep {++added++} and {--removed--} and {~~old~>new~~}',
  'with {==marked==} plus a note{>>remember this<<}',
  ''
].join('\n')

test.describe('packaged distributable smoke (plan 0006 Wave 7)', () => {
  test.skip(!packagedBinary, 'MARKTEXT_PACKAGED_APP not set')
  test.describe.configure({ timeout: 120000 })

  test('the mounted app opens, renders all five forms, projects, and saves', async() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-packaged-smoke-'))
    const filePath = path.join(dir, 'smoke.md')
    fs.writeFileSync(filePath, SMOKE_DOC)

    const app = await electron.launch({
      executablePath: packagedBinary,
      args: [filePath],
      env: {
        ...process.env,
        MARKTEXT_TEST_BACKGROUND: '1'
      }
    })
    try {
      const page = await app.firstWindow()
      await page.waitForSelector('.editor-component', {
        state: 'attached',
        timeout: 60000
      })
      await expect(page.locator('.editor-component')).toContainText('added')

      // All five forms materialize as semantic critic nodes.
      const criticIds = page.locator('[data-critic-id]')
      await expect(criticIds.first()).toBeVisible()
      expect(await criticIds.count()).toBeGreaterThanOrEqual(5)

      // The window stays hidden/unfocused under the background policy.
      const visible = await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        return { visible: win.isVisible(), focused: win.isFocused() }
      })
      expect(visible.visible).toBe(false)
      expect(visible.focused).toBe(false)

      // Projection to Original through the real menu; addition text leaves
      // the view, deletion text stays. Menu click handlers receive the
      // focused window from Electron; under the hidden background policy no
      // window ever gains focus, so pass the editor window explicitly —
      // MenuItem#click(event, focusedWindow, focusedWebContents) forwards it
      // to the same handler a user click would reach.
      await app.evaluate(({ Menu, BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        const item = Menu.getApplicationMenu()?.getMenuItemById(
          'reviewShowOriginalMenuItem'
        )
        if (!item) {
          throw new Error('Review menu item missing in packaged menu')
        }
        item.click(undefined, win, win.webContents)
      })
      await expect(page.locator('.editor-component')).toHaveAttribute(
        'data-critic-projection',
        'original'
      )
      await expect(page.locator('.editor-component')).not.toContainText('added')
      await expect(page.locator('.editor-component')).toContainText('removed')

      // Canonical persistence: saving under a projection writes markup bytes.
      await app.evaluate(({ Menu, BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        const item = Menu.getApplicationMenu()?.getMenuItemById('fileSaveMenuItem') ??
          Menu.getApplicationMenu()?.items
            .flatMap(top => top.submenu?.items ?? [])
            .find(candidate => candidate.role === 'save' || /^save$/i.test(candidate.label))
        if (!item) {
          throw new Error('Save menu item missing in packaged menu')
        }
        item.click(undefined, win, win.webContents)
      })
      await expect
        .poll(() => fs.readFileSync(filePath, 'utf8'), { timeout: 15000 })
        .toBe(SMOKE_DOC)
    } finally {
      await app.close()
    }
  })
})
