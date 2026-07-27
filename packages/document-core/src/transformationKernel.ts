import { createLanguageEngine, type LanguageEngine } from './languageEngine.js'
import type {
  CompleteDocumentRevision,
  CriticMarkupArm,
  CriticMarkupNode,
  DocumentRevision,
  MarkdownLiteralProvider,
  MarkdownNode,
  MarkupMark,
  NodeId,
  ProjectedCodeUnitOrigin,
  ProjectedMarkdown,
  SourceRange
} from './revision.js'
import { createSourceSnapshot } from './sourceSnapshot.js'

export interface TransformationSourceEdit {
  readonly start: number
  readonly end: number
  readonly insert: string
}

export type ChangeResolutionDecision = 'accept' | 'reject'

export type CriticMarkupAuthoringInput =
  | Readonly<{ readonly kind: 'addition' }>
  | Readonly<{ readonly kind: 'deletion' }>
  | Readonly<{
    readonly kind: 'substitution'
    readonly replacement: string
  }>
  | Readonly<{ readonly kind: 'highlight' }>
  | Readonly<{
    readonly kind: 'comment'
    readonly comment: string
  }>

export interface CriticMarkupAuthoringCapabilities {
  readonly canCreateAddition: boolean
  readonly canCreateDeletion: boolean
  readonly canCreateSubstitution: boolean
  readonly canCreateHighlight: boolean
  readonly canCreateComment: boolean
}

export type TransformationIntent =
  | Readonly<{
    readonly kind: 'resolve-change'
    readonly target: NodeId
    readonly decision: ChangeResolutionDecision
  }>
  | Readonly<{
    readonly kind: 'resolve-all-changes'
    readonly decision: ChangeResolutionDecision
  }>
  | Readonly<{
    readonly kind: 'remove-highlight'
    readonly target: NodeId
  }>
  | Readonly<{
    readonly kind: 'add-comment'
    readonly range: SourceRange
    readonly comment: string
  }>
  | Readonly<{
    readonly kind: 'edit-comment'
    readonly target: NodeId
    readonly comment: string
  }>
  | Readonly<{
    readonly kind: 'remove-comment'
    readonly target: NodeId
  }>

export type TransformationRejectionReason =
  | 'target-not-found'
  | 'wrong-target-kind'
  | 'invalid-source-range'
  | 'selection-collapsed'
  | 'empty-comment-anchor'
  | 'empty-comment'
  | 'invalid-comment-payload'
  | 'selection-crosses-syntax-boundary'
  | 'selection-includes-hidden-comment'
  | 'selection-partially-intersects-critic-markup'
  | 'selection-inside-markdown-literal'
  | 'selection-partially-intersects-markdown-literal'
  | 'markdown-literal-source-only'
  | 'selection-has-no-revised-contribution'
  | 'selection-has-no-original-contribution'
  | 'hidden-comment-loss'
  | 'candidate-source-only'
  | 'semantic-postcondition-failed'

export interface CommittedTransformation {
  readonly kind: 'committed'
  readonly revision: CompleteDocumentRevision
  readonly edits: readonly TransformationSourceEdit[]
}

export interface RejectedTransformation {
  readonly kind: 'rejected'
  readonly reason: TransformationRejectionReason
  /** The exact input revision; a rejected transform publishes no candidate. */
  readonly revision: CompleteDocumentRevision
  readonly edits: readonly []
}

export type TransformationResult =
  | CommittedTransformation
  | RejectedTransformation

export interface TransformationKernel {
  readonly apply: (
    revision: CompleteDocumentRevision,
    intent: TransformationIntent
  ) => TransformationResult
  readonly author: (
    revision: CompleteDocumentRevision,
    range: SourceRange,
    input: CriticMarkupAuthoringInput
  ) => TransformationResult
}

interface NodeRecord {
  readonly node: CriticMarkupNode
  readonly siblings: readonly CriticMarkupNode[]
  readonly siblingIndex: number
  readonly hasChangeAncestor: boolean
  readonly revisedPathVisible: boolean
}

interface CandidateDraft {
  readonly text: string
  /** One entry per UTF-16 code unit; null denotes transform-created source. */
  readonly origins: readonly (number | null)[]
  readonly joins: readonly number[]
}

type CandidateExpectation =
  | Readonly<{ readonly kind: 'generic' }>
  | Readonly<{
    readonly kind: 'comment-pair'
    readonly anchor: string
    readonly comment: string
  }>
  | Readonly<{
    readonly kind: 'comment-edit'
    readonly comment: string
  }>

interface PlannedTransformation {
  readonly edits: readonly TransformationSourceEdit[]
  readonly expectation: CandidateExpectation
}

interface PayloadOpaqueRange {
  readonly start: number
  readonly end: number
}

const CHANGE_KINDS = new Set<CriticMarkupNode['kind']>([
  'addition',
  'deletion',
  'substitution'
])

const CRITIC_OPENERS = Object.freeze([
  '{++',
  '{--',
  '{~~',
  '{==',
  '{>>'
])

function rejected(
  revision: CompleteDocumentRevision,
  reason: TransformationRejectionReason
): RejectedTransformation {
  return Object.freeze({
    kind: 'rejected',
    reason,
    revision,
    edits: Object.freeze([]) as readonly []
  })
}

function stableEdit(
  start: number,
  end: number,
  insert: string
): TransformationSourceEdit {
  return Object.freeze({ start, end, insert })
}

function mergeOpaqueRanges(
  ranges: readonly PayloadOpaqueRange[]
): readonly PayloadOpaqueRange[] {
  const sorted = [...ranges].sort(
    (left, right) => left.start - right.start || left.end - right.end
  )
  const merged: PayloadOpaqueRange[] = []
  for (const range of sorted) {
    const previous = merged[merged.length - 1]
    if (previous !== undefined && range.start <= previous.end) {
      merged[merged.length - 1] = Object.freeze({
        start: previous.start,
        end: Math.max(previous.end, range.end)
      })
    } else {
      merged.push(Object.freeze({ start: range.start, end: range.end }))
    }
  }
  return Object.freeze(merged)
}

function escapeCriticPayload(
  payload: string,
  close: '++}' | '--}' | '~~}' | '==}',
  escapeSubstitutionSeparator: boolean,
  opaqueRanges: readonly PayloadOpaqueRange[] = Object.freeze([])
): string {
  const ranges = mergeOpaqueRanges(opaqueRanges)
  const result: string[] = []
  const closePrefix = close.slice(0, -1)
  let opaqueIndex = 0
  let literalStart = 0

  const replace = (
    start: number,
    end: number,
    replacement: string
  ): void => {
    if (literalStart < start) {
      result.push(payload.slice(literalStart, start))
    }
    result.push(replacement)
    literalStart = end
  }

  for (let index = 0; index < payload.length;) {
    while ((ranges[opaqueIndex]?.end ?? Infinity) <= index) {
      opaqueIndex += 1
    }
    const opaque = ranges[opaqueIndex]
    if (opaque !== undefined && opaque.start <= index) {
      index = opaque.end
      continue
    }
    const lookaheadEnd = opaque?.start ?? payload.length
    let targetStart = index
    while (
      targetStart < lookaheadEnd &&
      payload[targetStart] === '\\'
    ) {
      targetStart += 1
    }
    const slashCount = targetStart - index
    const opener = CRITIC_OPENERS.find((candidate) =>
      payload.startsWith(candidate, targetStart)
    )
    const target =
      opener ??
      (
        escapeSubstitutionSeparator &&
        payload.startsWith('~>', targetStart)
          ? '~>'
          : undefined
      )
    if (
      target !== undefined &&
      targetStart + target.length <= lookaheadEnd
    ) {
      const end = targetStart + target.length
      replace(index, end, `${'\\'.repeat(slashCount * 2 + 1)}${target}`)
      index = end
      continue
    }
    if (slashCount > 0) {
      index = targetStart
      continue
    }
    if (
      index + closePrefix.length <= lookaheadEnd &&
      payload.startsWith(closePrefix, index)
    ) {
      let brace = index + closePrefix.length
      while (brace < lookaheadEnd && payload[brace] === '\\') {
        brace += 1
      }
      if (brace < lookaheadEnd && payload[brace] === '}') {
        const literalSlashes = brace - index - closePrefix.length
        const end = brace + 1
        replace(
          index,
          end,
          `${closePrefix}${'\\'.repeat(literalSlashes * 2 + 1)}}`
        )
        index = end
        continue
      }
    }
    index += 1
  }
  if (literalStart < payload.length) {
    result.push(payload.slice(literalStart))
  }
  return result.join('')
}

function serializeUnaryAuthoring(
  kind: 'addition' | 'deletion' | 'highlight',
  content: string,
  opaqueRanges: readonly PayloadOpaqueRange[]
): string {
  const markers = kind === 'addition'
    ? { open: '{++', close: '++}' as const }
    : kind === 'deletion'
      ? { open: '{--', close: '--}' as const }
      : { open: '{==', close: '==}' as const }
  return `${markers.open}${escapeCriticPayload(
    content,
    markers.close,
    false,
    opaqueRanges
  )}${markers.close}`
}

function serializeSubstitutionAuthoring(
  oldContent: string,
  newContent: string,
  oldOpaqueRanges: readonly PayloadOpaqueRange[]
): string {
  return `{~~${escapeCriticPayload(
    oldContent,
    '~~}',
    true,
    oldOpaqueRanges
  )}~>${escapeCriticPayload(newContent, '~~}', true)}~~}`
}

function rangeStart(range: SourceRange): number {
  return Number(range.start)
}

function rangeEnd(range: SourceRange): number {
  return Number(range.end)
}

function sourceOf(
  source: string,
  range: SourceRange
): string {
  return source.slice(rangeStart(range), rangeEnd(range))
}

function rootsOf(
  revision: CompleteDocumentRevision
): readonly CriticMarkupNode[] {
  return Object.freeze(
    Array.from(
      { length: revision.criticMarkup.rootCount },
      (_, index) => revision.criticMarkup.rootAt(index)
    )
  )
}

function recordsOf(
  revision: CompleteDocumentRevision
): readonly NodeRecord[] {
  const records: NodeRecord[] = []
  const visit = (
    siblings: readonly CriticMarkupNode[],
    hasChangeAncestor: boolean,
    revisedPathVisible: boolean
  ): void => {
    siblings.forEach((node, siblingIndex) => {
      records.push(Object.freeze({
        node,
        siblings,
        siblingIndex,
        hasChangeAncestor,
        revisedPathVisible
      }))
      for (const arm of node.arms) {
        visit(
          arm.children,
          hasChangeAncestor || isChange(node),
          revisedPathVisible && armSurvivesRevised(node, arm.name)
        )
      }
    })
  }
  visit(rootsOf(revision), false, true)
  return records
}

function recordFor(
  records: readonly NodeRecord[],
  target: NodeId
): NodeRecord | undefined {
  return records.find(({ node }) => node.nodeId === target)
}

function isChange(node: CriticMarkupNode): boolean {
  return CHANGE_KINDS.has(node.kind)
}

function armSurvivesRevised(
  node: CriticMarkupNode,
  arm: CriticMarkupArmName
): boolean {
  if (node.kind === 'addition' || node.kind === 'highlight') {
    return arm === 'content'
  }
  if (node.kind === 'substitution') {
    return arm === 'new'
  }
  return false
}

function armHasComment(arm: CriticMarkupArm<CriticMarkupArmName>): boolean {
  const pending = [...arm.children]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) {
      continue
    }
    if (node.kind === 'comment') {
      return true
    }
    for (const childArm of node.arms) {
      pending.push(...childArm.children)
    }
  }
  return false
}

type CriticMarkupArmName = 'content' | 'old' | 'new' | 'comment'

function hasCommentDescendant(node: CriticMarkupNode): boolean {
  return node.arms.some((arm) =>
    armHasComment(arm as CriticMarkupArm<CriticMarkupArmName>)
  )
}

function maximalNestedCommentSources(
  source: string,
  node: CriticMarkupNode
): readonly string[] {
  const comments: string[] = []
  const pending = node.arms
    .flatMap((arm) => arm.children)
    .slice()
    .reverse()
  while (pending.length > 0) {
    const child = pending.pop()
    if (child === undefined) {
      continue
    }
    if (child.kind === 'comment') {
      comments.push(sourceOf(source, child.range))
      continue
    }
    for (let armIndex = child.arms.length - 1; armIndex >= 0; armIndex -= 1) {
      const arm = child.arms[armIndex]
      if (arm === undefined) {
        continue
      }
      for (
        let childIndex = arm.children.length - 1;
        childIndex >= 0;
        childIndex -= 1
      ) {
        const nested = arm.children[childIndex]
        if (nested !== undefined) {
          pending.push(nested)
        }
      }
    }
  }
  return Object.freeze(comments)
}

function exactOccurrenceCount(value: string, pattern: string): number {
  let count = 0
  let from = 0
  while (from <= value.length - pattern.length) {
    const next = value.indexOf(pattern, from)
    if (next < 0) {
      break
    }
    count += 1
    from = next + pattern.length
  }
  return count
}

function editWouldLoseNestedComment(
  source: string,
  node: CriticMarkupNode,
  comment: string
): boolean {
  const required = new Map<string, number>()
  for (const raw of maximalNestedCommentSources(source, node)) {
    required.set(raw, (required.get(raw) ?? 0) + 1)
  }
  return [...required].some(([raw, count]) =>
    exactOccurrenceCount(comment, raw) < count
  )
}

function armHasRevisedAtom(
  arm: CriticMarkupArm<CriticMarkupArmName>
): boolean {
  let cursor = rangeStart(arm.range)
  for (const child of arm.children) {
    if (cursor < rangeStart(child.range) || nodeHasRevisedAtom(child)) {
      return true
    }
    cursor = rangeEnd(child.range)
  }
  return cursor < rangeEnd(arm.range)
}

function nodeHasRevisedAtom(node: CriticMarkupNode): boolean {
  if (node.kind === 'addition' || node.kind === 'highlight') {
    return armHasRevisedAtom(
      node.arms[0] as CriticMarkupArm<CriticMarkupArmName>
    )
  }
  if (node.kind === 'substitution') {
    return armHasRevisedAtom(
      node.arms[1] as CriticMarkupArm<CriticMarkupArmName>
    )
  }
  return false
}

function wouldLoseHiddenComment(
  node: CriticMarkupNode,
  decision: ChangeResolutionDecision
): boolean {
  if (node.kind === 'addition') {
    return decision === 'reject' &&
      armHasComment(node.arms[0] as CriticMarkupArm<CriticMarkupArmName>)
  }
  if (node.kind === 'deletion') {
    return decision === 'accept' &&
      armHasComment(node.arms[0] as CriticMarkupArm<CriticMarkupArmName>)
  }
  if (node.kind === 'substitution') {
    const discarded = decision === 'accept' ? node.arms[0] : node.arms[1]
    return armHasComment(
      discarded as CriticMarkupArm<CriticMarkupArmName>
    )
  }
  return false
}

function selectedArm(
  node: CriticMarkupNode,
  decision: ChangeResolutionDecision
): CriticMarkupArm<CriticMarkupArmName> | null {
  if (node.kind === 'addition') {
    return decision === 'accept'
      ? node.arms[0] as CriticMarkupArm<CriticMarkupArmName>
      : null
  }
  if (node.kind === 'deletion') {
    return decision === 'reject'
      ? node.arms[0] as CriticMarkupArm<CriticMarkupArmName>
      : null
  }
  if (node.kind === 'substitution') {
    return (
      decision === 'accept' ? node.arms[1] : node.arms[0]
    ) as CriticMarkupArm<CriticMarkupArmName>
  }
  return null
}

function renderArmResolvingChanges(
  source: string,
  arm: CriticMarkupArm<CriticMarkupArmName>,
  decision: ChangeResolutionDecision
): string {
  let cursor = rangeStart(arm.range)
  let rendered = ''
  for (const child of arm.children) {
    rendered += source.slice(cursor, rangeStart(child.range))
    rendered += isChange(child)
      ? renderResolvedChange(source, child, decision)
      : renderCarrierResolvingChanges(source, child, decision)
    cursor = rangeEnd(child.range)
  }
  return rendered + source.slice(cursor, rangeEnd(arm.range))
}

function renderCarrierResolvingChanges(
  source: string,
  node: CriticMarkupNode,
  decision: ChangeResolutionDecision
): string {
  let cursor = rangeStart(node.range)
  let rendered = ''
  for (const arm of node.arms) {
    rendered += source.slice(cursor, rangeStart(arm.range))
    rendered += renderArmResolvingChanges(
      source,
      arm as CriticMarkupArm<CriticMarkupArmName>,
      decision
    )
    cursor = rangeEnd(arm.range)
  }
  return rendered + source.slice(cursor, rangeEnd(node.range))
}

function renderResolvedChange(
  source: string,
  node: CriticMarkupNode,
  decision: ChangeResolutionDecision
): string {
  const arm = selectedArm(node, decision)
  return arm === null
    ? ''
    : renderArmResolvingChanges(source, arm, decision)
}

function validSourceRange(
  range: SourceRange,
  sourceLength: number
): boolean {
  const start = rangeStart(range)
  const end = rangeEnd(range)
  return Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end >= start &&
    end <= sourceLength
}

interface VisibleCriticMarkupOwner {
  readonly node: CriticMarkupNode
  readonly ranges: readonly SourceRange[]
}

interface MarkdownLiteralOwner {
  readonly provider: MarkdownLiteralProvider
  readonly ownerRange: SourceRange
  readonly visibleRange?: SourceRange
}

interface AuthoringTargetFacts {
  readonly criticMarkup: readonly VisibleCriticMarkupOwner[]
  readonly markdownLiterals: readonly MarkdownLiteralOwner[]
}

type AuthoringTargetClassification =
  | Readonly<{
    readonly kind: 'accepted'
    readonly range: SourceRange
  }>
  | Readonly<{
    readonly kind: 'rejected'
    readonly reason: TransformationRejectionReason
  }>

function freezeSourceRange(start: number, end: number): SourceRange {
  return Object.freeze({
    start: start as SourceRange['start'],
    end: end as SourceRange['end']
  })
}

function rangesOverlap(
  left: SourceRange,
  right: SourceRange
): boolean {
  return rangeStart(left) < rangeEnd(right) &&
    rangeStart(right) < rangeEnd(left)
}

function rangeContains(
  outer: SourceRange,
  inner: SourceRange
): boolean {
  return rangeStart(outer) <= rangeStart(inner) &&
    rangeEnd(outer) >= rangeEnd(inner)
}

function allCriticMarkupNodes(
  revision: CompleteDocumentRevision
): readonly CriticMarkupNode[] {
  const nodes: CriticMarkupNode[] = []
  const visit = (node: CriticMarkupNode): void => {
    nodes.push(node)
    for (const arm of node.arms) {
      for (const child of arm.children) {
        visit(child)
      }
    }
  }
  for (const root of rootsOf(revision)) {
    visit(root)
  }
  return Object.freeze(nodes)
}

function visibleCriticMarkupOwners(
  revision: CompleteDocumentRevision,
  nodes: readonly CriticMarkupNode[]
): readonly VisibleCriticMarkupOwner[] {
  const rangesByNode = new Map<NodeId, SourceRange[]>()
  for (let ordinal = 0; ordinal < revision.markup.runCount; ordinal += 1) {
    const run = revision.markup.runAt(ordinal)
    if (run.text.length === 0) {
      continue
    }
    for (const mark of run.marks) {
      const ranges = rangesByNode.get(mark.nodeId) ?? []
      ranges.push(run.sourceRange)
      rangesByNode.set(mark.nodeId, ranges)
    }
  }
  return Object.freeze(nodes.map((node) => Object.freeze({
    node,
    ranges: Object.freeze(rangesByNode.get(node.nodeId) ?? [])
  })))
}

function markdownLiteralProvider(
  node: MarkdownNode
): MarkdownLiteralProvider | undefined {
  switch (node.kind) {
    case 'inline-code':
      return 'inline-code'
    case 'code-block': {
      const provider = node.attributes['provider']
      return provider === 'fenced-code' || provider === 'indented-code'
        ? provider
        : undefined
    }
    case 'html-block':
      return 'html-block'
    case 'inline-html':
      return 'inline-html'
    case 'autolink':
      return 'autolink'
    case 'inline-math':
    case 'math-block':
      return 'math'
    case 'diagram':
      return 'diagram'
    default:
      return undefined
  }
}

function projectedLiteralContentRange(
  node: MarkdownNode
): Readonly<{ readonly start: number; readonly end: number }> | undefined {
  if (node.kind === 'autolink') {
    return Object.freeze({
      start: Math.min(node.range.end, node.range.start + 1),
      end: Math.max(node.range.start + 1, node.range.end - 1)
    })
  }
  if (node.kind === 'inline-html') {
    return node.range
  }
  const contentStart = node.attributes['contentStart']
  const contentEnd = node.attributes['contentEnd']
  if (
    typeof contentStart !== 'number' ||
    typeof contentEnd !== 'number'
  ) {
    return undefined
  }
  return Object.freeze({ start: contentStart, end: contentEnd })
}

function sourceUnitRange(
  origin: ProjectedCodeUnitOrigin
): Readonly<{ readonly start: number; readonly end: number }> {
  return origin.kind === 'canonical'
    ? Object.freeze({
      start: Number(origin.sourceOffset),
      end: Number(origin.sourceOffset) + 1
    })
    : Object.freeze({
      start: Number(origin.sourcePosition),
      end: Number(origin.sourcePosition)
    })
}

function canonicalEnvelope(
  projection: ProjectedMarkdown,
  start: number,
  end: number
): SourceRange | undefined {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > projection.source.length
  ) {
    return undefined
  }
  let sourceStart = Number.POSITIVE_INFINITY
  let sourceEnd = Number.NEGATIVE_INFINITY
  for (let offset = start; offset < end; offset += 1) {
    const unit = sourceUnitRange(projection.provenance.originAt(offset))
    sourceStart = Math.min(sourceStart, unit.start)
    sourceEnd = Math.max(sourceEnd, unit.end)
  }
  return Number.isFinite(sourceStart) && sourceEnd > sourceStart
    ? freezeSourceRange(sourceStart, sourceEnd)
    : undefined
}

function markdownLiteralOwners(
  revision: CompleteDocumentRevision
): readonly MarkdownLiteralOwner[] {
  const records = new Map<string, {
    provider: MarkdownLiteralProvider
    ownerRange: SourceRange
    visibleRange?: SourceRange
  }>()
  for (let ordinal = 0; ordinal < revision.ownership.count; ordinal += 1) {
    const run = revision.ownership.at(ordinal)
    if (run.owner.kind !== 'markdown-literal') {
      continue
    }
    const ownerRange = run.owner.ownerRange
    const key = [
      run.owner.provider,
      rangeStart(ownerRange),
      rangeEnd(ownerRange)
    ].join(':')
    if (!records.has(key)) {
      records.set(key, {
        provider: run.owner.provider,
        ownerRange
      })
    }
  }
  if (records.size === 0) {
    return Object.freeze([])
  }

  const projection = revision.projection('editing')
  const visit = (node: MarkdownNode): void => {
    const provider = markdownLiteralProvider(node)
    const projectedContent = projectedLiteralContentRange(node)
    const nodeEnvelope = canonicalEnvelope(
      projection,
      node.range.start,
      node.range.end
    )
    const visibleRange = projectedContent === undefined
      ? undefined
      : canonicalEnvelope(
        projection,
        projectedContent.start,
        projectedContent.end
      )
    if (
      provider !== undefined &&
      nodeEnvelope !== undefined &&
      visibleRange !== undefined
    ) {
      for (const record of records.values()) {
        if (
          record.provider !== provider ||
          rangeStart(record.ownerRange) !== rangeStart(nodeEnvelope) ||
          rangeEnd(record.ownerRange) !== rangeEnd(nodeEnvelope)
        ) {
          continue
        }
        record.visibleRange = record.visibleRange === undefined
          ? visibleRange
          : freezeSourceRange(
            Math.min(
              rangeStart(record.visibleRange),
              rangeStart(visibleRange)
            ),
            Math.max(
              rangeEnd(record.visibleRange),
              rangeEnd(visibleRange)
            )
          )
      }
    }
    for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
      visit(node.childAt(ordinal))
    }
  }
  visit(projection.markdown.root)

  return Object.freeze([...records.values()].map((record) =>
    Object.freeze(record)
  ))
}

function authoringTargetFacts(
  revision: CompleteDocumentRevision
): AuthoringTargetFacts {
  const nodes = allCriticMarkupNodes(revision)
  return Object.freeze({
    criticMarkup: visibleCriticMarkupOwners(revision, nodes),
    markdownLiterals: markdownLiteralOwners(revision)
  })
}

function widenCompleteOwners(
  range: SourceRange,
  facts: AuthoringTargetFacts
): SourceRange {
  let start = rangeStart(range)
  let end = rangeEnd(range)
  let changed = true
  while (changed) {
    changed = false
    const selected = freezeSourceRange(start, end)
    for (const owner of facts.criticMarkup) {
      if (
        owner.node.kind === 'comment' ||
        owner.ranges.length === 0 ||
        !owner.ranges.every((visible) => rangeContains(selected, visible))
      ) {
        continue
      }
      const widenedStart = Math.min(start, rangeStart(owner.node.range))
      const widenedEnd = Math.max(end, rangeEnd(owner.node.range))
      if (widenedStart !== start || widenedEnd !== end) {
        start = widenedStart
        end = widenedEnd
        changed = true
      }
    }
    const criticWidened = freezeSourceRange(start, end)
    for (const owner of facts.markdownLiterals) {
      if (
        owner.visibleRange === undefined ||
        !rangeContains(criticWidened, owner.visibleRange)
      ) {
        continue
      }
      const widenedStart = Math.min(start, rangeStart(owner.ownerRange))
      const widenedEnd = Math.max(end, rangeEnd(owner.ownerRange))
      if (widenedStart !== start || widenedEnd !== end) {
        start = widenedStart
        end = widenedEnd
        changed = true
      }
    }
  }
  return freezeSourceRange(start, end)
}

function selectionIncludesHiddenComment(
  range: SourceRange,
  nodes: readonly CriticMarkupNode[]
): boolean {
  for (const node of nodes) {
    if (node.kind === 'comment' && rangesOverlap(range, node.range)) {
      return true
    }
  }
  return false
}

function selectionBoundaryCutsCriticMarker(
  range: SourceRange,
  nodes: readonly CriticMarkupNode[]
): boolean {
  const start = rangeStart(range)
  const end = rangeEnd(range)
  for (const node of nodes) {
    const markers = node.kind === 'substitution'
      ? [node.markers.open, node.markers.separator, node.markers.close]
      : [node.markers.open, node.markers.close]
    if (markers.some((marker) =>
      (
        rangeStart(marker) < start &&
        start < rangeEnd(marker)
      ) ||
      (
        rangeStart(marker) < end &&
        end < rangeEnd(marker)
      )
    )) {
      return true
    }
  }
  return false
}

function criticMarkupIntersectionReason(
  range: SourceRange,
  nodes: readonly CriticMarkupNode[]
): TransformationRejectionReason | undefined {
  for (const node of nodes) {
    if (!rangesOverlap(range, node.range)) {
      continue
    }
    if (node.kind === 'comment') {
      return 'selection-includes-hidden-comment'
    }
    if (rangeContains(range, node.range)) {
      continue
    }
    const containingArm = node.arms.find((arm) =>
      rangeContains(arm.range, range)
    )
    if (containingArm !== undefined) {
      const nested = criticMarkupIntersectionReason(
        range,
        containingArm.children
      )
      if (nested !== undefined) {
        return nested
      }
      continue
    }
    if (
      node.kind === 'substitution' &&
      node.arms.filter((arm) => rangesOverlap(range, arm.range)).length > 1
    ) {
      return 'selection-crosses-syntax-boundary'
    }
    return 'selection-partially-intersects-critic-markup'
  }
  return undefined
}

function markdownLiteralIntersectionReason(
  range: SourceRange,
  owners: readonly MarkdownLiteralOwner[]
): TransformationRejectionReason | undefined {
  for (const owner of owners) {
    if (!rangesOverlap(range, owner.ownerRange)) {
      continue
    }
    if (owner.visibleRange === undefined) {
      return 'markdown-literal-source-only'
    }
    if (rangeContains(range, owner.ownerRange)) {
      continue
    }
    if (rangeContains(owner.visibleRange, range)) {
      return 'selection-inside-markdown-literal'
    }
    return 'selection-partially-intersects-markdown-literal'
  }
  return undefined
}

function runSurvivesRootRevised(
  marks: readonly MarkupMark[]
): boolean {
  return marks.every((mark) =>
    mark.kind !== 'deletion' &&
    !(mark.kind === 'substitution' && mark.arm === 'old')
  )
}

function runSurvivesRootOriginal(
  marks: readonly MarkupMark[]
): boolean {
  return marks.every((mark) =>
    mark.kind !== 'addition' &&
    !(mark.kind === 'substitution' && mark.arm === 'new')
  )
}

function hasProjectionContribution(
  revision: CompleteDocumentRevision,
  range: SourceRange,
  view: 'original' | 'revised'
): boolean {
  for (let ordinal = 0; ordinal < revision.markup.runCount; ordinal += 1) {
    const run = revision.markup.runAt(ordinal)
    if (
      run.text.length > 0 &&
      rangesOverlap(range, run.sourceRange) &&
      (
        view === 'revised'
          ? runSurvivesRootRevised(run.marks)
          : runSurvivesRootOriginal(run.marks)
      )
    ) {
      return true
    }
  }
  return false
}

function classifyAuthoringTarget(
  revision: CompleteDocumentRevision,
  range: SourceRange,
  inputKind: CriticMarkupAuthoringInput['kind'],
  facts: AuthoringTargetFacts = authoringTargetFacts(revision)
): AuthoringTargetClassification {
  if (!validSourceRange(range, revision.source.text.length)) {
    return Object.freeze({
      kind: 'rejected',
      reason: 'invalid-source-range'
    })
  }
  if (rangeStart(range) === rangeEnd(range)) {
    return Object.freeze({
      kind: 'rejected',
      reason: inputKind === 'comment'
        ? 'empty-comment-anchor'
        : 'selection-collapsed'
    })
  }

  const nodes = facts.criticMarkup.map(({ node }) => node)
  if (selectionBoundaryCutsCriticMarker(range, nodes)) {
    return Object.freeze({
      kind: 'rejected',
      reason: 'selection-partially-intersects-critic-markup'
    })
  }
  const effectiveRange = widenCompleteOwners(range, facts)
  if (selectionIncludesHiddenComment(effectiveRange, nodes)) {
    return Object.freeze({
      kind: 'rejected',
      reason: 'selection-includes-hidden-comment'
    })
  }
  const criticReason = criticMarkupIntersectionReason(
    effectiveRange,
    rootsOf(revision)
  )
  if (criticReason !== undefined) {
    return Object.freeze({ kind: 'rejected', reason: criticReason })
  }
  const literalReason = markdownLiteralIntersectionReason(
    effectiveRange,
    facts.markdownLiterals
  )
  if (literalReason !== undefined) {
    return Object.freeze({ kind: 'rejected', reason: literalReason })
  }

  if (
    (inputKind === 'addition' || inputKind === 'comment') &&
    !hasProjectionContribution(revision, effectiveRange, 'revised')
  ) {
    return Object.freeze({
      kind: 'rejected',
      reason: 'selection-has-no-revised-contribution'
    })
  }
  if (
    (inputKind === 'deletion' || inputKind === 'substitution') &&
    !hasProjectionContribution(revision, effectiveRange, 'original')
  ) {
    return Object.freeze({
      kind: 'rejected',
      reason: 'selection-has-no-original-contribution'
    })
  }
  return Object.freeze({ kind: 'accepted', range: effectiveRange })
}

export function criticMarkupAuthoringCapabilities(
  revision: CompleteDocumentRevision,
  range: SourceRange
): CriticMarkupAuthoringCapabilities {
  const facts = authoringTargetFacts(revision)
  const accepted = (kind: CriticMarkupAuthoringInput['kind']): boolean =>
    classifyAuthoringTarget(revision, range, kind, facts).kind === 'accepted'
  return Object.freeze({
    canCreateAddition: accepted('addition'),
    canCreateDeletion: accepted('deletion'),
    canCreateSubstitution: accepted('substitution'),
    canCreateHighlight: accepted('highlight'),
    canCreateComment: accepted('comment')
  })
}

function authoringOpaqueRanges(
  revision: CompleteDocumentRevision,
  range: SourceRange
): readonly PayloadOpaqueRange[] {
  const selectedStart = rangeStart(range)
  const selectedEnd = rangeEnd(range)
  const ranges: PayloadOpaqueRange[] = []
  const visit = (node: CriticMarkupNode): void => {
    const nodeStart = rangeStart(node.range)
    const nodeEnd = rangeEnd(node.range)
    if (nodeStart >= selectedStart && nodeEnd <= selectedEnd) {
      ranges.push(Object.freeze({
        start: nodeStart - selectedStart,
        end: nodeEnd - selectedStart
      }))
      return
    }
    for (const arm of node.arms) {
      for (const child of arm.children) {
        visit(child)
      }
    }
  }
  for (const root of rootsOf(revision)) {
    visit(root)
  }
  for (const owner of markdownLiteralOwners(revision)) {
    const ownerStart = rangeStart(owner.ownerRange)
    const ownerEnd = rangeEnd(owner.ownerRange)
    if (ownerStart >= selectedStart && ownerEnd <= selectedEnd) {
      ranges.push(Object.freeze({
        start: ownerStart - selectedStart,
        end: ownerEnd - selectedStart
      }))
    }
  }
  return mergeOpaqueRanges(ranges)
}

function validCommentPayload(
  engine: LanguageEngine,
  configuration: CompleteDocumentRevision['configuration'],
  comment: string
): boolean {
  const wrapped = `{>>${comment}<<}`
  const revision = engine.open(createSourceSnapshot(wrapped), configuration)
  if (revision.kind !== 'complete' || revision.criticMarkup.rootCount !== 1) {
    return false
  }
  const root = revision.criticMarkup.rootAt(0)
  return root.kind === 'comment' &&
    rangeStart(root.range) === 0 &&
    rangeEnd(root.range) === wrapped.length &&
    sourceOf(wrapped, root.arms[0].range) === comment
}

function sortedNonoverlapping(
  edits: readonly TransformationSourceEdit[],
  sourceLength: number
): boolean {
  let previousEnd = 0
  for (const [index, edit] of edits.entries()) {
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > sourceLength ||
      (index > 0 && edit.start < previousEnd)
    ) {
      return false
    }
    previousEnd = edit.end
  }
  return true
}

function buildCandidateDraft(
  source: string,
  edits: readonly TransformationSourceEdit[]
): CandidateDraft {
  const units: string[] = []
  const origins: Array<number | null> = []
  const joins: number[] = []
  let sourceCursor = 0

  const appendOriginal = (start: number, end: number): void => {
    for (let offset = start; offset < end; offset += 1) {
      units.push(source[offset] ?? '')
      origins.push(offset)
    }
  }

  for (const edit of edits) {
    appendOriginal(sourceCursor, edit.start)
    joins.push(units.length)
    for (let offset = 0; offset < edit.insert.length; offset += 1) {
      units.push(edit.insert[offset] ?? '')
      origins.push(null)
    }
    joins.push(units.length)
    sourceCursor = edit.end
  }
  appendOriginal(sourceCursor, source.length)

  return Object.freeze({
    text: units.join(''),
    origins: Object.freeze(origins),
    joins: Object.freeze(joins)
  })
}

function protectionPositions(
  revision: CompleteDocumentRevision,
  joins: readonly number[]
): readonly number[] {
  const positions = new Set<number>()
  for (let index = 0; index < revision.ownership.count; index += 1) {
    const run = revision.ownership.at(index)
    if (run.owner.kind !== 'critic-marker') {
      continue
    }
    const start = rangeStart(run.range)
    const end = rangeEnd(run.range)
    if (!joins.some((join) => start < join && join < end)) {
      continue
    }
    positions.add(
      run.owner.role === 'close' ? end - 1 : start
    )
  }
  return Object.freeze([...positions].sort((left, right) => right - left))
}

function protectChangedJoins(
  engine: LanguageEngine,
  revision: CompleteDocumentRevision,
  draft: CandidateDraft
): CandidateDraft | null {
  const parsed = engine.open(
    createSourceSnapshot(draft.text),
    revision.configuration
  )
  if (parsed.kind !== 'complete') {
    return null
  }

  const units = draft.text.split('')
  const origins = [...draft.origins]
  for (const position of protectionPositions(parsed, draft.joins)) {
    units.splice(position, 0, '\\')
    origins.splice(position, 0, null)
  }
  if (
    units[0] === '\uFEFF' &&
    !revision.source.text.startsWith('\uFEFF')
  ) {
    units.splice(0, 1, ...'&#xFEFF;'.split(''))
    origins.splice(0, 1, ...Array<null>(8).fill(null))
  }
  return Object.freeze({
    text: units.join(''),
    origins: Object.freeze(origins),
    joins: draft.joins
  })
}

function exactEditsFromOrigins(
  source: string,
  candidate: CandidateDraft
): readonly TransformationSourceEdit[] {
  const edits: TransformationSourceEdit[] = []
  let sourceCursor = 0
  let candidateCursor = 0

  while (
    sourceCursor < source.length ||
    candidateCursor < candidate.text.length
  ) {
    if (
      candidateCursor < candidate.origins.length &&
      candidate.origins[candidateCursor] === sourceCursor
    ) {
      sourceCursor += 1
      candidateCursor += 1
      continue
    }

    const editStart = sourceCursor
    const insertStart = candidateCursor
    let anchorCursor = candidateCursor
    while (
      anchorCursor < candidate.origins.length &&
      candidate.origins[anchorCursor] === null
    ) {
      anchorCursor += 1
    }
    const anchor = candidate.origins[anchorCursor]
    if (anchor === undefined) {
      const insert = candidate.text.slice(insertStart)
      if (sourceCursor < source.length || insert.length > 0) {
        edits.push(stableEdit(sourceCursor, source.length, insert))
      }
      break
    }

    const anchorOffset = anchor ?? source.length
    const insert = candidate.text.slice(insertStart, anchorCursor)
    if (anchorOffset > editStart || insert.length > 0) {
      edits.push(stableEdit(editStart, anchorOffset, insert))
    }
    sourceCursor = anchorOffset
    candidateCursor = anchorCursor
  }

  return Object.freeze(edits)
}

function applyExactEdits(
  source: string,
  edits: readonly TransformationSourceEdit[]
): string {
  let result = source
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index]
    if (edit === undefined) {
      continue
    }
    result =
      result.slice(0, edit.start) +
      edit.insert +
      result.slice(edit.end)
  }
  return result
}

function editTouchesNode(
  edit: TransformationSourceEdit,
  node: CriticMarkupNode
): boolean {
  const start = rangeStart(node.range)
  const end = rangeEnd(node.range)
  if (edit.start === edit.end) {
    return start < edit.start && edit.start < end
  }
  return edit.start < end && start < edit.end
}

function mapStart(
  offset: number,
  edits: readonly TransformationSourceEdit[]
): number {
  let mapped = offset
  for (const edit of edits) {
    const delta = edit.insert.length - (edit.end - edit.start)
    if (
      edit.end < offset ||
      edit.end === offset ||
      (edit.start === edit.end && edit.start <= offset)
    ) {
      mapped += delta
    }
  }
  return mapped
}

function mapEnd(
  offset: number,
  edits: readonly TransformationSourceEdit[]
): number {
  let mapped = offset
  for (const edit of edits) {
    const delta = edit.insert.length - (edit.end - edit.start)
    if (
      edit.end < offset ||
      (edit.end === offset && edit.start !== edit.end) ||
      (edit.start === edit.end && edit.start < offset)
    ) {
      mapped += delta
    }
  }
  return mapped
}

function preservesUntargetedNodes(
  before: CompleteDocumentRevision,
  candidate: CompleteDocumentRevision,
  edits: readonly TransformationSourceEdit[]
): boolean {
  const candidateNodes = recordsOf(candidate).map(({ node }) => node)
  for (const { node } of recordsOf(before)) {
    if (edits.some((edit) => editTouchesNode(edit, node))) {
      continue
    }
    const expectedStart = mapStart(rangeStart(node.range), edits)
    const expectedEnd = mapEnd(rangeEnd(node.range), edits)
    const raw = sourceOf(before.source.text, node.range)
    const survivor = candidateNodes.find((next) =>
      next.kind === node.kind &&
      rangeStart(next.range) === expectedStart &&
      rangeEnd(next.range) === expectedEnd &&
      sourceOf(candidate.source.text, next.range) === raw
    )
    if (survivor === undefined) {
      return false
    }
  }
  return true
}

function configurationIsSame(
  before: CompleteDocumentRevision,
  candidate: CompleteDocumentRevision
): boolean {
  return JSON.stringify(before.configuration) ===
    JSON.stringify(candidate.configuration)
}

function expectationPasses(
  candidate: CompleteDocumentRevision,
  expectation: CandidateExpectation
): boolean {
  if (expectation.kind === 'generic') {
    return true
  }
  const records = recordsOf(candidate)
  if (expectation.kind === 'comment-edit') {
    return records.some(({ node }) =>
      node.kind === 'comment' &&
      sourceOf(candidate.source.text, node.arms[0].range) ===
        expectation.comment
    )
  }

  return records.some((record) => {
    const comment = record.node
    if (
      comment.kind !== 'comment' ||
      sourceOf(candidate.source.text, comment.arms[0].range) !==
        expectation.comment ||
      record.siblingIndex === 0
    ) {
      return false
    }
    const anchor = record.siblings[record.siblingIndex - 1]
    return anchor?.kind === 'highlight' &&
      rangeEnd(anchor.range) === rangeStart(comment.range) &&
      sourceOf(candidate.source.text, anchor.arms[0].range) ===
        expectation.anchor
  })
}

function commitCandidate(
  engine: LanguageEngine,
  before: CompleteDocumentRevision,
  plan: PlannedTransformation
): TransformationResult {
  if (!sortedNonoverlapping(plan.edits, before.source.text.length)) {
    return rejected(before, 'semantic-postcondition-failed')
  }
  if (plan.edits.length === 0) {
    return Object.freeze({
      kind: 'committed',
      revision: before,
      edits: Object.freeze([])
    })
  }

  const draft = buildCandidateDraft(before.source.text, plan.edits)
  const protectedDraft = protectChangedJoins(engine, before, draft)
  if (protectedDraft === null) {
    return rejected(before, 'candidate-source-only')
  }
  const edits = exactEditsFromOrigins(before.source.text, protectedDraft)
  if (
    !sortedNonoverlapping(edits, before.source.text.length) ||
    applyExactEdits(before.source.text, edits) !== protectedDraft.text
  ) {
    return rejected(before, 'semantic-postcondition-failed')
  }

  const opened: DocumentRevision = engine.open(
    createSourceSnapshot(protectedDraft.text),
    before.configuration
  )
  if (opened.kind !== 'complete') {
    return rejected(before, 'candidate-source-only')
  }
  if (
    !configurationIsSame(before, opened) ||
    !preservesUntargetedNodes(before, opened, edits) ||
    !expectationPasses(opened, plan.expectation)
  ) {
    return rejected(before, 'semantic-postcondition-failed')
  }

  return Object.freeze({
    kind: 'committed',
    revision: opened,
    edits
  })
}

function planResolveChange(
  revision: CompleteDocumentRevision,
  records: readonly NodeRecord[],
  target: NodeId,
  decision: ChangeResolutionDecision
): PlannedTransformation | TransformationRejectionReason {
  const record = recordFor(records, target)
  if (record === undefined) {
    return 'target-not-found'
  }
  if (!isChange(record.node)) {
    return 'wrong-target-kind'
  }
  if (wouldLoseHiddenComment(record.node, decision)) {
    return 'hidden-comment-loss'
  }
  const arm = selectedArm(record.node, decision)
  return Object.freeze({
    edits: Object.freeze([
      stableEdit(
        rangeStart(record.node.range),
        rangeEnd(record.node.range),
        arm === null ? '' : sourceOf(revision.source.text, arm.range)
      )
    ]),
    expectation: Object.freeze({ kind: 'generic' })
  })
}

function planResolveAll(
  revision: CompleteDocumentRevision,
  records: readonly NodeRecord[],
  decision: ChangeResolutionDecision
): PlannedTransformation | TransformationRejectionReason {
  const changes = records.filter(({ node }) => isChange(node))
  if (changes.some(({ node }) => wouldLoseHiddenComment(node, decision))) {
    return 'hidden-comment-loss'
  }
  const maximal = changes.filter(({ hasChangeAncestor }) =>
    !hasChangeAncestor
  )
  const edits = maximal
    .map(({ node }) =>
      stableEdit(
        rangeStart(node.range),
        rangeEnd(node.range),
        renderResolvedChange(revision.source.text, node, decision)
      )
    )
    .sort((left, right) => left.start - right.start)
  return Object.freeze({
    edits: Object.freeze(edits),
    expectation: Object.freeze({ kind: 'generic' })
  })
}

function planRemoveHighlight(
  revision: CompleteDocumentRevision,
  records: readonly NodeRecord[],
  target: NodeId
): PlannedTransformation | TransformationRejectionReason {
  const record = recordFor(records, target)
  if (record === undefined) {
    return 'target-not-found'
  }
  if (record.node.kind !== 'highlight') {
    return 'wrong-target-kind'
  }
  return Object.freeze({
    edits: Object.freeze([
      stableEdit(
        rangeStart(record.node.range),
        rangeEnd(record.node.range),
        sourceOf(revision.source.text, record.node.arms[0].range)
      )
    ]),
    expectation: Object.freeze({ kind: 'generic' })
  })
}

function planAddComment(
  engine: LanguageEngine,
  revision: CompleteDocumentRevision,
  range: SourceRange,
  comment: string
): PlannedTransformation | TransformationRejectionReason {
  if (comment.trim().length === 0) {
    return 'empty-comment'
  }
  if (!validCommentPayload(engine, revision.configuration, comment)) {
    return 'invalid-comment-payload'
  }
  const selected = sourceOf(revision.source.text, range)
  const anchor = escapeCriticPayload(
    selected,
    '==}',
    false,
    authoringOpaqueRanges(revision, range)
  )
  return Object.freeze({
    edits: Object.freeze([
      stableEdit(
        rangeStart(range),
        rangeEnd(range),
        `{==${anchor}==}{>>${comment}<<}`
      )
    ]),
    expectation: Object.freeze({
      kind: 'comment-pair',
      anchor,
      comment
    })
  })
}

function planCriticMarkupAuthoring(
  engine: LanguageEngine,
  revision: CompleteDocumentRevision,
  range: SourceRange,
  input: CriticMarkupAuthoringInput
): PlannedTransformation | TransformationRejectionReason {
  const classification = classifyAuthoringTarget(
    revision,
    range,
    input.kind
  )
  if (classification.kind === 'rejected') {
    return classification.reason
  }
  const effectiveRange = classification.range
  if (input.kind === 'comment') {
    return planAddComment(
      engine,
      revision,
      effectiveRange,
      input.comment
    )
  }

  const selected = sourceOf(revision.source.text, effectiveRange)
  const opaqueRanges = authoringOpaqueRanges(revision, effectiveRange)
  const insert = input.kind === 'substitution'
    ? serializeSubstitutionAuthoring(
      selected,
      input.replacement,
      opaqueRanges
    )
    : serializeUnaryAuthoring(input.kind, selected, opaqueRanges)
  return Object.freeze({
    edits: Object.freeze([
      stableEdit(
        rangeStart(effectiveRange),
        rangeEnd(effectiveRange),
        insert
      )
    ]),
    expectation: Object.freeze({ kind: 'generic' })
  })
}

function planEditComment(
  engine: LanguageEngine,
  revision: CompleteDocumentRevision,
  records: readonly NodeRecord[],
  target: NodeId,
  comment: string
): PlannedTransformation | TransformationRejectionReason {
  const record = recordFor(records, target)
  if (record === undefined) {
    return 'target-not-found'
  }
  if (record.node.kind !== 'comment') {
    return 'wrong-target-kind'
  }
  if (comment.trim().length === 0) {
    return 'empty-comment'
  }
  if (!validCommentPayload(engine, revision.configuration, comment)) {
    return 'invalid-comment-payload'
  }
  if (
    editWouldLoseNestedComment(
      revision.source.text,
      record.node,
      comment
    )
  ) {
    return 'hidden-comment-loss'
  }
  const arm = record.node.arms[0]
  if (sourceOf(revision.source.text, arm.range) === comment) {
    return Object.freeze({
      edits: Object.freeze([]),
      expectation: Object.freeze({ kind: 'generic' })
    })
  }
  return Object.freeze({
    edits: Object.freeze([
      stableEdit(rangeStart(arm.range), rangeEnd(arm.range), comment)
    ]),
    expectation: Object.freeze({
      kind: 'comment-edit',
      comment
    })
  })
}

function planRemoveComment(
  revision: CompleteDocumentRevision,
  records: readonly NodeRecord[],
  target: NodeId
): PlannedTransformation | TransformationRejectionReason {
  const record = recordFor(records, target)
  if (record === undefined) {
    return 'target-not-found'
  }
  const comment = record.node
  if (comment.kind !== 'comment') {
    return 'wrong-target-kind'
  }
  if (hasCommentDescendant(comment)) {
    return 'hidden-comment-loss'
  }

  const previous = record.siblings[record.siblingIndex - 1]
  const previousRecord = records.find(({ node }) => node === previous)
  const pairedHighlight = previous?.kind === 'highlight' &&
    rangeEnd(previous.range) === rangeStart(comment.range) &&
    previousRecord?.revisedPathVisible === true &&
    nodeHasRevisedAtom(previous)
    ? previous
    : undefined
  if (pairedHighlight !== undefined) {
    return Object.freeze({
      edits: Object.freeze([
        stableEdit(
          rangeStart(pairedHighlight.range),
          rangeEnd(comment.range),
          sourceOf(
            revision.source.text,
            pairedHighlight.arms[0].range
          )
        )
      ]),
      expectation: Object.freeze({ kind: 'generic' })
    })
  }

  return Object.freeze({
    edits: Object.freeze([
      stableEdit(rangeStart(comment.range), rangeEnd(comment.range), '')
    ]),
    expectation: Object.freeze({ kind: 'generic' })
  })
}

function isRejectionReason(
  plan: PlannedTransformation | TransformationRejectionReason
): plan is TransformationRejectionReason {
  return typeof plan === 'string'
}

/**
 * Creates the pure source-native transformation boundary.
 *
 * The returned kernel never mutates its input. It authenticates NodeId/range
 * intent against one Complete revision, emits exact sorted source edits,
 * protects CriticMarkup delimiters activated at changed joins, reopens the
 * candidate with the revision's frozen configuration, and only publishes a
 * replacement revision after semantic postconditions pass.
 */
export function createTransformationKernel(
  engine: LanguageEngine = createLanguageEngine()
): TransformationKernel {
  const apply = (
    revision: CompleteDocumentRevision,
    intent: TransformationIntent
  ): TransformationResult => {
    const records = recordsOf(revision)
    let plan: PlannedTransformation | TransformationRejectionReason
    switch (intent.kind) {
      case 'resolve-change':
        plan = planResolveChange(
          revision,
          records,
          intent.target,
          intent.decision
        )
        break
      case 'resolve-all-changes':
        plan = planResolveAll(revision, records, intent.decision)
        break
      case 'remove-highlight':
        plan = planRemoveHighlight(revision, records, intent.target)
        break
      case 'add-comment':
        plan = planCriticMarkupAuthoring(
          engine,
          revision,
          intent.range,
          Object.freeze({
            kind: 'comment',
            comment: intent.comment
          })
        )
        break
      case 'edit-comment':
        plan = planEditComment(
          engine,
          revision,
          records,
          intent.target,
          intent.comment
        )
        break
      case 'remove-comment':
        plan = planRemoveComment(revision, records, intent.target)
        break
    }

    return isRejectionReason(plan)
      ? rejected(revision, plan)
      : commitCandidate(engine, revision, plan)
  }

  const author = (
    revision: CompleteDocumentRevision,
    range: SourceRange,
    input: CriticMarkupAuthoringInput
  ): TransformationResult => {
    const plan = planCriticMarkupAuthoring(
      engine,
      revision,
      range,
      input
    )
    return isRejectionReason(plan)
      ? rejected(revision, plan)
      : commitCandidate(engine, revision, plan)
  }

  return Object.freeze({
    apply: Object.freeze(apply),
    author: Object.freeze(author)
  })
}
