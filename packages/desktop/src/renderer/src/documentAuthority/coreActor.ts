import {
  createDocumentCore,
  DOCUMENT_RESOURCE_POLICY_V1,
  DocumentCoreError,
  DocumentSourceEditError,
  type DocumentCore,
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
  CoreHistorySnapshot,
  CoreConsumerSearchMatch,
  CoreReply,
  CoreRequest,
  CoreReviewItemLocator
} from './coreProtocol'
import { createMuyaPlainTextView } from './muyaPlainTextView'

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

const diagnosticsOf = (revision: DocumentRevision) => Object.freeze({
  diagnosticCount: revision.diagnostics.length,
  diagnostics: Object.freeze(revision.diagnostics.slice(0, DIAGNOSTIC_SAMPLE_LIMIT))
})

const consumerSearchBlockKinds = new Set<MarkdownAstNode['kind']>([
  'paragraph',
  'heading',
  'code-block',
  'html-block',
  'front-matter',
  'math-block',
  'diagram',
  'table-cell'
])

const consumerSemanticTextOf = (node: MarkdownAstNode): string => {
  const stringAttribute = (name: string): string => {
    const value = node.attributes[name]
    return typeof value === 'string' ? value : ''
  }
  switch (node.kind) {
    case 'text':
      return stringAttribute('semanticText')
    case 'soft-break':
    case 'hard-break':
      return '\n'
    case 'inline-code':
      return stringAttribute('semanticContent') || stringAttribute('content')
    case 'code-block':
    case 'html-block':
    case 'front-matter':
    case 'math-block':
    case 'diagram':
      return stringAttribute('content')
    case 'definition':
      return ''
    default:
      return node.children.map(consumerSemanticTextOf).join('')
  }
}

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
    match === null || typeof match !== 'object' ||
    !Array.isArray(match.path) || match.path.length === 0 ||
    !Number.isSafeInteger(match.start) || !Number.isSafeInteger(match.end) ||
    match.start < 0 || match.end <= match.start || typeof match.match !== 'string' ||
    match.match.length !== match.end - match.start
  ) return undefined
  const block = nodeAtConsumerPath(projection.ast, match.path)
  if (block === undefined || !consumerSearchBlockKinds.has(block.kind)) return undefined
  if (consumerSemanticTextOf(block).slice(match.start, match.end) !== match.match) {
    return undefined
  }

  let semanticOffset = 0
  let resolved: Readonly<{ readonly start: number; readonly end: number }> | undefined
  const visit = (node: MarkdownAstNode): void => {
    if (resolved !== undefined) return
    if (node.kind === 'text') {
      const semantic = consumerSemanticTextOf(node)
      const leafStart = semanticOffset
      const leafEnd = leafStart + semantic.length
      if (match.start >= leafStart && match.end <= leafEnd) {
        const raw = projection.markdown.slice(node.range.start, node.range.end)
        if (raw === semantic) {
          resolved = Object.freeze({
            start: node.range.start + match.start - leafStart,
            end: node.range.start + match.end - leafStart
          })
        }
      }
      semanticOffset = leafEnd
      return
    }
    if (
      node.kind === 'soft-break' || node.kind === 'hard-break' ||
      node.kind === 'inline-code' || node.kind === 'code-block' ||
      node.kind === 'html-block' || node.kind === 'front-matter' ||
      node.kind === 'math-block' || node.kind === 'diagram' ||
      node.kind === 'definition'
    ) {
      semanticOffset += consumerSemanticTextOf(node).length
      return
    }
    for (const child of node.children) visit(child)
  }
  visit(block)
  if (
    resolved === undefined ||
    projection.markdown.slice(resolved.start, resolved.end) !== match.match
  ) return undefined
  return resolved
}

const selectionAstOf = (
  projection: MarkdownProjection,
  start: number,
  end: number
): MarkdownAst | undefined => {
  const selected = new Map<MarkdownAstNode, MarkdownAstNode>()
  let supported = true
  const intersects = (node: MarkdownAstNode): boolean =>
    node.kind === 'document' || (node.range.start < end && node.range.end > start)
  const pending: Array<Readonly<{
    readonly node: MarkdownAstNode
    readonly ready: boolean
  }>> = [{ node: projection.ast.root, ready: false }]

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

    if (!fullySelected && task.node.children.length === 0) {
      if (task.node.kind !== 'text') {
        supported = false
        break
      }
      const raw = projection.markdown.slice(task.node.range.start, task.node.range.end)
      if (attributes.semanticText !== raw) {
        supported = false
        break
      }
      attributes.semanticText = raw.slice(
        rangeStart - task.node.range.start,
        rangeEnd - task.node.range.start
      )
    }

    selected.set(task.node, Object.freeze({
      kind: task.node.kind,
      range: Object.freeze({
        start: rangeStart - start,
        end: rangeEnd - start
      }),
      attributes: Object.freeze(attributes),
      children: Object.freeze(task.node.children.flatMap(child => {
        const item = selected.get(child)
        return item === undefined ? [] : [item]
      }))
    }))
  }

  const root = selected.get(projection.ast.root)
  return supported && root !== undefined ? Object.freeze({ root }) : undefined
}

export function createCoreActor(
  createCore: () => DocumentCore = createDocumentCore,
  options: CoreActorOptions = {}
): CoreActor {
  const maximumHistoryEntries = options.maximumHistoryEntries ??
    DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEntries
  const maximumHistoryInsertUnits = options.maximumHistoryInsertUnits ??
    DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryInsertUnits
  const maximumHistoryEditRecords = options.maximumHistoryEditRecords ??
    DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEditRecords
  const maximumHistoryEditsPerEntry = options.maximumHistoryEditsPerEntry ??
    DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEditsPerEntry
  if (
    !Number.isSafeInteger(maximumHistoryEntries) || maximumHistoryEntries < 1 ||
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
    maximumHistoryInsertUnits >
      DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryInsertUnits ||
    maximumHistoryEditRecords >
      DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEditRecords ||
    maximumHistoryEditsPerEntry >
      DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEditsPerEntry
  ) {
    throw new RangeError(
      'Core actor history limits cannot exceed the engine resource policy'
    )
  }
  let core: DocumentCore | undefined
  let revision: DocumentRevision | undefined
  let session = 0
  let sequence = 0
  let revisionNumber = 0
  let markdownOptions: Readonly<Partial<MarkdownOptions>> | undefined
  let disposed = false
  type HistoryEntry = CoreHistoryEntry
  const undoStack: HistoryEntry[] = []
  const redoStack: HistoryEntry[] = []
  let undoUnits = 0
  let redoUnits = 0
  let undoEditRecords = 0
  let redoEditRecords = 0

  const historyUnits = (entry: HistoryEntry): number =>
    entry.undo.reduce((sum, edit) => sum + edit.insert.length, 0) +
    entry.redo.reduce((sum, edit) => sum + edit.insert.length, 0)

  const historyEditRecords = (entry: HistoryEntry): number =>
    entry.undo.length + entry.redo.length

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

  const copyEdits = (edits: readonly DocumentSourceEdit[]) => Object.freeze(
    edits.map(edit => Object.freeze({ ...edit }))
  )
  const copyEntry = (entry: HistoryEntry): HistoryEntry => Object.freeze({
    undo: copyEdits(entry.undo),
    redo: copyEdits(entry.redo)
  })
  const recoveryHistory = (): CoreHistorySnapshot => Object.freeze({
    undo: Object.freeze(undoStack.map(copyEntry)),
    redo: Object.freeze(redoStack.map(copyEntry))
  })
  const applyRecoveryEdits = (
    source: string,
    edits: readonly DocumentSourceEdit[]
  ): string | undefined => {
    let previousEnd = 0
    let nextLength = source.length
    for (const edit of edits) {
      if (
        edit === null || typeof edit !== 'object' ||
        !Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end) ||
        typeof edit.insert !== 'string' || edit.start < previousEnd ||
        edit.end < edit.start || edit.end > source.length
      ) return undefined
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
  const restoreHistory = (
    snapshot: CoreHistorySnapshot,
    checkpointSource: string,
    checkpointOptions?: Readonly<Partial<MarkdownOptions>>
  ): 'restored' | 'invalid' | 'resource' => {
    if (
      snapshot === null || typeof snapshot !== 'object' ||
      !Array.isArray(snapshot.undo) || !Array.isArray(snapshot.redo)
    ) return 'invalid'
    const validEntry = (value: unknown): value is HistoryEntry => {
      if (value === null || typeof value !== 'object') return false
      const entry = value as Partial<HistoryEntry>
      if (!Array.isArray(entry.undo) || !Array.isArray(entry.redo)) return false
      if (entry.undo.length === 0 || entry.redo.length === 0) return false
      return [...entry.undo, ...entry.redo].every(edit =>
        edit !== null && typeof edit === 'object' &&
        Number.isSafeInteger(edit.start) && Number.isSafeInteger(edit.end) &&
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
    const records = entries.reduce(
      (sum, entry) => sum + historyEditRecords(entry),
      0
    )
    if (
      restoredUndo.length + restoredRedo.length > maximumHistoryEntries ||
      entries.some(entry =>
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
        prior === undefined || prior === undoSource || !isReachableSource(prior) ||
        applyRecoveryEdits(prior, entry.redo) !== undoSource
      ) return 'invalid'
      undoSource = prior
    }
    let redoSource = checkpointSource
    for (let index = restoredRedo.length - 1; index >= 0; index -= 1) {
      const entry = restoredRedo[index]
      if (entry === undefined) return 'invalid'
      const next = applyRecoveryEdits(redoSource, entry.redo)
      if (
        next === undefined || next === redoSource || !isReachableSource(next) ||
        applyRecoveryEdits(next, entry.undo) !== redoSource
      ) return 'invalid'
      redoSource = next
    }
    undoStack.push(...restoredUndo)
    redoStack.push(...restoredRedo)
    undoUnits = restoredUndo.reduce((sum, entry) => sum + historyUnits(entry), 0)
    redoUnits = restoredRedo.reduce((sum, entry) => sum + historyUnits(entry), 0)
    undoEditRecords = restoredUndo.reduce(
      (sum, entry) => sum + historyEditRecords(entry),
      0
    )
    redoEditRecords = restoredRedo.reduce(
      (sum, entry) => sum + historyEditRecords(entry),
      0
    )
    return 'restored'
  }

  const inverseEdits = (
    activeCore: DocumentCore,
    activeRevision: DocumentRevision,
    edits: readonly DocumentSourceEdit[]
  ): readonly DocumentSourceEdit[] => {
    let delta = 0
    return Object.freeze(edits.map(edit => {
      const removed = activeCore.sourceSlice(activeRevision, edit)
      const start = edit.start + delta
      delta += edit.insert.length - (edit.end - edit.start)
      return Object.freeze({
        start,
        end: start + edit.insert.length,
        insert: removed
      })
    }))
  }

  const annotationFor = (
    activeRevision: DocumentRevision,
    locator: Readonly<{
      readonly kind: CriticMarkupAnnotation['kind']
      readonly range: Readonly<{ readonly start: number; readonly end: number }>
    }>
  ): CriticMarkupAnnotation | undefined => {
    const pending = [...activeRevision.annotations]
    while (pending.length > 0) {
      const annotation = pending.pop()
      if (annotation === undefined) continue
      if (
        annotation.kind === locator.kind &&
        annotation.range.start === locator.range.start &&
        annotation.range.end === locator.range.end
      ) return annotation
      for (const arm of annotation.arms) pending.push(...arm.annotations)
    }
    return undefined
  }

  const reviewItemsFor = (
    activeCore: DocumentCore,
    activeRevision: DocumentRevision
  ): readonly CoreReviewItemLocator[] => {
    const items: CoreReviewItemLocator[] = []
    const annotations = activeRevision.annotations
    let revisedProjection: MarkdownProjection | undefined
    const appendVisibleNestedItems = (annotation: CriticMarkupAnnotation): void => {
      if (annotation.kind !== 'highlight') return
      const content = annotation.arms.find(arm => arm.name === 'content')
      if (content === undefined) return
      type PendingVisible = Readonly<{
        readonly kind: 'annotations'
        readonly annotations: readonly CriticMarkupAnnotation[]
      }> | Readonly<{
        readonly kind: 'item'
        readonly annotation: CriticMarkupAnnotation
      }> | Readonly<{
        readonly kind: 'pair'
        readonly highlight: CriticMarkupAnnotation
        readonly comment: CriticMarkupAnnotation
      }>
      const pending: PendingVisible[] = [{
        kind: 'annotations',
        annotations: content.annotations
      }]
      while (pending.length > 0) {
        const next = pending.pop()
        if (next === undefined) break
        if (next.kind === 'annotations') {
          for (let index = next.annotations.length - 1; index >= 0; index -= 1) {
            const current = next.annotations[index]
            if (current === undefined) continue
            const prior = next.annotations[index - 1]
            const pair = current.kind === 'comment' && prior?.kind === 'highlight' &&
              prior.range.end === current.range.start
            if (pair) {
              pending.push({ kind: 'pair', highlight: prior, comment: current })
              const nestedContent = prior.arms.find(arm => arm.name === 'content')
              if (nestedContent !== undefined) {
                pending.push({
                  kind: 'annotations',
                  annotations: nestedContent.annotations
                })
              }
              index -= 1
              continue
            }
            pending.push({ kind: 'item', annotation: current })
            if (current.kind === 'highlight') {
              const nestedContent = current.arms.find(arm => arm.name === 'content')
              if (nestedContent !== undefined) {
                pending.push({
                  kind: 'annotations',
                  annotations: nestedContent.annotations
                })
              }
            }
          }
          continue
        }
        if (next.kind === 'pair') {
          const nestedContent = next.highlight.arms.find(arm => arm.name === 'content')
          revisedProjection ??= activeCore.project(activeRevision, 'revised')
          if (
            nestedContent !== undefined &&
            revisedProjection.coordinates.intersectsSource(nestedContent.range)
          ) {
            items.push(Object.freeze({
              kind: 'commented-span',
              range: Object.freeze({
                start: next.highlight.range.start,
                end: next.comment.range.end
              }),
              highlightRange: Object.freeze({ ...next.highlight.range }),
              commentRange: Object.freeze({ ...next.comment.range })
            }))
            continue
          }
        }
        const visible = next.kind === 'pair' ? next.highlight : next.annotation
        items.push(Object.freeze({
          kind: visible.kind,
          range: Object.freeze({ ...visible.range })
        }))
      }
    }
    const appendCommentNestedItems = (annotation: CriticMarkupAnnotation): void => {
      if (annotation.kind !== 'comment') return
      const comment = annotation.arms.find(arm => arm.name === 'comment')
      if (comment === undefined) return
      const pending = [...comment.annotations].reverse()
      while (pending.length > 0) {
        const nested = pending.pop()
        if (nested === undefined) continue
        appendVisibleNestedItems(nested)
        appendCommentNestedItems(nested)
        items.push(Object.freeze({
          kind: nested.kind,
          range: Object.freeze({ ...nested.range })
        }))
      }
    }
    for (let index = 0; index < annotations.length; index += 1) {
      const annotation = annotations[index]
      if (annotation === undefined) continue
      const next = annotations[index + 1]
      const content = annotation.kind === 'highlight'
        ? annotation.arms.find(arm => arm.name === 'content')
        : undefined
      if (
        annotation.kind === 'highlight' && next?.kind === 'comment' &&
        annotation.range.end === next.range.start && content !== undefined
      ) {
        revisedProjection ??= activeCore.project(activeRevision, 'revised')
        if (revisedProjection.coordinates.intersectsSource(content.range)) {
          appendVisibleNestedItems(annotation)
          items.push(Object.freeze({
            kind: 'commented-span',
            range: Object.freeze({
              start: annotation.range.start,
              end: next.range.end
            }),
            highlightRange: Object.freeze({ ...annotation.range }),
            commentRange: Object.freeze({ ...next.range })
          }))
          index += 1
          continue
        }
      }
      appendVisibleNestedItems(annotation)
      appendCommentNestedItems(annotation)
      items.push(Object.freeze({
        kind: annotation.kind,
        range: Object.freeze({ ...annotation.range })
      }))
    }
    return Object.freeze(items)
  }

  const reviewItemFor = (
    activeCore: DocumentCore,
    activeRevision: DocumentRevision,
    direction: 'next' | 'previous',
    from: number
  ): CoreReviewItemLocator | undefined => {
    let best: CoreReviewItemLocator | undefined
    const items = reviewItemsFor(activeCore, activeRevision)
    for (const annotation of items) {
      if (direction === 'next') {
        const containsCursor = annotation.range.start < from &&
          annotation.range.end > from
        if (annotation.range.start < from && !containsCursor) continue
        if (
          best === undefined ||
          (containsCursor && !(best.range.start < from && best.range.end > from)) ||
          (containsCursor === (best.range.start < from && best.range.end > from) &&
            annotation.range.start < best.range.start) ||
          (annotation.range.start === best.range.start &&
            annotation.range.end < best.range.end)
        ) best = annotation
      } else {
        const containsCursor = annotation.range.start < from &&
          annotation.range.end > from
        if (annotation.range.end > from && !containsCursor) continue
        if (
          best === undefined ||
          (containsCursor && !(best.range.start < from && best.range.end > from)) ||
          (containsCursor === (best.range.start < from && best.range.end > from) &&
            annotation.range.start > best.range.start) ||
          (annotation.range.start === best.range.start &&
            annotation.range.end > best.range.end)
        ) best = annotation
      }
    }
    if (direction === 'next' && best !== undefined) {
      for (const candidate of items) {
        if (
          candidate !== best && candidate.range.start >= from &&
          candidate.range.start >= best.range.start &&
          candidate.range.end <= best.range.end &&
          (candidate.range.start > best.range.start ||
            candidate.range.end < best.range.end)
        ) best = candidate
      }
    }
    return best
  }

  const commentAnnotationFor = (
    activeCore: DocumentCore,
    activeRevision: DocumentRevision,
    locator: CoreReviewItemLocator
  ): CriticMarkupAnnotation | undefined => {
    if (locator.kind === 'comment') return annotationFor(activeRevision, locator)
    if (locator.kind !== 'commented-span') return undefined
    const span = reviewItemsFor(activeCore, activeRevision).find(item =>
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

  const editedCommentFor = (
    activeCore: DocumentCore,
    activeRevision: DocumentRevision,
    annotation: CriticMarkupAnnotation,
    text: string
  ): DocumentSourceEdit | undefined => {
    if (annotation.kind !== 'comment' || typeof text !== 'string') return undefined
    const prefix = activeCore.sourceSlice(activeRevision, {
      start: 0,
      end: annotation.range.start
    })
    const suffix = activeCore.sourceSlice(activeRevision, {
      start: annotation.range.end,
      end: activeRevision.sourceLength
    })
    const candidateFor = (payload: string): DocumentSourceEdit | undefined => {
      const insert = `{>>${payload}<<}`
      const candidateCore = createDocumentCore()
      const candidate = candidateCore.open(prefix + insert + suffix, markdownOptions)
      const end = annotation.range.start + insert.length
      if (candidate.diagnostics.some(diagnostic =>
        diagnostic.range.start < end &&
        diagnostic.range.end > annotation.range.start
      )) return undefined
      const edited = candidate.annotations.find(item =>
        item.kind === 'comment' &&
        item.range.start === annotation.range.start &&
        item.range.end === end
      )
      const arm = edited?.arms.find(item => item.name === 'comment')
      return arm !== undefined && candidateCore.sourceSlice(candidate, arm.range) === payload
        ? Object.freeze({ ...annotation.range, insert })
        : undefined
    }
    const raw = candidateFor(text)
    if (raw !== undefined) return raw
    const payloadCore = createDocumentCore()
    const payload = payloadCore.open(text, markdownOptions)
    const selectivelyProtectedText = text.replace(
      /\{\+\+|\+\+\}|\{--|--\}|\{~~|~>|~~\}|\{==|==\}|\{>>|<</g,
      (token: string, offset: number) => payload.diagnostics.some(diagnostic =>
        diagnostic.range.start < offset + token.length &&
        diagnostic.range.end > offset
      )
        ? `\\${token}`
        : token
    )
    if (selectivelyProtectedText !== text) {
      const selective = candidateFor(selectivelyProtectedText)
      if (selective !== undefined) return selective
    }
    const protectedText = text.replace(
      /\{\+\+|\+\+\}|\{--|--\}|\{~~|~>|~~\}|\{==|==\}|\{>>|<</g,
      token => `\\${token}`
    )
    return protectedText === text ? undefined : candidateFor(protectedText)
  }

  const resolutionEditFor = (
    activeCore: DocumentCore,
    activeRevision: DocumentRevision,
    annotation: CriticMarkupAnnotation,
    decision: 'accept' | 'reject'
  ): DocumentSourceEdit | undefined => {
    const armSource = (name: string): string | undefined => {
      const arm = annotation.arms.find(candidate => candidate.name === name)
      return arm === undefined
        ? undefined
        : activeCore.sourceSlice(activeRevision, arm.range)
    }
    const insert = annotation.kind === 'addition'
      ? decision === 'accept' ? armSource('content') : ''
      : annotation.kind === 'deletion'
        ? decision === 'accept' ? '' : armSource('content')
        : annotation.kind === 'substitution'
          ? armSource(decision === 'accept' ? 'new' : 'old')
          : undefined
    return insert === undefined
      ? undefined
      : Object.freeze({ ...annotation.range, insert })
  }

  const bulkResolutionAnnotationsFor = (
    activeRevision: DocumentRevision
  ): readonly CriticMarkupAnnotation[] => {
    const suggestions: CriticMarkupAnnotation[] = []
    const visit = (annotations: readonly CriticMarkupAnnotation[]): void => {
      for (const annotation of annotations) {
        if (
          annotation.kind === 'addition' || annotation.kind === 'deletion' ||
          annotation.kind === 'substitution'
        ) {
          // The parent edit owns this complete source range. Nested forms in
          // that range cannot be emitted as overlapping sibling edits.
          suggestions.push(annotation)
          continue
        }
        if (annotation.kind !== 'highlight') continue
        const content = annotation.arms.find(arm => arm.name === 'content')
        if (content !== undefined) visit(content.annotations)
      }
    }
    visit(activeRevision.annotations)
    return Object.freeze(suggestions)
  }

  const authoredEditFor = (
    activeCore: DocumentCore,
    activeRevision: DocumentRevision,
    request: Extract<CoreRequest, { readonly type: 'author' }>
  ): DocumentSourceEdit | undefined => {
    if (
      (request.form !== 'comment' && request.form !== 'highlight' &&
        request.form !== 'substitution') ||
      request.range === null || typeof request.range !== 'object' ||
      typeof request.text !== 'string' ||
      !Number.isSafeInteger(request.range.start) ||
      !Number.isSafeInteger(request.range.end) ||
      request.range.start < 0 || request.range.end <= request.range.start ||
      request.range.end > activeRevision.sourceLength ||
      (request.form === 'substitution' && request.text.length === 0)
    ) return undefined
    const pendingAnnotations = [...activeRevision.annotations]
    while (pendingAnnotations.length > 0) {
      const annotation = pendingAnnotations.pop()
      if (annotation === undefined) break
      const overlaps = request.range.start < annotation.range.end &&
        request.range.end > annotation.range.start
      const contains = request.range.start <= annotation.range.start &&
        request.range.end >= annotation.range.end
      if (overlaps && !contains) return undefined
      for (const arm of annotation.arms) {
        pendingAnnotations.push(...arm.annotations)
      }
    }
    const protectCriticPayload = (source: string): string => {
      const protectedAnnotations: Array<Readonly<{
        readonly start: number
        readonly end: number
      }>> = []
      const pending = [...activeRevision.annotations]
      while (pending.length > 0) {
        const annotation = pending.pop()
        if (annotation === undefined) break
        if (
          annotation.range.start >= request.range.start &&
          annotation.range.end <= request.range.end
        ) {
          protectedAnnotations.push(annotation.range)
          continue
        }
        for (const arm of annotation.arms) pending.push(...arm.annotations)
      }
      protectedAnnotations.sort((left, right) =>
        left.start - right.start || right.end - left.end
      )
      const escapeUnowned = (value: string): string => value.replace(
        /\{\+\+|\+\+\}|\{--|--\}|\{~~|~>|~~\}|\{==|==\}|\{>>|<<\}/g,
        token => `\\${token}`
      )
      const parts: string[] = []
      let offset = 0
      for (const range of protectedAnnotations) {
        const start = range.start - request.range.start
        const end = range.end - request.range.start
        if (start < offset) continue
        parts.push(escapeUnowned(source.slice(offset, start)))
        parts.push(source.slice(start, end))
        offset = end
      }
      parts.push(escapeUnowned(source.slice(offset)))
      return parts.join('')
    }
    const rawSelected = activeCore.sourceSlice(activeRevision, request.range)
    const prefix = activeCore.sourceSlice(activeRevision, {
      start: 0,
      end: request.range.start
    })
    const suffix = activeCore.sourceSlice(activeRevision, {
      start: request.range.end,
      end: activeRevision.sourceLength
    })
    const candidateFor = (
      selected: string,
      authoredText: string
    ): DocumentSourceEdit | undefined => {
      const insert = request.form === 'comment'
        ? `{==${selected}==}{>>${authoredText}<<}`
        : request.form === 'highlight'
          ? `{==${selected}==}`
          : `{~~${selected}~>${authoredText}~~}`
      const edit = Object.freeze({
        start: request.range.start,
        end: request.range.end,
        insert
      })

      // The detached parse uses the active grammar and proves both the outer
      // form and its exact authored arms. Raw Markdown remains untouched when
      // it is already unambiguous (including code/HTML/math literal ownership).
      const candidateCore = createDocumentCore()
      const candidate = candidateCore.open(prefix + insert + suffix, markdownOptions)
      const authoredEnd = request.range.start + insert.length
      if (candidate.diagnostics.some(diagnostic =>
        diagnostic.range.start < authoredEnd &&
        diagnostic.range.end > request.range.start
      )) return undefined
      if (request.form === 'substitution') {
        const annotation = candidate.annotations.find(item =>
          item.kind === 'substitution' &&
          item.range.start === request.range.start &&
          item.range.end === request.range.start + insert.length
        )
        const oldArm = annotation?.arms.find(arm => arm.name === 'old')
        const newArm = annotation?.arms.find(arm => arm.name === 'new')
        return annotation !== undefined && oldArm !== undefined && newArm !== undefined &&
          newArm.annotations.length === 0 &&
          candidateCore.sourceSlice(candidate, oldArm.range) === selected &&
          candidateCore.sourceSlice(candidate, newArm.range) === authoredText
          ? edit
          : undefined
      }
      if (request.form === 'highlight') {
        const annotation = candidate.annotations.find(item =>
          item.kind === 'highlight' &&
          item.range.start === request.range.start &&
          item.range.end === request.range.start + insert.length
        )
        const content = annotation?.arms.find(arm => arm.name === 'content')
        return annotation !== undefined && content !== undefined &&
          candidateCore.sourceSlice(candidate, content.range) === selected
          ? edit
          : undefined
      }
      const highlight = candidate.annotations.find(item =>
        item.kind === 'highlight' &&
        item.range.start === request.range.start
      )
      const comment = candidate.annotations.find(item =>
        item.kind === 'comment' &&
        item.range.end === request.range.start + insert.length
      )
      const highlightContent = highlight?.arms.find(arm => arm.name === 'content')
      const commentContent = comment?.arms.find(arm => arm.name === 'comment')
      return highlight !== undefined && comment !== undefined &&
        highlightContent !== undefined && commentContent !== undefined &&
        commentContent.annotations.length === 0 &&
        highlight.range.end === comment.range.start &&
        candidateCore.sourceSlice(candidate, highlightContent.range) === selected &&
        candidateCore.sourceSlice(candidate, commentContent.range) === authoredText
        ? edit
        : undefined
    }
    const rawCandidate = candidateFor(rawSelected, request.text)
    if (rawCandidate !== undefined) return rawCandidate
    const protectedSelected = protectCriticPayload(rawSelected)
    if (protectedSelected !== rawSelected) {
      const selectedCandidate = candidateFor(protectedSelected, request.text)
      if (selectedCandidate !== undefined) return selectedCandidate
    }
    if (request.form === 'highlight') return undefined
    const protectedText = request.text.replace(
      /\{\+\+|\+\+\}|\{--|--\}|\{~~|~>|~~\}|\{==|==\}|\{>>|<</g,
      token => `\\${token}`
    )
    if (protectedText === request.text) return undefined
    return candidateFor(protectedSelected, protectedText)
  }

  const trackedEditFor = (
    activeCore: DocumentCore,
    activeRevision: DocumentRevision,
    request: Extract<CoreRequest, { readonly type: 'track' }>
  ): DocumentSourceEdit | undefined => {
    if (
      request.range === null || typeof request.range !== 'object' ||
      typeof request.text !== 'string' ||
      !Number.isSafeInteger(request.range.start) ||
      !Number.isSafeInteger(request.range.end) ||
      request.range.start < 0 || request.range.end < request.range.start ||
      request.range.end > activeRevision.sourceLength
    ) return undefined
    const insertion = request.range.start === request.range.end && request.text.length > 0
    const deletion = request.range.end > request.range.start && request.text.length === 0
    const substitution = request.range.end > request.range.start &&
      request.text.length > 0
    if (!insertion && !deletion && !substitution) return undefined
    const protect = (value: string, pattern: RegExp): string =>
      value.replace(pattern, token => `\\${token}`)
    const protectNativeText = (value: string): string => protect(
      value,
      /\{\+\+|\+\+\}|\{--|--\}|\{~~|~>|~~\}|\{==|==\}|\{>>|<<\}/g
    )
    const protectedNativeText = protectNativeText(request.text)
    if (insertion) {
      const pending = [...activeRevision.annotations]
      let deepestAnnotation: CriticMarkupAnnotation | undefined
      while (pending.length > 0) {
        const annotation = pending.pop()
        if (annotation === undefined) break
        if (
          request.range.start > annotation.range.start &&
          request.range.start < annotation.range.end &&
          (deepestAnnotation === undefined ||
            annotation.range.end - annotation.range.start <
              deepestAnnotation.range.end - deepestAnnotation.range.start)
        ) deepestAnnotation = annotation
        for (const arm of annotation.arms) pending.push(...arm.annotations)
      }
      if (deepestAnnotation !== undefined) {
        const content = deepestAnnotation.kind === 'addition'
          ? deepestAnnotation.arms.find(arm => arm.name === 'content')
          : deepestAnnotation.kind === 'substitution'
            ? deepestAnnotation.arms.find(arm => arm.name === 'new')
            : undefined
        if (
          content === undefined || request.range.start < content.range.start ||
          request.range.start > content.range.end
        ) return undefined
        const originalContent = activeCore.sourceSlice(activeRevision, content.range)
        const originalOld = deepestAnnotation.kind === 'substitution'
          ? deepestAnnotation.arms.find(arm => arm.name === 'old')
          : undefined
        const originalOldSource = originalOld === undefined
          ? undefined
          : activeCore.sourceSlice(activeRevision, originalOld.range)
        const localOffset = request.range.start - content.range.start
        const annotationCount = (annotations: readonly CriticMarkupAnnotation[]): number =>
          annotations.reduce((count, item) => count + 1 + item.arms.reduce(
            (armCount, arm) => armCount + annotationCount(arm.annotations),
            0
          ), 0)
        const originalAnnotationCount = annotationCount(content.annotations)
        const extensionCandidate = (payload: string): DocumentSourceEdit | undefined => {
          const prefix = activeCore.sourceSlice(activeRevision, {
            start: 0,
            end: request.range.start
          })
          const suffix = activeCore.sourceSlice(activeRevision, {
            start: request.range.end,
            end: activeRevision.sourceLength
          })
          const candidateCore = createDocumentCore()
          const candidate = candidateCore.open(prefix + payload + suffix, markdownOptions)
          const extended = candidate.annotations.find(item =>
            item.kind === deepestAnnotation.kind &&
            item.range.start === deepestAnnotation.range.start &&
            item.range.end === deepestAnnotation.range.end + payload.length
          )
          const extendedContent = extended?.arms.find(arm =>
            arm.name === (deepestAnnotation.kind === 'addition' ? 'content' : 'new')
          )
          const extendedOld = deepestAnnotation.kind === 'substitution'
            ? extended?.arms.find(arm => arm.name === 'old')
            : undefined
          return extended !== undefined && extendedContent !== undefined &&
            (deepestAnnotation.kind !== 'substitution' ||
              (extendedOld !== undefined && originalOldSource !== undefined &&
                candidateCore.sourceSlice(candidate, extendedOld.range) ===
                  originalOldSource)) &&
            !candidate.diagnostics.some(diagnostic =>
              diagnostic.range.start < extended.range.end &&
              diagnostic.range.end > extended.range.start
            ) &&
            annotationCount(extendedContent.annotations) === originalAnnotationCount &&
            candidateCore.sourceSlice(candidate, extendedContent.range) ===
              originalContent.slice(0, localOffset) + payload +
              originalContent.slice(localOffset)
            ? Object.freeze({ ...request.range, insert: payload })
            : undefined
        }
        const rawExtension = extensionCandidate(request.text)
        if (rawExtension !== undefined) return rawExtension
        return protectedNativeText === request.text
          ? undefined
          : extensionCandidate(protectedNativeText)
      }
    }
    if (substitution) {
      const pending = [...activeRevision.annotations]
      let deepestAnnotation: CriticMarkupAnnotation | undefined
      while (pending.length > 0) {
        const annotation = pending.pop()
        if (annotation === undefined) break
        const content = annotation.kind === 'addition'
          ? annotation.arms.find(arm => arm.name === 'content')
          : annotation.kind === 'substitution'
            ? annotation.arms.find(arm => arm.name === 'new')
            : undefined
        if (
          content !== undefined && content.annotations.length === 0 &&
          request.range.start >= content.range.start &&
          request.range.end <= content.range.end &&
          (deepestAnnotation === undefined ||
            annotation.range.end - annotation.range.start <
              deepestAnnotation.range.end - deepestAnnotation.range.start)
        ) deepestAnnotation = annotation
        for (const arm of annotation.arms) pending.push(...arm.annotations)
      }
      if (deepestAnnotation !== undefined) {
        const content = deepestAnnotation.kind === 'addition'
          ? deepestAnnotation.arms.find(arm => arm.name === 'content')
          : deepestAnnotation.arms.find(arm => arm.name === 'new')
        if (content === undefined) return undefined
        const originalContent = activeCore.sourceSlice(activeRevision, content.range)
        const localStart = request.range.start - content.range.start
        const localEnd = request.range.end - content.range.start
        const originalOld = deepestAnnotation.kind === 'substitution'
          ? deepestAnnotation.arms.find(arm => arm.name === 'old')
          : undefined
        const originalOldSource = originalOld === undefined
          ? undefined
          : activeCore.sourceSlice(activeRevision, originalOld.range)
        const replacementCandidate = (
          payload: string
        ): DocumentSourceEdit | undefined => {
          if (
            deepestAnnotation.kind === 'substitution' &&
            content.annotations.length === 0 &&
            originalOld?.annotations.length === 0 &&
            originalOldSource ===
              originalContent.slice(0, localStart) + payload +
              originalContent.slice(localEnd)
          ) {
            const prefix = activeCore.sourceSlice(activeRevision, {
              start: 0,
              end: deepestAnnotation.range.start
            })
            const suffix = activeCore.sourceSlice(activeRevision, {
              start: deepestAnnotation.range.end,
              end: activeRevision.sourceLength
            })
            const candidateCore = createDocumentCore()
            const candidate = candidateCore.open(
              prefix + originalOldSource + suffix,
              markdownOptions
            )
            const replacementEnd = deepestAnnotation.range.start +
              originalOldSource.length
            return candidate.annotations.every(item =>
              item.range.start >= replacementEnd ||
              item.range.end <= deepestAnnotation.range.start
            ) && !candidate.diagnostics.some(diagnostic =>
              diagnostic.range.start < replacementEnd &&
              diagnostic.range.end > deepestAnnotation.range.start
            )
              ? Object.freeze({
                start: deepestAnnotation.range.start,
                end: deepestAnnotation.range.end,
                insert: originalOldSource
              })
              : undefined
          }
          const prefix = activeCore.sourceSlice(activeRevision, {
            start: 0,
            end: request.range.start
          })
          const suffix = activeCore.sourceSlice(activeRevision, {
            start: request.range.end,
            end: activeRevision.sourceLength
          })
          const candidateCore = createDocumentCore()
          const candidate = candidateCore.open(prefix + payload + suffix, markdownOptions)
          const delta = payload.length - (request.range.end - request.range.start)
          const replaced = candidate.annotations.find(item =>
            item.kind === deepestAnnotation.kind &&
            item.range.start === deepestAnnotation.range.start &&
            item.range.end === deepestAnnotation.range.end + delta
          )
          const replacedContent = replaced?.arms.find(arm =>
            arm.name === (deepestAnnotation.kind === 'addition' ? 'content' : 'new')
          )
          const replacedOld = deepestAnnotation.kind === 'substitution'
            ? replaced?.arms.find(arm => arm.name === 'old')
            : undefined
          return replaced !== undefined && replacedContent !== undefined &&
            replacedContent.annotations.length === 0 &&
            (deepestAnnotation.kind !== 'substitution' ||
              (replacedOld !== undefined && originalOldSource !== undefined &&
                candidateCore.sourceSlice(candidate, replacedOld.range) ===
                  originalOldSource)) &&
            !candidate.diagnostics.some(diagnostic =>
              diagnostic.range.start < replaced.range.end &&
              diagnostic.range.end > replaced.range.start
            ) &&
            candidateCore.sourceSlice(candidate, replacedContent.range) ===
              originalContent.slice(0, localStart) + payload +
              originalContent.slice(localEnd)
            ? Object.freeze({ ...request.range, insert: payload })
            : undefined
        }
        const rawReplacement = replacementCandidate(request.text)
        if (rawReplacement !== undefined) return rawReplacement
        return protectedNativeText === request.text
          ? undefined
          : replacementCandidate(protectedNativeText)
      }
    }
    if (deletion) {
      const pending = [...activeRevision.annotations]
      while (pending.length > 0) {
        const annotation = pending.pop()
        if (annotation === undefined) break
        const content = annotation.kind === 'addition'
          ? annotation.arms.find(arm => arm.name === 'content')
          : annotation.kind === 'substitution'
            ? annotation.arms.find(arm => arm.name === 'new')
            : undefined
        if (
          content !== undefined && content.annotations.length === 0 &&
          request.range.start >= content.range.start &&
          request.range.end <= content.range.end
        ) {
          const originalContent = activeCore.sourceSlice(activeRevision, content.range)
          const localStart = request.range.start - content.range.start
          const localEnd = request.range.end - content.range.start
          const remainingContent = originalContent.slice(0, localStart) +
            originalContent.slice(localEnd)
          const originalOld = annotation.kind === 'substitution'
            ? annotation.arms.find(arm => arm.name === 'old')
            : undefined
          const originalOldSource = originalOld === undefined
            ? undefined
            : activeCore.sourceSlice(activeRevision, originalOld.range)
          if (
            remainingContent.length === 0 && annotation.kind === 'substitution'
          ) {
            if (
              originalOld === undefined || originalOldSource === undefined ||
              originalOld.annotations.length > 0
            ) return undefined
            const insert = `{--${originalOldSource}--}`
            const prefix = activeCore.sourceSlice(activeRevision, {
              start: 0,
              end: annotation.range.start
            })
            const suffix = activeCore.sourceSlice(activeRevision, {
              start: annotation.range.end,
              end: activeRevision.sourceLength
            })
            const candidateCore = createDocumentCore()
            const candidate = candidateCore.open(prefix + insert + suffix, markdownOptions)
            const replacement = candidate.annotations.find(item =>
              item.kind === 'deletion' &&
              item.range.start === annotation.range.start &&
              item.range.end === annotation.range.start + insert.length
            )
            const replacementContent = replacement?.arms.find(
              arm => arm.name === 'content'
            )
            return replacement !== undefined && replacementContent !== undefined &&
              replacementContent.annotations.length === 0 &&
              !candidate.diagnostics.some(diagnostic =>
                diagnostic.range.start < replacement.range.end &&
                diagnostic.range.end > replacement.range.start
              ) &&
              candidateCore.sourceSlice(candidate, replacementContent.range) ===
                originalOldSource
              ? Object.freeze({
                start: annotation.range.start,
                end: annotation.range.end,
                insert
              })
              : undefined
          }
          const prefix = activeCore.sourceSlice(activeRevision, {
            start: 0,
            end: remainingContent.length === 0
              ? annotation.range.start
              : request.range.start
          })
          const suffix = activeCore.sourceSlice(activeRevision, {
            start: remainingContent.length === 0
              ? annotation.range.end
              : request.range.end,
            end: activeRevision.sourceLength
          })
          const candidateCore = createDocumentCore()
          const candidate = candidateCore.open(prefix + suffix, markdownOptions)
          if (remainingContent.length === 0) {
            return candidate.annotations.every(item =>
              item.range.start < annotation.range.start ||
              item.range.end > annotation.range.end
            )
              ? Object.freeze({
                start: annotation.range.start,
                end: annotation.range.end,
                insert: ''
              })
              : undefined
          }
          const shrunk = candidate.annotations.find(item =>
            item.kind === annotation.kind &&
            item.range.start === annotation.range.start &&
            item.range.end === annotation.range.end -
              (request.range.end - request.range.start)
          )
          const shrunkContent = shrunk?.arms.find(arm =>
            arm.name === (annotation.kind === 'addition' ? 'content' : 'new')
          )
          const shrunkOld = annotation.kind === 'substitution'
            ? shrunk?.arms.find(arm => arm.name === 'old')
            : undefined
          return shrunk !== undefined && shrunkContent !== undefined &&
            (annotation.kind !== 'substitution' ||
              (shrunkOld !== undefined && originalOldSource !== undefined &&
                candidateCore.sourceSlice(candidate, shrunkOld.range) ===
                  originalOldSource)) &&
            !candidate.diagnostics.some(diagnostic =>
              diagnostic.range.start < shrunk.range.end &&
              diagnostic.range.end > shrunk.range.start
            ) &&
            shrunkContent.annotations.length === 0 &&
            candidateCore.sourceSlice(candidate, shrunkContent.range) === remainingContent
            ? Object.freeze({ ...request.range, insert: '' })
            : undefined
        }
        for (const arm of annotation.arms) pending.push(...arm.annotations)
      }
    }
    if (!insertion) {
      const pending = [...activeRevision.annotations]
      while (pending.length > 0) {
        const annotation = pending.pop()
        if (annotation === undefined) break
        const overlaps = request.range.start < annotation.range.end &&
          request.range.end > annotation.range.start
        const contains = request.range.start <= annotation.range.start &&
          request.range.end >= annotation.range.end
        if (overlaps && !contains) return undefined
        for (const arm of annotation.arms) pending.push(...arm.annotations)
      }
    }
    const selected = insertion
      ? ''
      : activeCore.sourceSlice(activeRevision, request.range)
    const prefix = activeCore.sourceSlice(activeRevision, {
      start: 0,
      end: request.range.start
    })
    const suffix = activeCore.sourceSlice(activeRevision, {
      start: request.range.end,
      end: activeRevision.sourceLength
    })
    const expectedKind = insertion
      ? 'addition'
      : deletion
        ? 'deletion'
        : 'substitution'
    const candidateFor = (
      selectedPayload: string,
      insertedPayload: string,
      nativePayloadMustBeLiteral = false
    ): DocumentSourceEdit | undefined => {
      const payload = insertion ? insertedPayload : selectedPayload
      const insert = insertion
        ? `{++${payload}++}`
        : deletion
          ? `{--${payload}--}`
          : `{~~${selectedPayload}~>${insertedPayload}~~}`
      const candidateCore = createDocumentCore()
      const candidate = candidateCore.open(prefix + insert + suffix, markdownOptions)
      const annotation = candidate.annotations.find(item =>
        item.kind === expectedKind && item.range.start === request.range.start &&
        item.range.end === request.range.start + insert.length
      )
      if (annotation === undefined) return undefined
      const authoredEnd = request.range.start + insert.length
      if (
        nativePayloadMustBeLiteral && candidate.diagnostics.some(diagnostic =>
          diagnostic.range.start < authoredEnd &&
          diagnostic.range.end > request.range.start
        )
      ) return undefined
      if (substitution) {
        const oldArm = annotation.arms.find(arm => arm.name === 'old')
        const newArm = annotation.arms.find(arm => arm.name === 'new')
        return oldArm !== undefined && newArm !== undefined &&
          (!nativePayloadMustBeLiteral || newArm.annotations.length === 0) &&
          candidateCore.sourceSlice(candidate, oldArm.range) === selectedPayload &&
          candidateCore.sourceSlice(candidate, newArm.range) === insertedPayload
          ? Object.freeze({ ...request.range, insert })
          : undefined
      }
      const content = annotation.arms.find(arm => arm.name === 'content')
      return content !== undefined &&
        (!nativePayloadMustBeLiteral || !insertion || content.annotations.length === 0) &&
        candidateCore.sourceSlice(candidate, content.range) === payload
        ? Object.freeze({ ...request.range, insert })
        : undefined
    }
    const rawCandidate = candidateFor(selected, request.text, true)
    if (rawCandidate !== undefined) return rawCandidate
    const protectSelectedOutsideAnnotations = (
      value: string,
      pattern: RegExp
    ): string => {
      const ownedRanges: Array<Readonly<{ start: number, end: number }>> = []
      const pending = [...activeRevision.annotations]
      while (pending.length > 0) {
        const annotation = pending.pop()
        if (annotation === undefined) break
        if (
          annotation.range.start >= request.range.start &&
          annotation.range.end <= request.range.end
        ) {
          ownedRanges.push(annotation.range)
          continue
        }
        for (const arm of annotation.arms) pending.push(...arm.annotations)
      }
      ownedRanges.sort((left, right) =>
        left.start - right.start || right.end - left.end
      )
      const parts: string[] = []
      let offset = 0
      for (const range of ownedRanges) {
        const start = range.start - request.range.start
        const end = range.end - request.range.start
        if (start < offset) continue
        parts.push(protect(value.slice(offset, start), pattern))
        parts.push(value.slice(start, end))
        offset = end
      }
      parts.push(protect(value.slice(offset), pattern))
      return parts.join('')
    }
    const protectedSelected = insertion
      ? selected
      : deletion
        ? protectSelectedOutsideAnnotations(selected, /--\}/g)
        : protectSelectedOutsideAnnotations(selected, /~>|~~\}/g)
    const protectedInserted = insertion
      ? protectedNativeText
      : substitution
        ? protectedNativeText
        : request.text
    if (
      protectedSelected === selected && protectedInserted === request.text
    ) return undefined
    return candidateFor(protectedSelected, protectedInserted, true)
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
          const restored = restoreHistory(
            request.recoveryHistory,
            request.source,
            request.options
          )
          if (restored !== 'restored') {
            return Object.freeze({
              type: 'rejected',
              session: request.session,
              sequence,
              revision: 0,
              accepted: false,
              reason: restored === 'resource'
                ? 'history-resource'
                : 'recovery-history-invalid',
              sourceLength: 0
            })
          }
        }
        core = nextCore
        revision = opened
        markdownOptions = request.options === undefined
          ? undefined
          : Object.freeze({ ...request.options })
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
      if (request.type === 'plain-text-view-at-barrier') {
        const source = revision.source
        return Object.freeze({
          type: 'plain-text-view',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          source,
          view: createMuyaPlainTextView(core.project(revision, 'revised'))
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
            ast: projection.ast
          })
        })
      }
      if (request.type === 'selection-projection-at-barrier') {
        if (
          request.range === null || typeof request.range !== 'object' ||
          !Number.isSafeInteger(request.range.start) ||
          !Number.isSafeInteger(request.range.end) ||
          request.range.start < 0 || request.range.end <= request.range.start ||
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
        const start = documentProjection.coordinates.toProjected(
          request.range.start,
          'next'
        )
        const end = documentProjection.coordinates.toProjected(
          request.range.end,
          'previous'
        )
        const markdown = documentProjection.markdown.slice(start, Math.max(start, end))
        const selectionAst = selectionAstOf(
          documentProjection,
          start,
          Math.max(start, end)
        )
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
          !Number.isSafeInteger(request.from) || request.from < 0 ||
          request.from > revision.sourceLength
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
        const annotation = reviewItemFor(core, revision, request.direction, request.from)
        const comment = annotation === undefined
          ? undefined
          : commentAnnotationFor(core, revision, annotation)
        const commentArm = comment?.arms.find(arm => arm.name === 'comment')
        return Object.freeze({
          type: 'review-item',
          session,
          sequence,
          revision: revisionNumber,
          accepted: true,
          sourceLength: revision.sourceLength,
          item: annotation === undefined
            ? null
            : Object.freeze({
              ...annotation,
              range: Object.freeze({ ...annotation.range }),
              ...(annotation.kind === 'commented-span'
                ? {
                  highlightRange: Object.freeze({ ...annotation.highlightRange }),
                  commentRange: Object.freeze({ ...annotation.commentRange })
                }
                : {})
            }),
          ...(commentArm === undefined
            ? {}
            : { commentText: core.sourceSlice(revision, commentArm.range) })
        })
      }
      const historyEntry = request.type === 'undo'
        ? undoStack.at(-1)
        : request.type === 'redo'
          ? redoStack.at(-1)
          : undefined
      let authoredEdit: DocumentSourceEdit | undefined
      if (request.type === 'author') {
        try {
          authoredEdit = authoredEditFor(core, revision, request)
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
      let trackedEdit: DocumentSourceEdit | undefined
      let trackedNoChange = false
      if (request.type === 'track') {
        try {
          trackedNoChange = request.range !== null &&
            typeof request.range === 'object' &&
            typeof request.text === 'string' &&
            Number.isSafeInteger(request.range.start) &&
            Number.isSafeInteger(request.range.end) &&
            request.range.start >= 0 &&
            request.range.end >= request.range.start &&
            request.range.end <= revision.sourceLength &&
            core.sourceSlice(revision, request.range) === request.text
          if (!trackedNoChange) {
            trackedEdit = trackedEditFor(core, revision, request)
          }
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
      if (request.type === 'track' && trackedNoChange) {
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
      if (request.type === 'track' && trackedEdit === undefined) {
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
        if (
          !Array.isArray(request.replacements) ||
          request.replacements.length === 0
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
        const resolved = request.replacements.flatMap(replacement => {
          if (
            replacement === null || typeof replacement !== 'object' ||
            typeof replacement.insert !== 'string'
          ) return []
          const range = projectedRangeForConsumerMatch(projection, replacement.match)
          if (range === undefined) return []
          const start = projection.coordinates.toSource(range.start, 'next')
          const end = projection.coordinates.toSource(range.end, 'previous')
          if (
            end < start ||
            activeCore.sourceSlice(activeRevision, { start, end }) !==
              replacement.match.match
          ) return []
          return [Object.freeze({ start, end, insert: replacement.insert })]
        }).sort((left, right) => left.start - right.start || left.end - right.end)
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
        consumerSearchEdits = Object.freeze(resolved.filter(edit =>
          activeCore.sourceSlice(activeRevision, edit) !== edit.insert
        ))
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
          locator === null || typeof locator !== 'object' ||
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
        const arm = comment.arms.find(candidate => candidate.name === 'comment')
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
          editedComment = editedCommentFor(core, revision, comment, request.text)
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
      if (
        (request.type === 'undo' || request.type === 'redo') &&
        historyEntry === undefined
      ) {
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
      const resolutionAnnotation = request.type === 'resolve'
        ? request.annotation.kind === 'commented-span'
          ? undefined
          : annotationFor(revision, request.annotation)
        : undefined
      const requestedCommentedSpan = request.type === 'resolve' &&
        request.annotation.kind === 'commented-span'
        ? request.annotation
        : undefined
      const resolutionCommentedSpan = requestedCommentedSpan !== undefined
        ? reviewItemsFor(core, revision).find(item =>
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
        request.type === 'resolve' && resolutionAnnotation === undefined &&
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
      const resolutionDecisionIsValid = request.type !== 'resolve' ||
        (resolutionCommentedSpan !== undefined
          ? request.decision === 'remove'
          : resolutionAnnotation?.kind === 'highlight' ||
              resolutionAnnotation?.kind === 'comment'
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
        request.decision !== 'accept' && request.decision !== 'reject'
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
      const resolutionEdit = request.type === 'resolve'
        ? resolutionCommentedSpan?.kind === 'commented-span'
          ? (() => {
            const activeCore = core
            const activeRevision = revision
            const highlight = annotationFor(activeRevision, {
              kind: 'highlight',
              range: resolutionCommentedSpan.highlightRange
            })
            const content = highlight?.arms.find(arm => arm.name === 'content')
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
              const arm = annotation.arms.find(candidate => candidate.name === name)
              return arm === undefined
                ? undefined
                : activeCore.sourceSlice(activeRevision, arm.range)
            }
            const decision = request.decision === 'remove'
              ? 'accept'
              : request.decision
            const insert = annotation.kind === 'addition'
              ? decision === 'accept' ? armSource('content') : ''
              : annotation.kind === 'deletion'
                ? decision === 'accept' ? '' : armSource('content')
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
      const bulkResolutionEdits = request.type === 'resolve-all'
        ? (() => {
          const activeCore = core
          const activeRevision = revision
          return Object.freeze(bulkResolutionAnnotationsFor(activeRevision).flatMap(
            annotation => {
              const edit = resolutionEditFor(
                activeCore,
                activeRevision,
                annotation,
                request.decision
              )
              return edit === undefined ? [] : [edit]
            }
          ))
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
      const effectiveApplyEdits = request.type === 'apply'
        ? (() => {
          const activeCore = core
          const activeRevision = revision
          let previousEnd = 0
          const valid = request.edits.every(edit => {
            const accepted = edit !== null && typeof edit === 'object' &&
              Number.isSafeInteger(edit.start) &&
              Number.isSafeInteger(edit.end) &&
              typeof edit.insert === 'string' &&
              edit.start >= previousEnd && edit.end >= edit.start &&
              edit.end <= activeRevision.sourceLength
            previousEnd = edit?.end ?? previousEnd
            return accepted
          })
          return valid
            ? Object.freeze(request.edits.filter(edit =>
              activeCore.sourceSlice(activeRevision, edit) !== edit.insert
            ))
            : request.edits
        })()
        : undefined
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
      const edits = request.type === 'apply'
        ? effectiveApplyEdits!
        : request.type === 'replace-consumer-search'
          ? consumerSearchEdits!
          : request.type === 'author'
            ? Object.freeze([authoredEdit!])
            : request.type === 'track'
              ? Object.freeze([trackedEdit!])
              : request.type === 'edit-comment'
                ? Object.freeze([editedComment!])
                : request.type === 'resolve-all'
                  ? bulkResolutionEdits!
                  : request.type === 'resolve'
                    ? Object.freeze([resolutionEdit!])
                    : request.type === 'undo'
                      ? historyEntry!.undo
                      : historyEntry!.redo
      if (
        (request.type === 'apply' || request.type === 'resolve-all' ||
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
        (request.type === 'apply' || request.type === 'replace-consumer-search') &&
        edits!.length > 1
      ) {
        const prospectiveSource = applyRecoveryEdits(revision.source, edits!)
        if (prospectiveSource === revision.source) {
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
      let commit
      try {
        inverse = request.type === 'apply' ||
          request.type === 'replace-consumer-search' || request.type === 'author' ||
          request.type === 'track' || request.type === 'edit-comment' ||
          request.type === 'resolve' || request.type === 'resolve-all'
          ? inverseEdits(core, revision, edits!)
          : undefined
        if (inverse !== undefined) {
          prospectiveEntry = Object.freeze({
            undo: inverse,
            redo: copyEdits(edits!)
          })
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
        commit = core.apply(revision, edits!, { projections: request.projections })
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
      revision = commit.revision
      revisionNumber += 1
      if (
        request.type === 'apply' || request.type === 'replace-consumer-search' ||
        request.type === 'resolve' ||
        request.type === 'author' || request.type === 'track' ||
        request.type === 'edit-comment' || request.type === 'resolve-all'
      ) {
        const entry = prospectiveEntry!
        redoStack.splice(0)
        redoUnits = 0
        redoEditRecords = 0
        undoStack.push(entry)
        undoUnits += historyUnits(entry)
        undoEditRecords += historyEditRecords(entry)
        trimUndoHistory()
      } else if (request.type === 'undo') {
        undoStack.pop()
        undoUnits -= historyUnits(historyEntry!)
        undoEditRecords -= historyEditRecords(historyEntry!)
        redoStack.push(historyEntry!)
        redoUnits += historyUnits(historyEntry!)
        redoEditRecords += historyEditRecords(historyEntry!)
      } else {
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
        session,
        sequence,
        revision: revisionNumber,
        accepted: true,
        sourceLength: commit.revision.sourceLength,
        ...diagnostics,
        change: commit.change
      })
    },
    dispose(): void {
      disposed = true
      core = undefined
      revision = undefined
      undoStack.splice(0)
      redoStack.splice(0)
      undoUnits = 0
      redoUnits = 0
      undoEditRecords = 0
      redoEditRecords = 0
    }
  })
}
