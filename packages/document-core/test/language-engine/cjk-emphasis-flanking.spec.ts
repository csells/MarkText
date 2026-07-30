import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

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

const strongCount = (source: string): number => {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete revision')
  }
  let count = 0
  const visit = (node: {
    kind: string
    childCount: number
    childAt: (ordinal: number) => never
  }): void => {
    if (node.kind === 'strong') count += 1
    for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
      visit(node.childAt(ordinal))
    }
  }
  visit(revision.projection('editing').markdown.root as never)
  return count
}

// Profile 1 extension (product issue #4307, Typora and markdownlint parity):
// CJK ideographs, kana, and hangul are boundary-equivalent to punctuation when
// evaluating CommonMark's flanking clauses. Strict CommonMark treats them as
// ordinary letters, so a delimiter run between a CJK character and a quote is
// both left- and right-flanking and opens nothing — which is why bold around
// quoted text silently stopped working for CJK authors.
describe('CJK-friendly emphasis flanking', () => {
  it.each([
    { name: 'ideographs around a quoted run', source: '中文**"x"**中文\n' },
    { name: 'ideographs around plain text', source: '中文**x**中文\n' },
    { name: 'hiragana', source: 'ひらがな**"x"**ひらがな\n' },
    { name: 'katakana', source: 'カタカナ**"x"**カタカナ\n' },
    { name: 'hangul', source: '한국어**"x"**한국어\n' },
    { name: 'underscores between ideographs', source: '中文__x__中文\n' }
  ])('emphasizes $name', ({ source }) => {
    expect(strongCount(source)).toBe(1)
  })

  // The extension widens the boundary class; it must not make emphasis appear
  // where CommonMark itself refuses it.
  it.each([
    { name: 'a space before the closer', source: '中文**x **中文\n' },
    { name: 'an empty run', source: '中文****中文\n' },
    { name: 'latin intraword underscores', source: 'snake_case_word\n' }
  ])('still refuses $name', ({ source }) => {
    expect(strongCount(source)).toBe(0)
  })
})
