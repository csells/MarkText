import type {
  EditorIntent,
  IntentId,
  PendingInputDraft,
  RevisionId,
  SessionOperationId,
  SessionTransitionId
} from '../../documentSession.js'
import type { SourceEdit } from './sourceTransaction.js'
import type { RevisionTransition } from './revisionTransition.js'

interface JournalRecord {
  readonly kind: 'ingress' | 'commit' | 'operation'
  readonly payload: string
  readonly checksum: string
}

function frame(fields: readonly string[]): string {
  return fields.map((field) => `${field.length}:${field}`).join('')
}

function checksumUtf16(payload: string): string {
  let checksum = 0x811c9dc5
  for (let offset = 0; offset < payload.length; offset += 1) {
    checksum = Math.imul(checksum ^ payload.charCodeAt(offset), 0x01000193)
  }
  return (checksum >>> 0).toString(16).padStart(8, '0')
}

function intentFields(intent: EditorIntent): readonly string[] {
  if (intent.kind !== 'insert-text') {
    return Object.freeze([intent.kind])
  }
  return Object.freeze([
    'insert-text',
    intent.target.session,
    intent.target.revision,
    intent.target.view,
    String(intent.target.anchor.offset),
    intent.target.anchor.affinity,
    String(intent.target.focus.offset),
    intent.target.focus.affinity,
    intent.text
  ])
}

function editFields(edit: SourceEdit): readonly string[] {
  return Object.freeze([String(edit.start), String(edit.end), edit.insert])
}

function retainedDraftFields(draft: PendingInputDraft): readonly string[] {
  return Object.freeze([
    draft.id,
    String(draft.ticketIds.length),
    ...draft.ticketIds,
    String(draft.sequence),
    draft.submittedAgainst,
    draft.status,
    String(draft.allowedActions.length),
    ...draft.allowedActions,
    draft.reason,
    ...intentFields({ kind: 'insert-text', target: draft.target, text: draft.text })
  ])
}

/**
 * Volatile Phase 0 ordering tracer. It proves append-before-observe ordering,
 * but deliberately makes no crash-durability claim.
 */
export class VolatileSessionJournal {
  readonly #records: JournalRecord[] = []

  async appendIngress(
    ticket: IntentId,
    sequence: number,
    base: RevisionId,
    intent: EditorIntent
  ): Promise<void> {
    await this.#append('ingress', [ticket, String(sequence), base, ...intentFields(intent)])
  }

  async appendCommit(
    ticket: IntentId,
    sequence: number,
    transition: SessionTransitionId,
    proof: RevisionTransition,
    source: string
  ): Promise<void> {
    await this.#append('commit', [
      ticket,
      String(sequence),
      transition,
      proof.base,
      proof.next,
      String(proof.edits.length),
      ...proof.edits.flatMap(editFields),
      String(proof.inverseEdits.length),
      ...proof.inverseEdits.flatMap(editFields),
      source
    ])
  }

  async appendOperation(
    operation: SessionOperationId,
    sequence: number,
    kind: string,
    revision: RevisionId
  ): Promise<void> {
    await this.#append('operation', [operation, String(sequence), kind, revision])
  }

  async appendDispatchOutcome(
    ticket: IntentId,
    sequence: number,
    outcome: 'noop' | 'rejected',
    revision: RevisionId,
    reason: string,
    retainedDraft?: PendingInputDraft,
    transition?: SessionTransitionId
  ): Promise<void> {
    await this.#append('operation', [
      ticket,
      String(sequence),
      `dispatch:${outcome}`,
      revision,
      reason,
      ...(retainedDraft === undefined || transition === undefined
        ? []
        : [transition, ...retainedDraftFields(retainedDraft)])
    ])
  }

  async #append(kind: JournalRecord['kind'], fields: readonly string[]): Promise<void> {
    await Promise.resolve()
    const payload = frame(fields)
    const checksum = checksumUtf16(payload)
    const record = Object.freeze({ kind, payload, checksum })
    if (checksumUtf16(record.payload) !== record.checksum) {
      throw new Error('Volatile session journal checksum mismatch')
    }
    this.#records.push(record)
  }
}
