import type {
  IntrinsicProfile1ForkGraph,
  IntrinsicProfile1ForkLane,
  IntrinsicProfile1ForkLaneItem,
  IntrinsicProfile1LaneTransition,
  IntrinsicProfile1SourceSlice
} from './intrinsicProfile1ForkGraph.js'
import {
  shiftMarkdownCheckpoint,
  type MarkdownCheckpoint,
  type PlainMarkdownContainer,
  type PlainMarkdownLine,
  type PlainMarkdownListMarker
} from './markdownLaneState.js'
import type { MarkdownLiteralRange } from './markdownTypes.js'
import type {
  CanonicalMarkerDecision,
  TapeRun
} from './sourceTape.js'
import type {
  CriticMarkupNode,
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
  readonly roots: readonly CriticMarkupNode[]
  readonly markerDecisions: readonly CanonicalMarkerDecision[]
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
  readonly hasCriticMarkupCandidate: boolean
  readonly tape: readonly TapeRun[]
  readonly diagnostics: readonly SyntaxDiagnostic[]
  readonly markdownLiterals: readonly MarkdownLiteralRange[]
  readonly forkGraph: IntrinsicProfile1ForkGraph
  readonly roots: readonly CriticMarkupNode[]
  readonly markerDecisions: readonly CanonicalMarkerDecision[]
}

/**
 * Characters whose appearance anywhere in the bracket window could spell a
 * construct the splice refuses to reason about: CriticMarkup candidates and
 * reference machinery. Code spans, fences, and HTML are admitted — the
 * mini-parse recognizes them, and the assembly refuses any window construct
 * that fails to terminate before the window's end.
 */
const GUARDED_WINDOW_UNITS = new Set(
  ['{', '['].map((unit) => unit.charCodeAt(0))
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
    entryCheckpoint: shiftMarkdownCheckpoint(transition.entryCheckpoint, delta),
    exitCheckpoint: shiftMarkdownCheckpoint(transition.exitCheckpoint, delta),
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
        lineStart: transition.emittedFacts.block.lineStart + delta,
        ...(transition.emittedFacts.block.pendingLine === undefined
          ? {}
          : {
            pendingLine: Object.freeze({
              ...transition.emittedFacts.block.pendingLine,
              listContinuationIndentations: Object.freeze(
                transition.emittedFacts.block.pendingLine
                  .listContinuationIndentations.map((fact) => Object.freeze({
                    ...fact,
                    trivia: Object.freeze({
                      start: fact.trivia.start + delta,
                      end: fact.trivia.end + delta
                    }),
                    exitTrivia: Object.freeze({
                      start: fact.exitTrivia.start + delta,
                      end: fact.exitTrivia.end + delta
                    })
                  }))
              )
            })
          })
      })
    })
  })
}

function transitionExtent(
  transition: IntrinsicProfile1LaneTransition
): Readonly<{ start: number; end: number }> {
  let start = transition.entryCheckpoint.lineStart
  let end = transition.exitCheckpoint.lineStart
  for (const slice of transition.consumed) {
    start = Math.min(start, slice.range.start)
    end = Math.max(end, slice.range.end)
  }
  return Object.freeze({ start, end })
}

function shiftDecision(
  decision: CanonicalMarkerDecision,
  delta: number,
  remapRunId: (id: number) => number
): CanonicalMarkerDecision {
  const range = spliceRange(
    decision.range.start + delta,
    decision.range.end + delta
  )
  if (decision.role === 'open') {
    return Object.freeze({
      ...decision,
      range,
      runId: remapRunId(decision.runId),
      parentOpenRunId: decision.parentOpenRunId === null
        ? null
        : remapRunId(decision.parentOpenRunId)
    })
  }
  if (decision.role === 'separator') {
    return Object.freeze({
      ...decision,
      range,
      runId: remapRunId(decision.runId),
      openerRunId: remapRunId(decision.openerRunId)
    })
  }
  return Object.freeze({
    ...decision,
    range,
    runId: remapRunId(decision.runId),
    ...(decision.openerRunId === undefined
      ? {}
      : { openerRunId: remapRunId(decision.openerRunId) }),
    ...(decision.topOpenRunId === undefined
      ? {}
      : { topOpenRunId: remapRunId(decision.topOpenRunId) })
  })
}

/** Pair every retained node with its replayed twin, depth first. */
function zipForest(
  olds: readonly CriticMarkupNode[],
  news: readonly CriticMarkupNode[],
  map: Map<CriticMarkupNode, CriticMarkupNode>
): void {
  for (const [index, old] of olds.entries()) {
    const twin = news[index]
    if (twin === undefined) {
      throw new Error('Replayed forest lost a node')
    }
    map.set(old, twin)
    for (const [armIndex, arm] of old.arms.entries()) {
      const twinArm = twin.arms[armIndex]
      if (twinArm === undefined) {
        throw new Error('Replayed forest lost an arm')
      }
      zipForest(arm.children, twinArm.children, map)
    }
  }
}

function shiftForkLane(
  lane: IntrinsicProfile1ForkLane,
  delta: number,
  remapRunId: (id: number) => number,
  twins: ReadonlyMap<CriticMarkupNode, CriticMarkupNode>,
  allocateLaneId: () => number
): IntrinsicProfile1ForkLane {
  const owner = lane.owner.kind === 'document'
    ? lane.owner
    : Object.freeze({
      kind: 'critic-arm' as const,
      node: twins.get(lane.owner.node) ?? lane.owner.node,
      arm: lane.owner.arm
    })
  const id = allocateLaneId()
  return Object.freeze({
    id,
    owner,
    range: spliceRange(lane.range.start + delta, lane.range.end + delta),
    entryCheckpoint: shiftMarkdownCheckpoint(lane.entryCheckpoint, delta),
    exitCheckpoint: shiftMarkdownCheckpoint(lane.exitCheckpoint, delta),
    transitions: Object.freeze(lane.transitions.map(
      (transition) => shiftTransition(transition, delta, remapRunId)
    )),
    armBoundaries: Object.freeze(lane.armBoundaries.map((event) =>
      Object.freeze({
        ...event,
        sourcePosition: spliceOffset(event.sourcePosition + delta)
      })
    )),
    items: Object.freeze(lane.items.map((item) =>
      'kind' in item && item.kind === 'critic-branch'
        ? shiftForkBranch(item, delta, remapRunId, twins, allocateLaneId)
        : shiftSlice(item, delta, remapRunId)
    ))
  })
}

function shiftForkBranch(
  branch: Readonly<{
    kind: 'critic-branch'
    node: CriticMarkupNode
    arms: readonly IntrinsicProfile1ForkLane[]
  }>,
  delta: number,
  remapRunId: (id: number) => number,
  twins: ReadonlyMap<CriticMarkupNode, CriticMarkupNode>,
  allocateLaneId: () => number
): Readonly<{
  kind: 'critic-branch'
  node: CriticMarkupNode
  arms: readonly IntrinsicProfile1ForkLane[]
}> {
  return Object.freeze({
    kind: 'critic-branch' as const,
    node: twins.get(branch.node) ?? branch.node,
    arms: Object.freeze(branch.arms.map(
      (arm) => shiftForkLane(arm, delta, remapRunId, twins, allocateLaneId)
    ))
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
    retained.referenceDefinitionCount !== 0 ||
    retained.diagnostics.length !== 0
  ) {
    return false
  }
  // Marker-bearing documents splice when every node and branch sits fully
  // inside the prefix or the suffix; one crossing the bracket re-parses.
  for (const root of retained.roots) {
    const insidePrefix = root.range.end <= bracket.start
    const insideSuffix = root.range.start >= bracket.endPrevious
    if (!insidePrefix && !insideSuffix) {
      return false
    }
  }
  for (const branch of retained.forkGraph.branches) {
    const range = branch.node.range
    if (range.end > bracket.start && range.start < bracket.endPrevious) {
      return false
    }
  }
  // A retained literal is carried whole into its segment; one that crosses
  // the bracket would need its construct re-derived and refuses the splice.
  for (const literal of retained.markdownLiterals) {
    const insidePrefix = literal.end <= bracket.start
    const insideBracket =
      literal.start >= bracket.start && literal.end <= bracket.endPrevious
    const insideSuffix = literal.start >= bracket.endPrevious
    if (!insidePrefix && !insideBracket && !insideSuffix) {
      return false
    }
  }
  const graph = retained.forkGraph
  const root = graph.lanes[0]
  if (root === undefined || root !== graph.root) {
    return false
  }
  if (!checkpointIsClean(root.entryCheckpoint)) {
    return false
  }
  for (const transition of root.transitions) {
    if (
      transition.operation === 'malformed-recovery' ||
      transition.operation === 'unterminated-recovery'
    ) {
      return false
    }
    // A transition may cross ONE bracket boundary — the assembly clips it
    // at the safe point — but never span the whole bracket. Extents come
    // from the consumed slices: a line-start pair understates a transition
    // that consumes past its final line start.
    const extent = transitionExtent(transition)
    if (extent.start < bracket.start && extent.end > bracket.endPrevious) {
      return false
    }
  }
  if (!windowIsGuardClean(nextText, bracket.start, bracket.endNext)) {
    return false
  }
  // The mini-document must end at a real separation so its last block cannot
  // lazily continue into the suffix: a blank line before the bracket end —
  // LF or CRLF spelled — or the bracket runs to the end of the document.
  if (bracket.endNext < nextText.length) {
    const lastIsNewline =
      bracket.endNext >= 1 &&
      nextText.charCodeAt(bracket.endNext - 1) === 10
    const blankByLf =
      bracket.endNext >= 2 &&
      nextText.charCodeAt(bracket.endNext - 2) === 10
    const blankByCrlf =
      bracket.endNext >= 3 &&
      nextText.charCodeAt(bracket.endNext - 2) === 13 &&
      nextText.charCodeAt(bracket.endNext - 3) === 10
    if (!lastIsNewline || (!blankByLf && !blankByCrlf)) {
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
  nextLength: number,
  replayForest: (
    roots: readonly CriticMarkupNode[],
    shiftOffset: (offset: number) => number
  ) => readonly CriticMarkupNode[]
): SplicedIntrinsicFacts | undefined {
  if (
    mini.hasCriticMarkupCandidate ||
    mini.rootCount !== 0 ||
    mini.markerDecisionCount !== 0 ||
    mini.diagnostics.length !== 0 ||
    mini.forkGraph.branches.length !== 0 ||
    mini.forkGraph.lanes.length !== 1
  ) {
    return undefined
  }
  const windowLength = bracket.endNext - bracket.start
  for (const literal of mini.markdownLiterals) {
    // A literal reaching the window's end may be an unterminated fence or
    // HTML block that would swallow the suffix; only the full pass decides
    // it. A definition re-keys link resolution document-wide.
    if (literal.end >= windowLength || literal.kind === 'definition') {
      return undefined
    }
  }
  const miniRoot = mini.forkGraph.lanes[0]
  const retainedRoot = retained.forkGraph.root
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
  if (miniRoot === undefined || miniRoot !== mini.forkGraph.root) {
    {
    return undefined
  }
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
    if (transition.operation !== 'advance') {
      return undefined
    }
    miniAdvances.push(transition)
  }
  const miniLast = miniAdvances[miniAdvances.length - 1]
  if (miniLast === undefined) {
    {
    return undefined
  }
  }

  // Tape runs are ordered with ids as indices. A text run may span a
  // bracket boundary — runs break at markers, not lines — and splits there;
  // any other role crossing a boundary refuses the splice. Old-to-new id
  // maps replace arithmetic remaps because a split shifts every later id.
  for (let index = 0; index < retained.tape.length; index += 1) {
    if (retained.tape[index]?.id !== index) {
      return undefined
    }
  }
  for (let index = 0; index < mini.tape.length; index += 1) {
    if (mini.tape[index]?.id !== index) {
      return undefined
    }
  }
  const prefixRemapById = new Map<number, number>()
  const suffixRemapById = new Map<number, number>()
  let miniIdBase = 0
  const tape: TapeRun[] = []
  const pushRun = (role: TapeRun['role'], start: number, end: number): number => {
    const id = tape.length
    tape.push(Object.freeze({ id, role, range: spliceRange(start, end) }))
    return id
  }
  for (const run of retained.tape) {
    if (run.range.end <= bracket.start) {
      prefixRemapById.set(run.id, pushRun(run.role, run.range.start, run.range.end))
    } else if (run.range.start < bracket.start) {
      if (run.role !== 'text') return undefined
      prefixRemapById.set(run.id, pushRun('text', run.range.start, bracket.start))
    }
  }
  miniIdBase = tape.length
  for (const run of mini.tape) {
    pushRun(run.role, run.range.start + bracket.start, run.range.end + bracket.start)
  }
  for (const run of retained.tape) {
    if (run.range.start >= bracket.endPrevious) {
      suffixRemapById.set(
        run.id,
        pushRun(run.role, run.range.start + bracket.delta, run.range.end + bracket.delta)
      )
    } else if (run.range.end > bracket.endPrevious) {
      if (run.role !== 'text') return undefined
      suffixRemapById.set(
        run.id,
        pushRun('text', bracket.endNext, run.range.end + bracket.delta)
      )
    }
  }
  const remapPrefix = (id: number): number => {
    const mapped = prefixRemapById.get(id)
    if (mapped === undefined) {
      throw new Error('A prefix slice references a discarded tape run')
    }
    return mapped
  }
  const remapMini = (id: number): number => id + miniIdBase
  const remapSuffix = (id: number): number => {
    const mapped = suffixRemapById.get(id)
    if (mapped === undefined) {
      throw new Error('A suffix slice references a discarded tape run')
    }
    return mapped
  }
  const lastRun = tape[tape.length - 1]
  if (lastRun === undefined || lastRun.range.end !== nextLength) {
    {
    return undefined
  }
  }


  // ---- Marker-bearing route: preserve the retained transition structure ----
  if (retained.roots.length > 0 || retained.forkGraph.branches.length > 0) {
    const prefixRoots = retained.roots.filter(
      (node) => node.range.end <= bracket.start
    )
    const suffixRoots = retained.roots.filter(
      (node) => node.range.start >= bracket.endPrevious
    )
    // A transition crossing INTO the bracket clips at the bracket start: its
    // retained stretch keeps the original entry state, exits clean at the
    // safe point, and carries only the facts on its side. The mirror clips a
    // transition crossing OUT of the bracket at the bracket end. Clipping is
    // sound exactly because the bracket boundaries are safe points — the
    // true lane state there is clean by construction.
    const clipTransition = (
      transition: IntrinsicProfile1LaneTransition,
      keep: 'prefix' | 'suffix'
    ): IntrinsicProfile1LaneTransition => {
      const boundaryOld = keep === 'prefix' ? bracket.start : bracket.endPrevious
      const delta = keep === 'prefix' ? 0 : bracket.delta
      const remap = keep === 'prefix' ? remapPrefix : remapSuffix
      const keptSlices: IntrinsicProfile1SourceSlice[] = []
      for (const slice of transition.consumed) {
        const inside = keep === 'prefix'
          ? slice.range.start < boundaryOld
          : slice.range.end > boundaryOld
        if (!inside) continue
        const clippedStart = keep === 'prefix'
          ? slice.range.start
          : Math.max(slice.range.start, boundaryOld)
        const clippedEnd = keep === 'prefix'
          ? Math.min(slice.range.end, boundaryOld)
          : slice.range.end
        keptSlices.push(Object.freeze({
          kind: 'source' as const,
          sourceRunId: remap(slice.sourceRunId),
          range: spliceRange(clippedStart + delta, clippedEnd + delta)
        }))
      }
      const keptLines = transition.emittedFacts.lines
        .filter((line) => keep === 'prefix'
          ? line.end <= boundaryOld
          : line.start >= boundaryOld)
        .map((line) => shiftLine(line, delta))
      const keptLiterals = transition.emittedFacts.literals
        .filter((literal) => keep === 'prefix'
          ? literal.end <= boundaryOld
          : literal.start >= boundaryOld)
        .map((literal) => shiftLiteral(literal, delta))
      const boundaryNew = keep === 'prefix' ? bracket.start : bracket.endNext
      return Object.freeze({
        operation: 'advance',
        entryCheckpoint: keep === 'prefix'
          ? shiftMarkdownCheckpoint(transition.entryCheckpoint, delta)
          : cleanCheckpointAt(boundaryNew),
        exitCheckpoint: keep === 'prefix'
          ? cleanCheckpointAt(boundaryNew)
          : shiftMarkdownCheckpoint(transition.exitCheckpoint, delta),
        consumed: Object.freeze(keptSlices),
        emittedFacts: Object.freeze({
          literals: Object.freeze(keptLiterals),
          lines: Object.freeze(keptLines),
          block: keep === 'prefix'
            ? Object.freeze({
              paragraphOpen: false,
              lineStart: boundaryNew,
              containerPath: Object.freeze([]),
              activeProvider: undefined,
              pendingLine: undefined
            })
            : Object.freeze({
              ...transition.emittedFacts.block,
              lineStart: transition.emittedFacts.block.lineStart + delta
            })
        })
      })
    }
    const prefixTransitions: IntrinsicProfile1LaneTransition[] = []
    const suffixSideTransitions: IntrinsicProfile1LaneTransition[] = []
    for (const transition of retainedRoot.transitions) {
      const extent = transitionExtent(transition)
      if (extent.end <= bracket.start) {
        prefixTransitions.push(shiftTransition(transition, 0, remapPrefix))
      } else if (extent.start >= bracket.endPrevious) {
        suffixSideTransitions.push(
          shiftTransition(transition, bracket.delta, remapSuffix)
        )
      } else if (extent.start < bracket.start) {
        prefixTransitions.push(clipTransition(transition, 'prefix'))
      } else if (extent.end > bracket.endPrevious) {
        suffixSideTransitions.push(clipTransition(transition, 'suffix'))
      }
      // A transition fully inside the bracket is the mini-parse's business.
    }
    const miniAdvanceTransitions = miniAdvances.map(
      (transition) => shiftTransition(transition, bracket.start, remapMini)
    )
    const interiorBracket = bracket.endPrevious < retained.sourceLength
    const markerTransitions: IntrinsicProfile1LaneTransition[] = [
      ...prefixTransitions,
      ...miniAdvanceTransitions,
      ...suffixSideTransitions,
      ...(interiorBracket || miniFinish === undefined
        ? []
        : [shiftTransition(miniFinish, bracket.start, remapMini)])
    ]
    const markerFirst = markerTransitions[0]
    const markerLast = markerTransitions[markerTransitions.length - 1]
    if (markerFirst === undefined || markerLast === undefined) {
      return undefined
    }

    // Every bail point is behind us: replaying into the caller's registry is
    // now safe — a fallback after this would leave phantom emissions for the
    // full pass's first attempt.
    const replayedPrefix = replayForest(prefixRoots, (offset) => offset)
    const replayedSuffix = replayForest(
      suffixRoots,
      (offset) => offset + bracket.delta
    )
    const twins = new Map<CriticMarkupNode, CriticMarkupNode>()
    zipForest(prefixRoots, replayedPrefix, twins)
    zipForest(suffixRoots, replayedSuffix, twins)

    // Root items carry only top-level branches; nested ones live inside arm
    // lanes and shift recursively with their parent. The graph's flat branch
    // list re-collects from the shifted tree afterwards.
    const topLevelBranches = retainedRoot.items.filter(
      (item): item is Readonly<{
        kind: 'critic-branch'
        node: CriticMarkupNode
        arms: readonly IntrinsicProfile1ForkLane[]
      }> => 'kind' in item && item.kind === 'critic-branch'
    )
    // Lane ids are ordinals of the final lanes list: the root takes 0 and
    // every arm lane numbers sequentially in traversal order — the same
    // order the lane collector walks — so allocation happens during the
    // shift itself and object identity is shared between the lanes list and
    // the branches that carry them.
    let nextLaneId = 1
    const allocateLaneId = (): number => {
      const id = nextLaneId
      nextLaneId += 1
      return id
    }
    const shiftedBranches = [...topLevelBranches]
      .sort((left, right) => left.node.range.start - right.node.range.start)
      .map((branch) =>
        branch.node.range.end <= bracket.start
          ? shiftForkBranch(branch, 0, remapPrefix, twins, allocateLaneId)
          : shiftForkBranch(
            branch,
            bracket.delta,
            remapSuffix,
            twins,
            allocateLaneId
          )
      )
    const collectBranchesDeep = (
      branches: readonly Readonly<{
        kind: 'critic-branch'
        node: CriticMarkupNode
        arms: readonly IntrinsicProfile1ForkLane[]
      }>[]
    ): typeof branches => branches.flatMap((branch) => [
      branch,
      ...branch.arms.flatMap((arm) => collectBranchesDeep(
        arm.items.filter(
          (item): item is (typeof branches)[number] =>
            'kind' in item && item.kind === 'critic-branch'
        )
      ))
    ])
    const collectArmLanes = (
      branches: readonly Readonly<{
        kind: 'critic-branch'
        node: CriticMarkupNode
        arms: readonly IntrinsicProfile1ForkLane[]
      }>[]
    ): IntrinsicProfile1ForkLane[] => branches.flatMap((branch) => [
      ...branch.arms,
      ...branch.arms.flatMap((arm) => collectArmLanes(
        arm.items.filter(
          (item): item is typeof branch =>
            'kind' in item && item.kind === 'critic-branch'
        )
      ))
    ])

    // Root items rebuild canonically from the spliced tape: slice items for
    // every run outside a branch, branch items at their node positions —
    // cursor-contiguous exactly as the graph-core validator demands.
    const orderedBranches = shiftedBranches
    const markerItems: IntrinsicProfile1ForkLaneItem[] = []
    {
      let runIndex = 0
      for (const branch of orderedBranches) {
        while (
          runIndex < tape.length &&
          (tape[runIndex]?.range.end ?? Infinity) <= branch.node.range.start
        ) {
          const run = tape[runIndex]
          if (run === undefined) break
          markerItems.push(Object.freeze({
            kind: 'source' as const,
            sourceRunId: run.id,
            range: run.range
          }))
          runIndex += 1
        }
        markerItems.push(branch)
        while (
          runIndex < tape.length &&
          (tape[runIndex]?.range.start ?? Infinity) < branch.node.range.end
        ) {
          runIndex += 1
        }
      }
      while (runIndex < tape.length) {
        const run = tape[runIndex]
        if (run === undefined) break
        markerItems.push(Object.freeze({
          kind: 'source' as const,
          sourceRunId: run.id,
          range: run.range
        }))
        runIndex += 1
      }
    }

    const markerLane: IntrinsicProfile1ForkLane = Object.freeze({
      id: 0,
      owner: retainedRoot.owner,
      range: spliceRange(0, nextLength),
      entryCheckpoint: markerFirst.entryCheckpoint,
      exitCheckpoint: markerLast.exitCheckpoint,
      transitions: Object.freeze(markerTransitions),
      armBoundaries: Object.freeze(retainedRoot.armBoundaries.map((event) =>
        Object.freeze({
          ...event,
          sourcePosition: spliceOffset(
            event.sourcePosition >= bracket.endPrevious
              ? event.sourcePosition + bracket.delta
              : event.sourcePosition
          )
        })
      )),
      items: Object.freeze(markerItems)
    })
    const markerDecisions = retained.markerDecisions.map((decision) =>
      decision.range.end <= bracket.start
        ? shiftDecision(decision, 0, remapPrefix)
        : shiftDecision(decision, bracket.delta, remapSuffix)
    )
    const markerLiterals: MarkdownLiteralRange[] = [
      ...retained.markdownLiterals
        .filter((literal) => literal.end <= bracket.start),
      ...mini.markdownLiterals
        .map((literal) => shiftLiteral(literal, bracket.start)),
      ...retained.markdownLiterals
        .filter((literal) => literal.start >= bracket.endPrevious)
        .map((literal) => shiftLiteral(literal, bracket.delta))
    ].sort((left, right) => left.start - right.start)
    return Object.freeze({
      hasCriticMarkupCandidate: true,
      tape: Object.freeze(tape),
      diagnostics: Object.freeze([]),
      markdownLiterals: Object.freeze(markerLiterals),
      forkGraph: Object.freeze({
        root: markerLane,
        lanes: Object.freeze([
          markerLane,
          ...collectArmLanes(shiftedBranches)
        ]),
        branches: Object.freeze(collectBranchesDeep(shiftedBranches))
      }),
      roots: Object.freeze([...replayedPrefix, ...replayedSuffix]),
      markerDecisions: Object.freeze(markerDecisions)
    })
  }

  // Line facts splice at the bracket's line start; a retained line crossing
  // it cannot exist because the bracket start is a safe point.
  const retainedLines = retainedRoot.transitions.flatMap(
    (transition) => transition.emittedFacts.lines
  )
  for (const line of retainedLines) {
    if (line.end > bracket.start && line.start < bracket.start) {
    {
    return undefined
  }
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
      if (run.range.start !== covered) {
    return undefined
  }
      covered = run.range.end
    }
    if (covered !== to) {
    return undefined
  }
    const segmentLines = retainedLines.filter(
      (line) => line.start >= from && line.end <= to
    )
    const segmentLiterals = retained.markdownLiterals.filter(
      (literal) => literal.start >= from && literal.end <= to
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
        literals: Object.freeze(segmentLiterals),
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

  // Suffix segments mirror the prefix synthesis in next coordinates. The
  // mini window's finish-lane is a window artifact for an interior bracket
  // and is replaced with a synthetic document-end finish after the suffix.
  const interior = bracket.endPrevious < retained.sourceLength
  const suffixBoundaries: number[] = [bracket.endNext]
  for (const point of retained.safePoints) {
    if (point > bracket.endPrevious && point < retained.sourceLength) {
      suffixBoundaries.push(point + bracket.delta)
    }
  }
  suffixBoundaries.push(nextLength)
  const suffixSegments: IntrinsicProfile1LaneTransition[] = []
  if (interior) {
    const shiftedSuffixLines = retainedLines
      .filter((line) => line.start >= bracket.endPrevious)
      .map((line) => shiftLine(line, bracket.delta))
    for (let index = 0; index + 1 < suffixBoundaries.length; index += 1) {
      const from = suffixBoundaries[index]
      const to = suffixBoundaries[index + 1]
      if (from === undefined || to === undefined || from >= to) {
        continue
      }
      const segmentRuns = runsWithin(from, to)
      let covered = from
      for (const run of segmentRuns) {
        if (run.range.start !== covered) {
    return undefined
  }
        covered = run.range.end
      }
      if (covered !== to) {
    return undefined
  }
      const segmentLines = shiftedSuffixLines.filter(
        (line) => line.start >= from && line.end <= to
      )
      const segmentLiterals = retained.markdownLiterals
        .filter(
          (literal) =>
            literal.start >= from - bracket.delta &&
            literal.end <= to - bracket.delta
        )
        .map((literal) => shiftLiteral(literal, bracket.delta))
      suffixSegments.push(Object.freeze({
        operation: 'advance',
        entryCheckpoint: cleanCheckpointAt(from),
        exitCheckpoint: cleanCheckpointAt(to),
        consumed: Object.freeze(segmentRuns.map((run) => Object.freeze({
          kind: 'source' as const,
          sourceRunId: run.id,
          range: run.range
        }))),
        emittedFacts: Object.freeze({
          literals: Object.freeze(segmentLiterals),
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
  }
  const syntheticFinish: IntrinsicProfile1LaneTransition = Object.freeze({
    operation: 'finish-lane',
    entryCheckpoint: cleanCheckpointAt(nextLength),
    exitCheckpoint: cleanCheckpointAt(nextLength),
    consumed: Object.freeze([]),
    emittedFacts: Object.freeze({
      literals: Object.freeze([]),
      lines: Object.freeze([]),
      block: Object.freeze({
        paragraphOpen: false,
        lineStart: nextLength,
        containerPath: Object.freeze([]),
        activeProvider: undefined,
        pendingLine: undefined
      })
    })
  })
  const miniTransitions = [
    ...miniAdvances.map(
      (transition) => shiftTransition(transition, bracket.start, remapMini)
    ),
    ...(interior
      ? []
      : miniFinish === undefined
        ? []
        : [shiftTransition(miniFinish, bracket.start, remapMini)])
  ]
  const transitions: IntrinsicProfile1LaneTransition[] = [
    ...segmentTransitions,
    ...miniTransitions,
    ...suffixSegments,
    ...(interior ? [syntheticFinish] : [])
  ]
  const first = transitions[0]
  const last = transitions[transitions.length - 1]
  if (first === undefined || last === undefined) {
    {
    return undefined
  }
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
  const splicedLiterals: MarkdownLiteralRange[] = [
    ...retained.markdownLiterals
      .filter((literal) => literal.end <= bracket.start),
    ...mini.markdownLiterals
      .map((literal) => shiftLiteral(literal, bracket.start)),
    ...retained.markdownLiterals
      .filter((literal) => literal.start >= bracket.endPrevious)
      .map((literal) => shiftLiteral(literal, bracket.delta))
  ].sort((left, right) => left.start - right.start)
  return Object.freeze({
    hasCriticMarkupCandidate: false,
    tape: Object.freeze(tape),
    diagnostics: Object.freeze([]),
    markdownLiterals: Object.freeze(splicedLiterals),
    forkGraph: Object.freeze({
      root: lane,
      lanes: Object.freeze([lane]),
      branches: Object.freeze([])
    }),
    roots: Object.freeze([]),
    markerDecisions: Object.freeze([])
  })
}
