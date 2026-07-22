import type { SourceOffset, SourceRange } from '../../revision.js'

export type Profile1CriticKind =
  | 'addition'
  | 'deletion'
  | 'substitution'
  | 'highlight'
  | 'comment'

export type MarkerRole = 'open' | 'separator' | 'close'

export type TapeRole =
  | 'text'
  | 'virtual-bom'
  | 'eol-lf'
  | 'eol-cr'
  | 'eol-crlf'
  | `candidate-${Profile1CriticKind}-${MarkerRole}`

export interface FormDefinition {
  readonly kind: Profile1CriticKind
  readonly open: string
  readonly separator?: string
  readonly close: string
}

export interface TapeRun {
  readonly id: number
  readonly role: TapeRole
  readonly range: SourceRange
}

export interface RetainedMarkerCandidate {
  readonly kind: Profile1CriticKind
  readonly role: MarkerRole
  readonly range: SourceRange
}

export interface OpenMarkerDecision {
  readonly kind: Profile1CriticKind
  readonly role: 'open'
  readonly runId: number
  readonly range: SourceRange
  readonly parentOpenRunId: number | null
}

export interface SeparatorMarkerDecision {
  readonly kind: 'substitution'
  readonly role: 'separator'
  readonly runId: number
  readonly range: SourceRange
  readonly openerRunId: number
}

export interface CloseMarkerDecision {
  readonly kind: Profile1CriticKind
  readonly role: 'close'
  readonly runId: number
  readonly range: SourceRange
  readonly action: 'matched' | 'non-top' | 'unmatched'
  readonly openerRunId?: number
  readonly topOpenRunId?: number
}

export type CanonicalMarkerDecision =
  | OpenMarkerDecision
  | SeparatorMarkerDecision
  | CloseMarkerDecision

export const FORM_DEFINITIONS: readonly FormDefinition[] = Object.freeze([
  Object.freeze({ kind: 'addition', open: '{++', close: '++}' }),
  Object.freeze({ kind: 'deletion', open: '{--', close: '--}' }),
  Object.freeze({ kind: 'substitution', open: '{~~', separator: '~>', close: '~~}' }),
  Object.freeze({ kind: 'highlight', open: '{==', close: '==}' }),
  Object.freeze({ kind: 'comment', open: '{>>', close: '<<}' })
])

function sourceOffset(value: number): SourceOffset {
  return value as SourceOffset
}

function sourceRange(start: number, end: number): SourceRange {
  return Object.freeze({ start: sourceOffset(start), end: sourceOffset(end) })
}

function startsWithAt(source: string, marker: string, offset: number): boolean {
  if (offset + marker.length > source.length) {
    return false
  }
  for (let markerOffset = 0; markerOffset < marker.length; markerOffset += 1) {
    if (source.charCodeAt(offset + markerOffset) !== marker.charCodeAt(markerOffset)) {
      return false
    }
  }
  return true
}

export function findMarker(
  source: string,
  offset: number
): Readonly<{ definition: FormDefinition; role: MarkerRole; length: number }> | undefined {
  for (const definition of FORM_DEFINITIONS) {
    if (startsWithAt(source, definition.open, offset)) {
      return Object.freeze({ definition, role: 'open' as const, length: definition.open.length })
    }
    if (startsWithAt(source, definition.close, offset)) {
      return Object.freeze({ definition, role: 'close' as const, length: definition.close.length })
    }
    if (
      definition.separator !== undefined &&
      startsWithAt(source, definition.separator, offset)
    ) {
      return Object.freeze({
        definition,
        role: 'separator' as const,
        length: definition.separator.length
      })
    }
  }
  return undefined
}

export function isMarkdownTextTapeRole(role: TapeRole): boolean {
  return role === 'text' || role === 'virtual-bom' || role.startsWith('eol-')
}

export function markerCandidateFromRole(
  role: TapeRole
): Readonly<{ kind: Profile1CriticKind; role: MarkerRole }> | undefined {
  if (!role.startsWith('candidate-')) {
    return undefined
  }
  const markerRoleSeparator = role.lastIndexOf('-')
  return Object.freeze({
    kind: role.slice('candidate-'.length, markerRoleSeparator) as Profile1CriticKind,
    role: role.slice(markerRoleSeparator + 1) as MarkerRole
  })
}

export function scanSourceTape(
  source: string,
  retainedCandidates?: readonly RetainedMarkerCandidate[]
): readonly TapeRun[] {
  const tape: TapeRun[] = []
  const retainedByStart =
    retainedCandidates === undefined
      ? undefined
      : new Map<number, RetainedMarkerCandidate>(retainedCandidates.map((candidate) => [
        candidate.range.start,
        candidate
      ]))
  let textStart = 0
  let offset = 0

  const append = (role: TapeRole, start: number, end: number): void => {
    if (start === end) {
      return
    }
    tape.push(Object.freeze({
      id: tape.length,
      role,
      range: sourceRange(start, end)
    }))
  }
  const appendText = (end: number): void => {
    append('text', textStart, end)
  }

  while (offset < source.length) {
    if (offset === 0 && source.charCodeAt(offset) === 0xfeff) {
      appendText(offset)
      append('virtual-bom', offset, offset + 1)
      offset += 1
      textStart = offset
      continue
    }
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 10 || codeUnit === 13) {
      appendText(offset)
      const isCrLf =
        codeUnit === 13 &&
        offset + 1 < source.length &&
        source.charCodeAt(offset + 1) === 10
      const end = offset + (isCrLf ? 2 : 1)
      append(isCrLf ? 'eol-crlf' : codeUnit === 13 ? 'eol-cr' : 'eol-lf', offset, end)
      offset = end
      textStart = end
      continue
    }
    const retained = retainedByStart?.get(offset)
    const marker = retainedByStart === undefined ? findMarker(source, offset) : undefined
    if (retained === undefined && marker === undefined) {
      offset += 1
      continue
    }

    appendText(offset)
    const end = retained?.range.end ?? offset + (marker?.length ?? 0)
    append(
      `candidate-${retained?.kind ?? marker?.definition.kind}-${retained?.role ?? marker?.role}` as TapeRole,
      offset,
      end
    )
    offset = end
    textStart = end
  }

  appendText(source.length)
  return Object.freeze(tape)
}

export function assertLosslessTape(source: string, tape: readonly TapeRun[]): void {
  let nextOffset = 0
  for (let ordinal = 0; ordinal < tape.length; ordinal += 1) {
    const run = tape[ordinal]
    if (
      run === undefined ||
      run.id !== ordinal ||
      run.range.start !== nextOffset ||
      run.range.end <= run.range.start
    ) {
      throw new Error('Profile 1 scanner produced a non-lossless source tape')
    }
    nextOffset = run.range.end
  }
  if (nextOffset !== source.length) {
    throw new Error('Profile 1 scanner left source code units unowned')
  }
}
