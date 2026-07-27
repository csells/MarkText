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
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('projection provenance canonical range queries', () => {
  it('answers revised-view visibility from parser-emitted provenance ranges', () => {
    const source = 'A {++shown++} {--hidden--} {~~old~>new~~} Z'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete revision')
    }

    const revised = revision.projection('revised').provenance
    const shownStart = source.indexOf('shown')
    const hiddenStart = source.indexOf('hidden')
    const oldStart = source.indexOf('old')
    const newStart = source.indexOf('new')

    expect(
      revised.canonicalSourceRangeIntersects(shownStart, shownStart + 5)
    ).toBe(true)
    expect(
      revised.canonicalSourceRangeIntersects(hiddenStart, hiddenStart + 6)
    ).toBe(false)
    expect(revised.canonicalSourceRangeIntersects(oldStart, oldStart + 3)).toBe(
      false
    )
    expect(revised.canonicalSourceRangeIntersects(newStart, newStart + 3)).toBe(
      true
    )
    expect(revised.canonicalSourceRangeIntersects(newStart, newStart)).toBe(
      false
    )
  })

  it('rejects malformed canonical source ranges', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('plain'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete revision')
    }
    const provenance = revision.projection('revised').provenance

    expect(() =>
      provenance.canonicalSourceRangeIntersects(-1, 1)
    ).toThrow(RangeError)
    expect(() =>
      provenance.canonicalSourceRangeIntersects(2, 1)
    ).toThrow(RangeError)
    expect(() =>
      provenance.canonicalSourceRangeIntersects(0.5, 1)
    ).toThrow(RangeError)
  })
})
