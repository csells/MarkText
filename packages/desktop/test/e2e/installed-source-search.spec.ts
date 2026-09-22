import { _electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import {
  enterSourceMode,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import {
  defaultCoreLaunchEnvironment,
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'

async function launch(source: string) {
  const root = test.info().outputPath('fixture')
  fs.mkdirSync(root, { recursive: true })
  const file = path.join(root, 'search.md')
  fs.writeFileSync(file, source, { flag: 'wx' })
  const executablePath = process.env.MARKTEXT_PACKAGED_APP
  if (!executablePath) throw new Error('Installed Source search requires MARKTEXT_PACKAGED_APP')
  const app = await _electron.launch({
    executablePath,
    args: ['--user-data-dir', path.join(root, 'profile'), file],
    cwd: path.resolve(__dirname, '../..'),
    env: defaultCoreLaunchEnvironment({
      PERF_TESTING: 'true',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1',
      MARKTEXT_ERROR_INTERACTION: '1'
    })
  })
  await app.evaluate(({ ipcMain }) => {
    const errors: unknown[] = []
    ;(globalThis as unknown as { sourceSearchErrors: unknown[] }).sourceSearchErrors = errors
    ipcMain.on('mt::handle-renderer-error', (_, error) => errors.push(error))
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await waitForEditor(page)
  await waitForMenuReady(app)
  await expectInstalledArtifactCommit(page)
  await expectDefaultCoreAuthority(page)
  await expectEditorWindowHidden(app)
  expectEditorNotFrontmost(app)
  await enterSourceMode(page, app)
  return { app, page, file }
}

async function close(app: ElectronApplication) {
  const errors = await app.evaluate(
    () => (globalThis as unknown as { sourceSearchErrors: unknown[] }).sourceSearchErrors
  )
  expectEditorNotFrontmost(app)
  await app.close()
  expect(errors).toEqual([])
}

async function nativeKey(
  app: ElectronApplication,
  keyCode: string,
  modifiers: Array<'meta' | 'shift'> = []
) {
  await app.evaluate(
    ({ BrowserWindow }, key) => {
      const wc = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().includes('type=editor')
      )?.webContents
      if (!wc) throw new Error('Editor window is unavailable')
      wc.sendInputEvent({ type: 'keyDown', keyCode: key.keyCode, modifiers: key.modifiers })
      wc.sendInputEvent({ type: 'keyUp', keyCode: key.keyCode, modifiers: key.modifiers })
    },
    { keyCode, modifiers }
  )
}

async function menu(app: ElectronApplication, section: string, label: string) {
  await app.evaluate(
    ({ Menu, BrowserWindow }, command) => {
      const item = Menu.getApplicationMenu()
        ?.items.find((item) => item.label === command.section)
        ?.submenu?.items.find((item) => item.label.replace(/\u2026|\.\.\./g, '') === command.label)
      const win = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().includes('type=editor')
      )
      if (!item?.enabled || !win) {
        throw new Error(`Unavailable menu ${command.section}/${command.label}`)
      }
      item.click(item, win, { triggeredByAccelerator: false })
    },
    { section, label }
  )
}

async function expectSource(page: Page, expected: string) {
  await expect
    .poll(() => page.evaluate(() => window.__marktextDocumentCore?.authoritySource?.()))
    .toBe(expected.replace(/\r\n/g, '\n'))
  await expect
    .poll(() =>
      page.evaluate(() => {
        const cm = document.querySelector('.source-code .CodeMirror') as
          | (HTMLElement & { CodeMirror?: { getValue(): string } })
          | null
        return cm?.CodeMirror?.getValue()
      })
    )
    .toBe(expected.replace(/\r\n/g, '\n'))
}

async function save(app: ElectronApplication, file: string, expected: string) {
  await menu(app, 'File', 'Save')
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(expected)
}

test('Source native Find navigates repeated raw matches and next typing uses the selected occurrence', async() => {
  const before = 'cat {++cat++} cat\n'
  const after = 'cat {++X++} cat\n'
  const { app, page, file } = await launch(before)
  try {
    await nativeKey(app, 'F', ['meta'])
    const input = page.locator('.search-bar .search input')
    await expect(input).toBeVisible()
    await input.pressSequentially('cat')
    await expect(page.locator('.search-result')).toHaveText('1 / 3')
    await nativeKey(app, 'G', ['meta'])
    await expect(page.locator('.search-result')).toHaveText('2 / 3')
    await nativeKey(app, 'Escape')
    await expect(page.locator('.search-bar')).toBeHidden()
    await page.keyboard.type('X')
    await expectSource(page, after)
    await save(app, file, after)
    await nativeKey(app, 'Z', ['meta'])
    await expectSource(page, before)
    await nativeKey(app, 'Z', ['meta', 'shift'])
    await expectSource(page, after)
    await save(app, file, after)
  } finally {
    await close(app)
  }
})

test('Source Replace uses raw syntax, regex captures, one history operation and exact CRLF save', async() => {
  const before = 'cat-12 {++cat-34++}\r\n{--cat-56--} cat-78\r\n'
  const single = '12:cat {++cat-34++}\r\n{--cat-56--} cat-78\r\n'
  const all = '12:cat {++34:cat++}\r\n{--56:cat--} 78:cat\r\n'
  const { app, page, file } = await launch(before)
  try {
    await menu(app, 'Edit', 'Replace')
    const input = page.locator('.search-bar .search input')
    await expect(input).toBeVisible()
    await expect(input).toBeFocused()
    await page.keyboard.type('(cat)\\-(\\d+)')
    await page.locator('.search-bar .is-regex').click()
    await expect(page.locator('.search-result')).toHaveText('1 / 4')
    await page.locator('.search-bar .replace input').fill('$2:$1')
    await page.locator('.search-bar .replace .button-group .button').last().click()
    await expectSource(page, single)
    await expect(page.locator('.search-result')).toHaveText('1 / 3')
    await page.locator('.search-bar .replace .button-group .button.right').click()
    await expectSource(page, all)
    await save(app, file, all)
    await nativeKey(app, 'Escape')
    await nativeKey(app, 'Z', ['meta'])
    await expectSource(page, single)
    await nativeKey(app, 'Z', ['meta', 'shift'])
    await expectSource(page, all)
    await save(app, file, all)
  } finally {
    await close(app)
  }
})
