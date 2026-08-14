import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'

import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  sendIpcToRenderer,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import { expectInstalledArtifactCommit } from './installedArtifactProvenance'

const source = [
  '# Export Authority',
  '',
  'MT_KEEP_10 {--MT_DELETED_41--}{++MT_ADDED_52++} ' +
    '{~~MT_OLD_63~>MT_NEW_74~~}{>>MT_COMMENT_85<<} MT_TAIL_96.',
  ''
].join('\n')

const retainedProjectionTokens = [
  'MT_KEEP_10',
  'MT_ADDED_52',
  'MT_NEW_74',
  'MT_TAIL_96'
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
): Promise<{ app: ElectronApplication, page: Page }> => {
  const app = await electron.launch({
    executablePath: binary,
    args: ['--user-data-dir', userDataDir, filePath],
    env: {
      ...process.env,
      PERF_TESTING: 'true',
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1',
      MARKTEXT_ERROR_INTERACTION: '1'
    },
    timeout: 60_000
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await waitForEditor(page, 60_000)
  await waitForMenuReady(app, 60_000)
  await expectInstalledArtifactCommit(page)
  await page.waitForFunction(() =>
    window.__marktextDocumentCore?.authoritySource !== undefined
  )
  return { app, page }
}

const installNativeConsumerProbe = async(
  app: ElectronApplication,
  htmlPath: string,
  pdfPath: string
): Promise<void> => {
  await app.evaluate(async({ BrowserWindow, dialog }, outputPaths) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win === undefined) throw new Error('Installed editor window is absent')

    type Observation = Readonly<{
      kind: 'pdf' | 'print'
      html: string
      options: Readonly<Record<string, unknown>>
    }>
    type ProbeState = {
      observations: Observation[]
    }
    const processGlobal = global as unknown as {
      __marktextCoreExportConsumerProbe?: ProbeState
    }
    processGlobal.__marktextCoreExportConsumerProbe = { observations: [] }

    ;(dialog as unknown as {
      showSaveDialog: (...args: unknown[]) => Promise<{
        canceled: boolean
        filePath: string
      }>
    }).showSaveDialog = async(_owner: unknown, options: unknown) => {
      const defaultPath = String(
        (options as { defaultPath?: unknown } | undefined)?.defaultPath ?? ''
      )
      return {
        canceled: false,
        filePath: defaultPath.endsWith('.pdf') ? outputPaths.pdf : outputPaths.html
      }
    }

    const printContainerHtml = async(): Promise<string> =>
      await win.webContents.executeJavaScript(
        "document.querySelector('.print-container')?.innerHTML ?? ''"
      ) as string

    ;(win.webContents as unknown as {
      printToPDF: (options: Record<string, unknown>) => Promise<Uint8Array>
    }).printToPDF = async(options) => {
      processGlobal.__marktextCoreExportConsumerProbe?.observations.push({
        kind: 'pdf',
        html: await printContainerHtml(),
        options: { ...options }
      })
      return Buffer.from('%PDF-1.4\n% installed Core export consumer probe\n', 'utf8')
    }

    ;(win.webContents as unknown as {
      print: (
        options: Record<string, unknown>,
        completion: (success: boolean, failureReason?: string) => void
      ) => void
    }).print = async(options, completion) => {
      try {
        const html = await printContainerHtml()
        processGlobal.__marktextCoreExportConsumerProbe?.observations.push({
          kind: 'print',
          html,
          options: { ...options }
        })
        completion(true)
      } catch (error) {
        completion(false, String(error))
      }
    }
  }, { html: htmlPath, pdf: pdfPath })
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
  await sendIpcToRenderer(app, 'mt::execute-command-by-id', commandId)
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

const authoritySource = async(page: Page): Promise<string> => {
  const current = await page.evaluate(async() =>
    await window.__marktextDocumentCore?.authoritySource?.()
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
    fs.writeFileSync(filePath, source, 'utf8')

    let app: ElectronApplication | undefined
    try {
      const launched = await launchInstalled(binary, userDataDir, filePath)
      const installedApp = launched.app
      app = installedApp
      const { page } = launched
      await expectEditorWindowHidden(installedApp)
      expectEditorNotFrontmost(installedApp)
      expect(await page.evaluate(() =>
        window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
      )).toBeUndefined()
      expect(await authoritySource(page)).toBe(source)

      await installNativeConsumerProbe(installedApp, htmlPath, pdfPath)

      await invokeExportCommand(installedApp, page, 'file.export-file-html')
      await expect.poll(() => fs.existsSync(htmlPath)).toBe(true)
      const styledHtml = fs.readFileSync(htmlPath, 'utf8')
      expectRevisedProjectionHtml(styledHtml)

      await invokeExportCommand(installedApp, page, 'file.export-file-pdf')
      await expect.poll(() => fs.existsSync(pdfPath)).toBe(true)
      await expect.poll(async() =>
        (await observations(installedApp)).filter(event => event.kind === 'pdf').length
      ).toBe(1)
      const pdf = (await observations(installedApp)).find(event => event.kind === 'pdf')
      expect(pdf?.options).toMatchObject({
        printBackground: true,
        generateTaggedPDF: true,
        generateDocumentOutline: true
      })
      expectRevisedProjectionHtml(pdf?.html ?? '')

      await invokeExportCommand(installedApp, page, 'file.print')
      await expect.poll(async() =>
        (await observations(installedApp)).filter(event => event.kind === 'print').length
      ).toBe(1)
      const print = (await observations(installedApp)).find(event => event.kind === 'print')
      expect(print?.options).toEqual({ printBackground: true })
      expectRevisedProjectionHtml(print?.html ?? '')

      expect(await authoritySource(page)).toBe(source)
      await sendIpcToRenderer(installedApp, 'mt::editor-ask-file-save')
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(source)
    } finally {
      if (app !== undefined) await app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
