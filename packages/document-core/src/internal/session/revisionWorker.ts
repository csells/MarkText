import type {
  BlockConversion,
  DocumentHistoryState,
  InlineFormat,
  InitialModelSelection,
  MarkupModelSelection,
  ModelPosition,
  ModelSelection,
  QuickInsertBlock,
  RejectionCode,
  RevisionId,
  SessionId,
  SourceModelSelection
} from '../../documentSession.js'
import {
  inspectLanguageEngineChangedCriticMarkerJoins,
  nextLanguageEngineExecutionStage,
  type LanguageEngine
} from '../../languageEngine.js'
import {
  escapeCriticPayload,
  mergeOpaqueRanges,
  type OpaqueRange
} from '../sourceAuthorship.js'
import { materializeDocumentFacts } from '../../materialize/documentFacts.js'
import type {
  CompleteDocumentRevision,
  CriticMarkupNode,
  DocumentRevision,
  MarkupMark,
  MarkdownNode,
  MarkdownPhysicalLine,
  NodeId,
  ParseConfiguration,
  ProjectedCodeUnitOrigin,
  ProjectedMarkdown,
  SourceOffset,
  SourceOnlyDocumentRevision
} from '../../revision.js'
import type {
  RevisionSemanticHashV1,
  SourceHashV1
} from '../../hashCodec.js'
import { createSourceSnapshot } from '../../sourceSnapshot.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from '../../resourcePolicy.js'
import { chooseAuthoringEolV1 } from '../../authoringEol.js'
import {
  DOCUMENT_SEARCH_RESOURCE_POLICY_V1,
  decodeDocumentSearchQuery,
  DocumentSearchQueryError,
  findMarkupSearchMatches,
  findSearchMatches,
  type DocumentSearchQuery
} from '../../search.js'
import {
  canonicalMarkupDocument,
  groupRenderBlocks,
  markupRenderElement
} from '../../view/markupRender.js'
import type {
  MarkupRenderBlock,
  MarkupRenderNode,
  MarkupRenderText
} from '../../view/markupRender.js'
import {
  criticMarkupAuthoringCapabilities,
  createTransformationKernel,
  type CriticMarkupAuthoringCapabilities,
  type CriticMarkupAuthoringInput,
  type TransformationIntent,
  type TransformationKernel
} from '../../transformationKernel.js'
import { createMarkupView, type MarkupView } from './markupView.js'
import {
  buildSourceCandidateDraft,
  protectSourceCandidateDraft
} from './sourceCandidate.js'
import {
  normalizeMarkdownReferenceLabel
} from '../profile1/markdownLaneState.js'
import {
  createSavedIdentityLedger,
  type SavedIdentityLedger
} from './savedIdentityLedger.js'
import type { SourceEdit } from './sourceTransaction.js'
import { applyExactSourceEdits } from '../../exactSourceEdits.js'

export class IntentRejection extends Error {
  readonly code: RejectionCode

  constructor(code: RejectionCode) {
    super(code)
    this.name = 'IntentRejection'
    this.code = code
  }
}

interface CompleteWorkerState {
  readonly session: SessionId
  readonly id: RevisionId
  readonly revision: CompleteDocumentRevision
  readonly markupView: MarkupView
  readonly selection: MarkupModelSelection
  readonly sourceSelection: SourceModelSelection
}

interface SourceOnlyWorkerState {
  readonly session: SessionId
  readonly id: RevisionId
  readonly revision: SourceOnlyDocumentRevision
  readonly selection: SourceModelSelection
}

export type WorkerState = CompleteWorkerState | SourceOnlyWorkerState

interface HistoryEntry {
  readonly forward: readonly SourceEdit[]
  readonly inverse: readonly SourceEdit[]
  readonly beforeSelection: InitialModelSelection
  readonly afterSelection: InitialModelSelection
  readonly beforeSourceSelection: InitialModelSelection
  readonly afterSourceSelection: InitialModelSelection
}

export interface RevisionWorkerCheckpoint {
  readonly session: SessionId
  readonly id: RevisionId
  readonly source: string
  readonly sourceHash: SourceHashV1
  readonly semanticHash: RevisionSemanticHashV1
  readonly configuration: ParseConfiguration
  readonly selection: InitialModelSelection
  readonly sourceSelection: InitialModelSelection
  readonly trackChanges: boolean
  readonly history: readonly HistoryEntry[]
  readonly historyCursor: number
  readonly historyIdentities: readonly string[]
  // Parallel to historyIdentities: the canonical source each history position
  // holds. Saved identity is content-addressed, so dirty state survives a
  // document being edited back to the bytes on disk.
  readonly historySourceHashes: readonly SourceHashV1[]
  readonly historyIdentitySequence: number
  readonly savedHistoryIdentity: string
}

export interface WorkerTransitionProof {
  readonly base: RevisionId
  readonly next: RevisionId
  readonly edits: readonly SourceEdit[]
  readonly inverseEdits: readonly SourceEdit[]
}

interface PreparedWorkerCommitBase {
  readonly transition: WorkerTransitionProof
  readonly history: 'record' | 'none'
  readonly sourceSelection: SourceModelSelection
  readonly historyAction:
    | {
      readonly kind: 'record'
      readonly entry: HistoryEntry
      /**
       * True only for a single-scalar typed insertion: the History rule may
       * extend the open typed run with it instead of recording a new entry.
       */
      readonly coalescible?: boolean
    }
    | { readonly kind: 'undo' | 'redo' }
}

interface PreparedCompleteWorkerCommit extends PreparedWorkerCommitBase {
  readonly revision: CompleteDocumentRevision
  readonly markupView: MarkupView
  readonly selection: MarkupModelSelection
}

interface PreparedSourceOnlyWorkerCommit extends PreparedWorkerCommitBase {
  readonly revision: SourceOnlyDocumentRevision
  readonly selection: SourceModelSelection
}

export type PreparedWorkerCommit =
  | PreparedCompleteWorkerCommit
  | PreparedSourceOnlyWorkerCommit

/**
 * How a set of edits reaches a revision. ADR-0015: the engine authors no bytes
 * the user did not type, so candidate protection belongs to a semantic gesture
 * being admitted for the first time and never to bytes already admitted.
 */
type AdmissionClass =
  | Readonly<{ readonly kind: 'typed-gesture' }>
  | Readonly<{ readonly kind: 'proven-candidate'; readonly revision: DocumentRevision }>
  | Readonly<{ readonly kind: 'exact-replay' }>

const TYPED_GESTURE: AdmissionClass = Object.freeze({ kind: 'typed-gesture' })
const EXACT_REPLAY: AdmissionClass = Object.freeze({ kind: 'exact-replay' })

interface PreparedRawRevision {
  readonly revision: DocumentRevision
  readonly transition: WorkerTransitionProof
}

interface AppliedSourceEdits {
  readonly source: string
  readonly edits: readonly SourceEdit[]
  readonly inverseEdits: readonly SourceEdit[]
}

function protectChangedSourceJoins(
  engine: LanguageEngine,
  before: CompleteDocumentRevision,
  edits: readonly SourceEdit[]
): Readonly<{
    readonly transaction: AppliedSourceEdits
    readonly revision: DocumentRevision
  }> {
  const draft = buildSourceCandidateDraft(before.source.text, edits)
  const inspection = inspectLanguageEngineChangedCriticMarkerJoins(
    engine,
    createSourceSnapshot(draft.text),
    before.configuration,
    draft.joins
  )
  if (inspection.kind === 'source-only') {
    const revision = engine.reopen(
      before,
      createSourceSnapshot(draft.text),
      edits
    )
    return Object.freeze({
      transaction: applySourceEdits(before.source.text, edits, draft.text),
      revision
    })
  }

  const protectionPositions = inspection.protectionPositions
  const protectsIntroducedBom =
    draft.text.startsWith('\uFEFF') &&
    !before.source.text.startsWith('\uFEFF')
  if (protectionPositions.length === 0 && !protectsIntroducedBom) {
    return Object.freeze({
      transaction: applySourceEdits(before.source.text, edits, draft.text),
      revision: engine.reopen(
        before,
        createSourceSnapshot(draft.text),
        edits
      )
    })
  }

  const protectedDraft = protectSourceCandidateDraft(
    before.source.text,
    draft,
    protectionPositions,
    protectsIntroducedBom
  )
  const revision = engine.reopen(
    before,
    createSourceSnapshot(protectedDraft.text),
    protectedDraft.edits
  )
  return Object.freeze({
    transaction: applySourceEdits(
      before.source.text,
      protectedDraft.edits,
      protectedDraft.text
    ),
    revision
  })
}

function applySourceEdits(
  source: string,
  edits: readonly SourceEdit[],
  exactCandidateSource?: string
): AppliedSourceEdits {
  const stable = Object.freeze(edits.map((edit) => freezeSourceEdit(edit)))
  let previousEnd = 0
  for (const [index, edit] of stable.entries()) {
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > source.length ||
      (index > 0 && edit.start < previousEnd)
    ) {
      throw new RangeError('Source edits must be sorted and nonoverlapping')
    }
    previousEnd = edit.end
  }

  let nextSource = exactCandidateSource ?? source
  if (exactCandidateSource === undefined) {
    nextSource = applyExactSourceEdits(
      source,
      stable,
      'Session source edit'
    )
  }

  let delta = 0
  const inverseEdits = stable.map((edit): SourceEdit => {
    const start = edit.start + delta
    const inverse = Object.freeze({
      start,
      end: start + edit.insert.length,
      insert: source.slice(edit.start, edit.end)
    })
    delta += edit.insert.length - (edit.end - edit.start)
    return inverse
  })
  return Object.freeze({
    source: nextSource,
    edits: stable,
    inverseEdits: Object.freeze(inverseEdits)
  })
}

function mapSourcePositionThroughEdits(
  position: ModelPosition,
  edits: readonly SourceEdit[]
): ModelPosition {
  let delta = 0
  for (const edit of edits) {
    if (
      position.offset < edit.start ||
      (
        position.offset === edit.start &&
        position.affinity === 'previous'
      )
    ) {
      break
    }
    if (
      position.offset > edit.end ||
      (
        position.offset === edit.end &&
        position.affinity === 'next'
      )
    ) {
      delta += edit.insert.length - (edit.end - edit.start)
      continue
    }
    return Object.freeze({
      offset:
        edit.start +
        delta +
        (position.affinity === 'next' ? edit.insert.length : 0),
      affinity: position.affinity
    })
  }
  return Object.freeze({
    offset: position.offset + delta,
    affinity: position.affinity
  })
}

function modelPositionAtSemanticBoundary(
  view: MarkupView,
  position: ModelPosition
): ModelPosition | null {
  if (view.runs.length === 0) {
    return Object.freeze({
      offset: 0,
      affinity: position.affinity
    })
  }
  const exact = view.modelPositionAt(position)
  if (exact !== null) {
    return exact
  }

  let previous: ModelPosition | null = null
  for (const run of view.runs) {
    if (
      position.offset >= Number(run.sourceRange.start) &&
      position.offset <= Number(run.sourceRange.end)
    ) {
      return Object.freeze({
        offset:
          run.modelRange.start +
          Math.min(
            position.offset - Number(run.sourceRange.start),
            run.modelRange.end - run.modelRange.start
          ),
        affinity: position.affinity
      })
    }
    if (Number(run.sourceRange.end) < position.offset) {
      previous = Object.freeze({
        offset: run.modelRange.end,
        affinity: position.affinity
      })
      continue
    }
    return previous ?? Object.freeze({
      offset: run.modelRange.start,
      affinity: position.affinity
    })
  }
  return previous
}

type TrackCarrierPolicy = 'plain' | 'direct' | 'stable' | 'read-only'

interface TrackCarrierContext {
  readonly policy: TrackCarrierPolicy
  readonly node?: CriticMarkupNode
  readonly arm?: CriticMarkupNode['arms'][number]
  readonly depth: number
}

interface ExhaustedHighlight {
  readonly node: Extract<CriticMarkupNode, { readonly kind: 'highlight' }>
  readonly arm: Extract<
    CriticMarkupNode,
    { readonly kind: 'highlight' }
  >['arms'][0]
  readonly depth: number
}

interface VisibleReplacementSegment {
  readonly render: MarkupRenderText
  readonly owners: readonly MarkupRenderNode[]
}

interface VisibleReplacementIndex {
  readonly segments: readonly VisibleReplacementSegment[]
  readonly byOwner: ReadonlyMap<
    MarkupRenderNode,
    readonly VisibleReplacementSegment[]
  >
}

interface VisibleReplacementPiece extends OpaqueRange {
  readonly insertReplacement: boolean
}

const SEARCH_REMOVABLE_INLINE_KINDS = new Set([
  'autolink',
  'emphasis',
  'inline-code',
  'inline-html',
  'inline-math',
  'link',
  'strikethrough',
  'strong',
  'subscript',
  'superscript'
])

function visibleReplacementSegments(
  blocks: readonly MarkupRenderBlock[]
): VisibleReplacementIndex {
  const segments: VisibleReplacementSegment[] = []
  const byOwner = new Map<MarkupRenderNode, VisibleReplacementSegment[]>()
  const visit = (
    node: MarkupRenderNode,
    owners: readonly MarkupRenderNode[]
  ): void => {
    const path = Object.freeze([...owners, node])
    for (const render of node.text) {
      if (render.text.length > 0) {
        const segment = Object.freeze({ render, owners: path })
        segments.push(segment)
        for (const owner of path) {
          const owned = byOwner.get(owner) ?? []
          owned.push(segment)
          byOwner.set(owner, owned)
        }
      }
    }
    for (const child of node.children) visit(child, path)
  }
  for (const block of blocks) visit(block.tree, Object.freeze([]))
  return Object.freeze({
    segments: Object.freeze(segments),
    byOwner: new Map(
      [...byOwner].map(([owner, owned]) => [
        owner,
        Object.freeze(owned)
      ])
    )
  })
}

function touchedVisibleSegments(
  segments: readonly VisibleReplacementSegment[],
  match: OpaqueRange
): readonly VisibleReplacementSegment[] {
  let low = 0
  let high = segments.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const segment = segments[middle]
    if (segment === undefined || segment.render.modelRange.end > match.start) {
      high = middle
    } else {
      low = middle + 1
    }
  }
  const touched: VisibleReplacementSegment[] = []
  for (let index = low; index < segments.length; index += 1) {
    const segment = segments[index]
    if (
      segment === undefined ||
      segment.render.modelRange.start >= match.end
    ) {
      break
    }
    touched.push(segment)
  }
  return Object.freeze(touched)
}

/**
 * Split one reader-visible match at parser text boundaries.
 *
 * Replacing one contiguous model span would consume delimiters between its
 * visible pieces while leaving an opener or closer outside the span. The
 * parser tree tells us which later inline wrappers become empty: delete those
 * wrappers whole, retain the first piece's formatting, and apply the user's
 * replacement only to that first visible piece.
 */
function visibleReplacementPieces(
  index: VisibleReplacementIndex,
  match: OpaqueRange
): readonly VisibleReplacementPiece[] {
  const touched = touchedVisibleSegments(index.segments, match)
  const first = touched[0]
  if (first === undefined) {
    throw new IntentRejection('invalid-command-argument')
  }

  const parentByNode = new Map<MarkupRenderNode, MarkupRenderNode | undefined>()
  const candidateNodes = new Set<MarkupRenderNode>()
  for (const segment of touched) {
    segment.owners.forEach((node, index) => {
      parentByNode.set(node, segment.owners[index - 1])
      if (SEARCH_REMOVABLE_INLINE_KINDS.has(node.kind)) candidateNodes.add(node)
    })
  }
  const removable = [...candidateNodes].filter((node) => {
    if (first.owners.includes(node)) return false
    const owned = index.byOwner.get(node) ?? Object.freeze([])
    return owned.length > 0 && owned.every(({ render }) =>
      match.start <= render.modelRange.start &&
      render.modelRange.end <= match.end
    )
  })
  const removableSet = new Set(removable)
  const outermost = removable.filter((node) => {
    let parent = parentByNode.get(node)
    while (parent !== undefined) {
      if (removableSet.has(parent)) return false
      parent = parentByNode.get(parent)
    }
    return true
  })
  const removedOwners = new Set(outermost)
  const pieces: VisibleReplacementPiece[] = outermost.map((node) =>
    Object.freeze({
      start: node.modelRange.start,
      end: node.modelRange.end,
      insertReplacement: false
    })
  )
  for (const segment of touched) {
    if (segment.owners.some((owner) => removedOwners.has(owner))) continue
    pieces.push(Object.freeze({
      start: Math.max(match.start, segment.render.modelRange.start),
      end: Math.min(match.end, segment.render.modelRange.end),
      insertReplacement: segment === first
    }))
  }
  return Object.freeze(pieces.sort((left, right) =>
    left.start - right.start || left.end - right.end
  ))
}

function serializeAddition(
  content: string,
  opaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  return `{++${escapeCriticPayload(
    content,
    '++}',
    false,
    opaqueRanges
  )}++}`
}

function serializeDeletion(
  content: string,
  opaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  return `{--${escapeCriticPayload(
    content,
    '--}',
    false,
    opaqueRanges
  )}--}`
}

function serializeSubstitution(
  oldContent: string,
  newContent: string,
  oldOpaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  return `{~~${escapeCriticPayload(
    oldContent,
    '~~}',
    true,
    oldOpaqueRanges
  )}~>${escapeCriticPayload(newContent, '~~}', true)}~~}`
}

function carrierClose(
  context: TrackCarrierContext
): '++}' | '~~}' | '==}' | '--}' | '<<}' | null {
  if (context.node?.kind === 'addition') {
    return '++}'
  }
  if (context.node?.kind === 'substitution') {
    return '~~}'
  }
  if (context.node?.kind === 'highlight') {
    return '==}'
  }
  if (context.node?.kind === 'deletion') {
    return '--}'
  }
  if (context.node?.kind === 'comment') {
    return '<<}'
  }
  return null
}

function escapeDirectCarrierText(
  text: string,
  context: TrackCarrierContext
): string {
  const close = carrierClose(context)
  return close === null
    ? text
    : escapeCriticPayload(
      text,
      close,
      context.node?.kind === 'substitution'
    )
}

function trackCarrierContext(
  revision: CompleteDocumentRevision,
  start: number,
  end: number
): TrackCarrierContext {
  const contains = (
    range: CriticMarkupNode['arms'][number]['range']
  ): boolean =>
    start >= Number(range.start) && end <= Number(range.end)
  const deepest = new Map<
    Exclude<TrackCarrierPolicy, 'plain'>,
    TrackCarrierContext
  >()
  const pending: Array<Readonly<{
    node: CriticMarkupNode
    depth: number
  }>> = []
  for (
    let index = revision.criticMarkup.rootCount - 1;
    index >= 0;
    index -= 1
  ) {
    pending.push({ node: revision.criticMarkup.rootAt(index), depth: 0 })
  }
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) {
      continue
    }
    for (
      let armIndex = current.node.arms.length - 1;
      armIndex >= 0;
      armIndex -= 1
    ) {
      const arm = current.node.arms[armIndex]
      if (arm === undefined) {
        continue
      }
      if (!contains(arm.range)) {
        continue
      }
      let policy: Exclude<TrackCarrierPolicy, 'plain'> | undefined
      if (current.node.kind === 'addition' && arm.name === 'content') {
        policy = 'direct'
      } else if (current.node.kind === 'highlight' && arm.name === 'content') {
        policy = 'stable'
      } else if (current.node.kind === 'deletion' && arm.name === 'content') {
        policy = 'read-only'
      } else if (current.node.kind === 'substitution') {
        policy = arm.name === 'new' ? 'direct' : 'read-only'
      }
      const prior = policy === undefined ? undefined : deepest.get(policy)
      if (policy !== undefined && (prior === undefined || current.depth > prior.depth)) {
        deepest.set(policy, Object.freeze({
          depth: current.depth,
          policy,
          node: current.node,
          arm
        }))
      }
      for (
        let childIndex = arm.children.length - 1;
        childIndex >= 0;
        childIndex -= 1
      ) {
        const child = arm.children[childIndex]
        if (child !== undefined) {
          pending.push({ node: child, depth: current.depth + 1 })
        }
      }
    }
  }
  return (
    deepest.get('read-only') ??
    deepest.get('direct') ??
    deepest.get('stable') ??
    Object.freeze({ policy: 'plain' as const, depth: -1 })
  )
}

function runSurvivesRootRevised(
  marks: readonly MarkupMark[]
): boolean {
  return marks.every((mark) =>
    mark.kind !== 'deletion' &&
    !(mark.kind === 'substitution' && mark.arm === 'old')
  )
}

/**
 * Find the innermost Highlight whose complete root-Revised contribution is
 * covered by this edit.
 *
 * Source containment is insufficient: a Highlight may retain earlier source
 * which contributes nothing because it is a Comment, a Deletion, or lies on a
 * Substitution old-arm ancestor path. The parser's editing runs already carry
 * that complete mark path, so this classification reads the retained graph
 * product and never scans or reparses source syntax.
 */
function exhaustedHighlightAt(
  revision: CompleteDocumentRevision,
  start: number,
  end: number
): ExhaustedHighlight | undefined {
  const candidates: ExhaustedHighlight[] = []
  const pending: Array<Readonly<{
    node: CriticMarkupNode
    depth: number
  }>> = []
  for (
    let index = revision.criticMarkup.rootCount - 1;
    index >= 0;
    index -= 1
  ) {
    pending.push({ node: revision.criticMarkup.rootAt(index), depth: 0 })
  }
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) {
      continue
    }
    if (current.node.kind === 'highlight') {
      const arm = current.node.arms[0]
      if (
        start >= Number(arm.range.start) &&
        end <= Number(arm.range.end)
      ) {
        candidates.push(Object.freeze({
          node: current.node,
          arm,
          depth: current.depth
        }))
      }
    }
    for (
      let armIndex = current.node.arms.length - 1;
      armIndex >= 0;
      armIndex -= 1
    ) {
      const arm = current.node.arms[armIndex]
      if (arm === undefined) {
        continue
      }
      for (
        let childIndex = arm.children.length - 1;
        childIndex >= 0;
        childIndex -= 1
      ) {
        const child = arm.children[childIndex]
        if (child !== undefined) {
          pending.push({ node: child, depth: current.depth + 1 })
        }
      }
    }
  }
  const coverage = new Map<
    NodeId,
    { hasContribution: boolean, hasUnselectedContribution: boolean }
  >()
  for (const candidate of candidates) {
    coverage.set(candidate.node.nodeId, {
      hasContribution: false,
      hasUnselectedContribution: false
    })
  }
  for (let ordinal = 0; ordinal < revision.markup.runCount; ordinal += 1) {
    const run = revision.markup.runAt(ordinal)
    if (!runSurvivesRootRevised(run.marks)) {
      continue
    }
    for (const mark of run.marks) {
      if (mark.kind !== 'highlight') {
        continue
      }
      const state = coverage.get(mark.nodeId)
      if (state === undefined) {
        continue
      }
      state.hasContribution = true
      if (
        Number(run.sourceRange.start) < start ||
        Number(run.sourceRange.end) > end
      ) {
        state.hasUnselectedContribution = true
      }
    }
  }
  return candidates
    .filter((candidate) => {
      const state = coverage.get(candidate.node.nodeId)
      return state?.hasContribution === true &&
        !state.hasUnselectedContribution
    })
    .sort((left, right) => right.depth - left.depth)[0]
}

function hiddenCommentOverlaps(
  revision: CompleteDocumentRevision,
  start: number,
  end: number
): boolean {
  const pending: CriticMarkupNode[] = []
  for (let index = 0; index < revision.criticMarkup.rootCount; index += 1) {
    pending.push(revision.criticMarkup.rootAt(index))
  }
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) {
      continue
    }
    if (
      node.kind === 'comment' &&
      Number(node.range.start) < end &&
      Number(node.range.end) > start
    ) {
      return true
    }
    for (const arm of node.arms) {
      pending.push(...arm.children)
    }
  }
  return false
}

function exhaustedHighlightEdit(
  revision: CompleteDocumentRevision,
  highlight: ExhaustedHighlight,
  removedStart: number,
  removedEnd: number,
  trackAsRootChange: boolean
): SourceEdit {
  const nodeStart = Number(highlight.node.range.start)
  const nodeEnd = Number(highlight.node.range.end)
  const nodeSource = revision.source.text.slice(nodeStart, nodeEnd)
  if (trackAsRootChange) {
    return Object.freeze({
      start: nodeStart,
      end: nodeEnd,
      insert: serializeDeletion(
        nodeSource,
        Object.freeze([{ start: 0, end: nodeSource.length }])
      )
    })
  }
  return Object.freeze({
    start: nodeStart,
    end: nodeEnd,
    insert:
      revision.source.text.slice(
        Number(highlight.arm.range.start),
        removedStart
      ) +
      revision.source.text.slice(
        removedEnd,
        Number(highlight.arm.range.end)
      )
  })
}

function payloadOpaqueRanges(
  revision: CompleteDocumentRevision,
  start: number,
  end: number
): readonly OpaqueRange[] {
  const ranges: OpaqueRange[] = []
  const pending: CriticMarkupNode[] = []
  for (
    let index = revision.criticMarkup.rootCount - 1;
    index >= 0;
    index -= 1
  ) {
    pending.push(revision.criticMarkup.rootAt(index))
  }
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) {
      continue
    }
    const nodeStart = Number(node.range.start)
    const nodeEnd = Number(node.range.end)
    if (nodeStart >= start && nodeEnd <= end) {
      ranges.push(Object.freeze({
        start: nodeStart - start,
        end: nodeEnd - start
      }))
      continue
    }
    for (let armIndex = node.arms.length - 1; armIndex >= 0; armIndex -= 1) {
      const arm = node.arms[armIndex]
      if (arm === undefined) {
        continue
      }
      for (
        let childIndex = arm.children.length - 1;
        childIndex >= 0;
        childIndex -= 1
      ) {
        const child = arm.children[childIndex]
        if (child !== undefined) {
          pending.push(child)
        }
      }
    }
  }
  for (let index = 0; index < revision.ownership.count; index += 1) {
    const run = revision.ownership.at(index)
    if (run.owner.kind !== 'markdown-literal') {
      continue
    }
    const rangeStart = Math.max(start, Number(run.range.start))
    const rangeEnd = Math.min(end, Number(run.range.end))
    if (rangeStart < rangeEnd) {
      ranges.push(Object.freeze({
        start: rangeStart - start,
        end: rangeEnd - start
      }))
    }
  }
  return mergeOpaqueRanges(ranges)
}

function freezePosition(position: ModelPosition): ModelPosition {
  return Object.freeze({
    offset: position.offset,
    affinity: position.affinity
  })
}

function freezeSelection(
  session: SessionId,
  revision: RevisionId,
  view: 'markup',
  selection: InitialModelSelection
): MarkupModelSelection
function freezeSelection(
  session: SessionId,
  revision: RevisionId,
  view: 'source',
  selection: InitialModelSelection
): SourceModelSelection
function freezeSelection(
  session: SessionId,
  revision: RevisionId,
  view: 'markup' | 'source',
  selection: InitialModelSelection
): ModelSelection {
  const anchor = freezePosition(selection.anchor)
  const focus = freezePosition(selection.focus)
  if (view === 'markup') {
    return Object.freeze({
      session,
      revision,
      view: 'markup' as const,
      anchor,
      focus
    })
  }
  return Object.freeze({
    session,
    revision,
    view: 'source' as const,
    anchor,
    focus
  })
}

function detachSelection(selection: ModelSelection): InitialModelSelection {
  return Object.freeze({
    anchor: freezePosition(selection.anchor),
    focus: freezePosition(selection.focus)
  })
}

function freezeSourceEdit(edit: SourceEdit): SourceEdit {
  return Object.freeze({
    start: edit.start,
    end: edit.end,
    insert: edit.insert
  })
}

function freezeInitialSelection(
  selection: InitialModelSelection
): InitialModelSelection {
  return Object.freeze({
    anchor: freezePosition(selection.anchor),
    focus: freezePosition(selection.focus)
  })
}

/** The entry's one edit, when it is a pure insertion of one Unicode scalar. */
function singleScalarPureInsert(
  entry: HistoryEntry
): Readonly<{ position: number; scalar: string }> | null {
  const edit = entry.forward[0]
  if (
    entry.forward.length !== 1 ||
    edit === undefined ||
    edit.start !== edit.end ||
    [...edit.insert].length !== 1
  ) {
    return null
  }
  return Object.freeze({ position: edit.start, scalar: edit.insert })
}

/** The open entry's shape when it is one pure insertion run. */
function pureInsertRun(
  entry: HistoryEntry
): Readonly<{ position: number; text: string }> | null {
  const edit = entry.forward[0]
  if (
    entry.forward.length !== 1 ||
    edit === undefined ||
    edit.start !== edit.end ||
    edit.insert.length === 0
  ) {
    return null
  }
  return Object.freeze({ position: edit.start, text: edit.insert })
}

function isWhitespaceScalar(scalar: string): boolean {
  return /^\s$/u.test(scalar)
}

function freezeHistoryEntry(entry: HistoryEntry): HistoryEntry {
  if (
    entry.forward.length >
      DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction ||
    entry.inverse.length >
      DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction
  ) {
    throw new Error('Revision worker history exceeds the source-edit policy')
  }
  const insertUnits = [...entry.forward, ...entry.inverse].reduce(
    (total, edit) => total + edit.insert.length,
    0
  )
  if (
    insertUnits >
    DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryInsertUnits
  ) {
    throw new Error('Revision worker history exceeds the insert-unit policy')
  }
  return Object.freeze({
    forward: Object.freeze(entry.forward.map((edit) => freezeSourceEdit(edit))),
    inverse: Object.freeze(entry.inverse.map((edit) => freezeSourceEdit(edit))),
    beforeSelection: freezeInitialSelection(entry.beforeSelection),
    afterSelection: freezeInitialSelection(entry.afterSelection),
    beforeSourceSelection: freezeInitialSelection(entry.beforeSourceSelection),
    afterSourceSelection: freezeInitialSelection(entry.afterSourceSelection)
  })
}

function assertPosition(position: ModelPosition, modelLength: number): void {
  if (!Number.isInteger(position.offset) || position.offset < 0 || position.offset > modelLength) {
    throw new RangeError('Position is outside the active document view')
  }
}

function coordinateLength(state: WorkerState): number {
  return 'markupView' in state
    ? state.markupView.modelLength
    : state.revision.source.text.length
}

/** Validate a selection against the head revision, collapsed or not. */
function assertSelection(selection: ModelSelection, state: WorkerState): void {
  if (
    selection.session !== state.session ||
    selection.revision !== state.id ||
    selection.view !== state.selection.view
  ) {
    throw new IntentRejection('stale-selection')
  }
  const length = coordinateLength(state)
  assertPosition(selection.anchor, length)
  assertPosition(selection.focus, length)
}

/** Validate a canonical-source selection against the retained head revision. */
function assertSourceSelection(
  selection: SourceModelSelection,
  state: WorkerState
): void {
  if (
    selection.session !== state.session ||
    selection.revision !== state.id ||
    selection.view !== 'source'
  ) {
    throw new IntentRejection('stale-selection')
  }
  const length = state.revision.source.text.length
  assertPosition(selection.anchor, length)
  assertPosition(selection.focus, length)
}

function assertCollapsedSelection(selection: ModelSelection, state: WorkerState): void {
  assertSelection(selection, state)
  if (
    selection.anchor.offset !== selection.focus.offset ||
    selection.anchor.affinity !== selection.focus.affinity
  ) {
    throw new IntentRejection('selection-not-collapsed')
  }
}

const INLINE_FORMAT_DELIMITERS: Readonly<
  Record<
    Exclude<InlineFormat, 'clear'>,
    readonly [open: string, close: string]
  >
> = Object.freeze({
  strong: ['**', '**'] as const,
  emphasis: ['*', '*'] as const,
  underline: ['<u>', '</u>'] as const,
  superscript: ['^', '^'] as const,
  subscript: ['~', '~'] as const,
  highlight: ['==', '=='] as const,
  'inline-code': ['`', '`'] as const,
  'inline-math': ['$', '$'] as const,
  strikethrough: ['~~', '~~'] as const,
  link: ['[', ']()'] as const,
  image: ['![', ']()'] as const
})

interface InlineFormatMarkerPair {
  readonly format: Exclude<InlineFormat, 'clear'>
  readonly openStart: number
  readonly closeEnd: number
}

const INLINE_FORMAT_MATCH_ORDER = Object.freeze([
  'image',
  'link',
  'underline',
  'strong',
  'strikethrough',
  'emphasis',
  'superscript',
  'subscript',
  'highlight',
  'inline-code',
  'inline-math'
] as const satisfies readonly Exclude<InlineFormat, 'clear'>[])

function assertToolLine(value: string, _field: string, allowEmpty = false): void {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    /[\r\n]/.test(value) ||
    value.includes(String.fromCharCode(0))
  ) {
    throw new IntentRejection('invalid-command-argument')
  }
}

function serializeLinkDestination(destination: string): string {
  assertToolLine(destination, 'destination')
  const escaped = destination.replace(/\\/g, '\\\\')
  return /[\s()<>]/.test(destination)
    ? `<${escaped.replace(/>/g, '\\>')}>`
    : escaped.replace(/\)/g, '\\)')
}

function serializeOptionalTitle(title: string | undefined): string {
  if (title === undefined || title.length === 0) {
    return ''
  }

  assertToolLine(title, 'title', true)
  return ` "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function serializeImageAlt(alt: string): string {
  assertToolLine(alt, 'alt', true)
  return alt
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function inlineFormatMarkerPair(
  source: string,
  contentStart: number,
  contentEnd: number,
  format: Exclude<InlineFormat, 'clear'>
): InlineFormatMarkerPair | undefined {
  const [open, fixedClose] = INLINE_FORMAT_DELIMITERS[format]
  if (!source.slice(0, contentStart).endsWith(open)) {
    return undefined
  }
  const right = source.slice(contentEnd)
  const close =
    format === 'link' || format === 'image'
      ? /^\]\([^)\r\n]*\)/.exec(right)?.[0]
      : right.startsWith(fixedClose)
        ? fixedClose
        : undefined
  if (close === undefined) {
    return undefined
  }
  return Object.freeze({
    format,
    openStart: contentStart - open.length,
    closeEnd: contentEnd + close.length
  })
}

type TableAlignment = 'none' | 'left' | 'center' | 'right'

interface TableCellSource {
  readonly text: string
  readonly opaqueRanges: readonly OpaqueRange[]
}

interface SerializedTableSource {
  readonly text: string
  readonly opaqueRanges: readonly OpaqueRange[]
}

const EMPTY_TABLE_CELL_SOURCE: TableCellSource = Object.freeze({
  text: '',
  opaqueRanges: Object.freeze([])
})

const validTableShape = (rows: number, columns: number): boolean =>
  Number.isSafeInteger(rows) &&
  Number.isSafeInteger(columns) &&
  rows >= 1 &&
  rows <= 30 &&
  columns >= 1 &&
  columns <= 20

const blankGfmTable = (
  rows: number,
  columns: number,
  eol: string
): string => {
  const row = `|${'   |'.repeat(columns)}`
  const delimiter = `|${' --- |'.repeat(columns)}`
  return [
    row,
    delimiter,
    ...Array.from({ length: rows - 1 }, () => row)
  ].join(eol)
}

function plainTableCellSource(text: string): TableCellSource {
  return Object.freeze({ text, opaqueRanges: Object.freeze([]) })
}

function tableDelimiter(alignment: TableAlignment): string {
  if (alignment === 'left') return ':---'
  if (alignment === 'center') return ':---:'
  if (alignment === 'right') return '---:'
  return '---'
}

function serializeTableRow(
  cells: readonly TableCellSource[]
): SerializedTableSource {
  let text = '|'
  const opaqueRanges: OpaqueRange[] = []
  for (const cell of cells) {
    if (cell.text.length === 0) {
      text += '   |'
      continue
    }
    text += ' '
    const cellStart = text.length
    text += cell.text
    for (const range of cell.opaqueRanges) {
      opaqueRanges.push(Object.freeze({
        start: cellStart + range.start,
        end: cellStart + range.end
      }))
    }
    text += ' |'
  }
  return Object.freeze({
    text,
    opaqueRanges: Object.freeze(opaqueRanges)
  })
}

function serializeTable(
  rows: readonly (readonly TableCellSource[])[],
  alignments: readonly TableAlignment[],
  eol: string
): SerializedTableSource {
  const header = rows[0]
  if (header === undefined || alignments.length === 0) {
    return Object.freeze({
      text: '',
      opaqueRanges: Object.freeze([])
    })
  }
  const lines = [
    serializeTableRow(header),
    serializeTableRow(alignments.map((alignment) =>
      plainTableCellSource(tableDelimiter(alignment))
    )),
    ...rows.slice(1).map(serializeTableRow)
  ]
  let text = ''
  const opaqueRanges: OpaqueRange[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) continue
    if (index > 0) text += eol
    const lineStart = text.length
    text += line.text
    for (const range of line.opaqueRanges) {
      opaqueRanges.push(Object.freeze({
        start: lineStart + range.start,
        end: lineStart + range.end
      }))
    }
  }
  return Object.freeze({
    text,
    opaqueRanges: Object.freeze(opaqueRanges)
  })
}

function serializedTableCellOffset(
  rows: readonly (readonly TableCellSource[])[],
  alignments: readonly TableAlignment[],
  rowIndex: number,
  columnIndex: number,
  eol: string
): number {
  const lines = [
    serializeTableRow(rows[0] ?? Object.freeze([])).text,
    serializeTableRow(alignments.map((alignment) =>
      plainTableCellSource(tableDelimiter(alignment))
    )).text,
    ...rows.slice(1).map(serializeTableRow)
      .map((line) => line.text)
  ]
  const lineIndex = rowIndex === 0 ? 0 : rowIndex + 1
  const row = rows[rowIndex]
  if (
    row === undefined ||
    columnIndex < 0 ||
    columnIndex >= row.length
  ) {
    throw new RangeError('Serialized table cell is outside the table')
  }
  let offset = 0
  for (let index = 0; index < lineIndex; index += 1) {
    offset += (lines[index]?.length ?? 0) + eol.length
  }
  offset += 2
  for (let index = 0; index < columnIndex; index += 1) {
    const cell = row[index] ?? EMPTY_TABLE_CELL_SOURCE
    offset += cell.text.length === 0 ? 4 : cell.text.length + 3
  }
  return offset
}

function sourceBoundaryBefore(origin: ProjectedCodeUnitOrigin): number {
  return Number(
    origin.kind === 'canonical'
      ? origin.sourceOffset
      : origin.sourcePosition
  )
}

function sourceBoundaryAfter(origin: ProjectedCodeUnitOrigin): number {
  return origin.kind === 'canonical'
    ? Number(origin.sourceOffset) + 1
    : Number(origin.sourcePosition)
}

function criticMarkupNodesOf(
  revision: CompleteDocumentRevision
): readonly CriticMarkupNode[] {
  const nodes: CriticMarkupNode[] = []
  const pending: CriticMarkupNode[] = []
  for (
    let ordinal = revision.criticMarkup.rootCount - 1;
    ordinal >= 0;
    ordinal -= 1
  ) {
    pending.push(revision.criticMarkup.rootAt(ordinal))
  }
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) {
      continue
    }
    nodes.push(node)
    for (let armIndex = node.arms.length - 1; armIndex >= 0; armIndex -= 1) {
      const arm = node.arms[armIndex]
      if (arm === undefined) {
        continue
      }
      for (
        let childIndex = arm.children.length - 1;
        childIndex >= 0;
        childIndex -= 1
      ) {
        const child = arm.children[childIndex]
        if (child !== undefined) {
          pending.push(child)
        }
      }
    }
  }
  return Object.freeze(nodes)
}

function completeStructuralSourceRange(
  revision: CompleteDocumentRevision,
  start: number,
  end: number
): OpaqueRange {
  let expandedStart = start
  let expandedEnd = end
  const nodes = criticMarkupNodesOf(revision)
  let expanded = true
  while (expanded) {
    expanded = false
    for (const node of nodes) {
      const isCarrier = node.arms.some((arm) =>
        Number(arm.range.start) <= start &&
        Number(arm.range.end) >= end
      )
      if (isCarrier) continue

      const nodeStart = Number(node.range.start)
      const nodeEnd = Number(node.range.end)
      if (nodeStart < expandedStart && nodeEnd > expandedStart) {
        expandedStart = nodeStart
        expanded = true
      }
      if (nodeStart < expandedEnd && nodeEnd > expandedEnd) {
        expandedEnd = nodeEnd
        expanded = true
      }
    }
  }
  return Object.freeze({ start: expandedStart, end: expandedEnd })
}

/**
 * Read one parser-owned table cell from canonical source.
 *
 * Projected Markdown omits CriticMarkup markers and hidden arms. The syntax
 * immediately around a cell still has canonical provenance, so its two
 * projected boundaries name the exact canonical payload between them. At an
 * outer row edge there may be no syntax character to supply a boundary; in
 * that case parser-emitted CriticMarkup ranges extend the first/last visible
 * code unit to its complete carrier.
 */
function canonicalTableCellSource(
  revision: CompleteDocumentRevision,
  projected: ProjectedMarkdown,
  table: MarkdownNode,
  row: MarkdownNode,
  cell: MarkdownNode
): TableCellSource {
  const hasLeftBoundary = cell.range.start > row.range.start
  const hasRightBoundary = cell.range.end < row.range.end
  let start = hasLeftBoundary
    ? sourceBoundaryAfter(projected.provenance.originAt(cell.range.start - 1))
    : cell.range.start < cell.range.end
      ? sourceBoundaryBefore(projected.provenance.originAt(cell.range.start))
      : 0
  let end = hasRightBoundary
    ? sourceBoundaryBefore(projected.provenance.originAt(cell.range.end))
    : cell.range.start < cell.range.end
      ? sourceBoundaryAfter(projected.provenance.originAt(cell.range.end - 1))
      : start

  const criticNodes = criticMarkupNodesOf(revision)
  const tableStart = sourceBoundaryBefore(
    projected.provenance.originAt(table.range.start)
  )
  const tableEnd = sourceBoundaryAfter(
    projected.provenance.originAt(table.range.end - 1)
  )

  let expanded = true
  while (expanded) {
    expanded = false
    for (const node of criticNodes) {
      if (node.arms.some((arm) =>
        Number(arm.range.start) <= tableStart &&
        Number(arm.range.end) >= tableEnd
      )) {
        continue
      }
      const nodeStart = Number(node.range.start)
      const nodeEnd = Number(node.range.end)
      const touchesLeft =
        nodeStart <= start &&
        (
          nodeEnd > start ||
          (!hasLeftBoundary && nodeEnd === start)
        )
      const touchesRight =
        nodeEnd >= end &&
        (
          nodeStart < end ||
          (!hasRightBoundary && nodeStart === end)
        )
      if (
        (hasLeftBoundary && nodeStart < start && touchesLeft) ||
        (hasRightBoundary && nodeEnd > end && touchesRight)
      ) {
        throw new IntentRejection('selection-crosses-syntax-boundary')
      }
      if (!hasLeftBoundary && touchesLeft && nodeStart < start) {
        start = nodeStart
        expanded = true
      }
      if (!hasRightBoundary && touchesRight && nodeEnd > end) {
        end = nodeEnd
        expanded = true
      }
    }
  }
  if (start < 0 || end < start || end > revision.source.text.length) {
    throw new IntentRejection('invalid-source-range')
  }
  return Object.freeze({
    text: revision.source.text.slice(start, end),
    opaqueRanges: payloadOpaqueRanges(revision, start, end)
  })
}

export class RevisionWorker {
  readonly #engine: LanguageEngine
  readonly #transformations: TransformationKernel
  #trackChanges: boolean
  #state: WorkerState
  #history: HistoryEntry[] = []
  /**
   * The open typed run: consecutive single-scalar insertions extend one
   * history entry while each lands at the caret the previous one left and
   * does not start a new word after whitespace. Anything else — another
   * intent, a selection move, undo/redo, persistence, restoration — seals
   * it (section 2 History rule, G33).
   */
  #openTypedRun: Readonly<{
    caret: number
    lastScalar: string
  }> | null = null
  #historyCursor = 0
  #savedIdentityLedger: SavedIdentityLedger

  constructor(
    engine: LanguageEngine,
    session: SessionId,
    id: RevisionId,
    revision: DocumentRevision,
    initialSelection: InitialModelSelection,
    trackChanges: boolean,
    recovery: RevisionWorkerCheckpoint | undefined = undefined
  ) {
    this.#engine = engine
    this.#transformations = createTransformationKernel(engine)
    this.#trackChanges = recovery?.trackChanges ?? trackChanges
    this.#savedIdentityLedger = createSavedIdentityLedger(
      String(session),
      Object.freeze({ kind: 'opened' as const, sourceHash: revision.sourceHash })
    )
    if (
      recovery !== undefined &&
      (
        recovery.session !== session ||
        recovery.id !== id ||
        recovery.source !== revision.source.text ||
        recovery.sourceHash !== revision.sourceHash ||
        recovery.semanticHash !== revision.semanticHash
      )
    ) {
      throw new Error('Revision worker checkpoint does not match its recovered revision')
    }
    if (revision.kind === 'complete') {
      const markupView = createMarkupView(revision)
      assertPosition(initialSelection.anchor, markupView.modelLength)
      assertPosition(initialSelection.focus, markupView.modelLength)
      const sourceSelection = recovery?.sourceSelection ?? Object.freeze({
        anchor: markupView.sourcePositionAt(initialSelection.anchor),
        focus: markupView.sourcePositionAt(initialSelection.focus)
      })
      assertPosition(sourceSelection.anchor, revision.source.text.length)
      assertPosition(sourceSelection.focus, revision.source.text.length)
      this.#state = Object.freeze({
        session,
        id,
        revision,
        markupView,
        selection: freezeSelection(session, id, 'markup', initialSelection),
        sourceSelection: freezeSelection(
          session,
          id,
          'source',
          sourceSelection
        )
      })
    } else {
      assertPosition(initialSelection.anchor, revision.source.text.length)
      assertPosition(initialSelection.focus, revision.source.text.length)
      this.#state = Object.freeze({
        session,
        id,
        revision,
        selection: freezeSelection(session, id, 'source', initialSelection)
      })
    }
    if (recovery !== undefined) {
      if (
        !Number.isInteger(recovery.historyCursor) ||
        recovery.historyCursor < 0 ||
        recovery.historyCursor > recovery.history.length
      ) {
        throw new Error('Revision worker checkpoint has an invalid history cursor')
      }
      if (
        !Number.isInteger(recovery.historyIdentitySequence) ||
        recovery.historyIdentitySequence < 0 ||
        !Array.isArray(recovery.historyIdentities) ||
        recovery.historyIdentities.length !== recovery.history.length + 1 ||
        recovery.historyIdentities.some(
          (identity) => typeof identity !== 'string' || identity.length === 0
        ) ||
        new Set(recovery.historyIdentities).size !==
          recovery.historyIdentities.length ||
        typeof recovery.savedHistoryIdentity !== 'string' ||
        recovery.savedHistoryIdentity.length === 0
      ) {
        throw new Error(
          'Revision worker checkpoint has invalid history identities'
        )
      }
      this.#history = recovery.history.map((entry) => freezeHistoryEntry(entry))
      this.#historyCursor = recovery.historyCursor
      this.#savedIdentityLedger = createSavedIdentityLedger(
        String(session),
        Object.freeze({
          kind: 'recovered' as const,
          identities: recovery.historyIdentities,
          sourceHashes: recovery.historySourceHashes,
          sequence: recovery.historyIdentitySequence,
          savedIdentity: recovery.savedHistoryIdentity
        })
      )
    }
  }

  prepareDocumentFacts(
    revision: DocumentRevision = this.#state.revision
  ): void {
    materializeDocumentFacts(
      revision,
      nextLanguageEngineExecutionStage(this.#engine)
    )
  }

  get state(): WorkerState {
    return this.#state
  }

  get trackChanges(): boolean {
    return this.#trackChanges
  }

  sourceSelection(): SourceModelSelection {
    const state = this.#state
    return 'markupView' in state ? state.sourceSelection : state.selection
  }

  historyState(): DocumentHistoryState {
    // Dirty is the saved-identity module's content comparison, never a
    // position comparison performed here.
    return Object.freeze({
      canUndo: this.#historyCursor > 0,
      canRedo: this.#historyCursor < this.#history.length,
      dirty: this.#savedIdentityLedger.dirty(this.#state.revision.sourceHash),
      headIdentity: this.#savedIdentityLedger.identityAt(this.#historyCursor),
      savedIdentity: this.#savedIdentityLedger.savedIdentity()
    })
  }

  markPersisted(headIdentity: string): void {
    this.#savedIdentityLedger.markPersisted(headIdentity)
    // A saved identity names an exact recorded position; extending the run
    // would replace the head identity it points at.
    this.#openTypedRun = null
  }

  criticMarkupAuthoringCapabilities(): CriticMarkupAuthoringCapabilities {
    const state = this.#state
    if (!('markupView' in state)) {
      return Object.freeze({
        canCreateAddition: false,
        canCreateDeletion: false,
        canCreateSubstitution: false,
        canCreateHighlight: false,
        canCreateComment: false
      })
    }
    const from = Math.min(
      state.selection.anchor.offset,
      state.selection.focus.offset
    )
    const to = Math.max(
      state.selection.anchor.offset,
      state.selection.focus.offset
    )
    const start = this.#sourcePositionAt(
      state,
      Object.freeze({ offset: from, affinity: 'next' as const })
    )
    const end = from === to
      ? start
      : this.#sourcePositionAt(
        state,
        Object.freeze({ offset: to, affinity: 'previous' as const })
      )
    return criticMarkupAuthoringCapabilities(
      state.revision,
      Object.freeze({
        start: start.offset as SourceOffset,
        end: end.offset as SourceOffset
      })
    )
  }

  setTrackChanges(enabled: boolean): void {
    this.#trackChanges = enabled
  }

  checkpoint(): RevisionWorkerCheckpoint {
    return Object.freeze({
      session: this.#state.session,
      id: this.#state.id,
      source: this.#state.revision.source.text,
      sourceHash: this.#state.revision.sourceHash,
      semanticHash: this.#state.revision.semanticHash,
      configuration: this.#state.revision.configuration,
      selection: detachSelection(this.#state.selection),
      sourceSelection: detachSelection(this.sourceSelection()),
      trackChanges: this.#trackChanges,
      history: Object.freeze(this.#history.map((entry) => freezeHistoryEntry(entry))),
      historyCursor: this.#historyCursor,
      historyIdentities: this.#savedIdentityLedger.checkpoint().identities,
      historySourceHashes: this.#savedIdentityLedger.checkpoint().sourceHashes,
      historyIdentitySequence: this.#savedIdentityLedger.checkpoint().sequence,
      savedHistoryIdentity: this.#savedIdentityLedger.checkpoint().savedIdentity
    })
  }

  restore(checkpoint: RevisionWorkerCheckpoint): void {
    const revision = this.#engine.open(
      createSourceSnapshot(checkpoint.source),
      checkpoint.configuration
    )
    const restored = new RevisionWorker(
      this.#engine,
      checkpoint.session,
      checkpoint.id,
      revision,
      checkpoint.selection,
      checkpoint.trackChanges,
      checkpoint
    )
    this.#state = restored.#state
    this.#trackChanges = restored.#trackChanges
    this.#history = restored.#history
    this.#openTypedRun = null
    this.#historyCursor = restored.#historyCursor
    this.#savedIdentityLedger = restored.#savedIdentityLedger
  }

  /**
   * Reinterpret the exact head under a new closed parse configuration.
   *
   * This changes no source or history entry. Selection is carried through
   * parser-owned source coordinates whenever that boundary remains visible;
   * an option that hides the selected delimiter retains the same bounded
   * model offset rather than inventing a renderer-owned position.
   */
  reconfigure(configuration: ParseConfiguration): void {
    const previous = this.#state
    const sourceSelection = 'markupView' in previous
      ? previous.sourceSelection
      : previous.selection
    const anchorSource = sourceSelection.anchor
    const focusSource = sourceSelection.focus
    const revision = this.#engine.open(
      createSourceSnapshot(previous.revision.source.text),
      configuration
    )
    this.prepareDocumentFacts(revision)
    if (revision.kind === 'source-only') {
      this.#state = Object.freeze({
        session: previous.session,
        id: previous.id,
        revision,
        selection: freezeSelection(
          previous.session,
          previous.id,
          'source',
          Object.freeze({
            anchor: freezePosition(anchorSource),
            focus: freezePosition(focusSource)
          })
        )
      })
      return
    }
    const markupView = createMarkupView(revision)
    const mappedAnchor = markupView.modelPositionAt(anchorSource) ??
      freezePosition({
        offset: Math.min(
          previous.selection.anchor.offset,
          markupView.modelLength
        ),
        affinity: previous.selection.anchor.affinity
      })
    const mappedFocus = markupView.modelPositionAt(focusSource) ??
      freezePosition({
        offset: Math.min(
          previous.selection.focus.offset,
          markupView.modelLength
        ),
        affinity: previous.selection.focus.affinity
      })
    this.#state = Object.freeze({
      session: previous.session,
      id: previous.id,
      revision,
      markupView,
      selection: freezeSelection(
        previous.session,
        previous.id,
        'markup',
        Object.freeze({
          anchor: mappedAnchor,
          focus: mappedFocus
        })
      ),
      sourceSelection: freezeSelection(
        previous.session,
        previous.id,
        'source',
        Object.freeze({
          anchor: freezePosition(anchorSource),
          focus: freezePosition(focusSource)
        })
      )
    })
  }

  /**
   * Move the caret within the current revision.
   *
   * Selection is session state, not document state: the document did not
   * change, so this commits no revision and records no history. Positions are
   * validated like any other, because an offset outside the document is a
   * caller error rather than something to clamp silently.
   */
  moveSelection(selection: InitialModelSelection): void {
    this.#openTypedRun = null
    const state = this.#state
    if ('markupView' in state) {
      assertPosition(selection.anchor, state.markupView.modelLength)
      assertPosition(selection.focus, state.markupView.modelLength)
      this.#state = Object.freeze({
        ...state,
        selection: freezeSelection(state.session, state.id, 'markup', selection),
        sourceSelection: freezeSelection(
          state.session,
          state.id,
          'source',
          Object.freeze({
            anchor: this.#sourcePositionAt(state, selection.anchor),
            focus: this.#sourcePositionAt(state, selection.focus)
          })
        )
      })
      return
    }

    assertPosition(selection.anchor, state.revision.source.text.length)
    assertPosition(selection.focus, state.revision.source.text.length)
    this.#state = Object.freeze({
      ...state,
      selection: freezeSelection(state.session, state.id, 'source', selection)
    })
  }

  /**
   * Move the canonical-source selection while retaining the semantic view's
   * mapped selection for its hidden projection.
   */
  moveSourceSelection(selection: InitialModelSelection): void {
    this.#openTypedRun = null
    const state = this.#state
    const sourceLength = state.revision.source.text.length
    assertPosition(selection.anchor, sourceLength)
    assertPosition(selection.focus, sourceLength)
    if (!('markupView' in state)) {
      this.#state = Object.freeze({
        ...state,
        selection: freezeSelection(state.session, state.id, 'source', selection)
      })
      return
    }
    const anchor = modelPositionAtSemanticBoundary(
      state.markupView,
      selection.anchor
    )
    const focus = modelPositionAtSemanticBoundary(
      state.markupView,
      selection.focus
    )
    if (anchor === null || focus === null) {
      throw new Error('Source selection cannot map to the Markup projection')
    }
    this.#state = Object.freeze({
      ...state,
      selection: freezeSelection(
        state.session,
        state.id,
        'markup',
        Object.freeze({ anchor, focus })
      ),
      sourceSelection: freezeSelection(
        state.session,
        state.id,
        'source',
        selection
      )
    })
  }

  prepareReplacement(
    target: ModelSelection,
    text: string,
    next: RevisionId,
    sourceMode: 'semantic' | 'raw-source-import' = 'semantic'
  ): PreparedWorkerCommit {
    const edit = this.#replacementEdit(target, text, sourceMode)
    return this.#prepareEdit(edit, edit.start, target, next)
  }

  prepareCurrentMatchReplacement(
    target: ModelSelection,
    query: DocumentSearchQuery,
    replacement: string,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    assertSelection(target, state)
    if (typeof replacement !== 'string') {
      throw new IntentRejection('invalid-command-argument')
    }
    let decodedQuery: DocumentSearchQuery
    try {
      decodedQuery = decodeDocumentSearchQuery(query)
    } catch {
      throw new IntentRejection('invalid-command-argument')
    }
    if (decodedQuery.text.length === 0) {
      throw new IntentRejection('invalid-command-argument')
    }
    if (
      decodedQuery.syntax === 'literal' &&
      decodedQuery.caseSensitive &&
      decodedQuery.text === replacement
    ) {
      throw new IntentRejection('no-source-change')
    }
    const blocks = 'markupView' in state
      ? groupRenderBlocks(
        canonicalMarkupDocument(state.revision),
        Object.freeze(state.markupView.runs.map((run) => Object.freeze({
          key: run.key,
          text: run.text,
          elements: Object.freeze(run.marks.map(markupRenderElement)),
          modelRange: run.modelRange,
          sourceRange: run.sourceRange
        })))
      )
      : undefined
    let matches
    try {
      const executionControl =
        nextLanguageEngineExecutionStage(this.#engine)
      matches = blocks === undefined
        ? findSearchMatches(
          state.revision.source.text,
          decodedQuery,
          executionControl
        )
        : findMarkupSearchMatches(
          blocks,
          decodedQuery,
          executionControl
        )
    } catch (error) {
      if (error instanceof DocumentSearchQueryError) {
        throw new IntentRejection('invalid-command-argument')
      }
      throw error
    }
    if (matches.length === 0) {
      throw new IntentRejection('no-source-change')
    }
    if (
      replacement.length > 0 &&
      matches.length >
        Math.floor(
          DOCUMENT_SEARCH_RESOURCE_POLICY_V1
            .maximumGeneratedReplacementUnits /
          replacement.length
        )
    ) {
      throw new IntentRejection('invalid-command-argument')
    }
    const segments = blocks === undefined
      ? undefined
      : visibleReplacementSegments(blocks)
    const edits = matches.flatMap((match) => {
      const pieces = segments === undefined
        ? Object.freeze([Object.freeze({
          start: match.start,
          end: match.end,
          insertReplacement: true
        })])
        : visibleReplacementPieces(segments, match)
      return pieces.map((piece) => this.#replacementEdit(
        Object.freeze({
          ...target,
          anchor: Object.freeze({
            offset: piece.start,
            affinity: 'next' as const
          }),
          focus: Object.freeze({
            offset: piece.end,
            affinity: 'previous' as const
          })
        }),
        piece.insertReplacement ? replacement : ''
      ))
    }).sort((left, right) => left.start - right.start || left.end - right.end)
    for (let index = 1; index < edits.length; index += 1) {
      const previous = edits[index - 1]
      const current = edits[index]
      if (
        previous === undefined ||
        current === undefined ||
        current.start < previous.end
      ) {
        throw new IntentRejection('invalid-command-argument')
      }
    }
    return this.#prepareMappedEdits(Object.freeze(edits), target, next)
  }

  #replacementEdit(
    target: ModelSelection,
    text: string,
    sourceMode: 'semantic' | 'raw-source-import' = 'semantic'
  ): SourceEdit {
    const state = this.#state
    assertSelection(target, state)
    const from = Math.min(target.anchor.offset, target.focus.offset)
    const to = Math.max(target.anchor.offset, target.focus.offset)
    if (from === to && text.length === 0) {
      throw new IntentRejection('selection-collapsed')
    }
    const sourceStart = this.#sourcePositionAt(
      state,
      Object.freeze({ offset: from, affinity: 'next' as const })
    )
    const sourceEnd = from === to
      ? sourceStart
      : this.#sourcePositionAt(
        state,
        Object.freeze({ offset: to, affinity: 'previous' as const })
      )
    const removed = state.revision.source.text.slice(
      sourceStart.offset,
      sourceEnd.offset
    )
    if (
      state.revision.kind === 'complete' &&
      sourceStart.offset < sourceEnd.offset &&
      hiddenCommentOverlaps(
        state.revision,
        sourceStart.offset,
        sourceEnd.offset
      )
    ) {
      throw new IntentRejection('hidden-comment-loss')
    }
    const carrier =
      state.revision.kind === 'complete'
        ? trackCarrierContext(
          state.revision,
          sourceStart.offset,
          sourceEnd.offset
        )
        : Object.freeze({ policy: 'plain' as const, depth: -1 })
    if (this.#trackChanges && carrier.policy === 'read-only') {
      throw new IntentRejection('read-only-change-arm')
    }
    const exhaustedHighlight =
      state.revision.kind === 'complete' && text.length === 0
        ? exhaustedHighlightAt(
          state.revision,
          sourceStart.offset,
          sourceEnd.offset
        )
        : undefined
    if (
      state.revision.kind === 'complete' &&
      exhaustedHighlight !== undefined
    ) {
      const edit = exhaustedHighlightEdit(
        state.revision,
        exhaustedHighlight,
        sourceStart.offset,
        sourceEnd.offset,
        this.#trackChanges &&
          carrier.policy === 'stable' &&
          carrier.node?.nodeId === exhaustedHighlight.node.nodeId
      )
      return edit
    }
    const oldOpaque =
      state.revision.kind === 'complete'
        ? payloadOpaqueRanges(
          state.revision,
          sourceStart.offset,
          sourceEnd.offset
        )
        : Object.freeze([])
    const insert = !this.#trackChanges
      ? text
      : carrier.policy === 'direct'
        ? sourceMode === 'raw-source-import'
          ? text
          : escapeDirectCarrierText(text, carrier)
        : from === to
          ? serializeAddition(text)
          : text.length === 0
            ? serializeDeletion(removed, oldOpaque)
            : serializeSubstitution(removed, text, oldOpaque)
    const edit = Object.freeze({
      start: sourceStart.offset,
      end: sourceEnd.offset,
      insert
    })
    return edit
  }

  prepareDeletion(target: ModelSelection, next: RevisionId): PreparedWorkerCommit {
    const state = this.#state
    assertSelection(target, state)
    if (target.anchor.offset === target.focus.offset) {
      // Removing nothing is not an edit; say so instead of committing a
      // revision that leaves the document identical.
      throw new IntentRejection('selection-collapsed')
    }
    const from = Math.min(target.anchor.offset, target.focus.offset)
    const to = Math.max(target.anchor.offset, target.focus.offset)
    const sourceStart = this.#sourcePositionAt(
      state,
      Object.freeze({ offset: from, affinity: 'next' as const })
    )
    const sourceEnd = this.#sourcePositionAt(
      state,
      Object.freeze({ offset: to, affinity: 'previous' as const })
    )
    const carrier =
      state.revision.kind === 'complete'
        ? trackCarrierContext(
          state.revision,
          sourceStart.offset,
          sourceEnd.offset
        )
        : Object.freeze({ policy: 'plain' as const, depth: -1 })
    const fullStableHighlight =
      carrier.policy === 'stable' &&
      carrier.node?.kind === 'highlight' &&
      carrier.arm !== undefined &&
      sourceStart.offset === Number(carrier.arm.range.start) &&
      sourceEnd.offset === Number(carrier.arm.range.end)
    const exhaustedHighlight =
      state.revision.kind === 'complete'
        ? exhaustedHighlightAt(
          state.revision,
          sourceStart.offset,
          sourceEnd.offset
        )
        : undefined
    if (
      state.revision.kind === 'complete' &&
      hiddenCommentOverlaps(
        state.revision,
        sourceStart.offset,
        sourceEnd.offset
      )
    ) {
      throw new IntentRejection('hidden-comment-loss')
    }
    if (this.#trackChanges && carrier.policy === 'read-only') {
      throw new IntentRejection('read-only-change-arm')
    }
    if (
      state.revision.kind === 'complete' &&
      exhaustedHighlight !== undefined
    ) {
      const edit = exhaustedHighlightEdit(
        state.revision,
        exhaustedHighlight,
        sourceStart.offset,
        sourceEnd.offset,
        this.#trackChanges &&
          carrier.policy === 'stable' &&
          carrier.node?.nodeId === exhaustedHighlight.node.nodeId
      )
      return this.#prepareEdit(
        edit,
        edit.start,
        target,
        next
      )
    }
    if (fullStableHighlight && carrier.node !== undefined) {
      const nodeStart = Number(carrier.node.range.start)
      const nodeEnd = Number(carrier.node.range.end)
      const nodeSource = state.revision.source.text.slice(nodeStart, nodeEnd)
      return this.#prepareEdit(
        Object.freeze({
          start: nodeStart,
          end: nodeEnd,
          insert:
            this.#trackChanges
              ? serializeDeletion(
                nodeSource,
                Object.freeze([{ start: 0, end: nodeSource.length }])
              )
              : ''
        }),
        nodeStart,
        target,
        next
      )
    }
    const removed = state.revision.source.text.slice(
      sourceStart.offset,
      sourceEnd.offset
    )
    const opaque =
      state.revision.kind === 'complete'
        ? payloadOpaqueRanges(
          state.revision,
          sourceStart.offset,
          sourceEnd.offset
        )
        : Object.freeze([])
    const edit = Object.freeze({
      start: sourceStart.offset,
      end: sourceEnd.offset,
      insert:
        this.#trackChanges &&
        carrier.policy !== 'direct' &&
        carrier.policy !== 'stable'
          ? serializeDeletion(removed, opaque)
          : ''
    })
    return this.#prepareEdit(edit, sourceStart.offset, target, next)
  }

  prepareInsertion(
    target: ModelSelection,
    text: string,
    next: RevisionId,
    sourceMode: 'semantic' | 'raw-source-import' = 'semantic',
    coalescible = false
  ): PreparedWorkerCommit {
    const state = this.#state
    assertCollapsedSelection(target, state)
    if (text.length === 0) {
      throw new Error('Empty insertion is an explicit no-op, not a source commit')
    }

    const sourceTarget = this.#sourcePositionAt(state, target.anchor)
    const carrier =
      state.revision.kind === 'complete'
        ? trackCarrierContext(
          state.revision,
          sourceTarget.offset,
          sourceTarget.offset
        )
        : Object.freeze({ policy: 'plain' as const, depth: -1 })
    if (this.#trackChanges && carrier.policy === 'read-only') {
      throw new IntentRejection('read-only-change-arm')
    }
    const edit = Object.freeze({
      start: sourceTarget.offset,
      end: sourceTarget.offset,
      insert:
        !this.#trackChanges
          ? text
          : carrier.policy !== 'direct'
            ? serializeAddition(text)
            : sourceMode === 'raw-source-import'
              ? text
              : escapeDirectCarrierText(text, carrier)
    })
    return this.#prepareEdit(
      edit,
      sourceTarget.offset,
      target,
      next,
      undefined,
      coalescible && edit.start === edit.end && [...edit.insert].length === 1
    )
  }

  prepareFormatting(
    target: ModelSelection,
    format: InlineFormat,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const from = Math.min(target.anchor.offset, target.focus.offset)
    const to = Math.max(target.anchor.offset, target.focus.offset)
    if (from === to) {
      throw new IntentRejection('selection-collapsed')
    }
    const sourceStart = this.#sourcePositionAt(
      state,
      Object.freeze({ offset: from, affinity: 'next' as const })
    )
    const sourceEnd = this.#sourcePositionAt(
      state,
      Object.freeze({ offset: to, affinity: 'previous' as const })
    )
    const carrier = trackCarrierContext(
      state.revision,
      sourceStart.offset,
      sourceEnd.offset
    )
    if (this.#trackChanges && carrier.policy === 'read-only') {
      throw new IntentRejection('read-only-change-arm')
    }
    if (format === 'clear') {
      let openStart = sourceStart.offset
      let closeEnd = sourceEnd.offset
      let removed = false
      while (true) {
        const pair = INLINE_FORMAT_MATCH_ORDER
          .map((candidate) => inlineFormatMarkerPair(
            state.revision.source.text,
            openStart,
            closeEnd,
            candidate
          ))
          .find((candidate) => candidate !== undefined)
        if (pair === undefined) {
          break
        }
        openStart = pair.openStart
        closeEnd = pair.closeEnd
        removed = true
      }
      if (!removed) {
        throw new IntentRejection('no-source-change')
      }
      const source = state.revision.source.text
      const open = source.slice(openStart, sourceStart.offset)
      const close = source.slice(sourceEnd.offset, closeEnd)
      return this.#prepareMappedEdits(
        Object.freeze([
          Object.freeze({
            start: openStart,
            end: sourceStart.offset,
            insert: this.#trackChanges ? serializeDeletion(open) : ''
          }),
          Object.freeze({
            start: sourceEnd.offset,
            end: closeEnd,
            insert: this.#trackChanges ? serializeDeletion(close) : ''
          })
        ]),
        target,
        next
      )
    }
    const active = inlineFormatMarkerPair(
      state.revision.source.text,
      sourceStart.offset,
      sourceEnd.offset,
      format
    )
    if (active !== undefined) {
      const source = state.revision.source.text
      const open = source.slice(active.openStart, sourceStart.offset)
      const close = source.slice(sourceEnd.offset, active.closeEnd)
      return this.#prepareMappedEdits(
        Object.freeze([
          Object.freeze({
            start: active.openStart,
            end: sourceStart.offset,
            insert: this.#trackChanges ? serializeDeletion(open) : ''
          }),
          Object.freeze({
            start: sourceEnd.offset,
            end: active.closeEnd,
            insert: this.#trackChanges ? serializeDeletion(close) : ''
          })
        ]),
        target,
        next
      )
    }
    const [open, close] = INLINE_FORMAT_DELIMITERS[format]
    const openInsert =
      this.#trackChanges && carrier.policy !== 'direct'
        ? serializeAddition(open)
        : open
    const closeInsert =
      this.#trackChanges && carrier.policy !== 'direct'
        ? serializeAddition(close)
        : close
    return this.#prepareMappedEdits(
      Object.freeze([
        Object.freeze({
          start: sourceStart.offset,
          end: sourceStart.offset,
          insert: openInsert
        }),
        Object.freeze({
          start: sourceEnd.offset,
          end: sourceEnd.offset,
          insert: closeInsert
        })
      ]),
      target,
      next
    )
  }

  prepareStructureReplacement(
    target: ModelSelection,
    replacement: string,
    next: RevisionId,
    historyTarget: ModelSelection = target,
    caretOffsetWithinReplacement?: number,
    replacementOpaqueRanges: readonly OpaqueRange[] = Object.freeze([])
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const from = Math.min(target.anchor.offset, target.focus.offset)
    const to = Math.max(target.anchor.offset, target.focus.offset)
    if (from === to) {
      throw new IntentRejection('selection-collapsed')
    }
    const mappedSourceStart = this.#sourcePositionAt(
      state,
      Object.freeze({ offset: from, affinity: 'next' as const })
    )
    const mappedSourceEnd = this.#sourcePositionAt(
      state,
      Object.freeze({ offset: to, affinity: 'previous' as const })
    )
    const sourceRange = completeStructuralSourceRange(
      state.revision,
      mappedSourceStart.offset,
      mappedSourceEnd.offset
    )
    const removed = state.revision.source.text.slice(
      sourceRange.start,
      sourceRange.end
    )
    if (
      hiddenCommentOverlaps(
        state.revision,
        sourceRange.start,
        sourceRange.end
      )
    ) {
      throw new IntentRejection('hidden-comment-loss')
    }
    const carrier = trackCarrierContext(
      state.revision,
      sourceRange.start,
      sourceRange.end
    )
    if (this.#trackChanges && carrier.policy === 'read-only') {
      throw new IntentRejection('read-only-change-arm')
    }
    const exhaustedHighlight =
      replacement.length === 0
        ? exhaustedHighlightAt(
          state.revision,
          sourceRange.start,
          sourceRange.end
        )
        : undefined
    if (exhaustedHighlight !== undefined) {
      const edit = exhaustedHighlightEdit(
        state.revision,
        exhaustedHighlight,
        sourceRange.start,
        sourceRange.end,
        this.#trackChanges &&
          carrier.policy === 'stable' &&
          carrier.node?.nodeId === exhaustedHighlight.node.nodeId
      )
      return this.#prepareEdit(edit, edit.start, historyTarget, next)
    }
    const opaque = payloadOpaqueRanges(
      state.revision,
      sourceRange.start,
      sourceRange.end
    )
    const insert =
      this.#trackChanges && carrier.policy !== 'direct'
        ? removed.length === 0
          ? serializeAddition(replacement, replacementOpaqueRanges)
          : replacement.length === 0
            ? serializeDeletion(removed, opaque)
            : `${serializeDeletion(removed, opaque)}${serializeAddition(
              replacement,
              replacementOpaqueRanges
            )}`
        : replacement
    const explicitCaretSourceOffset =
      caretOffsetWithinReplacement === undefined ||
      (this.#trackChanges && carrier.policy !== 'direct')
        ? undefined
        : sourceRange.start + caretOffsetWithinReplacement
    return this.#prepareEdit(
      Object.freeze({
        start: sourceRange.start,
        end: sourceRange.end,
        insert
      }),
      sourceRange.start,
      historyTarget,
      next,
      explicitCaretSourceOffset
    )
  }

  prepareBlockConversion(
    target: ModelSelection,
    conversion: BlockConversion,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const from = Math.min(target.anchor.offset, target.focus.offset)
    const to = Math.max(target.anchor.offset, target.focus.offset)
    const document = state.revision.projection('editing').markdown
    const root = document.root
    const blocks = Array.from(
      { length: root.childCount },
      (_, ordinal) => root.childAt(ordinal)
    )
    const selectedBlocks =
      from === to
        ? [
          blocks.find((candidate) =>
            from >= candidate.range.start && from < candidate.range.end
          ) ??
          blocks.find((candidate) => from === candidate.range.end)
        ].filter((block): block is MarkdownNode => block !== undefined)
        : blocks.filter((candidate) =>
          candidate.range.end > from && candidate.range.start < to
        )
    const completeSource = state.revision.source.text
    const eol = completeSource.includes('\r\n')
      ? '\r\n'
      : completeSource.includes('\r')
        ? '\r'
        : '\n'
    if (selectedBlocks.length === 0) {
      if (
        from === to &&
        blocks.length === 0 &&
        completeSource.trim().length === 0 &&
        (
          conversion.kind === 'code-block' ||
          conversion.kind === 'blockquote' ||
          conversion.kind === 'thematic-break'
        )
      ) {
        const trailingEol =
          completeSource.endsWith('\n') || completeSource.endsWith('\r')
            ? eol
            : ''
        const replacement = conversion.kind === 'code-block'
          ? `\`\`\`${eol}${eol}\`\`\`${trailingEol}`
          : conversion.kind === 'blockquote'
            ? `> ${trailingEol}`
            : `---${trailingEol}`
        const wholeDocumentTarget = Object.freeze({
          ...target,
          anchor: Object.freeze({
            offset: 0,
            affinity: 'next' as const
          }),
          focus: Object.freeze({
            offset: state.markupView.modelLength,
            affinity: 'previous' as const
          })
        })
        return this.prepareStructureReplacement(
          wholeDocumentTarget,
          replacement,
          next
        )
      }
      throw new IntentRejection('target-not-found')
    }
    const stripLinePrefixes = (
      text: string,
      pattern: RegExp
    ): string => text
      .split(/(\r\n|\r|\n)/)
      .map((part, index) =>
        index % 2 === 0 ? part.replace(pattern, '') : part)
      .join('')
    // Parser-emitted inline content extent of a block, as exact canonical
    // source: the model range spanned by the first and last inline child,
    // mapped through the same position authority as the block extent itself.
    const inlineContentSlice = (block: MarkdownNode): string => {
      if (block.childCount === 0) {
        return ''
      }
      const first = block.childAt(0)
      const last = block.childAt(block.childCount - 1)
      const start = this.#sourcePositionAt(state, Object.freeze({
        offset: first.range.start,
        affinity: 'next' as const
      }))
      const end = this.#sourcePositionAt(state, Object.freeze({
        offset: last.range.end,
        affinity: 'previous' as const
      }))
      return completeSource.slice(start.offset, end.offset)
    }
    // Parser-emitted content extent (contentStart/contentEnd attributes) of
    // a literal block, as exact canonical source with the extent's trailing
    // line ending removed — the emitted extent runs to the end of the last
    // interior line, and a conversion payload is the content alone.
    const emittedContentSlice = (block: MarkdownNode): string | null => {
      const contentStart = block.attributes['contentStart']
      const contentEnd = block.attributes['contentEnd']
      if (
        typeof contentStart !== 'number' ||
        typeof contentEnd !== 'number' ||
        contentEnd < contentStart
      ) {
        return null
      }
      if (contentStart === contentEnd) {
        return ''
      }
      const start = this.#sourcePositionAt(state, Object.freeze({
        offset: contentStart,
        affinity: 'next' as const
      }))
      const end = this.#sourcePositionAt(state, Object.freeze({
        offset: contentEnd,
        affinity: 'previous' as const
      }))
      return completeSource
        .slice(start.offset, end.offset)
        .replace(/(?:\r\n|\r|\n)$/, '')
    }
    // Container payload from the parser-emitted line index: each line's
    // content begins at its emitted contentOffset — past every blockquote
    // and list prefix the grammar recognized — so no expression here
    // re-derives a marker (non-negotiable 2). Task markers are content-side
    // per the grammar, so each task item's emitted marker extent is
    // excluded, along with one following space.
    const containerPayload = (block: MarkdownNode): string => {
      const exclusions: Array<Readonly<{ start: number; end: number }>> = []
      const collectTaskMarkers = (node: MarkdownNode): void => {
        const markerStart = node.attributes['taskMarkerStart']
        const markerEnd = node.attributes['taskMarkerEnd']
        if (
          node.attributes['task'] === true &&
          typeof markerStart === 'number' &&
          typeof markerEnd === 'number'
        ) {
          exclusions.push(Object.freeze({ start: markerStart, end: markerEnd }))
        }
        for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
          collectTaskMarkers(node.childAt(ordinal))
        }
      }
      collectTaskMarkers(block)
      exclusions.sort((left, right) => left.start - right.start)
      const sourceSlice = (from: number, to: number): string => {
        if (to <= from) {
          return ''
        }
        const start = this.#sourcePositionAt(state, Object.freeze({
          offset: from,
          affinity: 'next' as const
        }))
        const end = this.#sourcePositionAt(state, Object.freeze({
          offset: to,
          affinity: 'previous' as const
        }))
        return completeSource.slice(start.offset, end.offset)
      }
      const index = document.lines
      const pieces: string[] = []
      for (let ordinal = 0; ordinal < index.count; ordinal += 1) {
        const line = index.at(ordinal)
        if (line.end <= block.range.start) {
          continue
        }
        if (line.start >= block.range.end) {
          break
        }
        let cursor = Math.max(line.contentOffset, block.range.start)
        const lineEnd = Math.min(line.end, block.range.end)
        for (const exclusion of exclusions) {
          if (exclusion.end <= cursor || exclusion.start >= lineEnd) {
            continue
          }
          pieces.push(sourceSlice(cursor, exclusion.start))
          cursor = exclusion.end
          // The grammar's task marker ends at `]`; the separating space the
          // author typed after it belongs to the marker in a conversion.
          const following = sourceSlice(cursor, cursor + 1)
          if (following === ' ' || following === '\t') {
            cursor += 1
          }
        }
        pieces.push(sourceSlice(cursor, lineEnd))
      }
      return pieces.join('')
    }
    const paragraphPayload = (
      block: MarkdownNode,
      source: string
    ): string => {
      if (block.kind === 'heading') {
        // The parser emits the heading's inline content extent for both
        // spellings; the markers — an ATX prefix or a setext underline —
        // are what the conversion discards. Content lines join with a
        // space so the replacement stays one block: re-lexing here kept a
        // setext underline in the payload and committed a document whose
        // reparse held a heading plus a leftover paragraph or an injected
        // thematic break (G29).
        return inlineContentSlice(block).split(/\r\n|\r|\n/).join(' ')
      }
      if (block.kind === 'blockquote' || block.kind === 'list') {
        return containerPayload(block)
      }
      // A line-based literal block's extent may run through its final line
      // ending; the payload keeps that spelling so the block behind it stays
      // separate.
      const trailingEol = /(\r\n|\r|\n)$/.exec(source)?.[1] ?? ''
      const body = trailingEol === ''
        ? source
        : source.slice(0, -trailingEol.length)
      if (block.kind === 'html-block') {
        // Unwrapping the editor's own authored `<div>` carrier is not
        // Markdown recognition; any other HTML stays raw.
        const wrapper = /^<div>[ \t]*(?:\r\n|\r|\n)([\s\S]*)(?:\r\n|\r|\n)<\/div>[ \t]*$/.exec(body)
        return (wrapper?.[1] ?? body) + trailingEol
      }
      if (
        block.kind === 'code-block' ||
        block.kind === 'math-block' ||
        block.kind === 'front-matter'
      ) {
        // Literal blocks carry their parser-emitted content extent; an
        // indented code block has no delimiter lines, so its extent spans
        // the indented lines and the per-line indent is stripped here.
        const emitted = emittedContentSlice(block)
        if (emitted !== null) {
          const payload = block.kind === 'code-block' &&
            block.attributes['provider'] === 'indented-code'
            ? stripLinePrefixes(emitted, /^(?: {4}|\t)/)
            : emitted
          return payload + trailingEol
        }
        return trailingEol
      }
      if (block.kind === 'thematic-break') {
        return ''
      }
      return source
    }
    const replacementFor = (
      block: MarkdownNode,
      source: string
    ): string => {
      const payload = paragraphPayload(block, source)
      if (conversion.kind === 'heading') {
        return `${'#'.repeat(conversion.level)} ${payload}`
      }
      if (conversion.kind === 'blockquote') {
        return block.kind === 'blockquote'
          ? payload
          : payload
            .split(/(\r\n|\r|\n)/)
            .map((part, index) => index % 2 === 0 && part.length > 0
              ? `> ${part}`
              : part)
            .join('')
      }
      if (conversion.kind === 'paragraph') {
        return payload
      }
      if (conversion.kind === 'heading-shift') {
        if (block.kind !== 'heading') {
          throw new IntentRejection('wrong-target-kind')
        }
        const current = Number(block.attributes.level)
        const level = Math.max(
          1,
          Math.min(
            6,
            current + (conversion.direction === 'promote' ? -1 : 1)
          )
        ) as 1 | 2 | 3 | 4 | 5 | 6
        return `${'#'.repeat(level)} ${payload}`
      }
      if (
        conversion.kind === 'unordered-list' ||
        conversion.kind === 'ordered-list' ||
        conversion.kind === 'task-list'
      ) {
        // The grammar emits task recognition per item; the first item's
        // fact decides the list's current form, as the old first-line
        // re-lex did.
        const sourceIsTask = block.kind === 'list' &&
          block.childCount > 0 &&
          block.childAt(0).attributes['task'] === true
        const sourceIsOrdered = block.kind === 'list' &&
          block.attributes.ordered === true
        const sourceIsUnordered = block.kind === 'list' && !sourceIsOrdered
        const toggles =
          (conversion.kind === 'task-list' && sourceIsTask) ||
          (
            conversion.kind === 'ordered-list' &&
            sourceIsOrdered
          ) ||
          (
            conversion.kind === 'unordered-list' &&
            sourceIsUnordered &&
            !sourceIsTask
          )
        if (toggles) {
          return payload
        }
        let ordinal = 0
        const marker = (): string => {
          if (conversion.kind === 'task-list') return '- [ ] '
          if (conversion.kind === 'unordered-list') return '- '
          ordinal += 1
          return `${String(ordinal)}. `
        }
        return payload
          .split(/(\r\n|\r|\n)/)
          .map((part, index) =>
            index % 2 === 0 && part.length > 0
              ? `${marker()}${part}`
              : part)
          .join('')
      }
      if (conversion.kind === 'loose-list-item') {
        if (block.kind !== 'list') {
          throw new IntentRejection('wrong-target-kind')
        }
        // A toggle, applied at every inter-item gap the parser emitted: a
        // loose list (any blank line inside a gap, per the line index)
        // tightens by collapsing each gap to its first line ending; a tight
        // list loosens by inserting one blank at each gap. No expression
        // here recognizes a marker — the gaps are the extents between
        // consecutive emitted list items.
        const items: MarkdownNode[] = []
        for (let ordinal = 0; ordinal < block.childCount; ordinal += 1) {
          const child = block.childAt(ordinal)
          if (child.kind === 'list-item') {
            items.push(child)
          }
        }
        const index = document.lines
        const gaps: Array<Readonly<{ start: number; end: number }>> = []
        for (let ordinal = 1; ordinal < items.length; ordinal += 1) {
          const previous = items[ordinal - 1]
          const nextItem = items[ordinal]
          if (previous !== undefined && nextItem !== undefined) {
            gaps.push(Object.freeze({
              start: previous.range.end,
              end: nextItem.range.start
            }))
          }
        }
        const blankInside = (gap: Readonly<{
          start: number
          end: number
        }>): boolean => {
          for (let ordinal = 0; ordinal < index.count; ordinal += 1) {
            const line = index.at(ordinal)
            if (line.end <= gap.start) {
              continue
            }
            if (line.start >= gap.end) {
              return false
            }
            if (line.blank) {
              return true
            }
          }
          return false
        }
        const loose = gaps.some(blankInside)
        const blockStart = this.#sourcePositionAt(state, Object.freeze({
          offset: block.range.start,
          affinity: 'next' as const
        })).offset
        let rebuilt = ''
        let cursor = 0
        for (const gap of gaps) {
          const gapStart = this.#sourcePositionAt(state, Object.freeze({
            offset: gap.start,
            affinity: 'next' as const
          })).offset - blockStart
          const gapEnd = this.#sourcePositionAt(state, Object.freeze({
            offset: gap.end,
            affinity: 'previous' as const
          })).offset - blockStart
          if (gapEnd <= gapStart || gapStart < cursor) {
            continue
          }
          const gapText = source.slice(gapStart, gapEnd)
          const terminator =
            /\r\n|\r(?!\n)|\n/.exec(gapText)?.[0] ?? eol
          rebuilt += source.slice(cursor, gapStart)
          rebuilt += loose ? terminator : `${terminator}${eol}`
          cursor = gapEnd
        }
        rebuilt += source.slice(cursor)
        return rebuilt
      }
      if (conversion.kind === 'code-block') {
        return block.kind === 'code-block'
          ? payload
          : `\`\`\`${eol}${payload}${eol}\`\`\``
      }
      if (conversion.kind === 'math-block') {
        return block.kind === 'math-block'
          ? payload
          : `$$${eol}${payload}${eol}$$`
      }
      if (conversion.kind === 'html-block') {
        return block.kind === 'html-block'
          ? payload
          : `<div>${eol}${payload}${eol}</div>`
      }
      if (conversion.kind === 'thematic-break') {
        return '---'
      }
      if (conversion.kind === 'front-matter') {
        if (block.range.start !== 0) {
          throw new IntentRejection('wrong-target-kind')
        }
        return block.kind === 'front-matter'
          ? payload
          : `---${eol}${payload}${eol}---`
      }
      throw new IntentRejection('target-not-found')
    }
    const transformations = selectedBlocks.map((block) => {
      const blockTarget = Object.freeze({
        ...target,
        anchor: Object.freeze({
          offset: block.range.start,
          affinity: 'next' as const
        }),
        focus: Object.freeze({
          offset: block.range.end,
          affinity: 'previous' as const
        })
      })
      const sourceStart = this.#sourcePositionAt(state, blockTarget.anchor)
      const sourceEnd = this.#sourcePositionAt(state, blockTarget.focus)
      const source = completeSource.slice(sourceStart.offset, sourceEnd.offset)
      return Object.freeze({
        target: blockTarget,
        sourceStart,
        sourceEnd,
        source,
        replacement: replacementFor(block, source)
      })
    })
    const [transformation] = transformations
    if (transformations.length === 1 && transformation !== undefined) {
      return this.prepareStructureReplacement(
        transformation.target,
        transformation.replacement,
        next
      )
    }
    const edits = transformations.map((transformation): SourceEdit => {
      const { sourceStart, sourceEnd, source, replacement } = transformation
      if (
        hiddenCommentOverlaps(
          state.revision,
          sourceStart.offset,
          sourceEnd.offset
        )
      ) {
        throw new IntentRejection('hidden-comment-loss')
      }
      const carrier = trackCarrierContext(
        state.revision,
        sourceStart.offset,
        sourceEnd.offset
      )
      if (this.#trackChanges && carrier.policy === 'read-only') {
        throw new IntentRejection('read-only-change-arm')
      }
      const exhaustedHighlight =
        replacement.length === 0
          ? exhaustedHighlightAt(
            state.revision,
            sourceStart.offset,
            sourceEnd.offset
          )
          : undefined
      if (exhaustedHighlight !== undefined) {
        return exhaustedHighlightEdit(
          state.revision,
          exhaustedHighlight,
          sourceStart.offset,
          sourceEnd.offset,
          this.#trackChanges &&
            carrier.policy === 'stable' &&
            carrier.node?.nodeId === exhaustedHighlight.node.nodeId
        )
      }
      const opaque = payloadOpaqueRanges(
        state.revision,
        sourceStart.offset,
        sourceEnd.offset
      )
      const insert =
        this.#trackChanges && carrier.policy !== 'direct'
          ? `${serializeDeletion(source, opaque)}${serializeAddition(replacement)}`
          : replacement
      return Object.freeze({
        start: sourceStart.offset,
        end: sourceEnd.offset,
        insert
      })
    })
    return this.#prepareMappedEdits(Object.freeze(edits), target, next)
  }

  prepareQuickInsertBlock(
    target: ModelSelection,
    insertion: QuickInsertBlock,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const from = Math.min(target.anchor.offset, target.focus.offset)
    const to = Math.max(target.anchor.offset, target.focus.offset)
    if (from !== to) {
      throw new IntentRejection('selection-not-collapsed')
    }

    const document = state.revision.projection('editing').markdown
    const root = document.root
    const source = state.revision.source.text
    const emptyDocument = source.trim().length === 0
    const block = Array.from(
      { length: root.childCount },
      (_, ordinal) => root.childAt(ordinal)
    ).find((candidate) =>
      candidate.kind === 'paragraph' &&
      from >= candidate.range.start &&
      from <= candidate.range.end
    )
    if (block === undefined && !emptyDocument) {
      throw new IntentRejection('wrong-target-kind')
    }
    const query = block === undefined
      ? ''
      : document.source.slice(block.range.start, block.range.end).trim()
    if (!emptyDocument && !/^[/、]\S*$/u.test(query)) {
      throw new IntentRejection('wrong-target-kind')
    }

    const eol = source.includes('\r\n')
      ? '\r\n'
      : source.includes('\r')
        ? '\r'
        : '\n'
    if (
      insertion.kind === 'conversion' &&
      (
        (
          insertion.conversion.kind === 'front-matter' &&
          !state.revision.configuration.markdownOptions.frontMatter
        ) ||
        (
          insertion.conversion.kind === 'math-block' &&
          !state.revision.configuration.markdownOptions.math
        )
      )
    ) {
      throw new IntentRejection('invalid-command-argument')
    }
    const replacementAndCaret = (() => {
      if (insertion.kind === 'diagram') {
        const replacement =
          `\`\`\`${insertion.language}${eol}${eol}\`\`\``
        return Object.freeze({
          replacement,
          caret: 3 + insertion.language.length + eol.length
        })
      }
      if (insertion.kind === 'table') {
        if (
          !state.revision.configuration.markdownOptions.gfm ||
          !validTableShape(insertion.rows, insertion.columns)
        ) {
          throw new IntentRejection('invalid-command-argument')
        }
        return Object.freeze({
          replacement: blankGfmTable(
            insertion.rows,
            insertion.columns,
            eol
          ),
          caret: 2
        })
      }
      const conversion = insertion.conversion
      if (conversion.kind === 'heading') {
        const replacement = `${'#'.repeat(conversion.level)} `
        return Object.freeze({ replacement, caret: replacement.length })
      }
      if (conversion.kind === 'paragraph') {
        return Object.freeze({ replacement: '', caret: 0 })
      }
      if (conversion.kind === 'blockquote') {
        return Object.freeze({ replacement: '> ', caret: 2 })
      }
      if (conversion.kind === 'unordered-list') {
        return Object.freeze({ replacement: '- ', caret: 2 })
      }
      if (conversion.kind === 'ordered-list') {
        return Object.freeze({ replacement: '1. ', caret: 3 })
      }
      if (conversion.kind === 'task-list') {
        return Object.freeze({ replacement: '- [ ] ', caret: 6 })
      }
      if (conversion.kind === 'code-block') {
        return Object.freeze({
          replacement: `\`\`\`${eol}${eol}\`\`\``,
          caret: 3 + eol.length
        })
      }
      if (conversion.kind === 'math-block') {
        return Object.freeze({
          replacement: `$$${eol}${eol}$$`,
          caret: 2 + eol.length
        })
      }
      if (conversion.kind === 'html-block') {
        return Object.freeze({
          replacement: `<div>${eol}${eol}</div>`,
          caret: 5 + eol.length
        })
      }
      if (conversion.kind === 'thematic-break') {
        return Object.freeze({ replacement: '---', caret: 3 })
      }
      if (
        conversion.kind === 'front-matter' &&
        (emptyDocument || block?.range.start === 0)
      ) {
        return Object.freeze({
          replacement: `---${eol}${eol}---`,
          caret: 3 + eol.length
        })
      }
      throw new IntentRejection('wrong-target-kind')
    })()
    const trailingEol =
      emptyDocument && (source.endsWith('\n') || source.endsWith('\r'))
        ? eol
        : ''
    const replacement = replacementAndCaret.replacement + trailingEol
    const caretOffsetWithinReplacement = replacementAndCaret.caret

    if (emptyDocument && source.length === 0 && replacement.length > 0) {
      const insert = this.#trackChanges
        ? serializeAddition(replacement)
        : replacement
      return this.#prepareEdit(
        Object.freeze({ start: 0, end: 0, insert }),
        0,
        target,
        next,
        caretOffsetWithinReplacement + (this.#trackChanges ? 3 : 0)
      )
    }

    const blockTarget = emptyDocument
      ? Object.freeze({
        ...target,
        anchor: Object.freeze({ offset: 0, affinity: 'next' as const }),
        focus: Object.freeze({
          offset: state.markupView.modelLength,
          affinity: 'previous' as const
        })
      })
      : (() => {
        if (block === undefined) {
          throw new Error('Quick Insert block target invariant was violated')
        }
        return Object.freeze({
          ...target,
          anchor: Object.freeze({
            offset: block.range.start,
            affinity: 'next' as const
          }),
          focus: Object.freeze({
            offset: block.range.end,
            affinity: 'previous' as const
          })
        })
      })()
    return this.prepareStructureReplacement(
      blockTarget,
      replacement,
      next,
      target,
      caretOffsetWithinReplacement
    )
  }

  prepareBlockDuplication(
    target: ModelSelection,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const from = Math.min(target.anchor.offset, target.focus.offset)
    const to = Math.max(target.anchor.offset, target.focus.offset)
    const document = state.revision.projection('editing').markdown
    const root = document.root
    const blocks = Array.from(
      { length: root.childCount },
      (_, ordinal) => root.childAt(ordinal)
    )
    const selectedBlocks =
      from === to
        ? [
          blocks.find((candidate) =>
            from >= candidate.range.start && from < candidate.range.end
          ) ??
          blocks.find((candidate) => from === candidate.range.end)
        ].filter((block): block is MarkdownNode => block !== undefined)
        : blocks.filter((candidate) =>
          candidate.range.end > from && candidate.range.start < to
        )
    const first = selectedBlocks[0]
    const last = selectedBlocks[selectedBlocks.length - 1]
    if (first === undefined || last === undefined) {
      throw new IntentRejection('target-not-found')
    }
    const sourceStart = this.#sourcePositionAt(
      state,
      Object.freeze({
        offset: first.range.start,
        affinity: 'next' as const
      })
    )
    const sourceEnd = this.#sourcePositionAt(
      state,
      Object.freeze({
        offset: last.range.end,
        affinity: 'previous' as const
      })
    )
    const source = state.revision.source.text
    const blockSource = source.slice(sourceStart.offset, sourceEnd.offset)
    const eol = source.includes('\r\n')
      ? '\r\n'
      : source.includes('\r')
        ? '\r'
        : '\n'
    const insertionTarget = Object.freeze({
      ...target,
      anchor: Object.freeze({
        offset: last.range.end,
        affinity: 'previous' as const
      }),
      focus: Object.freeze({
        offset: last.range.end,
        affinity: 'previous' as const
      })
    })
    return this.prepareInsertion(
      insertionTarget,
      `${eol}${eol}${blockSource}`,
      next
    )
  }

  prepareBlockDeletion(
    target: ModelSelection,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const position = Math.min(target.anchor.offset, target.focus.offset)
    const root = state.revision.projection('editing').markdown.root
    const blocks = Array.from(
      { length: root.childCount },
      (_, ordinal) => root.childAt(ordinal)
    )
    const index = blocks.findIndex((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    const block = blocks[index]
    if (block === undefined) {
      throw new IntentRejection('target-not-found')
    }
    const previous = blocks[index - 1]
    const following = blocks[index + 1]
    const from =
      following !== undefined || previous === undefined
        ? block.range.start
        : previous.range.end
    const to =
      following !== undefined
        ? following.range.start
        : block.range.end
    return this.prepareStructureReplacement(
      Object.freeze({
        ...target,
        anchor: Object.freeze({
          offset: from,
          affinity: 'next' as const
        }),
        focus: Object.freeze({
          offset: to,
          affinity: 'previous' as const
        })
      }),
      '',
      next,
      target
    )
  }

  prepareParagraphInsertion(
    target: ModelSelection,
    location: 'before' | 'after',
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const position = Math.min(target.anchor.offset, target.focus.offset)
    const document = state.revision.projection('editing').markdown
    const root = document.root
    const block = Array.from(
      { length: root.childCount },
      (_, ordinal) => root.childAt(ordinal)
    ).find((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    if (block === undefined) {
      throw new IntentRejection('target-not-found')
    }
    const source = state.revision.source.text
    const eol = source.includes('\r\n')
      ? '\r\n'
      : source.includes('\r')
        ? '\r'
        : '\n'
    const offset =
      location === 'before'
        ? block.range.start
        : block.range.end
    const caret = Object.freeze({
      offset,
      affinity: 'next' as const
    })
    return this.prepareInsertion(
      Object.freeze({
        ...target,
        anchor: caret,
        focus: caret
      }),
      eol,
      next
    )
  }

  prepareListIndentation(
    target: ModelSelection,
    direction: 'increase' | 'decrease',
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const position = Math.min(target.anchor.offset, target.focus.offset)
    const candidates: MarkdownNode[] = []
    const visit = (node: MarkdownNode): void => {
      if (
        node.kind === 'list-item' &&
        position >= node.range.start &&
        position <= node.range.end
      ) {
        candidates.push(node)
      }
      for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
        visit(node.childAt(ordinal))
      }
    }
    visit(state.revision.projection('editing').markdown.root)
    const item = candidates.sort(
      (left, right) =>
        (left.range.end - left.range.start) -
        (right.range.end - right.range.start)
    )[0]
    if (item === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }

    const source = state.revision.source.text
    const markdownDocument = state.revision.projection('editing').markdown
    const lineIndex = markdownDocument.lines
    // The parser-emitted physical line holding a model position.
    const lineContaining = (offset: number): MarkdownPhysicalLine => {
      for (let ordinal = 0; ordinal < lineIndex.count; ordinal += 1) {
        const line = lineIndex.at(ordinal)
        if (offset < line.end || ordinal === lineIndex.count - 1) {
          return line
        }
      }
      throw new IntentRejection('wrong-target-kind')
    }
    // Nesting reaches the adjacent item's content column, so the step is
    // that marker segment's width — 2 under '- ', 3 under '1. ' — never a
    // fixed two spaces, which fails to nest under any ordered marker. An
    // item's marker segment is parser-emitted: it spans from the item's
    // start to its first line's content offset.
    const markerWidthOf = (candidate: MarkdownNode): number =>
      Math.max(
        0,
        lineContaining(candidate.range.start).contentOffset -
          candidate.range.start
      )
    // Sibling and ancestor come from the emitted tree, never from scanning
    // source lines for markers: the path to the item names its parent list
    // and any enclosing item.
    const path = markdownDocument.nodeAt(item.range.start, 'next')
    const itemDepth = path.lastIndexOf(item)
    const parentList = itemDepth > 0 ? path[itemDepth - 1] : undefined
    const precedingSibling = ((): MarkdownNode | null => {
      if (parentList === undefined || parentList.kind !== 'list') {
        return null
      }
      let previous: MarkdownNode | null = null
      for (
        let ordinal = 0;
        ordinal < parentList.childCount;
        ordinal += 1
      ) {
        const child = parentList.childAt(ordinal)
        if (child === item) {
          return previous
        }
        if (child.kind === 'list-item') {
          previous = child
        }
      }
      return null
    })()
    const enclosingItem = ((): MarkdownNode | null => {
      for (let ordinal = itemDepth - 1; ordinal >= 0; ordinal -= 1) {
        const ancestor = path[ordinal]
        if (ancestor !== undefined && ancestor.kind === 'list-item') {
          return ancestor
        }
      }
      return null
    })()
    const itemLine = lineContaining(item.range.start)
    const lineStart = this.#sourcePositionAt(
      state,
      Object.freeze({
        offset: itemLine.start,
        affinity: 'next' as const
      })
    ).offset
    const itemStart = this.#sourcePositionAt(
      state,
      Object.freeze({
        offset: item.range.start,
        affinity: 'next' as const
      })
    ).offset
    // The whitespace run before the emitted marker — an extent measure over
    // parser-identified bytes, not a recognizer.
    const indent =
      /^[ \t]*/.exec(source.slice(lineStart, itemStart))?.[0] ?? ''
    const edits: Array<Readonly<{
      start: number
      end: number
      insert: string
    }>> = []
    if (direction === 'increase') {
      if (precedingSibling === null) {
        // Without a preceding sibling at the same level there is no item to
        // nest under; indenting would fabricate a continuation line.
        throw new IntentRejection('no-source-change')
      }
      const width = markerWidthOf(precedingSibling)
      edits.push(Object.freeze({
        start: lineStart,
        end: lineStart,
        insert: ' '.repeat(width)
      }))
      // An ordered item becomes the first entry of its new nested list; its
      // marker number is part of the semantic move, exactly as an editor
      // renumbers on indent. The digits live inside the emitted marker
      // extent.
      const markerEnd = this.#sourcePositionAt(
        state,
        Object.freeze({
          offset: itemLine.contentOffset,
          affinity: 'previous' as const
        })
      ).offset
      const digits =
        /^\d{1,9}/.exec(source.slice(itemStart, markerEnd))?.[0]
      if (digits !== undefined && digits !== '1') {
        edits.push(Object.freeze({
          start: itemStart,
          end: itemStart + digits.length,
          insert: '1'
        }))
      }
    } else {
      const width =
        enclosingItem === null ? 2 : markerWidthOf(enclosingItem)
      const removal = Math.min(width, indent.length)
      if (removal === 0) {
        throw new IntentRejection('no-source-change')
      }
      edits.push(Object.freeze({
        start: lineStart,
        end: lineStart + removal,
        insert: ''
      }))
    }
    const edit = edits[0]!
    const carrier = trackCarrierContext(
      state.revision,
      edit.start,
      edit.end
    )
    if (this.#trackChanges && carrier.policy === 'read-only') {
      throw new IntentRejection('read-only-change-arm')
    }
    const trackedEdits = edits.map((entry) => {
      const removed = source.slice(entry.start, entry.end)
      return !this.#trackChanges || carrier.policy === 'direct'
        ? entry
        : Object.freeze({
          ...entry,
          insert: direction === 'increase'
            ? serializeAddition(entry.insert)
            : serializeDeletion(removed)
        })
    })
    return this.#prepareMappedEdits(
      Object.freeze(trackedEdits),
      target,
      next
    )
  }

  prepareTaskChecked(
    target: ModelSelection,
    checked: boolean,
    cascade: boolean,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)

    interface TaskEntry {
      readonly node: MarkdownNode
      readonly parent: TaskEntry | null
      readonly children: TaskEntry[]
    }

    const tasks: TaskEntry[] = []
    const visit = (
      node: MarkdownNode,
      parentTask: TaskEntry | null
    ): void => {
      let nextParent = parentTask
      if (
        node.kind === 'list-item' &&
        node.attributes['task'] === true
      ) {
        const entry: TaskEntry = {
          node,
          parent: parentTask,
          children: []
        }
        parentTask?.children.push(entry)
        tasks.push(entry)
        nextParent = entry
      }
      for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
        visit(node.childAt(ordinal), nextParent)
      }
    }
    visit(state.revision.projection('editing').markdown.root, null)

    const from = Math.min(target.anchor.offset, target.focus.offset)
    const to = Math.max(target.anchor.offset, target.focus.offset)
    const selected = tasks
      .filter(({ node }) =>
        from >= node.range.start &&
        to <= node.range.end
      )
      .sort((left, right) =>
        (left.node.range.end - left.node.range.start) -
        (right.node.range.end - right.node.range.start)
      )[0]
    if (selected === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }

    const desired = new Map<TaskEntry, boolean>(
      tasks.map((entry) => [
        entry,
        entry.node.attributes['checked'] === true
      ])
    )
    desired.set(selected, checked)
    if (cascade) {
      const setDescendants = (entry: TaskEntry): void => {
        for (const child of entry.children) {
          desired.set(child, checked)
          setDescendants(child)
        }
      }
      setDescendants(selected)

      let ancestor = selected.parent
      while (ancestor !== null) {
        desired.set(
          ancestor,
          ancestor.children.length > 0 &&
          ancestor.children.every((child) => desired.get(child) === true)
        )
        ancestor = ancestor.parent
      }
    }

    const source = state.revision.source.text
    const edits = tasks.flatMap((entry): readonly SourceEdit[] => {
      const current = entry.node.attributes['checked'] === true
      const replacement = desired.get(entry)
      if (replacement === undefined || current === replacement) {
        return Object.freeze([])
      }
      const markerStart = entry.node.attributes['taskMarkerStart']
      const markerEnd = entry.node.attributes['taskMarkerEnd']
      if (
        typeof markerStart !== 'number' ||
        typeof markerEnd !== 'number' ||
        !Number.isInteger(markerStart) ||
        !Number.isInteger(markerEnd) ||
        markerEnd - markerStart !== 3
      ) {
        throw new IntentRejection('wrong-target-kind')
      }
      const sourceStart = this.#sourcePositionAt(
        state,
        Object.freeze({
          offset: markerStart + 1,
          affinity: 'next' as const
        })
      ).offset
      const sourceEnd = this.#sourcePositionAt(
        state,
        Object.freeze({
          offset: markerStart + 2,
          affinity: 'previous' as const
        })
      ).offset
      const removed = source.slice(sourceStart, sourceEnd)
      if (
        sourceEnd - sourceStart !== 1 ||
        !/^[ xX]$/.test(removed) ||
        hiddenCommentOverlaps(state.revision, sourceStart, sourceEnd)
      ) {
        throw new IntentRejection('wrong-target-kind')
      }
      const carrier = trackCarrierContext(
        state.revision,
        sourceStart,
        sourceEnd
      )
      if (this.#trackChanges && carrier.policy === 'read-only') {
        throw new IntentRejection('read-only-change-arm')
      }
      const insert = replacement ? 'x' : ' '
      return Object.freeze([
        Object.freeze({
          start: sourceStart,
          end: sourceEnd,
          insert:
            this.#trackChanges && carrier.policy !== 'direct'
              ? `${serializeDeletion(removed)}${serializeAddition(insert)}`
              : insert
        })
      ])
    }).sort((left, right) => left.start - right.start)
    if (edits.length === 0) {
      throw new IntentRejection('no-source-change')
    }
    return this.#prepareMappedEdits(
      Object.freeze(edits),
      target,
      next
    )
  }

  prepareSemanticBreak(
    target: ModelSelection,
    kind: 'paragraph' | 'line',
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const position = Math.min(target.anchor.offset, target.focus.offset)
    const root = state.revision.projection('editing').markdown.root
    const block = Array.from(
      { length: root.childCount },
      (_, ordinal) => root.childAt(ordinal)
    ).find((candidate) =>
      position >= candidate.range.start &&
      position <= candidate.range.end
    )
    const source = state.revision.source.text
    const sourcePosition = this.#sourcePositionAt(
      state,
      Object.freeze({ offset: position, affinity: 'next' as const })
    ).offset
    const owner =
      block === undefined
        ? Object.freeze({ start: 0, end: source.length })
        : Object.freeze({
          start: this.#sourcePositionAt(
            state,
            Object.freeze({
              offset: block.range.start,
              affinity: 'next' as const
            })
          ).offset,
          end: this.#sourcePositionAt(
            state,
            Object.freeze({
              offset: block.range.end,
              affinity: 'previous' as const
            })
          ).offset
        })
    const eol = chooseAuthoringEolV1(
      source,
      owner,
      Math.max(owner.start, Math.min(owner.end, sourcePosition))
    ).token
    const text = kind === 'paragraph' ? `${eol}${eol}` : eol
    if (
      target.anchor.offset === target.focus.offset &&
      target.anchor.affinity === target.focus.affinity
    ) {
      return this.prepareInsertion(target, text, next)
    }
    return this.prepareReplacement(target, text, next)
  }

  prepareCodeLanguage(
    target: ModelSelection,
    language: string,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    assertToolLine(language, 'language', true)
    if (/[\s`]/.test(language)) {
      throw new IntentRejection('invalid-command-argument')
    }

    const position = Math.min(target.anchor.offset, target.focus.offset)
    const root = state.revision.projection('editing').markdown.root
    const block = Array.from(
      { length: root.childCount },
      (_, ordinal) => root.childAt(ordinal)
    ).find((candidate) =>
      candidate.kind === 'code-block' &&
      position >= candidate.range.start &&
      position <= candidate.range.end
    )
    if (block === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }

    // The grammar emits the fence's info-string extent; an indented code
    // block emits none and cannot carry a language.
    const emittedInfoStart = block.attributes['infoStart']
    const emittedInfoEnd = block.attributes['infoEnd']
    if (
      typeof emittedInfoStart !== 'number' ||
      typeof emittedInfoEnd !== 'number'
    ) {
      throw new IntentRejection('wrong-target-kind')
    }
    const infoStart = this.#sourcePositionAt(state, Object.freeze({
      offset: emittedInfoStart,
      affinity: 'next' as const
    })).offset
    const infoEnd = emittedInfoEnd <= emittedInfoStart
      ? infoStart
      : this.#sourcePositionAt(state, Object.freeze({
        offset: emittedInfoEnd,
        affinity: 'previous' as const
      })).offset
    const current = state.revision.source.text.slice(infoStart, infoEnd)
    if (current === language) {
      throw new IntentRejection('no-source-change')
    }
    const carrier = trackCarrierContext(
      state.revision,
      infoStart,
      infoEnd
    )
    if (this.#trackChanges && carrier.policy === 'read-only') {
      throw new IntentRejection('read-only-change-arm')
    }
    const insert =
      this.#trackChanges && carrier.policy !== 'direct'
        ? `${serializeDeletion(current)}${serializeAddition(language)}`
        : language
    return this.#prepareMappedEdits(
      Object.freeze([
        Object.freeze({
          start: infoStart,
          end: infoEnd,
          insert
        })
      ]),
      target,
      next
    )
  }

  prepareLinkInsertion(
    target: ModelSelection,
    href: string,
    title: string | undefined,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const from = Math.min(target.anchor.offset, target.focus.offset)
    const to = Math.max(target.anchor.offset, target.focus.offset)
    if (from === to) {
      throw new IntentRejection('selection-collapsed')
    }
    const sourceStart = this.#sourcePositionAt(
      state,
      Object.freeze({ offset: from, affinity: 'next' as const })
    )
    const sourceEnd = this.#sourcePositionAt(
      state,
      Object.freeze({ offset: to, affinity: 'previous' as const })
    )
    const carrier = trackCarrierContext(
      state.revision,
      sourceStart.offset,
      sourceEnd.offset
    )
    if (this.#trackChanges && carrier.policy === 'read-only') {
      throw new IntentRejection('read-only-change-arm')
    }
    const open = '['
    const close =
      `](${serializeLinkDestination(href)}${serializeOptionalTitle(title)})`
    return this.#prepareMappedEdits(
      Object.freeze([
        Object.freeze({
          start: sourceStart.offset,
          end: sourceStart.offset,
          insert:
            this.#trackChanges && carrier.policy !== 'direct'
              ? serializeAddition(open)
              : open
        }),
        Object.freeze({
          start: sourceEnd.offset,
          end: sourceEnd.offset,
          insert:
            this.#trackChanges && carrier.policy !== 'direct'
              ? serializeAddition(close)
              : close
        })
      ]),
      target,
      next
    )
  }

  prepareImageInsertion(
    target: ModelSelection,
    image: Readonly<{
      src: string
      alt: string
      title?: string
    }>,
    next: RevisionId
  ): PreparedWorkerCommit {
    const markdown =
      `![${serializeImageAlt(image.alt)}](` +
      `${serializeLinkDestination(image.src)}` +
      `${serializeOptionalTitle(image.title)})`
    if (target.view === 'source') {
      const start = Math.min(target.anchor.offset, target.focus.offset)
      const caret = start + markdown.length
      return this.prepareSourceEdit(
        target,
        markdown,
        Object.freeze({
          anchor: Object.freeze({
            offset: caret,
            affinity: 'next' as const
          }),
          focus: Object.freeze({
            offset: caret,
            affinity: 'next' as const
          })
        }),
        next
      )
    }
    if (
      target.anchor.offset === target.focus.offset &&
      target.anchor.affinity === target.focus.affinity
    ) {
      return this.prepareInsertion(target, markdown, next)
    }
    return this.prepareReplacement(target, markdown, next)
  }

  prepareFootnoteInsertion(
    target: ModelSelection,
    label: string,
    content: string,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertCollapsedSelection(target, state)
    assertToolLine(label, 'label')
    assertToolLine(content, 'content')
    if (!/^[A-Za-z0-9_-]+$/.test(label)) {
      throw new IntentRejection('invalid-command-argument')
    }
    const source = state.revision.source.text
    // Footnote definitions are parser facts; a duplicate label is detected
    // through the emitted index, never by scanning source with a second
    // recognizer.
    const normalizedLabel = normalizeMarkdownReferenceLabel(
      label,
      0,
      label.length
    )
    if (
      state.revision
        .projection('editing')
        .markdown.references.footnoteDefinitionForLabel(normalizedLabel) !==
        undefined
    ) {
      throw new IntentRejection('invalid-command-argument')
    }
    const eol = source.includes('\r\n')
      ? '\r\n'
      : source.includes('\r')
        ? '\r'
        : '\n'
    const reference = `[^${label}]`
    const definition = `[^${label}]: ${content}${eol}`
    const sourceTarget = this.#sourcePositionAt(state, target.anchor)
    if (sourceTarget.offset === source.length) {
      return this.prepareInsertion(
        target,
        `${reference}${eol}${eol}${definition}`,
        next
      )
    }

    const separator = source.endsWith(`${eol}${eol}`)
      ? ''
      : source.endsWith(eol)
        ? eol
        : `${eol}${eol}`
    const carrier = trackCarrierContext(
      state.revision,
      sourceTarget.offset,
      sourceTarget.offset
    )
    if (this.#trackChanges && carrier.policy === 'read-only') {
      throw new IntentRejection('read-only-change-arm')
    }
    const append =
      `${separator}${definition}`
    return this.#prepareMappedEdits(
      Object.freeze([
        Object.freeze({
          start: sourceTarget.offset,
          end: sourceTarget.offset,
          insert:
            this.#trackChanges && carrier.policy !== 'direct'
              ? serializeAddition(reference)
              : reference
        }),
        Object.freeze({
          start: source.length,
          end: source.length,
          insert: this.#trackChanges ? serializeAddition(append) : append
        })
      ]),
      target,
      next
    )
  }

  prepareTableCreation(
    target: ModelSelection,
    rows: number,
    columns: number,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    if (
      !state.revision.configuration.markdownOptions.gfm ||
      !validTableShape(rows, columns)
    ) {
      throw new IntentRejection('invalid-command-argument')
    }
    const source = state.revision.source.text
    const eol = source.includes('\r\n')
      ? '\r\n'
      : source.includes('\r')
        ? '\r'
        : '\n'
    const table = blankGfmTable(rows, columns, eol)
    const root = state.revision.projection('editing').markdown.root
    const position = Math.min(target.anchor.offset, target.focus.offset)
    const block = Array.from(
      { length: root.childCount },
      (_, ordinal) => root.childAt(ordinal)
    ).find((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    if (block === undefined) {
      const caret = Object.freeze({
        offset: position,
        affinity: 'next' as const
      })
      return this.prepareInsertion(
        Object.freeze({
          ...target,
          anchor: caret,
          focus: caret
        }),
        table,
        next
      )
    }
    const caret = Object.freeze({
      offset: block.range.end,
      affinity: 'next' as const
    })
    return this.prepareInsertion(
      Object.freeze({
        ...target,
        anchor: caret,
        focus: caret
      }),
      `${eol}${eol}${table}`,
      next
    )
  }

  prepareTableRowInsertion(
    target: ModelSelection,
    location: 'before' | 'after',
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const position = Math.min(target.anchor.offset, target.focus.offset)
    const projected = state.revision.projection('editing')
    const document = projected.markdown
    const root = document.root
    const table = Array.from(
      { length: root.childCount },
      (_, ordinal) => root.childAt(ordinal)
    ).find((candidate) =>
      candidate.kind === 'table' &&
      position >= candidate.range.start &&
      position <= candidate.range.end
    )
    if (table === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const rows = Array.from(
      { length: table.childCount },
      (_, ordinal) => table.childAt(ordinal)
    )
    const rowIndex = rows.findIndex((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    const selected = rows[rowIndex]
    if (selected === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const columnCount = Number(table.attributes.columns)
    if (!Number.isInteger(columnCount) || columnCount < 1) {
      throw new IntentRejection('invalid-command-argument')
    }
    const source = state.revision.source.text
    const eol = source.includes('\r\n')
      ? '\r\n'
      : source.includes('\r')
        ? '\r'
        : '\n'
    const selectedColumn = Math.max(0, Array.from(
      { length: selected.childCount },
      (_, ordinal) => selected.childAt(ordinal)
    ).findIndex((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    ))
    const cells = rows.map((row) => Object.freeze(Array.from(
      { length: row.childCount },
      (_, ordinal) => {
        const cell = row.childAt(ordinal)
        return canonicalTableCellSource(
          state.revision,
          projected,
          table,
          row,
          cell
        )
      }
    )))
    const insertedRowIndex = rowIndex + (location === 'after' ? 1 : 0)
    cells.splice(
      insertedRowIndex,
      0,
      Object.freeze(Array.from(
        { length: columnCount },
        () => EMPTY_TABLE_CELL_SOURCE
      ))
    )
    const header = rows[0]
    if (header === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const alignments = Array.from(
      { length: header.childCount },
      (_, ordinal): TableAlignment => {
        const current = header.childAt(ordinal).attributes.alignment
        return current === 'left' ||
          current === 'center' ||
          current === 'right'
          ? current
          : 'none'
      }
    )
    const editTarget = Object.freeze({
      ...target,
      anchor: Object.freeze({
        offset: table.range.start,
        affinity: 'next' as const
      }),
      focus: Object.freeze({
        offset: table.range.end,
        affinity: 'previous' as const
      })
    })
    const serialized = serializeTable(cells, alignments, eol)
    return this.prepareStructureReplacement(
      editTarget,
      serialized.text,
      next,
      target,
      serializedTableCellOffset(
        cells,
        alignments,
        insertedRowIndex,
        Math.min(selectedColumn, columnCount - 1),
        eol
      ),
      serialized.opaqueRanges
    )
  }

  prepareTableRowRemoval(
    target: ModelSelection,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const position = Math.min(target.anchor.offset, target.focus.offset)
    const projected = state.revision.projection('editing')
    const document = projected.markdown
    const root = document.root
    const table = Array.from(
      { length: root.childCount },
      (_, ordinal) => root.childAt(ordinal)
    ).find((candidate) =>
      candidate.kind === 'table' &&
      position >= candidate.range.start &&
      position <= candidate.range.end
    )
    if (table === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const rows = Array.from(
      { length: table.childCount },
      (_, ordinal) => table.childAt(ordinal)
    )
    const rowIndex = rows.findIndex((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    const selected = rows[rowIndex]
    if (selected === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    if (rows.length === 1) {
      return this.prepareBlockDeletion(target, next)
    }
    const selectedColumn = Math.max(0, Array.from(
      { length: selected.childCount },
      (_, ordinal) => selected.childAt(ordinal)
    ).findIndex((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    ))
    const cells = rows
      .filter((_, index) => index !== rowIndex)
      .map((row) => Object.freeze(Array.from(
        { length: row.childCount },
        (_, ordinal) => {
          const cell = row.childAt(ordinal)
          return canonicalTableCellSource(
            state.revision,
            projected,
            table,
            row,
            cell
          )
        }
      )))
    const header = rows[0]
    if (header === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const alignments = Array.from(
      { length: header.childCount },
      (_, ordinal): TableAlignment => {
        const current = header.childAt(ordinal).attributes.alignment
        return current === 'left' ||
          current === 'center' ||
          current === 'right'
          ? current
          : 'none'
      }
    )
    const source = state.revision.source.text
    const eol = source.includes('\r\n')
      ? '\r\n'
      : source.includes('\r')
        ? '\r'
        : '\n'
    const editTarget = Object.freeze({
      ...target,
      anchor: Object.freeze({
        offset: table.range.start,
        affinity: 'next' as const
      }),
      focus: Object.freeze({
        offset: table.range.end,
        affinity: 'previous' as const
      })
    })
    const destinationRow = Math.min(rowIndex, cells.length - 1)
    const serialized = serializeTable(cells, alignments, eol)
    return this.prepareStructureReplacement(
      editTarget,
      serialized.text,
      next,
      target,
      serializedTableCellOffset(
        cells,
        alignments,
        destinationRow,
        Math.min(selectedColumn, alignments.length - 1),
        eol
      ),
      serialized.opaqueRanges
    )
  }

  prepareTableColumnInsertion(
    target: ModelSelection,
    location: 'left' | 'right',
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const position = Math.min(target.anchor.offset, target.focus.offset)
    const projected = state.revision.projection('editing')
    const document = projected.markdown
    const table = Array.from(
      { length: document.root.childCount },
      (_, ordinal) => document.root.childAt(ordinal)
    ).find((candidate) =>
      candidate.kind === 'table' &&
      position >= candidate.range.start &&
      position <= candidate.range.end
    )
    if (table === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const rows = Array.from(
      { length: table.childCount },
      (_, ordinal) => table.childAt(ordinal)
    )
    const selectedRow = rows.find((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    if (selectedRow === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const selectedColumn = Array.from(
      { length: selectedRow.childCount },
      (_, ordinal) => selectedRow.childAt(ordinal)
    ).findIndex((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    if (selectedColumn < 0) {
      throw new IntentRejection('wrong-target-kind')
    }
    const selectedRowIndex = rows.indexOf(selectedRow)
    const insertAt = selectedColumn + (location === 'right' ? 1 : 0)
    const cells = rows.map((row) => {
      const values = Array.from(
        { length: row.childCount },
        (_, ordinal) => {
          const cell = row.childAt(ordinal)
          return canonicalTableCellSource(
            state.revision,
            projected,
            table,
            row,
            cell
          )
        }
      )
      values.splice(insertAt, 0, EMPTY_TABLE_CELL_SOURCE)
      return Object.freeze(values)
    })
    const header = rows[0]
    if (header === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const alignments = Array.from(
      { length: header.childCount },
      (_, ordinal): TableAlignment => {
        const alignment = header.childAt(ordinal).attributes.alignment
        return alignment === 'left' ||
          alignment === 'center' ||
          alignment === 'right'
          ? alignment
          : 'none'
      }
    )
    alignments.splice(insertAt, 0, 'none')
    const source = state.revision.source.text
    const eol = source.includes('\r\n')
      ? '\r\n'
      : source.includes('\r')
        ? '\r'
        : '\n'
    const editTarget = Object.freeze({
      ...target,
      anchor: Object.freeze({
        offset: table.range.start,
        affinity: 'next' as const
      }),
      focus: Object.freeze({
        offset: table.range.end,
        affinity: 'previous' as const
      })
    })
    const serialized = serializeTable(cells, alignments, eol)
    return this.prepareStructureReplacement(
      editTarget,
      serialized.text,
      next,
      target,
      serializedTableCellOffset(
        cells,
        alignments,
        selectedRowIndex,
        selectedColumn,
        eol
      ),
      serialized.opaqueRanges
    )
  }

  prepareTableColumnRemoval(
    target: ModelSelection,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const position = Math.min(target.anchor.offset, target.focus.offset)
    const projected = state.revision.projection('editing')
    const document = projected.markdown
    const table = Array.from(
      { length: document.root.childCount },
      (_, ordinal) => document.root.childAt(ordinal)
    ).find((candidate) =>
      candidate.kind === 'table' &&
      position >= candidate.range.start &&
      position <= candidate.range.end
    )
    if (table === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const rows = Array.from(
      { length: table.childCount },
      (_, ordinal) => table.childAt(ordinal)
    )
    const selectedRow = rows.find((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    if (selectedRow === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const selectedColumn = Array.from(
      { length: selectedRow.childCount },
      (_, ordinal) => selectedRow.childAt(ordinal)
    ).findIndex((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    if (selectedColumn < 0) {
      throw new IntentRejection('wrong-target-kind')
    }
    const selectedRowIndex = rows.indexOf(selectedRow)
    if (selectedRow.childCount === 1) {
      return this.prepareBlockDeletion(target, next)
    }
    const cells = rows.map((row) => {
      const values = Array.from(
        { length: row.childCount },
        (_, ordinal) => {
          const cell = row.childAt(ordinal)
          return canonicalTableCellSource(
            state.revision,
            projected,
            table,
            row,
            cell
          )
        }
      )
      values.splice(selectedColumn, 1)
      return Object.freeze(values)
    })
    const header = rows[0]
    if (header === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const alignments = Array.from(
      { length: header.childCount },
      (_, ordinal): TableAlignment => {
        const alignment = header.childAt(ordinal).attributes.alignment
        return alignment === 'left' ||
          alignment === 'center' ||
          alignment === 'right'
          ? alignment
          : 'none'
      }
    )
    alignments.splice(selectedColumn, 1)
    const source = state.revision.source.text
    const eol = source.includes('\r\n')
      ? '\r\n'
      : source.includes('\r')
        ? '\r'
        : '\n'
    const editTarget = Object.freeze({
      ...target,
      anchor: Object.freeze({
        offset: table.range.start,
        affinity: 'next' as const
      }),
      focus: Object.freeze({
        offset: table.range.end,
        affinity: 'previous' as const
      })
    })
    const serialized = serializeTable(cells, alignments, eol)
    return this.prepareStructureReplacement(
      editTarget,
      serialized.text,
      next,
      target,
      serializedTableCellOffset(
        cells,
        alignments,
        selectedRowIndex,
        Math.min(selectedColumn, alignments.length - 1),
        eol
      ),
      serialized.opaqueRanges
    )
  }

  prepareTableColumnAlignment(
    target: ModelSelection,
    alignment: TableAlignment,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    if (
      alignment !== 'none' &&
      alignment !== 'left' &&
      alignment !== 'center' &&
      alignment !== 'right'
    ) {
      throw new IntentRejection('invalid-command-argument')
    }
    const position = Math.min(target.anchor.offset, target.focus.offset)
    const projected = state.revision.projection('editing')
    const document = projected.markdown
    const table = Array.from(
      { length: document.root.childCount },
      (_, ordinal) => document.root.childAt(ordinal)
    ).find((candidate) =>
      candidate.kind === 'table' &&
      position >= candidate.range.start &&
      position <= candidate.range.end
    )
    if (table === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const rows = Array.from(
      { length: table.childCount },
      (_, ordinal) => table.childAt(ordinal)
    )
    const selectedRow = rows.find((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    if (selectedRow === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const selectedColumn = Array.from(
      { length: selectedRow.childCount },
      (_, ordinal) => selectedRow.childAt(ordinal)
    ).findIndex((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    if (selectedColumn < 0) {
      throw new IntentRejection('wrong-target-kind')
    }
    const selectedRowIndex = rows.indexOf(selectedRow)
    const cells = rows.map((row) => Object.freeze(Array.from(
      { length: row.childCount },
      (_, ordinal) => {
        const cell = row.childAt(ordinal)
        return canonicalTableCellSource(
          state.revision,
          projected,
          table,
          row,
          cell
        )
      }
    )))
    const header = rows[0]
    if (header === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const alignments = Array.from(
      { length: header.childCount },
      (_, ordinal): TableAlignment => {
        const current = header.childAt(ordinal).attributes.alignment
        return current === 'left' ||
          current === 'center' ||
          current === 'right'
          ? current
          : 'none'
      }
    )
    alignments[selectedColumn] = alignment
    const source = state.revision.source.text
    const eol = source.includes('\r\n')
      ? '\r\n'
      : source.includes('\r')
        ? '\r'
        : '\n'
    const editTarget = Object.freeze({
      ...target,
      anchor: Object.freeze({
        offset: table.range.start,
        affinity: 'next' as const
      }),
      focus: Object.freeze({
        offset: table.range.end,
        affinity: 'previous' as const
      })
    })
    const serialized = serializeTable(cells, alignments, eol)
    return this.prepareStructureReplacement(
      editTarget,
      serialized.text,
      next,
      target,
      serializedTableCellOffset(
        cells,
        alignments,
        selectedRowIndex,
        selectedColumn,
        eol
      ),
      serialized.opaqueRanges
    )
  }

  prepareTableRowMove(
    target: ModelSelection,
    direction: 'up' | 'down',
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const position = Math.min(target.anchor.offset, target.focus.offset)
    const projected = state.revision.projection('editing')
    const document = projected.markdown
    const table = Array.from(
      { length: document.root.childCount },
      (_, ordinal) => document.root.childAt(ordinal)
    ).find((candidate) =>
      candidate.kind === 'table' &&
      position >= candidate.range.start &&
      position <= candidate.range.end
    )
    if (table === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const rowNodes = Array.from(
      { length: table.childCount },
      (_, ordinal) => table.childAt(ordinal)
    )
    const selectedRowIndex = rowNodes.findIndex((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    const selectedRow = rowNodes[selectedRowIndex]
    if (selectedRow === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const selectedColumn = Array.from(
      { length: selectedRow.childCount },
      (_, ordinal) => selectedRow.childAt(ordinal)
    ).findIndex((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    if (selectedColumn < 0) {
      throw new IntentRejection('wrong-target-kind')
    }
    const destination =
      selectedRowIndex + (direction === 'up' ? -1 : 1)
    if (destination < 0 || destination >= rowNodes.length) {
      throw new IntentRejection('invalid-command-argument')
    }
    const cells = rowNodes.map((row) => Object.freeze(Array.from(
      { length: row.childCount },
      (_, ordinal) => {
        const cell = row.childAt(ordinal)
        return canonicalTableCellSource(
          state.revision,
          projected,
          table,
          row,
          cell
        )
      }
    )))
    const [moving] = cells.splice(selectedRowIndex, 1)
    if (moving === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    cells.splice(destination, 0, moving)
    const header = rowNodes[0]
    if (header === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const alignments = Array.from(
      { length: header.childCount },
      (_, ordinal): TableAlignment => {
        const current = header.childAt(ordinal).attributes.alignment
        return current === 'left' ||
          current === 'center' ||
          current === 'right'
          ? current
          : 'none'
      }
    )
    const source = state.revision.source.text
    const eol = source.includes('\r\n')
      ? '\r\n'
      : source.includes('\r')
        ? '\r'
        : '\n'
    const editTarget = Object.freeze({
      ...target,
      anchor: Object.freeze({
        offset: table.range.start,
        affinity: 'next' as const
      }),
      focus: Object.freeze({
        offset: table.range.end,
        affinity: 'previous' as const
      })
    })
    const serialized = serializeTable(cells, alignments, eol)
    return this.prepareStructureReplacement(
      editTarget,
      serialized.text,
      next,
      target,
      serializedTableCellOffset(
        cells,
        alignments,
        destination,
        selectedColumn,
        eol
      ),
      serialized.opaqueRanges
    )
  }

  prepareTableColumnMove(
    target: ModelSelection,
    direction: 'left' | 'right',
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const position = Math.min(target.anchor.offset, target.focus.offset)
    const projected = state.revision.projection('editing')
    const document = projected.markdown
    const table = Array.from(
      { length: document.root.childCount },
      (_, ordinal) => document.root.childAt(ordinal)
    ).find((candidate) =>
      candidate.kind === 'table' &&
      position >= candidate.range.start &&
      position <= candidate.range.end
    )
    if (table === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const rowNodes = Array.from(
      { length: table.childCount },
      (_, ordinal) => table.childAt(ordinal)
    )
    const selectedRowIndex = rowNodes.findIndex((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    const selectedRow = rowNodes[selectedRowIndex]
    if (selectedRow === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const selectedColumn = Array.from(
      { length: selectedRow.childCount },
      (_, ordinal) => selectedRow.childAt(ordinal)
    ).findIndex((candidate) =>
      position >= candidate.range.start && position <= candidate.range.end
    )
    if (selectedColumn < 0) {
      throw new IntentRejection('wrong-target-kind')
    }
    const destination =
      selectedColumn + (direction === 'left' ? -1 : 1)
    if (destination < 0 || destination >= selectedRow.childCount) {
      throw new IntentRejection('invalid-command-argument')
    }
    const cells = rowNodes.map((row) => {
      const values = Array.from(
        { length: row.childCount },
        (_, ordinal) => {
          const cell = row.childAt(ordinal)
          return canonicalTableCellSource(
            state.revision,
            projected,
            table,
            row,
            cell
          )
        }
      )
      const [moving] = values.splice(selectedColumn, 1)
      if (moving === undefined) {
        throw new IntentRejection('wrong-target-kind')
      }
      values.splice(destination, 0, moving)
      return Object.freeze(values)
    })
    const header = rowNodes[0]
    if (header === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const alignments = Array.from(
      { length: header.childCount },
      (_, ordinal): TableAlignment => {
        const current = header.childAt(ordinal).attributes.alignment
        return current === 'left' ||
          current === 'center' ||
          current === 'right'
          ? current
          : 'none'
      }
    )
    const [movingAlignment] = alignments.splice(selectedColumn, 1)
    if (movingAlignment === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    alignments.splice(destination, 0, movingAlignment)
    const source = state.revision.source.text
    const eol = source.includes('\r\n')
      ? '\r\n'
      : source.includes('\r')
        ? '\r'
        : '\n'
    const editTarget = Object.freeze({
      ...target,
      anchor: Object.freeze({
        offset: table.range.start,
        affinity: 'next' as const
      }),
      focus: Object.freeze({
        offset: table.range.end,
        affinity: 'previous' as const
      })
    })
    const serialized = serializeTable(cells, alignments, eol)
    return this.prepareStructureReplacement(
      editTarget,
      serialized.text,
      next,
      target,
      serializedTableCellOffset(
        cells,
        alignments,
        selectedRowIndex,
        destination,
        eol
      ),
      serialized.opaqueRanges
    )
  }

  prepareTableCellContentsDeletion(
    target: ModelSelection,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const from = Math.min(target.anchor.offset, target.focus.offset)
    const to = Math.max(target.anchor.offset, target.focus.offset)
    const projected = state.revision.projection('editing')
    const document = projected.markdown
    const table = Array.from(
      { length: document.root.childCount },
      (_, ordinal) => document.root.childAt(ordinal)
    ).find((candidate) =>
      candidate.kind === 'table' &&
      from >= candidate.range.start &&
      to <= candidate.range.end
    )
    if (table === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const rowNodes = Array.from(
      { length: table.childCount },
      (_, ordinal) => table.childAt(ordinal)
    )
    const coordinateAt = (
      position: number
    ): Readonly<{ row: number, column: number }> | undefined => {
      for (let row = 0; row < rowNodes.length; row += 1) {
        const rowNode = rowNodes[row]
        if (
          rowNode === undefined ||
          position < rowNode.range.start ||
          position > rowNode.range.end
        ) {
          continue
        }
        for (let column = 0; column < rowNode.childCount; column += 1) {
          const cell = rowNode.childAt(column)
          if (
            position >= cell.range.start &&
            position <= cell.range.end
          ) {
            return Object.freeze({ row, column })
          }
        }
      }
      return undefined
    }
    const first = coordinateAt(from)
    const last = coordinateAt(to)
    if (first === undefined || last === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const rowStart = Math.min(first.row, last.row)
    const rowEnd = Math.max(first.row, last.row)
    const columnStart = Math.min(first.column, last.column)
    const columnEnd = Math.max(first.column, last.column)
    const cells = rowNodes.map((row, rowIndex) => Object.freeze(Array.from(
      { length: row.childCount },
      (_, columnIndex) => {
        if (
          rowIndex >= rowStart &&
          rowIndex <= rowEnd &&
          columnIndex >= columnStart &&
          columnIndex <= columnEnd
        ) {
          return EMPTY_TABLE_CELL_SOURCE
        }
        const cell = row.childAt(columnIndex)
        return canonicalTableCellSource(
          state.revision,
          projected,
          table,
          row,
          cell
        )
      }
    )))
    const header = rowNodes[0]
    if (header === undefined) {
      throw new IntentRejection('wrong-target-kind')
    }
    const alignments = Array.from(
      { length: header.childCount },
      (_, ordinal): TableAlignment => {
        const current = header.childAt(ordinal).attributes.alignment
        return current === 'left' ||
          current === 'center' ||
          current === 'right'
          ? current
          : 'none'
      }
    )
    const source = state.revision.source.text
    const eol = source.includes('\r\n')
      ? '\r\n'
      : source.includes('\r')
        ? '\r'
        : '\n'
    const editTarget = Object.freeze({
      ...target,
      anchor: Object.freeze({
        offset: table.range.start,
        affinity: 'next' as const
      }),
      focus: Object.freeze({
        offset: table.range.end,
        affinity: 'previous' as const
      })
    })
    const serialized = serializeTable(cells, alignments, eol)
    return this.prepareStructureReplacement(
      editTarget,
      serialized.text,
      next,
      target,
      serializedTableCellOffset(
        cells,
        alignments,
        rowStart,
        columnStart,
        eol
      ),
      serialized.opaqueRanges
    )
  }

  preparePaste(
    target: ModelSelection,
    text: string,
    source: 'external-text' | 'raw-source-import',
    next: RevisionId
  ): PreparedWorkerCommit {
    if (target.view === 'source') {
      const start = Math.min(target.anchor.offset, target.focus.offset)
      const caret = start + text.length
      return this.prepareSourceEdit(
        target,
        text,
        Object.freeze({
          anchor: Object.freeze({
            offset: caret,
            affinity: 'next' as const
          }),
          focus: Object.freeze({
            offset: caret,
            affinity: 'next' as const
          })
        }),
        next
      )
    }
    if (
      target.anchor.offset === target.focus.offset &&
      target.anchor.affinity === target.focus.affinity
    ) {
      return this.prepareInsertion(
        target,
        text,
        next,
        source === 'raw-source-import' ? source : 'semantic'
      )
    }
    return this.prepareReplacement(
      target,
      text,
      next,
      source === 'raw-source-import' ? source : 'semantic'
    )
  }

  prepareCompositionCommit(
    target: ModelSelection,
    text: string,
    next: RevisionId
  ): PreparedWorkerCommit {
    const collapsed =
      target.anchor.offset === target.focus.offset &&
      target.anchor.affinity === target.focus.affinity
    if (collapsed && text.length === 0) {
      throw new IntentRejection('no-source-change')
    }
    if (collapsed) {
      return this.prepareInsertion(target, text, next)
    }
    return this.prepareReplacement(target, text, next)
  }

  prepareCriticMarkupAuthoring(
    target: ModelSelection,
    input: CriticMarkupAuthoringInput,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    assertSelection(target, state)
    const from = Math.min(target.anchor.offset, target.focus.offset)
    const to = Math.max(target.anchor.offset, target.focus.offset)
    const sourceStart = this.#sourcePositionAt(
      state,
      Object.freeze({ offset: from, affinity: 'next' as const })
    )
    const sourceEnd = from === to
      ? sourceStart
      : this.#sourcePositionAt(
        state,
        Object.freeze({ offset: to, affinity: 'previous' as const })
      )
    const result = this.#transformations.author(
      state.revision,
      Object.freeze({
        start: sourceStart.offset as SourceOffset,
        end: sourceEnd.offset as SourceOffset
      }),
      input
    )
    if (result.kind === 'rejected') {
      throw new IntentRejection(result.reason)
    }
    if (result.edits.length === 0) {
      throw new IntentRejection('no-source-change')
    }
    return this.#prepareMappedEdits(
      result.edits,
      target,
      next,
      Object.freeze({ kind: 'proven-candidate' as const, revision: result.revision })
    )
  }

  prepareSourceCommit(
    source: string,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (source === state.revision.source.text) {
      throw new IntentRejection('no-source-change')
    }
    const edit = Object.freeze({
      start: 0,
      end: state.revision.source.text.length,
      insert: source
    })
    const revision = this.#engine.open(
      createSourceSnapshot(source),
      state.revision.configuration
    )
    // A Source commit means these exact bytes. Supplying the parsed candidate
    // skips changed-join protection, which belongs to semantic Markup edits
    // and would otherwise escape intentionally authored CriticMarkup syntax.
    const prepared = this.#reviseEdits(
      Object.freeze([edit]),
      next,
      Object.freeze({ kind: 'proven-candidate' as const, revision })
    )
    const beforeSelection = detachSelection(state.selection)
    const beforeSourceSelection = detachSelection(this.sourceSelection())

    if (prepared.revision.kind === 'complete') {
      const markupView = createMarkupView(prepared.revision)
      const caret = Object.freeze({
        offset: markupView.modelLength,
        affinity: 'previous' as const
      })
      const afterSelection = Object.freeze({
        anchor: caret,
        focus: caret
      })
      const entry = Object.freeze({
        forward: prepared.transition.edits,
        inverse: prepared.transition.inverseEdits,
        beforeSelection,
        afterSelection,
        beforeSourceSelection,
        afterSourceSelection: Object.freeze({
          anchor: caret,
          focus: caret
        })
      })
      return Object.freeze({
        revision: prepared.revision,
        markupView,
        transition: prepared.transition,
        selection: freezeSelection(
          state.session,
          next,
          'markup',
          afterSelection
        ),
        sourceSelection: freezeSelection(
          state.session,
          next,
          'source',
          Object.freeze({
            anchor: caret,
            focus: caret
          })
        ),
        history: 'record' as const,
        historyAction: Object.freeze({ kind: 'record' as const, entry })
      })
    }

    const caret = Object.freeze({
      offset: prepared.revision.source.text.length,
      affinity: 'previous' as const
    })
    const afterSelection = Object.freeze({
      anchor: caret,
      focus: caret
    })
    const entry = Object.freeze({
      forward: prepared.transition.edits,
      inverse: prepared.transition.inverseEdits,
      beforeSelection,
      afterSelection,
      beforeSourceSelection,
      afterSourceSelection: afterSelection
    })
    return Object.freeze({
      revision: prepared.revision,
      transition: prepared.transition,
      selection: freezeSelection(
        state.session,
        next,
        'source',
        afterSelection
      ),
      sourceSelection: freezeSelection(
        state.session,
        next,
        'source',
        afterSelection
      ),
      history: 'record' as const,
      historyAction: Object.freeze({ kind: 'record' as const, entry })
    })
  }

  prepareSourceEdit(
    target: SourceModelSelection,
    text: string,
    selection: InitialModelSelection,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    assertSourceSelection(target, state)
    const start = Math.min(target.anchor.offset, target.focus.offset)
    const end = Math.max(target.anchor.offset, target.focus.offset)
    if (state.revision.source.text.slice(start, end) === text) {
      throw new IntentRejection('no-source-change')
    }
    const source = `${state.revision.source.text.slice(0, start)}${text}` +
      state.revision.source.text.slice(end)
    assertPosition(selection.anchor, source.length)
    assertPosition(selection.focus, source.length)
    const edit = Object.freeze({ start, end, insert: text })
    const revision = this.#engine.open(
      createSourceSnapshot(source),
      state.revision.configuration
    )
    // Raw source input owns these exact bytes. It deliberately bypasses
    // semantic changed-join protection, just like a complete source import.
    const prepared = this.#reviseEdits(
      Object.freeze([edit]),
      next,
      Object.freeze({ kind: 'proven-candidate' as const, revision })
    )
    const beforeSelection = detachSelection(state.selection)
    const beforeSourceSelection = detachSelection(target)
    const afterSourceSelection = freezeInitialSelection(selection)

    if (prepared.revision.kind === 'complete') {
      const markupView = createMarkupView(prepared.revision)
      const anchor = modelPositionAtSemanticBoundary(
        markupView,
        afterSourceSelection.anchor
      )
      const focus = modelPositionAtSemanticBoundary(
        markupView,
        afterSourceSelection.focus
      )
      if (anchor === null || focus === null) {
        throw new Error('Source cursor cannot map to the next Markup projection')
      }
      const afterSelection = Object.freeze({ anchor, focus })
      const entry = Object.freeze({
        forward: prepared.transition.edits,
        inverse: prepared.transition.inverseEdits,
        beforeSelection,
        afterSelection,
        beforeSourceSelection,
        afterSourceSelection
      })
      return Object.freeze({
        revision: prepared.revision,
        markupView,
        transition: prepared.transition,
        selection: freezeSelection(
          state.session,
          next,
          'markup',
          afterSelection
        ),
        sourceSelection: freezeSelection(
          state.session,
          next,
          'source',
          afterSourceSelection
        ),
        history: 'record' as const,
        historyAction: Object.freeze({ kind: 'record' as const, entry })
      })
    }

    const entry = Object.freeze({
      forward: prepared.transition.edits,
      inverse: prepared.transition.inverseEdits,
      beforeSelection,
      afterSelection: afterSourceSelection,
      beforeSourceSelection,
      afterSourceSelection
    })
    return Object.freeze({
      revision: prepared.revision,
      transition: prepared.transition,
      selection: freezeSelection(
        state.session,
        next,
        'source',
        afterSourceSelection
      ),
      sourceSelection: freezeSelection(
        state.session,
        next,
        'source',
        afterSourceSelection
      ),
      history: 'record' as const,
      historyAction: Object.freeze({ kind: 'record' as const, entry })
    })
  }

  prepareTransformation(
    intent: TransformationIntent,
    next: RevisionId
  ): PreparedWorkerCommit {
    const state = this.#state
    if (!('markupView' in state)) {
      throw new IntentRejection('source-only-revision')
    }
    const result = this.#transformations.apply(state.revision, intent)
    if (result.kind === 'rejected') {
      throw new IntentRejection(result.reason)
    }
    if (result.edits.length === 0) {
      throw new IntentRejection('no-source-change')
    }

    return this.#prepareMappedEdits(
      result.edits,
      state.selection,
      next,
      Object.freeze({ kind: 'proven-candidate' as const, revision: result.revision })
    )
  }

  #prepareMappedEdits(
    edits: readonly SourceEdit[],
    target: ModelSelection,
    next: RevisionId,
    admission: AdmissionClass = TYPED_GESTURE
  ): PreparedWorkerCommit {
    const state = this.#state
    const sourceAnchor = this.#sourcePositionAt(state, target.anchor)
    const sourceFocus = this.#sourcePositionAt(state, target.focus)
    const prepared = this.#reviseEdits(edits, next, admission)
    const mappedAnchor = mapSourcePositionThroughEdits(
      sourceAnchor,
      prepared.transition.edits
    )
    const mappedFocus = mapSourcePositionThroughEdits(
      sourceFocus,
      prepared.transition.edits
    )

    if (prepared.revision.kind === 'complete') {
      const markupView = createMarkupView(prepared.revision)
      const anchor = modelPositionAtSemanticBoundary(markupView, mappedAnchor)
      const focus = modelPositionAtSemanticBoundary(markupView, mappedFocus)
      if (anchor === null || focus === null) {
        throw new Error(
          'Transformed selection is not representable in the next Markup view'
        )
      }
      const afterSelection = Object.freeze({ anchor, focus })
      const entry = Object.freeze({
        forward: prepared.transition.edits,
        inverse: prepared.transition.inverseEdits,
        beforeSelection: detachSelection(target),
        afterSelection,
        beforeSourceSelection: Object.freeze({
          anchor: sourceAnchor,
          focus: sourceFocus
        }),
        afterSourceSelection: Object.freeze({
          anchor: mappedAnchor,
          focus: mappedFocus
        })
      })
      return Object.freeze({
        revision: prepared.revision,
        markupView,
        transition: prepared.transition,
        selection: freezeSelection(
          state.session,
          next,
          'markup',
          afterSelection
        ),
        sourceSelection: freezeSelection(
          state.session,
          next,
          'source',
          Object.freeze({
            anchor: mappedAnchor,
            focus: mappedFocus
          })
        ),
        history: 'record' as const,
        historyAction: Object.freeze({ kind: 'record' as const, entry })
      })
    }

    const sourceLength = prepared.revision.source.text.length
    assertPosition(mappedAnchor, sourceLength)
    assertPosition(mappedFocus, sourceLength)
    const afterSelection = Object.freeze({
      anchor: mappedAnchor,
      focus: mappedFocus
    })
    const entry = Object.freeze({
      forward: prepared.transition.edits,
      inverse: prepared.transition.inverseEdits,
      beforeSelection: detachSelection(target),
      afterSelection,
      beforeSourceSelection: Object.freeze({
        anchor: sourceAnchor,
        focus: sourceFocus
      }),
      afterSourceSelection: afterSelection
    })
    return Object.freeze({
      revision: prepared.revision,
      transition: prepared.transition,
      selection: freezeSelection(
        state.session,
        next,
        'source',
        afterSelection
      ),
      sourceSelection: freezeSelection(
        state.session,
        next,
        'source',
        afterSelection
      ),
      history: 'record' as const,
      historyAction: Object.freeze({ kind: 'record' as const, entry })
    })
  }

  /**
   * Commit one source edit and settle where the caret lands.
   *
   * Insertion and deletion differ only in the edit they describe, so they share
   * this: the caret rule, the history entry and the transition are identical,
   * and having two copies is how they drift apart.
   */
  #prepareEdit(
    edit: Readonly<{ start: number, end: number, insert: string }>,
    caretSourceOffset: number,
    target: ModelSelection,
    next: RevisionId,
    explicitCaretSourceOffset?: number,
    coalescible = false
  ): PreparedWorkerCommit {
    const state = this.#state
    const beforeSourceSelection = Object.freeze({
      anchor: this.#sourcePositionAt(state, target.anchor),
      focus: this.#sourcePositionAt(state, target.focus)
    })
    const prepared = this.#revise(edit, next)
    const nextSourcePosition = Object.freeze({
      offset:
        explicitCaretSourceOffset ??
        caretSourceOffset + edit.insert.length,
      affinity: 'next' as const
    })
    if (prepared.revision.kind === 'complete') {
      const markupView = createMarkupView(prepared.revision)
      const nextPosition = modelPositionAtSemanticBoundary(
        markupView,
        nextSourcePosition
      )
      if (nextPosition === null) {
        throw new Error('Committed caret is not representable in the next Markup view')
      }
      const afterSelection = Object.freeze({
        anchor: nextPosition,
        focus: nextPosition
      })
      const entry = Object.freeze({
        forward: prepared.transition.edits,
        inverse: prepared.transition.inverseEdits,
        beforeSelection: detachSelection(target),
        afterSelection,
        beforeSourceSelection,
        afterSourceSelection: Object.freeze({
          anchor: nextSourcePosition,
          focus: nextSourcePosition
        })
      })
      return Object.freeze({
        revision: prepared.revision,
        markupView,
        transition: prepared.transition,
        selection: freezeSelection(state.session, next, 'markup', afterSelection),
        sourceSelection: freezeSelection(
          state.session,
          next,
          'source',
          Object.freeze({
            anchor: nextSourcePosition,
            focus: nextSourcePosition
          })
        ),
        history: 'record' as const,
        historyAction: Object.freeze({
          kind: 'record' as const,
          entry,
          coalescible
        })
      })
    }

    const afterSelection = Object.freeze({
      anchor: nextSourcePosition,
      focus: nextSourcePosition
    })
    const entry = Object.freeze({
      forward: prepared.transition.edits,
      inverse: prepared.transition.inverseEdits,
      beforeSelection: detachSelection(target),
      afterSelection,
      beforeSourceSelection,
      afterSourceSelection: afterSelection
    })
    return Object.freeze({
      revision: prepared.revision,
      transition: prepared.transition,
      selection: freezeSelection(state.session, next, 'source', afterSelection),
      sourceSelection: freezeSelection(state.session, next, 'source', afterSelection),
      history: 'record' as const,
      historyAction: Object.freeze({
        kind: 'record' as const,
        entry,
        coalescible
      })
    })
  }

  prepareUndo(next: RevisionId): PreparedWorkerCommit {
    const entry = this.#history[this.#historyCursor - 1]
    if (entry === undefined) {
      throw new IntentRejection('nothing-to-undo')
    }

    return this.#prepareHistoryEdits(
      entry.inverse,
      next,
      entry.beforeSelection,
      entry.beforeSourceSelection,
      'undo'
    )
  }

  prepareRedo(next: RevisionId): PreparedWorkerCommit {
    const entry = this.#history[this.#historyCursor]
    if (entry === undefined) {
      throw new IntentRejection('nothing-to-redo')
    }

    return this.#prepareHistoryEdits(
      entry.forward,
      next,
      entry.afterSelection,
      entry.afterSourceSelection,
      'redo'
    )
  }

  #sourcePositionAt(
    state: WorkerState,
    position: ModelPosition
  ): ModelPosition {
    if ('markupView' in state) {
      for (const run of state.markupView.runs) {
        if (
          position.offset > run.modelRange.start &&
          position.offset < run.modelRange.end
        ) {
          return Object.freeze({
            offset:
              run.sourceRange.start +
              position.offset -
              run.modelRange.start,
            affinity: position.affinity
          })
        }
        if (
          position.offset === run.modelRange.start &&
          position.affinity === 'next'
        ) {
          return Object.freeze({
            offset: run.sourceRange.start,
            affinity: position.affinity
          })
        }
        if (
          position.offset === run.modelRange.end &&
          position.affinity === 'previous'
        ) {
          return Object.freeze({
            offset: run.sourceRange.end,
            affinity: position.affinity
          })
        }
      }
      if (state.markupView.runs.length > 0) {
        const edge =
          position.offset === 0
            ? state.markupView.runs[0]
            : state.markupView.runs[state.markupView.runs.length - 1]
        if (edge !== undefined) {
          return Object.freeze({
            offset:
              position.offset === 0
                ? edge.sourceRange.start
                : edge.sourceRange.end,
            affinity: position.affinity
          })
        }
      }
      return state.markupView.sourcePositionAt(position)
    }
    return freezePosition(position)
  }

  #revise(edit: SourceEdit, next: RevisionId): PreparedRawRevision {
    return this.#reviseEdits(Object.freeze([edit]), next, TYPED_GESTURE)
  }

  #reviseEdits(
    edits: readonly SourceEdit[],
    next: RevisionId,
    admission: AdmissionClass
  ): PreparedRawRevision {
    const state = this.#state
    if (
      edits.length >
      DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction
    ) {
      throw new IntentRejection('invalid-command-argument')
    }
    let insertUnits = 0
    for (const edit of edits) {
      insertUnits += edit.insert.length
      if (
        edit.insert.length >
          DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits ||
        insertUnits > DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
      ) {
        throw new IntentRejection('invalid-command-argument')
      }
    }
    let effectiveEdits = edits
    let protectedTransaction: AppliedSourceEdits | undefined
    let protectedRevision: DocumentRevision | undefined
    // A typed source gesture may assemble a CriticMarkup delimiter across one
    // of its changed joins even when neither side was syntax before. Protect
    // exactly those newly classified joins before the candidate is published.
    // TransformationKernel revisions already carry this proof themselves.
    if (
      admission.kind === 'typed-gesture' &&
      state.revision.kind === 'complete'
    ) {
      const protected_ = protectChangedSourceJoins(
        this.#engine,
        state.revision,
        edits
      )
      effectiveEdits = protected_.transaction.edits
      protectedTransaction = protected_.transaction
      protectedRevision = protected_.revision
    }
    const transaction =
      protectedTransaction ??
      applySourceEdits(state.revision.source.text, effectiveEdits)
    // One gesture, one entry, exact undo: a candidate byte-identical to its
    // base corresponds to no gesture, so it mints no revision and records no
    // history — it rejects visibly instead (G27, non-negotiable 10). Replays
    // are exempt: their bytes were proved when first admitted.
    if (
      admission.kind !== 'exact-replay' &&
      transaction.source === state.revision.source.text
    ) {
      throw new IntentRejection('no-source-change')
    }
    const revision =
      (admission.kind === 'proven-candidate' ? admission.revision : undefined) ??
      protectedRevision ??
      this.#engine.reopen(
        state.revision,
        createSourceSnapshot(transaction.source),
        effectiveEdits
      )
    if (revision.source.text !== transaction.source) {
      throw new Error(
        'Prepared revision does not match its exact source-edit transaction'
      )
    }
    const transition = Object.freeze({
      base: state.id,
      next,
      edits: transaction.edits,
      inverseEdits: transaction.inverseEdits
    })
    return Object.freeze({ revision, transition })
  }

  #prepareHistoryEdits(
    edits: readonly SourceEdit[],
    next: RevisionId,
    restoredSelection: InitialModelSelection,
    restoredSourceSelection: InitialModelSelection,
    action: 'undo' | 'redo'
  ): PreparedWorkerCommit {
    const state = this.#state
    const prepared = this.#reviseEdits(edits, next, EXACT_REPLAY)
    if (prepared.revision.kind === 'complete') {
      const markupView = createMarkupView(prepared.revision)
      assertPosition(restoredSelection.anchor, markupView.modelLength)
      assertPosition(restoredSelection.focus, markupView.modelLength)
      assertPosition(
        restoredSourceSelection.anchor,
        prepared.revision.source.text.length
      )
      assertPosition(
        restoredSourceSelection.focus,
        prepared.revision.source.text.length
      )
      return Object.freeze({
        revision: prepared.revision,
        markupView,
        transition: prepared.transition,
        selection: freezeSelection(
          state.session,
          next,
          'markup',
          restoredSelection
        ),
        sourceSelection: freezeSelection(
          state.session,
          next,
          'source',
          restoredSourceSelection
        ),
        history: 'none' as const,
        historyAction: Object.freeze({ kind: action })
      })
    }

    const sourceLength = prepared.revision.source.text.length
    assertPosition(restoredSelection.anchor, sourceLength)
    assertPosition(restoredSelection.focus, sourceLength)
    return Object.freeze({
      revision: prepared.revision,
      transition: prepared.transition,
      selection: freezeSelection(
        state.session,
        next,
        'source',
        restoredSelection
      ),
      sourceSelection: freezeSelection(
        state.session,
        next,
        'source',
        restoredSourceSelection
      ),
      history: 'none' as const,
      historyAction: Object.freeze({ kind: action })
    })
  }

  /**
   * Absorb one coalescible admission into the open typed run, rewriting the
   * head entry, identity, and source hash in place. Returns false when the
   * admission must record its own entry — which also decides whether it
   * opens a new run.
   */
  #extendTypedRun(prepared: PreparedWorkerCommit): boolean {
    if (prepared.historyAction.kind !== 'record') {
      return false
    }
    const run = this.#openTypedRun
    const open = this.#history[this.#historyCursor - 1]
    if (
      run === null ||
      open === undefined ||
      prepared.historyAction.coalescible !== true ||
      this.#historyCursor !== this.#history.length
    ) {
      return false
    }
    const single = singleScalarPureInsert(prepared.historyAction.entry)
    const openRun = pureInsertRun(open)
    if (
      single === null ||
      openRun === null ||
      single.position !== run.caret ||
      openRun.position + openRun.text.length !== single.position ||
      (isWhitespaceScalar(run.lastScalar) &&
        !isWhitespaceScalar(single.scalar))
    ) {
      return false
    }
    const text = openRun.text + single.scalar
    this.#history[this.#historyCursor - 1] = freezeHistoryEntry(Object.freeze({
      forward: Object.freeze([Object.freeze({
        start: openRun.position,
        end: openRun.position,
        insert: text
      })]),
      inverse: Object.freeze([Object.freeze({
        start: openRun.position,
        end: openRun.position + text.length,
        insert: ''
      })]),
      beforeSelection: open.beforeSelection,
      afterSelection: prepared.historyAction.entry.afterSelection,
      beforeSourceSelection: open.beforeSourceSelection,
      afterSourceSelection: prepared.historyAction.entry.afterSourceSelection
    }))
    // The head position now denotes a different recorded state, so it mints
    // a fresh identity and content hash; earlier positions — including any
    // saved one, since persistence seals the run — are untouched.
    this.#savedIdentityLedger.replace(
      this.#historyCursor,
      prepared.revision.sourceHash
    )
    this.#openTypedRun = Object.freeze({
      caret: single.position + single.scalar.length,
      lastScalar: single.scalar
    })
    return true
  }

  commit(prepared: PreparedWorkerCommit): void {
    if (prepared.transition.base !== this.#state.id) {
      throw new Error('Prepared revision no longer matches the worker head')
    }

    if (prepared.historyAction.kind === 'record' &&
      this.#extendTypedRun(prepared)) {
      // The open typed run absorbed this admission: the entry, identity, and
      // source hash at the head position were rewritten in place.
    } else if (prepared.historyAction.kind === 'record') {
      const action = prepared.historyAction
      const single = singleScalarPureInsert(action.entry)
      this.#openTypedRun = action.coalescible === true && single !== null
        ? Object.freeze({
          caret: single.position + single.scalar.length,
          lastScalar: single.scalar
        })
        : null
      const stableEntry = freezeHistoryEntry(prepared.historyAction.entry)
      this.#history = this.#history.slice(0, this.#historyCursor)
      this.#savedIdentityLedger.record(
        this.#historyCursor + 1,
        prepared.revision.sourceHash
      )
      this.#history.push(stableEntry)
      this.#historyCursor += 1
      let historyInsertUnits = this.#history.reduce(
        (total, entry) =>
          total +
          [...entry.forward, ...entry.inverse].reduce(
            (entryTotal, edit) => entryTotal + edit.insert.length,
            0
          ),
        0
      )
      while (
        this.#history.length >
          DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEntries ||
        historyInsertUnits >
          DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryInsertUnits
      ) {
        const removed = this.#history.shift()
        if (removed === undefined) {
          throw new Error('Revision worker could not compact its history')
        }
        historyInsertUnits -= [...removed.forward, ...removed.inverse].reduce(
          (total, edit) => total + edit.insert.length,
          0
        )
        this.#savedIdentityLedger.shift()
        this.#historyCursor -= 1
      }
    } else if (prepared.historyAction.kind === 'undo') {
      this.#openTypedRun = null
      this.#historyCursor -= 1
    } else {
      this.#openTypedRun = null
      this.#historyCursor += 1
    }

    if ('markupView' in prepared) {
      this.#state = Object.freeze({
        session: this.#state.session,
        id: prepared.transition.next,
        revision: prepared.revision,
        markupView: prepared.markupView,
        selection: prepared.selection,
        sourceSelection: prepared.sourceSelection
      })
    } else {
      this.#state = Object.freeze({
        session: this.#state.session,
        id: prepared.transition.next,
        revision: prepared.revision,
        selection: prepared.selection
      })
    }
  }
}
