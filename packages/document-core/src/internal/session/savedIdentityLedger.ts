import type { SourceHashV1 } from '../../hashCodec.js'

/**
 * The section 2 saved-identity module: one owner of the identity by which a
 * revision is recognized as the one on disk.
 *
 * Each recorded history position carries an opaque identity string and the
 * content hash of the canonical source it held. Dirty state is a comparison
 * THIS module performs — content-addressed, never a position comparison — so
 * a document edited back to the bytes on disk is clean however history
 * reached them, and a divergent replay is dirty even when the cursor returns
 * to where it was saved. A saved position compacted out of history has
 * unknowable content, so the head is dirty.
 *
 * Callers transport identities opaquely: minting, validation, and the dirty
 * comparison never leave this module.
 */
export interface SavedIdentityLedger {
  /** The identity at a history position (0 is the opened base). */
  readonly identityAt: (position: number) => string
  /** Mint a fresh identity and hash for a newly recorded position. */
  readonly record: (position: number, sourceHash: SourceHashV1) => void
  /**
   * Re-mint the identity at an existing position whose recorded state was
   * rewritten in place — an extended typed run. Earlier positions,
   * including any saved one, are untouched.
   */
  readonly replace: (position: number, sourceHash: SourceHashV1) => void
  /** Drop the oldest position after history compaction. */
  readonly shift: () => void
  /** Content-addressed dirty comparison against the saved position. */
  readonly dirty: (currentSourceHash: SourceHashV1) => boolean
  readonly savedIdentity: () => string
  /**
   * Accept a persisted head identity. Validation is this module's:
   * the identity must be one this session could have minted.
   *
   * @throws TypeError when the identity is not session-owned.
   */
  readonly markPersisted: (headIdentity: string) => void
  /** Serialized state for the durable checkpoint. */
  readonly checkpoint: () => Readonly<{
    identities: readonly string[]
    sourceHashes: readonly SourceHashV1[]
    sequence: number
    savedIdentity: string
  }>
}

export function createSavedIdentityLedger(
  session: string,
  initial:
    | Readonly<{ kind: 'opened'; sourceHash: SourceHashV1 }>
    | Readonly<{
      kind: 'recovered'
      identities: readonly string[]
      sourceHashes: readonly SourceHashV1[]
      sequence: number
      savedIdentity: string
    }>
): SavedIdentityLedger {
  const prefix = `${session}:history:`
  let identities: string[]
  let sourceHashes: SourceHashV1[]
  let sequence: number
  let savedIdentity: string
  if (initial.kind === 'opened') {
    const opened = `${prefix}0`
    identities = [opened]
    sourceHashes = [initial.sourceHash]
    sequence = 0
    savedIdentity = opened
  } else {
    identities = [...initial.identities]
    sourceHashes = [...initial.sourceHashes]
    sequence = initial.sequence
    savedIdentity = initial.savedIdentity
  }

  const mint = (): string => {
    sequence += 1
    return `${prefix}${String(sequence)}`
  }

  return Object.freeze({
    identityAt: (position: number): string => {
      const identity = identities[position]
      if (identity === undefined) {
        throw new Error('Revision worker has no current history identity')
      }
      return identity
    },
    record: (position: number, sourceHash: SourceHashV1): void => {
      identities = identities.slice(0, position)
      sourceHashes = sourceHashes.slice(0, position)
      identities.push(mint())
      sourceHashes.push(sourceHash)
    },
    replace: (position: number, sourceHash: SourceHashV1): void => {
      identities[position] = mint()
      sourceHashes[position] = sourceHash
    },
    shift: (): void => {
      identities.shift()
      sourceHashes.shift()
    },
    dirty: (currentSourceHash: SourceHashV1): boolean => {
      const savedIndex = identities.indexOf(savedIdentity)
      const savedSourceHash =
        savedIndex === -1 ? undefined : sourceHashes[savedIndex]
      return savedSourceHash !== currentSourceHash
    },
    savedIdentity: (): string => savedIdentity,
    markPersisted: (headIdentity: string): void => {
      const persistedSequence = Number(headIdentity.slice(prefix.length))
      if (
        !headIdentity.startsWith(prefix) ||
        !Number.isInteger(persistedSequence) ||
        persistedSequence < 0 ||
        persistedSequence > sequence
      ) {
        throw new TypeError(
          'Persisted history identity is not owned by this session'
        )
      }
      savedIdentity = headIdentity
    },
    checkpoint: () => Object.freeze({
      identities: Object.freeze([...identities]),
      sourceHashes: Object.freeze([...sourceHashes]),
      sequence,
      savedIdentity
    })
  })
}
