import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'

import {
  chooseCoreAuthorityPerformanceSurface,
  createCoreAuthorityPerformanceRawRun,
  formatMacHardwareFingerprint,
  type CoreAuthorityPerformanceRawSample
} from './helpers/coreAuthorityPerformanceRawRun'
import type { CoreAuthorityPerformanceSurface } from './helpers/coreAuthorityPerformanceRawRun'
import { reportCoreAuthorityPerformance } from './helpers/coreAuthorityPerformanceReport'
import {
  readBrowserInputEventTrace,
  startBrowserInputEventTrace,
  waitForBrowserInputEventTrace
} from './helpers/browserInputEventTrace'
import {
  readInputLatencyTrace,
  startInputLatencyTrace,
  waitForInputLatencyTrace
} from './helpers/inputLatencyTrace'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  enterSourceMode,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import { expectInstalledArtifactCommit } from './installedArtifactProvenance'

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const REPRESENTATIVE_DOCUMENTS = path.join(
  REPO_ROOT,
  'specs/baselines/criticmarkup-representative-documents.json'
)
const PERFORMANCE_TARGETS = path.join(
  REPO_ROOT,
  'specs/baselines/criticmarkup-performance-targets.json'
)
const PERFORMANCE_MEASUREMENTS = path.join(
  REPO_ROOT,
  'specs/baselines/criticmarkup-performance-measurements.json'
)

interface RepresentativeDocument {
  readonly id: string
  readonly path: string
  readonly sha256: string
  readonly dependentAssets?: readonly Readonly<{ readonly path: string }>[]
}

interface RepresentativeDocumentManifest {
  readonly documents: readonly RepresentativeDocument[]
}

interface PerformanceTargetManifest {
  readonly environment: Readonly<Record<string, string>>
  readonly sampling: Readonly<{
    readonly warmupSamples: number
    readonly measuredSamples: number
  }>
}

interface PerformanceMeasurementManifest {
  readonly baselineCommit: string
}

const readJson = <T>(filePath: string): T =>
  JSON.parse(fs.readFileSync(filePath, 'utf8')) as T

const sha256 = (source: Buffer): string => createHash('sha256')
  .update(source)
  .digest('hex')

const requiredPath = (name: string): string => {
  const configured = process.env[name]
  if (configured === undefined || configured.trim().length === 0) {
    throw new Error(`${name} is required`)
  }
  return path.resolve(configured)
}

const installedBinary = (): string => {
  const binary = requiredPath('MARKTEXT_PACKAGED_APP')
  if (!fs.existsSync(binary)) {
    throw new Error(`Installed MarkText executable does not exist: ${binary}`)
  }
  return binary
}

const machineEnvironment = (): Readonly<Record<string, string>> => {
  const hardware = JSON.parse(execFileSync(
    'system_profiler',
    ['SPHardwareDataType', '-json'],
    { encoding: 'utf8' }
  )) as {
    readonly SPHardwareDataType?: readonly Readonly<{
      readonly machine_name?: string
      readonly machine_model?: string
      readonly chip_type?: string
      readonly physical_memory?: string
    }>[]
  }
  const item = hardware.SPHardwareDataType?.[0]
  const productVersion = execFileSync('sw_vers', ['-productVersion'], {
    encoding: 'utf8'
  }).trim()
  const buildVersion = execFileSync('sw_vers', ['-buildVersion'], {
    encoding: 'utf8'
  }).trim()
  return Object.freeze({
    hardware: formatMacHardwareFingerprint({
      machineName: item?.machine_name,
      machineModel: item?.machine_model,
      chipType: item?.chip_type,
      physicalMemory: item?.physical_memory
    }),
    os: `macOS ${productVersion} (${buildVersion}), ${process.arch}`,
    build: 'MarkText production Electron bundle'
  })
}

const activeDocumentId = (page: Page): Promise<string | null> =>
  page.evaluate(() =>
    document.querySelector('.tabs-container > li.active')
      ?.getAttribute('data-id') ?? null
  )

const closeActiveTab = async(page: Page): Promise<void> => {
  const closed = await page.evaluate(() => {
    const root = document.querySelector('#app') as
      | (Element & {
        __vue_app__?: {
          config?: { globalProperties?: Record<string, unknown> }
        }
      })
      | null
    const pinia = root?.__vue_app__?.config?.globalProperties?.$pinia as
      | { _s?: Map<string, Record<string, unknown>> }
      | undefined
    const store = pinia?._s?.get('editor') as
      | {
        currentFile?: unknown
        FORCE_CLOSE_TAB?: (file: unknown) => void
      }
      | undefined
    if (store?.currentFile === undefined || store.FORCE_CLOSE_TAB === undefined) {
      return false
    }
    store.FORCE_CLOSE_TAB(store.currentFile)
    return true
  })
  if (!closed) throw new Error('Installed performance runner cannot close its sample tab')
  await expect.poll(() => activeDocumentId(page)).toBeNull()
}

const openSample = async(
  app: ElectronApplication,
  page: Page,
  filePath: string
): Promise<string> => {
  await app.evaluate(({ BrowserWindow, ipcMain }, target) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window === undefined) throw new Error('Editor window is unavailable')
    ipcMain.emit('app-open-file-by-id', window.id, target)
  }, filePath)
  await expect.poll(() => activeDocumentId(page), { timeout: 60_000 }).not.toBeNull()
  const documentId = await activeDocumentId(page)
  if (documentId === null) throw new Error('Installed performance document did not open')
  await page.waitForFunction(
    expected => window.__marktextDocumentCore?.documentId === expected,
    documentId,
    { timeout: 60_000 }
  )
  return documentId
}

const measureSample = async(
  app: ElectronApplication,
  page: Page,
  documentId: string,
  representativeId: string
): Promise<Readonly<{
  readonly surface: CoreAuthorityPerformanceSurface
  readonly report: ReturnType<typeof reportCoreAuthorityPerformance>
}>> => {
  const wysiwygEditable = page.locator(
    'span.mu-paragraph-content[contenteditable="true"]'
  ).first()
  const surface = chooseCoreAuthorityPerformanceSurface({
    sourceActive: await page.locator('.source-code .CodeMirror').count() > 0,
    wysiwygEditable: await wysiwygEditable.count() > 0
  })
  if (surface === 'source') await enterSourceMode(page, app)

  await page.waitForFunction(expected => {
    const events = window.__marktextDocumentCore?.performanceEvents?.() ?? []
    return events.some(event =>
      event.documentId === expected && event.phase === 'first-editable-viewport'
    )
  }, documentId, { timeout: 60_000 })

  let input: Readonly<{ readonly sequence: number; readonly tEvent: number }> |
    undefined
  if (surface === 'wysiwyg') {
    await wysiwygEditable.click()
    await page.keyboard.press('End')
    await startInputLatencyTrace(page, { maxSamples: 1 })
    await page.keyboard.type('x', { delay: 0 })
    await waitForInputLatencyTrace(page, 1, 30_000)
    ;[input] = await readInputLatencyTrace(page)
  } else {
    await page.waitForSelector(
      '.source-code .CodeMirror',
      { state: 'attached', timeout: 60_000 }
    )
    await startBrowserInputEventTrace(page, '.source-code')
    await page.evaluate(() => {
      const host = document.querySelector('.source-code .CodeMirror') as
        | (Element & {
          CodeMirror?: {
            focus(): void
            getLine(line: number): string
            setCursor(position: { line: number; ch: number }): void
          }
        })
        | null
      const codeMirror = host?.CodeMirror
      if (codeMirror === undefined) {
        throw new Error('Core Source performance surface is unavailable')
      }
      codeMirror.focus()
      codeMirror.setCursor({ line: 0, ch: codeMirror.getLine(0).length })
    })
    await page.keyboard.type('x', { delay: 0 })
    await waitForBrowserInputEventTrace(page, 1, 30_000)
    ;[input] = await readBrowserInputEventTrace(page)
  }
  await page.evaluate(() => window.__marktextDocumentCore?.settled())
  await page.waitForFunction(expected => {
    const events = (window.__marktextDocumentCore?.performanceEvents?.() ?? [])
      .filter(event => event.documentId === expected)
    const dispatch = events.find(event => event.phase === 'dispatch')
    return dispatch !== undefined &&
      events.some(event => event.phase === 'ack' &&
        event.transaction === dispatch.transaction) &&
      events.some(event => event.phase === 'reconcile' &&
        event.transaction === dispatch.transaction)
  }, documentId, { timeout: 30_000 })
  if (input === undefined) {
    throw new Error(
      `Browser input trace is missing for ${representativeId} ${surface}`
    )
  }
  const authorityEvents = await page.evaluate(expected =>
    (window.__marktextDocumentCore?.performanceEvents?.() ?? [])
      .filter(event => event.documentId === expected), documentId)
  return Object.freeze({
    surface,
    report: reportCoreAuthorityPerformance({
      inputEvents: [{ sequence: input.sequence, tEvent: input.tEvent }],
      authorityEvents
    })
  })
}

const sampleFilesFor = (
  root: string,
  document: RepresentativeDocument,
  count: number
): readonly string[] => {
  const sourcePath = path.resolve(REPO_ROOT, document.path)
  const source = fs.readFileSync(sourcePath)
  if (sha256(source) !== document.sha256) {
    throw new Error(`Representative document digest is stale: ${document.id}`)
  }
  for (const asset of document.dependentAssets ?? []) {
    const sourceAsset = path.resolve(REPO_ROOT, asset.path)
    const targetAsset = path.resolve(root, asset.path)
    fs.mkdirSync(path.dirname(targetAsset), { recursive: true })
    fs.copyFileSync(sourceAsset, targetAsset)
  }
  const directory = path.resolve(root, path.dirname(document.path))
  fs.mkdirSync(directory, { recursive: true })
  return Object.freeze(Array.from({ length: count }, (_, index) => {
    const sample = path.join(
      directory,
      `${document.id}-sample-${String(index + 1).padStart(3, '0')}.md`
    )
    fs.writeFileSync(sample, source)
    return sample
  }))
}

test.describe('installed Core authority raw performance producer', () => {
  test.describe.configure({ timeout: 60 * 60 * 1000 })
  test.skip(
    process.env.MARKTEXT_PERFORMANCE_OUTPUT === undefined,
    'Dedicated packaged performance launch only'
  )

  test('writes five unpooled 20/200 production-bundle distributions', async() => {
    if (process.platform !== 'darwin') {
      throw new Error('Pinned Core performance evidence requires the recorded macOS host')
    }
    const binary = installedBinary()
    const outputPath = requiredPath('MARKTEXT_PERFORMANCE_OUTPUT')
    const buildCommit = process.env.MARKTEXT_EXPECTED_COMMIT ?? ''
    const representatives = readJson<RepresentativeDocumentManifest>(
      REPRESENTATIVE_DOCUMENTS
    )
    const targets = readJson<PerformanceTargetManifest>(PERFORMANCE_TARGETS)
    const measurements = readJson<PerformanceMeasurementManifest>(
      PERFORMANCE_MEASUREMENTS
    )
    expect(representatives.documents).toHaveLength(5)
    expect(targets.sampling).toEqual({
      warmupSamples: 20,
      measuredSamples: 200,
      percentiles: [50, 95, 99],
      scenarios: expect.any(String)
    })
    expect(machineEnvironment()).toEqual(targets.environment)

    const totalSamples = representatives.documents.length *
      (targets.sampling.warmupSamples + targets.sampling.measuredSamples)
    const samples: CoreAuthorityPerformanceRawSample[] = []
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-core-performance-'))
    let completed = 0
    try {
      for (const document of representatives.documents) {
        const count = targets.sampling.warmupSamples +
          targets.sampling.measuredSamples
        const sampleFiles = sampleFilesFor(runRoot, document, count)
        const profile = path.join(runRoot, `profile-${document.id}`)
        const launchEnvironment = { ...process.env }
        delete launchEnvironment.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
        const app = await electron.launch({
          executablePath: binary,
          args: ['--user-data-dir', profile, sampleFiles[0]!],
          env: {
            ...launchEnvironment,
            PERF_TESTING: 'true',
            MARKTEXT_DOCUMENT_CORE_MODE: '1',
            MARKTEXT_E2E_HIDDEN_WINDOW: '1',
            MARKTEXT_ERROR_INTERACTION: '1'
          },
          timeout: 60_000
        })
        try {
          const page = await app.firstWindow()
          await page.waitForLoadState('domcontentloaded')
          await waitForEditor(page, 60_000)
          await waitForMenuReady(app, 60_000)
          await expectInstalledArtifactCommit(page)
          await expectEditorWindowHidden(app)
          expectEditorNotFrontmost(app)
          expect(await page.evaluate(() =>
            window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
          )).toBeUndefined()

          for (let index = 0; index < sampleFiles.length; index += 1) {
            const filePath = sampleFiles[index]!
            const documentId = index === 0
              ? await (async() => {
                await expect.poll(
                  () => activeDocumentId(page),
                  { timeout: 60_000 }
                ).not.toBeNull()
                const active = await activeDocumentId(page)
                if (active === null) throw new Error('Initial sample did not open')
                await page.waitForFunction(
                  expected => window.__marktextDocumentCore?.documentId === expected,
                  active,
                  { timeout: 60_000 }
                )
                return active
              })()
              : await openSample(app, page, filePath)
            const measurement = await measureSample(
              app,
              page,
              documentId,
              document.id
            )
            samples.push(Object.freeze({
              documentId: document.id,
              phase: index < targets.sampling.warmupSamples
                ? 'warmup'
                : 'measured',
              surface: measurement.surface,
              report: measurement.report
            }))
            completed += 1
            process.stdout.write(
              `[${String(completed)}/${String(totalSamples)}] ` +
              `${document.id} ${index < targets.sampling.warmupSamples
                ? 'warmup'
                : 'measured'} ${String(index + 1)} ` +
              `${measurement.surface}\n`
            )
            await closeActiveTab(page)
          }
        } finally {
          await app.close()
        }
      }

      const run = createCoreAuthorityPerformanceRawRun({
        runId: process.env.MARKTEXT_PERFORMANCE_RUN_ID ??
          `core-candidate-${buildCommit.slice(0, 12)}`,
        baselineCommit: measurements.baselineCommit,
        buildCommit,
        measuredAt: new Date().toISOString(),
        environment: targets.environment,
        sampling: targets.sampling,
        documents: representatives.documents.map(document => ({
          id: document.id,
          sourceSha256: document.sha256
        })),
        samples
      })
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.writeFileSync(outputPath, `${JSON.stringify(run, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx'
      })
      expect(completed).toBe(totalSamples)
    } finally {
      fs.rmSync(runRoot, { recursive: true, force: true })
    }
  })
})
