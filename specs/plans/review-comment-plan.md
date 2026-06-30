# Achievement Plan: Inline Comments in MarkText

This plan adapts MarkText into a local-first Markdown review editor with portable inline comments. The plan starts from the existing Electron desktop app, Muya WYSIWYG engine, and CodeMirror source mode.

## Hard Requirements

- The `.md` file is canonical and portable.
- No comment data is stored in JSON sidecars, external databases, MCP servers, CRDT documents, or hidden project metadata.
- Comment ranges are represented with paired HTML comments:
  - `<!--MC:id-->` opens a selected range.
  - `<!--MC:~id-->` closes that specific range.
- Explicit close IDs are mandatory because overlapping ranges must work.
- Comment metadata is stored in `[MC:id]: data:application/json;base64,...` reference definitions near the bottom of the same Markdown file.
- Metadata stores thread data only: status, authors, timestamps, replies, and schema version. It must not store anchor offsets or repair coordinates.
- WYSIWYG mode hides raw `MC` syntax while showing readable highlights and sidebar threads.
- Source mode preserves the raw syntax and may optionally decorate it, but must never rewrite valid comments unnecessarily.
- Git and the filesystem are the sync model.

## Phase 1: Format Spike and Tests

Create failing unit tests in `packages/muya/src/state/__tests__/` for round-tripping Markdown that contains `MC` range markers and metadata references.

Test cases:

- Simple range: `<!--MC:a-->text<!--MC:~a-->`
- Overlapping ranges: `<!--MC:a-->alpha <!--MC:b-->beta<!--MC:~a--> gamma<!--MC:~b-->`
- Markers across inline formatting, links, lists, block quotes, headings, and tables.
- Markers inside code spans or fenced code are treated as literal text, not comments.
- Leading inserts in a document do not require metadata rewrites.
- Invalid structures produce diagnostics without data loss.

Document the current failure mode before implementing fixes.

## Phase 2: Parser and State Model

Map `MC` markers into Muya state without treating them as user-visible prose. Primary files to inspect first:

- `packages/muya/src/state/markdownToState.ts`
- `packages/muya/src/state/stateToMarkdown.ts`
- `packages/muya/src/inlineRenderer/lexer.ts`
- `packages/muya/src/inlineRenderer/rules.ts`
- `packages/muya/src/state/types.ts`

Add a small comment-thread model that derives anchor ranges from marker IDs and metadata references while editing. Any in-memory positions are transient parser state only; persisted metadata must never store offsets, repair coordinates, or alternate anchors. The model must serialize back to the original compact Markdown syntax.

## Phase 3: WYSIWYG Review UI

Add visible comment affordances in Muya and the desktop shell:

- Highlight commented ranges without showing marker text.
- Show active and overlapping comments around the current selection.
- Add a sidebar for threads, edit, replies, resolve/reopen, and navigation.
- Add a toolbar or context-menu action to comment on the current selection.
- Keep keyboard selection, undo/redo, copy/paste, and search behavior coherent.

Start in `packages/muya/src/ui/`, `packages/muya/src/selection/`, and `packages/desktop/src/renderer/src/components/editorWithTabs/`.

## Phase 4: Source Mode Preservation

Update the CodeMirror source mode path in `packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue` so switching between source and WYSIWYG preserves valid `MC` ranges and metadata exactly unless the user edits them.

Add source-mode decorations only after preservation tests pass.

## Phase 5: Agent Scripts

Add a product-shipped agent skill at top-level `skills/markdown-comments/` with JSON-producing scripts for agents. This is not a project-scoped build helper; it is the skill deployed agents use to manage portable comments in Markdown files produced by MarkText. Required commands:

- `list`: parse comments and emit JSON.
- `edit`: update an existing thread or reply in its metadata reference.
- `reply`: append a reply to a metadata reference.
- `resolve`: mark a thread resolved while preserving markers and metadata by default.
- `reopen`: restore a resolved thread to active status.
- `validate`: report malformed markers, missing metadata, duplicate IDs, and orphaned metadata.

These scripts operate directly on Markdown files. They must not start a server.

## Phase 6: Quality Gates

Before calling the feature usable, run:

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm --filter marktext test:e2e
```

Add focused tests for every parser, serializer, sidebar, source/WYSIWYG switch, and agent-script behavior touched by the implementation.
