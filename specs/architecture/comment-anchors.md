# Runtime Representation: OT-Anchored Comments

The wire format keeps `<!--MC:id-->` bytes in the `.md` file
([comment-format.md](comment-format.md)). At **runtime**, those bytes do not
exist anywhere in the editable document. Comments live out-of-band as
**anchors** — OT positions transformed through every edit operation — and the
marker/metadata bytes are reconstructed only when the document is serialized.

## Why

The previous runtime kept marker bytes inside contenteditable text and
defended them with guards on every editing path (backspace, delete, Enter,
typing-over, cut, paste, table ops, IME, arrows, select-all). Every guard was
a place to eat a keystroke; every unguarded path (autocorrect, drag-drop,
dictation) was a place to corrupt a marker. The guard architecture was
adversarial by construction. With anchors out-of-band there is nothing in the
text to corrupt: **the entire guard family is deleted, not consolidated.**

muya is built on `ot-json1` + `ot-text-unicode`; transforming positions
through operations is the problem those libraries exist to solve
(`json1.type.transformPosition`, `textUnicode.type.transformPosition`).

## The model

`JSONState` owns one `CommentModel` per document — it IS document state:
every op applied to the state transforms its positions at that single choke
point. The `MuyaComments` facade reads it through the state and presents the
public API.

```ts
interface ICommentAnchor {
    id: string;
    kind: 'open' | 'close';
    // json1 position: [...blockPath, 'text', characterOffset] into the
    // CLEAN (marker-free) document state.
    position: TBlockPath;
}

// One contiguous run of definition lines as the file laid them out: thread
// items re-serialize their (possibly mutated) thread head-first; residue
// items re-emit verbatim lines that did not decode (duplicates, malformed
// payloads, orphan replies), so a damaged file round-trips without silent
// data loss.
interface ICommentDefinitionRun {
    // Block position for a run that was its own block, [...path, 'text',
    // offset] for lines embedded in a surviving leaf, null when detached
    // (an edit removed the surrounding structure): the run re-emits in the
    // trailing appendix. Threads created at runtime carry no run at all —
    // they join the trailing appendix at serialization.
    position: TBlockPath | null;
    edge: 'before' | 'after';
    items: Array<{ kind: 'thread', id } | { kind: 'residue', line }>;
}

interface ICommentModel {
    threads: Map<string, ICommentThread>;   // decoded metadata, wire-format agnostic
    anchors: ICommentAnchor[];              // document order not guaranteed; derive on read
    runs: ICommentDefinitionRun[];          // definition-line layout in document order
}
```

- Offsets are **clean-text offsets**. Rendered text, selection offsets,
  search, word count, and anchors all share one coordinate space — the
  marker-length arithmetic that permeated highlights and cursor mapping is
  gone.
- Ranges are derived on read by pairing open/close anchors per id (overlap
  stays non-tree-shaped, exactly as in the wire format).
- Placement runs make definition blocks position-stable: a mid-document
  `[MC:]` block stays where the file put it through load, edits, and
  serialization instead of migrating to the end of the file.

## Lifecycle

**Load (markdown → state + model).** After `markdownToState`, an extraction
pass — using the canonical grammar owner (`comments/syntax.ts`) and the same
scanners the file-level analyzer uses — removes marker bytes from every
commentable leaf (recording anchors at their clean-text positions) and
removes metadata-definition paragraphs entirely (decoding threads). The state
tree the editor renders and edits contains **no MC syntax**. Extraction and
file-level analysis (`analyzeMarkdownComments`) must agree; the file-level
analyzer remains the authority for anything operating on serialized bytes
(CLI, merge gates, source mode).

**Serialize (state + model → markdown).** Materialization is the exact
inverse: clone the state tree, splice marker bytes into leaf text at anchor
offsets (descending order per leaf), re-emit each definition run at its
recorded position (threads head-first per
[comment-format.md](comment-format.md); runtime-created threads join the
trailing appendix run so it stays one contiguous block), then run the
ordinary serializer.
`getMarkdown()` output is byte-for-byte what v-next of the wire format
defines — source mode, save, copy-as-source, and the CLI all see materialized
bytes and are unchanged in kind.

**Edit (operations).** Every operation that reaches the document state —
typing, paste, block insert/remove/replace, undo, redo — transforms every
anchor AND every run position through `json1.type.transformPosition` at the
**single choke point where ops are applied to `JSONState`**. No editing
surface knows comments exist:

- Text edits shift or swallow offsets (a deletion spanning an anchor
  collapses it to the deletion point — Google-Docs semantics).
- Block insert/remove shifts paths; `null` (the anchor's container was
  deleted) triggers the **detach policy** below. A run whose position nulls
  falls back to the trailing appendix.
- A TRUE subtree replace (remove + insert at one path, e.g.
  paragraph→heading conversion) also yields `null`; before detaching,
  materialize a **rescue attempt**: re-anchor at the same path with the
  offset clamped into the replacement's text when the replacement is a
  commentable text leaf. A bare remove never rescues — the sibling that
  shifts into the removed index is unrelated content, so deletion detaches.

**Detach policy.** A thread whose anchors are lost keeps its metadata
(`threads` entry) with no range. It serializes as metadata-only definitions —
visible to every reader as the existing `orphan-metadata` diagnostic, never
silently dropped. Deleting the text of a whole range therefore deletes the
highlight but not the thread's words. (The sidebar presents detached threads
distinctly; re-anchoring is a future affordance, not guessed at.)

## Mutations and undo

Comment mutations (`addComment`, `removeComment`, thread patches, replies)
mutate the model directly — **no text splicing, no replaceContent, no
document rebuild**. Each mutation records an invertible **comment-model
history entry** in muya's single undo timeline:

- `addComment` → entry whose inverse removes the thread + anchors.
- `removeComment` → entry whose inverse restores them.
- metadata patches → entry carrying before/after metadata.

Document ops and comment-model entries interleave in one history. Every
ordinary history entry snapshots the pre-op anchors and run positions, and
undo restores the snapshot after applying the inverse op —
`transformPosition` is lossy for positions a deletion swallowed, so
snapshots, not re-transforms, are what make undo exact (invariant 4).
Whole-document rebuild entries (`replaceContent`, source-mode return,
external reload) snapshot the model wholesale and restore it on undo across
that boundary.

## Rendering and analysis

- Highlights derive from anchors: for each block, the intersection of paired
  anchor ranges with that block, in clean-text offsets. No tokenizer
  involvement, and the live renderer does no hiding: marker- or
  definition-shaped bytes a user TYPES render as visible literal text. The
  `comment_marker` token stays in the LIVE tokenizer to make that so — it is
  what routes marker-shaped bytes to a visible plain-text vnode instead of
  inline-HTML handling — and doubles as the file-level scanning primitive
  for serialized-bytes consumers. Removing it from the live pipeline would
  regress the pinned visible-text semantics.
- `getComments()` reads the model through a per-version view
  (`commentModelView`): ranges pair anchors, previews and document order
  derive from one walk over the clean state, and the result is cached on the
  `JSONState` version — one derivation per version regardless of caller
  count, nothing document-sized per keystroke beyond it.
- `getCleanMarkdown()` serializes the clean state without materialization —
  the word-count input, cached per version like `getMarkdown()`.
- Diagnostics at runtime are model-level (detached threads, id collisions on
  paste-materialized text). File-level diagnostics (malformed payloads,
  duplicate definitions) surface at load and remain visible in the sidebar.

## What this deletes

The following exist only to defend in-text marker bytes and are removed with
this architecture (their regression tests convert to anchor-semantics tests):

- clipboard cut/paste marker guards, orphan checks, and the
  unreferenced-metadata sweep (`ScrollPage.removeUnreferencedCommentMetadata`)
- `Format` input/Enter/backspace/delete marker guards, `editedTextRange`
  cursor disambiguation, transparent-deletion hops, `commentMarkerNavSkip`
- the hidden-metadata-block caret invariant machinery
  (`isCommentMetadataBlock` navigation skips, `snapCaretOutOfHiddenSyntax`,
  select-all clamps) — there is no hidden block to protect
- `notifyCommentEditBlocked` and its desktop notification — edits are never
  refused
- search/copy marker stripping (clean text is the only text)

## Invariants (each pinned by tests)

1. **No MC bytes at runtime**: after load, no commentable state leaf text
   and no rendered comment machinery contains a well-formed `<!--MC:`
   marker or metadata definition. Literal contexts (code fences, inline
   code) keep their bytes as documentation. Two deliberate residues remain
   in leaf text as visible literal bytes: marker-shaped text the user
   TYPES (well-formed shapes fold into the model on the next load), and
   MALFORMED marker shapes from a loaded file (e.g. an invalid id) — these
   cannot be anchored without guessing and must not be destroyed, so they
   stay verbatim; the byte-level analyzer reports them as
   `malformed-marker` diagnostics to file-level consumers (source mode,
   CLI), which is where repair happens.
2. **Round-trip fidelity**: load → (no edits) → serialize is byte-identical
   for well-formed documents — including mid-document definition blocks,
   which stay in place (modulo the pre-existing serializer normalizations,
   wire-format version upgrades, and the comment canonicalizations named
   in [editing-invariants.md](editing-invariants.md) §Round-trip).
3. **Transform totality**: every op applied to `JSONState` transforms every
   anchor exactly once; an anchor is never stale relative to the state
   version.
4. **Undo symmetry**: any sequence of edits followed by the same number of
   undos restores both text and anchors; comment mutations undo/redo in the
   same timeline.
5. **Detach visibility**: no code path silently drops a thread; losing a
   range produces a detached thread that serializes as metadata.
6. **Selection unity**: selection offsets, highlight offsets, and anchor
   offsets are the same coordinate space (no mapping layer).
