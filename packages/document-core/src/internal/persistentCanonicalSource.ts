import { DOCUMENT_RESOURCE_POLICY_V1 } from '../resourcePolicy.js'

export type CanonicalSourceMaterializationReason =
  | 'getter'
  | 'fallback'
  | 'projection'
  | 'rebase'
  | 'reopen'

export interface PersistentCanonicalSourceRecorder {
  readonly recordNodeVisit: (depth: number) => void
  readonly recordRootShape: (height: number, pieces: number) => void
  readonly recordNodeAllocation: (piece: boolean) => void
  readonly recordCoalesce: () => void
  readonly recordRebalance: () => void
  readonly recordSlice: (pieces: number, units: number) => void
  readonly recordMaterialization: (
    reason: CanonicalSourceMaterializationReason,
    pieces: number,
    units: number
  ) => void
  readonly recordGetterHit: () => void
  readonly recordGetterMiss: () => void
  readonly recordCompaction: (
    pieces: number,
    retainedUpperBoundReductionUnits: number,
    fragmentationRebase: boolean
  ) => void
  readonly recordAttemptedRoot: () => void
}

// Regional revisions may conservatively overcount buffers that became wholly
// unreachable, but never undercount possible retention. Once at least 64 KiB
// is dead and backing exceeds four times live source, the facade crosses a
// full-document barrier and compacts the accepted candidate to one base span.
const SOURCE_REBASE_MINIMUM_DEAD_UNITS = 65_536
const SOURCE_REBASE_MAXIMUM_BACKING_RATIO = 4

export interface PersistentCanonicalSourceEdit {
  readonly start: number
  readonly end: number
  readonly insert: string
}

export interface CanonicalSourceView {
  readonly length: number
  readonly slice: (start: number, end: number) => string
}

export interface PersistentCanonicalSource extends CanonicalSourceView {
  readonly pieceCount: number
  readonly height: number
  /** Conservative; fully removed buffers may remain counted until compaction. */
  readonly retainedBufferUnitsUpperBound: number
  readonly requiresFragmentationRebase: boolean
  readonly applyExact: (
    edits: readonly PersistentCanonicalSourceEdit[],
    label: string
  ) => PersistentCanonicalSource
  readonly materialize: (reason: CanonicalSourceMaterializationReason) => string
}

interface SourceBuffer {
  readonly text: string
}

function sourceBuffer(text: string): SourceBuffer {
  return Object.freeze({ text })
}

interface SourceSpan {
  readonly buffer: SourceBuffer
  readonly start: number
  readonly end: number
}

interface SourceLeaf {
  readonly kind: 'leaf'
  readonly length: number
  readonly height: 1
  readonly pieceCount: 1
  readonly span: SourceSpan
}

interface SourceBranch {
  readonly kind: 'branch'
  readonly length: number
  readonly height: number
  readonly pieceCount: number
  readonly left: SourceNode
  readonly right: SourceNode
}

type SourceNode = SourceLeaf | SourceBranch

function leaf(
  buffer: SourceBuffer,
  start: number,
  end: number,
  recorder: PersistentCanonicalSourceRecorder
): SourceLeaf | undefined {
  if (start === end) return undefined
  recorder.recordNodeAllocation(true)
  return Object.freeze({
    kind: 'leaf',
    length: end - start,
    height: 1,
    pieceCount: 1,
    span: Object.freeze({ buffer, start, end })
  })
}

function branch(
  left: SourceNode,
  right: SourceNode,
  recorder: PersistentCanonicalSourceRecorder
): SourceBranch {
  if (Math.abs(left.height - right.height) > 1) {
    throw new Error('Source rope branch is not AVL balanced')
  }
  recorder.recordNodeAllocation(false)
  return Object.freeze({
    kind: 'branch',
    length: left.length + right.length,
    height: Math.max(left.height, right.height) + 1,
    pieceCount: left.pieceCount + right.pieceCount,
    left,
    right
  })
}

function balancedBranch(
  left: SourceNode,
  right: SourceNode,
  recorder: PersistentCanonicalSourceRecorder
): SourceNode {
  if (left.height > right.height + 1) {
    if (left.kind !== 'branch') throw new Error('Invalid source rope height')
    recorder.recordRebalance()
    if (left.left.height >= left.right.height) {
      return branch(
        left.left,
        branch(left.right, right, recorder),
        recorder
      )
    }
    if (left.right.kind !== 'branch') {
      throw new Error('Invalid source rope rotation')
    }
    return branch(
      branch(left.left, left.right.left, recorder),
      branch(left.right.right, right, recorder),
      recorder
    )
  }
  if (right.height > left.height + 1) {
    if (right.kind !== 'branch') throw new Error('Invalid source rope height')
    recorder.recordRebalance()
    if (right.right.height >= right.left.height) {
      return branch(
        branch(left, right.left, recorder),
        right.right,
        recorder
      )
    }
    if (right.left.kind !== 'branch') {
      throw new Error('Invalid source rope rotation')
    }
    return branch(
      branch(left, right.left.left, recorder),
      branch(right.left.right, right.right, recorder),
      recorder
    )
  }
  return branch(left, right, recorder)
}

function join(
  left: SourceNode | undefined,
  right: SourceNode | undefined,
  recorder: PersistentCanonicalSourceRecorder
): SourceNode | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  if (
    left.kind === 'leaf' &&
    right.kind === 'leaf' &&
    left.span.buffer === right.span.buffer &&
    left.span.end === right.span.start
  ) {
    recorder.recordCoalesce()
    return leaf(
      left.span.buffer,
      left.span.start,
      right.span.end,
      recorder
    )
  }
  if (left.height > right.height + 1) {
    if (left.kind !== 'branch') throw new Error('Invalid source rope height')
    const joined = join(left.right, right, recorder)
    if (joined === undefined) throw new Error('Source rope join lost content')
    return balancedBranch(
      left.left,
      joined,
      recorder
    )
  }
  if (right.height > left.height + 1) {
    if (right.kind !== 'branch') throw new Error('Invalid source rope height')
    const joined = join(left, right.left, recorder)
    if (joined === undefined) throw new Error('Source rope join lost content')
    return balancedBranch(
      joined,
      right.right,
      recorder
    )
  }
  return branch(left, right, recorder)
}

function split(
  node: SourceNode | undefined,
  offset: number,
  recorder: PersistentCanonicalSourceRecorder,
  depth: number = 1
): readonly [SourceNode | undefined, SourceNode | undefined] {
  if (node === undefined) return Object.freeze([undefined, undefined])
  recorder.recordNodeVisit(depth)
  if (offset === 0) return Object.freeze([undefined, node])
  if (offset === node.length) return Object.freeze([node, undefined])
  if (node.kind === 'leaf') {
    return Object.freeze([
      leaf(
        node.span.buffer,
        node.span.start,
        node.span.start + offset,
        recorder
      ),
      leaf(
        node.span.buffer,
        node.span.start + offset,
        node.span.end,
        recorder
      )
    ])
  }
  if (offset < node.left.length) {
    const [before, after] = split(
      node.left,
      offset,
      recorder,
      depth + 1
    )
    return Object.freeze([
      before,
      join(after, node.right, recorder)
    ])
  }
  if (offset === node.left.length) {
    return Object.freeze([node.left, node.right])
  }
  const [before, after] = split(
    node.right,
    offset - node.left.length,
    recorder,
    depth + 1
  )
  return Object.freeze([
    join(node.left, before, recorder),
    after
  ])
}

function appendRange(
  node: SourceNode | undefined,
  start: number,
  end: number,
  chunks: string[],
  recorder: PersistentCanonicalSourceRecorder,
  depth: number = 1
): number {
  if (node === undefined || start >= end) return 0
  recorder.recordNodeVisit(depth)
  if (node.kind === 'leaf') {
    chunks.push(node.span.buffer.text.slice(
      node.span.start + start,
      node.span.start + end
    ))
    return 1
  }
  let pieces = 0
  if (start < node.left.length) {
    pieces += appendRange(
      node.left,
      start,
      Math.min(end, node.left.length),
      chunks,
      recorder,
      depth + 1
    )
  }
  if (end > node.left.length) {
    pieces += appendRange(
      node.right,
      Math.max(0, start - node.left.length),
      end - node.left.length,
      chunks,
      recorder,
      depth + 1
    )
  }
  return pieces
}

function createSource(
  root: SourceNode | undefined,
  recorder: PersistentCanonicalSourceRecorder,
  estimatedRetainedBufferUnits: number,
  initiallyMaterialized?: string
): PersistentCanonicalSource {
  const length = root?.length ?? 0
  recorder.recordRootShape(root?.height ?? 0, root?.pieceCount ?? 0)
  let activeRoot = root
  let activeRetainedBufferUnits = estimatedRetainedBufferUnits
  let materialized = initiallyMaterialized
  const requiresFragmentationRebase = (): boolean => {
    const deadUnits = activeRetainedBufferUnits - length
    return (
      (activeRoot?.pieceCount ?? 0) >
        DOCUMENT_RESOURCE_POLICY_V1.maximumSourceRopePieces
    ) || (
      deadUnits >= SOURCE_REBASE_MINIMUM_DEAD_UNITS &&
        activeRetainedBufferUnits >
        length * SOURCE_REBASE_MAXIMUM_BACKING_RATIO
    )
  }
  const slice = Object.freeze((start: number, end: number): string => {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > length
    ) {
      throw new RangeError('Canonical source slice is outside its bounds')
    }
    const chunks: string[] = []
    const pieces = appendRange(activeRoot, start, end, chunks, recorder)
    recorder.recordSlice(pieces, end - start)
    return chunks.join('')
  })
  const applyExact = Object.freeze((
    edits: readonly PersistentCanonicalSourceEdit[],
    label: string
  ): PersistentCanonicalSource => {
    let previousEnd = 0
    for (let index = 0; index < edits.length; index += 1) {
      const edit = edits[index]
      if (
        edit === undefined ||
        !Number.isInteger(edit.start) ||
        !Number.isInteger(edit.end) ||
        edit.start < previousEnd ||
        edit.end < edit.start ||
        edit.end > length ||
        typeof edit.insert !== 'string'
      ) {
        throw new RangeError(`${label} ${String(index)} is invalid`)
      }
      previousEnd = edit.end
    }
    recorder.recordAttemptedRoot()
    let nextRoot = activeRoot
    let insertedUnits = 0
    for (let index = edits.length - 1; index >= 0; index -= 1) {
      const edit = edits[index]
      if (edit === undefined) continue
      insertedUnits += edit.insert.length
      const [before, fromStart] = split(nextRoot, edit.start, recorder)
      const [, after] = split(
        fromStart,
        edit.end - edit.start,
        recorder
      )
      const inserted = edit.insert.length === 0
        ? undefined
        : leaf(
          sourceBuffer(edit.insert),
          0,
          edit.insert.length,
          recorder
        )
      nextRoot = join(join(before, inserted, recorder), after, recorder)
    }
    return createSource(
      nextRoot,
      recorder,
      activeRetainedBufferUnits + insertedUnits
    )
  })
  const materialize = Object.freeze((
    reason: CanonicalSourceMaterializationReason
  ): string => {
    if (materialized !== undefined) {
      if (reason === 'getter') recorder.recordGetterHit()
      return materialized
    }
    if (reason === 'getter') recorder.recordGetterMiss()
    const chunks: string[] = []
    const pieces = appendRange(activeRoot, 0, length, chunks, recorder)
    const fragmentationRebase = requiresFragmentationRebase()
    const retainedUpperBoundReductionUnits = Math.max(
      0,
      activeRetainedBufferUnits - length
    )
    materialized = chunks.join('')
    recorder.recordMaterialization(reason, pieces, length)
    activeRoot = leaf(
      sourceBuffer(materialized),
      0,
      materialized.length,
      recorder
    )
    activeRetainedBufferUnits = length
    recorder.recordRootShape(
      activeRoot?.height ?? 0,
      activeRoot?.pieceCount ?? 0
    )
    recorder.recordCompaction(
      pieces,
      retainedUpperBoundReductionUnits,
      fragmentationRebase
    )
    return materialized
  })
  return Object.freeze({
    length,
    get pieceCount(): number {
      return activeRoot?.pieceCount ?? 0
    },
    get height(): number {
      return activeRoot?.height ?? 0
    },
    get retainedBufferUnitsUpperBound(): number {
      return activeRetainedBufferUnits
    },
    get requiresFragmentationRebase(): boolean {
      return requiresFragmentationRebase()
    },
    slice,
    applyExact,
    materialize
  })
}

/**
 * Creates the canonical source owned by one document revision. Rope leaves are
 * immutable spans into caller or edit buffers, so splitting never copies an
 * untouched prefix or suffix. Child revisions path-copy a balanced join tree
 * and cache their full string independently.
 */
export function createPersistentCanonicalSource(
  source: string,
  recorder: PersistentCanonicalSourceRecorder
): PersistentCanonicalSource {
  return createSource(
    leaf(sourceBuffer(source), 0, source.length, recorder),
    recorder,
    source.length,
    source
  )
}
