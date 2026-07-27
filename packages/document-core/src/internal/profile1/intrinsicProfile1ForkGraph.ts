import type {
  CriticMarkupNode,
  SourceOffset,
  SourceRange
} from '../../revision.js'
import {
  inspectMarkdownPendingLineBlock,
  type MarkdownCheckpoint,
  type MarkdownPendingLineBlockFact,
  type PlainMarkdownLine
} from './markdownLaneState.js'
import type {
  MarkdownLiteralRange
} from './markdownTypes.js'
import type { TapeRun } from './sourceTape.js'

export type IntrinsicProfile1ForkLaneOwner =
  | Readonly<{ readonly kind: 'document' }>
  | Readonly<{
    readonly kind: 'critic-arm'
    readonly node: CriticMarkupNode
    readonly arm: CriticMarkupNode['arms'][number]['name']
  }>

export interface IntrinsicProfile1SourceSlice {
  readonly kind: 'source'
  readonly sourceRunId: number
  readonly range: SourceRange
}

export interface IntrinsicProfile1BlockFact {
  readonly paragraphOpen: boolean
  readonly lineStart: number
  readonly containerPath: readonly ('blockquote' | 'list-item')[]
  readonly activeProvider: MarkdownLiteralRange['kind'] | undefined
  readonly pendingLine: MarkdownPendingLineBlockFact | undefined
}

export interface IntrinsicProfile1EmittedFacts {
  readonly literals: readonly MarkdownLiteralRange[]
  readonly lines: readonly PlainMarkdownLine[]
  readonly block: IntrinsicProfile1BlockFact
}

export type IntrinsicProfile1TransitionOperation =
  | 'advance'
  | 'prepare-for-marker'
  | 'release-at-boundary'
  | 'finish-lane'
  | 'rejoin-carrier'
  | 'malformed-recovery'
  | 'unterminated-recovery'

export interface IntrinsicProfile1LaneTransition {
  readonly operation: IntrinsicProfile1TransitionOperation
  readonly entryCheckpoint: MarkdownCheckpoint
  readonly exitCheckpoint: MarkdownCheckpoint
  readonly consumed: readonly IntrinsicProfile1SourceSlice[]
  readonly emittedFacts: IntrinsicProfile1EmittedFacts
}

export interface IntrinsicProfile1ForkBranch {
  readonly kind: 'critic-branch'
  readonly node: CriticMarkupNode
  readonly arms: readonly IntrinsicProfile1ForkLane[]
}

export interface IntrinsicProfile1ArmBoundaryEvent {
  readonly kind: 'substitution-arm-boundary'
  readonly role: 'enter' | 'exit'
  readonly sourcePosition: SourceOffset
}

export type IntrinsicProfile1ForkLaneItem =
  | IntrinsicProfile1SourceSlice
  | IntrinsicProfile1ForkBranch

export interface IntrinsicProfile1ForkLane {
  readonly id: number
  readonly owner: IntrinsicProfile1ForkLaneOwner
  readonly range: SourceRange
  readonly entryCheckpoint: MarkdownCheckpoint
  readonly exitCheckpoint: MarkdownCheckpoint
  readonly transitions: readonly IntrinsicProfile1LaneTransition[]
  readonly armBoundaries: readonly IntrinsicProfile1ArmBoundaryEvent[]
  readonly items: readonly IntrinsicProfile1ForkLaneItem[]
}

export interface IntrinsicProfile1ForkGraph {
  readonly root: IntrinsicProfile1ForkLane
  readonly lanes: readonly IntrinsicProfile1ForkLane[]
  readonly branches: readonly IntrinsicProfile1ForkBranch[]
}

interface PendingTransition {
  readonly operation: IntrinsicProfile1TransitionOperation
  readonly entryCheckpoint: MarkdownCheckpoint
  readonly exitCheckpoint: MarkdownCheckpoint
  readonly sourceRange: SourceRange
  readonly emittedLiterals: readonly MarkdownLiteralRange[]
  readonly emittedLines: readonly PlainMarkdownLine[]
}

interface PendingBranch {
  readonly node: CriticMarkupNode
  readonly arms: readonly MutableIntrinsicProfile1ForkLane[]
}

interface MutableIntrinsicProfile1ForkLane {
  owner: IntrinsicProfile1ForkLaneOwner | undefined
  range: SourceRange | undefined
  readonly entryCheckpoint: MarkdownCheckpoint
  exitCheckpoint: MarkdownCheckpoint | undefined
  readonly transitions: PendingTransition[]
  armBoundaries: readonly IntrinsicProfile1ArmBoundaryEvent[]
  readonly branches: PendingBranch[]
}

export interface IntrinsicProfile1ForkLaneHandle {
  readonly lane: MutableIntrinsicProfile1ForkLane
}

export interface IntrinsicProfile1ForkRecorder {
  readonly root: IntrinsicProfile1ForkLaneHandle
  readonly forkLane: (
    entryCheckpoint: MarkdownCheckpoint
  ) => IntrinsicProfile1ForkLaneHandle
  readonly recordTransition: (
    lane: IntrinsicProfile1ForkLaneHandle,
    operation: IntrinsicProfile1TransitionOperation,
    entryCheckpoint: MarkdownCheckpoint,
    exitCheckpoint: MarkdownCheckpoint,
    sourceStart: number,
    sourceEnd: number,
    emittedLiterals: readonly MarkdownLiteralRange[],
    emittedLines?: readonly PlainMarkdownLine[]
  ) => void
  readonly sealLane: (
    lane: IntrinsicProfile1ForkLaneHandle,
    exitCheckpoint: MarkdownCheckpoint
  ) => void
  readonly recordArmBoundary: (
    lane: IntrinsicProfile1ForkLaneHandle,
    event: IntrinsicProfile1ArmBoundaryEvent
  ) => void
  readonly acceptBranch: (
    parent: IntrinsicProfile1ForkLaneHandle,
    node: CriticMarkupNode,
    arms: readonly IntrinsicProfile1ForkLaneHandle[]
  ) => void
  readonly promoteBranches: (
    lanes: readonly IntrinsicProfile1ForkLaneHandle[],
    parent: IntrinsicProfile1ForkLaneHandle
  ) => void
  readonly finish: (
    tape: readonly TapeRun[],
    rootExitCheckpoint: MarkdownCheckpoint
  ) => IntrinsicProfile1ForkGraph
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
): IntrinsicProfile1BlockFact {
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
): readonly IntrinsicProfile1SourceSlice[] {
  if (start === end) {
    return Object.freeze([])
  }
  if (start < 0 || end < start || end > (tape.at(-1)?.range.end ?? 0)) {
    throw new Error('Intrinsic Profile 1 fork parse evidence is outside the source tape')
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
  const slices: IntrinsicProfile1SourceSlice[] = []
  let cursor = start
  for (let tapeIndex = low; cursor < end; tapeIndex += 1) {
    const run = tape[tapeIndex]
    if (run === undefined || cursor < run.range.start || cursor >= run.range.end) {
      throw new Error('Intrinsic Profile 1 fork parse evidence lost its source tape identity')
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
): MutableIntrinsicProfile1ForkLane {
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

export function createIntrinsicProfile1ForkRecorder(
  sourceLength: number,
  rootEntryCheckpoint: MarkdownCheckpoint
): IntrinsicProfile1ForkRecorder {
  const rootLane = createMutableLane(rootEntryCheckpoint)
  rootLane.owner = Object.freeze({ kind: 'document' })
  rootLane.range = sourceRange(0, sourceLength)
  const root = Object.freeze({ lane: rootLane })
  const forkLane = Object.freeze((
    entryCheckpoint: MarkdownCheckpoint
  ): IntrinsicProfile1ForkLaneHandle =>
    Object.freeze({ lane: createMutableLane(entryCheckpoint) }))
  const recordTransition = Object.freeze((
    lane: IntrinsicProfile1ForkLaneHandle,
    operation: IntrinsicProfile1TransitionOperation,
    entryCheckpoint: MarkdownCheckpoint,
    exitCheckpoint: MarkdownCheckpoint,
    sourceStart: number,
    sourceEnd: number,
    emittedLiterals: readonly MarkdownLiteralRange[],
    emittedLines: readonly PlainMarkdownLine[] = Object.freeze([])
  ): void => {
    lane.lane.transitions.push(Object.freeze({
      operation,
      entryCheckpoint,
      exitCheckpoint,
      sourceRange: sourceRange(sourceStart, sourceEnd),
      emittedLiterals: Object.freeze([...emittedLiterals]),
      emittedLines: Object.freeze([...emittedLines])
    }))
  })
  const sealLane = Object.freeze((
    lane: IntrinsicProfile1ForkLaneHandle,
    exitCheckpoint: MarkdownCheckpoint
  ): void => {
    lane.lane.exitCheckpoint = exitCheckpoint
  })
  const recordArmBoundary = Object.freeze((
    lane: IntrinsicProfile1ForkLaneHandle,
    event: IntrinsicProfile1ArmBoundaryEvent
  ): void => {
    lane.lane.armBoundaries = Object.freeze([
      ...lane.lane.armBoundaries,
      event
    ])
  })
  const acceptBranch = Object.freeze((
    parent: IntrinsicProfile1ForkLaneHandle,
    node: CriticMarkupNode,
    arms: readonly IntrinsicProfile1ForkLaneHandle[]
  ): void => {
    if (arms.length !== node.arms.length) {
      throw new Error('Intrinsic Profile 1 fork branch lost a CM arm')
    }
    const mutableArms = arms.map((arm, index) => {
      const nodeArm = node.arms[index]
      if (nodeArm === undefined || arm.lane.exitCheckpoint === undefined) {
        throw new Error('Intrinsic Profile 1 fork arm was not sealed')
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
    lanes: readonly IntrinsicProfile1ForkLaneHandle[],
    parent: IntrinsicProfile1ForkLaneHandle
  ): void => {
    for (const lane of lanes) {
      parent.lane.branches.push(...lane.lane.branches)
      lane.lane.branches.length = 0
    }
  })

  const finish = Object.freeze((
    tape: readonly TapeRun[],
    rootExitCheckpoint: MarkdownCheckpoint
  ): IntrinsicProfile1ForkGraph => {
    rootLane.exitCheckpoint = rootExitCheckpoint
    const mutableLanes: MutableIntrinsicProfile1ForkLane[] = [rootLane]
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
      MutableIntrinsicProfile1ForkLane,
      IntrinsicProfile1ForkLane
    >()
    const lanes = mutableLanes.map((lane, id): IntrinsicProfile1ForkLane => {
      if (
        lane.owner === undefined ||
        lane.range === undefined ||
        lane.exitCheckpoint === undefined
      ) {
        throw new Error('Intrinsic Profile 1 fork lane is incomplete')
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
              lines: transition.emittedLines,
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
        items: Object.freeze([]) as readonly IntrinsicProfile1ForkLaneItem[]
      }
      laneByMutable.set(lane, shell)
      return shell
    })

    const branches: IntrinsicProfile1ForkBranch[] = []
    for (let laneIndex = 0; laneIndex < mutableLanes.length; laneIndex += 1) {
      const mutableLane = mutableLanes[laneIndex]
      const lane = lanes[laneIndex]
      if (mutableLane === undefined || lane === undefined) {
        throw new Error('Intrinsic Profile 1 fork lane identity diverged')
      }
      const range = mutableLane.range
      if (range === undefined) {
        throw new Error('Intrinsic Profile 1 fork lane range is missing')
      }
      const items: IntrinsicProfile1ForkLaneItem[] = []
      const appendSourceSlices = (
        start: number,
        end: number
      ): void => {
        for (const slice of sourceSlices(tape, start, end)) {
          items.push(slice)
        }
      }
      let cursor = range.start
      for (const mutableBranch of mutableLane.branches) {
        if (mutableBranch.node.range.start < cursor) {
          throw new Error('Intrinsic Profile 1 fork branches overlap')
        }
        if (cursor < mutableBranch.node.range.start) {
          appendSourceSlices(cursor, mutableBranch.node.range.start)
        }
        const branch = Object.freeze({
          kind: 'critic-branch' as const,
          node: mutableBranch.node,
          arms: Object.freeze(mutableBranch.arms.map((arm) => {
            const resolved = laneByMutable.get(arm)
            if (resolved === undefined) {
              throw new Error('Intrinsic Profile 1 fork arm identity is missing')
            }
            return resolved
          }))
        })
        items.push(branch)
        branches.push(branch)
        cursor = mutableBranch.node.range.end
      }
      if (cursor < range.end) {
        appendSourceSlices(cursor, range.end)
      }
      ;(lane as { items: readonly IntrinsicProfile1ForkLaneItem[] }).items =
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
      root: lanes[0] as IntrinsicProfile1ForkLane,
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

/**
 * Parser-owned fork state for grammar inspections that publish no document.
 *
 * The intrinsic parser still drives the same Markdown checkpoints and arm
 * transitions, but an inspection has no consumer for the immutable fork graph.
 * Retaining every transition would otherwise make a sparse changed-join query
 * cost as much memory as a second complete revision.
 */
export function createIntrinsicProfile1InspectionForkRecorder(
  sourceLength: number,
  rootEntryCheckpoint: MarkdownCheckpoint
): IntrinsicProfile1ForkRecorder {
  const rootLane = createMutableLane(rootEntryCheckpoint)
  rootLane.owner = Object.freeze({ kind: 'document' })
  rootLane.range = sourceRange(0, sourceLength)
  const root = Object.freeze({ lane: rootLane })
  const forkLane = Object.freeze((
    entryCheckpoint: MarkdownCheckpoint
  ): IntrinsicProfile1ForkLaneHandle =>
    Object.freeze({ lane: createMutableLane(entryCheckpoint) }))
  const recordTransition = Object.freeze((): void => {})
  const sealLane = Object.freeze((
    lane: IntrinsicProfile1ForkLaneHandle,
    exitCheckpoint: MarkdownCheckpoint
  ): void => {
    lane.lane.exitCheckpoint = exitCheckpoint
  })
  const recordArmBoundary = Object.freeze((): void => {})
  const acceptBranch = Object.freeze((): void => {})
  const promoteBranches = Object.freeze((): void => {})
  const finish = Object.freeze((): never => {
    throw new Error('Inspection fork state cannot materialize a fork graph')
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
