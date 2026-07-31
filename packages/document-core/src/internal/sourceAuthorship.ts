import type { SourceEdit } from './session/sourceTransaction.js'
import type {
  CompleteDocumentRevision,
  CriticMarkupNode
} from '../revision.js'
/**
 * The one place MarkText decides which bytes it writes on a user's behalf.
 *
 * ADR-0015 rules that the engine authors no bytes the user did not type. A
 * projection edit is the exception it names: the user types *text*, so a
 * delimiter their text would otherwise assemble is escaped to encode what they
 * typed. That decision is narrow and auditable, so it lives here and nowhere
 * else — two copies previously disagreed on which closers they accept.
 */

/** A payload span the escape rule must copy through untouched. */
export interface OpaqueRange {
  readonly start: number
  readonly end: number
}

/** Every Profile 1 opener, in the order the escape rule probes them. */
export const CRITIC_OPENERS = Object.freeze([
  '{++',
  '{--',
  '{~~',
  '{==',
  '{>>'
])

/** Every Profile 1 closer a payload can be escaped against. */
export type CriticCloser = '++}' | '--}' | '~~}' | '==}' | '<<}'

export function mergeOpaqueRanges(ranges: readonly OpaqueRange[]): readonly OpaqueRange[] {
  const sorted = [...ranges].sort(
    (left, right) => left.start - right.start || left.end - right.end
  )
  const merged: OpaqueRange[] = []
  for (const range of sorted) {
    const previous = merged[merged.length - 1]
    if (previous !== undefined && range.start <= previous.end) {
      merged[merged.length - 1] = Object.freeze({
        start: previous.start,
        end: Math.max(previous.end, range.end)
      })
    } else {
      merged.push(Object.freeze({ start: range.start, end: range.end }))
    }
  }
  return Object.freeze(merged)
}

export function escapeCriticPayload(
  payload: string,
  close: CriticCloser,
  escapeSubstitutionSeparator: boolean,
  opaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  const ranges = mergeOpaqueRanges(opaqueRanges)
  const result: string[] = []
  const closePrefix = close.slice(0, -1)
  let opaqueIndex = 0
  let literalStart = 0

  const replace = (
    start: number,
    end: number,
    replacement: string
  ): void => {
    if (literalStart < start) {
      result.push(payload.slice(literalStart, start))
    }
    result.push(replacement)
    literalStart = end
  }

  for (let index = 0; index < payload.length;) {
    while ((ranges[opaqueIndex]?.end ?? Infinity) <= index) {
      opaqueIndex += 1
    }
    const opaque = ranges[opaqueIndex]
    if (opaque !== undefined && opaque.start <= index) {
      index = opaque.end
      continue
    }
    const lookaheadEnd = opaque?.start ?? payload.length

    let targetStart = index
    while (
      targetStart < lookaheadEnd &&
      payload[targetStart] === '\\'
    ) {
      targetStart += 1
    }
    const slashCount = targetStart - index
    const opener = CRITIC_OPENERS.find((candidate) =>
      payload.startsWith(candidate, targetStart)
    )
    const target =
      opener ??
      (
        escapeSubstitutionSeparator &&
        payload.startsWith('~>', targetStart)
          ? '~>'
          : undefined
      )
    if (
      target !== undefined &&
      targetStart + target.length <= lookaheadEnd
    ) {
      const end = targetStart + target.length
      replace(index, end, `${'\\'.repeat(slashCount * 2 + 1)}${target}`)
      index = end
      continue
    }
    if (slashCount > 0) {
      index = targetStart
      continue
    }

    if (
      index + closePrefix.length <= lookaheadEnd &&
      payload.startsWith(closePrefix, index)
    ) {
      let brace = index + closePrefix.length
      while (brace < lookaheadEnd && payload[brace] === '\\') {
        brace += 1
      }
      if (brace < lookaheadEnd && payload[brace] === '}') {
        const literalSlashes = brace - index - closePrefix.length
        const end = brace + 1
        replace(
          index,
          end,
          `${closePrefix}${'\\'.repeat(literalSlashes * 2 + 1)}}`
        )
        index = end
        continue
      }
    }
    index += 1
  }

  if (literalStart < payload.length) {
    result.push(payload.slice(literalStart))
  }
  return result.join('')
}

/**
 * §2 source authorship: every CriticMarkup marker production writes is
 * composed here — spelling, payload escape, and divider in one place. No
 * caller spells a marker or wires the escape rule inline.
 */
export function composeAdditionMarkup(
  content: string,
  opaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  return `{++${escapeCriticPayload(
    content,
    '++}',
    false,
    opaqueRanges
  )}++}`
}

export function composeDeletionMarkup(
  content: string,
  opaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  return `{--${escapeCriticPayload(
    content,
    '--}',
    false,
    opaqueRanges
  )}--}`
}

export function composeHighlightMarkup(
  content: string,
  opaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  return `{==${escapeCriticPayload(
    content,
    '==}',
    false,
    opaqueRanges
  )}==}`
}

export function composeUnaryMarkup(
  kind: 'addition' | 'deletion' | 'highlight',
  content: string,
  opaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  return kind === 'addition'
    ? composeAdditionMarkup(content, opaqueRanges)
    : kind === 'deletion'
      ? composeDeletionMarkup(content, opaqueRanges)
      : composeHighlightMarkup(content, opaqueRanges)
}

export function composeSubstitutionMarkup(
  oldContent: string,
  newContent: string,
  oldOpaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  return `{~~${escapeCriticPayload(
    oldContent,
    '~~}',
    true,
    oldOpaqueRanges
  )}~>${escapeCriticPayload(newContent, '~~}', true)}~~}`
}

export function composeCommentMarkup(comment: string): string {
  return `{>>${comment}<<}`
}

/**
 * The Highlight-anchored Comment pair. Returns the escaped anchor beside the
 * composed text so a caller recording an expectation never re-escapes it.
 */
export function composeCommentPairMarkup(
  anchorContent: string,
  comment: string,
  opaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): Readonly<{ readonly anchor: string; readonly text: string }> {
  const anchor = escapeCriticPayload(
    anchorContent,
    '==}',
    false,
    opaqueRanges
  )
  return Object.freeze({
    anchor,
    text: `{==${anchor}==}${composeCommentMarkup(comment)}`
  })
}

/*
 * §2 protect(revision-draft, edits): candidate drafting and changed-join
 * protection live beside the escape rule and marker composition they apply —
 * one authorship module, not a second file answering half the concern.
 */

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

/*
 * §2 Track Changes carrier decision: which CriticMarkup carrier owns an edit
 * position, and how authored bytes must be escaped for it. Derived here from
 * the parser's retained graph — no caller restates the closer table or the
 * deepest-carrier rule.
 */
export type TrackCarrierPolicy = 'plain' | 'direct' | 'stable' | 'read-only'

export interface TrackCarrierContext {
  readonly policy: TrackCarrierPolicy
  readonly node?: CriticMarkupNode
  readonly arm?: CriticMarkupNode['arms'][number]
  readonly depth: number
}

function carrierClose(
  context: TrackCarrierContext
): '++}' | '~~}' | '==}' | '--}' | '<<}' | null {
  if (context.node?.kind === 'addition') {
    return '++}'
  }
  if (context.node?.kind === 'substitution') {
    return '~~}'
  }
  if (context.node?.kind === 'highlight') {
    return '==}'
  }
  if (context.node?.kind === 'deletion') {
    return '--}'
  }
  if (context.node?.kind === 'comment') {
    return '<<}'
  }
  return null
}

export function escapeDirectCarrierText(
  text: string,
  context: TrackCarrierContext
): string {
  const close = carrierClose(context)
  return close === null
    ? text
    : escapeCriticPayload(
      text,
      close,
      context.node?.kind === 'substitution'
    )
}

export function trackCarrierContext(
  revision: CompleteDocumentRevision,
  start: number,
  end: number
): TrackCarrierContext {
  const contains = (
    range: CriticMarkupNode['arms'][number]['range']
  ): boolean =>
    start >= Number(range.start) && end <= Number(range.end)
  const deepest = new Map<
    Exclude<TrackCarrierPolicy, 'plain'>,
    TrackCarrierContext
  >()
  const pending: Array<Readonly<{
    node: CriticMarkupNode
    depth: number
  }>> = []
  for (
    let index = revision.criticMarkup.rootCount - 1;
    index >= 0;
    index -= 1
  ) {
    pending.push({ node: revision.criticMarkup.rootAt(index), depth: 0 })
  }
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) {
      continue
    }
    for (
      let armIndex = current.node.arms.length - 1;
      armIndex >= 0;
      armIndex -= 1
    ) {
      const arm = current.node.arms[armIndex]
      if (arm === undefined) {
        continue
      }
      if (!contains(arm.range)) {
        continue
      }
      let policy: Exclude<TrackCarrierPolicy, 'plain'> | undefined
      if (current.node.kind === 'addition' && arm.name === 'content') {
        policy = 'direct'
      } else if (current.node.kind === 'highlight' && arm.name === 'content') {
        policy = 'stable'
      } else if (current.node.kind === 'deletion' && arm.name === 'content') {
        policy = 'read-only'
      } else if (current.node.kind === 'substitution') {
        policy = arm.name === 'new' ? 'direct' : 'read-only'
      }
      const prior = policy === undefined ? undefined : deepest.get(policy)
      if (policy !== undefined && (prior === undefined || current.depth > prior.depth)) {
        deepest.set(policy, Object.freeze({
          depth: current.depth,
          policy,
          node: current.node,
          arm
        }))
      }
      for (
        let childIndex = arm.children.length - 1;
        childIndex >= 0;
        childIndex -= 1
      ) {
        const child = arm.children[childIndex]
        if (child !== undefined) {
          pending.push({ node: child, depth: current.depth + 1 })
        }
      }
    }
  }
  return (
    deepest.get('read-only') ??
    deepest.get('direct') ??
    deepest.get('stable') ??
    Object.freeze({ policy: 'plain' as const, depth: -1 })
  )
}

