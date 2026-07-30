import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CompleteDocumentRevision,
  type DocumentRevision,
  type MarkdownPhysicalLine,
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

function complete(revision: DocumentRevision): CompleteDocumentRevision {
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete revision')
  }
  return revision
}

function linesOf(source: string): readonly MarkdownPhysicalLine[] {
  const revision = complete(createLanguageEngine().open(
    createSourceSnapshot(source),
    CONFIGURATION
  ))
  const index = revision.projection('editing').markdown.lines
  return Array.from({ length: index.count }, (_, ordinal) => index.at(ordinal))
}

// Non-negotiable 2: block-container prefixes are recognized once, in the
// grammar. The line index publishes where each line's content begins after
// every recognized prefix, so no consumer re-derives a `>` or list marker
// with its own expression (G40).
describe('parser-emitted physical line index', () => {
  it('covers a paragraph document contiguously, blanks included', () => {
    const lines = linesOf('a\n\nb\n')
    expect(lines).toEqual([
      { start: 0, contentOffset: 0, contentEnd: 1, end: 2, blank: false },
      { start: 2, contentOffset: 2, contentEnd: 2, end: 3, blank: true },
      { start: 3, contentOffset: 3, contentEnd: 4, end: 5, blank: false }
    ])
  })

  it('consumes blockquote prefixes into contentOffset', () => {
    const lines = linesOf('> a\n> b\n')
    expect(lines.map((line) => line.contentOffset)).toEqual([2, 6])
    expect(lines.map((line) => line.start)).toEqual([0, 4])
  })

  it('consumes list markers and continuation indents', () => {
    const source = '- one\n  cont\n'
    const lines = linesOf(source)
    expect(source.slice(lines[0]!.contentOffset, lines[0]!.contentEnd))
      .toBe('one')
    expect(source.slice(lines[1]!.contentOffset, lines[1]!.contentEnd))
      .toBe('cont')
  })

  it('keeps CRLF terminators inside end but outside contentEnd', () => {
    const lines = linesOf('a\r\nb\r\n')
    expect(lines).toEqual([
      { start: 0, contentOffset: 0, contentEnd: 1, end: 3, blank: false },
      { start: 3, contentOffset: 3, contentEnd: 4, end: 6, blank: false }
    ])
  })

  it('indexes a certified simple-text reopen lazily', () => {
    const engine = createLanguageEngine()
    const source = 'plain text\nsecond line\n'
    const before = complete(engine.open(
      createSourceSnapshot(source),
      CONFIGURATION
    ))
    const after = `${source.slice(0, -1)}z\n`
    const reopened = complete(engine.reopen(
      before,
      createSourceSnapshot(after),
      Object.freeze([{
        start: source.length - 1,
        end: source.length - 1,
        insert: 'z'
      }])
    ))
    const index = reopened.projection('editing').markdown.lines
    expect(index.count).toBe(2)
    expect(index.at(1)).toEqual({
      start: 11,
      contentOffset: 11,
      contentEnd: 23,
      end: 24,
      blank: false
    })
    expect(() => index.at(2)).toThrow(RangeError)
  })
})
