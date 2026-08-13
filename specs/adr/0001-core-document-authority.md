---
status: proposed
---

# Keep one durable document authority

Core mode keeps canonical source and durable undo history in the document
authority module. Its Worker actor owns the live `DocumentRevision`; its
renderer-side session keeps a bounded recovery record outside the editable view.
That record contains a compact source checkpoint, accepted transactions since
the checkpoint, and the undo-group metadata needed to reproduce authority
history. Editor views may echo input
immediately as a pending draft, but Pinia, Muya, and CodeMirror do not become
alternate source owners. Each editor command is ordered against an acknowledged
revision and produces an accepted commit, a typed rejection, or a terminal
fault.

The alternatives were to keep saving renderer snapshots or to block visible
input on every actor response. Snapshots preserve two competing histories and
can persist a draft that the actor rejects. Blocking input avoids that split but
misses the latency target and makes IME fragile. Immediate presentation plus an
actor-owned acknowledgement stream preserves both constraints, at the cost of
finite pending-work and reconciliation rules that the production tests must
prove before this decision becomes accepted.

## Session rules

- Each command has a document id, session generation, transaction id, and base
  revision. Commands are acknowledged in order. The queue has configured limits
  on both transaction count and inserted source units; reaching either limit
  pauses admission and requires reconciliation rather than dropping input.
- A rejection invalidates every dependent draft. The view is restored from an
  explicit actor projection or source-resynchronization result, and selection is
  recovered from revision-relative anchors with stated previous/next affinity.
- Composition text remains one local draft until `compositionend`; the session
  then submits one transaction. A save or mode handoff waits for composition to
  finish or cancels it through the platform event path before crossing its
  barrier.
- Undo and redo are authority commands. An unsent draft may be canceled locally;
  once submitted, immediate undo is ordered after its acknowledgement. Muya and
  CodeMirror histories are presentation caches only.
- Save and autosave request a save barrier and persist the source returned for
  its acknowledged revision. They never read a view or Pinia Markdown snapshot.
- One authority session lives for each open tab. Activating another tab parks
  the old session without discarding its pending work. Switching Source and
  WYSIWYG within a document waits for a view-handoff barrier, then mounts the new
  view from the acknowledged projection and mapped selection.
- On Worker failure, the session stops accepting edits, discards speculative
  presentation, creates a new generation from its last compact checkpoint, and
  replays only transactions whose acceptance the session recorded. Replies from
  the failed generation are ignored. Save remains blocked until recovery reaches
  the last acknowledged revision. The record has limits on source units,
  transactions, and replay work; reaching one creates a new checkpoint only at
  a settled barrier and drops the superseded journal.

Core mode stays disabled while this ADR is proposed. It becomes accepted only
after installed tests cover these rules, including native IME, pending save,
tab and mode handoff, and Worker restart.
