export const PARSE_SOURCE_CHECKPOINT_INTERVAL = 4_096
const PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL = 2_048

export interface ParseExecutionTracker {
  readonly examineSource: (units: number) => void
  readonly emitLogicalNode: () => void
  /**
   * Count work that must remain outside the public syntax-accounting totals.
   *
   * Parser-owned indexing and similar physical passes report here without
   * inventing syntax events.
   */
  readonly examineParserWork: (units: number) => void
  readonly finish: () => void
}

export function createParseExecutionTracker(): ParseExecutionTracker {
  let sourceUnits = 0
  let logicalNodes = 0
  let checkpointSourceUnits = 0
  let checkpointLogicalNodes = 0
  let parserWorkSinceCheckpoint = 0

  const checkpoint = (): void => {
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
