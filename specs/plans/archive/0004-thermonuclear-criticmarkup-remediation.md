# 0004 — Thermonuclear CriticMarkup Remediation

**Status:** Superseded on 2026-07-13 by
[`0006-criticmarkup-production-readiness-closure.md`](../0006-criticmarkup-production-readiness-closure.md)  
**Started:** 2026-07-11  
**Branch:** `feat/native-criticmarkup`  
**Review scope:** the complete working tree versus `upstream/develop` at
`43bd8b77795fb27b1a9512737c000f7362031ea0`, including untracked files

**Companion exit bar:** `0005-mc-informed-criticmarkup-parser-hardening.md` is
active and shares this implementation. Its MH-01–MH-12 parser-context,
boundedness, parity, losslessness, sink/security, and performance obligations
must close before the hidden-app proof and fresh thermonuclear review.

## Exit bar

> Historical plan. All unfinished obligations were transferred to plan 0006;
> the findings and checkpoints below remain evidence, not an active queue.

Fix every validated finding from the 2026-07-11 thermonuclear code-quality
review through red-green TDD, satisfy every class-level closure check below,
exercise the real hidden desktop application, and then obtain an independent
fresh full-branch thermonuclear review with an **APPROVE** verdict and zero
remaining findings. A locally improved score, a green focused suite, or the
absence of a previously cited line is not completion.

## Baseline ledger

The inventory below is derived from the current tree, not from prior completion
claims. Counts are exhaustive for the named search/census unless noted.

| ID | Validated finding | Root-cause class | Baseline evidence | Closure check |
| --- | --- | --- | --- | --- |
| TN-01 | Leaf-local and block-spanning CriticMarkup use competing AST/token/render pipelines | A — split semantic ownership | Two live lexer handlers; two live renderer families; two Marked extensions; `inlineRenderer/lexer.ts` is 1,422 lines | One all-fragments document pipeline; legacy inline extension and local Critic token family absent; lexer below 1,000 lines |
| TN-02 | Track Changes discards exact OT operations and infers one broad string delta | B — mutation logic above the operation boundary | Exact ops originate in `Content`/`JSONState`; `contiguousEdit` re-diffs whole Markdown; search owns a special rejection | Every mutation enters one gateway carrying its exact operation intents; no `contiguousEdit`; multi-edit transforms preserve untouched Markdown |
| TN-03 | Track Changes commit/rollback is not atomic across state, history, tree, selection, and events | B — mutation logic above the operation boundary | Rebuild history is recorded before dispatch/rebuild; rollback restores only state/tree | One prepared commit protocol publishes history/events only after validation and successful rebuild; injected failures leave all observable state unchanged |
| TN-04 | Read-only projections depend on scattered endpoint checks | B — mutation logic above the operation boundary | 48 production references to `criticMarkupProjection`; public mutators are inconsistently guarded | The operation sink selects Direct, Tracked, or ReadOnly mode once; mutation entry points contain no projection-specific guards outside an explicit allowlist |
| TN-05 | Literal ranges can hang or expose excluded text | A — split semantic ownership | `scanCriticMarkup` accepts unvalidated ranges; empty/reversed ranges can prevent forward progress; overlapping ranges are not merged | One validated excluded-range type rejects invalid bounds, merges overlap, and proves forward progress with adversarial tests |
| TN-06 | Markdown literal classification exists in three handwritten implementations | A — split semantic ownership | Core fence/backtick parser, live-token classifier, and 627-line Marked context classifier | Critic grammar is Markdown-agnostic; one Markdown AST adapter owns excluded ranges |
| TN-07 | Source mapping has three unbranded algebras and has swollen the serializer | C — missing mapped-text primitive | `stateToMarkdown.ts` grew 626→940; Marked uses per-code-unit `starts`; document model owns a third translator | One branded `MappedText<Path>`/`SourceMap<Path>` implementation; serializer below 800 lines; no duplicate translators/validators |
| TN-08 | Review state is manually synchronized inside a 2,361-line component | D — duplicated desktop protocols/state | Eight `pushReviewMenuState()` calls; Muya, Pinia, and Electron menu mirrors; duplicate engine DTOs | Muya emits one typed snapshot; one controller publishes sidebar/menu state; zero `pushReviewMenuState` calls; review logic no longer grows `editor.vue` |
| TN-09 | Fifteen Review commands are copied across registries and two protocols | D — duplicated desktop protocols/state | 105 production command-id occurrences across at least eight registries; bespoke Review IPC; missing `commands.review.trackChanges` in all ten locales | One descriptor registry derives IDs/actions/menu metadata/descriptions/default bindings; one command execution protocol; every locale key resolves |
| TN-10 | Background-test mode is scattered and can silently suppress renderer failures | E — missing presentation/error policy | 20 policy/env references; window mutations duplicated; error handler returns an unobserved pending promise; bundle guard is substring matching | One presentation policy owns show/focus/native UI; every launch captures errors; policy behavior is mock-tested; stale build check is deterministic; hidden real-app assertion passes |
| TN-11 | Contextual Review tool is a dangling red test | D — incomplete vertical slice | `criticMarkupReviewTool/` contains zero production files and one 287-line test | Native tool implementation, styles, export, registration, and behavior tests are green |
| TN-12 | Sidebar cards contain nested interactive semantics and encode Remove as Accept | D — duplicated desktop protocols/state | Card has `role=button` around child buttons; annotation removal emits `accept` | Dedicated focus control plus sibling actions; explicit remove-annotation UI action; keyboard/a11y contract test |

Mechanical baseline commands:

```bash
rg -n "tryCriticMarkup\(|tryCriticMarkupDocumentFragment\(" packages/muya/src/inlineRenderer/lexer.ts
rg -n "criticMarkupExtension|criticMarkupDocumentExtension" packages/muya/src --glob '!**/__tests__/**'
rg -n "function offsetCriticToken" packages/muya/src
rg -n "criticMarkupProjection" packages/muya/src --glob '!**/__tests__/**'
rg -n "pushReviewMenuState\(" packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue
rg -n "review\.(toggle-track-changes|mark-addition|mark-deletion|suggest-replacement|highlight|add-comment|previous|next|accept-current|reject-current|accept-all|reject-all|show-marked|show-original|show-revised)" packages/desktop/src --glob '!**/*.spec.ts'
rg -n "isBackgroundTestMode|MARKTEXT_TEST_BACKGROUND" packages/desktop/src packages/desktop/test/e2e/helpers.ts
```

## Root-cause matrix and target architecture

### Program C → A — one mapped document and one all-fragments AST pipeline

**Causal chain:** source positions are not a first-class primitive → each
consumer invents translation → local and spanning CriticMarkup need different
adapters → parsing, rendering, and projection behavior are duplicated.

**Target invariant:** serialization produces immutable mapped Markdown whose
branded state paths, parser paths, local offsets, and source offsets cannot be
mixed. One source-neutral `CriticMarkupAnalysis` owns the frozen semantic
forest for a source revision; when Markdown-derived exclusions differ from the
base context, it performs the one required conditional final scan. A
`CriticMarkupDocument<Path>` binds that exact analysis to a checked mapped-path
domain, indexes every item/fragment by ID and path, and supplies fragments for
*all* items without reparsing. Live Muya and Marked are adapters over that same
analysis/fragment model; whether an item crosses a block changes only its
`role`, never its token or renderer architecture.

**Waves:**

1. Add red mapped-text and excluded-range tests, including empty/reversed/
   overlapping ranges and a safe mutation check for the forbidden legacy
   normalizer pattern.
2. Extract neutral branded mapping types and a writer; migrate the serializer
   and Marked traversal; add node ranges needed by structural mutations.
3. Make `CriticMarkupDocument` indexed and make every item expose fragments.
4. Migrate live rendering to the all-fragments adapter, then delete local
   Critic tokenization, offset shifting, and duplicate renderers.
5. Migrate Marked to one document transform, then delete the inline extension,
   its `WeakMap` call-order state machine, and duplicate export orchestration.
6. Remove Markdown fence/backtick knowledge from the Critic grammar; the one
   AST adapter supplies validated excluded ranges.

**End-state counts:** `tryCriticMarkup` = 0; production
`criticMarkupExtension` references = 0; `offsetCriticToken` definitions = 0;
one Critic fragment renderer per output technology; one excluded-range
normalizer; `inlineRenderer/lexer.ts` < 1,000 lines; `stateToMarkdown.ts` < 800
lines; no new file >= 1,000 lines.

### Program B — one exact, prepared mutation gateway

**Causal chain:** mutation intent is produced below Track Changes → Track
Changes observes only before/after Markdown → broad inferred deltas and
caller-specific exceptions appear → history, events, rollback, and read-only
rules cannot be atomic.

**Target invariant:** every state mutation passes through one gateway that
captures typed operation intents and the composed `JSONOpList` before durable
state changes. The gateway selects Direct, Tracked, or ReadOnly behavior once.
Tracked mode maps the exact touched state paths/ranges through the mapped
document, produces one or more pure CriticMarkup edits, proves Original=before
and Revised=after, prepares the inverse/history/selection, applies and rebuilds,
then publishes history and events. Any failure publishes nothing and restores
everything.

**Waves:**

1. Add red tests for multi-cell table edits, multi-match replace-all, literal
   edits, a public mutator in a clean projection, injected rebuild failure, and
   history/event rollback.
2. Add operation-intent capture at `JSONState`; do not commit or schedule a
   captured batch until the gateway decides.
3. Extend mapped node ranges and implement exact single- and multi-edit
   transforms for text edits, insert/remove/replace, split/join, cut, paste,
   search, spellcheck, and IME paths already supported by the branch.
4. Replace the snapshot transaction and unify history/rebuild commit.
5. Route mutations through the sink and delete endpoint wrappers, projection
   guards, `contiguousEdit`, and search-specific rejection.

**End-state counts:** `contiguousEdit` = 0; `search-replace-all` rejection = 0;
callers of `runSynchronousMutation` = 0; one mutation commit protocol; zero
projection-specific checks in public mutators outside the view/controller
allowlist; every tracked transform proves both projection invariants.

### Program D — one Review protocol and controller

**Causal chain:** Muya exposes several pull APIs but no atomic Review snapshot →
desktop polls and mirrors state at lifecycle sites → commands, DTOs, IPC, and
interaction semantics multiply.

**Target invariant:** Muya emits one serializable Review snapshot on relevant
document, selection, and option changes. A desktop controller subscribes once,
owns prompt lifetime, and atomically publishes sidebar and native-menu state.
One descriptor table derives all Review command metadata and one existing
command-ID protocol executes commands. Desktop uses canonical Muya types or an
explicit exported `Pick`; IPC derives window identity from `event.sender`.

**Waves:**

1. Add red snapshot, descriptor completeness, locale contract, sender-derived
   IPC, sidebar keyboard semantics, and contextual-tool tests.
2. Add the Muya snapshot/event and implement the native contextual tool.
3. Extract `useCriticMarkupReviewController` and `CriticMarkupPromptDialog.vue`;
   delete manual push sites and duplicate DTOs.
4. Introduce the descriptor registry, migrate menu/command/keybinding/labels,
   and delete bespoke Review IPC.
5. Replace nested card interaction and add explicit annotation removal.

**End-state counts:** `pushReviewMenuState` = 0; `mt::editor-review-action` = 0;
one Review descriptor registry; no handwritten duplicate of exported Muya
projection/item/command-state unions; all ten locale contracts green; the
contextual-tool directory contains production implementation and styles.

### Program E — one background presentation and error policy

**Causal chain:** test visibility is an environment boolean consulted at
individual presentation sites → new native UI paths bypass it → errors are
hidden independently of capture → a string sentinel substitutes for behavior.

**Target invariant:** one policy object determines whether the application may
activate, focus, show a window, or present native UI. Window options are derived
centrally. Automated launches always install fail-closed main/renderer error
capture. Source/build staleness is checked deterministically before launch, and
the real app proves hidden/unfocused behavior.

**Waves:**

1. Add red policy tests for app activation, editor/settings window options,
   focus/show, dialogs, screenshot, startup/crash errors, and stale builds.
2. Introduce the policy and migrate every direct presentation path found by an
   exhaustive `rg` census; retain explicit interactive-debug opt-out only.
3. Make error capture unconditional and delete the never-settling error path.
4. Replace bundle substring guards with source/build freshness plus a runtime
   policy assertion.
5. Run exactly one explicitly backgrounded, low-priority, one-worker Electron
   flow and assert hidden/unfocused windows and no captured errors.

**End-state counts:** one production policy owner; no direct background-mode
conditionals outside it; no unobserved pending Promise; every harness launch is
error-guarded; every direct native presentation call is policy-routed or has a
documented non-test startup exception.

## Permanent fitness checks

The remediation is not closed without tests that fail against the baseline
architecture and remain in the suite:

- `criticMarkupArchitecture.spec.ts`: forbidden legacy pipeline modules,
  duplicate offset helpers/classifiers, and file-size ceilings.
- `excludedRanges.spec.ts`: validation, normalization, overlap, and guaranteed
  progress.
- `mappedText.spec.ts`: branded concat/slice/translation/node-range behavior.
- Mutation-gateway tests: exact captured intents, multi-edit preservation,
  projection invariants, read-only sink, and injected-failure atomicity.
- Review descriptor/snapshot/locale/IPC/a11y contract tests.
- Background policy tests using mocked Electron boundaries plus one real hidden
  smoke flow.

Each class test must be observed red before its production migration. After a
class is green, temporarily reintroduce one forbidden pattern where practical
and prove the guard fails, then immediately revert that mutation.

## Red evidence ledger

All commands below ran sequentially under `taskpolicy -b nice -n 20` with one
Vitest worker and file parallelism disabled. No Electron process was launched.

| Program | Test scope | Baseline failure observed |
| --- | --- | --- |
| B | `search.spec.ts`; `mutationGateway.spec.ts` | Three failures: multi-match Replace All did not produce exact substitutions; a clean-projection `replaceContent` mutation was accepted; an injected rebuild failure leaked undo history instead of leaving all observable state unchanged. |
| B | `mutationCapture.spec.ts`; `multiEditTrackChanges.spec.ts` | Twelve failures: the capture and multi-edit APIs are absent; the Unicode fixture also proves `diffToTextOp` counts grapheme clusters where `ot-text-unicode` requires code points. Contracts cover all four op kinds, split/join/table batches, no-op IME composition, disjoint source edits, overlap/literal rejection, and both projection invariants. |
| B | prepared-update/history/search/event failure injection | Ordinary updates leaked state/history/events when incremental apply and fallback rebuild both failed; undo moved its stacks before a failing rebuild; rejected publication leaked four selection events; rollback lost case/whole-word/regex search semantics; async image writes bypassed Track Changes. |
| C → A | `excludedRanges.spec.ts`; `mappedText.spec.ts`; `criticMarkupArchitecture.spec.ts` | Missing validated-range and mapped-text modules; all five architecture assertions failed on the duplicate local renderer family, duplicate Marked extension, local offset shifters, and the 1,422-/940-line lexer/serializer ceilings. |
| C → B | structural mapping/source-island suites | Thirteen failures plus one missing module: no node ranges or explicit boundaries, empty leaves were unmappable, escaped table pipes mapped after the generated slash, one cell rewrote unrelated padding/delimiters, and the tracked policy still globally re-diffed whole Markdown. |
| D | Muya Review snapshot plus desktop descriptor/controller/IPC/a11y suites | Muya lacks an atomic snapshot API/event; descriptor and controller modules are absent; manual pushes and bespoke IPC remain; the sidebar nests controls and aliases annotation removal to acceptance; sender identity is renderer-supplied. |
| E | Background presentation-policy and build-freshness suites | Policy and fingerprint modules are absent; presentation conditionals remain scattered; the bundle preflight uses a substring sentinel; error capture is conditional. |

First green checkpoint: the validated excluded-range and branded mapped-text
contracts pass (11 tests). The architecture fitness suite remains deliberately
red until the legacy pipelines and file-size violations are removed.

Second green checkpoint: all five C → A architecture fitness assertions pass.
The live lexer is 963 lines, the serializer is 701 lines, the leaf-local
renderer/token family and Marked inline extension are absent, and no Critic
offset shifter remains.

Program B capture/transform checkpoint: all 12 exact-operation contracts pass.
`JSONState.capture` now isolates and composes sequential intents without
revision/event/RAF effects, text retains use Unicode code points while exposed
source edits use UTF-16, and the multi-edit Critic transform rejects overlap or
literal conflicts and proves Original/Revised equality before returning.

Program D Muya checkpoint: 50 snapshot, command, and contextual-tool tests
pass. The engine publishes detached atomic Review snapshots, and the native
contextual Review tool is implemented, registered, localized, and lifecycle
guarded.

Program B gateway checkpoint: 33 focused capture, gateway, search, transform,
and multi-edit tests pass after replacing the deleted singular service with
one Direct/Tracked/ReadOnly gateway. Exact source-edit batches are preserved,
multi-match replacement no longer has a caller-specific rejection, clean
projections reject mutation at the sink, and rebuild failure publishes no
history or change event. The transform also proves existing marked documents
against their original/revised semantics and accounts for grammar-protective
payload escapes.

Program B prepared-commit checkpoint: 15 gateway/event failure contracts pass.
Incremental and rebuild paths share one prepare/apply/tree/selection/search/
publish coordinator; failed preparation emits nothing and restores history,
search, state, tree, and selection; successful rebuild emits one final selection;
observer errors are aggregated and explicitly classified as post-commit so a
committed document remains undoable. Async image placeholder and resolution
writes now traverse the gateway and coalesce inside the pending review arm.

Program C mapping checkpoint: all 14 context, document, and Markdown source-map
tests pass after the final branded-map error/coalescing fixes.

Program C → B structural checkpoint: 26 mapped-text/source-map/table contracts,
9 operation-island/architecture contracts, and 14 real tracked-edit contracts
pass. The canonical map now carries nested state-node ranges and explicit leaf
boundaries through concat/slice/DTO adaptation; parsed table widths remain
source-local; empty leaves and escaped pipes map exact insertion points; and
structural source edits are derived only inside captured-operation islands
between unchanged state anchors. The tracked policy contains no `fast-diff` or
whole-document fallback.

Program D desktop checkpoint: all 55 descriptor, architecture, controller,
store, menu/IPC, and keybinding tests pass. One 15-entry descriptor registry
drives the desktop protocol, the controller consumes Muya's canonical snapshot,
manual state pushes and bespoke Review IPC are gone, and sidebar removal has a
distinct accessible action.

First Muya static checkpoint: `tsc --noEmit` passes after the gateway, mapping,
prepared-event, table-layout, and desktop-facing public-command migrations.

Program E partial checkpoint: nine policy/harness assertions in two files pass.
The build-freshness file has twice failed to start a Vitest worker under the
required lowest-priority scheduling; this is an infrastructure startup timeout,
not an assertion result, so the file remains unverified and Program E remains
open.

## Verification discipline

Only the root agent runs checks. Checks run sequentially, never overlapping,
under macOS background scheduling and lowest process priority:

```bash
taskpolicy -b nice -n 20 <one local test/lint/typecheck/build command>
```

Electron additionally requires `MARKTEXT_TEST_BACKGROUND=1`, the explicit
one-worker Playwright configuration, a fresh desktop build, and the background
policy preflight. No ad hoc Electron launch is permitted.

After targeted red-green waves, the full gate is Muya unit/spec/conformance,
desktop unit, lint, typecheck, circular dependency checks, build, then one
hidden real-app workflow. Only then is a fresh reviewer spawned without this
ledger, prior findings, or prior verdict.

## Incidental cleanup required before completion

- Delete the dead optional-service branch in `clipboard/paste.ts`.
- Make Critic semantic source segments a real discriminated union.
- Preserve the user-owned `.vscode/settings.json` customization in the working
  tree but never stage or modify it as part of this effort.
