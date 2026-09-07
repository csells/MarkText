import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'

import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  sendIpcToRenderer,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import {
  defaultCoreLaunchEnvironment,
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'

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

const excludedProjectionTokens = [
  'MT_DELETED_41',
  'MT_OLD_63',
  'MT_COMMENT_85',
  '{--',
  '{++',
  '{~~',
  '{>>'
] as const

type NativeConsumerObservation = Readonly<{
  kind: 'pdf' | 'print'
  html: string
  images: readonly { src: string; width: number; height: number; complete: boolean }[]
  options: Readonly<Record<string, unknown>>
}>

const installedBinary = (): string => {
  const configured = process.env.MARKTEXT_PACKAGED_APP
  if (configured === undefined || configured.trim().length === 0) {
    throw new Error('MARKTEXT_PACKAGED_APP must name the installed MarkText executable')
  }
  const absolute = path.resolve(configured)
  if (!fs.existsSync(absolute)) {
    throw new Error(`Installed MarkText executable does not exist: ${absolute}`)
  }
  return absolute
}

const launchInstalled = async(
  binary: string,
  userDataDir: string,
  filePath: string
): Promise<{ app: ElectronApplication; page: Page }> => {
  const app = await electron.launch({
    executablePath: binary,
    args: ['--user-data-dir', userDataDir, filePath],
    env: defaultCoreLaunchEnvironment({
      PERF_TESTING: 'true',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1',
      MARKTEXT_ERROR_INTERACTION: '1'
    }),
    timeout: 60_000
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await waitForEditor(page, 60_000)
    await waitForMenuReady(app, 60_000)
    await expectInstalledArtifactCommit(page)
    await expectDefaultCoreAuthority(page)
    await page.waitForFunction(() => window.__marktextDocumentCore?.authoritySource !== undefined)
    return { app, page }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
}

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

const expectRevisedProjectionHtml = (html: string): void => {
  expect(html).toContain('Export Authority')
  for (const token of retainedProjectionTokens) expect(html).toContain(token)
  for (const token of excludedProjectionTokens) expect(html).not.toContain(token)
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
    const binary = installedBinary()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-export-consumers-'))
    const filePath = path.join(root, 'export-authority.md')
    const htmlPath = path.join(root, 'export-authority.html')
    const pdfPath = path.join(root, 'export-authority.pdf')
    const userDataDir = path.join(root, 'profile')
    const imagePath = path.join(root, 'image.png')
    const imageUrl = pathToFileURL(imagePath).href
    fs.writeFileSync(
      imagePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      )
    )
    fs.writeFileSync(filePath, source, 'utf8')

    let app: ElectronApplication | undefined
    try {
      const launched = await launchInstalled(binary, userDataDir, filePath)
      const installedApp = launched.app
      app = installedApp
      const { page } = launched
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
      expectRevisedProjectionHtml(styledHtml)
      await expectMediaHtml(page, styledHtml, imageUrl)

      await invokeExportCommand(installedApp, page, 'file.export-file-pdf')
      await expect.poll(() => fs.existsSync(pdfPath)).toBe(true)
      const pdfBytes = fs.readFileSync(pdfPath)
      expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-')
      expect(pdfBytes.length).toBeGreaterThan(1_000)
      const pdfText = execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' })
      expectRevisedProjectionHtml(pdfText)
      await test
        .info()
        .attach('revised-export.pdf', { path: pdfPath, contentType: 'application/pdf' })
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
      expectRevisedProjectionHtml(pdf?.html ?? '')
      await expectMediaHtml(page, pdf?.html ?? '', imageUrl)
      expectNativeImages(pdf, imageUrl)

      await invokeExportCommand(installedApp, page, 'file.print')
      await expect
        .poll(
          async() =>
            (await observations(installedApp)).filter((event) => event.kind === 'print').length
        )
        .toBe(1)
      const print = (await observations(installedApp)).find((event) => event.kind === 'print')
      expect(print?.options).toEqual({ printBackground: true })
      expectRevisedProjectionHtml(print?.html ?? '')
      await expectMediaHtml(page, print?.html ?? '', imageUrl)
      expectNativeImages(print, imageUrl)

      expect(await authoritySource(page)).toBe(source)
      await sendIpcToRenderer(installedApp, 'mt::editor-ask-file-save')
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(source)
    } finally {
      if (app !== undefined) await app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
