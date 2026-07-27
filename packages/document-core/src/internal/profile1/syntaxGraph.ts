import type {
  CriticMarkupForest,
  CriticMarkupNode,
  DiagnosticIndex,
  MarkupProjection,
  NodeId,
  Profile1SyntaxGraph as PublicProfile1SyntaxGraph,
  ProjectedMarkdown,
  SourceOwnershipIndex,
  SourceRange
} from '../../revision.js'
import type {
  MarkdownContainerDepthFailure,
  MarkdownLiteralRange
} from './markdownLiterals.js'
import type {
  IntrinsicProfile1ForkGraph
} from './intrinsicProfile1ForkGraph.js'
import {
  markerCandidateFromRole,
  type CanonicalMarkerDecision,
  type MarkerRole,
  type TapeRun
} from './sourceTape.js'
import type {
  Profile1SyntaxIdentityRegistry
} from './syntaxIdentity.js'

export interface Profile1SyntaxGraphCore {
  readonly source: string
  readonly syntaxIdentity: Profile1SyntaxIdentityRegistry
  readonly canonicalTape: readonly TapeRun[]
  readonly markerDecisions: readonly CanonicalMarkerDecision[]
  readonly criticMarkup: CriticMarkupForest
  readonly criticMarkupEdges: readonly CriticMarkupTapeEdge[]
  readonly forkGraph: IntrinsicProfile1ForkGraph
  readonly ownership: SourceOwnershipIndex
  readonly markdownLiterals: readonly MarkdownLiteralRange[]
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
  readonly syntax: PublicProfile1SyntaxGraph
  readonly diagnostics: DiagnosticIndex
  readonly markup: MarkupProjection
  readonly original: Profile1ProjectedMarkdown
  readonly revised: Profile1ProjectedMarkdown
  readonly commentDisplays: () => readonly Profile1ProjectedMarkdown[]
  readonly commentDisplay: (comment: NodeId) => Profile1ProjectedMarkdown
  // The editing selection is admitted during open(); this accessor only
  // materializes the already-emitted selection on first read.
  readonly editing: () => Profile1ProjectedMarkdown
}

export interface Profile1SyntaxGraphProducts {
  readonly diagnostics: DiagnosticIndex
  readonly markup: MarkupProjection
  readonly original: Profile1ProjectedMarkdown
  readonly revised: Profile1ProjectedMarkdown
  readonly commentDisplays: () => readonly Profile1ProjectedMarkdown[]
  readonly commentDisplay: (comment: NodeId) => Profile1ProjectedMarkdown
  readonly editing: () => Profile1ProjectedMarkdown
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
  const pending: CriticMarkupNode[] = []
  for (let ordinal = forest.rootCount - 1; ordinal >= 0; ordinal -= 1) {
    pending.push(forest.rootAt(ordinal))
  }
  pending.reverse()
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

function validateProfile1SyntaxGraphCore(core: Profile1SyntaxGraphCore): void {
  if (core.forkGraph.lanes[0] !== core.forkGraph.root) {
    throw new Error('Intrinsic Profile 1 root lane identity diverged')
  }
  const edgeNodes = new Set(core.criticMarkupEdges.map((edge) => edge.node))
  const branchNodes = new Set(
    core.forkGraph.branches.map((branch) => branch.node)
  )
  if (
    edgeNodes.size !== core.criticMarkupEdges.length ||
    branchNodes.size !== core.forkGraph.branches.length ||
    edgeNodes.size !== branchNodes.size
  ) {
    throw new Error(
      'CriticMarkup graph identities diverged from the intrinsic Profile 1 fork parser graph'
    )
  }
  for (const node of edgeNodes) {
    if (!branchNodes.has(node)) {
      throw new Error('CriticMarkup node is missing its intrinsic Profile 1 fork branch')
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
  for (let ordinal = 0; ordinal < core.forkGraph.lanes.length; ordinal += 1) {
    const lane = core.forkGraph.lanes[ordinal]
    if (
      lane === undefined ||
      lane.id !== ordinal
    ) {
      throw new Error('Intrinsic Profile 1 fork lane identity is unstable')
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
          throw new Error('Intrinsic Profile 1 fork source slice is detached from its tape run')
        }
        cursor = item.range.end
        continue
      }
      if (
        item.node.range.start !== cursor ||
        item.arms.length !== item.node.arms.length
      ) {
        throw new Error('Intrinsic Profile 1 fork CM branch does not partition its lane')
      }
      for (let armIndex = 0; armIndex < item.arms.length; armIndex += 1) {
        const armLane = item.arms[armIndex]
        const arm = item.node.arms[armIndex]
        const boundaries = armLane?.armBoundaries ?? []
        if (
          armLane === undefined ||
          arm === undefined ||
          armLane.range.start !== arm.range.start ||
          armLane.range.end !== arm.range.end ||
          armLane.owner.kind !== 'critic-arm' ||
          armLane.owner.node !== item.node ||
          armLane.owner.arm !== arm.name
        ) {
          throw new Error('Intrinsic Profile 1 fork arm lane is detached from its CM arm')
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
            'Intrinsic Profile 1 fork arm boundary events diverged from parser topology'
          )
        }
      }
      cursor = item.node.range.end
    }
    if (cursor !== lane.range.end) {
      throw new Error('Intrinsic Profile 1 fork lane is not a gapless branching partition')
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
  syntaxIdentity: Profile1SyntaxIdentityRegistry,
  criticMarkup: CriticMarkupForest,
  markdownLiterals: readonly MarkdownLiteralRange[],
  canonicalTape: readonly TapeRun[],
  markerDecisions: readonly CanonicalMarkerDecision[],
  forkGraph: IntrinsicProfile1ForkGraph
): Profile1SyntaxGraphCore {
  const stableLiterals = Object.freeze([...markdownLiterals])
  const stableTape = Object.freeze([...canonicalTape])
  const criticMarkupEdges = createCriticMarkupEdges(stableTape, criticMarkup)
  const core = Object.freeze({
    source,
    syntaxIdentity,
    canonicalTape: stableTape,
    markerDecisions: Object.freeze([...markerDecisions]),
    criticMarkup,
    criticMarkupEdges,
    forkGraph,
    ownership: syntaxIdentity.finishOwnership(source),
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
  let commentDisplaysCache: readonly Profile1ProjectedMarkdown[] | undefined
  const commentDisplays = (): readonly Profile1ProjectedMarkdown[] => {
    if (commentDisplaysCache === undefined) {
      commentDisplaysCache = Object.freeze([...products.commentDisplays()])
      for (const commentDisplay of commentDisplaysCache) {
        validateMappedProjection(core, commentDisplay)
      }
    }
    return commentDisplaysCache
  }
  const commentDisplay = (comment: NodeId): Profile1ProjectedMarkdown => {
    const display = products.commentDisplay(comment)
    validateMappedProjection(core, display)
    return display
  }
  let syntaxCache: PublicProfile1SyntaxGraph | undefined
  const finishSyntax = (): PublicProfile1SyntaxGraph => {
    if (syntaxCache === undefined) {
      // Comment Markdown is admitted into the unified graph during open().
      // Touch the display collection before freezing its public enumeration.
      commentDisplays()
      syntaxCache = core.syntaxIdentity.finish()
    }
    return syntaxCache
  }
  const syntax: PublicProfile1SyntaxGraph = Object.freeze({
    root: core.syntaxIdentity.root,
    get nodeCount(): number {
      return finishSyntax().nodeCount
    },
    nodeAt: Object.freeze((ordinal: number) =>
      finishSyntax().nodeAt(ordinal)),
    get edgeCount(): number {
      return finishSyntax().edgeCount
    },
    edgeAt: Object.freeze((ordinal: number) =>
      finishSyntax().edgeAt(ordinal))
  })
  return Object.freeze({
    kind: 'complete',
    source: core.source,
    syntaxIdentity: core.syntaxIdentity,
    syntax,
    canonicalTape: core.canonicalTape,
    markerDecisions: core.markerDecisions,
    criticMarkup: core.criticMarkup,
    criticMarkupEdges: core.criticMarkupEdges,
    forkGraph: core.forkGraph,
    diagnostics: products.diagnostics,
    ownership: core.ownership,
    markup: products.markup,
    original: products.original,
    revised: products.revised,
    commentDisplays: Object.freeze(commentDisplays),
    commentDisplay: Object.freeze(commentDisplay),
    editing: products.editing,
    markdownLiterals: core.markdownLiterals
  })
}
