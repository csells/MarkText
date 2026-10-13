import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { launchWithMarkdown } from './helpers'

// A hidden run (PERF_TESTING with MARKTEXT_E2E_HIDDEN_WINDOW) must put nothing
// on the user's screen and launch nothing. A renderer that dies there records
// its reason rather than showing upstream's "MarkText has crashed" sheet; any
// native dialog, context menu or shell action no test stubbed is recorded
// instead of shown or performed.

const recorded = (app: ElectronApplication) => app.evaluate(() => {
  const scope = globalThis as typeof globalThis & {
    __marktextHiddenDialogs?: Array<{ method: string, message: string }>
    __marktextRendererGone?: string[]
  }
  return {
    dialogs: scope.__marktextHiddenDialogs ?? [],
    gone: scope.__marktextRendererGone ?? [],
    popups: (scope as typeof scope & { __marktextHiddenMenuPopups?: Array<{ method: string, detail: string }> }).__marktextHiddenMenuPopups ?? [],
    shell: (scope as typeof scope & { __marktextHiddenShellCalls?: Array<{ method: string, detail: string }> }).__marktextHiddenShellCalls ?? []
  }
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

test('an unstubbed context menu is recorded and not shown', async() => {
  const { app } = await launchWithMarkdown('Hidden\n', { env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' } })
  try {
    const dismissed = await app.evaluate(({ BrowserWindow, Menu }) => new Promise<boolean>((resolve) => {
      const menu = Menu.buildFromTemplate([{ label: 'First' }, { label: 'Second' }])
      menu.popup({ window: BrowserWindow.getAllWindows()[0]!, callback: () => resolve(true) })
      menu.closePopup()
    }))
    expect(dismissed).toBe(true)
    expect((await recorded(app)).popups).toEqual([
      { method: 'popup', detail: 'First | Second' },
      { method: 'closePopup', detail: '' }
    ])
    expect(await windowVisible(app)).toBe(false)
  } finally {
    await app.close()
  }
})

test('a shell action launches nothing and leaves the window hidden', async() => {
  const { app } = await launchWithMarkdown('Hidden\n', { env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' } })
  try {
    const answers = await app.evaluate(async({ shell }) => ({
      external: await shell.openExternal('https://example.com/hidden-run'),
      path: await shell.openPath('/tmp')
    }))
    expect(answers).toEqual({ external: undefined, path: '' })
    expect((await recorded(app)).shell).toEqual([
      { method: 'openExternal', detail: 'https://example.com/hidden-run' },
      { method: 'openPath', detail: '/tmp' }
    ])
    expect(await windowVisible(app)).toBe(false)
  } finally {
    await app.close()
  }
})
