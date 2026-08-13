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
expected product behavior, planned production oracle, and current evidence status; the validator
checks structure and completeness but never generates expected results.

`criticmarkup-performance-targets.json` freezes the proposed measurement protocol and candidate
p95 thresholds on the recorded reference host. Its status remains `proposed-unratified` until the
upstream shell and Core candidates have been measured under that protocol and the owner approves
the targets; numeric proposals are not evidence that either implementation meets them.

`criticmarkup-parity-rows.json` is the human-owned parity-row manifest. A `parity-row` disposition
references a row by ID; validation fails when that row does not exist. The generator never creates
rows or dispositions.

`criticmarkup-salvage-candidates.json` is the generated, Git-object-backed inventory of every
snapshot/path change from the recorded upstream base to the native and research snapshots. Its
human-owned companion, `criticmarkup-salvage-dispositions.json`, must partition every candidate
exactly once as import, adapt, supersede, or reject. The generator never writes decisions.

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
