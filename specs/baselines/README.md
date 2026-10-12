# CriticMarkup integration baselines

This directory contains generated observations about the recorded upstream MarkText baseline. A
baseline is an oracle input, not a product specification.

`criticmarkup-representative-documents.json` pins the checked-in corpus used for performance and
Shadow comparisons. Its hashes make fixture drift explicit, while its coverage labels require the
selected set to include plain and long prose, tables, code, Unicode, math, diagrams, images, and
dense CriticMarkup. The manifest is reproducible evidence, not product-owner ratification.

`criticmarkup-interaction-matrix.json` is the finite, human-authored release-risk denominator for
CriticMarkup interactions. Its 25 rows cross all five forms with paragraph, block-boundary,
literal, reference/footnote, and nested-Comment contexts. Each row records its exact fixture,
expected product behavior, named production oracle, and current evidence status. The desktop unit
suite validates its structure and pairwise completeness; the document-core and installed Review
specs execute its rows. Nothing generates its expected results.

`criticmarkup-performance-targets.json` freezes the proposed measurement protocol and candidate
p95 thresholds on the recorded reference host. It pins that host's hardware, architecture, and
build kind but no OS version: producers record the measured macOS version in each raw run as
evidence, and it never gates a run. Its status remains `proposed-unratified` until the
upstream shell and Core candidates have been measured under that protocol and the owner approves
the targets; numeric proposals are not evidence that either implementation meets them.

Its `calibration` record follows the owner decision of 2026-10-06, which replaced
the validity rule of 2026-10-04: performance gates measure the machine's natural idle state. Every
warm session, ours and upstream's, times a fixed loop after each measured key and records the
loop's p50 and p90 beside its results. Installed-core and upstream raw runs open a fresh
application for each one-key observation, so each observation probes the same loop eight times,
40 ms apart, right after its key, and records it per document. The loop is information only. It
never makes a run invalid, never reruns it and never leaves it inconclusive: every run is scored
against the unchanged thresholds, for our build and upstream alike. The pinned fast-state
reference (1.20 ms on the reference host) is kept as context. A quiet Mac clocks its CPU down
for bursty work, so its idle loop reads slower than with another core busy. Runs still require
AC power, an open lid, nice 0 and a 1-minute load below 6.

`criticmarkup-performance-measurements.json` pins four common product-boundary timings for both
implementations and three additional authority timings for Core. The current `awaiting-raw-runs`
record is intentionally empty:
it documents that neither an upstream-baseline nor Core-candidate measurement run has been checked
in. Raw evidence belongs under `runs/performance/`; validators reject absent files, stale digests,
wrong environments or documents, incomplete sample counts, and impossible timing order.

Validate the performance evidence record, then exercise its separate ratification prerequisite:

```bash
node_modules/.bin/tsx scripts/criticmarkupPerformanceMeasurements.ts --validate
node_modules/.bin/tsx scripts/criticmarkupPerformanceMeasurements.ts --require-ratification-evidence
```

The first command accepts the honest empty record. The second is expected to fail until both pinned
raw run roles are complete; once complete, it derives nearest-rank p95 rows per run, document, and
metric against the proposed targets. Schema validity alone cannot approve the numeric targets.
