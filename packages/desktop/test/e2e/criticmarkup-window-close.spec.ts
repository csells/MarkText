import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  enterSourceMode,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  placeCaretInEditor,
  sendIpcToRenderer
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
    if (!win || win.isVisible() || win.isFocused()) { throw new Error("Expected this run's hidden editor window") }
    win.close()
  })

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
}
