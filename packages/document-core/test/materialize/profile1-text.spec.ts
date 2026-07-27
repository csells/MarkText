import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  materializeProjectedText,
  materializeSearchText,
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
    gitLabMath: true,
    footnotes: true,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

const open = (source: string) => createLanguageEngine().open(
  createSourceSnapshot(source),
  CONFIGURATION
)

describe('Profile 1 semantic text', () => {
  it('materializes every enabled inline and block extension as visible text', () => {
    const source = [
      'Before ~sub~ and ^sup^ with $x+y$ and note[^n].',
      '',
      '$$',
      'a < b',
      '$$',
      '',
      '```mermaid',
      'graph A-->B',
      '```',
      '',
      '| H1 | H2 |',
      '| --- | --- |',
      '| A | B |',
      '',
      '[^n]: foot **body**'
    ].join('\n')
    const revision = open(source)
    const expected = [
      'Before sub and sup with x+y and note[1].',
      'a < b',
      'graph A-->B',
      'H1\tH2',
      'A\tB',
      '1. foot body'
    ].join('\n')

    expect(materializeProjectedText(revision, 'revised').text).toBe(expected)
    expect(materializeSearchText(revision, 'revised').text).toBe(expected)
  })

  it('keeps unresolved footnote references literal and searchable', () => {
    const revision = open('before[^missing] after')

    expect(materializeProjectedText(revision, 'revised').text)
      .toBe('before[^missing] after')
  })

  it('decodes escapes and valid entity boundaries without consuming near-misses', () => {
    const revision = open(
      String.raw`\* \a \[ &#65; &#x41; &#X1F600; &amp; &unknown; ` +
      '&#0; &#x110000; &#12345678; &#x1234567; &a;'
    )

    expect(materializeProjectedText(revision, 'revised').text).toBe(
      String.raw`* \a [ A A 😀 & &unknown; ` +
      '� � &#12345678; &#x1234567; &a;'
    )
  })

  it('uses view-selected extension content without exposing CriticMarkup', () => {
    const revision = open(
      '{~~$old$~>$new$~~}\n\n' +
      '{--```mermaid\nold-->node\n```--}' +
      '{++```mermaid\nnew-->node\n```++}'
    )

    expect(materializeProjectedText(revision, 'original').text)
      .toBe('old\nold-->node')
    expect(materializeProjectedText(revision, 'revised').text)
      .toBe('new\nnew-->node')
  })
})
