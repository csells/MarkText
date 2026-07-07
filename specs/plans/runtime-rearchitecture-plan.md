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
- P3 (OT anchors) — pending.
- P4 (serialization cache · undo journal · d.ts retirement) — pending.
- P5 (merge reducer) — pending.
- P6 (gap-analysis loop) — pending.

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
