# The document revision is the sole authority

One document actor owns the decoded canonical Markdown source and its unified
Markdown/CriticMarkup interpretation for an open document. The DOM, editor
block tree, Review surfaces, projections, exports, and file bytes are derived
or hosted state. They do not become competing document authorities.

Accepted commands publish a new revision atomically. Durable recovery data may
record enough source and transition information to restore that revision, but
it is not a second semantic model. The concrete revision types, hashes,
journaling, rematerialization protocol, and worker-loss behavior are
implementation decisions.

A single durable save owner does not satisfy this on its own. Existing Markdown
and CriticMarkup behavior share one language model and one set of editing
semantics. Native commands do not reinterpret projected text through another
Markdown parser, and they do not recover missing CriticMarkup meaning from
supplemental change-event metadata. The
[native integration architecture](../../specs/architecture/criticmarkup-native-integration.md#one-parser-to-ui-stack)
defines that requirement.

## Authority and input ordering

The actor's session keeps a bounded recovery record outside the editable view: a
compact source checkpoint, the transactions accepted since it, and the undo-group
metadata needed to reproduce authority history. Pinia, Muya, and CodeMirror never
own source or meaning, and their histories are presentation caches.

Each editor command is ordered against an acknowledged revision. The model's
resulting document and selection are available before the next action depends on
them. Asynchronous persistence, composition drafts, and view lifecycle work need
barriers and recovery, but never justify a second semantic owner or a speculative
selection used to interpret later input. Every keystroke is applied, as the
[vision](../../specs/vision/criticmarkup-vision.md) requires.

## Session rules

- Composition text stays one local draft until `compositionend`, then becomes one
  transaction. A save or mode handoff waits for composition to finish or cancels it
  through the platform event path before crossing its barrier.
- Undo and redo are authority commands. An unsent draft may be canceled locally;
  once submitted, an immediate undo is ordered after its acknowledgement.
- Save and autosave request a save barrier and persist the source of its
  acknowledged revision. They never read a view or a Pinia Markdown snapshot.
- Each open tab has one authority session. Activating another tab parks the old
  session without discarding its pending work. Switching between Source and WYSIWYG
  waits for a view-handoff barrier, then mounts the new view from the acknowledged
  projection and mapped selection.
- On authority failure, the session preserves the native draft before replacing its
  presentation. Recovery starts a new generation from the last checkpoint and
  replays only the transactions the session recorded as accepted. Replies from the
  failed generation are ignored, and save waits until recovery reaches the last
  acknowledged revision. Recovery artifacts survive restarting the application, are
  archived only by an explicit user action, and never become canonical save
  authority on their own.
