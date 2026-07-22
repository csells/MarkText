import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

const DESKTOP_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('LanguageEngine.open resource budgets', () => {
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
      expect(revision.criticMarkup.roots).toEqual([])
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
      let node = revision.criticMarkup.roots[0]
      while (node !== undefined) {
        depth += 1
        node = node.arms[0].children[0]
      }
      expect(depth).toBe(admittedDepth)
      expect(revision.markup.runs).toMatchObject([{ text: 'x' }])
      expect(revision.markup.runs[0]?.marks).toHaveLength(admittedDepth)
      expect(revision.projection('original').source).toBe('')
      expect(revision.projection('revised').source).toBe('x')
    },
    30_000
  )
})
