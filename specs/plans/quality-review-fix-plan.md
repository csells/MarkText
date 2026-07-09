# Plan: Thermo-Nuclear Quality Review — Fix Loop Handoff

Source: strict architecture/maintainability review of the whole
`markupdown-inline-comments` branch vs merge base `25caabad` (284 files,
+31,927/−1,523), run 2026-07-08. Verdict: **BLOCK** (approval bar: parallel
recognition paths, files past 1,000 lines, decisions leaked out of the
canonical layer). Review only — no code was changed; this plan is the
executable handoff.

Every finding below was validated against the code before inclusion. Where a
failure scenario is inferred from reading rather than reproduced, the finding
says so — reproduce it red before fixing (house rules: red-green TDD,
validate findings before acting).

## Status

- **Fixed (12 of 15 findings + all nits), verified in the real artifact:**
  - **F1 + F10** — one comment-semantics owner: parseMarkdownComments =
    commentModelView∘extractCommentModel; analyze.ts copies + null mode
    deleted (08a139bb).
  - **F2 + F3** — one literal-context grammar: batch-driven CodeMirror
    overlay, tokenizer inline-code over paragraph text; streaming
    classifier + per-line backtick scanner deleted; overlay eol-guarded
    against stale decorations (f82fe345).
  - **F11 + muya nits** — dead state-twin deleted; one _serializeCached
    memoizer; mayContainCommentSyntax owner; history infer→ICommentThread;
    materializedMarkdown rename; JSDoc move (muya ratchet 9→6).
  - **F14 + F15 + nits** — typed mt::update-file (4 casts gone); dead
    MergeConflictState fields; addComment→comment:add; one
    addCommentState getter (6d35ea7c).
  - **F8 + F9** — ICommentSurface honestly typed + narrowed once at the bus
    edge; router IS the mode (16 dead guards deleted); editor-focus via the
    surface; explicit isSourceHandoff flag replaces the field-shape sniff
    (6ed76ae1).
  - **F7** — sidebar's six parallel reactive records → one
    Record<threadId, IThreadUi>; composite-key parsing and the six-armed GC
    sweep gone (8f964dc0).
  - **F5** — one prevModelBeforeLastApply snapshot (three lockstep fields
    gone); the ordinary-edit history entry carries one modelBefore; shared
    model (de)serialize helper (f9e397cd).
  Full certification green at each step: muya 1744 unit + 1347 conformance
  + 242 e2e, desktop 913 unit + full e2e, skills 36, both typechecks,
  ratchets (root 182 / muya 6), stylelint, madge, build:unpack.

- **ROI-deferred (waivable per the review's own 1000-line clause):**
  - **F6** — split the transform block out of comments/model.ts (1188
    lines): isTextPosition/comparePositions straddle the
    extract/materialize/transform boundary, so a clean split needs a third
    shared module or risks a cycle, and the file is clearly
    section-organized.
  - **F12** — extract the WYSIWYG comment surface from editor.vue: the file
    was 2102 lines at the merge base, so the ~120-line extraction does not
    get it under the bar; it trades inline handlers for a wide-signature
    (8-dependency) composable without a net simplification.

- **Open — the merge-subsystem cluster (needs a product decision, then a
  cohesive careful pass):**
  - **F4** — move all watcher routing into the reducer decision table. Four
    sub-parts; three are mechanical, but one is a genuine UX decision: a
    save while a resolver is open currently closes it immediately
    (editor.ts:689), whereas the reducer's saved-while-reviewing rule keeps
    it open (baseSuperseded, close on next accept — pinned by
    merge-session-reducer.spec:430). Both are defensible; the direction
    must be chosen, not guessed, before unifying. Deferred to avoid
    guessing on data-integrity-critical code under the fix loop.
  - **F13** — loadChange { diskBase } option to collapse the three
    forge-payload-then-repair dances. Mechanical, but it modifies the merge
    base-setting path (the value the whole staleness logic keys on); best
    done as part of the F4 cohesive pass rather than piecemeal.

## The headline question (context for the fixes)

Is comment parsing fully pushed into the markdown parser? **Half yes.**
Recognition IS parser-owned: `[MC:id]:` lines are a first-class marked block
token (`utils/marked/extensions/commentMetadata.ts`, ahead of the generic
`def` rule, run-consuming), inline markers are tokenizer tokens
(`inlineRenderer/rules.ts:48`, consumed via `markerScan.ts`), grammar strings
have a single owner (`comments/syntax.ts`), and no hand-built MC byte strings
exist outside it anywhere in the repo.

What is NOT single-owned is everything above token recognition: the semantic
layer (pairing/head-reply resolution/diagnostics) exists twice (findings 1),
the literal-context grammar exists three times (findings 2–3), and the
parser's token identity is discarded at `markdownToState.ts:394-405`
(definition token lowered to a plain paragraph, mirroring `def`), which is
what allows extraction to re-recognize lines with a regex
(`model.ts:157`). Fixes 1–3 close that gap.

## Structural findings (fix in this order)

1. **[MAJOR] Two full implementations of comment semantics** —
   `parse.ts:108-355` (byte-level walk: pairing with duplicate-open ignore
   counters, first-decodable-head-wins, reply attachment, diagnostics) is
   re-implemented at `model.ts:232-273` (extraction) and `model.ts:570-644`
   (`commentModelView`), with diagnostic strings duplicated verbatim. Drift
   already shipped: model path loses decode-error detail on
   `invalid-metadata` (`model.ts:567` generic vs `parse.ts:194`
   `error.message`); duplicate-open handling differs (parse consumes the
   dup's matching close, the view diagnoses each independently).
   `malformed-marker` living only on the parse path is sanctioned by
   comment-anchors.md invariant 1 — but nothing pins the sanctioned split;
   `parserConsistency.spec.ts` never compares parse vs view.
   **Fix (judo a):** `parseMarkdownComments(input)` becomes
   `commentModelView(extractCommentModel(markdownToStates(input)))`. Record
   malformed markers as model data during extraction (markerScan already
   classifies them via `parseMalformedCommentMarker`); keep decode-error
   messages on residue records. Deletes parse.ts's ~250-line walk, the
   duplicated diagnostic set, the pairing fork, and finding 5's
   coordinate-space split.

2. **[MAJOR] `prepareCommentSourceLine` is a maintained second block
   grammar** — `source.ts:434-564` re-implements
   fences/front-matter/math/html/indented-code classification for the
   CodeMirror overlay while `source.ts:138-147` says the batch index moved to
   `lexBlock` because "marked's block tokenization is the single authority".
   No container stripping: a blockquote-nested definition (live per
   `parserConsistency.spec.ts:85-98`) fails `parseCommentMetadataDefinition`
   in `desktop .../codeMirror/markdownCommentMode.ts:44` and decorates as
   plain text (code-read, not reproduced — reproduce first).
   `sourceIgnoredRanges.spec.ts` exists solely to hold two grammars equal.
   **Fix (judo c):** drive the overlay from the batch line views — compute
   `buildCommentSourceLineViews` inside the already-memoized
   `analyzeSourceComments` (`sourceCode.vue:340-362`) and have the overlay
   look up `ignored`/`stripped`/`delta` by line number. Deletes
   `prepareCommentSourceLine`, `createCommentSourceLineState`,
   `getHtmlBlockClosing` (~180 lines) and the streaming half of the
   equivalence spec. Carry over the deliberate forgiving
   unclosed-front-matter behavior explicitly.

3. **[MAJOR] Two inline-code grammars decide which markers are live** —
   `source.ts:387-428` `sourceInlineCodeRanges` is a hand-rolled single-line
   backtick matcher; `markerScan.ts:34-47` `inlineCodeRangesInText` is the
   tokenizer-backed canonical version (verified verbatim duplicate concern).
   Granularity mismatch (index scans per stripped line; parser tokenizes
   whole leaves; `inline_code` spans newlines) means the two authorities can
   disagree on which ids exist for a soft-wrapped `` `a<!--MC:x-->\nb` ``
   (inferred, not reproduced; no multi-line inline-code case exists in
   `parserConsistency.spec.ts`).
   **Fix (also judo c):** delete `sourceInlineCodeRanges` /
   `sourceLinePositionInsideInlineCode`; scan inline context once per
   paragraph token's stripped text with `inlineCodeRangesInText` and map
   offsets through the existing per-line deltas. Add the multi-line
   inline-code case to parserConsistency.spec (red first).

4. **[MAJOR] Merge decisions leak out of the reducer — four leaks** —
   (a) `store/editor.ts:689-691`: `mt::tab-saved` closes the resolver
   directly while the reducer's `saved` row (`mergeSession.ts:550-556`)
   deliberately keeps the session reviewing with `baseSuperseded` — two
   authorities disagree about what a save does; (b) the watcher ladder in
   `LISTEN_FOR_FILE_CHANGE` (`editor.ts:~1820-1875`) re-implements row
   selection outside the decision table; (c)
   `dirtyExternalMergeActions.ts:456` re-decides markClean against the
   post-apply buffer under a doc-comment saying "nothing is re-derived
   here" — right behavior, wrong layer; (d) the auto-merge Undo notification
   closure (`dirtyExternalMergeActions.ts:479-537`) is a second state
   machine capturing document snapshots with hand-rolled liveness.
   **Fix (judo b):** the watcher dispatches ONE `disk-changed` event; add
   decision-table rows for byte-identical absorb and clean-tab reload
   (carry `isSaved`/persistence on the event); make `tab-saved` a reducer
   event; make post-apply buffer drift a reality event the reducer judges
   (deleting the interpreter markClean override); add an `undo-merge` event
   so the notification closure shrinks to read-reality-and-dispatch.
   Collapses three definitions of "still live" to one and erases most of
   editor.ts's +222-line growth.

5. **[MAJOR] History entries encode three kinds as six optional fields** —
   `history/index.ts:18-46` (`rebuild?`, `commentModel?`,
   `commentModelOnly?`, `anchors?`, `definitionRuns?`, `threads?`) with
   invariants enforced by runtime throws and untrusted `if (lastAnchors)`
   guards; compounded by `state/index.ts:136-152`
   `prev{Anchors,Runs,Threads}BeforeLastApply` — one ICommentModel snapshot
   shattered into three lockstep fields/getters.
   **Fix (judo e):** discriminated union
   `{ kind: 'edit'; modelBefore: ICommentModel } | { kind: 'rebuild'; model }
   | { kind: 'modelOnly'; model }` and a single
   `prevModelBeforeLastApply: ICommentModel` getter on JSONState. Also
   collapses the coordinate/serializer plumbing for the three per-field
   clones.

6. **[MAJOR] `comments/model.ts` is 1,087 lines stacking five concerns** —
   extraction (~106-360), materialization (364-568), view (570-644), restick
   (646-711), and the ~355-line OT transform block (733-1087) that shares
   only types with the rest.
   **Fix:** extract `comments/transform.ts` (the whole 733-1087 block); if
   fix 1 lands, the view moves too and model.ts ends ~500 lines.

7. **[MAJOR] `comments.vue` smears per-thread UI state across six parallel
   reactive records** (`comments.vue:265-277`; three keyed by id, three by
   `id:index` composite strings; six-armed GC sweep at 329-353).
   **Fix (judo d):** one `Map<threadId, ThreadUiState>` with
   `{ replyDraft, composing, replying, edits: Map<number, { draft,
   anchorCreatedAt }> }`; deletes `replyEditKey`/`threadIdOf` and the sweep
   arms.

8. **[MAJOR] The comment command router didn't delete what it replaced** —
   all ~15 per-handler `sourceCode.value` mode guards survive (e.g.
   `editor.vue:1734-1736`; 13 hits in the file) although
   `review/commentCommandRouter.ts:3-9` claims the router owns the split;
   `editor-focus` still double-dispatches on mitt registration order; and
   `ICommentSurface` types every payload `unknown` (router:11-20), forcing
   ~16 duplicated narrowing casts across both surfaces (already drifting in
   strictness).
   **Fix:** delete the guards (the router IS the mode); narrow once at the
   bus edge (throw on caller bugs per no-swallow); type the surface honestly
   (`reply(payload: { id: string; reply: ICommentReplyInput })` etc.); give
   `editor-focus` a surface member instead of dual listeners.

9. **[MAJOR] `isSourceModeHandoff` is field-shape sniffing** —
   `editor.vue:1558-1559` classifies a five-emitter bus payload by
   `isIndexCursor && !newCursor && history == null`.
   **Fix:** explicit `origin: 'source-handoff' | 'disk-reload' |
   'tab-switch'` discriminant on the payload (emitter:
   `sourceCode.vue:879-884`); delete the sniff, the `isReload` boolean, and
   the six-line justification comment.

10. **[MAJOR] `analyze.ts` copy-pastes `source.ts` helpers verbatim** —
    `definitionRemovalRange` byte-identical (`analyze.ts:87-108` =
    `source.ts:688-709`, diffed); near-duplicate `syntaxRemovalRangesForId`
    with a `markdown: string | null` phantom mode whose null branch produces
    dead/overwritten values. The forked logic is the trailing-separator
    byte-fidelity rule.
    **Fix:** parameterize the source.ts owner; delete both analyze.ts copies
    and the null mode; compute removal ranges once inside the memoized
    source maps.

11. **[MINOR] Dead public API** — `updateCommentMetadataDefinition`
    (`edit.ts:705`, ~150 lines, complexity-23 warning) has zero production
    callers (tests only; verified across desktop + skills). Also exported
    with no consumers outside their own module: `commentSyntaxRangesForId`,
    `stripCommentSyntaxFromMarkdown`, `collectSourceCommentIds`.
    **Fix:** delete (or stop exporting) after re-verifying no callers.

12. **[MINOR] Integration bolted into the two biggest files** —
    `store/editor.ts` 2,089→2,311; `editor.vue` 2,102→2,347. The WYSIWYG
    comment surface (~130 cohesive lines, `editor.vue:1700-1825`) is fully
    extractable as `useWysiwygCommentSurface(editor)` beside the router;
    fix 4 erases most of the editor.ts growth.

13. **[MINOR] `loadChange` conflates buffer content with disk base**
    (`editor.ts:426`), forcing three forge-payload-then-repair dances
    (`dirtyExternalMergeActions.ts:426-440`, the Undo closure, reload).
    **Fix:** explicit `{ diskBase?: string }` option; return the mutated tab.

14. **[MINOR] `mt::update-file` typed as an index-signature grab-bag**
    (`shared/types/files.ts:132-136`) forcing four
    `as unknown as FileChangePayload` casts in the watcher.
    **Fix:** type the channel with the real shape (move/merge
    `FileChangePayload` from `editorPersistence.ts:4-7` into shared/types);
    delete the casts and the existence guard.

15. **[MINOR] Dead `MergeConflictState.expectedMarkdown/expectedDiskBase`**
    (`dirtyExternalMergeActions.ts:39-42`) — written once, read nowhere,
    with a comment describing a retired liveness mechanism.
    **Fix:** delete fields + comment.

## Code-judo moves (referenced above)

- **(a)** One comment-semantics owner: `parseMarkdownComments` = extract +
  view. Also unifies `ICommentRange` offsets (currently marker-inclusive
  from the byte path, clean from the view — one type, two meanings).
- **(b)** Watcher dispatches one event; ALL routing in the reducer's
  decision table.
- **(c)** One literal-context grammar: overlay driven from batch line views;
  inline code via the tokenizer.
- **(d)** One `Map<threadId, ThreadUiState>` in comments.vue.
- **(e)** One `prevModelBeforeLastApply` + discriminated history-entry union.
- **(f)** One sentinel insertion plan: `offsetCursor.ts` `injectStateSentinels`
  (224-264) and `adjustedSentinelCommentModel` (304-332) duplicate the
  same-block tie-break branch structure, synced only by a "Mirror of"
  comment → shared `planSentinelInsertions(selection)`.

## Nits

- Rename bare `addComment` bus event to `comment:add` (router + three
  emitters; family is otherwise `comment:*`; branch-new, zero risk).
- `history/index.ts:71`: use `ICommentThread` instead of the
  `extends Map<string, infer T>` contortion.
- `muya.ts:1215`: local `cleanMarkdown` names the MATERIALIZED serialization —
  rename to `materializedMarkdown` (opposite of the engine's "clean" term).
- `offsetCursor.ts:294-304`: orphaned JSDoc — move `locateSentinelOffsets`'s
  doc block down to its function.
- Export `mayContainCommentSyntax()` from syntax.ts; delete the four
  hardcoded `'MC:'` sniffs (clipboard/index.ts:162,225; parse.ts:116,202)
  and `_pasteAbsorbingComments`'s boolean parameter.
- `state/index.ts:319-371`: one `_serializeCached` memoizer for
  getMarkdown/getCleanMarkdown; type `listIndentation` from IMuyaOptions.
- `addCommentState.ts:17-30`: keep one getter; callers write the `hasText &&`
  conjunction.
- `model.ts:871-874, 929-932`: concentrate the `transformPosition`
  double-casts in one audited `transformBlockPath` helper (asDoc precedent).

## Ruled out (attacked, held — do not re-litigate without new evidence)

Hand-built MC bytes outside the grammar owner; IPC naming + typed-contract
declarations for all branch-new channels; skills CLI package boundary;
preload test-bridge gating; reducer purity; the worker bridge envelope;
`mergeAlignedLineEdits` gating; `markerScan` as an adapter;
`restickTerminalAppendix` layering; locale completeness; paste id-remap
order-safety.

## Execution protocol

Fix ALL findings via red-green TDD (house rules): reproduce each inferred
failure scenario red first (findings 2, 3 explicitly), keep the muya/desktop
gates green at each step (muya unit + conformance + lint/types/css/madge;
desktop unit + typecheck + lint; both e2e suites for behavior-adjacent
changes), then **re-run the thermo-nuclear review fresh, from zero, with no
memory of this run's findings or verdict**.

## Handoff (human / external — not blockers for the fix loop)

- Open the PR from `markupdown-inline-comments` to `develop` (also gives the
  Linux CI e2e workflow its first run).
- Account limits interrupted two review dimensions mid-run twice
  (muya-structure, debt hunt were completed inline instead); re-running the
  full review needs available agent budget.
- The deployed `/Applications/MarkText.app` build predates any fixes made
  from this plan; redeploy after the fix loop.
