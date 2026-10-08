import { createHash } from 'node:crypto'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { chromium, expect, test } from '@playwright/test'
import type { Browser, Page } from 'playwright'

import {
  createUpstreamBaselinePerformanceRawRun,
  writeUpstreamBaselinePerformanceRawRun,
  type UpstreamBaselineEvidenceClass,
  type UpstreamBaselinePerformanceRawSample
} from './helpers/upstreamBaselinePerformanceRawRun'
import {
  readUpstreamBaselineInputProbe,
  startUpstreamBaselineInputProbe,
  waitForUpstreamBaselineInputProbe
} from './helpers/upstreamBaselineInputProbe'
import { readUpstreamBaselineMachineEnvironment } from './helpers/upstreamBaselineEnvironment'
import {
  activateUpstreamPerformanceWindow,
  captureUpstreamElectronHiddenPage,
  closeUpstreamPerformanceWindow,
  inspectUpstreamPerformanceWindow,
  installUpstreamExternalHiddenPolicy,
  type UpstreamInspectorChannel,
  type UpstreamInspectorResponse,
  showMarkTextReviewSidebar
} from './helpers/upstreamBaselineHiddenPolicy'
import {
  closeFailedUpstreamPerformanceLaunch,
  closeUpstreamPerformanceApplication,
  createUpstreamPerformanceBlankBootstrapFile,
  createUpstreamPerformanceObservationIsolation,
  findUpstreamPerformanceProcessId,
  finalizeUpstreamPerformanceRun,
  removeUpstreamPerformanceObservationIsolation,
  removeUpstreamPerformanceRunRoot,
  resolveUpstreamPerformanceProcessIdentity,
  upstreamPerformanceOrchestrationTimeoutMs,
  type UpstreamPerformanceProcessIdentity,
  forceKillOwnedProcess
} from './helpers/upstreamBaselineLifecycleCleanup'
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
  awaitMacWindowServerPresentationConvergence,
  assertMacWindowServerPresentationSettled,
  PERFORMANCE_CHROMIUM_SCHEDULING_POLICY,
  PERFORMANCE_DISPLAY_SLEEP_POLICY,
  PERFORMANCE_WINDOW_PRESENTATION_POLICY,
  withPerformanceChromiumScheduling
} from './helpers/performanceChromiumLaunchPolicy'
import {
  PERFORMANCE_PRESENTATION_BOUNDARY,
  resolveExactElectronPageTargetId,
  type PerformanceHiddenPageCapture
} from './helpers/performancePresentationCheckpoint'
import { placeCaretInEditor } from './helpers'
import { frontmostApplicationProcessId } from './frontmostApplication'
import {
  readInputLatencyTrace,
  startInputLatencyTrace,
  waitForInputLatencyEcho
} from './helpers/inputLatencyTrace'
import {
  FENCE_2000_ARM_SOURCE,
  ORDINARY_MARKDOWN_WORKLOADS,
  placeCaretAfterWarmEditingText,
  WARM_EDITING_PARAGRAPH
} from './helpers/ordinaryMarkdownWorkloads'
import {
  captureEditorDom,
  probeForcedLayout,
  startWarmRendererRecording
} from './helpers/warmSessionDiagnostics'
import {
  describePerformanceCalibration,
  loadPerformanceCalibration,
  probePerformanceCalibration,
  readPerformanceCalibration,
  startPerformanceCalibration
} from './helpers/performanceCalibration'
import { performanceRunCalibrationReference } from '../../../../scripts/criticmarkupPerformanceTargets'

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const PINNED_BASELINE = 'e52106fd1cdcbd33c1258b7b0cdc7013c4c5d86c'
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
  readonly dependentAssets?: readonly Readonly<{ readonly path: string }> []
}

interface RepresentativeDocumentManifest {
  readonly documents: readonly RepresentativeDocument[]
}

interface PerformanceTargetManifest {
  readonly environment: Readonly<Record<string, string>>
  readonly sampling: Readonly<{
    readonly warmupSamples: number
    readonly measuredSamples: number
    readonly displaySleepPolicy: typeof PERFORMANCE_DISPLAY_SLEEP_POLICY
  }>
}

interface PerformanceMeasurementManifest {
  readonly baselineCommit: string
}

interface ExternalOpenTimings {
  readonly documentId: string
  readonly open: number
  readonly first_viewport: number
}

interface UpstreamPerformanceObservation
  extends PerformanceObservationScheduleEntry {
  readonly filePath: string
}

interface RenderActiveUpstreamApplication {
  readonly browser: Browser
  readonly page: Page
  readonly processId: number
  readonly launcher: ChildProcess
  readonly inspector: UpstreamInspectorChannel & { readonly close: () => void }
  readonly targetId: string
}

const readJson = <Value>(filePath: string): Value =>
  JSON.parse(fs.readFileSync(filePath, 'utf8')) as Value

const sha256 = (source: Buffer | string): string => createHash('sha256')
  .update(source)
  .digest('hex')

const requiredValue = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`)
  }
  return value
}

const requiredPath = (name: string): string => {
  const value = path.resolve(requiredValue(name))
  if (!fs.existsSync(value)) throw new Error(`${name} does not exist: ${value}`)
  return value
}

const positiveCount = (name: string): number => {
  const value = Number(requiredValue(name))
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

const evidenceClass = (): UpstreamBaselineEvidenceClass => {
  const value = requiredValue('MARKTEXT_UPSTREAM_EVIDENCE_CLASS')
  if (value !== 'ratification' && value !== 'smoke-non-ratifying') {
    throw new Error('MARKTEXT_UPSTREAM_EVIDENCE_CLASS is invalid')
  }
  return value
}

const activeDocumentId = (page: Page): Promise<string | null> =>
  page.evaluate(() => document
    .querySelector('.tabs-container > li.active')
    ?.getAttribute('data-id') ?? null)

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
  if (!closed) throw new Error('Upstream runner cannot close its sample tab')
  await expect.poll(() => activeDocumentId(page)).toBeNull()
}

const reserveTcpPort = async(): Promise<number> => new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (address === null || typeof address === 'string') {
      server.close()
      reject(new Error('Cannot reserve a loopback debugging port'))
      return
    }
    server.close(error => {
      if (error) reject(error)
      else resolve(address.port)
    })
  })
})

const upstreamProcessTable = (): string => execFileSync(
  '/bin/ps',
  ['-ax', '-o', 'pid=', '-o', 'command='],
  {
    encoding: 'utf8'
  }
)

const processGroupOf = (processId: number): number | undefined => {
  try {
    const group = Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(processId)], { encoding: 'utf8' }).trim())
    return Number.isSafeInteger(group) && group > 0 ? group : undefined
  } catch {
    return undefined
  }
}

const forceKill = (processId: number): void => {
  forceKillOwnedProcess(processId, processGroupOf, (target, signal) => process.kill(target, signal))
}

const processIdForIdentity = (
  identity: Readonly<UpstreamPerformanceProcessIdentity>
): number => {
  const processId = findUpstreamPerformanceProcessId(
    upstreamProcessTable(),
    identity
  )
  if (processId === undefined) throw new Error('Upstream process ID is missing')
  return processId
}

const waitForCdpEndpoint = async(
  endpoint: string,
  launcher: ChildProcess
): Promise<void> => {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null) {
      throw new Error(`Hidden upstream launch exited with ${String(launcher.exitCode)}`)
    }
    try {
      const response = await fetch(`${endpoint}/json/version`)
      if (response.ok) return
    } catch {
      // The exact packaged renderer has not exposed its debugging socket yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Hidden upstream launch did not expose its debugging endpoint')
}

interface InspectorTarget {
  readonly webSocketDebuggerUrl?: string
}

const waitForInspectorTarget = async(
  endpoint: string,
  launcher: ChildProcess
): Promise<string> => {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null) {
      throw new Error(`Hidden upstream launch exited with ${String(launcher.exitCode)}`)
    }
    try {
      const response = await fetch(`${endpoint}/json/list`)
      const targets = await response.json() as InspectorTarget[]
      const socket = targets[0]?.webSocketDebuggerUrl
      if (response.ok && socket !== undefined) return socket
    } catch {
      // The packaged main process has not reached its inspector break yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Hidden upstream launch did not expose its main-process inspector')
}

const installExternalHiddenPolicy = async(
  endpoint: string,
  launcher: ChildProcess
): Promise<UpstreamInspectorChannel & { readonly close: () => void }> => {
  const socketUrl = await waitForInspectorTarget(endpoint, launcher)
  const socket = new WebSocket(socketUrl)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => {
      reject(new Error('Cannot connect to the upstream main-process inspector'))
    }, { once: true })
  })
  let nextId = 0
  const send = async(
    method: string,
    params: Readonly<Record<string, unknown>> = {}
  ) => {
    const id = ++nextId
    const response = new Promise<UpstreamInspectorResponse>((resolve, reject) => {
      const handleMessage = (event: MessageEvent): void => {
        if (typeof event.data !== 'string') return
        const candidate = JSON.parse(event.data) as UpstreamInspectorResponse
        if (candidate.id !== id) return
        socket.removeEventListener('message', handleMessage)
        if (candidate.error !== undefined) {
          reject(new Error(candidate.error.message ?? `Inspector ${method} failed`))
        } else {
          resolve(candidate)
        }
      }
      socket.addEventListener('message', handleMessage)
    })
    socket.send(JSON.stringify({ id, method, params }))
    return response
  }
  const waitForPaused = async(): Promise<Readonly<{
    readonly callFrames: readonly Readonly<{ readonly callFrameId: string }>[]
  }>> => new Promise(resolve => {
    const handleMessage = (event: MessageEvent): void => {
      if (typeof event.data !== 'string') return
      const candidate = JSON.parse(event.data) as Readonly<{
        readonly method?: string
        readonly params?: {
          readonly callFrames?: readonly Readonly<{
            readonly callFrameId: string
          }>[]
        }
      }>
      if (candidate.method !== 'Debugger.paused') return
      socket.removeEventListener('message', handleMessage)
      resolve(Object.freeze({
        callFrames: Object.freeze(candidate.params?.callFrames ?? [])
      }))
    }
    socket.addEventListener('message', handleMessage)
  })
  const channel = Object.freeze({
    send,
    waitForPaused,
    close: () => socket.close()
  })
  try {
    await installUpstreamExternalHiddenPolicy(channel)
    return channel
  } catch (error) {
    socket.close()
    throw error
  }
}

// Upstream MarkText has no document core, so its editor is ready once Muya has
// rendered into the editor component (the shared waitForEditor waits for Core).
const waitForUpstreamEditor = async(page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    const editor = document.querySelector('.editor-component')
    return editor !== null && editor.children.length > 0
  }, null, { timeout: 60_000 })
}

const launchRenderActiveUpstreamApplication = async(
  appBundle: string,
  profile: string,
  bootstrapFile: string
): Promise<RenderActiveUpstreamApplication> => {
  const processIdentity = resolveUpstreamPerformanceProcessIdentity(
    appBundle,
    profile
  )
  const browserPort = await reserveTcpPort()
  const inspectorPort = await reserveTcpPort()
  const launcher = spawn('/usr/bin/open', [
    '-n',
    '-j',
    '-g',
    '-W',
    appBundle,
    '--args',
    ...withPerformanceChromiumScheduling([
      `--inspect-brk=${String(inspectorPort)}`,
      `--remote-debugging-port=${String(browserPort)}`,
      '--remote-allow-origins=*',
      '--user-data-dir',
      profile,
      bootstrapFile
    ])
  ], {
    env: {
      ...process.env,
      PERF_TESTING: 'true',
      MARKTEXT_ERROR_INTERACTION: '1'
    },
    stdio: 'ignore'
  })
  const browserEndpoint = `http://127.0.0.1:${String(browserPort)}`
  const inspectorEndpoint = `http://127.0.0.1:${String(inspectorPort)}`
  let inspector: (UpstreamInspectorChannel & { readonly close: () => void }) |
    undefined
  let browser: Browser | undefined
  let processId: number | undefined
  try {
    inspector = await installExternalHiddenPolicy(inspectorEndpoint, launcher)
    await waitForCdpEndpoint(browserEndpoint, launcher)
    browser = await chromium.connectOverCDP(browserEndpoint)
    const context = browser.contexts()[0]
    if (context === undefined) throw new Error('Upstream CDP context is missing')
    await expect.poll(() => context.pages().length, { timeout: 60_000 })
      .toBeGreaterThan(0)
    const page = context.pages()[0]
    if (page === undefined) throw new Error('Upstream renderer page is missing')
    const targetId = await resolveExactElectronPageTargetId(page)
    processId = processIdForIdentity(processIdentity)
    await activateUpstreamPerformanceWindow(inspector, targetId)
    await page.waitForLoadState('domcontentloaded')
    await waitForUpstreamEditor(page)
    return Object.freeze({
      browser,
      page,
      processId,
      launcher,
      inspector,
      targetId
    })
  } catch (error) {
    inspector?.close()
    try {
      await closeFailedUpstreamPerformanceLaunch({
        closeBrowser: async() => {
          if (browser !== undefined) await browser.close()
        },
        launcher,
        processTable: upstreamProcessTable(),
        identity: processIdentity
      }, {
        terminate: ownedProcessId => {
          try {
            process.kill(ownedProcessId, 'SIGTERM')
          } catch (terminationError) {
            if (!(
              terminationError instanceof Error &&
              'code' in terminationError && terminationError.code === 'ESRCH'
            )) throw terminationError
          }
        },
        forceKill,
        isRunning: ownedProcessId => {
          try {
            process.kill(ownedProcessId, 0)
            return true
          } catch (runningError) {
            if (
              runningError instanceof Error && 'code' in runningError &&
              runningError.code === 'ESRCH'
            ) return false
            throw runningError
          }
        },
        sleep: () => new Promise(resolve => setTimeout(resolve, 50)),
        now: Date.now
      })
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Upstream performance launch and cleanup both failed'
      )
    }
    throw error
  }
}

const expectRenderActiveInactive = async(
  application: RenderActiveUpstreamApplication,
  includeWindowServerEvidence = false
): Promise<void> => {
  const state = await inspectUpstreamPerformanceWindow(
    application.inspector,
    application.targetId
  )
  expect(frontmostApplicationProcessId()).not.toBe(application.processId)
  if (includeWindowServerEvidence) {
    let reads = 0
    await assertMacWindowServerPresentationSettled(application.processId, async() =>
      reads++ === 0
        ? state
        : inspectUpstreamPerformanceWindow(application.inspector, application.targetId))
  }
}

const awaitRenderActiveInactiveConvergence = async(
  application: RenderActiveUpstreamApplication
): Promise<void> => {
  expect(frontmostApplicationProcessId()).not.toBe(application.processId)
  await awaitMacWindowServerPresentationConvergence({
    processId: application.processId,
    inspectElectron: () => inspectUpstreamPerformanceWindow(
      application.inspector,
      application.targetId
    )
  })
  expect(frontmostApplicationProcessId()).not.toBe(application.processId)
}

const closeRenderActiveUpstreamApplication = async(
  application: RenderActiveUpstreamApplication
): Promise<void> => {
  const isRunning = (processId: number): boolean => {
    try {
      process.kill(processId, 0)
      return true
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
        return false
      }
      throw error
    }
  }
  let lifecycleFailure: unknown
  try {
    await closeUpstreamPerformanceWindow(
      application.inspector,
      application.targetId
    )
  } catch (error) {
    lifecycleFailure = error
  } finally {
    application.inspector.close()
    await closeUpstreamPerformanceApplication({
      closeBrowser: () => application.browser.close(),
      processId: application.processId,
      launcher: application.launcher
    }, {
      terminate: processId => {
        try {
          process.kill(processId, 'SIGTERM')
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
            throw error
          }
        }
      },
      forceKill,
      isRunning,
      sleep: () => new Promise(resolve => setTimeout(resolve, 50)),
      now: Date.now
    })
  }
  if (lifecycleFailure !== undefined) throw lifecycleFailure
}

const waitForEditableViewport = async(
  page: Page,
  documentId: string
): Promise<void> => {
  await page.waitForFunction(expected => {
    const active = document.querySelector('.tabs-container > li.active')
      ?.getAttribute('data-id')
    const editor = document.querySelector('.editor-component')
    const editable = editor?.querySelector(
      'span.mu-paragraph-content[contenteditable="true"]'
    )
    return active === expected && editor !== null && editable !== null
  }, documentId, { timeout: 60_000 })
}

const openSample = async(
  page: Page,
  filePath: string
): Promise<ExternalOpenTimings> => {
  const startedAt = performance.now()
  await page.evaluate(target => {
    window.electron.ipcRenderer.send('mt::open-file', target, {})
  }, filePath)
  await expect.poll(
    () => activeDocumentId(page),
    { timeout: 60_000 }
  ).not.toBeNull()
  const documentId = await activeDocumentId(page)
  if (documentId === null) throw new Error('Upstream sample did not become active')
  const open = performance.now() - startedAt
  await waitForEditableViewport(page, documentId)
  const firstViewport = performance.now() - startedAt
  return Object.freeze({
    documentId,
    open,
    first_viewport: firstViewport
  })
}

const measureInput = async(
  page: Page,
  capturePage: PerformanceHiddenPageCapture
): Promise<Readonly<{
  readonly t_echo: number
  readonly t_present: number
}>> => {
  await placeCaretInEditor(page)
  await startUpstreamBaselineInputProbe(page)
  await page.keyboard.type('x', { delay: 0 })
  await waitForUpstreamBaselineInputProbe(page)
  return readUpstreamBaselineInputProbe(page, capturePage)
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
    const samplePath = path.join(
      directory,
      `${document.id}-upstream-${String(index + 1).padStart(3, '0')}.md`
    )
    fs.writeFileSync(samplePath, source)
    return samplePath
  }))
}

test.describe('pinned upstream baseline raw performance producer', () => {
  test.skip(
    process.env.MARKTEXT_UPSTREAM_OUTPUT === undefined,
    'Dedicated packaged upstream performance launch only'
  )

  test('records five unpooled external browser-boundary distributions', async() => {
    if (process.platform !== 'darwin') {
      throw new Error('Pinned upstream performance evidence requires macOS')
    }
    const outputPath = path.resolve(requiredValue('MARKTEXT_UPSTREAM_OUTPUT'))
    const appBundle = requiredPath('MARKTEXT_UPSTREAM_PACKAGED_APP')
    const representatives = readJson<RepresentativeDocumentManifest>(
      REPRESENTATIVE_DOCUMENTS
    )
    const targets = readJson<PerformanceTargetManifest>(PERFORMANCE_TARGETS)
    const measurements = readJson<PerformanceMeasurementManifest>(
      PERFORMANCE_MEASUREMENTS
    )
    const classification = evidenceClass()
    const sampling = Object.freeze({
      warmupSamples: positiveCount('MARKTEXT_UPSTREAM_WARMUP_SAMPLES'),
      measuredSamples: positiveCount('MARKTEXT_UPSTREAM_MEASURED_SAMPLES')
    })
    const environment = readUpstreamBaselineMachineEnvironment()
    expect(requiredValue('MARKTEXT_PERFORMANCE_DISPLAY_SLEEP_POLICY'))
      .toBe(PERFORMANCE_DISPLAY_SLEEP_POLICY)
    expect(targets.sampling.displaySleepPolicy)
      .toBe(PERFORMANCE_DISPLAY_SLEEP_POLICY)
    expect(representatives.documents).toHaveLength(5)
    expect(measurements.baselineCommit).toBe(PINNED_BASELINE)
    if (classification === 'ratification') {
      expect(sampling).toEqual({ warmupSamples: 20, measuredSamples: 200 })
      expect(environment.pinned).toEqual(targets.environment)
    }

    const totalSamples = representatives.documents.length *
      (sampling.warmupSamples + sampling.measuredSamples)
    const calibrationReference = performanceRunCalibrationReference(
      loadPerformanceCalibration()
    )
    test.setTimeout(upstreamPerformanceOrchestrationTimeoutMs(totalSamples))
    const samples: UpstreamBaselinePerformanceRawSample[] = []
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-upstream-performance-'))
    let completed = 0
    let finalizationStarted = false
    try {
      const bootstrapFile = await createUpstreamPerformanceBlankBootstrapFile(
        runRoot
      )
      const observationOrder = createPerformanceObservationSchedule({
        documentIds: representatives.documents.map(document => document.id),
        ...sampling
      })
      const sampleFilesByDocument = new Map<string, readonly string[]>()
      for (const document of representatives.documents) {
        sampleFilesByDocument.set(document.id, sampleFilesFor(
          runRoot,
          document,
          sampling.warmupSamples + sampling.measuredSamples
        ))
      }
      const observations: readonly Readonly<UpstreamPerformanceObservation>[] =
        Object.freeze(observationOrder.map(entry => {
          const documentSampleIndex = entry.phase === 'warmup'
            ? entry.phaseRound - 1
            : sampling.warmupSamples + entry.phaseRound - 1
          const filePath = sampleFilesByDocument
            .get(entry.documentId)?.[documentSampleIndex]
          if (filePath === undefined) throw new Error('Sample path is missing')
          return Object.freeze({ ...entry, filePath })
        }))

      const lifecycle = await runIsolatedPerformanceObservations(
        observations,
        {
          createIsolation: async(_observation, index) =>
            createUpstreamPerformanceObservationIsolation(runRoot, index),
          launchAndPrepare: async(_observation, isolation) => {
            const app = await launchRenderActiveUpstreamApplication(
              appBundle,
              isolation.profile,
              bootstrapFile
            )
            try {
              const { page } = app
              await expectRenderActiveInactive(app)
              expect(await page.evaluate(() =>
                (window as Window & { __marktextDocumentCore?: unknown })
                  .__marktextDocumentCore)).toBeUndefined()
              await closeActiveTab(page)
              await awaitRenderActiveInactiveConvergence(app)
              return app
            } catch (error) {
              try {
                await closeRenderActiveUpstreamApplication(app)
              } catch (cleanupError) {
                throw new AggregateError(
                  [error, cleanupError],
                  'Upstream observation preparation and cleanup both failed'
                )
              }
              throw error
            }
          },
          measure: async(app, observation) => {
            const capturePage = () => captureUpstreamElectronHiddenPage(
              app.inspector,
              app.targetId
            )
            const opened = await openSample(app.page, observation.filePath)
            const edit = await measureInput(app.page, capturePage)
            await expectRenderActiveInactive(app, true)
            const calibration = await probePerformanceCalibration(
              app.page,
              calibrationReference
            )
            process.stdout.write(`${describePerformanceCalibration(
              `${observation.documentId} ${observation.phase} round ${String(observation.phaseRound)}`,
              calibration
            )}\n`)
            return Object.freeze({
              ordinal: observation.ordinal,
              documentId: observation.documentId,
              phase: observation.phase,
              phaseRound: observation.phaseRound,
              roundPosition: observation.roundPosition,
              report: Object.freeze({
                ...edit,
                open: opened.open,
                first_viewport: opened.first_viewport
              }),
              calibration: calibration.summary
            })
          },
          close: closeRenderActiveUpstreamApplication,
          cleanup: async(observation, isolation) => {
            await removeUpstreamPerformanceObservationIsolation(
              runRoot,
              isolation
            )
            completed += 1
            process.stdout.write(
              `[${String(completed)}/${String(totalSamples)}] ` +
              `${observation.documentId} ${observation.phase} ` +
              `round ${String(observation.phaseRound)} position ` +
              `${String(observation.roundPosition)} ` +
              'external-browser-compositor-v4\n'
            )
          }
        }
      )
      samples.push(...lifecycle.measurements)

      expect(completed).toBe(totalSamples)
      const run = createUpstreamBaselinePerformanceRawRun({
        evidenceClass: classification,
        runId: requiredValue('MARKTEXT_UPSTREAM_RUN_ID'),
        baselineCommit: measurements.baselineCommit,
        buildCommit: requiredValue('MARKTEXT_UPSTREAM_BUILD_COMMIT'),
        measuredAt: new Date().toISOString(),
        environment: environment.recorded,
        sampling,
        documents: representatives.documents.map(document => ({
          id: document.id,
          sourceSha256: document.sha256
        })),
        provenance: {
          detachedWorktreeHead: requiredValue('MARKTEXT_UPSTREAM_WORKTREE_HEAD'),
          detachedWorktreeClean:
            requiredValue('MARKTEXT_UPSTREAM_WORKTREE_CLEAN') === 'true',
          harnessCommit: requiredValue('MARKTEXT_UPSTREAM_HARNESS_COMMIT'),
          packageArtifactSha256: requiredValue(
            'MARKTEXT_UPSTREAM_PACKAGE_SHA256'
          ),
          executableSha256: requiredValue('MARKTEXT_UPSTREAM_EXECUTABLE_SHA256'),
          packageVersion: requiredValue('MARKTEXT_UPSTREAM_PACKAGE_VERSION'),
          packageManager: requiredValue('MARKTEXT_UPSTREAM_PACKAGE_MANAGER'),
          nodeVersion: requiredValue('MARKTEXT_UPSTREAM_NODE_VERSION'),
          playwrightVersion: requiredValue(
            'MARKTEXT_UPSTREAM_PLAYWRIGHT_VERSION'
          ),
          lockfileSha256: requiredValue('MARKTEXT_UPSTREAM_LOCKFILE_SHA256'),
          producerSha256: requiredValue('MARKTEXT_UPSTREAM_PRODUCER_SHA256'),
          probeSha256: requiredValue('MARKTEXT_UPSTREAM_PROBE_SHA256'),
          launcherSha256: requiredValue('MARKTEXT_UPSTREAM_LAUNCHER_SHA256'),
          measurementBoundary: 'external-browser-compositor-v4',
          presentationBoundary: PERFORMANCE_PRESENTATION_BOUNDARY,
          launchBoundary: 'external-inspector-transparent-render-active-v3',
          windowPresentationPolicy: PERFORMANCE_WINDOW_PRESENTATION_POLICY,
          windowPresentationPlatform: 'darwin',
          chromiumSchedulingPolicy: PERFORMANCE_CHROMIUM_SCHEDULING_POLICY,
          displaySleepPolicy: PERFORMANCE_DISPLAY_SLEEP_POLICY,
          sampleLifecycle: PERFORMANCE_SAMPLE_LIFECYCLE,
          observationSchedule: PERFORMANCE_OBSERVATION_SCHEDULE,
          observationScheduleSha256:
            performanceObservationScheduleSha256(observationOrder),
          ...lifecycle.counts
        },
        calibration: { reference: calibrationReference },
        samples
      })
      finalizationStarted = true
      await finalizeUpstreamPerformanceRun(runRoot, () => {
        writeUpstreamBaselinePerformanceRawRun(outputPath, run)
      })
    } finally {
      if (!finalizationStarted) await removeUpstreamPerformanceRunRoot(runRoot)
    }
  })
})

// Sustained typing in upstream MarkText with the protocol of MarkText's
// warm-session harness (criticmarkup-warm-session-performance.spec.ts with
// MARKTEXT_WARM_ORDINARY=1): one warm app per document, 8 warmup keys, then
// measured keys at a fixed interval at the end of the first paragraph, each
// timed from its beforeinput to the exact DOM echo by the same probe.
//
// Same-producer comparison: this producer runs any packaged MarkText app, so
// MarkText itself can be measured under the identical launch, transparent
// render-active window and probe. Package it unsigned
// (`CSC_IDENTITY_AUTO_DISCOVERY=false pnpm run build:mac:arm64`), then run
// this describe once per app and document, alternating the apps, with
// MARKTEXT_UPSTREAM_WARM_APP set to `dist/mac-arm64/marktext.app` or to the
// upstream build, and a fresh MARKTEXT_UPSTREAM_WARM_OUTPUT directory for
// each run. The producer checks the window server, so keep the display lit
// for the run (`caffeinate -d -u`, stopped afterwards).
//
// Every run times the target manifest's fixed calibration loop after each
// measured key and records its p50 and p90 in `<workload>.json` as
// information. The loop never invalidates or reruns a run: every run is
// scored against the unchanged thresholds (owner decision 2026-10-06).
//
// Opt-in diagnostics, off by default, written beside `<workload>.json`:
// - MARKTEXT_UPSTREAM_WARM_PROFILE=1: `<workload>.cpuprofile`, the renderer's
//   CPU profile over the measured keys.
// - MARKTEXT_UPSTREAM_WARM_TRACE=1: `<workload>.trace.json`, a Chromium
//   timeline trace over the measured keys.
// - MARKTEXT_UPSTREAM_WARM_DOM=1: `<workload>.dom.json`, the editor's DOM
//   before the keys and a forced-layout probe after them.
test.describe('upstream warm-session echo on ordinary Markdown', () => {
  test.skip(
    process.env.MARKTEXT_UPSTREAM_WARM_OUTPUT === undefined,
    'Dedicated packaged upstream warm-session launch only'
  )
  const warmup = 8
  const measured = Number(process.env.MARKTEXT_UPSTREAM_WARM_SAMPLES ?? 40)
  const interval = Number(process.env.MARKTEXT_UPSTREAM_WARM_INTERVAL_MS ?? 80)
  const diagnostics = Object.freeze({
    profile: process.env.MARKTEXT_UPSTREAM_WARM_PROFILE === '1',
    trace: process.env.MARKTEXT_UPSTREAM_WARM_TRACE === '1',
    dom: process.env.MARKTEXT_UPSTREAM_WARM_DOM === '1'
  })
  const reference = performanceRunCalibrationReference(loadPerformanceCalibration())

  /** One warm session of `workload` in a fresh profile: the record its `<workload>.json` holds. */
  const measureUpstreamWarmSession = async(
    workload: typeof ORDINARY_MARKDOWN_WORKLOADS[number],
    appBundle: string,
    outputDirectory: string,
    tracking = false
  ): Promise<Record<string, unknown>> => {
    const artifact = workload.name
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-upstream-performance-'))
    try {
      const bootstrapFile = await createUpstreamPerformanceBlankBootstrapFile(runRoot)
      const isolation = await createUpstreamPerformanceObservationIsolation(runRoot, 0)
      const documentPath = path.join(isolation.root, `${workload.name}.md`)
      fs.writeFileSync(documentPath, workload.source, { flag: 'wx' })
      const loadBefore = os.loadavg()
      const app = await launchRenderActiveUpstreamApplication(appBundle, isolation.profile, bootstrapFile)
      try {
        const { page } = app
        await expectRenderActiveInactive(app)
        await closeActiveTab(page)
        await awaitRenderActiveInactiveConvergence(app)
        const opened = await openSample(page, documentPath)
        if (tracking) {
          // Track Changes lives in MarkText's Review sidebar, which a fresh
          // profile keeps closed: open it from its menu item, as a user would.
          await showMarkTextReviewSidebar(app.inspector, app.targetId)
          const trackChanges = page.getByTestId('critic-review-track-changes')
          await trackChanges.click({ timeout: 30_000 })
          await expect(trackChanges).toHaveAttribute('aria-pressed', 'true')
        }
        // Both harnesses type at the end of the warm editing text.
        const target = await placeCaretAfterWarmEditingText(page)
        const dom = diagnostics.dom ? await captureEditorDom(page) : undefined
        for (let index = 0; index < warmup; index += 1) {
          await page.keyboard.type('x', { delay: 0 })
          await page.waitForTimeout(interval)
        }
        await startInputLatencyTrace(page, { maxSamples: measured })
        await startPerformanceCalibration(page)
        const stopRecording = diagnostics.profile || diagnostics.trace
          ? await startWarmRendererRecording(page, diagnostics)
          : undefined
        for (let index = 0; index < measured; index += 1) {
          await page.keyboard.type('x', { delay: 0 })
          await page.waitForTimeout(interval)
        }
        await waitForInputLatencyEcho(page, measured, 30_000)
        await stopRecording?.(outputDirectory, artifact)
        const input = await readInputLatencyTrace(page)
        const calibration = await readPerformanceCalibration(page, reference)
        expect(await target.textContent()).toContain(WARM_EDITING_PARAGRAPH + 'x'.repeat(warmup + measured))
        if (dom !== undefined) {
          fs.writeFileSync(path.join(outputDirectory, `${artifact}.dom.json`),
            JSON.stringify({ before: dom, forcedLayoutMs: await probeForcedLayout(page) }, null, 2), { flag: 'wx' })
        }
        await expectRenderActiveInactive(app, true)
        const echoes = input.flatMap(sample => sample.tEcho === undefined ? [] : [sample.tEcho - sample.tEvent])
        const sorted = [...echoes].sort((left, right) => left - right)
        const percentile = (value: number): number | null => sorted.length === 0
          ? null
          : sorted[Math.min(sorted.length - 1, Math.ceil(value * sorted.length) - 1)] ?? null
        expect(sorted).toHaveLength(measured)
        console.log(describePerformanceCalibration(workload.name, calibration))
        return {
          workload: workload.name,
          sourceSha256: sha256(workload.source),
          sourceUnits: workload.source.length,
          upstreamBuildCommit: process.env.MARKTEXT_UPSTREAM_BUILD_COMMIT ?? null,
          harnessCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
          measuredAt: new Date().toISOString(),
          loadAverage: { before: loadBefore, after: os.loadavg() },
          protocol: { warmup, measured, intervalMs: interval, boundary: 'beforeinput-to-exact-dom-echo', tracking },
          diagnostics,
          calibration,
          open: opened,
          echoMs: {
            count: sorted.length,
            p50: percentile(0.5),
            p95: percentile(0.95),
            max: sorted.at(-1) ?? null
          },
          frameMs: (() => {
            const frames = input.flatMap(sample => sample.tFrame === undefined ? [] : [sample.tFrame - sample.tEvent])
              .sort((left, right) => left - right)
            const at = (value: number): number | null => frames.length === 0
              ? null
              : frames[Math.min(frames.length - 1, Math.ceil(value * frames.length) - 1)] ?? null
            return { count: frames.length, p50: at(0.5), p95: at(0.95), max: frames.at(-1) ?? null }
          })(),
          samples: input
        }
      } finally {
        await closeRenderActiveUpstreamApplication(app)
      }
    } finally {
      await removeUpstreamPerformanceRunRoot(runRoot)
    }
  }

  for (const workload of ORDINARY_MARKDOWN_WORKLOADS) {
    test(workload.name, async() => {
      if (process.platform !== 'darwin') throw new Error('Upstream warm sessions require macOS')
      test.setTimeout(Math.max(300_000, (warmup + measured) * (interval + 150) + 120_000))
      const outputDirectory = requiredPath('MARKTEXT_UPSTREAM_WARM_OUTPUT')
      const appBundle = requiredPath('MARKTEXT_UPSTREAM_WARM_APP')
      const record = await measureUpstreamWarmSession(workload, appBundle, outputDirectory)
      fs.writeFileSync(path.join(outputDirectory, `${workload.name}.json`),
        JSON.stringify(record, null, 2), { flag: 'wx' })
    })
  }

  // Plan 0012 B4: the 2,000-line fence's proposed arm. MarkText types there
  // with Track Changes on (MARKTEXT_UPSTREAM_WARM_TRACK=1); upstream, which has
  // no tracked mode, reads the same source as ordinary Markdown and types the
  // same keys at the same caret, untracked.
  const armWorkload = { name: 'fence-2000-arm-tracked', source: FENCE_2000_ARM_SOURCE }
  test(armWorkload.name, async() => {
    if (process.platform !== 'darwin') throw new Error('Upstream warm sessions require macOS')
    test.setTimeout(Math.max(300_000, (warmup + measured) * (interval + 150) + 120_000))
    const outputDirectory = requiredPath('MARKTEXT_UPSTREAM_WARM_OUTPUT')
    const appBundle = requiredPath('MARKTEXT_UPSTREAM_WARM_APP')
    const tracking = process.env.MARKTEXT_UPSTREAM_WARM_TRACK === '1'
    const record = await measureUpstreamWarmSession(armWorkload, appBundle, outputDirectory, tracking)
    fs.writeFileSync(path.join(outputDirectory, `${armWorkload.name}.json`),
      JSON.stringify(record, null, 2), { flag: 'wx' })
  })
})
