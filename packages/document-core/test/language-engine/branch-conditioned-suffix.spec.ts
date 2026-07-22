import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type DocumentRevision,
  type MarkdownNode,
  type ParseConfiguration
} from '@marktext/document-core'

type CompleteRevision = Extract<DocumentRevision, { readonly kind: 'complete' }>

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

function open(source: string): CompleteRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete document revision')
  }
  return revision
}

function childKinds(node: MarkdownNode): readonly string[] {
  return Array.from(
    { length: node.childCount },
    (_, ordinal) => node.childAt(ordinal).kind
  )
}

function expectTwoConditionalRoots(revision: CompleteRevision): void {
  expect(revision.criticMarkup.roots.map((node) => ({
    kind: node.kind,
    range: node.range
  }))).toEqual([
    { kind: 'substitution', range: { start: 0, end: 14 } },
    { kind: 'addition', range: { start: 14, end: 27 } }
  ])
}

describe('Profile 1 branch-conditioned shared suffix', () => {
  it('retains suffix CM literally only on the old arm code-span lane', () => {
    const revision = open('{~~`~>plain~~}{++literal++}`')
    expectTwoConditionalRoots(revision)

    const original = revision.projection('original')
    expect(original.source).toBe('`{++literal++}`')
    expect(original.provenance.originAt(1)).toEqual({
      kind: 'canonical',
      sourceOffset: 14
    })
    const originalParagraph = original.markdown.root.childAt(0)
    expect(childKinds(originalParagraph)).toEqual(['inline-code'])
    expect(originalParagraph.childAt(0).range).toEqual({ start: 0, end: 15 })

    const revised = revision.projection('revised')
    expect(revised.source).toBe('plainliteral`')
    const revisedParagraph = revised.markdown.root.childAt(0)
    expect(childKinds(revisedParagraph)).toEqual(['text'])
    expect(revisedParagraph.childAt(0).range).toEqual({ start: 0, end: 13 })
  })

  it('retains suffix CM literally only on the new arm code-span lane', () => {
    const revision = open('{~~plain~>`~~}{++literal++}`')
    expectTwoConditionalRoots(revision)

    const original = revision.projection('original')
    expect(original.source).toBe('plain`')
    const originalParagraph = original.markdown.root.childAt(0)
    expect(childKinds(originalParagraph)).toEqual(['text'])
    expect(originalParagraph.childAt(0).range).toEqual({ start: 0, end: 6 })

    const revised = revision.projection('revised')
    expect(revised.source).toBe('`{++literal++}`')
    expect(revised.provenance.originAt(1)).toEqual({
      kind: 'canonical',
      sourceOffset: 14
    })
    const revisedParagraph = revised.markdown.root.childAt(0)
    expect(childKinds(revisedParagraph)).toEqual(['inline-code'])
    expect(revisedParagraph.childAt(0).range).toEqual({ start: 0, end: 15 })
  })

  it('does not put suffix CM in the canonical forest when every lane owns it literally', () => {
    const revision = open('{~~`~>$~~}{++literal++}$`')
    expect(revision.criticMarkup.roots.map((node) => ({
      kind: node.kind,
      range: node.range
    }))).toEqual([
      { kind: 'substitution', range: { start: 0, end: 10 } }
    ])

    const original = revision.projection('original')
    expect(original.source).toBe('`{++literal++}$`')
    expect(original.provenance.originAt(1)).toEqual({
      kind: 'canonical',
      sourceOffset: 10
    })
    const originalParagraph = original.markdown.root.childAt(0)
    expect(childKinds(originalParagraph)).toEqual(['inline-code'])
    expect(originalParagraph.childAt(0).range).toEqual({ start: 0, end: 16 })

    const revised = revision.projection('revised')
    expect(revised.source).toBe('$' + '{++literal++}$`')
    expect(revised.provenance.originAt(1)).toEqual({
      kind: 'canonical',
      sourceOffset: 10
    })
    const revisedParagraph = revised.markdown.root.childAt(0)
    expect(childKinds(revisedParagraph)).toEqual(['inline-math', 'text'])
    expect(revisedParagraph.childAt(0).range).toEqual({ start: 0, end: 15 })
  })
})
