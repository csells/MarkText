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

type PlanningVisitEvent = Extract<
  ProfileParseTraceEventV1,
  { readonly kind: 'projection-planning-range-visit' }
>

function planningVisits(
  events: readonly ProfileParseTraceEventV1[]
): readonly PlanningVisitEvent[] {
  return events.filter(
    (event): event is PlanningVisitEvent =>
      event.kind === 'projection-planning-range-visit'
  )
}

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
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

const TICK = String.fromCharCode(96)

function planningWork(repetitions: number): number {
  const arm = '{~~old~>B' + TICK + 'C~~}'
  const interior = ('B' + TICK + 'C').repeat(repetitions)
  const source =
    '{++' + TICK + '++}A' + arm.repeat(repetitions) + 'D{++' + TICK + '++}'
  const candidate = TICK + 'A' + interior + 'D' + TICK
  const expected = TICK.repeat(2) + 'A' + interior + 'D' + TICK.repeat(2)
  const engine = createLanguageEngine()
  const captured = captureProfileParseTraceV1(engine, () =>
    engine.open(createSourceSnapshot(source), TEST_CONFIGURATION)
  )

  const revision = captured.value
  expect(revision.kind).toBe('complete')
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete document revision')
  }
  const revised = revision.projection('revised')
  expect(revised.source).toBe(expected)
  expect(revised.markdown.root.childAt(0).childAt(0)).toMatchObject({
    kind: 'inline-code',
    attributes: { markerLength: 2 }
  })

  const visits = planningVisits(captured.trace.events).filter((event) =>
    event.view === 'revised' &&
    event.reason === 'inline-code-extension-analysis'
  )
  return candidate.length + visits.reduce(
    (sum, event) => sum + event.range.end - event.range.start,
    0
  )
}

function crossScopeBacktickLookupWork(repetitions: number): Readonly<{
  readonly queries: number
  readonly candidates: number
}> {
  const source = ('{~~o~>' + TICK + 'a~~}').repeat(repetitions)
  const engine = createLanguageEngine()
  const captured = captureProfileParseTraceV1(engine, () =>
    engine.open(createSourceSnapshot(source), TEST_CONFIGURATION)
  )

  expect(captured.value.kind).toBe('complete')
  const revisedEvents = planningVisits(captured.trace.events).filter(
    (event) => event.view === 'revised'
  )
  return Object.freeze({
    queries: revisedEvents.filter((event) =>
      event.reason === 'inline-code-closer-query'
    ).length,
    candidates: revisedEvents.filter((event) =>
      event.reason === 'inline-code-closer-candidate'
    ).length
  })
}

describe('Profile 1 projection planning complexity', () => {
  it('plans repeated arm-local code boundaries with linear source visits', () => {
    const small = planningWork(64)
    const large = planningWork(128)

    expect(large).toBeLessThanOrEqual(small * 2)
  })

  it('looks up cross-scope backtick closers with linear indexed work', () => {
    const repetitions = 64
    const work = crossScopeBacktickLookupWork(repetitions)

    expect(work.queries).toBe(repetitions)
    expect(work.candidates).toBeLessThanOrEqual(repetitions)
  })

  it('plans arm terminations with indexed fence probes, not lane rescans', () => {
    const armTerminationProbes = (repetitions: number): number => {
      const source = '{~~o~>a~~}'.repeat(repetitions)
      const engine = createLanguageEngine()
      const captured = captureProfileParseTraceV1(engine, () =>
        engine.open(createSourceSnapshot(source), TEST_CONFIGURATION)
      )
      expect(captured.value.kind).toBe('complete')
      return planningVisits(captured.trace.events).filter(
        (event) =>
          event.view === 'revised' &&
          event.reason === 'arm-termination-fence-probe'
      ).length
    }

    // One indexed probe per arm exit; a per-exit rescan of the parent lane's
    // transitions is the quadratic this pins down (R-4).
    expect(armTerminationProbes(64)).toBeLessThanOrEqual(64)
  })

  it('carries substitution scopes through codec edits without a post-hoc join', () => {
    const engine = createLanguageEngine()
    const captured = captureProfileParseTraceV1(engine, () =>
      engine.open(
        createSourceSnapshot('{~~o~>a~~}'.repeat(64)),
        TEST_CONFIGURATION
      )
    )
    expect(captured.value.kind).toBe('complete')
    expect(captured.trace.events.filter(
      (event) => event.kind === 'source-progression'
    )).toEqual([{
      kind: 'source-progression',
      owner: 'markdown-kernel'
    }])
  })

  it('materializes line-path prefixes with amortized-linear chunk walks', () => {
    const walks = (repetitions: number): number => {
      const source = '{~~o~>a~~}'.repeat(repetitions)
      const engine = createLanguageEngine()
      const revision = engine.open(createSourceSnapshot(source), TEST_CONFIGURATION)
      expect(revision.kind).toBe('complete')
      return engine.traversalCounts().lineMaterializationChunkWalks
    }

    const small = walks(64)
    const large = walks(128)
    expect(large).toBeLessThanOrEqual(small * 3)
  })

  it('retains only a bounded number of materialized long-line prefixes', () => {
    const source = 'x'.repeat(4_096 * 64)
    const engine = createLanguageEngine()
    const revision = engine.open(
      createSourceSnapshot(source),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    // Live long-line entries are retentions minus evictions; the LRU keeps
    // at most four, and the counters prove it without a cache seam.
    const counts = engine.traversalCounts()
    expect(
      counts.longLineMaterializationRetained -
      counts.longLineMaterializationEvicted
    ).toBeLessThanOrEqual(4)
  })

  it('fails closed instead of hiding nested trace work', () => {
    const engine = createLanguageEngine()

    expect(() => captureProfileParseTraceV1(engine, () =>
      captureProfileParseTraceV1(engine, () =>
        engine.open(createSourceSnapshot('plain'), TEST_CONFIGURATION)
      )
    )).toThrow(/nested/i)
  })

  it('fails closed when a trace operation escapes asynchronously', () => {
    const engine = createLanguageEngine()

    expect(() => captureProfileParseTraceV1(engine, () =>
      Promise.resolve('later')
    )).toThrow(/synchronous/i)
  })
})
