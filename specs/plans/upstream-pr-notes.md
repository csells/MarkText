# Notes for the upstream PR description

Material for the description of the PR from
`rebase/criticmarkup-on-upstream-develop` to upstream `develop`. This file lives
only on `fork/criticmarkup-extras`.

## Workflow triggers

The PR keeps upstream's workflows except for these deliberate changes:

- `build.yml`, `test.yml` and `e2e.yml` no longer skip `packages/muya/**`.
  Muya now imports `@marktext/input-policy` and is driven by the desktop's
  document authority, so a Muya-only change can break the desktop build, its
  unit tests and its E2E suite.
- `e2e.yml` sets `MARKTEXT_E2E_PRIVATE_DISPLAY` so the Electron suite runs on
  its own virtual display under `xvfb-run`.
- `muya-e2e.yml` also runs for `packages/document-core`, `packages/input-policy`
  and the desktop's `documentAuthority`, and typechecks its browser harness.
- `document-core.yml` is new: it runs `pnpm document-core:check`.
- `build.yml` gains `workflow_dispatch` inputs for verifying an existing
  candidate's installers and the Windows IME environment. A pull request runs
  upstream's jobs unchanged.

## Dependencies

- `mermaid` is `^11.16.1` in the desktop and Muya.
  `criticmarkup-rendering-security.spec.ts` opens a hostile
  `architecture-beta` diagram and requires the editor to stay responsive
  without prototype pollution. Re-verified 2026-10-06 on the PR tree pinned
  to Mermaid 11.15.0: that case fails (`Object.prototype` gains the
  diagram's group name) while the normal-document cases pass.
- `turndown`, `joplin-turndown-plugin-gfm`, `html-tags` and `underscore` are
  removed: their only callers were the Markdown paths Core replaced.
- New: `@marktext/document-core` and `@marktext/input-policy` (workspace),
  `@tanstack/vue-virtual`, `yaml`, and the root dev dependency
  `@electron/asar` (packaged-app verification).

## Separate PRs

- `fix/packaging-native-modules`: packages native-keymap and ced explicitly
  and keeps test output out of the app archive.
- electron-builder 26.15.7 fixes the Windows ARM64 NSIS install (CI run
  34067133878 installed no executable with 26.15.3); not part of this PR.

## Building a verifiable package

Installed verification needs an ad-hoc sealed macOS build that names its
source revision:

    MARKTEXT_BUILD_COMMIT="$(git rev-parse HEAD)" \
      pnpm --filter marktext build:mac:arm64 -c.mac.identity=-

The `run-installed-core-*.sh` scripts do this themselves. A plain build embeds
the checkout's HEAD, or `unknown` outside git.
