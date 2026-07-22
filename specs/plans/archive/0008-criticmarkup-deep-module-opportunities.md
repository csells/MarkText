# 0008 — CriticMarkup Deep-Module Opportunities

**Status:** Archived on 2026-07-19; superseded by
[`0009-criticmarkup-document-engine-rebuild.md`](../0009-criticmarkup-document-engine-rebuild.md);
migration evidence only
**Created:** 2026-07-19
**Branch:** `feat/native-criticmarkup`
**Source:** `/improve-codebase-architecture` review — five parallel Explore
passes over the commit hot spots (selection, editor/focus, state round-trip,
desktop Review pipeline, muya facade + inline render), reconciled against the
current tree on 2026-07-19.
**Vocabulary:** domain terms from `CONTEXT.md`; architecture terms
(module · interface · depth · seam · adapter · leverage · locality · deletion
test) from the codebase-design glossary.

## Framing

> This document evaluated how to deepen the legacy implementation in place.
> Plan 0009 instead replaces its authority direction and deletes the selection,
> state-round-trip, Review, binding, and renderer paths named below. Do not
> schedule C1–C5 against those modules. Preserve this inventory only as a
> migration oracle for duplicated responsibilities and deletion tests; any
> concept worth retaining must be re-expressed behind plan 0009's
> `DocumentRevision`/`DocumentSession` interfaces and proved in its ordered
> red-green phases.

The CriticMarkup subsystem is largely well-shaped: `CriticMarkupDocument`,
`MuyaCriticMarkup`, and the `reviewContract` seam are genuinely deep, and the
command surface has been decomposed into focused modules (`authoringDraft`,
`commandSnapshot`, `commentEditing`, `domIdentity`, `pointComments`, …). The
remaining friction is not "big files"; it is where a **single concept has no
owning module** and gets re-derived at many call sites. That is exactly where
the one-character cross-paragraph comment bug lived (commit `9746d4c6`):
`Editor.focus` healed a cross-block selection collapse that four sibling
reconcilers did not.

Each opportunity below turns a **shallow** cluster into a **deep** module. None
re-litigates ADR-0001…0004; where an item touches an ADR it _serves_ it (one
place to enforce the invariant).

## Deepening opportunities

Ordered by recommendation strength. C4 is recorded as already addressed by the
recent `domIdentity.ts` extraction and kept only for provenance.

### C1 — Give the Selection module a home for "capture the live range" · **Strong** · OPEN

- **Modules:** `selection/TextSelection.ts`, `selection/index.ts`,
  `block/base/content.ts` (`keyupHandler`), `muya.ts`
  (`commitAuthoringSelection`).
- **Problem.** The zero-argument operation callers actually want — "persist
  whatever range is live right now so it survives a blur" — has no module.
  `commitSelectionToModel(anchor, focus)` is a shallow primitive: its interface
  (two `IAnchorFocusInfo`) is nearly as complex as its body (six field
  assignments + `_emitSelectionChange`), so every caller runs the same
  preamble (`getSelection` → null-check → `!isCollapsed` → extract endpoints →
  commit). That preamble is duplicated in `keyupHandler` and
  `commitAuthoringSelection`, and a third stash/commit variant lives in the
  mouse handlers. The "what counts as a committable range" rule is authored in
  three places.
- **Deletion test.** The capture wrapper is _already_ duplicated → complexity
  is spread, not concentrated. A hypothetical `captureLiveRange()` deleted today
  would reappear copy-pasted in two callers → it concentrates complexity → a
  real deepening target.
- **Deepen.** Add a deep zero-arg `TextSelection.captureLiveRange(): boolean`
  that reads `getSelection()`, returns false on null-or-collapsed, else commits
  via the existing `commitSelectionToModel` (which the mouse stash path keeps).
  `keyupHandler` and `commitAuthoringSelection` collapse to
  `this.selection.captureLiveRange()`.
- **Seam.** `captureLiveRange` on `TextSelection`, mirrored one line on the
  `Selection` facade. Callers cross a zero-argument seam.
- **Wins.** locality: one committable-range rule · leverage: callers drop the
  DOM dance · the capture rule becomes the test surface (no spec targets it
  today).

### C2 — Own "the effective selection" once instead of re-deriving it in 5+ consumers · **Strong** · OPEN

- **Modules:** `criticMarkup/commands.ts` (`_selectionSnapshot`), `muya.ts`
  (`_snapshotSelection`, `_selectionEndpoints`), `selection/index.ts`
  (`selectAll`), `editor/index.ts` (`focus`), `selection/TextSelection.ts`.
- **Problem.** The browser collapses a cross-block selection, so the committed
  fields (`anchor`/`focus`/`anchorBlock`/`focusBlock`) are the only true record
  after a blur. Every consumer reconciles live-vs-committed by hand, each with a
  divergent heuristic. `_selectionSnapshot` rebuilds an `ISelection` from the
  cached fields and re-derives `direction`/`caretType` inline — using `<=`
  where the canonical `computeDirection` uses `<`, and leaving cross-block
  direction `NONE`. The divergence between the copy that heals the cross-block
  collapse and the copies that do not is where the real bug lived.
- **Deletion test.** The reconciliation already reappears across five sites with
  subtle divergence → it earns a single owner; it is merely mis-located in
  `criticMarkup` instead of the selection module that owns the data.
- **Deepen.** `TextSelection.getStoredSelection(): ISelection | null`
  (reconstruct from the cached endpoints via the _same_ `computeDirection` /
  `computeCaretType`) and `resolveSelection()` (prefer live, fall back to
  committed on a collapsed cross-block range). `_selectionSnapshot`,
  `_snapshotSelection`, `_selectionEndpoints`, `selectAll` become thin adapters.
- **Seam.** `getStoredSelection` / `resolveSelection` on `TextSelection`,
  mirrored on the `Selection` facade; consumers get a fully-formed `ISelection`.
- **Wins.** locality: the cross-block heal lives once → the one-character-comment
  bug class becomes structurally impossible · leverage: a complete `ISelection`
  per call · the reconciliation becomes unit-testable through one interface.
- **ADR.** Adjacent to ADR-0002 (caret never enters a hidden comment) — does
  not reopen it; gives the cursor-restore invariant one enforcement point.

### C3 — Promote the plan layer to the single trivia authority for boundary newlines · **Strong** · OPEN

- **Modules:** `state/markdownTokenToState.ts`,
  `utils/marked/extensions/criticMarkupBoundaryPlans.ts`,
  `state/criticMarkupSerialization.ts`, `state/markdownToState.ts`
  (`_captureBlockSpacing`), `state/stateToMarkdown.ts`.
- **Problem.** One boundary rule — "who owns the newline between a marker and
  its covered content" — has no owning module. Boundary _attachments_ already
  carry a precomputed `trivia`/`followingTrivia`, but the `CriticMarkupFragment`
  token does not, so the fragment path re-derives it from raw source in three
  hand-rolled newline loops (token→state regex, serializer-weave peel,
  `_captureBlockSpacing` deduction). A mistake in any one silently double-emits
  or drops a byte — the failure the property-fuzz burn-down keeps chasing.
- **Deletion test.** Load-bearing (removing it loses data), but it fails the
  _locality_ half: the complexity reappears at each of three seams. Attachments
  prove it is concentratable — they already carry the answer as data.
- **Deepen.** Emit `trivia`/`followingTrivia` on the `CriticMarkupFragment`
  token (parity with boundary attachments, computed from the same source).
  Token→state reads recorded bytes; the weave and `_captureBlockSpacing` become
  mechanical splices.
- **Seam.** The `Tokens.CriticMarkupFragment` contract, alongside the existing
  attachment trivia — one uniform interface for "who owns this byte".
- **Wins.** locality: one "who owns this byte" · leverage: consumers stop
  re-deriving · the trivia decision is assertable at the plan boundary instead
  of only through full markdown→state→markdown fuzz.

### C4 — DOM→critic-item identity behind a seam · **Strong** · **ADDRESSED (domIdentity.ts)**

- **Modules:** `criticMarkup/domIdentity.ts` (now), `ui/criticMarkupReviewTool`,
  `criticMarkup/commands.ts`, `block/base/treeNode.ts`.
- **Was.** "Given a clicked DOM node, which `Comment`/`Anchor` item did the user
  mean" lived inside the review float tool (`_deepestTargetItemId`), with the
  id-encoding written in `treeNode`, read in `commands` (`~=`), and decoded in
  the tool — nothing binding them, and untested.
- **Now.** `domIdentity.ts` owns `criticMarkupItemsFromDomTarget` /
  `deepestCriticMarkupItemId` (attribute decode, `itemById` lookup, depth
  arbitration) as a module. The resolution is no longer stranded in a
  float-positioning tool.
- **Remaining (optional).** Confirm the `treeNode` _writer_ and the `commands`
  `~=` reader share one encoding constant with `domIdentity` so the write/read
  contract cannot drift; consider surfacing the reader on
  `CriticMarkupDocumentService` next to `itemById`.

### C5 — Collapse the snapshot→view projection into one module · **Worth exploring** · OPEN

- **Modules:** `editorWithTabs/useCriticMarkupReviewController.ts`,
  `editorWithTabs/criticMarkupReview.ts`, `store/criticMarkupReview.ts`,
  `shared/types/criticMarkup.ts`.
- **Problem.** One published snapshot becomes two view faces (sidebar, menu) in
  two conditions (available / unavailable) = four shallow single-caller
  field-copies split across three files (`buildCriticMarkupSidebarState`,
  `menuStateFromSnapshot`, `unavailableMenuState`, `emptySnapshot`). The
  `available:true/false` literal appears four times; `CriticMarkupReviewMenuState`
  re-Picks the nine capability names that already _are_ `ICriticMarkupCommandState`.
- **Deletion test.** Individually shallow single-caller copies, but deleting the
  _concept_ re-scatters the mapping inline at every publish/clear site → it
  earns one module; it is mis-split into four half-modules.
- **Deepen.** One projection seam in `criticMarkupReview.ts`:
  `reviewSidebarState(fileId, snapshot|null)` and `reviewMenuState(snapshot|null)`,
  each total over `snapshot | null`. Redefine
  `CriticMarkupReviewMenuState = ICriticMarkupCommandState & { available }`. The
  controller becomes routing; the store seeds from `reviewSidebarState(null, null)`.
- **Wins.** locality: the sidebar/menu × available/unavailable matrix in one
  file · leverage: add a capability in one edit · the projection gets a
  table-test surface (the menu face is effectively unasserted today).
- **Companion (from the same slice, Worth exploring).** The "is Review
  actionable in this context" guard (live editor + `fileId` + not source-mode)
  is copy-pasted with drift across ~6 controller handlers; extract one
  `activeReviewContext()` accessor so the "Review is a no-op" precondition has a
  single home and the captured-vs-live `fileId` drift disappears.

### C6 — Stop hand-mirroring TextSelection's text surface on the facade · **Worth exploring** · OPEN

- **Modules:** `selection/index.ts` (`Selection`), `selection/TextSelection.ts`.
- **Problem.** The facade re-exposes the text-selection surface as ten one-line
  delegates (`return this._text.X`). For the text members the interface is
  exactly as complex as the implementation (a shallow adapter); the mirror is
  kept in lockstep by hand and _broke once_ — the cross-paragraph fix included a
  facade delegation gap that threw a `TypeError` on every non-collapsed
  selection. (The facade's image/table multiplexing is genuine depth — keep it.)
- **Deletion test.** Deleting the whole facade fails (multiplexing reappears),
  but deleting the ten text pass-throughs makes their complexity vanish → that
  subset is an unearned mirror.
- **Deepen.** Expose the text selection as one typed reader
  (`selection.text: ITextSelectionReader`) — or, folded into C2, route all
  committed-state reads through the single reconciled reader so consumers stop
  touching raw cached getters. Either removes the class of gap the `TypeError`
  came from.
- **Wins.** locality: one text-selection authority (adding a method can no
  longer miss the facade) · leverage: consumers depend on one reader, not a fan
  of drift-prone getters · deletes the `TypeError` class (no test guards those
  pass-throughs today).

### C6b — One `criticFragmentShape` descriptor for both inline renderers · **Worth exploring** · OPEN

- **Modules:** `inlineRenderer/renderer/criticDocumentFragment.ts` (snabbdom
  vdom), `utils/marked/extensions/criticMarkupDocument.ts` (HTML-string export).
- **Problem.** Two renderers encode the same fragment semantics with no shared
  authority: the type→element map (`addition`=ins, `deletion`=del,
  substitution old=del/new=ins, `highlight`=mark), the `data-critic-*`
  attribute set, and the comment title-preview rule are each duplicated, and
  already quietly diverge (`mu-critic-*` vs `critic-*`, hidden-comment vs
  inline-`role=note`).
- **Deletion test.** Both renderers earn their keep (interactive vdom vs flat
  export), but the _shared mapping_ is duplicated → a shared descriptor deleted
  would force the duplication straight back.
- **Deepen.** Extract a pure `criticFragmentShape(token) → { element,
armElement, typeToken, dataAttributes, commentTitle }` consumed by both;
  each renderer keeps only its output-specific policy (vdom: MU_HIDE comment
  collapse + indicator; string: HTML escaping + `role=note`).
- **Wins.** leverage: a new critic type / attribute is one edit both inherit ·
  locality: live editing and static export cannot silently disagree · the
  mapping becomes a pure unit test independent of snabbdom/marked.

## Top recommendation

**C1 + C2 together** — the same seam viewed from both sides. The Selection
module owns the live DOM range and the committed endpoints but exposes no deep
operation to _capture_ the live range or to _read the reconciled effective
selection_, so both are smeared across 5+ call sites with divergent copies —
the exact spot the cross-paragraph comment bug lived. Highest-churn area, the
complexity genuinely concentrates rather than moving, and the reconciliation
becomes unit-testable through one interface. **C6 folds in as the follow-through**
(once reads route through one reconciled reader, the facade's hand-mirrored text
surface disappears). Then **C3** (boundary-trivia authority — retires a whole
class of property-fuzz failures) and the optional **C4** finish (shared
id-encoding constant) as independent follow-ups.

## Non-goals

- No file-size/decomposition churn for its own sake — the command surface is
  already decomposed.
- No change to the CriticMarkup data model or the five forms (ADR-0001).
- No re-opening of the hidden-comment caret invariant (ADR-0002), the
  commented-span-as-one-unit identity (ADR-0003), or the explicit/non-intrusive
  interaction (ADR-0004); C2 and C4 _serve_ those invariants with a single home.
