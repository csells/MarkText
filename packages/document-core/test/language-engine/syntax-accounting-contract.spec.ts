import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type {
  ExecutionBudgetId,
  MarkdownOptionsV1
} from '@marktext/document-core'
import { parseProfile1Document } from '../../src/internal/profile1Document.js'
import type {
  Profile1SyntaxAccountingEventV1
} from '../../src/internal/profile1/syntaxAccounting.js'

type EventKind =
  | 'TapeRun'
  | 'MarkdownNode'
  | 'CriticNode'
  | 'MarkerNode'
  | 'ArmNode'
  | 'ProjectionSegment'

interface EventDefinition {
  readonly kind: EventKind
  readonly order: number
  readonly range: string
  readonly key: string
  readonly maximalization: string
}

interface TraceExample {
  readonly id: string
  readonly source: string
  readonly eventCounts: Readonly<Record<EventKind, number>>
  readonly total: number
}

interface BoundaryCase {
  readonly relation: 'below' | 'at' | 'above'
  readonly value: number
  readonly expected: 'complete' | 'source-only'
  readonly diagnosticCode?: string
  readonly generatorArguments?: Readonly<Record<string, number>>
}

interface BoundaryVector {
  readonly id: string
  readonly dimension: string
  readonly limit: number
  readonly generator: string
  readonly cases: readonly BoundaryCase[]
}

interface SyntaxAccountingManifest {
  readonly schema: string
  readonly id: string
  readonly events: readonly EventDefinition[]
  readonly uncounted: readonly string[]
  readonly limits: {
    readonly profile: string
    readonly decodedSourceUnits: number
    readonly budgetEvents: number
    readonly markdownContainerDepth: number
    readonly criticMarkupDepth: number
  }
  readonly examples: readonly TraceExample[]
  readonly generators: readonly {
    readonly id: string
    readonly fixedEvents: number
    readonly units: readonly {
      readonly argument: string
      readonly source: string
      readonly events: number
    }[]
  }[]
  readonly boundaryVectors: readonly BoundaryVector[]
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const MANIFEST = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'specs/migration/syntax-accounting-1.yml'), 'utf8')
) as SyntaxAccountingManifest

const EXACT_EVENT_KINDS: readonly EventKind[] = [
  'TapeRun',
  'MarkdownNode',
  'CriticNode',
  'MarkerNode',
  'ArmNode',
  'ProjectionSegment'
]

const TEST_BUDGET: ExecutionBudgetId = {
  limitsProfile: 'test-unbounded',
  accountingSchema: 'syntax-accounting-1'
}

const MARKDOWN_OPTIONS: MarkdownOptionsV1 = {
  schema: 'markdown-options-1',
  gfm: true,
  frontMatter: true,
  math: true,
  gitLabMath: false,
  footnotes: false,
  subscriptAndSuperscript: true
}

function productionTrace(source: string): readonly Profile1SyntaxAccountingEventV1[] {
  const parsed = parseProfile1Document(
    source,
    TEST_BUDGET,
    undefined,
    MARKDOWN_OPTIONS,
    true
  )
  expect(parsed.kind).toBe('complete')
  if (parsed.kind !== 'complete' || parsed.accountingTrace === undefined) {
    throw new Error('Expected a captured complete accounting trace')
  }
  return parsed.accountingTrace.events
}

describe('syntax-accounting-1 event algebra', () => {
  it('is the ordered trace emitted by production, not manifest arithmetic', () => {
    for (const example of MANIFEST.examples) {
      const actual = productionTrace(example.source)
      expect(actual.length, example.id).toBe(example.total)
      expect(Object.fromEntries(EXACT_EVENT_KINDS.map((kind) => [
        kind,
        actual.filter((event) => event.kind === kind).length
      ])), example.id).toEqual(example.eventCounts)
      expect(new Set(
        actual.map((event) => `${event.kind}\u0000${event.key}`)
      ).size, example.id).toBe(actual.length)
    }
  })

  it('emits the same complete ordered trace on independent full runs', () => {
    const source =
      '# shared\n\nA {~~[old][r]~>[new][r]~~} B {>>**note**<<}\n\n' +
      '[r]: /destination\n'
    expect(productionTrace(source)).toEqual(productionTrace(source))
  })

  it('defines implementation-independent logical events and literal traces', () => {
    expect(MANIFEST.schema).toBe('marktext-syntax-accounting-v1')
    expect(MANIFEST.id).toBe('syntax-accounting-1')
    expect(MANIFEST.events.map((event) => event.kind)).toEqual(EXACT_EVENT_KINDS)
    expect(MANIFEST.events.map((event) => event.order)).toEqual([10, 20, 30, 40, 50, 60])
    for (const event of MANIFEST.events) {
      expect(event.range.length).toBeGreaterThan(0)
      expect(event.key.length).toBeGreaterThan(0)
      expect(event.maximalization.length).toBeGreaterThan(0)
    }
    expect(MANIFEST.uncounted).toEqual([
      'caches',
      'diagnostics',
      'indexes',
      'history',
      'checkpoints',
      'physical-helper-objects'
    ])

    expect(MANIFEST.examples.map((example) => example.id)).toEqual([
      'SA1-EMPTY',
      'SA1-PLAIN',
      'SA1-ALL-FIVE',
      'SA1-NESTED',
      'SA1-LITERAL',
      'SA1-MALFORMED',
      'SA1-COMMENT-DISPLAY'
    ])
    const coveredKinds = new Set<EventKind>()
    for (const example of MANIFEST.examples) {
      expect(example.total, example.id).toBe(
        Object.values(example.eventCounts).reduce(
          (count, value) => count + value,
          0
        )
      )
      expect(Object.keys(example.eventCounts)).toEqual(EXACT_EVENT_KINDS)
      for (const kind of EXACT_EVENT_KINDS) {
        if (example.eventCounts[kind] > 0) {
          coveredKinds.add(kind)
        }
      }
    }
    expect([...coveredKinds].sort()).toEqual([...EXACT_EVENT_KINDS].sort())
  })

  it('pins every desktop limit with one below at and above vector', () => {
    expect(MANIFEST.limits).toEqual({
      profile: 'desktop-v1',
      decodedSourceUnits: 32_000_000,
      budgetEvents: 2_000_000,
      markdownContainerDepth: 128,
      criticMarkupDepth: 16_384
    })
    expect(MANIFEST.boundaryVectors.map((vector) => vector.id)).toEqual([
      'SA1-SOURCE-UNITS',
      'SA1-BUDGET-EVENTS',
      'SA1-MARKDOWN-DEPTH',
      'SA1-CRITICMARKUP-DEPTH'
    ])
    for (const vector of MANIFEST.boundaryVectors) {
      expect(vector.generator.length).toBeGreaterThan(0)
      expect(
        vector.cases.map((row) => row.relation),
        vector.id
      ).toEqual(['below', 'at', 'above'])
      expect(
        vector.cases.map((row) => row.value),
        vector.id
      ).toEqual([vector.limit - 1, vector.limit, vector.limit + 1])
      expect(
        vector.cases.map((row) => row.expected),
        vector.id
      ).toEqual(['complete', 'complete', 'source-only'])
      expect(vector.cases[0]?.diagnosticCode, vector.id).toBeUndefined()
      expect(vector.cases[1]?.diagnosticCode, vector.id).toBeUndefined()
      expect(vector.cases[2]?.diagnosticCode, vector.id).toMatch(/^CM_RESOURCE_[A-Z_]+_EXCEEDED$/)
    }

    const eventGenerator = MANIFEST.generators.find(
      (generator) => generator.id === 'exact-empty-cm-event-family'
    )
    expect(eventGenerator).toEqual({
      id: 'exact-empty-cm-event-family',
      fixedEvents: 2,
      units: [
        {
          argument: 'emptyAdditions',
          source: '{++++}',
          events: 6
        },
        {
          argument: 'emptyComments',
          source: '{>><<}',
          events: 7
        }
      ]
    })
    const eventVector = MANIFEST.boundaryVectors.find((vector) => vector.id === 'SA1-BUDGET-EVENTS')
    expect(eventVector?.generator).toBe(eventGenerator?.id)
    for (const row of eventVector?.cases ?? []) {
      const additions = row.generatorArguments?.['emptyAdditions']
      const comments = row.generatorArguments?.['emptyComments']
      const additionUnit = eventGenerator?.units[0]
      const commentUnit = eventGenerator?.units[1]
      expect(additions, `${row.relation} emptyAdditions`).toBeTypeOf('number')
      expect(comments, `${row.relation} emptyComments`).toBeTypeOf('number')
      if (
        additions === undefined ||
        comments === undefined ||
        eventGenerator === undefined ||
        additionUnit === undefined ||
        commentUnit === undefined
      ) {
        continue
      }
      expect(
        eventGenerator.fixedEvents +
          additions * additionUnit.events +
          comments * commentUnit.events,
        row.relation
      ).toBe(row.value)
      expect(
        additions * additionUnit.source.length + comments * commentUnit.source.length,
        row.relation
      ).toBeLessThan(MANIFEST.limits.decodedSourceUnits)
    }
  })
})
