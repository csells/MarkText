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

function slicedPiece(
  piece: CandidatePiece,
  start: number,
  end: number
): CandidatePiece {
  return piece.kind === 'source'
    ? sourcePiece(piece.start + start, piece.start + end)
    : insertPiece(piece.text.slice(start, end))
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
  let candidateOffset = 0
  let pieceIndex = 0
  let pieceOffset = 0
  const advanceTo = (target: number, retain: boolean): void => {
    while (candidateOffset < target) {
      const piece = pieces[pieceIndex]
      if (piece === undefined) {
        throw new Error('Source candidate pieces do not cover their text')
      }
      const length = pieceLength(piece)
      const consumed = Math.min(
        target - candidateOffset,
        length - pieceOffset
      )
      if (retain) {
        appendPiece(
          next,
          slicedPiece(piece, pieceOffset, pieceOffset + consumed)
        )
      }
      candidateOffset += consumed
      pieceOffset += consumed
      if (pieceOffset === length) {
        pieceIndex += 1
        pieceOffset = 0
      }
    }
  }
  for (const edit of edits) {
    advanceTo(edit.start, true)
    advanceTo(edit.end, false)
    if (edit.insert.length > 0) {
      appendPiece(next, insertPiece(edit.insert))
    }
  }
  advanceTo(candidateLength, true)
  return Object.freeze(next)
}

function exactSourceEditsFromPieces(
  sourceLength: number,
  pieces: readonly CandidatePiece[]
): readonly SourceEdit[] {
  const edits: SourceEdit[] = []
  let sourceCursor = 0
  let insertParts: string[] = []

  for (const piece of pieces) {
    if (piece.kind === 'insert') {
      insertParts.push(piece.text)
      continue
    }
    if (piece.start < sourceCursor) {
      throw new Error('Source candidate provenance is not monotone')
    }
    if (piece.start > sourceCursor || insertParts.length > 0) {
      edits.push(Object.freeze({
        start: sourceCursor,
        end: piece.start,
        insert: insertParts.join('')
      }))
      insertParts = []
    }
    sourceCursor = piece.end
  }
  if (sourceCursor < sourceLength || insertParts.length > 0) {
    edits.push(Object.freeze({
      start: sourceCursor,
      end: sourceLength,
      insert: insertParts.join('')
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
  const distinctPositions: number[] = []
  let previousPosition = -1
  for (const position of protectionPositions) {
    if (
      !Number.isSafeInteger(position) ||
      position < previousPosition ||
      position > draft.text.length
    ) {
      throw new RangeError('Protection positions must be ordered positions')
    }
    if (position !== previousPosition) distinctPositions.push(position)
    previousPosition = position
  }
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
