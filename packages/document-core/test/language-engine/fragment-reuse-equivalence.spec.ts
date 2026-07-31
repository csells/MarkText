import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  materializeDocumentFacts,
  type CompleteDocumentRevision,
  type DocumentRevision,
  type MarkdownNode,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  createProfile1DocumentReuseCache,
  parseProfile1Document,
  profile1DocumentReuseRetentionV1
} from '../../src/internal/profile1Document.js'
import {
  createPhysicalTraversalRecorderV1,
  type Profile1PhysicalTraversalCountsV1
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

function physicalDelta(
  after: Profile1PhysicalTraversalCountsV1,
  before: Profile1PhysicalTraversalCountsV1
): Profile1PhysicalTraversalCountsV1 {
  const keys = Object.keys(after) as (keyof Profile1PhysicalTraversalCountsV1)[]
  const delta = {} as Record<keyof Profile1PhysicalTraversalCountsV1, number>
  for (const key of keys) {
    delta[key] = after[key] - before[key]
  }
  return Object.freeze(delta)
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
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects a hostile many-edit reopen after one source pass', () => {
    const editCount = 1_024
    const beforeSource = 'a '.repeat(editCount)
    const edits = Object.freeze(Array.from(
      { length: editCount },
      (_, index) => Object.freeze({
        start: index * 2,
        end: index * 2 + 1,
        insert: 'b'
      })
    ))
    const nextSource = 'b '.repeat(editCount)
    const engine = createLanguageEngine()
    const before = complete(engine.open(
      createSourceSnapshot(beforeSource),
      CONFIGURATION
    ))
    const mismatched = createSourceSnapshot(`${nextSource}!`)
    const nativeSlice = String.prototype.slice
    let slices = 0
    vi.spyOn(String.prototype, 'slice').mockImplementation(function(
      this: string,
      start?: number,
      end?: number
    ) {
      slices += 1
      return nativeSlice.call(this, start, end)
    })

    expect(() => engine.reopen(before, mismatched, edits))
      .toThrow(/exact edits/i)
    expect(slices).toBeLessThanOrEqual(editCount + 2)
  })

  it('reuses a same-shape plain-text revision without rescanning its source', () => {
    const beforeSource = 'x'.repeat(32_000)
    const afterSource = `${beforeSource.slice(0, -1)}z`
    const engine = createLanguageEngine()
    const before = complete(engine.open(
      createSourceSnapshot(beforeSource),
      CONFIGURATION
    ))

    const physicalBase = engine.traversalCounts()
    const reused = engine.reopen(
      before,
      createSourceSnapshot(afterSource),
      Object.freeze([{
        start: beforeSource.length - 1,
        end: beforeSource.length,
        insert: 'z'
      }])
    )
    const reuseCounts = physicalDelta(engine.traversalCounts(), physicalBase)
    const full = createLanguageEngine().open(
      createSourceSnapshot(afterSource),
      CONFIGURATION
    )
    const completeFull = complete(full)

    expect(reuseCounts.intrinsicSource).toBe(0)
    expect(reuseCounts.intrinsicSourceUnits).toBe(0)
    expect(reuseCounts.forkAstRegionEmissions).toBe(0)
    expect(
      reuseCounts.forkAstRegionReuses +
      reuseCounts.forkAstRegionProvenanceReuses
    ).toBeGreaterThan(0)
    expect(revisionRecord(reused)).toEqual(revisionRecord(completeFull))
    expect(materializeDocumentFacts(reused)).toEqual(
      materializeDocumentFacts(full)
    )
    expect(materializeDocumentFacts(reused).statistics).toEqual({
      word: 1,
      paragraph: 1,
      character: afterSource.length,
      all: afterSource.length
    })
  })

  it('reuses a certified simple-text insertion with fresh public ranges', () => {
    const beforeSource = 'x'.repeat(32_000)
    const insertAt = Math.floor(beforeSource.length / 2)
    const afterSource =
      beforeSource.slice(0, insertAt) + 'yz' + beforeSource.slice(insertAt)
    const engine = createLanguageEngine()
    const before = complete(engine.open(
      createSourceSnapshot(beforeSource),
      CONFIGURATION
    ))

    const physicalBase = engine.traversalCounts()
    const reused = complete(engine.reopen(
      before,
      createSourceSnapshot(afterSource),
      Object.freeze([{ start: insertAt, end: insertAt, insert: 'yz' }])
    ))
    const reuseCounts = physicalDelta(engine.traversalCounts(), physicalBase)
    const full = createLanguageEngine().open(
      createSourceSnapshot(afterSource),
      CONFIGURATION
    )
    const completeFull = complete(full)

    expect(reuseCounts.intrinsicSource).toBe(0)
    expect(reuseCounts.intrinsicSourceUnits).toBe(0)
    expect(revisionRecord(reused)).toEqual(revisionRecord(full))
    expect(reused.ownership.ownerAt(afterSource.length - 1).range).toEqual({
      start: 0,
      end: afterSource.length
    })
    expect(reused.projection('editing').provenance.originAt(
      afterSource.length - 1
    )).toEqual({
      kind: 'canonical',
      sourceOffset: afterSource.length - 1
    })
    expect(() => reused.ownership.ownerAt(afterSource.length)).toThrow(RangeError)
    expect(() => reused.projection('editing').provenance.originAt(
      afterSource.length
    )).toThrow(RangeError)
    const reusedProjection = reused.projection('editing')
    const fullProjection = completeFull.projection('editing')
    for (const position of [0, 1, afterSource.length]) {
      for (const affinity of ['previous', 'next'] as const) {
        expect(reusedProjection.markdown.nodeAt(position, affinity).map(
          (node) => node.nodeId
        )).toEqual(fullProjection.markdown.nodeAt(position, affinity).map(
          (node) => node.nodeId
        ))
      }
    }
    for (const [start, end] of [
      [0, 0],
      [0, afterSource.length],
      [afterSource.length - 1, afterSource.length + 10],
      [afterSource.length, afterSource.length + 10]
    ] as const) {
      expect(
        reusedProjection.provenance.canonicalSourceRangeIntersects(start, end)
      ).toBe(
        fullProjection.provenance.canonicalSourceRangeIntersects(start, end)
      )
    }
    for (const [start, end] of [[-1, 0], [2, 1], [0.5, 1]] as const) {
      expect(() =>
        reusedProjection.provenance.canonicalSourceRangeIntersects(start, end)
      ).toThrow(RangeError)
      expect(() =>
        fullProjection.provenance.canonicalSourceRangeIntersects(start, end)
      ).toThrow(RangeError)
    }
  })

  it('certifies a terminal inert period across replacement and deletion', () => {
    const beforeSource = 'x'.repeat(32_000)
    const periodSource = `${beforeSource.slice(0, -1)}.`
    const afterSource = periodSource.slice(0, -1)
    const engine = createLanguageEngine()
    const before = complete(engine.open(
      createSourceSnapshot(beforeSource),
      CONFIGURATION
    ))

    const physicalBase = engine.traversalCounts()
    const withPeriod = complete(engine.reopen(
      before,
      createSourceSnapshot(periodSource),
      Object.freeze([{
        start: beforeSource.length - 1,
        end: beforeSource.length,
        insert: '.'
      }])
    ))
    const withoutPeriod = complete(engine.reopen(
      withPeriod,
      createSourceSnapshot(afterSource),
      Object.freeze([{
        start: periodSource.length - 1,
        end: periodSource.length,
        insert: ''
      }])
    ))
    const reuseCounts = physicalDelta(engine.traversalCounts(), physicalBase)
    const fullPeriod = createLanguageEngine().open(
      createSourceSnapshot(periodSource),
      CONFIGURATION
    )
    const fullAfter = createLanguageEngine().open(
      createSourceSnapshot(afterSource),
      CONFIGURATION
    )

    expect(reuseCounts.intrinsicSource).toBe(0)
    expect(reuseCounts.intrinsicSourceUnits).toBe(0)
    expect(revisionRecord(withPeriod)).toEqual(revisionRecord(fullPeriod))
    expect(revisionRecord(withoutPeriod)).toEqual(revisionRecord(fullAfter))
    expect(materializeDocumentFacts(withPeriod).statistics).toEqual({
      word: 1,
      paragraph: 1,
      character: periodSource.length,
      all: periodSource.length
    })
    expect(materializeDocumentFacts(withoutPeriod).statistics).toEqual({
      word: 1,
      paragraph: 1,
      character: afterSource.length,
      all: afterSource.length
    })
  })

  it('parses a numeric terminal period that changes Markdown topology', () => {
    const engine = createLanguageEngine()
    const before = complete(engine.open(
      createSourceSnapshot('1'),
      CONFIGURATION
    ))

    const physicalBase = engine.traversalCounts()
    const reopened = engine.reopen(
      before,
      createSourceSnapshot('1.'),
      Object.freeze([{ start: 1, end: 1, insert: '.' }])
    )
    const reopenCounts = physicalDelta(engine.traversalCounts(), physicalBase)
    const full = createLanguageEngine().open(
      createSourceSnapshot('1.'),
      CONFIGURATION
    )

    expect(reopenCounts.intrinsicSource).toBe(1)
    expect(revisionRecord(reopened)).toEqual(revisionRecord(full))
  })

  it('falls back to checkpointed parsing for an oversized simple-text insert', () => {
    const beforeSource = 'x'.repeat(32_000)
    const insert = 'y'.repeat(4_097)
    const afterSource = `${beforeSource}${insert}`
    const engine = createLanguageEngine()
    const before = complete(engine.open(
      createSourceSnapshot(beforeSource),
      CONFIGURATION
    ))

    const physicalBase = engine.traversalCounts()
    const reopened = engine.reopen(
      before,
      createSourceSnapshot(afterSource),
      Object.freeze([{
        start: beforeSource.length,
        end: beforeSource.length,
        insert
      }])
    )
    const reopenCounts = physicalDelta(engine.traversalCounts(), physicalBase)
    const full = createLanguageEngine().open(
      createSourceSnapshot(afterSource),
      CONFIGURATION
    )

    expect(reopenCounts.intrinsicSource).toBe(1)
    expect(revisionRecord(reopened)).toEqual(revisionRecord(full))
  })

  it('reuses a certified plain-text deletion without reparsing its source', () => {
    const beforeSource = 'x'.repeat(32_000)
    const afterSource = beforeSource.slice(0, -1)
    const engine = createLanguageEngine()
    const before = complete(engine.open(
      createSourceSnapshot(beforeSource),
      CONFIGURATION
    ))

    const physicalBase = engine.traversalCounts()
    const reused = engine.reopen(
      before,
      createSourceSnapshot(afterSource),
      Object.freeze([{
        start: beforeSource.length - 1,
        end: beforeSource.length,
        insert: ''
      }])
    )
    const reuseCounts = physicalDelta(engine.traversalCounts(), physicalBase)
    const full = createLanguageEngine().open(
      createSourceSnapshot(afterSource),
      CONFIGURATION
    )

    expect(reuseCounts.intrinsicSource).toBe(0)
    expect(reuseCounts.intrinsicSourceUnits).toBe(0)
    expect(reuseCounts.forkAstRegionEmissions).toBe(0)
    expect(
      reuseCounts.forkAstRegionReuses +
      reuseCounts.forkAstRegionProvenanceReuses
    ).toBeGreaterThan(0)
    expect(revisionRecord(reused)).toEqual(revisionRecord(full))
  })

  it('rehashes a terminal length-changing edit from its nearest checkpoint', () => {
    const beforeSource = 'x'.repeat(32_000)
    const afterSource = beforeSource.slice(0, -1)
    let sourceUnits = 0
    const engine = createLanguageEngine({
      checkpoint: progress => {
        sourceUnits = progress.sourceUnits
      }
    })
    const before = complete(engine.open(
      createSourceSnapshot(beforeSource),
      CONFIGURATION
    ))
    const beforeReopenSourceUnits = sourceUnits

    engine.reopen(
      before,
      createSourceSnapshot(afterSource),
      Object.freeze([{
        start: beforeSource.length - 1,
        end: beforeSource.length,
        insert: ''
      }])
    )

    expect(sourceUnits - beforeReopenSourceUnits)
      .toBeLessThanOrEqual(4_096)
  })

  it('falls back to grammar parsing when a plain-text edit adds syntax', () => {
    const beforeSource = 'aaaaa'
    const afterSource = 'a*b* '
    const engine = createLanguageEngine()
    const before = complete(engine.open(
      createSourceSnapshot(beforeSource),
      CONFIGURATION
    ))

    const physicalBase = engine.traversalCounts()
    const reopened = engine.reopen(
      before,
      createSourceSnapshot(afterSource),
      Object.freeze([{
        start: 1,
        end: 5,
        insert: '*b* '
      }])
    )
    const reopenCounts = physicalDelta(engine.traversalCounts(), physicalBase)
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

    const physicalBase = engine.traversalCounts()
    const reused = engine.reopen(
      before,
      createSourceSnapshot(afterSource),
      Object.freeze([{ start, end, insert: changedText }])
    )
    const reuseCounts = physicalDelta(engine.traversalCounts(), physicalBase)
    const full = createLanguageEngine().open(
      createSourceSnapshot(afterSource),
      CONFIGURATION
    )

    expect(
      reuseCounts.forkAstRegionReuses +
      reuseCounts.forkAstRegionProvenanceReuses
    ).toBeGreaterThan(0)
    expect(revisionRecord(reused)).toEqual(revisionRecord(full))
  })

  it('byte-bounds session-lifetime reuse across large syntax-changing revisions', () => {
    const cache = createProfile1DocumentReuseCache()
    const body = 'x'.repeat(96 * 1_024)
    // Enough distinct revisions to overflow the total retention budget: each
    // retains at least its source string twice (key digestion keeps keys
    // small, but the entry value holds the exact region source).
    const revisionCount = Math.ceil(
      profile1DocumentReuseRetentionV1(cache).maximumRetainedBytes /
      (body.length * 2)
    ) + 8

    for (let revision = 0; revision < revisionCount; revision += 1) {
      const heading = '#'.repeat(revision % 6 + 1)
      const source = `${heading} revision ${String(revision)}\n${body}${String(revision)}\n`
      const parsed = parseProfile1Document(
        source,
        CONFIGURATION.executionBudget,
        undefined,
        CONFIGURATION.markdownOptions,
        false,
        undefined,
        cache
      )
      expect(parsed.kind).toBe('complete')
    }

    const retention = profile1DocumentReuseRetentionV1(cache)
    expect(retention.entries).toBeLessThan(revisionCount)
    expect(retention.keyBytes).toBeLessThanOrEqual(retention.maximumRetainedBytes)
    expect(retention.valueBytes).toBeLessThanOrEqual(
      retention.maximumRetainedBytes
    )
    expect(retention.overheadBytes).toBeGreaterThanOrEqual(
      retention.entries * 96
    )
    expect(retention.retainedBytes).toBe(
      retention.keyBytes + retention.valueBytes + retention.overheadBytes
    )
    expect(retention.retainedBytes).toBeLessThanOrEqual(
      retention.maximumRetainedBytes
    )
    expect(profile1DocumentReuseRetentionV1(createProfile1DocumentReuseCache()))
      .toMatchObject({
        entries: 0,
        keyBytes: 0,
        valueBytes: 0,
        overheadBytes: 0,
        retainedBytes: 0
      })
    // ~5 s alone; headroom for the full-suite parallel load, like the 500 KB
    // reuse target above.
  }, 30_000)

  it('does not construct cache keys or retain an oversized region', () => {
    const cache = createProfile1DocumentReuseCache()
    const maximumRetainedBytes =
      profile1DocumentReuseRetentionV1(cache).maximumRetainedEntryBytes
    const source = `# oversized\n${'x'.repeat(
      Math.floor(maximumRetainedBytes / 2) + 1
    )}\n`
    const stringify = vi.spyOn(JSON, 'stringify')
    const nativeIncludes = String.prototype.includes
    let oversizedReferenceScans = 0
    vi.spyOn(String.prototype, 'includes').mockImplementation(function(
      this: string,
      searchString: string,
      position?: number
    ) {
      if (
        this.length > maximumRetainedBytes / 2 &&
        (searchString === '[' || searchString === ']')
      ) {
        oversizedReferenceScans += 1
      }
      return nativeIncludes.call(this, searchString, position)
    })

    const parsed = parseProfile1Document(
      source,
      CONFIGURATION.executionBudget,
      undefined,
      CONFIGURATION.markdownOptions,
      false,
      undefined,
      cache
    )
    const serializedOversizedCacheKeys = stringify.mock.calls.filter(
      ([value]) => Array.isArray(value) && value.some(
        (entry) => typeof entry === 'string' && entry.length >
          maximumRetainedBytes / 2
      )
    )
    stringify.mockRestore()
    const full = parseProfile1Document(
      source,
      CONFIGURATION.executionBudget,
      undefined,
      CONFIGURATION.markdownOptions,
      false
    )

    expect(serializedOversizedCacheKeys).toHaveLength(0)
    expect(oversizedReferenceScans).toBe(0)
    expect(profile1DocumentReuseRetentionV1(cache)).toMatchObject({
      entries: 0,
      keyBytes: 0,
      valueBytes: 0,
      overheadBytes: 0,
      retainedBytes: 0
    })
    expect(parsed).toMatchObject({ kind: 'complete' })
    expect(full).toMatchObject({ kind: 'complete' })
    if (parsed.kind !== 'complete' || full.kind !== 'complete') {
      throw new Error('Expected complete oversized-region parses')
    }
    expect(parsed.canonicalTape).toEqual(full.canonicalTape)
    expect(parsed.markerDecisions).toEqual(full.markerDecisions)
    expect(parsed.markdownLiterals).toEqual(full.markdownLiterals)
    expect(markdownNodeRecord(parsed.original.markdown.root)).toEqual(
      markdownNodeRecord(full.original.markdown.root)
    )
    expect(markdownNodeRecord(parsed.revised.markdown.root)).toEqual(
      markdownNodeRecord(full.revised.markdown.root)
    )
  }, 15_000)

  it('does not duplicate a provably oversized high-node AST as templates', () => {
    const cache = createProfile1DocumentReuseCache()
    const source = `${'*x* '.repeat(24_000)}\n`
    const recorder = createPhysicalTraversalRecorderV1()

    const parsed = parseProfile1Document(
      source,
      CONFIGURATION.executionBudget,
      undefined,
      CONFIGURATION.markdownOptions,
      false,
      undefined,
      cache,
      recorder
    )
    const templateConstructions = recorder.counts().astCacheTemplateConstructions
    const retention = profile1DocumentReuseRetentionV1(cache)
    const full = parseProfile1Document(
      source,
      CONFIGURATION.executionBudget,
      undefined,
      CONFIGURATION.markdownOptions,
      false
    )

    expect(templateConstructions).toBe(0)
    expect(retention).toMatchObject({
      entries: 0,
      keyBytes: 0,
      valueBytes: 0,
      overheadBytes: 0,
      retainedBytes: 0
    })
    expect(parsed).toMatchObject({ kind: 'complete' })
    expect(full).toMatchObject({ kind: 'complete' })
    if (parsed.kind !== 'complete' || full.kind !== 'complete') {
      throw new Error('Expected complete high-node parses')
    }
    expect(parsed.canonicalTape).toEqual(full.canonicalTape)
    expect(parsed.markerDecisions).toEqual(full.markerDecisions)
    expect(parsed.markdownLiterals).toEqual(full.markdownLiterals)
    expect(markdownNodeRecord(parsed.original.markdown.root)).toEqual(
      markdownNodeRecord(full.original.markdown.root)
    )
    expect(markdownNodeRecord(parsed.revised.markdown.root)).toEqual(
      markdownNodeRecord(full.revised.markdown.root)
    )
  }, 15_000)

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
    // Trace identity is only evidence if the reusing parse actually reused.
    // Without this, a cache that declined every fragment would compare two
    // full parses and pass.
    const reuseRecorder = createPhysicalTraversalRecorderV1()
    const reused = parseProfile1Document(
      after,
      CONFIGURATION.executionBudget,
      undefined,
      CONFIGURATION.markdownOptions,
      true,
      undefined,
      cache,
      reuseRecorder
    )
    const reuseEngagement =
      reuseRecorder.counts().forkAstRegionReuses +
      reuseRecorder.counts().forkAstRegionProvenanceReuses
    const fullRecorder = createPhysicalTraversalRecorderV1()
    const full = parseProfile1Document(
      after,
      CONFIGURATION.executionBudget,
      undefined,
      CONFIGURATION.markdownOptions,
      true,
      undefined,
      undefined,
      fullRecorder
    )
    const fullEngagement =
      fullRecorder.counts().forkAstRegionReuses +
      fullRecorder.counts().forkAstRegionProvenanceReuses
    expect(reuseEngagement, 'the reusing parse must engage fragment reuse').toBeGreaterThan(0)
    expect(fullEngagement, 'the full parse must reuse nothing').toBe(0)
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
