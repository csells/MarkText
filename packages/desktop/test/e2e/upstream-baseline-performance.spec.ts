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
  type UpstreamInspectorResponse
} from './helpers/upstreamBaselineHiddenPolicy'
import {
  closeFailedUpstreamPerformanceLaunch,
  closeUpstreamPerformanceApplication,
  findUpstreamPerformanceProcessId,
  finalizeUpstreamPerformanceRun,
  removeUpstreamPerformanceRunRoot,
  resolveUpstreamPerformanceProcessIdentity,
  type UpstreamPerformanceProcessIdentity
} from './helpers/upstreamBaselineLifecycleCleanup'
import {
  assertMacWindowServerPresentation,
  PERFORMANCE_CHROMIUM_SCHEDULING_POLICY,
  PERFORMANCE_WINDOW_PRESENTATION_POLICY,
  withPerformanceChromiumScheduling
} from './helpers/performanceChromiumLaunchPolicy'
import {
  PERFORMANCE_PRESENTATION_BOUNDARY,
  resolveExactElectronPageTargetId,
  type PerformanceHiddenPageCapture
} from './helpers/performancePresentationCheckpoint'
import {
  placeCaretInEditor,
  waitForEditor
} from './helpers'
import { frontmostApplicationProcessId } from './frontmostApplication'

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const PINNED_BASELINE = '43bd8b77795fb27b1a9512737c000f7362031ea0'
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
    await waitForEditor(page, 60_000)
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
    assertMacWindowServerPresentation(application.processId, state)
  }
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
  test.describe.configure({ timeout: 60 * 60 * 1000 })
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
    expect(representatives.documents).toHaveLength(5)
    expect(measurements.baselineCommit).toBe(PINNED_BASELINE)
    if (classification === 'ratification') {
      expect(sampling).toEqual({ warmupSamples: 20, measuredSamples: 200 })
      expect(environment).toEqual(targets.environment)
    }

    const totalSamples = representatives.documents.length *
      (sampling.warmupSamples + sampling.measuredSamples)
    const samples: UpstreamBaselinePerformanceRawSample[] = []
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-upstream-performance-'))
    let completed = 0
    let finalizationStarted = false
    try {
      for (const document of representatives.documents) {
        const sampleFiles = sampleFilesFor(
          runRoot,
          document,
          sampling.warmupSamples + sampling.measuredSamples + 1
        )
        const bootstrapFile = sampleFiles[0]
        if (bootstrapFile === undefined) throw new Error('Bootstrap sample is missing')
        const profile = path.join(runRoot, `profile-${document.id}`)
        const app = await launchRenderActiveUpstreamApplication(
          appBundle,
          profile,
          bootstrapFile
        )
        try {
          const { page } = app
          const capturePage = () => captureUpstreamElectronHiddenPage(
            app.inspector,
            app.targetId
          )
          await expectRenderActiveInactive(app, true)
          expect(await page.evaluate(() =>
            (window as Window & { __marktextDocumentCore?: unknown })
              .__marktextDocumentCore)).toBeUndefined()
          await closeActiveTab(page)

          for (let index = 1; index < sampleFiles.length; index += 1) {
            await expectRenderActiveInactive(app)
            const filePath = sampleFiles[index]
            if (filePath === undefined) throw new Error('Sample path is missing')
            const opened = await openSample(page, filePath)
            const edit = await measureInput(page, capturePage)
            await expectRenderActiveInactive(app)
            samples.push(Object.freeze({
              documentId: document.id,
              phase: index <= sampling.warmupSamples ? 'warmup' : 'measured',
              report: Object.freeze({
                ...edit,
                open: opened.open,
                first_viewport: opened.first_viewport
              })
            }))
            completed += 1
            process.stdout.write(
              `[${String(completed)}/${String(totalSamples)}] ` +
              `${document.id} ${index <= sampling.warmupSamples
                ? 'warmup'
                : 'measured'} ${String(index)} external-browser-compositor-v4\n`
            )
            await closeActiveTab(page)
            await expectRenderActiveInactive(app)
          }
          await expectRenderActiveInactive(app, true)
        } finally {
          await closeRenderActiveUpstreamApplication(app)
        }
      }

      expect(completed).toBe(totalSamples)
      const run = createUpstreamBaselinePerformanceRawRun({
        evidenceClass: classification,
        runId: requiredValue('MARKTEXT_UPSTREAM_RUN_ID'),
        baselineCommit: measurements.baselineCommit,
        buildCommit: requiredValue('MARKTEXT_UPSTREAM_BUILD_COMMIT'),
        measuredAt: new Date().toISOString(),
        environment,
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
          chromiumSchedulingPolicy: PERFORMANCE_CHROMIUM_SCHEDULING_POLICY
        },
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
