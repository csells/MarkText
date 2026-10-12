import { expect, test } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clickMenuById,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  installRendererErrorCounter,
  launchElectron,
  placeCaretInEditor,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import {
  defaultCoreLaunchEnvironment,
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'

type LifecycleProbe = {
  openPaths: string[]
  savePaths: string[]
  popupLabel: string | null
  popupLabels: string[]
  decisions: string[]
  decide?: (response: number) => void
}

const launchOptions = {
  suppressErrorDialog: true,
  env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
} as const

async function prepare(app: ElectronApplication, page: Page): Promise<void> {
  await waitForMenuReady(app)
  await expectEditorWindowHidden(app)
  expectEditorNotFrontmost(app)
  await expectInstalledArtifactCommit(page)
  await installRendererErrorCounter(app)
  // Select the native menu item without showing a popup or sheet. Its real
  // click handler still traverses main IPC, renderer dispatch and the model.
  await app.evaluate(({ Menu, dialog }) => {
    const probe: LifecycleProbe = {
      openPaths: [],
      savePaths: [],
      popupLabel: null,
      popupLabels: [],
      decisions: []
    }
    ;(globalThis as unknown as { lifecycleProbe: LifecycleProbe }).lifecycleProbe = probe
    Menu.prototype.popup = function(options) {
      const item = this.items.find((candidate) => candidate.label === probe.popupLabel)
      probe.popupLabels = this.items.map((candidate) => candidate.label)
      if (!item || !item.enabled || !options?.window) {
        throw new Error(`Unavailable context command: ${probe.popupLabel}`)
      }
      probe.popupLabel = null
      item.click(item, options.window, { triggeredByAccelerator: false })
      options.callback?.()
    }
    dialog.showMessageBox = ((...args: unknown[]) => {
      const options = args.at(-1) as { message: string }
      probe.decisions.push(options.message)
      return new Promise((resolve) => {
        probe.decide = (response) => {
          probe.decide = undefined
          resolve({ response, checkboxChecked: false })
        }
      })
    }) as typeof dialog.showMessageBox
    dialog.showOpenDialog = (async() => ({
      canceled: false,
      filePaths: probe.openPaths.splice(0)
    })) as typeof dialog.showOpenDialog
    dialog.showSaveDialog = (async() => {
      const filePath = probe.savePaths.shift()
      return { canceled: filePath === undefined, filePath: filePath ?? '' }
    }) as typeof dialog.showSaveDialog
  })
}

async function dispose(app: ElectronApplication): Promise<void> {
  await app
    .evaluate(({ dialog }) => {
      const probe = (globalThis as unknown as { lifecycleProbe?: LifecycleProbe }).lifecycleProbe
      probe?.decide?.(2)
      dialog.showMessageBox = (async() => ({
        response: 1,
        checkboxChecked: false
      })) as typeof dialog.showMessageBox
    })
    .catch(() => {})
  await app.close()
}

async function menu(
  app: ElectronApplication,
  section: string,
  label: string,
  page?: Page
): Promise<void> {
  const window = page ? await app.browserWindow(page) : undefined
  const windowId = await window?.evaluate((win) => win.id)
  await window?.dispose()
  await app.evaluate(
    ({ BrowserWindow, Menu }, command) => {
      const parent = Menu.getApplicationMenu()?.items.find((item) => item.label === command.section)
      const item = parent?.submenu?.items.find((item) => item.label === command.label)
      const win =
        command.windowId === undefined
          ? BrowserWindow.getAllWindows()[0]
          : BrowserWindow.fromId(command.windowId)
      if (!item?.enabled || !win || win.isVisible() || win.isFocused()) {
        throw new Error(`Unavailable hidden-window command: ${command.section}/${command.label}`)
      }
      item.click(item, win, { triggeredByAccelerator: false })
    },
    { section, label, windowId }
  )
}

async function contextCommand(
  app: ElectronApplication,
  page: Page,
  selector: string,
  label: string
): Promise<void> {
  await app.evaluate((_, command) => {
    ;(globalThis as unknown as { lifecycleProbe: LifecycleProbe }).lifecycleProbe.popupLabel =
      command
  }, label)
  await page.locator(selector).click({ button: 'right' })
  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (globalThis as unknown as { lifecycleProbe: LifecycleProbe }).lifecycleProbe.popupLabel
      )
    )
    .toBeNull()
}

async function selectTab(page: Page, path: string): Promise<void> {
  await page.locator(`.tabs-container li[title=${JSON.stringify(path)}]`).click()
  await expectDefaultCoreAuthority(page)
}

async function append(page: Page, value: string): Promise<void> {
  await placeCaretInEditor(page)
  await page.keyboard.type(value)
  await expect(page.locator('.tabs-container li.active')).toHaveClass(/unsaved/)
}

async function expectSaved(app: ElectronApplication, page: Page, path: string, source: string) {
  await menu(app, 'File', 'Save', page)
  await expect.poll(() => (existsSync(path) ? readFileSync(path, 'utf8') : undefined)).toBe(source)
  await expect(page.locator('.tabs-container li.active')).not.toHaveClass(/unsaved/)
}

test('opening multiple files at startup retains the active editor, history and save authority', async() => {
  const folder = test.info().outputPath('documents')
  mkdirSync(folder, { recursive: true })
  const sources = ['plain\n', 'review {++addition++} end\n', 'third\n', 'fourth\n']
  const paths = sources.map((source, index) => {
    const path = join(folder, `${index}.md`)
    writeFileSync(path, source, { flag: 'wx' })
    return path
  })
  const { app, page } = await launchElectron(paths, launchOptions)
  try {
    await prepare(app, page)
    await waitForEditor(page)
    await expect(page.locator('.tabs-container li')).toHaveCount(4)
    await expect(page.locator('.tabs-container li.active')).toHaveAttribute('title', paths[0])
    for (const index of [0, 1]) {
      await selectTab(page, paths[index])
      await append(page, 'X')
      await expectSaved(app, page, paths[index], `${sources[index].trimEnd()}X\n`)
      await menu(app, 'Edit', 'Undo')
      await expectSaved(app, page, paths[index], sources[index])
      await menu(app, 'Edit', 'Redo')
      await expectSaved(app, page, paths[index], `${sources[index].trimEnd()}X\n`)
    }
    await expectNoRendererErrors(app)
  } finally {
    await dispose(app)
  }
})

for (const command of ['Close all tabs', 'Close others']) {
  test(`${command}: cancelling mixed tabs preserves dirty documents and history`, async() => {
    const folder = test.info().outputPath('documents')
    mkdirSync(folder, { recursive: true })
    const paths = ['keep', 'saved', 'first', 'second'].map((name) => join(folder, `${name}.md`))
    const sources = ['keep\n', 'saved\n', 'plain\n', 'review {++addition++} end\n']
    paths.forEach((path, index) => writeFileSync(path, sources[index], { flag: 'wx' }))
    const { app, page } = await launchElectron([paths[0]], launchOptions)
    try {
      await prepare(app, page)
      await waitForEditor(page)
      await app.evaluate((_, paths) => {
        ;(globalThis as unknown as { lifecycleProbe: LifecycleProbe }).lifecycleProbe.openPaths =
          paths
      }, paths.slice(1))
      await menu(app, 'File', 'Open File...')
      await expect(page.locator('.tabs-container li')).toHaveCount(4)
      for (const path of paths.slice(2)) {
        await selectTab(page, path)
        await append(page, 'X')
      }
      await contextCommand(
        app,
        page,
        `.tabs-container li[title=${JSON.stringify(paths[0])}]`,
        command
      )
      await expect
        .poll(() =>
          app.evaluate(
            () =>
              (globalThis as unknown as { lifecycleProbe: LifecycleProbe }).lifecycleProbe.decisions
                .length
          )
        )
        .toBe(1)
      await app.evaluate(() => {
        const probe = (globalThis as unknown as { lifecycleProbe: LifecycleProbe }).lifecycleProbe
        if (!probe.decide) throw new Error('No unsaved-file decision pending')
        probe.decide(2)
      })
      await expect(page.locator('.tabs-container li')).toHaveCount(
        command === 'Close others' ? 3 : 2
      )
      expect(readFileSync(paths[2], 'utf8')).toBe(sources[2])
      expect(readFileSync(paths[3], 'utf8')).toBe(sources[3])
      for (const index of [2, 3]) {
        await selectTab(page, paths[index])
        await expect(page.locator('.tabs-container li.active')).toHaveClass(/unsaved/)
        await placeCaretInEditor(page)
        await menu(app, 'Edit', 'Undo')
        await expectSaved(app, page, paths[index], sources[index])
        await menu(app, 'Edit', 'Redo')
        await expectSaved(app, page, paths[index], `${sources[index].trimEnd()}X\n`)
        await append(page, 'Y')
        await expectSaved(app, page, paths[index], `${sources[index].trimEnd()}XY\n`)
      }
      await expectNoRendererErrors(app)
    } finally {
      await dispose(app)
    }
  })
}

test('collapsed folder New File creates, edits, saves and reopens the document', async() => {
  const folder = test.info().outputPath('folder')
  const child = join(folder, 'child')
  const created = join(child, 'created.md')
  mkdirSync(child, { recursive: true })
  writeFileSync(join(child, 'existing.md'), 'existing\n', { flag: 'wx' })
  const { app, page } = await launchElectron([folder], launchOptions)
  try {
    await prepare(app, page)
    if (!(await page.locator('.side-bar').isVisible())) await clickMenuById(app, 'sideBarMenuItem')
    await expect(page.locator('.side-bar-folder .folder-name')).toHaveCount(1)
    await contextCommand(app, page, '.side-bar-folder .folder-name', 'New File')
    const input = page.locator('.side-bar-folder input.new-input:visible')
    await input.fill('created.md')
    await input.press('Enter')
    await expect.poll(() => existsSync(created)).toBe(true)
    await waitForEditor(page)
    await expect(page.locator('.tabs-container li.active')).toHaveAttribute('title', created)
    await expectDefaultCoreAuthority(page)
    await append(page, 'new document')
    await expectSaved(app, page, created, 'new document')
    await page.locator('.tabs-container li.active .close-icon').click()
    await expect(page.locator('.tabs-container li')).toHaveCount(0)
    await page.locator(`.side-bar-file[title=${JSON.stringify(created)}]`).click()
    await waitForEditor(page)
    await expect(page.locator('.mu-paragraph-content').first()).toHaveText('new document')
    await append(page, ' reopened')
    await expectSaved(app, page, created, 'new document reopened')
    await expectNoRendererErrors(app)
  } finally {
    await dispose(app)
  }
})

test('normal quit restores dirty and untitled documents across two windows without file arguments', async() => {
  const folder = test.info().outputPath('documents')
  mkdirSync(folder, { recursive: true })
  const savedPath = join(folder, 'saved.md')
  const untitledPath = join(folder, 'restored-untitled.md')
  const secondPath = join(folder, 'restored-second.md')
  const savedSource = 'saved {++review++} end\n'
  writeFileSync(savedPath, savedSource, { flag: 'wx' })
  const initial = await launchElectron([savedPath], launchOptions)
  let restored: ElectronApplication | undefined
  let initialExited = false
  try {
    await prepare(initial.app, initial.page)
    await waitForEditor(initial.page)
    await initial.page.evaluate(() => {
      window.electron.ipcRenderer.send('mt::set-user-preference', { startUpAction: 'restoreAll' })
    })
    const launch = await initial.app.evaluate(({ app }) => ({
      profile: app.getPath('userData'),
      executable: process.execPath,
      cwd: process.cwd()
    }))
    await append(initial.page, 'X')
    await menu(initial.app, 'File', 'New Tab', initial.page)
    await waitForEditor(initial.page)
    await append(initial.page, 'untitled work')
    const newWindow = initial.app.waitForEvent('window')
    await menu(initial.app, 'File', 'New Window', initial.page)
    const second = await newWindow
    await waitForEditor(second)
    await append(second, 'second window')
    await expectNoRendererErrors(initial.app)
    const child = initial.app.process()
    await initial.app.evaluate(({ app, BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows()
      if (windows.length !== 2 || windows.some((win) => win.isVisible() || win.isFocused())) {
        throw new Error('Expected only the two private hidden editor windows')
      }
      app.quit()
    })
    await expect.poll(() => child.exitCode, { timeout: 10000 }).toBe(0)
    initialExited = true
    expect(readFileSync(savedPath, 'utf8')).toBe(savedSource)
    restored = await _electron.launch({
      executablePath: launch.executable,
      args: ['--user-data-dir', launch.profile],
      cwd: launch.cwd,
      env: defaultCoreLaunchEnvironment({
        PERF_TESTING: 'true',
        MARKTEXT_E2E_HIDDEN_WINDOW: '1',
        MARKTEXT_ERROR_INTERACTION: '1'
      })
    })
    await expect.poll(() => restored?.windows().length).toBe(2)
    const windows = restored.windows()
    for (const page of windows) {
      await waitForEditor(page)
      await expectInstalledArtifactCommit(page)
    }
    await prepare(restored, windows[0])
    const tabCounts = await Promise.all(
      windows.map((page) => page.locator('.tabs-container li').count())
    )
    expect(tabCounts.slice().sort()).toEqual([1, 2])
    const first = windows[tabCounts.indexOf(2)]
    const other = windows[tabCounts.indexOf(1)]
    await expect(first.locator('.mu-paragraph-content').first()).toHaveText('untitled work')
    await expect(other.locator('.mu-paragraph-content').first()).toHaveText('second window')
    await selectTab(first, savedPath)
    await expect(first.locator('.mu-paragraph-content').first()).toHaveText('saved review endX')
    await append(first, 'Y')
    await menu(restored, 'Edit', 'Undo', first)
    await expectSaved(restored, first, savedPath, 'saved {++review++} endX\n')
    await menu(restored, 'Edit', 'Redo', first)
    await expectSaved(restored, first, savedPath, 'saved {++review++} endXY\n')
    await first.locator('.tabs-container li').filter({ hasText: 'Untitled' }).click()
    await append(first, '!')
    await restored.evaluate(
      (_, paths) => {
        ;(globalThis as unknown as { lifecycleProbe: LifecycleProbe }).lifecycleProbe.savePaths =
          paths
      },
      [untitledPath, secondPath]
    )
    await expectSaved(restored, first, untitledPath, 'untitled work!')
    await append(other, 'Z')
    await expectSaved(restored, other, secondPath, 'second windowZ')
    await expectNoRendererErrors(restored)
    expectEditorNotFrontmost(restored)
  } finally {
    if (restored) await dispose(restored)
    if (!initialExited) await dispose(initial.app)
  }
})
