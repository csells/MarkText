import {
  commentPairPreservingResolution,
  createDocumentCore,
  projectTableSelection,
  projectModelTextSelection,
  projectSourceSelection,
  rebaseDocumentInputSelection,
  type DocumentClipboardSelection,
  DOCUMENT_RESOURCE_POLICY_V1,
  DocumentCoreError,
  DocumentSourceEditError,
  copyDocumentSelection,
  type DocumentSelection,
  type DocumentSourceInputAction,
  type SourceRange,
  type DocumentCore,
  type DocumentInputPlan,
  type DocumentFormatPlan,
  type DocumentClipboardPlan,
  type DocumentAuthorPlan,
  type DocumentRevision,
  type DocumentSourceEdit,
  type CriticMarkupAnnotation,
  type MarkdownAst,
  type MarkdownAstNode,
  type MarkdownAttribute,
  type MarkdownOptions,
  type MarkdownProjection
} from '@marktext/document-core'

import type {
  CoreHistoryEntry,
  CoreRetainedSelectionReply,
  CoreRejectedReply,
  CoreHistorySnapshot,
  CoreConsumerSearchMatch,
  CoreReply,
  CoreRequest,
  CoreReviewItemLocator,
  CoreReviewOverviewEntry
} from './coreProtocol'
import { createMuyaMarkupView } from './muyaMarkupView'
import { stringAttribute } from '../documentConsumers/astAttributes'
import { searchableBlockKinds, semanticProjectionOf } from '../documentConsumers/semanticProjection'
import { createReviewOverviewTracker } from './coreReviewOverview'
import { createConsumerSummaryTracker } from './coreConsumerSummary'

export interface CoreActor {
  handle(request: CoreRequest): CoreReply
  dispose(): void
}

export interface CoreActorOptions {
  readonly maximumHistoryEntries?: number
  readonly maximumHistoryInsertUnits?: number
  readonly maximumHistoryEditRecords?: number
  readonly maximumHistoryEditsPerEntry?: number
}

const DIAGNOSTIC_SAMPLE_LIMIT = 16

const diagnosticsOf = (revision: DocumentRevision) =>
  Object.freeze({
    diagnosticCount: revision.diagnostics.length,
    diagnostics: Object.freeze(revision.diagnostics.slice(0, DIAGNOSTIC_SAMPLE_LIMIT))
  })

// Unlike `semanticProjectionOf`'s default, an empty `semanticContent` falls
// back to the span's `content`.
const consumerInlineCodeText = (node: MarkdownAstNode): string =>
  stringAttribute(node, 'semanticContent') || (stringAttribute(node, 'content') ?? '')

const consumerSemanticTextOf = (node: MarkdownAstNode): string =>
  semanticProjectionOf(node, undefined, consumerInlineCodeText).text

const nodeAtConsumerPath = (
  ast: MarkdownAst,
  path: readonly number[]
): MarkdownAstNode | undefined => {
  let node = ast.root
  for (const index of path) {
    if (!Number.isSafeInteger(index) || index < 0) return undefined
    const child = node.children[index]
    if (child === undefined) return undefined
    node = child
  }
  return node
}

const projectedRangeForConsumerMatch = (
  projection: MarkdownProjection,
  match: CoreConsumerSearchMatch
): Readonly<{ readonly start: number; readonly end: number }> | undefined => {
  if (
    match === null ||
    typeof match !== 'object' ||
    !Array.isArray(match.path) ||
    match.path.length === 0 ||
    !Number.isSafeInteger(match.start) ||
    !Number.isSafeInteger(match.end) ||
    match.start < 0 ||
    match.end <= match.start ||
    typeof match.match !== 'string' ||
    match.match.length !== match.end - match.start
  ) {
    return undefined
  }
  const block = nodeAtConsumerPath(projection.ast, match.path)
  if (block === undefined || !searchableBlockKinds.has(block.kind)) return undefined
  const semantic = semanticProjectionOf(block, projection.markdown, consumerInlineCodeText)
  if (semantic.text.slice(match.start, match.end) !== match.match) return undefined
  // Only a text leaf spelled directly can hold the whole match.
  const leaf = semantic.segments.find(
    (segment) =>
      segment.kind === 'text' &&
      match.start >= segment.semanticStart &&
      match.end <= segment.semanticEnd
  )
  if (leaf === undefined) return undefined
  const resolved = Object.freeze({
    start: leaf.projectionStart + match.start - leaf.semanticStart,
    end: leaf.projectionStart + match.end - leaf.semanticStart
  })
  if (projection.markdown.slice(resolved.start, resolved.end) !== match.match) return undefined
  return resolved
}

const AUTHOR_FORMS = ['addition', 'comment', 'highlight', 'substitution'] as const
// Stand-in for the user's not-yet-entered comment or replacement text.
const AUTHOR_PROBE_TEXT = 'x'

const selectionAstOf = (
  projection: MarkdownProjection,
  start: number,
  end: number
): MarkdownAst | undefined => {
  const selected = new Map<MarkdownAstNode, MarkdownAstNode>()
  let supported = true
  const intersects = (node: MarkdownAstNode): boolean =>
    node.kind === 'document' || (node.range.start < end && node.range.end > start)
  const pending: Array<
    Readonly<{
      readonly node: MarkdownAstNode
      readonly ready: boolean
    }>
  > = [{ node: projection.ast.root, ready: false }]

  while (pending.length > 0 && supported) {
    const task = pending.pop()
    if (task === undefined) break
    if (!task.ready) {
      pending.push({ node: task.node, ready: true })
      for (let index = task.node.children.length - 1; index >= 0; index -= 1) {
        const child = task.node.children[index]
        if (child !== undefined && intersects(child)) {
          pending.push({ node: child, ready: false })
        }
      }
      continue
    }

    const rangeStart = Math.max(start, task.node.range.start)
    const rangeEnd = Math.min(end, task.node.range.end)
    const fullySelected = task.node.range.start >= start && task.node.range.end <= end
    const attributes: Record<string, MarkdownAttribute> = {
      ...task.node.attributes
    }
    for (const name of Object.keys(attributes)) {
      if (!name.endsWith('Start')) continue
      const base = name.slice(0, -'Start'.length)
      const endName = `${base}End`
      const attributeStart = attributes[name]
      const attributeEnd = attributes[endName]
      if (typeof attributeStart !== 'number' || typeof attributeEnd !== 'number') {
        continue
      }
      if (attributeStart < start || attributeEnd > end) {
        delete attributes[name]
        delete attributes[endName]
      } else {
        attributes[name] = attributeStart - start
        attributes[endName] = attributeEnd - start
      }
    }

    let kind = task.node.kind
    if (!fullySelected && task.node.children.length === 0) {
      const raw = projection.markdown.slice(task.node.range.start, task.node.range.end)
      const selectedRaw = raw.slice(
        rangeStart - task.node.range.start,
        rangeEnd - task.node.range.start
      )
      if (task.node.kind === 'text') {
        if (attributes.semanticText !== raw) {
          supported = false
          break
        }
        attributes.semanticText = selectedRaw
      } else {
        // Part of a literal leaf (formula, code span, tag) is its selected
        // source characters; its whole-node meaning no longer applies.
        kind = 'text'
        for (const name of Object.keys(attributes)) delete attributes[name]
        attributes.semanticText = selectedRaw
      }
    }

    selected.set(
      task.node,
      Object.freeze({
        kind,
        range: Object.freeze({
          start: rangeStart - start,
          end: rangeEnd - start
        }),
        attributes: Object.freeze(attributes),
        children: Object.freeze(
          task.node.children.flatMap((child) => {
            const item = selected.get(child)
            return item === undefined ? [] : [item]
          })
        )
      })
    )
  }

  const root = selected.get(projection.ast.root)
  return supported && root !== undefined ? Object.freeze({ root }) : undefined
}

export function createCoreActor(
  createCore: () => DocumentCore = createDocumentCore,
  options: CoreActorOptions = {}
): CoreActor {
  const maximumHistoryEntries =
    options.maximumHistoryEntries ?? DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEntries
  const maximumHistoryInsertUnits =
    options.maximumHistoryInsertUnits ?? DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryInsertUnits
  const maximumHistoryEditRecords =
    options.maximumHistoryEditRecords ?? DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEditRecords
  const maximumHistoryEditsPerEntry =
    options.maximumHistoryEditsPerEntry ?? DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEditsPerEntry
  if (
    !Number.isSafeInteger(maximumHistoryEntries) ||
    maximumHistoryEntries < 1 ||
    !Number.isSafeInteger(maximumHistoryInsertUnits) ||
    maximumHistoryInsertUnits < 1 ||
    !Number.isSafeInteger(maximumHistoryEditRecords) ||
    maximumHistoryEditRecords < 1 ||
    !Number.isSafeInteger(maximumHistoryEditsPerEntry) ||
    maximumHistoryEditsPerEntry < 1
  ) {
    throw new TypeError('Core actor history limits must be positive integers')
  }
  if (
    maximumHistoryEntries > DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEntries ||
    maximumHistoryInsertUnits > DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryInsertUnits ||
    maximumHistoryEditRecords > DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEditRecords ||
    maximumHistoryEditsPerEntry > DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEditsPerEntry
  ) {
    throw new RangeError('Core actor history limits cannot exceed the engine resource policy')
  }
  let core: DocumentCore | undefined
  let revision: DocumentRevision | undefined
  let session = 0
  let sequence = 0
  let revisionNumber = 0
  let markdownOptions: Readonly<Partial<MarkdownOptions>> | undefined
  let disposed = false
  let nextRetainedSelection = 0
  const retainedSelections = new Map<
    string,
    {
      id: string
      order: number
      selection: DocumentClipboardSelection
      selectionRevision: number
      status: 'ready' | 'conflict'
    }
  >()
  type HistoryEntry = CoreHistoryEntry
  const undoStack: HistoryEntry[] = []
  let nativeHistoryGroup: Readonly<{ id: string; entry: HistoryEntry }> | undefined
  const redoStack: HistoryEntry[] = []
  let undoUnits = 0
  let redoUnits = 0
  let undoEditRecords = 0
  let redoEditRecords = 0

  const historyUnits = (entry: HistoryEntry): number =>
    entry.undo.reduce((sum, edit) => sum + edit.insert.length, 0) +
    entry.redo.reduce((sum, edit) => sum + edit.insert.length, 0)

  const historyEditRecords = (entry: HistoryEntry): number => entry.undo.length + entry.redo.length

  const trimUndoHistory = (): void => {
    while (
      undoStack.length > maximumHistoryEntries ||
      undoUnits + redoUnits > maximumHistoryInsertUnits ||
      undoEditRecords + redoEditRecords > maximumHistoryEditRecords
    ) {
      const removed = undoStack.shift()
      if (removed === undefined) break
      undoUnits -= historyUnits(removed)
      undoEditRecords -= historyEditRecords(removed)
    }
  }

  const copyEdits = (edits: readonly DocumentSourceEdit[]) =>
    Object.freeze(edits.map((edit) => Object.freeze({ ...edit })))
  const copySelection = (selection: DocumentSelection): DocumentSelection =>
    copyDocumentSelection(selection, Number.MAX_SAFE_INTEGER)
  const singleSelection = (selection: SourceRange | DocumentSelection): DocumentSelection =>
    !('start' in selection)
      ? copySelection(selection)
      : Object.freeze({
        ranges: Object.freeze([Object.freeze({ anchor: selection.start, focus: selection.end })]),
        primary: 0
      })
  /** A joined step's redo caret, unless the joined change ended the text before it. */
  const joinedAfterSelection = (
    selection: DocumentSelection | undefined,
    sourceLength: number
  ): Readonly<{ afterSelection?: DocumentSelection }> => {
    if (selection === undefined) return {}
    try {
      return { afterSelection: copyDocumentSelection(selection, sourceLength) }
    } catch {
      return {}
    }
  }
  const copyEntry = (entry: HistoryEntry): HistoryEntry =>
    Object.freeze({
      undo: copyEdits(entry.undo),
      redo: copyEdits(entry.redo),
      ...(entry.beforeSelection === undefined
        ? {}
        : { beforeSelection: copySelection(entry.beforeSelection) }),
      ...(entry.afterSelection === undefined
        ? {}
        : { afterSelection: copySelection(entry.afterSelection) })
    })
  const recoveryHistory = (): CoreHistorySnapshot =>
    Object.freeze({
      undo: Object.freeze(undoStack.map(copyEntry)),
      redo: Object.freeze(redoStack.map(copyEntry)),
      ...(nativeHistoryGroup !== undefined && undoStack.at(-1) === nativeHistoryGroup.entry
        ? { nativeHistoryGroup: nativeHistoryGroup.id }
        : {})
    })
  const applyRecoveryEdits = (
    source: string,
    edits: readonly DocumentSourceEdit[]
  ): string | undefined => {
    let previousEnd = 0
    let nextLength = source.length
    for (const edit of edits) {
      if (
        edit === null ||
        typeof edit !== 'object' ||
        !Number.isSafeInteger(edit.start) ||
        !Number.isSafeInteger(edit.end) ||
        typeof edit.insert !== 'string' ||
        edit.start < previousEnd ||
        edit.end < edit.start ||
        edit.end > source.length
      ) {
        return undefined
      }
      nextLength += edit.insert.length - (edit.end - edit.start)
      previousEnd = edit.end
    }
    if (nextLength > DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits) {
      return undefined
    }
    let result = source
    for (let index = edits.length - 1; index >= 0; index -= 1) {
      const edit = edits[index]
      if (edit === undefined) return undefined
      result = result.slice(0, edit.start) + edit.insert + result.slice(edit.end)
    }
    return result
  }
  /**
   * Whether ordered `edits` leave the source as it is, reading only the span
   * from the first edit's start to the last one's end.
   */
  const leavesSourceUnchanged = (
    activeCore: DocumentCore,
    activeRevision: DocumentRevision,
    edits: readonly DocumentSourceEdit[]
  ): boolean => {
    const first = edits[0]
    const last = edits.at(-1)
    if (first === null || typeof first !== 'object' || last === null || typeof last !== 'object') {
      return false
    }
    const { start } = first
    const { end } = last
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > activeRevision.sourceLength
    ) {
      return false
    }
    const span = activeCore.sourceSlice(activeRevision, { start, end })
    const local = edits.map((edit) =>
      edit === null || typeof edit !== 'object'
        ? edit
        : { ...edit, start: edit.start - start, end: edit.end - start }
    )
    return applyRecoveryEdits(span, local) === span
  }
  const restoreHistory = (
    snapshot: CoreHistorySnapshot,
    checkpointSource: string,
    checkpointOptions?: Readonly<Partial<MarkdownOptions>>
  ): 'restored' | 'invalid' | 'resource' => {
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      !Array.isArray(snapshot.undo) ||
      !Array.isArray(snapshot.redo)
    ) {
      return 'invalid'
    }
    if (
      snapshot.nativeHistoryGroup !== undefined &&
      (typeof snapshot.nativeHistoryGroup !== 'string' ||
        snapshot.nativeHistoryGroup.length === 0 ||
        snapshot.nativeHistoryGroup.length > 128 ||
        snapshot.undo.length === 0 ||
        snapshot.redo.length > 0)
    ) {
      return 'invalid'
    }
    const validSelection = (
      value: unknown,
      length = Number.MAX_SAFE_INTEGER
    ): value is DocumentSelection => {
      try {
        copyDocumentSelection(value as DocumentSelection, length)
        return true
      } catch {
        return false
      }
    }
    const validEntry = (value: unknown): value is HistoryEntry => {
      if (value === null || typeof value !== 'object') return false
      const entry = value as Partial<HistoryEntry>
      if (!Array.isArray(entry.undo) || !Array.isArray(entry.redo)) return false
      if (entry.undo.length === 0 || entry.redo.length === 0) return false
      // A review command's entry keeps only the selection its undo restores.
      if (entry.beforeSelection !== undefined || entry.afterSelection !== undefined) {
        if (
          !validSelection(entry.beforeSelection) ||
          (entry.afterSelection !== undefined && !validSelection(entry.afterSelection))
        ) {
          return false
        }
      }
      return [...entry.undo, ...entry.redo].every(
        (edit) =>
          edit !== null &&
          typeof edit === 'object' &&
          Number.isSafeInteger(edit.start) &&
          Number.isSafeInteger(edit.end) &&
          typeof edit.insert === 'string'
      )
    }
    if (!snapshot.undo.every(validEntry) || !snapshot.redo.every(validEntry)) {
      return 'invalid'
    }
    const restoredUndo = snapshot.undo.map(copyEntry)
    const restoredRedo = snapshot.redo.map(copyEntry)
    const entries = [...restoredUndo, ...restoredRedo]
    const units = entries.reduce((sum, entry) => sum + historyUnits(entry), 0)
    const records = entries.reduce((sum, entry) => sum + historyEditRecords(entry), 0)
    if (
      restoredUndo.length + restoredRedo.length > maximumHistoryEntries ||
      entries.some(
        (entry) =>
          entry.undo.length > maximumHistoryEditsPerEntry ||
          entry.redo.length > maximumHistoryEditsPerEntry
      ) ||
      units > maximumHistoryInsertUnits ||
      records > maximumHistoryEditRecords
    ) {
      return 'resource'
    }
    const isReachableSource = (source: string): boolean => {
      try {
        createDocumentCore().open(source, checkpointOptions)
        return true
      } catch (error) {
        if (error instanceof DocumentCoreError || error instanceof RangeError) {
          return false
        }
        throw error
      }
    }
    let undoSource = checkpointSource
    for (let index = restoredUndo.length - 1; index >= 0; index -= 1) {
      const entry = restoredUndo[index]
      if (entry === undefined) return 'invalid'
      const prior = applyRecoveryEdits(undoSource, entry.undo)
      if (
        prior === undefined ||
        prior === undoSource ||
        (entry.beforeSelection !== undefined &&
          !validSelection(entry.beforeSelection, prior.length)) ||
        (entry.afterSelection !== undefined &&
          !validSelection(entry.afterSelection, undoSource.length)) ||
        !isReachableSource(prior) ||
        applyRecoveryEdits(prior, entry.redo) !== undoSource
      ) {
        return 'invalid'
      }
      undoSource = prior
    }
    let redoSource = checkpointSource
    for (let index = restoredRedo.length - 1; index >= 0; index -= 1) {
      const entry = restoredRedo[index]
      if (entry === undefined) return 'invalid'
      const next = applyRecoveryEdits(redoSource, entry.redo)
      if (
        next === undefined ||
        next === redoSource ||
        (entry.beforeSelection !== undefined &&
          !validSelection(entry.beforeSelection, redoSource.length)) ||
        (entry.afterSelection !== undefined &&
          !validSelection(entry.afterSelection, next.length)) ||
        !isReachableSource(next) ||
        applyRecoveryEdits(next, entry.undo) !== redoSource
      ) {
        return 'invalid'
      }
      redoSource = next
    }
    undoStack.push(...restoredUndo)
    redoStack.push(...restoredRedo)
    nativeHistoryGroup =
      snapshot.nativeHistoryGroup === undefined
        ? undefined
        : { id: snapshot.nativeHistoryGroup, entry: restoredUndo.at(-1)! }
    undoUnits = restoredUndo.reduce((sum, entry) => sum + historyUnits(entry), 0)
    redoUnits = restoredRedo.reduce((sum, entry) => sum + historyUnits(entry), 0)
    undoEditRecords = restoredUndo.reduce((sum, entry) => sum + historyEditRecords(entry), 0)
    redoEditRecords = restoredRedo.reduce((sum, entry) => sum + historyEditRecords(entry), 0)
    return 'restored'
  }

  const inverseEdits = (
    activeCore: DocumentCore,
    activeRevision: DocumentRevision,
    edits: readonly DocumentSourceEdit[]
  ): readonly DocumentSourceEdit[] => {
    let delta = 0
    return Object.freeze(
      edits.map((edit) => {
        const removed = activeCore.sourceSlice(activeRevision, edit)
        const start = edit.start + delta
        delta += edit.insert.length - (edit.end - edit.start)
        return Object.freeze({
          start,
          end: start + edit.insert.length,
          insert: removed
        })
      })
    )
  }

  const mergeNativeHistory = (
    previous: HistoryEntry,
    next: HistoryEntry,
    activeCore: DocumentCore,
    activeRevision: DocumentRevision
  ): HistoryEntry | null | undefined => {
    // Both edit lists address the current intermediate source. Read only their
    // shared envelope, keeping normal typing work proportional to the group.
    let start = activeRevision.sourceLength
    let end = 0
    for (const edits of [previous.undo, next.redo]) {
      for (const edit of edits) {
        start = Math.min(start, edit.start)
        end = Math.max(end, edit.end)
      }
    }
    const delta = (items: readonly DocumentSourceEdit[]) =>
      items.reduce((sum, edit) => sum + edit.insert.length - edit.end + edit.start, 0)
    const units = 2 * (end - start) + delta(previous.undo) + delta(next.redo)
    if (!Number.isSafeInteger(units) || units > maximumHistoryInsertUnits) return undefined
    const source = activeCore.sourceSlice(activeRevision, { start, end })
    const local = (items: readonly DocumentSourceEdit[]) =>
      items.map((edit) => ({
        start: edit.start - start,
        end: edit.end - start,
        insert: edit.insert
      }))
    const before = applyRecoveryEdits(source, local(previous.undo))
    const after = applyRecoveryEdits(source, local(next.redo))
    if (before === undefined || after === undefined) return undefined
    if (before === after) return null
    let prefix = 0
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
      prefix += 1
    }
    let suffix = 0
    while (
      suffix < before.length - prefix &&
      suffix < after.length - prefix &&
      before[before.length - suffix - 1] === after[after.length - suffix - 1]
    ) {
      suffix += 1
    }
    return Object.freeze({
      ...(previous.beforeSelection === undefined
        ? {}
        : { beforeSelection: previous.beforeSelection }),
      undo: Object.freeze([
        {
          start: start + prefix,
          end: start + after.length - suffix,
          insert: before.slice(prefix, before.length - suffix)
        }
      ]),
      redo: Object.freeze([
        {
          start: start + prefix,
          end: start + before.length - suffix,
          insert: after.slice(prefix, after.length - suffix)
        }
      ])
    })
  }

  // The Review overview resolves every item, so index each revision's
  // annotations once instead of walking the tree per item.
  const annotationIndexes = new WeakMap<DocumentRevision, Map<string, CriticMarkupAnnotation>>()
  const annotationFor = (
    activeRevision: DocumentRevision,
    locator: Readonly<{
      readonly kind: CriticMarkupAnnotation['kind']
      readonly range: Readonly<{ readonly start: number; readonly end: number }>
    }>
  ): CriticMarkupAnnotation | undefined => {
    let index = annotationIndexes.get(activeRevision)
    if (index === undefined) {
      index = new Map()
      const pending = [...activeRevision.annotations]
      while (pending.length > 0) {
        const annotation = pending.pop()
        if (annotation === undefined) continue
        const key = `${annotation.kind}:${annotation.range.start}:${annotation.range.end}`
        if (!index.has(key)) index.set(key, annotation)
        for (const arm of annotation.arms) pending.push(...arm.annotations)
      }
      annotationIndexes.set(activeRevision, index)
    }
    return index.get(`${locator.kind}:${locator.range.start}:${locator.range.end}`)
  }

  const reviewOverview = createReviewOverviewTracker()
  const consumerSummary = createConsumerSummaryTracker()
  const reviewItemsFor = (
    activeCore: DocumentCore,
    activeRevision: DocumentRevision
  ): readonly CoreReviewItemLocator[] =>
    reviewOverview.overview(activeCore, activeRevision).map((entry) => entry.item)

  const reviewItemFor = (
    activeCore: DocumentCore,
    activeRevision: DocumentRevision,
    direction: 'next' | 'previous',
    from: number
  ): CoreReviewOverviewEntry | undefined => {
    let best: CoreReviewItemLocator | undefined
    const entries = reviewOverview.overview(activeCore, activeRevision)
    const items = entries.map((entry) => entry.item)
    for (const annotation of items) {
      if (direction === 'next') {
        const containsCursor = annotation.range.start < from && annotation.range.end > from
        if (annotation.range.start < from && !containsCursor) continue
        if (
          best === undefined ||
          (containsCursor && !(best.range.start < from && best.range.end > from)) ||
          (containsCursor === (best.range.start < from && best.range.end > from) &&
            annotation.range.start < best.range.start) ||
          (annotation.range.start === best.range.start && annotation.range.end < best.range.end)
        ) {
          best = annotation
        }
      } else {
        const containsCursor = annotation.range.start < from && annotation.range.end > from
        if (annotation.range.end > from && !containsCursor) continue
        if (
          best === undefined ||
          (containsCursor && !(best.range.start < from && best.range.end > from)) ||
          (containsCursor === (best.range.start < from && best.range.end > from) &&
            annotation.range.start > best.range.start) ||
          (annotation.range.start === best.range.start && annotation.range.end > best.range.end)
        ) {
          best = annotation
        }
      }
    }
    if (direction === 'next' && best !== undefined) {
      for (const candidate of items) {
        if (
          candidate !== best &&
          candidate.range.start >= from &&
          candidate.range.start >= best.range.start &&
          candidate.range.end <= best.range.end &&
          (candidate.range.start > best.range.start || candidate.range.end < best.range.end)
        ) {
          best = candidate
        }
      }
    }
    return best === undefined ? undefined : entries[items.indexOf(best)]
  }

  const commentAnnotationFor = (
    activeCore: DocumentCore,
    activeRevision: DocumentRevision,
    locator: CoreReviewItemLocator
  ): CriticMarkupAnnotation | undefined => {
    if (locator.kind === 'comment') return annotationFor(activeRevision, locator)
    if (locator.kind !== 'commented-span') return undefined
    const span = reviewItemsFor(activeCore, activeRevision).find(
      (item) =>
        item.kind === 'commented-span' &&
        item.range.start === locator.range.start &&
        item.range.end === locator.range.end &&
        item.highlightRange.start === locator.highlightRange.start &&
        item.highlightRange.end === locator.highlightRange.end &&
        item.commentRange.start === locator.commentRange.start &&
        item.commentRange.end === locator.commentRange.end
    )
    return span?.kind === 'commented-span'
      ? annotationFor(activeRevision, {
        kind: 'comment',
        range: span.commentRange
      })
      : undefined
  }

  const resolutionEditFor = (
    activeCore: DocumentCore,
    activeRevision: DocumentRevision,
    annotation: CriticMarkupAnnotation,
    decision: 'accept' | 'reject'
  ): DocumentSourceEdit | undefined => {
    // Bulk resolution yields the Revised or Original column (Profile 1 §10),
    // so suggestions nested in the kept arm resolve with the same decision.
    // Highlights keep their markers and Comments keep their exact payload.
    const resolvedSource = (
      range: SourceRange,
      annotations: readonly CriticMarkupAnnotation[]
    ): string | undefined => {
      let resolved = ''
      let cursor = range.start
      for (const nested of annotations) {
        resolved += activeCore.sourceSlice(activeRevision, { start: cursor, end: nested.range.start })
        if (nested.kind === 'highlight') {
          const content = nested.arms.find((arm) => arm.name === 'content')
          const inner =
            content === undefined ? undefined : resolvedSource(content.range, content.annotations)
          if (content === undefined || inner === undefined) return undefined
          resolved +=
            activeCore.sourceSlice(activeRevision, {
              start: nested.range.start,
              end: content.range.start
            }) +
            inner +
            activeCore.sourceSlice(activeRevision, {
              start: content.range.end,
              end: nested.range.end
            })
        } else if (nested.kind === 'comment') {
          resolved += activeCore.sourceSlice(activeRevision, nested.range)
        } else {
          const edit = resolutionEditFor(activeCore, activeRevision, nested, decision)
          if (edit === undefined) return undefined
          resolved += edit.insert
        }
        cursor = nested.range.end
      }
      return resolved + activeCore.sourceSlice(activeRevision, { start: cursor, end: range.end })
    }
    const armSource = (name: string): string | undefined => {
      const arm = annotation.arms.find((candidate) => candidate.name === name)
      return arm === undefined ? undefined : resolvedSource(arm.range, arm.annotations)
    }
    const insert =
      annotation.kind === 'addition'
        ? decision === 'accept'
          ? armSource('content')
          : ''
        : annotation.kind === 'deletion'
          ? decision === 'accept'
            ? ''
            : armSource('content')
          : annotation.kind === 'substitution'
            ? armSource(decision === 'accept' ? 'new' : 'old')
            : undefined
    return insert === undefined ? undefined : Object.freeze({ ...annotation.range, insert })
  }

  const bulkResolutionAnnotationsFor = (
    activeRevision: DocumentRevision
  ): readonly CriticMarkupAnnotation[] => {
    const suggestions: CriticMarkupAnnotation[] = []
    const visit = (annotations: readonly CriticMarkupAnnotation[]): void => {
      for (const annotation of annotations) {
        if (
          annotation.kind === 'addition' ||
          annotation.kind === 'deletion' ||
          annotation.kind === 'substitution'
        ) {
          // The parent edit owns this complete source range. Nested forms in
          // that range cannot be emitted as overlapping sibling edits.
          suggestions.push(annotation)
          continue
        }
        if (annotation.kind !== 'highlight') continue
        const content = annotation.arms.find((arm) => arm.name === 'content')
        if (content !== undefined) visit(content.annotations)
      }
    }
    visit(activeRevision.annotations)
    return Object.freeze(suggestions)
  }

  return Object.freeze({
    handle(request: CoreRequest): CoreReply {
      if (disposed) throw new Error('Core actor is disposed')
      if (request.sequence <= sequence) {
        throw new Error('Core actor request is out of order')
      }
      sequence = request.sequence
      if (request.type === 'open') {
        if (revision !== undefined) throw new Error('Core document is already open')
        if (typeof request.source !== 'string') {
          return Object.freeze({
            type: 'rejected',
            session: request.session,
            sequence,
            revision: 0,
            accepted: false,
            reason: 'invalid-edit',
            sourceLength: 0
          })
        }
        const nextCore = createCore()
        let opened: DocumentRevision
        try {
          opened = nextCore.open(request.source, request.options)
        } catch (error) {
          if (error instanceof DocumentCoreError) {
            return Object.freeze({
              type: 'resource',
              session: request.session,
              sequence,
              revision: 0,
              accepted: false,
              sourceLength: 0,
              resource: Object.freeze({
                code: error.code,
                range: Object.freeze({ ...error.range }),
                metadata: Object.freeze({ ...error.metadata })
              })
            })
          }
          throw error
        }
        if (request.recoveryHistory !== undefined) {
          const restored = restoreHistory(request.recoveryHistory, request.source, request.options)
          if (restored !== 'restored') {
            return Object.freeze({
              type: 'rejected',
              session: request.session,
              sequence,
              revision: 0,
              accepted: false,
              reason: restored === 'resource' ? 'history-resource' : 'recovery-history-invalid',
              sourceLength: 0
            })
          }
        }
        core = nextCore
        revision = opened
        reviewOverview.reset()
        consumerSummary.reset()
        markdownOptions =
          request.options === undefined ? undefined : Object.freeze({ ...request.options })
        session = request.session
        revisionNumber = 1
        const diagnostics = diagnosticsOf(opened)
        return Object.freeze({
          type: 'opened',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: opened.sourceLength,
          ...diagnostics
        })
      }
      if (request.session !== session || core === undefined || revision === undefined) {
        throw new Error('Core document is not open')
      }
      if (request.baseRevision !== revisionNumber) {
        return Object.freeze({
          type: 'rejected',
          session,
          sequence,
          revision: revisionNumber,
          accepted: false,
          reason: 'stale-base',
          sourceLength: revision.sourceLength
        })
      }
      const rejectPrepared = (reason: CoreRejectedReply['reason']): CoreRejectedReply =>
        Object.freeze({
          type: 'rejected',
          session,
          sequence,
          revision: revisionNumber,
          accepted: false,
          reason,
          sourceLength: revision!.sourceLength
        })
      const retainedReply = (
        target: NonNullable<ReturnType<typeof retainedSelections.get>>
      ): CoreRetainedSelectionReply =>
        Object.freeze({
          type: 'retained-selection',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision!.sourceLength,
          id: target.id,
          selection: target.selection,
          selectionRevision: target.selectionRevision,
          status: target.status
        })
      if (request.type === 'retain-selection') {
        if (retainedSelections.size >= DOCUMENT_RESOURCE_POLICY_V1.maximumJournalOutcomes) {
          return rejectPrepared('prepared-selection-limit')
        }
        let selection: DocumentClipboardSelection
        try {
          if ('start' in request.selection) {
            core.sourceSlice(revision, request.selection)
            selection = Object.freeze({ ...request.selection })
          } else {
            projectSourceSelection(core, revision, request.selection)
            selection = copyDocumentSelection(request.selection, revision.sourceLength)
          }
        } catch (error) {
          if (error instanceof RangeError || error instanceof DocumentSourceEditError) {
            return rejectPrepared('author-invalid')
          }
          throw error
        }
        const order = ++nextRetainedSelection
        const id = `${session}:${order}`
        const target = {
          id,
          order,
          selection,
          selectionRevision: revisionNumber,
          status: 'ready' as const
        }
        retainedSelections.set(id, target)
        return retainedReply(target)
      }
      if (request.type === 'read-retained-selection') {
        const target = retainedSelections.get(request.id)
        return target === undefined
          ? rejectPrepared('prepared-selection-unavailable')
          : retainedReply(target)
      }
      if (request.type === 'release-selection') {
        if (typeof request.id !== 'string' || !request.id.startsWith(`${session}:`)) {
          return rejectPrepared('prepared-selection-unavailable')
        }
        retainedSelections.delete(request.id)
        return Object.freeze({
          type: 'selection-released',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          id: request.id
        })
      }
      let preparedTarget: NonNullable<ReturnType<typeof retainedSelections.get>> | undefined
      if (request.type === 'apply-prepared') {
        preparedTarget = retainedSelections.get(request.target)
        if (preparedTarget === undefined) return rejectPrepared('prepared-selection-unavailable')
        if (preparedTarget.status === 'conflict') {
          return rejectPrepared('prepared-selection-conflict')
        }
        const { operation, projections, baseRevision, nativeHistoryGroup: group } = request
        const preparedGroup = group === undefined ? {} : { nativeHistoryGroup: group }
        if (operation.kind === 'clipboard') {
          const target = preparedTarget.selection
          if (operation.action.kind === 'table') {
            if (!('kind' in target) || target.kind !== 'table') {
              return rejectPrepared('author-invalid')
            }
            request = Object.freeze({
              type: 'clipboard',
              session,
              sequence,
              baseRevision,
              projections,
              ...preparedGroup,
              action: Object.freeze({ ...operation.action, selection: target })
            })
          } else {
            if ('start' in target || target.kind === 'table') {
              return rejectPrepared('author-invalid')
            }
            request = Object.freeze({
              type: 'clipboard',
              session,
              sequence,
              baseRevision,
              projections,
              ...preparedGroup,
              action: Object.freeze({ ...operation.action, selection: target })
            })
          }
        } else {
          if (!('start' in preparedTarget.selection)) return rejectPrepared('author-invalid')
          request = Object.freeze({
            type: 'format',
            session,
            sequence,
            baseRevision,
            projections,
            ...preparedGroup,
            action: Object.freeze({ ...operation.action, selection: preparedTarget.selection })
          })
        }
      }
      const consumedPreparedSelection = (): Readonly<{
        preparedSelection?: DocumentClipboardSelection
      }> => {
        if (preparedTarget === undefined) return Object.freeze({})
        retainedSelections.delete(preparedTarget.id)
        return Object.freeze({ preparedSelection: preparedTarget.selection })
      }
      if (request.type === 'source-at-barrier') {
        return Object.freeze({
          type: 'source',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          source: revision.source,
          recoveryHistory: recoveryHistory()
        })
      }
      if (request.type === 'source-selection-at-barrier') {
        return Object.freeze({
          type: 'source-selection',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          selection: projectSourceSelection(core, revision, request.selection)
        })
      }
      if (request.type === 'source-syntax-at-barrier') {
        return Object.freeze({
          type: 'source-syntax',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          spans: core.sourceSyntax(revision)
        })
      }
      if (request.type === 'plain-text-view-at-barrier') {
        const source = revision.source
        const viewCore = core
        const viewRevision = revision
        return Object.freeze({
          type: 'plain-text-view',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          source,
          view: createMuyaMarkupView(
            core.project(revision, 'markup'),
            revision.annotations,
            source,
            (comment) =>
              viewCore.projectComment(viewRevision, comment).ast.root.children
                .map(consumerSemanticTextOf)
                .join(' ')
          )
        })
      }
      if (request.type === 'display-projection-at-barrier') {
        if (request.name !== 'original' && request.name !== 'revised') {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'invalid-edit',
            sourceLength: revision.sourceLength
          })
        }
        const projection = core.project(revision, request.name)
        return Object.freeze({
          type: 'display-projection',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          projection: Object.freeze({ name: request.name, ast: projection.ast })
        })
      }
      if (request.type === 'consumer-summary-at-barrier') {
        return Object.freeze({
          type: 'consumer-summary',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          summary: consumerSummary.summary(core, revision)
        })
      }
      if (request.type === 'consumer-projection-at-barrier') {
        const projection = core.project(revision, 'revised')
        return Object.freeze({
          type: 'consumer-projection',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          projection: Object.freeze({
            kind: 'markdown-consumer-projection',
            name: 'revised',
            markdown: projection.markdown,
            ast: projection.ast,
            sourceSegments: projection.coordinates.sourceSegments ?? Object.freeze([])
          })
        })
      }
      if (request.type === 'author-forms-at-barrier') {
        const range = request.range
        const valid =
          range !== null &&
          typeof range === 'object' &&
          Number.isSafeInteger(range.start) &&
          Number.isSafeInteger(range.end) &&
          range.start >= 0 &&
          range.end > range.start &&
          range.end <= revision.sourceLength
        const activeCore = core
        const activeRevision = revision
        // Planning previews the authored syntax; a form is available only when
        // that preview yields the intended annotation over this exact range.
        const forms = valid
          ? AUTHOR_FORMS.filter((form) => {
            try {
              return (
                activeCore.planAuthor(activeRevision, {
                  form,
                  range: { start: range.start, end: range.end },
                  text: form === 'comment' || form === 'substitution' ? AUTHOR_PROBE_TEXT : ''
                }) !== undefined
              )
            } catch (error) {
              if (error instanceof DocumentCoreError) return false
              throw error
            }
          })
          : []
        return Object.freeze({
          type: 'author-forms',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          forms: Object.freeze(forms)
        })
      }
      if (request.type === 'selection-projection-at-barrier') {
        if (
          request.range !== null &&
          typeof request.range === 'object' &&
          'kind' in request.range
        ) {
          try {
            const projection =
              request.range.kind === 'model-text'
                ? projectModelTextSelection(core, revision, request.range)
                : projectTableSelection(core, revision, request.range)
            return Object.freeze({
              type: 'selection-projection',
              session,
              sequence,
              revision: revisionNumber,
              accepted: true,
              sourceLength: revision.sourceLength,
              projection: Object.freeze({ kind: 'markdown-consumer-projection', ...projection })
            })
          } catch (error) {
            if (error instanceof DocumentCoreError) {
              return Object.freeze({
                type: 'resource',
                session,
                sequence,
                revision: revisionNumber,
                accepted: false,
                sourceLength: revision.sourceLength,
                resource: Object.freeze({
                  code: error.code,
                  range: Object.freeze({ ...error.range }),
                  metadata: Object.freeze({ ...error.metadata })
                })
              })
            }
            if (!(error instanceof RangeError || error instanceof TypeError)) throw error
            return Object.freeze({
              type: 'rejected',
              session,
              sequence,
              revision: revisionNumber,
              accepted: false,
              reason: 'invalid-edit',
              sourceLength: revision.sourceLength
            })
          }
        }
        if (
          request.range === null ||
          typeof request.range !== 'object' ||
          !Number.isSafeInteger(request.range.start) ||
          !Number.isSafeInteger(request.range.end) ||
          request.range.start < 0 ||
          request.range.end <= request.range.start ||
          request.range.end > revision.sourceLength
        ) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'invalid-edit',
            sourceLength: revision.sourceLength
          })
        }
        const documentProjection = core.project(revision, 'revised')
        const start = documentProjection.coordinates.toProjected(request.range.start, 'next')
        const end = documentProjection.coordinates.toProjected(request.range.end, 'previous')
        const markdown = documentProjection.markdown.slice(start, Math.max(start, end))
        const selectionAst = selectionAstOf(documentProjection, start, Math.max(start, end))
        if (selectionAst === undefined) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'invalid-edit',
            sourceLength: revision.sourceLength
          })
        }
        return Object.freeze({
          type: 'selection-projection',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          projection: Object.freeze({
            kind: 'markdown-consumer-projection',
            name: 'revised',
            markdown,
            ast: selectionAst
          })
        })
      }
      if (request.type === 'review-item-at-barrier') {
        if (
          (request.direction !== 'next' && request.direction !== 'previous') ||
          !Number.isSafeInteger(request.from) ||
          request.from < 0
        ) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'invalid-edit',
            sourceLength: revision.sourceLength
          })
        }
        // Navigation anchors survive edits. A deleted prefix can move an old
        // anchor past EOF; searching from the new boundary is a valid read.
        const entry = reviewItemFor(
          core,
          revision,
          request.direction,
          Math.min(request.from, revision.sourceLength)
        )
        return Object.freeze({
          type: 'review-item',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          ...(entry === undefined ? { item: null } : entry),
          ...(request.includeOverview
            ? { overview: reviewOverview.overview(core, revision) }
            : {})
        })
      }
      const historyEntry =
        request.type === 'undo'
          ? undoStack.at(-1)
          : request.type === 'redo'
            ? redoStack.at(-1)
            : undefined
      let authorPlan: DocumentAuthorPlan | undefined
      let authoredEdit: DocumentSourceEdit | undefined
      if (request.type === 'author') {
        try {
          authorPlan = core.planAuthor(revision, request)
          authoredEdit = authorPlan?.edit
        } catch (error) {
          if (error instanceof DocumentCoreError) {
            return Object.freeze({
              type: 'resource',
              session,
              sequence,
              revision: revisionNumber,
              accepted: false,
              sourceLength: revision.sourceLength,
              resource: Object.freeze({
                code: error.code,
                range: Object.freeze({ ...error.range }),
                metadata: Object.freeze({ ...error.metadata })
              })
            })
          }
          throw error
        }
      }
      if (request.type === 'author' && authoredEdit === undefined) {
        return Object.freeze({
          type: 'rejected',
          session,
          sequence,
          revision: revisionNumber,
          accepted: false,
          reason: 'author-invalid',
          sourceLength: revision.sourceLength
        })
      }
      let consumerSearchEdits: readonly DocumentSourceEdit[] | undefined
      if (request.type === 'replace-consumer-search') {
        const activeCore = core
        const activeRevision = revision
        const projection = activeCore.project(activeRevision, 'revised')
        if (!Array.isArray(request.replacements) || request.replacements.length === 0) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'consumer-search-match-invalid',
            sourceLength: revision.sourceLength
          })
        }
        const resolved = request.replacements
          .flatMap((replacement) => {
            if (
              replacement === null ||
              typeof replacement !== 'object' ||
              typeof replacement.insert !== 'string'
            ) {
              return []
            }
            const range = projectedRangeForConsumerMatch(projection, replacement.match)
            if (range === undefined) return []
            const start = projection.coordinates.toSource(range.start, 'next')
            const end = projection.coordinates.toSource(range.end, 'previous')
            if (
              end < start ||
              activeCore.sourceSlice(activeRevision, { start, end }) !== replacement.match.match
            ) {
              return []
            }
            return [Object.freeze({ start, end, insert: replacement.insert })]
          })
          .sort((left, right) => left.start - right.start || left.end - right.end)
        if (
          resolved.length !== request.replacements.length ||
          resolved.some((edit, index) => {
            const previous = resolved[index - 1]
            return previous !== undefined && edit.start < previous.end
          })
        ) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'consumer-search-match-invalid',
            sourceLength: revision.sourceLength
          })
        }
        consumerSearchEdits = Object.freeze(
          resolved.filter((edit) => activeCore.sourceSlice(activeRevision, edit) !== edit.insert)
        )
        // Replacements change blocks as any edit does (see normalizeEdits).
        consumerSearchEdits = activeCore.normalizeEdits(activeRevision, consumerSearchEdits, {
          trimUnnecessaryCodeBlockEmptyLines: request.trimUnnecessaryCodeBlockEmptyLines === true
        })
        if (consumerSearchEdits.length === 0) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'no-change',
            sourceLength: revision.sourceLength
          })
        }
      }
      let editedComment: DocumentSourceEdit | undefined
      if (request.type === 'edit-comment') {
        const locator = request.annotation
        if (
          locator === null ||
          typeof locator !== 'object' ||
          (locator.kind !== 'comment' && locator.kind !== 'commented-span')
        ) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'author-invalid',
            sourceLength: revision.sourceLength
          })
        }
        const comment = commentAnnotationFor(core, revision, locator)
        if (comment === undefined) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'annotation-not-found',
            sourceLength: revision.sourceLength
          })
        }
        const arm = comment.arms.find((candidate) => candidate.name === 'comment')
        if (typeof request.text !== 'string' || arm === undefined) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'author-invalid',
            sourceLength: revision.sourceLength
          })
        }
        if (core.sourceSlice(revision, arm.range) === request.text) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'no-change',
            sourceLength: revision.sourceLength
          })
        }
        try {
          editedComment = core.planCommentEdit(revision, { range: comment.range, text: request.text })?.edit
        } catch (error) {
          if (error instanceof DocumentCoreError) {
            return Object.freeze({
              type: 'resource',
              session,
              sequence,
              revision: revisionNumber,
              accepted: false,
              sourceLength: revision.sourceLength,
              resource: Object.freeze({
                code: error.code,
                range: Object.freeze({ ...error.range }),
                metadata: Object.freeze({ ...error.metadata })
              })
            })
          }
          throw error
        }
        if (editedComment === undefined) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'author-invalid',
            sourceLength: revision.sourceLength
          })
        }
      }
      if ((request.type === 'undo' || request.type === 'redo') && historyEntry === undefined) {
        return Object.freeze({
          type: 'rejected',
          session,
          sequence,
          revision: revisionNumber,
          accepted: false,
          reason: 'history-empty',
          sourceLength: revision.sourceLength
        })
      }
      const resolutionAnnotation =
        request.type === 'resolve'
          ? request.annotation.kind === 'commented-span'
            ? undefined
            : annotationFor(revision, request.annotation)
          : undefined
      const requestedCommentedSpan =
        request.type === 'resolve' && request.annotation.kind === 'commented-span'
          ? request.annotation
          : undefined
      const resolutionCommentedSpan =
        requestedCommentedSpan !== undefined
          ? reviewItemsFor(core, revision).find(
            (item) =>
              item.kind === 'commented-span' &&
                item.range.start === requestedCommentedSpan.range.start &&
                item.range.end === requestedCommentedSpan.range.end &&
                item.highlightRange.start === requestedCommentedSpan.highlightRange.start &&
                item.highlightRange.end === requestedCommentedSpan.highlightRange.end &&
                item.commentRange.start === requestedCommentedSpan.commentRange.start &&
                item.commentRange.end === requestedCommentedSpan.commentRange.end
          )
          : undefined
      if (
        request.type === 'resolve' &&
        resolutionAnnotation === undefined &&
        resolutionCommentedSpan === undefined
      ) {
        return Object.freeze({
          type: 'rejected',
          session,
          sequence,
          revision: revisionNumber,
          accepted: false,
          reason: 'annotation-not-found',
          sourceLength: revision.sourceLength
        })
      }
      const resolutionDecisionIsValid =
        request.type !== 'resolve' ||
        (resolutionCommentedSpan !== undefined
          ? request.decision === 'remove'
          : resolutionAnnotation?.kind === 'highlight' || resolutionAnnotation?.kind === 'comment'
            ? request.decision === 'remove'
            : request.decision === 'accept' || request.decision === 'reject')
      if (!resolutionDecisionIsValid) {
        return Object.freeze({
          type: 'rejected',
          session,
          sequence,
          revision: revisionNumber,
          accepted: false,
          reason: 'resolution-invalid',
          sourceLength: revision.sourceLength
        })
      }
      if (
        request.type === 'resolve-all' &&
        request.decision !== 'accept' &&
        request.decision !== 'reject'
      ) {
        return Object.freeze({
          type: 'rejected',
          session,
          sequence,
          revision: revisionNumber,
          accepted: false,
          reason: 'resolution-invalid',
          sourceLength: revision.sourceLength
        })
      }
      const resolutionEdit =
        request.type === 'resolve'
          ? resolutionCommentedSpan?.kind === 'commented-span'
            ? (() => {
              const activeCore = core
              const activeRevision = revision
              const highlight = annotationFor(activeRevision, {
                kind: 'highlight',
                range: resolutionCommentedSpan.highlightRange
              })
              const content = highlight?.arms.find((arm) => arm.name === 'content')
              return content === undefined
                ? undefined
                : Object.freeze({
                  start: resolutionCommentedSpan.range.start,
                  end: resolutionCommentedSpan.range.end,
                  insert: activeCore.sourceSlice(activeRevision, content.range)
                })
            })()
            : (() => {
              const activeCore = core
              const activeRevision = revision
              const annotation = resolutionAnnotation
              if (annotation === undefined) return undefined
              const armSource = (name: string): string | undefined => {
                const arm = annotation.arms.find((candidate) => candidate.name === name)
                return arm === undefined
                  ? undefined
                  : activeCore.sourceSlice(activeRevision, arm.range)
              }
              const decision = request.decision === 'remove' ? 'accept' : request.decision
              const insert =
                  annotation.kind === 'addition'
                    ? decision === 'accept'
                      ? armSource('content')
                      : ''
                    : annotation.kind === 'deletion'
                      ? decision === 'accept'
                        ? ''
                        : armSource('content')
                      : annotation.kind === 'substitution'
                        ? armSource(decision === 'accept' ? 'new' : 'old')
                        : annotation.kind === 'highlight'
                          ? armSource('content')
                          : ''
              return insert === undefined
                ? undefined
                : Object.freeze({ ...annotation.range, insert })
            })()
          : undefined
      const bulkResolutionEdits =
        request.type === 'resolve-all'
          ? (() => {
            const activeCore = core
            const activeRevision = revision
            return Object.freeze(
              bulkResolutionAnnotationsFor(activeRevision).flatMap((annotation) => {
                const edit = resolutionEditFor(
                  activeCore,
                  activeRevision,
                  annotation,
                  request.decision
                )
                return edit === undefined ? [] : [edit]
              })
            )
          })()
          : undefined
      if (request.type === 'resolve-all' && bulkResolutionEdits?.length === 0) {
        return Object.freeze({
          type: 'rejected',
          session,
          sequence,
          revision: revisionNumber,
          accepted: false,
          reason: 'no-change',
          sourceLength: revision.sourceLength
        })
      }
      let sourceInputPlan: DocumentSourceInputAction | undefined
      let clipboardPlan: DocumentClipboardPlan | undefined
      let formatPlan: DocumentFormatPlan | undefined
      let inputPlan: DocumentInputPlan | undefined
      let effectiveApplyEdits: readonly DocumentSourceEdit[] | undefined
      try {
        effectiveApplyEdits =
          request.type === 'source-input'
            ? (() => {
              sourceInputPlan = core.planSourceInput(revision, request.action)
              return sourceInputPlan.edits
            })()
            : request.type === 'clipboard'
              ? (() => {
                clipboardPlan = core.planClipboard(revision, request.action)
                return clipboardPlan.edits
              })()
              : request.type === 'format'
                ? (() => {
                  formatPlan = core.planFormat(revision, request.action)
                  return formatPlan.edits
                })()
                : request.type === 'input'
                  ? (() => {
                    inputPlan = core.planInput(revision, request.action, {
                      tracked: request.tracked === true
                    })
                    return core.inputEdits(
                      revision,
                      request.action,
                      inputPlan,
                      request.tracked === true
                    )
                  })()
                  : request.type === 'apply'
                    ? (() => {
                      const activeCore = core
                      const activeRevision = revision
                      if (!Array.isArray(request.edits)) return undefined
                      let previousEnd = 0
                      const valid = request.edits.every((edit) => {
                        const accepted =
                            edit !== null &&
                            typeof edit === 'object' &&
                            Number.isSafeInteger(edit.start) &&
                            Number.isSafeInteger(edit.end) &&
                            typeof edit.insert === 'string' &&
                            edit.start >= previousEnd &&
                            edit.end >= edit.start &&
                            edit.end <= activeRevision.sourceLength
                        previousEnd = edit?.end ?? previousEnd
                        return accepted
                      })
                      return valid
                        ? Object.freeze(
                          request.edits.filter(
                            (edit) =>
                              activeCore.sourceSlice(activeRevision, edit) !== edit.insert
                          )
                        )
                        : request.edits
                    })()
                    : undefined
      } catch (error) {
        if (
          error instanceof DocumentSourceEditError ||
          error instanceof RangeError ||
          ((request.type === 'input' ||
            request.type === 'format' ||
            request.type === 'clipboard') &&
            error instanceof TypeError)
        ) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'author-invalid',
            sourceLength: revision.sourceLength
          })
        }
        if (error instanceof DocumentCoreError) {
          return Object.freeze({
            type: 'resource',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            sourceLength: revision.sourceLength,
            resource: Object.freeze({
              code: error.code,
              range: Object.freeze({ ...error.range }),
              metadata: Object.freeze({ ...error.metadata })
            })
          })
        }
        throw error
      }
      if (
        (request.type === 'clipboard' ||
          request.type === 'format' ||
          request.type === 'input') &&
        effectiveApplyEdits === undefined
      ) {
        return Object.freeze({
          type: 'rejected',
          session,
          sequence,
          revision: revisionNumber,
          accepted: false,
          reason: 'author-invalid',
          sourceLength: revision.sourceLength
        })
      }
      if (
        request.type === 'clipboard' &&
        effectiveApplyEdits?.length === 0 &&
        clipboardPlan !== undefined
      ) {
        return Object.freeze({
          type: 'applied',
          ...consumedPreparedSelection(),
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          ...diagnosticsOf(revision),
          change: Object.freeze({
            appliedEdits: Object.freeze([]),
            projections: Object.freeze([])
          }),
          clipboardResult: Object.freeze({ selection: clipboardPlan.selection })
        })
      }
      if (
        request.type === 'format' &&
        effectiveApplyEdits?.length === 0 &&
        formatPlan !== undefined
      ) {
        return Object.freeze({
          type: 'applied',
          ...consumedPreparedSelection(),
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          ...diagnosticsOf(revision),
          change: Object.freeze({
            appliedEdits: Object.freeze([]),
            projections: Object.freeze([])
          }),
          formatResult: Object.freeze({ selection: formatPlan.selection })
        })
      }
      if (
        request.type === 'input' &&
        effectiveApplyEdits?.length === 0 &&
        inputPlan !== undefined
      ) {
        return Object.freeze({
          type: 'applied',
          ...consumedPreparedSelection(),
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          ...diagnosticsOf(revision),
          change: Object.freeze({
            appliedEdits: Object.freeze([]),
            projections: Object.freeze([])
          }),
          inputResult: (() => {
            try {
              return core.reconcileInput(revision, inputPlan, null, request.action)
            } catch (error) {
              if (!(error instanceof RangeError) || request.tracked !== true) throw error
              return Object.freeze({ policy: inputPlan, selection: request.action.selection })
            }
          })()
        })
      }
      if (
        request.type === 'source-input' &&
        effectiveApplyEdits?.length === 0 &&
        sourceInputPlan !== undefined
      ) {
        return Object.freeze({
          type: 'applied',
          ...consumedPreparedSelection(),
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          ...diagnosticsOf(revision),
          change: Object.freeze({
            appliedEdits: Object.freeze([]),
            projections: Object.freeze([])
          }),
          sourceInputResult: Object.freeze({ selection: sourceInputPlan.afterSelection })
        })
      }
      if (request.type === 'apply' && effectiveApplyEdits?.length === 0) {
        return Object.freeze({
          type: 'rejected',
          session,
          sequence,
          revision: revisionNumber,
          accepted: false,
          reason: 'no-change',
          sourceLength: revision.sourceLength
        })
      }
      const resolvingCore = core
      const resolvingRevision = revision
      const edits =
        request.type === 'configure'
          ? Object.freeze([])
          : request.type === 'source-input' ||
              request.type === 'apply' ||
              request.type === 'input' ||
              request.type === 'format' ||
              request.type === 'clipboard'
            ? effectiveApplyEdits!
            : request.type === 'replace-consumer-search'
              ? consumerSearchEdits!
              : request.type === 'author'
                ? Object.freeze([authoredEdit!])
                : request.type === 'edit-comment'
                  ? Object.freeze([editedComment!])
                  : request.type === 'resolve-all' || request.type === 'resolve'
                    ? commentPairPreservingResolution(
                      resolvingRevision.annotations,
                      request.type === 'resolve' ? [resolutionEdit!] : bulkResolutionEdits!,
                      (range) => resolvingCore.sourceSlice(resolvingRevision, range)
                    )
                    : request.type === 'undo'
                      ? historyEntry!.undo
                      : historyEntry!.redo
      const editingRevision = revision
      // Rewriting text with itself, such as typing a selection's own text,
      // changes nothing and records no undo step, tracked or not. Its commit
      // still carries the planned selection.
      const unchangedByEdits =
        edits!.length > 0 &&
        edits!.every(
          (edit) =>
            edit.start >= 0 &&
            edit.start <= edit.end &&
            edit.end <= resolvingRevision.sourceLength &&
            edit.end - edit.start === edit.insert.length &&
            resolvingCore.sourceSlice(resolvingRevision, edit) === edit.insert
        )
      if (
        (request.type === 'source-input' ||
          request.type === 'clipboard' ||
          request.type === 'format' ||
          request.type === 'input' ||
          request.type === 'apply' ||
          request.type === 'resolve-all' ||
          request.type === 'replace-consumer-search') &&
        edits!.length > maximumHistoryEditsPerEntry
      ) {
        return Object.freeze({
          type: 'rejected',
          session,
          sequence,
          revision: revisionNumber,
          accepted: false,
          reason: 'history-resource',
          sourceLength: revision.sourceLength
        })
      }
      if (
        (request.type === 'source-input' ||
          request.type === 'clipboard' ||
          request.type === 'format' ||
          request.type === 'input' ||
          request.type === 'apply' ||
          request.type === 'replace-consumer-search') &&
        edits!.length > 1
      ) {
        if (leavesSourceUnchanged(core, revision, edits!)) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'no-change',
            sourceLength: revision.sourceLength
          })
        }
      }
      let inverse: readonly DocumentSourceEdit[] | undefined
      let prospectiveEntry: HistoryEntry | undefined
      const requestedGroup =
        request.type === 'source-input' ||
        request.type === 'input' ||
        request.type === 'format' ||
        request.type === 'clipboard' ||
        request.type === 'apply'
          ? request.nativeHistoryGroup
          : undefined
      if (
        requestedGroup !== undefined &&
        (typeof requestedGroup !== 'string' ||
          requestedGroup.length === 0 ||
          requestedGroup.length > 128)
      ) {
        return Object.freeze({
          type: 'rejected',
          session,
          sequence,
          revision: revisionNumber,
          accepted: false,
          reason: 'invalid-edit',
          sourceLength: revision.sourceLength
        })
      }
      let mergedEntry: HistoryEntry | null | undefined
      const joinedHistory = request.type === 'apply' && request.joinPreviousHistory === true
      let continuedGroup: string | undefined
      let joinedSelections: Pick<HistoryEntry, 'beforeSelection' | 'afterSelection'> | undefined
      let commit
      try {
        inverse =
          request.type === 'source-input' ||
          request.type === 'clipboard' ||
          request.type === 'format' ||
          request.type === 'input' ||
          request.type === 'apply' ||
          request.type === 'replace-consumer-search' ||
          request.type === 'author' ||
          request.type === 'edit-comment' ||
          request.type === 'resolve' ||
          request.type === 'resolve-all'
            ? inverseEdits(core, revision, edits!)
            : undefined
        if (inverse !== undefined) {
          prospectiveEntry = Object.freeze({
            undo: inverse,
            redo: copyEdits(edits!),
            ...(sourceInputPlan === undefined
              ? {}
              : { beforeSelection: sourceInputPlan.beforeSelection }),
            ...(request.type === 'author'
              ? { beforeSelection: singleSelection(request.range) }
              : {}),
            ...((request.type === 'resolve' ||
              request.type === 'resolve-all' ||
              request.type === 'edit-comment') &&
            request.selection !== undefined
              ? { beforeSelection: copySelection(request.selection) }
              : {}),
            ...(request.type === 'input' ||
            request.type === 'format' ||
            request.type === 'clipboard'
              ? {
                beforeSelection: singleSelection(
                  request.type === 'clipboard' && 'currentSelection' in request.action
                    ? (request.action.currentSelection ?? request.action.selection)
                    : request.type === 'format' && request.action.format === 'image-properties'
                      ? (request.action.currentSelection ?? request.action.selection)
                      : request.action.selection
                )
              }
              : {})
          })
          const joinTarget =
            joinedHistory
              ? undoStack.at(-1)
              : requestedGroup !== undefined &&
                  nativeHistoryGroup?.id === requestedGroup &&
                  undoStack.at(-1) === nativeHistoryGroup.entry
                ? nativeHistoryGroup.entry
                : undefined
          if (joinTarget !== undefined) {
            mergedEntry = mergeNativeHistory(joinTarget, prospectiveEntry, core, revision)
            if (mergedEntry !== undefined && mergedEntry !== null) prospectiveEntry = mergedEntry
          }
          if (joinedHistory && mergedEntry !== undefined && joinTarget !== undefined) {
            // A joined change keeps the step it joined open to further typing,
            // and that step's carets: it changes no text the caret is in.
            if (nativeHistoryGroup?.entry === joinTarget) continuedGroup = nativeHistoryGroup.id
            joinedSelections = joinTarget
          }
          if (
            prospectiveEntry.undo.length > maximumHistoryEditsPerEntry ||
            prospectiveEntry.redo.length > maximumHistoryEditsPerEntry ||
            historyUnits(prospectiveEntry) > maximumHistoryInsertUnits ||
            historyEditRecords(prospectiveEntry) > maximumHistoryEditRecords
          ) {
            return Object.freeze({
              type: 'rejected',
              session,
              sequence,
              revision: revisionNumber,
              accepted: false,
              reason: 'history-resource',
              sourceLength: revision.sourceLength
            })
          }
        }
        commit = core.apply(revision, edits!, {
          projections: request.projections,
          ...(request.type === 'configure' ? { markdown: request.options } : {})
        })
      } catch (error) {
        if (error instanceof DocumentSourceEditError || error instanceof RangeError) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            reason: 'invalid-edit',
            sourceLength: revision.sourceLength
          })
        }
        if (error instanceof DocumentCoreError) {
          return Object.freeze({
            type: 'resource',
            session,
            sequence,
            revision: revisionNumber,
            accepted: false,
            sourceLength: revision.sourceLength,
            resource: Object.freeze({
              code: error.code,
              range: Object.freeze({ ...error.range }),
              metadata: Object.freeze({ ...error.metadata })
            })
          })
        }
        throw error
      }
      const inputResult =
        inputPlan === undefined
          ? undefined
          : core.reconcileInput(
            editingRevision,
            inputPlan,
            commit,
            request.type === 'input'
              ? request.action
              : (() => {
                throw new Error('Input plan requires an input action')
              })()
          )
      const primaryAfterSelection =
        authorPlan?.selection ??
        formatPlan?.selection ??
        clipboardPlan?.selection ??
        inputResult?.selection
      const afterSelection =
        sourceInputPlan?.afterSelection ??
        (primaryAfterSelection === undefined ? undefined : singleSelection(primaryAfterSelection))
      if (prospectiveEntry !== undefined) {
        // A grouped transaction retains the first actual selection and the last
        // model-planned selection. Unmigrated commands never invent endpoints.
        // Review commands plan no selection: their undo returns to where the
        // caret was, as upstream undo and Google Docs do, and their redo
        // places the caret as the command did.
        const beforeSelection = prospectiveEntry.beforeSelection
        const reviewCommand =
          request.type === 'resolve' ||
          request.type === 'resolve-all' ||
          request.type === 'edit-comment'
        prospectiveEntry = Object.freeze({
          undo: prospectiveEntry.undo,
          redo: prospectiveEntry.redo,
          ...(joinedSelections !== undefined
            ? {
              ...(joinedSelections.beforeSelection === undefined ? {} : { beforeSelection: joinedSelections.beforeSelection }),
              ...(joinedAfterSelection(joinedSelections.afterSelection, revision.sourceLength +
                edits!.reduce((sum, edit) => sum + edit.insert.length - edit.end + edit.start, 0)))
            }
            : beforeSelection === undefined
              ? {}
              : afterSelection !== undefined
                ? { beforeSelection, afterSelection: copySelection(afterSelection) }
                : reviewCommand
                  ? { beforeSelection }
                  : {})
        })
      }
      for (const target of retainedSelections.values()) {
        if (target === preparedTarget || target.status === 'conflict') continue
        try {
          const rebased = rebaseDocumentInputSelection(
            core,
            editingRevision,
            commit,
            target.selection,
            {
              affinity:
                preparedTarget !== undefined && preparedTarget.order < target.order
                  ? 'after'
                  : 'before',
              operation:
                request.type === 'input'
                  ? { kind: 'input', action: request.action, tracked: request.tracked }
                  : request.type === 'clipboard'
                    ? { kind: 'clipboard', action: request.action }
                    : { kind: 'edits' }
            }
          )
          if (rebased.kind === 'conflict') target.status = 'conflict'
          else {
            target.selection = rebased.selection
            target.selectionRevision = revisionNumber + 1
          }
        } catch (error) {
          if (!(error instanceof RangeError)) throw error
          target.status = 'conflict'
        }
      }
      reviewOverview.committed(revision, commit.revision, commit.change)
      consumerSummary.committed(revision, commit.revision, commit.change)
      revision = commit.revision
      if (request.type === 'configure') {
        markdownOptions = Object.freeze({ ...markdownOptions, ...request.options })
      }
      revisionNumber += 1
      if (
        !unchangedByEdits &&
        (request.type === 'source-input' ||
        request.type === 'clipboard' ||
        request.type === 'format' ||
        request.type === 'input' ||
        request.type === 'apply' ||
        request.type === 'replace-consumer-search' ||
        request.type === 'resolve' ||
        request.type === 'author' ||
        request.type === 'edit-comment' ||
        request.type === 'resolve-all')
      ) {
        const entry = prospectiveEntry!
        redoStack.splice(0)
        redoUnits = 0
        redoEditRecords = 0
        if (mergedEntry !== undefined) {
          const previous = undoStack.pop()!
          undoUnits -= historyUnits(previous)
          undoEditRecords -= historyEditRecords(previous)
        }
        if (mergedEntry !== null) {
          undoStack.push(entry)
          undoUnits += historyUnits(entry)
          undoEditRecords += historyEditRecords(entry)
        }
        const group = continuedGroup ?? requestedGroup
        nativeHistoryGroup =
          group === undefined || mergedEntry === null
            ? undefined
            : { id: group, entry }
        trimUndoHistory()
      } else if (request.type === 'undo') {
        nativeHistoryGroup = undefined
        undoStack.pop()
        undoUnits -= historyUnits(historyEntry!)
        undoEditRecords -= historyEditRecords(historyEntry!)
        redoStack.push(historyEntry!)
        redoUnits += historyUnits(historyEntry!)
        redoEditRecords += historyEditRecords(historyEntry!)
      } else if (request.type === 'redo') {
        nativeHistoryGroup = undefined
        redoStack.pop()
        redoUnits -= historyUnits(historyEntry!)
        redoEditRecords -= historyEditRecords(historyEntry!)
        undoStack.push(historyEntry!)
        undoUnits += historyUnits(historyEntry!)
        undoEditRecords += historyEditRecords(historyEntry!)
      }
      const diagnostics = diagnosticsOf(commit.revision)
      return Object.freeze({
        type: 'applied',
        ...consumedPreparedSelection(),
        session,
        sequence,
        revision: revisionNumber,
        accepted: true,
        sourceLength: commit.revision.sourceLength,
        ...diagnostics,
        change: commit.change,
        ...(formatPlan === undefined
          ? {}
          : { formatResult: Object.freeze({ selection: formatPlan.selection }) }),
        ...(clipboardPlan === undefined
          ? {}
          : { clipboardResult: Object.freeze({ selection: clipboardPlan.selection }) }),
        ...(inputResult === undefined ? {} : { inputResult }),
        ...(authorPlan === undefined
          ? {}
          : {
            authorResult: Object.freeze({
              selection: authorPlan.selection,
              escaped: authorPlan.escaped
            })
          }),
        ...(sourceInputPlan === undefined
          ? {}
          : { sourceInputResult: Object.freeze({ selection: sourceInputPlan.afterSelection }) }),
        ...(request.type === 'undo' && historyEntry?.beforeSelection !== undefined
          ? { historyResult: Object.freeze({ selection: historyEntry.beforeSelection }) }
          : request.type === 'redo' && historyEntry?.afterSelection !== undefined
            ? { historyResult: Object.freeze({ selection: historyEntry.afterSelection }) }
            : {})
      })
    },
    dispose(): void {
      disposed = true
      retainedSelections.clear()
      nativeHistoryGroup = undefined
      core = undefined
      revision = undefined
      reviewOverview.reset()
      consumerSummary.reset()
      undoStack.splice(0)
      redoStack.splice(0)
      undoUnits = 0
      redoUnits = 0
      undoEditRecords = 0
      redoEditRecords = 0
    }
  })
}
