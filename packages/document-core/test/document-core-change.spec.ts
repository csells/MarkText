import { describe, expect, it } from 'vitest'

import {
  createDocumentCore,
  DOCUMENT_RESOURCE_POLICY_V1,
  type CriticMarkupAnnotation,
  type CriticMarkupAnnotationSnapshot,
  type CommentCoordinateSegment,
  type CommentProjection,
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
import {
  createUnboundedDocumentCoreForInspection
} from '../src/documentCore.js'

interface ChangeInspection {
  readonly fullProductStoresStrongCurrent: number
  readonly fullProductStoresStrongPeak: number
  readonly fullProductStoreReleases: number
  readonly documentParses: number
  readonly documentParseSourceUnits: number
  readonly regionalIntrinsicSourceUnits: number
  readonly regionalFastApplies: number
  readonly documentProjectionPreparationUnits: number
  readonly documentMarkupEventUnits: number
  readonly documentAstMaterializedNodes: number
  readonly documentCoordinateSegments: number
  readonly documentAnnotationMaterializedNodes: number
  readonly documentRetainedFactOutputStructuralUnits: number
  readonly canonicalFactIndexUnits: number
  readonly regionalProjectionPreparationUnits: number
  readonly regionalMarkupEventUnits: number
  readonly regionalAstMaterializedNodes: number
  readonly regionalCoordinateSegments: number
  readonly regionalCommentProjectionPreparationUnits: number
  readonly regionalCommentAstMaterializedNodes: number
  readonly regionalCommentCoordinateSegments: number
  readonly regionalInventoryBuildUnits: number
  readonly regionalInventoryLookupComparisons: number
  readonly regionalInventoryNodesVisited: number
  readonly regionalInventoryNodesAllocated: number
  readonly regionalInventoryNodesShared: number
  readonly regionalInventoryChangedLeaves: number
  readonly regionalInventoryRootsAttempted: number
  readonly regionalInventoryRootsCommitted: number
  readonly regionalInventoryLocalAnnotationMaterializedNodes: number
  readonly regionalInventoryCandidateRegionParses: number
  readonly regionalInventoryCandidateRegionParseSourceUnits: number
  readonly regionalInventoryAnnotationMaterializedNodes: number
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

function expectAnnotationTreesEqual(
  actual: readonly CriticMarkupAnnotation[],
  expected: readonly CriticMarkupAnnotation[]
): void {
  expect(actual).toHaveLength(expected.length)
  const pending: Array<readonly [CriticMarkupAnnotation, CriticMarkupAnnotation]> =
    actual.map((annotation, index) => {
      const expectedAnnotation = expected[index]
      if (expectedAnnotation === undefined) {
        throw new Error('Expected matching annotation root')
      }
      return [annotation, expectedAnnotation]
    })
  while (pending.length > 0) {
    const pair = pending.pop()
    if (pair === undefined) break
    const [left, right] = pair
    expect(left.kind).toBe(right.kind)
    expect(left.range).toEqual(right.range)
    expect(left.arms).toHaveLength(right.arms.length)
    for (let armIndex = 0; armIndex < left.arms.length; armIndex += 1) {
      const leftArm = left.arms[armIndex]
      const rightArm = right.arms[armIndex]
      if (leftArm === undefined || rightArm === undefined) {
        throw new Error('Expected matching annotation arms')
      }
      expect(leftArm.name).toBe(rightArm.name)
      expect(leftArm.range).toEqual(rightArm.range)
      expect(leftArm.annotations).toHaveLength(rightArm.annotations.length)
      for (
        let childIndex = 0;
        childIndex < leftArm.annotations.length;
        childIndex += 1
      ) {
        pending.push([
          leftArm.annotations[childIndex] as CriticMarkupAnnotation,
          rightArm.annotations[childIndex] as CriticMarkupAnnotation
        ])
      }
    }
  }
}

function annotationSnapshotForOracle(
  annotation: CriticMarkupAnnotation
): CriticMarkupAnnotationSnapshot {
  const nodes: CriticMarkupAnnotation[] = []
  const ordinalByNode = new Map<CriticMarkupAnnotation, number>()
  const pending = [annotation]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) break
    ordinalByNode.set(node, nodes.length)
    nodes.push(node)
    for (let armIndex = node.arms.length - 1; armIndex >= 0; armIndex -= 1) {
      const arm = node.arms[armIndex]
      if (arm === undefined) continue
      for (
        let childIndex = arm.annotations.length - 1;
        childIndex >= 0;
        childIndex -= 1
      ) {
        const child = arm.annotations[childIndex]
        if (child !== undefined) pending.push(child)
      }
    }
  }
  return {
    root: 0,
    nodes: nodes.map(node => ({
      kind: node.kind,
      range: node.range,
      arms: node.arms.map(arm => ({
        name: arm.name,
        range: arm.range,
        children: arm.annotations.map(child => {
          const ordinal = ordinalByNode.get(child)
          if (ordinal === undefined) throw new Error('Missing child ordinal')
          return ordinal
        })
      }))
    }))
  }
}

function expectCommentCoordinatesEqual(
  projection: CommentProjection,
  segments: readonly CommentCoordinateSegment[]
): void {
  let projectedEnd = 0
  for (const segment of segments) {
    expect(segment.projected.start).toBe(projectedEnd)
    projectedEnd = segment.projected.end
    for (
      let offset = segment.projected.start;
      offset < segment.projected.end;
      offset += 1
    ) {
      expect(projection.coordinates.originAt(offset)).toEqual(
        segment.kind === 'source'
          ? {
            kind: 'source',
            sourceOffset: segment.source.start +
              offset - segment.projected.start
          }
          : {
            kind: 'generated',
            sourcePosition: segment.sourcePosition,
            affinity: segment.affinity
          }
      )
    }
  }
  expect(projectedEnd).toBe(projection.markdown.length)
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
  it.each([
    ['addition', '{++new {--nested--}++}', 'new {--nested--}', ''],
    ['deletion', '{--old {++nested++}--}', '', 'old {++nested++}'],
    ['substitution', '{~~old~>new~~}', 'new', 'old'],
    ['highlight', '{==marked==}', 'marked', 'marked'],
    ['comment', '{>>note<<}', '', '']
  ] as const)(
    'resolves one owned %s as an exact atomic source transaction',
    (kind, marked, accepted, rejected) => {
      for (const [decision, replacement] of [
        ['accept', accepted],
        ['reject', rejected]
      ] as const) {
        const source = `before ${marked} after`
        const core = createDocumentCore()
        const opened = core.open(source)
        const annotation = opened.annotations[0]
        expect(annotation?.kind).toBe(kind)

        const commit = core.resolve(opened, annotation!, decision, { projections: [] })

        expect(commit.revision.source).toBe(`before ${replacement} after`)
        expect(commit.change.appliedEdits).toEqual([{
          start: source.indexOf(marked),
          end: source.indexOf(marked) + marked.length,
          insert: replacement
        }])
        expect(commit.change.projections).toEqual([])
      }
    }
  )

  it('rejects foreign resolution identity without publishing a revision', () => {
    const core = createDocumentCore()
    const opened = core.open('before {++one++} after')
    const foreignCore = createDocumentCore()
    const foreign = foreignCore.open('before {++one++} after').annotations[0]!

    expect(() => core.resolve(opened, foreign, 'accept')).toThrow(
      /does not belong to this revision/
    )
    expect(opened.source).toBe('before {++one++} after')

    const accepted = core.resolve(opened, opened.annotations[0]!, 'accept')
    expect(accepted.revision.source).toBe('before one after')
  })

  it('keeps only the current full products strong while history stays projectable', () => {
    const source = [
      'head\n\n',
      'before {>>historical note<<} after\n\n',
      'plain\n\n'.repeat(1_000)
    ].join('')
    const nextSource = source.replace('plain', 'PLAIN')
    const core = createDocumentCore()
    const opened = core.open(source)
    const historicalComment = opened.annotations[0]
    if (historicalComment?.kind !== 'comment') {
      throw new Error('Expected historical Comment')
    }
    const afterOpen = inspectionOf(core)
    expect(afterOpen.fullProductStoresStrongCurrent).toBe(1)
    expect(afterOpen.fullProductStoresStrongPeak).toBe(1)
    expect(afterOpen.fullProductStoreReleases).toBe(0)

    const editAt = source.indexOf('plain')
    const commit = core.apply(opened, [{
      start: editAt,
      end: editAt + 5,
      insert: 'PLAIN'
    }])
    const afterApply = inspectionOf(core)
    expect(commit.revision.source).toBe(nextSource)
    expect(afterApply.fullProductStoresStrongCurrent).toBe(1)
    expect(afterApply.fullProductStoresStrongPeak).toBe(1)
    expect(afterApply.fullProductStoreReleases).toBe(1)

    const historicalMarkup = core.project(opened, 'markup')
    expect(historicalMarkup.events.some(event =>
      event.kind === 'text' && event.text.includes('historical note')
    )).toBe(false)
    expect(inspectionOf(core).fullProductStoresStrongCurrent).toBe(0)
    expect(core.projectComment(opened, historicalComment).markdown)
      .toBe('historical note')
    expect(opened.annotations[0]).toBe(historicalComment)
    const currentMarkup = core.project(commit.revision, 'markup')
    expect(currentMarkup.events.some(event =>
      event.kind === 'text' && event.text.includes('PLAIN')
    )).toBe(true)
    const afterHistory = inspectionOf(core)
    expect(afterHistory.fullProductStoresStrongCurrent).toBe(1)
    expect(afterHistory.fullProductStoresStrongPeak).toBe(1)
  })
  it('rehydrates an unread historical revision once per projection', () => {
    const source = `head\n\n${'plain\n\n'.repeat(1_000)}`
    const core = createDocumentCore()
    const opened = core.open(source)
    const editAt = source.indexOf('plain')
    const commit = core.apply(opened, [{
      start: editAt,
      end: editAt + 5,
      insert: 'PLAIN'
    }])
    const beforeHistory = inspectionOf(core)

    expect(core.project(opened, 'original').markdown).toBe(source)
    const afterHistory = inspectionOf(core)
    expect(afterHistory.documentParses - beforeHistory.documentParses).toBe(1)
    expect(afterHistory.fullProductStoresStrongCurrent).toBe(0)
    expect(afterHistory.fullProductStoresStrongPeak).toBe(1)
    expect(core.project(commit.revision, 'original').markdown)
      .toContain('PLAIN')
    expect(inspectionOf(core).fullProductStoresStrongCurrent).toBe(1)
  })
  it('leaves a demoted revision usable after a full parse rejects', () => {
    const source = 'head\n\nbefore {>>note<<} after\n\ntail\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const comment = opened.annotations[0]
    if (comment?.kind !== 'comment') throw new Error('Expected Comment')
    const editAt = source.indexOf('tail')

    expect(() => core.apply(opened, [{
      start: editAt,
      end: editAt,
      insert: '{++ '.repeat(1_025)
    }])).toThrow(expect.objectContaining({
      code: 'CM_RESOURCE_LOGICAL_NODES_EXCEEDED'
    }))
    const afterReject = inspectionOf(core)
    expect(afterReject.fullProductStoresStrongCurrent).toBe(0)
    expect(afterReject.fullProductStoresStrongPeak).toBe(1)
    expect(afterReject.fullProductStoreReleases).toBe(1)
    expect(core.project(opened, 'original').markdown)
      .toBe('head\n\nbefore  after\n\ntail\n')
    expect(core.projectComment(opened, comment).markdown).toBe('note')
    expect(opened.annotations[0]).toBe(comment)
    expect(inspectionOf(core).fullProductStoresStrongCurrent).toBe(1)
    const accepted = core.apply(opened, [{
      start: editAt,
      end: editAt + 4,
      insert: 'TAIL'
    }])
    expect(accepted.revision.source)
      .toBe('head\n\nbefore {>>note<<} after\n\nTAIL\n')
    const acceptedComment = accepted.revision.annotations[0]
    if (acceptedComment?.kind !== 'comment') {
      throw new Error('Expected accepted Comment')
    }
    expect(core.projectComment(accepted.revision, acceptedComment).markdown)
      .toBe('note')
    expect(inspectionOf(core).fullProductStoresStrongCurrent).toBe(1)
  })
  it('serves cached history without demoting the current product store', () => {
    const source = 'head\n\nbefore {>>note<<} after\n\nplain\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const openedAnnotations = opened.annotations
    const comment = openedAnnotations[0]
    if (comment?.kind !== 'comment') throw new Error('Expected Comment')
    const cachedMarkup = core.project(opened, 'markup')
    const cachedComment = core.projectComment(opened, comment)
    const editAt = source.indexOf('plain')
    core.apply(opened, [{
      start: editAt,
      end: editAt + 5,
      insert: 'PLAIN'
    }])
    const beforeCachedReads = inspectionOf(core)

    expect(core.project(opened, 'markup')).toBe(cachedMarkup)
    expect(core.projectComment(opened, comment)).toBe(cachedComment)
    expect(opened.annotations).toBe(openedAnnotations)
    const afterCachedReads = inspectionOf(core)
    expect(afterCachedReads.documentParses).toBe(beforeCachedReads.documentParses)
    expect(afterCachedReads.fullProductStoreReleases)
      .toBe(beforeCachedReads.fullProductStoreReleases)
    expect(afterCachedReads.fullProductStoresStrongCurrent).toBe(1)
  })
  it('materializes unread historical annotations ephemerally and caches identity', () => {
    const source = '{>>note<<}\n\ntail\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const editAt = source.lastIndexOf('tail')
    core.apply(opened, [{
      start: editAt,
      end: editAt + 4,
      insert: 'TAIL'
    }])
    const beforeAnnotations = inspectionOf(core)

    const historicalAnnotations = opened.annotations
    const afterAnnotations = inspectionOf(core)
    const fresh = createDocumentCore().open(source)
    expect(historicalAnnotations).toEqual(fresh.annotations)
    expect(opened.annotations).toBe(historicalAnnotations)
    expect(afterAnnotations.documentParses - beforeAnnotations.documentParses)
      .toBe(1)
    expect(afterAnnotations.fullProductStoresStrongCurrent).toBe(0)
    expect(inspectionOf(core).documentParses).toBe(afterAnnotations.documentParses)
  })
  it('demotes a lazily projected regional head before its descendant publishes', () => {
    const source = `head\n\n${'plain paragraph\n\n'.repeat(1_000)}`
    const core = createDocumentCore()
    const opened = core.open(source)
    const firstAt = source.indexOf('plain paragraph', 100)
    const first = core.apply(opened, [{
      start: firstAt,
      end: firstAt + 5,
      insert: 'PLAIN'
    }], { projections: ['markup'] })
    expect(inspectionOf(core).fullProductStoresStrongCurrent).toBe(0)
    expect(core.project(first.revision, 'original').markdown)
      .toContain('PLAIN paragraph')
    expect(inspectionOf(core).fullProductStoresStrongCurrent).toBe(1)

    const secondAt = source.indexOf('plain paragraph', firstAt + 15)
    const second = core.apply(first.revision, [{
      start: secondAt,
      end: secondAt + 5,
      insert: 'PLAIN'
    }], { projections: ['markup'] })
    const afterSecond = inspectionOf(core)
    expect(afterSecond.fullProductStoresStrongCurrent).toBe(0)
    expect(afterSecond.fullProductStoresStrongPeak).toBe(1)
    expect(afterSecond.fullProductStoreReleases).toBe(2)
    expect(core.project(first.revision, 'original').markdown)
      .toContain('PLAIN paragraph')
    expect(core.project(second.revision, 'original').markdown)
      .toContain('PLAIN paragraph')
  })
  it('updates one subscribed region in a multi-annotation document', () => {
    const source = [
      'head',
      '',
      'early {--deleted text--}',
      '',
      'middle {++added text++}',
      '',
      'bridge',
      '',
      'far {>>comment payload<<}',
      '',
      'suffix\n\n'.repeat(4_000)
    ].join('\n')
    const editAt = source.indexOf('added text') + 'added '.length
    const nextSource = source.slice(0, editAt) + 'TEXTS' +
      source.slice(editAt + 4)
    const previousOracleCore = createDocumentCore()
    const previousOracle = previousOracleCore.open(source)
    const previousMarkup = previousOracleCore.project(previousOracle, 'markup')
    const previousFarComment = previousOracle.annotations.find(annotation =>
      annotation.kind === 'comment'
    )
    if (previousFarComment?.kind !== 'comment') {
      throw new Error('Expected far Comment')
    }
    const previousFarProjection = previousOracleCore.projectComment(
      previousOracle,
      previousFarComment
    )
    const core = createDocumentCore()
    const opened = core.open(source)
    const farComment = opened.annotations.find(annotation =>
      annotation.kind === 'comment'
    )
    if (farComment?.kind !== 'comment') throw new Error('Expected Comment')
    const before = inspectionOf(core)

    const first = core.apply(opened, [{
      start: editAt,
      end: editAt + 4,
      insert: 'TEXTS'
    }], {
      projections: ['markup', {
        name: 'comment',
        annotationRange: farComment.range
      }]
    })
    const afterFirst = inspectionOf(core)
    expect(first.change.projections).toHaveLength(2)
    const markupChange = first.change.projections[0]
    const commentChange = first.change.projections[1]
    if (markupChange?.name !== 'markup' || markupChange.scope !== 'regions') {
      throw new Error('Expected one regional Markup change')
    }
    if (commentChange?.name !== 'comment' || commentChange.scope !== 'regions') {
      throw new Error('Expected one regional Comment change')
    }
    expect(markupChange.replacements).toHaveLength(1)
    expect(commentChange.replacements).toHaveLength(1)
    expect(commentChange.replacements[0]?.previous.annotation)
      .toEqual(farComment.range)
    assertPortable(commentChange.replacements)
    const replacement = markupChange.replacements[0]
    if (replacement === undefined) throw new Error('Expected replacement')
    expect(replacement.previous.source.start)
      .toBeGreaterThan(source.indexOf('{--deleted text--}'))
    expect(replacement.previous.source.end)
      .toBeLessThan(farComment.range.start)

    expect(delta(afterFirst, before, 'regionalFastApplies')).toBe(1)
    expect(delta(afterFirst, before, 'documentParses')).toBe(0)
    expect(delta(afterFirst, before, 'documentParseSourceUnits')).toBe(0)
    expect(delta(afterFirst, before, 'sourceMaterializations')).toBe(0)
    expect(delta(
      afterFirst,
      before,
      'documentAnnotationMaterializedNodes'
    )).toBe(0)
    expect(delta(
      afterFirst,
      before,
      'documentRetainedFactOutputStructuralUnits'
    )).toBe(0)
    expect(delta(afterFirst, before, 'regionalInventoryBuildUnits')).toBe(0)
    expect(delta(
      afterFirst,
      before,
      'regionalInventoryCandidateRegionParses'
    )).toBe(2)
    expect(delta(
      afterFirst,
      before,
      'regionalInventoryCandidateRegionParseSourceUnits'
    )).toBeGreaterThan(replacement.next.source.end - replacement.next.source.start)
    expect(delta(
      afterFirst,
      before,
      'regionalInventoryCandidateRegionParseSourceUnits'
    )).toBeLessThan(source.length)
    expect(delta(afterFirst, before, 'regionalInventoryChangedLeaves')).toBe(1)
    expect(delta(afterFirst, before, 'regionalInventoryRootsAttempted')).toBe(1)
    expect(delta(afterFirst, before, 'regionalInventoryRootsCommitted')).toBe(1)
    expect(delta(
      afterFirst,
      before,
      'regionalInventoryLocalAnnotationMaterializedNodes'
    )).toBeGreaterThan(0)
    expect(delta(
      afterFirst,
      before,
      'regionalInventoryAnnotationMaterializedNodes'
    )).toBe(0)
    expect(delta(afterFirst, before, 'regionalInventoryLookupComparisons'))
      .toBeGreaterThan(0)
    expect(delta(afterFirst, before, 'regionalInventoryLookupComparisons'))
      .toBeLessThan(128)
    expect(delta(afterFirst, before, 'regionalInventoryNodesVisited'))
      .toBeLessThan(128)
    expect(delta(afterFirst, before, 'regionalInventoryNodesAllocated'))
      .toBeLessThan(64)
    expect(delta(afterFirst, before, 'regionalInventoryNodesShared'))
      .toBeGreaterThan(0)
    expect(delta(afterFirst, before, 'regionalInventoryNodesShared'))
      .toBeLessThan(64)

    const freshCore = createDocumentCore()
    const fresh = freshCore.open(nextSource)
    const freshMarkup = freshCore.project(fresh, 'markup')
    expect(applyMarkupReplacement(previousMarkup.events, replacement))
      .toEqual(freshMarkup.events)
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
          sourceOffset: segment.source.start + offset - segment.projected.start
        })
      }
    }
    const sourceDelta = replacement.next.source.end -
      replacement.previous.source.end
    const syntaxDelta = replacement.next.syntax.end -
      replacement.previous.syntax.end
    for (
      let offset = replacement.previous.syntax.end;
      offset < previousMarkup.syntax.ast.root.range.end;
      offset += 1
    ) {
      const origin = previousMarkup.syntax.coordinates.originAt(offset)
      expect(freshMarkup.syntax.coordinates.originAt(offset + syntaxDelta))
        .toEqual(origin.kind === 'source'
          ? { kind: 'source', sourceOffset: origin.sourceOffset + sourceDelta }
          : {
            kind: 'generated',
            sourcePosition: origin.sourcePosition + sourceDelta,
            affinity: origin.affinity
          })
    }

    const shiftedFarRange = Object.freeze({
      start: farComment.range.start + 1,
      end: farComment.range.end + 1
    })
    const freshFarComment = fresh.annotations[2]
    if (freshFarComment?.kind !== 'comment') {
      throw new Error('Expected fresh far Comment')
    }
    const freshFarProjection = freshCore.projectComment(fresh, freshFarComment)
    expect(freshFarProjection.markdown).toBe(previousFarProjection.markdown)
    expect(freshFarProjection.ast).toEqual(previousFarProjection.ast)
    for (let offset = 0; offset < freshFarProjection.markdown.length; offset += 1) {
      const previousOrigin = previousFarProjection.coordinates.originAt(offset)
      if (previousOrigin.kind !== 'source') {
        throw new Error('Expected source-backed far Comment')
      }
      expect(freshFarProjection.coordinates.originAt(offset)).toEqual({
        kind: 'source',
        sourceOffset: previousOrigin.sourceOffset + 1
      })
    }

    const secondAt = nextSource.indexOf('payload')
    const beforeSecond = inspectionOf(core)
    const second = core.apply(first.revision, [{
      start: secondAt,
      end: secondAt + 'payload'.length,
      insert: 'PAYLOADS'
    }], {
      projections: [{
        name: 'comment',
        annotationRange: shiftedFarRange
      }]
    })
    const afterSecond = inspectionOf(core)
    expect(second.change.projections).toHaveLength(1)
    expect(second.change.projections[0]).toMatchObject({
      name: 'comment',
      scope: 'regions'
    })
    expect(delta(afterSecond, beforeSecond, 'regionalFastApplies')).toBe(1)
    expect(delta(afterSecond, beforeSecond, 'documentParses')).toBe(0)
    expect(delta(afterSecond, beforeSecond, 'sourceMaterializations')).toBe(0)
    expect(delta(
      afterSecond,
      beforeSecond,
      'documentAnnotationMaterializedNodes'
    )).toBe(0)
    expect(delta(
      afterSecond,
      beforeSecond,
      'documentRetainedFactOutputStructuralUnits'
    )).toBe(0)
    expect(delta(afterSecond, beforeSecond, 'regionalInventoryBuildUnits'))
      .toBe(0)
    expect(delta(
      afterSecond,
      beforeSecond,
      'regionalInventoryCandidateRegionParses'
    )).toBe(1)
    expect(delta(afterSecond, beforeSecond, 'regionalInventoryChangedLeaves'))
      .toBe(1)
    expect(delta(afterSecond, beforeSecond, 'regionalInventoryRootsAttempted'))
      .toBe(1)
    expect(delta(afterSecond, beforeSecond, 'regionalInventoryRootsCommitted'))
      .toBe(1)
    expect(delta(afterSecond, beforeSecond, 'regionalInventoryLookupComparisons'))
      .toBeGreaterThan(0)
    expect(delta(afterSecond, beforeSecond, 'regionalInventoryLookupComparisons'))
      .toBeLessThan(128)
    expect(delta(afterSecond, beforeSecond, 'regionalInventoryNodesAllocated'))
      .toBeLessThan(64)
    expect(delta(afterSecond, beforeSecond, 'regionalInventoryNodesShared'))
      .toBeGreaterThan(0)
    expect(delta(afterSecond, beforeSecond, 'regionalInventoryNodesShared'))
      .toBeLessThan(64)

    // Compatibility annotation access may materialize the source-ordered view,
    // but both regional transactions have already been admitted without it.
    const firstAnnotations = first.revision.annotations
    expect(firstAnnotations.map(annotation => annotation.kind))
      .toEqual(['deletion', 'addition', 'comment'])
    expect(firstAnnotations).toEqual(fresh.annotations)
    const shiftedFarComment = firstAnnotations[2]
    if (shiftedFarComment?.kind !== 'comment') {
      throw new Error('Expected shifted far Comment')
    }
    expect(shiftedFarComment.range).toEqual(shiftedFarRange)
    const historicalFarProjection = core.projectComment(
      first.revision,
      shiftedFarComment
    )
    expect(historicalFarProjection.markdown).toBe(freshFarProjection.markdown)
    expect(historicalFarProjection.ast).toEqual(freshFarProjection.ast)
    for (let offset = 0; offset < historicalFarProjection.markdown.length; offset += 1) {
      expect(historicalFarProjection.coordinates.originAt(offset))
        .toEqual(freshFarProjection.coordinates.originAt(offset))
    }

    const secondAnnotations = second.revision.annotations
    const secondComment = secondAnnotations[2]
    if (secondComment?.kind !== 'comment') {
      throw new Error('Expected second regional Comment')
    }
    const beforeSecondProjection = inspectionOf(core)
    const secondProjection = core.projectComment(second.revision, secondComment)
    const afterSecondProjection = inspectionOf(core)
    expect(secondProjection.markdown).toBe('comment PAYLOADS')
    expect(delta(
      afterSecondProjection,
      beforeSecondProjection,
      'documentParses'
    )).toBe(0)
    expect(delta(
      afterSecondProjection,
      beforeSecondProjection,
      'sourceMaterializations'
    )).toBe(0)
  })

  it('projects two nested Comments from one edited inventory leaf', () => {
    const source = [
      'head',
      '',
      'before {>>outer before {>>nested word<<} after<<} bridge ' +
        '{>>second root<<} after',
      '',
      'far {--deleted--}',
      '',
      'tail\n'
    ].join('\n')
    const editAt = source.indexOf('word')
    const nextSource = source.slice(0, editAt) + 'WORDS' +
      source.slice(editAt + 4)
    const core = createDocumentCore()
    const opened = core.open(source)
    const outer = opened.annotations[0]
    const secondRoot = opened.annotations[1]
    const nested = outer?.arms[0]?.annotations[0]
    if (
      outer?.kind !== 'comment' || nested?.kind !== 'comment' ||
      secondRoot?.kind !== 'comment'
    ) {
      throw new Error('Expected nested Comments and a second Comment root')
    }
    const before = inspectionOf(core)

    const commit = core.apply(opened, [{
      start: editAt,
      end: editAt + 4,
      insert: 'WORDS'
    }], {
      projections: [
        { name: 'comment', annotationRange: nested.range },
        { name: 'comment', annotationRange: outer.range }
      ]
    })
    const afterApply = inspectionOf(core)
    const change = commit.change.projections[0]
    if (change?.name !== 'comment' || change.scope !== 'regions') {
      throw new Error('Expected regional Comment replacements')
    }
    expect(commit.change.projections).toHaveLength(1)
    expect(change.replacements).toHaveLength(2)
    expect(change.replacements.map(replacement => replacement.previous.annotation))
      .toEqual([outer.range, nested.range])
    assertPortable(change.replacements)
    expect(delta(afterApply, before, 'regionalFastApplies')).toBe(1)
    expect(delta(afterApply, before, 'documentParses')).toBe(0)
    expect(delta(afterApply, before, 'documentParseSourceUnits')).toBe(0)
    expect(delta(afterApply, before, 'sourceMaterializations')).toBe(0)
    expect(delta(afterApply, before, 'sourceMaterializationOutputUnits')).toBe(0)
    expect(delta(
      afterApply,
      before,
      'regionalInventoryCandidateRegionParses'
    )).toBe(1)
    expect(delta(afterApply, before, 'regionalInventoryChangedLeaves')).toBe(1)

    const freshCore = createDocumentCore()
    const fresh = freshCore.open(nextSource)
    const freshOuter = fresh.annotations[0]
    const freshNested = freshOuter?.arms[0]?.annotations[0]
    if (freshOuter?.kind !== 'comment' || freshNested?.kind !== 'comment') {
      throw new Error('Expected fresh nested Comments')
    }
    for (const [index, freshComment] of [freshOuter, freshNested].entries()) {
      const replacement = change.replacements[index]
      if (replacement === undefined) throw new Error('Expected Comment replacement')
      const freshProjection = freshCore.projectComment(fresh, freshComment)
      expect(replacement.annotation)
        .toEqual(annotationSnapshotForOracle(freshComment))
      expect(replacement.markdown).toBe(freshProjection.markdown)
      expect(replacement.ast).toEqual(freshProjection.ast)
      expectCommentCoordinatesEqual(freshProjection, replacement.coordinates)
    }

    const nextOuter = commit.revision.annotations[0]
    const nextSecondRoot = commit.revision.annotations[1]
    const nextNested = nextOuter?.arms[0]?.annotations[0]
    if (
      nextOuter?.kind !== 'comment' || nextNested?.kind !== 'comment' ||
      nextSecondRoot?.kind !== 'comment'
    ) {
      throw new Error('Expected next nested Comments and second root')
    }
    expect(nextSecondRoot.range.start).toBe(secondRoot.range.start + 1)
    const beforeLocalReads = inspectionOf(core)
    const outerProjection = core.projectComment(commit.revision, nextOuter)
    const nestedProjection = core.projectComment(commit.revision, nextNested)
    const afterLocalReads = inspectionOf(core)
    const freshOuterProjection = freshCore.projectComment(fresh, freshOuter)
    const freshNestedProjection = freshCore.projectComment(fresh, freshNested)
    expect(outerProjection.markdown).toBe(freshOuterProjection.markdown)
    expect(outerProjection.ast).toEqual(freshOuterProjection.ast)
    expectCommentCoordinatesEqual(
      outerProjection,
      change.replacements[0]?.coordinates ?? []
    )
    expect(nestedProjection.markdown).toBe(freshNestedProjection.markdown)
    expect(nestedProjection.ast).toEqual(freshNestedProjection.ast)
    expectCommentCoordinatesEqual(
      nestedProjection,
      change.replacements[1]?.coordinates ?? []
    )
    expect(afterLocalReads.documentParses).toBe(beforeLocalReads.documentParses)
    expect(afterLocalReads.sourceMaterializations)
      .toBe(beforeLocalReads.sourceMaterializations)
  })

  it('projects requested Comments across inventory leaves from one edit', () => {
    const source = [
      'head',
      '',
      'left {>>first word<<}',
      '',
      'middle {++visible++}',
      '',
      'right {>>second note<<}',
      '',
      'tail\n'
    ].join('\n')
    const editAt = source.indexOf('word')
    const insert = 'WORDS!'
    const deltaUnits = insert.length - 'word'.length
    const nextSource = source.slice(0, editAt) + insert +
      source.slice(editAt + 'word'.length)
    const core = createDocumentCore()
    const opened = core.open(source)
    const first = opened.annotations[0]
    const second = opened.annotations[2]
    if (first?.kind !== 'comment' || second?.kind !== 'comment') {
      throw new Error('Expected Comments in separate inventory leaves')
    }
    const before = inspectionOf(core)

    const commit = core.apply(opened, [{
      start: editAt,
      end: editAt + 'word'.length,
      insert
    }], {
      projections: [
        { name: 'comment', annotationRange: second.range },
        'markup',
        { name: 'comment', annotationRange: first.range }
      ]
    })
    const after = inspectionOf(core)
    const markup = commit.change.projections[0]
    const comments = commit.change.projections[1]
    if (
      markup?.name !== 'markup' || markup.scope !== 'regions' ||
      comments?.name !== 'comment' || comments.scope !== 'regions'
    ) throw new Error('Expected regional cross-leaf projections')

    expect(markup.replacements).toHaveLength(1)
    expect(comments.replacements).toHaveLength(2)
    expect(comments.replacements.map(item => item.previous.annotation))
      .toEqual([first.range, second.range])
    expect(comments.replacements[1]?.next.annotation).toEqual({
      start: second.range.start + deltaUnits,
      end: second.range.end + deltaUnits
    })
    assertPortable(comments.replacements)
    expect(delta(after, before, 'regionalFastApplies')).toBe(1)
    expect(delta(after, before, 'documentParses')).toBe(0)
    expect(delta(after, before, 'sourceMaterializations')).toBe(0)
    expect(delta(after, before, 'regionalInventoryCandidateRegionParses'))
      .toBe(2)
    expect(delta(after, before, 'regionalInventoryChangedLeaves')).toBe(1)

    const freshCore = createDocumentCore()
    const fresh = freshCore.open(nextSource)
    const freshComments = fresh.annotations.filter(annotation =>
      annotation.kind === 'comment'
    )
    expect(freshComments).toHaveLength(2)
    for (const [index, freshComment] of freshComments.entries()) {
      const replacement = comments.replacements[index]
      if (replacement === undefined) throw new Error('Expected replacement')
      const freshProjection = freshCore.projectComment(fresh, freshComment)
      expect(replacement.annotation)
        .toEqual(annotationSnapshotForOracle(freshComment))
      expect(replacement.markdown).toBe(freshProjection.markdown)
      expect(replacement.ast).toEqual(freshProjection.ast)
      expectCommentCoordinatesEqual(freshProjection, replacement.coordinates)
    }

    const nextComments = commit.revision.annotations.filter(annotation =>
      annotation.kind === 'comment'
    )
    const beforeReads = inspectionOf(core)
    for (const [index, comment] of nextComments.entries()) {
      const projected = core.projectComment(commit.revision, comment)
      expect(projected.markdown).toBe(
        comments.replacements[index]?.markdown
      )
    }
    const afterReads = inspectionOf(core)
    expect(afterReads.documentParses).toBe(beforeReads.documentParses)
    expect(afterReads.sourceMaterializations).toBe(beforeReads.sourceMaterializations)
  })

  it('falls back when an inventory Comment edit changes Display topology', () => {
    const source = 'head {++visible++}\n\nbefore {>>word<<} after\n\ntail\n'
    const editAt = source.indexOf('word')
    const core = createDocumentCore()
    const opened = core.open(source)
    const comment = opened.annotations[1]
    if (comment?.kind !== 'comment') throw new Error('Expected Comment')
    const before = inspectionOf(core)
    const commit = core.apply(opened, [{
      start: editAt,
      end: editAt + 4,
      insert: '# hi'
    }], {
      projections: ['markup', {
        name: 'comment',
        annotationRange: comment.range
      }]
    })
    const after = inspectionOf(core)
    expect(commit.change.projections).toEqual([
      {
        name: 'markup',
        scope: 'document',
        reason: 'structural-region-ineligible'
      },
      {
        name: 'comment',
        scope: 'document',
        targets: [comment.range],
        reason: 'structural-region-ineligible'
      }
    ])
    expect(delta(after, before, 'regionalInventoryCandidateRegionParses'))
      .toBe(1)
    expect(delta(after, before, 'regionalInventoryChangedLeaves')).toBe(0)
  })

  it('falls back before inventory publication when a regional edit adds a diagnostic', () => {
    const source = [
      'early {--deleted--}\n\n',
      'middle {++added text++}\n\n',
      'far {>>comment<<}\n\n',
      'tail\n'
    ].join('')
    const core = createDocumentCore()
    const opened = core.open(source)
    const comment = opened.annotations[2]
    if (comment?.kind !== 'comment') throw new Error('Expected Comment')
    const at = source.indexOf('added text') + 'added text'.length
    const before = inspectionOf(core)
    const commit = core.apply(opened, [{ start: at, end: at, insert: ' {++' }], {
      projections: ['markup', {
        name: 'comment',
        annotationRange: comment.range
      }]
    })
    const after = inspectionOf(core)
    expect(commit.change.projections).toEqual([
      {
        name: 'markup',
        scope: 'document',
        reason: 'structural-region-ineligible'
      },
      {
        name: 'comment',
        scope: 'document',
        targets: [comment.range],
        reason: 'structural-region-ineligible'
      }
    ])
    expect(commit.revision.diagnostics.length).toBeGreaterThan(0)
    expect(delta(after, before, 'regionalInventoryCandidateRegionParses'))
      .toBe(1)
    expect(delta(after, before, 'regionalInventoryRootsAttempted')).toBe(0)
    expect(delta(after, before, 'regionalInventoryRootsCommitted')).toBe(0)
  })

  it('keeps multi-region inventory tree work suffix-independent', () => {
    const workFor = (suffixParagraphs: number): Readonly<{
      comparisons: number
      visits: number
      allocations: number
      shared: number
    }> => {
      const source = [
        'early {--deleted--}\n\n',
        'middle {++target++}\n\n',
        'far {>>payload<<}\n\n',
        'suffix\n\n'.repeat(suffixParagraphs)
      ].join('')
      const core = createUnboundedDocumentCoreForInspection()
      const opened = core.open(source)
      const comment = opened.annotations[2]
      if (comment?.kind !== 'comment') throw new Error('Expected Comment')
      const before = inspectionOf(core)
      const at = source.indexOf('target')
      const commit = core.apply(opened, [{
        start: at,
        end: at + 6,
        insert: 'TARGETS'
      }], {
        projections: ['markup', {
          name: 'comment',
          annotationRange: comment.range
        }]
      })
      const after = inspectionOf(core)
      expect(commit.change.projections[0]?.scope).toBe('regions')
      expect(commit.change.projections[1]?.scope).toBe('regions')
      expect(delta(after, before, 'regionalInventoryChangedLeaves')).toBe(1)
      expect(delta(after, before, 'regionalInventoryCandidateRegionParses'))
        .toBe(2)
      // These are tree-descent/path-copy counters. Candidate parsing and
      // topology validation are bounded separately by the changed region.
      return Object.freeze({
        comparisons: delta(
          after,
          before,
          'regionalInventoryLookupComparisons'
        ),
        visits: delta(after, before, 'regionalInventoryNodesVisited'),
        allocations: delta(after, before, 'regionalInventoryNodesAllocated'),
        shared: delta(after, before, 'regionalInventoryNodesShared')
      })
    }
    const small = workFor(1_000)
    const large = workFor(16_000)
    expect(large.comparisons).toBeLessThan(small.comparisons * 2)
    expect(large.visits).toBeLessThan(small.visits * 2)
    expect(large.allocations).toBeLessThan(small.allocations * 2)
    expect(large.shared).toBeLessThan(small.shared * 2)
  })

  it('does not build the CM inventory for a plain document', () => {
    const core = createUnboundedDocumentCoreForInspection()
    const before = inspectionOf(core)
    core.open('plain\n\n'.repeat(10_000))
    const after = inspectionOf(core)
    expect(delta(after, before, 'regionalInventoryBuildUnits')).toBe(0)
    expect(delta(after, before, 'regionalInventoryNodesAllocated')).toBe(0)
  })

  it('does not build the multi-region inventory for one CM root', () => {
    const core = createDocumentCore()
    const before = inspectionOf(core)
    core.open('head\n\nonly {++one++}\n\ntail\n')
    const after = inspectionOf(core)
    expect(delta(after, before, 'regionalInventoryBuildUnits')).toBe(0)
    expect(delta(after, before, 'regionalInventoryNodesAllocated')).toBe(0)
  })

  it('builds a dense CM inventory with linear retained-fact work', () => {
    const buildFor = (regions: number): ChangeInspection => {
      const core = createDocumentCore()
      core.open(`head\n\n${'{++word++}\n\n'.repeat(regions)}tail\n`)
      return inspectionOf(core)
    }
    const small = buildFor(100)
    const large = buildFor(1_000)
    expect(small.regionalInventoryBuildUnits).toBeGreaterThan(0)
    expect(large.regionalInventoryBuildUnits)
      .toBeLessThan(small.regionalInventoryBuildUnits * 12)
    expect(small.documentAnnotationMaterializedNodes).toBe(0)
    expect(large.documentAnnotationMaterializedNodes).toBe(0)
  })

  it('compacts a large plain suffix behind a few CM regions', () => {
    const buildFor = (plainSuffixRegions: number): Readonly<{
      buildUnits: number
      nodes: number
    }> => {
      const core = createUnboundedDocumentCoreForInspection()
      core.open([
        'early {--deleted--}\n\n',
        'middle {++added++}\n\n',
        'far {>>comment<<}\n\n',
        'x\n\n'.repeat(plainSuffixRegions)
      ].join(''))
      const inspection = inspectionOf(core)
      expect(inspection.documentAnnotationMaterializedNodes).toBe(0)
      return Object.freeze({
        buildUnits: inspection.regionalInventoryBuildUnits,
        nodes: inspection.regionalInventoryNodesAllocated
      })
    }
    const small = buildFor(1_000)
    const large = buildFor(100_000)
    expect(large.nodes).toBeLessThan(small.nodes * 2)
    expect(large.buildUnits).toBeLessThan(small.buildUnits * 110)
  }, 30_000)

  it('keeps a deeply nested Comment annotation and projection regional', () => {
    const depth = 3_000
    const payload = '{++'.repeat(depth) + 'x' + '++}'.repeat(depth)
    const source = `head\n\nbefore {>>${payload}<<} after\n\ntail\n`
    const editAt = source.indexOf('x')
    const nextSource = source.slice(0, editAt) + 'y' + source.slice(editAt + 1)
    const core = createDocumentCore()
    const opened = core.open(source)
    const comment = opened.annotations[0]
    if (comment?.kind !== 'comment') throw new Error('Expected Comment')
    const before = inspectionOf(core)

    const commit = core.apply(opened, [{
      start: editAt,
      end: editAt + 1,
      insert: 'y'
    }], {
      projections: [{
        name: 'comment',
        annotationRange: comment.range
      }]
    })
    const afterApply = inspectionOf(core)
    const change = commit.change.projections[0]
    if (change?.name !== 'comment' || change.scope !== 'regions') {
      throw new Error('Expected regional Comment change')
    }
    expect(() => structuredClone(commit.change)).not.toThrow()
    const freshCore = createDocumentCore()
    const fresh = freshCore.open(nextSource)
    expectAnnotationTreesEqual(commit.revision.annotations, fresh.annotations)

    const nextComment = commit.revision.annotations[0]
    const freshComment = fresh.annotations[0]
    if (nextComment?.kind !== 'comment' || freshComment?.kind !== 'comment') {
      throw new Error('Expected Comment revisions')
    }
    expect(change.replacements[0]?.annotation)
      .toEqual(annotationSnapshotForOracle(freshComment))
    const projection = core.projectComment(commit.revision, nextComment)
    const freshProjection = freshCore.projectComment(fresh, freshComment)
    expect(projection.markdown).toBe(freshProjection.markdown)
    expect(projection.ast).toEqual(freshProjection.ast)
    const afterProjection = inspectionOf(core)
    expect(delta(afterApply, before, 'regionalFastApplies')).toBe(1)
    expect(delta(afterApply, before, 'documentParses')).toBe(0)
    expect(delta(afterApply, before, 'sourceMaterializations')).toBe(0)
    expect(afterProjection.documentParses).toBe(afterApply.documentParses)
    expect(afterProjection.sourceMaterializations)
      .toBe(afterApply.sourceMaterializations)
  })

  it('replaces one isolated Comment Display after a payload edit', () => {
    const payload = [
      '# Note',
      '',
      'See [inside][ref].',
      '',
      '[ref]: /local',
      '',
      'edit word',
      ''
    ].join('\n')
    const source =
      `head\n\nbefore {>>${payload}<<} after\n\ntail\n\n` +
      'suffix\n\n'.repeat(100)
    const editAt = source.indexOf('word')
    const nextSource = source.slice(0, editAt) + 'WORDS' +
      source.slice(editAt + 4)
    const previousOracleCore = createDocumentCore()
    const previousOracle = previousOracleCore.open(source)
    const previousComment = previousOracle.annotations[0]
    if (previousComment?.kind !== 'comment') {
      throw new Error('Expected previous Comment')
    }
    const previousCommentProjection = previousOracleCore.projectComment(
      previousOracle,
      previousComment
    )
    const previousMarkup = previousOracleCore.project(previousOracle, 'markup')
    const core = createDocumentCore()
    const opened = core.open(source)
    const comment = opened.annotations[0]
    if (comment?.kind !== 'comment') throw new Error('Expected Comment')
    const requestedRange = Object.freeze({
      start: comment.range.start,
      end: comment.range.end
    })
    const before = inspectionOf(core)

    const commit = core.apply(opened, [{
      start: editAt,
      end: editAt + 4,
      insert: 'WORDS'
    }], {
      projections: [
        'markup',
        { name: 'comment', annotationRange: requestedRange }
      ]
    })
    const after = inspectionOf(core)
    expect(commit.change.projections).toHaveLength(2)
    const markupChange = commit.change.projections[0]
    if (markupChange?.name !== 'markup' || markupChange.scope !== 'regions') {
      throw new Error('Expected regional Markup change')
    }
    const markupReplacement = markupChange.replacements[0]
    if (markupReplacement === undefined) {
      throw new Error('Expected Markup replacement')
    }
    expect(markupReplacement.previous).toEqual({
      source: { start: 6, end: 80 },
      syntax: { start: 6, end: 21 },
      events: { start: 1, end: 3 }
    })
    expect(markupReplacement.next).toEqual({
      source: { start: 6, end: 81 },
      syntax: { start: 6, end: 21 },
      events: { start: 1, end: 3 }
    })
    expect(markupReplacement.events).toEqual([
      {
        kind: 'text',
        text: 'before ',
        sourceRange: { start: 6, end: 13 }
      },
      {
        kind: 'text',
        text: ' after\n\n',
        sourceRange: { start: 73, end: 81 }
      }
    ])
    const change = commit.change.projections[1]
    if (change?.name !== 'comment' || change.scope !== 'regions') {
      throw new Error('Expected regional Comment change')
    }
    expect(change.replacements).toHaveLength(1)
    const replacement = change.replacements[0]
    if (replacement === undefined) throw new Error('Expected replacement')

    expect(commit.revision.annotations).toEqual([{
      kind: 'comment',
      range: { start: 13, end: 73 },
      arms: [{
        name: 'comment',
        range: { start: 16, end: 70 },
        annotations: []
      }]
    }])
    expect(replacement.previous).toEqual({
      annotation: { start: 13, end: 72 },
      payload: { start: 16, end: 69 },
      projection: { start: 0, end: 53 }
    })
    expect(replacement.next).toEqual({
      annotation: { start: 13, end: 73 },
      payload: { start: 16, end: 70 },
      projection: { start: 0, end: 54 }
    })
    expect(replacement.annotation).toEqual({
      root: 0,
      nodes: [{
        kind: 'comment',
        range: { start: 13, end: 73 },
        arms: [{
          name: 'comment',
          range: { start: 16, end: 70 },
          children: []
        }]
      }]
    })
    expect(replacement.markdown).toBe(payload.replace('word', 'WORDS'))
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
      .toBeGreaterThan(0)
    expect(delta(after, before, 'regionalIntrinsicSourceUnits'))
      .toBeLessThan(source.length)

    const freshCore = createDocumentCore()
    const fresh = freshCore.open(nextSource)
    const freshComment = fresh.annotations[0]
    if (freshComment?.kind !== 'comment') {
      throw new Error('Expected fresh Comment')
    }
    const freshCommentProjection = freshCore.projectComment(
      fresh,
      freshComment
    )
    expect(commit.revision.annotations).toEqual(fresh.annotations)
    expect(replacement.markdown).toBe(freshCommentProjection.markdown)
    expect(replacement.ast).toEqual(freshCommentProjection.ast)
    let projectedEnd = 0
    for (const segment of replacement.coordinates) {
      expect(segment.projected.start).toBe(projectedEnd)
      projectedEnd = segment.projected.end
      expect(segment.kind).toBe('source')
      if (segment.kind !== 'source') {
        throw new Error('Expected canonical Comment coordinate')
      }
      for (
        let offset = segment.projected.start;
        offset < segment.projected.end;
        offset += 1
      ) {
        expect(freshCommentProjection.coordinates.originAt(offset)).toEqual({
          kind: 'source',
          sourceOffset: segment.source.start +
            offset - segment.projected.start
        })
      }
    }
    expect(projectedEnd).toBe(replacement.markdown.length)
    const pending = [...replacement.ast.root.children]
    const nodes: MarkdownAstNode[] = []
    while (pending.length > 0) {
      const node = pending.pop()
      if (node === undefined) break
      nodes.push(node)
      for (const child of node.children) pending.push(child)
    }
    expect(nodes.find(node => node.kind === 'link')?.attributes)
      .toMatchObject({ rawDestination: '/local' })
    expect(nodes.some(node => node.kind === 'definition')).toBe(true)

    const freshMarkup = freshCore.project(fresh, 'markup')
    expect(applyMarkupReplacement(
      previousMarkup.events,
      markupReplacement
    )).toEqual(freshMarkup.events)
    expect(applySyntaxReplacementForOracle(
      previousMarkup.syntax.ast.root,
      markupReplacement
    )).toEqual(freshMarkup.syntax.ast.root)
    for (const segment of markupReplacement.coordinates) {
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
    expect(freshMarkup.events.map(event =>
      event.kind === 'text' ? event.text : event.kind
    )).toEqual(previousMarkup.events.map(event =>
      event.kind === 'text' ? event.text : event.kind
    ))
    expect(freshMarkup.syntax.ast).toEqual(previousMarkup.syntax.ast)
    const appliedEdit = commit.change.appliedEdits[0]
    if (appliedEdit === undefined) throw new Error('Expected applied edit')
    const sourceDelta = appliedEdit.insert.length -
      (appliedEdit.end - appliedEdit.start)
    const shiftOffset = (offset: number): number =>
      offset <= appliedEdit.start ? offset : offset + sourceDelta
    const rebasedEvents = previousMarkup.events.map(event =>
      event.kind === 'text'
        ? {
          ...event,
          sourceRange: {
            start: shiftOffset(event.sourceRange.start),
            end: shiftOffset(event.sourceRange.end)
          }
        }
        : event
    )
    expect(rebasedEvents).toEqual(freshMarkup.events)
    for (
      let offset = 0;
      offset < previousMarkup.syntax.ast.root.range.end;
      offset += 1
    ) {
      const origin = previousMarkup.syntax.coordinates.originAt(offset)
      expect(origin.kind).toBe('source')
      if (origin.kind !== 'source') throw new Error('Expected source origin')
      expect(freshMarkup.syntax.coordinates.originAt(offset)).toEqual({
        kind: 'source',
        sourceOffset: shiftOffset(origin.sourceOffset)
      })
    }
    expect(previousCommentProjection.annotationRange)
      .toEqual(replacement.previous.annotation)
    expect(delta(after, before, 'regionalCommentProjectionPreparationUnits'))
      .toBe(payload.length + replacement.markdown.length)
    expect(delta(after, before, 'regionalCommentAstMaterializedNodes'))
      .toBeGreaterThan(0)
    expect(delta(after, before, 'regionalCommentCoordinateSegments'))
      .toBe(replacement.coordinates.length)
  })

  it('normalizes Comment requests and canonicalizes projection changes', () => {
    const source = 'head\n\nbefore {>>edit word<<} after\n\ntail\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const comment = opened.annotations[0]
    if (comment?.kind !== 'comment') throw new Error('Expected Comment')
    const at = source.indexOf('word')
    const request = { name: 'comment' as const, annotationRange: comment.range }
    const commit = core.apply(opened, [{
      start: at,
      end: at + 4,
      insert: 'WORDS'
    }], {
      projections: [request, 'markup', request, 'markup']
    })

    expect(commit.change.projections.map(change => change.name))
      .toEqual(['markup', 'comment'])
    expect(commit.change.projections.map(change => change.scope))
      .toEqual(['regions', 'regions'])

    const emptySource = 'head\n\nordinary text paragraph\n\ntail\n'
    const emptyAt = emptySource.indexOf('text')
    const emptyCore = createDocumentCore()
    const emptyOpened = emptyCore.open(emptySource)
    const beforeEmpty = inspectionOf(emptyCore)
    const empty = emptyCore.apply(emptyOpened, [{
      start: emptyAt,
      end: emptyAt + 4,
      insert: 'WORDS'
    }], { projections: [] })
    const afterEmpty = inspectionOf(emptyCore)
    expect(empty.change.projections).toEqual([])
    expect(empty.change.resynchronization).toBeUndefined()
    expect(delta(afterEmpty, beforeEmpty, 'regionalFastApplies')).toBe(1)
    expect(delta(afterEmpty, beforeEmpty, 'documentParses')).toBe(0)
    expect(delta(afterEmpty, beforeEmpty, 'sourceMaterializations')).toBe(0)
    expect(delta(afterEmpty, beforeEmpty, 'regionalIntrinsicSourceUnits')).toBe(26)
    expect(delta(afterEmpty, beforeEmpty, 'regionalProjectionPreparationUnits')).toBe(0)
    expect(delta(afterEmpty, beforeEmpty, 'regionalMarkupEventUnits')).toBe(0)
    expect(delta(afterEmpty, beforeEmpty, 'regionalAstMaterializedNodes')).toBe(0)
    expect(delta(afterEmpty, beforeEmpty, 'regionalCoordinateSegments')).toBe(0)

    for (const candidate of [
      { insert: 'text\n# heading', markdown: undefined },
      { insert: '{++added++}', markdown: undefined },
      { insert: 'WORDS', markdown: { gfm: false } }
    ] as const) {
      const fallbackCore = createDocumentCore()
      const fallbackOpened = fallbackCore.open(emptySource)
      const beforeFallback = inspectionOf(fallbackCore)
      const fallback = fallbackCore.apply(fallbackOpened, [{
        start: emptyAt,
        end: emptyAt + 4,
        insert: candidate.insert
      }], {
        projections: [],
        ...(candidate.markdown === undefined ? {} : { markdown: candidate.markdown })
      })
      const afterFallback = inspectionOf(fallbackCore)
      expect(fallback.change.projections).toEqual([])
      expect(delta(afterFallback, beforeFallback, 'regionalFastApplies')).toBe(0)
      expect(delta(afterFallback, beforeFallback, 'documentParses')).toBe(1)
      expect(delta(afterFallback, beforeFallback, 'sourceMaterializations')).toBe(1)
    }

    const resynchronizationCore = createDocumentCore()
    const resynchronizationOpened = resynchronizationCore.open(emptySource)
    const resynchronization = resynchronizationCore.apply(
      resynchronizationOpened,
      [{
        start: emptyAt,
        end: emptyAt + 4,
        insert: 'text\n# heading'
      }],
      { projections: [] }
    )
    expect(resynchronization.change.resynchronization).toEqual({
      kind: 'source',
      scope: 'document',
      reason: 'structural-region-ineligible',
      source: emptySource.slice(0, emptyAt) + 'text\n# heading' +
        emptySource.slice(emptyAt + 4)
    })
    expect(structuredClone(resynchronization.change))
      .toEqual(resynchronization.change)

    const multipleSource =
      'head\n\n{>>first word<<}\n\nmiddle\n\n{>>second word<<}\n\ntail\n'
    const multipleCore = createDocumentCore()
    const multipleOpened = multipleCore.open(multipleSource)
    const first = multipleOpened.annotations[0]
    const second = multipleOpened.annotations[1]
    if (first?.kind !== 'comment' || second?.kind !== 'comment') {
      throw new Error('Expected two Comments')
    }
    const beforeMultiple = inspectionOf(multipleCore)
    const multiple = multipleCore.apply(multipleOpened, [{
      start: multipleSource.indexOf('first'),
      end: multipleSource.indexOf('first') + 5,
      insert: 'FIRST'
    }], {
      projections: [
        { name: 'comment', annotationRange: second.range },
        'markup',
        { name: 'comment', annotationRange: first.range }
      ]
    })
    const afterMultiple = inspectionOf(multipleCore)
    expect(multiple.change.projections.map(projection => ({
      name: projection.name,
      scope: projection.scope
    }))).toEqual([{
      name: 'markup', scope: 'regions'
    }, {
      name: 'comment', scope: 'regions'
    }])
    const multipleComments = multiple.change.projections[1]
    if (
      multipleComments?.name !== 'comment' ||
      multipleComments.scope !== 'regions'
    ) throw new Error('Expected cross-leaf Comment replacements')
    expect(multipleComments.replacements.map(item => item.previous.annotation))
      .toEqual([first.range, second.range])
    assertPortable(multipleComments.replacements)
    expect(delta(
      afterMultiple,
      beforeMultiple,
      'regionalInventoryCandidateRegionParses'
    )).toBe(2)
    expect(delta(
      afterMultiple,
      beforeMultiple,
      'regionalInventoryRootsAttempted'
    )).toBe(1)

    const missingCore = createDocumentCore()
    const missingOpened = missingCore.open(source)
    const missing = missingCore.apply(missingOpened, [{
      start: at,
      end: at + 4,
      insert: 'WORDS'
    }], {
      projections: [{
        name: 'comment',
        annotationRange: { start: source.length + 10, end: source.length + 20 }
      }]
    })
    expect(missing.change.projections).toEqual([{
      name: 'comment',
      scope: 'document',
      targets: [{ start: source.length + 10, end: source.length + 20 }],
      reason: 'structural-region-ineligible'
    }])
  })

  it('emits an exact combined delta for a standalone Comment block', () => {
    const source = 'head\n\n{>>note text<<}\n\ntail\n'
    const nextSource = source.replace('text', 'WORDS')
    const previousCore = createDocumentCore()
    const previous = previousCore.open(source)
    const previousMarkup = previousCore.project(previous, 'markup')
    const core = createDocumentCore()
    const opened = core.open(source)
    const comment = opened.annotations[0]
    if (comment?.kind !== 'comment') throw new Error('Expected Comment')
    const at = source.indexOf('text')
    const commit = core.apply(opened, [{
      start: at,
      end: at + 4,
      insert: 'WORDS'
    }], {
      projections: ['markup', {
        name: 'comment',
        annotationRange: comment.range
      }]
    })
    const markup = commit.change.projections[0]
    if (markup?.name !== 'markup' || markup.scope !== 'regions') {
      throw new Error('Expected regional Markup change')
    }
    const replacement = markup.replacements[0]
    if (replacement === undefined) throw new Error('Expected replacement')
    expect(replacement.syntaxBlocks).toEqual([])

    const freshCore = createDocumentCore()
    const fresh = freshCore.open(nextSource)
    const freshMarkup = freshCore.project(fresh, 'markup')
    expect(applyMarkupReplacement(previousMarkup.events, replacement))
      .toEqual(freshMarkup.events)
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
          sourceOffset: segment.source.start + offset - segment.projected.start
        })
      }
    }
  })

  it.each(['start', 'end'] as const)(
    'admits insertion at the nonempty Comment payload %s boundary',
    boundary => {
      const source = 'head\n\nbefore {>>abc<<} after\n\ntail\n'
      const core = createDocumentCore()
      const opened = core.open(source)
      const comment = opened.annotations[0]
      if (comment?.kind !== 'comment') throw new Error('Expected Comment')
      const payload = comment.arms[0]?.range
      if (payload === undefined) throw new Error('Expected payload')
      const at = payload[boundary]
      const commit = core.apply(opened, [{ start: at, end: at, insert: 'X' }], {
        projections: [{ name: 'comment', annotationRange: comment.range }]
      })
      const change = commit.change.projections[0]
      if (change?.name !== 'comment' || change.scope !== 'regions') {
        throw new Error('Expected regional Comment change')
      }
      expect(change.replacements[0]?.next.payload).toEqual({
        start: payload.start,
        end: payload.end + 1
      })
      const freshCore = createDocumentCore()
      const fresh = freshCore.open(
        source.slice(0, at) + 'X' + source.slice(at)
      )
      const freshComment = fresh.annotations[0]
      if (freshComment?.kind !== 'comment') throw new Error('Expected Comment')
      expect(change.replacements[0]?.markdown)
        .toBe(freshCore.projectComment(fresh, freshComment).markdown)
    }
  )

  it('falls back explicitly when an empty Comment gains content', () => {
    const source = 'head\n\nbefore {>><<} after\n\ntail\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const comment = opened.annotations[0]
    if (comment?.kind !== 'comment') throw new Error('Expected Comment')
    const at = comment.arms[0]?.range.start
    if (at === undefined) throw new Error('Expected payload')
    const commit = core.apply(opened, [{ start: at, end: at, insert: 'X' }], {
      projections: ['markup', {
        name: 'comment',
        annotationRange: comment.range
      }]
    })
    expect(commit.change.projections).toEqual([{
      name: 'markup',
      scope: 'document',
      reason: 'structural-region-ineligible'
    }, {
      name: 'comment',
      scope: 'document',
      targets: [comment.range],
      reason: 'structural-region-ineligible'
    }])
  })

  it.each([
    {
      name: 'front matter',
      payload: '---\ntitle: old\n---\n\nbody\n',
      needle: 'old',
      insert: 'new',
      options: {},
      expectedKind: 'front-matter'
    },
    {
      name: 'local reference and footnote definitions',
      payload: 'Inside [x][r] and note[^n].\n\n[r]: /local\n\n[^n]: local\n',
      needle: 'Inside',
      insert: 'Within',
      options: { footnotes: true },
      expectedKind: 'footnote-definition'
    },
    {
      name: 'generated unresolved-reference guards',
      payload: '{++[r]: /inner\n++}\n\nedit word [x][r]\n',
      needle: 'word',
      insert: 'WORDS',
      options: {},
      expectedKind: 'paragraph'
    },
    {
      name: 'literal Markdown and nested CriticMarkup',
      payload: '```md\n{++literal++}\n```\n\nedit {++nested text++}\n',
      needle: 'text',
      insert: 'TEXTS',
      options: {},
      expectedKind: 'code-block'
    },
    {
      name: 'nested Comment elision',
      payload: 'outer before {>>nested word<<} after\n',
      needle: 'word',
      insert: 'WORDS',
      options: {},
      expectedKind: 'paragraph'
    }
  ])('keeps $name local to a regional Comment projection', testCase => {
    const source =
      `head\n\nbefore {>>${testCase.payload}<<} after\n\ntail\n`
    const at = source.indexOf(testCase.needle)
    const nextSource = source.slice(0, at) + testCase.insert +
      source.slice(at + testCase.needle.length)
    const core = createDocumentCore()
    const opened = core.open(source, testCase.options)
    const comment = opened.annotations[0]
    if (comment?.kind !== 'comment') throw new Error('Expected Comment')
    const commit = core.apply(opened, [{
      start: at,
      end: at + testCase.needle.length,
      insert: testCase.insert
    }], {
      projections: [{ name: 'comment', annotationRange: comment.range }]
    })
    const change = commit.change.projections[0]
    if (change?.name !== 'comment' || change.scope !== 'regions') {
      throw new Error(`Expected regional Comment for ${testCase.name}`)
    }
    const replacement = change.replacements[0]
    if (replacement === undefined) throw new Error('Expected replacement')
    const freshCore = createDocumentCore()
    const fresh = freshCore.open(nextSource, testCase.options)
    const freshComment = fresh.annotations[0]
    if (freshComment?.kind !== 'comment') throw new Error('Expected Comment')
    const freshProjection = freshCore.projectComment(fresh, freshComment)
    expect(replacement.markdown).toBe(freshProjection.markdown)
    expect(replacement.ast).toEqual(freshProjection.ast)
    expect(replacement.annotation)
      .toEqual(annotationSnapshotForOracle(freshComment))
    expectCommentCoordinatesEqual(freshProjection, replacement.coordinates)
    const pending = [replacement.ast.root]
    const kinds: string[] = []
    while (pending.length > 0) {
      const node = pending.pop()
      if (node === undefined) break
      kinds.push(node.kind)
      for (const child of node.children) pending.push(child)
    }
    expect(kinds).toContain(testCase.expectedKind)
    if (testCase.name.startsWith('generated')) {
      expect(replacement.coordinates.some(segment =>
        segment.kind === 'generated'
      )).toBe(true)
      const regionalComment = commit.revision.annotations[0]
      if (regionalComment?.kind !== 'comment') {
        throw new Error('Expected regional Comment')
      }
      const beforeProjection = inspectionOf(core)
      const regionalProjection = core.projectComment(
        commit.revision,
        regionalComment
      )
      const afterProjection = inspectionOf(core)
      expect(afterProjection.documentParses).toBe(beforeProjection.documentParses)
      expect(afterProjection.sourceMaterializations)
        .toBe(beforeProjection.sourceMaterializations)
      for (let offset = 0; offset < regionalProjection.markdown.length; offset += 1) {
        expect(regionalProjection.coordinates.originAt(offset))
          .toEqual(freshProjection.coordinates.originAt(offset))
      }
      for (
        let projected = 0;
        projected <= regionalProjection.markdown.length;
        projected += 1
      ) {
        for (const affinity of ['previous', 'next'] as const) {
          expect(regionalProjection.coordinates.toSource(projected, affinity))
            .toBe(freshProjection.coordinates.toSource(projected, affinity))
        }
      }
      for (let sourcePosition = 0; sourcePosition <= nextSource.length; sourcePosition += 1) {
        for (const affinity of ['previous', 'next'] as const) {
          expect(regionalProjection.coordinates.toProjected(
            sourcePosition,
            affinity
          )).toBe(freshProjection.coordinates.toProjected(sourcePosition, affinity))
        }
      }
      for (let start = 0; start <= nextSource.length; start += 1) {
        const end = Math.min(nextSource.length, start + 3)
        expect(regionalProjection.coordinates.intersectsSource({ start, end }))
          .toBe(freshProjection.coordinates.intersectsSource({ start, end }))
      }
    }
    if (testCase.name.startsWith('nested Comment')) {
      const nested = freshComment.arms[0]?.annotations[0]
      if (nested?.kind !== 'comment') throw new Error('Expected nested Comment')
      expect(freshCore.projectComment(fresh, nested).markdown)
        .toBe('nested WORDS')
    }
  })

  it('uses explicit Comment fallbacks for marker edits and option changes', () => {
    const source = 'head\n\nbefore {>>edit word<<} after\n\ntail\n'
    for (const testCase of [
      {
        name: 'marker',
        edit: {
          start: source.indexOf('<<}'),
          end: source.indexOf('<<}') + 1,
          insert: '['
        },
        markdown: undefined,
        reason: 'structural-region-ineligible'
      },
      {
        name: 'options',
        edit: {
          start: source.indexOf('word'),
          end: source.indexOf('word') + 4,
          insert: 'WORDS'
        },
        markdown: { gfm: false },
        reason: 'markdown-options-changed'
      }
    ] as const) {
      const core = createDocumentCore()
      const opened = core.open(source)
      const comment = opened.annotations[0]
      if (comment?.kind !== 'comment') throw new Error('Expected Comment')
      const commit = core.apply(opened, [testCase.edit], {
        ...(testCase.markdown === undefined
          ? {}
          : { markdown: testCase.markdown }),
        projections: ['markup', {
          name: 'comment',
          annotationRange: comment.range
        }]
      })
      expect(commit.change.projections).toEqual([{
        name: 'markup',
        scope: 'document',
        reason: testCase.reason
      }, {
        name: 'comment',
        scope: 'document',
        targets: [comment.range],
        reason: testCase.reason
      }])
    }
  })

  it.each([
    {
      name: 'Addition siblings become nested',
      previous: '{++a++}{++b++}',
      next: '{++a{++b++}++}'
    },
    {
      name: 'nested Additions become siblings',
      previous: '{++a{++b++}++}',
      next: '{++a++}{++b++}'
    },
    {
      name: 'mixed siblings become nested',
      previous: '{++a++}{--b--}',
      next: '{++a{--b--}++}'
    },
    {
      name: 'Comment siblings become nested',
      previous: '{>>a<<}{>>b<<}',
      next: '{>>a{>>b<<}<<}'
    }
  ])('falls back when nested topology changes: $name', testCase => {
    const source =
      `head\n\nbefore {>>a ${testCase.previous} z<<} after\n\ntail\n`
    const at = source.indexOf(testCase.previous)
    const core = createDocumentCore()
    const opened = core.open(source)
    const comment = opened.annotations[0]
    if (comment?.kind !== 'comment') throw new Error('Expected Comment')
    const commit = core.apply(opened, [{
      start: at,
      end: at + testCase.previous.length,
      insert: testCase.next
    }], {
      projections: ['markup', {
        name: 'comment',
        annotationRange: comment.range
      }]
    })
    expect(commit.change.projections).toEqual([{
      name: 'markup',
      scope: 'document',
      reason: 'structural-region-ineligible'
    }, {
      name: 'comment',
      scope: 'document',
      targets: [comment.range],
      reason: 'structural-region-ineligible'
    }])
  })

  it('allows payload punctuation adjacent to a nested marker', () => {
    const source =
      'head\n\nbefore {>>outer {++a++} text<<} after\n\ntail\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const comment = opened.annotations[0]
    if (comment?.kind !== 'comment') throw new Error('Expected Comment')
    const at = source.indexOf('{++') + 3
    const commit = core.apply(opened, [{ start: at, end: at, insert: '+' }], {
      projections: [{ name: 'comment', annotationRange: comment.range }]
    })
    expect(commit.change.projections[0]).toMatchObject({
      name: 'comment',
      scope: 'regions'
    })
  })

  it('rebases a fragmented Comment through an explicit document fallback', () => {
    const payload = 'A'.repeat(262_144)
    const source = `head\n\n{>>${payload}<<}\n\ntail\n`
    const core = createDocumentCore()
    const opened = core.open(source)
    const comment = opened.annotations[0]
    if (comment?.kind !== 'comment') throw new Error('Expected Comment')
    const payloadStart = comment.arms[0]?.range.start
    if (payloadStart === undefined) throw new Error('Expected payload')
    const before = inspectionOf(core)
    const commit = core.apply(opened, [{
      start: payloadStart + 1,
      end: payloadStart + payload.length,
      insert: ''
    }], {
      projections: ['markup', {
        name: 'comment',
        annotationRange: comment.range
      }]
    })
    const after = inspectionOf(core)
    expect(commit.change.projections).toEqual([{
      name: 'markup',
      scope: 'document',
      reason: 'source-fragmentation-rebase'
    }, {
      name: 'comment',
      scope: 'document',
      targets: [comment.range],
      reason: 'source-fragmentation-rebase'
    }])
    expect(delta(after, before, 'sourceRebaseMaterializations')).toBe(1)
    expect(delta(after, before, 'sourceRopeRootsCommitted')).toBe(1)
  })

  it('rebases bounded Comment resource failures and preserves the regional head', () => {
    const source =
      'head\n\nbefore {>>edit word<<} after\n\ntail\n\n' +
      'suffix\n\n'.repeat(20)
    const firstAt = source.indexOf('word')
    const afterFirstSource = source.slice(0, firstAt) + 'WORDS' +
      source.slice(firstAt + 4)
    const core = createDocumentCore()
    const opened = core.open(source)
    const openedComment = opened.annotations[0]
    if (openedComment?.kind !== 'comment') throw new Error('Expected Comment')
    const first = core.apply(opened, [{
      start: firstAt,
      end: firstAt + 4,
      insert: 'WORDS'
    }], {
      projections: [{
        name: 'comment',
        annotationRange: openedComment.range
      }]
    })
    const firstComment = first.revision.annotations[0]
    if (firstComment?.kind !== 'comment') throw new Error('Expected Comment')
    const resourceAt = afterFirstSource.indexOf('edit') + 2
    const resourceEdit = {
      start: resourceAt,
      end: resourceAt,
      insert: '{++ '.repeat(1_025)
    }
    const fullCore = createDocumentCore()
    const fullOpened = fullCore.open(afterFirstSource)
    let fullError: DocumentCoreError | undefined
    try {
      fullCore.apply(fullOpened, [resourceEdit])
    } catch (error) {
      fullError = error as DocumentCoreError
    }
    expect(fullError).toBeDefined()
    const beforeFailure = inspectionOf(core)
    let regionalError: DocumentCoreError | undefined
    try {
      core.apply(first.revision, [resourceEdit], {
        projections: [{
          name: 'comment',
          annotationRange: firstComment.range
        }]
      })
    } catch (error) {
      regionalError = error as DocumentCoreError
    }
    const afterFailure = inspectionOf(core)
    expect(regionalError).toMatchObject({
      code: fullError?.code,
      range: fullError?.range,
      metadata: fullError?.metadata
    })
    expect(afterFailure.documentParses).toBe(beforeFailure.documentParses)
    expect(afterFailure.sourceMaterializations)
      .toBe(beforeFailure.sourceMaterializations)
    expect(afterFailure.sourceRopeRootsCommitted)
      .toBe(beforeFailure.sourceRopeRootsCommitted)
    expect(afterFailure.regionalFastApplies)
      .toBe(beforeFailure.regionalFastApplies)

    const next = core.apply(first.revision, [{
      start: afterFirstSource.indexOf('edit'),
      end: afterFirstSource.indexOf('edit') + 4,
      insert: 'EDIT'
    }], {
      projections: [{
        name: 'comment',
        annotationRange: firstComment.range
      }]
    })
    expect(next.change.projections[0]).toMatchObject({
      name: 'comment',
      scope: 'regions'
    })
  })

  it('chains Comment deltas and keeps historical projections locally cached', () => {
    const source = 'head\n\nbefore {>>edit word<<} after\n\ntail\n'
    const firstAt = source.indexOf('word')
    const afterFirst = source.slice(0, firstAt) + 'WORDS' +
      source.slice(firstAt + 4)
    const secondAt = afterFirst.indexOf('edit')
    const afterSecond = afterFirst.slice(0, secondAt) + 'EDITED' +
      afterFirst.slice(secondAt + 4)
    const core = createDocumentCore()
    const opened = core.open(source)
    const openedComment = opened.annotations[0]
    if (openedComment?.kind !== 'comment') throw new Error('Expected Comment')
    const before = inspectionOf(core)
    const first = core.apply(opened, [{
      start: firstAt,
      end: firstAt + 4,
      insert: 'WORDS'
    }], {
      projections: [{
        name: 'comment',
        annotationRange: openedComment.range
      }]
    })
    const firstComment = first.revision.annotations[0]
    if (firstComment?.kind !== 'comment') throw new Error('Expected Comment')
    const second = core.apply(first.revision, [{
      start: secondAt,
      end: secondAt + 4,
      insert: 'EDITED'
    }], {
      projections: ['markup', {
        name: 'comment',
        annotationRange: firstComment.range
      }]
    })
    const secondComment = second.revision.annotations[0]
    if (secondComment?.kind !== 'comment') throw new Error('Expected Comment')
    const afterApplies = inspectionOf(core)
    const historical = core.projectComment(first.revision, firstComment)
    const current = core.projectComment(second.revision, secondComment)
    const afterProjections = inspectionOf(core)
    expect(historical.markdown).toBe('edit WORDS')
    expect(current.markdown).toBe('EDITED WORDS')
    expect(delta(afterApplies, before, 'regionalFastApplies')).toBe(2)
    expect(delta(afterApplies, before, 'documentParses')).toBe(0)
    expect(delta(afterApplies, before, 'sourceMaterializations')).toBe(0)
    expect(afterProjections.documentParses).toBe(afterApplies.documentParses)
    expect(afterProjections.sourceMaterializations)
      .toBe(afterApplies.sourceMaterializations)

    const freshCore = createDocumentCore()
    const fresh = freshCore.open(afterSecond)
    const freshComment = fresh.annotations[0]
    if (freshComment?.kind !== 'comment') throw new Error('Expected Comment')
    expect(current.ast)
      .toEqual(freshCore.projectComment(fresh, freshComment).ast)
  })

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
    if (change?.name !== 'markup' || change.scope !== 'regions') {
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
    if (change?.name !== 'markup' || change.scope !== 'regions') {
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
    if (firstChange?.name !== 'markup' || firstChange.scope !== 'regions') {
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
    if (secondChange?.name !== 'markup' || secondChange.scope !== 'regions') {
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
    if (firstChange?.name !== 'markup' || firstChange.scope !== 'regions') {
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
    if (secondChange?.name !== 'markup' || secondChange.scope !== 'regions') {
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
    if (thirdChange?.name !== 'markup' || thirdChange.scope !== 'regions') {
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
    if (change?.name !== 'markup' || change.scope !== 'regions') {
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
    const core = createUnboundedDocumentCoreForInspection()
    const opened = core.open(source)
    const previousMarkup = core.project(opened, 'markup')
    const before = inspectionOf(core)

    const commit = core.apply(opened, [{
      start: insertAt,
      end: insertAt,
      insert: 'X'
    }], { projections: ['markup'] })
    const after = inspectionOf(core)
    const changes = commit.change.projections

    expect(commit.revision.source).toBe(nextSource)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ name: 'markup', scope: 'regions' })
    const change = changes[0]
    if (change?.name !== 'markup' || change.scope !== 'regions') {
      throw new Error('Expected regional change')
    }
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
        attributes: { semanticText: 'target woXrd' },
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
    const fullCore = createUnboundedDocumentCoreForInspection()
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

  it('keeps an edit after unchanged global reference facts regional', () => {
    const source =
      'head [ref]\n\n' +
      '[ref]: /url\n\n' +
      'target word\n\n' +
      'tail\n\n'
    const insertAt = source.indexOf('word') + 2
    const edit = { start: insertAt, end: insertAt, insert: 'X' }
    const nextSource = applyExactSourceEdits(
      source,
      [edit],
      'global reference dependency oracle'
    )
    const core = createDocumentCore()
    const opened = core.open(source)
    const previousMarkup = core.project(opened, 'markup')
    const before = inspectionOf(core)

    const commit = core.apply(opened, [edit], { projections: ['markup'] })
    const after = inspectionOf(core)
    const change = commit.change.projections[0]
    if (change?.name !== 'markup' || change.scope !== 'regions') {
      throw new Error('Expected reference-independent regional change')
    }
    expect(change.replacements).toHaveLength(1)
    const replacement = change.replacements[0]
    if (replacement === undefined) throw new Error('Expected Markup replacement')

    const freshCore = createDocumentCore()
    const fresh = freshCore.open(nextSource)
    const freshMarkup = freshCore.project(fresh, 'markup')
    const nextEvents = applyMarkupReplacement(previousMarkup.events, replacement)
    expect(nextEvents).toEqual(freshMarkup.events)
    expect(applySyntaxReplacementForOracle(
      previousMarkup.syntax.ast.root,
      replacement
    )).toEqual(freshMarkup.syntax.ast.root)
    expect(core.project(opened, 'markup')).toEqual(previousMarkup)
    expect(previousMarkup.events.flatMap(event =>
      event.kind === 'text' ? [event.text] : []).join('')).toBe(source)
    expect(nextEvents.flatMap(event =>
      event.kind === 'text' ? [event.text] : []).join('')).toBe(nextSource)
    expect(opened.sourceLength).toBe(source.length)
    expect(commit.revision.sourceLength).toBe(nextSource.length)
    const afterHistoryRead = inspectionOf(core)
    expect(delta(after, before, 'documentParses')).toBe(0)
    expect(delta(after, before, 'documentParseSourceUnits')).toBe(0)
    expect(delta(after, before, 'documentProjectionPreparationUnits')).toBe(0)
    expect(delta(after, before, 'sourceMaterializations')).toBe(0)
    expect(delta(after, before, 'sourceMaterializationOutputUnits')).toBe(0)
    expect(delta(after, before, 'regionalFastApplies')).toBe(1)
    expect(delta(afterHistoryRead, before, 'documentParses')).toBe(0)
    expect(delta(afterHistoryRead, before, 'sourceMaterializations')).toBe(0)
    assertPortable(commit.change)
  })

  it('invalidates when a candidate introduces a global reference definition', () => {
    const source =
      'head [ref]\n\n' +
      '[ref]: /url\n\n' +
      'target word\n\n' +
      'tail\n\n'
    const start = source.indexOf('target')
    const edit = {
      start,
      end: start + 'target word'.length,
      insert: '[new]: /new'
    }
    const nextSource = applyExactSourceEdits(
      source,
      [edit],
      'introduced reference definition oracle'
    )
    const core = createDocumentCore()
    const opened = core.open(source)

    const commit = core.apply(opened, [edit], { projections: ['markup'] })

    expect(commit.change.projections).toEqual([{
      name: 'markup',
      scope: 'document',
      reason: 'definition-or-reference-facts'
    }])
    const freshCore = createDocumentCore()
    const fresh = freshCore.open(nextSource)
    const projection = core.project(commit.revision, 'markup')
    const freshProjection = freshCore.project(fresh, 'markup')
    expect(projection.events).toEqual(freshProjection.events)
    expect(projection.syntax.ast).toEqual(freshProjection.syntax.ast)

    const sourceOnlyCore = createDocumentCore()
    const sourceOnlyOpened = sourceOnlyCore.open(source)
    const beforeSourceOnly = inspectionOf(sourceOnlyCore)
    const sourceOnlyCommit = sourceOnlyCore.apply(sourceOnlyOpened, [edit], {
      projections: []
    })
    const afterSourceOnly = inspectionOf(sourceOnlyCore)
    expect(sourceOnlyCommit.change.projections).toEqual([])
    expect(delta(
      afterSourceOnly,
      beforeSourceOnly,
      'regionalFastApplies'
    )).toBe(0)
    expect(delta(afterSourceOnly, beforeSourceOnly, 'documentParses')).toBe(1)
    expect(sourceOnlyCore.project(sourceOnlyCommit.revision, 'markup').syntax.ast)
      .toEqual(freshProjection.syntax.ast)
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

  it('rejects malformed projection requests before source work', () => {
    const source = 'head\n\ntarget word\n\ntail\n\n'
    const core = createDocumentCore()
    const opened = core.open(source)
    const at = source.indexOf('word')
    const before = inspectionOf(core)
    for (const projections of [
      ['revised'],
      [null],
      [{ name: 'comment', annotationRange: { start: -1, end: 2 } }],
      [{ name: 'comment', annotationRange: { start: 3, end: 2 } }],
      [{ name: 'comment', annotationRange: { start: 1.5, end: 2 } }]
    ]) {
      expect(() => core.apply(opened, [
        { start: at, end: at, insert: 'X' }
      ], { projections } as never)).toThrow(/projection request/)
    }
    const after = inspectionOf(core)
    expect(after.sourceRopeRootsAttempted).toBe(before.sourceRopeRootsAttempted)
    expect(after.sourceRopeRootsCommitted).toBe(before.sourceRopeRootsCommitted)
    expect(after.sourceSliceCalls).toBe(before.sourceSliceCalls)
    expect(after.sourceMaterializations).toBe(before.sourceMaterializations)
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
      const core = createUnboundedDocumentCoreForInspection()
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
    const core = createUnboundedDocumentCoreForInspection()
    const opened = core.open('x\n\n'.repeat(paragraphCount))

    const projection = core.project(opened, 'markup')

    expect(projection.syntax.ast.root.children).toHaveLength(paragraphCount)
  }, 15_000)

  it('keeps canonical source persistent across 100 regional edits', () => {
    const suffix = Array.from(
      { length: 10_000 },
      (_, index) => `suffix ${String(index)}\n\n`
    ).join('')
    let expectedSource = `head\n\ntarget word\n\n${suffix}`
    const core = createUnboundedDocumentCoreForInspection()
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
      if (projection?.name !== 'markup' || projection.scope !== 'regions') {
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
    const freshCore = createUnboundedDocumentCoreForInspection()
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

  it('rebases once when barrier-free source pieces exceed policy', () => {
    const source = 'head\n\ntarget word\n\ntail\n\n'
    const editAt = source.indexOf('word') + 1
    const maximumPieces = 256
    const core = createDocumentCore()
    const opened = core.open(source)
    const before = inspectionOf(core)
    let revision = opened
    let expected = source
    let historical = opened
    let historicalExpected = source

    expect(DOCUMENT_RESOURCE_POLICY_V1.maximumSourceRopePieces)
      .toBe(maximumPieces)
    for (let ordinal = 0; ordinal < maximumPieces - 2; ordinal += 1) {
      const commit = core.apply(revision, [{
        start: editAt,
        end: editAt,
        insert: 'X'
      }], { projections: ['markup'] })
      expect(commit.change.projections[0]?.scope).toBe('regions')
      revision = commit.revision
      expected = expected.slice(0, editAt) + 'X' + expected.slice(editAt)
      if (ordinal === Math.floor(maximumPieces / 2)) {
        historical = revision
        historicalExpected = expected
      }
    }

    const atBoundary = inspectionOf(core)
    expect(atBoundary.sourceRopeCurrentPieces).toBe(maximumPieces)
    expect(delta(atBoundary, before, 'sourceMaterializations')).toBe(0)
    const preBoundary = revision
    const preBoundaryExpected = expected
    const commit = core.apply(revision, [{
      start: editAt,
      end: editAt,
      insert: 'Y'
    }], { projections: ['markup'] })
    expected = expected.slice(0, editAt) + 'Y' + expected.slice(editAt)
    const after = inspectionOf(core)

    expect(commit.change.projections).toEqual([{
      name: 'markup',
      scope: 'document',
      reason: 'source-fragmentation-rebase'
    }])
    expect(delta(after, atBoundary, 'sourceRebaseMaterializations')).toBe(1)
    expect(delta(after, atBoundary, 'sourceRebases')).toBe(1)
    expect(delta(after, atBoundary, 'sourceRopeRootsAttempted')).toBe(1)
    expect(delta(after, atBoundary, 'sourceRopeRootsCommitted')).toBe(1)
    expect(delta(after, atBoundary, 'documentParses')).toBe(1)
    expect(delta(after, atBoundary, 'regionalFastApplies')).toBe(0)
    expect(after.sourceRopeCurrentPieces).toBe(1)
    expect(commit.revision.sourceLength).toBe(expected.length)
    expect(opened.source).toBe(source)
    expect(historical.source).toBe(historicalExpected)
    expect(preBoundary.source).toBe(preBoundaryExpected)
    expect(commit.revision.source).toBe(expected)

    const continued = core.apply(commit.revision, [{
      start: editAt + 1,
      end: editAt + 1,
      insert: 'Z'
    }], { projections: ['markup'] })
    expected = expected.slice(0, editAt + 1) +
      'Z' + expected.slice(editAt + 1)
    const afterContinuation = inspectionOf(core)
    expect(continued.change.projections[0]?.scope).toBe('regions')
    expect(continued.revision.source).toBe(expected)
    expect(delta(afterContinuation, atBoundary, 'sourceRebases')).toBe(1)
    expect(afterContinuation.sourceRopeCurrentPieces)
      .toBeLessThanOrEqual(maximumPieces)

    const historicalCore = createDocumentCore()
    const historicalFresh = historicalCore.open(historicalExpected)
    expect(core.project(historical, 'markup').events)
      .toEqual(historicalCore.project(historicalFresh, 'markup').events)
    const currentCore = createDocumentCore()
    const currentFresh = currentCore.open(expected)
    expect(core.project(continued.revision, 'markup').events)
      .toEqual(currentCore.project(currentFresh, 'markup').events)
  })

  it('retains 64 historical overlay roots over 100k regions', () => {
    const source = `first\n\n${'p\n\n'.repeat(49_999)}target word\n\n${
      'p\n\n'.repeat(49_999)
    }last\n\n`
    const core = createUnboundedDocumentCoreForInspection()
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
    const core = createUnboundedDocumentCoreForInspection()
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
    if (secondChange?.name !== 'markup' || secondChange.scope !== 'regions') {
      throw new Error('Expected region')
    }
    expect(secondChange.replacements[0]?.previous.source.start)
      .toBeGreaterThan(1_000)

    const freshCore = createUnboundedDocumentCoreForInspection()
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
    if (
      insertionChange?.name !== 'markup' ||
      insertionChange.scope !== 'regions'
    ) {
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
    }], { projections: ['markup'] }))
      .toThrow(/CM_RESOURCE_LOGICAL_NODES_EXCEEDED/)
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
    {
      name: 'CM facts without an eligible index',
      source: 'head {++added++}\n\ntarget word\n\ntail\n\n',
      buildsDependencyIndex: false
    },
    {
      name: 'an invalidated definition dependency index',
      source: 'head [ref]\n\ntarget word\n\n[ref]: /url\n',
      buildsDependencyIndex: true
    }
  ])('never mutates the retained overlay for $name', ({
    source,
    buildsDependencyIndex
  }) => {
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
    if (buildsDependencyIndex) {
      expect(before.retainedInitialBuildUnits).toBeGreaterThan(0)
    } else {
      expect(before.retainedInitialBuildUnits).toBe(0)
    }
    expect(delta(after, before, 'retainedOverlayNodesAllocated')).toBe(0)
    expect(delta(after, before, 'retainedCommittedUpdates')).toBe(0)
    expect(delta(after, before, 'sourceFallbackMaterializations')).toBe(1)
    expect(delta(after, before, 'sourceMaterializations')).toBe(1)
  })
})
