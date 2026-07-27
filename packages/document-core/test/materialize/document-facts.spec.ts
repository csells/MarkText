import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  materializeDocumentFacts,
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
  it('derives the recommended title and statistics from semantic parser structure', () => {
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
        word: 10,
        paragraph: 3,
        character: 37,
        all: 46
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

  it('does not treat a heading removed from the editing meaning tree as a title', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{--# Removed--}\n\nParagraph.\n'),
      CONFIGURATION
    )

    expect(materializeDocumentFacts(revision).recommendedTitle).toBeNull()
  })
})
