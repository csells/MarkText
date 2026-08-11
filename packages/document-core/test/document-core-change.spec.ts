import { describe, expect, it } from 'vitest'

import {
  createDocumentCore,
  type DocumentCoreError,
  type MarkdownAstNode,
  type MarkupEvent,
  type MarkupMark,
  type MarkupProjection,
  type MarkupRegionReplacement,
  type OrdinalRange,
  type SourceRange
} from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'
import { applyExactSourceEdits } from '../src/exactSourceEdits.js'

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
  readonly sourceMaterializations: number
  readonly sourceMaterializationOutputUnits: number
  readonly sourceRopeNodesAllocated: number
  readonly sourceRopeNodeVisits: number
  readonly sourceRopePiecesAllocated: number
  readonly sourceRopeCoalesces: number
  readonly sourceRopeRebalances: number
  readonly sourceRopeMaximumDepth: number
  readonly sourceRopeMaximumHeight: number
  readonly sourceRopeCurrentHeight: number
  readonly sourceRopeCurrentPieces: number
  readonly sourceSliceCalls: number
  readonly sourceSlicePieces: number
  readonly sourceSliceUnits: number
  readonly sourceMaterializationPieces: number
  readonly sourceGetterHits: number
  readonly sourceGetterMisses: number
  readonly sourceFallbackMaterializations: number
  readonly sourceRebaseMaterializations: number
  readonly sourceProjectionMaterializations: number
  readonly sourceReopenMaterializations: number
  readonly sourceRopeRootsAttempted: number
  readonly sourceRopeRootsCommitted: number
  readonly sourceRebases: number
  readonly sourceCurrentRetainedBufferUnitsUpperBound: number
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

function shiftMarkdownAstNodeForOracle(
  node: MarkdownAstNode,
  delta: number
): MarkdownAstNode {
  const attributes: Record<string, string | number | boolean> = {}
  for (const [name, value] of Object.entries(node.attributes)) {
    attributes[name] = typeof value === 'number' &&
      (name.endsWith('Start') || name.endsWith('End'))
      ? value + delta
      : value
  }
  return Object.freeze({
    kind: node.kind,
    range: Object.freeze({
      start: node.range.start + delta,
      end: node.range.end + delta
    }),
    attributes: Object.freeze(attributes),
    children: Object.freeze(node.children.map(
      child => shiftMarkdownAstNodeForOracle(child, delta)
    ))
  })
}

function applySyntaxReplacementForOracle(
  previousRoot: MarkdownAstNode,
  replacement: MarkupRegionReplacement
): MarkdownAstNode {
  const delta = replacement.next.syntax.end - replacement.previous.syntax.end
  const prefix = previousRoot.children.filter(
    child => child.range.end <= replacement.previous.syntax.start
  )
  const suffix = previousRoot.children
    .filter(child => child.range.start >= replacement.previous.syntax.end)
    .map(child => shiftMarkdownAstNodeForOracle(child, delta))
  return Object.freeze({
    kind: previousRoot.kind,
    range: Object.freeze({
      start: previousRoot.range.start,
      end: previousRoot.range.end + delta
    }),
    attributes: previousRoot.attributes,
    children: Object.freeze([
      ...prefix,
      ...replacement.syntaxBlocks,
      ...suffix
    ])
  })
}

describe('document-core semantic changes', () => {
  it('emits a balanced regional replacement for text inside an Addition', () => {
    const source =
      'head\n\nbefore {++added text++} after\n\ntail\n\n' +
      'suffix\n\n'.repeat(100)
    const editAt = source.indexOf('text')
    const nextSource =
      source.slice(0, editAt) + 'TEXTS' + source.slice(editAt + 4)
    const previousOracleCore = createDocumentCore()
    const previousOracle = previousOracleCore.open(source)
    const previousMarkup = previousOracleCore.project(previousOracle, 'markup')
    const core = createDocumentCore()
    const opened = core.open(source)
    const before = inspectionOf(core)

    const commit = core.apply(opened, [{
      start: editAt,
      end: editAt + 4,
      insert: 'TEXTS'
    }], { projections: ['markup'] })
    const after = inspectionOf(core)
    const change = commit.change.projections[0]

    expect(commit.revision.sourceLength).toBe(nextSource.length)
    expect(commit.revision.annotations).toEqual([{
      kind: 'addition',
      range: { start: 13, end: 30 },
      arms: [{
        name: 'content',
        range: { start: 16, end: 27 },
        annotations: []
      }]
    }])
    expect(change?.scope).toBe('regions')
    if (change?.scope !== 'regions') {
      throw new Error('Expected Addition regional change')
    }
    expect(change.replacements).toHaveLength(1)
    const replacement = change.replacements[0]
    if (replacement === undefined) throw new Error('Expected replacement')
    expect(replacement.previous).toEqual({
      source: { start: 6, end: 37 },
      syntax: { start: 6, end: 31 },
      events: { start: 1, end: 6 }
    })
    expect(replacement.next).toEqual({
      source: { start: 6, end: 38 },
      syntax: { start: 6, end: 32 },
      events: { start: 1, end: 6 }
    })
    expect(replacement.events).toEqual([
      {
        kind: 'text',
        text: 'before ',
        sourceRange: { start: 6, end: 13 }
      },
      {
        kind: 'enter',
        mark: {
          kind: 'addition',
          annotationRange: { start: 13, end: 30 }
        }
      },
      {
        kind: 'text',
        text: 'added TEXTS',
        sourceRange: { start: 16, end: 27 }
      },
      {
        kind: 'exit',
        mark: {
          kind: 'addition',
          annotationRange: { start: 13, end: 30 }
        }
      },
      {
        kind: 'text',
        text: ' after\n\n',
        sourceRange: { start: 30, end: 38 }
      }
    ])
    expect(replacement.events[1]?.kind).toBe('enter')
    expect(replacement.events[3]?.kind).toBe('exit')
    if (
      replacement.events[1]?.kind !== 'enter' ||
      replacement.events[3]?.kind !== 'exit'
    ) {
      throw new Error('Expected balanced Addition events')
    }
    expect(replacement.events[1].mark).toBe(replacement.events[3].mark)
    expect(replacement.coordinates).toEqual([
      {
        projected: { start: 6, end: 13 },
        source: { start: 6, end: 13 }
      },
      {
        projected: { start: 13, end: 24 },
        source: { start: 16, end: 27 }
      },
      {
        projected: { start: 24, end: 30 },
        source: { start: 30, end: 36 }
      },
      {
        projected: { start: 30, end: 31 },
        source: { start: 36, end: 37 }
      },
      {
        projected: { start: 31, end: 32 },
        source: { start: 37, end: 38 }
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
    expect(delta(after, before, 'sourceMaterializations')).toBe(0)
    expect(delta(after, before, 'sourceMaterializationOutputUnits')).toBe(0)
    expect(delta(after, before, 'regionalIntrinsicSourceUnits')).toBe(63)
    expect(delta(after, before, 'regionalProjectionPreparationUnits')).toBe(63)
    expect(delta(after, before, 'regionalIntrinsicSourceUnits'))
      .toBeLessThan(source.length)

    const freshCore = createDocumentCore()
    const fresh = freshCore.open(nextSource)
    const freshMarkup = freshCore.project(fresh, 'markup')
    expect(commit.revision.annotations).toEqual(fresh.annotations)
    expect(applyMarkupReplacement(
      previousMarkup.events,
      replacement
    )).toEqual(freshMarkup.events)
    expect(replacement.syntaxBlocks).toEqual([
      freshMarkup.syntax.ast.root.children[1]
    ])
    expect(applySyntaxReplacementForOracle(
      previousMarkup.syntax.ast.root,
      replacement
    )).toEqual(freshMarkup.syntax.ast.root)
    for (const segment of replacement.coordinates) {
      for (
        let offset = segment.projected.start;
        offset < segment.projected.end;
        offset += 1
      ) {
        expect(freshMarkup.syntax.coordinates.originAt(offset)).toEqual({
          kind: 'source',
          sourceOffset: segment.source.start +
            offset - segment.projected.start
        })
      }
    }
    const syntaxDelta = replacement.next.syntax.end -
      replacement.previous.syntax.end
    const sourceDelta = replacement.next.source.end -
      replacement.previous.source.end
    for (
      let offset = replacement.previous.syntax.end;
      offset < previousMarkup.syntax.ast.root.range.end;
      offset += 1
    ) {
      const previousOrigin = previousMarkup.syntax.coordinates.originAt(offset)
      const expectedOrigin = previousOrigin.kind === 'source'
        ? {
          kind: 'source' as const,
          sourceOffset: previousOrigin.sourceOffset + sourceDelta
        }
        : {
          kind: 'generated' as const,
          sourcePosition: previousOrigin.sourcePosition + sourceDelta,
          affinity: previousOrigin.affinity
        }
      expect(freshMarkup.syntax.coordinates.originAt(offset + syntaxDelta))
        .toEqual(expectedOrigin)
    }
  })

  it.each([
    {
      name: 'Deletion content',
      markup: '{--deleted text--}',
      needle: 'text',
      insert: 'TEXTS',
      annotation: {
        kind: 'deletion',
        range: { start: 13, end: 32 },
        arms: [{
          name: 'content',
          range: { start: 16, end: 29 },
          annotations: []
        }]
      },
      previous: {
        source: { start: 6, end: 39 },
        syntax: { start: 6, end: 33 },
        events: { start: 1, end: 6 }
      },
      next: {
        source: { start: 6, end: 40 },
        syntax: { start: 6, end: 34 },
        events: { start: 1, end: 6 }
      },
      marks: [
        'enter:deletion',
        'exit:deletion'
      ],
      regionalUnits: 67
    },
    {
      name: 'Highlight content',
      markup: '{==marked text==}',
      needle: 'text',
      insert: 'TEXTS',
      annotation: {
        kind: 'highlight',
        range: { start: 13, end: 31 },
        arms: [{
          name: 'content',
          range: { start: 16, end: 28 },
          annotations: []
        }]
      },
      previous: {
        source: { start: 6, end: 38 },
        syntax: { start: 6, end: 32 },
        events: { start: 1, end: 6 }
      },
      next: {
        source: { start: 6, end: 39 },
        syntax: { start: 6, end: 33 },
        events: { start: 1, end: 6 }
      },
      marks: [
        'enter:highlight',
        'exit:highlight'
      ],
      regionalUnits: 65
    },
    {
      name: 'Substitution old arm',
      markup: '{~~old text~>new text~~}',
      needle: 'old',
      insert: 'OLDER',
      annotation: {
        kind: 'substitution',
        range: { start: 13, end: 39 },
        arms: [
          {
            name: 'old',
            range: { start: 16, end: 26 },
            annotations: []
          },
          {
            name: 'new',
            range: { start: 28, end: 36 },
            annotations: []
          }
        ]
      },
      previous: {
        source: { start: 6, end: 45 },
        syntax: { start: 6, end: 37 },
        events: { start: 1, end: 9 }
      },
      next: {
        source: { start: 6, end: 47 },
        syntax: { start: 6, end: 39 },
        events: { start: 1, end: 9 }
      },
      marks: [
        'enter:substitution:old',
        'exit:substitution:old',
        'enter:substitution:new',
        'exit:substitution:new'
      ],
      regionalUnits: 80
    },
    {
      name: 'Substitution new arm',
      markup: '{~~old text~>new text~~}',
      needle: 'new',
      insert: 'NEWER',
      annotation: {
        kind: 'substitution',
        range: { start: 13, end: 39 },
        arms: [
          {
            name: 'old',
            range: { start: 16, end: 24 },
            annotations: []
          },
          {
            name: 'new',
            range: { start: 26, end: 36 },
            annotations: []
          }
        ]
      },
      previous: {
        source: { start: 6, end: 45 },
        syntax: { start: 6, end: 37 },
        events: { start: 1, end: 9 }
      },
      next: {
        source: { start: 6, end: 47 },
        syntax: { start: 6, end: 39 },
        events: { start: 1, end: 9 }
      },
      marks: [
        'enter:substitution:old',
        'exit:substitution:old',
        'enter:substitution:new',
        'exit:substitution:new'
      ],
      regionalUnits: 80
    }
  ])('emits a balanced regional replacement for $name', testCase => {
    const source =
      `head\n\nbefore ${testCase.markup} after\n\ntail\n\n` +
      'suffix\n\n'.repeat(100)
    const editAt = source.indexOf(testCase.needle)
    const nextSource = source.slice(0, editAt) + testCase.insert +
      source.slice(editAt + testCase.needle.length)
    const previousOracleCore = createDocumentCore()
    const previousOracle = previousOracleCore.open(source)
    const previousMarkup = previousOracleCore.project(previousOracle, 'markup')
    const core = createDocumentCore()
    const opened = core.open(source)
    const before = inspectionOf(core)

    const commit = core.apply(opened, [{
      start: editAt,
      end: editAt + testCase.needle.length,
      insert: testCase.insert
    }], { projections: ['markup'] })
    const after = inspectionOf(core)
    const change = commit.change.projections[0]
    if (change?.scope !== 'regions') {
      throw new Error(`Expected ${testCase.name} regional change`)
    }
    const replacement = change.replacements[0]
    if (replacement === undefined) throw new Error('Expected replacement')

    expect(commit.revision.annotations).toEqual([testCase.annotation])
    expect(replacement.previous).toEqual(testCase.previous)
    expect(replacement.next).toEqual(testCase.next)
    const stack: MarkupMark[] = []
    const enteredMarks: MarkupMark[] = []
    const marks: string[] = []
    for (const event of replacement.events) {
      if (event.kind === 'enter') {
        enteredMarks.push(event.mark)
        stack.push(event.mark)
        marks.push(`enter:${event.mark.kind}${
          event.mark.kind === 'substitution' ? `:${event.mark.arm}` : ''
        }`)
      } else if (event.kind === 'exit') {
        expect(stack.pop()).toBe(event.mark)
        marks.push(`exit:${event.mark.kind}${
          event.mark.kind === 'substitution' ? `:${event.mark.arm}` : ''
        }`)
      }
    }
    expect(stack).toEqual([])
    expect(marks).toEqual(testCase.marks)
    if (testCase.annotation.kind === 'substitution') {
      expect(enteredMarks).toHaveLength(2)
      expect(enteredMarks[0]).not.toBe(enteredMarks[1])
      expect(enteredMarks[0]?.annotationRange)
        .toEqual(enteredMarks[1]?.annotationRange)
    }
    assertPortable(commit.change)

    expect(delta(after, before, 'regionalFastApplies')).toBe(1)
    expect(delta(after, before, 'documentParses')).toBe(0)
    expect(delta(after, before, 'documentParseSourceUnits')).toBe(0)
    expect(delta(after, before, 'documentProjectionPreparationUnits')).toBe(0)
    expect(delta(after, before, 'documentMarkupEventUnits')).toBe(0)
    expect(delta(after, before, 'documentAstMaterializedNodes')).toBe(0)
    expect(delta(after, before, 'documentCoordinateSegments')).toBe(0)
    expect(delta(after, before, 'sourceMaterializations')).toBe(0)
    expect(delta(after, before, 'sourceMaterializationOutputUnits')).toBe(0)
    expect(delta(after, before, 'regionalIntrinsicSourceUnits'))
      .toBe(testCase.regionalUnits)
    expect(delta(after, before, 'regionalIntrinsicSourceUnits'))
      .toBeLessThan(source.length)

    const freshCore = createDocumentCore()
    const fresh = freshCore.open(nextSource)
    const freshMarkup = freshCore.project(fresh, 'markup')
    expect(commit.revision.annotations).toEqual(fresh.annotations)
    expect(applyMarkupReplacement(
      previousMarkup.events,
      replacement
    )).toEqual(freshMarkup.events)
    expect(applySyntaxReplacementForOracle(
      previousMarkup.syntax.ast.root,
      replacement
    )).toEqual(freshMarkup.syntax.ast.root)
    expect(replacement.syntaxBlocks).toEqual([
      freshMarkup.syntax.ast.root.children[1]
    ])
    if (testCase.annotation.kind === 'deletion') {
      expect(replacement.syntaxBlocks[0]).not.toEqual(
        freshCore.project(fresh, 'revised').ast.root.children[1]
      )
    } else if (testCase.annotation.kind === 'substitution') {
      expect(replacement.syntaxBlocks[0]).not.toEqual(
        freshCore.project(fresh, 'original').ast.root.children[1]
      )
      expect(replacement.syntaxBlocks[0]).not.toEqual(
        freshCore.project(fresh, 'revised').ast.root.children[1]
      )
    }
    for (const segment of replacement.coordinates) {
      for (
        let offset = segment.projected.start;
        offset < segment.projected.end;
        offset += 1
      ) {
        expect(freshMarkup.syntax.coordinates.originAt(offset)).toEqual({
          kind: 'source',
          sourceOffset: segment.source.start +
            offset - segment.projected.start
        })
      }
    }
    const syntaxDelta = replacement.next.syntax.end -
      replacement.previous.syntax.end
    const sourceDelta = replacement.next.source.end -
      replacement.previous.source.end
    for (
      let offset = replacement.previous.syntax.end;
      offset < previousMarkup.syntax.ast.root.range.end;
      offset += 1
    ) {
      const previousOrigin = previousMarkup.syntax.coordinates.originAt(offset)
      const expectedOrigin = previousOrigin.kind === 'source'
        ? {
          kind: 'source' as const,
          sourceOffset: previousOrigin.sourceOffset + sourceDelta
        }
        : {
          kind: 'generated' as const,
          sourcePosition: previousOrigin.sourcePosition + sourceDelta,
          affinity: previousOrigin.affinity
        }
      expect(freshMarkup.syntax.coordinates.originAt(offset + syntaxDelta))
        .toEqual(expectedOrigin)
    }
  })

  it('chains balanced Addition replacements without materializing the source', () => {
    const source =
      'head\n\nbefore {++added text++} after\n\ntail\n\n' +
      'suffix\n\n'.repeat(100)
    const firstAt = source.indexOf('text')
    const afterFirst =
      source.slice(0, firstAt) + 'TEXTS' + source.slice(firstAt + 4)
    const secondAt = afterFirst.indexOf('TEXTS') + 2
    const afterSecond =
      afterFirst.slice(0, secondAt) + 'Q' + afterFirst.slice(secondAt)
    const previousOracleCore = createDocumentCore()
    const previousOracle = previousOracleCore.open(source)
    const previousEvents = previousOracleCore.project(
      previousOracle,
      'markup'
    ).events
    const core = createDocumentCore()
    const opened = core.open(source)
    const before = inspectionOf(core)

    const first = core.apply(opened, [{
      start: firstAt,
      end: firstAt + 4,
      insert: 'TEXTS'
    }], { projections: ['markup'] })
    const firstChange = first.change.projections[0]
    if (firstChange?.scope !== 'regions') {
      throw new Error('Expected first Addition regional change')
    }
    const firstReplacement = firstChange.replacements[0]
    if (firstReplacement === undefined) {
      throw new Error('Expected first Addition replacement')
    }

    const second = core.apply(first.revision, [{
      start: secondAt,
      end: secondAt,
      insert: 'Q'
    }], { projections: ['markup'] })
    const after = inspectionOf(core)
    const secondChange = second.change.projections[0]
    if (secondChange?.scope !== 'regions') {
      throw new Error('Expected second Addition regional change')
    }
    const secondReplacement = secondChange.replacements[0]
    if (secondReplacement === undefined) {
      throw new Error('Expected second Addition replacement')
    }

    expect(second.revision.sourceLength).toBe(afterSecond.length)
    expect(second.revision.annotations).toEqual([{
      kind: 'addition',
      range: { start: 13, end: 31 },
      arms: [{
        name: 'content',
        range: { start: 16, end: 28 },
        annotations: []
      }]
    }])
    expect(secondReplacement.previous).toEqual({
      source: { start: 6, end: 38 },
      syntax: { start: 6, end: 32 },
      events: { start: 1, end: 6 }
    })
    expect(secondReplacement.next).toEqual({
      source: { start: 6, end: 39 },
      syntax: { start: 6, end: 33 },
      events: { start: 1, end: 6 }
    })
    expect(secondReplacement.events).toEqual([
      {
        kind: 'text',
        text: 'before ',
        sourceRange: { start: 6, end: 13 }
      },
      {
        kind: 'enter',
        mark: {
          kind: 'addition',
          annotationRange: { start: 13, end: 31 }
        }
      },
      {
        kind: 'text',
        text: 'added TEQXTS',
        sourceRange: { start: 16, end: 28 }
      },
      {
        kind: 'exit',
        mark: {
          kind: 'addition',
          annotationRange: { start: 13, end: 31 }
        }
      },
      {
        kind: 'text',
        text: ' after\n\n',
        sourceRange: { start: 31, end: 39 }
      }
    ])
    expect(secondReplacement.events[1]?.kind).toBe('enter')
    expect(secondReplacement.events[3]?.kind).toBe('exit')
    if (
      secondReplacement.events[1]?.kind !== 'enter' ||
      secondReplacement.events[3]?.kind !== 'exit'
    ) {
      throw new Error('Expected balanced chained Addition events')
    }
    expect(secondReplacement.events[1].mark)
      .toBe(secondReplacement.events[3].mark)
    assertPortable(first.change)
    assertPortable(second.change)

    expect(delta(after, before, 'regionalFastApplies')).toBe(2)
    expect(delta(after, before, 'documentParses')).toBe(0)
    expect(delta(after, before, 'documentParseSourceUnits')).toBe(0)
    expect(delta(after, before, 'documentProjectionPreparationUnits')).toBe(0)
    expect(delta(after, before, 'documentMarkupEventUnits')).toBe(0)
    expect(delta(after, before, 'sourceMaterializations')).toBe(0)
    expect(delta(after, before, 'sourceMaterializationOutputUnits')).toBe(0)
    expect(delta(after, before, 'regionalIntrinsicSourceUnits')).toBe(128)
    expect(delta(after, before, 'regionalProjectionPreparationUnits')).toBe(128)

    const firstFreshCore = createDocumentCore()
    const firstFresh = firstFreshCore.open(afterFirst)
    const historicalMarkup = core.project(first.revision, 'markup')
    const firstFreshMarkup = firstFreshCore.project(firstFresh, 'markup')
    expect(historicalMarkup.events).toEqual(firstFreshMarkup.events)
    expect(historicalMarkup.syntax.ast).toEqual(firstFreshMarkup.syntax.ast)
    for (
      let offset = 0;
      offset < historicalMarkup.syntax.ast.root.range.end;
      offset += 1
    ) {
      expect(historicalMarkup.syntax.coordinates.originAt(offset)).toEqual(
        firstFreshMarkup.syntax.coordinates.originAt(offset)
      )
    }

    const freshCore = createDocumentCore()
    const fresh = freshCore.open(afterSecond)
    const freshMarkup = freshCore.project(fresh, 'markup')
    expect(second.revision.annotations).toEqual(fresh.annotations)
    const afterFirstEvents = applyMarkupReplacement(
      previousEvents,
      firstReplacement
    )
    expect(applyMarkupReplacement(
      afterFirstEvents,
      secondReplacement
    )).toEqual(freshMarkup.events)
    expect(secondReplacement.syntaxBlocks).toEqual([
      freshMarkup.syntax.ast.root.children[1]
    ])
    for (const segment of secondReplacement.coordinates) {
      for (
        let offset = segment.projected.start;
        offset < segment.projected.end;
        offset += 1
      ) {
        expect(freshMarkup.syntax.coordinates.originAt(offset)).toEqual({
          kind: 'source',
          sourceOffset: segment.source.start +
            offset - segment.projected.start
        })
      }
    }
  })

  it('chains Substitution old, new, then old arm edits with exact history', () => {
    const source =
      'head\n\nbefore {~~old text~>new text~~} after\n\ntail\n\n' +
      'suffix\n\n'.repeat(100)
    const firstAt = source.indexOf('old')
    const afterFirst = source.slice(0, firstAt) + 'OLDER' +
      source.slice(firstAt + 3)
    const secondAt = afterFirst.indexOf('new')
    const afterSecond = afterFirst.slice(0, secondAt) + 'NEWER' +
      afterFirst.slice(secondAt + 3)
    const thirdAt = afterSecond.indexOf('OLDER') + 2
    const afterThird = afterSecond.slice(0, thirdAt) + 'Q' +
      afterSecond.slice(thirdAt)
    const previousCore = createDocumentCore()
    const previous = previousCore.open(source)
    const previousMarkup = previousCore.project(previous, 'markup')
    const core = createDocumentCore()
    const opened = core.open(source)
    const before = inspectionOf(core)

    const first = core.apply(opened, [{
      start: firstAt,
      end: firstAt + 3,
      insert: 'OLDER'
    }], { projections: ['markup'] })
    const firstChange = first.change.projections[0]
    if (firstChange?.scope !== 'regions') {
      throw new Error('Expected first Substitution regional change')
    }
    const firstReplacement = firstChange.replacements[0]
    if (firstReplacement === undefined) throw new Error('Expected replacement')

    const second = core.apply(first.revision, [{
      start: secondAt,
      end: secondAt + 3,
      insert: 'NEWER'
    }], { projections: ['markup'] })
    const secondChange = second.change.projections[0]
    if (secondChange?.scope !== 'regions') {
      throw new Error('Expected second Substitution regional change')
    }
    const secondReplacement = secondChange.replacements[0]
    if (secondReplacement === undefined) throw new Error('Expected replacement')

    const third = core.apply(second.revision, [{
      start: thirdAt,
      end: thirdAt,
      insert: 'Q'
    }], { projections: ['markup'] })
    const after = inspectionOf(core)
    const thirdChange = third.change.projections[0]
    if (thirdChange?.scope !== 'regions') {
      throw new Error('Expected third Substitution regional change')
    }
    const thirdReplacement = thirdChange.replacements[0]
    if (thirdReplacement === undefined) throw new Error('Expected replacement')

    expect(third.revision.annotations).toEqual([{
      kind: 'substitution',
      range: { start: 13, end: 42 },
      arms: [
        {
          name: 'old',
          range: { start: 16, end: 27 },
          annotations: []
        },
        {
          name: 'new',
          range: { start: 29, end: 39 },
          annotations: []
        }
      ]
    }])
    expect(thirdReplacement.previous).toEqual({
      source: { start: 6, end: 49 },
      syntax: { start: 6, end: 41 },
      events: { start: 1, end: 9 }
    })
    expect(thirdReplacement.next).toEqual({
      source: { start: 6, end: 50 },
      syntax: { start: 6, end: 42 },
      events: { start: 1, end: 9 }
    })
    assertPortable(first.change)
    assertPortable(second.change)
    assertPortable(third.change)
    expect(delta(after, before, 'regionalFastApplies')).toBe(3)
    expect(delta(after, before, 'regionalIntrinsicSourceUnits')).toBe(251)
    expect(delta(after, before, 'documentParses')).toBe(0)
    expect(delta(after, before, 'documentProjectionPreparationUnits')).toBe(0)
    expect(delta(after, before, 'documentMarkupEventUnits')).toBe(0)
    expect(delta(after, before, 'sourceMaterializations')).toBe(0)

    const firstFreshCore = createDocumentCore()
    const firstFresh = firstFreshCore.open(afterFirst)
    const firstHistorical = core.project(first.revision, 'markup')
    const firstFreshMarkup = firstFreshCore.project(firstFresh, 'markup')
    expect(firstHistorical.events).toEqual(firstFreshMarkup.events)
    expect(firstHistorical.syntax.ast).toEqual(firstFreshMarkup.syntax.ast)
    const secondFreshCore = createDocumentCore()
    const secondFresh = secondFreshCore.open(afterSecond)
    const secondHistorical = core.project(second.revision, 'markup')
    const secondFreshMarkup = secondFreshCore.project(secondFresh, 'markup')
    expect(secondHistorical.events).toEqual(secondFreshMarkup.events)
    expect(secondHistorical.syntax.ast).toEqual(secondFreshMarkup.syntax.ast)

    const freshCore = createDocumentCore()
    const fresh = freshCore.open(afterThird)
    const freshMarkup = freshCore.project(fresh, 'markup')
    const firstEvents = applyMarkupReplacement(
      previousMarkup.events,
      firstReplacement
    )
    const secondEvents = applyMarkupReplacement(
      firstEvents,
      secondReplacement
    )
    expect(applyMarkupReplacement(secondEvents, thirdReplacement))
      .toEqual(freshMarkup.events)
    const firstAst = applySyntaxReplacementForOracle(
      previousMarkup.syntax.ast.root,
      firstReplacement
    )
    const secondAst = applySyntaxReplacementForOracle(
      firstAst,
      secondReplacement
    )
    expect(applySyntaxReplacementForOracle(secondAst, thirdReplacement))
      .toEqual(freshMarkup.syntax.ast.root)
    expect(third.revision.annotations).toEqual(fresh.annotations)
  })

  it.each([
    {
      name: 'inserts punctuation',
      source: 'head\n\nbefore {++added text++} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('text') + 2,
        end: source.indexOf('text') + 2,
        insert: '! @ , . -'
      })
    },
    {
      name: 'deletes punctuation',
      source: 'head\n\nbefore {++added a,b text++} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf(','),
        end: source.indexOf(',') + 1,
        insert: ''
      })
    }
  ])('lets the parser admit an Addition edit that $name', ({ source, edit }) => {
    const stableEdit = edit(source)
    const nextSource = applyExactSourceEdits(
      source,
      [stableEdit],
      'Addition punctuation oracle'
    )
    const previousCore = createDocumentCore()
    const previous = previousCore.open(source)
    const previousEvents = previousCore.project(previous, 'markup').events
    const core = createDocumentCore()
    const opened = core.open(source)
    const before = inspectionOf(core)

    const commit = core.apply(opened, [stableEdit], {
      projections: ['markup']
    })
    const after = inspectionOf(core)
    const change = commit.change.projections[0]
    if (change?.scope !== 'regions') {
      throw new Error('Expected punctuation Addition regional change')
    }
    const replacement = change.replacements[0]
    if (replacement === undefined) throw new Error('Expected replacement')

    expect(delta(after, before, 'regionalFastApplies')).toBe(1)
    expect(delta(after, before, 'documentParses')).toBe(0)
    expect(delta(after, before, 'sourceMaterializations')).toBe(0)
    const freshCore = createDocumentCore()
    const fresh = freshCore.open(nextSource)
    const freshMarkup = freshCore.project(fresh, 'markup')
    expect(commit.revision.annotations).toEqual(fresh.annotations)
    expect(applyMarkupReplacement(previousEvents, replacement))
      .toEqual(freshMarkup.events)
  })

  it.each([
    {
      name: 'touches an Addition marker',
      source: 'head\n\nbefore {++added text++} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('{++'),
        end: source.indexOf('{++') + 1,
        insert: '['
      })
    },
    {
      name: 'creates nested marker topology',
      source: 'head\n\nbefore {++added text++} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('text'),
        end: source.indexOf('text') + 4,
        insert: '{++nested++}'
      })
    },
    {
      name: 'creates a Markdown block',
      source: 'head\n\nbefore {++added text++} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('text'),
        end: source.indexOf('text') + 4,
        insert: '\n\n# block\n\n'
      })
    },
    {
      name: 'starts at the content boundary',
      source: 'head\n\nbefore {++added text++} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('{++') + 3,
        end: source.indexOf('{++') + 3,
        insert: 'X'
      })
    },
    {
      name: 'targets an empty arm',
      source: 'head\n\nbefore {++++} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('{++') + 3,
        end: source.indexOf('{++') + 3,
        insert: 'X'
      })
    },
    {
      name: 'would replace a generated Markdown origin',
      source: 'head\n\nbefore {++x*++}* after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('x*') + 1,
        end: source.indexOf('x*') + 1,
        insert: ' '
      })
    },
    {
      name: 'has a nested Comment',
      source: 'head\n\nbefore {++added {>>note<<} text++} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('added'),
        end: source.indexOf('added') + 5,
        insert: 'ADDED'
      })
    },
    {
      name: 'has multiple top-level annotations',
      source: 'head\n\nbefore {++added text++} {--drop--} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('text'),
        end: source.indexOf('text') + 4,
        insert: 'TEXT'
      })
    },
    {
      name: 'has a literal marker candidate',
      source: 'head\n\n`{++literal++}` before {++added text++} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('text'),
        end: source.indexOf('text') + 4,
        insert: 'TEXT'
      })
    },
    {
      name: 'has a diagnostic marker candidate',
      source: 'head\n\n++} before {++added text++} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('text'),
        end: source.indexOf('text') + 4,
        insert: 'TEXT'
      })
    }
  ])('falls back to a document change when an Addition edit $name', ({
    source,
    edit
  }) => {
    const core = createDocumentCore()
    const opened = core.open(source)
    const commit = core.apply(opened, [edit(source)], {
      projections: ['markup']
    })

    expect(commit.change.projections).toEqual([{
      name: 'markup',
      scope: 'document',
      reason: 'criticmarkup-facts-present'
    }])
  })

  it.each([
    {
      name: 'touches the Substitution divider',
      source: 'head\n\nbefore {~~old text~>new text~~} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('~>'),
        end: source.indexOf('~>') + 1,
        insert: '-'
      })
    },
    {
      name: 'crosses Substitution arms',
      source: 'head\n\nbefore {~~old text~>new text~~} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('old') + 1,
        end: source.indexOf('new') + 2,
        insert: 'replacement'
      })
    },
    {
      name: 'creates generated protection from the old arm',
      source: 'head\n\nbefore {~~old~>new*~~} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('old'),
        end: source.indexOf('old') + 1,
        insert: '*o'
      })
    },
    {
      name: 'creates generated protection from the new arm',
      source: 'head\n\nbefore {~~*old~>new~~} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('new') + 2,
        end: source.indexOf('new') + 3,
        insert: 'w*'
      })
    },
    {
      name: 'edits a Comment payload',
      source: 'head\n\nbefore {>>note text<<} after\n\ntail\n\n',
      edit: (source: string) => ({
        start: source.indexOf('text'),
        end: source.indexOf('text') + 4,
        insert: 'TEXTS'
      })
    }
  ])('keeps $name on the explicit document fallback', ({ source, edit }) => {
    const core = createDocumentCore()
    const opened = core.open(source)
    const commit = core.apply(opened, [edit(source)], {
      projections: ['markup']
    })

    expect(commit.change.projections).toEqual([{
      name: 'markup',
      scope: 'document',
      reason: 'criticmarkup-facts-present'
    }])
  })

  it('rebases a bounded Addition resource error and rejects atomically', () => {
    const source =
      'head\n\nbefore {++added text++} after\n\ntail\n\n' +
      'suffix\n\n'.repeat(20)
    const editAt = source.indexOf('added') + 2
    const overLimit = '{++ '.repeat(1_025)
    const edit = {
      start: editAt,
      end: editAt,
      insert: overLimit
    }
    const fullCore = createDocumentCore()
    const fullOpened = fullCore.open(source)
    let fullError: DocumentCoreError | undefined
    try {
      fullCore.apply(fullOpened, [edit])
    } catch (error) {
      fullError = error as DocumentCoreError
    }
    expect(fullError).toBeDefined()

    const core = createDocumentCore()
    const opened = core.open(source)
    const before = inspectionOf(core)
    let regionalError: DocumentCoreError | undefined
    try {
      core.apply(opened, [edit], { projections: ['markup'] })
    } catch (error) {
      regionalError = error as DocumentCoreError
    }
    const rejected = inspectionOf(core)

    expect(regionalError).toMatchObject({
      code: fullError?.code,
      range: fullError?.range,
      metadata: fullError?.metadata
    })
    expect(delta(rejected, before, 'documentParses')).toBe(0)
    expect(delta(rejected, before, 'documentParseSourceUnits')).toBe(0)
    expect(delta(rejected, before, 'sourceMaterializations')).toBe(0)
    expect(delta(rejected, before, 'sourceRopeRootsCommitted')).toBe(0)
    expect(delta(rejected, before, 'regionalFastApplies')).toBe(0)

    const accepted = core.apply(opened, [{
      start: editAt,
      end: editAt,
      insert: 'X'
    }], { projections: ['markup'] })
    expect(accepted.change.projections[0]?.scope).toBe('regions')
  })

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
    expect(delta(
      afterProjection,
      beforeProjection,
      'sourceProjectionMaterializations'
    )).toBe(2)
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

  it('keeps canonical source persistent across 100 regional edits', () => {
    const suffix = Array.from(
      { length: 10_000 },
      (_, index) => `suffix ${String(index)}\n\n`
    ).join('')
    let expectedSource = `head\n\ntarget word\n\n${suffix}`
    const core = createDocumentCore()
    let revision = core.open(expectedSource)
    const revisions = [revision]
    const expectedRevisions = [expectedSource]
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
      expect(commit.revision.sourceLength).toBe(expectedSource.length)
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
      revisions.push(revision)
      expectedRevisions.push(expectedSource)
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
    expect(delta(after, before, 'sourceMaterializations')).toBe(0)
    expect(delta(after, before, 'sourceMaterializationOutputUnits')).toBe(0)
    expect(delta(after, before, 'sourceRopeNodesAllocated')).toBeLessThan(2_000)
    expect(after.sourceRopeMaximumDepth).toBeLessThan(16)
    expect(delta(after, before, 'sourceSliceCalls')).toBe(200)
    expect(delta(after, before, 'sourceSliceUnits')).toBeLessThan(20_000)
    expect(delta(after, before, 'sourceSlicePieces')).toBeLessThan(20_000)
    expect(delta(after, before, 'sourceRopeRootsAttempted')).toBe(100)
    expect(delta(after, before, 'sourceRopeRootsCommitted')).toBe(100)

    expect(revision.source).toBe(expectedSource)
    const afterHeadRead = inspectionOf(core)
    expect(delta(afterHeadRead, after, 'sourceMaterializations')).toBe(1)
    expect(delta(afterHeadRead, after, 'sourceMaterializationOutputUnits'))
      .toBe(expectedSource.length)
    expect(revision.source).toBe(expectedSource)
    const afterCachedHeadRead = inspectionOf(core)
    expect(afterCachedHeadRead.sourceMaterializations)
      .toBe(afterHeadRead.sourceMaterializations)
    expect(afterCachedHeadRead.sourceMaterializationOutputUnits)
      .toBe(afterHeadRead.sourceMaterializationOutputUnits)
    expect(afterCachedHeadRead.sourceGetterHits)
      .toBe(afterHeadRead.sourceGetterHits + 1)

    const historical = revisions[50]
    const historicalSource = expectedRevisions[50]
    if (historical === undefined || historicalSource === undefined) {
      throw new Error('Expected retained source history')
    }
    expect(historical.sourceLength).toBe(historicalSource.length)
    expect(historical.source).toBe(historicalSource)
    const afterHistoricalRead = inspectionOf(core)
    expect(delta(afterHistoricalRead, afterHeadRead, 'sourceMaterializations'))
      .toBe(1)
    expect(delta(
      afterHistoricalRead,
      afterHeadRead,
      'sourceMaterializationOutputUnits'
    )).toBe(historicalSource.length)

    const projected = core.project(revision, 'markup')
    const freshCore = createDocumentCore()
    const fresh = freshCore.open(expectedSource)
    const freshProjected = freshCore.project(fresh, 'markup')
    expect(projected.events).toEqual(freshProjected.events)
    expect(projected.syntax.ast).toEqual(freshProjected.syntax.ast)
  })

  it('preserves exact UTF-16 multi-edit ordering through rope rotations', () => {
    const core = createDocumentCore()
    const opened = core.open('a\r\n😀b\nxyz')
    const first = core.apply(opened, [
      { start: 2, end: 2, insert: 'q' },
      { start: 3, end: 8, insert: '' },
      { start: 8, end: 8, insert: 'q' }
    ])
    expect(first.revision.source).toBe('a\rq\nqyz')

    const second = core.apply(first.revision, [
      { start: 7, end: 7, insert: 'X' },
      { start: 7, end: 7, insert: 'X' },
      { start: 7, end: 7, insert: '😀' }
    ])
    expect(second.revision.source).toBe('a\rq\nqyzXX😀')
    expect(second.revision.sourceLength).toBe(11)
    expect(inspectionOf(core).sourceRopeMaximumHeight).toBeLessThan(16)
  })

  it('matches the exact-source oracle across deterministic edit batches', () => {
    let randomState = 0x5eed1234
    const random = (limit: number): number => {
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0
      return limit === 0 ? 0 : randomState % limit
    }
    const insertions = ['', 'X', '\r\n', '😀', '{++', ' ++}'] as const
    let expected = 'start\r\n😀 middle\nend\n'
    const core = createDocumentCore()
    let revision = core.open(expected)

    for (let batch = 0; batch < 128; batch += 1) {
      const edits: Array<{ start: number, end: number, insert: string }> = []
      let cursor = 0
      const editCount = 1 + random(4)
      for (let ordinal = 0; ordinal < editCount; ordinal += 1) {
        const start = cursor + random(expected.length - cursor + 1)
        const deletion = random(Math.min(4, expected.length - start) + 1)
        const end = start + deletion
        edits.push({
          start,
          end,
          insert: insertions[random(insertions.length)] ?? ''
        })
        cursor = end
      }
      expected = applyExactSourceEdits(expected, edits, 'oracle edit')
      revision = core.apply(revision, edits).revision
      expect(revision.sourceLength).toBe(expected.length)
      expect(revision.source).toBe(expected)
    }

    expect(inspectionOf(core).sourceRopeMaximumHeight).toBeLessThan(32)
  })

  it('rejects an oversized candidate before allocating a source root', () => {
    const core = createDocumentCore()
    const opened = core.open('head\n\ntarget\n\ntail\n\n')
    const before = inspectionOf(core)

    expect(() => core.apply(opened, [{
      start: 8,
      end: 8,
      insert: 'X'.repeat(32_000_000)
    }], { projections: ['markup'] })).toThrow(expect.objectContaining({
      code: 'CM_RESOURCE_SOURCE_UNITS_EXCEEDED',
      range: { start: 32_000_000, end: 32_000_000 },
      metadata: { limit: '32000000', observed: '32000020' }
    }))
    const after = inspectionOf(core)
    for (const key of [
      'sourceRopeNodesAllocated',
      'sourceRopeNodeVisits',
      'sourceSliceCalls',
      'sourceMaterializations',
      'sourceRopeRootsAttempted',
      'sourceRopeRootsCommitted'
    ] as const) {
      expect(after[key]).toBe(before[key])
    }
  })

  it('rejects too many edits before stabilizing or allocating source work', () => {
    const core = createDocumentCore()
    const opened = core.open('head\n\ntarget\n\ntail\n\n')
    const before = inspectionOf(core)
    const edits = Array.from({ length: 16_385 }, () => ({
      start: 8,
      end: 8,
      insert: 'X'
    }))

    expect(() => core.apply(opened, edits, { projections: ['markup'] }))
      .toThrow(/transaction limit/)
    const after = inspectionOf(core)
    for (const key of [
      'sourceRopeNodesAllocated',
      'sourceRopeNodeVisits',
      'sourceSliceCalls',
      'sourceMaterializations',
      'sourceRopeRootsAttempted',
      'sourceRopeRootsCommitted'
    ] as const) {
      expect(after[key]).toBe(before[key])
    }
  })

  it('preserves BOM, CRLF, and isolated surrogate code units exactly', () => {
    const source = '\uFEFFa\r\n😀z'
    const edits = [
      { start: 2, end: 3, insert: '\r' },
      { start: 4, end: 5, insert: 'X' },
      { start: 7, end: 7, insert: '\uFEFF' }
    ]
    const expected = applyExactSourceEdits(source, edits, 'oracle edit')
    const core = createDocumentCore()
    const opened = core.open(source)
    const commit = core.apply(opened, edits)

    expect(commit.revision.source).toBe(expected)
    expect(Array.from(
      { length: expected.length },
      (_, index) => commit.revision.source.charCodeAt(index)
    )).toEqual(Array.from(
      { length: expected.length },
      (_, index) => expected.charCodeAt(index)
    ))
  })

  it('keeps enumerable revision source lazy while changes stay portable', () => {
    const source = 'head\n\ntarget word\n\ntail\n\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const at = source.indexOf('word') + 1
    const commit = core.apply(opened, [{
      start: at,
      end: at,
      insert: 'X'
    }], { projections: ['markup'] })
    const expected = source.slice(0, at) + 'X' + source.slice(at)
    const before = inspectionOf(core)

    expect(Object.isFrozen(commit.revision)).toBe(true)
    expect(Object.getOwnPropertyDescriptor(commit.revision, 'source'))
      .toEqual(expect.objectContaining({ enumerable: true }))
    expect(Object.keys(commit.revision)).toContain('source')
    expect(structuredClone(commit.change)).toEqual(commit.change)
    expect(inspectionOf(core).sourceMaterializations)
      .toBe(before.sourceMaterializations)

    const clonedRevision = structuredClone(commit.revision)
    expect(clonedRevision.source).toBe(expected)
    const afterClone = inspectionOf(core)
    expect(delta(afterClone, before, 'sourceGetterMisses')).toBe(1)
    expect(delta(afterClone, before, 'sourceMaterializations')).toBe(1)
    expect(delta(afterClone, before, 'sourceMaterializationOutputUnits'))
      .toBe(expected.length)
    expect(afterClone.sourceRopeCurrentPieces).toBe(1)
    expect(afterClone.sourceCurrentRetainedBufferUnitsUpperBound)
      .toBe(expected.length)

    expect(JSON.parse(JSON.stringify(commit.revision)).source).toBe(expected)
    expect({ ...commit.revision }.source).toBe(expected)
    const afterCachedBarriers = inspectionOf(core)
    expect(afterCachedBarriers.sourceMaterializations)
      .toBe(afterClone.sourceMaterializations)
    expect(delta(afterCachedBarriers, afterClone, 'sourceGetterHits')).toBe(2)
  })

  it('full-fallback rebases a source that would retain a huge deletion', () => {
    const content = 'A'.repeat(262_144)
    const source = `guard\n\n${content}\n\ntail\n\n`
    const core = createDocumentCore()
    const opened = core.open(source)
    const contentStart = source.indexOf(content)
    const before = inspectionOf(core)
    const commit = core.apply(opened, [{
      start: contentStart + 1,
      end: contentStart + content.length,
      insert: ''
    }], { projections: ['markup'] })
    const after = inspectionOf(core)

    expect(commit.change.projections).toEqual([{
      name: 'markup',
      scope: 'document',
      reason: 'source-fragmentation-rebase'
    }])
    expect(delta(after, before, 'sourceFallbackMaterializations')).toBe(0)
    expect(delta(after, before, 'sourceRebaseMaterializations')).toBe(1)
    expect(delta(after, before, 'sourceRebases')).toBe(1)
    expect(delta(after, before, 'sourceRopeRootsCommitted')).toBe(1)
    expect(commit.revision.source).toBe('guard\n\nA\n\ntail\n\n')
    expect(opened.source).toBe(source)
    expect(after.sourceRopeCurrentPieces).toBe(1)
    expect(after.sourceCurrentRetainedBufferUnitsUpperBound)
      .toBe(commit.revision.sourceLength)
    expect(inspectionOf(core).sourceMaterializations)
      .toBe(after.sourceMaterializations)
  })

  it('rebases after cumulative small deletions cross fragmentation policy', () => {
    const content = 'A'.repeat(100_000)
    const source = `guard\n\n${content}\n\ntail\n\n`
    const core = createDocumentCore()
    let revision = core.open(source)
    const contentStart = source.indexOf(content)
    const before = inspectionOf(core)
    let fallbackOrdinal: number | undefined

    for (let ordinal = 1; ordinal <= 90; ordinal += 1) {
      const commit = core.apply(revision, [{
        start: contentStart + 1,
        end: contentStart + 1_001,
        insert: ''
      }], { projections: ['markup'] })
      revision = commit.revision
      const projection = commit.change.projections[0]
      if (projection?.scope === 'document') {
        expect(projection.reason).toBe('source-fragmentation-rebase')
        fallbackOrdinal = ordinal
        break
      }
      expect(projection?.scope).toBe('regions')
      expect(inspectionOf(core).sourceMaterializations)
        .toBe(before.sourceMaterializations)
    }

    expect(fallbackOrdinal).toBeGreaterThan(65)
    expect(fallbackOrdinal).toBeLessThan(90)
    const after = inspectionOf(core)
    expect(delta(after, before, 'sourceRebaseMaterializations')).toBe(1)
    expect(delta(after, before, 'sourceRebases')).toBe(1)
    expect(after.sourceRopeCurrentPieces).toBe(1)
    expect(after.sourceCurrentRetainedBufferUnitsUpperBound)
      .toBe(revision.sourceLength)
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
    const structuralAt = source.indexOf('target')
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
    expect(delta(
      afterFallback,
      beforeFallback,
      'sourceFallbackMaterializations'
    )).toBe(1)
    expect(delta(
      afterFallback,
      beforeFallback,
      'sourceMaterializations'
    )).toBe(1)
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
    expect(() => core.apply(regionalHead, [{
      start: regionalHead.sourceLength + 1,
      end: regionalHead.sourceLength + 1,
      insert: 'X'
    }], { projections: ['markup'] })).toThrow()
    expect(() => core.apply(opened, [{
      start: at,
      end: at,
      insert: 'X'
    }], { projections: ['markup'] })).toThrow(/not the current core revision/)
    const afterInputRejections = inspectionOf(core)
    for (const key of [
      'sourceRopeNodesAllocated',
      'sourceRopeNodeVisits',
      'sourceSliceCalls',
      'sourceMaterializations',
      'sourceRopeRootsAttempted',
      'sourceRopeRootsCommitted'
    ] as const) {
      expect(afterInputRejections[key]).toBe(beforeRejections[key])
    }

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
    expect(delta(
      afterRejections,
      afterInputRejections,
      'sourceFallbackMaterializations'
    )).toBe(1)
    expect(delta(
      afterRejections,
      afterInputRejections,
      'sourceRopeRootsAttempted'
    )).toBe(1)
    expect(afterRejections.sourceRopeRootsCommitted)
      .toBe(afterInputRejections.sourceRopeRootsCommitted)

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
    expect(delta(after, before, 'sourceFallbackMaterializations')).toBe(1)
    expect(delta(after, before, 'sourceMaterializations')).toBe(1)
  })
})
