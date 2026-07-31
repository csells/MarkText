import { describe, expect, it } from 'vitest'
import { createDocumentSession } from '../../src/documentSession.js'
import type {
  DocumentSession,
  ModelPosition,
  RevisionSourceEdit
} from '../../src/documentSession.js'
import type { MarkupLiveRenderPlan } from '../../src/documentSession.js'
import {
  boundaryNearMarkupCoordinateMap,
  mapPositionThroughEdits,
  nodeModelRangeAtMarkupCoordinateMap
} from '../../src/markupCoordinateMap.js'
import { createSourceSnapshot } from '../../src/sourceSnapshot.js'
import type { ParseConfiguration } from '../../src/revision.js'

const CONFIGURATION: ParseConfiguration = {
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

async function openPlan(source: string): Promise<Readonly<{
  session: DocumentSession
  plan: MarkupLiveRenderPlan
}>> {
  const session = await createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: CONFIGURATION
  })
  const snapshot = session.snapshot()
  if (snapshot.kind !== 'complete') {
    throw new Error(`Expected a complete snapshot, got ${snapshot.kind}`)
  }
  return Object.freeze({ session, plan: snapshot.livePlan })
}

/**
 * The retired run-scan boundary rule, kept verbatim as the equivalence
 * oracle: the authority's span-based boundaryNear must answer exactly what
 * the worker's run walk answered at every source position.
 */
function runScanBoundary(
  plan: MarkupLiveRenderPlan,
  position: ModelPosition
): ModelPosition | null {
  if (plan.runs.length === 0) {
    return Object.freeze({ offset: 0, affinity: position.affinity })
  }
  const exact = plan.modelPositionAt(position)
  if (exact !== null) {
    return exact
  }
  let previous: ModelPosition | null = null
  for (const run of plan.runs) {
    if (
      position.offset >= Number(run.sourceRange.start) &&
      position.offset <= Number(run.sourceRange.end)
    ) {
      return Object.freeze({
        offset:
          run.modelRange.start +
          Math.min(
            position.offset - Number(run.sourceRange.start),
            run.modelRange.end - run.modelRange.start
          ),
        affinity: position.affinity
      })
    }
    if (Number(run.sourceRange.end) < position.offset) {
      previous = Object.freeze({
        offset: run.modelRange.end,
        affinity: position.affinity
      })
      continue
    }
    return previous ?? Object.freeze({
      offset: run.modelRange.start,
      affinity: position.affinity
    })
  }
  return previous
}

const SWEEP_SOURCES: readonly string[] = Object.freeze([
  'plain text only\n',
  'a {++added++} z\n',
  'x {>>hidden note<<} y\n',
  'sub {~~old~>new~~} end\n',
  '{--gone--}{==kept==}\n',
  'a {++x++}{--y--} b {>>c<<} d\n'
])

describe('coordinate authority members', () => {
  it('answers the one nearest-visible-boundary rule the run walk answered', async() => {
    const failures: string[] = []
    for (const source of SWEEP_SOURCES) {
      const { plan } = await openPlan(source)
      for (let offset = 0; offset <= source.length; offset += 1) {
        for (const affinity of ['previous', 'next'] as const) {
          const position = Object.freeze({ offset, affinity })
          const expected = runScanBoundary(plan, position)
          const actual = boundaryNearMarkupCoordinateMap(
            plan.coordinateMap,
            position
          )
          if (
            expected === null ||
            actual.offset !== expected.offset ||
            actual.affinity !== expected.affinity
          ) {
            failures.push(
              `${JSON.stringify(source)}@${offset}/${affinity}: ` +
              `${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`
            )
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('maps positions through edit sets under the declared affinity rule', () => {
    const edits: readonly RevisionSourceEdit[] = Object.freeze([
      Object.freeze({ start: 2, end: 4, insert: 'XYZ' }),
      Object.freeze({ start: 8, end: 8, insert: '!' })
    ])
    const at = (
      offset: number,
      affinity: 'previous' | 'next'
    ): number =>
      mapPositionThroughEdits(Object.freeze({ offset, affinity }), edits).offset

    expect(at(0, 'next')).toBe(0)
    expect(at(2, 'previous')).toBe(2)
    expect(at(2, 'next')).toBe(5)
    expect(at(3, 'next')).toBe(5)
    expect(at(3, 'previous')).toBe(2)
    expect(at(4, 'next')).toBe(5)
    expect(at(6, 'next')).toBe(7)
    expect(at(8, 'previous')).toBe(9)
    expect(at(8, 'next')).toBe(10)
    expect(at(10, 'previous')).toBe(12)
  })

  it('reports the visible model extent of a source range', async() => {
    const source = 'a {++added++} z\n'
    const { plan } = await openPlan(source)
    // The Addition node spans '{++added++}' in source; its visible extent in
    // the Markup projection is exactly the payload 'added'.
    const nodeStart = source.indexOf('{++')
    const nodeEnd = source.indexOf('++}') + 3
    const range = nodeModelRangeAtMarkupCoordinateMap(
      plan.coordinateMap,
      Object.freeze({ start: nodeStart, end: nodeEnd })
    )
    const markupText = plan.runs.map((run) => run.text).join('')
    expect(markupText.slice(range.start, range.end)).toBe('added')

    // A fully visible range maps to itself.
    const plain = nodeModelRangeAtMarkupCoordinateMap(
      plan.coordinateMap,
      Object.freeze({ start: 0, end: 2 })
    )
    expect(markupText.slice(plain.start, plain.end)).toBe('a ')
  })
})
