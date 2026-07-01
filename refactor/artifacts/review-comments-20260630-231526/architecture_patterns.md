# Architecture Pattern Notes

Run: `review-comments-20260630-231526`

## Project-Level Patterns

- MarkText is a pnpm monorepo with desktop Electron/Vue code in `packages/desktop`, the TypeScript editor engine in `packages/muya`, the legacy engine in `packages/muyajs`, and docs/site code in `packages/website`.
- Desktop keeps Node/Electron access in main and preload layers; renderer code uses typed bridges, stores, and local utilities instead of direct Node access.
- Cross-process contracts live under `packages/desktop/src/shared/types`; renderer-only behavior usually stays in components, stores, or `src/renderer/src/util`.
- Muya owns markdown parse/state/render behavior. Desktop should ask Muya for comment semantics where a shared editor-engine helper exists instead of duplicating parser decisions in Vue code.
- The skill package is private repo tooling. It should manage the portable comment format directly and reuse Muya's parser/metadata helpers for all format rules.

## Portable Comment Implementation Fit

- The comment format is anchored in Muya: `packages/muya/src/comments` owns metadata normalization, marker parsing, parsed comment graph diagnostics, range wrapping, and metadata replacement.
- Desktop is an integration layer: menu/sidebar/source-mode code should call Muya helpers and keep CodeMirror-specific behavior local only where it affects editor selection or undo granularity.
- Source-mode edits need targeted CodeMirror replacements. Whole-document `setValue()` would be simpler, but would risk undo/selection behavior and is not isomorphic.
- The skill should remain a CLI/thin helper over the format. It should not carry a second metadata codec, block parser, or independent reply merge implementation.

## Refactor Direction

- Prefer replacing duplicated comment-format decisions with exported Muya helpers.
- Keep source-mode raw-index scanners where CodeMirror cursor/range behavior needs raw document indexes.
- Remove dead state and pass-through functions when references prove they cannot affect behavior.
- Do not extract larger UI components or source scanners unless tests are added first; the current coverage is strongest around metadata/reply behavior and weaker around full source-mode parsing UI.
