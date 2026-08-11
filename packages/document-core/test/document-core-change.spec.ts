import { describe, expect, it } from 'vitest'

import {
  createDocumentCore,
  type MarkupEvent,
  type MarkupMark,
  type MarkupProjection,
  type MarkupRegionReplacement,
  type OrdinalRange,
  type SourceRange
} from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

interface ChangeInspection {
  readonly documentParses: number
  readonly documentParseSourceUnits: number
  readonly regionalIntrinsicSourceUnits: number
  readonly regionalFastApplies: number
  readonly documentProjectionPreparationUnits: number
  readonly documentMarkupEventUnits: number
  readonly documentAstMaterializedNodes: number
  readonly documentCoordinateSegments: number
  readonly canonicalFactIndexUnits: number
  readonly regionalProjectionPreparationUnits: number
  readonly regionalMarkupEventUnits: number
  readonly regionalAstMaterializedNodes: number
  readonly regionalCoordinateSegments: number
  readonly retainedFactInputStructuralUnits: number
  readonly retainedFactOutputStructuralUnits: number
  readonly retainedIndexLookupComparisons: number
  readonly retainedOverlayNodeVisits: number
  readonly retainedOverlayNodesAllocated: number
  readonly retainedOverlayNodesReused: number
  readonly retainedChangedLeafUnits: number
  readonly retainedCommittedUpdates: number
  readonly retainedLocalIndexUnitsCopied: number
  readonly retainedInitialBuildUnits: number
  readonly retainedOverlayMaximumDepth: number
  readonly sourceReconstructionOutputUnits: number
}

const ordinalRange = (range: OrdinalRange): OrdinalRange => range

function inspectionOf(core: ReturnType<typeof createDocumentCore>): ChangeInspection {
  return inspectDocumentCore(core) as unknown as ChangeInspection
}

function delta(
  after: ChangeInspection,
  before: ChangeInspection,
  key: keyof ChangeInspection
): number {
  return after[key] - before[key]
}

function eventsOf(projection: MarkupProjection): readonly MarkupEvent[] {
  return projection.events
}

function applyMarkupReplacement(
  previousEvents: readonly MarkupEvent[],
  replacement: MarkupRegionReplacement
): readonly MarkupEvent[] {
  const sourceDelta =
    replacement.next.source.end - replacement.previous.source.end
  const shiftedMarks = new WeakMap<object, MarkupMark>()
  const shiftRange = (range: SourceRange): SourceRange => {
    if (range.end <= replacement.previous.source.end) return range
    if (range.start < replacement.previous.source.end) {
      throw new Error('Regional Markup replacement bisects a retained range')
    }
    return Object.freeze({
      start: range.start + sourceDelta,
      end: range.end + sourceDelta
    })
  }
  const shiftMark = (mark: MarkupMark): MarkupMark => {
    const cached = shiftedMarks.get(mark)
    if (cached !== undefined) return cached
    const shifted = Object.freeze({
      ...mark,
      annotationRange: shiftRange(mark.annotationRange)
    }) as MarkupMark
    shiftedMarks.set(mark, shifted)
    return shifted
  }
  const shiftEvent = (event: MarkupEvent): MarkupEvent => event.kind === 'text'
    ? Object.freeze({
      ...event,
      sourceRange: shiftRange(event.sourceRange)
    })
    : Object.freeze({ ...event, mark: shiftMark(event.mark) })
  const events = replacement.previous.events
  return Object.freeze([
    ...previousEvents.slice(0, events.start),
    ...replacement.events,
    ...previousEvents.slice(events.end).map(shiftEvent)
  ])
}

function assertPortable(value: unknown): void {
  expect(() => structuredClone(value)).not.toThrow()
  const pending: unknown[] = [value]
  const seen = new Set<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === null || typeof current !== 'object') {
      expect(typeof current).not.toBe('function')
      continue
    }
    if (seen.has(current)) continue
    seen.add(current)
    for (const [key, child] of Object.entries(current)) {
      expect(key.toLowerCase()).not.toContain('nodeid')
      expect(typeof child).not.toBe('function')
      pending.push(child)
    }
  }
}

describe('document-core semantic changes', () => {
  it('emits a bounded Markup replacement for one inert middle-paragraph edit', () => {
    const suffix = Array.from(
      { length: 10_000 },
      (_, index) => `suffix ${String(index)}\n\n`
    ).join('')
    const source = `one\n\ntarget word\n\n${suffix}`
    const insertAt = source.indexOf('word') + 2
    const nextSource =
      source.slice(0, insertAt) + 'X' + source.slice(insertAt)
    const core = createDocumentCore()
    const opened = core.open(source)
    const previousMarkup = core.project(opened, 'markup')
    const before = inspectionOf(core)

    const commit = core.apply(opened, [{
      start: insertAt,
      end: insertAt,
      insert: 'X'
    }], { projections: ['markup'] } as never)
    const after = inspectionOf(core)
    const changes = commit.change.projections

    expect(commit.revision.source).toBe(nextSource)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ name: 'markup', scope: 'regions' })
    const change = changes[0]
    if (change?.scope !== 'regions') throw new Error('Expected regional change')
    expect(change.replacements).toHaveLength(1)
    const replacement = change.replacements[0]
    expect(replacement).toBeDefined()
    if (replacement === undefined) throw new Error('Expected Markup replacement')
    expect(replacement.previous.source).toEqual({ start: 5, end: 18 })
    expect(replacement.next.source).toEqual({ start: 5, end: 19 })
    expect(ordinalRange(replacement.previous.events).start).toBeGreaterThan(0)
    expect(replacement.previous.events.end - replacement.previous.events.start)
      .toBe(1)
    expect(replacement.next.events.end - replacement.next.events.start)
      .toBe(replacement.events.length)
    expect(replacement.events).toEqual([{
      kind: 'text',
      text: 'target woXrd\n\n',
      sourceRange: { start: 5, end: 19 }
    }])
    expect(replacement.syntaxBlocks).toEqual([{
      kind: 'paragraph',
      range: { start: 5, end: 17 },
      attributes: {},
      children: [{
        kind: 'text',
        range: { start: 5, end: 17 },
        attributes: {},
        children: []
      }]
    }])
    expect(replacement.coordinates).toEqual([
      {
        projected: { start: 5, end: 17 },
        source: { start: 5, end: 17 }
      },
      {
        projected: { start: 17, end: 18 },
        source: { start: 17, end: 18 }
      },
      {
        projected: { start: 18, end: 19 },
        source: { start: 18, end: 19 }
      }
    ])
    assertPortable(commit.change)

    expect(delta(after, before, 'regionalFastApplies')).toBe(1)
    expect(delta(after, before, 'documentParses')).toBe(0)
    expect(delta(after, before, 'documentParseSourceUnits')).toBe(0)
    expect(delta(after, before, 'documentProjectionPreparationUnits')).toBe(0)
    expect(delta(after, before, 'documentMarkupEventUnits')).toBe(0)
    expect(delta(after, before, 'documentAstMaterializedNodes')).toBe(0)
    expect(delta(after, before, 'documentCoordinateSegments')).toBe(0)
    expect(delta(after, before, 'canonicalFactIndexUnits')).toBe(0)
    expect(delta(after, before, 'regionalProjectionPreparationUnits'))
      .toBeLessThan(source.length)
    expect(delta(after, before, 'regionalProjectionPreparationUnits'))
      .toBeGreaterThan(0)
    expect(delta(after, before, 'regionalMarkupEventUnits'))
      .toBeLessThan(source.length)
    expect(delta(after, before, 'regionalMarkupEventUnits'))
      .toBeGreaterThan(0)
    expect(delta(after, before, 'regionalIntrinsicSourceUnits'))
      .toBeGreaterThan(0)
    expect(delta(after, before, 'regionalIntrinsicSourceUnits'))
      .toBeLessThan(source.length)
    expect(delta(after, before, 'regionalAstMaterializedNodes'))
      .toBeGreaterThan(0)
    expect(delta(after, before, 'regionalCoordinateSegments'))
      .toBeGreaterThan(0)

    const previousEvents = eventsOf(previousMarkup)
    // A production adapter can retain the suffix in a shifted persistent
    // segment. This small oracle materializes that shift only to compare the
    // resulting absolute ranges with a fresh authoritative projection.
    const spliced = applyMarkupReplacement(previousEvents, replacement)
    const fullCore = createDocumentCore()
    const full = fullCore.open(nextSource)
    const fullMarkup = fullCore.project(full, 'markup')
    expect(spliced).toEqual(eventsOf(fullMarkup))
    expect(replacement.syntaxBlocks[0]).toEqual(
      fullMarkup.syntax.ast.root.children[1]
    )
    for (const segment of replacement.coordinates) {
      for (
        let offset = segment.projected.start;
        offset < segment.projected.end;
        offset += 1
      ) {
        expect(fullMarkup.syntax.coordinates.originAt(offset)).toEqual({
          kind: 'source',
          sourceOffset: segment.source.start +
            offset - segment.projected.start
        })
      }
    }
  })

  it('chains two same-paragraph regional applies without a lazy document parse', () => {
    const source = 'head\n\ntarget word\n\ntail\n\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const before = inspectionOf(core)
    const firstAt = source.indexOf('word') + 1
    const first = core.apply(opened, [{
      start: firstAt,
      end: firstAt,
      insert: 'A'
    }], { projections: ['markup'] })
    const secondAt = firstAt + 2
    const second = core.apply(first.revision, [{
      start: secondAt,
      end: secondAt,
      insert: 'B'
    }], { projections: ['markup'] })
    const after = inspectionOf(core)

    expect(first.change.projections[0]?.scope).toBe('regions')
    expect(second.change.projections[0]?.scope).toBe('regions')
    expect(second.revision.source).toBe('head\n\ntarget wAoBrd\n\ntail\n\n')
    expect(delta(after, before, 'regionalFastApplies')).toBe(2)
    expect(delta(after, before, 'documentParses')).toBe(0)
    expect(delta(after, before, 'documentParseSourceUnits')).toBe(0)
    expect(delta(after, before, 'documentProjectionPreparationUnits')).toBe(0)
    expect(delta(after, before, 'canonicalFactIndexUnits')).toBe(0)
  })

  it.each([
    {
      name: 'punctuation changes paragraph structure',
      source: 'head\n\ntarget word\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('target'),
        end: source.indexOf('target'),
        insert: '#'
      }),
      reason: 'structural-region-ineligible'
    },
    {
      name: 'a newline changes paragraph structure',
      source: 'head\n\ntarget word\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('word'),
        end: source.indexOf('word'),
        insert: '\n'
      }),
      reason: 'structural-region-ineligible'
    },
    {
      name: 'whitespace becomes a paragraph',
      source: 'head\n\n   \n\ntail\n\n',
      edit: () => ({
        start: 7,
        end: 7,
        insert: 'X'
      }),
      reason: 'structural-region-ineligible'
    },
    {
      name: 'a paragraph becomes whitespace',
      source: 'head\n\ntarget\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('target'),
        end: source.indexOf('target') + 'target'.length,
        insert: '   '
      }),
      reason: 'structural-region-ineligible'
    },
    {
      name: 'CriticMarkup facts are present',
      source: 'head {++added++}\n\ntarget word\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('word'),
        end: source.indexOf('word'),
        insert: 'X'
      }),
      reason: 'criticmarkup-facts-present'
    },
    {
      name: 'definition and reference facts are present',
      source: 'head [ref]\n\ntarget word\n\n[ref]: /url\n',
      edit: (source: string) => ({
        start: source.indexOf('word'),
        end: source.indexOf('word'),
        insert: 'X'
      }),
      reason: 'definition-or-reference-facts'
    }
  ])('publishes a document Markup fallback when $name', ({
    source,
    edit,
    reason
  }) => {
    const core = createDocumentCore()
    const opened = core.open(source)
    const commit = core.apply(opened, [edit(source)], {
      projections: ['markup']
    })

    expect(commit.change.projections).toEqual([{
      name: 'markup',
      scope: 'document',
      reason
    }])
  })

  it('publishes a document Markup fallback when Markdown options change', () => {
    const source = 'head\n\ntarget word\n\ntail\n\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const at = source.indexOf('word')
    const commit = core.apply(opened, [{ start: at, end: at, insert: 'X' }], {
      markdown: { gfm: false },
      projections: ['markup']
    })

    expect(commit.change.projections).toEqual([{
      name: 'markup',
      scope: 'document',
      reason: 'markdown-options-changed'
    }])
  })

  it('rejects projection requests outside the one supported delta contract', () => {
    const source = 'head\n\ntarget word\n\ntail\n\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const at = source.indexOf('word')
    for (const projections of [
      ['revised'],
      ['markup', 'markup']
    ]) {
      expect(() => core.apply(opened, [
        { start: at, end: at, insert: 'X' }
      ], { projections } as never)).toThrow(/exactly \["markup"\]/)
    }
  })

  it('scales retained overlay work logarithmically from 1k to 100k regions', () => {
    const overlayWorkFor = (suffixParagraphs: number): Readonly<{
      comparisons: number
      visits: number
      allocations: number
      localCopies: number
    }> => {
      const suffix = 'suffix\n\n'.repeat(suffixParagraphs)
      const source = `head\n\ntarget word\n\n${suffix}`
      const core = createDocumentCore()
      let revision = core.open(source)
      const before = inspectionOf(core)
      const at = source.indexOf('word') + 1
      for (let index = 0; index < 32; index += 1) {
        revision = core.apply(revision, [
          { start: at, end: at, insert: 'X' }
        ], { projections: ['markup'] }).revision
      }
      const after = inspectionOf(core)
      return Object.freeze({
        comparisons: delta(after, before, 'retainedIndexLookupComparisons'),
        visits: delta(after, before, 'retainedOverlayNodeVisits'),
        allocations: delta(after, before, 'retainedOverlayNodesAllocated'),
        localCopies: delta(after, before, 'retainedLocalIndexUnitsCopied')
      })
    }

    const small = overlayWorkFor(1_000)
    const large = overlayWorkFor(100_000)
    expect(large.comparisons).toBeLessThan(small.comparisons * 3)
    expect(large.visits).toBeLessThan(small.visits * 3)
    expect(large.allocations).toBeLessThan(small.allocations * 3)
    expect(large.localCopies).toBe(large.allocations)
  })

  it('lazily projects head and older regional revisions in isolation', () => {
    const source = 'head\n\ntarget word\n\ntail\n\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const firstAt = source.indexOf('word') + 1
    const first = core.apply(opened, [{
      start: firstAt,
      end: firstAt,
      insert: 'A'
    }], { projections: ['markup'] })
    const secondAt = firstAt + 2
    const second = core.apply(first.revision, [{
      start: secondAt,
      end: secondAt,
      insert: 'B'
    }], { projections: ['markup'] })
    const beforeProjection = inspectionOf(core)

    const headProjection = core.project(second.revision, 'markup')
    const olderProjection = core.project(first.revision, 'markup')
    const afterProjection = inspectionOf(core)
    const freshProjection = (revisionSource: string): MarkupProjection => {
      const freshCore = createDocumentCore()
      const freshRevision = freshCore.open(revisionSource)
      return freshCore.project(freshRevision, 'markup')
    }
    const freshHead = freshProjection(second.revision.source)
    const freshOlder = freshProjection(first.revision.source)

    expect(headProjection.events).toEqual(freshHead.events)
    expect(headProjection.syntax.ast).toEqual(freshHead.syntax.ast)
    expect(olderProjection.events).toEqual(freshOlder.events)
    expect(olderProjection.syntax.ast).toEqual(freshOlder.syntax.ast)
    expect(delta(afterProjection, beforeProjection, 'documentParses')).toBe(2)
    expect(delta(afterProjection, beforeProjection, 'documentParseSourceUnits'))
      .toBe(first.revision.source.length + second.revision.source.length)
  })

  it('projects a wide Markdown root without variadic child expansion', () => {
    const paragraphCount = 130_000
    const core = createDocumentCore()
    const opened = core.open('x\n\n'.repeat(paragraphCount))

    const projection = core.project(opened, 'markup')

    expect(projection.syntax.ast.root.children).toHaveLength(paragraphCount)
  })

  it('shares retained suffix facts across 100 regional paragraph edits', () => {
    const suffix = Array.from(
      { length: 10_000 },
      (_, index) => `suffix ${String(index)}\n\n`
    ).join('')
    let expectedSource = `head\n\ntarget word\n\n${suffix}`
    const core = createDocumentCore()
    let revision = core.open(expectedSource)
    const before = inspectionOf(core)
    expect(before.retainedInitialBuildUnits).toBeGreaterThan(10_000)
    const insertAt = expectedSource.indexOf('word') + 1

    for (let index = 0; index < 100; index += 1) {
      expectedSource =
        expectedSource.slice(0, insertAt) +
        'X' +
        expectedSource.slice(insertAt)
      const commit = core.apply(revision, [{
        start: insertAt,
        end: insertAt,
        insert: 'X'
      }], { projections: ['markup'] })
      expect(commit.revision.source).toBe(expectedSource)
      expect(commit.change.appliedEdits).toEqual([{
        start: insertAt,
        end: insertAt,
        insert: 'X'
      }])
      const projection = commit.change.projections[0]
      expect(projection?.scope).toBe('regions')
      if (projection?.scope !== 'regions') {
        throw new Error('Expected repeated regional Markup change')
      }
      const replacement = projection.replacements[0]
      if (replacement === undefined) throw new Error('Expected replacement')
      expect(replacement.events).toEqual([{
        kind: 'text',
        text: expectedSource.slice(
          replacement.next.source.start,
          replacement.next.source.end
        ),
        sourceRange: replacement.next.source
      }])
      revision = commit.revision
    }
    const after = inspectionOf(core)

    expect(delta(after, before, 'regionalFastApplies')).toBe(100)
    expect(delta(after, before, 'documentParses')).toBe(0)
    expect(delta(after, before, 'documentParseSourceUnits')).toBe(0)
    expect(delta(after, before, 'retainedIndexLookupComparisons'))
      .toBeLessThan(100_000)
    expect(delta(after, before, 'retainedOverlayNodeVisits'))
      .toBeLessThan(100_000)
    expect(delta(after, before, 'retainedOverlayNodesAllocated'))
      .toBeLessThan(10_000)
    expect(delta(after, before, 'retainedChangedLeafUnits')).toBe(100)
    expect(delta(after, before, 'retainedCommittedUpdates')).toBe(100)
    expect(delta(after, before, 'retainedLocalIndexUnitsCopied'))
      .toBe(delta(after, before, 'retainedOverlayNodesAllocated'))
    expect(delta(after, before, 'retainedFactOutputStructuralUnits'))
      .toBeLessThan(10_000)
    expect(delta(after, before, 'retainedInitialBuildUnits')).toBe(0)
    // Canonical source is still reconstructed eagerly on every apply. This
    // slice removes retained-fact suffix copying, not full-string output.
    expect(delta(after, before, 'sourceReconstructionOutputUnits'))
      .toBeGreaterThan(expectedSource.length * 90)

    const projected = core.project(revision, 'markup')
    const freshCore = createDocumentCore()
    const fresh = freshCore.open(expectedSource)
    const freshProjected = freshCore.project(fresh, 'markup')
    expect(projected.events).toEqual(freshProjected.events)
    expect(projected.syntax.ast).toEqual(freshProjected.syntax.ast)
  })

  it('retains 64 historical overlay roots over 100k regions', () => {
    const source = `first\n\n${'p\n\n'.repeat(49_999)}target word\n\n${
      'p\n\n'.repeat(49_999)
    }last\n\n`
    const core = createDocumentCore()
    const revisions = [core.open(source)]
    const at = source.indexOf('word') + 1
    for (let index = 0; index < 64; index += 1) {
      const previous = revisions.at(-1)
      if (previous === undefined) throw new Error('Expected overlay head')
      revisions.push(core.apply(previous, [{
        start: at,
        end: at,
        insert: 'X'
      }], { projections: ['markup'] }).revision)
    }

    expect(revisions).toHaveLength(65)
    expect(revisions[0]?.source).toBe(source)
    expect(revisions[32]?.source).toContain(`w${'X'.repeat(32)}ord`)
    expect(revisions[64]?.source).toContain(`w${'X'.repeat(64)}ord`)
    expect(revisions[64]?.source.startsWith('first\n\n')).toBe(true)
    expect(revisions[64]?.source.endsWith('last\n\n')).toBe(true)
    const inspection = inspectionOf(core)
    expect(inspection.retainedCommittedUpdates).toBe(64)
    expect(inspection.retainedOverlayNodesAllocated).toBeLessThan(2_000)
    expect(inspection.retainedOverlayMaximumDepth).toBeLessThan(32)
  })

  it('updates boundary and alternating far-region overlay ranks', () => {
    let source = 'guard\n\nfirst word\n\nmiddle word\n\nlast word\n\nguardtail\n\n'
    const core = createDocumentCore()
    let revision = core.open(source)
    for (const editOf of [
      (text: string) => ({
        start: text.indexOf('middle'),
        end: text.indexOf('middle'),
        insert: 'X'
      }),
      (text: string) => ({
        start: text.indexOf('middle word') + 'middle word'.length,
        end: text.indexOf('middle word') + 'middle word'.length,
        insert: 'Y'
      }),
      (text: string) => ({
        start: text.indexOf('first') + 1,
        end: text.indexOf('first') + 1,
        insert: 'A'
      }),
      (text: string) => ({
        start: text.indexOf('last') + 1,
        end: text.indexOf('last') + 1,
        insert: 'B'
      }),
      (text: string) => ({
        start: text.indexOf('fAirst') + 2,
        end: text.indexOf('fAirst') + 2,
        insert: 'C'
      })
    ]) {
      const edit = editOf(source)
      source = source.slice(0, edit.start) + edit.insert + source.slice(edit.end)
      const commit = core.apply(revision, [edit], { projections: ['markup'] })
      expect(
        commit.change.projections[0]?.scope,
        JSON.stringify(edit)
      ).toBe('regions')
      expect(commit.revision.source).toBe(source)
      revision = commit.revision
    }
    const freshCore = createDocumentCore()
    const fresh = freshCore.open(source)
    expect(core.project(revision, 'markup').events)
      .toEqual(freshCore.project(fresh, 'markup').events)
    expect(inspectionOf(core).retainedOverlayNodesReused).toBeGreaterThan(0)
  })

  it('maps an early 1k growth before a penultimate negative delta', () => {
    const middle = 'p\n\n'.repeat(10_000)
    let source = `guard\n\nearlyword\n\n${middle}penultimateword\n\nlastword\n\nguardtail\n\n`
    const core = createDocumentCore()
    let revision = core.open(source)
    const earlyAt = source.indexOf('earlyword') + 5
    const growth = 'X'.repeat(1_000)
    source = source.slice(0, earlyAt) + growth + source.slice(earlyAt)
    const first = core.apply(revision, [{
      start: earlyAt,
      end: earlyAt,
      insert: growth
    }], { projections: ['markup'] })
    expect(first.change.projections[0]?.scope).toBe('regions')
    revision = first.revision

    const penultimateAt = source.indexOf('penultimateword') + 11
    source = source.slice(0, penultimateAt) + source.slice(penultimateAt + 1)
    const second = core.apply(revision, [{
      start: penultimateAt,
      end: penultimateAt + 1,
      insert: ''
    }], { projections: ['markup'] })
    expect(second.change.projections[0]?.scope).toBe('regions')
    expect(second.revision.source).toBe(source)
    const secondChange = second.change.projections[0]
    if (secondChange?.scope !== 'regions') throw new Error('Expected region')
    expect(secondChange.replacements[0]?.previous.source.start)
      .toBeGreaterThan(1_000)

    const freshCore = createDocumentCore()
    const fresh = freshCore.open(source)
    expect(core.project(second.revision, 'markup').syntax.ast)
      .toEqual(freshCore.project(fresh, 'markup').syntax.ast)
  })

  it('chains a zero-delta replacement into a far regional edit', () => {
    let source = 'guard\n\ntarget word\n\nmiddle\n\nfar word\n\nguardtail\n\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const beforeReplacement = inspectionOf(core)
    const wordAt = source.indexOf('word')
    source = source.slice(0, wordAt) + 'WXYZ' + source.slice(wordAt + 4)
    const replacement = core.apply(opened, [{
      start: wordAt,
      end: wordAt + 4,
      insert: 'WXYZ'
    }], { projections: ['markup'] })
    const afterReplacement = inspectionOf(core)

    expect(replacement.change.projections[0]?.scope).toBe('regions')
    expect(replacement.revision.source).toBe(source)
    expect(delta(
      afterReplacement,
      beforeReplacement,
      'retainedOverlayNodesAllocated'
    )).toBe(0)
    expect(delta(
      afterReplacement,
      beforeReplacement,
      'retainedChangedLeafUnits'
    )).toBe(0)
    expect(delta(
      afterReplacement,
      beforeReplacement,
      'retainedCommittedUpdates'
    )).toBe(1)

    const farAt = source.indexOf('far word') + 1
    source = source.slice(0, farAt) + 'Q' + source.slice(farAt)
    const far = core.apply(replacement.revision, [{
      start: farAt,
      end: farAt,
      insert: 'Q'
    }], { projections: ['markup'] })

    expect(far.change.projections[0]?.scope).toBe('regions')
    expect(far.revision.source).toBe(source)
    const freshCore = createDocumentCore()
    const fresh = freshCore.open(source)
    expect(core.project(far.revision, 'markup').events)
      .toEqual(freshCore.project(fresh, 'markup').events)
    expect(core.project(far.revision, 'markup').syntax.ast)
      .toEqual(freshCore.project(fresh, 'markup').syntax.ast)
  })

  it('full-parses one structural fallback after a regional chain', () => {
    const source = 'head\n\ntarget word\n\ntail\n\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const at = source.indexOf('word') + 1
    const regional = core.apply(opened, [{
      start: at,
      end: at,
      insert: 'X'
    }], { projections: ['markup'] })
    const beforeFallback = inspectionOf(core)
    const structuralAt = regional.revision.source.indexOf('target')
    const fallback = core.apply(regional.revision, [{
      start: structuralAt,
      end: structuralAt,
      insert: '#'
    }], { projections: ['markup'] })
    const afterFallback = inspectionOf(core)

    expect(fallback.change.projections).toEqual([{
      name: 'markup',
      scope: 'document',
      reason: 'structural-region-ineligible'
    }])
    expect(delta(afterFallback, beforeFallback, 'documentParses')).toBe(1)
    expect(delta(afterFallback, beforeFallback, 'retainedCommittedUpdates'))
      .toBe(0)
    const freshCore = createDocumentCore()
    const fresh = freshCore.open(fallback.revision.source)
    expect(core.project(fallback.revision, 'markup').events)
      .toEqual(freshCore.project(fresh, 'markup').events)
    expect(core.project(fallback.revision, 'markup').syntax.ast)
      .toEqual(freshCore.project(fresh, 'markup').syntax.ast)
  })

  it('uses exact safe-boundary affinity for insertion and replacement', () => {
    const source = 'guard\n\nfirst word\n\nfollowing word\n\ntail\n\n'
    const boundary = source.indexOf('following')
    const insertionCore = createDocumentCore()
    const insertionOpened = insertionCore.open(source)
    const insertion = insertionCore.apply(insertionOpened, [{
      start: boundary,
      end: boundary,
      insert: 'X'
    }], { projections: ['markup'] })
    const insertionChange = insertion.change.projections[0]
    if (insertionChange?.scope !== 'regions') {
      throw new Error('Boundary insertion did not select a region')
    }
    expect(insertionChange.replacements[0]?.previous).toEqual({
      source: { start: boundary, end: source.indexOf('tail') },
      syntax: { start: boundary, end: source.indexOf('tail') },
      events: { start: 2, end: 3 }
    })

    const replacementCore = createDocumentCore()
    const replacementOpened = replacementCore.open(source)
    const replacement = replacementCore.apply(replacementOpened, [{
      start: source.indexOf('first') + 1,
      end: boundary,
      insert: 'Z'
    }], { projections: ['markup'] })
    expect(replacement.change.projections).toEqual([{
      name: 'markup',
      scope: 'document',
      reason: 'structural-region-ineligible'
    }])
  })

  it('projects shuffled old roots then continues the current overlay head', () => {
    const source = 'head\n\ntarget word\n\ntail\n\n'
    const core = createDocumentCore()
    const revisions = [core.open(source)]
    const at = source.indexOf('word') + 1
    for (let index = 0; index < 8; index += 1) {
      const previous = revisions.at(-1)
      if (previous === undefined) throw new Error('Expected current revision')
      revisions.push(core.apply(previous, [{
        start: at,
        end: at,
        insert: 'X'
      }], { projections: ['markup'] }).revision)
    }
    for (const ordinal of [1, 6, 3, 7, 2]) {
      const old = revisions[ordinal]
      if (old === undefined) throw new Error('Expected historical revision')
      const freshCore = createDocumentCore()
      const fresh = freshCore.open(old.source)
      expect(core.project(old, 'markup').events)
        .toEqual(freshCore.project(fresh, 'markup').events)
    }
    const head = revisions.at(-1)
    if (head === undefined) throw new Error('Expected overlay head')
    const continued = core.apply(head, [{
      start: at + 2,
      end: at + 2,
      insert: 'Y'
    }], { projections: ['markup'] })
    expect(continued.change.projections[0]?.scope).toBe('regions')
  })

  it('preserves the overlay root after invalid and resource rejection', () => {
    const source = 'head\n\ntarget word\n\ntail\n\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const at = source.indexOf('word') + 1
    const first = core.apply(opened, [{
      start: at,
      end: at,
      insert: 'A'
    }], { projections: ['markup'] })
    const regionalHead = first.revision
    const beforeRejections = inspectionOf(core)
    expect(() => core.apply(regionalHead, [
      { start: 1, end: 4, insert: 'X' },
      { start: 3, end: 5, insert: 'Y' }
    ], { projections: ['markup'] })).toThrow()
    const overDepth = `${'{++'.repeat(16_385)}x${'++}'.repeat(16_385)}`
    expect(() => core.apply(regionalHead, [{
      start: at,
      end: at,
      insert: overDepth
    }], { projections: ['markup'] })).toThrow(/CM_RESOURCE_CM_DEPTH_EXCEEDED/)
    const afterRejections = inspectionOf(core)
    expect(afterRejections.retainedCommittedUpdates)
      .toBe(beforeRejections.retainedCommittedUpdates)
    expect(afterRejections.retainedOverlayNodesAllocated)
      .toBe(beforeRejections.retainedOverlayNodesAllocated)

    const accepted = core.apply(regionalHead, [{
      start: at + 1,
      end: at + 1,
      insert: 'Z'
    }], { projections: ['markup'] })
    expect(accepted.change.projections[0]?.scope).toBe('regions')
    expect(inspectionOf(core).retainedCommittedUpdates)
      .toBe(beforeRejections.retainedCommittedUpdates + 1)
  })

  it.each([
    'head {++added++}\n\ntarget word\n\ntail\n\n',
    'head [ref]\n\ntarget word\n\n[ref]: /url\n'
  ])('never builds an overlay for CM or definition facts', (source) => {
    const core = createDocumentCore()
    const opened = core.open(source)
    const before = inspectionOf(core)
    const at = source.indexOf('word') + 1
    const commit = core.apply(opened, [{
      start: at,
      end: at,
      insert: 'X'
    }], { projections: ['markup'] })
    const after = inspectionOf(core)

    expect(commit.change.projections[0]?.scope).toBe('document')
    expect(before.retainedInitialBuildUnits).toBe(0)
    expect(delta(after, before, 'retainedOverlayNodesAllocated')).toBe(0)
    expect(delta(after, before, 'retainedCommittedUpdates')).toBe(0)
  })
})
