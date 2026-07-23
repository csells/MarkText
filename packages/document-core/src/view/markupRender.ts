import type { MarkupLiveRenderPlan, ModelRange } from '../documentSession.js'
import type {
  CompleteDocumentRevision,
  MarkdownDocument,
  MarkdownNodeKind,
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
 * One block a view mounts: the engine-emitted block node's kind and span, plus
 * the CriticMarkup-marked inline runs that fall inside it. A run straddling a
 * block boundary is split so each block carries only its own text.
 */
export interface MarkupRenderBlock {
  readonly kind: MarkdownNodeKind
  readonly modelRange: ModelRange
  readonly runs: readonly MarkupRenderRun[]
}

/**
 * Join the engine's editing-view block AST with the CriticMarkup-marked inline
 * runs into the tree a WYSIWYG view mounts. The view never computes block
 * structure — it mounts what the parser emitted (ADR-0009/0013) — and never
 * loses the marks or the model↔source map it needs for selection and editing.
 *
 * Both inputs share one coordinate space: the editing projection's source is the
 * session's model text, so a block's range and a run's `modelRange` are directly
 * comparable.
 */
export function groupRenderBlocks(
  document: MarkdownDocument,
  runs: readonly MarkupRenderRun[]
): readonly MarkupRenderBlock[] {
  const root = document.root
  return Object.freeze(Array.from({ length: root.childCount }, (_, ordinal) => {
    const block = root.childAt(ordinal)
    const start = block.range.start
    const end = block.range.end
    const blockRuns: MarkupRenderRun[] = []
    for (const run of runs) {
      const overlapStart = Math.max(run.modelRange.start, start)
      const overlapEnd = Math.min(run.modelRange.end, end)
      if (overlapStart >= overlapEnd) {
        continue
      }
      blockRuns.push(
        overlapStart === run.modelRange.start && overlapEnd === run.modelRange.end
          ? run
          : sliceRenderRun(run, overlapStart, overlapEnd)
      )
    }
    return Object.freeze({
      kind: block.kind,
      modelRange: Object.freeze({ start, end }),
      runs: Object.freeze(blockRuns)
    })
  }))
}

/**
 * Which blocks can share one parse across views, and which must be resolved per
 * view. `shared` and `divergent` together cover the document, in order.
 */
export interface ForkPlan {
  readonly shared: readonly ModelRange[]
  readonly divergent: readonly ModelRange[]
}

/**
 * Plan where a per-view fork is actually required (ADR-0013 slices 2-3).
 *
 * Original and Revised differ only where an Addition, Deletion or Substitution
 * resolves differently — rendered as `ins` and `del`. A Highlight renders in
 * both views and a Comment body is hidden in both, so a block carrying only
 * those is byte-identical across views and one parse serves every view.
 *
 * Blocks are the unit because a fork reconverges at a safe point and every
 * top-level block start is one (`specs/research/0002`), so a divergence can
 * never leak past its block into the shared remainder.
 */
export function forkPlanOf(blocks: readonly MarkupRenderBlock[]): ForkPlan {
  const shared: ModelRange[] = []
  const divergent: ModelRange[] = []
  for (const block of blocks) {
    const diverges = block.runs.some((run) =>
      run.elements.includes('ins') || run.elements.includes('del')
    )
    ;(diverges ? divergent : shared).push(block.modelRange)
  }
  return Object.freeze({
    shared: Object.freeze(shared),
    divergent: Object.freeze(divergent)
  })
}

/**
 * Where the caret or a click sits in view terms: which mounted block, which run
 * inside it, and how many UTF-16 code units into that run's text. `offset` may
 * equal the run's length, meaning the boundary just past its last character.
 */
export interface MarkupViewPosition {
  readonly blockIndex: number
  readonly runIndex: number
  readonly offset: number
}

/**
 * The model offset a view position denotes. Every editor intent addresses the
 * model, so this is the translation a view performs before dispatching one — it
 * reads the engine-emitted mapping the run already carries rather than counting
 * rendered DOM text.
 *
 * @throws RangeError when the position is not a position in these blocks.
 */
export function modelOffsetAt(
  blocks: readonly MarkupRenderBlock[],
  position: MarkupViewPosition
): number {
  const block = blocks[position.blockIndex]
  if (block === undefined) {
    throw new RangeError(`No mounted block at index ${position.blockIndex}`)
  }
  const run = block.runs[position.runIndex]
  if (run === undefined) {
    // A block with no runs (an empty paragraph) still has a caret position.
    if (position.runIndex === 0 && position.offset === 0) {
      return block.modelRange.start
    }
    throw new RangeError(`No run at index ${position.runIndex}`)
  }
  if (position.offset < 0 || position.offset > run.text.length) {
    throw new RangeError(`Offset ${position.offset} is outside the run`)
  }
  return run.modelRange.start + position.offset
}

/**
 * The view position that renders a model offset — the reverse of
 * `modelOffsetAt`, used to place the caret after the model changes.
 *
 * An offset between two runs is genuinely two positions: the trailing edge of
 * the earlier run and the leading edge of the later one. `affinity` picks the
 * side, matching `ModelPosition.affinity`. At a CriticMarkup boundary the choice
 * is meaningful — `'next'` puts the caret inside the following run, so typing at
 * the start of an addition extends the addition, while `'previous'` keeps it in
 * the preceding text.
 *
 * @throws RangeError when the offset is not rendered by these blocks.
 */
export function viewPositionAt(
  blocks: readonly MarkupRenderBlock[],
  modelOffset: number,
  affinity: 'previous' | 'next' = 'next'
): MarkupViewPosition {
  const candidates: MarkupViewPosition[] = []
  for (const [blockIndex, block] of blocks.entries()) {
    if (modelOffset < block.modelRange.start || modelOffset > block.modelRange.end) {
      continue
    }
    for (const [runIndex, run] of block.runs.entries()) {
      if (modelOffset < run.modelRange.start || modelOffset > run.modelRange.end) {
        continue
      }
      candidates.push({
        blockIndex,
        runIndex,
        offset: modelOffset - run.modelRange.start
      })
    }
    // A block with no runs (an empty paragraph) still hosts a caret.
    if (block.runs.length === 0 && modelOffset === block.modelRange.start) {
      candidates.push({ blockIndex, runIndex: 0, offset: 0 })
    }
  }
  const preferred = affinity === 'next'
    // Leading edge of the later run; fall back to the only candidate there is.
    ? candidates.find((candidate) => candidate.offset === 0) ?? candidates[0]
    // Trailing edge of the earlier run.
    : candidates.find((candidate) => candidate.offset !== 0) ?? candidates[0]
  if (preferred === undefined) {
    throw new RangeError(`Model offset ${modelOffset} is not rendered`)
  }
  return Object.freeze(preferred)
}

/** The `[from, to)` model-offset slice of a run, keeping its marks and mapping. */
function sliceRenderRun(
  run: MarkupRenderRun,
  from: number,
  to: number
): MarkupRenderRun {
  const offset = from - run.modelRange.start
  const length = to - from
  return Object.freeze({
    key: `${run.key}:${offset}`,
    text: run.text.slice(offset, offset + length),
    elements: run.elements,
    modelRange: Object.freeze({ start: from, end: to }),
    sourceRange: Object.freeze({
      start: (run.sourceRange.start + offset) as SourceOffset,
      end: (run.sourceRange.start + offset + length) as SourceOffset
    })
  })
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
