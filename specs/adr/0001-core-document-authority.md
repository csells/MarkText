---
status: accepted
---

# Keep one durable document authority

Accepted as the architecture under [archived plan 0011](../plans/archive/0011-criticmarkup-editable-review.md),
retained by [plan 0012](../plans/0012-criticmarkup-upstream-integration-review.md)
and the [native integration architecture](../architecture/criticmarkup-native-integration.md).
Implementation and installed verification remain incomplete; acceptance is not a
claim that the product passes every rule below.

The owner's 8 September 2026 restatement reaffirms the unified parser-to-UI
requirement already explicit in July, not a new requirement for this branch.
A single durable save owner alone does not satisfy it. All existing Markdown and new CM behavior
must use the same language model and editing semantics. Native commands may not
reinterpret projected text through another Markdown parser or rely on supplemental
change-event metadata to recover missing CM meaning. The
[native integration architecture](../architecture/criticmarkup-native-integration.md#one-parser-to-ui-stack)
defines that requirement. The reproduced wrong-location edits and formatting that
removes suggestions demonstrate why the earlier authority boundary alone was
insufficient; the input, history, save and recovery guarantees below still apply.

## Authority and input ordering

Core mode keeps canonical source and durable undo history in one document
authority. The actor owns the live `DocumentRevision`; its session keeps a
bounded recovery record outside the editable view.
That record contains a compact source checkpoint, accepted transactions since
the checkpoint, and the undo-group metadata needed to reproduce authority
history. Pinia, Muya, and CodeMirror do not become alternate source or semantic
owners. Each editor command is ordered against an acknowledged
revision and produces an accepted commit, a typed rejection, or a terminal
fault.

The model's resulting document and selection must be available before the next
action depends on them. Asynchronous persistence, composition drafts and view
lifecycle work still require barriers and recovery, but cannot justify a second
semantic owner or a speculative selection used to interpret subsequent input.

The earlier Worker placement and raw input echo were implementation decisions,
not product requirements. Native queued wrapping demonstrated their failure:
the next key used a collapsed selection before the model's wrapping result
arrived. That design is superseded at this boundary. The current migration moves
the same actor into synchronous session ownership; it must prove the unchanged
latency, composition, history, save and recovery requirements before release.
This ADR does not claim that migration or its verification is complete; see the
[CURRENT blockers](../plans/0012-criticmarkup-upstream-integration-review.md#current-completion-blockers).

## Session rules

- Each command has a document id, session generation, transaction id, and base
  revision. Commands are acknowledged in order. The queue has configured limits
  on both transaction count and inserted source units; reaching either limit
  pauses admission and requires reconciliation rather than dropping input.
- A rejection invalidates dependent commands for submission. Before replacing
  native presentation, the application durably preserves its unacknowledged text,
  native state, and pending intent as a separate recovery artifact. If preservation
  fails, the frozen draft remains accessible and recovery waits for a successful
  retry. The view is then restored from an explicit actor projection or
  source-resynchronization result, and selection is recovered from revision-relative
  anchors with stated previous/next affinity. Recovery artifacts survive closing
  and restarting the application; only an explicit user action archives them,
  retaining their bytes. They never become canonical save authority automatically.
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
- On authority failure or a pending-work limit, the session stops accepting edits
  and preserves the native draft before replacing its speculative presentation.
  Authority recovery creates a new generation from its last compact checkpoint and
  replays only transactions whose acceptance the session recorded. Replies from
  the failed generation are ignored. Save remains blocked until recovery reaches
  the last acknowledged revision. The record has limits on source units,
  transactions, and replay work; reaching one creates a new checkpoint only at
  a settled barrier and drops the superseded journal.

Production default enablement and release verification follow plan 0012; installed tests must cover these
rules, including native IME, pending save, tab and mode handoff, authority restart,
continuous editable Review, parity, and realistic performance. A document approval
field is not an additional implementation or release gate.
