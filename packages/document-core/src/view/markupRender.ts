import type { MarkupLiveRenderPlan, ModelRange } from '../documentSession.js'
import type {
  CompleteDocumentRevision,
  MarkdownDocument,
  MarkupMark,
  SourceOffset,
  SourceRange
} from '../revision.js'

/**
 * The block AST of a revision's canonical (marker-bearing) editing view — the
 * structure a WYSIWYG editor renders, which the engine must own so the view
 * mounts rather than re-parses it.
 *
 * ADR 0013: the engine parses once and reads every view off it; the editing view
 * is that parse. The block AST is the editing view's Markdown tree — markers
 * zero-width, all content present (both Substitution arms, old then new). For a
 * CriticMarkup-free document the editing view is the source itself, so this is
 * the shared parse the engine already builds; the projection is lazy, so reading
 * it here never adds a parse to `open()`.
 */
export function canonicalMarkupDocument(
  revision: CompleteDocumentRevision
): MarkdownDocument {
  return revision.projection('editing').markdown
}

/**
 * The editing-view element a CriticMarkup mark renders as, following the
 * documented CriticMarkup presentation: additions are insertions, deletions and
 * a substitution's old arm are deletions, a substitution's new arm is an
 * insertion, and a highlight is a mark. Comments have no Markup-view element —
 * they are hidden and shown only in the sidebar — so no mark maps to them here.
 */
export type MarkupRenderElement = 'ins' | 'del' | 'mark'

/**
 * One render run: the run's text plus the ordered element wrappers (outermost
 * first) a view mounts around it, keeping the model↔source mapping the view
 * needs for selection and editing. A run with no marks has no wrappers and is
 * plain text.
 */
export interface MarkupRenderRun {
  readonly key: string
  readonly text: string
  readonly elements: readonly MarkupRenderElement[]
  readonly modelRange: ModelRange
  readonly sourceRange: SourceRange
}

/**
 * One rendered line: the render runs whose text falls on this line (none
 * containing `\n`) and whether a newline terminates it. A view mounts one block
 * element per line; markdown block *semantics* (which lines form a heading or a
 * list) are the view's concern, computed from these lines' model↔source ranges.
 */
export interface MarkupRenderLine {
  readonly runs: readonly MarkupRenderRun[]
  /**
   * The line's content span in model offsets, excluding the terminating
   * newline. Present even for a blank line (a zero-width span), so a view can
   * place a caret on any line — including empty ones — and translate it back to
   * a model position.
   */
  readonly modelRange: ModelRange
  readonly endsWithNewline: boolean
}

export function markupRenderElement(mark: MarkupMark): MarkupRenderElement {
  switch (mark.kind) {
    case 'addition':
      return 'ins'
    case 'deletion':
      return 'del'
    case 'highlight':
      return 'mark'
    case 'substitution':
      return mark.arm === 'old' ? 'del' : 'ins'
  }
}

/**
 * Turn an engine-produced `MarkupLiveRenderPlan` into the render runs a WYSIWYG
 * view mounts. Pure and DOM-free: the view owns the actual DOM/vdom; this owns
 * the plan→structure mapping so the two are testable apart. Nested marks (CM
 * inside CM) become nested wrappers, outermost mark first.
 */
export function renderMarkupPlan(
  plan: MarkupLiveRenderPlan
): readonly MarkupRenderRun[] {
  return Object.freeze(plan.runs.map((run) => Object.freeze({
    key: run.key,
    text: run.text,
    elements: Object.freeze(run.marks.map(markupRenderElement)),
    modelRange: run.modelRange,
    sourceRange: run.sourceRange
  })))
}

/**
 * Split render runs into lines at newline boundaries. A run whose text spans a
 * newline is divided into per-line sub-runs that keep the run's element
 * wrappers and carry the exact model/source sub-ranges, so a CriticMarkup mark
 * spanning a newline stays on both halves and the view keeps a total
 * model↔source map. The `\n` itself is a line terminator, not run content;
 * joining line texts with `\n` reproduces the model text.
 */
export function groupRenderLines(
  runs: readonly MarkupRenderRun[]
): readonly MarkupRenderLine[] {
  const lines: MarkupRenderLine[] = []
  let current: MarkupRenderRun[] = []
  let lineStart = runs.length > 0 ? runs[0]!.modelRange.start : 0
  let modelEnd = lineStart
  const closeLine = (contentEnd: number, endsWithNewline: boolean): void => {
    lines.push(Object.freeze({
      runs: Object.freeze(current),
      modelRange: Object.freeze({ start: lineStart, end: contentEnd }),
      endsWithNewline
    }))
    current = []
    lineStart = endsWithNewline ? contentEnd + 1 : contentEnd
  }

  for (const run of runs) {
    let segmentStart = 0
    for (let index = 0; index <= run.text.length; index += 1) {
      const atNewline = index < run.text.length && run.text.charCodeAt(index) === 10
      if (!atNewline && index !== run.text.length) {
        continue
      }
      // Emit a sub-run for [segmentStart, index) only when it has content; a
      // zero-length segment (e.g. an empty line) contributes no zero-width run.
      if (index > segmentStart) {
        current.push(Object.freeze({
          key: `${run.key}:${segmentStart}`,
          text: run.text.slice(segmentStart, index),
          elements: run.elements,
          modelRange: Object.freeze({
            start: run.modelRange.start + segmentStart,
            end: run.modelRange.start + index
          }),
          sourceRange: Object.freeze({
            start: (run.sourceRange.start + segmentStart) as SourceOffset,
            end: (run.sourceRange.start + index) as SourceOffset
          })
        }))
      }
      if (atNewline) {
        closeLine(run.modelRange.start + index, true)
        segmentStart = index + 1
      }
    }
    modelEnd = run.modelRange.end
  }
  closeLine(Math.max(lineStart, modelEnd), false)
  return Object.freeze(lines)
}
