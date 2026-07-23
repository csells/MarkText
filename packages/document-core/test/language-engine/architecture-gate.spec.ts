import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  captureProfileParseTraceV1,
  type ProfileParseTraceEventV1
} from '../../src/internal/profileParseTraceV1.js'

/**
 * The Phase 0 blocking architecture gate.
 *
 * Plan 0009 requires the Profile 1 Markdown parser to own canonical source
 * progression and to emit CriticMarkup as native grammar productions, with every
 * derived product built from parser-created identity. Until 2026-07-22 no test
 * could observe whether that was true, so nine tranches grew the opposite
 * architecture while the suite stayed green.
 *
 * This gate makes the architecture executable. It asserts over
 * `ProfileParseTraceV1`, which records what actually consumed canonical source
 * and what each authoritative CST was built from.
 *
 * Rows marked `it.fails` are the known blocking gap: they document the
 * target-incompatible ownership that Phase 0 must remove. When the intrinsic
 * kernel lands they will start failing *because they pass* — delete the
 * `.fails` at that point. Do not "fix" them by weakening the assertion.
 */

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

const CRITIC_FREE_SOURCE = '# Title\n\nHello *world* and `code`.\n'
const CRITIC_SOURCE = 'a{++new++}b\n'

function traceOf(source: string): readonly ProfileParseTraceEventV1[] {
  const engine = createLanguageEngine()
  const captured = captureProfileParseTraceV1(engine, () =>
    engine.open(createSourceSnapshot(source), TEST_CONFIGURATION)
  )
  expect(captured.value.kind).toBe('complete')
  return captured.trace.events
}

const admissions = (
  events: readonly ProfileParseTraceEventV1[]
): readonly ProfileParseTraceEventV1[] =>
  events.filter((event) => event.kind === 'canonical-source-admission')

const progressionOwners = (
  events: readonly ProfileParseTraceEventV1[]
): readonly string[] =>
  events.flatMap((event) =>
    event.kind === 'source-progression' ? [event.owner] : []
  )

const authoritativeInputs = (
  events: readonly ProfileParseTraceEventV1[]
): readonly string[] =>
  events.flatMap((event) =>
    event.kind === 'authoritative-markdown-parse' ? [event.input] : []
  )

const postHocJoins = (
  events: readonly ProfileParseTraceEventV1[]
): readonly string[] =>
  events.flatMap((event) =>
    event.kind === 'post-hoc-join' ? [event.join] : []
  )

describe('Phase 0 intrinsic-parser architecture gate', () => {
  describe('canonical source admission', () => {
    it('admits canonical source exactly once for a CriticMarkup-free document', () => {
      expect(admissions(traceOf(CRITIC_FREE_SOURCE))).toHaveLength(1)
    })

    it('admits canonical source exactly once for a CriticMarkup document', () => {
      expect(admissions(traceOf(CRITIC_SOURCE))).toHaveLength(1)
    })
  })

  describe('CriticMarkup-free documents — the intrinsic kernel beachhead', () => {
    it('gives the Markdown kernel ownership of source progression', () => {
      expect(progressionOwners(traceOf(CRITIC_FREE_SOURCE)))
        .not.toContain('criticmarkup-driver')
    })

    it('builds every authoritative CST from canonical source', () => {
      expect(authoritativeInputs(traceOf(CRITIC_FREE_SOURCE)))
        .not.toContain('flattened-projection')
    })

    it('reparses canonical source no more than once', () => {
      const reparses = traceOf(CRITIC_FREE_SOURCE).filter(
        (event) => event.kind === 'canonical-reparse'
      )
      expect(reparses).toHaveLength(0)
    })
  })

  describe('CriticMarkup documents — BLOCKING Phase 0 gap', () => {
    it.fails(
      'BLOCKING: a CriticMarkup state machine still owns source progression',
      () => {
        expect(progressionOwners(traceOf(CRITIC_SOURCE)))
          .not.toContain('criticmarkup-driver')
      }
    )

    it.fails(
      'BLOCKING: authoritative CSTs are still reparsed from flattened projections',
      () => {
        expect(authoritativeInputs(traceOf(CRITIC_SOURCE)))
          .not.toContain('flattened-projection')
      }
    )

    it.fails(
      'BLOCKING: ownership facts are still joined after parsing',
      () => {
        expect(postHocJoins(traceOf(CRITIC_SOURCE))).toHaveLength(0)
      }
    )
  })
})
