import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  createPerformanceObservationSchedule,
  PERFORMANCE_OBSERVATION_SCHEDULE,
  performanceObservationScheduleSha256,
  type PerformanceObservationScheduleEntry
} from '../../e2e/helpers/performanceObservationSchedule'
import {
  createUpstreamBaselinePerformanceRawRun,
  writeUpstreamBaselinePerformanceRawRun,
  type UpstreamBaselinePerformanceRawSample
} from '../../e2e/helpers/upstreamBaselinePerformanceRawRun'

const PINNED_BASELINE = '43bd8b77795fb27b1a9512737c000f7362031ea0'

const sample = (
  scheduleEntry: PerformanceObservationScheduleEntry,
  value: number
): UpstreamBaselinePerformanceRawSample => ({
  ...scheduleEntry,
  report: {
    t_echo: value + 1,
    t_present: value + 2,
    open: value + 3,
    first_viewport: value + 4
  }
})

const input = (
  evidenceClass: 'ratification' | 'smoke-non-ratifying',
  warmupSamples: number,
  measuredSamples: number
) => {
  const schedule = createPerformanceObservationSchedule({
    documentIds: ['doc'],
    warmupSamples,
    measuredSamples
  })
  return {
    evidenceClass,
    runId: `upstream-${evidenceClass}`,
    baselineCommit: PINNED_BASELINE,
    buildCommit: PINNED_BASELINE,
    measuredAt: '2026-08-13T12:00:00.000Z',
    environment: { build: 'MarkText production Electron bundle' },
    sampling: { warmupSamples, measuredSamples },
    documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
    provenance: {
      detachedWorktreeHead: PINNED_BASELINE,
      detachedWorktreeClean: true,
      harnessCommit: '2'.repeat(40),
      packageArtifactSha256: 'b'.repeat(64),
      executableSha256: 'c'.repeat(64),
      packageVersion: '0.20.0-dev',
      packageManager: 'pnpm@10.33.4',
      nodeVersion: 'v22.20.0',
      playwrightVersion: '1.61.0',
      lockfileSha256: 'd'.repeat(64),
      producerSha256: 'e'.repeat(64),
      probeSha256: 'f'.repeat(64),
      launcherSha256: '1'.repeat(64),
      measurementBoundary: 'external-browser-compositor-v4' as const,
      presentationBoundary: 'electron-webcontents-capture-page-transparent-v2' as const,
      launchBoundary: 'external-inspector-transparent-render-active-v3' as const,
      windowPresentationPolicy: 'transparent-render-active-inactive-v6' as const,
      windowPresentationPlatform: 'darwin' as const,
      chromiumSchedulingPolicy: 'hidden-unthrottled-rendering-v2' as const,
      displaySleepPolicy:
        'runner-owned-caffeinate-display-sleep-prevention-v1' as const,
      sampleLifecycle: 'fresh-application-profile-per-observation-v1' as const,
      applicationLaunchCount: warmupSamples + measuredSamples,
      uniqueProfileCount: warmupSamples + measuredSamples,
      applicationCloseCount: warmupSamples + measuredSamples,
      profileCleanupCount: warmupSamples + measuredSamples,
      observationSchedule: PERFORMANCE_OBSERVATION_SCHEDULE,
      observationScheduleSha256: performanceObservationScheduleSha256(schedule)
    },
    samples: schedule.map((entry, index) => sample(
      entry,
      entry.phase === 'warmup' ? index + 1 : index + 101
    ))
  }
}

const twoDocumentInput = () => {
  const base = input('smoke-non-ratifying', 1, 1)
  const schedule = createPerformanceObservationSchedule({
    documentIds: ['doc-a', 'doc-b'],
    warmupSamples: 1,
    measuredSamples: 1
  })
  return {
    ...base,
    documents: [
      { id: 'doc-a', sourceSha256: 'a'.repeat(64) },
      { id: 'doc-b', sourceSha256: 'b'.repeat(64) }
    ],
    provenance: {
      ...base.provenance,
      applicationLaunchCount: 4,
      uniqueProfileCount: 4,
      applicationCloseCount: 4,
      profileCleanupCount: 4,
      observationScheduleSha256: performanceObservationScheduleSha256(schedule)
    },
    samples: schedule.map((entry, index) => sample(entry, index + 1))
  }
}

describe('upstream baseline raw performance producer', () => {
  it('creates an accepted v12 shape only for pinned isolated scheduled 20/200 ratification evidence', () => {
    const run = createUpstreamBaselinePerformanceRawRun(
      input('ratification', 20, 200)
    )

    expect(run).toMatchObject({
      schema: 'marktext-criticmarkup-raw-performance-run-v12',
      runId: 'upstream-ratification',
      implementation: 'upstream-baseline',
      baselineCommit: PINNED_BASELINE,
      buildCommit: PINNED_BASELINE,
      sampling: { warmupSamples: 20, measuredSamples: 200 },
      provenance: {
        detachedWorktreeHead: PINNED_BASELINE,
        detachedWorktreeClean: true,
        harnessCommit: '2'.repeat(40),
        lockfileSha256: 'd'.repeat(64),
        producerSha256: 'e'.repeat(64),
        probeSha256: 'f'.repeat(64),
        launcherSha256: '1'.repeat(64),
        measurementBoundary: 'external-browser-compositor-v4',
        presentationBoundary: 'electron-webcontents-capture-page-transparent-v2',
        launchBoundary: 'external-inspector-transparent-render-active-v3',
        windowPresentationPolicy: 'transparent-render-active-inactive-v6',
        windowPresentationPlatform: 'darwin',
        chromiumSchedulingPolicy: 'hidden-unthrottled-rendering-v2',
        displaySleepPolicy:
          'runner-owned-caffeinate-display-sleep-prevention-v1',
        sampleLifecycle: 'fresh-application-profile-per-observation-v1',
        applicationLaunchCount: 220,
        uniqueProfileCount: 220,
        applicationCloseCount: 220,
        profileCleanupCount: 220,
        observationSchedule: PERFORMANCE_OBSERVATION_SCHEDULE,
        observationScheduleSha256: expect.stringMatching(/^[0-9a-f]{64}$/u)
      },
      metricDefinitions: {
        t_echo: 'Elapsed time from beforeinput to the exact matching Muya DOM state.',
        t_present: expect.stringMatching(
          /WebContents\.capturePage.*stayHidden.*stayAwake.*upper bound/i
        ),
        open: 'External elapsed time from file-open request until its tab is active.',
        first_viewport: 'External elapsed time from file-open request until its editor is editable.'
      }
    })
    expect(run.documents[0]?.warmup.t_echo).toHaveLength(20)
    expect(run.documents[0]?.measured.t_present).toHaveLength(200)
    expect(run.observationOrder).toEqual(
      input('ratification', 20, 200).samples.map(({
        ordinal,
        phase,
        phaseRound,
        roundPosition,
        documentId
      }) => ({ ordinal, phase, phaseRound, roundPosition, documentId }))
    )
    expect(Object.isFrozen(run.observationOrder)).toBe(true)
  })

  it('marks configurable smoke output with a schema rejected by ratification', () => {
    const smoke = createUpstreamBaselinePerformanceRawRun(
      input('smoke-non-ratifying', 1, 2)
    )

    expect(smoke).toMatchObject({
      schema: 'marktext-criticmarkup-raw-performance-smoke-v12',
      evidenceClass: 'smoke-non-ratifying',
      sampling: { warmupSamples: 1, measuredSamples: 2 }
    })
    expect(() => createUpstreamBaselinePerformanceRawRun(
      input('ratification', 1, 2)
    )).toThrow(/ratification.*20 warmup and 200 measured/i)
  })

  it('rejects stale provenance, unordered observations, and incomplete documents', () => {
    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...input('smoke-non-ratifying', 1, 2),
      buildCommit: 'd'.repeat(40)
    })).toThrow(/build commit.*pinned baseline/i)
    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...input('smoke-non-ratifying', 1, 2),
      provenance: {
        ...input('smoke-non-ratifying', 1, 2).provenance,
        launcherSha256: 'not-a-digest'
      }
    })).toThrow(/launcher digest/i)

    const invalid = input('smoke-non-ratifying', 1, 2)
    const invalidSample = invalid.samples[0]
    if (invalidSample === undefined) throw new Error('Synthetic sample is missing')
    invalid.samples[0] = {
      ...invalidSample,
      report: { ...invalidSample.report, t_present: 0 }
    }
    expect(() => createUpstreamBaselinePerformanceRawRun(invalid))
      .toThrow(/timing order/i)

    const staleMetric = input('smoke-non-ratifying', 1, 2)
    const staleReport = staleMetric.samples[0]?.report as unknown as
      Record<string, unknown>
    staleReport.t_frame = staleReport.t_present
    delete staleReport.t_present
    expect(() => createUpstreamBaselinePerformanceRawRun(staleMetric as never))
      .toThrow(/metrics must be exactly.*t_present/i)

    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...input('smoke-non-ratifying', 1, 2),
      samples: input('smoke-non-ratifying', 1, 2).samples.slice(0, 2)
    })).toThrow(/observation schedule expected 3 entries but received 2/i)
  })

  it('rejects swapped, duplicate, missing, or relabeled scheduled observations', () => {
    const swapped = twoDocumentInput()
    ;[swapped.samples[0], swapped.samples[1]] = [
      swapped.samples[1] as UpstreamBaselinePerformanceRawSample,
      swapped.samples[0] as UpstreamBaselinePerformanceRawSample
    ]
    expect(() => createUpstreamBaselinePerformanceRawRun(swapped))
      .toThrow(/observation schedule.*ordinal 1/i)

    const duplicate = twoDocumentInput()
    duplicate.samples[1] = duplicate.samples[0] as UpstreamBaselinePerformanceRawSample
    expect(() => createUpstreamBaselinePerformanceRawRun(duplicate))
      .toThrow(/observation schedule.*ordinal 2/i)

    const missing = twoDocumentInput()
    missing.samples.pop()
    expect(() => createUpstreamBaselinePerformanceRawRun(missing))
      .toThrow(/observation schedule.*4.*3/i)

    const relabeled = twoDocumentInput()
    const measured = relabeled.samples[2]
    if (measured === undefined) throw new Error('Synthetic measured sample is missing')
    relabeled.samples[2] = { ...measured, phase: 'warmup' }
    expect(() => createUpstreamBaselinePerformanceRawRun(relabeled))
      .toThrow(/observation schedule.*ordinal 3/i)
  })

  it('rejects a schedule policy or digest not regenerated from documents and counts', () => {
    const policy = twoDocumentInput()
    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...policy,
      provenance: {
        ...policy.provenance,
        observationSchedule: 'document-major-v0'
      }
    } as never)).toThrow(/observation schedule policy/i)

    const digest = twoDocumentInput()
    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...digest,
      provenance: {
        ...digest.provenance,
        observationScheduleSha256: 'f'.repeat(64)
      }
    })).toThrow(/observation schedule digest/i)
  })

  it('rejects absent or mismatched hidden Chromium scheduling provenance', () => {
    const absent = input('smoke-non-ratifying', 1, 2)
    const absentProvenance = {
      ...absent.provenance
    } as Record<string, unknown>
    delete absentProvenance.chromiumSchedulingPolicy
    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...absent,
      provenance: absentProvenance
    } as never)).toThrow(/Chromium scheduling/i)

    const absentDisplaySleep = input('smoke-non-ratifying', 1, 2)
    const absentDisplaySleepProvenance = {
      ...absentDisplaySleep.provenance
    } as Record<string, unknown>
    delete absentDisplaySleepProvenance.displaySleepPolicy
    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...absentDisplaySleep,
      provenance: absentDisplaySleepProvenance
    } as never)).toThrow(/display sleep/i)

    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...input('smoke-non-ratifying', 1, 2),
      provenance: {
        ...input('smoke-non-ratifying', 1, 2).provenance,
        displaySleepPolicy: 'unmanaged-display-sleep-v0'
      }
    } as never)).toThrow(/display sleep/i)

    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...input('smoke-non-ratifying', 1, 2),
      provenance: {
        ...input('smoke-non-ratifying', 1, 2).provenance,
        chromiumSchedulingPolicy: 'hidden-unthrottled-rendering-v1'
      }
    } as never)).toThrow(/Chromium scheduling/i)

    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...input('smoke-non-ratifying', 1, 2),
      provenance: {
        ...input('smoke-non-ratifying', 1, 2).provenance,
        measurementBoundary: 'external-browser-compositor-v3'
      }
    } as never)).toThrow(/measurement boundary/i)

    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...input('smoke-non-ratifying', 1, 2),
      provenance: {
        ...input('smoke-non-ratifying', 1, 2).provenance,
        presentationBoundary: 'electron-webcontents-capture-page-hidden-v1'
      }
    } as never)).toThrow(/presentation boundary/i)

    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...input('smoke-non-ratifying', 1, 2),
      provenance: {
        ...input('smoke-non-ratifying', 1, 2).provenance,
        launchBoundary: 'external-inspector-transparent-render-active-v2'
      }
    } as never)).toThrow(/launch boundary/i)

    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...input('smoke-non-ratifying', 1, 2),
      provenance: {
        ...input('smoke-non-ratifying', 1, 2).provenance,
        windowPresentationPolicy: 'transparent-render-active-inactive-v2'
      }
    } as never)).toThrow(/window presentation/i)

    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...input('smoke-non-ratifying', 1, 2),
      provenance: {
        ...input('smoke-non-ratifying', 1, 2).provenance,
        windowPresentationPlatform: 'linux'
      }
    } as never)).toThrow(/window presentation platform/i)
  })

  it.each([
    ['sampleLifecycle', 'pooled-application-per-document', /sample lifecycle/i],
    ['applicationLaunchCount', 2, /application launch count/i],
    ['uniqueProfileCount', 2, /unique profile count/i],
    ['applicationCloseCount', 2, /application close count/i],
    ['profileCleanupCount', 2, /profile cleanup count/i]
  ] as const)(
    'rejects non-isolated lifecycle provenance field %s',
    (field, value, expected) => {
      const candidate = input('smoke-non-ratifying', 1, 2)
      expect(() => createUpstreamBaselinePerformanceRawRun({
        ...candidate,
        provenance: {
          ...candidate.provenance,
          [field]: value
        }
      } as never)).toThrow(expected)
    }
  )

  it('writes exclusively and never allows smoke into the ratification directory', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'marktext-upstream-raw-'))
    try {
      const ratification = createUpstreamBaselinePerformanceRawRun(
        input('ratification', 20, 200)
      )
      const output = resolve(root, 'ratification.json')
      writeUpstreamBaselinePerformanceRawRun(output, ratification)
      expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(ratification)
      expect(() => writeUpstreamBaselinePerformanceRawRun(output, ratification))
        .toThrow(/refusing to replace/i)

      const smoke = createUpstreamBaselinePerformanceRawRun(
        input('smoke-non-ratifying', 1, 2)
      )
      expect(() => writeUpstreamBaselinePerformanceRawRun(
        resolve(root, 'specs/baselines/runs/performance/smoke.json'),
        smoke
      )).toThrow(/smoke.*ratification directory/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
