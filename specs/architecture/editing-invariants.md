# Editing Invariants

> The guard-based enforcement this document previously specified (per-path
> marker guards, the hidden-metadata caret invariant, transparent deletion,
> edit refusals) is superseded by the OT-anchor runtime —
> [comment-anchors.md](comment-anchors.md). At runtime there are no hidden
> bytes to protect; the invariants below are what remain true of *editing*
> once comments live out-of-band.

## One coordinate space

Selection offsets, highlight offsets, search matches, word count, and comment
anchors all measure the same clean text. No editing or navigation code maps
between raw-with-markers and visible coordinates; no caret position is ever
"inside hidden syntax" because no such position exists.

## Every edit is an operation

All document mutation flows through `JSONState` operations
(`insert/remove/edit/replace`). That choke point is where comment anchors
transform ([comment-anchors.md](comment-anchors.md) invariant 3) — an editing
surface that mutated state around it would silently strand anchors, so none
may. Block-level structural edits (splits, merges, conversions) are
compositions of those same ops.

## Deletion semantics for commented text

- Deleting part of a commented range shrinks the range (anchors transform
  through the deletion).
- Deleting a whole range collapses it to a caret-width range at the deletion
  point; the thread survives.
- Deleting the block(s) containing a range detaches the thread — kept as
  metadata, surfaced as detached, never silently dropped
  ([comment-anchors.md](comment-anchors.md) detach policy).
- No deletion, paste, cut, Enter, or table operation is ever *refused* on
  account of comments.

## Clipboard and search

- Copy/cut produce exactly the visible text (there is nothing hidden to
  strip). Cutting or deleting the last range of a thread follows the
  deletion semantics above.
- Pasting text that *contains* MC syntax pastes it as literal text — wire
  syntax enters the model only through load/materialization, so paste cannot
  inject ranges or collide ids.
- Search operates over the same clean text the user sees.

## Select-all semantics (unchanged)

- Keyboard Cmd/Ctrl+A (`selection.selectWholeDocument()`): one press spans
  the whole document.
- Menu/toolbar `selectAll()`: progressive — block first, then document, with
  table cell→table→document escalation.

Pinned by `packages/muya/src/selection/__tests__/selectAll.spec.ts` and
`packages/muya/e2e/tests/editing/selection.spec.ts`.

## Round-trip data preservation

`markdownToState` → extraction → materialization → `stateToMarkdown` is
byte-identical for well-formed documents (modulo pre-existing serializer
normalizations and wire-format v1→v2 upgrades). Source-mode round trips
(WYSIWYG → source → WYSIWYG without edits) preserve materialized bytes.
Acceptable normalizations are exactly the pre-existing, test-locked ones —
never comment-specific.
