import { expect, test } from '@playwright/test'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import type {
  DocumentCorePerformanceSurface
} from '../../src/main/documentCore/documentCorePerformanceSurface'
import { measuredDoublingRatio } from './documentCorePerformanceMath'
import {
  closeElectron,
  expectNoCapturedErrors,
  launchElectron,
  waitForEditor,
  waitForMenuReady
} from './helpers'

const MAX_SOURCE_UNITS = 32_000_000
const OPEN_ADMISSION_BUDGET_MS = 50
const MAIN_STAGE_BUDGET_MS = 4
const CANCELLATION_BUDGET_MS = 100
const HEARTBEAT_BUDGET_MS = 100
const TERMINAL_BUDGET_MS = 120_000
const MAXIMUM_DOCUMENT_EDIT_BUDGET_MS = 500
const VIEWPORT_MOUNT_BUDGET_MS = 10_000
const VIEWPORT_DOM_NODE_BUDGET = 32
const APP_WORKING_SET_BUDGET_BYTES = 2_000_000_000
const SCALE_EDIT_SAMPLES = 5
const SCALE_DOUBLING_RATIO_BUDGET = 2.25
const ORDINARY_OPEN_BUDGET_MS = 5_000
const GREEN_NO_REUSE_STALL_MS = 8
const REQUIRED_REUSE_STALL_MS = 16

const SCALE_FAMILY_IDS = Object.freeze([
  'P1S-ORDINARY-4096-LINES',
  'P1S-MALFORMED-16000-OPENERS',
  'P1S-DEEP-12000-ADDITIONS',
  'P1S-DEEP-1024-CONTEXTS',
  'P1S-BLOCKQUOTE-DEPTH-5000',
  'P1S-WIDE-257-ADDITIONS',
  'P1S-LITERAL-PREFIX-1024'
] as const)

type ScaleFamilyId = typeof SCALE_FAMILY_IDS[number]
type ReuseMeasurementBand =
  | 'green'
  | 'owner-decision'
  | 'reuse-required'

interface PerformanceReuseDecision {
  readonly schema: 'marktext-performance-reuse-decision-v1'
  readonly plan: '0009'
  readonly measurement: 'P11'
  readonly ambiguousBandMs: Readonly<{
    readonly lowerInclusive: number
    readonly upperInclusive: number
  }>
  readonly decision: 'retain-equivalence-proven-reuse'
  readonly implementation: readonly string[]
  readonly proofTargets: readonly string[]
}

interface ScaleFamilyFixture {
  readonly id: ScaleFamilyId
  readonly axis: string
  readonly sourceShape: string
  readonly declaredCount: number
  readonly observedCount: number
  readonly source: string
  readonly filePath: string
}

const MACHINE_RECORD = Object.freeze({
  hostname: os.hostname(),
  platform: `${process.platform}-${process.arch}`,
  release: os.release(),
  cpu: os.cpus()[0]?.model ?? 'unknown',
  cores: os.cpus().length,
  memoryGb: Math.round(os.totalmem() / 1024 ** 3),
  node: process.version
})

interface ExecutionReport {
  readonly schema: 'document-core-execution-report-1'
  readonly executionThreadId: number
  readonly checkpointCount: number
  readonly sourceCheckpointCount: number
  readonly logicalNodeCheckpointCount: number
  readonly sourceCheckpointInterval: number
  readonly logicalNodeCheckpointInterval: number
  readonly sourceUnits: number
  readonly logicalNodes: number
  readonly maximumSourceDelta: number
  readonly maximumLogicalNodeDelta: number
  readonly cancellationObserved: boolean
  readonly workerHeapUsedBytes: number
  readonly workerHeapTotalBytes: number
  readonly workerExternalBytes: number
  readonly workerArrayBuffersBytes: number
  readonly workerProcessRssBytes: number
  readonly serializedPayloadBytes: number
  readonly serializedMemberBytes: Readonly<
    Partial<Record<string, number>>
  >
  readonly operationKind:
    | 'open'
    | 'recovery'
    | 'attach'
    | 'dispatch'
    | 'reload'
    | 'reconfigure'
    | 'select'
  readonly operationCheckpointCount: number
  readonly operationSourceCheckpointCount: number
  readonly operationLogicalNodeCheckpointCount: number
  readonly operationSourceUnits: number
  readonly operationLogicalNodes: number
  readonly operationMaximumSourceDelta: number
  readonly operationMaximumLogicalNodeDelta: number
  readonly operationElapsedMs: number
  readonly operationMaximumCheckpointGapMs: number
  readonly operationOwningThreadStallMs: number
  readonly operationIntrinsicSourceTraversals: number
  readonly operationIntrinsicSourceUnits: number
  readonly operationForkAstRegionEmissions: number
  readonly operationForkAstRegionUnits: number
  readonly operationForkAstRegionReuses: number
}

interface ScaleEditSample {
  readonly browserInputLatencyMs: number
  readonly browserHandlerMs: number
  readonly rendererMaximumGapMs: number
  readonly defaultPrevented: boolean
  readonly execution: ExecutionReport
}

interface ScaleEditFamilyResult {
  readonly id: ScaleFamilyId
  readonly axis: string
  readonly sourceShape: string
  readonly declaredCount: number
  readonly observedCount: number
  readonly initialSourceUnits: number
  readonly openMs: number
  readonly mounted: Readonly<{
    readonly mode: string | null
    readonly sourceLength: number
    readonly executionThreadId: number | null
  }>
  readonly sampleCount: number
  readonly browserInputLatencyMs: Readonly<{
    readonly values: readonly number[]
    readonly p50: number
    readonly p95: number
    readonly maximum: number
  }>
  readonly workerOwningThreadStallMs: Readonly<{
    readonly values: readonly number[]
    readonly p50: number
    readonly p95: number
    readonly maximum: number
  }>
  readonly renderer: Readonly<{
    readonly maximumGapMs: number
    readonly samples: number
  }>
  readonly main: Readonly<{
    readonly maximumGapMs: number
    readonly samples: number
  }>
  readonly processMetrics: readonly Readonly<{
    readonly type: string
    readonly workingSetBytes: number
    readonly peakWorkingSetBytes: number
  }>[]
  readonly samples: readonly ScaleEditSample[]
}

function performanceReuseDecision(): PerformanceReuseDecision {
  const decisionPath = path.resolve(
    __dirname,
    '../../../../specs/migration/performance-reuse-decision.yml'
  )
  const value = JSON.parse(
    readFileSync(decisionPath, 'utf8')
  ) as PerformanceReuseDecision
  if (
    value.schema !== 'marktext-performance-reuse-decision-v1' ||
    value.plan !== '0009' ||
    value.measurement !== 'P11' ||
    value.decision !== 'retain-equivalence-proven-reuse' ||
    value.ambiguousBandMs.lowerInclusive !== GREEN_NO_REUSE_STALL_MS ||
    value.ambiguousBandMs.upperInclusive !== REQUIRED_REUSE_STALL_MS ||
    value.implementation.length === 0 ||
    value.proofTargets.length === 0
  ) {
    throw new TypeError('Plan 0009 performance reuse decision is invalid')
  }
  return Object.freeze({
    ...value,
    ambiguousBandMs: Object.freeze({ ...value.ambiguousBandMs }),
    implementation: Object.freeze([...value.implementation]),
    proofTargets: Object.freeze([...value.proofTargets])
  })
}

function occurrences(source: string, token: string): number {
  let count = 0
  let offset = 0
  while (offset < source.length) {
    const found = source.indexOf(token, offset)
    if (found < 0) break
    count += 1
    offset = found + token.length
  }
  return count
}

const SCALE_BUILDERS: Readonly<Record<
  ScaleFamilyId,
  (count: number) => Readonly<{ source: string; observedCount: number }>
>> = Object.freeze({
  'P1S-ORDINARY-4096-LINES': (count) => {
    const source = Array.from(
      { length: count },
      (_, index) =>
        `line ${index}: {"value":${index}} ` +
        `[link](https://example.test/${index})\n`
    ).join('')
    return Object.freeze({
      source,
      observedCount: occurrences(source, '\n')
    })
  },
  'P1S-MALFORMED-16000-OPENERS': (count) => {
    const source = '{++'.repeat(count)
    return Object.freeze({
      source,
      observedCount: occurrences(source, '{++')
    })
  },
  'P1S-DEEP-12000-ADDITIONS': (count) => {
    const source = `${'{++'.repeat(count)}x${'++}'.repeat(count)}`
    return Object.freeze({
      source,
      observedCount: occurrences(source, '{++')
    })
  },
  'P1S-DEEP-1024-CONTEXTS': (count) => {
    const source = `${'{++'.repeat(count)}x${'++}'.repeat(count)}`
    return Object.freeze({
      source,
      observedCount: occurrences(source, '{++')
    })
  },
  'P1S-BLOCKQUOTE-DEPTH-5000': (count) => {
    const source = `${'> '.repeat(count)}{++x++}\n`
    return Object.freeze({
      source,
      observedCount: occurrences(source, '> ')
    })
  },
  'P1S-WIDE-257-ADDITIONS': (count) => {
    const source = `${'{++x++}'.repeat(count)}\n`
    return Object.freeze({
      source,
      observedCount: occurrences(source, '{++')
    })
  },
  'P1S-LITERAL-PREFIX-1024': (count) => {
    const literal = '`literal {++hidden++}` '
    const source = `${literal.repeat(count)}{++live++}\n`
    return Object.freeze({
      source,
      observedCount: occurrences(source, '`literal ')
    })
  }
})

function buildScaleCorpus(fixtureRoot: string): readonly ScaleFamilyFixture[] {
  const manifestPath = path.resolve(
    __dirname,
    '../../../../specs/migration/profile1-adversarial.yml'
  )
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    readonly schema?: unknown
    readonly scaleFamilies?: readonly Readonly<{
      readonly id?: unknown
      readonly axis?: unknown
      readonly sourceShape?: unknown
    }>[]
  }
  if (
    manifest.schema !== 'marktext-language-corpus-v1' ||
    !Array.isArray(manifest.scaleFamilies)
  ) {
    throw new TypeError('Profile 1 scale corpus manifest is invalid')
  }
  const ids = manifest.scaleFamilies.map((row) => row.id)
  if (JSON.stringify(ids) !== JSON.stringify(SCALE_FAMILY_IDS)) {
    throw new TypeError(
      `Profile 1 scale families changed or were omitted: ${JSON.stringify(ids)}`
    )
  }
  return Object.freeze(manifest.scaleFamilies.map((row) => {
    if (
      typeof row.id !== 'string' ||
      !SCALE_FAMILY_IDS.includes(row.id as ScaleFamilyId) ||
      typeof row.axis !== 'string' ||
      typeof row.sourceShape !== 'string'
    ) {
      throw new TypeError('Profile 1 scale family declaration is invalid')
    }
    const match = /([\d,]+)/.exec(row.sourceShape)
    if (match === null) {
      throw new TypeError(`Scale family ${row.id} has no declared count`)
    }
    const declaredCount = Number(match[1].replaceAll(',', ''))
    const id = row.id as ScaleFamilyId
    const built = SCALE_BUILDERS[id](declaredCount)
    if (built.observedCount !== declaredCount) {
      throw new TypeError(
        `${id} generated ${built.observedCount}, expected ${declaredCount}`
      )
    }
    const filePath = path.join(fixtureRoot, `${id}.md`)
    writeFileSync(filePath, built.source, 'utf8')
    return Object.freeze({
      id,
      axis: row.axis,
      sourceShape: row.sourceShape,
      declaredCount,
      observedCount: built.observedCount,
      source: built.source,
      filePath
    })
  }))
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) throw new RangeError('No latency samples')
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1)
  )
  const value = sorted[index]
  if (value === undefined) throw new RangeError('Latency percentile is absent')
  return value
}

test.describe('document-core maximum-document responsiveness', () => {
  test.describe.configure({ timeout: 1_200_000 })

  let app: ElectronApplication | undefined
  let page: Page | undefined
  let fixtureRoot: string | undefined

  test.afterEach(async() => {
    if (app !== undefined) {
      const current = app
      app = undefined
      try {
        await expectNoCapturedErrors(current)
      } finally {
        await closeElectron(current)
      }
    }
    if (fixtureRoot !== undefined) {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
    app = undefined
    page = undefined
    fixtureRoot = undefined
  })

  test('keeps admission heartbeat cancellation and viewport mount within budget', async() => {
    await test.info().attach('machine-record', {
      body: JSON.stringify(MACHINE_RECORD, null, 2),
      contentType: 'application/json'
    })

    // Every source in this acceptance enters from a main-owned file path. The
    // renderer receives an opaque document id and attaches to that admitted
    // session; it never supplies source, parser policy, or durability identity.
    const fixtureDirectory = mkdtempSync(
      path.join(os.tmpdir(), 'mt-max-document-')
    )
    fixtureRoot = fixtureDirectory
    const filePath = path.join(fixtureDirectory, 'maximum.md')
    const nodeCheckpointPath = path.join(
      fixtureDirectory,
      'logical-node-checkpoint.md'
    )
    const dispatchCancellationPath = path.join(
      fixtureDirectory,
      'dispatch-cancellation.md'
    )
    writeFileSync(filePath, 'x'.repeat(MAX_SOURCE_UNITS), 'utf8')
    writeFileSync(nodeCheckpointPath, 'a\n\n'.repeat(4_096), 'utf8')
    writeFileSync(
      dispatchCancellationPath,
      'd'.repeat(4_000_000),
      'utf8'
    )
    const scaleFixtures = buildScaleCorpus(fixtureDirectory)
    const scaleDoublingFixtures = Object.freeze(scaleFixtures.map((family) => {
      const lowerCount = Math.max(1, Math.floor(family.declaredCount / 2))
      const lower = SCALE_BUILDERS[family.id](lowerCount)
      if (lower.observedCount !== lowerCount) {
        throw new TypeError(
          `${family.id} doubling fixture generated ` +
          `${lower.observedCount}, expected ${lowerCount}`
        )
      }
      const lowerFilePath = path.join(
        fixtureDirectory,
        `${family.id}-doubling-lower.md`
      )
      writeFileSync(lowerFilePath, lower.source, 'utf8')
      return Object.freeze({
        id: family.id,
        lowerCount,
        upperCount: family.declaredCount,
        lowerFilePath,
        upperFilePath: family.filePath
      })
    }))
    expect(scaleFixtures.map((family) => family.id)).toEqual(
      SCALE_FAMILY_IDS
    )
    expect(
      scaleFixtures.every(
        (family) => family.observedCount === family.declaredCount
      )
    ).toBe(true)
    const launched = await launchElectron()
    app = launched.app
    page = launched.page
    await waitForMenuReady(app, TERMINAL_BUDGET_MS)

    // Install both heartbeat probes before the production file-open event so
    // they cover file admission, worker parsing, verified attach, and mount.
    await app.evaluate(() => {
      const state = {
        last: performance.now(),
        maximumGapMs: 0,
        samples: 0,
        timer: undefined as NodeJS.Timeout | undefined
      }
      state.timer = setInterval(() => {
        const now = performance.now()
        state.maximumGapMs = Math.max(
          state.maximumGapMs,
          now - state.last
        )
        state.last = now
        state.samples += 1
      }, 1)
      ;(global as unknown as {
        __mtMaximumDocumentLoop?: typeof state
      }).__mtMaximumDocumentLoop = state
    })

    await page.evaluate(async() => {
      const state = {
        running: true,
        last: performance.now(),
        maximumGapMs: 0,
        samples: 0
      }
      const heartbeat = (now: number): void => {
        state.maximumGapMs = Math.max(state.maximumGapMs, now - state.last)
        state.last = now
        state.samples += 1
        if (state.running) requestAnimationFrame(heartbeat)
      }
      ;(window as unknown as {
        __mtMaximumDocumentAnimation?: typeof state
      }).__mtMaximumDocumentAnimation = state
      requestAnimationFrame(heartbeat)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
    await page.evaluate((filename) => {
      const state = {
        receivedAt: null as number | null,
        presentedAt: null as number | null
      }
      const inspect = (): void => {
        if (
          state.receivedAt !== null &&
          state.presentedAt === null &&
          [...document.querySelectorAll<HTMLElement>(
            '.editor-tabs li.active'
          )].some(tab => tab.textContent?.includes(filename) === true)
        ) {
          state.presentedAt = performance.now()
        }
      }
      new MutationObserver(inspect).observe(document.body, {
        childList: true,
        subtree: true
      })
      window.electron.ipcRenderer.on(
        'mt::document-core::tab-opened',
        (_event, descriptor) => {
          if (
            descriptor !== null &&
            typeof descriptor === 'object' &&
            'filename' in descriptor &&
            descriptor.filename === filename
          ) {
            state.receivedAt = performance.now()
            queueMicrotask(inspect)
          }
        }
      )
      ;(window as unknown as {
        __mtMaximumDocumentAdmission?: typeof state
      }).__mtMaximumDocumentAdmission = state
    }, path.basename(filePath))

    const mountedOpenStartedAt = performance.now()
    const productionOpenDispatchMs = await app.evaluate(
      ({ app: electronApp }, pathname) => {
        const startedAt = performance.now()
        electronApp.emit('open-file', { preventDefault() {} }, pathname)
        return performance.now() - startedAt
      },
      filePath
    )
    await waitForEditor(page, TERMINAL_BUDGET_MS)
    await expect.poll(
      () => launched.page.evaluate(() =>
        window.__marktextE2EReadOnly?.readCanonicalMarkdown().length ?? -1
      ),
      { timeout: TERMINAL_BUDGET_MS }
    ).toBe(MAX_SOURCE_UNITS)
    const mountedTerminalMs = performance.now() - mountedOpenStartedAt
    const rendererAdmissionMs = await page.evaluate(() => {
      const state = (window as unknown as {
        __mtMaximumDocumentAdmission?: {
          readonly receivedAt: number | null
          readonly presentedAt: number | null
        }
      }).__mtMaximumDocumentAdmission
      if (
        state?.receivedAt === null ||
        state?.receivedAt === undefined ||
        state.presentedAt === null
      ) {
        throw new Error('Maximum document has no renderer admission evidence')
      }
      return state.presentedAt - state.receivedAt
    })

    const mountStartedAt = performance.now()
    await expect(page.locator(
      '.editor-component.document-view-container'
    )).toHaveAttribute(
      'data-document-mode',
      /^(?:semantic|source-only)$/,
      { timeout: VIEWPORT_MOUNT_BUDGET_MS }
    )
    const viewportMountMs = performance.now() - mountStartedAt
    const mounted = await page.evaluate(() => {
      const root = document.querySelector(
        '.editor-component.document-view-container'
      )
      const bridge = window.__marktextE2EReadOnly
      const source = bridge?.readCanonicalMarkdown()
      const execution = bridge?.readLastExecutionReport()
      const documentId = document.querySelector(
        '.editor-tabs li.active'
      )?.getAttribute('data-id')
      if (
        root === null ||
        source === undefined ||
        execution === null ||
        execution === undefined ||
        documentId === null ||
        documentId === undefined
      ) {
        throw new Error('Maximum document did not mount its verified session')
      }
      return {
        documentId,
        sourceLength: source.length,
        firstUnit: source.charCodeAt(0),
        lastUnit: source.charCodeAt(source.length - 1),
        domNodes: root.querySelectorAll('*').length,
        renderedTextLength: root.textContent?.length ?? -1,
        mode: (root as HTMLElement).dataset.documentMode ?? null,
        execution
      }
    })
    const productionAdmission = await app.evaluate((_electron, documentId) => {
      const surface = (
        globalThis as typeof globalThis & {
          __mtDocumentCorePerformance?: DocumentCorePerformanceSurface
        }
      ).__mtDocumentCorePerformance
      if (surface === undefined) {
        throw new Error('Main-only document performance surface is absent')
      }
      return surface.readAdmission(documentId)
    }, mounted.documentId)
    const mountedAppProcesses = await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().map((metric) => Object.freeze({
        type: metric.type,
        cpuPercent: metric.cpu.percentCPUUsage,
        workingSetBytes: metric.memory.workingSetSize * 1_024,
        peakWorkingSetBytes: metric.memory.peakWorkingSetSize * 1_024
      }))
    )
    const rendererMemoryAfterMount = await page.evaluate(() => {
      const memory = (
        performance as Performance & {
          readonly memory?: Readonly<{
            readonly usedJSHeapSize: number
            readonly totalJSHeapSize: number
            readonly jsHeapSizeLimit: number
          }>
        }
      ).memory
      return {
        usedJSHeapSize: memory?.usedJSHeapSize ?? null,
        totalJSHeapSize: memory?.totalJSHeapSize ?? null,
        jsHeapSizeLimit: memory?.jsHeapSizeLimit ?? null
      }
    })

    const maximumDocumentEditAdmission = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(
        '.editor-component.document-view-container'
      )
      const bridge = window.__marktextE2EReadOnly
      if (root === null || bridge === undefined) {
        throw new Error('Maximum document has no mounted production editor')
      }
      const carriers = [
        ...root.querySelectorAll<HTMLElement>(
          '.document-view-run[data-model-end]'
        )
      ].filter((carrier) =>
        !carrier.classList.contains('document-view-atomic')
      )
      const carrier = carriers.reduce<HTMLElement | null>(
        (selected, candidate) => {
          if (selected === null) return candidate
          return Number(candidate.dataset.modelEnd) >=
            Number(selected.dataset.modelEnd)
            ? candidate
            : selected
        },
        null
      )
      const text = carrier?.lastChild
      if (
        carrier === null ||
        text === null ||
        text === undefined ||
        text.nodeType !== Node.TEXT_NODE ||
        (text.textContent?.length ?? 0) < 1
      ) {
        throw new Error('Maximum document has no final editable text carrier')
      }
      const range = document.createRange()
      const end = text.textContent?.length ?? 0
      range.setStart(text, end - 1)
      range.setEnd(text, end)
      const selection = document.getSelection()
      if (selection === null) {
        throw new Error('Maximum document has no browser Selection')
      }
      selection.removeAllRanges()
      selection.addRange(range)
      root.focus()
      document.dispatchEvent(new Event('selectionchange'))
      root.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true
      }))

      const state = {
        startedAt: 0,
        handlerReturnedAt: null as number | null,
        defaultPrevented: false,
        beforeReport: bridge.readLastExecutionReport()
      }
      root.addEventListener('beforeinput', () => {
        state.startedAt = performance.now()
      }, { capture: true, once: true })
      root.addEventListener('beforeinput', (event) => {
        state.handlerReturnedAt = performance.now()
        state.defaultPrevented = event.defaultPrevented
      }, { once: true })
      ;(window as unknown as {
        __mtMaximumDocumentEdit?: typeof state
      }).__mtMaximumDocumentEdit = state
      return {
        beforeReport: state.beforeReport,
        sourceLength: bridge.readCanonicalMarkdown().length
      }
    })
    expect(maximumDocumentEditAdmission.sourceLength).toBe(MAX_SOURCE_UNITS)
    const maximumDocumentEditStartedAt = performance.now()
    await page.keyboard.insertText('z')
    await page.waitForFunction(
      ({ expectedLength, beforeReport }) => {
        const bridge = window.__marktextE2EReadOnly
        const source = bridge?.readCanonicalMarkdown()
        const execution = bridge?.readLastExecutionReport()
        return source?.length === expectedLength &&
          source.endsWith('z') &&
          execution !== null &&
          execution !== undefined &&
          execution !== beforeReport &&
          execution.operationKind === 'dispatch'
      },
      {
        expectedLength: MAX_SOURCE_UNITS,
        beforeReport: maximumDocumentEditAdmission.beforeReport
      },
      { timeout: TERMINAL_BUDGET_MS }
    )
    const maximumDocumentEditTerminalMs =
      performance.now() - maximumDocumentEditStartedAt
    const maximumDocumentEdit = await page.evaluate(() => {
      const bridge = window.__marktextE2EReadOnly
      const state = (window as unknown as {
        __mtMaximumDocumentEdit?: {
          readonly startedAt: number
          readonly handlerReturnedAt: number | null
          readonly defaultPrevented: boolean
        }
      }).__mtMaximumDocumentEdit
      const execution = bridge?.readLastExecutionReport()
      if (
        state === undefined ||
        state.startedAt <= 0 ||
        state.handlerReturnedAt === null ||
        execution === null ||
        execution === undefined ||
        execution.operationKind !== 'dispatch'
      ) {
        throw new Error('Maximum document edit has no terminal evidence')
      }
      return {
        sourceLength: bridge?.readCanonicalMarkdown().length ?? -1,
        finalUnit: bridge?.readCanonicalMarkdown().at(-1) ?? null,
        browserHandlerMs: state.handlerReturnedAt - state.startedAt,
        defaultPrevented: state.defaultPrevented,
        execution
      }
    })

    // The performance surface exists only in Electron main during PERF_TESTING.
    // Its public values are absolute file paths or opaque document ids.
    const surfaceCall = async<T>(
      pathname: string,
      operation: keyof Pick<
        DocumentCorePerformanceSurface,
        | 'runFileAdmission'
        | 'cancelFileAdmission'
        | 'cancelDispatchAndRecoverFile'
      >
    ): Promise<T> => await launched.app.evaluate(
      async(_electron, { pathname, operation }) => {
        const surface = (
          globalThis as typeof globalThis & {
            __mtDocumentCorePerformance?: DocumentCorePerformanceSurface
          }
        ).__mtDocumentCorePerformance
        if (surface === undefined) {
          throw new Error('Main-only document performance surface is absent')
        }
        return await surface[operation](pathname) as T
      },
      { pathname, operation }
    )

    // Force the logical-node threshold to win before the source threshold in
    // a worker parse, proving the 2,048-node side of the OR checkpoint.
    const nodeCheckpoint = await surfaceCall<
      Awaited<ReturnType<DocumentCorePerformanceSurface['runFileAdmission']>>
    >(nodeCheckpointPath, 'runFileAdmission')
    const cancelled = await surfaceCall<
      Awaited<ReturnType<DocumentCorePerformanceSurface['cancelFileAdmission']>>
    >(filePath, 'cancelFileAdmission')
    const dispatchCancellation = await surfaceCall<
      Awaited<
        ReturnType<
          DocumentCorePerformanceSurface['cancelDispatchAndRecoverFile']
        >
      >
    >(dispatchCancellationPath, 'cancelDispatchAndRecoverFile')
    const scaleDoubling = []
    for (const fixture of scaleDoublingFixtures) {
      const lower = await surfaceCall<
        Awaited<ReturnType<DocumentCorePerformanceSurface['runFileAdmission']>>
      >(fixture.lowerFilePath, 'runFileAdmission')
      const upper = await surfaceCall<
        Awaited<ReturnType<DocumentCorePerformanceSurface['runFileAdmission']>>
      >(fixture.upperFilePath, 'runFileAdmission')
      const lowerElapsedMs = lower.admission.execution.operationElapsedMs
      const upperElapsedMs = upper.admission.execution.operationElapsedMs
      scaleDoubling.push(Object.freeze({
        id: fixture.id,
        lowerCount: fixture.lowerCount,
        upperCount: fixture.upperCount,
        lowerElapsedMs,
        upperElapsedMs,
        lowerTerminalMs: lower.terminalMs,
        upperTerminalMs: upper.terminalMs,
        ratio: measuredDoublingRatio(lowerElapsedMs, upperElapsedMs),
        lowerResourcesAfterClose: lower.resourcesAfterClose,
        upperResourcesAfterClose: upper.resourcesAfterClose
      }))
    }

    const completedAppProcesses = await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().map((metric) => Object.freeze({
        type: metric.type,
        cpuPercent: metric.cpu.percentCPUUsage,
        workingSetBytes: metric.memory.workingSetSize * 1_024,
        peakWorkingSetBytes: metric.memory.peakWorkingSetSize * 1_024
      }))
    )

    const rendererLoop = await page.evaluate(async() => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const state = (window as unknown as {
        __mtMaximumDocumentAnimation?: {
          running: boolean
          maximumGapMs: number
          samples: number
        }
      }).__mtMaximumDocumentAnimation
      if (state === undefined) {
        throw new Error('Renderer animation monitor was not installed')
      }
      state.running = false
      return {
        maximumGapMs: state.maximumGapMs,
        samples: state.samples
      }
    })

    const rendererMemoryAfterLifecycleEvidence = await page.evaluate(() => {
      const memory = (
        performance as Performance & {
          readonly memory?: Readonly<{
            readonly usedJSHeapSize: number
            readonly totalJSHeapSize: number
            readonly jsHeapSizeLimit: number
          }>
        }
      ).memory
      return {
        usedJSHeapSize: memory?.usedJSHeapSize ?? null,
        totalJSHeapSize: memory?.totalJSHeapSize ?? null,
        jsHeapSizeLimit: memory?.jsHeapSizeLimit ?? null
      }
    })

    const metrics = {
      productionOpenDispatchMs,
      rendererAdmissionMs,
      maximumDocumentTicketAdmissionMs: cancelled.ticketAdmissionMs,
      admissionMs: Math.max(
        productionOpenDispatchMs,
        nodeCheckpoint.ticketAdmissionMs,
        cancelled.ticketAdmissionMs
      ),
      terminalMs: mountedTerminalMs,
      maximumDocumentEditTerminalMs,
      maximumDocumentEdit,
      executionThreadId:
        productionAdmission.admission.execution.executionThreadId,
      workerExecution: productionAdmission.admission.execution,
      attachedExecution: mounted.execution,
      serializedMemberBytes: mounted.execution.serializedMemberBytes,
      serializedPayloadBytes: mounted.execution.serializedPayloadBytes,
      nodeCheckpoint: nodeCheckpoint.admission.execution,
      maximumMainStageMs: Math.max(
        nodeCheckpoint.maximumMainStageMs,
        cancelled.maximumMainStageMs
      ),
      maximumAnimationGapMs: rendererLoop.maximumGapMs,
      rendererAnimationSamples: rendererLoop.samples,
      rendererMemoryAfterMount,
      rendererMemoryAfterLifecycleEvidence,
      nodeCheckpointSourceLength: nodeCheckpoint.sourceLength,
      openCancellationMs: cancelled.cancellationMs,
      openCancellationSourceLength: cancelled.sourceLength,
      openCancellationTerminalMs: cancelled.terminalAfterCancellationMs,
      openCancellationKind: cancelled.cancellationKind,
      openCancellationCheckpointObserved: cancelled.checkpointObserved,
      cancelledTerminalStatus: cancelled.terminalStatus,
      dispatchCancellationMs: dispatchCancellation.cancellationMs,
      dispatchCancellationSourceLength: dispatchCancellation.sourceLength,
      dispatchCancellationTerminalMs:
        dispatchCancellation.terminalAfterCancellationMs,
      dispatchCancellationKind: dispatchCancellation.cancellationKind,
      dispatchStayedOnBase: dispatchCancellation.cancelledStayedOnBase,
      dispatchCancelledExecution: dispatchCancellation.cancelledExecution,
      dispatchRecoveredExecution: dispatchCancellation.recoveredExecution,
      dispatchRecoveredSourceLength:
        dispatchCancellation.recoveredSourceLength,
      dispatchRecoveredThreadMatches:
        dispatchCancellation.recoveredThreadMatches,
      scaleDoubling: Object.freeze(scaleDoubling),
      resourceBaseline: productionAdmission.resources,
      nodeResourcesAfterClose: nodeCheckpoint.resourcesAfterClose,
      openCancellationResources: cancelled.resources,
      dispatchResourcesAfterClose:
        dispatchCancellation.resourcesAfterClose
    }

    const mainLoop = await app.evaluate(() => {
      const state = (global as unknown as {
        __mtMaximumDocumentLoop?: {
          maximumGapMs: number
          samples: number
          timer?: NodeJS.Timeout
        }
      }).__mtMaximumDocumentLoop
      if (state === undefined) {
        throw new Error('Main event-loop monitor was not installed')
      }
      if (state.timer !== undefined) clearInterval(state.timer)
      return {
        maximumGapMs: state.maximumGapMs,
        samples: state.samples
      }
    })
    const appProcesses = await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().map((metric) => Object.freeze({
        type: metric.type,
        cpuPercent: metric.cpu.percentCPUUsage,
        workingSetBytes: metric.memory.workingSetSize * 1_024,
        peakWorkingSetBytes: metric.memory.peakWorkingSetSize * 1_024
      }))
    )
    const appWorkingSetBytes = appProcesses.reduce(
      (total, metric) => total + metric.workingSetBytes,
      0
    )
    const mountedAppWorkingSetBytes = mountedAppProcesses.reduce(
      (total, metric) => total + metric.workingSetBytes,
      0
    )
    const completedAppWorkingSetBytes = completedAppProcesses.reduce(
      (total, metric) => total + metric.workingSetBytes,
      0
    )
    const appPeakWorkingSetBytes = appProcesses.reduce(
      (total, metric) => total + metric.peakWorkingSetBytes,
      0
    )
    const mountedAppPeakWorkingSetBytes = mountedAppProcesses.reduce(
      (total, metric) => total + metric.peakWorkingSetBytes,
      0
    )
    const completedAppPeakWorkingSetBytes = completedAppProcesses.reduce(
      (total, metric) => total + metric.peakWorkingSetBytes,
      0
    )

    const completedApp = app
    app = undefined
    page = undefined
    try {
      await expectNoCapturedErrors(completedApp)
    } finally {
      await closeElectron(completedApp)
    }

    const scaleEditFamilies: ScaleEditFamilyResult[] = []
    for (const family of scaleFixtures) {
      const launchedScale = await launchElectron()
      app = launchedScale.app
      page = launchedScale.page
      await waitForMenuReady(app, TERMINAL_BUDGET_MS)
      const openedAt = performance.now()
      await app.evaluate(
        ({ app: electronApp }, pathname) => {
          electronApp.emit('open-file', { preventDefault() {} }, pathname)
        },
        family.filePath
      )
      await waitForEditor(page, TERMINAL_BUDGET_MS)
      await expect.poll(
        () => launchedScale.page.evaluate(() =>
          window.__marktextE2EReadOnly?.readCanonicalMarkdown().length ?? -1
        ),
        { timeout: TERMINAL_BUDGET_MS }
      ).toBe(family.source.length)
      const openMs = performance.now() - openedAt

      await app.evaluate(() => {
        const state = {
          last: performance.now(),
          maximumGapMs: 0,
          samples: 0,
          timer: undefined as NodeJS.Timeout | undefined
        }
        state.timer = setInterval(() => {
          const now = performance.now()
          state.maximumGapMs = Math.max(
            state.maximumGapMs,
            now - state.last
          )
          state.last = now
          state.samples += 1
        }, 1)
        ;(global as unknown as {
          __mtScaleEditMainLoop?: typeof state
        }).__mtScaleEditMainLoop = state
      })

      const mountedScale = await page.evaluate((sampleCount) => {
        const root = document.querySelector<HTMLElement>(
          '.editor-component.document-view-container'
        )
        const bridge = window.__marktextE2EReadOnly
        if (root === null || bridge === undefined) {
          throw new Error('Scale document has no mounted production editor')
        }
        type Sample = {
          browserInputLatencyMs: number
          browserHandlerMs: number
          rendererMaximumGapMs: number
          defaultPrevented: boolean
          execution: ExecutionReport
        }
        type Current = {
          startedAt: number
          expectedLength: number
          handlerReturnedAt: number | null
          defaultPrevented: boolean
          beforeReport: ExecutionReport | null
          rendererMaximumGapMs: number
        }
        const state = {
          running: true,
          lastFrameAt: performance.now(),
          maximumAnimationGapMs: 0,
          animationSamples: 0,
          expectedSamples: sampleCount,
          current: null as Current | null,
          samples: [] as Sample[]
        }
        const settle = (): void => {
          const current = state.current
          if (current === null) return
          const execution = bridge.readLastExecutionReport()
          if (
            bridge.readCanonicalMarkdown().length !==
              current.expectedLength ||
            execution === null ||
            execution === current.beforeReport ||
            execution.operationKind !== 'dispatch'
          ) {
            return
          }
          const settledAt = performance.now()
          state.samples.push({
            browserInputLatencyMs: settledAt - current.startedAt,
            browserHandlerMs:
              (current.handlerReturnedAt ?? settledAt) -
              current.startedAt,
            rendererMaximumGapMs: current.rendererMaximumGapMs,
            defaultPrevented: current.defaultPrevented,
            execution
          })
          state.current = null
        }
        root.addEventListener('beforeinput', (rawEvent) => {
          const event = rawEvent as InputEvent
          if (
            event.inputType !== 'insertText' ||
            event.data === null ||
            state.current !== null
          ) {
            return
          }
          state.current = {
            startedAt: performance.now(),
            expectedLength:
              bridge.readCanonicalMarkdown().length + event.data.length,
            handlerReturnedAt: null,
            defaultPrevented: false,
            beforeReport: bridge.readLastExecutionReport(),
            rendererMaximumGapMs: 0
          }
        }, true)
        root.addEventListener('beforeinput', (event) => {
          if (state.current === null) return
          state.current.handlerReturnedAt = performance.now()
          state.current.defaultPrevented = event.defaultPrevented
        })
        new MutationObserver(settle).observe(root, {
          childList: true,
          characterData: true,
          subtree: true
        })
        const animate = (now: number): void => {
          const gap = now - state.lastFrameAt
          state.lastFrameAt = now
          state.maximumAnimationGapMs = Math.max(
            state.maximumAnimationGapMs,
            gap
          )
          if (state.current !== null) {
            state.current.rendererMaximumGapMs = Math.max(
              state.current.rendererMaximumGapMs,
              gap
            )
          }
          state.animationSamples += 1
          settle()
          if (state.running) requestAnimationFrame(animate)
        }
        requestAnimationFrame(animate)

        const carriers = [
          ...root.querySelectorAll<HTMLElement>(
            '.document-view-run[data-model-end]'
          )
        ].filter((carrier) =>
          !carrier.classList.contains('document-view-atomic')
        )
        const carrier = carriers.reduce<HTMLElement | null>(
          (selected, candidate) => {
            if (selected === null) return candidate
            return Number(candidate.dataset.modelEnd) >=
              Number(selected.dataset.modelEnd)
              ? candidate
              : selected
          },
          null
        )
        if (carrier === null) {
          throw new Error('Scale document has no editable text carrier')
        }
        const text = carrier.lastChild
        if (text === null || text.nodeType !== Node.TEXT_NODE) {
          throw new Error('Scale document has no editable text carrier')
        }
        const range = document.createRange()
        range.setStart(text, text.textContent?.length ?? 0)
        range.collapse(true)
        const selection = document.getSelection()
        if (selection === null) {
          throw new Error('Scale document has no browser Selection')
        }
        selection.removeAllRanges()
        selection.addRange(range)
        root.focus()
        document.dispatchEvent(new Event('selectionchange'))
        root.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true
        }))
        ;(window as unknown as {
          __mtScaleEditInput?: typeof state
        }).__mtScaleEditInput = state
        return {
          mode: root.dataset.documentMode ?? null,
          sourceLength: bridge.readCanonicalMarkdown().length,
          executionThreadId:
            bridge.readLastExecutionReport()?.executionThreadId ?? null
        }
      }, SCALE_EDIT_SAMPLES)

      await page.waitForTimeout(50)
      for (let sample = 0; sample < SCALE_EDIT_SAMPLES; sample += 1) {
        await page.keyboard.insertText(String.fromCharCode(97 + sample))
        await page.waitForFunction(
          (expectedSamples) => {
            const state = (window as unknown as {
              __mtScaleEditInput?: {
                readonly samples: readonly unknown[]
              }
            }).__mtScaleEditInput
            return state !== undefined &&
              state.samples.length >= expectedSamples
          },
          sample + 1,
          { timeout: TERMINAL_BUDGET_MS }
        )
      }

      const browser = await page.evaluate(async() => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve())
          )
        )
        const state = (window as unknown as {
          __mtScaleEditInput?: {
            running: boolean
            readonly maximumAnimationGapMs: number
            readonly animationSamples: number
            readonly expectedSamples: number
            readonly samples: readonly Readonly<{
              readonly browserInputLatencyMs: number
              readonly browserHandlerMs: number
              readonly rendererMaximumGapMs: number
              readonly defaultPrevented: boolean
              readonly execution: ExecutionReport
            }>[]
          }
        }).__mtScaleEditInput
        if (state === undefined) {
          throw new Error('Scale input monitor was not installed')
        }
        state.running = false
        return {
          maximumAnimationGapMs: state.maximumAnimationGapMs,
          animationSamples: state.animationSamples,
          expectedSamples: state.expectedSamples,
          samples: state.samples
        }
      })
      const main = await app.evaluate(() => {
        const state = (global as unknown as {
          __mtScaleEditMainLoop?: {
            maximumGapMs: number
            samples: number
            timer?: NodeJS.Timeout
          }
        }).__mtScaleEditMainLoop
        if (state === undefined) {
          throw new Error('Scale main-loop monitor was not installed')
        }
        if (state.timer !== undefined) clearInterval(state.timer)
        return {
          maximumGapMs: state.maximumGapMs,
          samples: state.samples
        }
      })
      const processMetrics = await app.evaluate(({ app: electronApp }) =>
        electronApp.getAppMetrics().map((metric) => Object.freeze({
          type: metric.type,
          workingSetBytes: metric.memory.workingSetSize * 1_024,
          peakWorkingSetBytes: metric.memory.peakWorkingSetSize * 1_024
        }))
      )
      const inputLatencies = browser.samples.map(
        (sample) => sample.browserInputLatencyMs
      )
      const workerStalls = browser.samples.map(
        (sample) => sample.execution.operationOwningThreadStallMs
      )
      scaleEditFamilies.push(Object.freeze({
        id: family.id,
        axis: family.axis,
        sourceShape: family.sourceShape,
        declaredCount: family.declaredCount,
        observedCount: family.observedCount,
        initialSourceUnits: family.source.length,
        openMs,
        mounted: mountedScale,
        sampleCount: browser.samples.length,
        browserInputLatencyMs: Object.freeze({
          values: Object.freeze(inputLatencies),
          p50: percentile(inputLatencies, 0.5),
          p95: percentile(inputLatencies, 0.95),
          maximum: Math.max(...inputLatencies)
        }),
        workerOwningThreadStallMs: Object.freeze({
          values: Object.freeze(workerStalls),
          p50: percentile(workerStalls, 0.5),
          p95: percentile(workerStalls, 0.95),
          maximum: Math.max(...workerStalls)
        }),
        renderer: Object.freeze({
          maximumGapMs: browser.maximumAnimationGapMs,
          samples: browser.animationSamples
        }),
        main,
        processMetrics,
        samples: browser.samples
      }) satisfies ScaleEditFamilyResult)

      const completedScaleApp = app
      app = undefined
      page = undefined
      try {
        await expectNoCapturedErrors(completedScaleApp)
      } finally {
        await closeElectron(completedScaleApp)
      }
    }

    const scaleWorkerStalls = scaleEditFamilies.flatMap(
      (family) => family.workerOwningThreadStallMs.values
    )
    const worstResidualParseStallMs = Math.max(...scaleWorkerStalls)
    const measuredFragmentReuses = scaleEditFamilies.reduce(
      (total, family) => total + family.samples.reduce(
        (familyTotal, sample) =>
          familyTotal + sample.execution.operationForkAstRegionReuses,
        0
      ),
      0
    )
    const measuredFragmentEmissions = scaleEditFamilies.reduce(
      (total, family) => total + family.samples.reduce(
        (familyTotal, sample) =>
          familyTotal + sample.execution.operationForkAstRegionEmissions,
        0
      ),
      0
    )
    const ownerDecision = performanceReuseDecision()
    const measurementBand: ReuseMeasurementBand =
      worstResidualParseStallMs < GREEN_NO_REUSE_STALL_MS
        ? 'green'
        : worstResidualParseStallMs <= REQUIRED_REUSE_STALL_MS
          ? 'owner-decision'
          : 'reuse-required'
    const reuseAssessment = measurementBand === 'green'
      ? measuredFragmentReuses === 0
        ? 'green-no-reuse-needed'
        : 'green-reuse-retained'
      : measurementBand === 'owner-decision'
        ? 'owner-decision-reuse-retained'
        : measuredFragmentReuses > 0
          ? 'reuse-required-and-proven'
          : 'reuse-required-but-unobserved'
    const scaleEdit = Object.freeze({
      schema: 'document-core-scale-edit-report-1',
      manifest: 'specs/migration/profile1-adversarial.yml',
      sampleCountPerFamily: SCALE_EDIT_SAMPLES,
      worstResidualParseStallMs,
      measurementBand,
      reuseAssessment,
      ownerDecision,
      fragmentReuse: Object.freeze({
        productionPath: 'session-language-engine-reopen',
        algorithm: 'profile1-safe-point-fragment-reuse-v1',
        implementation: ownerDecision.implementation,
        measuredFragmentReuses,
        measuredFragmentEmissions,
        equivalenceGate:
          'packages/document-core/test/language-engine/' +
          'fragment-reuse-equivalence.spec.ts',
        requiredProofs: Object.freeze([
          'full-and-reuse-result-equivalence',
          'accounting-trace-equivalence',
          'first-resource-failure-equivalence'
        ])
      }),
      thresholdsMs: Object.freeze({
        greenNoReuseBelow: GREEN_NO_REUSE_STALL_MS,
        ownerDecisionAtOrBelow: REQUIRED_REUSE_STALL_MS
      }),
      families: Object.freeze(scaleEditFamilies)
    })

    const report = {
      machine: MACHINE_RECORD,
      mountedTerminalMs,
      viewportMountMs,
      mounted,
      mountedAppProcesses,
      mountedAppWorkingSetBytes,
      mountedAppPeakWorkingSetBytes,
      mainLoop,
      completedAppProcesses,
      completedAppWorkingSetBytes,
      completedAppPeakWorkingSetBytes,
      appProcesses,
      appWorkingSetBytes,
      appPeakWorkingSetBytes,
      scaleEdit,
      ...metrics
    }
    await test.info().attach('scale-edit-report', {
      body: JSON.stringify(scaleEdit, null, 2),
      contentType: 'application/json'
    })
    await test.info().attach('maximum-document-report', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json'
    })

    expect(mounted.sourceLength, JSON.stringify(report))
      .toBe(MAX_SOURCE_UNITS)
    expect(mounted.firstUnit, JSON.stringify(report))
      .toBe('x'.charCodeAt(0))
    expect(mounted.lastUnit, JSON.stringify(report))
      .toBe('x'.charCodeAt(0))
    expect(mounted.renderedTextLength, JSON.stringify(report))
      .toBe(MAX_SOURCE_UNITS)
    expect(mounted.domNodes, JSON.stringify(report))
      .toBeLessThanOrEqual(VIEWPORT_DOM_NODE_BUDGET)
    expect(mountedTerminalMs, JSON.stringify(report))
      .toBeLessThanOrEqual(TERMINAL_BUDGET_MS)
    expect(viewportMountMs, JSON.stringify(report))
      .toBeLessThanOrEqual(VIEWPORT_MOUNT_BUDGET_MS)
    expect(metrics.rendererAdmissionMs, JSON.stringify(report))
      .toBeLessThanOrEqual(OPEN_ADMISSION_BUDGET_MS)
    expect(metrics.productionOpenDispatchMs, JSON.stringify(report))
      .toBeLessThanOrEqual(OPEN_ADMISSION_BUDGET_MS)
    expect(
      metrics.maximumDocumentTicketAdmissionMs,
      JSON.stringify(report)
    ).toBeLessThanOrEqual(OPEN_ADMISSION_BUDGET_MS)
    expect(metrics.admissionMs, JSON.stringify(report))
      .toBeLessThanOrEqual(OPEN_ADMISSION_BUDGET_MS)
    expect(metrics.executionThreadId, JSON.stringify(report))
      .toBeGreaterThan(0)
    expect(metrics.workerExecution.executionThreadId, JSON.stringify(report))
      .toBe(metrics.executionThreadId)
    expect(metrics.workerExecution.operationKind, JSON.stringify(report))
      .toBe('open')
    expect(
      metrics.workerExecution.operationElapsedMs,
      JSON.stringify(report)
    ).toBeLessThanOrEqual(TERMINAL_BUDGET_MS)
    expect(metrics.workerExecution.sourceUnits, JSON.stringify(report))
      .toBe(MAX_SOURCE_UNITS)
    expect(metrics.attachedExecution.operationKind, JSON.stringify(report))
      .toBe('attach')
    expect(metrics.maximumDocumentEdit.sourceLength, JSON.stringify(report))
      .toBe(MAX_SOURCE_UNITS)
    expect(metrics.maximumDocumentEdit.finalUnit, JSON.stringify(report))
      .toBe('z')
    expect(
      metrics.maximumDocumentEdit.defaultPrevented,
      JSON.stringify(report)
    ).toBe(true)
    expect(
      metrics.maximumDocumentEdit.browserHandlerMs,
      JSON.stringify(report)
    ).toBeLessThanOrEqual(MAIN_STAGE_BUDGET_MS)
    expect(
      metrics.maximumDocumentEditTerminalMs,
      JSON.stringify(report)
    ).toBeLessThanOrEqual(MAXIMUM_DOCUMENT_EDIT_BUDGET_MS)
    expect(
      metrics.maximumDocumentEdit.execution.operationElapsedMs,
      JSON.stringify(report)
    ).toBeLessThanOrEqual(MAXIMUM_DOCUMENT_EDIT_BUDGET_MS)
    expect(
      metrics.maximumDocumentEdit.execution.operationOwningThreadStallMs,
      JSON.stringify(report)
    ).toBeLessThanOrEqual(HEARTBEAT_BUDGET_MS)
    expect(
      metrics.maximumDocumentEdit.execution.operationIntrinsicSourceTraversals,
      JSON.stringify(report)
    ).toBe(0)
    expect(
      metrics.maximumDocumentEdit.execution.operationIntrinsicSourceUnits,
      JSON.stringify(report)
    ).toBe(0)
    expect(
      metrics.maximumDocumentEdit.execution.operationForkAstRegionEmissions,
      JSON.stringify(report)
    ).toBe(0)
    expect(
      metrics.maximumDocumentEdit.execution.operationForkAstRegionUnits,
      JSON.stringify(report)
    ).toBe(0)
    expect(
      metrics.maximumDocumentEdit.execution.operationForkAstRegionReuses,
      JSON.stringify(report)
    ).toBeGreaterThan(0)
    expect(
      metrics.attachedExecution.executionThreadId,
      JSON.stringify(report)
    ).toBe(metrics.executionThreadId)
    expect(metrics.workerExecution.sourceCheckpointInterval, JSON.stringify(report))
      .toBe(4_096)
    expect(
      metrics.workerExecution.logicalNodeCheckpointInterval,
      JSON.stringify(report)
    ).toBe(2_048)
    expect(metrics.workerExecution.checkpointCount, JSON.stringify(report))
      .toBeGreaterThan(0)
    expect(metrics.workerExecution.sourceCheckpointCount, JSON.stringify(report))
      .toBeGreaterThan(0)
    expect(metrics.workerExecution.maximumSourceDelta, JSON.stringify(report))
      .toBe(4_096)
    expect(
      metrics.workerExecution.maximumLogicalNodeDelta,
      JSON.stringify(report)
    ).toBeLessThanOrEqual(2_048)
    expect(metrics.nodeCheckpoint.maximumSourceDelta, JSON.stringify(report))
      .toBeLessThanOrEqual(4_096)
    expect(metrics.nodeCheckpoint.maximumLogicalNodeDelta, JSON.stringify(report))
      .toBe(2_048)
    expect(
      metrics.workerExecution.serializedPayloadBytes,
      JSON.stringify(report)
    ).toBe(0)
    expect(metrics.serializedPayloadBytes, JSON.stringify(report))
      .toBe(metrics.attachedExecution.serializedPayloadBytes)
    expect(
      metrics.serializedMemberBytes.livePlanDelta,
      JSON.stringify(report)
    ).toBeLessThanOrEqual(4_096)
    expect(
      metrics.serializedMemberBytes.reviewDelta,
      JSON.stringify(report)
    ).toBeLessThanOrEqual(4_096)
    expect(
      metrics.serializedMemberBytes.sessionDelta,
      JSON.stringify(report)
    ).toBeLessThanOrEqual(MAX_SOURCE_UNITS + 4_096)
    expect(metrics.serializedPayloadBytes, JSON.stringify(report))
      .toBeLessThanOrEqual(MAX_SOURCE_UNITS + 12_288)
    expect(
      metrics.workerExecution.workerProcessRssBytes,
      JSON.stringify(report)
    ).toBeLessThanOrEqual(APP_WORKING_SET_BUDGET_BYTES)
    expect(metrics.maximumMainStageMs, JSON.stringify(report))
      .toBeLessThanOrEqual(MAIN_STAGE_BUDGET_MS)
    expect(metrics.terminalMs, JSON.stringify(report))
      .toBeLessThanOrEqual(TERMINAL_BUDGET_MS)
    expect(mainLoop.samples, JSON.stringify(report)).toBeGreaterThan(0)
    expect(mainLoop.maximumGapMs, JSON.stringify(report))
      .toBeLessThanOrEqual(HEARTBEAT_BUDGET_MS)
    expect(metrics.maximumAnimationGapMs, JSON.stringify(report))
      .toBeLessThanOrEqual(HEARTBEAT_BUDGET_MS)
    expect(metrics.rendererAnimationSamples, JSON.stringify(report))
      .toBeGreaterThan(0)
    expect(metrics.dispatchCancellationMs, JSON.stringify(report))
      .toBeLessThanOrEqual(CANCELLATION_BUDGET_MS)
    expect(metrics.dispatchCancellationTerminalMs, JSON.stringify(report))
      .toBeLessThanOrEqual(CANCELLATION_BUDGET_MS)
    expect(metrics.dispatchCancellationKind, JSON.stringify(report))
      .toBe('cancelled')
    expect(metrics.dispatchStayedOnBase, JSON.stringify(report)).toBe(true)
    expect(
      metrics.dispatchCancelledExecution.cancellationObserved,
      JSON.stringify(report)
    ).toBe(true)
    expect(
      metrics.dispatchRecoveredExecution.operationKind,
      JSON.stringify(report)
    ).toBe('dispatch')
    expect(metrics.dispatchRecoveredSourceLength, JSON.stringify(report))
      .toBe(metrics.dispatchCancellationSourceLength + 1)
    expect(metrics.dispatchRecoveredThreadMatches, JSON.stringify(report))
      .toBe(true)
    expect(metrics.openCancellationMs, JSON.stringify(report))
      .toBeLessThanOrEqual(CANCELLATION_BUDGET_MS)
    expect(metrics.openCancellationSourceLength, JSON.stringify(report))
      .toBe(MAX_SOURCE_UNITS)
    expect(metrics.openCancellationKind, JSON.stringify(report))
      .toBe('cancelled')
    expect(
      metrics.openCancellationCheckpointObserved,
      JSON.stringify(report)
    ).toBe(true)
    expect(metrics.openCancellationTerminalMs, JSON.stringify(report))
      .toBeLessThanOrEqual(CANCELLATION_BUDGET_MS)
    expect(metrics.cancelledTerminalStatus, JSON.stringify(report))
      .toBe('rejected')
    expect(metrics.nodeResourcesAfterClose, JSON.stringify(report))
      .toEqual(metrics.resourceBaseline)
    expect(metrics.openCancellationResources, JSON.stringify(report))
      .toEqual(metrics.resourceBaseline)
    expect(metrics.dispatchResourcesAfterClose, JSON.stringify(report))
      .toEqual(metrics.resourceBaseline)
    expect(mountedAppWorkingSetBytes, JSON.stringify(report))
      .toBeLessThanOrEqual(APP_WORKING_SET_BUDGET_BYTES)
    expect(mountedAppPeakWorkingSetBytes, JSON.stringify(report))
      .toBeLessThanOrEqual(APP_WORKING_SET_BUDGET_BYTES)
    expect(completedAppWorkingSetBytes, JSON.stringify(report))
      .toBeLessThanOrEqual(APP_WORKING_SET_BUDGET_BYTES)
    expect(completedAppPeakWorkingSetBytes, JSON.stringify(report))
      .toBeLessThanOrEqual(APP_WORKING_SET_BUDGET_BYTES)
    expect(appWorkingSetBytes, JSON.stringify(report))
      .toBeLessThanOrEqual(APP_WORKING_SET_BUDGET_BYTES)
    expect(appPeakWorkingSetBytes, JSON.stringify(report))
      .toBeLessThanOrEqual(APP_WORKING_SET_BUDGET_BYTES)
    expect(
      metrics.scaleDoubling.map(result => result.id),
      JSON.stringify(report)
    ).toEqual(SCALE_FAMILY_IDS)
    for (const result of metrics.scaleDoubling) {
      expect(result.ratio, JSON.stringify(report))
        .toBeLessThanOrEqual(SCALE_DOUBLING_RATIO_BUDGET)
      expect(result.lowerResourcesAfterClose, JSON.stringify(report))
        .toEqual(metrics.resourceBaseline)
      expect(result.upperResourcesAfterClose, JSON.stringify(report))
        .toEqual(metrics.resourceBaseline)
      if (result.id === 'P1S-ORDINARY-4096-LINES') {
        expect(result.upperTerminalMs, JSON.stringify(report))
          .toBeLessThanOrEqual(ORDINARY_OPEN_BUDGET_MS)
      }
    }
    expect(
      scaleEdit.families.map((family) => family.id),
      JSON.stringify(report)
    ).toEqual(SCALE_FAMILY_IDS)
    for (const family of scaleEdit.families) {
      expect(family.observedCount, JSON.stringify(report))
        .toBe(family.declaredCount)
      expect(family.sampleCount, JSON.stringify(report))
        .toBe(SCALE_EDIT_SAMPLES)
      expect(family.main.samples, JSON.stringify(report)).toBeGreaterThan(0)
      expect(family.main.maximumGapMs, JSON.stringify(report))
        .toBeLessThanOrEqual(HEARTBEAT_BUDGET_MS)
      expect(family.renderer.samples, JSON.stringify(report))
        .toBeGreaterThan(0)
      expect(family.renderer.maximumGapMs, JSON.stringify(report))
        .toBeLessThanOrEqual(HEARTBEAT_BUDGET_MS)
      expect(
        family.processMetrics.reduce(
          (total, metric) => total + metric.peakWorkingSetBytes,
          0
        ),
        JSON.stringify(report)
      ).toBeLessThanOrEqual(APP_WORKING_SET_BUDGET_BYTES)
      if (family.id === 'P1S-ORDINARY-4096-LINES') {
        expect(family.openMs, JSON.stringify(report))
          .toBeLessThanOrEqual(ORDINARY_OPEN_BUDGET_MS)
      }
      expect(
        family.browserInputLatencyMs.p95,
        JSON.stringify(report)
      ).toBeLessThanOrEqual(500)
      for (const sample of family.samples) {
        expect(sample.defaultPrevented, JSON.stringify(report)).toBe(true)
        expect(sample.browserHandlerMs, JSON.stringify(report))
          .toBeLessThanOrEqual(MAIN_STAGE_BUDGET_MS)
        expect(sample.execution.operationKind, JSON.stringify(report))
          .toBe('dispatch')
        expect(sample.execution.executionThreadId, JSON.stringify(report))
          .toBe(family.mounted.executionThreadId)
        expect(
          sample.execution.operationCheckpointCount,
          JSON.stringify(report)
        ).toBeGreaterThan(0)
        expect(
          sample.execution.operationMaximumSourceDelta,
          JSON.stringify(report)
        ).toBeLessThanOrEqual(4_096)
        expect(
          sample.execution.operationMaximumLogicalNodeDelta,
          JSON.stringify(report)
        ).toBeLessThanOrEqual(2_048)
        expect(
          sample.execution.operationForkAstRegionReuses,
          JSON.stringify(report)
        ).toBeGreaterThanOrEqual(0)
        expect(
          sample.execution.operationForkAstRegionEmissions,
          JSON.stringify(report)
        ).toBeGreaterThanOrEqual(0)
      }
    }
    expect(
      scaleEdit.fragmentReuse.requiredProofs,
      JSON.stringify(report)
    ).toEqual([
      'full-and-reuse-result-equivalence',
      'accounting-trace-equivalence',
      'first-resource-failure-equivalence'
    ])
    expect(
      scaleEdit.fragmentReuse.measuredFragmentEmissions,
      JSON.stringify(report)
    ).toBeGreaterThan(0)
    expect(scaleEdit.ownerDecision, JSON.stringify(report)).toMatchObject({
      schema: 'marktext-performance-reuse-decision-v1',
      plan: '0009',
      measurement: 'P11',
      ambiguousBandMs: {
        lowerInclusive: GREEN_NO_REUSE_STALL_MS,
        upperInclusive: REQUIRED_REUSE_STALL_MS
      },
      decision: 'retain-equivalence-proven-reuse'
    })
    expect(
      scaleEdit.ownerDecision.implementation,
      JSON.stringify(report)
    ).toEqual([
      'packages/document-core/src/languageEngine.ts',
      'packages/document-core/src/internal/profile1/markdownParser.ts'
    ])
    expect(
      scaleEdit.ownerDecision.proofTargets,
      JSON.stringify(report)
    ).toEqual([
      'packages/document-core/test/language-engine/' +
        'fragment-reuse-equivalence.spec.ts',
      'packages/desktop/test/e2e/document-core-max-document-perf.spec.ts'
    ])
    if (scaleEdit.reuseAssessment === 'green-no-reuse-needed') {
      expect(scaleEdit.measurementBand, JSON.stringify(report)).toBe('green')
      expect(scaleEdit.worstResidualParseStallMs, JSON.stringify(report))
        .toBeLessThan(GREEN_NO_REUSE_STALL_MS)
      expect(
        scaleEdit.fragmentReuse.measuredFragmentReuses,
        JSON.stringify(report)
      ).toBe(0)
    } else if (
      scaleEdit.reuseAssessment === 'green-reuse-retained'
    ) {
      expect(scaleEdit.measurementBand, JSON.stringify(report)).toBe('green')
      expect(scaleEdit.worstResidualParseStallMs, JSON.stringify(report))
        .toBeLessThan(GREEN_NO_REUSE_STALL_MS)
      expect(
        scaleEdit.fragmentReuse.measuredFragmentReuses,
        JSON.stringify(report)
      ).toBeGreaterThan(0)
    } else if (
      scaleEdit.reuseAssessment === 'reuse-required-and-proven'
    ) {
      expect(scaleEdit.measurementBand, JSON.stringify(report))
        .toBe('reuse-required')
      expect(scaleEdit.worstResidualParseStallMs, JSON.stringify(report))
        .toBeGreaterThan(REQUIRED_REUSE_STALL_MS)
      expect(
        scaleEdit.fragmentReuse.measuredFragmentReuses,
        JSON.stringify(report)
      ).toBeGreaterThan(0)
    } else if (
      scaleEdit.reuseAssessment === 'owner-decision-reuse-retained'
    ) {
      expect(scaleEdit.measurementBand, JSON.stringify(report))
        .toBe('owner-decision')
      expect(scaleEdit.worstResidualParseStallMs, JSON.stringify(report))
        .toBeGreaterThanOrEqual(GREEN_NO_REUSE_STALL_MS)
      expect(scaleEdit.worstResidualParseStallMs, JSON.stringify(report))
        .toBeLessThanOrEqual(REQUIRED_REUSE_STALL_MS)
      expect(
        scaleEdit.fragmentReuse.measuredFragmentReuses,
        JSON.stringify(report)
      ).toBeGreaterThan(0)
    } else {
      throw new Error(
        'Measured scale-edit stall requires observed fragment reuse: ' +
        JSON.stringify(report)
      )
    }
  })
})
