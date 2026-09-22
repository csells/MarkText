import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchElectron,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import {
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'

const launchOptions = {
  suppressErrorDialog: true,
  env: {
    MARKTEXT_E2E_HIDDEN_WINDOW: '1',
    MARKTEXT_DOCUMENT_CORE_MODE: undefined,
    MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
    MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined
  }
} as const

async function ready(app: ElectronApplication, page: Page): Promise<void> {
  await waitForEditor(page)
  await waitForMenuReady(app)
  await expectDefaultCoreAuthority(page)
  if (process.env.MARKTEXT_PACKAGED_APP) await expectInstalledArtifactCommit(page)
  await expectEditorWindowHidden(app)
  await expectEditorNotFrontmost(app)
}

async function menu(app: ElectronApplication, page: Page, label: string): Promise<void> {
  const handle = await app.browserWindow(page)
  const windowId = await handle.evaluate((win) => win.id)
  await handle.dispose()
  await app.evaluate(
    ({ BrowserWindow, Menu }, { windowId, label }) => {
      const win = BrowserWindow.fromId(windowId)
      if (!win || win.isVisible() || win.isFocused()) {
        throw new Error('Expected private hidden editor')
      }
      const item = Menu.getApplicationMenu()
        ?.items.flatMap((item) => item.submenu?.items ?? [])
        .find((item) => item.label === label)
      if (!item || !item.enabled) throw new Error(`Unavailable menu item: ${label}`)
      item.click(undefined, win, win.webContents)
    },
    { windowId, label }
  )
}

async function typeAtEnd(page: Page, text: string): Promise<void> {
  const paragraph = page.locator('.mu-paragraph-content[contenteditable=true]').first()
  await paragraph.click()
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.type(text)
}

async function open(page: Page, pathname: string): Promise<void> {
  await page.evaluate(
    (pathname) => window.electron.ipcRenderer.send('mt::open-file', pathname),
    pathname
  )
  await expect(page.locator('.tabs-container li.active')).toHaveAttribute('title', pathname)
  await waitForEditor(page)
}

async function controlSavePicker(app: ElectronApplication, pathname: string): Promise<void> {
  await app.evaluate(({ dialog }, pathname) => {
    dialog.showSaveDialog = async() => ({ canceled: false, filePath: pathname })
    dialog.showMessageBox = async() => ({ response: 2, checkboxChecked: false })
  }, pathname)
}

for (const location of ['same window', 'another window', 'symlink alias'] as const) {
  test(`Save As refuses an already-open dirty destination in ${location}`, async() => {
    const scratch = mkdtempSync(join(tmpdir(), 'marktext-save-ownership-'))
    const source = join(scratch, 'a.md')
    const destination = join(scratch, 'b.md')
    writeFileSync(source, 'seed\n\nText {++keep++}.\n', { flag: 'wx' })
    writeFileSync(destination, 'other\n\nOther {--keep--}.\n', { flag: 'wx' })
    let selectedDestination = destination
    if (location === 'symlink alias') {
      const alias = `${scratch}-alias`
      symlinkSync(scratch, alias, 'dir')
      selectedDestination = join(alias, 'b.md')
    }
    const { app, page } = await launchElectron([source], launchOptions)
    try {
      await ready(app, page)
      await controlSavePicker(app, selectedDestination)
      await typeAtEnd(page, ' SOURCE')
      let other = page
      if (location === 'another window') {
        const newWindow = app.waitForEvent('window', { timeout: 10000 })
        await menu(app, page, 'New Window')
        other = await newWindow
        await waitForEditor(other)
      }
      await open(other, destination)
      await ready(app, other)
      await typeAtEnd(other, ' UNSAVED')
      if (other === page) {
        await page.locator(`.tabs-container li[title="${source}"]`).click()
        await waitForEditor(page)
      }
      await controlSavePicker(app, selectedDestination)
      await menu(app, page, 'Save As...')
      await expect(page.getByText(/This file is already open in MarkText/)).toBeVisible()
      expect(readFileSync(source, 'utf8')).toBe('seed\n\nText {++keep++}.\n')
      expect(readFileSync(destination, 'utf8')).toBe('other\n\nOther {--keep--}.\n')
      await expect(page.locator('.tabs-container li.active')).toHaveAttribute('title', source)
      await expect(other.locator(`.tabs-container li[title="${destination}"]`)).toHaveCount(1)
      await page.locator('.mu-paragraph-content[contenteditable=true]').first().click()
      await menu(app, page, 'Undo')
      await expect(page.locator('.mu-paragraph-content').first()).toHaveText('seed')
      await menu(app, page, 'Redo')
      await expect(page.locator('.mu-paragraph-content').first()).toHaveText('seed SOURCE')
      await menu(app, page, 'Save')
      await expect
        .poll(() => readFileSync(source, 'utf8'))
        .toBe('seed SOURCE\n\nText {++keep++}.\n')
      if (other === page) await other.locator(`.tabs-container li[title="${destination}"]`).click()
      await expect(other.locator('.tabs-container li.active')).toHaveAttribute('title', destination)
      await waitForEditor(other)
      await typeAtEnd(other, '!')
      await menu(app, other, 'Save')
      await expect
        .poll(() => readFileSync(destination, 'utf8'))
        .toBe('other UNSAVED!\n\nOther {--keep--}.\n')
      expect(readFileSync(source, 'utf8')).toBe('seed SOURCE\n\nText {++keep++}.\n')
      await expectNoRendererErrors(app)
    } finally {
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async() => ({ response: 1, checkboxChecked: false })
      })
      await app.close()
    }
  })
}

test('ordinary Save As overwrites a closed file and retains the next edit, history and save', async() => {
  const scratch = mkdtempSync(join(tmpdir(), 'marktext-save-available-'))
  const source = join(scratch, 'a.md')
  const destination = join(scratch, 'copy.md')
  writeFileSync(source, 'seed\n\nText {++keep++}.\n', { flag: 'wx' })
  writeFileSync(destination, 'closed file\n', { flag: 'wx' })
  const { app, page } = await launchElectron([source], launchOptions)
  try {
    await ready(app, page)
    await typeAtEnd(page, ' SOURCE')
    await controlSavePicker(app, destination)
    await menu(app, page, 'Save As...')
    await expect(page.locator('.tabs-container li.active')).toHaveAttribute('title', destination)
    await expect
      .poll(() => readFileSync(destination, 'utf8'))
      .toBe('seed SOURCE\n\nText {++keep++}.\n')
    await typeAtEnd(page, '!')
    await menu(app, page, 'Undo')
    await menu(app, page, 'Redo')
    await expect(page.locator('.mu-paragraph-content').first()).toHaveText('seed SOURCE!')
    await menu(app, page, 'Save')
    await expect
      .poll(() => readFileSync(destination, 'utf8'))
      .toBe('seed SOURCE!\n\nText {++keep++}.\n')
    expect(readFileSync(source, 'utf8')).toBe('seed\n\nText {++keep++}.\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('concurrent Save As retains one owner for equivalent destinations that do not exist yet', async() => {
  const scratch = mkdtempSync(join(tmpdir(), 'marktext-save-concurrent-'))
  const source = join(scratch, 'a.md')
  const otherSource = join(scratch, 'b.md')
  const destination = join(scratch, 'New.md')
  const caseProbe = join(scratch, 'CaseProbe')
  writeFileSync(caseProbe, 'case sensitivity probe', { flag: 'wx' })
  const lowercaseProbe = join(scratch, 'caseprobe')
  const caseInsensitive =
    existsSync(lowercaseProbe) && statSync(caseProbe).ino === statSync(lowercaseProbe).ino
  const equivalentDestination = caseInsensitive ? join(scratch, 'new.md') : destination
  writeFileSync(source, 'seed\n\nText {++keep++}.\n', { flag: 'wx' })
  writeFileSync(otherSource, 'other\n\nOther {--keep--}.\n', { flag: 'wx' })
  await test.info().attach('destination-equivalence', {
    contentType: 'application/json',
    body: JSON.stringify({ caseInsensitive, destination, equivalentDestination })
  })
  const { app, page } = await launchElectron([source], launchOptions)
  try {
    await ready(app, page)
    await typeAtEnd(page, ' SOURCE')
    const newWindow = app.waitForEvent('window', { timeout: 10000 })
    await menu(app, page, 'New Window')
    const other = await newWindow
    await waitForEditor(other)
    await open(other, otherSource)
    await ready(app, other)
    await typeAtEnd(other, ' UNSAVED')

    // Pause only the atomic rename of our first fixture save. Its reservation
    // is live while neither spelling exists, independent of machine timing.
    await app.evaluate((_, pathname) => {
      const fs = process.getBuiltinModule('node:fs')
      const rename = fs.rename
      const probe = { pending: false, release: undefined as (() => void) | undefined }
      ;(globalThis as unknown as { saveRenameProbe: typeof probe }).saveRenameProbe = probe
      fs.rename = ((from, to, callback) => {
        if (to.toString() !== pathname) return rename(from, to, callback)
        probe.pending = true
        probe.release = () => {
          fs.rename = rename
          probe.release = undefined
          rename(from, to, callback)
        }
      }) as typeof fs.rename
    }, destination)
    await controlSavePicker(app, destination)
    await menu(app, page, 'Save As...')
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as unknown as { saveRenameProbe: { pending: boolean } }).saveRenameProbe
              .pending
        )
      )
      .toBe(true)
    expect(existsSync(destination)).toBe(false)
    expect(existsSync(equivalentDestination)).toBe(false)

    await controlSavePicker(app, equivalentDestination)
    await menu(app, other, 'Save As...')
    await expect(other.getByText(/This file is being saved by another document/)).toBeVisible()
    await expect(other.locator('.tabs-container li.active')).toHaveAttribute('title', otherSource)
    expect(existsSync(equivalentDestination)).toBe(false)
    expect(readFileSync(otherSource, 'utf8')).toBe('other\n\nOther {--keep--}.\n')
    await app.evaluate(() => {
      ;(
        globalThis as unknown as { saveRenameProbe: { release?: () => void } }
      ).saveRenameProbe.release?.()
    })
    await expect(page.locator('.tabs-container li.active')).toHaveAttribute('title', destination)
    await expect
      .poll(() => readFileSync(destination, 'utf8'))
      .toBe('seed SOURCE\n\nText {++keep++}.\n')
    await expect(other.locator('.tabs-container li.active')).toHaveAttribute('title', otherSource)

    // A native word boundary separates this edit from the pre-save typing.
    await typeAtEnd(other, ' NEXT')
    await menu(app, other, 'Undo')
    await expect(other.locator('.mu-paragraph-content').first()).toHaveText('other UNSAVED')
    await menu(app, other, 'Redo')
    await expect(other.locator('.mu-paragraph-content').first()).toHaveText('other UNSAVED NEXT')
    await menu(app, other, 'Save')
    await expect
      .poll(() => readFileSync(otherSource, 'utf8'))
      .toBe('other UNSAVED NEXT\n\nOther {--keep--}.\n')
    expect(readFileSync(destination, 'utf8')).toBe('seed SOURCE\n\nText {++keep++}.\n')
    expect(readFileSync(source, 'utf8')).toBe('seed\n\nText {++keep++}.\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.evaluate(({ dialog }) => {
      ;(
        globalThis as unknown as { saveRenameProbe?: { release?: () => void } }
      ).saveRenameProbe?.release?.()
      dialog.showMessageBox = async() => ({ response: 1, checkboxChecked: false })
    })
    await app.close()
  }
})
