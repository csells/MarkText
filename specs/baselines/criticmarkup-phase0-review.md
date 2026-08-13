# CriticMarkup Phase 0 owner review packet

> **Status:** Prepared for review; no owner decision or ratification is recorded.
>
> **Evidence commit:** `177a13f24fe5e5c265dcef468f71988186d1f85e`
>
> **Upstream baseline:** `43bd8b77795fb27b1a9512737c000f7362031ea0`

## Current stop condition

Performance-target ratification is not ready. The checked-in measurement manifest intentionally
contains no raw runs. The evidence gate currently requires both:

- an `upstream-baseline` production-bundle run at the pinned upstream commit; and
- a `core-candidate` production-bundle run at a recorded 40-character build commit.

Each run must cover all five representative documents with 20 warmup and 200 measured samples per
document for `t_dispatch`, `t_ack`, `t_reconcile`, `open`, and `first_viewport`. The raw JSON must
record the exact proposed hardware, OS, build, timestamp, document hashes, and ordered timing data,
and must be checked in under `specs/baselines/runs/performance/` with a matching SHA-256 reference.

The following command is expected to fail until that evidence exists:

```bash
node_modules/.bin/tsx scripts/criticmarkupPerformanceMeasurements.ts --require-ratification-evidence
```

No numbers in the target manifest are measurements. Current proposed p95 limits are:

| Metric | Proposed p95 |
| --- | ---: |
| `t_dispatch` | 8 ms |
| `t_ack` | 50 ms |
| `t_reconcile` | 50 ms |
| `open` | 500 ms |
| `first_viewport` | 1,500 ms |

## Decisions after raw measurements are checked in

For the performance decision, the owner must record all of the following explicitly:

1. Whether the upstream and Core run provenance, environment, document coverage, sample counts, and
   raw distributions are acceptable evidence under the proposed protocol.
2. Whether to ratify the five numeric p95 limits unchanged or amend them with an evidence-based
   rationale. A slower Core result is not, by itself, a reason to relax a target.
3. Whether the Core candidate satisfies the ratified targets. A miss remains an authority-feasibility
   blocker rather than an approval to redefine the baseline.

The performance decision does not approve the rest of Phase 0. The owner must also decide:

4. **Working baseline:** approve the pinned upstream commit for this interval or require the planned
   pre-PR rebase and denominator regeneration first.
5. **Upstream oracle run:** accept the recorded run with its explicit Muya toolbar failure, teardown
   hang, and reproduced Electron burst-input loss, or require a replacement run.
6. **Parity manifest:** approve or amend the proposal covering all 829 items: 392 byte-identical
   retained upstream test files that still need a current passing run, four retained manual cases
   that still need supported-platform execution, 367 items needing a new or explicitly equivalent
   production-path oracle, 66 proposed compatibility decisions, and zero proposed `unaffected`
   items.
7. **Language profile and ADRs:** ratify, amend, or supersede Profile 1 and the pinned CriticMarkup and
   parser ADR set after reviewing semantic rules separately from implementation machinery.
8. **Interaction matrix:** approve or amend the 25 expected product behaviors. The current evidence
   map has 21 partial production seams, four rows with no named production oracle, and zero green
   installed executions. A table-driven installed oracle now exercises all 20 resolve, save/reopen,
   Source round-trip, and render rows, but no stable-commit execution record is pinned. Completion
   requires closing the five author gaps and recording a passing installed run for all 25. The
   `comment.reference-footnote.resolve` fixture now follows Profile definition precedence by placing
   its Comment closer on a separate line and is covered at the public engine seam; its installed
   Review oracle is included in the table-driven installed suite.
9. **Representative documents:** approve or amend the five hash-pinned documents and coverage labels.
10. **Salvage inventory:** approve or amend all 2,941 content-lineage proposals: 41 exact imports,
    97 adaptations, and 2,803 rejections. The mechanical Git relation does not establish semantic
    equivalence.

## Mechanical checks before review

```bash
node_modules/.bin/tsx scripts/criticmarkupPhase0Review.ts --validate-proposal
node_modules/.bin/tsx scripts/criticmarkupPerformanceMeasurements.ts --validate
node_modules/.bin/tsx scripts/criticmarkupPhase0Review.ts --require-approval
```

The first two commands must pass. The final command must continue to fail with eight pending owner
decisions until the review is complete and the approved artifacts contain the owner's identity,
timestamp, and rationale.
