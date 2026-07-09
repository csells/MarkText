import { analyzeMarkdownComments } from '@muyajs/core'
import {
  containsConflictScaffolding,
  createWholeFileConflict,
  type ThreeWayMergeConflict
} from '../util/threeWayMerge'
import type { FileChangePayload } from './editorPersistence'

// The per-tab merge-session lifecycle as a pure reducer
// (specs/architecture/external-merge.md §The session reducer). All race
// handling lives here: stale worker results, disk changes superseding an open
// review, buffer edits and saves invalidating captured sessions, closed tabs
// going permanently silent. The reducer performs no IO, touches no store, and
// never reads the clock — the store actions are a thin interpreter that
// translates watcher/worker/UI happenings into events and executes the
// returned effects.

// A captured review session: the pane content the resolver shows plus the
// reality snapshots (expectedLocal, expectedDiskBase) the session is valid
// against. After a clean auto-merge, "Review" inspects the merge that already
// applied, so the liveness anchor (the merged buffer) differs from the
// pane's pre-merge local — hence separate expectedLocal and paneLocal.
export interface MergeReviewSession {
  // Monotonic per tab: every (re)derivation mints a new one so the dialog
  // remounts its panes when a same-tab session is superseded.
  sessionId: number
  expectedLocal: string
  expectedDiskBase: string | undefined
  // paneBase is '' for the no-recorded-base whole-file fallback.
  paneBase: string
  paneLocal: string
  remote: string
  result: string
  conflicts: ThreeWayMergeConflict[]
  fileChange: FileChangePayload
}

// requestCounter/sessionCounter ride every variant so ids stay monotonic for
// the tab's whole lifetime: a request abandoned in one merging episode can
// never collide with a request minted in the next.
export type MergeSessionState =
  | { kind: 'idle'; requestCounter: number; sessionCounter: number }
  | {
    kind: 'merging'
    requestCounter: number
    sessionCounter: number
    requestId: number
    base: string
    local: string
    remote: string
      // An explicit review request (or a superseded session) must surface the
      // resolver even for a clean result — never silently auto-apply.
    forceReview: boolean
    fileChange: FileChangePayload
  }
  | {
    kind: 'reviewing'
    requestCounter: number
    sessionCounter: number
    session: MergeReviewSession
      // Reality as reported by buffer-edited/saved events since the session
      // was captured; accept/reload consult these instead of reading the tab.
    currentLocal: string
    baseSuperseded: boolean
  }
  | { kind: 'closed'; requestCounter: number; sessionCounter: number }

// Events carry the reality snapshots the interpreter reads at dispatch time
// (tab buffer, disk base, persistence equality) — the reducer never reaches
// into the store for them.
export type MergeSessionEvent =
  | {
    type: 'disk-changed'
    fileChange: FileChangePayload
    local: string
    base: string | undefined
    persistenceEqual: boolean
    // The tab's own unsaved-changes flag (!isSaved). It can diverge from
    // local !== base: an edit-then-revert leaves a tab flagged dirty while
    // its buffer matches the base. A persistence-only change must preserve
    // this flag exactly — neither clear a dirty tab nor dirty a clean one.
    dirty: boolean
    forceReview?: boolean
  }
  | {
    type: 'merge-resolved'
    requestId: number
    merged: string
    conflicts: ThreeWayMergeConflict[]
  }
  | { type: 'merge-failed'; requestId: number }
  | { type: 'buffer-edited'; local: string }
  | { type: 'saved' }
  | { type: 'tab-closed' }
  | {
      // A notification click reopening a captured session. The captured panes
      // come from the notification closure; currentLocal/currentBase are read
      // at click time so the reducer can re-derive when they diverged.
    type: 'review-requested'
    paneBase: string
    paneLocal: string
    expectedLocal: string
    expectedDiskBase: string | undefined
    result: string
    conflicts: ThreeWayMergeConflict[]
    fileChange: FileChangePayload
    currentLocal: string
    currentBase: string | undefined
    persistenceEqual: boolean
    withNotification?: boolean
  }
  | { type: 'accept'; result: string; persistenceEqual: boolean }
  | { type: 'cancel' }
  | { type: 'reload-disk' }

export type MergeSessionEffect =
  | { type: 'start-merge'; requestId: number; base: string; local: string; remote: string }
  | {
    type: 'apply-merge'
    fileChange: FileChangePayload
    merged: string
    origin: 'auto' | 'accepted'
      // Pre-merge snapshots for the auto-merge notification's Undo/Review.
    base: string
    local: string
      // True when the merged output is byte-identical to the disk content
      // (the remote subsumed the local edits): the tab is truthfully clean
      // after the apply. Accept always keeps the tab dirty.
    markClean: boolean
  }
  | { type: 'open-resolver'; session: MergeReviewSession; withNotification: boolean }
  | { type: 'close-resolver' }
  | {
    type: 'validation-error'
    code: 'unresolved-conflict' | 'invalid-comment-syntax'
    result: string
  }
  | {
    type: 'load-disk'
    fileChange: FileChangePayload
    preserveDirty: boolean
    reason: 'local-matches-remote' | 'reload-disk' | 'clean-tab-reload'
  }
  // Byte + persistence identical: mark the tab clean without reloading — the
  // engine already holds this exact content, so a reload is pure churn (#1861).
  | { type: 'absorb'; fileChange: FileChangePayload }
  | { type: 'create-recovery-tab' }

export interface MergeSessionTransition {
  state: MergeSessionState
  effects: MergeSessionEffect[]
}

export const initialMergeSessionState = (): MergeSessionState => ({
  kind: 'idle',
  requestCounter: 0,
  sessionCounter: 0
})

const idleFrom = (state: MergeSessionState): MergeSessionState => ({
  kind: 'idle',
  requestCounter: state.requestCounter,
  sessionCounter: state.sessionCounter
})

const commentDiagnosticOccurrences = (markdown: string): Map<string, number> => {
  const counts = new Map<string, number>()
  const add = (key: string): void => {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  try {
    for (const diagnostic of analyzeMarkdownComments(markdown).comments.diagnostics) {
      // Identity only — no source positions. A clean merge shifts offsets, and
      // a position-bearing key would make every pre-existing diagnostic look
      // "new", escalating the merge to a conflict dialog whose Accept can then
      // never pass validation. Multiplicity is handled by the counts map.
      add(
        JSON.stringify({
          code: diagnostic.code,
          id: diagnostic.id ?? null,
          message: diagnostic.message
        })
      )
    }
  } catch (err) {
    add(`parse-error:${String(err)}`)
  }
  return counts
}

const introducesNewCommentDiagnostics = (
  mergedMarkdown: string,
  localMarkdown: string,
  remoteMarkdown: string
): boolean => {
  const localCounts = commentDiagnosticOccurrences(localMarkdown)
  const remoteCounts = commentDiagnosticOccurrences(remoteMarkdown)

  for (const [key, count] of commentDiagnosticOccurrences(mergedMarkdown)) {
    const existingCount = Math.max(localCounts.get(key) ?? 0, remoteCounts.get(key) ?? 0)
    if (count > existingCount) return true
  }
  return false
}

interface SessionPanes {
  expectedLocal: string
  expectedDiskBase: string | undefined
  paneBase: string
  paneLocal: string
  remote: string
  result: string
  conflicts: ThreeWayMergeConflict[]
  fileChange: FileChangePayload
}

const openReview = (
  state: MergeSessionState,
  panes: SessionPanes,
  withNotification: boolean,
  effects: MergeSessionEffect[] = []
): MergeSessionTransition => {
  const sessionId = state.sessionCounter + 1
  const session: MergeReviewSession = { sessionId, ...panes }
  return {
    state: {
      kind: 'reviewing',
      requestCounter: state.requestCounter,
      sessionCounter: sessionId,
      session,
      currentLocal: panes.expectedLocal,
      baseSuperseded: false
    },
    effects: [...effects, { type: 'open-resolver', session, withNotification }]
  }
}

const onDiskChanged = (
  state: MergeSessionState,
  event: Extract<MergeSessionEvent, { type: 'disk-changed' }>
): MergeSessionTransition => {
  const effects: MergeSessionEffect[] = []
  let working = state
  // Review intent is sticky across supersedes: a Review click carried on an
  // in-flight merge (or an open session) must survive onto the re-derived
  // merge — dropping it would let the new merge's clean result silently
  // auto-apply past the user's explicit request.
  let forceReview =
    event.forceReview === true || (state.kind === 'merging' && state.forceReview)

  // A newer change for a tab with an open review SUPERSEDES that session:
  // never auto-apply beneath the modal or leave stale panes up. Re-derive
  // against the newest remote and keep the user headed for review.
  if (state.kind === 'reviewing') {
    effects.push({ type: 'close-resolver' })
    forceReview = true
    working = idleFrom(state)
  }

  const remote = event.fileChange.data.markdown

  if (event.local === remote) {
    // Byte-identical AND persistence-identical: absorb (mark clean, no reload).
    // Byte-identical but a persistence diff (encoding/line-ending) needs a
    // reload to adopt it, preserving the tab's dirtiness exactly: a dirty tab
    // stays dirty so the persistence change can't silently clear it; a clean
    // tab stays clean — the user made no edit, so adopting the new
    // persistence must not fabricate unsaved changes.
    if (event.persistenceEqual) {
      effects.push({ type: 'absorb', fileChange: event.fileChange })
    } else {
      effects.push({
        type: 'load-disk',
        fileChange: event.fileChange,
        preserveDirty: event.dirty,
        reason: 'local-matches-remote'
      })
    }
    return { state: idleFrom(working), effects }
  }

  // A dirty tab without a recorded base (legacy session restore) cannot be
  // merged; the resolver surfaces the whole-file difference instead of any
  // side being silently preferred.
  if (typeof event.base !== 'string') {
    const fallback = createWholeFileConflict('', event.local, remote)
    return openReview(
      working,
      {
        expectedLocal: event.local,
        expectedDiskBase: undefined,
        paneBase: '',
        paneLocal: event.local,
        remote,
        result: fallback.mergedMarkdown,
        conflicts: fallback.conflicts,
        fileChange: event.fileChange
      },
      true,
      effects
    )
  }

  // A clean tab (buffer == base — no local edits vs disk) has nothing to
  // merge: a disk change is a plain reload, not a three-way merge. But NOT
  // under an explicit review intent carried from a superseded session — a
  // silent reload would drop the user's Review click. There the change falls
  // through to the merge path so its (trivially clean) result surfaces the
  // resolver instead of auto-applying.
  if (event.local === event.base && !forceReview) {
    effects.push({
      type: 'load-disk',
      fileChange: event.fileChange,
      preserveDirty: false,
      reason: 'clean-tab-reload'
    })
    return { state: idleFrom(working), effects }
  }

  // Disk has nothing new relative to the edit base; an in-flight merge (if
  // any) keeps running against the identical remote content.
  if (remote === event.base) {
    return { state: working, effects }
  }

  const requestId = working.requestCounter + 1
  effects.push({
    type: 'start-merge',
    requestId,
    base: event.base,
    local: event.local,
    remote
  })
  return {
    state: {
      kind: 'merging',
      requestCounter: requestId,
      sessionCounter: working.sessionCounter,
      requestId,
      base: event.base,
      local: event.local,
      remote,
      forceReview,
      fileChange: event.fileChange
    },
    effects
  }
}

const onMergeResolved = (
  state: MergeSessionState,
  event: Extract<MergeSessionEvent, { type: 'merge-resolved' }>
): MergeSessionTransition => {
  if (state.kind !== 'merging' || state.requestId !== event.requestId) {
    return { state, effects: [] }
  }

  const clean = event.conflicts.length === 0
  if (
    clean &&
    !state.forceReview &&
    !introducesNewCommentDiagnostics(event.merged, state.local, state.remote)
  ) {
    return {
      state: idleFrom(state),
      effects: [
        {
          type: 'apply-merge',
          fileChange: state.fileChange,
          merged: event.merged,
          origin: 'auto',
          base: state.base,
          local: state.local,
          markClean: event.merged === state.remote
        }
      ]
    }
  }

  return openReview(
    state,
    {
      expectedLocal: state.local,
      expectedDiskBase: state.base,
      paneBase: state.base,
      paneLocal: state.local,
      remote: state.remote,
      result: event.merged,
      conflicts: event.conflicts,
      fileChange: state.fileChange
    },
    true
  )
}

const onMergeFailed = (
  state: MergeSessionState,
  event: Extract<MergeSessionEvent, { type: 'merge-failed' }>
): MergeSessionTransition => {
  if (state.kind !== 'merging' || state.requestId !== event.requestId) {
    return { state, effects: [] }
  }

  const fallback = createWholeFileConflict(state.base, state.local, state.remote)
  return openReview(
    state,
    {
      expectedLocal: state.local,
      expectedDiskBase: state.base,
      paneBase: state.base,
      paneLocal: state.local,
      remote: state.remote,
      result: fallback.mergedMarkdown,
      conflicts: fallback.conflicts,
      fileChange: state.fileChange
    },
    true
  )
}

const onReviewRequested = (
  state: MergeSessionState,
  event: Extract<MergeSessionEvent, { type: 'review-requested' }>
): MergeSessionTransition => {
  // A re-derivation is already in flight; carry the explicit review intent
  // onto it so even a clean resolution opens the resolver — dropping the
  // click here would let a forceReview-less merge silently auto-apply.
  if (state.kind === 'merging') {
    return { state: { ...state, forceReview: true }, effects: [] }
  }

  // The disk base moved since the session was captured — a save (or reload)
  // replaced the bytes this session was resolving, so the session is dead and
  // its captured "on disk" remote no longer exists. Dissolve it rather than
  // reopen a resolver whose remote pane is stale (whose Accept the
  // base-superseded guard at onAccept would then silently discard, dropping
  // the user's hand-resolution with no feedback). A genuinely new external
  // change re-arrives as its own disk-changed event carrying the real remote.
  // This mirrors onAccept's base-superseded handling — the two must agree.
  if (event.currentBase !== event.expectedDiskBase) {
    return { state: idleFrom(state), effects: [{ type: 'close-resolver' }] }
  }

  // The captured session no longer describes the buffer — re-derive against
  // current reality instead of resurrecting stale panes.
  if (event.currentLocal !== event.expectedLocal) {
    return onDiskChanged(state, {
      type: 'disk-changed',
      fileChange: event.fileChange,
      local: event.currentLocal,
      base: event.currentBase,
      persistenceEqual: event.persistenceEqual,
      dirty: event.currentLocal !== event.currentBase,
      forceReview: true
    })
  }

  return openReview(
    state,
    {
      expectedLocal: event.expectedLocal,
      expectedDiskBase: event.expectedDiskBase,
      paneBase: event.paneBase,
      paneLocal: event.paneLocal,
      remote: event.fileChange.data.markdown,
      result: event.result,
      conflicts: event.conflicts,
      fileChange: event.fileChange
    },
    event.withNotification === true
  )
}

const onAccept = (
  state: MergeSessionState,
  event: Extract<MergeSessionEvent, { type: 'accept' }>
): MergeSessionTransition => {
  if (state.kind !== 'reviewing') {
    return { state, effects: [] }
  }

  const { session } = state
  const live = !state.baseSuperseded && state.currentLocal === session.expectedLocal

  // A stale session must never apply: the buffer or the disk base moved since
  // the panes were captured. A moved buffer re-derives the merge against the
  // current content; a moved base (save/newer reload) means the disk content
  // this session was resolving no longer exists — close it.
  if (!live) {
    if (state.baseSuperseded) {
      return { state: idleFrom(state), effects: [{ type: 'close-resolver' }] }
    }
    const rederived = onDiskChanged(idleFrom(state), {
      type: 'disk-changed',
      fileChange: session.fileChange,
      local: state.currentLocal,
      base: session.expectedDiskBase,
      persistenceEqual: event.persistenceEqual,
      dirty: state.currentLocal !== session.expectedDiskBase,
      forceReview: true
    })
    return {
      state: rederived.state,
      effects: [{ type: 'close-resolver' }, ...rederived.effects]
    }
  }

  // Never write generated conflict scaffolding into the document: an
  // unresolved (or hand-mangled) marker block must be resolved first.
  if (containsConflictScaffolding(event.result)) {
    return {
      state,
      effects: [{ type: 'validation-error', code: 'unresolved-conflict', result: event.result }]
    }
  }

  if (introducesNewCommentDiagnostics(event.result, session.paneLocal, session.remote)) {
    return {
      state,
      effects: [
        { type: 'validation-error', code: 'invalid-comment-syntax', result: event.result }
      ]
    }
  }

  return {
    state: idleFrom(state),
    effects: [
      { type: 'close-resolver' },
      {
        type: 'apply-merge',
        fileChange: session.fileChange,
        merged: event.result,
        origin: 'accepted',
        base: session.paneBase,
        local: session.paneLocal,
        markClean: false
      }
    ]
  }
}

const onReloadDisk = (state: MergeSessionState): MergeSessionTransition => {
  if (state.kind !== 'reviewing') {
    return { state, effects: [] }
  }

  // A stale session's fileChange no longer matches the disk (a save or newer
  // change superseded it); loading it would resurrect dead bytes. Close the
  // session — the watcher reports the real disk state on the next change.
  const live = !state.baseSuperseded && state.currentLocal === state.session.expectedLocal
  if (!live) {
    return { state: idleFrom(state), effects: [{ type: 'close-resolver' }] }
  }

  // The recovery tab must exist before the reload replaces the buffer.
  return {
    state: idleFrom(state),
    effects: [
      { type: 'close-resolver' },
      { type: 'create-recovery-tab' },
      {
        type: 'load-disk',
        fileChange: state.session.fileChange,
        preserveDirty: false,
        reason: 'reload-disk'
      }
    ]
  }
}

export const reduceMergeSession = (
  state: MergeSessionState,
  event: MergeSessionEvent
): MergeSessionTransition => {
  // A closed tab is permanently dead: no event emits effects again.
  if (state.kind === 'closed') {
    return { state, effects: [] }
  }

  switch (event.type) {
    case 'disk-changed':
      return onDiskChanged(state, event)
    case 'merge-resolved':
      return onMergeResolved(state, event)
    case 'merge-failed':
      return onMergeFailed(state, event)
    case 'buffer-edited':
      if (state.kind === 'merging') {
        // The in-flight merge captured a buffer that no longer exists.
        return { state: idleFrom(state), effects: [] }
      }
      if (state.kind === 'reviewing') {
        return { state: { ...state, currentLocal: event.local }, effects: [] }
      }
      return { state, effects: [] }
    case 'saved':
      if (state.kind === 'merging') {
        return { state: idleFrom(state), effects: [] }
      }
      if (state.kind === 'reviewing') {
        return { state: { ...state, baseSuperseded: true }, effects: [] }
      }
      return { state, effects: [] }
    case 'tab-closed': {
      const closed: MergeSessionState = {
        kind: 'closed',
        requestCounter: state.requestCounter,
        sessionCounter: state.sessionCounter
      }
      return {
        state: closed,
        effects: state.kind === 'reviewing' ? [{ type: 'close-resolver' }] : []
      }
    }
    case 'review-requested':
      return onReviewRequested(state, event)
    case 'accept':
      return onAccept(state, event)
    case 'cancel':
      if (state.kind !== 'reviewing') {
        return { state, effects: [] }
      }
      return { state: idleFrom(state), effects: [{ type: 'close-resolver' }] }
    case 'reload-disk':
      return onReloadDisk(state)
  }
}
