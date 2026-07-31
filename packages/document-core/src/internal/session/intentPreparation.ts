import { classifyPasteConsumer } from '../../materialize/consumerPolicy.js'
import type { EditorIntent, RevisionId } from '../../documentSession.js'
import {
  IntentRejection,
  type PreparedWorkerCommit,
  type RevisionWorker
} from './revisionWorker.js'

type IntentOfKind<K extends EditorIntent['kind']> =
  Extract<EditorIntent, { kind: K }>

type PrepareAdapter<K extends EditorIntent['kind']> = (
  worker: RevisionWorker,
  intent: IntentOfKind<K>,
  next: RevisionId
) => PreparedWorkerCommit

/**
 * How an intent commits. A `revision` intent prepares a candidate revision
 * through the worker; a `session-state` intent mutates session-scoped state
 * (projection, track changes) and mints no revision, so it carries no
 * prepare adapter — the coordinator routes it to its dedicated commit.
 */
/**
 * Snapshot-evaluable preconditions an intent declares. Each names a fact
 * the capability snapshot can read from live session state before any
 * prepare runs; everything else an intent checks is prepare-only and never
 * predicted by the snapshot.
 */
export type SnapshotPrecondition =
  | 'marked-projection'
  | 'complete-revision'
  | 'undoable'
  | 'redoable'

type IntentPreparation<K extends EditorIntent['kind']> =
  | Readonly<{
    commitClass: 'revision'
    requires: readonly SnapshotPrecondition[]
    prepare: PrepareAdapter<K>
  }>
  | Readonly<{ commitClass: 'session-state' }>

const REVISION_REQUIRES: readonly SnapshotPrecondition[] =
  Object.freeze(['marked-projection'])

function revision<K extends EditorIntent['kind']>(
  prepare: PrepareAdapter<K>,
  requires: readonly SnapshotPrecondition[] = REVISION_REQUIRES
): IntentPreparation<K> {
  return Object.freeze({ commitClass: 'revision', requires, prepare })
}

const SESSION_STATE = Object.freeze({
  commitClass: 'session-state'
} as const)

/**
 * One preparation per union arm, keyed so a union arm without an entry — or
 * an entry without a union arm — is a compile error. The union stays the
 * single hand-written intent declaration; the coordinator's dispatch ladder
 * is this table.
 */
export const INTENT_PREPARATIONS: {
  readonly [K in EditorIntent['kind']]: IntentPreparation<K>
} = Object.freeze({
  // Typed insertions are the one coalescible admission: the History rule
  // may extend the open typed run instead of recording an entry.
  'insert-text': revision<'insert-text'>((worker, intent, next) =>
    worker.prepareInsertion(intent.target, intent.text, next, 'semantic', true)),
  'replace-text': revision<'replace-text'>((worker, intent, next) =>
    worker.prepareReplacement(intent.target, intent.text, next)),
  'replace-current-matches': revision<'replace-current-matches'>((worker, intent, next) =>
    worker.prepareCurrentMatchReplacement(
      intent.target,
      intent.query,
      intent.replacement,
      next
    )),
  'delete-text': revision<'delete-text'>((worker, intent, next) =>
    worker.prepareDeletion(intent.target, next)),
  'format-text': revision<'format-text'>((worker, intent, next) =>
    worker.prepareFormatting(intent.target, intent.format, next)),
  'replace-structure': revision<'replace-structure'>((worker, intent, next) =>
    worker.prepareStructureReplacement(intent.target, intent.replacement, next)),
  'convert-block': revision<'convert-block'>((worker, intent, next) =>
    worker.prepareBlockConversion(intent.target, intent.conversion, next)),
  'quick-insert-block': revision<'quick-insert-block'>((worker, intent, next) =>
    worker.prepareQuickInsertBlock(intent.target, intent.block, next)),
  'duplicate-block': revision<'duplicate-block'>((worker, intent, next) =>
    worker.prepareBlockDuplication(intent.target, next)),
  'delete-block': revision<'delete-block'>((worker, intent, next) =>
    worker.prepareBlockDeletion(intent.target, next)),
  'insert-paragraph': revision<'insert-paragraph'>((worker, intent, next) =>
    worker.prepareParagraphInsertion(intent.target, intent.location, next)),
  'insert-paragraph-break': revision<'insert-paragraph-break'>((worker, intent, next) =>
    worker.prepareSemanticBreak(intent.target, 'paragraph', next)),
  'insert-line-break': revision<'insert-line-break'>((worker, intent, next) =>
    worker.prepareSemanticBreak(intent.target, 'line', next)),
  'set-list-indentation': revision<'set-list-indentation'>((worker, intent, next) =>
    worker.prepareListIndentation(intent.target, intent.direction, next)),
  'set-task-checked': revision<'set-task-checked'>((worker, intent, next) =>
    worker.prepareTaskChecked(
      intent.target,
      intent.checked,
      intent.cascade,
      next
    )),
  'set-code-language': revision<'set-code-language'>((worker, intent, next) =>
    worker.prepareCodeLanguage(intent.target, intent.language, next)),
  'insert-link': revision<'insert-link'>((worker, intent, next) =>
    worker.prepareLinkInsertion(intent.target, intent.href, intent.title, next)),
  'insert-image': revision<'insert-image'>((worker, intent, next) =>
    worker.prepareImageInsertion(
      intent.target,
      {
        src: intent.src,
        alt: intent.alt,
        ...(intent.title === undefined ? {} : { title: intent.title })
      },
      next
    )),
  'insert-footnote': revision<'insert-footnote'>((worker, intent, next) =>
    worker.prepareFootnoteInsertion(
      intent.target,
      intent.label,
      intent.content,
      next
    )),
  'create-table': revision<'create-table'>((worker, intent, next) =>
    worker.prepareTableCreation(intent.target, intent.rows, intent.columns, next)),
  'insert-table-row': revision<'insert-table-row'>((worker, intent, next) =>
    worker.prepareTableRowInsertion(intent.target, intent.location, next)),
  'remove-table-row': revision<'remove-table-row'>((worker, intent, next) =>
    worker.prepareTableRowRemoval(intent.target, next)),
  'insert-table-column': revision<'insert-table-column'>((worker, intent, next) =>
    worker.prepareTableColumnInsertion(intent.target, intent.location, next)),
  'remove-table-column': revision<'remove-table-column'>((worker, intent, next) =>
    worker.prepareTableColumnRemoval(intent.target, next)),
  'align-table-column': revision<'align-table-column'>((worker, intent, next) =>
    worker.prepareTableColumnAlignment(intent.target, intent.alignment, next)),
  'move-table-row': revision<'move-table-row'>((worker, intent, next) =>
    worker.prepareTableRowMove(intent.target, intent.direction, next)),
  'move-table-column': revision<'move-table-column'>((worker, intent, next) =>
    worker.prepareTableColumnMove(intent.target, intent.direction, next)),
  'delete-table-cell-contents': revision<'delete-table-cell-contents'>((worker, intent, next) =>
    worker.prepareTableCellContentsDeletion(intent.target, next)),
  // The paste question — which payload flavors import raw syntax, which
  // are semantic edits, and which surface takes the bytes verbatim — is
  // answered by the consumer policy, never here. The coordinator's
  // projection guard already refused read-only views, so the disabled arm
  // is unreachable through dispatch; it stays refused for any future
  // caller that consults the policy directly.
  'paste-text': revision<'paste-text'>((worker, intent, next) => {
    const route = classifyPasteConsumer(worker.state.revision, {
      view: intent.target.view === 'source' ? 'source' : 'markup',
      payload: intent.payload
    })
    if (route.kind === 'disabled') {
      throw new IntentRejection('read-only-projection')
    }
    if (route.kind === 'semantic-html-edit') {
      throw new TypeError(
        'The paste intent carries no wire spelling for trusted HTML'
      )
    }
    return worker.preparePaste(
      intent.target,
      route.text,
      route.kind === 'raw-syntax-import' || route.kind === 'source-text-edit'
        ? 'raw-source-import'
        : 'external-text',
      next
    )
  }),
  'commit-composition': revision<'commit-composition'>((worker, intent, next) =>
    worker.prepareCompositionCommit(intent.target, intent.text, next)),
  'author-critic-markup': revision<'author-critic-markup'>((worker, intent, next) =>
    worker.prepareCriticMarkupAuthoring(intent.target, intent.input, next)),
  'reload-source-from-file': revision<'reload-source-from-file'>((worker, intent, next) =>
    worker.prepareSourceCommit(intent.source, next)),
  'edit-source': revision<'edit-source'>((worker, intent, next) =>
    worker.prepareSourceEdit(
      intent.target,
      intent.text,
      intent.selection,
      next
    )),
  'undo': revision<'undo'>(
    (worker, _intent, next) => worker.prepareUndo(next),
    Object.freeze(['marked-projection', 'undoable'])
  ),
  'redo': revision<'redo'>(
    (worker, _intent, next) => worker.prepareRedo(next),
    Object.freeze(['marked-projection', 'redoable'])
  ),
  'set-track-changes': SESSION_STATE,
  'set-projection': SESSION_STATE,
  'resolve-change': revision<'resolve-change'>(
    (worker, intent, next) => worker.prepareTransformation(intent, next),
    Object.freeze(['marked-projection', 'complete-revision'])
  ),
  'resolve-all-changes': revision<'resolve-all-changes'>(
    (worker, intent, next) => worker.prepareTransformation(intent, next),
    Object.freeze(['marked-projection', 'complete-revision'])
  ),
  'remove-highlight': revision<'remove-highlight'>(
    (worker, intent, next) => worker.prepareTransformation(intent, next),
    Object.freeze(['marked-projection', 'complete-revision'])
  ),
  'remove-all-annotations': revision<'remove-all-annotations'>(
    (worker, intent, next) => worker.prepareTransformation(intent, next),
    Object.freeze(['marked-projection', 'complete-revision'])
  ),
  'add-comment': revision<'add-comment'>(
    (worker, intent, next) => worker.prepareTransformation(intent, next),
    Object.freeze(['marked-projection', 'complete-revision'])
  ),
  'edit-comment': revision<'edit-comment'>(
    (worker, intent, next) => worker.prepareTransformation(intent, next),
    Object.freeze(['marked-projection', 'complete-revision'])
  ),
  'remove-comment': revision<'remove-comment'>(
    (worker, intent, next) => worker.prepareTransformation(intent, next),
    Object.freeze(['marked-projection', 'complete-revision'])
  )
})

export interface IntentCapabilityFacts {
  readonly projection: 'marked' | 'original' | 'revised'
  readonly revisionKind: 'complete' | 'source-only'
  readonly canUndo: boolean
  readonly canRedo: boolean
}

export type IntentCapability =
  | Readonly<{ enabled: true }>
  | Readonly<{
    enabled: false
    reason:
      | 'read-only-projection'
      | 'source-only-revision'
      | 'nothing-to-undo'
      | 'nothing-to-redo'
  }>

/**
 * One capability per union arm: the preconditions the intent declares,
 * folded against live session facts. `enabled: false` predicts the exact
 * rejection dispatch would return; `enabled: true` promises only that no
 * snapshot-evaluable precondition fails — prepare-only conditions still
 * decide at dispatch.
 */
export type IntentCapabilitySnapshot = Readonly<{
  [K in EditorIntent['kind']]: IntentCapability
}>

const ENABLED: IntentCapability = Object.freeze({ enabled: true })

function foldCapability(
  requires: readonly SnapshotPrecondition[],
  facts: IntentCapabilityFacts
): IntentCapability {
  for (const requirement of requires) {
    if (requirement === 'marked-projection' && facts.projection !== 'marked') {
      return Object.freeze({
        enabled: false,
        reason: 'read-only-projection' as const
      })
    }
    if (
      requirement === 'complete-revision' &&
      facts.revisionKind !== 'complete'
    ) {
      return Object.freeze({
        enabled: false,
        reason: 'source-only-revision' as const
      })
    }
    if (requirement === 'undoable' && !facts.canUndo) {
      return Object.freeze({
        enabled: false,
        reason: 'nothing-to-undo' as const
      })
    }
    if (requirement === 'redoable' && !facts.canRedo) {
      return Object.freeze({
        enabled: false,
        reason: 'nothing-to-redo' as const
      })
    }
  }
  return ENABLED
}

export function computeIntentCapabilities(
  facts: IntentCapabilityFacts
): IntentCapabilitySnapshot {
  const entries = Object.keys(INTENT_PREPARATIONS).map((kind) => {
    const preparation =
      INTENT_PREPARATIONS[kind as EditorIntent['kind']]
    return [
      kind,
      preparation.commitClass === 'revision'
        ? foldCapability(preparation.requires, facts)
        : ENABLED
    ] as const
  })
  return Object.freeze(
    Object.fromEntries(entries)
  ) as IntentCapabilitySnapshot
}

/**
 * Prepare a revision-class intent through its declared adapter. The
 * session-state class never reaches here: the coordinator routes it to its
 * dedicated commit before any revision is minted.
 */
export function prepareEditorIntent(
  worker: RevisionWorker,
  intent: EditorIntent,
  next: RevisionId
): PreparedWorkerCommit {
  const preparation = INTENT_PREPARATIONS[intent.kind]
  if (preparation.commitClass !== 'revision') {
    throw new Error(
      `Intent ${intent.kind} is session-state and prepares no revision`
    )
  }
  return (preparation.prepare as PrepareAdapter<EditorIntent['kind']>)(
    worker,
    intent,
    next
  )
}
