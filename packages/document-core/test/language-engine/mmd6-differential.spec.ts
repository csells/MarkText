import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

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

/**
 * Profile 1 §15 suite 2 — REFERENCE_PROJECTION_CONVENTIONS: the MMD-6
 * CuTest matrix from `Test_critic` in MultiMarkdown-6 `src/critic_markup.c`,
 * imported verbatim. MMD-6's accept maps to the Revised projection and its
 * reject to the Original projection (§10); the three nesting cases and the
 * pair rows are included exactly as shipped. D4 (stray `~>` erasure) is the
 * one documented delta and is not exercised by this matrix.
 */
const MMD6_MATRIX: readonly Readonly<{
  source: string
  operation: 'accept' | 'reject'
  expected: string
}>[] = Object.freeze([
  { source: '{--foo bar--}', operation: 'reject', expected: 'foo bar' },
  { source: '{++foo bar++}', operation: 'reject', expected: '' },
  { source: '{--foo bar--}', operation: 'accept', expected: '' },
  { source: '{++foo bar++}', operation: 'accept', expected: 'foo bar' },
  {
    source: '{++foo{--bat--}bar++}',
    operation: 'accept',
    expected: 'foobar'
  },
  {
    source: '{--foo{-- bat --}bar--}',
    operation: 'reject',
    expected: 'foo bat bar'
  },
  {
    source: '{--foo{++ bat ++}bar--}',
    operation: 'reject',
    expected: 'foobar'
  },
  { source: '{==foo bar==}', operation: 'reject', expected: 'foo bar' },
  { source: '{==foo bar==}', operation: 'accept', expected: 'foo bar' },
  { source: '{>>foo bar<<}', operation: 'reject', expected: '' },
  { source: '{>>foo bar<<}', operation: 'accept', expected: '' },
  { source: '{++foo++}{>>bar<<}', operation: 'accept', expected: 'foo' },
  { source: '{++foo++}{>>bar<<}', operation: 'reject', expected: '' }
])

describe('MMD-6 differential projection conventions', () => {
  const engine = createLanguageEngine()

  it('projects every MMD-6 CuTest row through Original and Revised', () => {
    const failures: string[] = []
    for (const [ordinal, row] of MMD6_MATRIX.entries()) {
      const revision = engine.open(
        createSourceSnapshot(row.source),
        TEST_CONFIGURATION
      )
      if (revision.kind !== 'complete') {
        failures.push(`row ${ordinal} (${row.source}): ${revision.kind}`)
        continue
      }
      const view = row.operation === 'accept' ? 'revised' : 'original'
      const projected = revision.projection(view).source
      if (projected !== row.expected) {
        failures.push(
          `row ${ordinal} (${row.operation} of ${row.source}): ` +
          `${JSON.stringify(projected)} !== ${JSON.stringify(row.expected)}`
        )
      }
      if (revision.source.text !== row.source) {
        failures.push(`row ${ordinal}: source drift`)
      }
    }
    expect(failures).toEqual([])
  })
})
