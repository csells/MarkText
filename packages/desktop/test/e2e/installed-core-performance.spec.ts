import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'

import {
  assertBlankCoreAuthorityPerformanceBootstrap,
  chooseCoreAuthorityPerformanceSurface,
  closeCoreAuthorityPerformanceApplication,
  coreAuthorityPerformanceOrchestrationTimeoutMs,
  createCoreAuthorityPerformanceRawRun,
  finalizeCoreAuthorityPerformanceRawOutput,
  formatMacHardwareFingerprint,
  removeCoreAuthorityPerformanceObservationProfile,
  removeCoreAuthorityPerformanceRunRoot,
  type CoreAuthorityPerformanceRawSample
} from './helpers/coreAuthorityPerformanceRawRun'
import type { CoreAuthorityPerformanceSurface } from './helpers/coreAuthorityPerformanceRawRun'
import { reportCoreAuthorityPerformance } from './helpers/coreAuthorityPerformanceReport'
import {
  activateInstalledPerformanceWindow,
  assertMacWindowServerPresentation,
  closeInstalledPerformanceWindow,
  firstWindowWithPerformanceScheduling,
  inspectInstalledPerformanceWindow,
  PERFORMANCE_CHROMIUM_SCHEDULING_POLICY,
  PERFORMANCE_WINDOW_PRESENTATION_POLICY,
  withPerformanceChromiumScheduling
} from './helpers/performanceChromiumLaunchPolicy'
import {
  captureBrowserInputEventPresentation,
  startBrowserInputEventTrace,
  waitForBrowserInputEventEcho
} from './helpers/browserInputEventTrace'
import {
  captureInputLatencyPresentation,
  startInputLatencyTrace,
  waitForInputLatencyEcho
} from './helpers/inputLatencyTrace'
import {
  captureInstalledElectronHiddenPage,
  PERFORMANCE_PRESENTATION_BOUNDARY,
  resolveExactElectronPageTargetId,
  type PerformanceHiddenPageCapture
} from './helpers/performancePresentationCheckpoint'
import {
  PERFORMANCE_SAMPLE_LIFECYCLE,
  runIsolatedPerformanceObservations
} from './helpers/performanceSampleLifecycle'
import {
  createPerformanceObservationSchedule,
  PERFORMANCE_OBSERVATION_SCHEDULE,
  performanceObservationScheduleSha256,
  type PerformanceObservationScheduleEntry
} from './helpers/performanceObservationSchedule'
import {
  expectEditorNotFrontmost,
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
    readonly sampleLifecycle: typeof PERFORMANCE_SAMPLE_LIFECYCLE
    readonly observationSchedule: typeof PERFORMANCE_OBSERVATION_SCHEDULE
  }>
}

interface PerformanceMeasurementManifest {
  readonly baselineCommit: string
}

type CorePerformanceEvidenceClass = 'ratification' | 'smoke-non-ratifying'

interface CorePerformanceObservation extends PerformanceObservationScheduleEntry {
  readonly filePath: string
}

interface PreparedCorePerformanceApplication {
  readonly app: ElectronApplication
  readonly page: Page
  readonly targetId: string
  readonly applicationProcessId: number
  readonly capturePage: PerformanceHiddenPageCapture
}

const readJson = <T>(filePath: string): T =>
  JSON.parse(fs.readFileSync(filePath, 'utf8')) as T

const sha256 = (source: Buffer): string => createHash('sha256')
  .update(source)
  .digest('hex')

const requiredValue = (name: string): string => {
  const configured = process.env[name]
  if (configured === undefined || configured.trim().length === 0) {
    throw new Error(`${name} is required`)
  }
  return configured
}

const requiredPath = (name: string): string => path.resolve(requiredValue(name))

const throwLifecycleFailures = (
  message: string,
  failures: readonly unknown[]
): void => {
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, message)
}

const isProcessRunning = (processId: number): boolean => {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

const closeCorePerformanceApplication = async(
  app: ElectronApplication,
  applicationProcessId: number,
  targetId?: string
): Promise<void> => closeCoreAuthorityPerformanceApplication({
  processId: applicationProcessId,
  closeWindow: async() => {
    if (targetId !== undefined) {
      await closeInstalledPerformanceWindow(app, targetId)
    }
  },
  closeApplication: async() => app.close(),
  isProcessRunning,
  signalProcess: (processId, signal) => { process.kill(processId, signal) },
  now: () => Date.now(),
  wait: async() => new Promise(resolve => setTimeout(resolve, 50))
})

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

const assertBlankCorePerformanceBootstrap = async(page: Page): Promise<void> => {
  const state = await page.evaluate(async() => {
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
        currentFile?: {
          id?: unknown
          filename?: unknown
          pathname?: unknown
          markdown?: unknown
        }
      }
      | undefined
    const currentFile = store?.currentFile
    const authority = window.__marktextDocumentCore
    if (
      typeof currentFile?.id !== 'string' ||
      typeof currentFile.filename !== 'string' ||
      typeof currentFile.pathname !== 'string' ||
      typeof currentFile.markdown !== 'string' ||
      typeof authority?.documentId !== 'string' ||
      authority.authoritySource === undefined
    ) throw new Error('Installed Core blank bootstrap authority is unavailable')
    return Object.freeze({
      currentFile: Object.freeze({
        id: currentFile.id,
        filename: currentFile.filename,
        pathname: currentFile.pathname,
        markdown: currentFile.markdown
      }),
      authority: Object.freeze({
        documentId: authority.documentId,
        source: await authority.authoritySource()
      })
    })
  })
  assertBlankCoreAuthorityPerformanceBootstrap(state)
}

const openSample = async(
  app: ElectronApplication,
  page: Page,
  filePath: string
): Promise<Readonly<{
  readonly documentId: string
  readonly requestedAt: number
  readonly open: number
}>> => {
  const requestedAt = performance.now()
  await app.evaluate(({ BrowserWindow, ipcMain }, target) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window === undefined) throw new Error('Editor window is unavailable')
    ipcMain.emit('app-open-file-by-id', window.id, target)
  }, filePath)
  await expect.poll(() => activeDocumentId(page), { timeout: 60_000 }).not.toBeNull()
  const documentId = await activeDocumentId(page)
  if (documentId === null) throw new Error('Installed performance document did not open')
  return Object.freeze({
    documentId,
    requestedAt,
    open: performance.now() - requestedAt
  })
}

const measureSample = async(
  app: ElectronApplication,
  page: Page,
  capturePage: PerformanceHiddenPageCapture,
  opened: Readonly<{
    readonly documentId: string
    readonly requestedAt: number
    readonly open: number
  }>
): Promise<Readonly<{
  readonly surface: CoreAuthorityPerformanceSurface
  readonly report: ReturnType<typeof reportCoreAuthorityPerformance>
}>> => {
  const { documentId } = opened
  await page.waitForFunction(expected =>
    window.__marktextDocumentCore?.documentId === expected &&
    window.__marktextDocumentCore.performanceSurface?.() !== undefined,
  documentId,
  { timeout: 60_000 })
  const wysiwygEditable = page.locator(
    'span.mu-paragraph-content[contenteditable="true"]'
  ).first()
  const initialSurface = await page.evaluate(() =>
    window.__marktextDocumentCore?.performanceSurface?.())
  const surface = chooseCoreAuthorityPerformanceSurface({
    sourceActive: initialSurface === 'source' || initialSurface === 'source-required',
    wysiwygEditable: initialSurface === 'wysiwyg'
  })
  if (surface === 'source') await enterSourceMode(page, app)

  await page.waitForFunction(({ expected, expectedSurface }) => {
    const events = window.__marktextDocumentCore?.performanceEvents?.() ?? []
    return events.some(event =>
      event.documentId === expected && event.phase === 'first-editable-viewport' &&
      event.surface === expectedSurface
    )
  }, { expected: documentId, expectedSurface: surface }, { timeout: 60_000 })
  if (surface === 'source') {
    await page.waitForSelector('.source-code .CodeMirror', {
      state: 'attached',
      timeout: 60_000
    })
    await page.waitForFunction(() => {
      const host = document.querySelector('.source-code .CodeMirror') as
        | (Element & { CodeMirror?: { focus(): void; hasFocus(): boolean } })
        | null
      const codeMirror = host?.CodeMirror
      if (codeMirror === undefined) return false
      codeMirror.focus()
      return codeMirror.hasFocus()
    }, undefined, { timeout: 60_000 })
  } else {
    await expect(wysiwygEditable).toBeEditable({ timeout: 60_000 })
  }
  const firstViewport = performance.now() - opened.requestedAt

  if (surface === 'wysiwyg') {
    await wysiwygEditable.click()
    await page.keyboard.press('End')
    await startInputLatencyTrace(page, { maxSamples: 1 })
    await page.keyboard.type('x', { delay: 0 })
    await waitForInputLatencyEcho(page, 1, 30_000)
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
            hasFocus(): boolean
            getValue(): string
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
      if (!codeMirror.hasFocus()) {
        throw new Error('Core Source performance surface did not receive focus')
      }
    })
    await page.keyboard.insertText('x')
    await waitForBrowserInputEventEcho(page, 1, 30_000)
  }
  try {
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
  } catch (error) {
    const diagnostic = await page.evaluate(expected => {
      const codeMirrorHost = document.querySelector('.source-code .CodeMirror') as
        | (Element & { CodeMirror?: { getValue(): string } })
        | null
      return Object.freeze({
        documentId: window.__marktextDocumentCore?.documentId,
        expected,
        state: window.__marktextDocumentCore?.latest(),
        events: window.__marktextDocumentCore?.performanceEvents?.() ?? [],
        activeElement: document.activeElement?.outerHTML.slice(0, 500),
        codeMirrorValue: codeMirrorHost?.CodeMirror?.getValue()
      })
    }, documentId)
    throw new Error(
      `Core authority transaction timeout: ${JSON.stringify(diagnostic)}`,
      { cause: error }
    )
  }
  await page.evaluate(() => window.__marktextDocumentCore?.settled())
  const input = surface === 'wysiwyg'
    ? await captureInputLatencyPresentation(page, capturePage, 0, 30_000)
    : await captureBrowserInputEventPresentation(page, capturePage, 0, 30_000)
  const authorityEvents = await page.evaluate(expected =>
    (window.__marktextDocumentCore?.performanceEvents?.() ?? [])
      .filter(event => event.documentId === expected), documentId)
  const browserInput = Object.freeze({
    sequence: input.sequence,
    tEvent: input.tEvent,
    tEcho: input.tEcho,
    tPresent: input.tPresent
  })
  return Object.freeze({
    surface,
    report: reportCoreAuthorityPerformance({
      surface,
      externalOpen: { open: opened.open, firstViewport },
      inputEvents: [browserInput],
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
  test.skip(
    process.env.MARKTEXT_PERFORMANCE_OUTPUT === undefined,
    'Dedicated packaged performance launch only'
  )

  test('writes five fresh-observation authenticated production-bundle distributions', async() => {
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
    const evidenceClass = requiredValue('MARKTEXT_CORE_EVIDENCE_CLASS') as
      CorePerformanceEvidenceClass
    if (
      evidenceClass !== 'ratification' &&
      evidenceClass !== 'smoke-non-ratifying'
    ) throw new Error('MARKTEXT_CORE_EVIDENCE_CLASS is invalid')
    const sampling = evidenceClass === 'ratification'
      ? {
        warmupSamples: targets.sampling.warmupSamples,
        measuredSamples: targets.sampling.measuredSamples
      }
      : {
        warmupSamples: Number(requiredValue('MARKTEXT_CORE_WARMUP_SAMPLES')),
        measuredSamples: Number(requiredValue('MARKTEXT_CORE_MEASURED_SAMPLES'))
      }
    if (
      !Number.isSafeInteger(sampling.warmupSamples) || sampling.warmupSamples < 1 ||
      !Number.isSafeInteger(sampling.measuredSamples) || sampling.measuredSamples < 1
    ) throw new Error('Core smoke sample counts must be positive integers')
    expect(representatives.documents).toHaveLength(5)
    const totalSamples = representatives.documents.length *
      (sampling.warmupSamples + sampling.measuredSamples)
    test.setTimeout(coreAuthorityPerformanceOrchestrationTimeoutMs(totalSamples))
    expect(targets.sampling).toEqual({
      warmupSamples: 20,
      measuredSamples: 200,
      percentiles: [50, 95, 99],
      sampleLifecycle: PERFORMANCE_SAMPLE_LIFECYCLE,
      observationSchedule: PERFORMANCE_OBSERVATION_SCHEDULE,
      scenarios: expect.any(String)
    })
    expect(machineEnvironment()).toEqual(targets.environment)

    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-core-performance-'))
    let completed = 0
    let finalizationCompleted = false
    try {
      const sampleFilesByDocument = new Map<string, readonly string[]>()
      for (const document of representatives.documents) {
        const count = sampling.warmupSamples + sampling.measuredSamples
        sampleFilesByDocument.set(
          document.id,
          sampleFilesFor(runRoot, document, count)
        )
      }
      const observationOrder = createPerformanceObservationSchedule({
        documentIds: representatives.documents.map(document => document.id),
        ...sampling
      })
      const observations: CorePerformanceObservation[] = observationOrder.map(
        entry => {
          const sampleIndex = entry.phase === 'warmup'
            ? entry.phaseRound - 1
            : sampling.warmupSamples + entry.phaseRound - 1
          const filePath = sampleFilesByDocument.get(entry.documentId)?.[sampleIndex]
          if (filePath === undefined) {
            throw new Error('Core performance sample file is missing')
          }
          return Object.freeze({ ...entry, filePath })
        }
      )

      const observationRun = await runIsolatedPerformanceObservations(
        observations,
        {
          createIsolation: async(declaration, index) => {
            const profile = path.join(
              runRoot,
              `profile-${String(index + 1).padStart(4, '0')}-${declaration.documentId}`
            )
            await fs.promises.mkdir(profile)
            return Object.freeze({ profile })
          },
          launchAndPrepare: async(_declaration, isolation) => {
            const launchEnvironment = { ...process.env }
            delete launchEnvironment.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
            let app: ElectronApplication | undefined
            let targetId: string | undefined
            let applicationProcessId: number | undefined
            try {
              app = await electron.launch({
                executablePath: binary,
                args: [...withPerformanceChromiumScheduling([
                  '--user-data-dir',
                  isolation.profile
                ])],
                env: {
                  ...launchEnvironment,
                  PERF_TESTING: 'true',
                  MARKTEXT_DOCUMENT_CORE_MODE: '1',
                  MARKTEXT_E2E_HIDDEN_WINDOW: '1',
                  MARKTEXT_ERROR_INTERACTION: '1'
                },
                timeout: 60_000
              })
              applicationProcessId = app.process().pid
              if (applicationProcessId === undefined) {
                throw new Error('Installed performance process ID is unavailable')
              }
              const page = await firstWindowWithPerformanceScheduling(app)
              targetId = await resolveExactElectronPageTargetId(page)
              await activateInstalledPerformanceWindow(app, targetId)
              await page.waitForLoadState('domcontentloaded')
              await waitForEditor(page, 60_000)
              await waitForMenuReady(app, 60_000)
              await expectInstalledArtifactCommit(page)
              const initialWindowState = await inspectInstalledPerformanceWindow(
                app,
                targetId
              )
              expectEditorNotFrontmost(app)
              assertMacWindowServerPresentation(
                applicationProcessId,
                initialWindowState
              )
              expect(await page.evaluate(() =>
                window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
              )).toBeUndefined()
              await assertBlankCorePerformanceBootstrap(page)
              await closeActiveTab(page)
              const preparedApp = app
              const preparedTargetId = targetId
              const capturePage = () => captureInstalledElectronHiddenPage(
                preparedApp,
                preparedTargetId
              )
              return Object.freeze({
                app: preparedApp,
                page,
                targetId: preparedTargetId,
                applicationProcessId,
                capturePage
              }) satisfies PreparedCorePerformanceApplication
            } catch (error) {
              const failures: unknown[] = [error]
              if (app !== undefined) {
                try {
                  if (applicationProcessId === undefined) {
                    await app.close()
                  } else {
                    await closeCorePerformanceApplication(
                      app,
                      applicationProcessId,
                      targetId
                    )
                  }
                } catch (cleanupError) {
                  failures.push(cleanupError)
                }
              }
              throwLifecycleFailures(
                'Core performance launch preparation and cleanup both failed',
                failures
              )
              throw error
            }
          },
          measure: async(application, declaration) => {
            await inspectInstalledPerformanceWindow(
              application.app,
              application.targetId
            )
            expectEditorNotFrontmost(application.app)
            const opened = await openSample(
              application.app,
              application.page,
              declaration.filePath
            )
            const measurement = await measureSample(
              application.app,
              application.page,
              application.capturePage,
              opened
            )
            const finalWindowState = await inspectInstalledPerformanceWindow(
              application.app,
              application.targetId
            )
            expectEditorNotFrontmost(application.app)
            assertMacWindowServerPresentation(
              application.applicationProcessId,
              finalWindowState
            )
            return Object.freeze({
              ordinal: declaration.ordinal,
              documentId: declaration.documentId,
              phase: declaration.phase,
              phaseRound: declaration.phaseRound,
              roundPosition: declaration.roundPosition,
              surface: measurement.surface,
              report: measurement.report
            }) satisfies CoreAuthorityPerformanceRawSample
          },
          close: async application => closeCorePerformanceApplication(
            application.app,
            application.applicationProcessId,
            application.targetId
          ),
          cleanup: async(declaration, isolation) => {
            await removeCoreAuthorityPerformanceObservationProfile(
              runRoot,
              isolation.profile
            )
            completed += 1
            process.stdout.write(
              `[${String(completed)}/${String(totalSamples)}] ` +
              `${declaration.documentId} ${declaration.phase} ` +
              `round-${String(declaration.phaseRound)} ` +
              `position-${String(declaration.roundPosition)} ` +
              'fresh-profile-complete\n'
            )
          }
        }
      )
      if (observationRun.measurements.length !== totalSamples) {
        throw new Error('Core performance observation count is incomplete')
      }

      const run = createCoreAuthorityPerformanceRawRun({
        evidenceClass,
        runId: process.env.MARKTEXT_PERFORMANCE_RUN_ID ??
          `core-candidate-${buildCommit.slice(0, 12)}`,
        baselineCommit: measurements.baselineCommit,
        buildCommit,
        measuredAt: new Date().toISOString(),
        environment: targets.environment,
        sampling,
        provenance: {
          checkoutHead: requiredValue('MARKTEXT_CORE_CHECKOUT_HEAD'),
          checkoutClean: requiredValue('MARKTEXT_CORE_CHECKOUT_CLEAN') === 'true',
          harnessCommit: requiredValue('MARKTEXT_CORE_HARNESS_COMMIT'),
          packageArtifactSha256: requiredValue(
            'MARKTEXT_CORE_PACKAGE_SHA256'
          ),
          executableSha256: requiredValue('MARKTEXT_CORE_EXECUTABLE_SHA256'),
          packageVersion: requiredValue('MARKTEXT_CORE_PACKAGE_VERSION'),
          packageManager: requiredValue('MARKTEXT_CORE_PACKAGE_MANAGER'),
          nodeVersion: requiredValue('MARKTEXT_CORE_NODE_VERSION'),
          playwrightVersion: requiredValue('MARKTEXT_CORE_PLAYWRIGHT_VERSION'),
          lockfileSha256: requiredValue('MARKTEXT_CORE_LOCKFILE_SHA256'),
          producerSha256: requiredValue('MARKTEXT_CORE_PRODUCER_SHA256'),
          probeSha256: requiredValue('MARKTEXT_CORE_PROBE_SHA256'),
          launcherSha256: requiredValue('MARKTEXT_CORE_LAUNCHER_SHA256'),
          measurementBoundary: 'core-authority-browser-compositor-v6',
          presentationBoundary: PERFORMANCE_PRESENTATION_BOUNDARY,
          launchBoundary: 'playwright-electron-packaged-transparent-v3',
          windowPresentationPolicy: PERFORMANCE_WINDOW_PRESENTATION_POLICY,
          windowPresentationPlatform: 'darwin',
          chromiumSchedulingPolicy: PERFORMANCE_CHROMIUM_SCHEDULING_POLICY,
          sampleLifecycle: PERFORMANCE_SAMPLE_LIFECYCLE,
          observationSchedule: PERFORMANCE_OBSERVATION_SCHEDULE,
          observationScheduleSha256: performanceObservationScheduleSha256(
            observationOrder
          ),
          ...observationRun.counts
        },
        documents: representatives.documents.map(document => ({
          id: document.id,
          sourceSha256: document.sha256
        })),
        samples: observationRun.measurements
      })
      expect(completed).toBe(totalSamples)
      await finalizeCoreAuthorityPerformanceRawOutput({
        runRoot,
        outputPath,
        contents: `${JSON.stringify(run, null, 2)}\n`
      })
      finalizationCompleted = true
    } finally {
      if (!finalizationCompleted) {
        await removeCoreAuthorityPerformanceRunRoot(runRoot)
      }
    }
  })
})
