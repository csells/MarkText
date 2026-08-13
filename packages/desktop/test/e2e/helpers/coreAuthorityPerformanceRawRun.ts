import type {
  CoreAuthorityPerformanceReport
} from './coreAuthorityPerformanceReport'
import {
  PERFORMANCE_CHROMIUM_SCHEDULING_POLICY,
  PERFORMANCE_WINDOW_PRESENTATION_POLICY
} from './performanceChromiumLaunchPolicy'
import {
  PERFORMANCE_PRESENTATION_BOUNDARY
} from './performancePresentationCheckpoint'

const METRICS = [
  't_echo',
  't_dispatch',
  't_ack',
  't_reconcile',
  't_present',
  'open',
  'first_viewport'
] as const

type Metric = typeof METRICS[number]
type SamplePhase = 'warmup' | 'measured'
export type CoreAuthorityPerformanceEvidenceClass =
  | 'ratification'
  | 'smoke-non-ratifying'
export type CoreAuthorityPerformanceSurface = 'wysiwyg' | 'source'
type Distribution = Record<Metric, readonly number[]>

export interface CoreAuthorityPerformanceRawSample {
  readonly documentId: string
  readonly phase: SamplePhase
  readonly surface: CoreAuthorityPerformanceSurface
  readonly report: CoreAuthorityPerformanceReport
}

export interface CoreAuthorityPerformanceBuildProvenance {
  readonly checkoutHead: string
  readonly checkoutClean: boolean
  readonly harnessCommit: string
  readonly packageArtifactSha256: string
  readonly executableSha256: string
  readonly packageVersion: string
  readonly packageManager: string
  readonly nodeVersion: string
  readonly playwrightVersion: string
  readonly lockfileSha256: string
  readonly producerSha256: string
  readonly probeSha256: string
  readonly launcherSha256: string
  readonly measurementBoundary: 'core-authority-browser-compositor-v6'
  readonly presentationBoundary: typeof PERFORMANCE_PRESENTATION_BOUNDARY
  readonly launchBoundary: 'playwright-electron-packaged-transparent-v3'
  readonly windowPresentationPolicy: typeof PERFORMANCE_WINDOW_PRESENTATION_POLICY
  readonly windowPresentationPlatform: 'darwin'
  readonly chromiumSchedulingPolicy: 'hidden-unthrottled-rendering-v2'
}

export interface CoreAuthorityPerformanceRawRunInput {
  readonly evidenceClass: CoreAuthorityPerformanceEvidenceClass
  readonly runId: string
  readonly baselineCommit: string
  readonly buildCommit: string
  readonly measuredAt: string
  readonly environment: Readonly<Record<string, string>>
  readonly sampling: Readonly<{
    readonly warmupSamples: number
    readonly measuredSamples: number
  }>
  readonly provenance: CoreAuthorityPerformanceBuildProvenance
  readonly documents: readonly Readonly<{
    readonly id: string
    readonly sourceSha256: string
  }>[]
  readonly samples: readonly CoreAuthorityPerformanceRawSample[]
}

export function formatMacHardwareFingerprint(input: Readonly<{
  readonly machineName?: string
  readonly machineModel?: string
  readonly chipType?: string
  readonly physicalMemory?: string
}>): string {
  const product = [input.machineName, input.machineModel]
    .filter((value): value is string =>
      typeof value === 'string' && value.length > 0
    )
    .join(' ')

  return [product, input.chipType, input.physicalMemory]
    .filter((value): value is string =>
      typeof value === 'string' && value.length > 0
    )
    .join(', ')
}

export function chooseCoreAuthorityPerformanceSurface(input: Readonly<{
  readonly sourceActive: boolean
  readonly wysiwygEditable: boolean
}>): CoreAuthorityPerformanceSurface {
  if (input.sourceActive) return 'source'
  return input.wysiwygEditable ? 'wysiwyg' : 'source'
}

const emptyDistribution = (): Record<Metric, number[]> => ({
  t_echo: [],
  t_dispatch: [],
  t_ack: [],
  t_reconcile: [],
  t_present: [],
  open: [],
  first_viewport: []
})

const frozenDistribution = (
  distribution: Record<Metric, number[]>
): Distribution => Object.freeze({
  t_echo: Object.freeze([...distribution.t_echo]),
  t_dispatch: Object.freeze([...distribution.t_dispatch]),
  t_ack: Object.freeze([...distribution.t_ack]),
  t_reconcile: Object.freeze([...distribution.t_reconcile]),
  t_present: Object.freeze([...distribution.t_present]),
  open: Object.freeze([...distribution.open]),
  first_viewport: Object.freeze([...distribution.first_viewport])
})

const requireIdentity = (value: string, units: number, label: string): void => {
  if (!new RegExp(`^[0-9a-f]{${String(units)}}$`, 'u').test(value)) {
    throw new Error(`${label} is invalid`)
  }
}

const requireNonEmpty = (value: string, label: string): void => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} provenance is required`)
  }
}

export function createCoreAuthorityPerformanceRawRun(
  input: CoreAuthorityPerformanceRawRunInput
) {
  if (!input.runId.trim()) throw new Error('Raw performance run ID is required')
  requireIdentity(input.baselineCommit, 40, 'Raw performance baseline commit')
  requireIdentity(input.buildCommit, 40, 'Raw performance build commit')
  if (!input.provenance.checkoutClean) {
    throw new Error('Raw performance evidence requires a clean checkout')
  }
  if (input.provenance.checkoutHead !== input.buildCommit) {
    throw new Error('Raw performance checkout head must equal the build commit')
  }
  if (input.provenance.harnessCommit !== input.buildCommit) {
    throw new Error('Raw performance harness commit must equal the build commit')
  }
  requireIdentity(
    input.provenance.packageArtifactSha256,
    64,
    'Raw performance package artifact digest'
  )
  requireIdentity(
    input.provenance.executableSha256,
    64,
    'Raw performance executable digest'
  )
  requireIdentity(input.provenance.lockfileSha256, 64, 'Raw performance lockfile digest')
  requireIdentity(input.provenance.producerSha256, 64, 'Raw performance producer digest')
  requireIdentity(input.provenance.probeSha256, 64, 'Raw performance probe digest')
  requireIdentity(input.provenance.launcherSha256, 64, 'Raw performance launcher digest')
  requireNonEmpty(input.provenance.packageVersion, 'Raw performance package version')
  requireNonEmpty(input.provenance.packageManager, 'Raw performance package manager')
  requireNonEmpty(input.provenance.nodeVersion, 'Raw performance Node version')
  requireNonEmpty(input.provenance.playwrightVersion, 'Raw performance Playwright version')
  if (
    input.provenance.measurementBoundary !==
      'core-authority-browser-compositor-v6'
  ) {
    throw new Error('Raw performance measurement boundary provenance is invalid')
  }
  if (input.provenance.presentationBoundary !== PERFORMANCE_PRESENTATION_BOUNDARY) {
    throw new Error('Raw performance presentation boundary provenance is invalid')
  }
  if (
    input.provenance.launchBoundary !==
      'playwright-electron-packaged-transparent-v3'
  ) {
    throw new Error('Raw performance launch boundary provenance is invalid')
  }
  if (
    input.provenance.windowPresentationPolicy !==
      PERFORMANCE_WINDOW_PRESENTATION_POLICY
  ) {
    throw new Error('Raw performance window presentation provenance is invalid')
  }
  if (input.provenance.windowPresentationPlatform !== 'darwin') {
    throw new Error(
      'Raw performance window presentation platform provenance is invalid'
    )
  }
  if (
    input.provenance.chromiumSchedulingPolicy !==
      PERFORMANCE_CHROMIUM_SCHEDULING_POLICY
  ) {
    throw new Error('Raw performance Chromium scheduling provenance is invalid')
  }
  if (Number.isNaN(Date.parse(input.measuredAt))) {
    throw new Error('Raw performance timestamp is invalid')
  }
  if (
    !Number.isSafeInteger(input.sampling.warmupSamples) ||
    input.sampling.warmupSamples < 1 ||
    !Number.isSafeInteger(input.sampling.measuredSamples) ||
    input.sampling.measuredSamples < 1
  ) throw new Error('Raw performance sample counts must be positive integers')
  if (
    input.evidenceClass === 'ratification' &&
    (input.sampling.warmupSamples !== 20 || input.sampling.measuredSamples !== 200)
  ) {
    throw new Error(
      'Ratification evidence requires exactly 20 warmup and 200 measured samples'
    )
  }

  const samplesByDocument = new Map<string, CoreAuthorityPerformanceRawSample[]>()
  for (const sample of input.samples) {
    const list = samplesByDocument.get(sample.documentId) ?? []
    list.push(sample)
    samplesByDocument.set(sample.documentId, list)
  }
  const documentIds = new Set(input.documents.map(document => document.id))
  for (const documentId of samplesByDocument.keys()) {
    if (!documentIds.has(documentId)) {
      throw new Error(`Raw performance sample names an unknown document: ${documentId}`)
    }
  }

  const documents = input.documents.map(document => {
    requireIdentity(document.sourceSha256, 64, `${document.id} source digest`)
    const warmup = emptyDistribution()
    const measured = emptyDistribution()
    const evidence = {
      warmup: { pendingDepthMaximum: [] as number[], correctionCount: [] as number[] },
      measured: { pendingDepthMaximum: [] as number[], correctionCount: [] as number[] }
    }
    const samples = samplesByDocument.get(document.id) ?? []
    const surfaces = new Set(samples.map(sample => sample.surface))
    if (surfaces.size !== 1) {
      throw new Error(`${document.id} samples must use one editor surface`)
    }
    const surface = samples[0]?.surface
    if (surface !== 'wysiwyg' && surface !== 'source') {
      throw new Error(`${document.id} sample editor surface is invalid`)
    }
    for (const sample of samples) {
      const reportFields = Object.keys(sample.report).sort()
      const expectedReportFields = [
        ...METRICS,
        'pendingDepthMaximum',
        'correctionCount'
      ].sort()
      if (
        JSON.stringify(reportFields) !== JSON.stringify(expectedReportFields)
      ) {
        throw new Error(
          `${document.id} ${sample.phase} report metrics must be exactly: ` +
          expectedReportFields.join(', ')
        )
      }
      if (
        sample.report.t_dispatch.length !== 1 ||
        sample.report.t_ack.length !== 1 ||
        sample.report.t_reconcile.length !== 1 ||
        sample.report.t_echo.length !== 1 ||
        sample.report.t_present.length !== 1
      ) {
        throw new Error(
          `${document.id} ${sample.phase} sample must contain one browser transaction`
        )
      }
      const values = [
        sample.report.t_echo[0]!,
        sample.report.t_dispatch[0]!,
        sample.report.t_ack[0]!,
        sample.report.t_reconcile[0]!,
        sample.report.t_present[0]!,
        sample.report.open,
        sample.report.first_viewport
      ]
      if (values.some(value => !Number.isFinite(value) || value < 0)) {
        throw new Error(`${document.id} ${sample.phase} sample contains invalid timing`)
      }
      if (
        sample.report.t_ack[0]! < sample.report.t_dispatch[0]! ||
        sample.report.t_reconcile[0]! < sample.report.t_ack[0]! ||
        sample.report.t_present[0]! < sample.report.t_echo[0]! ||
        sample.report.first_viewport < sample.report.open
      ) {
        throw new Error(`${document.id} ${sample.phase} sample timing order is invalid`)
      }
      if (
        !Number.isSafeInteger(sample.report.pendingDepthMaximum) ||
        sample.report.pendingDepthMaximum < 1 ||
        !Number.isSafeInteger(sample.report.correctionCount) ||
        sample.report.correctionCount < 0 || sample.report.correctionCount > 1
      ) {
        throw new Error(`${document.id} ${sample.phase} authority evidence is invalid`)
      }
      const distribution = sample.phase === 'warmup' ? warmup : measured
      distribution.t_echo.push(sample.report.t_echo[0]!)
      distribution.t_dispatch.push(sample.report.t_dispatch[0]!)
      distribution.t_ack.push(sample.report.t_ack[0]!)
      distribution.t_reconcile.push(sample.report.t_reconcile[0]!)
      distribution.t_present.push(sample.report.t_present[0]!)
      distribution.open.push(sample.report.open)
      distribution.first_viewport.push(sample.report.first_viewport)
      evidence[sample.phase].pendingDepthMaximum.push(
        sample.report.pendingDepthMaximum
      )
      evidence[sample.phase].correctionCount.push(sample.report.correctionCount)
    }
    if (warmup.open.length !== input.sampling.warmupSamples) {
      throw new Error(
        `${document.id} warmup sample count must be ${String(input.sampling.warmupSamples)}`
      )
    }
    if (measured.open.length !== input.sampling.measuredSamples) {
      throw new Error(
        `${document.id} measured sample count must be ${String(input.sampling.measuredSamples)}`
      )
    }
    return Object.freeze({
      id: document.id,
      sourceSha256: document.sourceSha256,
      surface,
      warmup: frozenDistribution(warmup),
      measured: frozenDistribution(measured),
      authorityEvidence: Object.freeze({
        warmup: Object.freeze({
          pendingDepthMaximum: Object.freeze([...evidence.warmup.pendingDepthMaximum]),
          correctionCount: Object.freeze([...evidence.warmup.correctionCount])
        }),
        measured: Object.freeze({
          pendingDepthMaximum: Object.freeze([...evidence.measured.pendingDepthMaximum]),
          correctionCount: Object.freeze([...evidence.measured.correctionCount])
        })
      })
    })
  })

  const base = Object.freeze({
    runId: input.runId,
    implementation: 'core-candidate' as const,
    surfaces: Object.freeze([
      ...new Set(documents.map(document => document.surface))
    ]),
    baselineCommit: input.baselineCommit,
    buildCommit: input.buildCommit,
    measuredAt: input.measuredAt,
    environment: Object.freeze({ ...input.environment }),
    sampling: Object.freeze({ ...input.sampling }),
    provenance: Object.freeze({ ...input.provenance }),
    documents: Object.freeze(documents)
  })
  return input.evidenceClass === 'ratification'
    ? Object.freeze({
      schema: 'marktext-criticmarkup-raw-performance-run-v7' as const,
      ...base
    })
    : Object.freeze({
      schema: 'marktext-criticmarkup-raw-performance-smoke-v7' as const,
      evidenceClass: 'smoke-non-ratifying' as const,
      ...base
    })
}
