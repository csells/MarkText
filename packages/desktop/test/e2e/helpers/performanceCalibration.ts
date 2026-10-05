import fs from 'node:fs'
import path from 'node:path'
import type { Page } from 'playwright'

import {
  performanceCalibrationReference,
  performanceRunValidity,
  summarizePerformanceCalibration,
  type PerformanceCalibrationReference,
  type PerformanceCalibrationSummary,
  type PerformanceRunValidity
} from '../../../../../scripts/criticmarkupPerformanceTargets'
import { installKeyCalibration, readKeyCalibration } from './warmSessionDiagnostics'

const TARGETS = path.resolve(__dirname, '../../../../../specs/baselines/criticmarkup-performance-targets.json')

/** The calibration reference and rule the target manifest pins for this hardware. */
export const loadPerformanceCalibration = (): PerformanceCalibrationReference =>
  performanceCalibrationReference(
    (JSON.parse(fs.readFileSync(TARGETS, 'utf8')) as { calibration?: unknown }).calibration
  )

/** A run's calibration loop numbers and whether they make the run valid. */
export interface PerformanceCalibrationVerdict {
  readonly loop: PerformanceCalibrationReference['loop']
  readonly referenceP50Ms: number
  readonly maximumP50Ms: number
  readonly summary: PerformanceCalibrationSummary
  readonly validity: PerformanceRunValidity
}

/**
 * Starts timing the manifest's fixed loop after every key from here on.
 * Install it after warmup, so that only measured keys are timed.
 */
export const startPerformanceCalibration = async(page: Page): Promise<void> => {
  await installKeyCalibration(page, 'keyup')
}

/** Judges the loop times recorded since `startPerformanceCalibration`. */
export const readPerformanceCalibration = async(
  page: Page,
  reference: PerformanceCalibrationReference
): Promise<PerformanceCalibrationVerdict> => {
  const summary = summarizePerformanceCalibration(await readKeyCalibration(page))
  return Object.freeze({
    loop: reference.loop,
    referenceP50Ms: reference.referenceP50Ms,
    maximumP50Ms: reference.referenceP50Ms * (1 + reference.maximumExcess),
    summary,
    validity: performanceRunValidity(summary, reference)
  })
}

/** One line naming a run's loop numbers and verdict, for the run's log. */
export const describePerformanceCalibration = (
  name: string,
  attempt: number,
  verdict: PerformanceCalibrationVerdict
): string =>
  `[calibration] ${name} attempt ${String(attempt)}: ${verdict.validity}, loop p50 ` +
  `${String(verdict.summary.p50)} p90 ${String(verdict.summary.p90)} ms ` +
  `(reference ${String(verdict.referenceP50Ms)}, limit ${verdict.maximumP50Ms.toFixed(2)})`
