# Editing Invariants

## The hidden-syntax caret invariant

**A collapsed caret must never REST inside hidden comment syntax in WYSIWYG
mode — by any means.** Arrow keys, word/line/document jumps, mouse clicks,
select-all-then-collapse, and programmatic placement (cursor restore on load,
source-mode handoff, comment jump, undo/redo) all included. A selection may
*span* hidden syntax; a caret may not rest in it. The document, for caret
purposes, ends at the last visible content.

### Enforcement layers

The invariant is enforced at the placement layer, not per key:

1. **Model placement choke point** — `Content.setCursor`
   (`packages/muya/src/block/base/content.ts`) redirects any placement aimed
   at a hidden metadata block to the nearest visible content (end of the
   previous editable block, else start of the next). Every model-driven
   placement — `muya.setCursor`, `setCursorByOffset` source handoff, comment
   jump, render-time restore — flows through this primitive.
2. **Native placement backstop** — `TextSelection.snapCaretOutOfHiddenSyntax`
   listens to the document's `selectionchange` and snaps a collapsed caret
   that came to rest inside a metadata block (native select-all collapse,
   platform-specific jumps, anything nobody enumerated). It ignores
   non-collapsed selections and mid-render detached targets.
3. **Input-path ergonomics** — arrow handling jumps a hidden inline marker in
   a single keystroke (its two boundary offsets share one visual column),
   navigation skips metadata blocks (`nextEditableContentInContext` /
   `previousEditableContentInContext`), clicks snap out, and select-all
   clamps its endpoints past trailing metadata. These exist for single-press
   UX; layers 1–2 are what make the invariant airtight.

Source→WYSIWYG cursor restore from inside an `[MC:id]:` line deliberately
clamps to the last visible position (the mapping is lossy there by design —
the invariant outranks round-trip fidelity of a caret parked in hidden
bytes).

### Select-all semantics

- Keyboard Cmd/Ctrl+A (`selection.selectWholeDocument()`): native semantics —
  ONE press spans the whole document, clamped past hidden metadata.
- Menu/toolbar `selectAll()`: progressive — block first, whole document on
  the next invocation, with table cell→table→document escalation.

Both are pinned by `packages/muya/src/selection/__tests__/selectAll.spec.ts`
and `packages/muya/e2e/tests/editing/selection.spec.ts`.

## Data preservation on editing paths

- **Backspace/forward-delete** must never partially delete a hidden marker
  token; deleting a whole commented range must not strand its metadata
  definition.
- **Cut/copy** never leak marker or metadata bytes into the clipboard unless
  the full raw source is explicitly requested; cutting a range's last marker
  cleans up the now-unreferenced metadata via a full-text marker scan.
- **Paste** of text containing MC syntax must not corrupt the document's
  comment graph (id collisions and mid-document definition insertion are
  guarded).
- **Search** operates over visible prose; hidden syntax is not matched by
  default.
- **Round-trips** (`markdownToState` → `stateToMarkdown`, WYSIWYG ↔ source
  mode without edits, save/reload) preserve comment bytes exactly, including
  duplicate and malformed definitions. Acceptable global serializer
  normalizations (list reflow etc.) are the pre-existing ones locked by
  tests — never comment-specific ones.

Every guard above is locked by specs under
`packages/muya/src/**/__tests__/` (clipboard, format, state round-trip) and
the desktop e2e caret suites (`comment-metadata-unreachable.spec.ts`,
`caret-*.spec.ts`), which assert intermediate state (e.g. "select-all really
selected across blocks") so a platform no-op keystroke fails loudly instead
of leaving the invariant checks vacuously green.
