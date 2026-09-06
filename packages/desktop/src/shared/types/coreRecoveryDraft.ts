/** A recoverable view draft, never an input to canonical save or actor replay. */
export interface CoreRecoveryDraftInput {
  readonly documentId: string
  readonly pathname?: string
  readonly generation: number
  readonly revision: number
  readonly reason: string
  readonly visibleText: string
  readonly nativeState: unknown
  readonly nativeIntent: unknown
  readonly acknowledgedView: unknown
}

export interface CoreRecoveryDraftRecord extends CoreRecoveryDraftInput {
  readonly id: string
  readonly createdAt: string
  readonly artifactPath: string
  readonly readError?: string
}
