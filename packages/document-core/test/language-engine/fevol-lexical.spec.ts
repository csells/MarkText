import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CompleteDocumentRevision,
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
 * Profile 1 §15 suite 5 — lexical fixtures imported from
 * Fevol/criticmarkup-parser `test/basic_ranges.txt`,
 * `test/malformed_ranges.txt`, and `test/edge_cases.txt`, with expectations
 * adjusted to Profile 1 rulings where the two grammars deliberately differ:
 * N1 parses nesting recursively where Fevol reads it flat (§12 D6), and
 * ADR-0014/L2a takes the first unowned closer. Sources are verbatim.
 */
interface LexicalCase {
  readonly name: string
  readonly source: string
  readonly rootKinds: readonly string[]
  readonly adjustment?: string
}

const BASIC_RANGES: readonly LexicalCase[] = Object.freeze([
  {
    name: 'Addition',
    source: '{++ an addition ++}\n',
    rootKinds: ['addition']
  },
  {
    name: 'Deletion',
    source: '{-- a deletion --}\n',
    rootKinds: ['deletion']
  },
  {
    name: 'Substitution',
    source: '{~~ a ~> substitution ~~}\n',
    rootKinds: ['substitution']
  },
  {
    name: 'Comment',
    source: '{>> a comment <<}\n',
    rootKinds: ['comment']
  },
  {
    name: 'Highlight',
    source: '{== a highlight ==}\n',
    rootKinds: ['highlight']
  }
])

const MALFORMED_RANGES: readonly LexicalCase[] = Object.freeze([
  {
    name: 'Space between bracket characters',
    source: '{ ++ Text ++}\n{+ + Text ++}\n',
    rootKinds: []
  },
  {
    name: 'Space between Substitution arrow',
    source: '{~~ This is ~ > a test ~~}\n',
    rootKinds: [],
    adjustment:
      'Profile 1 R4: a substitution without its divider degrades to ' +
      'literal text with a diagnostic, matching the zero-node reading.'
  },
  {
    name: 'Escaped brackets',
    source: '{\\++ This is a test ++}\n',
    rootKinds: [],
    adjustment:
      'Profile 1 E1: the escape prevents the opener; the trailing closer ' +
      'is a closer with no opener — literal by R2.'
  },
  {
    name: 'Unclosed opening bracket',
    source: '{++ Unclosed opening bracket\n',
    rootKinds: []
  },
  {
    name: 'Unclosed closing bracket',
    source: 'Unclosed closing bracket ++}\n',
    rootKinds: []
  }
])

const EDGE_CASES: readonly LexicalCase[] = Object.freeze([
  {
    name: 'Nested markup',
    source:
      '{++ {-- This is a nested node --} ++}\n' +
      '{>> {>> Doubly nested comment <<} and some additional text <<}\n',
    rootKinds: ['addition', 'comment'],
    adjustment:
      'Profile 1 N1 parses nesting recursively (§12 D6): the Addition ' +
      'holds a Deletion child and the Comment a Comment child, where ' +
      'Fevol reads the markers flat.'
  },
  {
    name: 'Mixed markup',
    source: '{++ This is a mixed node --}\n',
    rootKinds: []
  },
  {
    name: 'Mixed nested range',
    source: '{++ {-- This is a nested mixed node ++} --}\n',
    rootKinds: ['deletion'],
    adjustment:
      'Profile 1 non-top-closer rule: the addition closer inside the open ' +
      'Deletion frame is literal, the Deletion closes at its own closer, ' +
      'and the outer opener stays unterminated — Fevol reads the same ' +
      'bytes flat as an Addition.'
  }
])

function completeParse(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error(`Expected a complete revision, got ${revision.kind}`)
  }
  return revision
}

function rootKinds(revision: CompleteDocumentRevision): readonly string[] {
  return Array.from(
    { length: revision.criticMarkup.rootCount },
    (_, ordinal) => revision.criticMarkup.rootAt(ordinal).kind
  )
}

function diagnosticCodes(
  revision: CompleteDocumentRevision
): readonly string[] {
  return Array.from(
    { length: revision.diagnostics.count },
    (_, ordinal) => revision.diagnostics.at(ordinal).code
  )
}

describe('Fevol lexical fixtures under Profile 1 rulings', () => {
  const suites = [
    { file: 'basic_ranges', cases: BASIC_RANGES },
    { file: 'malformed_ranges', cases: MALFORMED_RANGES },
    { file: 'edge_cases', cases: EDGE_CASES }
  ]
  for (const suite of suites) {
    describe(suite.file, () => {
      it.each([...suite.cases])('$name', (row) => {
        const revision = completeParse(row.source)
        expect(rootKinds(revision)).toEqual(row.rootKinds)
        expect(revision.source.text).toBe(row.source)
      })
    })
  }

  it('emits the unterminated and unmatched diagnostics for the broken rows', () => {
    expect(
      diagnosticCodes(completeParse('{++ Unclosed opening bracket\n'))
    ).toContain('CM_UNTERMINATED_OPENER')
    expect(
      diagnosticCodes(completeParse('Unclosed closing bracket ++}\n'))
    ).toContain('CM_UNMATCHED_CLOSER')
  })

  it('parses the nested rows recursively per N1', () => {
    const revision = completeParse(
      '{++ {-- This is a nested node --} ++}\n' +
      '{>> {>> Doubly nested comment <<} and some additional text <<}\n'
    )
    const addition = revision.criticMarkup.rootAt(0)
    const comment = revision.criticMarkup.rootAt(1)
    expect(addition.arms[0].children.map((child) => child.kind))
      .toEqual(['deletion'])
    expect(comment.arms[0].children.map((child) => child.kind))
      .toEqual(['comment'])
  })
})
