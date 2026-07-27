import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CompleteDocumentRevision,
  type DocumentRevision,
  type MarkdownNode,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  createProfile1DocumentReuseCache,
  parseProfile1Document
} from '../../src/internal/profile1Document.js'
import {
  __profile1PhysicalTraversalCountsV1,
  __resetProfile1PhysicalTraversalCountsV1
} from '../../src/internal/profile1/physicalTraversalAccounting.js'

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

function markdownNodeRecord(node: MarkdownNode): unknown {
  return {
    nodeId: node.nodeId,
    kind: node.kind,
    range: node.range,
    attributes: node.attributes,
    children: Array.from(
      { length: node.childCount },
      (_, ordinal) => markdownNodeRecord(node.childAt(ordinal))
    )
  }
}

function revisionRecord(revision: DocumentRevision): unknown {
  if (revision.kind === 'source-only') {
    return {
      kind: revision.kind,
      source: revision.source.text,
      sourceHash: revision.sourceHash,
      semanticHash: revision.semanticHash,
      configuration: revision.configuration,
      fatalDiagnostic: revision.fatalDiagnostic
    }
  }
  const projection = (view: 'original' | 'revised' | 'editing') => {
    const projected = revision.projection(view)
    return {
      source: projected.source,
      markdown: markdownNodeRecord(projected.markdown.root),
      origins: Array.from(
        { length: projected.source.length },
        (_, offset) => projected.provenance.originAt(offset)
      )
    }
  }
  return {
    kind: revision.kind,
    source: revision.source.text,
    sourceHash: revision.sourceHash,
    semanticHash: revision.semanticHash,
    configuration: revision.configuration,
    syntax: {
      nodes: Array.from(
        { length: revision.syntax.nodeCount },
        (_, ordinal) => revision.syntax.nodeAt(ordinal)
      ),
      edges: Array.from(
        { length: revision.syntax.edgeCount },
        (_, ordinal) => revision.syntax.edgeAt(ordinal)
      )
    },
    diagnostics: Array.from(
      { length: revision.diagnostics.count },
      (_, ordinal) => revision.diagnostics.at(ordinal)
    ),
    ownership: Array.from(
      { length: revision.ownership.count },
      (_, ordinal) => revision.ownership.at(ordinal)
    ),
    markup: Array.from(
      { length: revision.markup.runCount },
      (_, ordinal) => revision.markup.runAt(ordinal)
    ),
    original: projection('original'),
    revised: projection('revised'),
    editing: projection('editing')
  }
}

function complete(revision: DocumentRevision): CompleteDocumentRevision {
  expect(revision.kind).toBe('complete')
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete revision')
  }
  return revision
}

describe('Profile 1 fragment reuse', () => {
  it('reuses a same-shape plain-text revision without rescanning its source', () => {
    const beforeSource = 'x'.repeat(32_000)
    const afterSource = `${beforeSource.slice(0, -1)}z`
    const engine = createLanguageEngine()
    const before = complete(engine.open(
      createSourceSnapshot(beforeSource),
      CONFIGURATION
    ))

    __resetProfile1PhysicalTraversalCountsV1()
    const reused = engine.reopen(
      before,
      createSourceSnapshot(afterSource),
      Object.freeze([{
        start: beforeSource.length - 1,
        end: beforeSource.length,
        insert: 'z'
      }])
    )
    const reuseCounts = __profile1PhysicalTraversalCountsV1()
    const full = createLanguageEngine().open(
      createSourceSnapshot(afterSource),
      CONFIGURATION
    )

    expect(reuseCounts.intrinsicSource).toBe(0)
    expect(reuseCounts.intrinsicSourceUnits).toBe(0)
    expect(reuseCounts.forkAstRegionEmissions).toBe(0)
    expect(reuseCounts.forkAstRegionReuses).toBeGreaterThan(0)
    expect(revisionRecord(reused)).toEqual(revisionRecord(full))
  })

  it('falls back to grammar parsing when a plain-text edit adds syntax', () => {
    const beforeSource = 'aaaaa'
    const afterSource = 'a*b* '
    const engine = createLanguageEngine()
    const before = complete(engine.open(
      createSourceSnapshot(beforeSource),
      CONFIGURATION
    ))

    __resetProfile1PhysicalTraversalCountsV1()
    const reopened = engine.reopen(
      before,
      createSourceSnapshot(afterSource),
      Object.freeze([{
        start: 1,
        end: 5,
        insert: '*b* '
      }])
    )
    const reopenCounts = __profile1PhysicalTraversalCountsV1()
    const full = createLanguageEngine().open(
      createSourceSnapshot(afterSource),
      CONFIGURATION
    )

    expect(reopenCounts.intrinsicSource).toBe(1)
    expect(revisionRecord(reopened)).toEqual(revisionRecord(full))
  })

  it('reuses safe unchanged fragments and remains identical to a full parse', () => {
    const paragraphs = Array.from(
      { length: 32 },
      (_, index) =>
        `Paragraph ${index} with [link](https://example.test/${index}).`
    )
    const beforeSource = `${paragraphs.join('\n\n')}\n`
    const changedText = 'Paragraph 16 changed locally.'
    const changedParagraph = paragraphs[16]
    if (changedParagraph === undefined) {
      throw new Error('Expected the changed paragraph fixture')
    }
    const start = beforeSource.indexOf(changedParagraph)
    const end = start + changedParagraph.length
    const afterSource =
      beforeSource.slice(0, start) + changedText + beforeSource.slice(end)
    const engine = createLanguageEngine()
    const before = complete(engine.open(
      createSourceSnapshot(beforeSource),
      CONFIGURATION
    ))

    __resetProfile1PhysicalTraversalCountsV1()
    const reused = engine.reopen(
      before,
      createSourceSnapshot(afterSource),
      Object.freeze([{ start, end, insert: changedText }])
    )
    const reuseCounts = __profile1PhysicalTraversalCountsV1()
    const full = createLanguageEngine().open(
      createSourceSnapshot(afterSource),
      CONFIGURATION
    )

    expect(reuseCounts.forkAstRegionReuses).toBeGreaterThan(0)
    expect(revisionRecord(reused)).toEqual(revisionRecord(full))
  })

  it('emits the exact full-parse accounting trace and first resource failure', () => {
    const cache = createProfile1DocumentReuseCache()
    const before = 'head\n\nmiddle\n\ntail\n'
    const after = 'head\n\nmiddle changed\n\ntail\n'
    parseProfile1Document(
      before,
      CONFIGURATION.executionBudget,
      undefined,
      CONFIGURATION.markdownOptions,
      true,
      undefined,
      cache
    )
    const reused = parseProfile1Document(
      after,
      CONFIGURATION.executionBudget,
      undefined,
      CONFIGURATION.markdownOptions,
      true,
      undefined,
      cache
    )
    const full = parseProfile1Document(
      after,
      CONFIGURATION.executionBudget,
      undefined,
      CONFIGURATION.markdownOptions,
      true
    )
    expect(reused).toMatchObject({ kind: 'complete' })
    expect(full).toMatchObject({ kind: 'complete' })
    if (
      reused.kind !== 'complete' ||
      full.kind !== 'complete' ||
      reused.accountingTrace === undefined ||
      full.accountingTrace === undefined
    ) {
      throw new Error('Expected complete traced parses')
    }
    expect(reused.accountingTrace).toEqual(full.accountingTrace)

    const overDepth = `${'> '.repeat(129)}text\n`
    const reusedFailure = parseProfile1Document(
      overDepth,
      CONFIGURATION.executionBudget,
      undefined,
      CONFIGURATION.markdownOptions,
      true,
      undefined,
      cache
    )
    const fullFailure = parseProfile1Document(
      overDepth,
      CONFIGURATION.executionBudget,
      undefined,
      CONFIGURATION.markdownOptions,
      true
    )
    expect(reusedFailure).toEqual(fullFailure)
  })
})
