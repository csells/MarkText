import type {
  CompleteDocumentRevision,
  CriticMarkupNode,
  SourceRange
} from '../revision.js'

/**
 * §2 postcondition shared by the transformation kernel and the admission
 * authority: a candidate revision preserves every CriticMarkup node its
 * edits never touched — same kind, same envelope mapped through the edit
 * deltas. Exact-edit construction already proves untouched source slices
 * copy code-unit-for-code-unit, so the indexed kind and mapped envelope are
 * the remaining structural survivor proof; rescanning every nested slice
 * would turn a sibling edit beside a deep tree quadratic.
 */

export interface PreservationSourceEdit {
  readonly start: number
  readonly end: number
  readonly insert: string
}

export interface SourceEditDeltaIndex {
  readonly touches: (start: number, end: number) => boolean
  readonly mapStart: (offset: number) => number
  readonly mapEnd: (offset: number) => number
}

export function createSourceEditDeltaIndex(
  edits: readonly PreservationSourceEdit[]
): SourceEditDeltaIndex {
  const allEnds: number[] = []
  const allPrefixDeltas: number[] = [0]
  const replacementEnds: number[] = []
  const replacementPrefixDeltas: number[] = [0]
  const insertionEnds: number[] = []
  const insertionPrefixDeltas: number[] = [0]

  for (const edit of edits) {
    const delta = edit.insert.length - (edit.end - edit.start)
    allEnds.push(edit.end)
    allPrefixDeltas.push((allPrefixDeltas.at(-1) ?? 0) + delta)
    if (edit.start === edit.end) {
      insertionEnds.push(edit.end)
      insertionPrefixDeltas.push(
        (insertionPrefixDeltas.at(-1) ?? 0) + delta
      )
    } else {
      replacementEnds.push(edit.end)
      replacementPrefixDeltas.push(
        (replacementPrefixDeltas.at(-1) ?? 0) + delta
      )
    }
  }

  const deltaAt = (
    positions: readonly number[],
    prefixDeltas: readonly number[],
    offset: number,
    inclusive: boolean
  ): number => {
    let low = 0
    let high = positions.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      const position = positions[middle] ?? Number.POSITIVE_INFINITY
      if (position < offset || (inclusive && position === offset)) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return prefixDeltas[low] ?? 0
  }

  return Object.freeze({
    touches: Object.freeze((start: number, end: number): boolean => {
      let low = 0
      let high = edits.length
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2)
        if ((edits[middle]?.end ?? Number.POSITIVE_INFINITY) <= start) {
          low = middle + 1
        } else {
          high = middle
        }
      }
      const candidate = edits[low]
      return candidate !== undefined && candidate.start < end
    }),
    mapStart: Object.freeze((offset: number): number =>
      offset + deltaAt(allEnds, allPrefixDeltas, offset, true)),
    mapEnd: Object.freeze((offset: number): number =>
      offset +
        deltaAt(replacementEnds, replacementPrefixDeltas, offset, true) +
        deltaAt(insertionEnds, insertionPrefixDeltas, offset, false))
  })
}

function rangeStart(range: SourceRange): number {
  return Number(range.start)
}

function rangeEnd(range: SourceRange): number {
  return Number(range.end)
}

/** Every node of the forest, nested arm children included. */
function forEachNode(
  revision: CompleteDocumentRevision,
  visit: (node: CriticMarkupNode) => void
): void {
  const pending: CriticMarkupNode[] = []
  for (
    let ordinal = revision.criticMarkup.rootCount - 1;
    ordinal >= 0;
    ordinal -= 1
  ) {
    pending.push(revision.criticMarkup.rootAt(ordinal))
  }
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) continue
    visit(node)
    for (const arm of node.arms) {
      for (const child of arm.children) {
        pending.push(child)
      }
    }
  }
}

export function preservesUntargetedNodes(
  before: CompleteDocumentRevision,
  candidate: CompleteDocumentRevision,
  edits: readonly PreservationSourceEdit[]
): boolean {
  const nodeKey = (
    kind: CriticMarkupNode['kind'],
    start: number,
    end: number
  ): string => `${kind}:${start}:${end}`
  const candidateNodes = new Set<string>()
  forEachNode(candidate, (node) => {
    candidateNodes.add(nodeKey(
      node.kind,
      rangeStart(node.range),
      rangeEnd(node.range)
    ))
  })
  const editIndex = createSourceEditDeltaIndex(edits)
  let preserved = true
  forEachNode(before, (node) => {
    if (!preserved) return
    const start = rangeStart(node.range)
    const end = rangeEnd(node.range)
    if (editIndex.touches(start, end)) {
      return
    }
    if (!candidateNodes.has(nodeKey(
      node.kind,
      editIndex.mapStart(start),
      editIndex.mapEnd(end)
    ))) {
      preserved = false
    }
  })
  return preserved
}
