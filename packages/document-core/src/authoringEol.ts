export type AuthoringEolToken = '\n' | '\r' | '\r\n'

export interface AuthoringSourceOwner {
  readonly start: number
  readonly end: number
}

export interface AuthoringEolDecisionV1 {
  readonly policy: 'nearest-owner-eol-v1'
  readonly token: AuthoringEolToken
  readonly source:
    | 'owner-preceding'
    | 'owner-following'
    | 'document-preference'
  readonly documentPreference: AuthoringEolToken
}

interface EolOccurrence {
  readonly start: number
  readonly end: number
  readonly token: AuthoringEolToken
}

function assertOffset(value: number, name: string, sourceLength: number): void {
  if (!Number.isInteger(value) || value < 0 || value > sourceLength) {
    throw new RangeError(`${name} is outside the canonical source`)
  }
}

function lineEndings(source: string): readonly EolOccurrence[] {
  const occurrences: EolOccurrence[] = []
  for (let offset = 0; offset < source.length; offset += 1) {
    const unit = source[offset]
    if (unit === '\r') {
      const token = source[offset + 1] === '\n' ? '\r\n' : '\r'
      occurrences.push(Object.freeze({
        start: offset,
        end: offset + token.length,
        token
      }))
      offset += token.length - 1
    } else if (unit === '\n') {
      occurrences.push(Object.freeze({
        start: offset,
        end: offset + 1,
        token: '\n'
      }))
    }
  }
  return Object.freeze(occurrences)
}

function preferredDocumentEol(
  occurrences: readonly EolOccurrence[]
): AuthoringEolToken {
  if (occurrences.length === 0) {
    return '\n'
  }
  const counts = new Map<AuthoringEolToken, number>([
    ['\r\n', 0],
    ['\r', 0],
    ['\n', 0]
  ])
  for (const occurrence of occurrences) {
    counts.set(occurrence.token, (counts.get(occurrence.token) ?? 0) + 1)
  }
  const maximum = Math.max(...counts.values())
  return occurrences.find(
    (occurrence) => counts.get(occurrence.token) === maximum
  )?.token ?? '\n'
}

/**
 * Choose one spelling for a newly synthesized line break.
 *
 * The function only reads canonical source. It never rewrites retained text
 * and treats CRLF as one token, so the recorded result can travel with a
 * transaction and never be recomputed during retry, undo, or recovery.
 */
export function chooseAuthoringEolV1(
  source: string,
  owner: AuthoringSourceOwner,
  position: number
): AuthoringEolDecisionV1 {
  if (typeof source !== 'string') {
    throw new TypeError('Canonical source must be a string')
  }
  assertOffset(owner.start, 'Owner start', source.length)
  assertOffset(owner.end, 'Owner end', source.length)
  if (owner.start > owner.end) {
    throw new RangeError('Owner start must not follow owner end')
  }
  assertOffset(position, 'Authoring position', source.length)
  if (position < owner.start || position > owner.end) {
    throw new RangeError('Authoring position is outside its source owner')
  }

  const occurrences = lineEndings(source)
  const documentPreference = preferredDocumentEol(occurrences)
  const owned = occurrences.filter(
    (occurrence) =>
      occurrence.start >= owner.start &&
      occurrence.end <= owner.end
  )
  let preceding: EolOccurrence | undefined
  for (let index = owned.length - 1; index >= 0; index -= 1) {
    const occurrence = owned[index]
    if (occurrence !== undefined && occurrence.end <= position) {
      preceding = occurrence
      break
    }
  }
  if (preceding !== undefined) {
    return Object.freeze({
      policy: 'nearest-owner-eol-v1' as const,
      token: preceding.token,
      source: 'owner-preceding' as const,
      documentPreference
    })
  }
  const following = owned.find(
    (occurrence) => occurrence.start >= position
  )
  if (following !== undefined) {
    return Object.freeze({
      policy: 'nearest-owner-eol-v1' as const,
      token: following.token,
      source: 'owner-following' as const,
      documentPreference
    })
  }
  return Object.freeze({
    policy: 'nearest-owner-eol-v1' as const,
    token: documentPreference,
    source: 'document-preference' as const,
    documentPreference
  })
}
