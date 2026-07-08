# Test Infrastructure Contracts

Rules for how this repo's tests earn trust. These exist because two
infrastructure choices repeatedly produced false confidence and refactor
friction.

## Component tests mount real components

Vue component behavior is tested by **mounting the component** (
`@vue/test-utils`), with collaborators controlled at module boundaries
(`vi.mock` of store/service modules, element-plus component stubs) — never by
compiling an SFC's script with `compileScript`, regex-stripping its imports,
and evaluating it in a hand-maintained `new Function` dependency harness.

Why: the compiled-script harness binds tests to the component's *compiled
internals* — every import added or renamed breaks a hand-kept destructure
list; handlers are invoked without templates, so template-level regressions
(bindings, emits, v-model wiring) pass silently; and the harness itself is
more code than the behaviors it checks.

Contract:

- `comments.vue`, `sourceCode.vue`, and `mergeConflictDialog.vue` specs mount
  the real component. Interactions go through the rendered DOM (`trigger`,
  `setValue`) or emitted events, not by calling setup-scope closures.
- Store state is arranged through real Pinia (`createTestingPinia` or
  `setActivePinia` + direct state writes), not through `storeToRefs` fakes.
- A spec may reach into `wrapper.vm` only for values the component
  deliberately exposes.

## E2E reads document bytes through a test bridge

Byte-preservation and undo assertions must not obtain the document by
round-tripping through source mode: toggling modes exercises the very
markdown⇄state conversion under test (and mutates history), so those
assertions were partially self-referential.

Contract: in test mode (`MARKTEXT_TEST_BACKGROUND`), the preload exposes a
read-only bridge — `window.__marktextTest.getTabMarkdown()` returning the
active tab's committed markdown (post engine flush), and
`getEngineSelection()` returning the engine's committed selection so
arrangement helpers wait on the selectionchange pipeline instead of
sleeping. `getMarkdownContent` in the e2e helpers uses the bridge; READING
document bytes through a source-mode round-trip is banned. Entering source
mode to ARRANGE content (`setSourceMarkdown` — a fast deterministic reset
without relaunching Electron) is sanctioned; reads still go through the
bridge. The bridge does not exist outside test mode.

## Waits assert conditions, not clocks

- No bare `waitForTimeout` before a hard assertion; wait on the observable
  condition (`expect.poll`, `waitForFunction`, `waitForSelector`).
  A fixed sleep is acceptable only to *provoke* debounced behavior, never to
  *await* it.
- Negative expectations must settle: a check that something is (still)
  disabled holds for consecutive reads (`waitForMenuItemEnabled` semantics)
  so it cannot pass by reading stale state.
- Platform-chorded keys use portable forms (`ControlOrMeta+…`) with an
  intermediate positive assertion, so a platform no-op keystroke fails loudly
  instead of leaving the real check vacuously green.

## Suites that gate

`pnpm -C packages/muya test` (unit) and `test:spec` (CommonMark/GFM
conformance with the expected-failures ratchet), `check-circular`, desktop
`test`/`test:skills`/`typecheck`/`lint`, and both Playwright suites gate
every change. Long suites run with progress visibility and hang detection
rather than silent multi-minute blocks.
