import type { SourceEdit } from './sourceTransaction.js'

interface SourcePiece {
  readonly kind: 'source'
  readonly start: number
  readonly end: number
}

interface InsertPiece {
  readonly kind: 'insert'
  readonly text: string
}

type CandidatePiece = SourcePiece | InsertPiece

export interface SourceCandidateDraft {
  readonly text: string
  readonly joins: readonly number[]
  readonly accounting: {
    readonly sourceUnits: number
    readonly editCount: number
    readonly physicalPieceCount: number
  }
  /** Sparse source provenance used only while composing protective edits. */
  readonly pieces: readonly CandidatePiece[]
}

export interface ProtectedSourceCandidate {
  readonly text: string
  readonly edits: readonly SourceEdit[]
  readonly accounting: {
    readonly sourceUnits: number
    readonly editCount: number
    readonly protectionCount: number
    readonly physicalPieceCount: number
  }
}

function sourcePiece(start: number, end: number): SourcePiece {
  return Object.freeze({ kind: 'source', start, end })
}

function insertPiece(text: string): InsertPiece {
  return Object.freeze({ kind: 'insert', text })
}

function pieceLength(piece: CandidatePiece): number {
  return piece.kind === 'source'
    ? piece.end - piece.start
    : piece.text.length
}

function appendPiece(target: CandidatePiece[], piece: CandidatePiece): void {
  if (pieceLength(piece) === 0) {
    return
  }
  const previous = target[target.length - 1]
  if (
    previous?.kind === 'source' &&
    piece.kind === 'source' &&
    previous.end === piece.start
  ) {
    target[target.length - 1] = sourcePiece(previous.start, piece.end)
    return
  }
  if (previous?.kind === 'insert' && piece.kind === 'insert') {
    target[target.length - 1] = insertPiece(previous.text + piece.text)
    return
  }
  target.push(piece)
}

function materializePieces(
  source: string,
  pieces: readonly CandidatePiece[]
): string {
  const parts = pieces.map((piece) =>
    piece.kind === 'source'
      ? source.slice(piece.start, piece.end)
      : piece.text
  )
  return parts.join('')
}

function validateSourceEdits(
  sourceLength: number,
  edits: readonly SourceEdit[]
): void {
  let previousEnd = 0
  for (const [index, edit] of edits.entries()) {
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > sourceLength ||
      (index > 0 && edit.start < previousEnd)
    ) {
      throw new RangeError('Source edits must be sorted and nonoverlapping')
    }
    previousEnd = edit.end
  }
}

export function buildSourceCandidateDraft(
  source: string,
  edits: readonly SourceEdit[]
): SourceCandidateDraft {
  validateSourceEdits(source.length, edits)
  const pieces: CandidatePiece[] = []
  const joins: number[] = []
  let sourceCursor = 0
  let candidateLength = 0

  for (const edit of edits) {
    if (sourceCursor < edit.start) {
      appendPiece(pieces, sourcePiece(sourceCursor, edit.start))
      candidateLength += edit.start - sourceCursor
    }
    joins.push(candidateLength)
    if (edit.insert.length > 0) {
      appendPiece(pieces, insertPiece(edit.insert))
      candidateLength += edit.insert.length
    }
    joins.push(candidateLength)
    sourceCursor = edit.end
  }
  if (sourceCursor < source.length) {
    appendPiece(pieces, sourcePiece(sourceCursor, source.length))
  }

  const frozenPieces = Object.freeze(pieces)
  return Object.freeze({
    text: materializePieces(source, frozenPieces),
    joins: Object.freeze(joins),
    accounting: Object.freeze({
      sourceUnits: source.length,
      editCount: edits.length,
      physicalPieceCount: frozenPieces.length
    }),
    pieces: frozenPieces
  })
}

function slicePieces(
  pieces: readonly CandidatePiece[],
  start: number,
  end: number
): readonly CandidatePiece[] {
  const sliced: CandidatePiece[] = []
  let cursor = 0
  for (const piece of pieces) {
    const length = pieceLength(piece)
    const pieceStart = cursor
    const pieceEnd = cursor + length
    cursor = pieceEnd
    const overlapStart = Math.max(start, pieceStart)
    const overlapEnd = Math.min(end, pieceEnd)
    if (overlapStart >= overlapEnd) {
      continue
    }
    const localStart = overlapStart - pieceStart
    const localEnd = overlapEnd - pieceStart
    appendPiece(
      sliced,
      piece.kind === 'source'
        ? sourcePiece(piece.start + localStart, piece.start + localEnd)
        : insertPiece(piece.text.slice(localStart, localEnd))
    )
  }
  return Object.freeze(sliced)
}

function applyCandidateEdits(
  pieces: readonly CandidatePiece[],
  edits: readonly SourceEdit[]
): readonly CandidatePiece[] {
  const candidateLength = pieces.reduce(
    (length, piece) => length + pieceLength(piece),
    0
  )
  validateSourceEdits(candidateLength, edits)
  const next: CandidatePiece[] = []
  let cursor = 0
  for (const edit of edits) {
    for (const piece of slicePieces(pieces, cursor, edit.start)) {
      appendPiece(next, piece)
    }
    if (edit.insert.length > 0) {
      appendPiece(next, insertPiece(edit.insert))
    }
    cursor = edit.end
  }
  for (const piece of slicePieces(pieces, cursor, candidateLength)) {
    appendPiece(next, piece)
  }
  return Object.freeze(next)
}

function exactSourceEditsFromPieces(
  sourceLength: number,
  pieces: readonly CandidatePiece[]
): readonly SourceEdit[] {
  const edits: SourceEdit[] = []
  let sourceCursor = 0
  let insert = ''

  for (const piece of pieces) {
    if (piece.kind === 'insert') {
      insert += piece.text
      continue
    }
    if (piece.start < sourceCursor) {
      throw new Error('Source candidate provenance is not monotone')
    }
    if (piece.start > sourceCursor || insert.length > 0) {
      edits.push(Object.freeze({
        start: sourceCursor,
        end: piece.start,
        insert
      }))
      insert = ''
    }
    sourceCursor = piece.end
  }
  if (sourceCursor < sourceLength || insert.length > 0) {
    edits.push(Object.freeze({
      start: sourceCursor,
      end: sourceLength,
      insert
    }))
  }
  return Object.freeze(edits)
}

export function protectSourceCandidateDraft(
  source: string,
  draft: SourceCandidateDraft,
  protectionPositions: readonly number[],
  protectsIntroducedBom: boolean
): ProtectedSourceCandidate {
  const distinctPositions = [...new Set(protectionPositions)].sort(
    (left, right) => left - right
  )
  let pieces = applyCandidateEdits(
    draft.pieces,
    distinctPositions.map((position) =>
      Object.freeze({ start: position, end: position, insert: '\\' })
    )
  )
  if (protectsIntroducedBom) {
    pieces = applyCandidateEdits(
      pieces,
      Object.freeze([{ start: 0, end: 1, insert: '&#xFEFF;' }])
    )
  }
  return Object.freeze({
    text: materializePieces(source, pieces),
    edits: exactSourceEditsFromPieces(source.length, pieces),
    accounting: Object.freeze({
      sourceUnits: source.length,
      editCount: draft.accounting.editCount,
      protectionCount:
        distinctPositions.length + (protectsIntroducedBom ? 1 : 0),
      physicalPieceCount: pieces.length
    })
  })
}
