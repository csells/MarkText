import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type {
  DocumentCoreExportOptions,
  DocumentCoreStaticSinkReceipt
} from '../../src/shared/types/documentCore'
import type {
  DocumentCoreStaticSinkAcceptanceRequest,
  DocumentCoreStaticSinkAcceptanceSurface
} from '../../src/main/documentCore/staticSinkAcceptanceSurface'
import {
  clickMenuById,
  closeElectron,
  enterSourceMode,
  exitSourceMode,
  expectNoCapturedErrors,
  launchWithMarkdown
} from './helpers'
import {
  saveCanonicalSnapshot
} from './documentCoreReviewE2e'

interface LiveSinkState {
  readonly hostileGlobal: boolean
  readonly scriptCount: number
  readonly imageCount: number
  readonly eventHandlerCount: number
}

const exportOptions = Object.freeze({
  title: 'Hostile sink review',
  page: Object.freeze({
    size: Object.freeze({ kind: 'named' as const, name: 'A4' as const }),
    landscape: false,
    marginsMm: Object.freeze({
      top: 20,
      right: 15,
      bottom: 20,
      left: 15
    })
  }),
  theme: Object.freeze({
    kind: 'built-in' as const,
    name: 'default' as const
  }),
  typography: null,
  autoNumberHeadings: false,
  showFrontMatter: false,
  toc: Object.freeze({ title: '', includeTopHeading: true }),
  header: null,
  footer: null,
  headerFooterAppearance: null
}) satisfies DocumentCoreExportOptions

const liveSinkState = async(page: Page): Promise<LiveSinkState> =>
  await page.evaluate(() => ({
    hostileGlobal:
      (globalThis as typeof globalThis & { __marktextHostile?: boolean })
        .__marktextHostile === true,
    scriptCount: document.querySelectorAll('.editor-component script').length,
    imageCount: document.querySelectorAll('.editor-component img').length,
    eventHandlerCount: document.querySelectorAll(
      '.editor-component [onerror],.editor-component [onclick],.editor-component [onload]'
    ).length
  }))

const expectInertLiveSink = async(page: Page): Promise<void> => {
  expect(await liveSinkState(page)).toEqual({
    hostileGlobal: false,
    scriptCount: 0,
    imageCount: 0,
    eventHandlerCount: 0
  })
}

const staticSinkIdentity = async(page: Page) =>
  await page.evaluate(() => {
    const bridge = window.__marktextE2EReadOnly
    if (bridge === undefined) {
      throw new Error('The E2E read-only bridge is unavailable')
    }
    return bridge.readStaticSinkIdentity()
  })

const invokeRendererStaticSink = async(
  page: Page,
  request: unknown
): Promise<DocumentCoreStaticSinkReceipt> =>
  await page.evaluate(async(payload) => {
    const rendererIpc = window.electron.ipcRenderer as unknown as {
      invoke: (
        channel: string,
        request: unknown
      ) => Promise<DocumentCoreStaticSinkReceipt>
    }
    return await rendererIpc.invoke(
      'mt::document-core::materialize-static',
      payload
    )
  }, request)

const invokeMainStaticSink = async(
  app: ElectronApplication,
  request: DocumentCoreStaticSinkAcceptanceRequest
): Promise<DocumentCoreStaticSinkReceipt> =>
  await app.evaluate(async({ BrowserWindow }, payload) => {
    const surface = (
      globalThis as typeof globalThis & {
        __mtDocumentCoreStaticSinkAcceptance?:
        DocumentCoreStaticSinkAcceptanceSurface
      }
    ).__mtDocumentCoreStaticSinkAcceptance
    if (surface === undefined) {
      throw new Error('Main-only static sink acceptance surface is absent')
    }
    const owners = BrowserWindow.getAllWindows()
      .filter(window => !window.isDestroyed())
    if (owners.length !== 1) {
      throw new Error(
        `Static sink acceptance expected one owner, found ${owners.length}`
      )
    }
    return await surface.execute(owners[0].webContents.id, payload)
  }, request)

test.describe('document-core hostile sinks', () => {
  test.describe.configure({ timeout: 60_000 })

  let app: ElectronApplication
  let page: Page
  let documentPath = ''
  let server: Server
  let probeRequests = 0
  let source = ''

  test.beforeAll(async() => {
    server = createServer((_request, response) => {
      probeRequests += 1
      response.writeHead(204)
      response.end()
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Hostile sink probe server has no TCP address')
    }
    const probeUrl = `http://127.0.0.1:${String(address.port)}/probe`
    source = [
      '# Sink security',
      '',
      'Safe {++new++} and {--old--} content.',
      '',
      '<script>globalThis.__marktextHostile = true</script>',
      `<img src="${probeUrl}" onerror="globalThis.__marktextHostile = true">`,
      '[unsafe](javascript:globalThis.__marktextHostile=true)'
    ].join('\n')

    const launched = await launchWithMarkdown(source)
    app = launched.app
    page = launched.page
    documentPath = launched.filePath
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  test('keeps hostile source inert in live HTML PDF and print sinks', async() => {
    await expectInertLiveSink(page)

    for (const [menuId, projection] of [
      ['reviewShowOriginalMenuItem', 'original'],
      ['reviewShowRevisedMenuItem', 'revised'],
      ['reviewShowMarkedMenuItem', 'marked']
    ] as const) {
      await clickMenuById(app, menuId)
      await expect(page.locator('.editor-component')).toHaveAttribute(
        'data-critic-projection',
        projection
      )
      await expectInertLiveSink(page)
      expect(await saveCanonicalSnapshot(page, app, documentPath)).toBe(source)
    }

    await enterSourceMode(page, app)
    await expect(page.locator('.source-code-input')).toHaveValue(source)
    expect(await page.evaluate(() =>
      (globalThis as typeof globalThis & { __marktextHostile?: boolean })
        .__marktextHostile === true
    )).toBe(false)
    await exitSourceMode(page, app)
    await expectInertLiveSink(page)

    await clickMenuById(app, 'reviewShowMarkedMenuItem')
    const identity = await staticSinkIdentity(page)
    const htmlPath = test.info().outputPath('hostile.html')
    const pdfPath = test.info().outputPath('hostile.pdf')
    const printPath = test.info().outputPath('hostile-print-proof.pdf')

    const forgedPaths = [
      test.info().outputPath('renderer-forged.html'),
      test.info().outputPath('renderer-forged.pdf'),
      test.info().outputPath('renderer-forged-print.pdf')
    ] as const
    for (const forgedRequest of [
      {
        ...identity,
        consumer: 'styled-html',
        targetPath: forgedPaths[0]
      },
      {
        ...identity,
        consumer: 'pdf',
        targetPath: forgedPaths[1]
      },
      {
        ...identity,
        consumer: 'print',
        proofPath: forgedPaths[2]
      }
    ]) {
      await expect(invokeRendererStaticSink(page, forgedRequest))
        .rejects.toThrow(/targetPath|proofPath|closed|fields/i)
    }
    for (const forgedPath of forgedPaths) {
      expect(existsSync(forgedPath)).toBe(false)
    }

    const htmlReceipt = await invokeMainStaticSink(app, {
      ...identity,
      consumer: 'styled-html',
      targetPath: htmlPath,
      options: exportOptions
    })
    const pdfReceipt = await invokeMainStaticSink(app, {
      ...identity,
      consumer: 'pdf',
      targetPath: pdfPath,
      options: exportOptions
    })
    const printReceipt = await invokeMainStaticSink(app, {
      ...identity,
      consumer: 'print',
      proofPath: printPath,
      options: exportOptions
    })

    expect(htmlReceipt).toMatchObject({
      kind: 'written',
      targetPath: htmlPath
    })
    expect(pdfReceipt).toMatchObject({
      kind: 'written',
      targetPath: pdfPath
    })
    expect(printReceipt).toMatchObject({
      kind: 'proof-written',
      targetPath: printPath
    })

    const html = readFileSync(htmlPath, 'utf8')
    expect(html).toContain('Safe')
    // Sanitized means semantically inert, not byte-absent. The hostile text
    // must survive as escaped text — dropping it would author a loss — so the
    // live forms are forbidden and the escaped forms are required.
    // A handler attribute cannot execute without a live tag, and every tag in
    // the hostile payload is escaped, so live tags and live javascript: URLs
    // are what must be absent.
    expect(html).not.toMatch(/<script|<img|<iframe|<svg/iu)
    expect(html).not.toMatch(/(?:href|src)\s*=\s*["']?\s*javascript:/iu)
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img')
    expect(html).toContain('onerror=&quot;')
    for (const artifactPath of [pdfPath, printPath]) {
      const artifact = readFileSync(artifactPath)
      expect(statSync(artifactPath).size).toBeGreaterThan(500)
      expect(artifact.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      expect(artifact.subarray(-6).toString('latin1')).toContain('%%EOF')
    }
    await test.info().attach('hostile-pdf', {
      path: pdfPath,
      contentType: 'application/pdf'
    })
    await test.info().attach('hostile-print-proof', {
      path: printPath,
      contentType: 'application/pdf'
    })

    // A raw hostile image would fetch the probe URL from any Chromium-backed
    // live, PDF, or print render. Zero requests proves all of those consumers
    // received inert parser-owned materialization.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(probeRequests).toBe(0)
    await expectNoCapturedErrors(app)
  })
})
