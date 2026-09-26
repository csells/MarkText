import fs from 'node:fs'
import path from 'node:path'
import { _electron, expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  waitForEditor,
  waitForMenuReady,
  showReviewSidebar
} from './helpers'
import {
  defaultCoreLaunchEnvironment,
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'

async function launch(source: string) {
  const root = test.info().outputPath('fixture')
  fs.mkdirSync(root, { recursive: true })
  const file = path.join(root, 'inline.md')
  fs.writeFileSync(file, source, { flag: 'wx' })
  const executablePath = process.env.MARKTEXT_PACKAGED_APP
  if (!executablePath) {
    throw new Error('Installed inline presentation requires MARKTEXT_PACKAGED_APP')
  }
  const app = await _electron.launch({
    executablePath,
    args: ['--user-data-dir', path.join(root, 'profile'), file],
    env: defaultCoreLaunchEnvironment({
      PERF_TESTING: 'true',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1',
      MARKTEXT_ERROR_INTERACTION: '1'
    })
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.waitForLoadState('domcontentloaded')
    await waitForEditor(page)
    await waitForMenuReady(app)
    await expectInstalledArtifactCommit(page)
    await expectDefaultCoreAuthority(page)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    return { app, page, file, root, errors }
  } catch (error) {
    await app.close()
    throw error
  }
}

async function menu(app: ElectronApplication, section: string, label: string) {
  await app.evaluate(
    ({ Menu, BrowserWindow }, command) => {
      const item = Menu.getApplicationMenu()
        ?.items.find((item) => item.label === command.section)
        ?.submenu?.items.find((item) => item.label === command.label)
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

async function save(app: ElectronApplication, file: string, expected: string) {
  await menu(app, 'File', 'Save')
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(expected)
}

test('installed native math preview edits the selected suggestion and preserves history and exact save', async() => {
  const source = 'Plain $x^2$.\n\nSuggested {++$x^2$++}.\n\nCaret outside formulas.\n'
  const edited = 'Plain $x^2$.\n\nSuggested {++$y$++}.\n\nCaret outside formulas.\n'
  const { app, page, file, errors } = await launch(source)
  try {
    await page.locator('.editor-component .mu-content').last().click()
    const previews = page.locator('.editor-component .mu-math-render')
    await expect(previews).toHaveCount(2)
    await expect(previews.last().locator('.katex')).toHaveCount(1)
    await previews.last().click()
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('x^2')
    await page.keyboard.type('y')
    await save(app, file, edited)
    await menu(app, 'Edit', 'Undo')
    await save(app, file, source)
    await menu(app, 'Edit', 'Redo')
    await save(app, file, edited)
    expect(errors).toEqual([])
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('installed inline HTML retains native presentation and selects the repeated suggested text', async() => {
  const source =
    'Plain <kbd title="A &amp; B">key</kbd>.\n\nSuggested {++<kbd>key</kbd>++} and <u>underlined</u>.\n\nCaret outside tags.\n'
  const edited =
    'Plain <kbd title="A &amp; B">key</kbd>.\n\nSuggested {++<kbd>X</kbd>++} and <u>underlined</u>.\n\nCaret outside tags.\n'
  const { app, page, file, errors } = await launch(source)
  try {
    await page.locator('.editor-component .mu-content').last().click()
    const keys = page.locator('.editor-component kbd')
    await expect(keys).toHaveCount(2)
    await expect(keys.first()).toHaveAttribute('title', 'A & B')
    await expect(page.locator('.editor-component u')).toHaveText('underlined')
    // Entering the element reveals its editable tag syntax; select the word
    // once that layout has settled, as a user would.
    await keys.last().click()
    await keys.last().dblclick()
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('key')
    await page.keyboard.type('X')
    await save(app, file, edited)
    await menu(app, 'Edit', 'Undo')
    await save(app, file, source)
    await menu(app, 'Edit', 'Redo')
    await save(app, file, edited)
    expect(errors).toEqual([])
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('installed emoji matches Markup in reader modes, comments and the HTML export command', async() => {
  const source = 'Plain :smile: {++:smile:++} `:smile:`.\n\n{>>Note :smile: and $x^2$.<<}\n'
  const { app, page, file, root, errors } = await launch(source)
  try {
    await expect(page.locator('.editor-component [data-emoji="😄"]')).toHaveCount(2)
    await showReviewSidebar(app)
    await expect(page.locator('[data-projection="comment"]')).toContainText('Note 😄 and')
    await page.getByTestId('critic-review-original').click()
    await expect(page.locator('[data-projection="original"]')).toHaveText('Plain 😄  :smile:.\n')
    await page.getByTestId('critic-review-revised').click()
    await expect(page.locator('[data-projection="revised"]')).toHaveText('Plain 😄 😄 :smile:.\n')
    const htmlPath = path.join(root, 'inline.html')
    await app.evaluate(({ dialog, Menu, BrowserWindow }, destination) => {
      dialog.showSaveDialog = async() => ({ canceled: false, filePath: destination })
      const command = Menu.getApplicationMenu()
        ?.items.find((item) => item.label === 'File')
        ?.submenu?.items.find((item) => item.label === 'Export')
        ?.submenu?.items.find((item) => item.label === 'Export as HTML')
      const win = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().includes('type=editor')
      )
      if (!command?.enabled || !win) throw new Error('Export as HTML command is unavailable')
      command.click(command, win, { triggeredByAccelerator: false })
    }, htmlPath)
    const settings = page.locator('.print-settings-dialog .el-dialog')
    await expect(settings).toBeVisible()
    await settings.locator('.button-primary').click()
    await expect.poll(() => fs.existsSync(htmlPath)).toBe(true)
    const text = await page.evaluate(
      (html) =>
        new DOMParser()
          .parseFromString(html, 'text/html')
          .querySelector('article')
          ?.textContent?.trim(),
      fs.readFileSync(htmlPath, 'utf8')
    )
    expect(text).toBe('Plain 😄 😄 :smile:.')
    expect(fs.readFileSync(file, 'utf8')).toBe(source)
    expect(errors).toEqual([])
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})
