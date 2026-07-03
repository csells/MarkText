# Achievement Plan: Inline Comments in MarkText

This plan adapts MarkText into a local-first Markdown review editor with portable inline comments. The canonical file format is still plain Markdown; the desktop app and Muya derive all review state from that Markdown on load and serialize it back into the same file on save.

## Hard Requirements

- The `.md` file is canonical and portable.
- No comment data is stored in JSON sidecars, external databases, MCP servers, CRDT documents, or hidden project metadata.
- Comment ranges are represented with paired HTML comments:
  - `<!--MC:id-->` opens a selected range.
  - `<!--MC:~id-->` closes that specific range.
- Explicit close IDs are mandatory because overlapping ranges must work:
  - `<!--MC:a-->alpha <!--MC:b-->beta<!--MC:~a--> gamma<!--MC:~b-->`
- Comment metadata is stored in `[MC:id]: data:application/json;base64,...` reference definitions near the bottom of the same Markdown file.
- Metadata stores thread data only: schema version, status, authors, timestamps, replies, and optional display fields. It must not store anchor offsets, repair coordinates, or alternate anchors.
- WYSIWYG mode hides raw `MC` syntax while showing readable highlights and sidebar threads.
- Source mode preserves the raw syntax and may optionally decorate it, but must never rewrite valid comments unless the user edits the source text.
- Git and the filesystem are the sync model.

## Current Architecture To Use

- The desktop app is a pnpm workspace package at `packages/desktop`. It hosts the Electron renderer, Pinia stores, application menu plumbing, and CodeMirror source mode.
- The active WYSIWYG engine is `@muyajs/core` in `packages/muya`, not the legacy `packages/muyajs` package.
- Muya import flow:
  - `packages/muya/src/state/index.ts` `JSONState.markdownToState()`
  - `packages/muya/src/state/markdownToState.ts` `MarkdownToState.generate()`
  - `packages/muya/src/utils/marked/lexBlock.ts` `lexBlock()`
  - `packages/muya/src/state/types.ts` `TState[]`
- Muya export flow:
  - `packages/muya/src/state/index.ts` `JSONState.getMarkdown()`
  - `JSONState.getMarkdownFromState()`
  - `packages/muya/src/state/stateToMarkdown.ts` `StateToMarkdown.generate()`
- Muya live edit flow:
  - content text setters in `packages/muya/src/block/base/content.ts` emit `ot-text-unicode` operations through `JSONState.editOperation()`.
  - `packages/muya/src/history/index.ts` records `json-change` operations and supports whole-document rebuild entries through `recordRebuild()`.
  - `packages/muya/src/muya.ts` exposes the public API consumed by desktop. New review APIs should be added there instead of making desktop reach into block internals.
- Inline rendering flow:
  - `packages/muya/src/inlineRenderer/index.ts` tokenizes each content block and patches `domNode.innerHTML`.
  - `packages/muya/src/inlineRenderer/rules.ts` currently treats HTML comments as generic `html_tag`.
  - `packages/muya/src/inlineRenderer/lexer.ts` emits generic `html_tag` tokens in `tryHtmlTag()`.
  - `packages/muya/src/inlineRenderer/renderer/index.ts` dispatches token renderers by token type.
  - selection offsets rely on rendered DOM text preserving raw source text lengths. See `packages/muya/src/selection/dom.ts`, `TextSelection.ts`, and `offsetCursor.ts`.
- Desktop editor flow:
  - `packages/desktop/src/renderer/src/components/editorWithTabs/index.vue` mounts WYSIWYG `editor.vue` and overlays `sourceCode.vue` when source mode is enabled.
  - WYSIWYG stays mounted while source mode is open.
  - Entering source mode in `editor.vue` captures `muyaIndexCursor` and `preSourceModeSelection`.
  - Exiting source mode in `sourceCode.vue` emits `file-changed`; `editor.vue` detects the handoff and calls `Muya.replaceContent()`.
  - `editor.vue` listens to Muya `json-change`, serializes `editor.value.getMarkdown()`, and calls `editorStore.LISTEN_FOR_CONTENT_CHANGE()`.
  - External file changes flow through `packages/desktop/src/main/filesystem/watcher.ts` via chokidar, then into the renderer as `mt::update-file`, where `packages/desktop/src/renderer/src/store/editor.ts` decides whether to reload the tab or prompt the user.
  - Saves use the Markdown string from the tab state. `packages/desktop/src/main/filesystem/markdown.ts` writes it with encoding and line-ending handling only.

## Comment Data Model

Add a Muya-owned comment module, suggested path `packages/muya/src/comments/`, with pure helpers that can also be reused by desktop tests and the agent scripts:

- `parseMarkdownComments(markdownOrStates)`:
  - scans all leaf text state nodes that can contain inline Markdown: paragraphs, ATX headings, setext headings, table cells, thematic-break text only if required by current parser behavior, and any other `TLeafState` with `text`.
  - skips fenced code, indented code, math blocks, diagrams, front matter, and raw HTML blocks unless tests prove the marker is inline text inside a paragraph.
  - recognizes `<!--MC:id-->` and `<!--MC:~id-->`.
  - recognizes metadata definitions matching `[MC:id]: data:application/json;base64,...`.
  - returns `threads`, `ranges`, and `diagnostics`.
- `decodeCommentMetadata(raw)` and `encodeCommentMetadata(thread)`:
  - base64 JSON only.
  - stable key ordering so edits do not churn unrelated metadata.
  - schema versioned, starting with `version: 1`.
- `validateCommentGraph()`:
  - duplicate marker IDs.
  - duplicate metadata IDs.
  - malformed metadata definitions still reserve their `MC` ID for duplicate detection; a later valid definition with the same ID must still report `duplicate-metadata`.
  - orphan close marker.
  - unclosed open marker.
  - missing metadata for a marked range.
  - orphan metadata with no markers.
  - malformed base64 or JSON.
  - invalid status or reply shape.

Persisted `TState` should not gain anchor offsets. In the first implementation, keep marker and metadata text in existing leaf state text and derive review state transiently. Do not revive the deprecated `link-reference-definition` state in `packages/muya/src/state/types.ts`.

## Phase 1: Format Spike And Characterization Tests

Create failing tests before implementation.

Muya state tests:

- Add `packages/muya/src/state/__tests__/markdownComments.spec.ts`.
- Cover `MarkdownToState -> StateToMarkdown` round trips for:
  - simple range: `<!--MC:a-->text<!--MC:~a-->`
  - overlapping ranges: `<!--MC:a-->alpha <!--MC:b-->beta<!--MC:~a--> gamma<!--MC:~b-->`
  - metadata definitions: `[MC:a]: data:application/json;base64,...`
  - headings, paragraphs, block quotes, bullet lists, ordered lists, task lists, links, inline formatting, and tables.
  - markers inside inline code and fenced code as literal text.
  - standalone marker comments at block boundaries. Current marked behavior may classify them as `html-block`, so document the actual failure before changing behavior.
  - invalid structures produce diagnostics without dropping source bytes.

Inline lexer tests:

- Add `packages/muya/src/inlineRenderer/__tests__/markdownComments.spec.ts`.
- Assert `<!--MC:id-->` and `<!--MC:~id-->` become a dedicated comment marker token.
- Assert normal HTML comments remain generic HTML.
- Assert inline code tokenization wins before comment marker tokenization.
- Assert metadata definitions do not enter normal reference-link label collection.

Desktop source/WYSIWYG tests:

- Extend or add desktop E2E coverage under `packages/desktop/test/e2e/`.
- Source mode toggle must preserve valid `MC` syntax through:
  - WYSIWYG -> source -> WYSIWYG without edits.
  - source edit outside comment syntax.
  - source edit inside comment metadata.
  - save/reload.
- Include a fixture in `all-blocks-roundtrip.spec.ts` or a new `portable-comments.spec.ts`.

Document current failures in the test names or comments before implementation.

## Phase 2: Parser, Serializer, And Hidden Syntax Rendering

Implement marker recognition without changing the canonical Markdown bytes.

Muya inline parser changes:

- In `packages/muya/src/inlineRenderer/rules.ts`, add a specific MC marker rule such as `comment_marker` for `<!--MC:...-->`.
- In `packages/muya/src/inlineRenderer/lexer.ts`, add `tryCommentMarker()`:
  - place it after `tryChunks()` so inline code, inline math, emoji, and delete spans keep priority.
  - place it before `tryHtmlTag()` so MC markers do not render as generic raw HTML.
  - emit `{ type: 'comment_marker', raw, markerId, markerKind, range }`.
- In `packages/muya/src/inlineRenderer/types.ts`, add `CommentMarkerToken` to the `Token` union.
- In `packages/muya/src/inlineRenderer/renderer/commentMarker.ts`, render the raw marker text in hidden DOM using existing hidden-syntax conventions:
  - retain the raw marker text in DOM text content so offset mapping still works.
  - use `mu-hide` plus a marker-specific class.
  - do not display marker text in normal WYSIWYG mode.
- Register the renderer in `packages/muya/src/inlineRenderer/renderer/index.ts`.

Metadata rendering and label collection:

- In `packages/muya/src/inlineRenderer/index.ts`, skip labels whose paragraph text matches `[MC:id]: data:application/json;base64,...` in `_collectReferenceDefinitions()`.
- In `packages/muya/src/inlineRenderer/renderer/referenceDefinition.ts`, hide MC metadata definitions while preserving raw text in DOM for offset mapping.
- Keep ordinary `[label]: href "title"` behavior unchanged.

State import/export changes:

- Keep metadata definitions as paragraph state nodes unless tests prove a dedicated state is required.
- Preserve every top-level `MC` metadata definition line as paragraph text, including duplicate IDs and malformed metadata. Do not allow the generic Markdown reference-definition parser to deduplicate or drop `MC` metadata before diagnostics can see it.
- Special-case block-level MC marker comments only if marked currently classifies them as `html-block` and that breaks the required range syntax.
- `stateToMarkdown.ts` should serialize marker and metadata raw text exactly except for existing global serializer behavior already covered by tests.

CSS:

- Add marker and highlight classes to `packages/muya/src/assets/styles/inlineSyntax.css` and `packages/muya/src/config/index.ts`.
- Comment highlights must be readable across light and dark themes without overpowering selection/search highlights.

## Phase 3: Comment Range Model And Muya API

Add a transient review state layer in Muya.

Suggested new files:

- `packages/muya/src/comments/types.ts`
- `packages/muya/src/comments/parse.ts`
- `packages/muya/src/comments/metadata.ts`
- `packages/muya/src/comments/diagnostics.ts`
- `packages/muya/src/comments/edit.ts`
- `packages/muya/src/comments/index.ts`

Suggested public API additions in `packages/muya/src/muya.ts`:

- `getComments()`: returns decoded threads, derived ranges, and diagnostics.
- `getActiveComments()`: derives active thread IDs from current selection.
- `addComment(input)`: wraps current selection with markers, appends metadata, and emits one undoable change.
- `updateCommentThread(id, patch)`: updates only the metadata definition.
- `replyToComment(id, reply)`.
- `resolveComment(id)` and `reopenComment(id)`.
- `focusComment(id)`: scrolls/selects the first visible range for a thread.

Implementation notes:

- First implementation may use `Muya.replaceContent()` for `addComment()` and metadata edits so marker insertion plus metadata write is one undo boundary.
- Later optimization can compose text ops directly, but do not start there if it risks splitting a comment action across multiple undo steps.
- Cross-leaf comments are required long term. For the first UI slice, either implement true cross-leaf marker insertion or explicitly gate `addComment()` to one content leaf while parser support already handles cross-block loaded files.
- Overlapping ranges are not tree-shaped. Do not represent them as nested DOM-only tokens. Derive highlight spans by scanning independent open and close marker events.
- Backspace/delete handling in `packages/muya/src/block/base/format.ts` must not partially delete hidden marker tokens. Audit token-edge code such as `_scanBackspaceTokens`.
- Search and clipboard must not leak hidden syntax:
  - `packages/muya/src/search/index.ts` should search visible prose by default, with future explicit source-search behavior if needed.
  - `packages/muya/src/clipboard/copyData.ts` should copy selected visible Markdown without accidentally copying marker syntax unless the full source is requested.

Events:

- Emit a review event from Muya when comments or selection-active comments change, for example `comments-change` and `active-comments-change`.
- Recompute from `json-change` and `selection-change`, not from external mutable state.

## Phase 4: WYSIWYG Review UI In Desktop

Wire the desktop shell to Muya's public comment API.

Primary files:

- `packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue`
- `packages/desktop/src/renderer/src/store/editor.ts`
- `packages/desktop/src/renderer/src/components/sideBar/index.vue`
- `packages/desktop/src/renderer/src/components/sideBar/help.ts`
- new `packages/desktop/src/renderer/src/components/sideBar/comments.vue`
- locale files under `packages/desktop/static/locales/`

UI behavior:

- Highlight commented ranges in Muya without showing `MC` marker syntax.
- Show overlapping comments around the current selection.
- Add a comments sidebar that lists threads, replies, status, diagnostics, and navigation controls.
- Sidebar state should come from Muya-derived comment data, not sidecar persistence.
- Add edit, reply, resolve, reopen, and jump-to-range actions.
- Diagnostics should be visible enough for malformed documents but must not block opening or saving the file.

Command/menu integration:

- Add comment command IDs in `packages/desktop/src/common/commands/constants.ts`.
- Add renderer command-palette entries in `packages/desktop/src/renderer/src/commands/index.ts` and descriptions in `commands/descriptions.ts`.
- Add main-process menu action wiring in `packages/desktop/src/main/menu/actions/`.
- Add menu templates where appropriate. A first cut can put "Add Comment" under Format or Edit, but the final product likely wants a Review menu or sidebar action.
- Add IPC type entries in `packages/desktop/src/shared/types/ipc.ts` when main sends a new command to renderer.
- Hook renderer bus events in `editor.vue` similarly to existing `format` actions.
- Context menu support belongs in `packages/desktop/src/main/contextMenu/editor/` for WYSIWYG. Source mode currently suppresses the browser context menu, so source-mode actions should start with menu/command-palette support unless a CodeMirror context menu is added.
- Menus, context menus, command-palette entries, and command-by-ID execution must share the same commentability predicate. If Add Comment is disabled for the current WYSIWYG or source-mode selection, it must not be shown as an executable command in the palette and direct command execution must no-op.

Selection behavior:

- Reuse `selection-change` payloads from Muya to enable/disable comment actions.
- Do not allow empty collapsed comments unless a product decision explicitly adds point comments.
- Preserve existing keyboard selection, undo/redo, copy/paste, and search behavior.

External file sync behavior:

- A loaded Markdown file must stay connected to its filesystem path because Git and agents are part of the collaboration model.
- When chokidar reports that an opened file changed on disk and the loaded tab has no unsaved local edits, MarkText should reload the new Markdown automatically, independent of the Auto Save preference.
- If the on-disk content is byte-equivalent to the current tab Markdown, ignore the watcher event and keep the tab clean. In implementation terms this means the decoded Markdown and persistence metadata must match: encoding/BOM, line-ending mode, line-ending-on-save behavior, and trailing-newline policy. A CRLF/BOM/encoding-only disk change is not a no-op and must not silently clear a dirty tab.
- Every path-backed tab must keep a per-tab `diskBaseMarkdown` snapshot: the exact Markdown content from the last successful open, save, clean reload, or accepted external merge base. Dirty external sync must never infer its merge base from the undo stack.
- If the editor tab has unsaved local edits and the disk content changed, use Git-style three-way merge semantics before prompting to discard anything:
  - `base` is `diskBaseMarkdown`.
  - `local` is the flushed in-memory editor Markdown.
  - `remote` is the new on-disk Markdown from the watcher payload.
  - If `local === remote`, mark the tab clean and advance the disk base.
  - If `local === base`, reload `remote` normally.
  - If `remote === base`, ignore the event because the disk has no new content relative to the user's edit base.
  - Otherwise run a line-oriented diff3 merge that preserves Markdown line endings and comment marker bytes.
- If the three-way merge has no overlapping conflicts, apply the merged Markdown to the original tab automatically, mark it dirty against the on-disk file, advance `diskBaseMarkdown` to the remote content, and show a non-blocking notification with Undo/review affordance. The user should not have to resolve non-overlapping local-vs-disk edits manually.
- If the three-way merge reports overlapping conflicts, keep the user's current editor buffer intact and open a CodeMirror-based merge resolver:
  - Show read-only panes for "Your unsaved edits" and "Changed on disk".
  - Show an editable result pane initialized with diff3 conflict markers or structured conflict blocks.
  - Provide per-conflict actions for using local, using disk, and using both when practical.
  - Accepting the resolver output replaces the original tab as one undoable reload/merge boundary, marks the tab dirty, and advances `diskBaseMarkdown` to the remote content.
  - Canceling the resolver leaves the original dirty editor buffer untouched.
- Recovery tabs remain the safety fallback, not the primary merge UX. If the user explicitly chooses to abandon merge and reload from disk, MarkText must first preserve the pre-reload local Markdown in a dirty untitled recovery tab, then replace the original tab with the on-disk content. The replacement must also remain recoverable as an explicit undo boundary in both WYSIWYG and source mode; the first undo after the confirmed reload should restore the pre-reload local buffer and mark the original tab dirty.
- After an automatic or accepted dirty merge, run comment parsing/validation against the merged Markdown. If the merge introduces malformed `MC` marker structure, duplicate metadata, or invalid comment metadata that was not already present in the selected input, escalate to the conflict resolver instead of silently applying the merged text.

### Merge engine — settled decision (do not re-litigate)

The three-way merge is performed by [`node-diff3`](https://www.npmjs.com/package/node-diff3), a deterministic, maintained diff3 implementation. We deliberately do **not** shell out to `git`, and do **not** hand-roll a merge algorithm. ("Git-style three-way merge semantics" above means the base/local/remote diff3 *model* — non-overlapping edits auto-merge, overlaps conflict — **not** a requirement that output match `git merge-file`.)

**Correctness is defined by these engine-independent properties, verified by fuzzing, none of which reference git:**

1. **No data loss** — a clean auto-merge never drops a line both sides kept (`merged count >= min(local, remote)` for every distinct line).
2. **No fabrication** — a clean auto-merge never invents content (`merged count <= local + remote` for every distinct line).
3. **Order preservation** — the merged output is order-consistent with *both* sides' own line order (the merge never scrambles content).

`node-diff3` can, in rare cases, emit a clean result that violates the count bounds. `mergeViolatesDataPreservation` (in `packages/desktop/src/renderer/src/util/threeWayMerge.ts`) is the safety net: it rejects any such output and escalates to a whole-file conflict. node-diff3 is the engine; the bounds check guarantees the properties above hold on everything we accept.

**Do not measure merge quality against `git`.** `git`'s diff3 is one valid resolution among several; matching it byte-for-byte is explicitly not a goal. A fuzz that diffs our output against `git merge-file` will show a few percent of "reorder" and "auto-accepted overlap" divergences — those are git-divergence, **not defects** (our output is lossless and order-correct in every one; verified 0 data-loss, 0 fabrication over 30k+ triples and 0 order-scrambles over 5k+ clean merges). The authoritative fuzz asserts properties 1–3 directly, with no git oracle. If someone reopens "why doesn't the merge match git," the answer is: it doesn't need to, and by design won't — that conversation is closed here.
- Auto-reloaded external changes should update the current WYSIWYG/source view, comments sidebar state, diagnostics, highlights, word count, dirty state, and undo history as one coherent reload boundary. The first undo after an auto-reload should restore the pre-reload document and mark the tab dirty against the file on disk.
- Source mode needs the same policy: a clean source-mode tab should receive agent filesystem edits automatically while preserving CodeMirror scroll/cursor as much as practical; a dirty source-mode tab should prompt instead of overwriting.

## Phase 5: Source Mode Preservation And Optional Decorations

Preservation comes before decoration.

Primary files:

- `packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue`
- `packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue`
- `packages/desktop/src/renderer/src/codeMirror/index.ts`
- `packages/desktop/src/renderer/src/codeMirror/markdownMathMode.ts`
- optional new CodeMirror overlay module for MC syntax

Required behavior:

- Switching WYSIWYG -> source -> WYSIWYG without edits must not rewrite valid markers or metadata beyond existing newline normalization.
- `sourceCode.vue` must not run any formatter or source mutation for MC syntax.
- `editor.vue` source handoff through `replaceContent()` is the preservation choke point, so source-mode tests must assert the Markdown after handoff.
- CodeMirror decorations, if added, must be overlays or marks that do not alter `cm.getValue()`.
- Cursor mapping through `getCursorOffset()` and `setCursorByOffset()` must account for hidden marker bytes and metadata definitions.
- Source-mode reload tests must cover clean external agent edits auto-syncing from disk and dirty source buffers prompting instead of being overwritten. Confirmed dirty reload coverage must assert that the local source buffer is preserved in a dirty untitled recovery tab before the original tab is replaced.

## Phase 6: Agent Scripts And Shipped Skill

Add a repo-shipped skill artifact for agents at top-level `skills/markdown-comments/`. This is product documentation/tooling for MarkText-authored Markdown files, not a user-scoped machine skill install. Do not create user-managed skills under `~/.codex/skills`.

Suggested layout:

```text
skills/markdown-comments/
  SKILL.md
  package.json
  src/
    cli.ts
    parse.ts
    metadata.ts
    edit.ts
  test/
```

Required commands:

- `list`: parse comments and emit JSON.
- `edit`: update an existing thread or reply in its metadata reference. Reply edits should be addressable by a deterministic reply index, for example `edit <file> <id> --reply-index 1 --body "updated"`, without rewriting unrelated replies.
- `reply`: append a reply to a metadata reference.
- `resolve`: mark a thread resolved while preserving markers and metadata by default.
- `reopen`: restore a resolved thread to active status.
- `validate`: report malformed markers, missing metadata, duplicate IDs, and orphaned metadata.

Script requirements:

- Operate directly on Markdown files.
- Do not start a server.
- Stay scoped to MarkText `MC` comments. The skill lists, validates, and mutates comment metadata/replies/status; ordinary Markdown edits are direct file edits by the agent, and loaded-editor conflicts are handled by the desktop external-sync merge UI.
- Reuse the same parsing and metadata rules as Muya, either by sharing a small library or by keeping byte-for-byte compatible tests.
- Preserve unrelated Markdown bytes and line endings as much as practical when a skill command mutates one metadata definition. This includes UTF-8 BOM, mixed line separators, target-line trailing whitespace, and no-final-newline policy.
- Emit deterministic JSON for agent workflows. Document the `threads`, `ranges`, and `diagnostics` schema, including that range paths/offsets are Muya parser/state text coordinates rather than byte offsets or persistent alternate anchors.

## Phase 7: Quality Gates

Run the narrowest relevant checks while developing, then the broader gates before calling the feature usable.

Muya checks:

```sh
pnpm -C packages/muya test
pnpm -C packages/muya lint:types
pnpm -C packages/muya check-circular
```

Desktop checks:

```sh
pnpm test
pnpm test:skills
pnpm typecheck
pnpm build
pnpm --filter marktext test:e2e
```

Full setup gate when dependencies are not installed:

```sh
pnpm install
```

Focused regression coverage must include parser, serializer, hidden rendering, selection offsets, source/WYSIWYG switching, sidebar actions, menu commands, undo/redo, copy/paste, search, save/reload, clean external agent file auto-sync, dirty external-change prompting, Git-style dirty external merge, CRLF/BOM/no-final-newline preservation in merge and skill metadata edits, dirty reload recovery tabs, and agent-script behavior.

End-to-end coverage additionally exercises the full comment lifecycle in both WYSIWYG and source mode (add, reply, edit, resolve, reopen, jump, and **discard** — the compose-cancel path that strips a just-created comment's syntax), save/reopen byte preservation, and the merge-conflict resolver's per-conflict choices (**Use Yours / Use Disk / Use Both**) plus whole-file accept/reload/undo. The goal is that these workflows never require manual verification — only real-world dogfooding of a local build covers subjective UX, visual fidelity, large-document performance, and OS-native integration.

## Known Risks

- Generic HTML comments currently render through the normal inline HTML path; MC markers must be special-cased before that path.
- Standalone HTML comments may parse as block HTML and get trimmed by `markdownToState.ts`; tests must characterize and then fix this if needed.
- Hidden marker DOM must preserve text length or selection offsets, source cursor mapping, and undo restoration will drift.
- Overlapping ranges cannot be represented as a simple nested inline tree.
- Existing serializers may reflow lists and tables. Tests must separate acceptable existing normalization from comment-specific data loss.
- Source mode only commits some edits on source exit today. Do not assume a CodeMirror `cursorActivity` save event means the WYSIWYG engine has already accepted the edit.
- Search, copy, paste, and token-edge deletion can accidentally expose or corrupt marker bytes unless explicitly hardened.
- The current file watcher path can detect loaded-file changes, but tying silent reload to the Auto Save preference would make agent-authored filesystem edits invisible until the user accepts a prompt. Clean external changes should auto-sync regardless of Auto Save; only dirty editor buffers should block automatic reload.
