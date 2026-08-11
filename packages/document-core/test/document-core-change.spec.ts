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

  it('keeps retained-fact structural-size debt visible as the document grows', () => {
    const assemblyFor = (suffixParagraphs: number): Readonly<{
      input: number
      output: number
    }> => {
      const suffix = Array.from(
        { length: suffixParagraphs },
        (_, index) => `suffix ${String(index)}\n\n`
      ).join('')
      const source = `head\n\ntarget word\n\n${suffix}`
      const core = createDocumentCore()
      const opened = core.open(source)
      const before = inspectionOf(core)
      const at = source.indexOf('word') + 1
      core.apply(opened, [{ start: at, end: at, insert: 'X' }], {
        projections: ['markup']
      })
      const after = inspectionOf(core)
      return Object.freeze({
        input: delta(after, before, 'retainedFactInputStructuralUnits'),
        output: delta(after, before, 'retainedFactOutputStructuralUnits')
      })
    }

    const small = assemblyFor(100)
    const large = assemblyFor(1_000)
    // These cardinalities expose the known persistent-structure debt. They
    // intentionally do not claim to count repeated or failed internal walks.
    expect(small.input).toBeGreaterThan(0)
    expect(small.output).toBeGreaterThan(0)
    expect(large.input).toBeGreaterThan(small.input)
    expect(large.output).toBeGreaterThan(small.output)
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
})
