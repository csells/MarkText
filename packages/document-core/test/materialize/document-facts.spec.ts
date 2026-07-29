import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDocumentSession,
  createLanguageEngine,
  createSourceSnapshot,
  materializeDocumentFacts,
  PARSE_SOURCE_CHECKPOINT_INTERVAL,
  type ParseExecutionProgress,
  type ParseConfiguration
} from '../../src/index.js'

const CONFIGURATION: ParseConfiguration = Object.freeze({
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: Object.freeze({
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  }),
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: Object.freeze({
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  })
})

describe('parser-owned document facts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Consumer policy (specs/migration/consumer-policy.yml): the count consumer
  // reads "committed canonical source including markers and Comment payload",
  // identical in every view. The title still derives from parsed structure.
  it('derives the title from structure and statistics from canonical source', () => {
    const source = [
      '```md',
      '# Not a title',
      '```',
      '',
      '# Real {++Title++}',
      '',
      'Body **bold** {--old--}{++new++}.',
      '',
      '{>>secret words<<}',
      '',
      '中文.'
    ].join('\n')
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      CONFIGURATION
    )

    expect(materializeDocumentFacts(revision)).toEqual({
      kind: 'document-facts',
      recommendedTitle: 'Real Title',
      statistics: {
        word: 14,
        paragraph: 3,
        character: 85,
        all: 103
      }
    })
  })

  it('uses exact source statistics and no inferred title in SourceOnly', () => {
    const source = `${'> '.repeat(129)}# not parsed\n\n中文`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      CONFIGURATION
    )
    expect(revision.kind).toBe('source-only')

    expect(materializeDocumentFacts(revision)).toEqual({
      kind: 'document-facts',
      recommendedTitle: null,
      statistics: {
        word: 4,
        paragraph: 2,
        character: 141,
        all: source.length
      }
    })
  })

  it('counts exact-limit SourceOnly paragraphs without splitting source', () => {
    const prefix = `${'> '.repeat(129)}x`
    const source = prefix + 'x'.repeat(32_000_000 - prefix.length)
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      CONFIGURATION
    )
    expect(revision.kind).toBe('source-only')
    vi.spyOn(String.prototype, 'split').mockImplementation(() => {
      throw new Error('SourceOnly facts split the maximum source')
    })

    expect(materializeDocumentFacts(revision)).toMatchObject({
      recommendedTitle: null,
      statistics: {
        paragraph: 1,
        all: source.length
      }
    })
  }, 30_000)

  it.each([
    { kind: 'Complete', source: 'x'.repeat(65_536) },
    {
      kind: 'SourceOnly',
      source: `${'> '.repeat(129)}x${'x'.repeat(65_536)}`
    }
  ])('accounts and checkpoints one fused $kind facts scan', ({ source }) => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      CONFIGURATION
    )
    const progress: ParseExecutionProgress[] = []

    materializeDocumentFacts(revision, {
      checkpoint: checkpoint => progress.push(checkpoint)
    })

    expect(progress.length).toBeGreaterThan(1)
    let previous = 0
    for (const checkpoint of progress) {
      expect(checkpoint.sourceUnits - previous)
        .toBeLessThanOrEqual(PARSE_SOURCE_CHECKPOINT_INTERVAL)
      previous = checkpoint.sourceUnits
    }
    expect(previous).toBe(source.length)
  })

  it('accounts a SourceOnly whitespace-line scan exactly once', () => {
    const source = `${'> '.repeat(129)}x\n${' \t'.repeat(16_384)}\n\nend`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      CONFIGURATION
    )
    expect(revision.kind).toBe('source-only')
    const progress: ParseExecutionProgress[] = []

    const facts = materializeDocumentFacts(revision, {
      checkpoint: checkpoint => progress.push(checkpoint)
    })

    expect(facts.statistics.paragraph).toBe(2)
    expect(progress.at(-1)?.sourceUnits).toBe(source.length)
  })

  it('accounts newline-heavy SourceOnly facts exactly once', () => {
    const source = `${'> '.repeat(129)}${'x\r\n\r\n'.repeat(4_096)}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      CONFIGURATION
    )
    expect(revision.kind).toBe('source-only')
    const progress: ParseExecutionProgress[] = []

    const facts = materializeDocumentFacts(revision, {
      checkpoint: checkpoint => progress.push(checkpoint)
    })

    expect(progress.length).toBeGreaterThan(2)
    expect(progress.at(-1)?.sourceUnits).toBe(source.length)
    expect(facts.statistics.paragraph).toBe(4_096)
  })

  it('propagates cancellation from within a large Complete facts scan', () => {
    const source = 'x'.repeat(65_536)
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      CONFIGURATION
    )
    const cancellation = new Error('cancelled-during-document-facts')

    expect(() => materializeDocumentFacts(revision, {
      checkpoint: progress => {
        if (progress.sourceUnits >= PARSE_SOURCE_CHECKPOINT_INTERVAL * 2) {
          throw cancellation
        }
      }
    })).toThrow(cancellation)
  })

  it('propagates cancellation from within a large SourceOnly facts scan', () => {
    const source = `${'> '.repeat(129)}${'x'.repeat(65_536)}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      CONFIGURATION
    )
    expect(revision.kind).toBe('source-only')
    const cancellation = new Error('cancelled-during-source-only-facts')

    expect(() => materializeDocumentFacts(revision, {
      checkpoint: progress => {
        if (progress.sourceUnits >= PARSE_SOURCE_CHECKPOINT_INTERVAL * 2) {
          throw cancellation
        }
      }
    })).toThrow(cancellation)
  })

  it('cancels during non-certified Complete semantic materialization', () => {
    const source = `# ${'x'.repeat(65_536)}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      CONFIGURATION
    )
    expect(revision.kind).toBe('complete')
    const cancellation = new Error(
      'cancelled-during-non-certified-document-facts'
    )
    vi.spyOn(String.prototype, 'trim').mockImplementation(() => {
      throw new Error('facts reached an uncheckpointed trim scan')
    })
    vi.spyOn(String.prototype, 'replace').mockImplementation(() => {
      throw new Error('facts reached an uncheckpointed replacement scan')
    })

    expect(() => materializeDocumentFacts(revision, {
      checkpoint: progress => {
        if (progress.sourceUnits >= PARSE_SOURCE_CHECKPOINT_INTERVAL * 2) {
          throw cancellation
        }
      }
    })).toThrow(cancellation)
  })

  it('cancels before an uncheckpointed inline-code normalization scan', () => {
    const source = `\`${'x'.repeat(65_536)}\``
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      CONFIGURATION
    )
    expect(revision.kind).toBe('complete')
    const cancellation = new Error('cancelled-during-inline-code-facts')
    vi.spyOn(String.prototype, 'trim').mockImplementation(() => {
      throw new Error('inline-code facts reached an uncheckpointed trim scan')
    })
    vi.spyOn(String.prototype, 'replace').mockImplementation(() => {
      throw new Error('inline-code facts reached an uncheckpointed replacement scan')
    })

    expect(() => materializeDocumentFacts(revision, {
      checkpoint: progress => {
        if (progress.sourceUnits >= PARSE_SOURCE_CHECKPOINT_INTERVAL * 2) {
          throw cancellation
        }
      }
    })).toThrow(cancellation)
  })

  it('opens a production session in exactly four accounted source passes', async() => {
    const source = 'x'.repeat(65_536)
    const progress: ParseExecutionProgress[] = []

    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: CONFIGURATION,
      initialSelection: {
        anchor: { offset: 0, affinity: 'next' },
        focus: { offset: 0, affinity: 'next' }
      },
      executionControl: {
        checkpoint: checkpoint => progress.push(checkpoint)
      }
    })

    let previous = 0
    for (const checkpoint of progress) {
      expect(checkpoint.sourceUnits - previous)
        .toBeLessThanOrEqual(PARSE_SOURCE_CHECKPOINT_INTERVAL)
      previous = checkpoint.sourceUnits
    }
    expect(previous).toBe(source.length * 4)
    await session.close().completion
  })

  it('does not treat a heading removed from the editing meaning tree as a title', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{--# Removed--}\n\nParagraph.\n'),
      CONFIGURATION
    )

    expect(materializeDocumentFacts(revision).recommendedTitle).toBeNull()
  })

  it('counts entity source bytes, not their decoded text', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('alpha &amp; beta'),
      CONFIGURATION
    )

    // `&amp;` is five source characters and one decoded one; the count
    // consumer's policy reads committed canonical source, so the entity
    // counts as the bytes the user typed.
    expect(materializeDocumentFacts(revision).statistics).toEqual({
      word: 3,
      paragraph: 1,
      character: 14,
      all: 16
    })
  })

  it('counts large-text-shaped facts without materializing regex match arrays', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('ascii alpha_beta 42\t中文\ncombining e\u0301.'),
      CONFIGURATION
    )
    vi.spyOn(String.prototype, 'match').mockImplementation(() => {
      throw new Error('document facts materialized a match array')
    })
    vi.spyOn(String.prototype, 'matchAll').mockImplementation(() => {
      throw new Error('document facts materialized match records')
    })
    vi.spyOn(String.prototype, 'replace').mockImplementation(() => {
      throw new Error('document facts copied the full semantic text')
    })

    expect(materializeDocumentFacts(revision)).toMatchObject({
      statistics: {
        word: 7,
        paragraph: 1,
        character: 31,
        all: 36
      }
    })
  })
})
