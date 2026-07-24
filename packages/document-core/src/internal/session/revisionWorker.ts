import type {
  InitialModelSelection,
  ModelPosition,
  ModelSelection,
  RejectionCode,
  RevisionId,
  SessionId
} from '../../documentSession.js'
import type { LanguageEngine } from '../../languageEngine.js'
import type { CompleteDocumentRevision } from '../../revision.js'
import { createMarkupView, type MarkupView } from './markupView.js'
import { RevisionKernel } from './revisionKernel.js'
import type { RevisionTransition } from './revisionTransition.js'
import type { SourceEdit } from './sourceTransaction.js'

export class IntentRejection extends Error {
  readonly code: RejectionCode

  constructor(code: RejectionCode) {
    super(code)
    this.name = 'IntentRejection'
    this.code = code
  }
}

interface WorkerState {
  readonly session: SessionId
  readonly id: RevisionId
  readonly revision: CompleteDocumentRevision
  readonly markupView: MarkupView
  readonly selection: ModelSelection
}

interface HistoryEntry {
  readonly forward: readonly SourceEdit[]
  readonly inverse: readonly SourceEdit[]
  readonly beforeSelection: InitialModelSelection
  readonly afterSelection: InitialModelSelection
}

export interface PreparedWorkerCommit {
  readonly revision: CompleteDocumentRevision
  readonly markupView: MarkupView
  readonly transition: RevisionTransition
  readonly selection: ModelSelection
  readonly history: 'record' | 'none'
  readonly historyAction:
    | { readonly kind: 'record'; readonly entry: HistoryEntry }
    | { readonly kind: 'undo' | 'redo' }
}

function freezePosition(position: ModelPosition): ModelPosition {
  return Object.freeze({
    offset: position.offset,
    affinity: position.affinity
  })
}

function freezeSelection(
  session: SessionId,
  revision: RevisionId,
  selection: InitialModelSelection
): ModelSelection {
  return Object.freeze({
    session,
    revision,
    view: 'markup' as const,
    anchor: freezePosition(selection.anchor),
    focus: freezePosition(selection.focus)
  })
}

function detachSelection(selection: ModelSelection): InitialModelSelection {
  return Object.freeze({
    anchor: freezePosition(selection.anchor),
    focus: freezePosition(selection.focus)
  })
}

function assertPosition(position: ModelPosition, modelLength: number): void {
  if (!Number.isInteger(position.offset) || position.offset < 0 || position.offset > modelLength) {
    throw new RangeError('Model position is outside the Markup view')
  }
}

function assertCollapsedSelection(selection: ModelSelection, state: WorkerState): void {
  if (
    selection.session !== state.session ||
    selection.revision !== state.id ||
    selection.view !== 'markup'
  ) {
    throw new IntentRejection('stale-selection')
  }
  assertPosition(selection.anchor, state.markupView.modelLength)
  assertPosition(selection.focus, state.markupView.modelLength)
  if (
    selection.anchor.offset !== selection.focus.offset ||
    selection.anchor.affinity !== selection.focus.affinity
  ) {
    throw new IntentRejection('selection-not-collapsed')
  }
}

export class RevisionWorker {
  readonly #kernel: RevisionKernel
  #state: WorkerState
  #history: HistoryEntry[] = []
  #historyCursor = 0

  constructor(
    engine: LanguageEngine,
    session: SessionId,
    id: RevisionId,
    revision: CompleteDocumentRevision,
    initialSelection: InitialModelSelection
  ) {
    const markupView = createMarkupView(revision)
    assertPosition(initialSelection.anchor, markupView.modelLength)
    assertPosition(initialSelection.focus, markupView.modelLength)
    this.#kernel = new RevisionKernel(engine)
    this.#state = Object.freeze({
      session,
      id,
      revision,
      markupView,
      selection: freezeSelection(session, id, initialSelection)
    })
  }

  get state(): WorkerState {
    return this.#state
  }

  /**
   * Move the caret within the current revision.
   *
   * Selection is session state, not document state: the document did not
   * change, so this commits no revision and records no history. Positions are
   * validated like any other, because an offset outside the document is a
   * caller error rather than something to clamp silently.
   */
  moveSelection(selection: InitialModelSelection): void {
    assertPosition(selection.anchor, this.#state.markupView.modelLength)
    assertPosition(selection.focus, this.#state.markupView.modelLength)
    this.#state = Object.freeze({
      ...this.#state,
      selection: freezeSelection(this.#state.session, this.#state.id, selection)
    })
  }

  prepareInsertion(target: ModelSelection, text: string, next: RevisionId): PreparedWorkerCommit {
    assertCollapsedSelection(target, this.#state)
    if (text.length === 0) {
      throw new Error('Empty insertion is an explicit no-op, not a source commit')
    }

    const sourceTarget = this.#state.markupView.sourcePositionAt(target.anchor)
    const edit = Object.freeze({
      start: sourceTarget.offset,
      end: sourceTarget.offset,
      insert: text
    })
    const prepared = this.#kernel.revise(this.#state.revision, edit, {
      base: this.#state.id,
      next
    })
    const markupView = createMarkupView(prepared.revision)
    const nextSourcePosition = prepared.transition.canonicalMap.mapPosition(
      'forward',
      Object.freeze({ offset: sourceTarget.offset, affinity: 'next' as const })
    )
    const nextPosition = markupView.modelPositionAt(nextSourcePosition)
    if (nextPosition === null) {
      throw new Error('Committed insertion caret is not representable in the next Markup view')
    }
    const afterSelection = Object.freeze({
      anchor: nextPosition,
      focus: nextPosition
    })
    const entry = Object.freeze({
      forward: prepared.transition.edits,
      inverse: prepared.transition.inverseEdits,
      beforeSelection: detachSelection(target),
      afterSelection
    })

    return Object.freeze({
      revision: prepared.revision,
      markupView,
      transition: prepared.transition,
      selection: freezeSelection(this.#state.session, next, afterSelection),
      history: 'record' as const,
      historyAction: Object.freeze({ kind: 'record' as const, entry })
    })
  }

  prepareUndo(next: RevisionId): PreparedWorkerCommit {
    const entry = this.#history[this.#historyCursor - 1]
    if (entry === undefined) {
      throw new IntentRejection('nothing-to-undo')
    }

    const inverse = entry.inverse[0]
    if (inverse === undefined || entry.inverse.length !== 1) {
      throw new Error('The Phase 0 undo tracer requires one canonical inverse edit')
    }
    const prepared = this.#kernel.revise(this.#state.revision, inverse, {
      base: this.#state.id,
      next
    })
    const markupView = createMarkupView(prepared.revision)
    assertPosition(entry.beforeSelection.anchor, markupView.modelLength)
    assertPosition(entry.beforeSelection.focus, markupView.modelLength)
    return Object.freeze({
      revision: prepared.revision,
      markupView,
      transition: prepared.transition,
      selection: freezeSelection(this.#state.session, next, entry.beforeSelection),
      history: 'none' as const,
      historyAction: Object.freeze({ kind: 'undo' as const })
    })
  }

  prepareRedo(next: RevisionId): PreparedWorkerCommit {
    const entry = this.#history[this.#historyCursor]
    if (entry === undefined) {
      throw new IntentRejection('nothing-to-redo')
    }

    const forward = entry.forward[0]
    if (forward === undefined || entry.forward.length !== 1) {
      throw new Error('The Phase 0 redo tracer requires one canonical forward edit')
    }
    const prepared = this.#kernel.revise(this.#state.revision, forward, {
      base: this.#state.id,
      next
    })
    const markupView = createMarkupView(prepared.revision)
    assertPosition(entry.afterSelection.anchor, markupView.modelLength)
    assertPosition(entry.afterSelection.focus, markupView.modelLength)
    return Object.freeze({
      revision: prepared.revision,
      markupView,
      transition: prepared.transition,
      selection: freezeSelection(this.#state.session, next, entry.afterSelection),
      history: 'none' as const,
      historyAction: Object.freeze({ kind: 'redo' as const })
    })
  }

  commit(prepared: PreparedWorkerCommit): void {
    if (prepared.transition.base !== this.#state.id) {
      throw new Error('Prepared revision no longer matches the worker head')
    }

    if (prepared.historyAction.kind === 'record') {
      this.#history = this.#history.slice(0, this.#historyCursor)
      this.#history.push(prepared.historyAction.entry)
      this.#historyCursor += 1
    } else if (prepared.historyAction.kind === 'undo') {
      this.#historyCursor -= 1
    } else {
      this.#historyCursor += 1
    }

    this.#state = Object.freeze({
      session: this.#state.session,
      id: prepared.transition.next,
      revision: prepared.revision,
      markupView: prepared.markupView,
      selection: prepared.selection
    })
  }
}
