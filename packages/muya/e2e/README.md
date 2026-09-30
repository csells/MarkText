# `muya-e2e`

Playwright end-to-end test suite for `@muyajs/core`. Real-browser tests that exercise muya's contenteditable surface, floating UI plugins, KaTeX / Mermaid rendering, and public API — the things `happy-dom` unit tests can't cover.

## Layout

```
e2e/
├── host/              # Minimal SUT (system-under-test) page
│   ├── index.html     # #editor + toolbar buttons (#undo, #search, …)
│   └── main.ts        # Registers all UI plugins, exposes window.muya
├── vite.config.ts     # Vite dev server, port 5174 (avoids examples 5173)
├── playwright.config.ts
├── types.d.ts         # Augments Window.muya?: Muya for evaluate callbacks
└── tests/
    ├── fixtures/      # Auto-wait-for-muya-init fixture
    ├── helpers/       # selectors / keyboard / api wrappers
    ├── smoke/         # P0 boot + public API
    ├── typing/        # block creation via typing/slash menu
    ├── inline/        # IFT, emoji, links, shortcuts
    ├── ui/            # slash menu, paragraph-front, image, footnote
    ├── editing/       # undo/redo, selection, search/replace, clipboard
    └── i18n/          # locale switching
```

The host page is intentionally decoupled from `examples/` — that folder is undergoing a parallel refactor, and a self-owned SUT keeps the two workstreams independent.

## Running locally

From the repo root:

```sh
pnpm install                    # one-time, picks up @playwright/test
pnpm e2e                        # full matrix — Chromium + Firefox + WebKit
pnpm e2e:ui                     # Playwright UI mode (recommended for debugging)
pnpm e2e:headed                 # headed Chrome with normal page UI
```

Targeted runs (Phase 2 added the cross-browser matrix):

```sh
pnpm --filter muya-e2e e2e:chromium   # Chromium only (bundled binary)
pnpm --filter muya-e2e e2e:firefox    # Firefox only (bundled binary)
pnpm --filter muya-e2e e2e:webkit     # WebKit only (bundled binary)
```

Playwright uses its bundled Chromium, Firefox and WebKit, locally as on CI (`playwright install --with-deps chromium firefox webkit` in `ci-e2e.yml`). Download them once:

```sh
pnpm e2e:install
```

The installed Google Chrome is not the default: it starts its GoogleUpdater, which inherits the browser's output pipes, and Playwright cannot finish closing that browser until the updater exits. A worker can then outlive Playwright's five-minute stop limit and fail a run whose tests all passed. To run the Chromium project in the installed Chrome anyway:

```sh
PLAYWRIGHT_USE_SYSTEM_CHROME=1 pnpm --filter muya-e2e e2e:chromium
```

Inspect failures:

```sh
pnpm --filter muya-e2e exec playwright show-report   # HTML report from the latest run
```

## Conventions

- **`page.keyboard.type` with `delay: 0` drops characters.** muya's content-change pipeline re-renders synchronously per keystroke; Playwright's default 0ms inter-key delay can outrun snabbdom patches. Use `slowType()` from `tests/helpers/keyboard.ts` (30ms per char) for any typing > 4 chars.
- **Float plugins hide via `opacity: 0`, not `display: none`.** `expect(...).toBeHidden()` won't work — assert on computed opacity or rely on a subsequent action to settle state.
- **Native input reaches state on a deferred animation frame.** DOM echo does not acknowledge that state update. Assert the eventual exact Markdown with `expect.poll(() => getMarkdown(page))`; use `muya.flush()` only when the workflow itself explicitly flushes.
- **No `(window as any).muya`.** `types.d.ts` declares `Window.muya?: Muya`; the project bans `any` (`ts/no-explicit-any: 'error'`), so explicit casts will fail lint.
- **One global E2E sandbox per workspace.** The host pre-registers every UI plugin. Specs that want a clean slate call `window.muya!.setContent('')` in a `before*` or first step.

## Adding a new spec

1. Pick a folder by category (`tests/<category>/your-feature.spec.ts`).
2. `import { test, expect } from '../fixtures/muya'` — gives you a Page with `window.muya` already initialised.
3. Use selectors from `tests/helpers/selectors.ts` (or extend it). Don't hard-code `.mu-*` classes inside spec files.
4. Bias toward asserting via the public API (`getMarkdown` / `getState` / `getTOC`) over DOM regex matching — markdown serialization is deterministic where snabbdom output can shift.

## Roadmap

This is **Phase 1 — P0 smoke + key interaction skeleton**. See [BACKLOG.md](./BACKLOG.md) for the full 4-phase plan.
