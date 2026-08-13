# CriticMarkup integration baselines

This directory contains generated observations about the recorded upstream MarkText baseline. A
baseline is an oracle input, not a product specification.

`criticmarkup-upstream-parity.json` is generated from Git objects at the commit recorded in the
file, so integration-branch additions cannot silently enlarge or shrink the upstream denominator.
It inventories commands, preferences, editor plugins, routes, menu entries, application and Muya
README promises, desktop and Muya tests, disabled tests and commands, backlog items, and manual OS
integration checks.

`criticmarkup-parity-dispositions.json` is the separate, human-owned review overlay. Each generated
item must map to a parity row, an unaffected rationale, or an approved compatibility decision. The
generator never rewrites that file. Keeping observations and decisions separate makes stale review
entries and upstream additions visible instead of silently carrying them forward.

`criticmarkup-representative-documents.json` pins the checked-in corpus used for performance and
Shadow comparisons. Its hashes make fixture drift explicit, while its coverage labels require the
selected set to include plain and long prose, tables, code, Unicode, math, diagrams, images, and
dense CriticMarkup. The manifest is reproducible evidence; product-owner ratification is recorded
separately at the Phase 0 gate.

`criticmarkup-interaction-matrix.json` is the finite, human-authored release-risk denominator for
CriticMarkup interactions. Its 25 rows cross all five forms with paragraph, block-boundary,
literal, reference/footnote, and nested-Comment contexts. Each row records its exact fixture,
expected product behavior, named production oracle, and current evidence status; the validator
checks structure and completeness but never generates expected results.

`criticmarkup-interaction-evidence.json` maps every matrix row to its named production test. Green
requires a named installed E2E oracle, a SHA-256-pinned passing execution record for a full build
commit, and a matching green matrix row. All 25 rows are green against the installed matrix oracle
and share one authenticated stable-commit execution record containing the exact 25 unique passing
row IDs. The matrix and evidence artifacts remain proposed and do not record owner ratification.

```bash
node_modules/.bin/tsx scripts/criticmarkupInteractionMatrix.ts --validate-evidence
node_modules/.bin/tsx scripts/criticmarkupInteractionMatrix.ts --require-green
```

The first command validates the complete evidence disposition; the second requires all 25 exact
interactions to retain installed passing evidence.

On a clean stable commit, the installed runner can create that record after Playwright passes all 25
exact, unique matrix rows. The destination directory must already exist and the JSON path must not:

```bash
MARKTEXT_INTERACTION_RUN_RECORD=specs/baselines/runs/<record-name>.json \
  packages/desktop/test/e2e/run-installed-core-review.sh
```

The runner prints the repository-relative path and SHA-256 pin. Missing, duplicated, non-installed,
or non-passing rows prevent materialization; an existing destination is never overwritten.

`criticmarkup-performance-targets.json` freezes the proposed measurement protocol and candidate
p95 thresholds on the recorded reference host. Its status remains `proposed-unratified` until the
upstream shell and Core candidates have been measured under that protocol and the owner approves
the targets; numeric proposals are not evidence that either implementation meets them.

`criticmarkup-performance-measurements.json` pins four common product-boundary timings for both
implementations and three additional authority timings for Core. The current `awaiting-raw-runs`
record is intentionally empty:
it documents that neither an upstream-baseline nor Core-candidate measurement run has been checked
in. Raw evidence belongs under `runs/performance/`; validators reject absent files, stale digests,
wrong environments or documents, incomplete sample counts, and impossible timing order.

`criticmarkup-parity-rows.json` is the human-owned parity-row manifest. A `parity-row` disposition
references a row by ID; validation fails when that row does not exist. The generator never creates
rows or dispositions.

`criticmarkup-parity-proposal.json` is an unapproved preparation aid for that human review. It
partitions the complete generated denominator by source kind, records the proposed disposition,
and pins each selected item set by count and SHA-256 digest. It does not populate or replace the
human-owned disposition and row files.

`criticmarkup-parity-oracle-proposal.json` adds a separate Git-backed evidence classification. It
distinguishes byte-identical retained test sources from changed tests, manual definitions, surfaces
that still require a production-path test, and known gaps requiring an owner decision. Retention is
not execution evidence, and the manifest deliberately proposes no item as `unaffected`.

`criticmarkup-salvage-candidates.json` is the generated, Git-object-backed inventory of every
snapshot/path change from the recorded upstream base to the native and research snapshots. Its
human-owned companion, `criticmarkup-salvage-dispositions.json`, must partition every candidate
exactly once as import, adapt, supersede, or reject. The generator never writes decisions.

`criticmarkup-salvage-proposal.json` partitions the same denominator by snapshot change and its
exact Git-object relation to the pinned evidence commit. Exact snapshot objects are proposed for
import, objects unchanged from upstream for rejection, and divergent objects for adaptation. This
is content-lineage evidence only: it does not assert semantic equivalence or owner acceptance.

`criticmarkup-phase0-approval.json` pins the complete review packet by file digest and names the
eight explicit decisions still owned by the product owner. Its `proposed-unapproved` status and
`pending-owner-decision` rows are intentional. Agents and structural validators must not turn
mechanical completeness into ratification.

Regenerate it at an explicit upstream rebase checkpoint:

```bash
pnpm criticmarkup:parity -- --write <upstream-commit>
```

Check that the committed inventory still matches that Git commit:

```bash
pnpm criticmarkup:parity:check
```

`pnpm criticmarkup:parity:validate` also requires every item to have a `parity-row`, `unaffected`,
or `approved-decision` disposition, with a supporting reference or rationale. It is expected to
fail while Phase 0 review is incomplete.

Generate the salvage denominator only at an explicit snapshot checkpoint:

```bash
pnpm criticmarkup:salvage -- --write <upstream-commit> <native-commit> <research-commit>
```

`pnpm criticmarkup:salvage:check` detects drift in the generated inventory.
`pnpm criticmarkup:salvage:validate` also requires a complete human disposition partition and is
expected to fail while the Phase 0 salvage review is incomplete.

Validate the mechanically complete, explicitly unapproved review packet with:

```bash
node_modules/.bin/tsx scripts/criticmarkupPhase0Review.ts --validate-proposal
```

The approval gate is separate and is expected to fail until every recorded owner decision is made:

```bash
node_modules/.bin/tsx scripts/criticmarkupPhase0Review.ts --require-approval
```

Validate the performance evidence record, then exercise its separate ratification prerequisite:

```bash
node_modules/.bin/tsx scripts/criticmarkupPerformanceMeasurements.ts --validate
node_modules/.bin/tsx scripts/criticmarkupPerformanceMeasurements.ts --require-ratification-evidence
```

The first command accepts the honest empty record. The second is expected to fail until both pinned
raw run roles are complete; once complete, it derives nearest-rank p95 rows per run, document, and
metric against the proposed targets. Schema validity alone cannot approve the numeric targets.

The same script exports a pure `materializeCriticMarkupPhase0Dispositions` function for the eventual
approved transition. It refuses the pending packet before deriving output, performs no file writes,
and returns item-level parity dispositions, planned parity rows, and salvage assets in the existing
final-overlay schemas only after every approval row is explicit and the packet status is `ratified`.
