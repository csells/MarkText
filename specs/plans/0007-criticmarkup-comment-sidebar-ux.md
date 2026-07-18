# 0007 — CriticMarkup Comment Sidebar UX

**Status:** Active
**Created:** 2026-07-17
**Design settled:** 2026-07-17 via a grilling session (see decisions below;
domain terms in `CONTEXT.md`, hard decisions in `docs/adr/0001–0004`).
**Branch:** `feat/native-criticmarkup`
**Reference UX:** `origin/markupdown-inline-comments` (a separate, mature
Google-Docs-style review system — its *look and interaction* informed this
design; its `<!--MC:id-->` storage format is **not** adopted).
**Relationship to 0006:** 0006 shipped pure CriticMarkup (five forms, parser
topology, projections, Track Changes, Review surfaces). This plan corrects one
specific defect 0006 left — the **comment** form's editing UX — without
reopening any 0006 decision.

## Problem

The `{>>comment<<}` form was authored through a modal dialog and rendered
**inline** as grey text in the middle of the paragraph (revealing in full
whenever the caret was nearby). A reviewer expects a comment to behave like
Google Docs: composed in a sidebar, living in a sidebar, with only the
*anchored text* highlighted in the document — never the comment body spliced
into the prose.

## Outcome

Comments are a sidebar experience, not an inline one:

1. **Not shown inline.** The `{>>comment<<}` markers and body never appear in
   the WYSIWYG text flow, regardless of caret position.
2. **Anchor highlighted.** A commented span's `{==…==}` anchor is highlighted
   and visibly distinguishable from a plain highlight.
3. **Composed in the sidebar.** Add Comment opens the sidebar with a focused
   compose box; there is no modal.
4. **Lives in the sidebar.** Each comment is one card (its text, its anchor),
   editable and removable there.
5. **Explicit and non-intrusive.** Putting the caret in a commented span marks
   its card selected — nothing opens or scrolls on its own. Editing is a
   deliberate act (click the card, or right-click → Edit Comment).

Completion is a capability judgment: the freshly built desktop app must
demonstrate the whole flow (select → add → highlighted anchor + sidebar card →
edit → delete), not merely pass unit tests.

## Settled decisions

Inherited from 0006 (unchanged): pure CriticMarkup only (decision 1); canonical
Markdown owns persistence (decision 8); existing Review surfaces are the
baseline UI (decision 7); do not touch `.vscode/settings.json` (decision 10).

Settled here (grilling, 2026-07-17):

1. **Single-note comments** *(Q1 · ADR-0001)*. A comment is one anonymous
   `{>>…<<}` string; lifecycle is create → edit → delete. No replies, authors,
   timestamps, or resolved state — none are representable in pure CriticMarkup,
   and deleting is the only "done". The reference UI's look/interaction are
   adopted; its threaded data model is not.
2. **Every app-made comment has a highlighted anchor** *(Q2)*. Add Comment
   **requires a selection** and emits `{==sel==}{>>note<<}`. A bare `{>>note<<}`
   (typed in source, imported, or left by anchor deletion) still renders and
   round-trips, but the app never creates one.
3. **A commented span is one unit** *(Q6 · ADR-0003)*. Identity follows
   creation intent — Mark Highlight → a plain highlight; Add Comment → a
   commented span. The proxy is source adjacency: a gapless `{==…==}{>>…<<}` is
   a comment's anchor; a lone `{==…==}` is a highlight. The pair is created and
   removed together and shown as **one** Comment entry (never a separate
   Highlight card).
4. **Editing is in place** *(Q4)*. A new muya command rewrites only the
   `{>>…<<}` content through the single mutation gateway, keeping the same
   anchor and item identity. Two entry points: click the sidebar card, or
   right-click the span → Edit Comment.
5. **The caret never enters a hidden comment** *(Q5 · ADR-0002)*. A hard
   navigation invariant enforced at the cursor-placement layer — no arrow,
   jump, click, select-all-collapse, or programmatic restore may land inside
   the collapsed `{>>…<<}`.
6. **Anchor deletion keeps the comment** *(Q7)*. Deleting all of a comment's
   anchored text leaves the `{>>…<<}` as a point comment — still listed and
   removable in the sidebar. The app never silently destroys a comment.
7. **Selection is passive; viewing/editing is explicit** *(Q8 · ADR-0004)*.
   Caret inside a commented span marks its sidebar card selected and does
   **nothing else** — it never opens or scrolls the sidebar. The user opens the
   comments sidebar themselves; edits a comment by clicking its card or via
   right-click → Edit Comment. (Composing a *new* comment does open the sidebar,
   because the compose box must be visible.)
8. **Flat Review list** *(Q3)*. Comments and tracked changes share the one
   Review list as cards; no dedicated Comments tab and no sectioning.
9. **Nested/overlapping comments are allowed but unspecialised.** Commenting on
   a selection that already contains a comment nests as CriticMarkup permits; no
   special handling for now.

## Architecture — the seam

**This branch already owns the CriticMarkup review stack:** a `review` sidebar
tab + badge, a `criticMarkupReview` Pinia store (`snapshot.items` of
`ICriticMarkupReviewItem`), `useCriticMarkupReviewController` (subscribed to the
muya `critic-markup-review-change` event), the executor `criticMarkupReview.ts`,
the review panel `review.vue`, and the muya facade (`createCriticMarkup` /
`focusCriticMarkup` / `resolveCriticMarkup` / `getCriticMarkupReviewSnapshot`).
The comment UX is built on this stack, not a ported subsystem.

**Key enablers proven during mapping (2026-07-17):**

- muya persists its selection — `_selectionSnapshot` falls back to the stored
  editor selection when the live DOM selection is gone
  (`criticMarkup/commands.ts:315`) — so the sidebar compose box feeds text
  straight into `createCriticMarkup({type:'comment', comment})`.
- The comment↔anchor link is derivable by adjacency
  (`highlight.sourceEnd === comment.sourceStart`) via the document's
  source-range queries; there is no linked-pair type in the data today.

**Files in play:** muya render `inlineRenderer/renderer/criticDocumentFragment.ts`
+ `assets/styles/inlineSyntax.css`; muya command/navigation
`criticMarkup/commands.ts`, `muya.ts`, the selection/cursor-placement layer, and
the review snapshot (`criticMarkup/reviewSnapshot.ts` + `reviewContract.ts`) for
anchor subsumption; desktop `components/editorWithTabs/{useCriticMarkupReviewController,
criticMarkupReview,commentComposer}.ts`, `components/sideBar/{review.vue,index.vue}`,
`store/criticMarkupReview.ts`, the editor context menu (`main/contextMenu/…`),
`static/locales/*.json`.

## Status & divergences to correct (gap analysis 2026-07-17)

Phases 1a/2/3 are committed and green. The gap analysis surfaced five places
where the *current* build contradicts a settled decision (not merely missing) —
each is folded into the phase that fixes it:

- **D1 — Add Comment allowed with no selection** (`commands.ts:413-419` permits
  a collapsed caret for `comment`). Violates decision 2. Fixed in Phase 4.
- **D2 — the anchor double-lists** (`reviewSnapshot.ts` maps items 1:1, so
  `{==sel==}{>>c<<}` is two cards; Remove strands one). Violates decision 3.
  Fixed in Phase 4.
- **D3 — the in-document indicator force-opens/scrolls the sidebar**
  (`criticDocumentFragment.ts:121` → `focusCriticMarkup`). Violates decision 7.
  Fixed in Phase 6.
- **D4 — clicking a sidebar comment card jumps the document** (`review.vue`
  focus action) rather than editing it. Violates decision 7. Fixed in Phase 5.
- **D5 — the anchor renders as an indistinguishable plain highlight.** Violates
  decision 3 / Outcome 2. Fixed in Phase 4.

Phase 6 (passive selection) is half-present already: `_currentEntry`
(`commands.ts:620`) derives the current item from the caret, and `review.vue`
marks that card active — so once the anchor is subsumed (Phase 4) and D3/D4 are
removed, caret-in-a-span → active comment card falls out for free.

## Execution — red-green TDD

Every phase: a red test encoding the behaviour, the minimum change to green, a
regression run.

### Phase 1a — comment never rendered inline (muya) — **DONE**

Red proved the caret-reveal; green forces the collapsed class for comments
(`criticDocumentFragment.ts`). 80/80 critic render + binding + parity suites.

### Phase 2 — compose in the sidebar, not the modal (desktop) — **DONE**

`createCommentComposer` (pure, 4/4) satisfies the executor's
`requestText('comment')` from the sidebar; the controller owns it, the store's
`composing` signal drives the compose box, the sidebar container opens the
Review tab on compose. Store signal red-green.

### Phase 3 — compose box + comment cards (desktop) — **DONE (baseline)**

`review.vue` has the compose box (textarea, Enter submits, autofocus); the
Review list already renders each comment as a card (content + focus + remove).
Baseline only — anchor subsumption, edit, and passive-selection land below.

### Phase 4 — subsume the anchor into the comment *(decision 3, Q6)*

- **Red:** a rendered `{==x==}{>>c<<}` does not carry the comment's id on the
  anchor and is styled like a plain highlight; the review snapshot lists the
  anchor highlight as its own item alongside the comment (double-listing);
  removing the comment card does not remove the anchor.
- **Green:** derive anchor↔comment adjacency in the document/topology; the
  review snapshot presents the pair as **one** comment item (anchor subsumed,
  not a separate highlight item); the anchor renders with a distinct
  commented marker; Remove on the comment deletes the whole pair.

### Phase 5 — editing a comment *(decision 4, Q4; decision 7, Q8)* — **DONE (core)**

- **Red/green (done):** `editCriticMarkupComment(target, text)` on the muya
  review contract + facade rewrites the `{>>…<<}` body through the mutation
  gateway (anchor + id preserved; refuses a non-comment target or empty text).
  The sidebar comment card gained an Edit action opening an inline box; Save
  routes through the controller to the command. Red-green on the muya command
  and the controller edit-routing.
- **Deferred (convenience):** the native editor context-menu **Edit Comment**
  item. It needs racy cross-process plumbing (renderer comment hit-test → IPC →
  the main `context-menu` handler, which fires after the DOM event). The edit
  requirement is fully met by the sidebar Edit action, and passive selection
  already surfaces the right comment card when you click into its span, so this
  is a follow-up, not a blocker.

### Phase 6 — passive selection *(decision 7, Q8)*

- **Red:** the in-document comment affordance force-opens/scrolls the sidebar on
  click (today's `focusCriticMarkup` behaviour), violating "nothing else
  happens".
- **Green:** caret/selection inside a commented span marks that card selected in
  the sidebar (active-comment state) and nothing more — no open, no scroll-jack.
  Opening the sidebar stays a user action.

### Phase 7 — caret never enters the hidden comment *(decision 5, Q5 · ADR-0002)* — **DEFERRED (tracked)**

The hard invariant is a large, high-risk change to muya's core cursor layer:
muya has **no single `selectionchange` backstop** — the caret flows through
native browser movement (arrows/clicks) observed on keyup/click, plus
`Content.setCursor` for programmatic placements, plus the input path. Enforcing
"never enters, by any means" touches all of them, and a rushed change risks
breaking ordinary editing — a worse outcome than the residual gap (the comment
is already visually collapsed via Phase 1a and is read/edited in the sidebar;
the narrow remaining risk is arrowing into the zero-width region and typing).

Deferred deliberately rather than rushed. Design for the follow-up:

- **Placement redirect** in `Content.setCursor` (Format-aware): using
  `criticMarkupFragmentsForPath`, snap an offset strictly inside a comment
  fragment's local range to the nearest edge. Covers programmatic restores,
  `focusCriticMarkup`, post-edit cursor reseats — cleanly unit-testable.
- **Native backstop**: after a keyup/click selection read, if the caret landed
  inside a comment's hidden range, snap it out (the arrows/clicks path).
- **Input guard**: reject an input mutation whose target offset is inside a
  comment's hidden range (defence-in-depth against corruption).

Do this as a focused change with its own red-green battery, not squeezed into
this pass.

### Phase 8 — anchor-deletion survival + gate + deploy *(decision 6, Q7)*

- **Red:** deleting all of a comment's anchored text drops the comment.
- **Green:** confirm/guarantee the `{>>…<<}` survives as a point comment, still
  listed and removable.
- **Gate:** muya unit (serial), CommonMark/GFM conformance, muya
  lint/lint:types/check-circular, desktop unit (serial), root lint, vue-tsc,
  fresh `build:unpack`; then rebuild `build:mac:arm64` and redeploy to
  `/Applications` for the capability walkthrough.

## Acceptance criteria

1. Select text → Add Comment produces a **highlighted, distinguishable** anchor
   and **one** sidebar card — no inline comment text, no modal, no separate
   Highlight card for the anchor.
2. The `.md` on disk contains exactly `{==sel==}{>>note<<}` — canonical
   CriticMarkup, nothing else.
3. Caret in a commented span selects its card and does nothing else. Editing is
   explicit (click the card, or right-click → Edit Comment) and rewrites the
   body in place; Remove deletes the whole pair.
4. The caret cannot be placed inside a hidden comment by any means.
5. Deleting a comment's anchored text leaves a removable point comment.
6. Source-code mode shows the raw CriticMarkup; round-trip is byte-exact.
7. The full gate is green and the artifact is rebuilt and deployed.

## Evidence ledger

- **2026-07-17** — Phase 1a green (comment never inline); 80/80 critic render +
  binding + parity suites.
- **2026-07-17** — Phase 2 green (`createCommentComposer` 4/4; store `composing`
  red-green); composer owned by the Review controller (0006 editor.vue
  invariant held; focus-invariant test refined).
- **2026-07-17** — Phase 3 baseline green (compose box + existing comment
  cards). Milestone gate: desktop unit 893/893, muya render/critic/state
  1068/1068, typecheck clean, lint 0 errors. Built + deployed to `/Applications`.
- **2026-07-17** — Design settled via grilling; decisions 1–9 above recorded in
  `CONTEXT.md` and `docs/adr/0001–0004`. Phases 4–8 re-scoped from those
  decisions (anchor subsumption, in-place edit + right-click, passive selection,
  hard caret-skip, anchor-deletion survival).
- **2026-07-17** — Phases 4–8 landed red-green:
  - **Phase 4** (anchor subsumption): review snapshot folds the anchor into one
    comment item (+anchorId/anchorText) with a caret→comment current-item remap;
    symmetric paired removal (resolving either half removes both); Add Comment
    requires a selection; desktop card previews the anchored text. Cross-consumer
    parity corpus updated for the fold (document/live/HTML/clipboard unchanged).
  - **Phase 5** (edit): `editCriticMarkupComment` gateway command +
    contract/facade; sidebar card Edit action → inline box → controller routing.
    Native right-click Edit Comment deferred (racy cross-process menu; sidebar
    Edit covers it).
  - **Phase 6** (passive selection): the in-document indicator is presentational
    (no force-scroll); the caret drives card selection via the Phase 4 remap.
  - **Phase 7** (hard caret-skip): **deferred** — large, high-risk cursor-layer
    change; design + rationale recorded above.
  - **Phase 8** (survival): a point comment stays listed + removable.
  - **Gate (all green):** muya unit 3,316/3,316, CommonMark/GFM conformance
    1,347/1,347, desktop unit 894/894, root lint 0 errors, vue-tsc clean, muya
    lint:types + check-circular clean.
