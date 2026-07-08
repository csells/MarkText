# External-Change Merge Pipeline

Product bar #4 (vision): an agent editing the loaded file on disk has its
changes merged properly, correctly, robustly into the user's current
document. Git and the filesystem are the sync model; the desktop app is the
merge surface.

## Base tracking

Every path-backed tab carries `diskBaseMarkdown` (typed on the shared
`IFileState` contract): the exact Markdown last known to be on disk. It is
the merge base and advances **only** when disk truth genuinely moves under
the tab: open, save, clean reload, an applied external merge (auto or
accepted — the base advances to the remote content), the byte-identical
absorb row, and the `local == remote` clean-sync row. Dirty-state math never infers a base from
the undo stack. A dirty external change with no recorded base (legacy
session restore) cannot be merged: it opens the whole-file resolver so no
side is silently preferred, and Accept applies the hand-resolved result.
The reducer enforces this structurally — a merge only ever starts from a
recorded string base, and the pre-merge base/local snapshots travel on the
apply-merge effect to the notification's Review panes.

## Decision table (watcher reports disk content `remote` for a tab)

Rows are evaluated in this order (byte-equality outranks the clean-tab
reload: a byte-identical change is ignored or absorbed, never reloaded —
the #1861 behavior). Rows 3–5 are reducer rows, which only DIRTY tabs
reach: a clean tab short-circuits to the reload row before the reducer is
consulted, so a clean tab whose disk bytes match but whose persistence
snapshot differs reloads and stays clean (there is nothing dirty to
preserve):

| Condition | Action |
| --- | --- |
| disk bytes == tab bytes and persistence snapshot equal | absorb: mark the tab clean and advance the base (no reload, no notification churn); an open resolver session for the tab is closed via the reducer instead — its content no longer differs |
| tab clean | reload from disk (regardless of Auto Save) |
| `local == remote` (dirty tab) | mark clean, advance base (persistence-only diffs keep dirty); the auto-merge Undo/Review notification is kept |
| `remote == base` | ignore — disk has nothing new relative to the edit base |
| otherwise | three-way merge (`base`, `local`, `remote`) |

A byte-affecting persistence difference (encoding/BOM, line-ending mode,
trailing-newline policy) is not a no-op and must not silently clear a dirty
tab.

## Merge engine — settled (do not re-litigate)

`node-diff3` performs the line-oriented merge, off the UI thread in a Web
Worker, behind a positional fast path: equal-line-count triples merge
index-by-index first (`mergeAlignedLineEdits` — node-diff3 needlessly
conflicts some of them), and everything else falls through to diff3.
Correctness is defined by engine-independent properties, fuzzed directly
(no git oracle; git byte-parity is an explicit non-goal):

1. **No data loss** — a clean auto-merge never drops a line both sides kept.
2. **No fabrication** — a clean auto-merge never invents content.
3. **Order preservation** — lines whose relative order base, local, and
   remote all agree on keep that order in every clean output (when one side
   deliberately reorders, no output can agree with both sides at once).

`mergeViolatesDataPreservation` rejects any clean node-diff3 output violating
the count bounds and escalates it to a whole-file conflict. Documents past
the merge cell budget escalate the same way rather than freezing the
renderer. The fuzz corpus (`three-way-merge-fuzz.spec.ts`) exercises the
payloads the feature exists for: MC markers, duplicate/malformed metadata
definitions, CRLF and bare-CR endings, non-ASCII and astral text.

## Worker protocol

`dirtyExternalMerge.worker.ts` posts exactly one reply shape — the
`{ ok: true, result } | { ok: false, message }` envelope. The bridge rejects
any other shape loudly; a shape mismatch means worker and bridge are out of
sync and must never be guessed around.

## Clean-merge outcomes

A conflict-free merge auto-applies into the live editor (WYSIWYG or source
mode), keeps the tab dirty against disk, advances `diskBaseMarkdown` to the
remote content, and pushes a per-tab notification ("Merged disk changes into
your unsaved edits in …") with two real buttons:

- **Undo** — restores the pre-merge local buffer (still dirty).
- **Review** — opens the resolver on the merge (zero conflict rows) for
  inspection; an explicit review request never silently auto-applies.

When the merge output is byte-identical to the disk content (the remote
subsumed the local edits) the tab is truthfully marked clean — the buffer
equals disk — but the buffer still visibly changed, so the notification is
pushed all the same and Undo restores the pre-merge dirty buffer. That
decision (`markClean`) is the reducer's, carried on the apply-merge effect.

**Escalation gate:** a clean merge whose output introduces comment
diagnostics that neither `local` nor `remote` had (offset-independent
occurrence counts) does not auto-apply — it opens the resolver with the merge
as the editable result. The same gate re-validates on Accept, so a
hand-mangled result cannot be applied either; unresolved conflict scaffolding
in the result is likewise rejected.

## Conflicting merges — the resolver

A modal resolver (`mergeConflictDialog.vue`) titled with the file it is
resolving (pathname on hover):

- Read-only panes for "Your unsaved edits" and "Changed on disk", an editable
  result pane initialized with structured conflict blocks; all three
  virtualized (whole-file escalations are by definition the largest inputs).
- Per-conflict actions: **Use Yours / Use Disk / Use Both**.
- CodeMirror panes theme via `codeMirrorThemeFor` — the same UI-theme →
  editor-theme mapping source mode uses — and render MC decorations.
- **Accept Merge** applies the result as one undoable boundary, keeps the tab
  dirty, advances the base to the remote content, and clears the session.
- **Keep Editing** cancels: the user's buffer is untouched.
- **Reload Disk** abandons the merge: the local buffer is first preserved in
  a dirty untitled recovery tab, then the tab reloads from disk; the reload
  remains undoable back to the local buffer.

## The session reducer

Per-tab merge lifecycle state is a **pure reducer**
(`store/mergeSession.ts`), not scattered flags:

```ts
type MergeSessionState =
  | { kind: 'idle' }
  | { kind: 'merging'; requestId; base; local; remote; forceReview; fileChange }
  | { kind: 'reviewing'; session: MergeReviewSession; currentLocal; baseSuperseded }
  | { kind: 'closed' }
// every variant also carries monotonic requestCounter/sessionCounter, so an
// abandoned request can never collide with a later one

reduce(state, event) -> { state, effects }
```

Events are everything that can happen to the tab while a merge matters:
`disk-changed`, `merge-resolved(requestId, …)`, `merge-failed(requestId)`,
`buffer-edited`, `saved`, `tab-closed`, `review-requested`, `accept`,
`cancel`, `reload-disk`. Events carry the reality snapshots the interpreter
reads at dispatch time (buffer, base, persistence equality) — the reducer
performs no IO, touches no store, and never reads the clock. Effects are
declarative instructions the store interprets: `start-merge`,
`apply-merge` (carrying `origin`, `markClean`, and the pre-merge
base/local snapshots), `open-resolver` (with a `withNotification` flag —
notification *pushing* is interpreter work), `close-resolver`,
`validation-error`, `create-recovery-tab`, `load-disk`.

All race handling IS the reducer: a `merge-resolved` carrying a stale
`requestId` is a no-op transition; `disk-changed` while `reviewing`
supersedes the session (close, re-derive, stay headed for review);
`review-requested` while `merging` upgrades the in-flight merge to
forceReview so its resolution opens the resolver (the click is never
dropped and a clean result never silently auto-applies);
`tab-closed` goes to `closed`, which is permanently silent; `saved` while
reviewing marks the session's base superseded, so a later `accept` closes
the dead session instead of applying stale content, and a moved buffer
re-derives against current reality.

**Property fuzz (the reason for the shape):** random event sequences are
driven through the reducer with a model interpreter and its invariants
asserted directly —

1. no effect sequence ever discards the local buffer except downstream of an
   explicit `accept` or `reload-disk`;
2. `apply-merge` effects reference only the newest `disk-changed` payload
   seen (never a superseded remote);
3. after `tab-closed`, no further effects are emitted;
4. every terminal state is `idle`, `reviewing`, or `closed` — nothing wedges
   in `merging` once its `merge-resolved`/`merge-failed` arrives.

The store's actions are a thin interpreter (`dirtyExternalMergeActions.ts`):
translate IPC/watcher/UI happenings into events, reconcile reality drift
lazily at each decision point (typing, saves, and tab closes do not dispatch
merge events of their own), run the reducer, execute effects. Unit tests for
the decision table target the reducer as a pure function.

## Background tabs and undo

Auto-merging a background tab replaces content the engine never saw, so the
engine history captured at the tab's last edit describes a different
document. The tab keeps a **pre-merge journal entry** (`{ markdown, cursor,
mergedAt }`); when the tab is next activated, the editor seeds a rebuild-undo
boundary from the journal so the first Cmd+Z after switching back restores
the pre-merge buffer — the same contract foreground auto-merges already
honor. Stale engine history is discarded, never replayed onto the merged
tree.

## End-to-end coverage

The flagship agent flow is driven end to end in
`packages/desktop/test/e2e/external-reload-undo.spec.ts`: disjoint agent
edits auto-merging into dirty WYSIWYG and source buffers, the notification's
Undo and Review paths, per-conflict resolution choices, recovery tabs, and
undo boundaries after reloads.
