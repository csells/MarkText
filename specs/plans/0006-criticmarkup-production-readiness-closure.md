# 0006 — CriticMarkup Production-Readiness Closure

**Status:** Active  
**Created:** 2026-07-13  
**Branch:** `feat/native-criticmarkup`  
**Base:** `develop` at `43bd8b77795fb27b1a9512737c000f7362031ea0`

**Supersedes:**

- [`0003-native-criticmarkup-integration.md`](archive/0003-native-criticmarkup-integration.md)
- [`0004-thermonuclear-criticmarkup-remediation.md`](archive/0004-thermonuclear-criticmarkup-remediation.md)
- [`0005-mc-informed-criticmarkup-parser-hardening.md`](archive/0005-mc-informed-criticmarkup-parser-hardening.md)

Those plans remain the historical decision and red/green evidence record. This
plan is the only active execution plan and carries every surviving obligation.

## Outcome

Ship pure CriticMarkup as a production-ready, parser-native MarkText feature.
All five standard constructs must share one Markdown-parser-owned semantic and
topology model through editing, rendering, review, persistence, clipboard,
search, and export. Track Changes must preserve exact before/after semantics
through ordinary editor operations. The freshly built desktop application must
prove the complete workflow while remaining hidden and unfocused during
automation.

Completion is a capability judgment, not a score. Green focused tests do not
offset a known broken user flow, and unit tests do not substitute for the real
artifact.

## Scope boundary and settled decisions

1. **Pure CriticMarkup only.** Persist only the five canonical forms. No IDs,
   metadata appendix, authors, timestamps, threads, or Roughdraft extensions.
2. **One grammar and one parser artifact.** Grammar recognition, semantic
   identity, Markdown context, native topology, and mapped fragments have one
   authority per exact source revision and parser-option profile.
3. **No inferred fragment topology.** A fragment-bearing document requires an
   authenticated parser binding graph. Generic mapped-span intersection,
   structural source-cover inference, sidecar regexes, optional provenance,
   and module-global parse state are forbidden.
4. **Explicit semantic-only construction.** Native extension planning may
   consume a source-neutral `CriticMarkupAnalysis`; APIs exposing paths or
   fragments require complete bindings.
5. **One mutation gateway.** Direct, tracked, read-only, history, document
   replacement, and nested mutations share one transaction boundary. A tracked
   commit must prove `Original = before` and `Revised = after`.
6. **Fail closed, but visibly.** Unsafe or unmappable edits do not mutate the
   document, history, selection, or events, and the user receives a localized,
   actionable rejection reason.
7. **Existing Review surfaces are the baseline product UI.** The native Review
   menu, Review sidebar, and contextual Review tool are the preferred control
   placement. Dedicated toolbar/preferences controls may be dropped only after
   the user accepts a packaged-app reachability walkthrough; otherwise that
   surviving 0003 obligation must be implemented.
8. **Canonical Markdown owns persistence.** Save and autosave always use the
   canonical Muya Markdown, never the active display projection.
9. **Concurrency remains out of scope.** External-file watching, agent-write
   reconciliation, autosave ownership arbitration, and modeless conflict UI
   are the next project after this plan closes.
10. **Preserve user-owned workspace state.** Do not modify or stage
    `.vscode/settings.json` as part of this work.

## Current evidence baseline

The implementation is materially advanced: the five-form grammar, immutable
analysis, native inline and block bindings on the live-state path, branded
mapping, projection model, mutation gateway, Review snapshot/controller/menu/
sidebar, contextual tool, sink policy, security corpus, resource policy, and
background-presentation policy all exist. Do not rebuild those capabilities.

The 2026-07-12/13 fresh audit found the following release blockers:

| ID | Current blocker | Evidence to reproduce cleanly |
| --- | --- | --- |
| PR-01 | Static Marked/export construction still permits no-binding documents and falls back to generic mapped-span fragment reconstruction | `buildFragmentsByItem` and optional `nativeBindings` remain in `packages/muya/src/criticMarkup/document.ts`; parser-context constructors omit a graph |
| PR-02 | Native structural state and consumer topology regressions | 8 structural-state cases, 6 consumer-parity rows, and 1 projection-topology case were red in the audit |
| PR-03 | Five structural Track Changes flows are broken | Cross-block cut, multi-paragraph paste, cross-block replacement, paragraph split, and paragraph join |
| PR-04 | Contextual structural review is broken | Four focused cases covering list-item targeting, block-spanning fragments, and nested focus |
| PR-05 | Track Changes rejection can be an unexplained no-op | The engine emits `critic-markup-track-change-rejected`, but production does not present it and command dispatch discards the result |
| PR-06 | Parser-option rollback can fail under the new options | The mutation-authority option-failure case reports that reset and rollback both failed |
| PR-07 | The vendored Marked fork is neither reproducibly verified nor tracked | Both positive fork-contract tests fail; reverse application of the canonical patch fails; `packages/marked/` is untracked |
| PR-08 | Native adapter complexity is not yet protected by a size law | Global marker/plan `find`/`filter` scans remain; the final scale suite has fixed-size timeouts but no ratio/call-count invariant |
| PR-09 | Architecture/decomposition gates are red | `stateToMarkdown.ts`, `markdownToState.ts`, `criticMarkup/document.ts`, `nativeCriticMarkup.ts`, and `paragraphContent/index.ts` violate current size/decomposition contracts |
| PR-10 | Production artifact proof is incomplete | No fresh complete hidden desktop workflow, full sequential gate, actual PDF/print proof, complete persistence matrix, or accessibility proof |

Every audit failure must be rerun alone under the required background policy
before its cause is considered established. The interrupted audit runs are a
failure ledger, not completion evidence.

## Execution discipline

- Work in the order below. Each wave closes a named capability and has a
  falsifiable gate.
- Start each behavior or architecture change with a red test that fails for
  the intended reason; implement the smallest systemic correction; rerun the
  narrow test before broader gates.
- Only the root agent runs tests. Tests are sequential, low priority, and one
  worker. Never overlap suites.
- Do not launch Electron ad hoc. Desktop automation requires a fresh build,
  `MARKTEXT_TEST_BACKGROUND=1`, the repository Playwright configuration, one
  worker, presentation-policy preflight, and main/renderer error capture.
- Do not rerun scores or broad suites while a known red capability remains.

## Wave 0 — Re-establish a trustworthy red baseline

- [ ] Rerun each executable PR-01 through PR-09 failure independently and
  record the exact assertion, source, and causal boundary. Record PR-10 as a
  proof-gap ledger with the exact future command/artifact required.
- [ ] Prove which structural/parity/contextual failures share the incomplete
  binding migration and which are independent.
- [ ] Replace brittle fitness assertions that count implementation details
  with exhaustive coverage assertions; do not weaken the behavior or
  architecture bar to make them green.
- [ ] Replace the obsolete `resourceScaleContracts` expectation that preserves
  `buildFragmentsByItem` with a red contract for its deletion and the new
  parser-owned complexity law.
- [ ] Record the focused command and red evidence beside each wave below.

**Gate:** every current failure has one reproducible, isolated test and a
root-cause assignment; no unexplained or test-order-only red remains.

## Wave 1 — Complete parser-owned binding authority

- [ ] Move binding contracts to a neutral generic module that supports both
  Muya state paths and Marked parser paths without reversing dependencies.
- [ ] Make the located Marked parser artifact emit exact inline and structural
  bindings from token identity and parser provenance. Do not search repeated
  text or reparse delimiters.
- [ ] Carry `{analysis, bindings}` atomically for one exact source revision,
  normalization result, parser profile, context-coverage identity, parser
  invocation/token graph, and mapped path-domain revision.
- [ ] Pass complete bindings into both live-state and Marked/static/export/
  clipboard documents.
- [ ] Split native extension bootstrap onto an explicit semantic-only analysis
  API so it does not construct a fragment-bearing no-binding document.
- [ ] Require authenticated bindings in every API that exposes fragments,
  paths, source-to-local lookup, rendering, review targeting, or authoring.
- [ ] Delete `buildFragmentsByItem`, `finalizedFragments`, their generic span-
  intersection helper/type cluster, optional binding parameters, and every
  higher-level topology fallback.
- [ ] Preserve exact substitution arm identity, nested ownership, zero-width
  boundaries, repeated identical text, escaped table pipes, generated prefixes,
  normalization, and block-spanning fragments.
- [ ] Repair PR-02 through this common owner; do not add state-, renderer-, or
  export-specific patches.
- [ ] Add permanent architecture tests forbidding generic fragment inference,
  hidden sidecars, optional fragment provenance, and multiple delimiter owners.
- [ ] Reject stale bindings even when source bytes and parser options match but
  the produced state tree, token graph, or mapped path domain differs.

**Gate:** structural-state, consumer-parity, projection-topology, parser-
artifact, native-AST, inline-binding, block-binding, export, clipboard, and
shared-corpus suites are green; all fragment-bearing documents are backed by
one parser artifact; the deleted fallback is absent from production and tests.

## Wave 2 — Bound and decompose the native pipeline

- [ ] Precompute marker ranges, plan starts, next-plan offsets, boundary plans,
  and item/path indexes once per parser artifact.
- [ ] Replace per-token or per-boundary scans of complete marker/plan sets with
  indexed or monotonic lookup.
- [ ] Add allocation/call-count and size-ratio tests over the actual grammar →
  native Marked → Muya/static adapter pipeline for ordinary no-opener, dense,
  malformed, exclusion-heavy, deep, wide, and native-container-heavy input.
- [ ] Complete the interrupted scale matrix and prove documented 128-level
  Markdown and 64-level presentation budgets preserve excess source literally
  with diagnostics and no crash, hang, truncation, or silent semantic loss.
- [ ] Decompose oversized production modules by responsibility while preserving
  public contracts. Restore the existing ceilings: inline lexer below 1,000
  lines, serializer below 800 lines, and no new unallowlisted production file
  at or above 1,000 lines.
- [ ] Keep `CriticMarkupDocument` focused on immutable indexed views; move
  validation, binding materialization, render planning, and query indexes into
  cohesive modules rather than weakening the size gate.
- [ ] Validate and remove the dead optional-service branch in
  `clipboard/paste.ts` if it still exists.
- [ ] Make Critic semantic source segments a true discriminated union if that
  cleanup remains outstanding.

**Gate:** resource, scale, architecture, circular-dependency, and size fitness
checks pass; measured work scales according to the documented complexity law.

## Wave 3 — Close transactional editing and Track Changes

- [ ] Fix parse-affecting option transitions: prepare under the prospective
  option snapshot, roll back under the previous snapshot, restore every
  observable, and preserve the original failure unless rollback independently
  fails.
- [ ] Fix the five known structural editing regressions: cross-block cut,
  multi-paragraph paste, cross-block replacement, paragraph split, and
  paragraph join.
- [ ] Build one table-driven mutation matrix spanning all five constructs and
  every arm/boundary: before/open/inside/separator/close/after, empty forms,
  nested forms, and block-spanning forms.
- [ ] Cover typing, Backspace/Delete, selection replacement, split/join, block
  conversion, table/list mutations, cut/paste, multi-match search replacement,
  spellcheck, IME composition/cancel/commit, formatting, image placeholder and
  resolution, undo/redo, and whole-document replacement.
- [ ] Require exact captured operations, one descending source-edit composition,
  `Original = before`, `Revised = after`, untouched-byte preservation, one
  semantic history entry, and exact undo restoration.
- [ ] Prove failed preparation/rebuild/observer publication changes no state,
  tree, history, search state, selection, or pre-commit event.
- [ ] Define a typed rejection-reason taxonomy and route gateway rejections to
  one localized, actionable desktop presentation. Rejections must be visible
  without stealing focus during background tests.

**Gate:** the complete mutation matrix and failure-injection suites are green;
no tracked edit silently no-ops; all mutation entry points use the one gateway.

## Wave 4 — Finish structural Review UX and accessibility

- [ ] Fix contextual targeting so list annotations bind to the semantic list
  item rather than its container.
- [ ] Preserve every fragment of block-spanning and nested items in contextual
  review state.
- [ ] Restore deterministic nested-parent/child focus, previous/next navigation,
  resolution focus restoration, and projection-to-Marked handoff.
- [ ] Keep the existing Review snapshot, controller, descriptor registry,
  native menu, sidebar, IPC, and localization architecture; repair rather than
  replace it.
- [ ] Preserve explicit Remove semantics for highlight/comment instead of
  presenting annotation removal as Accept.
- [ ] Prove keyboard-only traversal and actions, stable focus restoration,
  screen-reader names/roles/states, live rejection announcements, and no nested
  interactive semantics.
- [ ] Validate all ten locale contracts and platform menu/keybinding behavior.
- [ ] Walk the packaged app from the ordinary editor surface to Track Changes,
  projections, navigation, and resolution using the Review menu/sidebar/tool.
  Record the user's explicit acceptance of those surfaces as replacement for
  dedicated toolbar/preferences controls, or implement the missing controls.

**Gate:** contextual-tool, Review snapshot/controller/sidebar/menu, focus,
keyboard, accessibility, localization, and source-mode lifecycle suites pass
through real DOM and desktop boundaries.

## Wave 5 — Certify persistence, projections, sinks, and security

- [ ] Run the shared corpus through open/no-op save, repeated save, edit/save/
  reopen, autosave/reopen, and WYSIWYG↔source no-op handoff.
- [ ] Flush pending editor operations before explicit save and prove save and
  autosave use canonical Markdown in Marked, Original, and Revised display
  views.
- [ ] Preserve exact bytes except the explicitly documented pre-existing
  MarkText serializer normalizations; test LF/CRLF, BOM, no final newline,
  repeated blank lines, astral text, malformed input, nesting, containers,
  tables, front matter, and hostile payloads.
- [ ] Prove per-projection policy for normal copy, Copy as Rich, Copy as HTML,
  Copy as Markdown, cut, paste, search/replace, word/character count, source
  mode, static/styled HTML, PDF, and print.
- [ ] Inspect actual PDF and print artifacts, not only their shared styled-HTML
  precursor.
- [ ] Prove final sanitization rejects script elements, event attributes,
  unsafe URL schemes, hostile image fields, quote-breaking titles, and nested/
  cross-block payloads while preserving required Critic semantics.
- [ ] Maintain a checked-in corpus-to-boundary matrix covering every shared row.
  File-backed desktop E2E must include at least: all five canonical forms;
  nested and block-spanning forms; malformed recovery; BOM+CRLF+astral text;
  repeated table cells with escaped pipes; front matter; and hostile cross-
  block payloads. Every other row names its equivalent parser, state, static,
  clipboard, persistence, or artifact proof—no uncited “representative” set.

**Gate:** the losslessness, consumer-parity, sink-policy, security, file-backed
desktop, source-handoff, autosave, and export-artifact suites are green.

## Wave 6 — Make the Marked fork reproducible and reviewable

- [ ] Finalize and track the complete `packages/marked` fork, including source,
  license, upstream identity, package metadata, canonical patch, manifest, and
  verifier.
- [ ] Regenerate the canonical patch and manifest from the pinned upstream
  commit so reverse/reapply produces byte-exact trees.
- [ ] Verify the fork offline and run its negative controls for unrecorded
  source, version, manifest, patch, and consumer-wiring drift.
- [ ] Prove Muya resolves `marked` through `workspace:*`, the lockfile points to
  `packages/marked`, and the pinned CommonMark conformance version is exact.
- [ ] Regenerate and validate third-party license attribution for the vendored
  fork.
- [ ] Run the complete CommonMark/GFM ratchet and explain every intentional
  delta caused by the native parser contract.

**Gate:** `node packages/marked/scripts/verify-fork.mjs --self-test`, fork-
contract tests, dependency/lock checks, and CommonMark/GFM conformance pass from
a clean checkout without network access.

## Wave 7 — Prove the production artifact and close the branch

- [ ] Run all gates sequentially under background scheduling: Muya unit,
  spec/conformance, real-DOM/E2E, lint, CSS lint, typecheck, circular checks;
  desktop unit/E2E, lint, typecheck; fork verification; and unpacked/package
  build.
- [ ] Build freshly before desktop E2E. Reject stale bundles deterministically.
- [ ] Produce the native distributable for the current platform, install or
  mount it in an isolated test location, and run the smoke workflow against
  that packaged artifact rather than only `build:unpack` output.
- [ ] Run one hidden, low-priority, one-worker desktop workflow with no Dock/
  focus/window takeover and capture main and renderer errors.
- [ ] In the real artifact, open the named Wave 5 file-backed corpus rows;
  inspect every item; author all five forms; enable Track Changes; exercise inline and
  structural edits; navigate and resolve individual/all items; toggle all
  projections; copy/cut/paste/search; source-edit; autosave/save/reopen; undo/
  redo; and export HTML/PDF/print.
- [ ] On a recorded CI/dogfood machine, open the 4,096-line no-opener fixture in
  at most 5 seconds and complete five projection toggles, next/previous actions,
  and sidebar refreshes with a p95 below 500 ms. Pair this artifact budget with
  Wave 2's deterministic law that doubling input performs at most 2.25× the
  measured parser/adapter work; investigate rather than average away outliers.
- [ ] Prove the accessibility tree, keyboard traversal/actions, focus return,
  and rejection live announcement in automation, then complete one packaged-
  app assistive-technology walkthrough using VoiceOver on macOS or NVDA on
  Windows and retain the checklist/result.
- [ ] Run named supported-platform jobs: macOS arm64 build plus Review menu/
  keybinding tests, Windows x64 build plus Windows menu/keybinding tests, and
  Linux x64 build plus Linux menu/keybinding tests.
- [ ] Produce and inspect an actual PDF file. For printing, capture the final
  sanitized print document and print options with the deterministic hidden-test
  adapter, then complete one user-owned packaged-app Print-to-PDF smoke step;
  automated tests may not open a foreground native print dialog.
- [ ] Immediately before the final gate, fetch `upstream` and `origin`; require
  local `develop`, `origin/develop`, and `upstream/develop` to name the same
  commit. If upstream advanced, fast-forward local `develop` to it, push that
  exact commit to the fork's `origin/develop`, merge `develop` forward into
  this branch without rebasing, and rerun every gate.
- [ ] Audit the whole branch versus the merge base, including every untracked
  file. Remove generated artifacts and unrelated changes; preserve the user's
  `.vscode/settings.json` customization unstaged.
- [ ] Update README/user documentation/release notes only after artifact proof:
  five forms, Track Changes, projections, Accept/Reject/Remove, source/save/
  autosave, copy/export policy, interoperability limits, and the explicit
  concurrency non-goal.
- [ ] Obtain an independent, fresh, whole-branch thermonuclear review with an
  **APPROVE** verdict and zero validated findings. Do not seed the reviewer with
  old scores or claim closure from an incremental rescore.

**Gate:** every command reaches a clean pass, the hidden freshly built app
completes the workflow with zero captured errors, cross-platform checks pass,
documentation matches proven behavior, and the fresh review approves.

## Consolidated traceability

| Superseded obligation | Disposition in this plan |
| --- | --- |
| 0003 Phases 0–2: grammar, transforms, native parsing/rendering/serialization | Implemented; permanent parser/corpus/conformance tests remain in Waves 1, 5, and 7 |
| 0003 Phase 3: Track Changes and complete edit-boundary matrix | Wave 3 |
| 0003 Phase 4: MarkText Review UI, contextual controls, toolbar/preferences ambiguity, localization | Wave 4; existing menu/sidebar/contextual tool retained only if the packaged-app reachability walkthrough receives explicit user acceptance; otherwise implement the surviving controls |
| 0003 Phase 5: persistence, export, performance, accessibility, docs, packaged-app proof | Waves 2, 4, 5, and 7 |
| 0004 TN-01/TN-06/TN-07: one pipeline/context/mapped-source model | Waves 1 and 2 |
| 0004 TN-02/TN-03/TN-04: exact mutation gateway and atomic rollback | Wave 3 |
| 0004 TN-05: validated excluded ranges and progress | Implemented; retained as permanent Wave 7 fitness coverage |
| 0004 TN-08–TN-12: Review protocol, commands, background policy, contextual tool, semantics/a11y | Existing architecture retained; remaining correctness and proof in Waves 4 and 7 |
| 0004 incidental cleanup and final fresh review | Waves 2 and 7 |
| 0005 MH-01/MH-02/MH-04/MH-05/MH-06/MH-07/MH-08 | Implemented architecture retained; reverified through Waves 1–3, 5, and 7 rather than recreated |
| 0005 MH-03: one all-fragments pipeline | Wave 1 |
| 0005 MH-09/MH-10/MH-11: losslessness, consumer parity, sinks/security | Wave 5 and real-artifact Wave 7 |
| 0005 MH-12: bounded final pipeline | Wave 2 and real-artifact Wave 7 |
| 0005 permanent fitness checks and complete release gate | Every wave's gate plus Wave 7 |

## Completion criteria

This plan is complete only when all of the following are true:

- [ ] Every PR-01 through PR-10 blocker is closed with red-green evidence.
- [ ] Every fragment-bearing CriticMarkup consumer uses the exact parser-owned
  binding artifact; no generic topology inference or optional provenance
  remains.
- [ ] Every supported edit satisfies both projection invariants, atomic
  history/rollback, and visible fail-closed behavior.
- [ ] Valid, malformed, literal-context, Unicode, nested, block-spanning, and
  adversarial documents are lossless and bounded at every affected consumer.
- [ ] The vendored Marked fork is complete, tracked, reproducible, and passes
  conformance.
- [ ] All focused and full gates pass sequentially from the final tree.
- [ ] A freshly built hidden desktop application and the installed/mounted
  native distributable prove the end-to-end workflow with no captured error
  and no foreground takeover during automation.
- [ ] Keyboard and screen-reader operation and supported-platform integration
  are proven.
- [ ] User-facing documentation describes only behavior verified in the
  artifact.
- [ ] A fresh whole-branch thermonuclear review returns **APPROVE** with zero
  validated findings.

After completion, distill any newly discovered lasting truth into
`specs/architecture/`, move this plan to `specs/plans/archive/`, and begin the
external-file concurrency effort as a separately numbered plan.

## Background-safe verification commands

The commands below are the exhaustive macOS-local gate. Run one at a time,
never in parallel. Windows and Linux execute the equivalent named Wave 7 CI
jobs without `taskpolicy`.

```bash
taskpolicy -b /usr/bin/nice -n 20 pnpm -C packages/muya exec vitest run <focused-test> --pool=threads --maxWorkers=1 --no-file-parallelism
taskpolicy -b /usr/bin/nice -n 20 pnpm -C packages/muya exec vitest run --pool=threads --maxWorkers=1 --no-file-parallelism
taskpolicy -b /usr/bin/nice -n 20 pnpm -C packages/muya exec vitest run --config vitest.spec.config.ts --pool=threads --maxWorkers=1 --no-file-parallelism
taskpolicy -b /usr/bin/nice -n 20 pnpm -C packages/muya/e2e e2e:chromium
taskpolicy -b /usr/bin/nice -n 20 pnpm -C packages/muya lint
taskpolicy -b /usr/bin/nice -n 20 pnpm -C packages/muya lint:css
taskpolicy -b /usr/bin/nice -n 20 pnpm -C packages/muya lint:types
taskpolicy -b /usr/bin/nice -n 20 pnpm -C packages/muya check-circular
taskpolicy -b /usr/bin/nice -n 20 node packages/marked/scripts/verify-fork.mjs --self-test
taskpolicy -b /usr/bin/nice -n 20 pnpm -C packages/muya exec vitest run src/utils/marked/__tests__/markedForkContract.spec.ts --pool=threads --maxWorkers=1 --no-file-parallelism
taskpolicy -b /usr/bin/nice -n 20 pnpm run gen-third-party
taskpolicy -b /usr/bin/nice -n 20 pnpm run validate-licenses
taskpolicy -b /usr/bin/nice -n 20 pnpm --filter marktext exec vitest run test/unit --pool=threads --maxWorkers=1 --no-file-parallelism
MARKTEXT_TEST_BACKGROUND=1 taskpolicy -b /usr/bin/nice -n 20 pnpm run test:e2e
taskpolicy -b /usr/bin/nice -n 20 pnpm run lint
taskpolicy -b /usr/bin/nice -n 20 pnpm run typecheck
taskpolicy -b /usr/bin/nice -n 20 pnpm run build:unpack
taskpolicy -b /usr/bin/nice -n 20 pnpm run build:mac:arm64
```

If a command may exceed 30 seconds, log and poll it with observable progress.
An interrupted, timed-out, or stale-build run is inconclusive, never a pass.
