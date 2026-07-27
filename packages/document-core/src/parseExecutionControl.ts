export interface ParseExecutionProgress {
  /** Cumulative UTF-16 units examined by canonical parser work. */
  readonly sourceUnits: number
  /** Cumulative syntax-accounting events emitted by the parser. */
  readonly logicalNodes: number
}

export interface ParseExecutionControl {
  /**
   * Called cooperatively during production parsing. Throwing aborts the parse;
   * an isolated worker uses this seam to poll its shared cancellation flag.
   */
  readonly checkpoint: (progress: ParseExecutionProgress) => void
}

export class DocumentExecutionCancelledError extends Error {
  constructor() {
    super('Document execution was cancelled at a cooperative checkpoint')
    this.name = 'DocumentExecutionCancelledError'
  }
}

export const PARSE_SOURCE_CHECKPOINT_INTERVAL = 4_096
export const PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL = 2_048

export interface ParseExecutionTracker {
  readonly examineSource: (units: number) => void
  readonly emitLogicalNode: () => void
  /**
   * Poll work that must remain outside the public syntax-accounting totals.
   *
   * Parser-owned indexing and similar physical passes use this seam so a long
   * pass remains cancellable without inventing syntax events.
   */
  readonly examineParserWork: (units: number) => void
  readonly finish: () => void
}

export interface ParseExecutionAccumulator {
  /**
   * Begin one synchronous work stage whose checkpoints start at zero.
   *
   * Only the newest stage may report progress. Its local cumulative values are
   * translated onto the accumulator's lifetime totals before reaching the
   * caller's control.
   */
  readonly stage: () => ParseExecutionControl
  readonly progress: () => ParseExecutionProgress
}

function assertProgressValue(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `Parse execution ${name} must be a nonnegative safe integer`
    )
  }
}

/**
 * Join sequential hash/parser stages into one monotone execution stream.
 *
 * Each stage reports cumulative work from zero. The accumulator both translates
 * that local stream and fails closed if a production stage skips either
 * cooperative checkpoint ceiling.
 */
export function createParseExecutionAccumulator(
  control?: ParseExecutionControl
): ParseExecutionAccumulator {
  let sourceUnits = 0
  let logicalNodes = 0
  let activeStage = 0

  return Object.freeze({
    stage: Object.freeze((): ParseExecutionControl => {
      activeStage += 1
      const stage = activeStage
      const sourceBase = sourceUnits
      const logicalNodeBase = logicalNodes
      let localSourceUnits = 0
      let localLogicalNodes = 0
      return Object.freeze({
        checkpoint: Object.freeze((progress: ParseExecutionProgress): void => {
          if (stage !== activeStage) {
            throw new Error(
              'An inactive parse execution stage reported progress'
            )
          }
          assertProgressValue('source units', progress.sourceUnits)
          assertProgressValue('logical nodes', progress.logicalNodes)
          const sourceDelta = progress.sourceUnits - localSourceUnits
          const logicalNodeDelta =
            progress.logicalNodes - localLogicalNodes
          if (sourceDelta < 0 || logicalNodeDelta < 0) {
            throw new Error(
              'Parse execution stage progress must be monotone'
            )
          }
          if (sourceDelta > PARSE_SOURCE_CHECKPOINT_INTERVAL) {
            throw new Error(
              'Parse execution stage exceeded the source checkpoint ceiling'
            )
          }
          if (logicalNodeDelta > PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL) {
            throw new Error(
              'Parse execution stage exceeded the logical-node checkpoint ceiling'
            )
          }
          const next = Object.freeze({
            sourceUnits: sourceBase + progress.sourceUnits,
            logicalNodes: logicalNodeBase + progress.logicalNodes
          })
          assertProgressValue('source units', next.sourceUnits)
          assertProgressValue('logical nodes', next.logicalNodes)
          control?.checkpoint(next)
          sourceUnits = next.sourceUnits
          logicalNodes = next.logicalNodes
          localSourceUnits = progress.sourceUnits
          localLogicalNodes = progress.logicalNodes
        })
      })
    }),
    progress: Object.freeze((): ParseExecutionProgress => Object.freeze({
      sourceUnits,
      logicalNodes
    }))
  })
}

export function createParseExecutionTracker(
  control?: ParseExecutionControl
): ParseExecutionTracker {
  let sourceUnits = 0
  let logicalNodes = 0
  let checkpointSourceUnits = 0
  let checkpointLogicalNodes = 0
  let parserWorkSinceCheckpoint = 0

  const checkpoint = (): void => {
    control?.checkpoint(Object.freeze({ sourceUnits, logicalNodes }))
    checkpointSourceUnits = sourceUnits
    checkpointLogicalNodes = logicalNodes
    parserWorkSinceCheckpoint = 0
  }
  const checkpointWhenDue = (): void => {
    if (
      sourceUnits - checkpointSourceUnits >=
        PARSE_SOURCE_CHECKPOINT_INTERVAL ||
      logicalNodes - checkpointLogicalNodes >=
        PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL ||
      parserWorkSinceCheckpoint >=
        PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL
    ) {
      checkpoint()
    }
  }

  return Object.freeze({
    examineSource: Object.freeze((units: number): void => {
      if (!Number.isSafeInteger(units) || units < 0) {
        throw new RangeError('Parser source work must be a nonnegative safe integer')
      }
      let remaining = units
      while (remaining > 0) {
        const untilCheckpoint =
          PARSE_SOURCE_CHECKPOINT_INTERVAL -
          (sourceUnits - checkpointSourceUnits)
        const consumed = Math.min(remaining, untilCheckpoint)
        sourceUnits += consumed
        remaining -= consumed
        checkpointWhenDue()
      }
    }),
    emitLogicalNode: Object.freeze((): void => {
      logicalNodes += 1
      checkpointWhenDue()
    }),
    examineParserWork: Object.freeze((units: number): void => {
      if (!Number.isSafeInteger(units) || units < 0) {
        throw new RangeError('Parser work must be a nonnegative safe integer')
      }
      let remaining = units
      while (remaining > 0) {
        const untilCheckpoint =
          PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL -
          parserWorkSinceCheckpoint
        const consumed = Math.min(remaining, untilCheckpoint)
        parserWorkSinceCheckpoint += consumed
        remaining -= consumed
        checkpointWhenDue()
      }
    }),
    finish: Object.freeze((): void => {
      if (
        sourceUnits !== checkpointSourceUnits ||
        logicalNodes !== checkpointLogicalNodes ||
        parserWorkSinceCheckpoint !== 0
      ) {
        checkpoint()
      }
    })
  })
}
