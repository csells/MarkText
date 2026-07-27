import { describe, expect, it } from 'vitest'
import {
  materializeCount,
  materializeSearchText
} from '../../src/materialize/textMaterializers.js'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

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

const source = [
  '# H &amp;',
  '',
  '{~~old~>new~~}',
  '',
  '{>>secret<<}',
  '',
  '`code`'
].join('\r\n')

describe('search and count materializers', () => {
  it('searches canonical Markup and semantic Original/Revised text by policy', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      CONFIGURATION
    )

    expect(materializeSearchText(revision, 'markup')).toEqual({
      kind: 'search-text',
      view: 'markup',
      text: source
    })
    expect(materializeSearchText(revision, 'original')).toEqual({
      kind: 'search-text',
      view: 'original',
      text: 'H &\nold\ncode'
    })
    expect(materializeSearchText(revision, 'revised')).toEqual({
      kind: 'search-text',
      view: 'revised',
      text: 'H &\nnew\ncode'
    })
  })

  it('counts the same exact committed canonical source in every view', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      CONFIGURATION
    )
    const expected = {
      kind: 'count',
      codeUnits: source.length,
      lineBreaks: 6,
      words: 6
    }

    expect(materializeCount(revision, 'markup')).toEqual({
      ...expected,
      view: 'markup'
    })
    expect(materializeCount(revision, 'original')).toEqual({
      ...expected,
      view: 'original'
    })
    expect(materializeCount(revision, 'revised')).toEqual({
      ...expected,
      view: 'revised'
    })
  })

  it('rejects every semantic text consumer for SourceOnly while retaining count', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot(`${'> '.repeat(129)}text\n`),
      CONFIGURATION
    )
    expect(revision.kind).toBe('source-only')
    expect(() => materializeSearchText(revision, 'original')).toThrow(
      /SourceOnly/i
    )
    expect(materializeSearchText(revision, 'markup').text)
      .toBe(revision.source.text)
    expect(materializeCount(revision, 'revised').codeUnits)
      .toBe(revision.source.text.length)
  })
})
