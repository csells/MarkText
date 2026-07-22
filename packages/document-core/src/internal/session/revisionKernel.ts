import type { LanguageEngine } from '../../languageEngine.js'
import type { RevisionId } from '../../documentSession.js'
import type { CompleteDocumentRevision } from '../../revision.js'
import { createSourceSnapshot } from '../../sourceSnapshot.js'
import { createRevisionTransition, type RevisionTransition } from './revisionTransition.js'
import { applySourceEdit, type SourceEdit } from './sourceTransaction.js'

export interface PreparedRevision {
  readonly revision: CompleteDocumentRevision
  readonly transition: RevisionTransition
}

export interface RevisionIdentityPair {
  readonly base: RevisionId
  readonly next: RevisionId
}

/** Package-private source transaction seam. Never export from the package root. */
export class RevisionKernel {
  readonly #engine: LanguageEngine

  constructor(engine: LanguageEngine) {
    this.#engine = engine
  }

  revise(
    previous: CompleteDocumentRevision,
    edit: SourceEdit,
    identity: RevisionIdentityPair
  ): PreparedRevision {
    const transaction = applySourceEdit(previous.source.text, edit)
    const revision = this.#engine.open(
      createSourceSnapshot(transaction.source),
      previous.configuration
    )
    if (revision.kind !== 'complete') {
      throw new Error('Source transaction exceeded the active parse budget')
    }

    const transition = createRevisionTransition(
      identity.base,
      identity.next,
      previous,
      revision,
      transaction.edit,
      transaction.inverse
    )
    return Object.freeze({ revision, transition })
  }
}
