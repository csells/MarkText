import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkupSyntax, SourceRange } from './documentCore.js'
import type { DocumentInputAction, DocumentInputPlan } from './inputPlanning.js'
import type { DocumentSelection } from './sourceInputPlanning.js'
import { codeBlockEdgeTrims } from './codeBlockEdgeTrimming.js'
import { editedSourceReader } from './emptiedParagraphPlanning.js'
import { rebaseModelTextPoint } from './modelText.js'
import { composeSourceEdits } from './sourceEditComposition.js'
import { positionAfter } from './sourcePosition.js'

/** Preferences that ask an edit to bring the blocks it changes to upstream's spelling. */
export interface EditNormalizationOptions {
  readonly trimUnnecessaryCodeBlockEmptyLines?: boolean | undefined
}

/** How a planner reads the revision it normalizes. */
export interface EditNormalizationReaders {
  /** The window around a range when one reads it; undefined where only the document's parse does. */
  readonly syntax?: ((range: SourceRange) => MarkupSyntax | undefined) | undefined
  /** The whole source extent of the literal block holding a position, from the regional inventory. */
  readonly literalBlockRange?: ((position: number) => SourceRange | undefined) | undefined
}

export interface EditNormalizationContext extends EditNormalizationReaders {
  readonly core: DocumentCore
  /** The revision the planner's edits apply to. */
  readonly revision: DocumentRevision
  /** The planner's own edits, sorted, in `revision`'s source. */
  readonly edits: readonly DocumentSourceEdit[]
  /** Reads the source `edits` produce. */
  readonly result: (start: number, end: number) => string
  readonly options: EditNormalizationOptions
}

/**
 * Upstream rewrites some blocks whenever its parser reads a document. Here
 * such a rewrite belongs to the edit that changes the block: a normalization
 * returns edits against the source the planner's edits produce, disjoint from
 * every other normalization's, and must propose nothing for its own output.
 */
export type EditNormalization = (context: EditNormalizationContext) => readonly DocumentSourceEdit[]

const normalizations: readonly EditNormalization[] = [codeBlockEdgeTrims]

/**
 * The one hook every edit planner passes its edits through, untracked or
 * tracked: `edits` with each normalization composed into the same operation,
 * and the normalizations as the edited source reads them, for carrying the
 * planner's selection. A tracked planner normalizes its untracked edits before
 * spelling them as suggestions, so Accept All gives the untracked result.
 * Undefined when nothing applies.
 */
export function normalizeEdits(
  core: DocumentCore,
  revision: DocumentRevision,
  edits: readonly DocumentSourceEdit[],
  options: EditNormalizationOptions,
  readers: EditNormalizationReaders = {}
): { readonly edits: readonly DocumentSourceEdit[], readonly normalized: readonly DocumentSourceEdit[] } | undefined {
  if (edits.length === 0) return undefined
  const sorted = [...edits].sort((left, right) => left.start - right.start || left.end - right.end)
  const result = editedSourceReader(core, revision, sorted)
  const context: EditNormalizationContext = { core, revision, edits: sorted, result, options, ...readers }
  const normalized = normalizations.flatMap(normalization => normalization(context))
    .sort((left, right) => left.start - right.start || left.end - right.end)
  if (normalized.length === 0) return undefined
  normalized.forEach((edit, index) => {
    const next = normalized[index + 1]
    if (next !== undefined && next.start < edit.end) throw new RangeError('Edit normalizations overlap')
  })
  return {
    edits: Object.freeze(composeSourceEdits(sorted, normalized, result).map(edit => Object.freeze(edit))),
    normalized: Object.freeze(normalized.map(edit => Object.freeze({ ...edit })))
  }
}

/** A planned selection carried past `normalized`, in the edited source. */
export function selectionAfterNormalization<Selection extends DocumentInputPlan['selection'] | DocumentSelection | SourceRange>(selection: Selection, normalized: readonly DocumentSourceEdit[]): Selection {
  const point = (at: number) => positionAfter(normalized, at, false)
  const value = selection as DocumentInputPlan['selection'] | DocumentSelection | SourceRange
  const moved = 'ranges' in value
    ? { ...value, ranges: value.ranges.map(range => ({ anchor: point(range.anchor), focus: point(range.focus) })) }
    : 'start' in value
      ? { start: point(value.start), end: point(value.end) }
      : value.kind === 'model-text'
        ? { ...value, anchor: rebaseModelTextPoint(value.anchor, normalized), focus: rebaseModelTextPoint(value.focus, normalized) }
        : value
  return Object.freeze(moved) as Selection
}

/** An input plan normalized as its action's options ask, its selection and native echo carried along. */
export function normalizeInputPlan(
  core: DocumentCore,
  revision: DocumentRevision,
  action: DocumentInputAction,
  plan: DocumentInputPlan,
  readers: EditNormalizationReaders = {}
): DocumentInputPlan {
  const normalized = normalizeEdits(core, revision, plan.edits, action.options, readers)
  if (normalized === undefined) return plan
  return Object.freeze({
    ...plan,
    edits: normalized.edits,
    selection: selectionAfterNormalization(plan.selection, normalized.normalized),
    // A native echo of the input lacks the normalization, which the plan's
    // own operation carries.
    ...('kind' in action
      ? {}
      : { reconciliation: Object.freeze(composeSourceEdits(plan.reconciliation, normalized.normalized, editedSourceReader(core, revision, plan.edits)).map(edit => Object.freeze(edit))) })
  })
}

/**
 * A normalized edit set as one replacement, from its first edit's start to its
 * last's end. A tracked planner spells each of its edits as its own
 * suggestion; joined, a normalization inside a literal block becomes part of
 * the same proposed block as the edit that caused it.
 */
export function joinedEdit(core: DocumentCore, revision: DocumentRevision, edits: readonly DocumentSourceEdit[]): DocumentSourceEdit {
  const first = edits[0]
  const last = edits.at(-1)
  if (first === undefined || last === undefined) throw new RangeError('Joining requires an edit')
  const delta = edits.reduce((sum, edit) => sum + edit.insert.length - (edit.end - edit.start), 0)
  return Object.freeze({ start: first.start, end: last.end, insert: editedSourceReader(core, revision, edits)(first.start, last.end + delta) })
}
