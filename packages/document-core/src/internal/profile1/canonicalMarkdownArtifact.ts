import type {
  CriticMarkupNode,
  SourceOffset,
  SourceRange
} from '../../revision.js'
import {
  inspectMarkdownPendingLineBlock,
  type MarkdownCheckpoint,
  type MarkdownPendingLineBlockFact
} from './markdownLaneState.js'
import type {
  MarkdownLiteralRange
} from './markdownTypes.js'
import type { TapeRun } from './sourceTape.js'

export type CanonicalMarkdownParseLaneOwner =
  | Readonly<{ readonly kind: 'document' }>
  | Readonly<{
    readonly kind: 'critic-arm'
    readonly node: CriticMarkupNode
    readonly arm: CriticMarkupNode['arms'][number]['name']
  }>

export interface CanonicalMarkdownParseSourceSlice {
  readonly kind: 'source'
  readonly sourceRunId: number
  readonly range: SourceRange
}

export interface CanonicalMarkdownBlockFact {
  readonly paragraphOpen: boolean
  readonly lineStart: number
  readonly containerPath: readonly ('blockquote' | 'list-item')[]
  readonly activeProvider: MarkdownLiteralRange['kind'] | undefined
  readonly pendingLine: MarkdownPendingLineBlockFact | undefined
}

export interface CanonicalMarkdownEmittedFacts {
  readonly literals: readonly MarkdownLiteralRange[]
  readonly block: CanonicalMarkdownBlockFact
}

export type CanonicalMarkdownTransitionOperation =
  | 'advance'
  | 'prepare-for-marker'
  | 'release-at-boundary'
  | 'finish-lane'
  | 'rejoin-carrier'
  | 'malformed-recovery'
  | 'unterminated-recovery'

export interface CanonicalMarkdownLaneTransition {
  readonly operation: CanonicalMarkdownTransitionOperation
  readonly entryCheckpoint: MarkdownCheckpoint
  readonly exitCheckpoint: MarkdownCheckpoint
  readonly consumed: readonly CanonicalMarkdownParseSourceSlice[]
  readonly emittedFacts: CanonicalMarkdownEmittedFacts
}

export interface CanonicalMarkdownParseBranch {
  readonly kind: 'critic-branch'
  readonly node: CriticMarkupNode
  readonly arms: readonly CanonicalMarkdownParseLane[]
}

export interface CanonicalMarkdownArmBoundaryEvent {
  readonly kind: 'substitution-arm-boundary'
  readonly role: 'enter' | 'exit'
  readonly sourcePosition: SourceOffset
}

export type CanonicalMarkdownParseLaneItem =
  | CanonicalMarkdownParseSourceSlice
  | CanonicalMarkdownParseBranch

export interface CanonicalMarkdownParseLane {
  readonly id: number
  readonly owner: CanonicalMarkdownParseLaneOwner
  readonly range: SourceRange
  readonly entryCheckpoint: MarkdownCheckpoint
  readonly exitCheckpoint: MarkdownCheckpoint
  readonly transitions: readonly CanonicalMarkdownLaneTransition[]
  readonly armBoundaries: readonly CanonicalMarkdownArmBoundaryEvent[]
  readonly items: readonly CanonicalMarkdownParseLaneItem[]
}

export interface CanonicalMarkdownParseArtifact {
  readonly root: CanonicalMarkdownParseLane
  readonly lanes: readonly CanonicalMarkdownParseLane[]
  readonly branches: readonly CanonicalMarkdownParseBranch[]
}

interface PendingTransition {
  readonly operation: CanonicalMarkdownTransitionOperation
  readonly entryCheckpoint: MarkdownCheckpoint
  readonly exitCheckpoint: MarkdownCheckpoint
  readonly sourceRange: SourceRange
  readonly emittedLiterals: readonly MarkdownLiteralRange[]
}

interface PendingBranch {
  readonly node: CriticMarkupNode
  readonly arms: readonly MutableCanonicalMarkdownParseLane[]
}

interface MutableCanonicalMarkdownParseLane {
  owner: CanonicalMarkdownParseLaneOwner | undefined
  range: SourceRange | undefined
  readonly entryCheckpoint: MarkdownCheckpoint
  exitCheckpoint: MarkdownCheckpoint | undefined
  readonly transitions: PendingTransition[]
  armBoundaries: readonly CanonicalMarkdownArmBoundaryEvent[]
  readonly branches: PendingBranch[]
}

export interface CanonicalMarkdownParseLaneHandle {
  readonly lane: MutableCanonicalMarkdownParseLane
}

export interface CanonicalMarkdownParseRecorder {
  readonly root: CanonicalMarkdownParseLaneHandle
  readonly forkLane: (
    entryCheckpoint: MarkdownCheckpoint
  ) => CanonicalMarkdownParseLaneHandle
  readonly recordTransition: (
    lane: CanonicalMarkdownParseLaneHandle,
    operation: CanonicalMarkdownTransitionOperation,
    entryCheckpoint: MarkdownCheckpoint,
    exitCheckpoint: MarkdownCheckpoint,
    sourceStart: number,
    sourceEnd: number,
    emittedLiterals: readonly MarkdownLiteralRange[]
  ) => void
  readonly sealLane: (
    lane: CanonicalMarkdownParseLaneHandle,
    exitCheckpoint: MarkdownCheckpoint
  ) => void
  readonly recordArmBoundary: (
    lane: CanonicalMarkdownParseLaneHandle,
    event: CanonicalMarkdownArmBoundaryEvent
  ) => void
  readonly acceptBranch: (
    parent: CanonicalMarkdownParseLaneHandle,
    node: CriticMarkupNode,
    arms: readonly CanonicalMarkdownParseLaneHandle[]
  ) => void
  readonly promoteBranches: (
    lanes: readonly CanonicalMarkdownParseLaneHandle[],
    parent: CanonicalMarkdownParseLaneHandle
  ) => void
  readonly finish: (
    tape: readonly TapeRun[],
    rootExitCheckpoint: MarkdownCheckpoint
  ) => CanonicalMarkdownParseArtifact
}

function sourceOffset(value: number): SourceOffset {
  return value as SourceOffset
}

function sourceRange(start: number, end: number): SourceRange {
  return Object.freeze({ start: sourceOffset(start), end: sourceOffset(end) })
}

function activeProvider(
  checkpoint: MarkdownCheckpoint
): MarkdownLiteralRange['kind'] | undefined {
  if (checkpoint.fence !== undefined) {
    return checkpoint.fence.provider
  }
  if (checkpoint.frontMatter !== undefined) {
    return 'front-matter'
  }
  if (checkpoint.indentedCode !== undefined) {
    return 'indented-code'
  }
  if (checkpoint.htmlBlock !== undefined) {
    return 'html-block'
  }
  if (checkpoint.definition !== undefined) {
    return 'definition'
  }
  if (checkpoint.inlineCode !== undefined) {
    return 'inline-code'
  }
  if (checkpoint.math !== undefined) {
    return 'math'
  }
  return checkpoint.fixedInline?.kind
}

function blockFact(
  checkpoint: MarkdownCheckpoint,
  retainPendingLine: boolean
): CanonicalMarkdownBlockFact {
  return Object.freeze({
    paragraphOpen: checkpoint.paragraphOpen,
    lineStart: checkpoint.lineStart,
    containerPath: Object.freeze(
      checkpoint.activeContainers.map((container) => container.kind)
    ),
    activeProvider: activeProvider(checkpoint),
    pendingLine: retainPendingLine
      ? inspectMarkdownPendingLineBlock(checkpoint)
      : undefined
  })
}

function sourceSlices(
  tape: readonly TapeRun[],
  start: number,
  end: number
): readonly CanonicalMarkdownParseSourceSlice[] {
  if (start === end) {
    return Object.freeze([])
  }
  if (start < 0 || end < start || end > (tape.at(-1)?.range.end ?? 0)) {
    throw new Error('Canonical Markdown parse evidence is outside the source tape')
  }
  let low = 0
  let high = tape.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if ((tape[middle]?.range.end ?? Number.POSITIVE_INFINITY) <= start) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  const slices: CanonicalMarkdownParseSourceSlice[] = []
  let cursor = start
  for (let tapeIndex = low; cursor < end; tapeIndex += 1) {
    const run = tape[tapeIndex]
    if (run === undefined || cursor < run.range.start || cursor >= run.range.end) {
      throw new Error('Canonical Markdown parse evidence lost its source tape identity')
    }
    const sliceEnd = Math.min(end, run.range.end)
    slices.push(Object.freeze({
      kind: 'source',
      sourceRunId: run.id,
      range: sourceRange(cursor, sliceEnd)
    }))
    cursor = sliceEnd
  }
  return Object.freeze(slices)
}

function createMutableLane(
  entryCheckpoint: MarkdownCheckpoint
): MutableCanonicalMarkdownParseLane {
  return {
    owner: undefined,
    range: undefined,
    entryCheckpoint,
    exitCheckpoint: undefined,
    transitions: [],
    armBoundaries: Object.freeze([]),
    branches: []
  }
}

export function createCanonicalMarkdownParseRecorder(
  sourceLength: number,
  rootEntryCheckpoint: MarkdownCheckpoint
): CanonicalMarkdownParseRecorder {
  const rootLane = createMutableLane(rootEntryCheckpoint)
  rootLane.owner = Object.freeze({ kind: 'document' })
  rootLane.range = sourceRange(0, sourceLength)
  const root = Object.freeze({ lane: rootLane })
  const forkLane = Object.freeze((
    entryCheckpoint: MarkdownCheckpoint
  ): CanonicalMarkdownParseLaneHandle =>
    Object.freeze({ lane: createMutableLane(entryCheckpoint) }))
  const recordTransition = Object.freeze((
    lane: CanonicalMarkdownParseLaneHandle,
    operation: CanonicalMarkdownTransitionOperation,
    entryCheckpoint: MarkdownCheckpoint,
    exitCheckpoint: MarkdownCheckpoint,
    sourceStart: number,
    sourceEnd: number,
    emittedLiterals: readonly MarkdownLiteralRange[]
  ): void => {
    lane.lane.transitions.push(Object.freeze({
      operation,
      entryCheckpoint,
      exitCheckpoint,
      sourceRange: sourceRange(sourceStart, sourceEnd),
      emittedLiterals: Object.freeze([...emittedLiterals])
    }))
  })
  const sealLane = Object.freeze((
    lane: CanonicalMarkdownParseLaneHandle,
    exitCheckpoint: MarkdownCheckpoint
  ): void => {
    lane.lane.exitCheckpoint = exitCheckpoint
  })
  const recordArmBoundary = Object.freeze((
    lane: CanonicalMarkdownParseLaneHandle,
    event: CanonicalMarkdownArmBoundaryEvent
  ): void => {
    lane.lane.armBoundaries = Object.freeze([
      ...lane.lane.armBoundaries,
      event
    ])
  })
  const acceptBranch = Object.freeze((
    parent: CanonicalMarkdownParseLaneHandle,
    node: CriticMarkupNode,
    arms: readonly CanonicalMarkdownParseLaneHandle[]
  ): void => {
    if (arms.length !== node.arms.length) {
      throw new Error('Parser-owned canonical Markdown branch lost a CM arm')
    }
    const mutableArms = arms.map((arm, index) => {
      const nodeArm = node.arms[index]
      if (nodeArm === undefined || arm.lane.exitCheckpoint === undefined) {
        throw new Error('Parser-owned canonical Markdown arm was not sealed')
      }
      arm.lane.owner = Object.freeze({
        kind: 'critic-arm',
        node,
        arm: nodeArm.name
      })
      arm.lane.range = nodeArm.range
      return arm.lane
    })
    parent.lane.branches.push(Object.freeze({
      node,
      arms: Object.freeze(mutableArms)
    }))
  })
  const promoteBranches = Object.freeze((
    lanes: readonly CanonicalMarkdownParseLaneHandle[],
    parent: CanonicalMarkdownParseLaneHandle
  ): void => {
    for (const lane of lanes) {
      parent.lane.branches.push(...lane.lane.branches)
      lane.lane.branches.length = 0
    }
  })

  const finish = Object.freeze((
    tape: readonly TapeRun[],
    rootExitCheckpoint: MarkdownCheckpoint
  ): CanonicalMarkdownParseArtifact => {
    rootLane.exitCheckpoint = rootExitCheckpoint
    const mutableLanes: MutableCanonicalMarkdownParseLane[] = [rootLane]
    const pending = [rootLane]
    while (pending.length > 0) {
      const lane = pending.pop()
      if (lane === undefined) {
        break
      }
      lane.branches.sort(
        (left, right) =>
          left.node.range.start - right.node.range.start ||
          right.node.range.end - left.node.range.end
      )
      for (let branchIndex = lane.branches.length - 1; branchIndex >= 0; branchIndex -= 1) {
        const branch = lane.branches[branchIndex]
        if (branch === undefined) {
          continue
        }
        for (let armIndex = branch.arms.length - 1; armIndex >= 0; armIndex -= 1) {
          const arm = branch.arms[armIndex]
          if (arm !== undefined) {
            mutableLanes.push(arm)
            pending.push(arm)
          }
        }
      }
    }

    const laneByMutable = new Map<
      MutableCanonicalMarkdownParseLane,
      CanonicalMarkdownParseLane
    >()
    const lanes = mutableLanes.map((lane, id): CanonicalMarkdownParseLane => {
      if (
        lane.owner === undefined ||
        lane.range === undefined ||
        lane.exitCheckpoint === undefined
      ) {
        throw new Error('Parser-owned canonical Markdown lane is incomplete')
      }
      const shell = {
        id,
        owner: lane.owner,
        range: lane.range,
        entryCheckpoint: lane.entryCheckpoint,
        exitCheckpoint: lane.exitCheckpoint,
        transitions: Object.freeze(lane.transitions.map((transition) =>
          Object.freeze({
            operation: transition.operation,
            entryCheckpoint: transition.entryCheckpoint,
            exitCheckpoint: transition.exitCheckpoint,
            consumed: sourceSlices(
              tape,
              transition.sourceRange.start,
              transition.sourceRange.end
            ),
            emittedFacts: Object.freeze({
              literals: transition.emittedLiterals,
              block: blockFact(
                transition.exitCheckpoint,
                (
                  transition.operation === 'finish-lane' &&
                  lane.owner?.kind === 'critic-arm' &&
                  lane.owner.node.kind === 'substitution'
                ) ||
                (
                  transition.operation === 'advance' &&
                  (
                    transition.exitCheckpoint.lineStart >
                      transition.entryCheckpoint.lineStart ||
                    (
                      transition.entryCheckpoint.linePath === undefined &&
                      transition.entryCheckpoint.paragraphOpen
                    )
                  )
                )
              )
            })
          })
        )),
        armBoundaries: lane.armBoundaries,
        items: Object.freeze([]) as readonly CanonicalMarkdownParseLaneItem[]
      }
      laneByMutable.set(lane, shell)
      return shell
    })

    const branches: CanonicalMarkdownParseBranch[] = []
    for (let laneIndex = 0; laneIndex < mutableLanes.length; laneIndex += 1) {
      const mutableLane = mutableLanes[laneIndex]
      const lane = lanes[laneIndex]
      if (mutableLane === undefined || lane === undefined) {
        throw new Error('Parser-owned canonical Markdown lane identity diverged')
      }
      const range = mutableLane.range
      if (range === undefined) {
        throw new Error('Parser-owned canonical Markdown lane range is missing')
      }
      const items: CanonicalMarkdownParseLaneItem[] = []
      let cursor = range.start
      for (const mutableBranch of mutableLane.branches) {
        if (mutableBranch.node.range.start < cursor) {
          throw new Error('Parser-owned canonical Markdown branches overlap')
        }
        if (cursor < mutableBranch.node.range.start) {
          items.push(...sourceSlices(tape, cursor, mutableBranch.node.range.start))
        }
        const branch = Object.freeze({
          kind: 'critic-branch' as const,
          node: mutableBranch.node,
          arms: Object.freeze(mutableBranch.arms.map((arm) => {
            const resolved = laneByMutable.get(arm)
            if (resolved === undefined) {
              throw new Error('Parser-owned canonical Markdown arm identity is missing')
            }
            return resolved
          }))
        })
        items.push(branch)
        branches.push(branch)
        cursor = mutableBranch.node.range.end
      }
      if (cursor < range.end) {
        items.push(...sourceSlices(tape, cursor, range.end))
      }
      ;(lane as { items: readonly CanonicalMarkdownParseLaneItem[] }).items =
        Object.freeze(items)
    }

    for (let index = lanes.length - 1; index >= 0; index -= 1) {
      Object.freeze(lanes[index])
    }
    branches.sort(
      (left, right) =>
        left.node.range.start - right.node.range.start ||
        right.node.range.end - left.node.range.end
    )
    return Object.freeze({
      root: lanes[0] as CanonicalMarkdownParseLane,
      lanes: Object.freeze(lanes),
      branches: Object.freeze(branches)
    })
  })

  return Object.freeze({
    root,
    forkLane,
    recordTransition,
    sealLane,
    recordArmBoundary,
    acceptBranch,
    promoteBranches,
    finish
  })
}
