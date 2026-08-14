import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assertBlankCoreAuthorityPerformanceBootstrap,
  chooseCoreAuthorityPerformanceSurface,
  closeCoreAuthorityPerformanceApplication,
  coreAuthorityPerformanceOrchestrationTimeoutMs,
  createCoreAuthorityPerformanceRawRun,
  finalizeCoreAuthorityPerformanceRawOutput,
  formatMacHardwareFingerprint,
  removeCoreAuthorityPerformanceObservationProfile,
  type CoreAuthorityPerformanceBuildProvenance,
  type CoreAuthorityPerformanceRawSample
} from '../../e2e/helpers/coreAuthorityPerformanceRawRun'
import {
  createPerformanceObservationSchedule,
  PERFORMANCE_OBSERVATION_SCHEDULE,
  performanceObservationScheduleSha256
} from '../../e2e/helpers/performanceObservationSchedule'
import { runIsolatedPerformanceObservations } from '../../e2e/helpers/performanceSampleLifecycle'

const report = (
  value: number,
  pendingDepthMaximum = 1,
  correctionCount = 0
) => Object.freeze({
  t_echo: Object.freeze([value + 0.5]),
  t_dispatch: Object.freeze([value]),
  t_ack: Object.freeze([value + 1]),
  t_reconcile: Object.freeze([value + 2]),
  t_present: Object.freeze([value + 2.5]),
  open: value + 3,
  first_viewport: value + 4,
  pendingDepthMaximum,
  correctionCount
})

const scheduleFor = (
  warmupSamples = 1,
  measuredSamples = 1,
  documentIds: readonly string[] = ['doc']
) => createPerformanceObservationSchedule({
  documentIds,
  warmupSamples,
  measuredSamples
})

type SamplePayload = Pick<
  CoreAuthorityPerformanceRawSample,
  'documentId' | 'phase' | 'surface' | 'report'
>

const scheduledSamples = (
  payloads: readonly SamplePayload[],
  warmupSamples = 1,
  measuredSamples = 1,
  documentIds: readonly string[] = ['doc']
): CoreAuthorityPerformanceRawSample[] => {
  const remaining = [...payloads]
  return scheduleFor(warmupSamples, measuredSamples, documentIds).flatMap(
    entry => {
      const payloadIndex = remaining.findIndex(payload =>
        payload.documentId === entry.documentId &&
        payload.phase === entry.phase
      )
      if (payloadIndex < 0) return []
      const [payload] = remaining.splice(payloadIndex, 1)
      if (payload === undefined) return []
      return [{ ...entry, ...payload }]
    }
  )
}

const authenticatedProvenance = (
  schedule = scheduleFor()
) => Object.freeze({
  checkoutHead: '2'.repeat(40),
  checkoutClean: true,
  harnessCommit: '2'.repeat(40),
  packageArtifactSha256: '3'.repeat(64),
  executableSha256: '4'.repeat(64),
  packageVersion: '0.17.0',
  packageManager: 'pnpm@10.14.0',
  nodeVersion: 'v22.18.0',
  playwrightVersion: '1.61.0',
  lockfileSha256: '5'.repeat(64),
  producerSha256: '6'.repeat(64),
  probeSha256: '7'.repeat(64),
  launcherSha256: '8'.repeat(64),
  measurementBoundary: 'core-authority-browser-compositor-v6',
  presentationBoundary: 'electron-webcontents-capture-page-transparent-v2',
  launchBoundary: 'playwright-electron-packaged-transparent-v3',
  windowPresentationPolicy: 'transparent-render-active-inactive-v6',
  windowPresentationPlatform: 'darwin',
  chromiumSchedulingPolicy: 'hidden-unthrottled-rendering-v2',
  sampleLifecycle: 'fresh-application-profile-per-observation-v1',
  applicationLaunchCount: schedule.length,
  uniqueProfileCount: schedule.length,
  applicationCloseCount: schedule.length,
  profileCleanupCount: schedule.length,
  observationSchedule: PERFORMANCE_OBSERVATION_SCHEDULE,
  observationScheduleSha256: performanceObservationScheduleSha256(schedule)
})

describe('Core authority raw performance producer', () => {
  it('cleans the run root before create-only output and stays output-free on cleanup failure', async() => {
    const order: string[] = []
    const runRoot = path.join(os.tmpdir(), 'mt-core-performance-unit')
    const fileLifecycle = {
      removeDirectory: async(path: string) => { order.push(`remove:${path}`) },
      pathExists: () => false,
      createDirectory: async(path: string) => { order.push(`mkdir:${path}`) },
      writeCreateOnly: async(path: string, contents: string) => {
        order.push(`write:${path}:${contents}`)
      },
      now: () => 0,
      wait: async() => {}
    }
    await finalizeCoreAuthorityPerformanceRawOutput({
      runRoot,
      outputPath: '/evidence/core.json',
      contents: '{}\n'
    }, fileLifecycle)
    expect(order).toEqual([
      `remove:${runRoot}`,
      'mkdir:/evidence',
      'write:/evidence/core.json:{}\n'
    ])

    const cleanupFailure = new Error('run-root cleanup failed')
    let wroteOutput = false
    await expect(finalizeCoreAuthorityPerformanceRawOutput({
      runRoot,
      outputPath: '/evidence/core.json',
      contents: '{}\n'
    }, {
      ...fileLifecycle,
      removeDirectory: async() => { throw cleanupFailure },
      now: (() => {
        let value = 0
        return () => ++value * 10_000
      })(),
      writeCreateOnly: async() => { wroteOutput = true }
    })).rejects.toBe(cleanupFailure)
    expect(wroteOutput).toBe(false)
  })

  it('terminates and waits for the exact application PID before profile cleanup', async() => {
    const appCloseFailure = new Error('Electron close failed')
    const events: string[] = []
    let runningChecks = 0
    let profileChecks = 0
    const runRoot = path.join(os.tmpdir(), 'mt-core-performance-unit')
    const profile = path.join(runRoot, 'profile-0001-doc')

    await expect(runIsolatedPerformanceObservations(['doc'], {
      createIsolation: async() => ({ profile }),
      launchAndPrepare: async() => 'application',
      measure: async() => 'measurement',
      close: async() => closeCoreAuthorityPerformanceApplication({
        processId: 4242,
        closeWindow: async() => { events.push('close-window') },
        closeApplication: async() => {
          events.push('close-application')
          throw appCloseFailure
        },
        isProcessRunning: pid => {
          events.push(`running:${String(pid)}`)
          runningChecks += 1
          return runningChecks < 3
        },
        signalProcess: (pid, signal) => {
          events.push(`signal:${signal}:${String(pid)}`)
        },
        now: () => 0,
        wait: async() => { events.push('wait-for-exit') }
      }),
      cleanup: async(_declaration, isolation) => {
        await removeCoreAuthorityPerformanceObservationProfile(
          runRoot,
          isolation.profile,
          {
            removeDirectory: async target => {
              events.push(`remove-profile:${target}`)
            },
            pathExists: target => {
              events.push(`profile-exists:${target}`)
              profileChecks += 1
              return profileChecks === 1
            },
            createDirectory: async() => {},
            writeCreateOnly: async() => {},
            now: () => 0,
            wait: async() => { events.push('wait-profile-cleanup') }
          }
        )
      }
    })).rejects.toBe(appCloseFailure)

    expect(events).toEqual([
      'close-window',
      'close-application',
      'running:4242',
      'signal:SIGTERM:4242',
      'running:4242',
      'wait-for-exit',
      'running:4242',
      `remove-profile:${profile}`,
      `profile-exists:${profile}`,
      'wait-profile-cleanup',
      `remove-profile:${profile}`,
      `profile-exists:${profile}`
    ])
  })

  it('retains the primary lifecycle failure when close fallbacks also fail', async() => {
    const primary = new Error('window close failed')
    const application = new Error('application close failed')
    const termination = new Error('termination failed')

    await expect(closeCoreAuthorityPerformanceApplication({
      processId: 4242,
      closeWindow: async() => { throw primary },
      closeApplication: async() => { throw application },
      isProcessRunning: () => true,
      signalProcess: () => { throw termination },
      now: () => 0,
      wait: async() => {}
    })).rejects.toMatchObject({
      errors: [primary, application, termination]
    })
  })

  it('escalates an exact PID from TERM to KILL with a bounded wait after each signal', async() => {
    const events: string[] = []
    let clock = 0
    let signal: 'none' | 'SIGTERM' | 'SIGKILL' = 'none'
    let killPolls = 0

    await closeCoreAuthorityPerformanceApplication({
      processId: 4242,
      closeWindow: async() => { events.push('close-window') },
      closeApplication: async() => { events.push('close-application') },
      isProcessRunning: pid => {
        events.push(`running:${signal}:${String(pid)}`)
        if (signal !== 'SIGKILL') return true
        killPolls += 1
        return killPolls === 1
      },
      signalProcess: (pid, nextSignal) => {
        signal = nextSignal
        events.push(`signal:${nextSignal}:${String(pid)}`)
      },
      now: () => clock,
      wait: async() => {
        events.push(`wait:${signal}`)
        clock += 10_000
      }
    })

    expect(events).toEqual([
      'close-window',
      'close-application',
      'running:none:4242',
      'signal:SIGTERM:4242',
      'running:SIGTERM:4242',
      'wait:SIGTERM',
      'running:SIGTERM:4242',
      'signal:SIGKILL:4242',
      'running:SIGKILL:4242',
      'wait:SIGKILL',
      'running:SIGKILL:4242'
    ])
  })

  it('admits only an exact blank untitled bootstrap with empty Core authority', () => {
    expect(() => assertBlankCoreAuthorityPerformanceBootstrap({
      currentFile: {
        id: 'untitled-document',
        filename: 'Untitled-1',
        pathname: '',
        markdown: ''
      },
      authority: {
        documentId: 'untitled-document',
        source: ''
      }
    })).not.toThrow()

    const valid = {
      currentFile: {
        id: 'untitled-document',
        filename: 'Untitled-1',
        pathname: '',
        markdown: ''
      },
      authority: {
        documentId: 'untitled-document',
        source: ''
      }
    } as const
    expect(() => assertBlankCoreAuthorityPerformanceBootstrap({
      ...valid,
      currentFile: { ...valid.currentFile, pathname: '/samples/measured.md' }
    })).toThrow(/measured file|pathname/i)
    expect(() => assertBlankCoreAuthorityPerformanceBootstrap({
      ...valid,
      currentFile: { ...valid.currentFile, markdown: 'stale store source' }
    })).toThrow(/current file.*empty/i)
    expect(() => assertBlankCoreAuthorityPerformanceBootstrap({
      ...valid,
      authority: { ...valid.authority, source: 'stale authority source' }
    })).toThrow(/authority source.*empty/i)
    expect(() => assertBlankCoreAuthorityPerformanceBootstrap({
      ...valid,
      currentFile: { ...valid.currentFile, filename: 'sample.md' }
    })).toThrow(/untitled/i)
    expect(() => assertBlankCoreAuthorityPerformanceBootstrap({
      ...valid,
      authority: { ...valid.authority, documentId: 'another-document' }
    })).toThrow(/document identity/i)
  })

  it('scales the outer budget with lifecycle and finalization headroom', () => {
    expect(coreAuthorityPerformanceOrchestrationTimeoutMs(15)).toBe(630_000)
    expect(coreAuthorityPerformanceOrchestrationTimeoutMs(1_100)).toBe(33_180_000)
    expect(() => coreAuthorityPerformanceOrchestrationTimeoutMs(0))
      .toThrow(/total samples.*positive integer/i)
  })

  it('formats the frozen Mac hardware fingerprint exactly', () => {
    expect(formatMacHardwareFingerprint({
      machineName: 'MacBook Pro',
      machineModel: 'Mac17,6',
      chipType: 'Apple M5 Max',
      physicalMemory: '128 GB'
    })).toBe('MacBook Pro Mac17,6, Apple M5 Max, 128 GB')
  })

  it('keeps an active Source surface ahead of hidden WYSIWYG bindings', () => {
    expect(chooseCoreAuthorityPerformanceSurface({
      sourceActive: true,
      wysiwygEditable: true
    })).toBe('source')
    expect(chooseCoreAuthorityPerformanceSurface({
      sourceActive: false,
      wysiwygEditable: true
    })).toBe('wysiwyg')
    expect(chooseCoreAuthorityPerformanceSurface({
      sourceActive: false,
      wysiwygEditable: false
    })).toBe('source')
  })

  it('assembles exact per-document distributions and queue/correction evidence', () => {
    const digest = 'a'.repeat(64)
    const schedule = createPerformanceObservationSchedule({
      documentIds: ['doc'],
      warmupSamples: 1,
      measuredSamples: 2
    })
    const provenance = {
      ...authenticatedProvenance(schedule)
    }
    const samples: CoreAuthorityPerformanceRawSample[] = [
      { ...schedule[0]!, surface: 'source', report: report(1) },
      {
        ...schedule[1]!,
        surface: 'source',
        report: report(2, 3, 1)
      },
      {
        ...schedule[2]!,
        surface: 'source',
        report: report(3, 2, 0)
      }
    ]

    expect(createCoreAuthorityPerformanceRawRun({
      runId: 'core-2026-08-13',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 2 },
      provenance,
      documents: [{ id: 'doc', sourceSha256: digest }],
      samples
    })).toEqual({
      schema: 'marktext-criticmarkup-raw-performance-smoke-v13',
      evidenceClass: 'smoke-non-ratifying',
      runId: 'core-2026-08-13',
      implementation: 'core-candidate',
      surfaces: ['source'],
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 2 },
      provenance,
      observationOrder: schedule,
      documents: [{
        id: 'doc',
        sourceSha256: digest,
        surface: 'source',
        warmup: {
          t_echo: [1.5],
          t_dispatch: [1],
          t_ack: [2],
          t_reconcile: [3],
          t_present: [3.5],
          open: [4],
          first_viewport: [5]
        },
        measured: {
          t_echo: [2.5, 3.5],
          t_dispatch: [2, 3],
          t_ack: [3, 4],
          t_reconcile: [4, 5],
          t_present: [4.5, 5.5],
          open: [5, 6],
          first_viewport: [6, 7]
        },
        authorityEvidence: {
          warmup: {
            pendingDepthMaximum: [1],
            correctionCount: [0]
          },
          measured: {
            pendingDepthMaximum: [3, 2],
            correctionCount: [1, 0]
          }
        }
      }]
    })
  })

  it('rejects reordered, duplicate, missing, or relabeled scheduled observations', () => {
    const schedule = createPerformanceObservationSchedule({
      documentIds: ['doc'],
      warmupSamples: 1,
      measuredSamples: 2
    })
    const samples: CoreAuthorityPerformanceRawSample[] = schedule.map(
      (entry, index) => ({
        ...entry,
        surface: 'source',
        report: report(index + 1)
      })
    )
    const input = {
      runId: 'core-scheduled',
      evidenceClass: 'smoke-non-ratifying' as const,
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 2 },
      provenance: {
        ...authenticatedProvenance(schedule)
      },
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }]
    }

    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      samples: [samples[1]!, samples[0]!, samples[2]!]
    })).toThrow(/observation schedule.*ordinal 1/i)
    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      samples: [samples[0]!, samples[0]!, samples[2]!]
    })).toThrow(/observation schedule.*ordinal 2/i)
    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      samples: samples.slice(0, 2)
    })).toThrow(/observation schedule.*3.*2/i)
    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      samples: [
        samples[0]!,
        { ...samples[1]!, phaseRound: 2 },
        samples[2]!
      ]
    })).toThrow(/observation schedule.*ordinal 2/i)
    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      samples: [
        samples[0]!,
        samples[1]!,
        { ...samples[2]!, phase: 'warmup' }
      ]
    })).toThrow(/observation schedule.*ordinal 3/i)
    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      samples: [
        samples[0]!,
        samples[1]!,
        { ...samples[2]!, roundPosition: 2 }
      ]
    })).toThrow(/observation schedule.*ordinal 3/i)
    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      samples: [
        samples[0]!,
        samples[1]!,
        { ...samples[2]!, ordinal: 4 }
      ]
    })).toThrow(/observation schedule.*ordinal 3/i)
  })

  it('rejects an unauthenticated observation schedule policy or digest', () => {
    const schedule = scheduleFor()
    const input = {
      runId: 'core-scheduled-provenance',
      evidenceClass: 'smoke-non-ratifying' as const,
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: scheduledSamples([
        { documentId: 'doc', phase: 'warmup', surface: 'source', report: report(1) },
        { documentId: 'doc', phase: 'measured', surface: 'source', report: report(2) }
      ])
    }

    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      provenance: {
        ...authenticatedProvenance(schedule),
        observationSchedule: 'document-major-v0'
      }
    } as never)).toThrow(/observation schedule policy/i)
    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      provenance: {
        ...authenticatedProvenance(schedule),
        observationScheduleSha256: 'not-a-digest'
      }
    })).toThrow(/observation schedule digest.*invalid/i)
    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      provenance: {
        ...authenticatedProvenance(schedule),
        observationScheduleSha256: 'f'.repeat(64)
      }
    })).toThrow(/observation schedule digest.*documents and sampling/i)
  })

  it('keeps short Core smoke output structurally non-ratifying', () => {
    const smoke = createCoreAuthorityPerformanceRawRun({
      runId: 'core-smoke',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: authenticatedProvenance(),
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: scheduledSamples([
        { documentId: 'doc', phase: 'warmup', surface: 'source', report: report(1) },
        { documentId: 'doc', phase: 'measured', surface: 'source', report: report(2) }
      ])
    })
    expect(smoke).toMatchObject({
      schema: 'marktext-criticmarkup-raw-performance-smoke-v13',
      evidenceClass: 'smoke-non-ratifying'
    })
  })

  it('emits v13 only for the fixed 20/200 ratification protocol', () => {
    const ratificationSchedule = scheduleFor(20, 200)
    const ratificationSamples: CoreAuthorityPerformanceRawSample[] = ratificationSchedule.map(
      (entry, index) => ({
        ...entry,
        surface: 'source' as const,
        report: report(entry.phase === 'warmup' ? index + 1 : index + 81)
      })
    )
    const ratification = createCoreAuthorityPerformanceRawRun({
      runId: 'core-ratification',
      evidenceClass: 'ratification',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 20, measuredSamples: 200 },
      provenance: authenticatedProvenance(ratificationSchedule),
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: ratificationSamples
    })

    expect(ratification.schema).toBe(
      'marktext-criticmarkup-raw-performance-run-v13'
    )
    expect(() => createCoreAuthorityPerformanceRawRun({
      runId: 'core',
      evidenceClass: 'ratification',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: authenticatedProvenance(),
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: scheduledSamples([
        { documentId: 'doc', phase: 'warmup', surface: 'source', report: report(1) },
        { documentId: 'doc', phase: 'measured', surface: 'source', report: report(2) }
      ])
    })).toThrow(/20 warmup and 200 measured/i)
  })

  it('rejects incomplete or pooled browser transactions', () => {
    const input = {
      runId: 'core',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: authenticatedProvenance(),
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }]
    } as const

    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      samples: scheduledSamples([{
        documentId: 'doc',
        phase: 'warmup',
        surface: 'wysiwyg',
        report: report(1)
      }])
    })).toThrow(/observation schedule.*2.*1/i)
    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      samples: scheduledSamples([
        {
          documentId: 'doc',
          phase: 'warmup',
          surface: 'wysiwyg',
          report: { ...report(1), t_dispatch: [1, 2] }
        },
        {
          documentId: 'doc',
          phase: 'measured',
          surface: 'wysiwyg',
          report: report(2)
        }
      ])
    })).toThrow(/one browser transaction/i)

    const staleReport = { ...report(1) } as unknown as Record<string, unknown>
    staleReport.t_frame = staleReport.t_present
    delete staleReport.t_present
    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      samples: scheduledSamples([
        {
          documentId: 'doc',
          phase: 'warmup',
          surface: 'wysiwyg',
          report: staleReport as never
        },
        {
          documentId: 'doc',
          phase: 'measured',
          surface: 'wysiwyg',
          report: report(2)
        }
      ])
    } as never)).toThrow(/report metrics must be exactly.*t_present/i)
  })

  it('rejects mixed editor surfaces within one document distribution', () => {
    expect(() => createCoreAuthorityPerformanceRawRun({
      runId: 'core',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: authenticatedProvenance(),
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: scheduledSamples([
        {
          documentId: 'doc',
          phase: 'warmup',
          surface: 'wysiwyg',
          report: report(1)
        },
        {
          documentId: 'doc',
          phase: 'measured',
          surface: 'source',
          report: report(2)
        }
      ])
    })).toThrow(/one editor surface/i)
  })

  it('rejects evidence produced from a dirty checkout', () => {
    expect(() => createCoreAuthorityPerformanceRawRun({
      runId: 'core',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: { ...authenticatedProvenance(), checkoutClean: false },
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: scheduledSamples([
        {
          documentId: 'doc',
          phase: 'warmup',
          surface: 'source',
          report: report(1)
        },
        {
          documentId: 'doc',
          phase: 'measured',
          surface: 'source',
          report: report(2)
        }
      ])
    })).toThrow(/clean checkout/i)
  })

  it('rejects evidence whose checkout does not authenticate the build commit', () => {
    expect(() => createCoreAuthorityPerformanceRawRun({
      runId: 'core',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: { ...authenticatedProvenance(), checkoutHead: '9'.repeat(40) },
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: scheduledSamples([
        {
          documentId: 'doc',
          phase: 'warmup',
          surface: 'source',
          report: report(1)
        },
        {
          documentId: 'doc',
          phase: 'measured',
          surface: 'source',
          report: report(2)
        }
      ])
    })).toThrow(/checkout head must equal the build commit/i)
  })

  it('rejects absent or mismatched hidden Chromium scheduling provenance', () => {
    const absent = {
      ...authenticatedProvenance()
    } as Record<string, unknown>
    delete absent.chromiumSchedulingPolicy
    const run = (provenance: unknown) => createCoreAuthorityPerformanceRawRun({
      runId: 'core',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: provenance as CoreAuthorityPerformanceBuildProvenance,
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: scheduledSamples([
        { documentId: 'doc', phase: 'warmup', surface: 'source', report: report(1) },
        { documentId: 'doc', phase: 'measured', surface: 'source', report: report(2) }
      ])
    })

    expect(() => run(absent)).toThrow(/Chromium scheduling/i)
    expect(() => run({
      ...authenticatedProvenance(),
      chromiumSchedulingPolicy: 'hidden-unthrottled-rendering-v1'
    })).toThrow(/Chromium scheduling/i)
  })

  it('rejects pooled or incomplete fresh-observation lifecycle provenance', () => {
    const run = (provenance: unknown) => createCoreAuthorityPerformanceRawRun({
      runId: 'core',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: provenance as CoreAuthorityPerformanceBuildProvenance,
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: scheduledSamples([
        { documentId: 'doc', phase: 'warmup', surface: 'source', report: report(1) },
        { documentId: 'doc', phase: 'measured', surface: 'source', report: report(2) }
      ])
    })
    const absent = { ...authenticatedProvenance() } as Record<string, unknown>
    delete absent.sampleLifecycle

    expect(() => run(absent)).toThrow(/sample lifecycle/i)
    expect(() => run({
      ...authenticatedProvenance(),
      sampleLifecycle: 'one-application-per-document'
    })).toThrow(/fresh application profile per observation/i)
    for (const field of [
      'applicationLaunchCount',
      'uniqueProfileCount',
      'applicationCloseCount',
      'profileCleanupCount'
    ] as const) {
      expect(() => run({
        ...authenticatedProvenance(),
        [field]: 1
      })).toThrow(new RegExp(`${field}.*observation count`, 'iu'))
    }
  })

  it.each([
    'packageArtifactSha256',
    'executableSha256',
    'lockfileSha256',
    'producerSha256',
    'probeSha256',
    'launcherSha256'
  ] as const)('rejects an invalid %s provenance digest', field => {
    expect(() => createCoreAuthorityPerformanceRawRun({
      runId: 'core',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: { ...authenticatedProvenance(), [field]: 'not-a-digest' },
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: scheduledSamples([
        {
          documentId: 'doc',
          phase: 'warmup',
          surface: 'source',
          report: report(1)
        },
        {
          documentId: 'doc',
          phase: 'measured',
          surface: 'source',
          report: report(2)
        }
      ])
    })).toThrow(/invalid/i)
  })

  it.each([
    ['packageVersion', ''],
    ['packageManager', ''],
    ['nodeVersion', ''],
    ['playwrightVersion', ''],
    ['measurementBoundary', 'legacy-core-timing'],
    ['presentationBoundary', 'request-animation-frame'],
    ['launchBoundary', 'playwright-electron-packaged-transparent-v2'],
    ['windowPresentationPolicy', 'transparent-render-active-inactive-v2'],
    ['windowPresentationPlatform', 'linux']
  ] as const)('rejects unauthenticated %s provenance', (field, value) => {
    const provenance = {
      ...authenticatedProvenance(),
      [field]: value
    } as unknown as CoreAuthorityPerformanceBuildProvenance
    expect(() => createCoreAuthorityPerformanceRawRun({
      runId: 'core',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance,
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: scheduledSamples([
        {
          documentId: 'doc',
          phase: 'warmup',
          surface: 'source',
          report: report(1)
        },
        {
          documentId: 'doc',
          phase: 'measured',
          surface: 'source',
          report: report(2)
        }
      ])
    })).toThrow(/provenance/i)
  })
})
