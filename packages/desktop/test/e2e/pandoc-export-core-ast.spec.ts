import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { launchWithMarkdown } from './helpers'

// File > Export builds Pandoc's input from Core's parse, so the
// installed pandoc is only ever asked to read JSON. Word keeps suggestions as
// tracked changes and comments; the HTML export shows the Revised text.

const PANDOC = spawnSync('sh', ['-c', 'command -v pandoc'], { encoding: 'utf8' }).stdout.trim()

const ORDINARY = [
  '# Field notes',
  '',
  'Some *emphasis* and a [link](https://example.com).',
  '',
  '1) first',
  '2) second',
  '',
  '| Left | Right |',
  '|:-----|------:|',
  '| a    | b     |',
  ''
].join('\n')

const REVIEWED = [
  '# Plan {++v2++}',
  '',
  'Keep {++added++} {--removed--} {~~old~>new~~} {==marked==}{>>why<<} end{>>note<<}.',
  '',
  'Cross {--gone',
  '',
  'still gone--} after.',
  ''
].join('\n')

type ExportCommand = 'Export as HTML' | 'Word (.docx)'

const stubSaveDialog = async(app: ElectronApplication, outputDir: string): Promise<void> => {
  await app.evaluate(({ dialog }, directory) => {
    ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async(
      _owner: unknown,
      options: { defaultPath?: string }
    ) => ({
      canceled: false,
      filePath: `${directory}/${String(options?.defaultPath ?? 'export').split('/').pop()}`
    })
  }, outputDir)
}

const runFileCommand = async(app: ElectronApplication, page: Page, label: ExportCommand): Promise<void> => {
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

const documentXml = (docx: string): string =>
  execFileSync('unzip', ['-p', docx, 'word/document.xml'], { encoding: 'utf8' })

const runsOf = (xml: string, tag: 'ins' | 'del', textTag: string): string[] =>
  [...xml.matchAll(new RegExp(`<w:${tag} [^>]*>([\\s\\S]*?)</w:${tag}>`, 'g'))].map((match) =>
    [...match[1]!.matchAll(new RegExp(`<w:${textTag}[^>]*>([^<]*)</w:${textTag}>`, 'g'))]
      .map((text) => text[1])
      .join('')
  )

test.describe('Pandoc and HTML export from Core', () => {
  test.describe.configure({ timeout: 120_000 })
  test.skip(PANDOC === '', 'needs pandoc on PATH')

  let app: ElectronApplication | undefined
  let outputDir: string
  let argvLog: string

  test.beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-pandoc-core-export-'))
    argvLog = path.join(outputDir, 'pandoc-argv.log')
  })

  test.afterEach(async() => {
    if (app !== undefined) await app.close()
    app = undefined
    fs.rmSync(outputDir, { recursive: true, force: true })
  })

  // The real pandoc behind a wrapper that records each argv line.
  const launch = async(markdown: string): Promise<Page> => {
    const wrapper = path.join(outputDir, 'pandoc-wrapper.sh')
    fs.writeFileSync(wrapper, `#!/bin/sh\necho "$@" >> '${argvLog}'\nexec '${PANDOC}' "$@"\n`, { mode: 0o755 })
    const launched = await launchWithMarkdown(markdown, { env: { MARKTEXT_PANDOC: wrapper } })
    app = launched.app
    await stubSaveDialog(app, outputDir)
    return launched.page
  }

  const readersUsed = (): string[] =>
    fs
      .readFileSync(argvLog, 'utf8')
      .split('\n')
      .flatMap((line) => [...line.matchAll(/(?:^| )-f ([^ ]+)/g)].map((match) => match[1]!))

  const exportBoth = async(page: Page, stem: string): Promise<{ xml: string; html: string }> => {
    await runFileCommand(app!, page, 'Word (.docx)')
    const docxPath = path.join(outputDir, `${stem}.docx`)
    await expect.poll(() => fs.existsSync(docxPath) && fs.statSync(docxPath).size > 0, { timeout: 30_000 }).toBe(true)
    await expect.poll(() => spawnSync('unzip', ['-t', docxPath]).status, { timeout: 15_000 }).toBe(0)

    await runFileCommand(app!, page, 'Export as HTML')
    const htmlPath = path.join(outputDir, `${stem}.html`)
    await expect.poll(() => fs.existsSync(htmlPath), { timeout: 15_000 }).toBe(true)
    return { xml: documentXml(docxPath), html: fs.readFileSync(htmlPath, 'utf8') }
  }

  test('an ordinary document reaches Word and HTML as Core reads it', async() => {
    const page = await launch(ORDINARY)
    const stem = 'note'
    const { xml, html } = await exportBoth(page, stem)

    expect(xml).toContain('w:val="Heading1"')
    expect(xml).toMatch(/<w:bookmarkStart w:id="\d+" w:name="field-notes" \/>/)
    expect(xml).toContain('>emphasis<')
    expect(xml).toContain('>second<')
    expect(xml).toContain('<w:tbl>')
    expect(xml).not.toMatch(/<w:ins |<w:del /)
    expect(html).toMatch(/<h1[^>]*>\s*Field notes\s*<\/h1>/)
    expect(html).toContain('<em>emphasis</em>')
    expect(readersUsed().length).toBeGreaterThan(0)
    expect(readersUsed().every((reader) => reader === 'json' || reader === 'native')).toBe(true)
  })

  test('a reviewed document keeps suggestions and comments in Word, and HTML shows the Revised text', async() => {
    const page = await launch(REVIEWED)
    const { xml, html } = await exportBoth(page, 'note')

    expect(runsOf(xml, 'ins', 't')).toEqual(expect.arrayContaining(['v2', 'added', 'new']))
    expect(runsOf(xml, 'del', 'delText')).toEqual(expect.arrayContaining(['removed', 'old', 'gone', 'still gone']))
    expect(xml.match(/<w:commentRangeStart /g)).toHaveLength(2)
    expect(xml).not.toMatch(/\{\+\+|\+\+\}|\{--|\{~~|~>|\{==|\{>>|<<\}/)

    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    expect(text).toContain('Keep added new marked end')
    expect(text).toContain('Cross after')
    expect(html).not.toMatch(/\{\+\+|\+\+\}|\{--|\{~~|~>|\{==|\{>>|<<\}/)
    expect(readersUsed().every((reader) => reader === 'json' || reader === 'native')).toBe(true)
  })
})
