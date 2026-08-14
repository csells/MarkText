import { createHash } from 'node:crypto'

export const PERFORMANCE_OBSERVATION_SCHEDULE =
  'warmup-then-measured-rotating-round-robin-v1' as const

export type PerformanceObservationPhase = 'warmup' | 'measured'

export interface PerformanceObservationScheduleEntry {
  readonly ordinal: number
  readonly phase: PerformanceObservationPhase
  readonly phaseRound: number
  readonly roundPosition: number
  readonly documentId: string
}

export interface PerformanceObservationScheduleInput {
  readonly documentIds: readonly string[]
  readonly warmupSamples: number
  readonly measuredSamples: number
}

export const createPerformanceObservationSchedule = (
  input: PerformanceObservationScheduleInput
): readonly Readonly<PerformanceObservationScheduleEntry>[] => {
  if (input.documentIds.length === 0) {
    throw new Error('Performance observation document IDs must be non-empty')
  }
  if (input.documentIds.some(documentId => !documentId.trim())) {
    throw new Error('Performance observation document ID must be non-empty')
  }
  if (new Set(input.documentIds).size !== input.documentIds.length) {
    throw new Error('Performance observation document IDs must be unique')
  }
  if (
    !Number.isSafeInteger(input.warmupSamples) ||
    input.warmupSamples < 1 ||
    !Number.isSafeInteger(input.measuredSamples) ||
    input.measuredSamples < 1
  ) {
    throw new Error('Performance observation sample counts must be positive integers')
  }

  const schedule: PerformanceObservationScheduleEntry[] = []
  let startPosition = 0

  const appendPhase = (
    phase: PerformanceObservationPhase,
    rounds: number
  ): void => {
    for (let round = 0; round < rounds; round += 1) {
      for (let position = 0; position < input.documentIds.length; position += 1) {
        const documentId = input.documentIds[
          (startPosition + position) % input.documentIds.length
        ]
        if (documentId === undefined) {
          throw new Error('Performance observation document is missing')
        }
        schedule.push(Object.freeze({
          ordinal: schedule.length + 1,
          phase,
          phaseRound: round + 1,
          roundPosition: position + 1,
          documentId
        }))
      }
      startPosition = (startPosition + 1) % input.documentIds.length
    }
  }

  appendPhase('warmup', input.warmupSamples)
  appendPhase('measured', input.measuredSamples)
  return Object.freeze(schedule)
}

export const canonicalPerformanceObservationScheduleJson = (
  schedule: readonly Readonly<PerformanceObservationScheduleEntry>[]
): string => JSON.stringify(schedule.map(entry => [
  entry.ordinal,
  entry.phase,
  entry.phaseRound,
  entry.roundPosition,
  entry.documentId
]))

export const performanceObservationScheduleSha256 = (
  schedule: readonly Readonly<PerformanceObservationScheduleEntry>[]
): string => createHash('sha256')
  .update(canonicalPerformanceObservationScheduleJson(schedule), 'utf8')
  .digest('hex')
