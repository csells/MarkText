# CriticMarkup salvage inventory

This inventory records what the integration branch will carry forward from the two CriticMarkup
implementation snapshots. It is an implementation baseline for plan 0010, not a new product or
language specification.

## Lineage

- The native snapshot is `feat/native-criticmarkup` at
  `9a5b6d8e0d8dcd1131f07eb1a8a2cf621ccd7d28`.
- The engine-research snapshot is tag `criticmarkup-engine-research-2026-08-10` at
  `37ea7e842fb16dfb8ee9fd0c0d0ac07f3e3626b9`.
- The native snapshot is an ancestor of the research snapshot. They are stages of one line of work,
  not independent implementations.
- Commit `4a08c5e269c4c7dd519635a650e367053cf48cad` replaced Muya and the editor path wholesale. It is the
  boundary between the reusable native integration and the replacement architecture we are not
  adopting as the product base.

Paths below refer to the named snapshot unless they also exist on this integration branch.

## Import unchanged

| Asset | Snapshot and path | Why it survives |
| --- | --- | --- |
| Package boundary | research: `packages/document-core/{package.json,boundary-policy.json,src/index.ts}` | A bounded, renderer-safe core package is the right ownership seam. Its public exports will be reduced before consumers depend on it. |
| External Markdown fixtures | research: `packages/document-core/test/fixtures/commonmark-*.json`, `gfm-*.json` | These are independent conformance inputs rather than implementation-generated expected results. Provenance and licenses must remain with them. |
| Exact source edit helper | research: `packages/document-core/src/exactSourceEdits.ts` | Source-splice behavior is useful without importing the old session, wire, or persistence protocols. |
| Review vocabulary and localization | research: `packages/desktop/src/common/commands/review.ts`, Review locale entries | The user-facing commands remain part of the target UX. Import only entries that still match plan 0010 terminology. |
| Installed-app fixture mechanics | research: `packages/desktop/test/e2e/installedDocumentCoreE2e.ts`, `installedArtifactProvenance.ts` | The launch and fixture techniques fill an upstream oracle gap. Assertions must be rewritten against the restored MarkText shell. |

“Import unchanged” means the asset's intent and data survive. Normal path, build, and naming edits are
still expected on this branch.

## Adapt behind the new core facade

| Asset | Snapshot and path | Required adaptation |
| --- | --- | --- |
| Profile 1 parser kernel | research: `packages/document-core/src/internal/profile1/**`, `profile1Document.ts`, `languageEngine.ts` | Expose a small open, project, map, and edit surface. Remove public hash, syntax-accounting, resource-profile, pass-count, and forensic trace contracts. Verify semantics independently before treating old fixtures as truth. |
| Transformations and maps | research: `transformationKernel.ts`, `markupCoordinateMap.ts`, relevant `test/transformation-kernel/**` and `test/coordinate-map/**` | Keep exact source edits, accept/reject, Track Changes, and source/view mappings. Detach them from wire envelopes, journal identity, and fixed resource mechanics. |
| Semantic tests and corpora | research: parser, projection, recovery, transformation, mapping, and exact-source tests under `packages/document-core/test/**` | Port tests that assert observable language or editing behavior. Reclassify implementation-mechanics tests; do not copy plan-0009 certification tests. |
| Native Muya authority seam | native: the document-core integration in `packages/muya/**` and `packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue` | Restore it only as a session-wide Shadow/Core gateway. Eliminate per-read or per-operation choice of authority. Keep upstream Muya authoritative until the Core path passes its parity rows. |
| Review UI shell | native: Review sidebar, store, controller, comment composer, menus, and commands | Restore on top of the upstream shell, then port later accessibility, draft-preservation, navigation, and interaction fixes through a narrow editor port. Do not couple Vue components to the discarded session protocol. |
| Production-path Review tests | native plus research: `packages/desktop/test/{unit,e2e}/**critic*`, `**review*`, and the installed CriticMarkup flows | Retain observable assertions and selectors that still express plan 0010. Rebuild setup around the upstream editor and the new facade. |
| Presentation behavior | native Muya CM rendering and later research Review presentation | Preserve proven UI behavior while switching its data source to core-issued nodes and mappings. Presentation plugins do not become source authorities. |

## Supersede

| Asset | Replacement |
| --- | --- |
| Native sidecar CriticMarkup scan and the modified `marked` path | One Markdown+CriticMarkup parse in `document-core`, with upstream rendering used only in Shadow comparison. |
| Native per-flow authority selection | One authority mode for an entire document session, as required by ADR 0005 and plan 0010. |
| Research `document-view` editor replacement | The upstream MarkText/Muya shell plus a bounded core adapter. A replacement may be reconsidered only after the Phase 1A measured spike. |
| Research main-process, per-keystroke session route | A renderer-reachable engine actor; main remains responsible for file and process effects without joining the synchronous typing path. |
| Hash, wire, checkpoint, journal, resource-profile, and syntax-accounting protocols | Private implementation choices made only when a measured requirement needs them. Observable atomicity, bounded failure, exact source, and incremental/full equivalence remain requirements. |
| Plan-0009 mutation, closure, evidence, and archive-absence tests | Ordinary language, parity, performance, security, and installed-product tests referenced by plan 0010. |

## Reject

- Cherry-picking the wholesale replacement commit `4a08c5e2` or either snapshot as a unit.
- Retaining two durable document models and choosing whichever result succeeds.
- Parser-generated expectations as the sole correctness oracle.
- A synchronous main-process round trip before typed text can appear.
- Reintroducing release evidence formats as engine APIs or language semantics.

## Extraction order

1. Establish the package shell and external conformance fixtures on the upstream branch.
2. Port the parser behind the reduced facade and run independent CommonMark, GFM, and CriticMarkup
   checks.
3. Port exact transformations and source/view mapping without the discarded transport machinery.
4. Restore the corrected session-wide Shadow seam in Muya and measure it.
5. Port the Review UI and its production-path tests through the editor port.
6. Restore installed-app flows and grow parity adapters one upstream behavior at a time.
7. Use the Phase 1A measurements to decide whether any part of `document-view` deserves a new,
   narrowly scoped implementation.

This order is deliberately not a commit order. Each step should select files or behavior, not inherit
the surrounding architecture by ancestry.
