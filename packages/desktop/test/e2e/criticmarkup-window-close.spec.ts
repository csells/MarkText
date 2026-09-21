import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  enterSourceMode,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  placeCaretInEditor,
  sendIpcToRenderer,
  waitForEditor
} from './helpers'
import {
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'

type Surface = 'markup' | 'source'
type CloseProbe = {
  decisions: number
  saveAs: number
  prepared: Array<{ requestId: number; files?: Array<{ markdown: string }>; error?: string }>
  resumed: number[]
  decide?: (response: number) => void
  choosePath?: (filePath?: string) => void
}

// Only the OS dialog decision is controlled. Native close, the bundled renderer,
// live model, durable buffer, save service, cancellation and destruction are real.
// Each app owns a throwaway profile; no dialogs or visible windows are permitted.
async function installDialogControl(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog, ipcMain }) => {
    const state: CloseProbe = { decisions: 0, saveAs: 0, prepared: [], resumed: [] }
    ;(globalThis as unknown as { closeProbe: CloseProbe }).closeProbe = state
    dialog.showMessageBox = (() => {
      state.decisions++
      return new Promise((resolve) => {
        state.decide = (response) => {
          state.decide = undefined
          resolve({ response, checkboxChecked: false })
        }
      })
    }) as typeof dialog.showMessageBox
    dialog.showSaveDialog = (() => {
      state.saveAs++
      return new Promise((resolve) => {
        state.choosePath = (filePath) => {
          state.choosePath = undefined
          resolve({ canceled: filePath === undefined, filePath: filePath ?? '' })
        }
      })
    }) as typeof dialog.showSaveDialog
    ipcMain.on('mt::window-close-prepared', (_event, reply) => state.prepared.push(reply))
    ipcMain.on('mt::window-close-resumed', (_event, requestId) => state.resumed.push(requestId))
  })
}

const probe = (app: ElectronApplication) =>
  app.evaluate(() => {
    const state = (globalThis as unknown as { closeProbe: CloseProbe }).closeProbe
    return {
      decisions: state.decisions,
      saveAs: state.saveAs,
      prepared: state.prepared,
      resumed: state.resumed
    }
  })

const decideSave = (app: ElectronApplication) =>
  app.evaluate(() => {
    const state = (globalThis as unknown as { closeProbe: CloseProbe }).closeProbe
    if (!state.decide) throw new Error('No native Save decision is pending')
    state.decide(0)
  })

const chooseSavePath = (app: ElectronApplication, filePath?: string) =>
  app.evaluate((_, path) => {
    const state = (globalThis as unknown as { closeProbe: CloseProbe }).closeProbe
    if (!state.choosePath) throw new Error('No native Save As decision is pending')
    state.choosePath(path)
  }, filePath)

const closeNativeWindow = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || win.isVisible() || win.isFocused()) {
      throw new Error("Expected this run's hidden editor window")
    }
    win.close()
  })

const quitNativeApp = (application: ElectronApplication) =>
  application.evaluate(({ app, BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length !== 1 || windows.some((win) => win.isVisible() || win.isFocused())) {
      throw new Error("Expected this run's single hidden editor window")
    }
    app.quit()
  })

async function sendToPage(
  app: ElectronApplication,
  page: Page,
  channel: string,
  ...args: unknown[]
): Promise<void> {
  const window = await app.browserWindow(page)
  try {
    await window.evaluate(
      (win, payload) => win.webContents.send(payload.channel, ...payload.args),
      {
        channel,
        args
      }
    )
  } finally {
    await window.dispose()
  }
}

async function disposeTestApp(app: ElectronApplication): Promise<void> {
  // Resolve only this run's controlled dialogs, then let its ordinary quit path
  // dispose its owned windows. Never restore a real native modal during cleanup.
  await app
    .evaluate(({ dialog }) => {
      const state = (globalThis as unknown as { closeProbe?: CloseProbe }).closeProbe
      state?.decide?.(2)
      state?.choosePath?.()
      dialog.showMessageBox = (async() => ({
        response: 1,
        checkboxChecked: false
      })) as typeof dialog.showMessageBox
      dialog.showSaveDialog = (async() => ({
        canceled: true,
        filePath: ''
      })) as typeof dialog.showSaveDialog
    })
    .catch(() => {})
  await app.close()
}

async function prepareSurface(
  page: Page,
  app: ElectronApplication,
  surface: Surface
): Promise<void> {
  if (surface === 'markup') {
    await placeCaretInEditor(page)
    return
  }
  await enterSourceMode(page, app)
  await page.evaluate(() => {
    const cm = (
      document.querySelector('.source-code .CodeMirror') as Element & {
        CodeMirror: {
          focus(): void
          getLine(index: number): string
          setCursor(position: { line: number; ch: number }): void
        }
      }
    ).CodeMirror
    cm.focus()
    cm.setCursor({ line: 0, ch: cm.getLine(0).length })
  })
}

const visibleText = (page: Page, surface: Surface): Promise<string> =>
  surface === 'markup'
    ? page.locator('.mu-paragraph-content').first().innerText()
    : page.evaluate(() =>
      (
        document.querySelector('.source-code .CodeMirror') as Element & {
          CodeMirror: { getValue(): string }
        }
      ).CodeMirror.getValue().replace(/\n$/, '')
    )

async function assertLaunch(app: ElectronApplication, page: Page): Promise<void> {
  await expectEditorWindowHidden(app)
  expectEditorNotFrontmost(app)
  await expectDefaultCoreAuthority(page)
  if (process.env.MARKTEXT_PACKAGED_APP) await expectInstalledArtifactCommit(page)
  await test.info().attach('candidate.json', {
    contentType: 'application/json',
    body: JSON.stringify(
      await app.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        appPath: app.getAppPath(),
        executable: process.execPath
      }))
    )
  })
  await sendIpcToRenderer(app, 'mt::user-preference', { startUpAction: 'blank' })
}

const launchOptions = {
  suppressErrorDialog: true,
  env: {
    MARKTEXT_E2E_HIDDEN_WINDOW: '1',
    MARKTEXT_DOCUMENT_CORE_MODE: undefined,
    MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
    MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined
  }
} as const

for (const surface of ['markup', 'source'] as const) {
  test(`${surface}: application quit saves late input before the process exits`, async() => {
    const retained = '\n\n{++keep++} {>>preserve this comment<<}\n'
    const { app, page, filePath } = await launchWithMarkdown(`see${retained}`, launchOptions)
    const childProcess = app.process()
    try {
      await assertLaunch(app, page)
      await installDialogControl(app)
      await prepareSurface(page, app, surface)
      await page.keyboard.type('d')
      await expect.poll(async() => (await visibleText(page, surface)).split('\n')[0]).toBe('seed')
      await quitNativeApp(app)
      await expect.poll(async() => (await probe(app)).decisions).toBe(1)
      await page.keyboard.type(' late')
      await expect
        .poll(async() => (await visibleText(page, surface)).split('\n')[0])
        .toBe('seed late')
      expect(readFileSync(filePath, 'utf8')).toBe(`see${retained}`)
      expect(childProcess.exitCode).toBeNull()
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      await expectNoRendererErrors(app)
      const closed = app.waitForEvent('close')
      await decideSave(app)
      await closed
      await expect.poll(() => childProcess.exitCode).toBe(0)
      expect(page.isClosed()).toBe(true)
      expect(readFileSync(filePath, 'utf8')).toBe(`seed late${retained}`)
    } finally {
      await disposeTestApp(app)
    }
  })

  test(`${surface}: native close saves input accepted while the Save decision was pending`, async() => {
    const { app, page, filePath } = await launchWithMarkdown('see\n', launchOptions)
    try {
      await assertLaunch(app, page)
      await installDialogControl(app)
      await prepareSurface(page, app, surface)
      await page.keyboard.type('d')
      await expect.poll(() => visibleText(page, surface)).toBe('seed')
      await closeNativeWindow(app)
      await expect.poll(async() => (await probe(app)).decisions).toBe(1)
      // This is a held OS decision, not a delayed model acknowledgement.
      // No application state or persistence function is replaced.
      await page.keyboard.type(' late')
      await expect.poll(() => visibleText(page, surface)).toBe('seed late')
      expect(readFileSync(filePath, 'utf8')).toBe('see\n')
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      await expectNoRendererErrors(app)
      const destroyed = page.waitForEvent('close')
      await decideSave(app)
      await destroyed
      expect(page.isClosed()).toBe(true)
      expect(readFileSync(filePath, 'utf8')).toBe('seed late\n')
    } finally {
      await disposeTestApp(app)
    }
  })

  test(`${surface}: cancelled Save As resumes immediate input, caret and canonical history`, async() => {
    const root = mkdtempSync(join(tmpdir(), 'marktext-close-save-as-'))
    const savedPath = join(root, 'resumed.md')
    const { app, page } = await launchWithMarkdown('untouched\n', launchOptions)
    try {
      await assertLaunch(app, page)
      await installDialogControl(app)
      await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, '')
      await expect.poll(() => visibleText(page, 'markup')).toBe('')
      await prepareSurface(page, app, surface)
      await page.keyboard.type('seed')
      await expect.poll(() => visibleText(page, surface)).toBe('seed')
      await closeNativeWindow(app)
      await expect.poll(async() => (await probe(app)).decisions).toBe(1)
      await page.keyboard.type(' late')
      await expect.poll(() => visibleText(page, surface)).toBe('seed late')
      await decideSave(app)
      await expect.poll(async() => (await probe(app)).saveAs).toBe(1)
      const retired = await probe(app)
      expect(retired.prepared).toHaveLength(1)
      // New untitled source starts empty; typing does not invent a terminal newline.
      expect(retired.prepared[0]?.files?.map((file) => file.markdown)).toEqual(['seed late'])
      await expect(page.locator('.mu-paragraph-content, .source-code .CodeMirror')).toHaveCount(0)
      await chooseSavePath(app)
      await expect
        .poll(async() => (await probe(app)).resumed)
        .toEqual([retired.prepared[0]!.requestId])
      // Do not reset focus or selection after cancellation. The first native
      // key must already use the restored live owner and its retained caret.
      await page.keyboard.type('X')
      await expect.poll(() => visibleText(page, surface)).toBe('seed lateX')
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await expect.poll(() => visibleText(page, surface)).toBe('seed late')
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
      await expect.poll(() => visibleText(page, surface)).toBe('seed lateX')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(async() => (await probe(app)).saveAs).toBe(2)
      await chooseSavePath(app, savedPath)
      await expect(() => expect(readFileSync(savedPath, 'utf8')).toBe('seed lateX')).toPass({
        timeout: 5000
      })
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
      await expectNoRendererErrors(app)
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
    } finally {
      await disposeTestApp(app)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test(`${surface}: incoming open survives a retired window and cancelled Save As`, async() => {
    const root = mkdtempSync(join(tmpdir(), 'marktext-close-incoming-'))
    const originalPath = join(root, 'resumed.md')
    const incomingPath = join(root, 'incoming.md')
    const retained = '\n\n{++keep++} {>>incoming comment<<}\n'
    writeFileSync(incomingPath, `incoming${retained}`, { flag: 'wx' })
    const { app, page } = await launchWithMarkdown('untouched\n', launchOptions)
    try {
      await assertLaunch(app, page)
      await installDialogControl(app)
      await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, '')
      await expect.poll(() => visibleText(page, 'markup')).toBe('')
      await prepareSurface(page, app, surface)
      await page.keyboard.type('seed')
      await closeNativeWindow(app)
      await expect.poll(async() => (await probe(app)).decisions).toBe(1)
      await page.keyboard.type(' late')
      await expect.poll(() => visibleText(page, surface)).toBe('seed late')
      await decideSave(app)
      await expect.poll(async() => (await probe(app)).saveAs).toBe(1)
      const retired = await probe(app)
      expect(retired.prepared).toHaveLength(1)
      expect(retired.prepared[0]?.files?.map((file) => file.markdown)).toEqual(['seed late'])
      await expect(page.locator('.mu-paragraph-content, .source-code .CodeMirror')).toHaveCount(0)

      // Main must carry the loaded document into a fresh window while the
      // original renderer has no live view. Only the OS Save As answer is held.
      const opened = app.waitForEvent('window')
      await page.evaluate(
        (path) => window.electron.ipcRenderer.send('mt::open-file', path),
        incomingPath
      )
      const incoming = await opened
      await incoming.waitForLoadState('domcontentloaded')
      await waitForEditor(incoming)
      await expectDefaultCoreAuthority(incoming)
      if (process.env.MARKTEXT_PACKAGED_APP) await expectInstalledArtifactCommit(incoming)
      const incomingSurface: Surface =
        (await incoming.locator('.source-code .CodeMirror').count()) > 0 ? 'source' : 'markup'
      await expect
        .poll(async() => (await visibleText(incoming, incomingSurface)).split('\n')[0])
        .toBe('incoming')
      expect(readFileSync(incomingPath, 'utf8')).toBe(`incoming${retained}`)
      await expect(page.locator('.mu-paragraph-content, .source-code .CodeMirror')).toHaveCount(0)
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((win) => ({
            visible: win.isVisible(),
            focused: win.isFocused()
          }))
        )
      ).toEqual([
        { visible: false, focused: false },
        { visible: false, focused: false }
      ])
      expectEditorNotFrontmost(app)

      await chooseSavePath(app)
      await expect
        .poll(async() => (await probe(app)).resumed)
        .toEqual([retired.prepared[0]!.requestId])
      await page.keyboard.type('X')
      await expect.poll(() => visibleText(page, surface)).toBe('seed lateX')
      await sendToPage(app, page, 'mt::editor-edit-action', 'undo')
      await expect.poll(() => visibleText(page, surface)).toBe('seed late')
      await sendToPage(app, page, 'mt::editor-edit-action', 'redo')
      await expect.poll(() => visibleText(page, surface)).toBe('seed lateX')
      await sendToPage(app, page, 'mt::editor-ask-file-save')
      await expect.poll(async() => (await probe(app)).saveAs).toBe(2)
      await chooseSavePath(app, originalPath)
      await expect(() => expect(readFileSync(originalPath, 'utf8')).toBe('seed lateX')).toPass({
        timeout: 5000
      })

      await prepareSurface(incoming, app, incomingSurface)
      await incoming.keyboard.type('X')
      await expect
        .poll(async() => (await visibleText(incoming, incomingSurface)).split('\n')[0])
        .toBe('incomingX')
      await sendToPage(app, incoming, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(incomingPath, 'utf8')).toBe(`incomingX${retained}`)
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
      await expect(incoming.getByTestId('core-recovery-draft')).toHaveCount(0)
      await expectNoRendererErrors(app)
      expectEditorNotFrontmost(app)
    } finally {
      await disposeTestApp(app)
      rmSync(root, { recursive: true, force: true })
    }
  })
}
