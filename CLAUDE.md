# MarkText repository guide

MarkText is a realtime Markdown editor built with Electron, Vue 3, TypeScript,
and CSS. The repository is a pnpm workspace.

## Workspace structure

```text
packages/
  document-core/  Source-authoritative Markdown and CriticMarkup engine
  document-view/  Browser DOM view over @marktext/document-core
  desktop/        Electron main, preload, renderer, and desktop tests
  website/        Documentation website
specs/
  language/       Normative language profiles
  migration/      Historical plan-0009 evidence and candidate fixtures
  plans/          Active implementation plans
```

This branch is the document-engine research snapshot. The active product direction is
`specs/plans/0010-marktext-criticmarkup-core-integration.md`: preserve a recorded upstream
MarkText baseline and selectively import research assets. Do not treat the current replacement
view or the archived plan-0009 certification ledgers as product-completion authority.

`@marktext/document-core` owns exact decoded source text, parsing, projections,
immutable revisions, selection, history, typed editing intents, Review indexes,
and materialization. It has no DOM, Vue, Pinia, or Electron dependency.

`@marktext/document-view` mounts render plans from document-core into browser
DOM and translates browser input and selection into typed engine operations. It
must not parse Markdown, recognize CriticMarkup, reconstruct offsets, or own a
second document state.

The desktop package hosts the view. Main owns durable sessions, file IO, and
static sinks. The renderer owns presentation and user interaction. Source mode
is a native input projection over that same main-owned document session; it
does not own document bytes or history.

## Commands

Run commands from the repository root unless a package path is shown.

```bash
pnpm install
pnpm run dev
pnpm run build:unpack
pnpm run test
pnpm run test:unit
pnpm run test:e2e
pnpm run lint
pnpm run typecheck

pnpm -C packages/document-core check
pnpm -C packages/document-view test
pnpm -C packages/document-view typecheck
pnpm -C packages/document-view test:e2e
pnpm -C packages/desktop run build:desktop
```

A focused test can be run with the package-local executable:

```bash
pnpm -C packages/document-core exec vitest run test/language-engine/open-addition.spec.ts
pnpm -C packages/desktop exec vitest run test/unit/specs/document-core-direct-owner.spec.ts
pnpm -C packages/desktop exec playwright test --config test/e2e/playwright.config.ts test/e2e/document-core-review-workflow.spec.ts
```

## Architecture rules

- Canonical document source is read from the session, never serialized from DOM.
- Every document mutation crosses a typed intent boundary.
- Browser DOM is a replaceable projection with parser-issued model ranges.
- Main-process session tokens bind renderer requests to the owning frame.
- Persistence flushes admitted work before acquiring a canonical-source lease.
- Clipboard, search, count, HTML, PDF, print, and persistence use declared
  consumer projection policy.
- Review UI consumes one typed snapshot and dispatches typed commands.
- Renderer code cannot access Node directly; use the typed preload bridge.
- Cross-process types belong in `packages/desktop/src/shared/types`.
- IPC channels are typed in `packages/desktop/src/shared/types/ipc.ts`.

The direct view package is intentionally small. Do not add parser, serializer,
history, export, or parallel state modules to it. Add document semantics to
document-core and keep the view as a mount/input adapter.

## Code style

Desktop code uses two-space indentation, single quotes, and no semicolons.
Document-core and document-view follow their package-local TypeScript style.
TypeScript runs in strict mode.

Follow `.github/COMMENTING-GUIDELINES.md`. Comments should explain invariants,
ownership, units, or non-obvious reasoning. Delete comments that narrate the
code or refer to removed implementations.

Preserve unrelated work in a dirty tree. Use focused, non-destructive changes
and run the narrowest relevant checks before broader suites.

## Electron process model

```text
main
  file IO, durable document sessions, native dialogs, static sinks
    |
    | typed IPC and capability tokens
    v
preload
  contextBridge-only API
    |
    v
renderer
  Vue shell + @marktext/document-view + native source input adapter
```

The renderer is sandboxed with context isolation. Main and preload build as
CommonJS; renderer output is ES modules.

## Build notes

- Packaged installers are written under the repository `dist/` directory.
- Electron native modules must be rebuilt after changing Electron.
- Platform packaging scripts run locale minimization and native rebuild steps.
- Background Electron tests require a fresh desktop build; the build manifest
  fingerprints desktop and document-view inputs.
- Path aliases are defined in `packages/desktop/electron.vite.config.ts`,
  `vitest.config.ts`, and `tsconfig.base.json`.

## Documentation

Developer documentation lives in
`packages/website/content/docs/dev/`. When architecture changes, update that
documentation and its generated navigation artifacts in the same change.
