# 0003 — Native CriticMarkup Integration

**Status:** Superseded on 2026-07-13 by
[`0006-criticmarkup-production-readiness-closure.md`](0006-criticmarkup-production-readiness-closure.md)
**Started:** 2026-07-10  
**Branch:** `feat/native-criticmarkup` (from the repository mainline,
`develop`)

## Outcome

> Historical plan. All unfinished obligations were transferred to plan 0006;
> unchecked boxes below describe the state at supersession, not the active
> execution queue.

Make pure CriticMarkup a first-class Markdown feature of MarkText and Muya.
MarkText must be able to open, render, author, edit, review, accept, reject,
save, and reopen all five standard CriticMarkup constructs without converting
them to a proprietary format or handling them in a regex-based side channel.

This plan deliberately establishes CriticMarkup before any work on concurrent
file editing. Filesystem watchers, autosave ownership, external-write merging,
and agent attribution are out of scope. A later effort will build those
features on the native review model delivered here.

## Settled decisions

1. **Keep MarkText as the application.** Its mature cross-platform desktop
   shell, file lifecycle, source mode, WYSIWYG editor, export surfaces, menus,
   preferences, localization, and tests remain the product foundation.
2. **Implement CriticMarkup in Muya's Markdown pipeline.** Parsing must produce
   semantic inline tokens consumed by the editor and renderers. No production
   feature may rediscover CriticMarkup by scanning already-parsed Markdown with
   an independent set of regular expressions.
3. **Implement the pure standard.** The on-disk representation is limited to
   the five standard constructs. No IDs, metadata appendix, threaded-comment
   syntax, hidden anchors, or Roughdraft-flavored extensions may leak into the
   file.
4. **Use Roughdraft as a behavioral oracle, not an architectural transplant.**
   Its parsing, editing, track-changes, review, and serialization behavior will
   inform conformance cases. Muya will implement those behaviors in its own
   marked/custom-inline-lexer, JSON-state, OT, snabbdom, command, and UI
   architecture.
5. **Deliver complete review behavior before concurrency.** Parser support or
   syntax coloring alone is not completion. Automatic track changes,
   authoring, navigation, per-change and bulk resolution, comments, undo/redo,
   source mode, persistence, and export behavior are part of this effort.
6. **Match MarkText's existing UI language.** New affordances must use the
   application's established menus, sidebar, toolbar, context-menu,
   preferences, keyboard-shortcut, and localization patterns rather than
   introducing a separate review application inside MarkText.

## Standard constructs

| Construct | Syntax | Accept | Reject |
| --- | --- | --- | --- |
| Addition | `{++new++}` | Keep `new` | Remove `new` |
| Deletion | `{--old--}` | Remove `old` | Keep `old` |
| Substitution | `{~~old~>new~~}` | Keep `new` | Keep `old` |
| Highlight | `{==text==}` | Keep text, remove annotation | Keep text, remove annotation |
| Comment | `{>>comment<<}` | Remove annotation | Remove annotation |

A substitution is one semantic review item even if a renderer presents it as
paired deleted and inserted spans. In-memory identities may be assigned for
selection and UI routing, but they are session-local and never serialized.

## Definition of full support

A user can:

- Open Markdown containing any standard CriticMarkup construct and see it
  represented semantically in WYSIWYG mode.
- Switch to source mode and inspect or edit the same standard syntax.
- Create additions, deletions, substitutions, highlights, and comments using
  MarkText commands and controls.
- Enable Track Changes so ordinary insert, delete, and replace operations
  produce coherent CriticMarkup rather than destructive edits.
- Continue editing around and within pending changes without corrupting their
  boundaries.
- Navigate pending review items and accept or reject one item or the complete
  document.
- View the marked-up, original, and revised projections without changing the
  stored document merely by switching views.
- Save and reopen the file with the same CriticMarkup semantics and without
  unrelated Markdown churn.
- Copy, paste, search, undo, redo, split blocks, join blocks, and export with
  explicit, tested treatment of pending changes.

## Architecture constraints

### One grammar owner

One Muya module owns delimiter recognition, token boundaries, construct
classification, source ranges, malformed-input behavior, and resolution
semantics. The marked extension, Muya inline lexer, document transforms,
source-mode integration, and tests consume that owner. They must not develop
independent interpretations of the syntax.

The grammar owner must be context-aware. CriticMarkup-looking bytes inside
inline code, fenced/indented code, raw constructs where Markdown treats text as
literal, escaped delimiters, and malformed constructs must follow explicit
rules proven by the conformance suite.

### Parser and editor model

- CriticMarkup enters through the Markdown parser/inline lexer before generic
  text and before conflicting GFM rules such as `~~` strikethrough.
- All five constructs have explicit token types and exhaustive renderer
  dispatch. Unknown or structurally impossible states fail loudly.
- The editor retains enough semantic structure to resolve a substitution
  atomically and to route commands to the intended review item.
- OT operations remain the only way user edits mutate Muya's JSON state.
  Track Changes must produce normal, undoable editor transactions; it may not
  rewrite the entire Markdown string behind the editor's back.
- Markdown serialization is the inverse of parsing for every supported
  construct. Standard Markdown outside the edited region must not be rewritten
  merely because CriticMarkup is present.

### Pure persistence

Only standard CriticMarkup is durable. Comment threads, resolved state,
authors, timestamps, stable IDs, and other metadata are not representable and
will not be invented. Comments are flat annotations; a highlighted passage may
be followed by a comment using the standard paired idiom.

## Execution plan

### Phase 0 — Pin behavior before implementation

- [x] Build a reference corpus from the CriticMarkup specification and
  Roughdraft covering all five constructs, adjacency, delimiter-like content,
  malformed input, Markdown nesting, code, escapes, line breaks, and block
  boundaries.
- [x] Record Roughdraft's authoring, track-changes, accept/reject, navigation,
  and projection behavior where the standard itself is silent.
- [x] Separate standard behavior from Roughdraft-specific extensions. Only the
  former enters MarkText's file format.
- [x] Add failing tests for the first vertical slice before production code.

**Gate:** every intended behavior has an observable assertion; ambiguous cases
are documented rather than guessed in implementation.

The compatibility record lives in `specs/architecture/criticmarkup.md`; its
executable corpus lives in
`packages/muya/src/criticMarkup/__tests__/compatibilityCorpus.spec.ts`.
Roughdraft 0.1.10 is retained as a UX/resolution oracle, not a grammar oracle:
its standalone scanner and rich-editor parser disagree on multiple load-bearing
edge cases, so MarkText's native Markdown AST owns the documented answers.

### Phase 1 — Grammar owner and pure transforms

- [x] Add a typed CriticMarkup grammar module that recognizes the five
  constructs and reports exact source ranges and payloads.
- [x] Define deterministic malformed-input and nesting behavior.
- [x] Implement pure marked-up/original/revised projections.
- [x] Implement per-item and whole-document accept/reject transforms from the
  same semantic parse result.
- [x] Prove substitution direction and comment/highlight behavior with focused
  tests.

**Gate:** the reference corpus passes at the grammar/transform layer without
depending on DOM APIs.

### Phase 2 — Native Markdown and Muya rendering pipeline

- [x] Register CriticMarkup with the Markdown parsing pipeline.
- [x] Add explicit inline token types and integrate them into the custom Muya
  lexer ahead of conflicting generic/GFM rules.
- [x] Render additions, deletions, substitutions, highlights, and comments
  through snabbdom with accessible semantics and stable source-offset mapping.
- [x] Serialize every construct back to pure CriticMarkup.
- [x] Integrate CriticMarkup into static HTML, clipboard HTML, and other
  parser consumers through declared projection modes rather than ad hoc
  stripping.
- [x] Run the CommonMark/GFM conformance ratchet and explain every delta.

**Gate:** parser, state, renderer, serializer, static-render, and conformance
tests are green for all five constructs.

### Phase 3 — Editor commands and Track Changes

- [x] Expose engine commands to create each construct from the current
  selection or caret.
- [x] Expose commands to navigate, accept, and reject the active/next/previous
  review item and to accept/reject all.
- [ ] Implement Track Changes at the editor-operation layer for insertions,
  deletions, and replacements.
- [ ] Define and test edits at every boundary: before, after, and inside each
  construct; selection replacement; block split/join; paste; IME composition;
  undo/redo.
- [x] Keep substitutions atomic in command routing and review navigation.

**Gate:** real-DOM Muya tests demonstrate authoring and resolution through
normal editing operations, including undo/redo.

As of 2026-07-11, Track Changes has a parser-aware same-leaf fast path and an
editor-owned synchronous mutation transaction for paragraph split/join,
same-/cross-block cut, and normalized text/HTML paste (including cross-block
replacement and multi-paragraph insertion). Those actions discard their raw
deferred OT ops and publish one CriticMarkup rebuild/history boundary. Basic
single-leaf IME commit and undo are covered. Image paste, the full IME matrix,
search/spellcheck edits, formatting, images, and the complete
construct-boundary matrix remain open; Phase 3 is therefore intentionally not
checked complete.

### Phase 4 — MarkText UI integration

- [x] Add review commands to the appropriate native application menus and
  command-routing layer with platform-correct shortcuts.
- [x] Add a Review sidebar surface listing document-order changes and comments,
  using existing sidebar conventions.
- [ ] Add contextual accept/reject and comment/highlight affordances using
  existing Muya floating-tool patterns.
- [ ] Add Track Changes and projection controls using established toolbar and
  preference patterns.
- [x] Add localization keys for every user-visible label and message.
- [x] Make source mode recognize the same syntax and keep mode switching
  lossless.

**Gate:** desktop unit tests and Playwright tests cover menu routing, sidebar
navigation, authoring, mode switches, and resolution.

As of 2026-07-11, the Review menu and renderer routing cover authoring,
navigation, targeted/bulk resolution, Track Changes, and all three projections.
The Review sidebar consumes file-bound snapshots of Muya's parser-native
document items, lists all five forms in source order, focuses exact items via
the canonical source map, and exposes targeted resolution plus Track Changes
and projection controls. Source mode clears the actionable snapshot while it
owns the document and restores it after the lossless handoff. Focused desktop
unit tests and a hidden one-worker Playwright workflow prove those paths.
Inline floating-tool affordances and dedicated toolbar/preferences placement
remain open, so Phase 4 is not complete.

### Phase 5 — Persistence, export, and hardening

- [ ] Define explicit behavior for Markdown save, HTML/PDF export, copy/cut,
  search, word count, and printing in marked-up/original/revised projections.
- [ ] Verify no-op open/save and edit/save/reopen behavior against the corpus.
- [ ] Exercise large documents and dense adjacent changes for parser and UI
  performance.
- [ ] Add accessibility labels, keyboard-only operation, focus restoration,
  and screen-reader semantics.
- [ ] Update user-facing documentation only after behavior is proven in the
  packaged application.

**Gate:** focused suites, Muya unit/spec/E2E, desktop unit/E2E, lint,
typechecking, circular-dependency checks, build, and a manual packaged-app
workflow all pass or any remaining failures are reported precisely.

## First vertical slice

The first implementation slice is intentionally narrow but end-to-end:

1. Parse `{++new++}` as a first-class addition token.
2. Render it semantically in Muya.
3. Preserve it through Markdown serialization.
4. Produce correct original and revised projections.
5. Accept or reject it through a pure transform.

The test must be observed failing before implementation. Once green, extend the
same architecture to deletion, substitution, highlight, and comment rather
than adding parallel special cases.

The slice was observed red at each boundary, then extended to all five forms in
the same token architecture. On 2026-07-10, the complete Muya unit suite passed
(219 files, 1,485 tests) and the strict CommonMark/GFM suite passed (4 files,
1,347 tests). Strict conformance explicitly disables the application extension;
normal MarkText parsing enables it by default.

## Verification commands

Run the narrowest relevant test first, then broaden:

Desktop Electron tests on macOS must run one worker at a time through
`packages/desktop/test/e2e/helpers.ts`, with `MARKTEXT_TEST_BACKGROUND=1`.
The package script must load `test/e2e/playwright.config.ts`, which pins the
run to one worker. Background mode selects the macOS accessory activation
policy and hides the Dock icon before readiness, creates every window hidden,
disables later show/focus paths and startup/crash dialogs, and keeps hidden
renderers unthrottled. Build the desktop bundle first; the harness refuses to
launch Electron if that bundle does not contain the background guards. Tests
that exercise a feature-level native dialog must install a deterministic stub
before invoking it. Do not launch Electron directly from an ad hoc Playwright
script.
Non-UI suites also run sequentially at low process priority while this branch
is under active development.

```bash
pnpm -C packages/muya exec vitest run <focused-test>
pnpm -C packages/muya test
pnpm -C packages/muya test:spec
pnpm -C packages/muya lint
pnpm -C packages/muya lint:types
pnpm -C packages/muya check-circular
pnpm -C packages/muya/e2e e2e:chromium
pnpm run test:unit
pnpm run test:e2e
pnpm run lint
pnpm run typecheck
pnpm run build:unpack
```

## Explicit non-goals

- Detecting, attributing, merging, or queuing external file writes.
- Changing autosave ownership or adding conditional filesystem writes.
- Turning filesystem diffs into CriticMarkup.
- Threads, replies, resolved state, authors, timestamps, or proprietary IDs.
- A compatibility layer for the proprietary comment format from the abandoned
  review branch; this branch starts from clean mainline and has no such format.
- Broad editor rewrites unrelated to native CriticMarkup support.

## Completion criteria

- All five standard constructs share one grammar owner and are native to the
  parser/editor/serializer pipeline.
- No regex sidecar or post-parser syntax rediscovery exists in production.
- Every behavior in "Definition of full support" is proven at the appropriate
  unit, real-DOM, desktop, and packaged-app level.
- The CommonMark/GFM conformance baseline does not regress.
- The running MarkText application exposes a coherent review workflow that
  looks and behaves like MarkText.
- The Markdown file contains only pure CriticMarkup and ordinary Markdown.
- Concurrent file editing remains untouched and is deferred to a later plan.
