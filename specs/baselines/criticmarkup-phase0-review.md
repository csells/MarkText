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
document for the common `t_echo`, `t_present`, `open`, and `first_viewport` metrics; Core additionally
records `t_dispatch`, `t_ack`, and `t_reconcile`. `t_present` ends at one Electron
`WebContents.capturePage` call with `stayHidden` and `stayAwake` while the exact macOS measurement
window is render-active but opacity-zero, nonfocusable, noninteractive, inactive, and not frontmost,
followed by retained-state validation. It is a captured compositor-surface upper bound—not screenshot pixel equality, physical
display, vsync, or next-frame evidence—and its p95 target remains calibration-required. The raw JSON
must record the exact proposed hardware, OS, build, timestamp, document hashes, and ordered timing
data, and must be checked in under `specs/baselines/runs/performance/` with a matching SHA-256
reference.

Every one of those 1,100 observations per run must use lifecycle
`fresh-application-profile-per-observation-v1`: one fresh application process and one unique profile
for exactly one warmup or measured observation, followed by an application close and successful
profile deletion before the next observation. Each raw run must therefore authenticate exactly
1,100 application launches, unique profiles, application closes, and profile cleanups. Launch,
editor bootstrap, application close, and profile cleanup are excluded protocol overhead outside all
timed metrics. Evidence from a pooled application, browser context, or profile is rejected.

Observation order is `warmup-then-measured-rotating-round-robin-v1`: all warmup rounds run before
all measured rounds; each representative document runs exactly once per round, and the first
document rotates by one position continuously across rounds and across the phase boundary. This
deterministic rotating round-robin limits fixed document/time-order confounding but does not
eliminate temporal, thermal, cache, hardware, or environment drift. Mandatory time-ordered drift
diagnostics are required for every document and metric. No drift pass/fail threshold is defined
before owner review and ratification; the protocol does not invent one.

The authenticated launcher starts runner-owned `caffeinate -d` display-sleep prevention before
package build and holds the exact process through sampling and cleanup; it neither synthesizes user
input nor focuses MarkText. The raw run records
`runner-owned-caffeinate-display-sleep-prevention-v1`, and cleanup waits for that owned process to
exit.

Before pre-timing readiness, Electron calls `setVisibleOnAllWorkspaces(true, {
visibleOnFullScreen: true, skipTransformProcessType: true })`; readiness asserts
`isVisibleOnAllWorkspaces() === true` and `isHiddenInMissionControl() === true`. Pre-timing readiness
requires two consecutive exact Electron and CGWindow matches within a bounded 5 seconds. During
pre-timing readiness only, a transient origin mismatch or missing optional `onScreen` metadata on
the otherwise exact CGWindow row may settle, but readiness cannot complete until the external
CGWindow row provides explicit on-screen proof. Explicit `onScreen: false`, any identity or other
native-state mismatch, and any Electron-state or display-topology mismatch remain strict and fail
immediately. Post-measurement validation remains one-shot strict; null `onScreen` metadata remains
strict and fails immediately. Cleanup reverses the workspace policy with
`setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: false, skipTransformProcessType: true })`
before restoring window state. Application launch and readiness are excluded from every timed
metric; the measurement window remains unfocused and not always-on-top, with no retries of a
measurement or its post-measurement validation.

After both canonical raw JSON files are copied under `specs/baselines/runs/performance/`, generate
the deterministic `measured-unratified` manifest candidate without writing the current manifest:

```bash
node_modules/.bin/tsx scripts/criticmarkupPerformanceMeasurements.ts \
  --materialize-measurements \
  specs/baselines/runs/performance/<upstream-raw>.json \
  specs/baselines/runs/performance/<core-raw>.json \
  > /tmp/criticmarkup-performance-measurements.json
```

Review and apply that exact candidate to
`specs/baselines/criticmarkup-performance-measurements.json`, then write the calibration report
create-only:

```bash
node_modules/.bin/tsx scripts/criticmarkupPerformanceMeasurements.ts \
  --write-calibration \
  specs/baselines/runs/performance/<calibration-report>.json
```

The checked-in calibration report is a required ratification artifact. Add it to Phase 0 evidence as
`performance-calibration`, pin its canonical repository-relative path and full SHA-256, and include
that evidence ID in the performance decision. The gate exact-recomputes the report from the
validated raw runs; a report whose bytes differ is rejected even when its own digest is current.
After the owner freezes a positive `t_present` target, require the same checked-in calibration report
explicitly:

```bash
node_modules/.bin/tsx scripts/criticmarkupPerformanceMeasurements.ts \
  --require-ratification-evidence \
  specs/baselines/runs/performance/<calibration-report>.json \
  <calibration-report-sha256>
```

That final command is expected to fail while the manifest is `awaiting-raw-runs`, while
`t_present` remains calibration-required, or while Phase 0 lacks the authenticated report reference.

No numbers in the target manifest are measurements. Current proposed p95 limits are:

| Metric | Proposed p95 |
| --- | ---: |
| `t_echo` | 16.7 ms |
| `t_dispatch` | 8 ms |
| `t_ack` | 50 ms |
| `t_reconcile` | 50 ms |
| `t_present` | Calibration required |
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
   items. Mechanical production-path evidence names 364 of those 367 active surfaces. The remaining
   three now have narrowly item-level compatibility-decision proposals tied to this still-pending
   `parity-manifest` decision, without inventing tests or approval:
   `readme-feature:ada27f4ce6a3` has already-proved objective WYSIWYG behavior, while its
   clean/simple/distraction-free outcome is subjective and nonmechanical;
   `readme-feature:0b8caa1ea286` has all 87 declared shortcuts mechanically proved, while the claimed
   writing-efficiency outcome is subjective and nonmechanical; and
   `muya-readme-feature:57b5c6a23c6a` has a JSON/OT state model but no shipped collaborative
   transport, so including transport in scope requires an owner decision. Ratification would yield
   69 compatibility decisions and 760 planned parity rows. Until then, all eight owner decisions
   remain pending and the final parity overlays remain empty and red.
7. **Language profile and ADRs:** ratify, amend, or supersede Profile 1 and the pinned CriticMarkup and
   parser ADR set after reviewing semantic rules separately from implementation machinery.
8. **Interaction matrix:** approve or amend the 25 expected product behaviors. The current evidence
   map has 25 green installed executions and no rows without a named production oracle. A
   table-driven installed oracle exercised all 25 rows through visible controls and exact
   source/history/save/reopen checks at stable build commit
   `addd76f29ac28b0efc13db33868b1f62dd0f9724`; the exact unique passing row IDs and run provenance
   are preserved in a SHA-256-pinned execution record. That mechanical evidence does not ratify the
   expected product behaviors. The Comment author row follows `CONTEXT.md`: Add Comment creates the
   conventional Commented span rather than a Point comment. That still-unratified expected behavior
   remains part of the pending matrix decision. The
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
node_modules/.bin/tsx scripts/criticmarkupInteractionMatrix.ts --require-green
node_modules/.bin/tsx scripts/criticmarkupPhase0Review.ts --require-approval
```

The first three commands must pass. The final command must continue to fail with eight pending
owner decisions until the review is complete and the approved artifacts contain the owner's
identity, timestamp, and rationale.
