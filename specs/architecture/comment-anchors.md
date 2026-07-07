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

The engine owns one `CommentModel` per document (held by the `MuyaComments`
facade):

```ts
interface ICommentAnchor {
    id: string;
    kind: 'open' | 'close';
    // json1 position: [...blockPath, 'text', characterOffset] into the
    // CLEAN (marker-free) document state.
    position: TJson1Path;
}

interface ICommentModel {
    threads: Map<string, ICommentThread>;   // decoded metadata, wire-format agnostic
    anchors: ICommentAnchor[];              // document order not guaranteed; derive on read
}
```

- Offsets are **clean-text offsets**. Rendered text, selection offsets,
  search, word count, and anchors all share one coordinate space — the
  marker-length arithmetic that permeated highlights and cursor mapping is
  gone.
- Ranges are derived on read by pairing open/close anchors per id (overlap
  stays non-tree-shaped, exactly as in the wire format).

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
offsets (descending order per leaf), append the metadata appendix per
[comment-format.md](comment-format.md), then run the ordinary serializer.
`getMarkdown()` output is byte-for-byte what v-next of the wire format
defines — source mode, save, copy-as-source, and the CLI all see materialized
bytes and are unchanged in kind.

**Edit (operations).** Every operation that reaches the document state —
typing, paste, block insert/remove/replace, undo, redo — transforms every
anchor through `json1.type.transformPosition` at the **single choke point
where ops are applied to `JSONState`**. No editing surface knows comments
exist:

- Text edits shift or swallow offsets (a deletion spanning an anchor
  collapses it to the deletion point — Google-Docs semantics).
- Block insert/remove shifts paths; `null` (the anchor's container was
  deleted) triggers the **detach policy** below.
- Subtree `replaceOp` (e.g. paragraph→heading conversion) also yields
  `null`; before detaching, materialize a **rescue attempt**: re-anchor at
  the same path with the offset clamped into the replacement's text when the
  replacement is a commentable text leaf.

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

Document ops and comment-model entries interleave in one history. Undoing a
document op transforms anchors through the inverted op at the same choke
point (transform through an op and its inverse is identity, modulo
tie-breaking at insertion boundaries — pinned by tests). Whole-document
rebuild entries (`replaceContent`, source-mode return, external reload)
snapshot the model alongside the rebuild and restore it on undo across that
boundary.

## Rendering and analysis

- Highlights derive from anchors: for each block, the intersection of paired
  anchor ranges with that block, in clean-text offsets. No tokenizer
  involvement; the `comment_marker` inline token and `mu-comment-marker`/
  `mu-comment-metadata` DOM classes have no runtime occurrences (the
  tokenizer rules remain for file-level scanning only).
- `getComments()` reads the model directly — O(threads + anchors) per call,
  no document scan, no cache invalidation protocol. **Incremental analysis
  falls out**: nothing document-sized happens per keystroke.
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

1. **No MC bytes at runtime**: no state leaf text and no rendered DOM ever
   contains `<!--MC:` or a metadata definition after load.
2. **Round-trip fidelity**: load → (no edits) → serialize is byte-identical
   for well-formed documents (modulo the pre-existing serializer
   normalizations and wire-format version upgrades).
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
