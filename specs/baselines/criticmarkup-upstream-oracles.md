# Upstream MarkText test and latency baseline

This is the Phase 0 oracle map for upstream commit
`43bd8b77795fb27b1a9512737c000f7362031ea0`. It distinguishes tests that exist from evidence the
integration still has to create.

## Runnable upstream suites

| Surface | Command | What it establishes |
| --- | --- | --- |
| Muya unit tests | `pnpm -C packages/muya test` | Editor model, parsing, editing, clipboard, presentation helpers, and plugin behavior. |
| Muya specification tests | `pnpm -C packages/muya test:spec` | The package's Markdown specification cases. |
| Desktop unit tests | `pnpm -C packages/desktop test:unit` | Renderer/main integration, preferences, file lifecycle, commands, and component behavior. |
| Muya browser tests | `pnpm -C packages/muya/e2e exec playwright test --project=chromium` | Browser editing and plugin behavior through the Muya host. |
| Desktop build | `pnpm build` | The normal desktop production bundle compiles. |
| Desktop Electron tests | `pnpm test:e2e` | The built project runs in Electron and exercises the application shell. |

The root `pnpm test` command covers the desktop package only; it is not a monorepo test command.
Focused commands may speed iteration, but the Phase 0 result must retain the complete suite outcome.

## What upstream does not establish

- There is no typing-to-paint or input-to-authoritative-acknowledgement benchmark. The existing Muya
  performance smoke times `setContent` for a 10,000-paragraph document; it does not measure typing.
- Browser helpers commonly type with a 30 ms delay. That is useful for deterministic correctness but
  can hide burst-input queueing and dropped-event problems.
- Desktop E2E launches the repository's Electron dependency against the built project root. It does
  not launch an installed artifact.
- `build:unpack` runs the Electron/Vite build; its name is not evidence of a packaged or installed
  application smoke.
- Four OS-integration paths remain manual upstream: local-file image drop, web-image drop, browser
  bitmap paste, and the macOS screenshot flow.

These are missing oracles, not permission to lower the compatibility bar. Plan 0010 adds a
production-path latency harness and packaged/installed smoke instead of treating the existing tests
as proof they do not provide.

## Phase 1A latency trace

The spike records these timestamps and counters for each input transaction:

- captured browser input (`t_event`);
- speculative visible echo (`t_echo`);
- dispatch to the engine (`t_dispatch`);
- authoritative acknowledgement (`t_ack`);
- reconciliation complete (`t_reconcile`);
- one Electron `WebContents.capturePage` call with `stayHidden` and `stayAwake` after the exact acknowledged view checkpoint while the exact macOS measurement window is render-active but opacity-zero, nonfocusable, noninteractive, inactive, and not frontmost, followed immediately by retained-state validation (`t_present`); this is a captured compositor-surface upper bound, while the post-capture checkpoint proves only that view state was retained—not screenshot pixel equality, physical display, vsync, or next-frame time;
- pending-input depth, correction count, and source/view checksums.

Comparable upstream and Core distributions use lifecycle
`fresh-application-profile-per-observation-v1`. Each of the five documents receives 20 warmup and
200 measured observations, and every observation runs in one newly launched application with one
fresh profile that is closed and deleted before the next launch. A complete run therefore records
exactly 1,100 application launches, 1,100 unique profiles, 1,100 application closes, and 1,100
successful profile cleanups. Application launch, editor bootstrap, application close, and profile
cleanup are excluded from every metric; pooled process, browser-context, or profile runs are not
admissible evidence.

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
CGWindow row provides explicit on-screen proof. Explicit `onScreen: false` and every other native
or Electron mismatch remain strict and fail immediately. Post-measurement validation remains
one-shot strict; null `onScreen` metadata remains strict and fails immediately. Cleanup reverses the
workspace policy with `setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: false,
skipTransformProcessType: true })` before restoring window state. Application launch and readiness
are excluded from every timed metric; the measurement window remains unfocused and not
always-on-top, with no retries of a measurement or its post-measurement validation.

The minimum scenario set is ordinary prose typing, a burst with no artificial delay, IME composition,
an edit in dense CriticMarkup, an edit near a large table or structured block, and undo immediately
after input. Open and first-editable-viewport timing use the representative documents selected in
plan 0010.

Numeric acknowledgement and open targets remain intentionally unset until the upstream shell and
the two bounded Phase 1A candidates have been measured on the same recorded hardware. The
ordinary-input exact DOM-echo criterion is fixed. The transparent render-active compositor-surface
capture target remains calibration-required until comparable upstream and Core distributions support
a frozen positive p95 target; it does not claim physical visibility. Sustained queue growth and
routine corrective paint remain disallowed.

## Execution record

Suite results, machine details, and latency distributions belong in dated run artifacts rather than
in this document. This file changes only when the oracle set or measurement method changes.
