# 0007 — CriticMarkup Comment Sidebar UX

**Status:** Active
**Created:** 2026-07-17
**Branch:** `feat/native-criticmarkup`
**Reference UX:** `origin/markupdown-inline-comments` (a separate, mature
Google-Docs-style review system — the *look and interaction* are the target;
its storage format is **not** adopted)
**Relationship to 0006:** 0006 shipped pure CriticMarkup (five forms, parser
topology, projections, Track Changes, Review surfaces). This plan corrects one
specific defect 0006 left: the **comment** form's editing UX. It does not
reopen any 0006 decision.

## Problem

The `{>>comment<<}` form is authored through a modal dialog and rendered
**inline** as grey text in the middle of the paragraph (it reveals in full
whenever the caret is nearby). A reviewer expects a comment to behave like
Google Docs: composed in a sidebar, living in a sidebar, with only the
*anchored text* highlighted in the document — never the comment body spliced
into the prose.

## Outcome

Comments are a sidebar experience, not an inline one:

1. **Not shown inline.** The `{>>comment<<}` markers and body never appear in
   the WYSIWYG text flow, regardless of caret position.
2. **Anchor highlighted.** The commented span is highlighted in the document.
   (Commenting on a selection already emits `{==sel==}{>>comment<<}`, so the
   `{==…==}` highlight *is* the anchor.)
3. **Composed in the sidebar.** "Add comment" opens the sidebar with a focused
   compose box; there is no modal.
4. **Lives in the sidebar.** Each comment shows its text and anchor, with
   click-to-scroll, edit, and delete — matching the reference UX's feel.

Completion is a capability judgment: the freshly built desktop app must
demonstrate the whole flow (select → add → see highlight + sidebar card →
edit → delete), not merely pass unit tests.

## Scope boundary and settled decisions

1. **CriticMarkup is the only storage format.** Comments persist solely as the
   canonical `{==sel==}{>>comment<<}` (or a bare `{>>comment<<}` for an empty
   selection). No `<!--MC:id-->` markers, no metadata definitions, no sidecar —
   this inherits 0006 decision 1 (pure CriticMarkup only).
2. **Single-note comments.** A `{>>comment<<}` is one anonymous string.
   Threaded replies, authors, timestamps, and resolve/reopen from the reference
   UI are **out of scope** — they cannot be represented in pure CriticMarkup
   without the metadata encoding decision 1 forbids. The reference UI's *look
   and interaction* are adopted; its thread model is not.
3. **Reuse the reference UI's presentation, re-back the data.** Bring over the
   compose-box + comment-card presentation and the format-agnostic seam
   (a sidebar view over a store field + intent bus). Replace the data provider
   with a CriticMarkup-backed one. Do not port the MC comment engine.
4. **The existing Review surface is the host.** 0006 decision 7 makes the
   native Review sidebar the baseline product UI. Comments are presented there
   (or in a sibling Comments tab that shares its store/controller), not in a
   new parallel subsystem.
5. **Canonical Markdown owns persistence** (0006 decision 8) — the sidebar
   never persists anything but the canonical CriticMarkup bytes.
6. **Preserve user-owned workspace state** (0006 decision 10) — do not modify
   or stage `.vscode/settings.json`.

## Architecture — the seam

Two code maps (2026-07-17) established the integration boundary.

**Reference UI layer (format-agnostic, reusable):** the reference sidebar is a
thin view over one store field and an intent bus. It reads
`comments.threads` / `activeCommentIds` / `addCommentEnabled` /
`composeCommentId` from a Pinia store and emits `comment:add / focus / resolve
/ reopen / reply / edit / discard` on a `mitt` bus; a command router turns
those into calls on an `ICommentSurface` (9 methods). The Vue components, the
edit box, the router shape, the store fields, the i18n keys, and the
menu/context-menu "can a comment start here" plumbing carry **no** knowledge of
the storage format.

**This branch already has the CriticMarkup half:** a `review` sidebar tab with
a badge (the checklist icon in the bug report screenshot), a
`criticMarkupReview` Pinia store (`snapshot.items` of
`ICriticMarkupReviewItem`), a `useCriticMarkupReviewController` that subscribes
to the muya `critic-markup-review-change` event, an executor
(`criticMarkupReview.ts`), the muya facade
(`createCriticMarkup` / `focusCriticMarkup` / `resolveCriticMarkup` /
`getCriticMarkupReviewSnapshot`), and the review panel `review.vue`. What is
missing is exactly the four Outcome behaviours.

**Key enablers proven during mapping:**

- muya persists its selection: `_selectionSnapshot` falls back to the stored
  editor selection when the live DOM selection is gone
  (`criticMarkup/commands.ts:315`). So a sidebar compose box can feed text
  straight into `createCriticMarkup({type:'comment', comment})` — the same
  atomic path the modal uses — with no selection save/restore.
- The comment↔anchor link is derivable by adjacency
  (`highlight.sourceEnd === comment.sourceStart`) via the document's
  source-range queries; there is no linked-pair type today.

**Files that change (by phase):**

- muya render: `inlineRenderer/renderer/criticDocumentFragment.ts` (hide
  inline; optional anchor linkage), `assets/styles/inlineSyntax.css`.
- desktop compose: `components/editorWithTabs/{useCriticMarkupReviewController,
  criticMarkupReview}.ts`, retire the `add-comment` path through
  `CriticMarkupPromptDialog.vue`.
- desktop sidebar: `components/sideBar/{review.vue or a new comments.vue,
  commentEditBox.vue, index.vue, help.ts}`, `store/criticMarkupReview.ts`,
  `static/locales/*.json` (`sideBar.comments.*`).
- muya edit command: `criticMarkup/commands.ts` (+ facade in `muya.ts`).

## Execution — red-green TDD

Every phase is a red test first (a failing assertion that encodes the desired
behaviour), then the minimum change to green, then a regression guard run.

### Phase 1a — the comment is never rendered inline (muya) — **DONE**

- **Red:** with the caret inside a `{>>comment<<}`, the renderer revealed the
  raw markers + body in `mu-gray`
  (`inlineRenderer/renderer/__tests__/criticMarkup.spec.ts`).
- **Green:** a comment fragment now always uses the collapsed hide class, never
  the caret-reveal (`criticDocumentFragment.ts`). The other four forms still
  reveal for inline editing.
- **Evidence:** new test green; 80/80 across the critic render + inline-binding
  + consumer-parity suites.

### Phase 1b — link + highlight the comment's anchor (muya) — deferred polish

Commenting on a selection already highlights the anchor (the `{==…==}` renders
as `<mark>`), so Outcome 2 holds without this. This phase adds the *distinct*
commented-vs-plain-highlight styling, a `data-comment-id` on the anchor, and
click-the-highlight-to-open. Pull it forward only if Phase 3's scroll-to-anchor
needs the linkage.

- **Red:** rendering `{==x==}{>>c<<}` does not put the comment's id on the
  highlight vnode, and a plain `{==x==}` is styled identically to a commented
  one.
- **Green:** derive adjacency in the document/topology, thread an
  `anchorCommentId` onto the highlight fragment, emit `data-comment-id`, add a
  `.mu-critic-comment-anchor` style.

### Phase 2 — compose in the sidebar, not the modal (desktop)

- **Red:** triggering `add-comment` resolves through
  `CriticMarkupPromptDialog` (a modal), and no sidebar compose state is set.
  A unit test on the controller/executor asserts the add-comment intent opens
  a sidebar compose affordance and, on submit, calls
  `createCriticMarkup({type:'comment', comment})` with the persisted selection —
  without invoking the modal `requestText`.
- **Green:** route `add-comment` to a store `composingComment` signal + open the
  Review/Comments sidebar + focus the compose box; the compose box's submit
  runs the create through the controller. Remove the modal from the comment
  path (leave it for `substitution` if still needed, or replace there too in a
  follow-up).

### Phase 3 — the Comments sidebar backed by CriticMarkup (desktop)

- **Red:** the sidebar renders comment items with the reference look — a
  compose box and one card per comment (text + anchor preview + jump/edit/
  delete) — driven by the `criticMarkupReview` store's comment-typed items.
  Tests assert: the store exposes comment items distinctly from the other four
  review types; a card renders the comment `content`; jump calls
  `focusCriticMarkup`; delete calls `resolveCriticMarkup('accept', id)`.
- **Green:** bring `commentEditBox.vue`, add a comments view (reuse
  `review.vue` structure or a sibling `comments.vue`), a comment selector over
  the store, the sidebar tab + badge, and the `sideBar.comments.*` locale keys
  in all shipped locales.

### Phase 4 — edit command, caret-skip, source parity, gate + deploy

- **Red:** there is no muya command to edit a comment's body in place; the caret
  can be placed inside the now-hidden comment and type blind; source-code mode
  must still show the raw `{>>…<<}`.
- **Green:** add an `editComment(id, text)` command (in-place content rewrite,
  or remove+re-add) on the facade; make caret navigation skip over a hidden
  comment region; confirm source-mode already shows the raw bytes.
- **Gate:** muya unit (serial), CommonMark/GFM conformance, muya
  lint/lint:types/check-circular, desktop unit (serial), root lint, vue-tsc,
  fresh `build:unpack`, then rebuild `build:mac:arm64` and redeploy to
  `/Applications` for the capability walkthrough.

## Acceptance criteria

1. In the running app, typing text, selecting it, and choosing Add Comment
   produces a highlighted span and a sidebar card — with **no** comment text
   inline and **no** modal.
2. The `.md` on disk contains exactly `{==sel==}{>>comment<<}` (or
   `{>>comment<<}` for an empty selection) — canonical CriticMarkup, nothing
   else.
3. Clicking a sidebar card scrolls to and reveals its anchor; edit rewrites the
   comment body; delete removes the whole annotation.
4. Source-code mode shows the raw CriticMarkup; round-trip is byte-exact.
5. The full gate is green and the artifact is rebuilt and deployed.

## Evidence ledger

- **2026-07-17** — Phase 1a green. `criticDocumentFragment.ts` forces the
  collapsed class for comments; red proved the caret-reveal, green removed it;
  80/80 critic render + binding + parity suites.
