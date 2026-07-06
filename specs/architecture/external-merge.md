# External-Change Merge Pipeline

Product bar #4 (vision): an agent editing the loaded file on disk has its
changes merged properly, correctly, robustly into the user's current
document. Git and the filesystem are the sync model; the desktop app is the
merge surface.

## Base tracking

Every path-backed tab carries `diskBaseMarkdown` (typed on the shared
`IFileState` contract): the exact Markdown from the last successful open,
save, clean reload, or accepted external merge. It is the merge base and is
advanced **only** by those events. Dirty-state math never infers a base from
the undo stack; a dirty merge without a recorded base fails loudly
(`requireDiskBaseMarkdown`).

## Decision table (watcher reports disk content `remote` for a tab)

| Condition | Action |
| --- | --- |
| tab clean | reload from disk (regardless of Auto Save) |
| disk bytes == tab bytes and persistence snapshot equal | ignore |
| `local == remote` | mark clean, advance base (persistence-only diffs keep dirty) |
| `remote == base` | ignore — disk has nothing new relative to the edit base |
| otherwise | three-way merge (`base`, `local`, `remote`) |

A byte-affecting persistence difference (encoding/BOM, line-ending mode,
trailing-newline policy) is not a no-op and must not silently clear a dirty
tab.

## Merge engine — settled (do not re-litigate)

`node-diff3` performs the line-oriented merge, off the UI thread in a Web
Worker. Correctness is defined by engine-independent properties, fuzzed
directly (no git oracle; git byte-parity is an explicit non-goal):

1. **No data loss** — a clean auto-merge never drops a line both sides kept.
2. **No fabrication** — a clean auto-merge never invents content.
3. **Order preservation** — output is order-consistent with both sides.

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

## Races

An in-flight merge result is dropped (never applied) if by resolution time:
a newer watcher event superseded it (per-tab request ids — newest disk
content wins), the tab was closed, the local buffer changed, the tab was
saved, or the disk base moved. All five guards are locked by unit tests in
`dirty-external-merge-actions.spec.ts`.

## End-to-end coverage

The flagship agent flow is driven end to end in
`packages/desktop/test/e2e/external-reload-undo.spec.ts`: disjoint agent
edits auto-merging into dirty WYSIWYG and source buffers, the notification's
Undo and Review paths, per-conflict resolution choices, recovery tabs, and
undo boundaries after reloads.
