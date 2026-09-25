import { _electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import {
  enterSourceMode,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  placeCaretInEditor,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import {
  defaultCoreLaunchEnvironment,
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'

async function launch(profile: string, files: string[]) {
  const executablePath = process.env.MARKTEXT_PACKAGED_APP
  if (!executablePath) throw new Error('Installed desktop checks require MARKTEXT_PACKAGED_APP')
  const app = await _electron.launch({
    executablePath,
    args: ['--user-data-dir', profile, ...files],
    cwd: path.resolve(__dirname, '../..'),
    env: defaultCoreLaunchEnvironment({
      PERF_TESTING: 'true',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1',
      MARKTEXT_ERROR_INTERACTION: '1'
    })
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await waitForEditor(page)
  await waitForMenuReady(app)
  await expectInstalledArtifactCommit(page)
  await expectDefaultCoreAuthority(page)
  await expectEditorWindowHidden(app)
  expectEditorNotFrontmost(app)
  await app.evaluate(({ ipcMain }) => {
    const errors: unknown[] = []
    ;(globalThis as unknown as { desktopBasicsErrors: unknown[] }).desktopBasicsErrors = errors
    ipcMain.on('mt::handle-renderer-error', (_, error) => errors.push(error))
  })
  return { app, page }
}

async function menu(app: ElectronApplication, section: string, label: string) {
  await app.evaluate(
    ({ Menu, BrowserWindow }, command) => {
      const parent = Menu.getApplicationMenu()?.items.find(
        (item) => item.label.toLowerCase() === command.section.toLowerCase()
      )
      const item = parent?.submenu?.items.find(
        (item) => item.label.replace(/\u2026|\.\.\./g, '') === command.label
      )
      const win = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().includes('type=editor')
      )
      if (!item?.enabled || !win) {
        throw new Error(`Unavailable menu: ${command.section}/${command.label}`)
      }
      item.click(item, win, { triggeredByAccelerator: false })
    },
    { section, label }
  )
}

async function close(app: ElectronApplication) {
  const errors = await app.evaluate(
    () => (globalThis as unknown as { desktopBasicsErrors: unknown[] }).desktopBasicsErrors
  )
  expectEditorNotFrontmost(app)
  await app.close()
  expect(errors).toEqual([])
}

function fixture(source: string) {
  const folder = test.info().outputPath('fixture')
  fs.mkdirSync(folder, { recursive: true })
  const file = path.join(folder, 'note.md')
  fs.writeFileSync(file, source, { flag: 'wx' })
  return { file, profile: path.join(folder, 'profile') }
}

async function source(page: Page): Promise<string | undefined> {
  return page.evaluate(async() => {
    try {
      return await window.__marktextDocumentCore?.authoritySource?.()
    } catch (error) {
      // A reload retires the view that installed this hook; poll its replacement.
      if (/generation changed|lease is released/.test(String(error))) return undefined
      throw error
    }
  })
}

test('Preferences theme controls persist through closing the window and restarting', async() => {
  const original = 'settings {++fixture++} end\n'
  const { file, profile } = fixture(original)
  let { app, page } = await launch(profile, [file])
  let closed = false
  try {
    await menu(app, 'MarkText', 'Preferences')
    await expect.poll(() => app.windows().length).toBe(2)
    const prefs = app.windows().find((candidate) => candidate !== page)
    if (!prefs) throw new Error('Preferences did not create a window')
    await prefs.waitForLoadState('domcontentloaded')
    await prefs.getByText('Theme', { exact: true }).first().click()
    const follow = prefs.locator('.pref-switch-item').filter({ hasText: 'Follow System Theme' })
    if ((await follow.getByRole('switch').getAttribute('aria-checked')) === 'true') {
      await follow.locator('.el-switch').click()
    }
    await expect(follow.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    await prefs.locator('.theme.dark').click()
    await expect(prefs.locator('.theme.dark')).toHaveClass(/active/)
    await expect(page.locator('body')).toHaveClass(/dark/)
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().includes('type=settings')
      )
      if (!win) throw new Error('Preferences window is absent')
      win.close()
    })
    await expect.poll(() => prefs.isClosed()).toBe(true)
    await close(app)
    closed = true
    const restarted = await launch(profile, [])
    app = restarted.app
    page = restarted.page
    closed = false
    await expect(page.locator('body')).toHaveClass(/dark/)
    await placeCaretInEditor(page)
    await page.keyboard.type('X')
    await menu(app, 'File', 'Save')
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('settings {++fixture++} endX\n')
  } finally {
    if (!closed) await close(app)
  }
})

for (const mode of ['Markup', 'Source']) {
  test(`${mode}: a real disk change reloads with undo, redo and exact subsequent save`, async() => {
    const before = 'before {++suggestion++}\n'
    const after = 'after {~~old~>new~~}\n'
    const { file, profile } = fixture(before)
    const { app, page } = await launch(profile, [file])
    try {
      if (mode === 'Source') await enterSourceMode(page, app)
      // File watching registers asynchronously after the initial document opens.
      await page.waitForTimeout(1500)
      fs.writeFileSync(file, after)
      // Upstream (#3652) reloads a tab without local edits without asking.
      await expect.poll(() => source(page)).toBe(after)
      await expect(page.getByText('has been changed on disk')).toHaveCount(0)
      await expect(page.locator('.tabs-container li.active')).not.toHaveClass(/unsaved/)
      await menu(app, 'Edit', 'Undo')
      await expect.poll(() => source(page)).toBe(before)
      await expect(page.locator('.tabs-container li.active')).toHaveClass(/unsaved/)
      expect(fs.readFileSync(file, 'utf8')).toBe(after)
      await menu(app, 'Edit', 'Redo')
      await expect.poll(() => source(page)).toBe(after)
      await menu(app, 'Edit', 'Undo')
      await expect.poll(() => source(page)).toBe(before)
      await menu(app, 'File', 'Save')
      await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(before)
      await expect(page.locator('.tabs-container li.active')).not.toHaveClass(/unsaved/)
    } finally {
      await close(app)
    }
  })
}

test('Command palette executes a heading action and saves canonical Markdown plus suggestions', async() => {
  const { file, profile } = fixture('alpha {++beta++}\n')
  const { app, page } = await launch(profile, [file])
  try {
    await placeCaretInEditor(page)
    await menu(app, 'View', 'Command Palette')
    const input = page.locator('input.search').last()
    await expect(input).toBeVisible()
    await input.pressSequentially('Heading 1')
    await expect(page.locator('.commands li')).toHaveCount(1)
    await page.locator('.commands li').filter({ hasText: 'Heading 1' }).first().click()
    await expect(page.locator('.editor-component h1')).toHaveCount(1)
    await menu(app, 'File', 'Save')
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('# alpha {++beta++}\n')
    await menu(app, 'Edit', 'Undo')
    await expect.poll(() => source(page)).toBe('alpha {++beta++}\n')
    await menu(app, 'Edit', 'Redo')
    await expect.poll(() => source(page)).toBe('# alpha {++beta++}\n')
  } finally {
    await test.info().attach('palette-state.json', {
      body: JSON.stringify({
        source: await source(page),
        body: await page.locator('body').innerText()
      }),
      contentType: 'application/json'
    })
    await close(app)
  }
})
