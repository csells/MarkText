import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL,
  PARSE_SOURCE_CHECKPOINT_INTERVAL,
  type ParseConfiguration,
  type ParseExecutionProgress
} from '@marktext/document-core'
import { createParseExecutionTracker } from '../../src/parseExecutionControl.js'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('production parse execution control', () => {
  it('reports monotonic cumulative work within both checkpoint ceilings', () => {
    const progress: ParseExecutionProgress[] = []
    const revision = createLanguageEngine().open(
      createSourceSnapshot(
        `${'plain source '.repeat(2_000)}\n\n{~~old~>new~~}\n`
      ),
      TEST_CONFIGURATION,
      {
        checkpoint: (checkpoint) => {
          progress.push(checkpoint)
        }
      }
    )
    expect(revision.kind).toBe('complete')
    expect(progress.length).toBeGreaterThan(1)

    let previous: ParseExecutionProgress = {
      sourceUnits: 0,
      logicalNodes: 0
    }
    for (const checkpoint of progress) {
      const sourceDelta = checkpoint.sourceUnits - previous.sourceUnits
      const nodeDelta = checkpoint.logicalNodes - previous.logicalNodes
      expect(sourceDelta).toBeGreaterThanOrEqual(0)
      expect(nodeDelta).toBeGreaterThanOrEqual(0)
      expect(sourceDelta).toBeLessThanOrEqual(
        PARSE_SOURCE_CHECKPOINT_INTERVAL
      )
      expect(nodeDelta).toBeLessThanOrEqual(
        PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL
      )
      previous = checkpoint
    }
    expect(previous.sourceUnits).toBeGreaterThan(0)
    expect(previous.logicalNodes).toBeGreaterThan(0)
  })

  it('propagates cancellation from a checkpoint during one long source run', () => {
    const cancellation = new Error('cancelled-at-production-checkpoint')
    let lastSourceUnits = 0
    expect(() => createLanguageEngine().open(
      createSourceSnapshot('x'.repeat(1_000_000)),
      TEST_CONFIGURATION,
      {
        checkpoint: (progress) => {
          lastSourceUnits = progress.sourceUnits
          if (progress.sourceUnits >= PARSE_SOURCE_CHECKPOINT_INTERVAL * 2) {
            throw cancellation
          }
        }
      }
    )).toThrow(cancellation)
    expect(lastSourceUnits).toBe(PARSE_SOURCE_CHECKPOINT_INTERVAL * 2)
  })

  it('polls non-accounting parser work at the logical checkpoint ceiling', () => {
    const workAtCheckpoint: number[] = []
    let work = 0
    const tracker = createParseExecutionTracker({
      checkpoint: (progress) => {
        expect(progress).toEqual({ sourceUnits: 0, logicalNodes: 0 })
        workAtCheckpoint.push(work)
      }
    })
    const totalWork = PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL * 2 + 1
    for (let ordinal = 0; ordinal < totalWork; ordinal += 1) {
      work += 1
      tracker.examineParserWork(1)
    }
    tracker.finish()
    expect(workAtCheckpoint).toEqual([
      PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL,
      PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL * 2,
      totalWork
    ])
  })

  it('propagates cancellation from parser-owned document-index work', () => {
    const cancellation = new Error('cancelled-in-document-index')
    let previous: ParseExecutionProgress | undefined
    let stableCheckpoint: ParseExecutionProgress | undefined
    expect(() => createLanguageEngine().open(
      createSourceSnapshot(`${'# heading\n\n'.repeat(3_000)}`),
      TEST_CONFIGURATION,
      {
        checkpoint: (progress) => {
          if (
            previous?.sourceUnits === progress.sourceUnits &&
            previous.logicalNodes === progress.logicalNodes
          ) {
            stableCheckpoint = progress
            throw cancellation
          }
          previous = progress
        }
      }
    )).toThrow(cancellation)
    expect(stableCheckpoint).toEqual(previous)
    expect(stableCheckpoint).toBeDefined()
  })
})
