import { describe, expect, it } from 'vitest'
import {
  createParseExecutionAccumulator,
  PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL,
  PARSE_SOURCE_CHECKPOINT_INTERVAL,
  sourceHashV1,
  type ParseExecutionProgress
} from '@marktext/document-core'

describe('parse execution progress accumulator', () => {
  it('translates stage-local cumulative progress into one monotone stream', () => {
    const observed: ParseExecutionProgress[] = []
    const accumulator = createParseExecutionAccumulator({
      checkpoint: (progress) => {
        observed.push(progress)
      }
    })

    const hash = accumulator.stage()
    hash.checkpoint({ sourceUnits: 4_096, logicalNodes: 0 })
    hash.checkpoint({ sourceUnits: 6_000, logicalNodes: 0 })
    const parser = accumulator.stage()
    parser.checkpoint({ sourceUnits: 4_096, logicalNodes: 2_048 })
    parser.checkpoint({ sourceUnits: 5_000, logicalNodes: 2_100 })

    expect(observed).toEqual([
      { sourceUnits: 4_096, logicalNodes: 0 },
      { sourceUnits: 6_000, logicalNodes: 0 },
      { sourceUnits: 10_096, logicalNodes: 2_048 },
      { sourceUnits: 11_000, logicalNodes: 2_100 }
    ])
  })

  it('rejects a stage that skips either production checkpoint ceiling', () => {
    const accumulator = createParseExecutionAccumulator({
      checkpoint: () => undefined
    })

    expect(() => accumulator.stage().checkpoint({
      sourceUnits: PARSE_SOURCE_CHECKPOINT_INTERVAL + 1,
      logicalNodes: 0
    })).toThrow(/source checkpoint ceiling/)
    expect(() => accumulator.stage().checkpoint({
      sourceUnits: 0,
      logicalNodes: PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL + 1
    })).toThrow(/logical-node checkpoint ceiling/)
  })

  it('checks cancellation from the pre-parser source-hash loop', () => {
    const cancellation = new Error('cancelled-during-source-hash')
    const checkpoints: ParseExecutionProgress[] = []

    expect(() => sourceHashV1('x'.repeat(1_000_000), {
      checkpoint: (progress) => {
        checkpoints.push(progress)
        if (progress.sourceUnits === PARSE_SOURCE_CHECKPOINT_INTERVAL * 2) {
          throw cancellation
        }
      }
    })).toThrow(cancellation)
    expect(checkpoints).toEqual([
      { sourceUnits: PARSE_SOURCE_CHECKPOINT_INTERVAL, logicalNodes: 0 },
      {
        sourceUnits: PARSE_SOURCE_CHECKPOINT_INTERVAL * 2,
        logicalNodes: 0
      }
    ])
  })
})
