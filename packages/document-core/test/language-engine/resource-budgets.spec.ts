import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CriticMarkupNode,
  type ParseConfiguration
} from '@marktext/document-core'
import { rootsOf, runsOf } from '../helpers/collections.js'

const DESKTOP_CONFIGURATION: ParseConfiguration = {
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

describe('LanguageEngine.open resource budgets', () => {
  it(
    'admits exact decoded source-unit values below and at desktop-v1 within parser headroom',
    () => {
      const elapsedByUnits: Array<Readonly<{
        readonly units: number
        readonly elapsedMs: number
        readonly maximumCheckpointGapMs: number
      }>> = []
      for (const units of [31_999_999, 32_000_000]) {
        const sourceText = 'x'.repeat(units)
        const startedAt = performance.now()
        let previousCheckpointAt = startedAt
        let maximumCheckpointGapMs = 0
        const revision = createLanguageEngine({
          checkpoint(): void {
            const checkpointAt = performance.now()
            maximumCheckpointGapMs = Math.max(
              maximumCheckpointGapMs,
              checkpointAt - previousCheckpointAt
            )
            previousCheckpointAt = checkpointAt
          }
        }).open(
          createSourceSnapshot(sourceText),
          DESKTOP_CONFIGURATION
        )
        const completedAt = performance.now()
        maximumCheckpointGapMs = Math.max(
          maximumCheckpointGapMs,
          completedAt - previousCheckpointAt
        )
        elapsedByUnits.push(Object.freeze({
          units,
          elapsedMs: completedAt - startedAt,
          maximumCheckpointGapMs
        }))

        expect(revision.kind, String(units)).toBe('complete')
        expect(revision.source.text.length, String(units)).toBe(units)
        expect(revision.source.text, String(units)).toBe(sourceText)
      }
      expect(
        Math.max(...elapsedByUnits.map((row) => row.elapsedMs)),
        JSON.stringify(elapsedByUnits)
      ).toBeLessThanOrEqual(7_500)
      expect(
        Math.max(...elapsedByUnits.map((row) => row.maximumCheckpointGapMs)),
        JSON.stringify(elapsedByUnits)
      ).toBeLessThanOrEqual(100)
    },
    120_000
  )

  it('applies the decoded source-unit preflight before grammar work', () => {
    const admittedUnits = 32_000_000
    const sourceText = 'x'.repeat(admittedUnits + 1)
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      DESKTOP_CONFIGURATION
    )

    expect(revision.kind).toBe('source-only')
    if (revision.kind !== 'source-only') {
      throw new Error('Expected a source-only document revision')
    }
    expect(revision.source.text).toBe(sourceText)
    expect(revision.fatalDiagnostic).toEqual({
      kind: 'resource',
      code: 'CM_RESOURCE_SOURCE_UNITS_EXCEEDED',
      range: { start: admittedUnits, end: admittedUnits },
      metadata: { limit: '32000000', observed: '32000001' }
    })
  })

  it(
    'applies the decoded source-unit preflight before certified revision reuse',
    () => {
      const admittedUnits = 32_000_000
      const admittedSource = 'x'.repeat(admittedUnits)
      const engine = createLanguageEngine()
      const admitted = engine.open(
        createSourceSnapshot(admittedSource),
        DESKTOP_CONFIGURATION
      )
      expect(admitted.kind).toBe('complete')

      const aboveLimitSource = `${admittedSource}x`
      const reopened = engine.reopen(
        admitted,
        createSourceSnapshot(aboveLimitSource),
        Object.freeze([{
          start: admittedUnits,
          end: admittedUnits,
          insert: 'x'
        }])
      )

      expect(reopened.kind).toBe('source-only')
      if (reopened.kind !== 'source-only') {
        throw new Error('Expected a source-only reopened document revision')
      }
      expect(reopened.source.text).toBe(aboveLimitSource)
      expect(reopened.fatalDiagnostic).toEqual({
        kind: 'resource',
        code: 'CM_RESOURCE_SOURCE_UNITS_EXCEEDED',
        range: { start: admittedUnits, end: admittedUnits },
        metadata: { limit: '32000000', observed: '32000001' }
      })
    },
    120_000
  )

  it('returns exact source-only state at the first Markdown container beyond desktop-v1', () => {
    const sourceText = `${'> '.repeat(129)}text\n`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      DESKTOP_CONFIGURATION
    )

    expect(revision.kind).toBe('source-only')
    if (revision.kind !== 'source-only') {
      throw new Error('Expected a source-only document revision')
    }
    expect(revision.source.text).toBe(sourceText)
    expect(revision.fatalDiagnostic).toEqual({
      kind: 'resource',
      code: 'CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED',
      range: { start: 256, end: 257 },
      metadata: { limit: '128', observed: '129' }
    })
  })

  it('admits exact Markdown container depths below and at desktop-v1', () => {
    for (const depth of [127, 128]) {
      const sourceText = `${'> '.repeat(depth)}text\n`
      const revision = createLanguageEngine().open(
        createSourceSnapshot(sourceText),
        DESKTOP_CONFIGURATION
      )

      expect(revision.kind, String(depth)).toBe('complete')
      expect(revision.source.text, String(depth)).toBe(sourceText)
    }
  })

  it('does not let depth accounting reinterpret an ordered marker that cannot interrupt a paragraph', () => {
    const sourceText = `paragraph\n2. ${'> '.repeat(128)}text\n`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      DESKTOP_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    expect(revision.source.text).toBe(sourceText)
  })

  it('applies the Markdown depth budget inside a zero-width CM arm lane', () => {
    const sourceText = `{++${'> '.repeat(129)}text++}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      DESKTOP_CONFIGURATION
    )

    expect(revision.kind).toBe('source-only')
    if (revision.kind !== 'source-only') {
      throw new Error('Expected a source-only document revision')
    }
    expect(revision.source.text).toBe(sourceText)
    expect(revision.fatalDiagnostic).toEqual({
      kind: 'resource',
      code: 'CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED',
      range: { start: 259, end: 260 },
      metadata: { limit: '128', observed: '129' }
    })
  })

  it('applies the Markdown depth budget to an independent Comment display lane', () => {
    const sourceText = `{>>${'> '.repeat(129)}text<<}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      DESKTOP_CONFIGURATION
    )

    expect(revision.kind).toBe('source-only')
    if (revision.kind !== 'source-only') {
      throw new Error('Expected a source-only document revision')
    }
    expect(revision.source.text).toBe(sourceText)
    expect(revision.fatalDiagnostic).toEqual({
      kind: 'resource',
      code: 'CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED',
      range: { start: 259, end: 260 },
      metadata: { limit: '128', observed: '129' }
    })
  })

  it(
    'does not charge unterminated CM openers against accepted tree depth',
    () => {
      const sourceText = '{++'.repeat(16_385)
      const revision = createLanguageEngine().open(
        createSourceSnapshot(sourceText),
        DESKTOP_CONFIGURATION
      )

      expect(revision.kind).toBe('complete')
      if (revision.kind !== 'complete') {
        throw new Error('Expected a complete document revision')
      }
      expect(revision.source.text).toBe(sourceText)
      expect(rootsOf(revision.criticMarkup)).toEqual([])
      expect(revision.diagnostics.count).toBe(16_385)
      expect(revision.diagnostics.at(16_384)).toEqual({
        code: 'CM_UNTERMINATED_OPENER',
        range: { start: 49_152, end: 49_155 },
        metadata: {}
      })
    },
    30_000
  )

  it('returns exact source-only state at the first CM frame beyond desktop-v1', () => {
    const admittedDepth = 16_384
    const sourceText = `${'{++'.repeat(admittedDepth + 1)}x${'++}'.repeat(admittedDepth + 1)}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      DESKTOP_CONFIGURATION
    )

    expect(revision.kind).toBe('source-only')
    if (revision.kind !== 'source-only') {
      throw new Error('Expected a source-only document revision')
    }
    expect(revision.source.text).toBe(sourceText)
    expect(revision.fatalDiagnostic).toEqual({
      kind: 'resource',
      code: 'CM_RESOURCE_CM_DEPTH_EXCEEDED',
      range: { start: 49_152, end: 49_155 },
      metadata: { limit: '16384', observed: '16385' }
    })
  })

  it(
    'materializes the exact accepted CM-depth boundary without quadratic ancestry copies',
    () => {
      const admittedDepth = 16_384
      const sourceText = `${'{++'.repeat(admittedDepth)}x${'++}'.repeat(admittedDepth)}`
      const revision = createLanguageEngine().open(
        createSourceSnapshot(sourceText),
        DESKTOP_CONFIGURATION
      )

      expect(revision.kind).toBe('complete')
      if (revision.kind !== 'complete') {
        throw new Error('Expected a complete document revision')
      }
      let depth = 0
      let node: CriticMarkupNode | undefined = revision.criticMarkup.rootAt(0)
      while (node !== undefined) {
        depth += 1
        node = node.arms[0].children[0]
      }
      expect(depth).toBe(admittedDepth)
      expect(runsOf(revision.markup)).toMatchObject([{ text: 'x' }])
      expect(revision.markup.runAt(0)?.marks).toHaveLength(admittedDepth)
      expect(revision.projection('original').source).toBe('')
      expect(revision.projection('revised').source).toBe('x')
    },
    30_000
  )

  it(
    'enforces the syntax-accounting event boundary below at and above desktop-v1',
    () => {
      const cases = [
        {
          relation: 'below',
          source: `${'{++++}'.repeat(333_327)}${'{>><<}'.repeat(5)}`,
          expected: 'complete'
        },
        {
          relation: 'at',
          source: '{++++}'.repeat(333_333),
          expected: 'complete'
        },
        {
          relation: 'above',
          source: `${'{++++}'.repeat(333_332)}{>><<}`,
          expected: 'source-only'
        }
      ] as const

      for (const row of cases) {
        const revision = createLanguageEngine().open(
          createSourceSnapshot(row.source),
          DESKTOP_CONFIGURATION
        )
        expect(revision.kind, row.relation).toBe(row.expected)
        expect(revision.source.text, row.relation).toBe(row.source)
        if (row.relation === 'above' && revision.kind === 'source-only') {
          expect(revision.fatalDiagnostic).toEqual({
            kind: 'resource',
            code: 'CM_RESOURCE_LOGICAL_NODES_EXCEEDED',
            range: { start: 1_999_995, end: 1_999_995 },
            metadata: { limit: '2000000', observed: '2000001' }
          })
        }
      }
    },
    120_000
  )

  it(
    'rejects the first high-node ordinary document above the one-AST event limit',
    () => {
      // Each line contributes two tape events, one paragraph, and one text
      // node; the one shared document root contributes the final two fixed
      // events. 333,333 lines are exactly 2,000,000 events.
      const sourceText = 'x\n'.repeat(333_334)
      const revision = createLanguageEngine().open(
        createSourceSnapshot(sourceText),
        DESKTOP_CONFIGURATION
      )
      expect(revision.kind).toBe('source-only')
      if (revision.kind !== 'source-only') {
        throw new Error('Expected a source-only document revision')
      }
      expect(revision.source.text).toBe(sourceText)
      expect(revision.fatalDiagnostic.kind).toBe('resource')
      expect(revision.fatalDiagnostic.code).toBe(
        'CM_RESOURCE_LOGICAL_NODES_EXCEEDED'
      )
      expect(revision.fatalDiagnostic.metadata).toEqual({
        limit: '2000000',
        observed: '2000001'
      })
    },
    120_000
  )
})
