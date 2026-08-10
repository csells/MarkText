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
- the next rendered frame (`t_frame`);
- pending-input depth, correction count, and source/view checksums.

The minimum scenario set is ordinary prose typing, a burst with no artificial delay, IME composition,
an edit in dense CriticMarkup, an edit near a large table or structured block, and undo immediately
after input. Open and first-editable-viewport timing use the representative documents selected in
plan 0010.

Numeric acknowledgement and open targets remain intentionally unset until the upstream shell and
the two bounded Phase 1A candidates have been measured on the same recorded hardware. The product
criterion is already fixed: ordinary input is visible by the next rendered frame at p95, with no
sustained queue growth or routine corrective paint.

## Execution record

Suite results, machine details, and latency distributions belong in dated run artifacts rather than
in this document. This file changes only when the oracle set or measurement method changes.
