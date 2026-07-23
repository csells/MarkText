import type {
  CriticMarkupForest,
  CriticMarkupNode,
  DiagnosticIndex,
  MarkupProjection,
  ProjectedMarkdown,
  SourceOffset,
  SourceOwner,
  SourceOwnershipIndex,
  SourceOwnershipRun,
  SourceRange
} from '../../revision.js'
import type {
  MarkdownContainerDepthFailure,
  MarkdownLiteralRange
} from './markdownLiterals.js'
import type {
  CanonicalMarkdownParseArtifact,
  CanonicalMarkdownParseBranch,
  CanonicalMarkdownParseLane,
  CanonicalMarkdownParseLaneOwner
} from './canonicalMarkdownArtifact.js'
import {
  markerCandidateFromRole,
  type CanonicalMarkerDecision,
  type MarkerRole,
  type TapeRun
} from './sourceTape.js'

interface OwnedSpan {
  readonly start: number
  readonly end: number
  readonly owner: SourceOwner
}

export interface Profile1SyntaxGraphCore {
  readonly source: string
  readonly canonicalTape: readonly TapeRun[]
  readonly markerDecisions: readonly CanonicalMarkerDecision[]
  readonly criticMarkup: CriticMarkupForest
  readonly criticMarkupEdges: readonly CriticMarkupTapeEdge[]
  readonly canonicalMarkdownParse: CanonicalMarkdownParseArtifact
  readonly canonicalMarkdown: CanonicalMarkdownGraph
  readonly ownership: SourceOwnershipIndex
  readonly markdownLiterals: readonly MarkdownLiteralRange[]
}

export type CanonicalMarkdownLaneOwner = CanonicalMarkdownParseLaneOwner

export interface CanonicalMarkdownSourceItem {
  readonly kind: 'source'
  readonly sourceRunId: number
  readonly range: SourceRange
}

export interface CanonicalMarkdownCriticBranch {
  readonly kind: 'critic-branch'
  readonly node: CriticMarkupNode
  readonly arms: readonly CanonicalMarkdownLane[]
  readonly parseArtifact: CanonicalMarkdownParseBranch
}

export type CanonicalMarkdownLaneItem =
  | CanonicalMarkdownSourceItem
  | CanonicalMarkdownCriticBranch

export interface CanonicalMarkdownLane {
  readonly id: number
  readonly owner: CanonicalMarkdownLaneOwner
  readonly range: SourceRange
  readonly items: readonly CanonicalMarkdownLaneItem[]
  readonly parseArtifact: CanonicalMarkdownParseLane
}

export interface CanonicalMarkdownGraph {
  readonly root: CanonicalMarkdownLane
  readonly lanes: readonly CanonicalMarkdownLane[]
  readonly branches: readonly CanonicalMarkdownCriticBranch[]
}

export interface CriticMarkupTapeEdge {
  readonly node: CriticMarkupNode
  readonly open: TapeRun
  readonly separator?: TapeRun
  readonly close: TapeRun
}

export type MappedProjectionSegment =
  | Readonly<{
    readonly kind: 'canonical'
    readonly projectedStart: number
    readonly projectedEnd: number
    readonly sourceRunId: number
    readonly sourceStart: number
  }>
  | Readonly<{
    readonly kind: 'generated'
    readonly projectedStart: number
    readonly projectedEnd: number
    readonly sourcePosition: number
    readonly affinity: 'previous' | 'next'
  }>

export interface Profile1ProjectedMarkdown extends ProjectedMarkdown {
  readonly mappedTape: readonly MappedProjectionSegment[]
  readonly markdownDepthFailure: MarkdownContainerDepthFailure | undefined
}

export interface Profile1SyntaxGraph extends Profile1SyntaxGraphCore {
  readonly kind: 'complete'
  readonly diagnostics: DiagnosticIndex
  readonly markup: MarkupProjection
  readonly original: Profile1ProjectedMarkdown
  readonly revised: Profile1ProjectedMarkdown
  readonly commentDisplays: readonly Profile1ProjectedMarkdown[]
  // The editing (Markup) view's block AST, computed lazily on first read so it
  // never runs during open() — only the editor's block layer forces it.
  readonly editing: () => Profile1ProjectedMarkdown
}

export interface Profile1SyntaxGraphProducts {
  readonly diagnostics: DiagnosticIndex
  readonly markup: MarkupProjection
  readonly original: Profile1ProjectedMarkdown
  readonly revised: Profile1ProjectedMarkdown
  readonly commentDisplays: readonly Profile1ProjectedMarkdown[]
  readonly editing: () => Profile1ProjectedMarkdown
}

function sourceOffset(value: number): SourceOffset {
  return value as SourceOffset
}

function sourceRange(start: number, end: number): SourceRange {
  return Object.freeze({ start: sourceOffset(start), end: sourceOffset(end) })
}

function collectMarkerSpans(edges: readonly CriticMarkupTapeEdge[]): readonly OwnedSpan[] {
  const spans: OwnedSpan[] = []
  for (const edge of edges) {
    const node = edge.node
    const appendMarker = (
      role: 'open' | 'separator' | 'close',
      run: TapeRun
    ): void => {
      spans.push(Object.freeze({
        start: run.range.start,
        end: run.range.end,
        owner: Object.freeze({
          kind: 'critic-marker',
          form: node.kind,
          role,
          nodeRange: node.range
        })
      }))
    }
    appendMarker('open', edge.open)
    if (edge.separator !== undefined) {
      appendMarker('separator', edge.separator)
    }
    appendMarker('close', edge.close)
  }
  spans.sort((left, right) => left.start - right.start || left.end - right.end)
  return Object.freeze(spans)
}

function collectTriviaSpans(tape: readonly TapeRun[]): readonly OwnedSpan[] {
  const spans: OwnedSpan[] = []
  for (const run of tape) {
    if (!run.role.startsWith('eol-')) {
      continue
    }
    spans.push(Object.freeze({
      start: run.range.start,
      end: run.range.end,
      owner: Object.freeze({
        kind: 'trivia',
        role: 'line-ending',
        spelling: run.role.slice('eol-'.length) as 'lf' | 'cr' | 'crlf'
      })
    }))
  }
  return Object.freeze(spans)
}

function collectLiteralSpans(
  source: string,
  literals: readonly MarkdownLiteralRange[]
): readonly OwnedSpan[] {
  const spans = literals
    .filter((literal) => literal.start < literal.end)
    .map((literal): OwnedSpan => {
      if (literal.start < 0 || literal.end > source.length) {
        throw new Error('Markdown literal ownership is outside canonical source')
      }
      const ownerRange = sourceRange(literal.start, literal.end)
      return Object.freeze({
        start: literal.start,
        end: literal.end,
        owner: Object.freeze({
          kind: 'markdown-literal',
          provider: literal.kind,
          ownerRange
        })
      })
    })
    .sort((left, right) => left.start - right.start || right.end - left.end)
  return Object.freeze(spans)
}

function containingSpan(
  spans: readonly OwnedSpan[],
  start: number,
  end: number
): OwnedSpan | undefined {
  let low = 0
  let high = spans.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if ((spans[middle]?.start ?? Number.POSITIVE_INFINITY) <= start) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  for (let index = low - 1; index >= 0; index -= 1) {
    const span = spans[index]
    if (span === undefined) {
      continue
    }
    if (span.end <= start) {
      break
    }
    if (span.start <= start && end <= span.end) {
      return span
    }
  }
  return undefined
}

function sameRange(left: SourceRange, right: SourceRange): boolean {
  return left.start === right.start && left.end === right.end
}

function sameOwner(left: SourceOwner, right: SourceOwner): boolean {
  if (left.kind !== right.kind) {
    return false
  }
  if (left.kind === 'markdown-text' && right.kind === 'markdown-text') {
    return true
  }
  if (left.kind === 'trivia' && right.kind === 'trivia') {
    return left.role === right.role && left.spelling === right.spelling
  }
  if (left.kind === 'markdown-literal' && right.kind === 'markdown-literal') {
    return left.provider === right.provider && sameRange(left.ownerRange, right.ownerRange)
  }
  if (left.kind === 'critic-marker' && right.kind === 'critic-marker') {
    return (
      left.form === right.form &&
      left.role === right.role &&
      sameRange(left.nodeRange, right.nodeRange)
    )
  }
  return false
}

function createOwnershipIndex(
  source: string,
  tape: readonly TapeRun[],
  edges: readonly CriticMarkupTapeEdge[],
  markdownLiterals: readonly MarkdownLiteralRange[]
): SourceOwnershipIndex {
  const markerSpans = collectMarkerSpans(edges)
  const eolSpans = collectTriviaSpans(tape)
  const literalSpans = collectLiteralSpans(source, markdownLiterals)
  const boundaries = new Set<number>([0, source.length])
  if (source.charCodeAt(0) === 0xfeff) {
    boundaries.add(1)
  }
  for (const spans of [markerSpans, eolSpans, literalSpans]) {
    for (const span of spans) {
      boundaries.add(span.start)
      boundaries.add(span.end)
    }
  }
  const orderedBoundaries = [...boundaries].sort((left, right) => left - right)
  const runs: SourceOwnershipRun[] = []
  for (let index = 0; index + 1 < orderedBoundaries.length; index += 1) {
    const start = orderedBoundaries[index]
    const end = orderedBoundaries[index + 1]
    if (start === undefined || end === undefined || start === end) {
      continue
    }
    const eol = containingSpan(eolSpans, start, end)
    const marker = containingSpan(markerSpans, start, end)
    const literal = containingSpan(literalSpans, start, end)
    const owner: SourceOwner =
      start === 0 && end <= 1 && source.charCodeAt(0) === 0xfeff
        ? Object.freeze({ kind: 'trivia', role: 'virtual-bom' })
        : eol?.owner ?? marker?.owner ?? literal?.owner ?? Object.freeze({ kind: 'markdown-text' })
    const previous = runs.at(-1)
    if (previous !== undefined && previous.range.end === start && sameOwner(previous.owner, owner)) {
      runs[runs.length - 1] = Object.freeze({
        range: sourceRange(previous.range.start, end),
        owner: previous.owner
      })
    } else {
      runs.push(Object.freeze({ range: sourceRange(start, end), owner }))
    }
  }

  let nextOffset = 0
  for (const run of runs) {
    if (run.range.start !== nextOffset || run.range.end <= run.range.start) {
      throw new Error('Profile 1 source ownership is not a gapless partition')
    }
    nextOffset = run.range.end
  }
  if (nextOffset !== source.length) {
    throw new Error('Profile 1 source ownership does not cover canonical source')
  }

  const frozenRuns = Object.freeze(runs)
  const at = Object.freeze((ordinal: number): SourceOwnershipRun => {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= frozenRuns.length) {
      throw new RangeError('Source ownership ordinal is outside the revision')
    }
    const run = frozenRuns[ordinal]
    if (run === undefined) {
      throw new Error('Source ownership index invariant failed')
    }
    return run
  })
  const ownerAt = Object.freeze((offset: number): SourceOwnershipRun => {
    if (!Number.isInteger(offset) || offset < 0 || offset >= source.length) {
      throw new RangeError('Source offset is outside the revision')
    }
    let low = 0
    let high = frozenRuns.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if ((frozenRuns[middle]?.range.end ?? Number.POSITIVE_INFINITY) <= offset) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    const run = frozenRuns[low]
    if (run === undefined || offset < run.range.start) {
      throw new Error('Source ownership index invariant failed')
    }
    return run
  })
  return Object.freeze({ count: frozenRuns.length, at, ownerAt })
}

function tapeRunForRange(
  tapeByRange: ReadonlyMap<string, TapeRun>,
  range: SourceRange,
  expectedRole: MarkerRole,
  node: CriticMarkupNode
): TapeRun {
  const run = tapeByRange.get(`${range.start}:${range.end}`)
  const marker = run === undefined ? undefined : markerCandidateFromRole(run.role)
  if (
    run === undefined ||
    marker === undefined ||
    marker.kind !== node.kind ||
    marker.role !== expectedRole
  ) {
    throw new Error('Accepted CriticMarkup marker lost its canonical tape identity')
  }
  return run
}

function createCriticMarkupEdges(
  tape: readonly TapeRun[],
  forest: CriticMarkupForest
): readonly CriticMarkupTapeEdge[] {
  const tapeByRange = new Map<string, TapeRun>()
  for (const run of tape) {
    tapeByRange.set(`${run.range.start}:${run.range.end}`, run)
  }
  const edges: CriticMarkupTapeEdge[] = []
  const pending = [...forest.roots].reverse()
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) {
      break
    }
    const open = tapeRunForRange(tapeByRange, node.markers.open, 'open', node)
    const close = tapeRunForRange(tapeByRange, node.markers.close, 'close', node)
    edges.push(
      node.kind === 'substitution'
        ? Object.freeze({
          node,
          open,
          separator: tapeRunForRange(
            tapeByRange,
            node.markers.separator,
            'separator',
            node
          ),
          close
        })
        : Object.freeze({ node, open, close })
    )
    for (let armIndex = node.arms.length - 1; armIndex >= 0; armIndex -= 1) {
      const arm = node.arms[armIndex]
      if (arm === undefined) {
        continue
      }
      for (let childIndex = arm.children.length - 1; childIndex >= 0; childIndex -= 1) {
        const child = arm.children[childIndex]
        if (child !== undefined) {
          pending.push(child)
        }
      }
    }
  }
  return Object.freeze(edges)
}

function createCanonicalMarkdownGraph(
  artifact: CanonicalMarkdownParseArtifact
): CanonicalMarkdownGraph {
  const lanes = artifact.lanes.map((parseArtifact): CanonicalMarkdownLane => ({
    id: parseArtifact.id,
    owner: parseArtifact.owner,
    range: parseArtifact.range,
    items: Object.freeze([]),
    parseArtifact
  }))
  const laneByArtifact = new Map(
    artifact.lanes.map((parseArtifact, index) => [parseArtifact, lanes[index]])
  )
  const branchByArtifact = new Map<
    CanonicalMarkdownParseBranch,
    CanonicalMarkdownCriticBranch
  >()
  const branches = artifact.branches.map((parseArtifact) => {
    const branch = Object.freeze({
      kind: 'critic-branch' as const,
      node: parseArtifact.node,
      arms: Object.freeze(parseArtifact.arms.map((arm) => {
        const lane = laneByArtifact.get(arm)
        if (lane === undefined) {
          throw new Error('Canonical Markdown parser artifact has a detached arm lane')
        }
        return lane
      })),
      parseArtifact
    })
    branchByArtifact.set(parseArtifact, branch)
    return branch
  })
  for (let laneIndex = 0; laneIndex < artifact.lanes.length; laneIndex += 1) {
    const parseLane = artifact.lanes[laneIndex]
    const lane = lanes[laneIndex]
    if (parseLane === undefined || lane === undefined) {
      throw new Error('Canonical Markdown parser artifact lane identity diverged')
    }
    const items = parseLane.items.map((item): CanonicalMarkdownLaneItem => {
      if (item.kind === 'source') {
        return item
      }
      const branch = branchByArtifact.get(item)
      if (branch === undefined) {
        throw new Error('Canonical Markdown parser artifact has a detached branch')
      }
      return branch
    })
    ;(lane as { items: readonly CanonicalMarkdownLaneItem[] }).items =
      Object.freeze(items)
  }
  for (let index = lanes.length - 1; index >= 0; index -= 1) {
    Object.freeze(lanes[index])
  }
  return Object.freeze({
    root: lanes[artifact.root.id] as CanonicalMarkdownLane,
    lanes: Object.freeze(lanes),
    branches: Object.freeze(branches)
  })
}

function validateProfile1SyntaxGraphCore(core: Profile1SyntaxGraphCore): void {
  if (
    core.canonicalMarkdown.root.parseArtifact !==
      core.canonicalMarkdownParse.root ||
    core.canonicalMarkdown.lanes.length !== core.canonicalMarkdownParse.lanes.length ||
    core.canonicalMarkdown.branches.length !==
      core.canonicalMarkdownParse.branches.length
  ) {
    throw new Error('Canonical Markdown graph diverged from its parser artifact')
  }
  if (core.canonicalMarkdown.lanes[0] !== core.canonicalMarkdown.root) {
    throw new Error('Canonical Markdown root lane identity diverged')
  }
  const edgeNodes = new Set(core.criticMarkupEdges.map((edge) => edge.node))
  const branchNodes = new Set(
    core.canonicalMarkdown.branches.map((branch) => branch.node)
  )
  if (
    edgeNodes.size !== core.criticMarkupEdges.length ||
    branchNodes.size !== core.canonicalMarkdown.branches.length ||
    edgeNodes.size !== branchNodes.size
  ) {
    throw new Error(
      'CriticMarkup graph identities diverged from the canonical Markdown parser artifact'
    )
  }
  for (const node of edgeNodes) {
    if (!branchNodes.has(node)) {
      throw new Error('CriticMarkup node is missing its canonical Markdown branch')
    }
  }
  for (const decision of core.markerDecisions) {
    const run = core.canonicalTape[decision.runId]
    if (
      run === undefined ||
      run.range.start !== decision.range.start ||
      run.range.end !== decision.range.end
    ) {
      throw new Error('Marker decision is detached from its canonical tape run')
    }
  }
  for (let ordinal = 0; ordinal < core.canonicalMarkdown.lanes.length; ordinal += 1) {
    const lane = core.canonicalMarkdown.lanes[ordinal]
    if (
      lane === undefined ||
      lane.id !== ordinal ||
      lane.parseArtifact !== core.canonicalMarkdownParse.lanes[ordinal]
    ) {
      throw new Error('Canonical Markdown lane identity is unstable')
    }
    let cursor = lane.range.start
    for (const item of lane.items) {
      if (item.kind === 'source') {
        const run = core.canonicalTape[item.sourceRunId]
        if (
          run === undefined ||
          item.range.start !== cursor ||
          item.range.start < run.range.start ||
          item.range.end > run.range.end
        ) {
          throw new Error('Canonical Markdown source slice is detached from its tape run')
        }
        cursor = item.range.end
        continue
      }
      if (
        item.node.range.start !== cursor ||
        item.arms.length !== item.node.arms.length
      ) {
        throw new Error('Canonical Markdown CM branch does not partition its lane')
      }
      for (let armIndex = 0; armIndex < item.arms.length; armIndex += 1) {
        const armLane = item.arms[armIndex]
        const arm = item.node.arms[armIndex]
        const boundaries = armLane?.parseArtifact.armBoundaries ?? []
        if (
          armLane === undefined ||
          arm === undefined ||
          armLane.range.start !== arm.range.start ||
          armLane.range.end !== arm.range.end ||
          armLane.owner.kind !== 'critic-arm' ||
          armLane.owner.node !== item.node ||
          armLane.owner.arm !== arm.name
        ) {
          throw new Error('Canonical Markdown arm lane is detached from its CM arm')
        }
        if (
          item.node.kind === 'substitution'
            ? boundaries.length !== 2 ||
              boundaries[0]?.role !== 'enter' ||
              boundaries[0].sourcePosition !== arm.range.start ||
              boundaries[1]?.role !== 'exit' ||
              boundaries[1].sourcePosition !== arm.range.end
            : boundaries.length !== 0
        ) {
          throw new Error(
            'Canonical Markdown arm boundary events diverged from parser topology'
          )
        }
      }
      cursor = item.node.range.end
    }
    if (cursor !== lane.range.end) {
      throw new Error('Canonical Markdown lane is not a gapless branching partition')
    }
  }
}

function validateMappedProjection(
  core: Profile1SyntaxGraphCore,
  projection: Profile1ProjectedMarkdown
): void {
  if (
    projection.markdown.source !== projection.source ||
    projection.markdown.root.range.start !== 0 ||
    projection.markdown.root.range.end !== projection.source.length
  ) {
    throw new Error('Projected Markdown CST is detached from its mapped source')
  }
  let projectedCursor = 0
  for (const segment of projection.mappedTape) {
    if (
      segment.projectedStart !== projectedCursor ||
      segment.projectedEnd <= segment.projectedStart
    ) {
      throw new Error('Mapped projection tape is not a gapless partition')
    }
    if (segment.kind === 'canonical') {
      const run = core.canonicalTape[segment.sourceRunId]
      const length = segment.projectedEnd - segment.projectedStart
      if (
        run === undefined ||
        segment.sourceStart < run.range.start ||
        segment.sourceStart + length > run.range.end ||
        projection.source.slice(segment.projectedStart, segment.projectedEnd) !==
          core.source.slice(segment.sourceStart, segment.sourceStart + length)
      ) {
        throw new Error('Mapped projection slice is detached from canonical tape identity')
      }
    } else if (
      segment.sourcePosition < 0 ||
      segment.sourcePosition > core.source.length
    ) {
      throw new Error('Generated projection slice has invalid canonical affinity')
    }
    projectedCursor = segment.projectedEnd
  }
  if (projectedCursor !== projection.source.length) {
    throw new Error('Mapped projection tape does not cover projected source')
  }
}

export function createProfile1SyntaxGraphCore(
  source: string,
  criticMarkup: CriticMarkupForest,
  markdownLiterals: readonly MarkdownLiteralRange[],
  canonicalTape: readonly TapeRun[],
  markerDecisions: readonly CanonicalMarkerDecision[],
  canonicalMarkdownParse: CanonicalMarkdownParseArtifact
): Profile1SyntaxGraphCore {
  const stableLiterals = Object.freeze([...markdownLiterals])
  const stableTape = Object.freeze([...canonicalTape])
  const criticMarkupEdges = createCriticMarkupEdges(stableTape, criticMarkup)
  const canonicalMarkdown = createCanonicalMarkdownGraph(canonicalMarkdownParse)
  const core = Object.freeze({
    source,
    canonicalTape: stableTape,
    markerDecisions: Object.freeze([...markerDecisions]),
    criticMarkup,
    criticMarkupEdges,
    canonicalMarkdownParse,
    canonicalMarkdown,
    ownership: createOwnershipIndex(
      source,
      stableTape,
      criticMarkupEdges,
      stableLiterals
    ),
    markdownLiterals: stableLiterals
  })
  validateProfile1SyntaxGraphCore(core)
  return core
}

export function finalizeProfile1SyntaxGraph(
  core: Profile1SyntaxGraphCore,
  products: Profile1SyntaxGraphProducts
): Profile1SyntaxGraph {
  validateMappedProjection(core, products.original)
  validateMappedProjection(core, products.revised)
  for (const commentDisplay of products.commentDisplays) {
    validateMappedProjection(core, commentDisplay)
  }
  return Object.freeze({
    kind: 'complete',
    source: core.source,
    canonicalTape: core.canonicalTape,
    markerDecisions: core.markerDecisions,
    criticMarkup: core.criticMarkup,
    criticMarkupEdges: core.criticMarkupEdges,
    canonicalMarkdownParse: core.canonicalMarkdownParse,
    canonicalMarkdown: core.canonicalMarkdown,
    diagnostics: products.diagnostics,
    ownership: core.ownership,
    markup: products.markup,
    original: products.original,
    revised: products.revised,
    commentDisplays: Object.freeze([...products.commentDisplays]),
    editing: products.editing,
    markdownLiterals: core.markdownLiterals
  })
}
