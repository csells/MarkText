import type {
  IntrinsicProfile1ForkGraph,
  IntrinsicProfile1ForkLane,
  IntrinsicProfile1ForkLaneItem,
  IntrinsicProfile1LaneTransition,
  IntrinsicProfile1SourceSlice
} from './intrinsicProfile1ForkGraph.js'
import type {
  MarkdownCheckpoint,
  PlainMarkdownContainer,
  PlainMarkdownLine,
  PlainMarkdownListMarker
} from './markdownLaneState.js'
import type { MarkdownLiteralRange } from './markdownTypes.js'
import type { TapeRun } from './sourceTape.js'
import type {
  SourceOffset,
  SourceRange,
  SyntaxDiagnostic
} from '../../revision.js'

/**
 * The incremental intrinsic parse (G32): a reopen whose edits sit between two
 * safe points re-scans only that bracket and splices the retained facts of
 * the untouched prefix and suffix around the bracket's fresh mini-parse.
 *
 * Version one is deliberately narrow — it accepts only documents the splice
 * can prove trivial end to end: no CriticMarkup candidates, no literals, no
 * reference definitions, no diagnostics, a root-only fork graph whose
 * boundary checkpoints are clean. Everything else falls back to the full
 * pass. Narrowness is a guard property, not a design ceiling: each widened
 * guard must widen the equivalence proof with it.
 */

function spliceOffset(value: number): SourceOffset {
  return value as SourceOffset
}

function spliceRange(start: number, end: number): SourceRange {
  return Object.freeze({
    start: spliceOffset(start),
    end: spliceOffset(end)
  })
}

export interface IntrinsicSpliceBracket {
  /** Bracket start, identical in previous and next coordinates. */
  readonly start: number
  /** Bracket end in previous coordinates — a previous safe point or EOF. */
  readonly endPrevious: number
  /** Bracket end in next coordinates. */
  readonly endNext: number
  /** next length minus previous length. */
  readonly delta: number
}

export interface RetainedIntrinsicFacts {
  readonly sourceLength: number
  readonly hasCriticMarkupCandidate: boolean
  readonly rootCount: number
  readonly markerDecisionCount: number
  readonly referenceDefinitionCount: number
  readonly tape: readonly TapeRun[]
  readonly diagnostics: readonly SyntaxDiagnostic[]
  readonly markdownLiterals: readonly MarkdownLiteralRange[]
  readonly safePoints: readonly number[]
  readonly forkGraph: IntrinsicProfile1ForkGraph
}

export interface SpliceSourceEdit {
  readonly start: number
  readonly end: number
  readonly insert: string
}

/** The mini-parse products of the bracket window, in window coordinates. */
export interface BracketPassFacts {
  readonly hasCriticMarkupCandidate: boolean
  readonly rootCount: number
  readonly markerDecisionCount: number
  readonly tape: readonly TapeRun[]
  readonly diagnostics: readonly SyntaxDiagnostic[]
  readonly markdownLiterals: readonly MarkdownLiteralRange[]
  readonly forkGraph: IntrinsicProfile1ForkGraph
}

export interface SplicedIntrinsicFacts {
  readonly tape: readonly TapeRun[]
  readonly diagnostics: readonly SyntaxDiagnostic[]
  readonly markdownLiterals: readonly MarkdownLiteralRange[]
  readonly forkGraph: IntrinsicProfile1ForkGraph
}

/**
 * Characters whose appearance anywhere in the bracket window could spell a
 * construct the version-one splice refuses to reason about: CriticMarkup
 * candidates, links and definitions, code, HTML, and fences.
 */
const GUARDED_WINDOW_UNITS = new Set(
  ['{', '[', '`', '~', '<'].map((unit) => unit.charCodeAt(0))
)

function windowIsGuardClean(
  text: string,
  start: number,
  end: number
): boolean {
  for (let offset = start; offset < end; offset += 1) {
    if (GUARDED_WINDOW_UNITS.has(text.charCodeAt(offset))) {
      return false
    }
  }
  return true
}

/**
 * A checkpoint the splice may re-base: nothing open, nothing pending. Only
 * `lineStart` carries a coordinate, so shifting is a single-field rebuild.
 */
function checkpointIsClean(checkpoint: MarkdownCheckpoint): boolean {
  return checkpoint.linePath === undefined &&
    checkpoint.inlineCode === undefined &&
    checkpoint.math === undefined &&
    checkpoint.bracketPath === undefined &&
    checkpoint.pendingLinkLabel === undefined &&
    checkpoint.fixedInline === undefined &&
    checkpoint.activeContainers.length === 0 &&
    !checkpoint.paragraphOpen &&
    !checkpoint.lastLineLazy &&
    checkpoint.fence === undefined &&
    !checkpoint.trailingBackslashOdd &&
    checkpoint.frontMatter === undefined &&
    checkpoint.indentedCode === undefined &&
    checkpoint.htmlBlock === undefined &&
    checkpoint.definition === undefined &&
    checkpoint.pendingCarriageReturn === undefined &&
    checkpoint.firstContainerDepthFailure === undefined
}

function shiftCheckpoint(
  checkpoint: MarkdownCheckpoint,
  delta: number
): MarkdownCheckpoint {
  if (delta === 0) return checkpoint
  return Object.freeze({
    ...checkpoint,
    lineStart: checkpoint.lineStart + delta
  })
}

function shiftListMarker(
  marker: PlainMarkdownListMarker,
  delta: number
): PlainMarkdownListMarker {
  return Object.freeze({
    ...marker,
    start: marker.start + delta,
    end: marker.end + delta,
    contentOffset: marker.contentOffset + delta
  })
}

function shiftContainer(
  container: PlainMarkdownContainer,
  delta: number
): PlainMarkdownContainer {
  if (container.kind === 'blockquote') {
    return Object.freeze({
      ...container,
      start: container.start + delta,
      end: container.end + delta
    })
  }
  return Object.freeze({
    ...container,
    start: container.start + delta,
    end: container.end + delta,
    contentOffset: container.contentOffset + delta
  })
}

function shiftLine(line: PlainMarkdownLine, delta: number): PlainMarkdownLine {
  if (delta === 0) return line
  return Object.freeze({
    ...line,
    start: line.start + delta,
    contentEnd: line.contentEnd + delta,
    end: line.end + delta,
    contentOffset: line.contentOffset + delta,
    listMarkers: Object.freeze(
      line.listMarkers.map((marker) => shiftListMarker(marker, delta))
    ),
    containers: Object.freeze(
      line.containers.map((container) => shiftContainer(container, delta))
    )
  })
}

function shiftLiteral(
  literal: MarkdownLiteralRange,
  delta: number
): MarkdownLiteralRange {
  if (delta === 0) return literal
  return Object.freeze({
    ...literal,
    start: literal.start + delta,
    end: literal.end + delta,
    ...(literal.construct === undefined
      ? {}
      : {
        construct: Object.freeze({
          ...literal.construct,
          start: literal.construct.start + delta,
          labelStart: literal.construct.labelStart + delta,
          labelEnd: literal.construct.labelEnd + delta
        })
      })
  })
}

function shiftSlice(
  slice: IntrinsicProfile1SourceSlice,
  delta: number,
  remapRunId: (id: number) => number
): IntrinsicProfile1SourceSlice {
  return Object.freeze({
    kind: 'source',
    sourceRunId: remapRunId(slice.sourceRunId),
    range: spliceRange(slice.range.start + delta, slice.range.end + delta)
  })
}

function shiftTransition(
  transition: IntrinsicProfile1LaneTransition,
  delta: number,
  remapRunId: (id: number) => number
): IntrinsicProfile1LaneTransition {
  return Object.freeze({
    operation: transition.operation,
    entryCheckpoint: shiftCheckpoint(transition.entryCheckpoint, delta),
    exitCheckpoint: shiftCheckpoint(transition.exitCheckpoint, delta),
    consumed: Object.freeze(
      transition.consumed.map((slice) => shiftSlice(slice, delta, remapRunId))
    ),
    emittedFacts: Object.freeze({
      literals: Object.freeze(
        transition.emittedFacts.literals.map(
          (literal) => shiftLiteral(literal, delta)
        )
      ),
      lines: Object.freeze(
        transition.emittedFacts.lines.map((line) => shiftLine(line, delta))
      ),
      block: Object.freeze({
        ...transition.emittedFacts.block,
        lineStart: transition.emittedFacts.block.lineStart + delta
      })
    })
  })
}

/**
 * The bracket the edits demand: the greatest retained safe point at or below
 * the earliest edit, to the least retained safe point strictly beyond the
 * last edit — or the previous end of document. Undefined when no bracket
 * isolates the edits.
 */
export function bracketForEdits(
  retained: RetainedIntrinsicFacts,
  edits: readonly SpliceSourceEdit[],
  nextLength: number
): IntrinsicSpliceBracket | undefined {
  if (edits.length === 0) return undefined
  let editStart = Number.POSITIVE_INFINITY
  let editEnd = Number.NEGATIVE_INFINITY
  for (const edit of edits) {
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > retained.sourceLength
    ) {
      return undefined
    }
    editStart = Math.min(editStart, edit.start)
    editEnd = Math.max(editEnd, edit.end)
  }
  const delta = nextLength - retained.sourceLength
  let start = 0
  for (const point of retained.safePoints) {
    if (point <= editStart) {
      start = Math.max(start, point)
    }
  }
  let endPrevious = retained.sourceLength
  for (const point of retained.safePoints) {
    if (point > editEnd && point < endPrevious) {
      endPrevious = point
    }
  }
  if (start >= endPrevious) return undefined
  return Object.freeze({
    start,
    endPrevious,
    endNext: endPrevious + delta,
    delta
  })
}

/**
 * Whether the retained facts and the new bracket window satisfy every
 * version-one guard. The bracket window is inspected over the NEXT text.
 */
export function spliceGuardsHold(
  retained: RetainedIntrinsicFacts,
  bracket: IntrinsicSpliceBracket,
  nextText: string
): boolean {
  if (
    retained.hasCriticMarkupCandidate ||
    retained.rootCount !== 0 ||
    retained.markerDecisionCount !== 0 ||
    retained.referenceDefinitionCount !== 0 ||
    retained.markdownLiterals.length !== 0 ||
    retained.diagnostics.length !== 0
  ) {
    return false
  }
  const graph = retained.forkGraph
  if (graph.branches.length !== 0 || graph.lanes.length !== 1) {
    return false
  }
  const root = graph.lanes[0]
  if (root === undefined || root !== graph.root) {
    return false
  }
  if (!checkpointIsClean(root.entryCheckpoint)) {
    return false
  }
  for (const [index, transition] of root.transitions.entries()) {
    const trailingFinish =
      transition.operation === 'finish-lane' &&
      index === root.transitions.length - 1
    if (
      (transition.operation !== 'advance' && !trailingFinish) ||
      transition.emittedFacts.block.pendingLine !== undefined
    ) {
      return false
    }
  }
  // Version one splices only a bracket that runs to the end of the document
  // — the reopened exit state then comes from the mini-parse verbatim. An
  // interior bracket must also re-base the retained suffix's exit state,
  // which the next widening proves separately.
  if (bracket.endPrevious !== retained.sourceLength) {
    return false
  }
  if (!windowIsGuardClean(nextText, bracket.start, bracket.endNext)) {
    return false
  }
  // The mini-document must end at a real separation so its last block cannot
  // lazily continue into the suffix: a blank line before the bracket end, or
  // the bracket runs to the end of the document.
  if (bracket.endNext < nextText.length) {
    if (
      bracket.endNext < 2 ||
      nextText.charCodeAt(bracket.endNext - 1) !== 10 ||
      nextText.charCodeAt(bracket.endNext - 2) !== 10
    ) {
      return false
    }
  }
  // Splicing at a non-zero start requires the previous parse to agree that a
  // top-level block begins exactly there.
  if (bracket.start !== 0 && !retained.safePoints.includes(bracket.start)) {
    return false
  }
  return true
}

/**
 * Assemble the spliced facts for an end-of-document bracket: the retained
 * line facts before the bracket, the mini-parse's lines shifted into place,
 * one synthetic advance transition carrying them, and a tape spliced at the
 * bracket's run boundary. The lane's exit state is the mini-parse's exit,
 * shifted — the bracket reaches the end of the document, so the reopened
 * document ends exactly as the window did.
 */
export function spliceIntrinsicFacts(
  retained: RetainedIntrinsicFacts,
  bracket: IntrinsicSpliceBracket,
  mini: BracketPassFacts,
  nextLength: number
): SplicedIntrinsicFacts | undefined {
  if (
    mini.hasCriticMarkupCandidate ||
    mini.rootCount !== 0 ||
    mini.markerDecisionCount !== 0 ||
    mini.markdownLiterals.length !== 0 ||
    mini.diagnostics.length !== 0 ||
    mini.forkGraph.branches.length !== 0 ||
    mini.forkGraph.lanes.length !== 1
  ) {
    return undefined
  }
  const miniRoot = mini.forkGraph.lanes[0]
  const retainedRoot = retained.forkGraph.root
  if (miniRoot === undefined || miniRoot !== mini.forkGraph.root) {
    return undefined
  }
  const miniAdvances: IntrinsicProfile1LaneTransition[] = []
  let miniFinish: IntrinsicProfile1LaneTransition | undefined
  for (const [index, transition] of miniRoot.transitions.entries()) {
    if (
      transition.operation === 'finish-lane' &&
      index === miniRoot.transitions.length - 1
    ) {
      miniFinish = transition
      continue
    }
    if (
      transition.operation !== 'advance' ||
      transition.emittedFacts.block.pendingLine !== undefined
    ) {
      return undefined
    }
    miniAdvances.push(transition)
  }
  const miniLast = miniAdvances[miniAdvances.length - 1]
  if (miniLast === undefined) {
    return undefined
  }

  // Tape runs are ordered with ids as indices; the bracket start is a line
  // start, so a run crossing it refuses the splice.
  let prefixRunCount = 0
  while (
    prefixRunCount < retained.tape.length &&
    (retained.tape[prefixRunCount]?.range.end ?? Infinity) <= bracket.start
  ) {
    prefixRunCount += 1
  }
  const boundaryRun = retained.tape[prefixRunCount]
  if (boundaryRun !== undefined && boundaryRun.range.start < bracket.start) {
    return undefined
  }
  for (let index = 0; index < retained.tape.length; index += 1) {
    if (retained.tape[index]?.id !== index) return undefined
  }
  for (let index = 0; index < mini.tape.length; index += 1) {
    if (mini.tape[index]?.id !== index) return undefined
  }
  const shiftRun = (run: TapeRun, delta: number, id: number): TapeRun =>
    Object.freeze({
      id,
      role: run.role,
      range: spliceRange(run.range.start + delta, run.range.end + delta)
    })
  const tape: TapeRun[] = [
    ...retained.tape.slice(0, prefixRunCount).map(
      (run, index) => shiftRun(run, 0, index)
    ),
    ...mini.tape.map(
      (run, index) => shiftRun(run, bracket.start, prefixRunCount + index)
    )
  ]
  const lastRun = tape[tape.length - 1]
  if (lastRun === undefined || lastRun.range.end !== nextLength) {
    return undefined
  }

  // Line facts splice at the bracket's line start; a retained line crossing
  // it cannot exist because the bracket start is a safe point.
  const retainedLines = retainedRoot.transitions.flatMap(
    (transition) => transition.emittedFacts.lines
  )
  for (const line of retainedLines) {
    if (line.end > bracket.start && line.start < bracket.start) {
      return undefined
    }
  }

  // The prefix re-materializes as one advance transition PER SAFE SEGMENT,
  // not one monolith: downstream regionization derives reuse regions from
  // per-transition reconvergence, and a single spliced transition would
  // collapse the document into one region and defeat the fragment reuse
  // G31 proved. Segment boundaries are the retained safe points.
  const boundaries: number[] = [0]
  for (const point of retained.safePoints) {
    if (point > 0 && point < bracket.start) {
      boundaries.push(point)
    }
  }
  boundaries.push(bracket.start)

  const cleanCheckpointAt = (lineStart: number): MarkdownCheckpoint =>
    Object.freeze({
      ...retainedRoot.entryCheckpoint,
      lineStart,
      atVirtualBof: lineStart === 0
        ? retainedRoot.entryCheckpoint.atVirtualBof
        : false,
      frontMatterEligible: lineStart === 0
        ? retainedRoot.entryCheckpoint.frontMatterEligible
        : false
    })

  const runsWithin = (from: number, to: number): readonly TapeRun[] => {
    const runs = tape.filter(
      (run) => run.range.start >= from && run.range.end <= to
    )
    return runs
  }
  const segmentTransitions: IntrinsicProfile1LaneTransition[] = []
  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const from = boundaries[index]
    const to = boundaries[index + 1]
    if (from === undefined || to === undefined || from >= to) {
      continue
    }
    const segmentRuns = runsWithin(from, to)
    let covered = from
    for (const run of segmentRuns) {
      if (run.range.start !== covered) return undefined
      covered = run.range.end
    }
    if (covered !== to) return undefined
    const segmentLines = retainedLines.filter(
      (line) => line.start >= from && line.end <= to
    )
    segmentTransitions.push(Object.freeze({
      operation: 'advance',
      entryCheckpoint: cleanCheckpointAt(from),
      exitCheckpoint: cleanCheckpointAt(to),
      consumed: Object.freeze(segmentRuns.map((run) => Object.freeze({
        kind: 'source' as const,
        sourceRunId: run.id,
        range: run.range
      }))),
      emittedFacts: Object.freeze({
        literals: Object.freeze([]),
        lines: Object.freeze(segmentLines),
        block: Object.freeze({
          paragraphOpen: false,
          lineStart: to,
          containerPath: Object.freeze([]),
          activeProvider: undefined,
          pendingLine: undefined
        })
      })
    }))
  }

  const remapMini = (id: number): number => id + prefixRunCount
  const miniTransitions = [
    ...miniAdvances.map(
      (transition) => shiftTransition(transition, bracket.start, remapMini)
    ),
    ...(miniFinish === undefined
      ? []
      : [shiftTransition(miniFinish, bracket.start, remapMini)])
  ]
  const transitions: IntrinsicProfile1LaneTransition[] = [
    ...segmentTransitions,
    ...miniTransitions
  ]
  const first = transitions[0]
  const last = transitions[transitions.length - 1]
  if (first === undefined || last === undefined) {
    return undefined
  }
  const items: IntrinsicProfile1ForkLaneItem[] = tape.map(
    (run) => Object.freeze({
      kind: 'source' as const,
      sourceRunId: run.id,
      range: run.range
    })
  )
  const lane: IntrinsicProfile1ForkLane = Object.freeze({
    id: retainedRoot.id,
    owner: retainedRoot.owner,
    range: spliceRange(0, nextLength),
    entryCheckpoint: first.entryCheckpoint,
    exitCheckpoint: last.exitCheckpoint,
    transitions: Object.freeze(transitions),
    armBoundaries: Object.freeze([]),
    items: Object.freeze(items)
  })
  return Object.freeze({
    tape: Object.freeze(tape),
    diagnostics: Object.freeze([]),
    markdownLiterals: Object.freeze([]),
    forkGraph: Object.freeze({
      root: lane,
      lanes: Object.freeze([lane]),
      branches: Object.freeze([])
    })
  })
}
