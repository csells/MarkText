import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import { rootsOf, runsOf } from '../helpers/collections.js'

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

describe('LanguageEngine.open Markup artifact safety', () => {
  it('preserves a Comment elision as a run discontinuity instead of exposing synthetic CM', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{{>>note<<}++x++}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      { kind: 'comment', range: { start: 1, end: 11 } }
    ])
    expect(revision.markup).not.toHaveProperty('source')
    expect(runsOf(revision.markup)).toEqual([
      {
        text: '{',
        sourceRange: { start: 0, end: 1 },
        marks: []
      },
      {
        text: '++x++}',
        sourceRange: { start: 11, end: 17 },
        marks: []
      }
    ])
  })

  it('keeps an ordinary U+FEFF source-mapped instead of promoting it into a Markup BOF lane', () => {
    const sourceText = '{++\uFEFF---\ntitle: x\n---++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      {
        kind: 'addition',
        range: { start: 0, end: 23 },
        arms: [{ range: { start: 3, end: 20 } }]
      }
    ])
    expect(revision.markup).not.toHaveProperty('source')
    expect(runsOf(revision.markup)).toEqual([
      {
        text: '\uFEFF---\ntitle: x\n---',
        sourceRange: { start: 3, end: 20 },
        marks: [{ kind: 'addition' }]
      }
    ])
  })
})
