import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  clickMenuById,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchElectron,
  launchWithMarkdown,
  sendIpcToRenderer,
  waitForEditor
} from './helpers'
import {
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'
import { preserveSystemClipboard } from './helpers/systemClipboardFixture'

for (const middle of ['aaa', 'a{++a++}a{>>keep<<}']) {
  test(`mounted table dialog retains target, next input and history (${middle === 'aaa' ? 'plain' : 'CM'})`, async() => {
    const source = `aaa\n\n${middle}\n\nlast\n`
    // Upstream MarkText writes an edited table afresh with padded cells.
    const typed = `aaa\n\n${middle}\n\n| X   |     |\n| --- | --- |\n|     |     |\n\nlast\n`
    const options = {
      suppressErrorDialog: true,
      env: {
        MARKTEXT_E2E_HIDDEN_WINDOW: '1',
        MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined
      }
    }
    const { app, page, filePath } = await launchWithMarkdown(source, options)
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    try {
      await expectDefaultCoreAuthority(page)
      if (process.env.MARKTEXT_PACKAGED_APP !== undefined) await expectInstalledArtifactCommit(page)
      await page.locator('.mu-paragraph-content').nth(1).click()
      await clickMenuById(app, 'tableMenuItem')
      const dialog = page.locator('.ag-insert-table-dialog')
      await expect(dialog).toBeVisible()
      const dimensions = dialog.locator('.el-input-number input')
      await dimensions.nth(0).fill('2')
      await dimensions.nth(1).fill('2')
      // A normal save refreshes the lease identity without changing its revision.
      // Observe its real response before confirming the retained model target.
      await app.evaluate(
        ({ BrowserWindow, ipcMain }) =>
          new Promise<void>((resolve) => {
            const window = BrowserWindow.getAllWindows()[0]
            const saved = (event: Electron.IpcMainEvent) => {
              if (event.sender !== window.webContents) return
              ipcMain.removeListener('mt::response-file-save', saved)
              resolve()
            }
            ipcMain.on('mt::response-file-save', saved)
            window.webContents.send('mt::editor-ask-file-save')
          })
      )
      expect(readFileSync(filePath, 'utf8')).toBe(source)
      await dialog.locator('.el-button--primary').click()
      expect(
        await page.evaluate(() => {
          const selection = window.getSelection()
          const node = selection?.focusNode
          const element = node instanceof Element ? node : node?.parentElement
          return { cell: element?.closest('td')?.cellIndex, offset: selection?.focusOffset }
        })
      ).toEqual({ cell: 0, offset: 0 })
      await page.keyboard.type('X')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(typed)
      // Upstream History groups the table with the key typed within its
      // one-second window.
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(typed)
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      await expectNoRendererErrors(app)
      expect(consoleErrors).toEqual([])
    } finally {
      await app.close()
    }
    const reopened = await launchElectron([filePath], options)
    const reopenedConsoleErrors: string[] = []
    reopened.page.on('console', (message) => {
      if (message.type() === 'error') reopenedConsoleErrors.push(message.text())
    })
    try {
      await waitForEditor(reopened.page)
      await expectDefaultCoreAuthority(reopened.page)
      if (process.env.MARKTEXT_PACKAGED_APP !== undefined) {
        await expectInstalledArtifactCommit(reopened.page)
      }
      await expect(reopened.page.locator('.editor-component table td')).toHaveCount(4)
      await expect(reopened.page.locator('.editor-component table td').first()).toHaveText('X')
      await sendIpcToRenderer(reopened.app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(typed)
      await expectEditorWindowHidden(reopened.app)
      expectEditorNotFrontmost(reopened.app)
      await expectNoRendererErrors(reopened.app)
      expect(reopenedConsoleErrors).toEqual([])
    } finally {
      await reopened.app.close()
    }
  })
}

for (const { middle, cancel } of [
  { middle: 'aaa', cancel: false },
  { middle: 'a{++a++}a{>>keep<<}', cancel: false },
  { middle: 'aaa', cancel: true }
]) {
  const title = cancel
    ? 'Escape cancels the pending table request while native clipboard import continues'
    : `table dialog retains its target while native clipboard import is pending (${middle === 'aaa' ? 'plain' : 'CM'})`
  test(title, async() => {
    test.skip(
      process.platform === 'linux',
      'Linux bypasses the native clipboard image-path IPC; common pending-resource behavior has universal unit coverage.'
    )
    const source = `aaa\n\n${middle}\n\nlast\n`
    const imported = `aaaimported\n\n${middle}\n\nlast\n`
    // Upstream MarkText writes an edited table afresh with padded cells.
    const typed = cancel
      ? 'aaaimported\n\naaaX\n\nlast\n'
      : `aaaimported\n\n${middle}\n\n| X   |     |\n| --- | --- |\n|     |     |\n\nlast\n`
    const options = {
      suppressErrorDialog: true,
      env: {
        MARKTEXT_E2E_HIDDEN_WINDOW: '1',
        MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined
      }
    }
    const clipboardFixture = preserveSystemClipboard()
    const { app, page, filePath } = await launchWithMarkdown(source, options)
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    try {
      await expectDefaultCoreAuthority(page)
      if (process.env.MARKTEXT_PACKAGED_APP !== undefined) await expectInstalledArtifactCommit(page)
      await app.evaluate(({ ipcMain }) => {
        const channel = 'mt::clipboard::guess-file-path'
        const handlers = (
          ipcMain as unknown as {
            _invokeHandlers: Map<
              string,
              (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
            >
          }
        )._invokeHandlers
        const original = handlers.get(channel)
        if (!original) throw new Error('Native clipboard path handler is absent')
        let release = () => {}
        const held = new Promise<void>((resolve) => {
          release = resolve
        })
        const control = {
          calls: 0,
          release,
          restore: () => {
            ipcMain.removeHandler(channel)
            ipcMain.handle(channel, original)
          }
        }
        ;(
          globalThis as unknown as { __marktextHeldClipboardPath: typeof control }
        ).__marktextHeldClipboardPath = control
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async(event, ...args: unknown[]) => {
          // Retain the real OS result; only its delivery is held.
          const result = await original(event, ...args)
          control.calls++
          await held
          return result
        })
      })
      await app.evaluate(({ clipboard }) =>
        clipboard.write({ text: 'imported', html: '<p>imported</p>' })
      )
      clipboardFixture.rememberOwnedWrite('imported')
      const paragraphs = page.locator('.editor-component .mu-paragraph-content')
      await paragraphs.nth(0).click()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.paste()
      )
      await expect
        .poll(() =>
          app.evaluate(
            () =>
              (globalThis as unknown as { __marktextHeldClipboardPath: { calls: number } })
                .__marktextHeldClipboardPath.calls
          )
        )
        .toBe(1)
      await paragraphs.nth(1).click()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
      await page.evaluate(() => {
        window.electron.ipcRenderer.on('mt::editor-paragraph-action', () => {
          document.documentElement.dataset.pendingTableAction = 'received'
        })
      })
      await clickMenuById(app, 'tableMenuItem')
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.pendingTableAction))
        .toBe('received')
      const dialog = page.locator('.ag-insert-table-dialog')
      expect(await dialog.isVisible()).toBe(false)
      expect(consoleErrors).toEqual([])
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
      expect(
        await page.evaluate(() => document.activeElement?.closest('.editor-component') !== null)
      ).toBe(true)
      if (cancel) await page.keyboard.press('Escape')

      await app.evaluate(() =>
        (
          globalThis as unknown as { __marktextHeldClipboardPath: { release(): void } }
        ).__marktextHeldClipboardPath.release()
      )
      await expect(paragraphs.nth(0)).toHaveText('aaaimported')
      // Upstream History groups edits within one second; waiting out the
      // paste's window keeps it a separate undo step from what follows.
      await page.waitForTimeout(1100)
      if (cancel) {
        expect(await dialog.isVisible()).toBe(false)
        await page.keyboard.type('X')
        expect(await paragraphs.nth(1).textContent()).toBe('aaaX')
        expect(await dialog.isVisible()).toBe(false)
      } else {
        await expect(dialog).toBeVisible()
        const dimensions = dialog.locator('.el-input-number input')
        await dimensions.nth(0).fill('2')
        await dimensions.nth(1).fill('2')
        await dialog.locator('.el-button--primary').click()
        expect(
          await page.evaluate(() => {
            const selection = window.getSelection()
            const node = selection?.focusNode
            const element = node instanceof Element ? node : node?.parentElement
            return { cell: element?.closest('td')?.cellIndex, offset: selection?.focusOffset }
          })
        ).toEqual({ cell: 0, offset: 0 })
        await page.keyboard.type('X')
      }
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(typed)
      // Upstream History groups the table with the key typed within its
      // one-second window.
      for (const expected of [imported, source]) {
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
      }
      for (const expected of [imported, typed]) {
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
      }
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      await expectNoRendererErrors(app)
      expect(consoleErrors).toEqual([])
    } finally {
      try {
        await app.evaluate(() => {
          const control = (
            globalThis as unknown as {
              __marktextHeldClipboardPath?: { release(): void; restore(): void }
            }
          ).__marktextHeldClipboardPath
          control?.release()
          control?.restore()
        })
      } finally {
        try {
          await app.close()
        } finally {
          clipboardFixture.restore()
        }
      }
    }
    const reopened = await launchElectron([filePath], options)
    try {
      await waitForEditor(reopened.page)
      await expectDefaultCoreAuthority(reopened.page)
      if (process.env.MARKTEXT_PACKAGED_APP !== undefined) {
        await expectInstalledArtifactCommit(reopened.page)
      }
      if (cancel) {
        await expect(
          reopened.page.locator('.editor-component .mu-paragraph-content').nth(1)
        ).toHaveText('aaaX')
        await expect(reopened.page.locator('.editor-component table')).toHaveCount(0)
      } else {
        await expect(reopened.page.locator('.editor-component table td').first()).toHaveText('X')
      }
      await sendIpcToRenderer(reopened.app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(typed)
      await expectEditorWindowHidden(reopened.app)
      expectEditorNotFrontmost(reopened.app)
      await expectNoRendererErrors(reopened.app)
    } finally {
      await reopened.app.close()
    }
  })
}
