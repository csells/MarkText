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
import {
  defaultCoreLaunchEnvironment,
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'

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
): Promise<{ app: ElectronApplication; page: Page }> => {
  const app = await electron.launch({
    executablePath: binary,
    // Explicit preliminary runs may use the repository Electron executable.
    // Final installed verification leaves this unset and launches only the app.
    args: [
      ...(process.env.MARKTEXT_PRELIMINARY_APP_ROOT === undefined
        ? []
        : [path.resolve(process.env.MARKTEXT_PRELIMINARY_APP_ROOT)]),
      '--user-data-dir',
      userDataDir,
      filePath
    ],
    env: defaultCoreLaunchEnvironment({
      PERF_TESTING: 'true',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1',
      MARKTEXT_ERROR_INTERACTION: '1'
    }),
    timeout: 60_000
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await waitForEditor(page, 60_000)
    await waitForMenuReady(app, 60_000)
    await expectInstalledArtifactCommit(page)
    await expectDefaultCoreAuthority(page)
    return { app, page }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
}

const counterText = (page: Page): Promise<string> => page.locator(RESULT_COUNTER).innerText()

const openReplace = async(app: ElectronApplication, page: Page, query: string): Promise<void> => {
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

  test('escaped-hyphen regex selects visible matches and replaces each capture with exact undo', async() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-search-regex-'))
    const filePath = path.join(root, 'search.md')
    const source = '{++cat-12++} cat-34\n'
    fs.writeFileSync(filePath, source, 'utf8')
    let launched: { app: ElectronApplication; page: Page } | undefined
    try {
      launched = await launchInstalled(installedBinary(), path.join(root, 'profile'), filePath)
      const { app, page } = launched
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      await openReplace(app, page, '(cat)\\-(\\d+)')
      await page.locator(`${SEARCH_BAR} .is-regex`).click()
      await expect.poll(() => counterText(page)).toContain('1 / 2')
      await expect(page.locator('.mu-highlight')).toHaveText(['cat-12'])
      await expect(page.locator('.mu-selection')).toHaveText(['cat-34'])
      await page.locator(REPLACE_INPUT).fill('$2:$1')
      await page.locator(REPLACE_ALL).click()
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await saveAndExpect(app, filePath, '{++12:cat++} 34:cat\n')
      await page.keyboard.press('Escape')
      await expect(page.locator(SEARCH_BAR)).toBeHidden()
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await saveAndExpect(app, filePath, source)
    } finally {
      if (launched !== undefined) await launched.app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('one Revised match spans retained Markup pieces without highlighting the deletion', async() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-search-pieces-'))
    const filePath = path.join(root, 'search.md')
    const source = 'a{--old--}b {~~legacy~>cat~~}\n'
    fs.writeFileSync(filePath, source, 'utf8')
    let launched: { app: ElectronApplication; page: Page } | undefined
    try {
      launched = await launchInstalled(installedBinary(), path.join(root, 'profile'), filePath)
      const { app, page } = launched
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      await openReplace(app, page, 'ab')
      await expect.poll(() => counterText(page)).toContain('1 / 1')
      await expect(page.locator('.mu-highlight')).toHaveText(['a', 'b'])
      await expect(page.locator('.mu-selection')).toHaveCount(0)
      await page.locator(FIND_INPUT).fill('cat')
      await expect.poll(() => counterText(page)).toContain('1 / 1')
      await expect(page.locator('.mu-highlight')).toHaveText(['cat'])
      await page.locator(FIND_INPUT).fill('legacy')
      await expect.poll(() => counterText(page)).toContain('/ 0')
      await expect(page.locator('.mu-highlight')).toHaveCount(0)
      await saveAndExpect(app, filePath, source)
    } finally {
      if (launched !== undefined) await launched.app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('visible Revised search and replace-all are one actor history unit', async() => {
    const binary = installedBinary()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-search-'))
    const filePath = path.join(root, 'search.md')
    const userDataDir = path.join(root, 'profile')
    fs.writeFileSync(filePath, initialSource, 'utf8')
    let launched: { app: ElectronApplication; page: Page } | undefined
    try {
      launched = await launchInstalled(binary, userDataDir, filePath)
      const { app, page } = launched
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      expect(
        await page.evaluate(() => window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS)
      ).toBeUndefined()

      const visibleEditorText = await page.locator('.editor-component').innerText()
      expect(visibleEditorText).toContain('legacy-cat')
      expect(visibleEditorText).not.toContain('cat private')

      await openReplace(app, page, 'cat')
      await expect.poll(() => counterText(page)).toContain('1 / 5')
      await expect(page.locator('.mu-highlight')).toHaveText(['cat'])
      await expect(page.locator('.mu-selection')).toHaveText(['cat', 'cat', 'cat', 'cat'])

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
      await expect(reopened.page.locator('.mu-highlight')).toHaveText(['dog'])
      await expect(reopened.page.locator('.mu-selection')).toHaveText(['dog', 'dog', 'dog', 'dog'])
    } finally {
      if (launched !== undefined) await launched.app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
