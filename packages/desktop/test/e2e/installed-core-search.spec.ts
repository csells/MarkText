import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'

import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  sendIpcToRenderer,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import { expectInstalledArtifactCommit } from './installedArtifactProvenance'

const initialSource =
  '# cat heading\n\n' +
  'cat {++cat++} {--cat--} {~~legacy-cat~>cat~~} {>>cat private<<}\n\n' +
  'cat\n'
const replacedSource =
  '# dog heading\n\n' +
  'dog {++dog++} {--cat--} {~~legacy-cat~>dog~~} {>>cat private<<}\n\n' +
  'dog\n'

const SEARCH_BAR = '.search-bar'
const FIND_INPUT = '.search-bar .search input'
const REPLACE_INPUT = '.search-bar .replace .input-wrapper input'
const RESULT_COUNTER = '.search-bar .search-result'
const REPLACE_ALL = '.search-bar .replace .button-group .button.right'

const installedBinary = (): string => {
  const configured = process.env.MARKTEXT_PACKAGED_APP
  if (configured === undefined || configured.trim().length === 0) {
    throw new Error('MARKTEXT_PACKAGED_APP must name the installed MarkText executable')
  }
  const absolute = path.resolve(configured)
  if (!fs.existsSync(absolute)) {
    throw new Error(`Installed MarkText executable does not exist: ${absolute}`)
  }
  return absolute
}

const launchInstalled = async(
  binary: string,
  userDataDir: string,
  filePath: string
): Promise<{ app: ElectronApplication, page: Page }> => {
  const app = await electron.launch({
    executablePath: binary,
    args: ['--user-data-dir', userDataDir, filePath],
    env: {
      ...process.env,
      PERF_TESTING: 'true',
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1',
      MARKTEXT_ERROR_INTERACTION: '1'
    },
    timeout: 60_000
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await waitForEditor(page, 60_000)
    await waitForMenuReady(app, 60_000)
    await expectInstalledArtifactCommit(page)
    return { app, page }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
}

const counterText = (page: Page): Promise<string> =>
  page.locator(RESULT_COUNTER).innerText()

const openReplace = async(
  app: ElectronApplication,
  page: Page,
  query: string
): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-edit-action', 'replace')
  await expect(page.locator(SEARCH_BAR)).toBeVisible({ timeout: 5_000 })
  await expect(page.locator(REPLACE_INPUT)).toBeVisible({ timeout: 5_000 })
  await page.locator(FIND_INPUT).fill(query)
}

const saveAndExpect = async(
  app: ElectronApplication,
  filePath: string,
  expectedSource: string
): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(expectedSource)
}

test.describe('installed Core projected search authority', () => {
  test.describe.configure({ timeout: 180_000 })

  test('visible Revised search and replace-all are one actor history unit', async() => {
    const binary = installedBinary()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-search-'))
    const filePath = path.join(root, 'search.md')
    const userDataDir = path.join(root, 'profile')
    fs.writeFileSync(filePath, initialSource, 'utf8')
    let launched: { app: ElectronApplication, page: Page } | undefined
    try {
      launched = await launchInstalled(binary, userDataDir, filePath)
      const { app, page } = launched
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      expect(await page.evaluate(() =>
        window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
      )).toBeUndefined()

      const visibleEditorText = await page.locator('.editor-component').innerText()
      expect(visibleEditorText).not.toContain('legacy-cat')
      expect(visibleEditorText).not.toContain('cat private')

      await openReplace(app, page, 'cat')
      await expect.poll(() => counterText(page)).toContain('1 / 5')
      await expect(page.locator('.mu-highlight')).toHaveCount(1)
      await expect(page.locator('.mu-selection')).toHaveCount(4)

      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'findNext')
      await expect.poll(() => counterText(page)).toContain('2 / 5')
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'findNext')
      await expect.poll(() => counterText(page)).toContain('3 / 5')
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'findPrev')
      await expect.poll(() => counterText(page)).toContain('2 / 5')

      await page.locator(REPLACE_INPUT).fill('dog')
      await page.locator(REPLACE_ALL).click()
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await expect.poll(() => counterText(page)).toContain('/ 0')
      await saveAndExpect(app, filePath, replacedSource)

      await page.keyboard.press('Escape')
      await expect(page.locator(SEARCH_BAR)).toBeHidden({ timeout: 5_000 })

      // One undo restores all five projected replacements, proving replace-all
      // crossed the actor as one history unit rather than five independent edits.
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await saveAndExpect(app, filePath, initialSource)

      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await saveAndExpect(app, filePath, replacedSource)

      await app.close()
      launched = undefined
      const reopened = await launchInstalled(binary, userDataDir, filePath)
      launched = reopened
      await expectEditorWindowHidden(reopened.app)
      expectEditorNotFrontmost(reopened.app)
      expect(fs.readFileSync(filePath, 'utf8')).toBe(replacedSource)

      await openReplace(reopened.app, reopened.page, 'dog')
      await expect.poll(() => counterText(reopened.page)).toContain('1 / 5')
      await expect(reopened.page.locator('.mu-highlight')).toHaveCount(1)
      await expect(reopened.page.locator('.mu-selection')).toHaveCount(4)
    } finally {
      if (launched !== undefined) await launched.app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
