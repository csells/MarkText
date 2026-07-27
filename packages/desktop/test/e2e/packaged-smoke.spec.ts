import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  clickMenuById,
  closeElectron,
  expectNoCapturedErrors
} from './helpers'
import { expectInstalledArtifactCommit } from './installedArtifactProvenance'

// Plan 0009 acceptance for the packaged document-core application. The
// installed/mounted native distributable — not the electron-vite out/ tree —
// must complete a CriticMarkup review workflow hidden and without focus
// takeover. The packaged binary path arrives via MARKTEXT_PACKAGED_APP (set
// by the runner that mounted the DMG in an isolated location). This spec lives
// only in the installed Playwright project and fails if that runner omits the
// artifact; the ordinary unpacked project does not collect it.

const requiredPackagedBinary = (): string => {
  const configured = process.env.MARKTEXT_PACKAGED_APP
  if (configured === undefined || configured.trim().length === 0) {
    throw new Error(
      'MARKTEXT_PACKAGED_APP must name the mounted or installed MarkText executable'
    )
  }
  const absolute = path.resolve(configured)
  if (!fs.existsSync(absolute)) {
    throw new Error(`Installed MarkText executable does not exist: ${absolute}`)
  }
  return absolute
}

const SMOKE_DOC = [
  '# Packaged smoke',
  '',
  'keep {++added++} and {--removed--} and {~~old~>new~~}',
  'with {==marked==}{>>remember this<<}',
  ''
].join('\n')

test.describe('packaged document-core distributable smoke', () => {
  test.describe.configure({ timeout: 120000 })

  test('the mounted app opens, renders all five forms, projects, and saves', async() => {
    const packagedBinary = requiredPackagedBinary()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-packaged-smoke-'))
    const filePath = path.join(dir, 'smoke.md')
    const userDataDir = path.join(dir, 'profile')
    fs.writeFileSync(filePath, SMOKE_DOC)

    let app: Awaited<ReturnType<typeof electron.launch>> | undefined
    try {
      app = await electron.launch({
        executablePath: packagedBinary,
        args: ['--user-data-dir', userDataDir, filePath],
        env: {
          ...process.env,
          MARKTEXT_TEST_BACKGROUND: '1'
        }
      })
      expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData')))
        .toBe(userDataDir)
      const page = await app.firstWindow()
      await page.waitForSelector('.editor-component', {
        state: 'attached',
        timeout: 60000
      })
      await expectInstalledArtifactCommit(page)
      await expect(page.locator('.editor-component')).toContainText('added')

      // All five forms materialize as semantic critic nodes.
      const criticIds = page.locator('[data-critic-id]')
      await expect(criticIds.first()).toBeVisible()
      expect(await criticIds.count()).toBeGreaterThanOrEqual(5)

      // The parser-native highlight/comment pair folds into one comment card
      // in the real packaged Review UI. The other three tracked changes remain
      // independent cards.
      const sideBar = page.locator('.side-bar')
      if (!(await sideBar.isVisible())) {
        await clickMenuById(app, 'sideBarMenuItem')
        await expect(sideBar).toBeVisible()
      }
      await page.locator('.side-bar .left-column').getByRole('button', {
        name: 'Review'
      }).click()
      await expect(page.locator('.side-bar-review')).toBeVisible()
      await expect(page.locator('.review-card')).toHaveCount(4)
      await expect(page.locator('.review-card.type-comment')).toHaveCount(1)
      await expect(page.locator('.review-card.type-highlight')).toHaveCount(0)
      await expect(page.locator('.comment-anchor')).toHaveText('marked')

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
      await clickMenuById(app, 'reviewShowOriginalMenuItem')
      await expect(page.locator('.editor-component')).toHaveAttribute(
        'data-critic-projection',
        'original'
      )
      await expect(page.locator('.editor-component')).not.toContainText('added')
      await expect(page.locator('.editor-component')).toContainText('removed')

      // Canonical persistence: saving under a projection writes markup bytes.
      await clickMenuById(app, 'fileSaveMenuItem')
      await expect
        .poll(() => fs.readFileSync(filePath, 'utf8'), { timeout: 15000 })
        .toBe(SMOKE_DOC)

      // The packaged leg holds the same zero-captured-errors bar as the
      // build:unpack E2E: the capture harness ships in production main and
      // arms under MARKTEXT_TEST_BACKGROUND.
      await expectNoCapturedErrors(app)
    } finally {
      try {
        if (app !== undefined) await closeElectron(app)
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  })
})
