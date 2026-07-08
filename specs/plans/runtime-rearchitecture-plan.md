# Plan: Comment Runtime Rearchitecture (Anchors, Format v2, Merge Reducer, Test Infra)

Implements the settled designs in `specs/architecture/`:
[comment-anchors.md](../architecture/comment-anchors.md) (OT-anchored
runtime), [comment-format.md](../architecture/comment-format.md) (wire format
v2), [external-merge.md](../architecture/external-merge.md) (session reducer
+ background-tab undo journal), and
[test-infrastructure.md](../architecture/test-infrastructure.md). Every phase
is red/green TDD; the plan closes with a spec gap-analysis loop that repeats
until the implementation reflects the specs.

## Status

- P0 (specs) — **done**.
- P1 (test infrastructure) — **done** (real mounts for the three specs; the
  preload markdown bridge + `getMarkdownContent` rewire; comment e2e clock
  waits converted to condition waits/`readSettled`).
- P2 (wire format v2) — **done**. Grammar/codecs/parse/mutations/CLI all
  read both and write v2; contiguous definition-line runs tokenize as one
  block so the appendix round-trips byte-identically; the four merge
  properties are pinned against the app's diff3 engine. One deliberate
  handoff: whole-document v1→v2 conversion on a mutation-free save (the
  engine-level half of pinned property 2) lands with P3's materialization
  pass — today untouched v1 lines round-trip byte-verbatim and convert on
  their first mutation.
- P3 (OT anchors) — **done**. Commits 7916d981 (model), 2a0fd669 (engine
  cutover: clean runtime, transform hook, model mutations + undo, cursor
  mapping, paste absorption), 4cec71ab (desktop pass: no-op json-change on
  model swaps, e2e restated to anchor semantics), ba706924 (guard machinery
  deleted — ~1300 net lines removed; the real muya types immediately caught
  the ParagraphFrontButton pluginName bug the hand-written declarations had
  hidden). Full gates green at each step: muya 1703 unit + 1347 conformance
  + 242 e2e, desktop 868 unit + 277 e2e, typecheck/lint/circular clean.
- P4 (serialization cache · undo journal · d.ts retirement) — **done**.
  getMarkdown cached per JSONState version + listIndentation
  (serializationCache.spec); background auto-merges journal the pre-merge
  buffer on the tab and activation seeds a rebuild-undo boundary from it,
  discarding stale engine history (background-merge-undo.spec e2e);
  muya-core.d.ts deleted — muya `build:types` emits real declarations to
  lib/types, tsconfig.base.json points at them, root typecheck builds them
  first.
- P5 (merge reducer) — **done**. `store/mergeSession.ts` is the pure per-tab
  reducer (state idle|merging|reviewing|closed carrying monotonic
  request/session counters; events carry reality snapshots; effects are
  declarative). `dirtyExternalMergeActions.ts` became the interpreter:
  reality-drift sync (buffer-edited/saved/tab-closed derived lazily from the
  tab), effect executors, and the notification closures that translate clicks
  into review-requested events. The request-id map, global session counter,
  scattered liveness checks, and the diagnostics escalation gate all folded
  into the reducer. merge-session-reducer.spec.ts pins the full decision
  table (29 specs) plus the four fuzz invariants over 150 seeded random
  event sequences with a model interpreter; the pre-existing
  dirty-external-merge behavior lock passes unchanged.
- P6 (gap-analysis loop) — **in progress**. Round 1: a 7-analyzer /
  per-finding adversarial-verifier workflow over every specs/architecture/
  doc confirmed 32 gaps (6 must-fix, 13 minor, 13 spec-stale; 2 claims
  refuted). All code gaps fixed red/green in six batches: merge-apply fixes
  (accept crash on no-base sessions, reducer-owned markClean + notification,
  order-preservation fuzz); definition-line placement runs (mid-document
  byte fidelity through the runtime) + reply-append file termination; guard
  machinery deletion (table refusals, copy/search stripping, live-renderer
  hiding) which exposed and fixed a replace-rescue transform bug; word count
  over getCleanMarkdown; test-infra conversions (real mounts for
  search-prefill/command-palette, sleep→condition waits, portable chords,
  selection bridge); CLI head-rewrite fix, --footnote parity flag, grammar
  prefixes derived from syntax.ts. All six architecture docs updated to the
  delivered design. Round 2 (10 confirmed: 1 must-fix, 7 minor, 2
  spec-stale) fixed: the Linux-CI test-bridge gating, rescue/redo pins,
  grammar-owner prefix regexp, dead apply fallback path, residual e2e
  sleeps, run-position parenthetical. Round 3 (7 confirmed, 0 must-fix)
  plus a five-verifier adversarial review (mutation testing, independent
  byte-fidelity probes) fixed: the same-leaf marker+definition
  serialization corruption (BLOCKER — markers and text-embedded runs now
  splice in one per-leaf pass, pinned), the mid-doc-definition cursor
  clamp, payload marker scanning (CLI rejected its own output), the
  byte-equal watcher-echo notification/resolver behavior, fuzz
  strengthening with mutants verified dying, the strip/getCleanMarkdown
  byte agreement (cross-mode word count), strict setHistory, lint:css
  gated + warning ratchets, canonicalization pins, and the final doc
  alignments. Round 4 (9 confirmed, 0 must-fix/major) fixed: invariant-1
  scoping, decision-table absorb row, canonicalization count, redo/burst
  history pins, byte-payload re-serialization pins, marker-fixture
  whitespace, and remaining doc drift. Round 5 (4 confirmed, 0 refuted,
  ZERO implementation-behavior divergences) fixed: the base-tracking
  advancement enumeration (spec-stale), the MC-paste single-undo-boundary
  pin (verified biting against a no-boundary mutant), the last four
  sleep-then-assert e2e reads converted to polls/settled streaks, and the
  agent-cli byte-preservation exception wording. Severity trajectory
  32→10→7→9→4 with rounds 4–5 free of behavior gaps. Next: round-6
  analysis as convergence confirmation; final certification sweep.

## P1 — Test infrastructure first (it gates everything after)

1. Convert `comment-sidebar-reply-edit.spec.ts`,
   `source-code-image-action.spec.ts`, and `merge-conflict-dialog.spec.ts`
   from the compiled-SFC `new Function` harness to real `@vue/test-utils`
   mounts per the contract in test-infrastructure.md. Behavior parity: every
   existing assertion survives, restated against rendered DOM/emitted events.
2. Test-mode markdown bridge: preload exposes
   `window.__marktextTest.getTabMarkdown()` (gated on
   `MARKTEXT_TEST_BACKGROUND`); `getMarkdownContent` in e2e helpers uses it;
   remove the source-mode round-trip read.
3. Sweep remaining bare `waitForTimeout`-before-assertion sites in the
   comment/merge e2e specs to condition waits.

Exit: desktop unit + both e2e suites green; no `compileScript` in specs; no
mode-toggling reads in helpers.

## P2 — Wire format v2

1. RED: v2 round-trip specs (head + reply lines, stable key order,
   byte-identity including malformed/duplicate lines); v1 read-compat specs
   (decoded equivalence, v2 emission); merge-property specs using the diff3
   engine as oracle (different-reply edits merge clean; status⊥reply merges
   clean; same-point replies conflict legibly and their union parses);
   single-line reply-append property; `orphan-reply`/`invalid-reply`
   diagnostics.
2. GREEN in `comments/syntax.ts` + `metadata.ts` + `parse.ts`/`analyze.ts`:
   line grammar `[MC:id]` / `[MC:id.N]`, compact stable-key JSON payloads,
   derived thread `updatedAt`, positional reply ordering, index
   normalization on serialize.
3. Serializer/materialization emits v2; CLI reads both/writes v2
   (`--reply-index` semantics preserved); update SKILL.md; migrate fixtures
   deliberately (keep dedicated v1-compat fixtures).

Exit: muya unit + conformance + skills + desktop suites green.

## P3 — OT-anchored comments (the core)

Staged so each lands green:

1. **Model + extraction + materialization.** `comments/model.ts`
   (`ICommentModel`, `ICommentAnchor`); `extractCommentModel(states)` →
   `{ cleanStates, model }`; `materializeCommentModel(states, model)` →
   marked states + metadata appendix. RED: extraction/materialization
   round-trip byte-identity over the existing corpus (single-block,
   cross-block, overlapping, container-nested, astral); no-MC-bytes
   invariant.
2. **Engine cutover: load + serialize.** `setContent`/`replaceContent` run
   extraction; `getMarkdown` materializes. The document tree is clean.
   Rendering: highlights from anchors (`MuyaComments.commentRenderView`
   rewired); marker/metadata DOM classes gone at runtime. Update engine
   suites that asserted marker bytes in state/DOM.
3. **Transform hook.** Anchor transform via `json1.type.transformPosition`
   at the `JSONState` apply choke point (all four op shapes; rescue policy on
   `replaceOp`; detach on `null`). RED first: typing/paste/block-ops/undo
   anchor-motion specs incl. transform-through-inverse identity.
4. **Mutations + undo entries.** `addComment`/`removeComment`/thread patches
   as model mutations recording invertible comment-model history entries;
   rebuild boundaries snapshot the model. Public API shapes unchanged
   (`getComments` etc.).
5. **Delete the guard families** listed in comment-anchors.md §What this
   deletes, convert their regression tests to anchor-semantics tests, update
   the caret/e2e suites that asserted `.mu-comment-marker` /
   `.mu-comment-metadata` DOM or marker-inclusive offsets.
6. **Desktop pass:** source-mode handoff (materialized bytes), cursor
   mapping (`getCursorOffset`/`setCursorByOffset` against materialized
   markdown), sidebar/dialog unaffected by API stability; e2e sweep.

Exit: full certification sweep (all gates, both e2e suites).

## P4 — Honorable mentions

1. **Serialization cache:** `getMarkdown`/materialization cached per
   `JSONState` version (one serialize per version regardless of caller
   count). RED: call-count spec.
2. **Background-tab undo journal:** per-tab pre-merge journal entry; on
   activation of a background-merged tab, seed a rebuild-undo boundary from
   the journal (external-merge.md §Background tabs and undo). RED: unit +
   e2e (background merge → activate → Cmd+Z restores pre-merge buffer).
3. **Retire `muya-core.d.ts`:** muya emits declarations (types-only tsc
   project → `lib/types`); `tsconfig.base.json` paths point at them; the
   hand-written declaration file is deleted; typecheck pipeline builds types
   first.

## P5 — Merge session reducer

1. RED: reducer unit specs for the full decision table (every existing
   `dirty-external-merge-actions.spec.ts` behavior restated as
   state+event→state+effects) plus the four fuzz invariants in
   external-merge.md §The session reducer.
2. GREEN: `store/mergeSession.ts` pure reducer; `dirtyExternalMergeActions`
   becomes the interpreter (request-id map, session counter, and scattered
   liveness checks fold into reducer state).
3. e2e unchanged and green (behavior-preserving).

## P6 — Gap-analysis loop

Run a fresh-eyes gap analysis of the implementation against every document
in `specs/architecture/` (letter and spirit, file:line evidence). Fix every
gap red/green. Repeat until the analysis reports the designs fully
implemented. Close with the full certification sweep and update this plan's
Status section to done.
