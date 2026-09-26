import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { enterSourceMode, launchWithMarkdown } from './helpers'

// Every export reads the document the save barrier would write. Edits typed
// in Source view reach Core through CodeMirror; the hidden WYSIWYG surface
// and the store's copy of the Markdown never see them, so an export built
// from either loses the edit.

const DOCUMENT = '# Export Source Edits\n\nKept {++added++} text.\n'
const SOURCE_EDIT = 'MT_SOURCE_VIEW_EDIT'

type ExportCommand = 'Export as HTML' | 'Export as PDF' | 'Print' | 'Word (.docx)'

// Stubs the native save dialog and records the HTML the PDF and Print
// consumers render, at the moment they would hand it to Chromium.
const installExportProbe = async(app: ElectronApplication, outputDir: string): Promise<void> => {
  await app.evaluate(({ BrowserWindow, dialog }, directory) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win === undefined) throw new Error('Editor window is absent')
    const probe = { printed: [] as string[] }
    ;(global as unknown as { __mtExportProbe: typeof probe }).__mtExportProbe = probe
    ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async(
      _owner: unknown,
      options: { defaultPath?: string }
    ) => ({
      canceled: false,
      filePath: `${directory}/${String(options?.defaultPath ?? 'export').split('/').pop()}`
    })
    const printContainer = async(): Promise<string> =>
      (await win.webContents.executeJavaScript(
        "document.querySelector('.print-container')?.innerHTML ?? ''"
      )) as string
    const contents = win.webContents as unknown as {
      printToPDF: (options: unknown) => Promise<Uint8Array>
      print: (options: unknown, completion: (success: boolean) => void) => void
    }
    contents.printToPDF = async() => {
      probe.printed.push(await printContainer())
      return new Uint8Array(Buffer.from('%PDF-1.4\n'))
    }
    contents.print = (_options, completion) => {
      printContainer().then((html) => {
        probe.printed.push(html)
        completion(true)
      }, () => completion(false))
    }
  }, outputDir)
}

const printedHtml = async(app: ElectronApplication): Promise<readonly string[]> =>
  await app.evaluate(
    () => (global as unknown as { __mtExportProbe: { printed: string[] } }).__mtExportProbe.printed
  )

const runFileCommand = async(
  app: ElectronApplication,
  page: Page,
  label: ExportCommand
): Promise<void> => {
  await app.evaluate(({ BrowserWindow, Menu }, commandLabel) => {
    const win = BrowserWindow.getAllWindows()[0]
    const fileMenu = Menu.getApplicationMenu()?.items.find((item) => item.label === 'File')
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const item of items) {
        if (item.label === commandLabel) return item
        const nested = item.submenu ? find(item.submenu.items) : undefined
        if (nested !== undefined) return nested
      }
      return undefined
    }
    const command = fileMenu?.submenu ? find(fileMenu.submenu.items) : undefined
    if (command === undefined || win === undefined) {
      throw new Error(`File command is unavailable: ${commandLabel}`)
    }
    command.click(undefined, win, win.webContents)
  }, label)
  if (label === 'Word (.docx)') return
  const dialog = page.locator('.print-settings-dialog .el-dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.locator('.button-primary').click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

test.describe('exports from Source view', () => {
  test.describe.configure({ timeout: 120_000 })

  let app: ElectronApplication | undefined
  let outputDir: string

  test.beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-source-export-'))
  })

  test.afterEach(async() => {
    if (app !== undefined) await app.close()
    app = undefined
    fs.rmSync(outputDir, { recursive: true, force: true })
  })

  test('styled HTML, PDF, Print and Pandoc include an edit typed in Source view', async() => {
    // Pandoc is replaced by a script that copies the Markdown it receives.
    const pandoc = path.join(outputDir, 'pandoc-stub.sh')
    fs.writeFileSync(
      pandoc,
      '#!/bin/sh\nout=""\nwhile [ $# -gt 0 ]; do\n  if [ "$1" = "-o" ]; then out="$2"; shift; fi\n  shift\ndone\ncat > "$out"\n',
      { mode: 0o755 }
    )
    const launched = await launchWithMarkdown(DOCUMENT, { env: { MARKTEXT_PANDOC: pandoc } })
    app = launched.app
    const { page } = launched
    await installExportProbe(app, outputDir)

    await enterSourceMode(page, app)
    await page.locator('.source-code .CodeMirror-code').click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type(SOURCE_EDIT)
    await expect(page.locator('.source-code')).toContainText(SOURCE_EDIT)

    await runFileCommand(app, page, 'Export as HTML')
    const htmlPath = path.join(outputDir, 'note.html')
    await expect.poll(() => fs.existsSync(htmlPath), { timeout: 15_000 }).toBe(true)
    const html = fs.readFileSync(htmlPath, 'utf8')
    expect(html).toContain(SOURCE_EDIT)
    // Exports keep reading the Revised projection, not raw CriticMarkup.
    expect(html).toContain('added')
    expect(html).not.toContain('{++')

    await runFileCommand(app, page, 'Export as PDF')
    await runFileCommand(app, page, 'Print')
    await expect.poll(async() => (await printedHtml(app!)).length, { timeout: 15_000 }).toBe(2)
    for (const printed of await printedHtml(app)) expect(printed).toContain(SOURCE_EDIT)

    await runFileCommand(app, page, 'Word (.docx)')
    const docxPath = path.join(outputDir, 'note.docx')
    await expect.poll(() => fs.existsSync(docxPath), { timeout: 15_000 }).toBe(true)
    await expect.poll(() => fs.readFileSync(docxPath, 'utf8'), { timeout: 15_000 }).toBe(
      `${DOCUMENT}${SOURCE_EDIT}`
    )
  })
})
