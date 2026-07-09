# Weakest-parts fix plan

Source: the 2026-07-09 whole-system weakness sweep (6 fresh investigators +
25 adversarial verifiers, scope deliberately outside the just-reviewed
comment/merge subsystem). 21 findings confirmed; ROI triage kept 6. This plan
fixes all 6 via red-green TDD and closes with the full gate sweep.

**Completion check:** every item below lands with its red test shown failing
first, then green; full sweep green at close (muya unit + conformance +
chromium e2e; desktop unit + e2e; skills; both typechecks; both lint
ratchets; madge; css; build:unpack).

## Status

- [x] 1. Main-process save/IO integrity (silent data loss) — DONE
- [x] 2. e2e harness fail-closed on renderer errors — DONE
- [x] 3. Delete the legacy muyajs corpse + orphan deps — DONE
- [x] 4. Inline tokenizer perf cliff — DONE (guard reorder, not the rewrite)
- [x] 5. format.ts block-conversion consolidation + caret bug — DONE (caret math unified)
- [x] 6. exportSettings single-object collapse — DONE (dispatch fail-loud + de-duped; full collapse ROI-deferred)

## 1. Main-process save/IO integrity — CRITICAL, silent data loss

Four confirmed instances, one pass. All in `packages/desktop/src/main`.

### 1a. Close-with-Save destroys the window even when the save failed
- Evidence: `menu/actions/file.ts:212-216` — `handleResponseForSave`'s
  `.catch` swallows the write error (logs + sends `mt::tab-save-failure` to a
  renderer being destroyed) and resolves undefined, so
  `Promise.all(...).then(() => ipcMain.emit('window-close-by-id', ...))`
  (`file.ts:426-427`) always fires; the keep-open save-failure dialog at
  `file.ts:429-446` is dead code.
- Fix: `handleResponseForSave` returns a discriminated result
  (`{saved:true,id} | {saved:false,id,error}`) instead of swallowing; the
  close path emits `window-close-by-id` only when every result is saved,
  otherwise shows the (currently dead) failure dialog and keeps the window.
  Audit the other `handleResponseForSave` call sites (quit flow, save-all)
  for the same swallowed-failure assumption.
- Red test: unit spec on the close-confirm handler with a failing
  `writeMarkdownFile` → asserts no `window-close-by-id`, dialog shown.

### 1b. Saves are truncate-in-place, not atomic
- Evidence: `filesystem/markdown.ts:84-85` (TODO admits it) → `writeFile` →
  fs-extra `outputFile` (truncate + stream). Crash/ENOSPC mid-write destroys
  the previous good file. The session buffer store already does temp+rename
  (`editorBufferStore/index.ts:179-200`).
- Fix: atomic write for document saves — prefer the battle-tested
  `write-file-atomic` package (per the don't-reinvent rule); preserve mode,
  resolve symlink targets first (the existing `readlinkSync` handling in
  filesystem/index.ts). Keep `outputFile`'s create-parent-dirs behavior.
- Red test: mock a write that throws mid-operation → original bytes survive;
  symlink target (not the link) gets replaced.

### 1c. Rename / Move-To / Pandoc import fail silently
- Evidence: `menu/actions/file.ts:496-508` (rename: log-only),
  `543-556` (Move-To uses `rename` → EXDEV across volumes = 100% silent
  no-op), `260-268` (pandoc import errors log-only).
- Fix: on failure send the error notification exactly like the export path
  (`file.ts:121-129`); Move-To switches to `fs.move` (cross-device safe).
- Red test: force EXDEV/permission errors → notification IPC asserted, path
  unchanged.

### 1d. Update flow ignores unsaved work; one failure bricks "Check for Updates"
- Evidence: `menu/actions/marktext.ts:41-52` — `update-downloaded` does
  `setImmediate(quitAndInstall)` (own TODO admits it), bypassing the close
  guard (`windows/editor.ts:278`). Rider: `runningUpdate` is never reset on
  updater error, so one transient failure disables update checks all session.
- Fix: run the existing unsaved-files save flow before `quitAndInstall`;
  reset `runningUpdate` in the updater error handler.
- Red test: update-downloaded with a dirty window → save flow invoked before
  quit; updater error → subsequent check allowed.

## 2. e2e harness fail-closed on renderer errors — HIGH, test-trust

- Evidence: renderer exceptions funnel to `mt::handle-renderer-error`;
  under `MARKTEXT_TEST_BACKGROUND` that's a hanging promise
  (`main/exceptionHandler.ts:68-71`), on CI a non-blocking dialog. Only the
  opt-in `installRendererErrorCounter` (`test/e2e/helpers.ts:122-173`)
  converts errors to failures — 24/69 specs opt in; 45 run blind.
- Fix: install the error counter unconditionally in `launchElectron`; shared
  afterEach runs `expectNoRendererErrors` on every launched app; explicit
  `allowErrors` opt-out for specs that deliberately provoke errors (the
  crash-* specs).
- Red proof: inject a throw into a renderer handler → a previously-blind
  spec now fails; remove injection → green. Then run the full e2e suite and
  fix (or explicitly triage) whatever real errors surface.

## 3. Delete the legacy muyajs corpse + orphan deps — MEDIUM, big cleanup

- Evidence: zero runtime imports repo-wide of `muya/lib` / bare `muya` /
  `@marktext/muyajs`; still a prod dep (`desktop/package.json:62`), aliased
  (electron.vite.config.ts ×3, vitest.config.ts:24, tsconfig.base.json:29),
  typed (`desktop/src/types/muya.d.ts`, 137 lines, header says delete it),
  CI-watched (`website-deploy.yml:8,14`), packaged (~3.9M/391 files). Last 5
  muyajs commits were wasted real bug fixes. ~17 muyajs-era orphan deps in
  the desktop manifest (mermaid, katex, pako, snabbdom, turndown, …) with 0
  desktop import sites — @muyajs/core declares its own copies. pako also has
  a dead shim (`types/shims.d.ts:22`) + `optimizeDeps` entry
  (electron.vite.config.ts:91).
- Fix: one mechanical PR — delete `packages/muyajs`, the workspace dep, the
  aliases/path-map, muya.d.ts, the website-deploy path filter; prune orphan
  deps individually (verify katex/github-markdown-css aren't reached via CSS
  @import or the export path before dropping); fix the stale comment path at
  `renderer/src/codeMirror/markdownMathMode.ts:19`; update AGENTS.md's
  architecture section (still names muyajs as the engine).
- Verification (observable, this is deletion): full gate sweep + fresh
  `pnpm install` + `build:unpack`; before/after `du` of the packaged app.

## 4. Inline tokenizer perf cliff — MEDIUM severity, core-editor feel

- Original evidence (finding [8]): claimed the char-by-char
  `state.src.substring(1)` main scan loop was O(n²). DIRECT MEASUREMENT
  refuted this: the plain-text scan is linear on current V8 (a SlicedString
  whose anchored rules fail at char 0 is not re-flattened). CPU profiling of
  the real cliff pinned it to ONE rule: the GFM `auto_link_extension` regex
  (`inlineRenderer/lexer.ts` tryAutoLinkExtension), whose email/URL body scans
  forward from the cursor — run at every offset over a long word-char run
  (email-charclass, no whitespace/boundary), that is O(n²) (49.5× for 8×).
- Fix DONE (a48e7b15): move tryAutoLinkExtension's cheap preceding-char guard
  (autolink valid only at line start or after ` * _ ~ (`) BEFORE the rule
  exec instead of after. Skips the O(remaining) scan wherever an autolink
  cannot begin; byte-identical behavior (the guard already discarded those
  hits). ~6 lines; the emphasis/strong path and every other rule untouched.
- NOT done (deliberately reverted): the broad sticky-`/y` rewrite of the whole
  scan the maintainer originally greenlit. Prototyped, conformance-green, but
  it broke 28 emphasis edge-case unit tests — the recursion decouples
  scan-position (content-relative) from range-offset (absolute), which merging
  into one `originSrc`+`pos` corrupts — for no gain over the guard reorder on
  realistic input. Right call: the small surgical fix, not the rewrite of the
  most conformance-critical file.
- Red test: a perf assertion that tokenization scales sub-quadratically
  (8× length must cost < 24× time — 49.5× on the pre-fix lexer, ~8× after);
  behavior guarded by the 1347-example CommonMark/GFM conformance ratchet
  (compliance can only go up) + the muya unit suite.

## 5. format.ts block-conversion consolidation + caret bug — MEDIUM

- Evidence: five `_convertTo*` methods (`muya/src/block/base/format.ts:751-1271`)
  hand-copy the same split/insert/replace/remap skeleton (~300 dup lines);
  the caret remap diverged — `_convertToBlockQuote` (1211-1219) subtracts
  only the `> ` marker delta, not the preceding soft-wrapped lines' length
  (atx/thematic subtract `preParagraphTextLength`). Typing `> ` on a
  non-first soft-wrapped line drops the caret out of range.
- Fix: REPRODUCE the caret bug red first (per house rules — it was traced,
  not yet reproduced). Then extract shared `splitAroundFirstMatch` +
  `remapOffsetAfterSplit` helpers and drive all five conversions through
  them; the blockquote fix falls out of the shared remap.
- Red test: unit spec on blockquote conversion in a soft-wrapped paragraph →
  caret at offset 0 of the quoted leaf, not clamped past end.

## 6. exportSettings single-object collapse — MEDIUM, fail-loud violation

- Evidence: `renderer/src/components/exportSettings/index.vue` — four
  hand-maintained projections (refs 304-340, `persistableSettings` 344-374
  [29 entries], `onSelectChange` `state` map 489-513 [23 entries],
  `handleClicked` assembly 426-482); `if (key in state)` (514-516) has no
  else — an unregistered key silently no-ops the control.
- Fix: one typed `reactive` settings object; `v-model`/`update(key, value)`
  that THROWS on unknown keys; persistence and `handleClicked` read the one
  object. Four lists become one.
- Red test: `update('bogusKey', …)` throws; every registered control's
  change round-trips through save/restore; the export payload carries all 29
  fields.

## Execution order

1 (data loss) → 2 (harness, so every later fix runs under fail-closed e2e)
→ 3 (muyajs deletion) → 4 (tokenizer) → 5 (format.ts) → 6 (exportSettings).
Gates green after each item; narrowest suite first, full sweep at close.

## COMPLETE — closing gate sweep green (2026-07-09)

All 6 fixes landed red-green, each verified in the real artifact:
- **1** (b2bbf3e1): discriminated SaveResult + resurrected keep-open dialog;
  atomic writes via write-file-atomic; rename/move/import notify + fs.move;
  update flow saves before quitAndInstall + resets runningUpdate.
- **2** (ee3de610): launchElectron installs the renderer-error counter
  unconditionally + close-time guard; suppressErrorDialog → allowErrors
  opt-out; full e2e green under the guard (no latent errors were hidden).
- **3** (4ccf86bd): deleted packages/muyajs (47,962 lines / 405 files) + all
  scaffolding + 16 orphan deps; diagram/math/export/theme e2e prove the paths
  route through @muyajs/core.
- **4** (a48e7b15): the actual O(n²) was the GFM auto_link_extension scan, not
  the substring loop (finding's stated cause refuted by measurement); fixed by
  a ~6-line guard reorder; the broad sticky rewrite was prototyped and reverted
  (broke 28 edge cases for no gain).
- **5** (72cb1ebd): one remapOffsetAfterSplit for the three block conversions;
  fixes the block-quote caret landing past the quote content.
- **6** (4b5402be): export dialog dispatch de-duped onto the canonical registry
  and fails loudly on unknown keys instead of silently dropping writes.

Full sweep green: muya 1752 unit + 1347 conformance + 242 chromium e2e +
types/lint/css/madge clean; desktop 938 unit + 285 e2e + typecheck + lint
clean; skills 36; build:unpack. (A first e2e run showed one failure —
issue-1861 — traced to running build:unpack concurrently, which regenerated
out/renderer mid-load; a clean isolated re-run and a clean full re-run both
pass 285.)

## Explicitly out of scope (ROI-filtered by the sweep, kept for the record)

Renderer-path validation on filesystem IPC (sandbox boundary is the deliberate
trust model); the image-uploader pane cluster (PicGo poll leak, zh-CN
timestamps, untested parsePicgoOutput); ripgrep internals test gaps; the
updateContents stripped-diagnostic nit; preferences-store stringly mutations
(verifier: overstated); the native-keymap 3-part workaround (deliberate,
working); the spellchecker watcher null-deref (verifier: overstated — needs a
repro before it earns work); model.ts / editor.vue file sizes (documented
waivers in the archived quality-review plan).
