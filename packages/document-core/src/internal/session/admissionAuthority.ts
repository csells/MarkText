import {
  inspectLanguageEngineChangedCriticMarkerJoins,
  type LanguageEngine
} from '../../languageEngine.js'
import type {
  CompleteDocumentRevision,
  DiagnosticIndex,
  DocumentRevision
} from '../../revision.js'
import { createSourceSnapshot } from '../../sourceSnapshot.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from '../../resourcePolicy.js'
import { applyExactSourceEdits } from '../../exactSourceEdits.js'
import {
  buildSourceCandidateDraft,
  protectSourceCandidateDraft
} from '../sourceAuthorship.js'
import type { SourceEdit } from './sourceTransaction.js'

/**
 * §2 admission authority: `admit(base, edits, class)` is the one path that
 * turns source edits into a candidate revision. It owns edit validation,
 * resource limits, inverse derivation, and the postcondition proof, and it is
 * the only caller of the language engine's `reopen` — nothing else turns
 * edits into a revision. The class is an ordinary discriminated argument,
 * never inferred from an argument's presence.
 */
export type AdmissionClass =
  | Readonly<{ readonly kind: 'typed-gesture' }>
  | Readonly<{
    readonly kind: 'proven-candidate'
    readonly revision: DocumentRevision
  }>
  | Readonly<{ readonly kind: 'exact-replay' }>

export const TYPED_GESTURE: AdmissionClass =
  Object.freeze({ kind: 'typed-gesture' })
export const EXACT_REPLAY: AdmissionClass =
  Object.freeze({ kind: 'exact-replay' })

export type AdmissionRejectionClass =
  | 'invalid-command-argument'
  | 'no-source-change'

export interface AdmittedCandidate {
  readonly kind: 'admitted'
  readonly revision: DocumentRevision
  /** The exact candidate source the transaction proves. */
  readonly source: string
  /** The effective (possibly join-protected) edits, sorted and frozen. */
  readonly edits: readonly SourceEdit[]
  readonly inverseEdits: readonly SourceEdit[]
  /** The admitted diagnostics; absent for a source-only candidate. */
  readonly diagnostics: DiagnosticIndex | undefined
}

export interface RejectedAdmission {
  readonly kind: 'rejected'
  readonly class: AdmissionRejectionClass
}

export interface AdmissionAuthority {
  readonly admit: (
    base: DocumentRevision,
    edits: readonly SourceEdit[],
    admission: AdmissionClass
  ) => AdmittedCandidate | RejectedAdmission
}

interface AppliedSourceEdits {
  readonly source: string
  readonly edits: readonly SourceEdit[]
  readonly inverseEdits: readonly SourceEdit[]
}

function freezeSourceEdit(edit: SourceEdit): SourceEdit {
  return Object.freeze({
    start: edit.start,
    end: edit.end,
    insert: edit.insert
  })
}

function applySourceEdits(
  source: string,
  edits: readonly SourceEdit[],
  exactCandidateSource?: string
): AppliedSourceEdits {
  const stable = Object.freeze(edits.map((edit) => freezeSourceEdit(edit)))
  let previousEnd = 0
  for (const [index, edit] of stable.entries()) {
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > source.length ||
      (index > 0 && edit.start < previousEnd)
    ) {
      throw new RangeError('Source edits must be sorted and nonoverlapping')
    }
    previousEnd = edit.end
  }

  let nextSource = exactCandidateSource ?? source
  if (exactCandidateSource === undefined) {
    nextSource = applyExactSourceEdits(
      source,
      stable,
      'Session source edit'
    )
  }

  let delta = 0
  const inverseEdits = stable.map((edit): SourceEdit => {
    const start = edit.start + delta
    const end = start + edit.insert.length
    delta += edit.insert.length - (edit.end - edit.start)
    return Object.freeze({
      start,
      end,
      insert: source.slice(edit.start, edit.end)
    })
  })

  return Object.freeze({
    source: nextSource,
    edits: stable,
    inverseEdits: Object.freeze(inverseEdits)
  })
}

function protectChangedSourceJoins(
  engine: LanguageEngine,
  before: CompleteDocumentRevision,
  edits: readonly SourceEdit[]
): Readonly<{
    readonly transaction: AppliedSourceEdits
    readonly revision: DocumentRevision
  }> {
  const draft = buildSourceCandidateDraft(before.source.text, edits)
  const inspection = inspectLanguageEngineChangedCriticMarkerJoins(
    engine,
    createSourceSnapshot(draft.text),
    before.configuration,
    draft.joins
  )
  if (inspection.kind === 'source-only') {
    const revision = engine.reopen(
      before,
      createSourceSnapshot(draft.text),
      edits
    )
    return Object.freeze({
      transaction: applySourceEdits(before.source.text, edits, draft.text),
      revision
    })
  }

  const protectionPositions = inspection.protectionPositions
  const protectsIntroducedBom =
    draft.text.startsWith('\uFEFF') &&
    !before.source.text.startsWith('\uFEFF')
  if (protectionPositions.length === 0 && !protectsIntroducedBom) {
    return Object.freeze({
      transaction: applySourceEdits(before.source.text, edits, draft.text),
      revision: engine.reopen(
        before,
        createSourceSnapshot(draft.text),
        edits
      )
    })
  }

  const protectedDraft = protectSourceCandidateDraft(
    before.source.text,
    draft,
    protectionPositions,
    protectsIntroducedBom
  )
  const revision = engine.reopen(
    before,
    createSourceSnapshot(protectedDraft.text),
    protectedDraft.edits
  )
  return Object.freeze({
    transaction: applySourceEdits(
      before.source.text,
      protectedDraft.edits,
      protectedDraft.text
    ),
    revision
  })
}

export function createAdmissionAuthority(
  engine: LanguageEngine
): AdmissionAuthority {
  const admit = (
    base: DocumentRevision,
    edits: readonly SourceEdit[],
    admission: AdmissionClass
  ): AdmittedCandidate | RejectedAdmission => {
    if (
      edits.length >
      DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction
    ) {
      return Object.freeze({
        kind: 'rejected',
        class: 'invalid-command-argument'
      } as const)
    }
    let insertUnits = 0
    for (const edit of edits) {
      insertUnits += edit.insert.length
      if (
        edit.insert.length >
          DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits ||
        insertUnits > DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
      ) {
        return Object.freeze({
          kind: 'rejected',
          class: 'invalid-command-argument'
        } as const)
      }
    }
    let effectiveEdits = edits
    let protectedTransaction: AppliedSourceEdits | undefined
    let protectedRevision: DocumentRevision | undefined
    // A typed source gesture may assemble a CriticMarkup delimiter across one
    // of its changed joins even when neither side was syntax before. Protect
    // exactly those newly classified joins before the candidate is published.
    // TransformationKernel revisions already carry this proof themselves.
    if (admission.kind === 'typed-gesture' && base.kind === 'complete') {
      const protected_ = protectChangedSourceJoins(engine, base, edits)
      effectiveEdits = protected_.transaction.edits
      protectedTransaction = protected_.transaction
      protectedRevision = protected_.revision
    }
    const transaction =
      protectedTransaction ??
      applySourceEdits(base.source.text, effectiveEdits)
    // One gesture, one entry, exact undo: a candidate byte-identical to its
    // base corresponds to no gesture, so it mints no revision and records no
    // history — it rejects visibly instead (G27, non-negotiable 10). Replays
    // are exempt: their bytes were proved when first admitted.
    if (
      admission.kind !== 'exact-replay' &&
      transaction.source === base.source.text
    ) {
      return Object.freeze({
        kind: 'rejected',
        class: 'no-source-change'
      } as const)
    }
    const revision =
      (admission.kind === 'proven-candidate'
        ? admission.revision
        : undefined) ??
      protectedRevision ??
      engine.reopen(
        base,
        createSourceSnapshot(transaction.source),
        effectiveEdits
      )
    if (revision.source.text !== transaction.source) {
      throw new Error(
        'Prepared revision does not match its exact source-edit transaction'
      )
    }
    return Object.freeze({
      kind: 'admitted',
      revision,
      source: transaction.source,
      edits: transaction.edits,
      inverseEdits: transaction.inverseEdits,
      diagnostics:
        revision.kind === 'complete' ? revision.diagnostics : undefined
    } as const)
  }
  return Object.freeze({ admit })
}
