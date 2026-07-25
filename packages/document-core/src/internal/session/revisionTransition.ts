import type { RevisionId } from '../../documentSession.js'
import type { CompleteDocumentRevision, CriticMarkupForest, CriticMarkupNode, SourceRange } from '../../revision.js'
import { applySourceEdit, type SourceEdit } from './sourceTransaction.js'

function forestRoots(forest: CriticMarkupForest): readonly CriticMarkupNode[] {
  return Array.from({ length: forest.rootCount }, (_, ordinal) =>
    forest.rootAt(ordinal))
}

export type MapDirection = 'forward' | 'backward'
export type Affinity = 'previous' | 'next'

export interface AffineSourcePosition {
  readonly offset: number
  readonly affinity: Affinity
}

export interface AffineSourceRange {
  readonly start: AffineSourcePosition
  readonly end: AffineSourcePosition
}

interface ContinuousRangeMapping {
  readonly kind: 'unchanged' | 'changed'
  readonly range: AffineSourceRange
}

interface SplitRangeMapping {
  readonly kind: 'split'
  readonly ranges: readonly AffineSourceRange[]
}

interface DeletedRangeMapping {
  readonly kind: 'deleted'
  readonly position: AffineSourcePosition
}

export type RangeMapping = ContinuousRangeMapping | SplitRangeMapping | DeletedRangeMapping

export interface ChangeMap {
  readonly mapPosition: (
    direction: MapDirection,
    position: AffineSourcePosition
  ) => AffineSourcePosition
  readonly mapRange: (direction: MapDirection, range: AffineSourceRange) => RangeMapping
}

export interface NodeSurvivalMap {
  readonly map: (direction: MapDirection, node: CriticMarkupNode) => CriticMarkupNode | null
}

export interface RevisionTransition {
  readonly base: RevisionId
  readonly next: RevisionId
  readonly edits: readonly SourceEdit[]
  readonly inverseEdits: readonly SourceEdit[]
  readonly canonicalMap: ChangeMap
  readonly nodeSurvival: NodeSurvivalMap
  readonly invert: () => RevisionTransition
  readonly compose: (next: RevisionTransition) => RevisionTransition
}

interface NodePairMaps {
  readonly forward: ReadonlyMap<CriticMarkupNode, CriticMarkupNode>
  readonly backward: ReadonlyMap<CriticMarkupNode, CriticMarkupNode>
}

interface NodeRecord {
  readonly node: CriticMarkupNode
  readonly parent: CriticMarkupNode | null
  readonly arm: CriticMarkupNode['arms'][number]['name'] | null
}

interface AtomicTransitionStep {
  readonly base: RevisionId
  readonly next: RevisionId
  readonly baseRevision: CompleteDocumentRevision
  readonly nextRevision: CompleteDocumentRevision
  readonly edit: SourceEdit
  readonly inverse: SourceEdit
  readonly nodes: NodePairMaps
}

interface TransitionInternals {
  readonly baseRevision: CompleteDocumentRevision
  readonly nextRevision: CompleteDocumentRevision
  readonly steps: readonly AtomicTransitionStep[]
}

const transitionInternals = new WeakMap<RevisionTransition, TransitionInternals>()

function requiredAt<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) {
    throw new Error('Internal transition collection invariant failed')
  }
  return item
}

function takeLast<T>(items: T[]): T {
  const item = items.pop()
  if (item === undefined) {
    throw new Error('Internal transition stack invariant failed')
  }
  return item
}

function freezePosition(position: AffineSourcePosition): AffineSourcePosition {
  return Object.freeze({ offset: position.offset, affinity: position.affinity })
}

function freezeRange(range: AffineSourceRange): AffineSourceRange {
  return Object.freeze({
    start: freezePosition(range.start),
    end: freezePosition(range.end)
  })
}

function assertPosition(position: AffineSourcePosition, sourceLength: number): void {
  if (!Number.isInteger(position.offset) || position.offset < 0 || position.offset > sourceLength) {
    throw new RangeError('Canonical position is outside the revision')
  }
  if (position.affinity !== 'previous' && position.affinity !== 'next') {
    throw new TypeError('Canonical position has an invalid affinity')
  }
}

function assertRange(range: AffineSourceRange, sourceLength: number): void {
  assertPosition(range.start, sourceLength)
  assertPosition(range.end, sourceLength)
  if (range.end.offset < range.start.offset) {
    throw new RangeError('Canonical range is reversed')
  }
}

function mapPositionAcrossEdit(
  edit: SourceEdit,
  position: AffineSourcePosition
): AffineSourcePosition {
  if (position.offset < edit.start) {
    return freezePosition(position)
  }

  const delta = edit.insert.length - (edit.end - edit.start)
  if (position.offset > edit.end) {
    return freezePosition({
      offset: position.offset + delta,
      affinity: position.affinity
    })
  }

  return freezePosition({
    offset: position.affinity === 'previous' ? edit.start : edit.start + edit.insert.length,
    affinity: position.affinity
  })
}

function insertionTouchesRange(edit: SourceEdit, range: AffineSourceRange): boolean {
  const insertion = edit.start
  const beforeRange =
    insertion < range.start.offset ||
    (insertion === range.start.offset && range.start.affinity === 'next')
  const afterRange =
    insertion > range.end.offset ||
    (insertion === range.end.offset && range.end.affinity === 'previous')
  return !beforeRange && !afterRange
}

function editTouchesRange(edit: SourceEdit, range: AffineSourceRange): boolean {
  if (edit.start === edit.end) {
    return insertionTouchesRange(edit, range)
  }
  return edit.start < range.end.offset && edit.end > range.start.offset
}

function mapPositionThroughSteps(
  steps: readonly AtomicTransitionStep[],
  direction: MapDirection,
  position: AffineSourcePosition
): AffineSourcePosition {
  let mapped = freezePosition(position)
  if (direction === 'forward') {
    for (const step of steps) {
      assertPosition(mapped, step.baseRevision.source.text.length)
      mapped = mapPositionAcrossEdit(step.edit, mapped)
    }
    return mapped
  }

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = requiredAt(steps, index)
    assertPosition(mapped, step.nextRevision.source.text.length)
    mapped = mapPositionAcrossEdit(step.inverse, mapped)
  }
  return mapped
}

function mapRangeThroughSteps(
  steps: readonly AtomicTransitionStep[],
  direction: MapDirection,
  range: AffineSourceRange,
  inputSource: string,
  outputSource: string
): RangeMapping {
  assertRange(range, inputSource.length)
  if (steps.length === 1) {
    const step = requiredAt(steps, 0)
    const edit = direction === 'forward' ? step.edit : step.inverse
    if (
      edit.start === edit.end &&
      edit.start > range.start.offset &&
      edit.start < range.end.offset
    ) {
      const left = freezeRange({
        start: mapPositionAcrossEdit(edit, range.start),
        end: mapPositionAcrossEdit(edit, {
          offset: edit.start,
          affinity: 'previous'
        })
      })
      const right = freezeRange({
        start: mapPositionAcrossEdit(edit, {
          offset: edit.start,
          affinity: 'next'
        }),
        end: mapPositionAcrossEdit(edit, range.end)
      })
      return Object.freeze({
        kind: 'split' as const,
        ranges: Object.freeze([left, right])
      })
    }
  }
  let mapped = freezeRange(range)
  let changed = false

  if (direction === 'forward') {
    for (const step of steps) {
      changed ||= editTouchesRange(step.edit, mapped)
      mapped = freezeRange({
        start: mapPositionAcrossEdit(step.edit, mapped.start),
        end: mapPositionAcrossEdit(step.edit, mapped.end)
      })
    }
  } else {
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      const step = requiredAt(steps, index)
      changed ||= editTouchesRange(step.inverse, mapped)
      mapped = freezeRange({
        start: mapPositionAcrossEdit(step.inverse, mapped.start),
        end: mapPositionAcrossEdit(step.inverse, mapped.end)
      })
    }
  }

  if (mapped.start.offset > mapped.end.offset) {
    mapped = freezeRange({
      start: {
        offset: mapped.end.offset,
        affinity: mapped.start.affinity
      },
      end: {
        offset: mapped.start.offset,
        affinity: mapped.end.affinity
      }
    })
  }

  if (range.start.offset !== range.end.offset && mapped.start.offset === mapped.end.offset) {
    return Object.freeze({ kind: 'deleted' as const, position: mapped.start })
  }

  const inputText = inputSource.slice(range.start.offset, range.end.offset)
  const outputText = outputSource.slice(mapped.start.offset, mapped.end.offset)
  return Object.freeze({
    kind: !changed && inputText === outputText ? ('unchanged' as const) : ('changed' as const),
    range: mapped
  })
}

function collectNodeRecords(roots: readonly CriticMarkupNode[]): readonly NodeRecord[] {
  const records: NodeRecord[] = []
  const stack: NodeRecord[] = roots
    .map((node) => Object.freeze({ node, parent: null, arm: null }))
    .reverse()
  while (stack.length > 0) {
    const record = takeLast(stack)
    const { node } = record
    records.push(record)
    for (let armIndex = node.arms.length - 1; armIndex >= 0; armIndex -= 1) {
      const arm = requiredAt<CriticMarkupNode['arms'][number]>(node.arms, armIndex)
      const { children } = arm
      for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) {
        stack.push(
          Object.freeze({
            node: requiredAt(children, childIndex),
            parent: node,
            arm: arm.name
          })
        )
      }
    }
  }
  return Object.freeze(records)
}

function relativeRange(range: SourceRange, origin: number): readonly [number, number] {
  return Object.freeze([range.start - origin, range.end - origin])
}

function markerShape(node: CriticMarkupNode, origin: number): readonly string[] {
  const shape = [
    `open:${relativeRange(node.markers.open, origin).join(':')}`,
    `close:${relativeRange(node.markers.close, origin).join(':')}`
  ]
  if ('separator' in node.markers) {
    shape.push(`separator:${relativeRange(node.markers.separator, origin).join(':')}`)
  }
  return Object.freeze(shape)
}

function structurallyEquivalent(base: CriticMarkupNode, next: CriticMarkupNode): boolean {
  const work: Array<readonly [CriticMarkupNode, CriticMarkupNode]> = [[base, next]]
  while (work.length > 0) {
    const [left, right] = takeLast(work)
    const leftOrigin = left.range.start
    const rightOrigin = right.range.start
    if (
      left.kind !== right.kind ||
      left.range.end - leftOrigin !== right.range.end - rightOrigin ||
      markerShape(left, leftOrigin).join('|') !== markerShape(right, rightOrigin).join('|') ||
      left.arms.length !== right.arms.length
    ) {
      return false
    }

    for (let armIndex = 0; armIndex < left.arms.length; armIndex += 1) {
      const leftArm = requiredAt<CriticMarkupNode['arms'][number]>(left.arms, armIndex)
      const rightArm = requiredAt<CriticMarkupNode['arms'][number]>(right.arms, armIndex)
      if (
        leftArm.name !== rightArm.name ||
        relativeRange(leftArm.range, leftOrigin).join(':') !==
          relativeRange(rightArm.range, rightOrigin).join(':') ||
        leftArm.children.length !== rightArm.children.length
      ) {
        return false
      }
      for (let childIndex = 0; childIndex < leftArm.children.length; childIndex += 1) {
        work.push([
          requiredAt(leftArm.children, childIndex),
          requiredAt(rightArm.children, childIndex)
        ])
      }
    }
  }
  return true
}

function nodeKey(node: CriticMarkupNode): string {
  return `${node.kind}:${node.range.start}:${node.range.end}`
}

function buildNodePairMaps(
  baseRevision: CompleteDocumentRevision,
  nextRevision: CompleteDocumentRevision,
  edit: SourceEdit
): NodePairMaps {
  const forward = new Map<CriticMarkupNode, CriticMarkupNode>()
  const backward = new Map<CriticMarkupNode, CriticMarkupNode>()
  const nextByRange = new Map<string, NodeRecord[]>()
  for (const record of collectNodeRecords(forestRoots(nextRevision.criticMarkup))) {
    const key = nodeKey(record.node)
    const candidates = nextByRange.get(key)
    if (candidates === undefined) {
      nextByRange.set(key, [record])
    } else {
      candidates.push(record)
    }
  }

  for (const baseRecord of collectNodeRecords(forestRoots(baseRevision.criticMarkup))) {
    const { node: baseNode } = baseRecord
    const range: AffineSourceRange = {
      start: { offset: baseNode.range.start, affinity: 'next' },
      end: { offset: baseNode.range.end, affinity: 'previous' }
    }
    if (editTouchesRange(edit, range)) {
      continue
    }
    const mappedStart = mapPositionAcrossEdit(edit, range.start).offset
    const mappedEnd = mapPositionAcrossEdit(edit, range.end).offset
    const candidates = nextByRange.get(`${baseNode.kind}:${mappedStart}:${mappedEnd}`) ?? []
    const matches = candidates.filter(
      (candidateRecord) =>
        (baseRecord.parent === null
          ? candidateRecord.parent === null
          : forward.get(baseRecord.parent) === candidateRecord.parent &&
            baseRecord.arm === candidateRecord.arm) &&
        baseRevision.source.text.slice(baseNode.range.start, baseNode.range.end) ===
          nextRevision.source.text.slice(
            candidateRecord.node.range.start,
            candidateRecord.node.range.end
          ) &&
        structurallyEquivalent(baseNode, candidateRecord.node)
    )
    if (matches.length === 1) {
      const survivor = requiredAt(matches, 0).node
      forward.set(baseNode, survivor)
      backward.set(survivor, baseNode)
    }
  }

  return Object.freeze({ forward, backward })
}

interface ProvenanceUnit {
  readonly text: string
  readonly baseOffset: number | null
}

function initialProvenanceTape(source: string): readonly ProvenanceUnit[] {
  const tape: ProvenanceUnit[] = []
  for (let offset = 0; offset < source.length; offset += 1) {
    tape.push(Object.freeze({ text: source[offset] ?? '', baseOffset: offset }))
  }
  return tape
}

function applyEditToTape(
  tape: readonly ProvenanceUnit[],
  edit: SourceEdit
): readonly ProvenanceUnit[] {
  if (edit.start < 0 || edit.end < edit.start || edit.end > tape.length) {
    throw new Error('Transition edit is outside its provenance tape')
  }
  const next: ProvenanceUnit[] = []
  for (let offset = 0; offset < edit.start; offset += 1) {
    next.push(requiredAt(tape, offset))
  }
  for (let offset = 0; offset < edit.insert.length; offset += 1) {
    next.push(Object.freeze({ text: edit.insert[offset] ?? '', baseOffset: null }))
  }
  for (let offset = edit.end; offset < tape.length; offset += 1) {
    next.push(requiredAt(tape, offset))
  }
  return next
}

function deriveEditsFromTape(
  baseSource: string,
  tape: readonly ProvenanceUnit[]
): readonly SourceEdit[] {
  const edits: SourceEdit[] = []
  let baseCursor = 0
  let inserted = ''

  const appendEdit = (end: number): void => {
    if (end !== baseCursor || inserted.length > 0) {
      edits.push(Object.freeze({ start: baseCursor, end, insert: inserted }))
    }
    inserted = ''
  }

  for (const unit of tape) {
    if (unit.baseOffset === null) {
      inserted += unit.text
      continue
    }
    if (unit.baseOffset < baseCursor || unit.text !== (baseSource[unit.baseOffset] ?? '')) {
      throw new Error('Transition provenance is not monotonic canonical source')
    }
    appendEdit(unit.baseOffset)
    baseCursor = unit.baseOffset + 1
  }
  appendEdit(baseSource.length)
  return Object.freeze(edits)
}

function transitionEdits(
  baseRevision: CompleteDocumentRevision,
  nextRevision: CompleteDocumentRevision,
  steps: readonly AtomicTransitionStep[]
): readonly SourceEdit[] {
  if (baseRevision === nextRevision) {
    return Object.freeze([])
  }

  let tape = initialProvenanceTape(baseRevision.source.text)
  for (const step of steps) {
    tape = applyEditToTape(tape, step.edit)
  }
  if (tape.map((unit) => unit.text).join('') !== nextRevision.source.text) {
    throw new Error('Transition provenance does not reproduce its next revision')
  }
  return deriveEditsFromTape(baseRevision.source.text, tape)
}

function invertStep(step: AtomicTransitionStep): AtomicTransitionStep {
  return Object.freeze({
    base: step.next,
    next: step.base,
    baseRevision: step.nextRevision,
    nextRevision: step.baseRevision,
    edit: step.inverse,
    inverse: step.edit,
    nodes: Object.freeze({
      forward: step.nodes.backward,
      backward: step.nodes.forward
    })
  })
}

function buildChangeMap(
  steps: readonly AtomicTransitionStep[],
  baseRevision: CompleteDocumentRevision,
  nextRevision: CompleteDocumentRevision
): ChangeMap {
  const mapPosition = Object.freeze(
    (direction: MapDirection, position: AffineSourcePosition): AffineSourcePosition =>
      mapPositionThroughSteps(steps, direction, position)
  )
  const mapRange = Object.freeze(
    (direction: MapDirection, range: AffineSourceRange): RangeMapping => {
      if (direction === 'forward') {
        return mapRangeThroughSteps(
          steps,
          direction,
          range,
          baseRevision.source.text,
          nextRevision.source.text
        )
      }
      return mapRangeThroughSteps(
        steps,
        direction,
        range,
        nextRevision.source.text,
        baseRevision.source.text
      )
    }
  )
  return Object.freeze({ mapPosition, mapRange })
}

function buildNodeSurvivalMap(steps: readonly AtomicTransitionStep[]): NodeSurvivalMap {
  const map = Object.freeze(
    (direction: MapDirection, node: CriticMarkupNode): CriticMarkupNode | null => {
      let survivor: CriticMarkupNode | undefined = node
      if (direction === 'forward') {
        for (const step of steps) {
          survivor = survivor === undefined ? undefined : step.nodes.forward.get(survivor)
        }
      } else {
        for (let index = steps.length - 1; index >= 0; index -= 1) {
          const step = requiredAt(steps, index)
          survivor = survivor === undefined ? undefined : step.nodes.backward.get(survivor)
        }
      }
      return survivor ?? null
    }
  )
  return Object.freeze({ map })
}

function buildTransition(
  base: RevisionId,
  next: RevisionId,
  baseRevision: CompleteDocumentRevision,
  nextRevision: CompleteDocumentRevision,
  steps: readonly AtomicTransitionStep[]
): RevisionTransition {
  const stableSteps = Object.freeze([...steps])
  const invertedSteps = Object.freeze(stableSteps.map(invertStep).reverse())
  const edits = transitionEdits(baseRevision, nextRevision, stableSteps)
  const inverseEdits = transitionEdits(nextRevision, baseRevision, invertedSteps)
  const canonicalMap = buildChangeMap(stableSteps, baseRevision, nextRevision)
  const nodeSurvival = buildNodeSurvivalMap(stableSteps)

  const invert = Object.freeze(
    (): RevisionTransition => buildTransition(next, base, nextRevision, baseRevision, invertedSteps)
  )
  const compose = Object.freeze((following: RevisionTransition): RevisionTransition => {
    const followingInternals = transitionInternals.get(following)
    if (followingInternals === undefined) {
      throw new TypeError('Cannot compose a transition not created by this kernel')
    }
    if (next !== following.base || nextRevision !== followingInternals.baseRevision) {
      throw new RangeError('Revision transitions are not adjacent')
    }
    return buildTransition(base, following.next, baseRevision, followingInternals.nextRevision, [
      ...stableSteps,
      ...followingInternals.steps
    ])
  })

  const transition = Object.freeze({
    base,
    next,
    edits,
    inverseEdits,
    canonicalMap,
    nodeSurvival,
    invert,
    compose
  })
  transitionInternals.set(
    transition,
    Object.freeze({ baseRevision, nextRevision, steps: stableSteps })
  )
  return transition
}

export function createRevisionTransition(
  base: RevisionId,
  next: RevisionId,
  baseRevision: CompleteDocumentRevision,
  nextRevision: CompleteDocumentRevision,
  edit: SourceEdit,
  inverse: SourceEdit
): RevisionTransition {
  if (applySourceEdit(baseRevision.source.text, edit).source !== nextRevision.source.text) {
    throw new Error('Forward source edit does not reproduce the candidate revision')
  }
  if (applySourceEdit(nextRevision.source.text, inverse).source !== baseRevision.source.text) {
    throw new Error('Inverse source edit does not reproduce the base revision')
  }

  const step = Object.freeze({
    base,
    next,
    baseRevision,
    nextRevision,
    edit,
    inverse,
    nodes: buildNodePairMaps(baseRevision, nextRevision, edit)
  })
  return buildTransition(base, next, baseRevision, nextRevision, [step])
}
