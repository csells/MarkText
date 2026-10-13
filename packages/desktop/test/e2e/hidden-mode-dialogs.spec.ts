import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { launchWithMarkdown } from './helpers'

// A hidden run (PERF_TESTING with MARKTEXT_E2E_HIDDEN_WINDOW) must put nothing
// on the user's screen. A renderer that dies there records its reason rather
// than showing upstream's "MarkText has crashed" sheet, and any native dialog
// no test stubbed is answered as its Cancel without being shown.

const recorded = (app: ElectronApplication) => app.evaluate(() => {
  const scope = globalThis as typeof globalThis & {
    __marktextHiddenDialogs?: Array<{ method: string, message: string }>
    __marktextRendererGone?: string[]
  }
  return { dialogs: scope.__marktextHiddenDialogs ?? [], gone: scope.__marktextRendererGone ?? [] }
})

const windowVisible = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.isVisible()))

test('a killed renderer in a hidden run shows no dialog and leaves the window hidden', async() => {
  const { app } = await launchWithMarkdown('Hidden\n', { env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' } })
  try {
    expect(await windowVisible(app)).toBe(false)
    const renderer = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId())
    process.kill(renderer, 'SIGKILL')

    await expect.poll(async() => (await recorded(app)).gone).toEqual(['killed'])
    expect((await recorded(app)).dialogs).toEqual([])
    expect(await windowVisible(app)).toBe(false)
  } finally {
    // A graceful quit waits on the dead renderer; with it gone, stopping the
    // main process can report nothing.
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
  }
})

test('a native dialog no test stubbed is answered as Cancel without showing', async() => {
  const { app } = await launchWithMarkdown('Hidden\n', { env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' } })
  try {
    const answers = await app.evaluate(async({ BrowserWindow, dialog }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      return {
        box: await dialog.showMessageBox(win, { message: 'Save changes?', buttons: ['Save', 'Cancel', 'Don’t Save'] }),
        open: await dialog.showOpenDialog(win, { properties: ['openFile'] }),
        save: await dialog.showSaveDialog(win, {})
      }
    })
    expect(answers).toEqual({
      box: { response: 1, checkboxChecked: false },
      open: { canceled: true, filePaths: [] },
      save: { canceled: true, filePath: '' }
    })
    expect((await recorded(app)).dialogs.map(entry => entry.method)).toEqual(['showMessageBox', 'showOpenDialog', 'showSaveDialog'])
    expect(await windowVisible(app)).toBe(false)
  } finally {
    await app.close()
  }
})
