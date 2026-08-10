# Upstream baseline run — 2026-08-10

- Commit: `43bd8b77795fb27b1a9512737c000f7362031ea0`
- Host: MacBook Pro `Mac17,6`, Apple M5 Max, 128 GB
- OS: macOS 26.5.1 (25F80)
- Runtime: Node 22.23.1, pnpm 10.33.4
- Worktree: `feat/criticmarkup-core-integration`, before importing document-core production code

The only integration-branch executable present during this run was the Phase 0 parity-baseline test.
It was excluded from the desktop upstream count. Application and Muya production code still matched
the recorded upstream commit.

## Results

| Command | Result |
| --- | --- |
| `pnpm -C packages/muya test` | Pass: 212 files, 1,438 tests. |
| `pnpm -C packages/muya test:spec` | Pass: four files, 1,347 standard examples. |
| `pnpm -C packages/desktop test:unit --exclude test/unit/specs/criticmarkup-parity-baseline.spec.ts` | Pass: 50 files, 734 tests. |
| `pnpm -C packages/muya/e2e exec playwright test --project=chromium` | Failed and then hung in teardown: 243 cases passed and one toolbar case failed in the full parallel run. The isolated five-case toolbar file passed. Three idle worker processes and the orphaned test Vite server were stopped after more than two minutes without output. |
| `pnpm build` | Pass: main, preload, and renderer production bundles built. Vite reported its existing mixed static/dynamic CodeMirror imports. |
| `pnpm test:e2e` | Fail: 214 passed, four skipped, one failed. The run exited normally in 39.6 seconds. |

All browser and Electron tests ran headless. Code remained the frontmost application during the
desktop suite.

## Reproduced upstream input loss

`packages/desktop/test/e2e/editor-input.spec.ts` types ` typed-token` with Playwright's zero-delay
keyboard path, then reads the document through Source mode. The complete suite saved ` typed-toke`.
An isolated rerun reproduced the loss and saved only ` typed-to`:

```text
Expected substring: "typed-token"
Received string:    "# Hello\n\nStarting paragraph.\n\n typed-to\n"
```

The isolated file result was seven passed and one failed. This is an upstream production-path defect,
not a CriticMarkup regression. It becomes a red oracle for plan 0010: the integration must preserve
ordinary editor behavior while fixing burst-input loss, and its latency harness must not hide the
problem with an artificial key delay.

## Environment note

The first desktop unit attempt used the machine's default Node 26.5.0. Eleven files failed because
that runtime exposed `localStorage` as an unavailable global before jsdom could install its own. The
same upstream suite passed under Node 22.23.1. Node 26 output is an environment incompatibility, not
an application baseline result.

The initial dependency tree also belonged to the previous research branch. A frozen pnpm install
completed successfully before the recorded runs. No tracked dependency or generated source files
changed.
