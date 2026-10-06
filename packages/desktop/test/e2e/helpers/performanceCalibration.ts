import fs from 'node:fs'
import path from 'node:path'
import type { Page } from 'playwright'

import {
  performanceCalibrationReference,
  summarizePerformanceCalibration,
  type PerformanceCalibrationReference,
  type PerformanceCalibrationSummary,
  type PerformanceRunCalibrationReference
} from '../../../../../scripts/criticmarkupPerformanceTargets'
import { installKeyCalibration, readKeyCalibration } from './warmSessionDiagnostics'

const TARGETS = path.resolve(__dirname, '../../../../../specs/baselines/criticmarkup-performance-targets.json')

/** The calibration reference and rule the target manifest pins for this hardware. */
export const loadPerformanceCalibration = (): PerformanceCalibrationReference =>
  performanceCalibrationReference(
    (JSON.parse(fs.readFileSync(TARGETS, 'utf8')) as { calibration?: unknown }).calibration
  )

/**
 * A run's calibration loop numbers, recorded as information beside its
 * results: they never make a run invalid (owner decision 2026-10-06).
 */
export interface PerformanceCalibrationRecord {
  readonly loop: PerformanceCalibrationReference['loop']
  readonly referenceP50Ms: number
  readonly summary: PerformanceCalibrationSummary
}

/**
 * Starts timing the manifest's fixed loop after every key from here on.
 * Install it after warmup, so that only measured keys are timed.
 */
export const startPerformanceCalibration = async(page: Page): Promise<void> => {
  await installKeyCalibration(page, 'keyup')
}

/** Summarizes the loop times recorded since `startPerformanceCalibration`. */
export const readPerformanceCalibration = async(
  page: Page,
  reference: PerformanceRunCalibrationReference
): Promise<PerformanceCalibrationRecord> => {
  const summary = summarizePerformanceCalibration(await readKeyCalibration(page))
  return Object.freeze({ loop: reference.loop, referenceP50Ms: reference.referenceP50Ms, summary })
}

/**
 * Times the manifest's loop eight times, 40 ms apart, after the keyup
 * timing's warmup (`PERFORMANCE_CALIBRATION_PROBE`). A fresh-application
 * observation has one key, too few to time at keyup, so it probes right
 * after its measurement instead.
 */
export const probePerformanceCalibration = async(
  page: Page,
  reference: PerformanceRunCalibrationReference
): Promise<PerformanceCalibrationRecord> => {
  const times = await page.evaluate(async() => {
    const spin = (count: number): number => {
      let value = 0
      for (let index = 0; index < count; index += 1) value = (value * 31 + index) | 0
      return value
    }
    for (let index = 0; index < 400; index += 1) spin(3000)
    const loopTimes: number[] = []
    for (let index = 0; index < 8; index += 1) {
      await new Promise(resolve => setTimeout(resolve, 40))
      const start = performance.now()
      const value = spin(300_000)
      // Using the value keeps the loop from being optimized away.
      loopTimes.push(performance.now() - start + (value === 0.5 ? 1 : 0))
    }
    return loopTimes
  })
  return Object.freeze({
    loop: reference.loop,
    referenceP50Ms: reference.referenceP50Ms,
    summary: summarizePerformanceCalibration(times)
  })
}

/** One line naming a run's loop numbers, for the run's log. */
export const describePerformanceCalibration = (
  name: string,
  record: PerformanceCalibrationRecord
): string =>
  `[calibration] ${name}: loop p50 ${String(record.summary.p50)} p90 ${String(record.summary.p90)} ms ` +
  `(reference ${String(record.referenceP50Ms)}, information only)`
