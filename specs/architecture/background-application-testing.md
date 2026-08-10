# Background Application Testing

> **Status:** Historical plan-0009 harness record. Keep its observable non-focus and fresh-build
> test goals; its process, scheduling, and document-view topology are not plan-0010 requirements.

## Purpose

Automated MarkText desktop tests must never take over the user's computer.
Background behavior is a production test-harness invariant, not a convention
individual tests may opt into.

## One presentation policy

One production presentation policy decides whether the application may
activate, focus, show a window, display a native dialog, reveal a screenshot,
or present startup/crash UI. Window options and every later presentation path
derive from that policy. Test code must not scatter environment checks or patch
individual `show()`/`focus()` calls.

When `MARKTEXT_TEST_BACKGROUND=1`:

- the application uses the non-activating macOS policy where applicable;
- editor, settings, dialogs, and later-created windows remain hidden;
- no Dock, taskbar, focus, or frontmost-application takeover is allowed;
- hidden renderers remain able to complete deterministic test work; and
- a requested native presentation either uses an explicit deterministic test
  substitute or fails loudly.

Interactive debugging is a separate explicit mode and may not weaken the
default automated contract.

## Error and build integrity

Every automated application launch captures main-process and renderer errors,
unhandled rejections, and fatal startup failures. Hiding a window never hides or
suppresses its errors. A run with a captured error is failed even if visible
assertions passed.

The harness proves that the desktop bundle is newer than every relevant source
and configuration input before launch. String sentinels inside a bundle are not
freshness proof. A stale or missing build fails before Electron starts.

## Execution discipline

Desktop builds and tests run sequentially under macOS background scheduling and
lowest process priority. Playwright uses the repository configuration and one
worker. No agent may launch Electron through an ad hoc script.

Long runs write observable logs and are polled regularly. An interrupted,
timed-out, stale-build, foreground-stealing, or error-capturing run is
inconclusive or failed—never a pass. After interruption, only processes owned
by that run may be terminated, and the agent verifies that no test-owned
Electron process remains.

## Release proof

At least one freshly built real-application workflow must assert that windows
remain hidden and unfocused while exercising the production renderer and main
process. Mocked policy tests are necessary but do not replace this artifact
proof.

## Readiness

Automation waits for the main-owned document session and direct browser view to
publish their ready state before measuring interaction latency. Opening and
projection costs are measured independently; tests must not create a second
parse or renderer-only cache to manufacture a steady-state result.
