import type {
  DocumentChange,
  DocumentCore,
  DocumentRevision,
  MarkdownProjection,
  SourceRange
} from '@marktext/document-core'
import {
  projectedHeadingNodes,
  type ProjectedHeadingNode
} from '../documentConsumers/projectedHeadings'

/**
 * What counts and the outline read of a revision's Revised projection: its
 * Markdown and its headings, located in canonical source.
 */
export interface CoreConsumerSummary {
  readonly markdown: string
  readonly headings: readonly ProjectedHeadingNode[]
}

/**
 * A run of the document's source read through one Revised projection: of
 * the whole document, or of the blocks around a range a regional change
 * replaced. `start` and `end` are in that projection's revision, `delta`
 * moves them to the tracked one.
 */
type SummaryPiece =
  | {
    readonly kind: 'read'
    readonly projection: MarkdownProjection
    readonly start: number
    readonly end: number
    delta: number
    reading?: Readonly<{ markdown: string; headings: readonly ProjectedHeadingNode[] }>
  }
  | {
    readonly kind: 'region'
    readonly revision: DocumentRevision
    readonly start: number
    readonly end: number
    delta: number
  }

export interface ConsumerSummaryTracker {
  /**
   * The summary of `revision`. After regional changes only the blocks they
   * replaced are read again; the rest of the Revised text moves with its source.
   */
  summary(core: DocumentCore, revision: DocumentRevision): CoreConsumerSummary
  /** Follows a committed change so the next summary reads only what it replaced. */
  committed(previous: DocumentRevision, next: DocumentRevision, change: DocumentChange): void
  reset(): void
}

const readingOf = (
  piece: Extract<SummaryPiece, { kind: 'read' }>
): Readonly<{ markdown: string; headings: readonly ProjectedHeadingNode[] }> => {
  if (piece.reading === undefined) {
    const { projection } = piece
    const span: SourceRange = {
      start: projection.coordinates.toProjected(piece.start, 'next'),
      end: projection.coordinates.toProjected(piece.end, 'next')
    }
    piece.reading = Object.freeze({
      markdown: projection.markdown.slice(span.start, span.end),
      headings: Object.freeze(projectedHeadingNodes({
        markdown: projection.markdown,
        ast: projection.ast,
        sourceSegments: projection.coordinates.sourceSegments
      }, span))
    })
  }
  return piece.reading
}

const movedHeading = (heading: ProjectedHeadingNode, delta: number): ProjectedHeadingNode =>
  delta === 0
    ? heading
    : Object.freeze({
      ...heading,
      sourceRanges: Object.freeze(heading.sourceRanges.map((range) =>
        Object.freeze({ start: range.start + delta, end: range.end + delta })))
    })

export const createConsumerSummaryTracker = (): ConsumerSummaryTracker => {
  let tracked:
    | {
      revision: DocumentRevision
      core: DocumentCore
      pieces: SummaryPiece[]
      summary?: CoreConsumerSummary
    }
    | undefined

  const read = (core: DocumentCore, piece: SummaryPiece): Extract<SummaryPiece, { kind: 'read' }> =>
    piece.kind === 'read'
      ? piece
      : {
        kind: 'read',
        projection: core.projectAround(piece.revision, 'revised', { start: piece.start, end: piece.end }).projection,
        start: piece.start,
        end: piece.end,
        delta: piece.delta
      }

  /** `piece` limited to the tracked source range `[from, to)`. */
  const trimmed = (piece: SummaryPiece, from: number, to: number): SummaryPiece | undefined => {
    const start = Math.max(piece.start, from - piece.delta)
    const end = Math.min(piece.end, to - piece.delta)
    if (start >= end) return undefined
    if (start === piece.start && end === piece.end) return piece
    // A region not yet read is read before a part of it is kept.
    const source = tracked === undefined || piece.kind === 'read' ? piece : read(tracked.core, piece)
    if (source.kind !== 'read') return undefined
    return { kind: 'read', projection: source.projection, start, end, delta: piece.delta }
  }

  return {
    summary(core, revision) {
      if (tracked?.revision !== revision || tracked.core !== core) {
        tracked = {
          revision,
          core,
          pieces: [{
            kind: 'read',
            projection: core.project(revision, 'revised'),
            start: 0,
            end: revision.sourceLength,
            delta: 0
          }]
        }
      }
      if (tracked.summary === undefined) {
        let markdown = ''
        const headings: ProjectedHeadingNode[] = []
        tracked.pieces = tracked.pieces.map((piece) => {
          const current = read(core, piece)
          const reading = readingOf(current)
          markdown += reading.markdown
          for (const heading of reading.headings) headings.push(movedHeading(heading, current.delta))
          return current
        })
        tracked.summary = Object.freeze({ markdown, headings: Object.freeze(headings) })
      }
      return tracked.summary
    },
    committed(previous, next, change) {
      if (tracked === undefined) return
      const markup = change.projections.find((projection) => projection.name === 'markup')
      if (tracked.revision !== previous || markup === undefined || markup.scope !== 'regions') {
        tracked = undefined
        return
      }
      const replacements = [...markup.replacements].sort(
        (left, right) => left.previous.source.start - right.previous.source.start
      )
      let offset = 0
      for (const replacement of replacements) {
        const from = replacement.previous.source.start + offset
        const to = replacement.previous.source.end + offset
        const { start: nextStart, end: nextEnd } = replacement.next.source
        if (nextStart !== from) {
          tracked = undefined
          return
        }
        const shift = nextEnd - nextStart - (to - from)
        const before: SummaryPiece[] = []
        const after: SummaryPiece[] = []
        for (const piece of tracked.pieces) {
          const start = piece.start + piece.delta
          const end = piece.end + piece.delta
          const head = trimmed(piece, start, Math.min(end, from))
          if (head !== undefined) before.push(head)
          const tail = trimmed(piece, Math.max(start, to), end)
          if (tail !== undefined) after.push({ ...tail, delta: tail.delta + shift })
        }
        tracked.pieces = [
          ...before,
          ...(nextEnd > nextStart
            ? [{ kind: 'region' as const, revision: next, start: nextStart, end: nextEnd, delta: 0 }]
            : []),
          ...after
        ]
        offset += shift
      }
      tracked.revision = next
      tracked.summary = undefined
    },
    reset() {
      tracked = undefined
    }
  }
}
