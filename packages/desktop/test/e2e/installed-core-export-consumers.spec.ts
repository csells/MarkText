import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { exportedDocumentText } from './helpers/exportedDocumentText'

import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  launchInstalled,
  sendIpcToRenderer
} from './helpers'

const source = [
  '# Export Authority',
  '',
  'MT_KEEP_10 {--MT_DELETED_41--}{++MT_ADDED_52++} ' +
    '{~~MT_OLD_63~>MT_NEW_74~~}{>>MT_COMMENT_85<<} MT_TAIL_96.',
  '',
  'Math: $x^2$.',
  '',
  '![Markdown media](image.png)',
  '',
  '<img src="image.png" alt="Raw HTML media">',
  '',
  '```mermaid',
  'graph TD; A[MT_DIAGRAM_118]-->B[Result]',
  '```',
  '',
  '```js',
  'const MT_CODE_107 = 42',
  '```',
  ''
].join('\n')

const retainedProjectionTokens = [
  'MT_KEEP_10',
  'MT_ADDED_52',
  'MT_NEW_74',
  'MT_TAIL_96',
  'MT_CODE_107',
  'MT_DIAGRAM_118'
] as const

const excludedProjectionWords = ['MT_DELETED_41', 'MT_OLD_63', 'MT_COMMENT_85'] as const

const excludedProjectionTokens = [...excludedProjectionWords, '{--', '{++', '{~~', '{>>'] as const

const writeFixtureImage = (filePath: string): void => {
  fs.writeFileSync(
    filePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
  )
}

type NativeConsumerObservation = Readonly<{
  kind: 'pdf' | 'print'
  html: string
  images: readonly { src: string; width: number; height: number; complete: boolean }[]
  mathFontsLoaded: boolean
  options: Readonly<Record<string, unknown>>
}>

const installNativeConsumerProbe = async(
  app: ElectronApplication,
  htmlPath: string,
  pdfPath: string
): Promise<void> => {
  await app.evaluate(
    async({ BrowserWindow, dialog }, outputPaths) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win === undefined) throw new Error('Installed editor window is absent')

      type Observation = Readonly<{
        kind: 'pdf' | 'print'
        html: string
        images: readonly { src: string; width: number; height: number; complete: boolean }[]
        mathFontsLoaded: boolean
        options: Readonly<Record<string, unknown>>
      }>
      type ProbeState = {
        observations: Observation[]
      }
      const processGlobal = global as unknown as {
        __marktextCoreExportConsumerProbe?: ProbeState
      }
      processGlobal.__marktextCoreExportConsumerProbe = { observations: [] }
      ;(
        dialog as unknown as {
          showSaveDialog: (...args: unknown[]) => Promise<{
            canceled: boolean
            filePath: string
          }>
        }
      ).showSaveDialog = async(_owner: unknown, options: unknown) => {
        const defaultPath = String(
          (options as { defaultPath?: unknown } | undefined)?.defaultPath ?? ''
        )
        return {
          canceled: false,
          filePath: defaultPath.endsWith('.pdf') ? outputPaths.pdf : outputPaths.html
        }
      }

      const printContainerHtml = async(): Promise<string> =>
        (await win.webContents.executeJavaScript(
          "document.querySelector('.print-container')?.innerHTML ?? ''"
        )) as string

      const printImages = async(): Promise<Observation['images']> =>
        (await win.webContents.executeJavaScript(
          "Array.from(document.querySelectorAll('.print-container img')).map(image => ({src: image.src, width: image.naturalWidth, height: image.naturalHeight, complete: image.complete}))"
        )) as Observation['images']

      const printMathFontsLoaded = async(): Promise<boolean> =>
        (await win.webContents.executeJavaScript(
          "Array.from(document.querySelectorAll('.print-container .katex *')).every(node => document.fonts.check(getComputedStyle(node).font, node.textContent || ' '))"
        )) as boolean

      const nativePrintToPDF = win.webContents.printToPDF.bind(win.webContents)
      ;(
        win.webContents as unknown as {
          printToPDF: (options: Record<string, unknown>) => Promise<Uint8Array>
        }
      ).printToPDF = async(options) => {
        processGlobal.__marktextCoreExportConsumerProbe?.observations.push({
          kind: 'pdf',
          html: await printContainerHtml(),
          images: await printImages(),
          mathFontsLoaded: await printMathFontsLoaded(),
          options: { ...options }
        })
        return nativePrintToPDF(options)
      }
      ;(
        win.webContents as unknown as {
          print: (
            options: Record<string, unknown>,
            completion: (success: boolean, failureReason?: string) => void
          ) => void
        }
      ).print = async(options, completion) => {
        try {
          const html = await printContainerHtml()
          processGlobal.__marktextCoreExportConsumerProbe?.observations.push({
            kind: 'print',
            html,
            images: await printImages(),
            mathFontsLoaded: await printMathFontsLoaded(),
            options: { ...options }
          })
          completion(true)
        } catch (error) {
          completion(false, String(error))
        }
      }
    },
    { html: htmlPath, pdf: pdfPath }
  )
}

const observations = async(
  app: ElectronApplication
): Promise<readonly NativeConsumerObservation[]> =>
  await app.evaluate(() => {
    const processGlobal = global as unknown as {
      __marktextCoreExportConsumerProbe?: {
        observations: NativeConsumerObservation[]
      }
    }
    return processGlobal.__marktextCoreExportConsumerProbe?.observations ?? []
  })

const invokeExportCommand = async(
  app: ElectronApplication,
  page: Page,
  commandId: 'file.export-file-html' | 'file.export-file-pdf' | 'file.print'
): Promise<void> => {
  await app.evaluate(({ BrowserWindow, Menu }, id) => {
    const applicationMenu = Menu.getApplicationMenu()
    const fileMenu = applicationMenu?.items.find((item) => item.label === 'File')
    const win = BrowserWindow.getAllWindows()[0]
    if (fileMenu?.submenu === undefined || win === undefined) {
      throw new Error('Installed File menu is unavailable')
    }
    const commandLabel =
      id === 'file.export-file-html'
        ? 'Export as HTML'
        : id === 'file.export-file-pdf'
          ? 'Export as PDF'
          : 'Print'
    const exportMenu = fileMenu.submenu.items.find((item) => item.label === 'Export')
    const command =
      id === 'file.print'
        ? fileMenu.submenu.items.find((item) => item.label === commandLabel)
        : exportMenu?.submenu?.items.find((item) => item.label === commandLabel)
    if (command === undefined) {
      throw new Error(`Installed File command is unavailable: ${commandLabel}`)
    }
    command.click(undefined, win, win.webContents)
  }, commandId)
  const dialog = page.locator('.print-settings-dialog .el-dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.locator('.button-primary').click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

const expectRevisedProjectionText = (text: string): void => {
  expect(text).toContain('Export Authority')
  for (const token of retainedProjectionTokens) expect(text).toContain(token)
  for (const token of excludedProjectionTokens) expect(text).not.toContain(token)
}

const expectRevisedProjectionHtml = async(page: Page, html: string): Promise<void> => {
  // Keep privacy checks over all HTML, including attributes and generated styles.
  for (const token of excludedProjectionWords) expect(html).not.toContain(token)
  // Mermaid CSS custom properties contain "{--"; only document text is CM prose.
  expectRevisedProjectionText(await page.evaluate(exportedDocumentText, html))
}

const expectMediaHtml = async(page: Page, html: string, imageUrl: string): Promise<void> => {
  const rendered = await page.evaluate((markup) => {
    const document = new DOMParser().parseFromString(markup, 'text/html')
    return {
      math: document.querySelectorAll('.katex .msupsub').length,
      diagrams: document.querySelectorAll('.mermaid svg').length,
      keyword: document.querySelector('code .token.keyword')?.textContent,
      images: [...document.querySelectorAll('img')].map((image) => ({
        src: image.getAttribute('src'),
        alt: image.alt
      }))
    }
  }, html)
  expect(rendered.math).toBeGreaterThan(0)
  expect(rendered.diagrams).toBe(1)
  expect(rendered.keyword).toBe('const')
  expect(rendered.images).toEqual([
    { src: imageUrl, alt: 'Markdown media' },
    { src: imageUrl, alt: 'Raw HTML media' }
  ])
}

const expectNativeImages = (
  observation: NativeConsumerObservation | undefined,
  imageUrl: string
): void => {
  // Snapshot at the native-consumer boundary: do not wait inside the probe and mask an early print.
  expect(observation?.images).toEqual([
    { src: imageUrl, width: 1, height: 1, complete: true },
    { src: imageUrl, width: 1, height: 1, complete: true }
  ])
}

const authoritySource = async(page: Page): Promise<string> => {
  const current = await page.evaluate(
    async() => await window.__marktextDocumentCore?.authoritySource?.()
  )
  if (current === undefined) throw new Error('Core authority source bridge is absent')
  return current
}

test.describe('installed Core Revised export consumers', () => {
  test.describe.configure({ timeout: 180_000 })

  test('styled HTML, PDF, and Print commands consume the same Revised projection', async() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-export-consumers-'))
    const filePath = path.join(root, 'export-authority.md')
    const htmlPath = path.join(root, 'export-authority.html')
    const pdfPath = path.join(root, 'export-authority.pdf')
    const userDataDir = path.join(root, 'profile')
    const imagePath = path.join(root, 'image.png')
    const imageUrl = pathToFileURL(imagePath).href
    writeFixtureImage(imagePath)
    fs.writeFileSync(filePath, source, 'utf8')

    let app: ElectronApplication | undefined
    try {
      const launched = await launchInstalled([filePath], { userDataDir, timeout: 60_000 })
      const installedApp = launched.app
      app = installedApp
      const { page } = launched
      await page.waitForFunction(() => window.__marktextDocumentCore?.authoritySource !== undefined)
      await expectEditorWindowHidden(installedApp)
      expectEditorNotFrontmost(installedApp)
      expect(
        await page.evaluate(() => window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS)
      ).toBeUndefined()
      expect(await authoritySource(page)).toBe(source)

      await installNativeConsumerProbe(installedApp, htmlPath, pdfPath)

      await invokeExportCommand(installedApp, page, 'file.export-file-html')
      await expect.poll(() => fs.existsSync(htmlPath)).toBe(true)
      const styledHtml = fs.readFileSync(htmlPath, 'utf8')
      await test
        .info()
        .attach('revised-export.html', { body: styledHtml, contentType: 'text/html' })
      await expectRevisedProjectionHtml(page, styledHtml)
      await expectMediaHtml(page, styledHtml, imageUrl)

      await invokeExportCommand(installedApp, page, 'file.export-file-pdf')
      await expect.poll(() => fs.existsSync(pdfPath)).toBe(true)
      const pdfBytes = fs.readFileSync(pdfPath)
      expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-')
      expect(pdfBytes.length).toBeGreaterThan(1_000)
      const pdfText = execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' })
      expectRevisedProjectionText(pdfText)
      await test
        .info()
        .attach('revised-export.pdf', { path: pdfPath, contentType: 'application/pdf' })
      // Inspect glyphs in the native PDF, not just the pre-print KaTeX DOM.
      // A present .katex tree can still print blank while its fonts are loading.
      expect(pdfText).toMatch(/Math:\s*x\s*2\s*\./)
      await expect
        .poll(
          async() =>
            (await observations(installedApp)).filter((event) => event.kind === 'pdf').length
        )
        .toBe(1)
      const pdf = (await observations(installedApp)).find((event) => event.kind === 'pdf')
      expect(pdf?.options).toMatchObject({
        printBackground: true,
        generateTaggedPDF: true,
        generateDocumentOutline: true
      })
      await expectRevisedProjectionHtml(page, pdf?.html ?? '')
      await expectMediaHtml(page, pdf?.html ?? '', imageUrl)
      expectNativeImages(pdf, imageUrl)
      expect(pdf?.mathFontsLoaded).toBe(true)

      await invokeExportCommand(installedApp, page, 'file.print')
      await expect
        .poll(
          async() =>
            (await observations(installedApp)).filter((event) => event.kind === 'print').length
        )
        .toBe(1)
      const print = (await observations(installedApp)).find((event) => event.kind === 'print')
      expect(print?.options).toEqual({ printBackground: true })
      await expectRevisedProjectionHtml(page, print?.html ?? '')
      await expectMediaHtml(page, print?.html ?? '', imageUrl)
      expectNativeImages(print, imageUrl)
      expect(print?.mathFontsLoaded).toBe(true)

      expect(await authoritySource(page)).toBe(source)
      await sendIpcToRenderer(installedApp, 'mt::editor-ask-file-save')
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(source)
    } finally {
      if (app !== undefined) await app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
