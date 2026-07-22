# 0007 — CriticMarkup Comment Sidebar UX

**Status:** Archived on 2026-07-19; superseded by
[`0009-criticmarkup-document-engine-rebuild.md`](../0009-criticmarkup-document-engine-rebuild.md)

**Created:** 2026-07-17
**Design settled:** 2026-07-17 via a grilling session (see decisions below;
domain terms in `CONTEXT.md`, hard decisions in `docs/adr/0001–0004`).
**Branch:** `feat/native-criticmarkup`
**Reference UX:** `origin/markupdown-inline-comments` (a separate, mature
Google-Docs-style review system — its _look and interaction_ informed this
design; its `<!--MC:id-->` storage format is **not** adopted).
**Relationship to archived 0006:** 0006 established the pure-CriticMarkup foundation
(five forms, parser topology, projections, Track Changes, Review surfaces).
This plan specifies the **comment** form's editing UX without reopening those
product decisions. Plan 0009 has absorbed both archived plans' surviving
requirements and is now the sole active contract. Manual dogfooding happens
afterward and is not a completion requirement.

**Plan 0009 owns the rebuild and acceptance.** It supersedes this plan's legacy
architecture, phase/checkmark status, serializer-normalization allowances, and
claims that legacy evidence proves the rebuilt engine. Every surviving Comment
UX outcome and automated acceptance requirement was transferred there. This
implementation history is an oracle and regression inventory, not an active
queue or rebuild completion evidence.

## Problem

The `{>>comment<<}` form was authored through a modal dialog and rendered
**inline** as grey text in the middle of the paragraph (revealing in full
whenever the caret was nearby). A reviewer expects a comment to behave like
Google Docs: composed in a sidebar, living in a sidebar, with only the
_anchored text_ highlighted in the document — never the comment body spliced
into the prose.

## Outcome

Comments are a sidebar experience, not an inline one:

1. **Not shown inline.** The `{>>comment<<}` markers and body never appear in
   the WYSIWYG text flow, regardless of caret position.
2. **Anchor highlighted.** A commented span's `{==…==}` anchor is highlighted
   and visibly distinguishable from a plain highlight.
3. **Composed in the sidebar.** Add Comment opens the sidebar with a focused
   compose box; there is no modal.
4. **Lives in the sidebar.** Each Comment in the main document/CM-arm tree—one
   that is not inside another Comment payload—is one card, editable and
   removable there. An anchored card shows its text and anchor preview; a
   standalone Comment shows an explicit unanchored state rather than inventing
   an anchor. A properly nested Comment inside another Comment is lossless raw
   outer-payload content, not a second main Review item: edit it through the
   outer card's raw-payload editor or Source mode. It is never silently dropped
   or given an action whose outer-Comment elision makes unreachable.
5. **Explicit and non-intrusive.** Putting the caret in a commented span marks
   its card selected when no deeper visible Review item owns the exact hit;
   nested anchors choose the innermost Comment. Nothing opens or scrolls on its
   own. Editing is a deliberate act (click the card, or right-click → Edit
   Comment); a nested right-click retains the deepest item's actions and also
   offers Edit Comment for the nearest containing anchor.
6. **Mouse-accessible.** A user can open the Review sidebar by mouse alone even
   when the entire sidebar is hidden; opening it cannot require a keyboard
   shortcut, command palette, or starting a comment/edit operation.

Completion is a capability judgment: the freshly built desktop app must
demonstrate the whole flow (select → add → highlighted anchor + sidebar card →
edit → delete), not merely pass unit tests.

## Settled decisions

Inherited from 0006 (unchanged): pure CriticMarkup only (decision 1); the
immutable revision's exact decoded source owns persistence (decision 8);
existing Review surfaces are the baseline UI (decision 7); do not touch
`.vscode/settings.json` (decision 10).

Settled here (grilling, 2026-07-17):

1. **Single-note product model** _(Q1 · ADR-0001)_. CriticMarkup Comment is
   generic, unstructured metadata whose `{>>…<<}` payload may contain any text,
   including author initials, timestamps, or Markdown-looking bytes. MarkText
   presents that payload as one note with a create → edit → delete lifecycle;
   it defines no author, reply, thread, or resolved-state schema. Deleting is
   the only product-level "done". The reference UI's look/interaction are
   adopted; its threaded data model is not.
2. **Every Add Comment result has a highlighted anchor** _(Q2)_. Add Comment
   **requires a nonempty selection** and emits `{==sel==}{>>note<<}`. A bare
   `{>>note<<}` (typed in source, imported, or left by anchor deletion) still
   renders and round-trips, but Add Comment never creates one.
3. **A commented span is one derived Review presentation** _(Q6 · ADR-0003)_.
   The parser retains independent Highlight and Comment nodes. Review freshly
   derives a nonempty, gapless `{==text==}{>>…<<}` relation from each source
   revision; no creation intent, attachment edge, or linked-pair identity is
   persisted. Nonempty uses plan 0009's revision-owned, ancestor-net root-Revised
   contribution atom set, not raw payload length or renderer pixels; Comment
   payload emptiness is irrelevant.
   The pair is shown as **one** Comment entry (never a separate
   Highlight card). Explicit **Remove comment** unwraps the Highlight while
   retaining its exact payload source, including nested CM and subject only to
   minimum protection at a delimiter causally reclassified by the transform or
   a provenance-bearing `BofTextCodecV1` encoding when unwrapping moves an
   ordinary nonleading U+FEFF to offset zero,
   and deletes the Comment; ordinary
   anchor-prose deletion instead preserves a standalone Comment under
   decision 6.
4. **Editing is in place** _(Q4)_. `DocumentSession.dispatch` plans an exact
   source edit for only the `{>>…<<}` raw payload, validates the candidate
   revision, and commits atomically. The field edits Markdown/CM payload source;
   nested syntax and protective spelling are intentional and exact, while an
   empty or target-destroying payload rejects with the draft retained. Node
   references are revision-bound; only a proven `RevisionTransition` may rebase
   one. Two entry points consume that same intent: click the sidebar card, or
   right-click the span → Edit Comment.
5. **The caret never enters a hidden comment** _(Q5 · ADR-0002)_. A hard
   navigation invariant enforced at the cursor-placement layer — no arrow,
   jump, click, select-all-collapse, or programmatic restore may land inside
   the collapsed `{>>…<<}`.
6. **Anchor deletion keeps the comment** _(Q7)_. For a root-effective
   `(present,present)` anchor with no Comment descendant, deleting all anchored
   prose removes the Highlight wrapper and leaves the canonical standalone
   `{>>…<<}` Comment — still listed and removable in the sidebar. With Track
   Changes on, the complete Highlight is instead wrapped in a Deletion: Accept
   leaves the bare Comment and Reject restores the exact pair. Inside an
   `(absent,present)` Addition or Substitution-new carrier, the existing pending
   carrier policy wins and deletion is direct, with the outer Comment retained
   in that carrier. Before any carrier policy, a hidden Comment descendant makes
   whole-anchor deletion—or the partial edit that would remove the last
   root-Revised contribution—reject visibly and preserve exact source; the user
   must explicitly remove that inner Comment or use Source. Without such a
   descendant, the last partial edit discards the exhausted Highlight wrapper
   when tracking is off while retaining residual untargeted non-Comment nodes.
   Root-effective tracking wraps that exact current Highlight in one Deletion,
   even after earlier partial tracked edits, so Reject restores the immediately
   prior anchor. The app never silently destroys a comment and
   never persists `{====}` as a barrier, sentinel, or zero-width anchor.
7. **Selection is passive; viewing/editing is explicit** _(Q8 · ADR-0004)_.
   Caret inside a commented span marks its sidebar card selected only when no
   deeper visible Review item owns that hit; nested anchors choose the
   innermost/deepest Comment, while explicit parent card/navigation focus stays
   on that parent while it survives. This does **nothing else**—it never opens or
   scrolls the sidebar. The user opens Review themselves and edits a comment by
   clicking its card or via right-click → Edit Comment. A right-click query
   carries the deepest item ancestry so nested change commands remain present
   while Edit Comment targets the nearest containing anchor. (Composing a _new_
   comment does open the sidebar, because the compose box must be visible.)
8. **Flat Review list** _(Q3)_. Comments and tracked changes share the one
   Review list as cards; no dedicated Comments tab and no sectioning.
9. **Only proper CM nesting is valid.** Same-kind and mixed-kind CM items may
   nest, and a selection-based command may wrap complete existing items. CM
   items never cross or partially overlap other CM items; authoring that would
   create such an intersection rejects visibly. Markdown and CM remain
   independent structures and may cross each other's containment boundaries.
10. **Mouse entry is core sidebar UX, not deferred accessibility work.** The
    Review icon opens the panel when the sidebar rail is visible. When the whole
    sidebar is hidden, a discoverable editor-shell Review control outside that
    collapsible subtree must still open it without starting an edit or moving
    editor focus.

## Legacy architecture inventory (historical only)

The following stack and file map describe the implementation that produced this
plan's original evidence. They are migration inputs, not the target seam. Plan
0009's `DocumentSession`, source-native `TransformationKernel`, immutable
revision, typed command presentations, and `LiveRenderPlan` own the rebuild; the
legacy mutation gateway, bindings/rebinding, copied facade state, and private UI
parser logic must be deleted.

**The legacy branch owns this CriticMarkup review stack:** a `review` sidebar
tab + badge, a `criticMarkupReview` Pinia store (`snapshot.items` of
`ICriticMarkupReviewItem`), `useCriticMarkupReviewController` (subscribed to the
muya `critic-markup-review-change` event), the executor `criticMarkupReview.ts`,
the review panel `review.vue`, and the muya facade (`createCriticMarkup` /
`focusCriticMarkup` / `resolveCriticMarkup` / `getCriticMarkupReviewSnapshot`).
The legacy comment UX was built on this stack, not a ported subsystem.

**Key enablers proven during mapping (2026-07-17):**

- muya persists its selection — `_selectionSnapshot` falls back to the stored
  editor selection when the live DOM selection is gone
  (`criticMarkup/commands.ts:315`) — so the sidebar compose box feeds text
  straight into `createCriticMarkup({type:'comment', comment})`.
- The comment↔anchor presentation is freshly derivable for a nonempty
  Highlight by adjacency (`highlight.sourceEnd === comment.sourceStart`) via
  each revision's source-range queries; there is no persisted creation intent,
  attachment edge, or linked-pair type.

**Legacy files in play:** muya render
`inlineRenderer/renderer/criticDocumentFragment.ts` and
`assets/styles/inlineSyntax.css`; muya command/navigation
`criticMarkup/commands.ts`, `muya.ts`, the selection/cursor-placement layer, and
the review snapshot (`criticMarkup/reviewSnapshot.ts` + `reviewContract.ts`) for
anchor subsumption; desktop
`components/editorWithTabs/{useCriticMarkupReviewController,criticMarkupReview,commentComposer}.ts`,
`components/sideBar/{review.vue,index.vue}`, `store/criticMarkupReview.ts`, the
editor context menu (`main/contextMenu/…`), and `static/locales/*.json`.

## Legacy status and divergences (historical evidence)

> **Reset by plan 0009:** every DONE/green label below applies only to the legacy
> implementation. It proves no rebuild phase. Each surviving product behavior
> must re-enter red-green through the new public seam and pass 0009's fresh
> browser/artifact gates.

Phases 1a/2/3 are committed and green. The gap analysis surfaced five places
where the _current_ build contradicts a settled decision (not merely missing) —
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

## Historical execution — legacy red-green TDD (superseded by 0009)

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

### Phase 4 — subsume the anchor into the comment _(decision 3, Q6)_ — **DONE**

- **Red:** a rendered `{==x==}{>>c<<}` does not carry the comment's current-
  revision id on the anchor and is styled like a plain highlight; the review
  snapshot lists the anchor highlight as its own item alongside the comment
  (double-listing); removing the comment card does not remove the anchor.
- **Green:** freshly derive nonempty anchor↔comment adjacency from the current
  revision; the review snapshot presents the pair as **one** comment item
  (anchor subsumed,
  not a separate highlight item); the anchor renders with a distinct
  commented marker; explicit **Remove comment** unwraps the Highlight while
  retaining its payload text and deletes the Comment.

### Phase 5 — editing a comment _(decision 4, Q4; decision 7, Q8)_ — **DONE (core)**

- **Red/green (done):** `editCriticMarkupComment(target, text)` on the muya
  review contract + facade rewrites the `{>>…<<}` body through the mutation
  gateway (anchor preserved; the revision-local target is revalidated and
  rebound; refuses a non-comment target or empty text).
  The sidebar comment card gained an Edit action opening an inline box; Save
  routes through the controller to the command. Red-green on the muya command
  and the controller edit-routing.
- **Red/green (done):** the native editor context-menu **Edit Comment** item now
  uses an event-scoped, correlated query to the exact originating frame. Muya
  returns parser-owned DOM identity at the gesture point; main rejects stale,
  malformed, superseded, non-editor, and non-comment responses; the renderer
  revalidates the opaque target against its current Review snapshot before a
  persistent store request opens the sidebar editor. No process reparses
  CriticMarkup or searches displayed text.

### Phase 6 — passive selection _(decision 7, Q8)_ — **DONE**

- **Red:** the in-document comment affordance force-opens/scrolls the sidebar on
  click (today's `focusCriticMarkup` behaviour), violating "nothing else
  happens".
- **Green:** caret/selection inside a commented span marks that card selected in
  the sidebar (active-comment state) and nothing more — no open, no scroll-jack.
  Opening the sidebar stays a user action.

### Phase 7 — caret never enters the hidden comment _(decision 5, Q5 · ADR-0002)_ — **DONE**

- **Red:** browser and model carets could enter hidden inline/structural comment
  content through programmatic restore, native arrows, `selectionchange`, or
  input/IME paths; document-edge, consecutive, nested, RTL, and projection
  transitions exposed different failures.
- **Green:** one selection-layer resolver consumes parser-owned inline and
  structural identities and source-map boundaries. Programmatic placement,
  native selection reconciliation, semantic arrow traversal, `beforeinput`
  target ranges, and IME ownership all route through it. It skips nested and
  consecutive comments transitively, never hides a visible block that carries
  only a comment boundary, seats native endpoints outside hidden DOM, and
  collapses selection in a comment-only document with no legal visible owner.
  The behavior is covered by 145 focused/neighbor tests plus the nested-owner
  adversarial regression.

### Phase 8 — anchor-deletion survival + closure gate _(decision 6, Q7)_ — **HISTORICAL; SUPERSEDED BY 0009**

- [x] **Red:** deleting all of a comment's anchored text drops the comment.
- [x] **Green:** the parser-owned before-document, capture edits, source map,
      and document-level anchor index preserve `{>>…<<}` as a listed, removable
      standalone Comment for the proven direct path and keep it independently
      listed after the tracked path, without an empty-Highlight sentinel; plan
      0009 replaces the legacy tracked spelling with a Deletion around the
      complete Highlight so Accept leaves the bare Comment, Reject restores the
      pair, and one undo restores the exact original source.
- [ ] **Hardening:** finish and verify the boundary matrix for the mandated
      rejection of hidden Comment descendants, direct editing inside pending
      revised carriers, adjacency to a surviving plain Highlight, sequential
      partial-to-final anchor deletion under both Track states, and nested
      passive/context-menu targeting. Each resulting revision must derive fresh
      context solely from the source it now expresses, without data loss or
      remembered creation intent.
- [ ] **Automated gate:** muya unit (serial), CommonMark/GFM conformance, muya
      lint/lint:types/check-circular, desktop unit (serial), root lint, vue-tsc,
      browser E2E, fresh `build:unpack`, packaged smoke, supported-platform CI, and
      `build:mac:arm64` all pass from the final tree under the background policy.

## Acceptance criteria

1. Select text → Add Comment produces a **highlighted, distinguishable** anchor
   and **one** sidebar card — no inline comment text, no modal, no separate
   Highlight card for the anchor.
2. The `.md` on disk contains exactly `{==sel==}{>>note<<}` — canonical
   CriticMarkup, nothing else.
3. Caret in a commented span selects its card when no deeper visible Review item
   owns the hit; nested anchors select the innermost Comment and explicit parent
   focus survives passive hits. Nothing opens or scrolls. Editing is explicit
   (click the card, or right-click → Edit Comment) and rewrites the body in
   place. A nested context menu preserves deepest-item actions and edits the
   nearest containing Comment. Explicit **Remove comment** unwraps the Highlight,
   retains its exact payload source including nested CM except for minimum
   delimiter protection or a provenance-bearing `BofTextCodecV1` offset-zero
   repair, and deletes the Comment.
4. The caret cannot be placed inside a hidden comment by any means.
5. For a root-effective anchor without a hidden Comment descendant, deleting
   all anchored text without tracking leaves a removable bare Comment. With
   tracking, it wraps the complete Highlight in a Deletion, shows the Comment
   unanchored, then Accept leaves the bare Comment and Reject restores the exact
   pair. Pending revised carriers edit directly; the hidden-Comment check runs
   before every carrier and rejects whole/final-contribution deletion unchanged.
   Sequential last-contribution edits follow the exact tracking-off/on outcomes
   in plan 0009. No path writes an empty-Highlight barrier or sentinel.
6. Source-code mode shows the raw CriticMarkup. The core preserves every decoded
   UTF-16 code unit exactly; file-encoding and byte-exact open/save behavior are
   separately proven at the desktop persistence adapter. Normalization occurs
   only through an explicit transform.
7. The full automated gate is green and the packaged artifact is rebuilt.
8. From a normal editor state with the entire sidebar hidden, a user can reach
   the Review sidebar using only mouse-operated product controls.

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
- **2026-07-17** — Phases 4–6 landed red-green; this was an intermediate
  checkpoint subsequently extended by the 2026-07-19 work below:
  - **Phase 4** (anchor subsumption): review snapshot folds the anchor into one
    comment item (+anchorId/anchorText) with a caret→comment current-item remap;
    the legacy command accepted either internal half for symmetric removal;
    plan 0009 replaces that implementation detail with the normative explicit
    **Remove comment** transaction that unwraps the Highlight and deletes the
    Comment. Add Comment requires a selection; desktop card previews the
    anchored text. Cross-consumer parity corpus updated for the fold
    (document/live/HTML/clipboard unchanged).
  - **Phase 5** (edit baseline): `editCriticMarkupComment` gateway command +
    contract/facade; sidebar card Edit action → inline box → controller routing.
    Native right-click Edit Comment was still open at this checkpoint and is
    closed by the 2026-07-19 entry below.
  - **Phase 6** (passive selection): the in-document indicator is presentational
    (no force-scroll); the caret drives card selection via the Phase 4 remap.
  - **Phase 7** (hard caret-skip) and **Phase 8** (anchor-deletion survival)
    were still open at this checkpoint; both received real interaction tests
    and implementation afterward.
  - **Checkpoint gate (all green at that revision):** muya unit 3,316/3,316,
    CommonMark/GFM conformance
    1,347/1,347, desktop unit 894/894, root lint 0 errors, vue-tsc clean, muya
    lint:types + check-circular clean.
- **2026-07-17 — real-app E2E, and the bugs it caught.** The unit gate above
  missed everything that only breaks in the running editor. A Playwright
  Electron spec (`test/e2e/critic-markup-comment-authoring.spec.ts`) driving the
  actual sidebar flow found: a comment wrapped the **whole paragraph** (or
  nothing, in a header) because opening the Review menu blurs the editor and
  `getSelection()` goes null before the authoring command runs, and a same-block
  selection never reaches muya's `setSelection` so the model was stale. Fix:
  `Muya.commitAuthoringSelection()` snapshots the live DOM **range** into the
  model (ranges only, so typing is undisturbed), called on a debounced DOM
  `selectionchange` in the Review controller — the range is committed while the
  editor still holds it and survives the blur. The compose box also returns
  focus to the editor on submit/cancel. E2E now covers: wraps-the-selection,
  Cmd+Enter submit, header commenting, and demoting a commented header without
  crashing; the existing Review E2E's comment authoring moved off the retired
  modal. **Standing rule: comment-flow changes must be proven by this E2E, not
  unit tests alone.** Desktop unit 895/895; authoring E2E 4/4.
- **2026-07-17 — the ACTUAL root cause (workflow root-cause audit + real Chromium
  E2E).** The "commit on debounced selectionchange" above was only a timing
  band-aid; a real fast mouse drag beats it, and Playwright's scripted mouse
  silently fails to select — so that earlier E2E was weak. True root cause: a
  **same-block selection is never written into muya's persistent selection model
  by muya's own DOM handlers** — `handleMousemoveOrClick` early-returned for
  `isSelectionInSameBlock` so `mouseup` committed nothing (`TextSelection.ts`),
  and `keyupHandler` was a no-op (`content.ts`). Opening the Review menu blurs
  the editor → `getSelection()` null → the authoring command resolved a stale
  pre-drag caret → the comment wrapped the whole paragraph / one char.
  **Fix at the source:** a real range (same- or cross-block) now stashes on
  `mousemove` and commits on `mouseup`; `keyupHandler` commits a real keyboard
  shift-selection (guarded on `isComposed`); collapsed carets untouched.
  `commitAuthoringSelection` stays as belt-and-suspenders for host/programmatic
  ranges. **Deterministic reproduction:** create a DOM Range, then dispatch
  muya's own `mousedown`/`mousemove`/`mouseup` over it. New muya-engine E2E
  (`critic-selection-commit.spec.ts`) proves the model commits forward+backward
  (red→green); new desktop E2E authors via the mouseup-commit drag and asserts
  the wrap; a heading-render E2E proves headings render critic fragments (the
  "raw in a header" report was an older build); header-demotion E2E strengthened
  to assert the block demotes. Audit: Cmd+Enter already fixed; edit-box
  autofocus made v-for-ref-array-resilient.
  Gate: muya 3316/3316, conformance 1347/1347, madge clean, desktop 895/895,
  authoring E2E 5/5, muya e2e drag/editing 59 + new specs green.
- **2026-07-19 — cross-PARAGRAPH comment authoring (real-gesture E2E + the true
  focus root cause).** The 2026-07-17 fix landed same-paragraph authoring but a
  selection spanning a paragraph break still mis-commented one character. The
  engine was never the limit: an authored `{==a\n\nb==}{>>c<<}` renders (mark in
  both paragraphs) and round-trips byte-exact, and `create()`'s document path is
  unit-tested. The defect was that muya's LIVE editor could not hold a
  cross-block DOM selection through the add-comment flow. **True root cause:**
  `Editor.focus()` restored the caret with `anchorBlock.setCursor(anchor.offset,
focus.offset)`, forcing BOTH offsets into the anchor block; when focus returned
  to the editor after the compose box / menu took it, a cross-paragraph selection
  collapsed to a one-char span in the first paragraph (`Editor.focus ← Muya.focus`
  proven by a setSelection caller-stack trace). **Fix:** when the stored
  selection spans two in-tree blocks, `Editor.focus()` restores the whole range
  via `selection.setSelection(anchor, focus)` instead of a same-block
  `setCursor`. Supporting changes: `Selection.commitSelectionToModel` (a
  model-only capture that never rewrites the DOM — wired into
  `commitAuthoringSelection`, `keyupHandler`, and the mouseup commit) fixed a
  `TypeError` regression (the method existed on the inner `TextSelection` but not
  the `Selection` facade, aborting the review refresh on every non-collapsed
  selection); `_updateSelection` now restores via `setBaseAndExtent`.
  **Testing lesson (user-driven):** the earlier synthetic-Range / dispatched-
  event E2E hid this — a pre-built Range has no native selection base. The
  authoring spec is now a REAL-gesture matrix (real `page.keyboard` shift-select,
  real `page.mouse` drags over computed pixel rects) × {same-paragraph,
  cross-paragraph}: 9 pass incl. real-keyboard cross-paragraph. The real-MOUSE
  cross-paragraph case is `test.fixme` — a Playwright/Electron harness limit
  (scripted drags do not select across a block boundary). The legacy ledger
  treated same-paragraph mouse plus cross-paragraph keyboard as transitive
  coverage; plan 0009 explicitly rejects that as completion evidence and keeps a
  real cross-paragraph pointer row open. Gate: muya 3309/3316 (+7 timeout-flakes green in isolation),
  conformance 1347/1347, madge clean, muya e2e Chromium 247/247, desktop
  typecheck + authoring matrix green.
- **2026-07-19 — passive comment UX and hidden-caret closure.** Native
  right-click **Edit Comment** now follows an event-scoped request/response
  protocol bound to the originating frame and gesture epoch, with runtime
  payload validation and renderer revision revalidation before the persistent
  sidebar edit request opens. Comment selection remains passive. The hidden
  caret invariant now covers inline and structural comments through parser
  bindings and the source map: programmatic restore, browser
  `selectionchange`, exact marker boundaries, arrows in LTR/RTL, consecutive
  and nested comments, cross-block document edges, `beforeinput` target ranges,
  IME, and projection rebind. Focused evidence before the final aggregate gate:
  caret/structural slice 145/145 plus nested-owner cursor suite 46/46; context
  menu/hit-test slices green; Muya and desktop typechecks green. The final
  sequential/package gate remains Phase 8 work.
- **2026-07-19 — real anchor-deletion survival.** The earlier point-comment
  assertion did not exercise deletion of an anchored span. New tests perform a
  real DOM Range deletion through the bubbling input path and a real
  cross-paragraph cut through the public clipboard handler. The mutation
  gateway now uses the parser-owned before-document, captured source edits,
  source mapping, and the shared comment-anchor index to remove only an emptied
  anchor's marker bytes inside the same capture/history boundary. The comment
  survives as a removable point comment; undo restores the exact pair and redo
  re-applies the deletion. Focused evidence: 5/5. The final sequential/package
  gate remains open.
- **2026-07-19 — production-hardening continuation (historical checkpoint).** Focused
  red-green work has added a document-owned gapless comment-anchor index,
  attempted to preserve nested point-comment source during direct and tracked
  whole-anchor deletion. Plan 0009 supersedes that rewrite with visible
  rejection because pure CM cannot both Accept deletion and restore/lift a
  hidden descendant losslessly. This checkpoint also prevented a stale sidebar draft from applying to a
  different file that reuses the same source-derived ID, and separated
  speculative capture documents from durable parser artifacts. The remaining
  adjacency/partial-deletion matrix, binding-rebase matrix, real-browser
  comment lifecycle proof, aggregate gates, build, and platform verification
  were the remaining legacy work at that checkpoint. Plan 0009's larger
  source-authoritative rebuild and deletion gates now define the complete
  remaining closure work; post-closure dogfooding is outside this plan.
