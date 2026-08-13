import type {
  CoreAuthorityPerformanceReport
} from './coreAuthorityPerformanceReport'

const METRICS = [
  't_dispatch',
  't_ack',
  't_reconcile',
  'open',
  'first_viewport'
] as const

type Metric = typeof METRICS[number]
type SamplePhase = 'warmup' | 'measured'
export type CoreAuthorityPerformanceSurface = 'wysiwyg' | 'source'
type Distribution = Record<Metric, readonly number[]>

export interface CoreAuthorityPerformanceRawSample {
  readonly documentId: string
  readonly phase: SamplePhase
  readonly surface: CoreAuthorityPerformanceSurface
  readonly report: CoreAuthorityPerformanceReport
}

export interface CoreAuthorityPerformanceRawRunInput {
  readonly runId: string
  readonly baselineCommit: string
  readonly buildCommit: string
  readonly measuredAt: string
  readonly environment: Readonly<Record<string, string>>
  readonly sampling: Readonly<{
    readonly warmupSamples: number
    readonly measuredSamples: number
  }>
  readonly documents: readonly Readonly<{
    readonly id: string
    readonly sourceSha256: string
  }>[]
  readonly samples: readonly CoreAuthorityPerformanceRawSample[]
}

const emptyDistribution = (): Record<Metric, number[]> => ({
  t_dispatch: [],
  t_ack: [],
  t_reconcile: [],
  open: [],
  first_viewport: []
})

const frozenDistribution = (
  distribution: Record<Metric, number[]>
): Distribution => Object.freeze({
  t_dispatch: Object.freeze([...distribution.t_dispatch]),
  t_ack: Object.freeze([...distribution.t_ack]),
  t_reconcile: Object.freeze([...distribution.t_reconcile]),
  open: Object.freeze([...distribution.open]),
  first_viewport: Object.freeze([...distribution.first_viewport])
})

const requireIdentity = (value: string, units: number, label: string): void => {
  if (!new RegExp(`^[0-9a-f]{${String(units)}}$`, 'u').test(value)) {
    throw new Error(`${label} is invalid`)
  }
}

export function createCoreAuthorityPerformanceRawRun(
  input: CoreAuthorityPerformanceRawRunInput
) {
  if (!input.runId.trim()) throw new Error('Raw performance run ID is required')
  requireIdentity(input.baselineCommit, 40, 'Raw performance baseline commit')
  requireIdentity(input.buildCommit, 40, 'Raw performance build commit')
  if (Number.isNaN(Date.parse(input.measuredAt))) {
    throw new Error('Raw performance timestamp is invalid')
  }
  if (
    !Number.isSafeInteger(input.sampling.warmupSamples) ||
    input.sampling.warmupSamples < 1 ||
    !Number.isSafeInteger(input.sampling.measuredSamples) ||
    input.sampling.measuredSamples < 1
  ) throw new Error('Raw performance sample counts must be positive integers')

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
      if (
        sample.report.t_dispatch.length !== 1 ||
        sample.report.t_ack.length !== 1 ||
        sample.report.t_reconcile.length !== 1
      ) {
        throw new Error(
          `${document.id} ${sample.phase} sample must contain one browser transaction`
        )
      }
      const values = [
        sample.report.t_dispatch[0]!,
        sample.report.t_ack[0]!,
        sample.report.t_reconcile[0]!,
        sample.report.open,
        sample.report.first_viewport
      ]
      if (values.some(value => !Number.isFinite(value) || value < 0)) {
        throw new Error(`${document.id} ${sample.phase} sample contains invalid timing`)
      }
      if (
        sample.report.t_ack[0]! < sample.report.t_dispatch[0]! ||
        sample.report.t_reconcile[0]! < sample.report.t_ack[0]! ||
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
      distribution.t_dispatch.push(sample.report.t_dispatch[0]!)
      distribution.t_ack.push(sample.report.t_ack[0]!)
      distribution.t_reconcile.push(sample.report.t_reconcile[0]!)
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

  return Object.freeze({
    schema: 'marktext-criticmarkup-raw-performance-run-v2' as const,
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
    documents: Object.freeze(documents)
  })
}
