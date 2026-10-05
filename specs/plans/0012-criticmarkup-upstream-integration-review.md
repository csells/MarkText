# Finish CriticMarkup through native MarkText reuse

- **Status:** Open. On 29 September the completion blockers were reconciled against the history since `27da397a` and the code at `99fceb6f`: most gap-analysis rows are fixed in source, while G35 (plain Markdown with links, code spans and non-paragraph blocks), G6, G12, G25, G42 and V2 remain open or partially fixed, and U1 stays open until they close. G15 (6ff15e0b, e0f48dde) and G43 (ca78e1d5) closed later that day. No final candidate is frozen: every row's verification evidence is pending the combined checkpoint and installed editorial pass on one frozen commit. Earlier results stay attributed to their original artifacts. E1/E2 remain external and D1 deferred.
- **Started:** 2026-09-07 at the owner's request following the branch review.
- **Supersedes:** [0011](archive/0011-criticmarkup-editable-review.md), archived incomplete. Its full product scope and unfinished requirements carry forward; archival is not completion.
- **Authority:** [vision](../vision/criticmarkup-vision.md), [domain language](../../CONTEXT.md), [Profile 1](../language/marktext-markdown-profile-1.md), [Markdown image-layout extension](../language/marktext-markdown-profile-2.md), semantic ADRs, [document authority](../adr/0001-core-document-authority.md), and [native integration architecture](../architecture/criticmarkup-native-integration.md).
- **Reviewed source:** `2f2a09d72a0c85227f31c0fb23b0c3bfecf946b7`, clean at review, compared with upstream HEAD `develop` at `33777a7abc435468201aec1b914c39f2b27e115d`. There is no upstream `main` branch.

## Outcome and retained scope

Deliver the existing MarkText editor with first-class CM1 authoring and review, using existing MarkText components and services wherever their responsibilities already fit. Fix the confirmed boundary failures instead of growing a parallel rendering, search, control or preference implementation. Keep the custom language core and current application shell.

The owner's 8 September restatement reaffirms the requirement already explicit in July:
deliver one unified stack from raw
parsing through the document model, editing, rendering and UI for every existing MT and
new CM feature. Follow the [unified-stack architecture](../architecture/criticmarkup-native-integration.md#one-parser-to-ui-stack).
No side data, parallel annotation model or supplemental metadata field repairs a
CM-unaware path. Existing native commands must operate through the shared model;
reparsing projected text and reconstructing intent from resulting diffs are mechanisms
to replace, not extend. This refines the existing plan and preserves its full scope.

All of 0011 remains in scope: the five canonical forms; continuous editing within and around annotations; cross-block, nested, literal, malformed, empty and Unicode semantics; isolated full Markdown/CM comment bodies and local references; tracked text, formatting and structural changes; per-item/bulk resolution; exact undo/redo, Source handoff and save/reopen. Preserve one canonical authority, mapped selection, bounded pending work, composition, stale rejection, durable full-draft recovery, pending-save barriers, tab isolation and authority restart (including the failure/recovery guarantees previously tested through Worker restart).

Retain the complete upstream editor contract: Markdown/media/widgets, keyboard/mouse/clipboard/drag/drop/search, file lifecycle and encoding/BOM/EOL, all exports, themes, focus/typewriter modes, preferences, accessibility, localization, native menus/commands and the existing left sidebar. Original/Revised remain single read-only projections. CM2 research stays on its separate research branch; metadata extensions, collaboration, an SDK and unrelated redesign are excluded.

macOS remains the implementation and verification priority. Windows/Linux requirements are deferred, not removed. Existing authorizations and data-preservation constraints carry forward; this plan does not itself request or newly authorize publication, PR submission or destructive operations.

## CURRENT completion blockers

On 29 September every row was reconciled against the git history since `27da397a` and the code at HEAD; each names the production path that now owns its behaviour. Every row's verification evidence is pending the combined checkpoint and installed editorial pass on one frozen candidate. R1–R8 were verified on the historical `5e5c6178` candidate. Later convention repairs are recorded below. The 20 September architecture review demonstrated U1 violations against the installed package and source; their migrations and fresh verification are recorded below. The full retained scope and release blockers remain open. Changed runtime inputs must not inherit earlier candidate verification.

| ID / violated requirement                                                                                                                                                   | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Responsible boundary and closure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1 — one parser-to-UI stack and faithful editing, open                                                                                                                      | Historical `eed5f5d9` (lost in the 24–25 September rebase) and `5a71228e` results are not reattributed. Since then the WYSIWYG and Source views are Core-only (0f52933f, a00b378d), Muya's native-operation reconstruction and the legacy `track`/`track-edits`/`markup-edits` submissions are retired (908d41d8, 95cb2590), comment payload spelling lives in document-core (6df8e8fa) and every Pandoc export reads Core's parse (26420d32). The remaining violations are the open and partially fixed rows below. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | U1 stays open until the open and partial rows below close and the combined checkpoint and installed editorial pass pass on one frozen candidate, within the owner's local-macOS scope. Preserve the completed migrations and all retained requirements; a passing subset or one durable save authority does not establish completion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| U2 — window ownership and pending-input preservation, locally verified on earlier artifacts                                                                                 | The user-reported zero-tab close failure was reproduced on the installed `eed5f5d9` (lost in the 24–25 September rebase) bundle in six scenarios. Candidate `02003385` passes all 16 installed lifecycle cases (six formerly failing close/Quit paths, two empty-state New File/reopen/history/save cases, eight existing pending-input/cancel/incoming-open cases), plus 294 affected unit tests. A held-retirement regression also proves newer document reload/recovery registrations survive cleanup. Earlier-artifact results are not reattributed. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | The common owner now lives across the window’s empty state; native input surfaces require a live document. Only retired actors relinquish handlers. The later `5a71228e` bundle reruns all 16 close cases, is installed in Applications and reopens the existing session. Missing-owner, composition and recovery refusal guards remain. Native screenshot-picker/CJK interaction remains E1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| V1 — sustained candidate verification, locally verified on earlier artifacts                                                                                                | Historical `eed5f5d9` (lost in the 24–25 September rebase) passes all six 1,200-input workloads, 15 cold opens, 82 installed functional cases and the full 200-cycle real-Paste editorial workload. All 20 saved-source checkpoints and the final fixture hash match. The final runner exits successfully in 151.703 seconds; the test deadline remains 180 seconds and pacing 20 ms. Earlier-artifact results are not reattributed. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | The sustained gate passed on `eed5f5d9` (lost in the 24–25 September rebase); the affected installed lifecycle gate for `02003385` is recorded below. Broad and sustained counts are not reattributed to the new artifact. Clipboard restored; owned apps closed. Prior timeout and clipboard interruptions remain separate retained evidence. The final pass uses the same runtime, original workload and guard after other clipboard activity was paused; no runtime change or weaker limit was introduced.                                                                                                                                                                                                                                                                                                                                                                       |
| B1 — Save As destination ownership, locally verified on earlier artifacts                                                                                                   | Final `5a71228e` passes all five installed Save As cases: same-window/cross-window/symlink collisions, ordinary closed-file overwrite and simultaneous missing case-alias destinations. Exact source, next edit, history and save are checked. The final concurrent fixture remains red on `1f7297b8`. Earlier-artifact results are not reattributed. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Shared save/rename destination ownership is checked before writes and held through registration; physical aliases and filesystem case policy are respected. Post-write tab eviction is retired. Affected caller units pass 43/43.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| B2 — focused-control history, locally verified on earlier artifacts                                                                                                         | Final artifact passes all ten focused Find/palette/Review-comment cases through native Cmd+Z/Cmd+Shift+Z and Edit-menu routes, including Source, exhausted control history and exact document saves. Earlier-artifact results are not reattributed. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Ordinary controls retain native history; Muya and CodeMirror retain common document history. Subsequent document input and Undo/Redo remain verified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| B3 — everyday desktop workflow verification, locally verified on earlier artifacts                                                                                          | Final artifact passes mixed Close All/Close Others cancellation, full folder creation, two-window dirty/untitled restoration, Preferences persistence, real disk reload in both modes and palette execution. Real macOS Open/Save As selection/cancellation and next input/save preserve independent exact source. Earlier-artifact results are not reattributed. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Durable installed regressions and actual OS sheet execution close these listed gaps. Native screenshot picker, CJK and Intel execution remain separately recorded in E1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| B4 — multiple-file startup owner, locally verified on earlier artifacts                                                                                                     | Final four-file startup test preserves immediate typing, common-model history and exact save. All 16 installed close cases pass alongside it. A held-save/background-tab/switch component regression covers the demonstrated overlap. Earlier-artifact results are not reattributed. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Active Markup ownership survives tab-collection-only changes; retirement follows actual closed actors and the owned projection, preserving live histories and Source handoff.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| B5 — Source Find/Replace, locally verified on earlier artifacts                                                                                                             | Final native Find/navigation/next-key and Replace regex/single/all/CRLF/history/save cases pass, plus both Source Find focused-history routes. Edit → Replace now actually focuses the shared query control. Earlier-artifact results are not reattributed. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Source reuses existing Search UI/query policy and canonical source positions; replacements enter existing pre-change common-model operations. Misrouted hidden Markup search handlers are retired in Source.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| G1 — retain unfinished comment input, fixed at fca1da38                                                                                                                     | Red on installed `5a71228e`: an edited comment draft disappeared on tab switch or Source handoff. fca1da38 moved composer state to the document: `editorWithTabs/index.vue` keeps one `CoreReviewComposerState` per document id (`commentComposerFor`) and passes it to `editor.vue`; `store/editor.ts` `confirmReviewInputDiscard` asks through `mt::confirm-discard-review-input` (`main/menu/actions/file.ts`) before tab close, window close or Quit. c3de0501 added the card position (`entryStart`, `draftStart`) to the same state. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Composer state (`coreReviewComposer.ts`) belongs to each document in `editorWithTabs/index.vue`, not the mounted editor; the editor-local composer survives only as the fallback when no state is passed. Tab close, window close and Quit with an open composer ask Discard and Close/Cancel; Cancel keeps the draft. Nothing remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| G2 — Original/Revised read-only command policy, fixed at fca1da38                                                                                                           | Red on installed `5a71228e`: Replace, Bold, Duplicate and Delete Paragraph changed saved bytes in reader modes. fca1da38 added `editor.vue` `markupEditingAvailable` (Markup view and not Source), which guards `handleUndo`, `handleRedo`, `handReplace`, `handleEditParagraph`, `handleParagraph`, `handleInlineFormat`, `handleInsertParagraph`, `insertImage`, `handleScreenShot`, `replaceMisspelling` and paste as plain text; its watcher sends `mt::set-editor-format-menus-enabled`, and the Find bar (`search/index.vue`) takes `replaceAvailable` from it. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | One `markupEditingAvailable` predicate in `editor.vue` gates every mutating Markup command handler; Format/Paragraph menus and Edit mutators are disabled natively through `main/menu/index.ts`; the Find bar keeps search and hides replacement. Review resolution uses the same rule through `ReviewCommandState.editable` (G13). Nothing remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| G3 — Source admission before presentation, fixed at fca1da38                                                                                                                | Red on installed `5a71228e` and in five unit regressions (including input immediately after Undo). fca1da38 made `codeMirrorCoreAdapter.ts` collect each native operation in `nativeOperationEdits` from the Doc `change` handler and enqueue it once every live capture has drained, before CodeMirror paints; `isSettled` counts undrained native edits, and history commands throw rather than overlap pending input. The adapter has not changed since; a00b378d later made Source view Core-only. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `codeMirrorCoreAdapter.ts` owns admission from the Doc `change` drain (`onChange` → `enqueue`); the editor-level `changes` submission is retired. History presentation applies synchronously when no native operation is pending. Nothing remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| G4 — native inline presentation, fixed at fca1da38                                                                                                                          | Red on installed `5a71228e` (literal math and tags); repair exposed that a selection inside inline math or a code span was rejected as a stale barrier and remounted the editor. fca1da38 presents Core `inline-math` and `inline-html` nodes through Muya's `renderMath`/`renderHtmlTag` in `muyaMarkupPresentation.ts`, projects a partially selected literal leaf's source characters in `muyaModelSelection.ts`, and gates authoring on `authorFormsAtBarrier` (`editorCoreBinding.ts`, `coreDocumentSessionManager.ts`). Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Core inline nodes are presented through Muya's native math and HTML-tag renderers with decoded attributes from document-core. `editor.vue` sets authoring forms only from Core's `planAuthor` via `lease.authorFormsAtBarrier(range)`; the remount path that let the literal-context case pass is gone. Nothing remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| G5 — emoji semantics across consumers, fixed at fca1da38                                                                                                                    | Red on installed `5a71228e` and in a unit regression against the renderer. fca1da38 made `markdownProjectionHtml.ts` present a closed text node's parser-owned `emojiValue` (`emojiClosed`), shared by reader modes, sidebar comments and Export as HTML; `muyaMarkupPresentation.ts` reads the same attribute. Pandoc output, rebuilt from Core's parse by 8231fb50 and 26420d32, takes it through `pandocExportProjection.ts`. Code, escapes and unknown aliases stay literal. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | document-core owns emoji recognition; `markdownProjectionHtml.ts` presents `emojiValue` for readers, comments and HTML export, and `pandocExportProjection.ts` for Pandoc formats. No consumer re-parses aliases. Nothing remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| G6 — durable CI regression selection, partially fixed at fca1da38, 8e0c208a                                                                                                 | fca1da38 replaced the per-spec lists in `.github/workflows/build.yml` with `--project=installed-functional`; 8e0c208a pointed every job at the package-root `packages/desktop/playwright.config.ts`. That project matches `**/installed-*.spec.ts` plus the image-size, window-close and (7eab9e92) orphaned-recovery specs, and ignores `installed-core-performance.spec.ts`; `test/unit/specs/e2e-project-discovery.spec.ts` guards the selection. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | The `installed-functional` project in `playwright.config.ts` owns selection, so new `installed-*` specs join every build and reverify job without workflow edits; performance workloads keep their own project and limits. Remains: no observed hosted CI run of this selection (outside the owner's local-only scope for this pass).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| V2 — vision acceptance pass, partially fixed at 9681efea                                                                                                                    | `installed-editorial-pass.spec.ts` (9681efea, extended by 9e214f79) drives the installed app through real menus, gestures, keyboard, sidebar and file lifecycle: open an annotated and an ordinary document; read comments in the Comments and Suggestions tab; the selection gesture × entry point × form matrix with ⌘Z; card-composer comment editing; Docs-style tracked editing; Next/Previous; resolution with keyboard and Edit menu undo/redo; Original/Revised/Source; save, close and reopen; CRLF+BOM no-op save; close prompts; crash restore; external reload; HTML/PDF/Word export. It runs in the `installed` Playwright projects. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | The acceptance pass is now written as an installed spec. Remaining: run it on a frozen installed candidate and record the result; no readiness claim until it passes. Findings from the UI and architecture audits against the vision still join this table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| G7 — selection tools for multi-paragraph selections, fixed at 9e98b262                                                                                                      | Real-gesture probe on `b95e9f9f`: a selection spanning paragraphs hid the floating toolbar. 9e98b262 made Muya's `ui/inlineFormatToolbar/index.ts` show the host's actions only (`_showHostActionsOnly`) for a non-collapsed cross-block `selection-change`; 2092ecec drew them as icons; c2560431 emits `muya-format-picker` when menu Select All grows a selection to its block (`selection/index.ts` `selectAll`). `editor.vue` supplies `inlineToolbarActions` (Add Comment, Highlight for Review, Mark as Addition, Suggest Replacement) with `reviewCommandEnabled` state. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Muya's inline format toolbar owns the display; `editor.vue` `inlineToolbarActions` owns the actions and redraws on `inline-toolbar-actions-change` (e9772a89 keeps it current after undo). Single-paragraph selections keep the full formatting toolbar plus review icons. Nothing remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| G8 — context menu authoring actions, fixed at 9e98b262                                                                                                                      | The context menu offered only Accept/Reject/Remove/Edit Comment for existing annotations. 9e98b262 made `main/contextMenu/editor/index.ts` append Add Comment, Highlight for Review, Mark as Addition and Suggest Replacement beside Cut/Copy/Paste whenever text is selected, built by `reviewMenuItems` so they carry the menu bar's enabled state; annotation commands from the renderer's `ReviewContextReply` follow, skipping any the selection already offers. dc663887 offers Add Comment on a standalone highlight. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `main/contextMenu/editor/index.ts` owns the menu; enabled state comes from `main/menu/actions/review.ts` `reviewMenuItems` and `common/commands/review.ts` `reviewCommandEnabled`, and annotation actions run through `mt::editor-review-context-action` (`editor.vue` `handleCoreContextAction`). Nothing remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| G9 — Review menu placement, fixed at 9e98b262                                                                                                                               | Review commands existed only as the Format → Review submenu. 9e98b262 added `main/menu/templates/review.ts`, a top-level Review menu registered after Format in `templates/index.ts`, grouped as authoring, Track Changes, Previous/Next, Edit Comment/Accept/Reject/Remove/Accept All/Reject All, Markup/Original/Revised and Show Comments and Suggestions; the Format submenu was removed. 039df01a restores its state when a theme or language change rebuilds the menu. 2092ecec added shortcuts; 55150b03 dropped the default Accept/Reject ones (G33). Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `main/menu/templates/review.ts` owns placement and grouping; items and state come from `main/menu/actions/review.ts` (`reviewMenuItems`, `updateReviewMenu`, `restoreReviewMenu`) fed by `mt::review-command-state`. The Format → Review submenu is retired. Nothing remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| G10 — Review command state after keyboard selections, fixed at e6c56ab5                                                                                                     | Probe: Add Comment was enabled after a cross-paragraph drag but disabled after Shift+arrows or ⌘A, because Muya committed cross-block selections only from mouse events. e6c56ab5 added a `keyup` handler in Muya's `selection/TextSelection.ts` that commits a cross-block keyboard selection, so `selection-change` reaches `editor.vue` `coreAuthorSelection` and `authorFormsAtBarrier`; whole-document Select All commits through `selectAllContent` → `setSelection`. c2560431 covers menu Select All within one block. 4344e83f runs every gesture against every entry point. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Muya's `TextSelection` commits every gesture's selection; `editor.vue` derives `authorForms` from Core's `planAuthor` for that range, so the Review menu, context menu, toolbar and palette share one state. ff6ffa59 keeps such selections through navigation keys and Escape. Nothing remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| G11 — lossless edits versus upstream table re-padding, superseded by G24 (owner decision 25 Sep), implemented at 88af24f9                                                   | The 25 Sep owner decision (G24) settles the conflict for Principle 2: an untracked cell edit no longer re-pads its table. `planInput` (`document-core/src/inputPlanning.ts`) returns a table-cell plan unspelled; only `tableCommands` (insert/remove/move row or column, alignment) and a table made by Enter reach `respellTableResult`. ADR 0007 records the explicit-command exception (0caf73f7); cells beyond the header stay as written (e40a5705). Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Closed by G24's decision and 88af24f9; no separate architecture audit remains. Retired: re-padding on every untracked cell edit. Remaining work, if any, is tracked under G24.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| G12 — Instant evidence on current code, open                                                                                                                                | No ratification run since 26 Sep: `specs/baselines/criticmarkup-performance-measurements.json` still reads `awaiting-raw-runs` (last changed 9183e55f, 24 Sep). Later perf commits (regional reparse and presentation, e.g. 14a3cb4c, 743bd7ac, 4f618fac, ad75601e) and new warm-workload specs change the measured code but record no `run-installed-core-performance.sh` result. Earlier runs: first blocked by the recorded OS, second stopped at sample 101/1,100 when macOS moved the hidden window. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Rerun `run-installed-core-performance.sh` on an idle Mac on the final committed candidate when the owner schedules it, and write the raw runs into the measurements file; the targets must stay the approved ones (`a2841f03`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| G13 — resolution target clarity, fixed at 0244539a                                                                                                                          | UI audit on `6e806726`: Accept acted on an unmarked item far from the caret and worked in reader views. 0244539a added `targeted` and `editable` to `ReviewCommandState`: `common/commands/review.ts` `reviewCommandEnabled` enables Accept/Reject/Remove/Edit Comment only with a targeted item in Markup. `editor.vue` sets `coreReviewTargeted` in `revealCoreReviewItem` (outline `core-review-current-block`) and `clearCoreReviewTarget` clears target and outline when the selection moves into plain text or a reader view opens. 27da397a targets a suggestion the caret touches. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `common/commands/review.ts` owns enablement; `editor.vue` owns the target (`revealCoreReviewItem`, `clearCoreReviewTarget`, `coreItemAtCaret`), and the sidebar marks the active card only while targeted. b5d7e679 (G37) places the caret on a Previous/Next target. Accept All/Reject All stay enabled on any item. Nothing remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| G14 — passive clicks open Review, fixed at 71e5b3af                                                                                                                         | A click in any annotation opened the hidden sidebar on Review via `selectCoreAnnotationAt(start, true)`. 71e5b3af made `editor.vue` `selectCoreDocumentAnnotation` pass `open` only for keyboard activation of a comment marker, so a pointer click selects the entry without `SET_LAYOUT`. b5d7e679 limited opening to Show Comments and Suggestions and the composers. abbebe2e and 99fceb6f add `coreReviewRevealRequest`, so a click asks an open sidebar (`CoreReviewList.vue`) to scroll the selected card into view without moving focus. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `editor.vue` `selectCoreDocumentAnnotation` → `selectCoreAnnotationAt(start, event instanceof KeyboardEvent, true)` owns the rule; `CoreReviewList.vue` owns card reveal. The sidebar opens for Show Comments and Suggestions, Edit Comment, new comment or replacement composers, card clicks and Enter/Space on a comment marker. Nothing remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| G15 — author state for every selection, fixed at e6c56ab5, c2560431, 7677924b, 6ff15e0b, e0f48dde                                                                           | Keyup commits Shift+arrow and select-all selections across paragraphs (e6c56ab5); menu ⌘A shows the toolbar (c2560431). Every entry point asks Core over one range: `editor.vue` `coreReviewAuthorForms` → `adapter.selectionSourceRange` → `authorFormsAtBarrier` → `coreActor.ts` probes `planAuthor` (`document-core/src/authorPlanning.ts`). Add Comment works inside a highlight or commented text (7677924b); the palette marks disabled commands (e9772a89). `planAuthor` now authors Highlight, Mark as Addition, Suggest Replacement and Add Comment inside any arm of an Addition, Deletion, Substitution (either arm), Highlight or Comment payload, and over whole annotations, as Profile 1 N1/N2 admit and Google Docs allows (6ff15e0b; `author-planning-nesting.spec.ts`). The shortcut of a disabled Review command beeps (`shell.beep()` from main's `before-input-event`) and leaves focus in the editor (e0f48dde; `review-shortcut-beep.spec.ts`, `criticmarkup-review-nested-authoring.spec.ts`). Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Closed. Forms that stay disabled, each by proper nesting (Profile 1 §6.1: pairing is properly nested, so no annotation crosses another's delimiters): Highlight, Mark as Addition and Suggest Replacement over a selection that partly overlaps any Addition, Deletion, Substitution, Highlight or Comment; Add Comment over a selection that partly overlaps an Addition, Deletion, Substitution or Comment. Add Comment partly over highlighted or commented text widens to enclose it, as Docs' overlapping comments do.                                                                                                                                                                                                                                                                                                                                                         |
| G16 — comment on an existing highlight, fixed at 7677924b, dc663887                                                                                                         | `planAuthor` (`document-core/src/authorPlanning.ts`) routes a comment on text in a standalone highlight to `planHighlightComment`, which inserts a gapless `{>>…<<}` at the highlight's end and proves the pair forms; in a commented passage it nests a new pair (7677924b). `editor.vue` offers Add Comment for a caret in a standalone highlight (`coreReviewAuthorForms` → `['comment']`), on the highlight card (`commentOnCoreHighlight`) and in the context menu (dc663887); real-gesture E2E 714fa66f. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | A standalone highlight takes Add Comment from the toolbar, context menu, Review menu, palette, shortcut and its card, making one commented span. Retired: removal-only card and context menu for a standalone highlight.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| G17 — themes, fixed at 2092ecec                                                                                                                                             | Review cards take the sidebar tokens: `CoreReviewList.vue` card buttons use a transparent background with `--sideBarColor`, the active card `--sideBarItemHoverBgColor` and `--themeColor`, comments `--sideBarTextColor`; card action buttons use the global themed `.button` (`--buttonBgColor`, `--buttonFontColor`). `criticmarkup-review-visual.spec.ts` "review cards follow every built-in theme" walks every entry of the Theme menu, not only Dracula. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Cards and their controls follow every built-in theme through the sidebar and button tokens. Retired: fixed light card backgrounds. The addition/deletion/highlight mark colours stay fixed tints over transparency, as in the editor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| G18 — accessibility semantics, fixed at 2092ecec, 2daf4d7a                                                                                                                  | `muyaMarkupPresentation.ts` `criticRole` gives additions and a substitution's new arm `role="insertion"`, deletions and the old arm `role="deletion"`, highlights `role="mark"`. The comment marker is named `Comment: <text>` from Core's comment projection (`commentMarkerName`, 2daf4d7a). `CoreReviewList.vue` `entryName` joins kind and excerpt as `Kind: text`. Review commands use Title Case in menus, toolbar, context menu and palette (2092ecec; 86a05b82 per locale). Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Insertion/deletion semantics, comment text as the marker's accessible name, separated card name parts and consistent command capitalization are in place. Retired: bare spans and the fixed "Comment" name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| G19 — Source-view and Pandoc exports, fixed at 82fe165d, 8231fb50, 26420d32                                                                                                 | `editor.vue` `handleExport` renders Styled HTML, PDF and Print from the lease's Core consumer projection (`coreProjectionAtBarrier` or `consumerProjectionAtBarrier`) through `exportStyledHTMLFromProjection` in either view (82fe165d). `store/editor.ts` `EXPORT_PANDOC` reads the save-barrier source (`withAuthoritativeSaveSource`) and `projectPandocExport` (`documentConsumers/pandocExportProjection.ts`) converts Core's Revised parse, or Markup for `.docx` with Word tracked changes and comments (8231fb50, 26420d32). Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Every export reads Core at the save barrier; `source-view-export-authority.spec.ts` exports after Source edits. Retired: the hidden Muya's `getMarkdown()` export, the stale `currentFile.markdown` Pandoc input, pandoc's gfm reader and the Markdown-input `exportStyledHTML` (abb7391e); its specs now exercise `exportStyledHTMLFromProjection`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| G20 — Muya parses the file without a Core view, fixed at ecd1fc05, 0f52933f                                                                                                 | `editor.vue` constructs Muya with `markdown: ''` unconditionally and installs only Core's Markup view (`installCoreMarkupPresentation` when `corePlainTextView` is present). `getSyntheticHistory` and the `coreRequired` prop are gone (ecd1fc05, then 0f52933f made the view Core-only: loading/tab-switch Markdown payloads, `json-change` store serialization, Muya search/copy/undo fallbacks and six parser preference watchers removed). Without a lease the view refuses search, copy, cut, paste and drop. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Core is the only parser of a document; Muya mounts empty and renders Core's projected state. Retired: Muya's first-open and Source-entry parse, the synthetic save-tracking history and the non-Core view branches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| G21 — retired engine still shipped, fixed at 149d76f0, 0f52933f, a00b378d                                                                                                   | `coreDocumentLaunchPolicy.ts` now decides only test controls; `MARKTEXT_DOCUMENT_CORE_MODE` and `_SHADOW` are ignored and no longer reach the renderer (149d76f0; `retired-engine-launch.spec.ts` sets both and expects the Core document). `shadowActor`, `shadowDocumentAuthority`, `workerShadowPort`, `editorShadowBinding`, `inMemoryShadowPort`, the Shadow worker and `muyaPlainTextView` are deleted; desktop drops `turndown`, `joplin-turndown-plugin-gfm`, `html-tags`, `underscore`. 0f52933f and a00b378d retire the WYSIWYG and Source Markdown fallbacks. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Core is the only launch; tests that pinned `CORE_MODE=1` no longer set it and Shadow specs are removed. Retired: fallback launch modes, Shadow modules, Markdown-only view variant, Source `markdownMathMode`/`sourceModeToc`. Muya keeps `turndown` for its live HTML-paste conversion (`clipboard/paste.ts`), which is not a retired path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| G22 — comment payload spelling, fixed at 6df8e8fa, b7b065df                                                                                                                 | Payload spelling lives in `document-core/src/commentSpelling.ts` (`commentPayloadCandidates`, `spellCommentPayload`, `planCommentEdit`); `coreActor.ts` edits a comment through `core.planCommentEdit` and authoring through `planAuthor`, with no desktop prefix/suffix assembly or escape regex (6df8e8fa). The composer shows the MarkText-only escaping disclosure while a draft needs it (`coreReviewComposer.ts` via `spellCommentPayload(...).escaped`, `CoreReviewCommentEditor.vue`), and `discloseCoreAuthorEscapes` notifies for every authored form (b7b065df). Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Comment-payload spelling is a document-core operation and ADR 0015's disclosure is shown whenever escaping applies. Retired: `coreActor.ts` `prefix + {>>payload<<} + suffix` construction with repeated reparses and the desktop backslash regex.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| G23 — a preference that changes Muya alone, fixed at b8d005b0                                                                                                               | `trimUnnecessaryCodeBlockEmptyLines` is retired from the desktop: its schema entry, Preferences switch, store field, `editor.vue` watcher and strings are removed; `code-block-trim-preference-retired.spec.ts` guards it. Core keeps unrelated code blocks byte for byte (ADR 0007), so the upstream trim would be a silent rewrite the owner has not ratified. A stored value is left untouched. Muya's own option remains a library default (`false`) the desktop never sets. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Retired with an upstream-parity justification recorded in b8d005b0 instead of mapped into Core. No desktop code reads the preference.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| G24 — typing never re-spells untouched source, owner decision 25 Sep (supersedes "pad like upstream"), implemented at 88af24f9                                              | `planInput` (`document-core/src/inputPlanning.ts`) leaves a table-cell plan unspelled; `escapeTableInput` (`tableRespelling.ts`) adds only pipe escapes and the one pipe an emptied edge cell needs, never re-padding. Only `tableCommands` and a table made by Enter reach `respellTableResult`. `typedLineBlockPlanning.ts` converts only the typed line; untouched lazy lines keep their bytes. Cells beyond the header survive (e40a5705); 1744ceb5/b935519a keep annotations from cutting cells. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Typing, paste, cut, formatting and joins change only their own bytes; explicit table commands re-pad as an explicit transformation and never drop cells. ADR 0007 lists the exception (0caf73f7). Retired: whole-table re-padding and per-keystroke paragraph re-spelling. ADR 0007's list Tab/Shift+Tab renumbering is a separate command.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| G25 — verification traceability and plan hygiene, partially fixed (rows reconciled 29 Sep)                                                                                  | `eed5f5d9` was lost in the 24–25 September rebase; U1, V1 and the other rows that cite it now say so, and its listed hashes remain its record. The measurements file still reads `awaiting-raw-runs`. U1's closure still waits on "hosted verification". The vision's document table (`specs/vision/criticmarkup-vision.md`) now lists ADRs `0013`–`0016`, Markdown Profile 2 and CriticMarkup Profile 2. The blocker rows were reconciled against `27da397a..HEAD` on 29 September (this section). Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Done: the vision's document table and the `eed5f5d9` citations. Remains: re-establish U1/V1 evidence on current commits in durable locations; restate U1/G6 closure for the owner's local-macOS scope; record G12's run when made.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| G26 — navigation keys delete a multi-paragraph selection, owner decision 25 Sep, implemented at ff6ffa59                                                                    | `shouldCrossBlockCut` (`muya/src/clipboard/index.ts`) now cuts a cross-block selection only for a typed character or `SELECTION_REPLACING_KEYS` (Enter, Backspace, Delete, Dead, Process), never with Cmd/Ctrl; Home, End, PageUp, PageDown, Escape, Tab, function, lock and media keys leave it, and Tab keeps focus. The same predicate gates the bound Core path. Recorded as a documented deviation from upstream. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Navigation keys and Escape keep or collapse the selection; only text input, Delete/Backspace, Enter, Cut and paste replace it. Retired: upstream's "any non-arrow, non-modifier key cuts" rule. Muya e2e `cross-block-navigation-keys.spec.ts` and desktop `criticmarkup-cross-block-navigation-keys.spec.ts` cover it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| G27 — Track Changes visibility, owner decision 25 Sep, implemented at 2092ecec                                                                                              | `titleBar/index.vue` shows a "Tracking" button (`title-bar-tracking`, `aria-pressed`) while `reviewStatus.tracking` is on; a click emits `review-command` `track-changes`. `keybindingsDarwin.ts` binds `review.track-changes` to `Command+Shift+E` through the shared keybinding registry, so it is rebindable. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The indicator and ⌘⇧E are in place as decided. The indicator appears only while tracking is on (click turns it off); turning tracking on stays in the Review menu, sidebar, palette and shortcut.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| G28 — reader-view identification, owner decision 25 Sep, implemented at 2092ecec                                                                                            | `editor.vue` renders `core-reader-banner` (`role="status"`) whenever Original or Revised is shown, reading "Original — read-only" or "Revised — read-only" (`editor.coreReview.originalBanner`/`revisedBanner`), with a Back to Markup button that runs `handleCoreReviewCommand('markup')`. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | The slim in-editor banner identifies the reader view with the sidebar hidden and returns to Markup, as decided.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| G29 — review command names, owner decision 25 Sep, implemented at 2092ecec, 86a05b82                                                                                        | Menus, toolbar tooltips and the context menu read `editor.coreReview.*`: Add Comment, Highlight for Review, Mark as Addition, Suggest Replacement, Accept All, Remove Comment or Highlight. Palette entries (`commands.review.*`) carry "Review:" and context, e.g. "Review: Next Change", "Review: Show Markup" (2092ecec). Every locale now names Highlight for Review apart from the `==mark==` Highlight format (86a05b82). Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Agreed names in Title Case across menus, toolbar, context menu and palette. Retired: "Mark Highlight" and bare palette names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| G30 — selection-toolbar review actions, owner decision 25 Sep, implemented at 2092ecec                                                                                      | `muya/src/ui/inlineFormatToolbar/index.ts` renders host actions that carry an icon as `ul.mu-format-host-icons` inside the same `div.mu-format-row` after the format icons. `editor.vue` supplies the four review commands with SVG icons (`reviewToolbarIcons`) and tooltips from `editor.coreReview.*`. A multi-paragraph selection shows only host actions (`_hostActionsOnly`, 9e98b262). Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Four icon actions with tooltips in the toolbar's single row; review-only for multi-paragraph selections (G7). Retired: the second row of text buttons.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| G31 — comment composer placement, owner decision 25 Sep, implemented at c3de0501                                                                                            | `CoreReviewList.vue` opens the composer in place: Edit Comment on the comment's own card (`composerStart`), and a new comment or replacement as a draft card among the entries in document order (`draftStart`, `draftIndex`). Other cards stay enabled and readable; ⌘Enter saves and Esc cancels, as in Google Docs. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | The edited card expands into the composer in place and the list is not dimmed, as decided (27 Sep Docs research). Retired: the bottom-of-list composer that disabled every card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| G32 — duplicate review UI, owner decision 25 Sep, implemented at 2092ecec                                                                                                   | The Review sidebar holds only view buttons, Track Changes, previous/next, per-card resolution and bulk actions; no author strip remains. The title bar has no "Review" text button, only the Tracking indicator (G27). Authoring runs from the toolbar icons, context menu, Review menu, palette and shortcuts; the sidebar opens from its tab, the Review menu ("show") or a composer. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Both duplicate surfaces are removed as decided. The highlight card's Add Comment (G16) is a per-item action, not an author strip.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| G33 — review shortcuts, owner decision 25 Sep (revised 27 Sep), implemented at 2092ecec, 55150b03                                                                           | `keybindingsDarwin.ts` binds `review.next` ⌥⌘], `review.previous` ⌥⌘[, `review.track-changes` ⌘⇧E and `review.add-comment` ⌘⌥⇧M; every other review command is registered with an empty default, so all are rebindable. Accept/Reject defaults (⌥⌘A, ⌥⌘R) were dropped (55150b03); `keybinding-default-conflicts.spec.ts` rejects duplicate default accelerators per platform. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Shortcuts as decided and revised for Google Docs parity; Accept/Reject remain in the Review menu, context menu and palette. Retired: the ⌥⌘A/⌥⌘R clashes with Edit → Screenshot and dev reload.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| G34 — tracked edits over existing suggestions, fixed at 9983555c, 63dd3f77, fb02b111                                                                                        | Red on `27da397a`: a second tracked Backspace after `hell{--o--}` hit `author-invalid` and faulted the adapter. Core now plans edits over deleted text, old arms and syntax as Google Docs does (`trackedHistoryEditing.ts`: `mergedTrackedDeletion`, `substitutionBeforeDeletion`, `trackedEditableSpans`, used by `documentCore.ts` and the input, clipboard and format planners), and `coreActor.ts` answers any tracked input or clipboard action Core cannot plan as an applied no-op keeping the selection (`trackedUnplanned`/`trackedUnchanged`). Added `tracked-differential-fuzz.spec.ts` and E2E `criticmarkup-tracked-google-docs.spec.ts`. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Closed by Docs-parity planning in Core (repeated Backspace/Delete extend one deletion, struck text beside the caret is stepped over, typing before a deletion merges into one Substitution, a replacement enclosing a deletion keeps it, format over deleted text is a no-op) and by the actor never rejecting tracked input as `author-invalid`. Retired: the refusal branches for deleted text, old arms and syntax, and the specs that pinned them. The seeded tracked-vs-untracked differential fuzz covers single-line ranges.                                                                                                                                                                                                                                                                                                                                                 |
| G35 — tracked typing and Enter reparse the whole document, partially fixed (vision principle 6)                                                                             | Keys are now planned and applied on the paragraphs around the caret: typing (including after the last suggestion and at a suggestion's edges), Enter, joins, and tracked Backspace/Delete among suggestions (1611fda4, fd710e7d, e645063d, 70fc4613, 47fdfb12, 8302d2d8, 26e46b21, 4fe80bd1), documents with stray markers (d40a61fa) and keys no specialised planner knows (4f618fac), through `documentCore.ts` regional apply and `regionalInventory.ts`. Planners and passive readers take only the annotations around the key or the replaced blocks (b0d91431, b5670399, 7157f810, c0eaa518); the overview, counts and outline are patched from each change (`coreReviewOverview.ts`, `coreConsumerSummary.ts`). Documents open up to 524,288 logical nodes (f18028f2). From 29 September to 2 October (`dd1f0861`..`e8789f2d`) every ordinary block, list item, long literal block's line and suggestion arm's literal line became a regional leaf, tracked candidates are validated from the blocks they change, and Muya redraws a long code block in place with reused and prefiltered Prism tokens; see "29 September – 2 October performance work". Verification evidence: pending the frozen candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Presentation follows the change: the Markup view keeps unchanged roots (`muyaMarkupViewRoots.ts`, f93a4381), the Review list mounts only cards near its view and the passive refresh runs in idle time (9a31aa8a, ad75601e); warm workloads include dense-2000-tracked and dense-2000-tracked-refresh (6343069e, 994896f3). Open, not accepted, at `e8789f2d`: fence-2000-inside and links-code-2000 echo runs are bimodal (p95 13.0–14.9 ms or 17.2–21.5 ms at the same load); enter-plain-1000-tracked settles at p95 85 ms against 50; tracked keys in the seeded sweeps still exceed 100 ms (fixer N, in progress). A key in a label a definition resolves still takes the one parse `apply()` publishes (0c6b3765). The per-key Chromium `setBaseAndExtent` selection update at dense-2000 is a shared Markdown/CriticMarkup editing-host cost, per fixer L's parity evidence. |
| G36 — review command state goes stale, fixed at e9772a89, 039df01a                                                                                                          | `editor.vue` now refetches author forms when either `coreAuthorSelection` or `coreDocumentRevision` changes (keyed by revision and range, so ⌘Z after Add Comment re-enables authoring), and closing the composer clears `coreAuthorInvocationSelection`. Every `coreReviewCommandState` change emits `inline-toolbar-actions-change`, which Muya's `inlineFormatToolbar` redraws on. Palette commands carry `enabled: () => reviewCommandEnabled(...)`; the palette dims and refuses a disabled one and returns focus to the document first. A menu rebuilt by a theme, language or keybinding change restores its window's last review state (`main/menu/actions/review.ts`). Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Closed by revision-keyed author forms, toolbar redraw on review-state change, palette enablement and focus return (e9772a89), and menu review-state restore on rebuild (039df01a). Retired: the selection-only equality skip in the author-forms watcher and the toolbar drawing review actions only when it opened. Tests: `criticmarkup-review-command-state.spec.ts`, `reviewGestures.ts`, `review-menu-restore.spec.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| G37 — navigation and panel behaviour (Google Docs parity), fixed at b5d7e679, abbebe2e, 99fceb6f                                                                            | `handleCoreReviewCommand` no longer opens the sidebar for every command; only `show`, the comment and replacement composers, and choosing an entry or annotation open it. `navigateCoreReview` navigates from the caret (`coreCaretSource`) or the current item and `placeCaretAtCoreReviewItem` puts the caret at the item's start with focus in the document; Accept/Reject leave the caret. Muya's `Editor.focus` sets `activeContentBlock`, so Focus mode undims the target. `CoreReviewList.vue` with `reviewCardReveal.ts` scrolls the least that shows the selected card, including on a repeat click of its annotation. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Closed by opening the panel only on request, caret placement on Next/Previous (b5d7e679), and Docs-style card reveal on selection and on re-click (abbebe2e, 99fceb6f). Retired: the unconditional `SET_LAYOUT({ showSideBar: true })` before every review command and outline-only navigation. Tests: `criticmarkup-review-command-state.spec.ts`, `criticmarkup-review-card-reveal.spec.ts`, `review-card-reveal.spec.ts`, `core-review-list-component.spec.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| G38 — End after a trailing addition, fixed at 208ff2da, ff064ab6, 3a33d4c0                                                                                                  | Muya's `lineEndKey` handler in `documentEditing.ts` (⌘→ on macOS, End elsewhere) lets the browser move, then asks the model's `lineEndStep`; the desktop answers with `lineEndStep` in `muyaModelSelection.ts` (`muyaLineEndStep`), which returns the position after the outermost closer of every annotation that ends the line, including nested arms (payload-boundary markers map to the annotation's exterior) and a caret the browser leaves beside a trailing comment marker. Untracked typing after ⌘→ in `Alpha {++beta++}` lands outside the addition; with Track Changes on it still extends one's own trailing addition, as Docs does. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Closed per the owner decision of 23 Sep (the visible line end is after trailing annotations' closers) by the model-owned line-end step (208ff2da), nested trailing annotations (ff064ab6) and element-boundary points beside comment markers (3a33d4c0). Tests: `muya-annotation-line-end-caret.spec.ts`, `criticmarkup-review-command-state.spec.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| G39 — Highlight+Comment adjacency and authoring escapes, fixed at 7b38ef79, dbe488fd, b7b065df, 96f8526e                                                                    | `commentedSpans.ts` owns the pair rules. `commentedSpanSafeInput` and `commentedSpanSafeClipboard` (applied in `documentCore.ts` input, paste and `moveText` planning, tracked or not) move a collapsed Markup insertion off a commented span's gap and hidden edges: end and gap lead after the Comment, start before the Highlight. `commentPairPreservingResolution` (Core single-item resolution and the actor's Accept/Reject All) leaves a standalone Comment when resolution empties the Highlight and never forms a new pair. `coreActor.ts` returns `escaped` with the author result and `editor.vue` notifies for every authored form. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Closed by Core-side gap protection (7b38ef79), pair-preserving resolution (dbe488fd) and disclosure of MarkText-only escaping for every form (b7b065df); 96f8526e moved the rules from a Profile 1 V6 rule to Profile 2's editing notes, keeping Profile 1 at 44 rules. Retired: reliance on desktop caret mapping to keep typing out of the gap. Source-view edits are not redirected and keep the typed bytes (ADR 0015). Tests: `commented-span-edges.spec.ts`, `core-resolution-comment-pairs.spec.ts`.                                                                                                                                                                                                                                                                                                                                                                         |
| G40 — Pandoc export, fixed at 8231fb50, 26420d32                                                                                                                            | Red: Pandoc read raw source through `gfm` (`{~~a~>b~~}` became `{<del>a~>b</del>}`). `EXPORT_PANDOC` in `store/editor.ts` now calls `projectPandocExport` (`documentConsumers/pandocExportProjection.ts`), which builds Pandoc's JSON AST from Core: the Revised projection for every format, and for `.docx` with CriticMarkup the Markup view as Word insertions, deletions and comments. Main's `toPandocJson` wraps it with the running pandoc's API version and `pandoc.toFile` spawns `-f json` only; front matter becomes metadata from YAML with values read by Core; list delimiters come from the parse (5c3c322f). HTML, PDF and Print render Core's consumer (Revised) projection. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Closed by feeding Pandoc a Core-built AST (8231fb50, then 26420d32 for every format). Retired: raw source and flattened Markdown sent to pandoc's `gfm` reader, the reader configuration and preferences in the payload, and Markdown rereads for media and front matter. Tests: `pandoc-export-ast.spec.ts`, `pandoc-export-projection.spec.ts`, `pandoc-export-tracked-changes.spec.ts`, `pandoc-export-formats.spec.ts`, `pandoc-export-core-ast.spec.ts`. Changes and comments carry pandoc's default author.                                                                                                                                                                                                                                                                                                                                                                   |
| G41 — lossless no-op save, fixed at d7f2b7f8, 4453653c, 9c3d3290, 6e967be2                                                                                                  | `main/filesystem/markdown.ts` keeps a per-path disk baseline (digests of the loaded text and bytes, encoding, BOM, line-ending options, `isLossyDecode`); saving unchanged text under unchanged options re-reads the file and, when its bytes still match, writes them back unchanged. Mixed endings are still normalized to LF on load, as upstream does, but a no-op save restores the original bytes; an edited save takes the announced ending. `LF_LINE_ENDING_REG` is `/(?:^\|[^\r])\n/`. `encoding.ts` decodes ced's SJS, ISO-8859-1 and Mac Roman guesses in their own encoding and reports lossy decodes; the tab warns and an edited save asks before replacing undecodable bytes. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Closed by byte write-back on no-op save and consent for lossy decodes (9c3d3290), the leading-LF regex fix (d7f2b7f8) and legacy-encoding mapping (4453653c). Retired: unconditional re-encoding of decoded text on every save. Tests: `markdown-file-bytes.spec.ts` (BOM, UTF-16 LE, truncated UTF-16, CRLF, mixed, invalid UTF-8, leading LF, changed or deleted file on disk), `lossy-decode-save-consent.spec.ts`, `lossy-decode-tab-notice.spec.ts`, `encoding.spec.ts`, E2E `lossless-noop-save.spec.ts` (6e967be2).                                                                                                                                                                                                                                                                                                                                                          |
| G42 — retired-path residue, partially fixed at 95cb2590, 908d41d8, c281d05d, d8933298, 712f21bd, 15aaeea7, 0f52933f, a00b378d                                               | The actor protocol has no `track`, `track-edits` or `markup-edits` kinds; tracked typing is `input` with `tracked` (95cb2590). `coreRequired` is gone: WYSIWYG (0f52933f) and Source (a00b378d) are Core-only, and the store no longer ingests view Markdown (b59ff91f, 0baf9e47). `rebaseMarks` string diffing is gone (c281d05d). `applyNativeOperation` is no longer exported (908d41d8). Ctrl+T/Ctrl+Y go through the model; other unmodeled types are prevented (d8933298). Save's suggested name comes from Core's headings (712f21bd); selection word counts read Core's Revised text (15aaeea7). `packages/muyajs` is still on disk and a workspace member via `packages/*`. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Closed except one item: delete `packages/muyajs` and its references (`eslint.config.js` entries, the `website-deploy.yml` path filter), scheduled post-0.20.0. Retired: the legacy submission kinds and `nativeReconciliation`, Muya's own document path and synthetic history, Source's markdown-math mode and heading regex, the store's snapshot ingestion and dead `file-changed`/`file-loaded` events, string-diff mark rebasing, `applyNativeOperation`, and main's heading regex for the file name.                                                                                                                                                                                                                                                                                                                                                                          |
| G43 — parser and undo-grouping divergences, fixed at 416c1dc2, 2cd0b089, 57e84f13, 44190738, 90f1de89, e1912365, fc244bcf, 2e180a43..8aecdb2b, 366c6224, a888d71f..ca78e1d5 | Profile 1 block parsing (`internal/profile1/markdownLaneState.ts`, `markdownParser.ts`) now reads `Foo\n-` as a setext heading, keeps one list across a blank after an empty item, ends paragraphs and indented code where a line opens a container, keeps marker-only lines in HTML blocks, and starts and ends GFM tables as micromark and marked do. `commonmark-upstream-parity.spec.ts` pins these cases; the two readings Core keeps from upstream are ledger rows D9/D10 in Profile 1 §2.2 (e1912365). Emoji, image, unlink, spelling, code-language and footnote commands go through `History.recordModelCommand`, joining upstream's one-second undo step (fc244bcf). The seeded differential is now in the repo (`document-core/test/differential/markdownDifferential.ts`, `pnpm --filter @marktext/document-core differential --count 6000 --seed 1`; 2e180a43). It compares Core with micromark 4.0.2 (plus the GFM table, strikethrough and task-item extensions) and marked 18.0.5, Muya's pinned parser. On seed 1, the documents where micromark and marked agree and Core differs fell from 294 to 7 (CommonMark) and 293 to 43 (GFM); seed 2 fell from 253 to 8 and 272 to 49. Fixed: fence closers after container markers and of shorter runs, unfinished reference definitions, list markers after a container opened on the same line, four-column indented `---`/`#` in containers, quotes reopened after a blank, code spans and links across container lines, table header, delimiter and pipe-less rows, unequal strikethrough runs, definition titles, empty-item lines ending a paragraph and lazy lines after a definition; the parity spec now pins 144 cases. Upstream readings kept are Profile 1 ledger rows D11–D13, with D9 scoped to a list item's own paragraph (7d0a1d42). A second pass (a888d71f..ca78e1d5) gave the lane GFM table state, paired code spans within one table cell, let a complete HTML tag on a lazy line interrupt the paragraph, let raw HTML and reference-link labels cross `>` markers, and narrowed D9 to where upstream Muya nests a marker; the ordered item's empty `[ ]` is its text, as upstream reads it (366c6224, D14). Seeds 1 and 2 now have 0 class (a) documents in both runs; every remaining difference is one where micromark and marked disagree. Upstream readings kept are ledger rows D9–D16. Verification evidence: pending final candidate. | Closed. The undo-grouping half closed at fc244bcf. The seeded differential (`pnpm --filter @marktext/document-core differential --count 6000 --seed 1`) reports 0 documents where micromark and marked agree and Core differs, on seeds 1 and 2; the rest are micromark/marked disagreements, with upstream's reading recorded in Profile 1 D9–D16.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| G44 — coverage gaps, fixed at 92ce2a4d, 9bfe4c2b, a8b8e5c0, 4c1705a8, 80b402f5, 9838d1b8, 7eab9e92, 4344e83f                                                                | Tests now exist for each listed gap. Unicode inside annotations: `unicode-annotations.spec.ts`, `muya-unicode-annotations.spec.ts`, E2E `criticmarkup-unicode-annotations.spec.ts`, aligned with Chromium's backspace unit (6b7c327b, production c37d615a). All 40 Profile 1 cases run against the facade in `profile-1-conformance-cases.spec.ts`, with no known nonconformance since R3b table-cell containment (1744ceb5). Malformed/empty E2E (80b402f5); cross-block, positive Accept/Reject All and real ⌘Z/⇧⌘Z (9838d1b8, production e731264c); orphaned-backup recovery in the installed project (7eab9e92); the gesture × entry point × form matrix with ⌘Z (4344e83f). The conformance map (`specs/baselines/criticmarkup-profile-conformance.json`, schema v2) now pins Profile 1, CriticMarkup Profile 2 and Markdown Profile 2 by sha256 and maps every Profile 2 rule (L2c, L1f, L2b, C3, V6; IL1–IL5, newly named in Markdown Profile 2) to the unit tests that execute it. Rules that lacked a test got one: L2c's escaped and innermost-token clauses, C3's Comment isolation and first-definition-wins, and the IL1–IL3 suffix grammar (`markdown-profile-2-image-layout.spec.ts`). `criticmarkup-profile-conformance.spec.ts` validates the committed map as-is in the desktop unit gate, rejecting a stale digest, an unmapped rule, or a test its spec does not define. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Closed by adding the listed tests; nested bulk resolution and R3b containment were fixed where the tests exposed them. The installed run of the matrix and of crash draft restore is in `installed-editorial-pass.spec.ts` (V2), and its results belong to V2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| E1 — native Mac input execution, external                                                                                                                                   | Local input sources expose U.S. keyboard only. Mini XCUITest previously failed before launch while enabling automation. Native CJK IME and the actual screenshot picker remain unverified. Current-head CI run `35676640048` passes its selected installed tests on Intel and Apple Silicon Mac runners; this adds Intel subset evidence, not native IME/picker or full final-candidate coverage. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Obtain non-disruptive native CJK input and picker execution; verify candidate selection/commit, history/save and capture. Chromium composition and completed-capture IPC do not substitute. Retain full platform verification scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| E2 — distribution trust, external                                                                                                                                           | Developer ID/notarization credentials are unavailable. Current ad-hoc signing verifies local integrity only. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Verify signed/notarized distribution and Gatekeeper trust when credentials are available.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D1 — Windows/Linux, deferred                                                                                                                                                | Historical Windows run `34068611204` once left the first saved file unchanged; ten repetitions passed without explaining it. Fresh current-head run `35676640048` fails Windows x64/ARM64 export image-URL assertions (`%7E` versus `~`) and a Linux annotated-list operation leaves an unexpected recovery draft. Later cases did not run after the first failure. Native Windows IME and final platform checks remain unfinished. Verification evidence: pending final candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Keep these failed verifications separate from local macOS repairs and from external signing/input dependencies. Preserve ARM64 installation fixes and investigate concrete failures when platform work resumes; no claim of platform completion follows from the Mac subset.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### 22 September vision gap review and red/green repair — locally verified

The owner requested that this existing plan record the fresh findings and that all
six be addressed through red/green TDD. Review baseline: clean
`6cbc5cbf172fd00e4a0faafe1bf07c3f7ecf5a7d`; installed artifact:
`5a71228e10f6e541e916b9a91adf2a06aef2707b`, ASAR
`d6e837de682142ec505af8f8ecb419c756d18997c0389c40361f0d471e09c7e9`.
The former differs from the installed snapshot only by previously verified
formatting changes. The common parser/model direction is retained. These gaps
reopen implementation completion under the
[one-parser-to-UI contract](../architecture/criticmarkup-native-integration.md#one-parser-to-ui-stack);
they are not external release exceptions or authorization for another architecture.

Retained pre-fix evidence:

- G1/G2: four private installed probes, JSON and screenshots under
  `/tmp/marktext-ui-review-8yvxaV/artifacts/`, with the caller fixtures in
  `/tmp/marktext-ui-review-8yvxaV/probe.spec.ts`. Draft loss concerns unsubmitted
  authored input, not corruption of an already-applied annotation. Replace changes
  actual saved bytes in Original and Revised.
- G3: `/tmp/marktext-native-audit-MRdaGl/source-timing-2.log` and
  `source-timing.spec.ts`. The native key and synchronous acknowledged-model read
  demonstrate the ordering violation; final source is correct.
- G4/G5: `/tmp/marktext-parser-gap-u8q7zmu6/installed-result.json`,
  `installed-markup.png`, `installed-revised.png` and bound-Muya probe output.
  The caret is outside the affected content, source bytes are unchanged and the
  actual sidebar comment participates. Export impact still needs caller proof.
- G6 and platform status: [current-head CI run 35676640048](https://github.com/csells/MarkText/actions/runs/35676640048).
  Mac x64/ARM64 selected suites pass; Windows URL-spelling assertions and a Linux
  unexpected recovery draft fail. Logs are retained under
  `/var/folders/6k/xzgngnms6jg4_z2l40y0_9vh0000gn/T/marktext-vision-gap-p7eqfpwj/`.

Each repair proceeds in vertical slices: a failing regression at the affected
production caller, the minimal common-stack repair, then the relevant existing
checks. Record exact commands/results, production ownership, retired paths and
candidate identity here before marking a gap closed. Keep failed attempts and
incomplete checks explicit. Tests use private profiles and scratch documents;
user sessions, data and clipboard are preserved. The existing sustained workloads
and limits remain unchanged; earlier passes are not reattributed to new code.

**G6 selection repair.** The pre-fix CI command's actual Playwright `--list`
output omits all five required desktop suites; the independent membership check
exits 1. The shared `installed-functional` project now discovers `installed-*.spec.ts`
and retains installed image-size/window-close checks, excluding only the existing
separately calibrated performance spec. All five build/reverify workflow commands
use that project; the focused Windows save diagnostic remains unchanged. The same
membership check exits 0 with eleven discovered files. Evidence:
`/var/folders/6k/xzgngnms6jg4_z2l40y0_9vh0000gn/T/marktext-vision-repair-iifhkvrw/ci-selection-red.json` and `ci-selection-green.json`.
This closes the selection defect, pending final local functional execution; it is
not a hosted CI pass. No workload, timeout, retry policy or performance limit changed.
New installed regressions inherit discovery through the same project.

**Repair record and candidate.** Codex's session ended at its usage limit with G1,
G3, G4 and G5 drafted and G2 not started; the work was completed and verified in a
follow-up session on 22 September. The candidate is the uncommitted working tree
over `6cbc5cbf172fd00e4a0faafe1bf07c3f7ecf5a7d` (the packaged `buildCommit` is that
HEAD), `dist/mac-arm64` ASAR
`5f9d87d0f1bad64d6a61c64b7dc32e380c6f52dbb96f6f959eabce9c37cae113`. It has not
replaced the Applications copy (still `5a71228e`).

Red evidence, each against the unchanged pre-fix artifact `5a71228e` or HEAD sources:

- Installed: the three G1 lifecycle cases, both G2 reader-mode cases, both G3
  admission cases and the three G4/G5 inline-presentation cases fail on their
  behavioral assertions.
- Unit: five G3 Source-ordering cases and the G5 emoji case fail with HEAD's
  `codeMirrorCoreAdapter.ts` and `markdownProjectionHtml.ts` restored; the
  formula-selection projection (ordinary and suggested math) returns `rejected`;
  the lease has no author-forms query.

Green on the candidate:

- Desktop unit 3,372/3,372 (304 files); typecheck clean; lint 0 errors.
- Muya 1,580/1,580 and CommonMark/GFM spec 1,347/1,347; document-core 1,347/1,347
  (both packages unchanged after these runs).
- Installed `installed-functional` 90/90 on ASAR `5f9d87d0…`, including every new
  G1–G5 case, the full installed interaction matrix, Save As, lifecycle,
  focused-history, basics and Source search.

Harness corrections, not product changes: the G1 specs targeted a missing
`-error` test ID and an `.el-notification` class the notice service never renders;
the G4 HTML case now clicks into the element before double-clicking the word,
as a user would once the revealed tag syntax settles. A native-Muya Chromium
probe confirmed that clicking a formula preview selects its content, so the G4
formula case is a genuine regression check rather than a harness artifact.

Retired or replaced paths: CodeMirror `changes`-event submission (G3); the
reader-mode gap in Source-only command guards (G2); projection text that ignored
`emojiValue` (G5); rejection of partially selected literal leaves and its
misreport as a stale barrier (G4); authoring availability inferred from any
non-empty selection (G4).

Still open or unperformed: hosted CI for this candidate; the sustained
`installed-core-performance` workloads were not rerun on it; Undo/Redo menu items
remain enabled in reader views because focused controls still use them (document
history is refused by the Markup command gate); E1, E2 and D1 are unchanged.

### 23–24 September unpacked E2E remediation — locally verified

The owner required every failing case fixed, including failures already present
on clean `6cbc5cbf`, and that MarkText's standard Markdown behavior stay exactly
as upstream has it: CriticMarkup is added to the unified stack as if built in
from day one. Upstream behavior was checked against pre-integration `8d6c198c`
(its Muya run directly in a jsdom probe) and against upstream's own `marked` parse.

Baseline: the hidden unpacked suite (`MARKTEXT_E2E_HIDDEN_WINDOW=1`, 460 cases)
failed 59 cases on clean HEAD; the G1–G6 candidate added 4 (open comment
composer blocking window close; recovery-panel retry race; inline-math gesture).
After the repairs below, run 2 failed 11 and targeted reruns of 9 of those pass;
the two remaining failures await the HTML-template decision.

Product repairs (each red/green through its production entry point):

- Window close/quit and tab close with an open Review composer show the native
  Discard-and-Close/Cancel confirmation (owner decision).
- Draft recovery: later faults no longer retry a pending backup implicitly; the
  visible Retry control owns it (fixed a 6-in-8 flake on clean HEAD).
- Paragraph→bullet/ordered/task list is a Core operation (`planListCreation`);
  Muya's native list path is retired for bound documents. Bytes match upstream,
  including continuation indentation and `preferLooseListItem=false` tight lists.
  Blockquote conversion quotes every line as upstream does. Tracked relocation of
  pure insertions now reconciles its selection.
- Unlisting keeps an end-of-line caret before the inserted separator; ordered
  Tab restarts nested numbering and renumbers following items as upstream does.
- Empty fenced/math/front-matter payloads keep their line ending on first input;
  Enter inside a multi-line HTML block inserts a literal line.
- Table alignment works without a live DOM selection; input at an unmapped DOM
  point fails closed instead of mutating the DOM outside the model.
- Parser: HTML blocks and indented code opened on a list item's marker line stay
  one block (CommonMark 0.31.2 all 652 examples still pass).
- Selection clipboard projects partially selected literal leaves; authoring
  controls require Core `planAuthor` availability (from the G4 repair).
- Unpacked `electron <app>` launches no longer open the application path as a
  folder (`userArguments`, including Electron switches before the app path).
- Hidden E2E windows disable background throttling so animation timing matches
  a visible window. The desktop's duplicate deferred image-tool open is retired;
  Muya owns it.

Test corrections (obsolete expectations, each justified against the contract,
Core unit tests or upstream): synchronous Core acknowledgement replaced the
retired Worker's 250 ms reply delay, so "queued/pending acknowledgement" axes
became consecutive-input variants and deferred-save assertions were removed;
tracked structural edits are separate per-line suggestions; tracked checkboxes
render intrinsically; Source-mode Find is owned by the Source search bar;
the input-latency probe prevents at window capture; image resize targets the
bar's truncating geometry; TOC and IME tests no longer race animations or leave
compositions open; real gestures replace synthetic ranges.

Decisions after run 2 (owner = O; delegated architecture/language decisions
= D, per the owner's instruction to decide those from existing MarkText behavior
and CriticMarkup practice and to ask only about user-visible behavior):

- O: window close/quit and tab close with an open Review composer both ask
  Discard-and-Close/Cancel.
- O: `<div>`+Enter and Paragraph→HTML Block write upstream's exact bytes
  (`<div>\n\n</div>`) and caret; the blank line between consecutive HTML blocks
  is an editable gap line, and typing there gives upstream's one-block result.
- O: End after a trailing annotation places the caret outside it (upstream's
  End-after-`**x**` analog); a visible line start is likewise outside a leading
  annotation.
- O: with Track Changes on, any edit possible untracked must be trackable
  (Accept = untracked result, Reject = original); typing inside deleted text
  splits the deletion at the caret.
- O: upstream's intentional behaviors are kept (for example per-keystroke
  paragraph re-evaluation that converts `2. ` lines); CriticMarkup is orthogonal.
- D: Profile rule L2c (new `marktext-criticmarkup-profile-2`, ADR-0016): a
  line-start boundary token stands against a block literal opened in its arm;
  C3/L2b amended so definitions in added/new arms resolve in Revised.
- D: tracked compiler "extent widening" with a projection-equivalence oracle;
  each created annotation must resolve independently. No rule change for a
  closer inside an arm-opened fence's info string: the compiler never produces it.
- D: keep CRLF for new breaks in CRLF documents; annotation delimiters are not
  text for block recognition; keep upstream's nested-list display for
  `- a\n  2. b` (a recorded CommonMark deviation shared with upstream); correct
  upstream's later-line `>` caret slip while keeping its bytes.

Retired production paths: `coreWorkerPort` and its Worker entry,
`optimisticHistoryTransform`, the Muya adapter's `accept`/`acceptTracked`
JSON-diff reconstruction and six modules only it reached
(`muyaPlainTextSourceEdit`, `muyaContainerSourceEdit`, `muyaStructuralEnter`,
`muyaStructuralSourceEdit`, `muyaNativeReconciliation`, `muyaTableSourceCodec`),
and the desktop's duplicate deferred image-tool open. The legacy submission
kinds (`track`, `track-edits`, `markup-edits`) were believed to remain for
recovery-journal replay; the 27 September gap analysis found no production
producer (see G42).

Additional defects fixed red/green in this pass: Enter after a closed annotation
split inside it; typing refusals before annotations; auto-pairing parity; later-
line block conversions and container line-start carets; Shift+Enter at paragraph
end (and a CRLF off-by-one); list-item HTML blocks and list-marker indented code;
four incremental-reparse and two fresh-parse bugs (2,993-case equivalence table
plus ~28,000 fuzzed documents).

The upstream-parity batch then closed: EOF blank-line paragraph, headings in
containers, setext Shift+Enter, upstream's per-input inline update (moved to
`@marktext/input-policy` `inlineUpdate`), the later-line quote caret, and table
re-padding through one spelling owner (`tableRespelling`; one command is one
history entry; tracked edits never re-pad). A 165-case real-gesture crash sweep
(`muya-edit-crash-sweep`) ends with no known gaps; its last four items were
Enter splitting ` - b` off a paragraph, Cut of a whole paragraph before a list,
a table cell holding only a comment (the caret stays where deleted text was,
before the marker, as in paragraphs) and delimiter-row width after deleting
inside `{++a++}` in a cell.

Final local verification (24 September, uncommitted tree on `6cbc5cbf`):

- Unit: desktop 4,232; document-core 5,408; Muya 1,586 plus 1,347 spec;
  input-policy 37; typecheck clean; lint 0 errors.
- Hidden unpacked E2E: 435 passed, 0 failed, 24 skipped (all opt-in: 20
  performance cases run below, 4 Linux-only IME cases).
- Packaged `build:mac:arm64` `installed-functional`: 90/90. The one first-run
  failure was the new close-confirmation case's harness: MarkText quits when its
  last window closes (upstream `windowManager`), so the case now observes that
  exit instead of polling a gone process.
- Packaged opt-in performance (19/19): cold open plain-80 ≈14 ms open / 32 ms
  editable, dense-80 ≈52 / 87 ms, plain-1000 ≈45 / 216 ms (limits 500 / 1,500);
  warm 40-key p95 echo 6.3 / 6.8 / 7.0 ms and reconcile 5.5 / 6.1 / 6.4 ms
  (plain / dense ordinary / dense tracked); 40-cycle editorial workload keeps
  exact source at every checkpoint.

Still open: `run-installed-core-performance.sh` requires a clean committed
checkout, so its authenticated 1,200-input workloads were not rerun on this
uncommitted candidate; nothing is committed; hosted CI has not run; the
Applications install was not replaced. E1, E2 and D1 are unchanged.

### 27 September gap analysis and review UX decisions

A four-part gap analysis of `27da397a` (one stack and lossless source, native
UI, editing semantics and performance, and this plan) added G34–G44 and found
G7–G10, G13, G14, G19–G24, G26–G28, G30 and G32 fixed at their commits
(9e98b262, 2092ecec, e6c56ab5, 0244539a, 27da397a, 71e5b3af, 94165f13,
82fe165d, ecd1fc05, 149d76f0, 6df8e8fa, b8d005b0, 88af24f9, ff6ffa59) though
their rows still read open. No verification is recorded for `27da397a`; the
installed app is `b95e9f9f`. Those fixes were confirmed against the code on
29 September, and their rows now record them.

Owner rule (27 Sep): review interaction follows Google Docs — research it, do
not invent. Docs' documented behaviour and a hands-on test in a throwaway
document settled G34, G37, G16/G31 (overlapping comments are allowed; the
composer is a card beside the text and nothing dims), G38/G39 (typing at a
comment's edges stays outside it) and G33 (no Accept/Reject shortcut). Where
Docs is silent, suggestions from any source are treated alike (vision: the
integration privileges no source of suggestions).

Other decisions: Print, PDF, HTML and non-docx Pandoc output use Revised;
`.docx` carries tracked changes and comments (owner). Typing never re-spells
untouched source, while explicit commands may (G24); list Tab/Shift+Tab
renumbering and blank-line removal follow upstream #5349 as an explicit
command, to be listed in ADR 0007. Documents upstream opens must open.

### 28–29 September completion work

Work from `27da397a` to `99fceb6f` closed most gap-analysis rows; the table
above records each row's state and owning path. Decisions made during it:

- **Profile 2 L1f accepted.** Footnote bodies are paragraph text: a footnote
  definition owns only its label, and CriticMarkup forms in its body as in any
  paragraph (`marktext-criticmarkup-profile-2.md`, ea2c8297).
- **R3b as implemented.** An annotation may not cut through a table cell: it
  forms when both markers sit in one cell, or when each stands on a cell
  boundary or outside every cell, so it covers whole cells, whole rows or the
  whole table (`tableCellContainment.ts`, 1744ceb5, b935519a). Annotations
  over whole rows form even when they span only some of a table's rows,
  because tracked row insertion, removal and moves spell them; R3b's
  some-but-not-all-rows clause is not enforced.
- **Markup reading in comments and excerpts.** Comment bodies and sidebar
  excerpts show the Markup reading, nested suggestions marked
  (3453ecc9, f5f04d43).
- **Pandoc justified deviations.** Exports are built from Core's parse, not
  pandoc's `gfm` reader (26420d32); where that differs from upstream, math
  fences follow the `texMathGfm` preference, TOML front matter is literal
  text (only YAML becomes metadata) and tabs are kept.
- **Backspace follows upstream Muya over combining sequences**, tracked or
  not: inside a line it removes Chromium's backspace unit (one code point of
  a combining sequence, a whole emoji or surrogate sequence), and a whole
  grapheme only where upstream Muya removes one (c37d615a).
- **Virtualized Review list.** Above 200 cards the list mounts only the cards
  in and near its view, through `@tanstack/vue-virtual` (9a31aa8a).
- **Active card revealed like Docs.** Selecting another entry, or clicking an
  annotation in the text, scrolls the sidebar the least that shows its card,
  without moving focus; typing does not (abbebe2e, 99fceb6f).
- **Closed disclosures without a display lock.** Closed `<details>` bodies are
  hidden without Chromium's `content-visibility` lock, which doubled the cost
  of every caret update (501044d4, 07d38781).
- **License check.** `validate-licenses` excludes the private document-core
  and input-policy workspace packages (914fb63b).
- **Editorial-pass harness limits.** The installed editorial pass
  (`installed-editorial-pass.spec.ts`, 9681efea) is accepted with these
  limits: native menus are driven through `MenuItem.click`, shortcuts through
  `webContents.sendInputEvent`, OS dialogs are stubbed and the clipboard is
  reached through Electron. Native menu tracking, OS-level key routing and
  real dialogs stay outside it.

### 29 September – 2 October performance work (G35) — pending the frozen candidate

Performance work from `dd1f0861` to `e8789f2d` moved most keys in long
documents off the document parse and the whole-view rebuild. Results below
are local measurements on the commits named. None of them is final
verification: every number here is pending the combined checkpoint on the
frozen candidate.

**Production paths that now own per-key cost**

- **Regional windows** (`documentCore.ts`, `internal/profile1/regionalInventory.ts`).
  Every ordinary block kind is edited regionally, as upstream does
  (0b932c47). Keys in resolved labels and no-op keys plan without a document
  parse (0c6b3765). A first suggestion beside unfinished openers takes the
  one parse `apply()` publishes (89e1c693). A window reads only the context
  a key needs beside a long block (e623590a), reads literal context,
  typed-over suggestions and HTML blocks from their blocks (98a90e7f), and
  takes its tracked compile only where blank lines part it from the blocks
  around it (75d88336). Edits that split a paragraph beside a fence, cross a
  literal Substitution's divider, split a suggestion, sit beside dollar runs
  or rewrite a Substitution's opener read from their blocks (a8662896,
  586d5301, 47dce3f9, ee3361af, f83a9901). Further admissions cover
  documents that begin or end with elided marker text and spellings a
  backslash protects (be349bae, 7d334fc4). Windows keep to what they read as
  the document does (6ea59439, 41bc4c63). Window parses are cached as the 32
  most recently read windows, up to 128K units (c63450ec).
- **Inventory leaves.** A document no smaller index covers is inventoried
  with each marker-free block as its own leaf (0b932c47). A whole new
  suggestion stays regional beside code spans and math when the inventory
  records no stray markers (d2a754a5). A whole fenced or `$$` block's
  replacement stays regional beside suggestions (9cfa1b12, 467b9f78).
- **Fork regions and tracked validation.** Each projection's fork regions
  are parsed once while a revision is parsed (96fe7821). Tracked candidates
  are previewed regionally as siblings of one base revision
  (`previewSourceEdits`, 03b24985). The oracle resolves a candidate's
  suggestions only once every other check has accepted it (f10d49dc).
- **List line windows.** A top-level list splits into item leaves, and a key
  replaces its items in place (`MarkupRegionReplacement.listItems`,
  e9897b67).
- **Literal line windows.** Each line of a long fenced, indented, math, HTML
  or diagram block is a leaf. A key reparses its lines with one line of
  context and the delimiters (`literalLines`, 07ab8424). Keys beside long
  literal blocks read only their own blocks (cdb915a4). The literal block
  holding a run is found by search (9a4e884b).
- **Arm-internal literal leaves.** A suggestion arm's long literal block is
  read from its lines (`armLiterals`, `admitArmLiteralLines`, 2e2f17f8).
  Related fixes to arm parting, closers and math arms: 5d0a95b6, 3315e3e9,
  0110305c, 2ef17de2.
- **First-key path.** A first tracked key in a long literal block compiles on
  a short block whose inventory leaves out the far lines, then gives them
  back (`admitArmCreation`, 4777dfca). Earlier steps are in cdb915a4.
- **View patches** (desktop `muyaMarkupView.ts`, `muyaMarkupViewRoots.ts`,
  `muyaMarkupChanges.ts`, `muyaMarkupViewLookup.ts`).
  - The Markup view is built by bisection, not by rescanning its text
    (fb2b8c70).
  - A regional reply replaces any top-level block kind (0b932c47).
  - Moved roots move their items only when first read (1172efed).
  - List roots keep their bindings grouped by item. Muya, the editability
    pass and the presentation index visit only the changed items (0e1fd867,
    1c169ac5).
  - Literal lines and arm lines are patched in place (07ab8424, 2e2f17f8,
    4777dfca).
  - A near-position search in a fully listed list root reads the items
    around the position (d3920bf2).
- **Muya in-place code-block redraw** (`codeBlockContent/index.ts`,
  `selection/dom.ts`).
  - A changed code, HTML, math, diagram or front matter root presents its
    new text in the existing block (ab6cc1b8).
  - A key redraws only the tokens it changes, and keeps a token's nodes
    where only its text changes (05812722, 9e0083cf, cc71e165).
  - Caret offsets and DOM points in a long block are read natively, then
    cached until the DOM changes, then found by binary search over the drawn
    children (ab6cc1b8, 9ea66a0c, 9e0083cf, cc71e165). The cached offset now
    counts mutation records delivered between reads. It used to drop them
    and could return a stale offset (9e0083cf).
  - The review target keeps its class while the same node shows the item
    (9e0083cf).
- **Prism run reuse and prefilters** (`utils/prism/tokenizeReusing.ts`,
  `utils/prism/prefilteredGrammar.ts`).
  - The tokens of untokenized runs left by a grammar's last greedy pattern
    are reused when their text is unchanged (9e0083cf).
  - Nine JavaScript patterns skip runs that lack text every match needs.
    Each pattern is pinned by flags and source, and a random-edit fuzz holds
    the result equal to `Prism.tokenize` (e8789f2d).
  - Both apply to the in-place highlight only.
- **Review overview, summary and sidebar.**
  - The overview and counts reread only the list items or arm lines a
    region changed (e9897b67, 2e2f17f8).
  - Each heading counts in the summary run it starts in (4b9a687e).
  - The overview finds an arm's replaced lines without listing every line
    break, and moves line nodes without copying empty child lists (9e0083cf,
    cc71e165).
  - The presentation index reads native-widget facts only when it renders
    a leaf (9e0083cf).
  - The virtualized Review list (9a31aa8a) and the idle passive refresh
    (ad75601e) are unchanged from 28–29 September.

**Retired paths**

- Whole-document candidate previews in the tracked compile, where the
  inventory admits the candidate (03b24985). A whole-document preview
  remains only where the inventory refuses.
- A whole-list reparse for a key inside one item (e9897b67).
- A whole-block reparse and redraw for a key in a long literal block
  (07ab8424, 05812722).
- Rebuilding a changed code, HTML, math, diagram or front matter root as a
  new block (ab6cc1b8).
- A whole-Substitution reparse for keys in an arm's long literal block
  (2e2f17f8), and for the first tracked key in one (4777dfca).
- The leaf-level generated-text pre-check in `evaluateBlockWindow`
  (75d88336).
- The eight-slot, insertion-order window parse cache (c63450ec).
- Planning-time node emission for plain-prose fork regions (96fe7821).
- Linear event and line-start scans in the Markup view build (fb2b8c70).
- A fresh live `Range` per offset read (9ea66a0c).
- Removing and re-adding the review target's class on every key
  (9e0083cf).
- Whole-block Prism highlighting per key (05812722, 9e0083cf).
- A whole redraw still serves search highlights, language changes and a
  block whose DOM something else wrote.
- The document parse still serves every edit a window refuses.

**Current numbers.** All warm workloads were measured at `e8789f2d`, built
unpacked in a clean worktree, hidden, with 40 measured keys after warmup,
under the shared lock, at a 1-minute load of 2.7–4.8. The limits are p95
echo 16.7 ms, dispatch 8, acknowledgement 50 and reconciliation 50.

| Workload                    | Echo p50 / p95 (ms)   | Dispatch / ack / reconcile p95 (ms) | Against the limits          |
| --------------------------- | --------------------- | ----------------------------------- | --------------------------- |
| plain                       | 4.0 / 4.9             | 0.6 / 2.0 / 4.5                     | within                      |
| plain-1000-tracked          | 4.1 / 6.9             | 0.7 / 3.0 / 6.6                     | within                      |
| dense-criticmarkup-ordinary | 2.0 / 3.1             | 0.2 / 1.0 / 2.0                     | within                      |
| dense-criticmarkup          | 2.3 / 2.6             | 0.3 / 1.3 / 2.4                     | within                      |
| dense-2000-tracked          | 8.5 / 9.2             | 1.0 / 2.0 / 8.9                     | within                      |
| dense-2000-tracked-refresh  | 9.3–14.0 / 10.1–15.6  | 0.9–1.5 / 2.0–3.3 / 8.7–14.0        | within (two runs)           |
| plain-80                    | 2.4 / 4.9             | 0.5 / 2.1 / 4.4                     | within                      |
| plain-1000                  | 4.6 / 6.3             | 0.6 / 2.2 / 5.9                     | within                      |
| links-code-2000             | 13.7–17.6 / 14.3–21.5 | 1.2–1.8 / 2.3–3.2 / 14.7–20.2       | **open**: 3 of 5 runs over  |
| mixed-blocks-2000           | 8.0 / 8.5             | 0.8 / 1.9 / 8.3                     | within                      |
| loose-list-2000             | 3.3 / 3.6             | 0.4 / 1.5 / 3.4                     | within                      |
| loose-list-2000-inside      | 5.8 / 6.1             | 0.4 / 1.8 / 5.9                     | within                      |
| loose-list-2000-after       | 3.1 / 3.4             | 0.4 / 1.4 / 3.2                     | within                      |
| fence-2000                  | 4.8 / 5.2             | 0.3 / 1.6 / 5.0                     | within                      |
| fence-2000-inside           | 11.8 / 13.3           | 0.9 / 2.0 / 13.1                    | **open**: 5 of 10 runs over |
| fence-2000-after            | 4.0 / 4.3             | 0.4 / 1.1 / 4.1                     | within                      |
| fence-2000-arm-tracked      | 14.0 / 14.8           | 0.9 / 2.2 / 14.6                    | within                      |
| enter-plain-1000            | settled 6.4 / 6.9     | —                                   | within the 50 ms limit      |
| enter-plain-1000-tracked    | settled 78.4 / 85.1   | —                                   | **open**: over 50 ms        |

`fence-2000-arm-tracked` (opt-in `MARKTEXT_WARM_ARMS`, 9e0083cf) also ran
five consecutive times on the same source at a load of 4.0–5.3: p95
15.2–15.4 ms, maximum 16.2. That is a margin of 1.3–1.5 ms; it started this
period at a p95 of 36.4 ms. A key's handler there is about 13.5 ms:
Chromium's selection sync and layout of the block after the caret is set
take about 9 ms, Core 1.25 and the remaining highlight about 0.5. The
installed performance smoke passes 15/15 at `e8789f2d`, once 1fe29cd7
corrected the probe's post-capture read, which ab6cc1b8 had left counting
paragraphs only.

Core costs per key, measured in Node on the commits that changed them:

- Keys in links and code spans at 2,000 paragraphs: 1–2 ms untracked and
  4–8 ms tracked (0b932c47).
- List keys at 2,000 items: 1–11 ms (e9897b67).
- Keys beside a 2,000-line fence or list: 1–4 ms (e623590a).
- Untracked keys inside a 2,000-line fence: 1–2 ms (07ab8424).
- Later tracked keys in an arm's 2,000-line block: 1–4 ms (2e2f17f8).
- A first tracked key there: 30–40 ms (4777dfca).
- All with no document parse.

Opens at 271 KB dense-2000 take 922–974 ms (96fe7821).

**Still open — not accepted**

- **fence-2000-inside and links-code-2000 are bimodal** (explained on 4 October as a slowed CPU; see "4 October performance-run validity rule"). At unchanged loads
  of 2.7–5.3, some runs measure p95 13.0–14.9 ms and others 17.2–21.5 ms.
  On 2 October, 5 of 10 fence-2000-inside runs of this source were over
  16.7 ms, and 3 of 5 links-code-2000 runs. In one slow run another agent's
  process was taking 143% CPU. The lock covers only builds and E2E runs, and
  the slow mode also appears without a visible competitor. The cause is not
  established.
- **enter-plain-1000-tracked settles at p95 85 ms** against the 50 ms limit.
- **Tracked-key targets, which fixer N is still closing.**
  - Fixer N's seeded sweeps of tracked keys run on the landed document-core,
    which is identical from 45cad8bc to `e8789f2d`. 480 keys on 1–10 KB
    documents measure p50 27.6 ms, p95 126.6 ms and a maximum of 359 ms.
    45 of those keys exceed 100 ms, and three take more than one document
    parse.
  - 32 keys on 2,000-block documents measure p50 24.8 ms, p95 113.5 ms and
    a maximum of 2,273 ms.
  - N's unlanded work moves several traced keys onto regional paths: P7n,
    and the G34 history-split rule in P13.
  - Seed 13 key 13 spends 170–250 ms in `splitTrackedHistoryEdit`. It
    previews three split points over a 1.7 KB Substitution window before
    one succeeds, and the line-boundary ordering is with N.
- **Chromium's per-key selection sync.** `setBaseAndExtent` and its forced
  layout remain the largest single cost of a key in a long block. Layout
  containment and a non-editable struck arm did not reduce it, and
  deferring the highlight to an animation frame was ruled out, because it
  would improve the echo metric without improving input-to-paint.
- **Final verification** of every number above is pending the frozen
  candidate.

### 6 October performance-run rule: the natural idle state (owner decision) — pending the frozen candidate

On 2026-10-06 the owner replaced the 4 October validity rule. Performance
gates measure the machine's natural idle state.

**The rule.**

- Every warm, upstream and installed run still records the calibration
  loop's p50 and p90 as information beside its results: the keyup loop in
  warm sessions, and the probe after each fresh-application observation.
- The loop never makes a run invalid, never reruns it and never leaves it
  inconclusive for a slow CPU. Every run is scored against the unchanged
  thresholds, for our build and upstream alike.
- Runs still require AC power, an open lid, nice 0 and a 1-minute load
  below 6.
- The target manifest (schema v13) keeps the loop and its 1.20 ms fast-state
  reference as context. `maximumExcess` and `maximumAttempts` are gone.
- The raw schemas (core v16, upstream v14) keep the reference, the probe and
  every observation's loop p50 and p90. They drop `invalidObservations`,
  and lifecycle counts are one launch, profile, close and cleanup per
  observation.
- The warm producers write one run per workload, with no attempt files and
  no inconclusive result.

**Evidence for the decision.**

- On a quiet, cool Mac on AC, V's probe read 1.45–2.05 ms with nothing else
  running and 1.16–1.22 ms with one other core busy. The CPU stays clocked
  down for bursty work, so the slow loop is the idle state a user meets.
- Under the old rule, N's warm run was invalid on 45 of 45 attempts at a
  1-minute load of 1.3–3.8.

**Still open.** links-code-2000 and fence-2000-inside stay open if they miss
their 16.7 ms echo limit at the natural idle state on the frozen candidate.

### 4 October performance-run validity rule (owner decision, superseded 6 October)

The owner decided on 2026-10-04 that a performance run measured on a slowed
CPU is invalid evidence, neither a pass nor a fail. The rule lives in the
target manifest's `calibration` record
(`specs/baselines/criticmarkup-performance-targets.json`, schema v12,
validated by `scripts/criticmarkupPerformanceTargets.ts`).

**The rule.**

- Every warm session, ours and upstream's, times a fixed loop after each
  measured key: 300,000 iterations of `(value * 31 + index) | 0` at keyup
  (`warmSessionDiagnostics`, `helpers/performanceCalibration.ts`). The run
  records the loop's p50 and p90 with its results.
- A run whose loop p50 exceeds the pinned reference, 1.20 ms on the reference
  host, by more than 15% (above 1.38 ms) is invalid. It is reported with its
  loop numbers, counted neither as a pass nor a fail, and run again, up to
  three attempts.
- A workload with no valid attempt is inconclusive and the gate does not
  pass.
- Valid runs are judged against the unchanged thresholds and workloads.
- Installed-core and upstream raw runs (smoke and ratification) launch a
  fresh application for each one-key observation, too few keys to time at
  keyup. Each observation instead probes the same loop eight times, 40 ms
  apart, right after its key (`integer-spin-300000-probe-8x40ms-v1`), and is
  judged by the same reference and limit.
  - An invalid observation is run again in a fresh profile and never scored.
  - Raw schemas core v15 and upstream v13 list each such attempt in
    `calibration.invalidObservations`, keep every observation's loop p50 and
    p90 per document, and count every attempt's launch, profile, close and
    cleanup.
  - An observation with no valid attempt in three makes the run
    inconclusive. The producer writes no evidence for that run.
  - `validateRawRun` and the producers' builders reject a kept observation
    above the limit and a rerun attempt that was not invalid.

**Evidence for the decision** (2–4 October, the reference host).

- _The same build has two modes._ At `e8789f2d`, links-code-2000 and
  fence-2000-inside measured echo p95 of about 14.3 and 13 ms in about 85% of
  roughly 90 runs, and 17–21.5 ms in the rest, at the same 1-minute load.
- _Every phase slows by one factor._ In the slow runs, the probe's dispatch,
  ack and reconcile medians each rose by about 1.33× (1.1 → 1.5, 2.0 → 2.8,
  13.5 → 18.0 ms). Extra work such as a GC, timer or periodic task would add
  time to some keys or phases; a slower CPU stretches all of them.
- _The fixed loop slows with them._ It measured p50 1.20 ms (p10 1.1–1.2,
  p90 1.3) in every fast run, about 60 runs of our build and upstream. Every
  slow run measured 1.5–1.8 ms.
- _Not ours._ Packaged upstream (`0c33241b`) showed the same signature on the
  same document after a controlled heat soak: echo p95 19.9 ms with loop
  p50 1.50. A plain Node loop on the command line slowed from 1.26 to 1.48 ms
  at the same moment.
- _Not visible scheduling demotion._ The renderer's main thread stayed at
  priority 47T in both modes, and 12 busy loops at load 11 did not cause the
  slow mode.
- _When it happens._ The slow runs coincide with DarkWake after the lid closed
  (2 October, followed by a thermal-emergency sleep), the minutes after waking
  (4 October), and heat.

**The cost the slow mode exposes** is Chromium's, and this rule does not
change it.

- Any DOM change under the editing host makes the next `TextInputInfo()`
  re-walk the host's whole plain text with a `TextIterator`, because any
  layout clears `CachedTextInputInfo`. That walk runs during input in
  `DidChangeSelection` → `UpdateTextInputState`/`SyncSelectionIfRequired`
  (`render_frame_impl.cc`), or otherwise at the next frame's
  `DidBeginMainFrame` (`widget_base.cc`).
- On links-code-2000 the walk measured 7.5–8.2 ms per frame for a pure text
  mutation with no selection write, and 0.01–0.03 ms for a selection write
  alone.
- Making the caret's block its own editing host removed it: links-code-2000
  measured 4.7 / 5.0 ms.
- Switching hosts per gesture would restyle every element in the document:

  | Document                          | Cost per switch |
  | --------------------------------- | --------------- |
  | links-code-2000 (34,003 elements) | 13.7–13.9 ms    |
  | mixed-blocks-2000                 | 37.3–37.4 ms    |
  | loose-list-2000                   | 22.2–22.3 ms    |
  | plain-1000                        | 5.6–5.7 ms      |
  | fence-2000-inside                 | 0.4–0.5 ms      |

  That is a navigation and click-to-type regression, so host switching was
  not adopted.

**Superseded.** The 6 October decision above replaced this rule: the loop is
now information only, and every run is scored.

### 5 October tracked-key and parser work — pending the frozen candidate

- Watch in the freeze run:
  - `core-review-overview-regional.spec.ts`, "reads as a fresh overview,
    seed 11". It failed once at 6,131 ms in a full desktop unit run under
    load (about 5–8) and passed rerun alone.
  - `regional-suggestion-safe-points.spec.ts`, open-arm seed 150. It timed
    out at 6.5 s under load and agrees on replay.
  - If either fails again, it is a failure to fix, by timeout headroom or
    by cost, not a flake.
- The 2,000-block sweep had two keys over 100 ms, on base as well.
  - Key 2/15 typed `{==h==}{>>c<<}` into an HTML block and took about
    1,600 ms. Two quadratic scans in the document compile took half of
    that: a history check asked of every suggestion, and each
    suggestion's visible text found by filtering every text event. Both
    now search only what they need, which halves the key to about 800 ms
    with byte-identical outputs. The rest was the key's fall from its
    window to the document compile (see below).
  - Key 5/14 types a blank line inside a `$$` math block and takes about
    700 ms. It is the one bounded parse: the split leaves `$$` runs
    unpaired in any window, which could pair with text beyond it, so no
    region admits the edit. The parse reuse is withheld from edits that
    may repair math (editsMayRepairMath). The whole 113 KB document is
    parsed once, at the parser's rate of about 160 characters per ms. This
    key stays open: it needs a math-pairing-aware incremental parse or a
    faster parser.
- Key 117/9 of the input sweep threw a RangeError while planning Enter.
  The fence's projected content was empty beside elided markers. Its
  content start mapped forward and its end mapped back across them, so the
  start passed the end and slicing that range threw. The Enter and Tab
  planners now read such content as the empty range at its start.
  `literal-content-source.spec.ts` minimizes the document from that key.

### 24–25 September rebase onto upstream develop — locally verified

Scope (owner): US English macOS, verified locally on the owner's Mac; hosted CI,
Windows, Linux and non-English input are out of scope for this pass.

The branch was rebased onto upstream `develop` (`0c33241b`, then `16e986fb`;
backups `backup/criticmarkup-core-integration-pre-rebase` and `-2`). Upstream
fixes that touched paths this branch retired were carried into the shared model
rather than merged textually: cross-block cut from `beforeinput`, Pandoc
`tex_math_dollars` rules and upstream's math options (backslash delimiters,
display markers), paragraph commands that must not convert tables or code, quote
joins on forward Delete, list-item kinds and footnote containers, Enter joining
a multi-line block into one heading line, tables inserted after a table, unique
exported footnote ids, the Source math tokenizer, anchor links into other
documents, the unsaved dot and hand cursor, a clean tab reloading silently on
disk change (#3652), and Muya's table-grid focus (#5355).

Decision (owner rule O, applied): undo grouping matches upstream Muya's History,
which is purely time-based (`delay: 1000` from a step's first change, split only
by `markInputBoundary`). The bound document now carries Muya's time-window group
through every model command — typing, Enter and structural keys (per each
block's upstream `enterHandler`), Paragraph/Format menus, quick-insert and
front-menu conversions, table and task commands, cut, paste, drops and image
edits — and Core merges entries sharing a group. CriticMarkup-only actions
(accept/reject/resolve, comment edits) have no upstream equivalent and remain
their own entries. Tests that assert separate steps now wait out the window or
freeze the clock (`separateUndoSteps`, `undoWindow`), and cases that typed inside
the window expect upstream's grouped step.

Other parity closed in this pass: a table made by Enter and text dropped into a
cell are written by upstream's serializer (padded) within the same history step;
Muya e2e typecheck is clean (a stale `underscore` shim was removed).

Remaining approximation: a text drag-move is one atomic model command, so it
cannot join an earlier deletion's undo step as upstream in principle could.

Verification on `b95e9f9f` (packaged; unit/E2E also on that tree):

- Unit: desktop 4,680; document-core 5,435; Muya 2,165 plus 1,347 spec;
  input-policy 37; typecheck clean; lint 0 errors.
- Hidden unpacked E2E: 518 passed, 0 failed, 24 opt-in skips.
- Muya e2e (Chromium): 1,026/1,026.
- Packaged `installed-functional`: 90/90. The build is installed as
  `/Applications/marktext.app`; older copies were removed at the owner's request.
- Installed ratification benchmark (`run-installed-core-performance.sh`): the
  host moved from macOS 26.5.1 to 26.6.2. Recording that in the targets
  (`bebec87b`) broke the digests the approval record and measurements manifest
  pin, so `a2841f03` restored the approved targets; the owner deferred the
  benchmark until it is re-run and re-approved. The run then stopped
  at sample 101/1,100 on the WindowServer presentation invariant: macOS moved the
  hidden measurement window (x 264 → 1289) while the Mac was in use. No evidence
  file was written; it needs an undisturbed hour.

Still open for a US-English macOS release: the benchmark rerun on an idle Mac;
the native screenshot picker (`screencapture -i`) exercised by the owner; E2
(Developer ID signing and notarization).

### 21 September basic desktop audit and repair — locally verified

The owner narrowed the readiness question to US English on macOS and authorized
repairing the confirmed failures and completing the listed verification gaps.
B1–B5 were implementation/verification blockers, not language or external release
exceptions. Earlier broad/component counts do not waive them. Work follows the
[one-parser-to-UI contract](../architecture/criticmarkup-native-integration.md#one-parser-to-ui-stack)
and retains the current shared model, native services, workloads and limits.

The failing artifact was `020033857c2a500808d876f91be81660e7b3f249`, previously
installed in Applications, ASAR `bb41fe7cfd2fac6f13f62a080893b6b56703d7a5c228251e5677e20179ce0d75`.
Save As reproductions and exact disk/tab observations are under
`/var/folders/6k/xzgngnms6jg4_z2l40y0_9vh0000gn/T/marktext-basics-files-audit-v3-docwf22t/`.
Focused-comment native-key evidence is under
`/tmp/marktext-basics-editing-audit-JhGago/`; Find menu/native-key evidence is under
`/tmp/marktext-basics-root-fwa1bpyl/`. The latter's Preferences and real-file reload
probes timed out and remain inconclusive, not product failures or passing checks.
All audit documents and profiles were private scratch fixtures; user state and
clipboard were not used as test fixtures. Final repair evidence is recorded below.

Coverage closure on the unchanged old artifact: the three new installed lifecycle
cases pass (Close All/Close Others cancellation and complete collapsed-folder
create/edit/save/reopen). Four additional installed desktop cases pass (Preferences
UI theme persistence through restart and subsequent edit/save; real filesystem
reload with undo/redo/save in Markup and Source; palette command execution and save).
The earlier Preferences timeout targeted Element Plus's hidden switch input; the
correct visible switch control passes. The reload timeout looked for “Reload”
instead of the existing “OK” control. These were harness errors, not product fixes.
The new tests remain required on the final repaired artifact.

**Repair path.** Save/Save As now share the existing save service; a main-process
destination guard checks open/pending documents across windows and resolves physical
path aliases before any write or rename. The guard retains destination ownership
through persistence and open-file registration. The renderer's post-write
`CLOSE_TAB(existingTab)` cleanup is retired. Rename/Move use the same guard. The
canonical document and revision-aware acknowledgement remain the source of save
bytes and dirty state; no semantic store or metadata lane is added.

The central edit dispatcher routes ordinary input/textarea Undo/Redo to their
native control history, including empty-history no-ops; Muya and CodeMirror keep
the common document history. The existing comment submission remains a canonical
operation. The window owner keeps its active Markup lease on tab-collection-only
changes. A deterministic held-save/background-tab/tab-switch overlap additionally
proved that global presentation state could still retire a live actor. The final
branch tests the actual owned Markup projection, preserving Source handoff and
all live actor histories.

Intermediate `f2c54665` was packaged successfully but is superseded by that overlap
fix. It is not installed in Applications. The initial full desktop suite passed
3,348 tests/302 files; the later overlap regression is separately red → green
(178 affected owner/authority tests). Initial package checks passed seven new
basic cases before a palette test exposed an invalid harness input sequence:
`fill` plus ArrowDown omitted the keyup query filter; actual typed query plus one
matching command passes. Native input history may group multiple typed characters
into several undo entries; the focused tests are being corrected to assert every
observed native group and unchanged canonical document rather than assume one
entry. Source Find's missing caller remains B5, not a harness exception.

Native OS sheet execution on the intermediate package uses CUA with a private
profile: Save As Cancel → next character, Save As new name → next character/Save,
Open Cancel → next character/Save, native Open selection → edit/Save and normal
Quit all preserve exact expected source. Evidence:
`/tmp/marktext-basics-final-cux214sf/native-dialogs/verification.json`. The original
fixture remained unchanged. No pasteboard operations were used. Repeat these
flows on the final artifact; intermediate success does not close B3.

The corrected focused-history fixture passes eight applicable intermediate cases.
The Source palette's extra exhausted-stack Undo reaches Chromium's native hidden
textarea history, so exact field undo/redo is checked before that additional
no-document-mutation probe. No custom field history or runtime workaround was
introduced. Source Find's two additional focused-input cases require the new
search implementation and final build.

**Source search production path.** `sourceCode.vue` now hosts the existing
`EditorSearch` widget. Query events read canonical raw source through
`sourceAtBarrier`, reuse Muya's pure `matchString` query policy and map canonical
positions through the Source adapter. Match navigation sets native CodeMirror
selection after scrolling. Replace validates the settled revision, expands
captures with shared `buildRegexValue`, and submits actual ranges through the
existing CodeMirror pre-change/common-model editing path. Replace All is one
operation/history entry. There is no projected-text reparse or resulting-diff
reconstruction. Source-mode guards in `editor.vue` retire the previously misrouted
hidden Markup search/replace/navigation handlers. Query and lifecycle epochs reject
stale results; ordinary document-change refresh does not move the caret.

Intermediate `86d89d4c` passes Source Find, repeated-match navigation, Escape,
subsequent typing, history and exact save, plus both focused Find history routes.
The native Edit → Replace regression then demonstrated another real failure:
the query appeared without focus, leaving typing in the document. A red shared
Search component regression confirms it. Find and Replace now share the existing
opening/prefill/focus/select operation. The remaining replacement workflow passed
only diagnostically after manually focusing the query (regex captures, single
then Replace All, exact CRLF source, one Undo/Redo); this does not close the native
focus failure. Final verification requires the newly rebuilt combined artifact.
Evidence is retained in `/tmp/marktext-basics-release-xbw56ae7/` and
`/tmp/marktext-source-replace-probe-1om5TZ/`. The new shared Search and Source
component checks pass 7/7; the earlier affected Source/history/search checks pass
36/36 and the shared Muya query-policy checks pass 16/16.

The final B1 review reproduced a further ownership race in `1f7297b8`: pending
Save As destinations `New.md` and `new.md` were treated as distinct before either
file existed on the local case-insensitive volume. Both writes could start. The
actual guard/comparator probe is retained at
`/var/folders/6k/xzgngnms6jg4_z2l40y0_9vh0000gn/T/marktext-save-case-review-geT8wf/result.json`.
That artifact is superseded pending a filesystem-aware alias guard and real
concurrent Save As regression. The installed two-window regression also goes red:
it holds the first fixture's final atomic rename, confirms neither destination
spelling exists, then observes the second Save As incorrectly succeed. Evidence:
`/tmp/marktext-basics-final-cux214sf/save-case-race-red.log`. All paths in the probe
are scratch files.

The other **68 installed checks pass in 2.2 minutes on `1f7297b8`**, including all
16 close cases, five lifecycle cases, four desktop basics, ten focused-history
cases, both Source search cases, 28 Review cases and three projected-search cases.
This proves the shared Replace focus fix through its actual caller. It does not
waive B1 or replace the final combined-artifact gate. Full desktop units pass
3,352/3,352 across 302 files; types pass; lint has zero errors and 725 warnings.

The final destination comparator now resolves ambiguous missing case aliases using
read-only directory-entry lookups on the destination filesystem (device and inode
identity), including mount-root handling. It preserves distinct names on
case-sensitive filesystems; unknown/disappearing lookup evidence conservatively
retains the existing claim. The same comparison protects pending writes and open
owners whose files were externally removed. No probe writes or platform-wide
lowercasing assumptions are used. The new unit regression is red before repair;
43 affected save/close/open caller tests, typechecking and targeted lint pass.
Evidence: `/tmp/marktext-focused-history-finish-hT1Lub/save-case-{red,final,typecheck}.log`.
The combined installed artifact, final native OS dialogs and Applications
replacement are still pending at this checkpoint.

**Final verification and installation.** Candidate
`5a71228e10f6e541e916b9a91adf2a06aef2707b` is a private frozen snapshot of the
working changes over branch commit `da6d936d6b3bb2a09531881d36592d8216baed51`.
At installed verification, all runtime inputs matched the worktree; the only
post-freeze differences were this plan and the concurrent Save As test's native
history-boundary correction. Commit preparation subsequently ran the repository
Prettier/ESLint tasks, formatting 20 of the 26 TypeScript/Vue files. Normalized
JavaScript, compiled Vue templates and CSS compare identically before/after for
all 26 files; these hook changes add no runtime or test behavior. Evidence:
`/var/folders/6k/xzgngnms6jg4_z2l40y0_9vh0000gn/T/marktext-push-basics-id86z77f/hook-equivalence-normalized.json`.
The commit containing this record publishes these verified working changes. The
private snapshot identifies the tested artifact rather than the branch commit;
Git metadata and this verification record do not change the installed runtime.

All **73 distinct affected installed cases pass** on this exact artifact, with
zero retries or skips. The combined run passed 70, then stopped on the new race
test's Undo expectation; the two Source search cases had not yet run. Ownership
refusal already passed. Muya intentionally groups adjacent insertions within one
second unless whitespace/input kind starts another group; the fixture's `!`
therefore correctly undid together with preceding `UNSAVED`. The next test edit
now starts ` NEXT`, using the existing native whitespace boundary. It retains
strict pre-word Undo, post-word Redo and independent exact saved bytes, with no
delay or runtime change. All five Save As cases pass in **9.4 seconds**, and the
same corrected race fixture still fails on old `1f7297b8`. The remaining two
Source Find/Replace cases pass in **2.8 seconds**. These bounded follow-up runs
complete the 73-case set; the initial failed attempt remains recorded rather than
being described as one uninterrupted passing run.

Final desktop units pass **3,355/3,355 across 302 files in 39.05 seconds**;
typechecking passes; full ESLint has **0 errors and 725 warnings**. The Source
shared policy and affected caller evidence above remains valid. Existing broad
and sustained workloads/limits are unchanged and attributed to `eed5f5d9` (lost in the 24–25 September rebase); this
bounded file/UI repair does not claim those workloads were rerun on `5a71228e`.

Actual macOS sheet execution uses the final package and private fixtures:
Save As Cancel → `Y`, Save As new pathname → `Z`/Save, Open Cancel → `Q`/Save,
and native Open selection → `R`/Save. Independent file expectations all match:
the seed remains unchanged, the copy contains `endXYZQ`, and the opened document
contains `endR`, with original CriticMarkup intact. Closing both saved tabs shows
the empty view; clicking the native close button exits the private process. The
UI observation tool subsequently relaunched the app without profile arguments,
restoring the existing user session. No input was made there; it quit normally
before installation. The observer's post-exit status call failed because its
private target had already closed; this is retained as an observation limitation.
No clipboard operations, user-document edits or profile resets were performed.

The DMG SHA-256 is
`4a7fb47a2a59940d485a139ec875d567e906376a3a4a7be06ac61811b5b2fb8a`;
ASAR `d6e837de682142ec505af8f8ecb419c756d18997c0389c40361f0d471e09c7e9`;
executable `c3402789eb38fe3194135e9e0a5e44a66f5424126fc1ede1947398c452b541f4`.
All 104 bundle files match the read-only mounted DMG; strict/deep ad-hoc signature
verification passes. All 192 filesystem entries match the staged Applications
copy. The prior bundle is preserved at
`~/Library/Application Backups/MarkText/20260921-183117-basics-fix-ikhzt4hc/marktext.app`.
The verified app was launched from `/Applications/marktext.app` (PID 35139), and
its rendered URL and restored session confirm that installed path.

Final evidence is retained under
`/var/folders/6k/xzgngnms6jg4_z2l40y0_9vh0000gn/T/marktext-basics-final-guard-8s_cly61/`:
`verification.json`, `installed-artifact.json`, `applications-installation.json`,
`installed-final-tests.log`, `save-tests-final-boundary.log`,
`save-case-final-fixture-red.log`, `source-final.log`, `desktop-unit.log`,
`typecheck.log`, `lint.log`, and `native-dialogs/{evidence,verification}.json` plus
screenshots. Earlier failed and superseded artifacts remain preserved separately.
B1–B5 are closed locally; E1/E2 and deferred D1 remain explicit above. Local
Apple-Silicon/US-English verification is not signed/notarized distribution or
Intel/native-CJK/screenshot-picker verification.

### 21 September installed empty-window close regression

The owner reported `Save failure: Window close owner is unavailable` after the
last tab was closed in `/Applications/marktext.app`. This was a product failure,
not a user-profile or clipboard problem. The Applications bundle matched the
previous verified candidate `eed5f5d9` (lost in the 24–25 September rebase) (ASAR
`b7f2dcdeeaf80d116a6cb106f47c51fc934f2d5113ab1c51547d391a3bbfff20`).
The eight earlier installed close tests all opened a document; the component
tests mounted the owner directly. Neither exercised the real parent removing
its last document. Those passing checks did not justify the earlier readiness
claim for this basic lifecycle.

**Production path and repair.** `pages/app.vue` formerly mounted
`components/editorWithTabs/index.vue` only while `hasCurrentFile` was true.
Removing the last tab therefore unregistered the only close owner, while
`store/editor.ts` still called `coreDocumentSaveAuthority.prepareClose()`.
The parent now keeps that owner mounted after window initialization. The existing
Recent component is rendered inside it when no document is open; native inputs,
tabs and notifications are conditional on a current document, and draft recovery
remains visible. Native Close and Quit retain the existing main-process handshake,
common model barriers, buffered-state persistence and cancellation/history path.
The superseded document-dependent owner lifetime is removed; there is no
missing-owner bypass, alternate save path or change to language interpretation.

Persistent ownership also requires retiring the closed actor's reload/recovery
registrations. A deterministic regression held retirement of A while New File B
registered, then demonstrated that cleanup against A's stale tab list removed
B's handlers. Cleanup now captures the actors actually being retired and releases
only their handlers. Both Markup and Source tests verify B's real fault/recovery
path and exact canonical source after that overlap.

**Red and green evidence.** Six old-artifact cases failed: last saved tab removed
in Markup or Source, or fresh empty-folder startup, each followed by native
`BrowserWindow.close()` or application Quit. They retained the exact toast and
close-preparation IPC error. The final fixture also fails on the old artifact
after its polling race was corrected. Final candidate `020033857c2a500808d876f91be81660e7b3f249`
passes **16/16 installed lifecycle checks in 27.0 seconds**, with no retries,
skips or flaky results. The six empty cases return an empty file list and no close
error. Two additional cases verify New File, reopening the same pathname,
ordinary Markdown plus CriticMarkup/comment preservation, editing, undo/redo and
exact saved source. The eight existing pending-input, Save decision, cancelled
Save As, incoming-open and Quit cases also pass.

The real-parent component and affected save/close/retirement/handoff suites pass
**294/294 across 12 files in 16.30 seconds** after the final runtime change.
Typechecking and scoped lint pass (zero errors; existing test warnings retained).
The final unit fixture was corrected after freezing to fault its lease before
requesting recovery: a healthy actor correctly refuses unnecessary recovery.
This changes test setup only; all runtime inputs match the frozen build. No broad
or performance rerun was needed for the bounded owner-lifetime correction, and
previous workloads and limits remain unchanged and attributed to their artifact.

**Artifact and installation.** The final source snapshot contains 2,645 files.
The DMG SHA-256 is
`a1f131c0248a1fe09f3ffef8c00c05a49300b9dbb9a2ae0624c72fb87a965229`,
ASAR `bb41fe7cfd2fac6f13f62a080893b6b56703d7a5c228251e5677e20179ce0d75`,
and executable `1567377140eee8376ea1347498706f630320a059ea82d5723c57cbebd4af0ace`.
All 104 installed bundle files match the read-only mounted DMG; strict/deep
ad-hoc signature verification passes. A packaging attempt failed on an unavailable
network fetch; the successful retry uses the existing pinned Electron 42.1.0
runtime through electron-builder's `electronDist` option. Both attempts are retained;
this does not claim Developer ID/notarization readiness.

Evidence is retained under `/tmp/marktext-empty-close-final-8mvfod20/`
(`installed-artifact.json`, `verification.json`, `applications-installation.json`,
build/package logs and unit red/green logs). Installed red runs are under
`/tmp/marktext-empty-close-red2-a_frdrkg/` and
`/tmp/marktext-empty-close-final-fixture-red-vsc71nwh/`; final green evidence is
`/tmp/marktext-empty-close-final-green-9w14tlax/final-verification.json`.
The intermediate `eefde73b` candidate's 16 passing cases remain separate from
final verification. All test apps used hidden private profiles and are closed;
no clipboard was accessed. The old user app quit through its normal session/save
flow; its bundle was backed up, the exact verified replacement was installed in
Applications, and the existing session reopened. No user document, recovery
backup or configuration was reset. E1/E2/D1 remain active above.

### 20 September reassessment and remaining implementation

Reviewed clean source `cf722bb71de79b63587bd2ebcd1cd46bfaa56e01` against the
[single-stack contract](../architecture/criticmarkup-native-integration.md#one-parser-to-ui-stack).
The July and September transcripts confirm this was the original requirement;
one parser and one save authority never waived model-owned editing and UI context.
Keep the working Core, synchronous live owner, parser-owned rendering and native
MarkText services. Finish their actual consumers rather than restart the engine.

The owner authorized updating this plan and completing the identified work on
20 September. These tasks refine U1 and its verification; U2, V1, E1, E2 and D1
remain active under the existing scope above.

- [x] **Structural callers:** move literal/table paragraph joins, blockquote
      boundary Backspace, paragraph-menu Duplicate/New/Delete and remaining generic
      paragraph resets onto shared-model operations before native mutation. The
      former `editor.vue` `json-change` →
      `muyaPlainTextCoreAdapter.decodeNativeEdit` route is now removed from production;
      operation-shape decoding and native block serialization cannot define the action. Verify ordinary Markdown and CM
      through actual native callers, including exact source, repeated text, immediate
      next input, directed selection, history and save/reopen. Retire the replaced
      production routes and account for every remaining decoder producer.
      Actual native tests have now reproduced and repaired literal/table joins,
      blockquote boundary Backspace, menu actions, generic resets and heading
      Backspace. Additional reachable bypasses found during caller accounting are
      the language picker and spelling replacement; both now submit actual actions
      before presentation. The picker reads parser-owned fence context. The audit
      also found image insertion/drop, block drag, preview deletion, footnote
      creation and page-tail clicks; those callers are included in this same work.
      Rendered pointer tests caught and repaired selection loss in floating
      controls and the missing native footnote wrapper. Annotation-boundary drag and
      async-drop selection now pass actual-caller tests, including original selection
      restoration on undo and newer input during asynchronous import. Final accounting
      also found modified word/line deletion, literal-body and Setext Backspace,
      parser ownership of emoji picker/rendering context, reference-definition scans
      during mount/update, and ordinary text drops. Include their migration and
      immediate next-key/history checks; do not leave a fault-only replacement for
      a supported user action. Direct editing of a fence's language field also now
      has its own model address; typing there no longer edits the code body. Text
      drag/drop carries the original selection and destination as one model action.
      Its planner preserves annotation/comment ownership, normalized text values,
      literal indentation/EOLs and the existing table-cell spelling policy.
      The combined unit, full Chromium, installed and sustained candidate checks
      now pass on the documented final artifact.
- [x] **Caret consumers:** replace Core calls to Muya's `getCursorOffset` and
      `setCursorByOffset` with common-model positions. Core mount, Source handoff
      and close retirement no longer capture positions by inserting sentinels into
      serialized native Markdown and reparsing it. They retain
      intrinsic normalized positions and history across mode/tab changes and a
      cancelled close, without reparsing the view or materializing source on a
      selection-only action. Component and hidden application handoff checks pass,
      including backward DOM selection, normalized positions, the next keystroke
      and undo/redo. Native selection commits preserve their actual DOM endpoints
      without changing programmatic cursor placement.
- [x] **Image-label sizing:** on 20 September the owner explicitly chose option 1:
      preserve independently reviewable label suggestions using a Markdown image-size
      suffix. [Markdown Profile 2](../language/marktext-markdown-profile-2.md) records
      this additive image-layout syntax; the five CriticMarkup forms and their
      Profile 1 semantics remain unchanged. Apply the same representation to plain
      and annotated Markdown images, retaining existing HTML images. The common
      parser owns suffix syntax, values and positions; the image-properties operation
      edits that structure before existing widgets render it. Verify actual resize
      and alignment controls, independent Accept/Reject, retained comments, references,
      subsequent typing, history, Source handoff, reader/clipboard/export output and
      exact save/reopen. The implementation and actual installed controls pass on
      `eed5f5d9` (lost in the 24–25 September rebase), including its completed local V1 verification.
- [x] **Affected-suite CI:** include shared input-policy changes in Core checks,
      Core/desktop authority changes in the Muya browser checks, and Muya changes in
      desktop unit checks. These consumers now share runtime dependencies. Updated
      `document-core.yml`, `muya-e2e.yml` and `test.yml`; these are trigger changes,
      not a report of a completed remote CI run. All three pass `actionlint`.
- [x] **Integrated local verification:** candidate `eed5f5d9` (lost in the 24–25 September rebase) passes the complete Core, The later empty-window regression and its completed affected verification on `02003385` are recorded below; broad counts remain attributed to `eed5f5d9` (lost in the 24–25 September rebase).
      Desktop and Chromium suites and all 82 installed functional cases, with all
      14 generated screenshots inspected, six 1,200-input workloads and 15 cold opens
      passed. The full 200-cycle native-Paste workload also passes, with exact source
      and unchanged pacing/deadline. Prior failures/interruption and their repairs
      remain recorded below. This completes the local candidate gate, not E1/E2/D1;
      native OS IME/Intel, distribution trust and deferred platforms remain open.

Fresh reassessment checks: selected Core input/literal/compilation/projection/image
suites passed 60 tests and failed the image-label sizing test; selected desktop
native-input, Source lifecycle and timing suites passed 49 tests; the independent
public-AST semantic test passed all 1,324 official CommonMark/GFM cases. No browser,
installed, native IME or sustained performance run was performed in that assessment.
The sampled older temporary evidence roots are no longer present locally; their
recorded counts remain historical reports, not reopened artifacts or validation of
new runtime inputs. Preserve the actual new run evidence in private test locations.

The assessment against both the wording and intent of the vision is unchanged:
the shared parser, intrinsic CM nodes, synchronous document owner and reuse of
native controls are the right foundation. The clean starting revision still
let supported actions mutate the native tree and then recover their meaning
from change events. That is a functional gap as well as an architectural one:
the next key can use a different selection, and duplicate visible text makes
intent unrecoverable. Keeping native widgets while moving their actual operations
and context onto the common model addresses the original vision. A new sidecar,
another save reconciliation layer or a standalone replacement editor would not.

The current production path is the intrinsic parser and model in
`packages/document-core`, reached through `DocumentEditing` operations captured
by Muya's native controls and `muyaModelSelection.ts`. The synchronous
`editorCoreBinding.ts` owner applies them before
`reconcileMuyaDocumentView.ts` installs the resulting model view and selection.
`blockCommandPlanning.ts`, `blockMovePlanning.ts`, `textMovePlanning.ts`, `codeLanguagePlanning.ts`,
`paragraphJoinPlanning.ts`, `formatPlanning.ts` and `clipboardPlanning.ts`
plan their respective actions from common syntax and actual positions. Shared
typing, image and emoji policies belong in `packages/input-policy`; consumers
do not establish Markdown or CM meaning by rescanning view text. Core mounts,
Source transitions and close leases carry `DocumentSelection`, including
intrinsic normalized positions. The legacy adapter decoding methods remain for
old replay tests, but the production `editor.vue` event path no longer calls
them. Any newly discovered native producer must migrate before U1 can close.

### 21 September image-layout implementation and verification

The owner chose option 1, preserving independent label suggestions, rather than
bundling them into a whole-image substitution. The production path extends
`markdownParser.ts` with `imageSizeAttributes.ts`: the same inline/reference image
nodes own the suffix, dimensions, alignment and exact source positions. Existing
CriticMarkup arm scopes govern containment and the revised layout shown in Markup.
`Format.updateImage` submits the actual selected image and property change through
`DocumentEditing`; `planImageProperties` edits that syntax through the common
compiler. `muyaMarkupPresentation.ts` and `markdownProjectionHtml.ts` consume the
same attributes for the existing widget, readers, comments and exports. No UI
parser, projected-string recognition or supplementary event metadata is added.

The former Markdown-to-HTML conversion and explicit rejection of annotated labels
are replaced for Markdown images. Existing HTML images keep their attribute-edit
path. Shared HTML clipboard import retains sized images as HTML, supported by both
standalone Muya and Core; `prepareClipboardMarkdown` uses the existing parser-owned
`paragraphImageRange` classification so a copied image stays inline at the native
paste location. WYSIWYG clipboard content remains the established Revised
projection, while canonical label suggestions stay independently reviewable.

The initial regressions demonstrated resize rejection/HTML conversion, missing
reader/export dimensions and lost imported dimensions. Focused controls pass for
plain/CM resize, alignment, reference images, isolated comments and clipboard.
Independent review additionally reproduced tracked clear/restore, multi-property
and partial-value annotation failures, including a next key entering a deleted
arm. Those fixes now pass focused Core and actual native-caller checks, including
next-keystroke placement. Final combined verification is in progress; earlier
green snapshots do not certify this changed source. Detailed logs are preserved under
`/tmp/marktext-image-layout-xSzfFF/`, `/tmp/marktext-image-size-DAwyuq/` and the
fresh verification root `/tmp/marktext-image-final-tiQxeG/`.

The frozen private source is `6941c3db438603221767603afb277e8e949b6f30`,
with 2,637 files recorded in `snapshot-manifest.json`; it contains the authorized
worktree changes based on `cf722bb71de79b63587bd2ebcd1cd46bfaa56e01`.
All six type checks pass, and uncached lint reports zero errors (724 root warnings,
17 Muya warnings). Desktop passes **3,289/3,289**, Muya **1,580/1,580** and
Chromium **850/850**, with no browser retries or skips. The full Core run passed
**1,322/1,324**: two 100,000-region retention tests hit the existing five-second
limit while other suites/builds were running. An isolated rerun of their complete
file passes **104/104** with that limit unchanged. This is separate-run evidence,
not a claim that the initial full run passed. A subsequent complete serial Core
run passes **1,324/1,324** in 58.83 seconds (`core-full-serial.log`), with all limits
unchanged. The public-AST consumer again
passes all **1,324** official rows; Muya conformance passes **1,347** checks while
retaining the existing 78 CommonMark and 90 GFM expected mismatches.

`build:unpack` and ARM64 DMG packaging pass. The DMG SHA-256 is
`1788c23278d710d821cf426363cfd85583e205d17c415d0187cb14295422677d`.
The app was copied from a read-only mount into this run's private `installed/`
directory; all 102 outer bundle files match, all 890 compiled files inside ASAR
match `build-sha256.json`, and `codesign --verify --deep --strict` passes.
`installed-artifact.json` records executable/ASAR hashes. This is ad-hoc local
integrity, not Developer ID/notarization or Gatekeeper trust. The first installed
26-case run times out inside `electron.launch`, after the main debugger connects
but before a renderer endpoint or document assertions. One test fails and 25 do
not run; `electron-installed.log` preserves the failure. Installed diagnosis and
all sustained measurements remain pending.

The startup diagnosis captured the actual uncaught exception before the native
error dialog: `Cannot find module 'native-keymap'`. The local postinstall had
restored that optional-install package, but pnpm's installed dependency graph
omitted it, so the packager left out a required main-process import.
`electron-builder.yml` now explicitly includes its runtime and licenses;
`verifyPackagedApp.ts` rejects missing package metadata, entry point or addon.
Three red controls now pass with the retained package-integrity checks (**13/13**).
The source package remains optional for its existing patched rebuild workflow;
there is no keyboard fallback or suppressed error. A new artifact must verify
this packaging repair. Four additional hidden installed tests cover real
application quit and incoming-file handoff while Save As holds a retired view,
on both Markup and Source; their type/lint checks pass, execution is pending.

### Installed package and lifecycle follow-up

The repaired private candidate is `64c1c9d14d0008d17e0fb38e99d4a42b3e678935`,
with evidence under
`/var/folders/6k/xzgngnms6jg4_z2l40y0_9vh0000gn/T/marktext-installed-final-nxkwtn6p/`.
Its DMG SHA-256 is
`115ce8f807ccb6b5bb34755d95fc7ffba9a23cf19dbb916734e613c9ba657fee`.
All 103 outer bundle files match the mounted DMG, all 890 compiled files match
the build, and deep strict local signature verification passes. Compared with
the preceding candidate, 889 compiled files are identical; the only compiled
change is the main-process build-commit literal. The added keyboard addon is
present and its existing IPC returns the U.S. layout and 119 key mappings in
the installed app. Default Core, hidden-window and nonfrontmost checks pass.

Both installed image cases pass actual resizing/alignment, independent label
Accept/Reject, retained comments, immediate typing, Source selection handoff,
history and exact save/reopen. The final preview assertion now moves the caret
out of the image label: existing native behavior shows editable image syntax
while Review locates that label. Source remains exact across this presentation
change. All eight installed close/quit/incoming-open lifecycle cases also pass.
The new quit tests retain their ChildProcess handle before Playwright disposes
its app wrapper, preserving the actual zero-exit and exact saved-byte checks.
These are overlapping focused runs; a final combined run remains required.

Installed investigation also found that the shared test launcher inherited
Core test controls by default. Its packaged path now clears mode, shadow and
control overrides before applying an individual test's explicit fault/recovery
options. A failing environment-capture regression now passes with the retained
launch/ownership controls (**11/11**). This changes the test harness, not the
application's default authority or failure behavior.

The combined installed run reproduced a real table-dialog failure. A trusted
click on enabled OK reached Vue, but `Muya.createTable` threw `Table creation
has no document selection` before dispatching a model command. Vue logged the
caught exception; the window-error IPC counter did not see it. The following
keystroke was lost and exact saved source stayed unchanged. Bounded repeats
and console traces are retained in `table-dialog-*-diagnostic.log`; earlier
passing instances do not waive this failure.

Closing the dialog and awaiting Vue's render flush alone did not fix it. The
frozen `89c552f7f22c823dbe39ae5d9e5a477fb6c70a6c` build passes Desktop
**3,296/3,296** and types, but its repeated native control run fails. Debugger
evidence in `/tmp/marktext-final-table-wflpr83i/table-retained-state.json`
shows Muya's retained selection pointing at disconnected initial blocks; those
references are not the clicked target. The old fallback cannot restore them.

The dialog now captures the actual common-model `DocumentSelection` before its
inputs take focus. After closing the dialog and releasing its focus trap, it
uses the existing `restoreMuyaDocumentSelection` boundary, then invokes the same
`Muya.createTable` → `DocumentEditing` → common-model table command. Editor,
lease and model-view checks prevent applying a retired target to another view.
This retains the operation's actual location; it adds no parsing, source scanning
or reconstructed event. The regression retains immediate first-cell caret,
next key, exact repeated-paragraph location, history and saved-source checks,
and now observes Vue console errors as well as renderer IPC faults.
Private source `ac7b5d3d7211cee91a2a9ecfe623ea8327553ef7` under
`/tmp/marktext-final-selection-0fgonmmq/` passes **20/20** actual table controls
(ten plain and ten CM), Desktop **3,296/3,296**, types and uncached root lint
(zero errors, 725 warnings). Independent review then added acknowledged-revision
and generation checks because a model view can be reused across revisions.
The first implementation compared identity objects and failed its native check:
the save barrier replaces that object even at the same generation/revision.
Debugger evidence in `/tmp/marktext-final-guarded-m8n35bi0/table-guard-repeat.log`
records identical generation/revision values and view, but unequal identity
objects. The guard now compares values; an actual save while the dialog is open
is added to the regression. That deterministic control fails on the reference
guard and passes both plain/CM cases on the value guard, without a post-click
wait. Desktop types and targeted uncached lint pass after the correction.

The resulting frozen candidate is
`1d860277318cf6a0cac5a0ce07bcfa90efa6d0c6`, with evidence under
`/tmp/marktext-final-candidate-0l39t2qy/`. Its ARM64 DMG SHA-256 is
`2c6e72941da9942f10c74633d3f981fab76e0b270ce3121d753792048de4b9ec`;
the installed ASAR is
`048f9c27559e086811583004db514c121a4b8bf44de49bb0b5f5e58f12904451`.
All 103 outer files match the read-only mounted DMG, all 890 compiled ASAR files
match the frozen build, and deep strict local signature verification passes.
Default Core startup and the actual keyboard-addon IPC pass in the installed,
hidden, nonfrontmost application. `broad-suite-source-delta.json` records the
changes since the full Core/Muya/Chromium snapshot: their runtime source is
unchanged; subsequent runtime edits are in the desktop table dialog and package
contents. All **30/30** combined installed image/table/selection/recovery/lifecycle
cases pass in 56.9 seconds, without retries or skips.

The retained 36 consumer checks then expose a prepared-paste regression: Copy
and Cut pass, Paste fails, and 33 checks do not run. The actual paste event
carries the correct Revised rich/plain payload. Core accepts it and the real
save barrier returns exact pasted source at revision 2, but the view remains
unchanged. The next native `X` enters at the old caret (`ZXcopied…be`), rather
than the common operation's result (`Zcopied…beX`). Same-artifact diagnostics and
their private profiles are retained in `clipboard-*-diagnostic.log` and the
recorded runtime directory.

The cause is the native reconciliation guard: while an asynchronous clipboard
preparation submits its now-accepted operation, it remains in the recovery-owned
preparation set. `hasPendingEdits()` counts that set and suppresses the view
update; removing the completed preparation afterward does not reconcile it.
Pending resource ownership and an unreconciled native text draft are different
conditions. The repair must preserve payload/settlement/recovery ownership while
allowing accepted model operations to install their view and selection before
the next input. Native-helper regressions are being strengthened to use the
same guard as production, including another pending resource and intervening
typing. Four plain/CM and simultaneous-resource controls reproduce the defect
before the fix and pass afterward. The view guard no longer counts resource
preparations; composition/native drafts remain protected, and resource
settlement/recovery ownership is unchanged. The affected 61 files pass
**1,079/1,079**, along with Desktop types and targeted lint. Evidence is under
`/tmp/marktext-prepared-clipboard-Whzx22/`. Final installed verification remains
required for this changed runtime.

The independent remaining-consumer run passes 29 export/Review cases, then
fails the last Review case's timing probe; three Search cases do not run there
and pass in a separate **3/3** run. The Review UI correctly shows `seed!`.
Its probe was registered on the editor after the synchronous production input
handler, so it captures that edited state, predicts `seed!!`, and timestamps
the event after dispatch/acknowledgement/reconciliation. The same-artifact
`review-latency-diagnostic.log` demonstrates all four facts. Moving the observer
to the earlier capture phase must preserve exact DOM checkpoints and timestamp
ordering; no timing limit is relaxed. Final candidate and sustained checks
remain open.

The corrected observer has a failing-before/passing-after ordering regression
plus outside-editor and cleanup controls; the 19 affected helper checks pass.
Candidate `b9d5bea1f2b308b6fcb16b39b51accbcac27b3e3`, under
`/tmp/marktext-final-prepared-9t4otf1i/`, includes the prepared-paste and observer
repairs. Desktop passes **3,303/3,303** (297 files), types pass and uncached root
lint reports zero errors and 725 warnings. Its installed startup/addon smoke
and both previously failing native Paste/Review cases pass. Paste now includes
an immediate next `X`, exact final `beX`, two-step history and reopen.

Review also identified an overly strict precondition added to the table repair:
global adapter settlement includes pending imports, so invoking Table during an
import would trigger recovery despite a valid acknowledged model target. The
dialog must retain that target through Core's existing selection owner and
wait for resource settlement before taking editor focus. This preserves the
pending paste's live selection while its result is reconciled, then uses the
rebased model target when the dialog confirms. Cancellation, supersession and
view retirement release that retained target. Two actual native tests
hold only the OS clipboard bridge response to exercise this interaction for
plain and annotated paragraphs. A third cancels the waiting table request with
Escape, then requires the original import to finish without a late dialog and
checks the immediate next key, exact source, history and reopen. The correction
uses the existing Core retained-selection owner; there is no separate target
mapping. Desktop types and targeted lint pass. Final native verification uses
private candidate `c115c6c3df2d232e6d4e82a933bb9ae4690d3ba8` under
`/tmp/marktext-final-table-owner-nqiao2hq/`; its manifest records 2,639 source files
and 890 compiled files. Relative to the previous candidate, only the table
component, table native test and this plan changed.
The three new native cases explicitly exclude Linux because production bypasses
that OS image-path lookup there; ordinary table cases and common pending-resource
tests still run. Equivalent native Linux interaction proof remains D1, rather
than being counted as verified by this macOS-only gate.

All **5/5** final unpacked table cases pass, including real Save while the
dialog is open, both pending-import targets and Escape cancellation. The final
ARM64 DMG SHA-256 is
`f60de7c3844bcdbfa29d256f1c01dc108bdef535c697e92bf77036a1742993ff`;
its installed ASAR is
`ab9a1d01cfdafd8eaa164005a8daa40f36b6eafd00d15a8c4ede91e128394037`.
All 103 outer files match the read-only mounted DMG, all 890 compiled files match
the frozen build, the keyboard runtime/addon is present, and deep strict local
signature verification passes. `snapshot-delta.json` also confirms that Core,
Muya and shared input-policy runtime source is unchanged since the full broad
verification above. Installed startup/default Core/native keyboard smoke and
all **69/69** cases pass: 33 image/table/selection/recovery/lifecycle and 36
clipboard/export/Review/Search cases, with zero failures, skips or retries.
`native-functional-verification.json` records the exact inputs. A subsequent
test-only cleanup correction guarantees clipboard restoration if app shutdown
rejects; its original and changed hashes are retained in
`table-cleanup-test-overlay.json`. Packaged runtime is unchanged.

The first unchanged sustained workload fails after all **1,200** measured keys
in a 1,000-paragraph plain document. p95 echo is **73.5 ms** (limit 16.7), dispatch
**0.2 ms** (limit 8), acknowledgement **42 ms** (limit 50), and reconciliation
**73.1 ms** (limit 50). Pairing is valid, maximum pending depth is one, and saved
source is exact. After explicit GC, renderer JavaScript heap grows from
22,934,696 to 787,038,696 bytes; embedder heap grows from 9,907,120 to
1,230,635,488 bytes. These observations require diagnosis: retained test-probe
DOM references and full native-tree replacement are separate hypotheses, not
established application leak causes. `performance-plain.log` and the raw data
under `/tmp/marktext-perf-runtime-zx5_vyxz/marktext-warm-plain-ofObmH/` preserve
the failure. All other task-owned tests/builds had finished; existing unrelated
host activity is recorded in `performance-host-before.json`. The other five
warm workloads, editorial cycles and cold observations have not run. Limits
remain unchanged; V1 remains open.

A separate 120-key diagnostic on that installed artifact confirms that completed
timing samples retain detached DOM references. Releasing only those references
after timing and saving reduces retained JavaScript heap from 104.1 to 29.1 MB
and embedder heap from 129.0 to 14.1 MB. This is a test-probe retention defect;
the original heap growth must not be reported as an established application
leak. The CPU profile still identifies real runtime costs: full canonical parsing
inside input planning and edit preview accounts for roughly 39 ms per key;
whole native-tree replacement then forces selection restoration and layout.
The short profiled run is diagnostic evidence, not a calibrated performance
pass. Raw profiles and before/after heap observations are under
`/tmp/mt-probe-n6ru4day/marktext-warm-plain-VXQPzf/`. Repairs remain subject to
the same common-model path, exact-source/selection checks and original limits.
The probe now releases completed/cancelled DOM references while retaining scalar
timing and exact checkpoint evidence. Its regression changes from six failures
and one pass to **7/7** passing. Repeating the 120-key diagnostic with that
test-only correction retains zero completed DOM references: JavaScript heap
22.2 → 28.2 MB and embedder heap 9.0 → 9.0 MB, without post-hoc cleanup. Source
and pairing remain exact; runtime echo p95 still fails at 67.4 ms. This separates
the repaired measurement retention from the unresolved application latency.

The runtime correction reuses existing canonical-region parser admission in
`documentCore.ts` for `inputPlanning.ts` and payload-preview validation. It
retains the full common-parser path for syntax requiring wider context; it adds
no projected-text parser or independent typing interpretation. The exact prior
candidate fails six of the nine resulting controls; the corrected source passes
**9/9**, with **196** affected Core checks, types and scoped lint passing. Tests
retain old-revision/source/AST parity and validate reference, literal and boundary
fallbacks as well as repeated plain and CM input.

At the rendering boundary, `reconcileMuyaDocumentView.ts` now gives the accepted
state to `Muya.reconcileContent`. Its existing native tree operations retain
unchanged roots and replace only changed roots, without dispatching an editing
operation or reconstructing its meaning. The desktop owner applies the current
editable paths once, then restores the common-model selection synchronously.
The prior native control fails unchanged-block identity; corrected ordinary/CM
input, Enter/history, composition cancellation, reference repaint and prepared
paste controls pass **22/22**. Desktop/Muya types and scoped lint pass. These are
source-level corrections; the changed runtime still needs the full affected
suites and installed sustained gate before V1 can close.

Private candidate `6f89d5bdf1d85eb09144d949178f9be06d70e14a`, under
`/tmp/marktext-final-incremental-gvjj619y/`, freezes these corrections in 2,641
source files. Its bounded native 120-key/1,000-paragraph check passes unchanged
limits: p95 echo 11.2 ms, dispatch 0.3 ms, acknowledgement 2.3 ms and
reconciliation 10.9 ms. Saved source and pairing are exact, pending depth is one,
and no completed probe retains DOM. This shorter unpacked measurement supports
the fix but does not replace the installed 1,200-key gate.
All full affected suites pass on that frozen source: Core **1,333/1,333**
(88 files), Desktop **3,310/3,310** (298), Muya **1,580/1,580** (235), and
Chromium **850/850** (128), with no retries or skips. Types and affected lint
checks pass. Installed and sustained results for this revision follow below.

The installed ARM64 DMG has SHA-256
`4679d64fe4226deee4d1e72afe71f0024d81976da2576953353f86e358fac7c7`;
its ASAR is `9c7a9b4e95574de2236fc9fa31955f58b6660a0eaf6acfb3d79a333627149b6c`.
All 103 installed bundle files match the read-only mounted DMG; all 890 compiled
files match the build manifest. Ad-hoc deep/strict signature verification passes.
Startup exercises the actual native keyboard addon (U.S., 119 entries), with
Core override flags absent, the window hidden and the application nonfrontmost.
All **33 functional + 36 consumer cases pass**, with no skips, retries or test
overlays (`native-functional-verification.json`). This establishes local artifact
integrity and default-enabled behavior, not E2 distribution trust.

All six installed **1,200-input** workloads pass the unchanged timing limits.
Each includes eight unmeasured warm-up inputs and 20 ms input pacing. Source is
exact, pairing is valid and maximum pending depth is one in every workload.

| Workload                                  | Echo p95 ms | Dispatch p95 ms | Acknowledgement p95 ms | Reconciliation p95 ms | JS heap before → after MB |
| ----------------------------------------- | ----------: | --------------: | ---------------------: | --------------------: | ------------------------: |
| Plain, 1,000 paragraphs                   |         6.7 |             0.2 |                    1.7 |                   6.4 |             21.38 → 30.16 |
| Dense CM, ordinary typing, 80 sections    |         3.3 |             0.2 |                    1.3 |                   3.0 |             20.75 → 28.40 |
| Dense CM, tracked typing, 80 sections     |         4.2 |             0.2 |                    1.9 |                   3.9 |             21.28 → 28.72 |
| Unicode, tracked typing, 80 sections      |         4.6 |             0.2 |                    2.2 |                   4.2 |             21.56 → 29.72 |
| Mixed blocks, tracked typing, 80 sections |         8.6 |             0.2 |                    1.9 |                   8.3 |             24.73 → 37.01 |
| Mixed media, tracked typing, 20 sections  |         5.0 |             0.2 |                    2.2 |                   4.6 |             24.31 → 29.86 |

Echo/dispatch/acknowledgement/reconciliation limits remain 16.7/8/50/50 ms p95.
Heap observations use collection outside the timed loop and include retained
history; they do not establish a leak-free long-running application. DOM echo
checkpoints do not measure physical paint or OS input latency. Task-owned builds
and tests did not compete with these runs; unrelated host activity was recorded
in `performance-host-before.json`, without attributing individual delays to it.
Raw data and summaries remain under this candidate and
`/tmp/marktext-perf-runtime-wr8bih07/` (`performance-summary.json`).

All **15 cold-open observations pass**: five fresh processes/profiles each for
plain 80 paragraphs (Core open 13.6–14.0 ms, editable 28.1–29.0 ms), dense CM
80 sections (51.6–55.3 / 79.7–83.0 ms) and plain 1,000 paragraphs
(42.4–45.0 / 120.0–123.9 ms). Limits remain 500/1,500 ms. These measure renderer
document opening, not whole-application startup or a cold filesystem cache.

The **200-cycle editorial gate remains incomplete**. Exact saved source was
confirmed through 70 cycles before an external clipboard change interrupted
native Paste. The preservation fixture retained its private backup and did not
overwrite the newer clipboard contents. The interrupted run is neither a pass
nor a product paste failure. Its private log is retained; clipboard contents
are not reproduced here. The test now checks its owned payload immediately
before native Paste and stops without printing unexpected clipboard contents.
This check does not isolate the system clipboard.

A separate **10-cycle clipboard-free diagnostic** uses native text insertion
in place of Paste and is explicitly not the required gate. It preserves exact
source, has no Playwright action retries and identifies runtime work: Backspace
acknowledgement p95 67.3 ms/reconciliation 70.9 ms, Review accept median
reconciliation 117.0 ms and undo 110.4 ms. Text/count assertions total about
66 ms across the run. Deletion still obtains full-document syntax before its
regional input planner; Review resolution/history also trigger full model and
view work. Repair these common paths and verify the real 200-cycle workload
without changing its deadline, cadence or operations. Diagnostic evidence is in
`editorial-diagnostic/`; it does not supersede native clipboard verification.

The renderer CPU profile confirms 4.81 seconds of full-document parsing across
90 Backspaces. Ten Accept actions spend about 529 ms parsing and 531 ms building
the full Muya view; ten undos spend 507/499 ms. Actual DOM reconciliation is
small (about 25 ms for the ten accepts). Passive Review/consumer refresh adds
587 ms parsing across the diagnostic, alongside its existing readiness debounce.
The profile and raw diagnostic remain at
`/tmp/mt-editorial-profile-2shffdp0/marktext-sustained-editorial-kfg4RR/`.

Deletion now resolves literal context through the same admitted canonical syntax
used by input planning. Private syntax-owned point helpers retain the public
full-document API; literal clamps use that syntax's coordinate map. Pairing
requires an admitted region covering both the caret and actual browser target.
Cross-region, literal and unsupported contexts retain the common parser's full
path. Eight repeated plain/CM deletion cases first failed for full parsing;
all 13 new cases and **204 affected Core cases pass**, with types and scoped
lint clean. Controls include forward/backward deletion, code-boundary targets,
hidden comments, exact next selection, unchanged old revisions and fresh-parser
parity. Evidence: `/tmp/marktext-core-deletion-regions-CK5mqC/`. Independent source
review found no alternate parser or semantic lane. Installed verification of this
new runtime remains pending.

Review resolve and undo/redo now request Core's existing markup projection,
as native edits already do. The acknowledgement resolver applies an eligible
regional result only to its exact preceding view revision; structural or
reference-sensitive cases retain the full canonical view. This does not make
structural resolution incrementally eligible or claim to eliminate its full
parse. Two actual manager/Muya regressions first failed for the absent request;
**75 affected tests**, Desktop types and scoped lint pass. They verify exact
source, immediate next-key caret/history and canonical reference rendering on
document fallback. Independent source review found no changes to pending input,
authority, history grouping or selection ownership. Logs:
`/tmp/marktext-regional-review-{red,green,types,lint-final}-20260921.log`.

Private candidate `68b2272d57eb7d23328fffd017157117e8112cb5` in
`/tmp/marktext-final-editorial-1o8_0lmi/` freezes the deletion and projection-request
corrections plus the guarded native-Paste test. Its 2,643 source files match the
user worktree before this documentation update; the build succeeds and all 890
compiled files are hashed. Its 10-cycle clipboard-free native diagnostic passes
with exact source: Backspace acknowledgement p95 **0.8 ms**, reconciliation
**4.9 ms**, compared with 67.3/70.9 ms on the preceding candidate. Review remains
about 520 ms per cycle. The observed loop pace estimates about 167 seconds for
200 cycles before startup/cleanup and actual Paste; this is not a gate result.
The profile-identified repeated line-position scan in the full view builder is
being reduced before installed editorial verification, without changing the
workload or its 180-second deadline. Diagnostic summaries and raw provenance are
in this candidate's `editorial-diagnostic/` directory.

The full view builder now lazily maps canonical event line endings once per
view and reuses that array for structural leaves. Event order, coordinate
map/affinity and strict range bounds are unchanged; nothing is cached across
revisions. The original repeated-work regression made 2,861 coordinate lookups
for 781 source units and 65 line endings, exceeding its linear-work bound.
The correction passes that regression and independent CM/CRLF nested list,
blockquote and table position expectations. All **124 affected tests**,
Desktop types and scoped lint pass; independent review found no semantic lane
or old-view ownership change. Logs are
`/tmp/marktext-view-line-index-{red-final,focused,types,lint}-20260921.log`.

Candidate `9385086a46947496745b6dd1788686d6d163ae3f` in
`/tmp/marktext-final-view-8bptnqe2/` freezes all these corrections (2,644 source
files, 890 compiled files). The full Core suite passes **1,346/1,346** in
89 files on `68b2272d`; all 203 Core/input-policy and workspace inputs match
this new candidate by hash (`core-source-equivalence.json`). The final Desktop
suite passes **3,314/3,314** (300 files) and Chromium **850/850** (128 files),
with no retries/skips. The 863 unchanged Muya/input-policy/workspace inputs match
`6f89d5bd`, whose Muya suite passed 1,580/1,580 (`muya-source-equivalence.json`).
Types and affected lint pass; `git diff --check` is clean.

The final ARM64 DMG SHA-256 is
`a957fa66d56a14fb6ca015244a29e2052984e25ba3d3ceb95d6b846f237ef4b5`;
ASAR SHA-256 is `bfad77b1bbc52244b11cec3651e4412e69944d7cea2c0a3a123f0f3c3c32d66e`.
All 103 installed bundle files match the mounted DMG and all 890 compiled files
match the build. Ad-hoc deep/strict signature verification and actual native
keyboard startup pass. The installed build runs default Core with all three
Core override flags absent, hidden and nonfrontmost. All **30 clipboard-free
functional + 33 clipboard-free consumer checks pass**, without overlays, retries
or skips (`native-nonclipboard-verification.json`). Three pending-table clipboard
cases and three native clipboard consumer cases are explicitly held, not skipped
or passed; their exact command is preserved in `clipboard-held-command.txt`.

The installed 10-cycle clipboard-free diagnostic preserves exact source and
shows Backspace acknowledgement/reconciliation p95 **0.8/4.6 ms**. Accept/undo
median reconciliation is **69.85/67.75 ms**. Its observed loop pace extrapolates
to 152.1 seconds for 200 cycles, excluding setup/cleanup and substituting native
text insertion for Paste. This remains diagnostic evidence, not a passed native
clipboard gate.

All six final **1,200-input workloads pass** at unchanged limits, with exact
source, valid pairing and maximum pending depth one. Eight warm-up keys, 20 ms
cadence and heap collection outside timing are unchanged. Other task-owned
builds/tests had exited before the run; host activity is recorded separately.

| Workload                           | Echo p95 ms | Dispatch p95 ms | Acknowledgement p95 ms | Reconciliation p95 ms | JS heap before → after MB |
| ---------------------------------- | ----------: | --------------: | ---------------------: | --------------------: | ------------------------: |
| Plain, 1,000 paragraphs            |         6.6 |             0.2 |                    1.7 |                   6.4 |             21.44 → 30.21 |
| Dense CM, ordinary, 80 sections    |         3.5 |             0.2 |                    1.3 |                   3.1 |             20.74 → 28.56 |
| Dense CM, tracked, 80 sections     |         4.1 |             0.2 |                    2.0 |                   3.8 |             21.28 → 28.72 |
| Unicode, tracked, 80 sections      |         4.5 |             0.2 |                    2.1 |                   4.1 |             21.56 → 29.72 |
| Mixed blocks, tracked, 80 sections |         8.1 |             0.2 |                    1.8 |                   7.7 |             24.76 → 36.97 |
| Mixed media, tracked, 20 sections  |         4.6 |             0.2 |                    2.0 |                   4.4 |             24.33 → 29.85 |

All **15 cold-open observations pass** (five fresh processes/profiles each):
plain 80 paragraphs opens in 13.6–14.2 ms and becomes editable in 28.3–29.5 ms;
dense CM 80 sections takes 53.1–56.7 / 80.6–84.8 ms; plain 1,000 paragraphs
takes 42.6–44.0 / 120.5–123.6 ms. Existing timing/heap qualifications above still
apply: renderer DOM/document observations do not measure OS input, physical
paint or whole-application cold startup. Raw data and command outcomes are in
`/tmp/marktext-perf-runtime-0guo4sc3/` and the candidate's
`performance-summary.json` / `performance-typing-cold-completed.json`.

The owner explicitly authorized the clipboard window. All six remaining installed
cases pass in **18.4 seconds**, with no retries/skips/failures, bringing this
artifact to **69/69** installed functional/consumer checks. The combined manifest
is `native-functional-verification.json`; clipboard fixtures preserve their backups.

The unchanged **200-cycle native-Paste editorial run fails its 180-second deadline**.
It confirms exact saved source at every ten-cycle checkpoint through **180 cycles**;
it does not finish all 200, and source at the interrupted final action is not
claimed as a completed checkpoint. The wrapper exits after 181.12 seconds.
Evidence is `performance-editorial.log`, `performance-result-editorial.json` and
`performance-editorial-artifacts/` under this candidate, with runtime data in
`/tmp/marktext-perf-runtime-0guo4sc3/marktext-sustained-editorial-ye1yJl/`.
The worker's final clipboard-restoration log did not appear after timeout;
a read-only comparison confirms every current clipboard item/format matches
the pre-test backup (`editorial-timeout-clipboard-verification.json`). No manual
clipboard write was needed. All task-owned apps closed, and the owner was told
the clipboard is free again.

The remaining V1 work is to distinguish production paste planning/render cost
from asynchronous test-observation delays, using clipboard-free diagnostics
before requesting another native run. Preserve the real operations, 200 cycles,
20 ms cadence and 180-second deadline. E1/E2/D1 remain in CURRENT blockers.

A clipboard-free diagnostic then dispatches a real `ClipboardEvent` with a
task-owned `DataTransfer` through the installed application's async import path.
Only that private application's image-path IPC handler returns an empty result,
avoiding an OS clipboard read; no model or semantic handler is replaced. This
is explicitly diagnostic, not native-gate proof. Exact source survives ten cycles.
Median event-to-visible-paste is **194.4 ms** versus **197.2 ms** for the assertion;
logs show no assertion retries. Test polling is not the main cause.

Across ten pastes the CPU profile records about 592 ms parsing the current
clipboard context, 539 ms parsing candidate validation, and 676 ms in the full
acknowledged view, while actual DOM reconciliation takes only 15 ms. The real
manager/lease/adapter regression reproduces 25,731 full-parser source units for
an eight-character paste. Core now reuses its existing canonical region for
literal/placement context and the existing validated regional payload proof for
one untracked edit; the import itself still uses the common parser. Unsupported
and structural cases retain the full compiler. The adapter requests existing
markup changes for prepared and direct clipboard commands, allowing the normal
revision-checked acknowledgement resolver to consume regional results.

The repeated prepared/direct regression now parses only the **eight-character
import** and materializes no whole source. All **99 affected Core tests**, Core
types and scoped lint pass. Independent source review finds no alternate grammar,
partial-Core facade or reconstructed semantics. Desktop passes **139 distinct
affected checks**, including three repeated prepared/direct paste cycles and
reference, literal and new-structure fallbacks with next input, history and reopen.
The old-adapter control still parses 8,585 source units despite the Core repair;
requesting the existing regional projection reduces that to the eight-character
import. Desktop types and scoped lint pass (zero errors, 22 existing warnings).
Final installed verification is still required. Diagnostic evidence:
`/tmp/mt-editorial-paste-0qlmrpdz/marktext-sustained-editorial-5RVN34/`; Core red/green
logs: `/tmp/marktext-core-clipboard-regions-EZUyEp/`. The official editorial test
also retains completed-cycle timings and the interrupted stage in a fresh partial
artifact on a failure after launch and before the complete result is written;
cleanup still runs if artifact writing fails. Its actions,
assertions, cadence and deadline are unchanged.

Private candidate `eed5f5d949632d60bb6662254a7911b11b533187` (lost in the 24–25 September rebase; the hashes below remain its record) freezes these
corrections in `/tmp/marktext-final-paste-z76pgws1/` (2,645 source files and
890 compiled files). Build and packaging succeed. DMG SHA-256 is
`a5ce6b4bcf67cd40c481a7baaff45a57306b57fe4548ced871c92686b3a13b3d`;
ASAR SHA-256 is `b7f2dcdeeaf80d116a6cb106f47c51fc934f2d5113ab1c51547d391a3bbfff20`.
All 103 installed bundle files match the read-only DMG and all 890 compiled files
match the frozen build. Ad-hoc deep/strict signature verification passes.
All 863 Muya/input-policy and root package/lock/workspace inputs match candidate
`6f89d5bd` on disk and in both manifests; its **1,580/1,580** unit result is
reused only for that unchanged scope (`muya-source-equivalence.json`).

The same clipboard-free async-Paste diagnostic now passes ten exact-source cycles
with median event-to-visible-paste **4.5 ms**, down from 194.4 ms, and assertion
duration **6.57 ms**, down from 197.23 ms. The ten-cycle loop takes 7.762 seconds;
its approximately 155.2-second extrapolation excludes setup and real clipboard
acquisition and is not the required 200-cycle gate. Runtime evidence remains in
`/tmp/mt-editorial-paste-l-wm065lyp/marktext-sustained-editorial-YnLChk/`.
Affected candidate suites and installed workflows are in progress; changed inputs
do not inherit earlier results.

On this frozen candidate the complete Core suite passes **1,346/1,346** in
89 files (66.09 seconds), including the official public-AST corpus, and Desktop
passes **3,322/3,322** in 301 files (105.27 seconds). The ordinary installed groups
pass **30 functional + 33 consumer** cases, without retries or skips. Startup
again verifies the default live owner, absent overrides, hidden/nonfrontmost
window and 119 native U.S. key mappings. Chromium subsequently passes
**850/850** in 128 files (210.47 seconds), with no retries or skips. Sustained
gates remain pending at this checkpoint; six native clipboard cases remain held.

The final checklist review also identified 13 retained installed cases outside
the earlier 69-case groups: preferences (four), media projections (one), rendering
security (four), and accessibility/localization (four). Run those unchanged cases
and inspect their generated screenshots on this same artifact before claiming
the local candidate gate complete. Their historical R2–R8 results alone do not
verify the changed Core and view paths. The first run passes all four
accessibility/localization cases and the live-preferences case, then fails before
the pending-input preference assertion: it assumes the old Worker test flag
holds acknowledgements, but the current synchronous owner has already accepted
`X` (dispatch 738.8 ms, acknowledgement 743.3 ms, reconciliation 745.1 ms).
Exact visible source is `seedX`, with a ready revision and no recovery draft.
Five cases pass, one fails and seven do not run; this is not a completed group.

Repair the two preference fixtures at the actual pending boundary: an active
composition, whose settlement the existing adapters await before configuration.
Issue the real preference IPC during composition, prove configuration is waiting,
then commit and retain exact source, immediate input, undo/redo, Source handoff
and no-draft assertions. This changes test setup, not the synchronous production
owner or the pending-input requirement. Native OS IME-panel coverage remains E1.
The 12 completed accessibility screenshots have been inspected: light/dark focus,
narrow controls and localized RTL content remain visible and contained. The
French mode label wraps midword at its narrow width; no control is clipped.

The first repaired preference harness passes the live-preferences case but stalls
in its new message observer before composition commit. The captured owned app
shows a trusted active `seedX` composition, an unresolved settlement promise,
no model dispatch and no recovery draft. The observer incorrectly expects all
three settings in one message; main Preferences broadcasts one changed key per
message. Aggregate those real deliveries, and end any remaining test composition
during cleanup so a failed assertion can close its owned app. This is another
fixture failure, not evidence of a production preference failure. Preserve the
failed `/tmp/marktext-final-paste-z76pgws1/preferences-repair/` harness and logs;
the frozen runtime remains unchanged.

The second preference harness passes **4/4** in 7.6 seconds, including both
actual pending-composition cases, immediate `Y`, two-step undo/redo, configured
semantics and exact saved bytes. Scoped lint and Desktop types pass. Only the
two preference tests and their provenance imports changed after the freeze;
`preferences-repair-2/provenance.json` records the test hashes and import-only
harness mapping. Production source, compiled output and the installed artifact
are unchanged. Both failed fixture attempts remain recorded separately.

The remaining frozen media/security group passes **5/5** in 7.5 seconds. Combined
with the four accessibility cases, all **13 retained additional cases** pass;
the current installed total is **76 clipboard-free cases**, with six native
clipboard cases still held. All **14 screenshots** are inspected: Original and
Revised retain math, diagrams, highlighted code, links, fixture images and
comment content; their suggestion visibility differs correctly. No blocking
visual defect is found. `native-nonclipboard-completion.json` records this
combined coverage, exact runtime and explicit test-fixture changes. Sustained
verification is now running with other task-owned builds/tests stopped.

All **six 1,200-input typing workloads pass** on `eed5f5d9` (lost in the 24–25 September rebase), with eight warmup
keys, 20 ms pacing, valid event pairing, maximum pending depth one and exact
saved source. Echo/dispatch/acknowledgement/reconciliation limits remain
16.7/8/50/50 ms p95. Results below are milliseconds; heap is collected outside
the timed loop and includes retained history.

| Workload                                  | Echo p95 | Dispatch p95 | Ack p95 | Reconcile p95 | JS heap MB before → after |
| ----------------------------------------- | -------: | -----------: | ------: | ------------: | ------------------------: |
| Plain, 1,000 paragraphs                   |      6.8 |          0.2 |     1.7 |           6.5 |             21.39 → 30.28 |
| Dense CM, ordinary typing, 80 sections    |      3.3 |          0.2 |     1.2 |           3.0 |             20.75 → 28.53 |
| Dense CM, tracked typing, 80 sections     |      4.2 |          0.2 |     1.9 |           3.9 |             21.28 → 28.74 |
| Unicode, tracked typing, 80 sections      |      4.7 |          0.2 |     2.2 |           4.3 |             21.56 → 29.84 |
| Mixed blocks, tracked typing, 80 sections |      8.8 |          0.3 |     1.9 |           8.4 |             24.75 → 36.97 |
| Mixed media, tracked typing, 20 sections  |      4.6 |          0.2 |     2.1 |           4.3 |             24.31 → 29.87 |

All **15 cold-open observations pass**: five fresh processes/profiles each for
plain 80 paragraphs (Core open 14.4–15.0 ms, editable 30.2–32.0 ms), dense CM
80 sections (54.2–57.3 / 84.2–86.7 ms), and plain 1,000 paragraphs
(44.7–46.7 / 129.5–132.0 ms). Limits remain 500/1,500 ms. All 15 records match
the installed executable/ASAR, exact commit, 890 compiled file hashes and saved
fixture hashes (`cold-artifact-verification.json`). Task-owned builds and other
tests were stopped. `performance-host-before.json` retains unrelated host
context without attributing individual delays to it.

Raw measurements remain under `/tmp/marktext-perf-runtime-ar0lbicg/` and
`performance-preclipboard-summary.json` in the candidate directory. DOM echo is
not physical paint or OS input latency; cold measurements cover renderer
document opening, not whole-app or cold-filesystem startup. Heap observations
do not establish leak-free long-running behavior. All independent checks are
ready; the six native clipboard cases and full 200-cycle editorial rerun await
another coordinated window. No shared clipboard access occurred in these checks.

The owner then explicitly authorized another clipboard window. All **six native
clipboard cases pass** in 19.2 seconds, bringing current installed functional
coverage to **82/82**, with no retries or skips in the successful runs. Four
restoration messages account for the three table fixtures and the shared native
clipboard fixture; preserved backups remain on disk. The combined manifest is
`native-functional-verification.json`, including the 14 inspected screenshots
and the recorded test-only preference repairs.

The same window's **200-cycle native-Paste gate is interrupted**, not timed out.
It completes **99 cycles** and confirms exact saved source at every checkpoint
through **90**. Before cycle 100 Paste, the guard detects that the shared clipboard
no longer contains the fixture payload and stops before inserting it. The runner
exits after 76.505 seconds. Completed-cycle medians are **291.2 ms editing** and
**426.3 ms Review/navigation**; their summed measured duration is 71.281 seconds.
These are partial workload observations, not a passed 200-cycle run or proof of
exact source after its interrupted action.

The fixture preserves the newer clipboard instead of overwriting it with the
older backup. The pre-test backup, generic guard error and partial timings remain
in `/tmp/marktext-perf-runtime-ar0lbicg/marktext-sustained-editorial-pWDM2n/` and
`editorial-interruption-summary.json`. All owned app/test processes close; the
owner is told the clipboard is free again. A bounded independent source review
finds no clipboard write in the exercised Review, undo or navigation paths; the
fixture writes only once before the loop. Existing pasteboard-daemon logs do not
identify the writer. No current clipboard or backup contents were read during
diagnosis. `editorial-clipboard-interruption-review.json` retains this conclusion
and its limits. Do not attribute the change to the owner, relax the guard, or
start another native run without coordinating genuinely exclusive clipboard
availability. No additional production change is justified by this interruption.

The owner subsequently confirmed that other clipboard activity was paused.
The editorial-only rerun on the **same installed `eed5f5d9` (lost in the 24–25 September rebase) artifact passes all
200 cycles**, with one test, one worker, zero retries/skips and no code or workload
change. All 20 ten-cycle saved-source checkpoints and the final independently
reconstructed 8,569-unit fixture hash match. The runner completes in
**151.703 seconds**; the original **180-second test deadline and 20 ms cadence**
are unchanged. Native Paste, deletion, navigation, actual Review Accept and Undo,
final Save, empty recovery drafts, renderer-error and hidden/nonfrontmost checks
all pass.

Completed-cycle editing p50/p95 is **294.9/306.6 ms**; Review/navigation is
**423.8/439.9 ms**. These include automation, pacing, assertions and authority
barriers, not per-input latency or physical paint. Retained renderer JS heap is
**26.01 → 32.39 MB** after collection outside the loop and includes undo history.
The bounded diagnostic trace reaches its existing 4,096-event capacity; all 200
separate cycle timings and exact-source checks remain complete. This is not a
claim of an unbounded per-event trace or leak-free indefinite use.

The final fixture reports **Clipboard restored**, keeps its private backup and
closes the owned app/runner. The owner is told the clipboard is free. Raw data is
`/tmp/marktext-editorial-retry-1oc1670_/marktext-sustained-editorial-Kz8J7W/result.json`;
the successful log, runner result and independent verification are in
`/tmp/marktext-final-paste-z76pgws1/editorial-attempt-2/`. The installed executable,
ASAR and compiled main hash still match the frozen artifact. The combined final
`performance-summary.json` joins this full editorial pass to the six typing
workloads and 15 cold observations, while explicitly retaining the preceding
interruption as a separate attempt.

This completes the demonstrated local U1/U2/V1 work under the unified-stack
verification gate. The implementation uses canonical parser/model products,
actual model commands and returned model selection through the native controls;
the retired production decoder is not a fallback. No further production change
is warranted by the passing affected checks. Keep this plan active for E1/E2/D1:
actual native OS CJK composition/screenshot picker/Intel execution, distribution
trust, and the deferred Windows/Linux requirements are not established by these
local results. Preserve the original user worktree; private verification commits
do not constitute a commit or push of the user's branch.

At the owner's rebase request, `git ls-remote --symref origin HEAD` identified
`develop` as this repository's default branch. A fresh `git fetch origin develop`
confirmed `43bd8b77795fb27b1a9512737c000f7362031ea0` was already an ancestor of
current HEAD (zero behind, 163 ahead); there was nothing new to rebase onto.
No branch rewrite, stash or worktree change was required. Source hashes still
matched the frozen candidate before this plan-result update.

### 20 September combined verification

Combined testing exposed and repaired three further integration failures.
Regional view updates now use exact parser-owned display-coordinate segments
instead of finding binding text with `indexOf`. Source remounts receive the live
lease’s canonical revision instead of assuming revision one. Actual native
selection commits preserve DOM endpoints; programmatic cursor placement keeps
its existing behavior. These repairs pass immediate typing, directed selection,
history and exact saved-source checks. Text moves also retain old/deleted arms
at their origin and preserve normalized values, comments, literal EOLs and the
shared table-cell spelling policy.

Evidence is preserved in `/tmp/marktext-0012-verification-L9MQ3S/`.
The final private snapshot is `1e5b24d3b1a77efbd67be30505086e88d85cd5a9`,
copied from the uncommitted user worktree based on
`cf722bb71de79b63587bd2ebcd1cd46bfaa56e01`.
`snapshot4-manifest.json` records its 2,630 source-file hashes. The unchanged
lock SHA-256 is
`b5ab09c6768caa2ec0cda19f73471a7c1d3e3cc46082ad5dc12a48181f6dec93`.
`build:unpack` succeeds; `build-snapshot4-sha256.json` records all 890 compiled
files and was independently checked after the application tests. This plan’s
result update follows the source freeze; runtime and test inputs are unchanged.

- Desktop: **3,265/3,265**; Muya: **1,575/1,575** (`*-snapshot4-full.log`).
- Full Chromium: **847/847**, with no retries or skips
  (`chromium-snapshot4.log`).
- Hidden unpacked Electron: **24/24**, with no retries or skips
  (`electron-snapshot4.log`). Fresh private profiles cover table dialogs,
  Source handoff, close/cancelled Save As, initial/incoming-file authority,
  acknowledged-input recovery and native input/history. Recovery assertions
  now reflect synchronous admission: all acknowledged input must survive;
  rejected input remains a separate durable draft. Renderer-error checks remain.
- Desktop, Muya and browser types pass at the final snapshot. Core and shared
  input-policy types passed before the final desktop/Muya-only repairs.
  Final lint has zero errors (703 root warnings, 17 Muya warnings);
  all three changed workflows pass `actionlint`.
- The latest full Core run passes **1,270/1,271**, with only the retained
  image-label sizing case failing (`core-final.log`). It precedes Core
  formatting-only changes and the final desktop/Muya repairs; it is not a
  claimed full Core rerun at snapshot four.
- The independent Core public-AST consumer passes all **1,324** official
  CommonMark/GFM rows. Retained Muya conformance passes **1,347/1,347** while
  preserving its existing 78 CommonMark and 90 GFM expected mismatches; that
  harness result is not a claim of complete standards conformance.

Earlier failed/intermediate snapshots and their logs remain preserved as
diagnostic evidence. The final results supersede their affected failures;
no performance limits or retained product requirements were weakened.
This private unpacked artifact is not an installed or distribution candidate.
These results precede the owner-authorized image-layout extension, which requires
new affected verification. U2’s installed quit/queued-open
checks, V1’s six 1,200-input workloads, 200 editorial cycles and 15 cold
observations, and E1/E2/D1 remain open under their existing requirements.

## Migration history — not a release candidate

### Shared literal payloads, 10 September — affected source checks complete

The proposed `  ```math\n\tx\n  ```\n` fixture initially opened as code:
GitLab math is disabled by default. That widget-identity failure was a test
setup mistake, not a product defect. The bound helper now accepts the existing
model open options; with `gitLabMath: true`, the same fixture fails in the
legacy `rawLine.endsWith(desiredLine)` mapping. Log:
`/tmp/marktext-literal-payload-native-preference-red-20260910.log`.
The corrected public AST test also fails with missing math payload children;
a separate default-options control keeps the existing code interpretation.
No recognition preference or language rule changed.

The existing code payload producer now supplies intrinsic text/soft-break children
for math, diagrams, HTML and front matter as well. `muyaMarkupView.ts` consumes
those children for every existing literal widget; its source-suffix reconstruction
branch is removed. Opening then exposed a second product defect: typing at
normalized offset one lost the two indentation columns consumed by the fence,
producing `...\n y x\n...` instead of `...\n   y x\n...`.
Log: `/tmp/marktext-literal-payload-native-model-red-20260910.log`.

The common literal classification now governs `documentCore.ts` semantic values,
[`modelText.ts`](../../packages/document-core/src/modelText.ts) live
position/operation ownership, and partial clipboard projection in
[`modelTextSelectionProjection.ts`](../../packages/document-core/src/modelTextSelectionProjection.ts). The existing
[`markdownParser.ts`](../../packages/document-core/src/internal/profile1/markdownParser.ts)
layout supplies physical ranges and consumed indentation.
[`muyaMarkupView.ts`](../../packages/desktop/src/renderer/src/documentAuthority/muyaMarkupView.ts)
binds those intrinsic positions to the existing CodeBlockContent widgets; native
input returns through the existing model-selection adapter and synchronous local
owner before the next key is captured. No view predictor, semantic event metadata,
second parser or fallback was introduced. Existing media/export consumers retain
their scalar payload and do not recurse into these literal children.

Actual bound-Muya checks now pass immediate typing and the next key with no
acknowledgement wait, exact source/caret, grouped undo/redo and saved-source reopen,
for LF/CRLF/CR both plain and inside a CM Addition (six cases). The retained
wrapped-selection policy scenario also passes. Public Core controls cover literal
spelling, EOLs, partial copy, formatting no-op and source-preserving materialization.
Initial Mermaid console errors did not establish invalid input. A later assertion
that an empty `graph TD` must show an error failed: its captured DOM instead
contained an SVG. The corrected controls require both the valid empty graph and
a graph with an edge to render; a separate malformed edge must show the existing
error UI. All three controls pass editing, history and reopen. No runtime change
was made for this test correction.

An added unclosed `$$` test initially expected a math block, but the unchanged
language recognizer requires its matching delimiter. The test now explicitly
preserves ordinary Markdown for unmatched dollars; runtime recognition was not
changed to satisfy that mistaken expectation. The first broader Core run passed
1,151 of 1,153 checks: that test mistake and the retained image-label sizing failure
were its two reds. It is not final verification.

Runtime source is held at HEAD `3dc316e99c69`, worktree SHA-256
`c14686e254234561c6030e50440b013961dec9063b2523ece4b48a55836fdb1e`,
lock SHA-256 `b5ab09c6768caa2ec0cda19f73471a7c1d3e3cc46082ad5dc12a48181f6dec93`.
Serial retained checks at that unchanged source passed Desktop 3,109/3,109,
Muya 1,575/1,575, upstream conformance 1,347/1,347 and Core/Desktop/browser types.
Core passed 1,152/1,153 with only the retained CM image-label sizing failure.
The first Chromium run failed the mistaken empty-graph assertion and stopped
progressing while replacing its worker. Its owned process subtree was terminated;
that interrupted run is not a pass. Evidence directory:
`/var/folders/6k/xzgngnms6jg4_z2l40y0_9vh0000gn/T/marktext-literal-payload-verify-20260910-b4chvhgr`.
`source.json` records 2,531 regular source files; the checksum excludes `specs/`.
`source.json` and `source-end.json` match. Only the browser fixture was then
corrected and strengthened, producing worktree SHA-256
`953957e6bade718e065a06fb35f35052f868efddc34e083acff2e13c9a8edf51`.
The affected Chromium group passed 104/104 at that test-only revision
(`chromium-final.log`); browser types passed again and
`source-browser-final.json`/`source-browser-end.json` match. This is the affected
browser group, not the full Chromium suite. The earlier interrupted browser run
remains failed/incomplete and contributes no pass evidence. Scoped lint passed with zero errors (six existing
Core non-null-assertion warnings). No installed artifact or sustained-performance
result is claimed. Other literal Backspace merges still use
the legacy semantic route and remain U1. These runtime changes invalidate affected
`6724ef6c4bc1` evidence below.

### Paragraph Backspace into code, 10 September — source checks complete

The actual offset-zero Backspace handler still appended the paragraph's native
text to the previous code widget, removed the paragraph and emitted a legacy
change. `muya-code-boundary-backspace.spec.ts` reproduces unchanged shared source
immediately after the key (`/tmp/marktext-code-join-native-red-20260910.log`).
As with wrapping, this direct-owner tracer requires model admission and does not
claim the delayed legacy decoder could never save the mutation.

The correction extends the existing `joinParagraphBackward` operation with
parser-owned code payload positions. `paragraphContent/index.ts` dispatches the
actual action through the live owner before native mutation and returns without
fallback on rejection. The generic legacy decoder remains reachable from other
literal widgets and table merges; those are still U1.

The actual no-blank-line fixture reproduced a shared ancestor-ownership bug: the
preceding code block claimed the following paragraph's start. A second actual
regression selected `b` there and typed `*`; instead of wrapping to `*b*`, literal
context replaced the selection with `*`. Structural commands and typing context
now use the same `syntaxPathAt` rule. Both regressions pass immediate next input,
exact source/selection, canonical history and saved-source reopening.

Further red-green controls caught a duplicated trailing donor comment, undefined
tracked caret, empty-code rejection, multiline indented-code escape, and a lone
HTML-image donor excluded from raw-preserving compilation. Shared paragraph
eligibility and parser-owned line/literal facts now feed the existing canonical
and tracked compiler. The bounded review found no remaining issue in this slice.
No parser, event decoder, supplemental metadata or presentation predictor was
added. Logs use `/tmp/marktext-code-join-{native-red,native-context-red,core-cm-boundary-red,literal-controls-red,image-red}-20260910.log`.

Affected checks pass: 327 Core, 19 actual desktop input cases, 30 retained Muya
controls (including rejected admission and unchanged standalone math behavior),
and 13 trusted Chromium workflows. Exact LF/CRLF/CR, tracking, CM spelling,
immediate caret/next key, history and reopening assertions remain intact.
Core, desktop, Muya and browser types pass; scoped lint has no errors. Browser
formatting-only lint fixes were followed by a final 13-case rerun. Complete
serial checks finished on held worktree
`6724ef6c4bc18e719a8d2da34817930cd0ee1e5e0d2ca4489aa808bd4cbcdec9`,
HEAD `3dc316e99c69c4f5d597f08c49986d92f31cfadf`, lock
`b5ab09c6768caa2ec0cda19f73471a7c1d3e3cc46082ad5dc12a48181f6dec93`.
Manifest/logs: `/tmp/marktext-code-join-verify-20260910-vso5udsi/`.
Final source rehash matched. Core finished 1,128/1,129 (only the retained CM
image-label sizing failure), desktop 3,103/3,103, Muya 1,575/1,575 and upstream
conformance 1,347/1,347. The 149 affected Chromium workflows passed, covering
code, paragraph boundaries, list/table boundaries, composition and Source image
history. This was not the entire Chromium suite or sustained installed testing.
The shared runtime changes invalidate affected preceding checkpoint results;
no package was rebuilt or installed, and sustained/release verification remains
open.

The next retained U1 path was source-validated at this checkpoint: math/diagram/HTML/frontmatter still have no literal children in
`markdownParser.ts::blockLiteralNode`, while `muyaMarkupView.ts` reconstructs their
mapping with `rawLine.endsWith(desiredLine)`. Reuse the existing literal payload
producer and each kind's parser-owned boundaries. The proposed opening control,
`  ```math\n\tx\n  ```\n`, requires the existing `gitLabMath: true` option;
its subsequent corrected reproduction is recorded above. Paragraph Backspace into math also still uses native
mutation; the new standalone Muya math control records its existing behavior.
These remain implementation work, not external verification blockers.

### Cross-block Code Block command, 10 September — affected checks complete

The actual `updateParagraph('pre')` cross-block route still serialized Muya view
states and submitted `json-change` for intent reconstruction. Single-block and
Quick Insert creation already enter the model; they are distinct operations.
The new actual-caller regression first fails unchanged shared source:
`muya-code-wrap-command.spec.ts`,
`/tmp/marktext-code-wrap-native-red-20260910.log`.
Its live-owner harness requires direct model admission and zero legacy submissions;
it does not establish that the old delayed decoder could never produce a file.

The selected heading and annotated paragraph must become a literal code body
retaining their raw Markdown/CM spelling, with the existing caret-at-start
convention before the next key. The outside comment, canonical history and
save/reopen must remain exact. The explicit `wrapCodeBlocks` intent now enters the same structural
planner/compiler before native mutation. Model-owned source ranges and the
existing fence serializer preserve selected bytes and handle delimiter collisions.
The integrated route no longer invokes `_wrapSelectedBlocksInCodeBlock` or its
native view serializer; rejection also returns without legacy fallback. The
standalone upstream Muya route remains supported.

Affected checks passed: 192 Core, 93 desktop, 35 retained Muya command controls,
and 46 trusted Chromium workflows (wrapping, reset and normalized input).
The actual native wrapping cases include all EOL forms with tracking on/off,
immediate next input, exact source/selection, history and reopen. A new adjacent
code-block control first failed because the preceding block owned the shared
newline boundary. The model now prefers the block beginning at the selected
position; the preceding code remains untouched.

These runs used worktree
`dc6f1af7996f5fd4c771fedd924a6c765423272be3228f67123fa8e2c22f593b`,
HEAD `3dc316e99c69c4f5d597f08c49986d92f31cfadf`, lock
`b5ab09c6768caa2ec0cda19f73471a7c1d3e3cc46082ad5dc12a48181f6dec93`.
Desktop typechecking then caught one implicit-any callback in the new test;
adding its parameter type changed the worktree hash to
`bbafad6c06b12361f62c2b2ed09a8091735fe30289bb411f26466fa2596ca044`.
Production code and assertions were unchanged; all seven affected desktop cases
were rerun green. Core, desktop, Muya and browser types pass; scoped lint has no
errors. The two manifests are in
`/tmp/marktext-code-wrap-verify-20260910-mm1tvqxl/`.
Logs include `/tmp/marktext-code-wrap-{core-retained-final,native-retained,browser-retained,muya-green,native-typed-final}-20260910.log`.
Runtime changes invalidate affected checks from the completed `19bf1a40b614`
checkpoint. No installed package or final candidate verification is claimed.

### Intrinsic normalized text positions, 10 September — source checkpoint complete

The retained partial-tab regression now passes through the live local owner:
opening preserves the tab, typing at displayed offset one produces exactly
`  ```\n   x body\n  ```\n`, and undo restores the original tab and interior
caret. Red is retained in the complete `c28fa4d59670` desktop checkpoint; green
is `/tmp/marktext-model-text-native-first-20260910.log`.

`DocumentModelTextSelection` addresses current parser-owned text values, with
ordinary source offsets or intrinsic text-node offsets at either endpoint.
The model resolves and materializes touched spelling only within the requested
mutation. Existing pairing and canonical/tracked compilation remain the owners
of editing semantics. Desktop captures and restores that position directly;
native diff decoding still rejects non-linear mappings. No normalization occurs
on opening or capturing a selection.

Focused verification includes three actual native workflows (typing/history,
formatting no-op followed immediately by typing, canceled composition followed
immediately by typing), six trusted Chromium workflows (three EOLs, ordinary or
enclosing addition), 27 copy-projection/transport checks and nine retained Source
history/recovery checks. Source undo had separately failed on `.ranges.map`;
the existing Source projection barrier now handles every intrinsic selection.
Copying one displayed space preserves the tab and history. Logs use
`/tmp/marktext-model-text-{native-composition,browser-first,copy-green,source-history-green}-20260910.log`.

Further focused checks passed 47/47 retained desktop tests, desktop typechecking,
seven trusted browser cases, and an isolated repeat of the long-binding budget
check. Actual wrap followed immediately by typing passes in ordinary code and
inside an existing addition with tracking enabled. The new test originally
expected two undo steps; the existing canonical typing policy groups consecutive
insertions, so it now asserts one undo restores the exact tab and backward
selection, followed by exact redo/reopen. No production history behavior changed.

Creating a new tracked code suggestion separately reproduced a parser defect:
`muya-code-normalized-input.spec.ts` / “tracks normalized wrapping and its next
key in the same live model”. Wrapping displayed offsets 2→1 produces selection
5→4 instead of 3→2 and two extra rendered spaces in the replacement arm.
Log: `/tmp/marktext-model-text-native-new-tracked2-20260910.log`.
The first run corrected the expected raw wrapper boundary to the existing
parser-owned code range; that spelling mismatch was a test-oracle mistake.
The subsequent visible text/selection mismatch was a product failure. The common
pending-line fact now exposes its already-computed indentation; the existing
arm-boundary projection retains that context. A pure-open AST control and all
six actual native workflows pass, including new tracking, immediate next input,
exact source/selection and history/reopen. Green:
`/tmp/marktext-model-text-native-fork-green-20260910.log`. No UI offset correction
or independent syntax recognition was added.
Core mixed-endpoint tests also caught lost consumed indentation and wrapping
that rewrote intervening code/CM lines; the common resolver and sparse endpoint
operations now pass focused controls. Those fixes still require integrated
verification and do not close U1.

The completed focused browser run passed 9/9, including ordinary and tracked
wrap→next-key, exact source/selection, canonical history and mounted reopening.
Desktop and browser typechecks passed. The complete serial checkpoint finished
against worktree `19bf1a40b614e7c301f5ac18121e225f805bb0ca30be646f2ac8e4afe98a651b`,
HEAD `3dc316e99c69c4f5d597f08c49986d92f31cfadf`, lock
`b5ab09c6768caa2ec0cda19f73471a7c1d3e3cc46082ad5dc12a48181f6dec93`.
Manifest/logs: `/tmp/marktext-normalized-verify-20260910-lxknfth1/`.
Core finished 1,098/1,099 (only the retained image-label sizing failure), desktop
3,077/3,077, Muya 1,570/1,570, upstream 1,347/1,347 and Chromium 742/742.
Final source rehash matched. No unexpected regression appeared. These are source
checks, not packaged verification; the installed app was not rebuilt or changed.
Sustained workloads and final installed macOS verification remain V1/U2.
A read-only caller trace confirms cross-block Format Code still takes native
state serialization through `json-change`/`decodeNativeEdit`; single-block and
Quick Insert creation already enter `createCodeBlock` in the shared model. That
remaining actual caller stays U1, alongside other unconverted semantic paths.

The initial formatting harness incorrectly supplied a presentation callback
that the actual formatting interface does not take. A later assertion also
mistook `recoveryDraft()` (available for accepted input) for a failure indicator.
Those harness mistakes are not product evidence. The corrected actual workflow
checks exact unchanged source/caret, immediate next input and successful
settlement. Core's no-op formatting rejection has independent red/green tests
in `/tmp/marktext-model-text-noop-{red,green}-20260910.log`.

A 4,000-line normalized code block demonstrated quadratic repeated syntax
validation: 541 ms exceeded the unchanged 50 ms reconciliation limit. One
ephemeral syntax lookup per binding replaces repeated full traversal. The same
five-sample isolated test now passes; see
`/tmp/marktext-model-text-validator-{red,green}-20260910.log`.
Run this timing test without competing files/builds; complete desktop runs must
serialize files. This component measurement does not establish sustained input
or installed performance. Command, clipboard and remaining lifecycle work is
still active, with no new frozen release candidate or packaged verification.

### Code-block reset ownership, 10 September — in progress

The next existing U1 producer is Format Code Block toggle and paragraph reset.
The actual command still reached native `resetToParagraph` / `replaceBlockByLabel`
before canonical reconciliation. The retained body-selection tracer fails with
unchanged fenced source on that caller and passes after entering the shared
`resetCodeBlock` operation, including immediate caret/next key, undo/redo and
reopen. Logs: `/tmp/marktext-code-reset-body-{red,green}-20260910.log`.
An initial fixture selected the language input instead of the code body; the
corrected fixture asserts the body identity and selection before the command,
and was rerun red against the original caller before green. No caret assertion
was relaxed.

Four bound command variants and four native controls now pass: Code Block toggle,
Paragraph, explicit Reset to Paragraph and direct reset. Toggle/Paragraph preserve
the selection; explicit/direct reset place the caret at the end. The controls
also demonstrated a native Paragraph defect: the immediate-block lookup targeted
code's presentation wrapper and discarded the body. That shared lookup now
resolves the actual code block. Exact body/caret assertions remain unchanged.
Logs: `/tmp/marktext-code-reset-modes-{red,green}-20260910.log`.

Focused Core controls then demonstrated leftover code indentation and duplicate
list/quote prefixes. The common parser now supplies literal text and soft-break
children with exact source ranges and literal values. Code reset and the code
view consume those children; the view's code-specific line-suffix reconstruction
is retired. Other literal views and cross-block code wrapping remain U1 work.
Reset uses the existing canonical/tracked compiler, preserving enclosing arms
and the code-owned terminal line ending. No legacy-event decoder was added.

Focused checks pass: Core reset 45, retained Core controls 59, desktop reset/input
controls 80, literal payload/view controls 35, and Chromium reset workflows 30
(27 ordinary/native and three tracked LF/CRLF/CR cases). They cover immediate
selection and next input, exact source, undo/redo and reopen. Core, desktop, Muya
and browser types pass; scoped lint has no errors. Logs include
`/tmp/marktext-code-reset-native-final-20260910.log`,
`/tmp/marktext-code-reset-tracked-selection-20260910.log`,
`/tmp/marktext-code-reset-retained-core-20260910.log`,
`/tmp/marktext-code-payload-view-matrix-20260910.log`, and
`/tmp/marktext-code-reset-{browser-final,tracked-browser}-20260910.log`.

The normalized-tab integration test remains red at binding installation; its
typing/history/reopen assertions have not executed. Exact segment endpoints
alone cannot represent an interior position in a tab rendered as multiple
spaces. This is an active model-selection defect, not a harness failure.
Source changes after `d8aa18a4b815` invalidate affected checkpoint results.
Complete serial checks finished against worktree
`c28fa4d59670a82b68e239a9672a575b7f402aacae1a41cb87c2943e51c9ec70`,
HEAD `3dc316e99c69c4f5d597f08c49986d92f31cfadf`, lock
`b5ab09c6768caa2ec0cda19f73471a7c1d3e3cc46082ad5dc12a48181f6dec93`;
manifest/logs: `/tmp/marktext-code-reset-verify-20260910-w9vfigvj/`.
Final rehash matched. Core passed 1,069/1,070 (only the retained image-label
dimensions failure), desktop 3,064/3,065 (only normalized-tab startup), Muya
1,570/1,570, upstream conformance 1,347/1,347, and Chromium 733/733.
No unexpected regression appeared. There is no rebuilt or installed candidate
for these changes; sustained and installed verification remain unperformed.
Subsequent normalized-text selection work invalidates affected checks from
this checkpoint and must retain both unresolved tests.

### Horizontal-rule ownership and editable blank paragraphs, 10 September

Format, Quick Insert/front-menu creation, rule-to-paragraph reset, and native
rule Enter/Backspace now dispatch `changeThematicBreak` into the same live model
before mutation. The model supplies the operation, resulting source and next
selection. Reset-to-paragraph retains its existing outer-container meaning;
Paragraph converts only the selected leaf. No specialized horizontal-rule
decoder existed to remove; these callers bypass native JSON mutation while the
generic decoder remains reachable for the other U1 producers.

The parser now supplies zero-width editable paragraph nodes from its existing
physical-line and container facts. The Muya view's EOF whitespace scanner and
empty-container fallback are retired. Original/Revised retain reader semantics,
and HTML omits empty editing paragraphs. New regressions cover root/container
emptiness, leading/middle/EOF separators, all three EOL forms, empty annotations,
and trailing list/quote insertion points. Core's focused controls pass 69/69.
The retained paired-deletion cases initially lost their caret; the root empty
paragraph correction restored those unchanged assertions.

Actual command tests first failed unchanged source, missing following paragraphs,
and native selection restoration against a replaced block. Focused integration
then passed 94/94 across horizontal-rule commands/keys, retained native input
policies (including queued wrapping), and Muya view tests. It covers immediate
next input, exact source/selection, canonical history and reopening, ordinary
and tracked changes, repeated rules and container placement. Browser creation
controls passed 8/8 before the expanded browser run. Source logs include
`/tmp/marktext-hr-model-green-20260910.log`,
`/tmp/marktext-hr-tracking-leading-red-20260910.log`,
`/tmp/marktext-hr-nested-red-20260910.log`,
`/tmp/marktext-thematic-keyboard-red-20260910.log`, and
`/tmp/marktext-hr-integrated-green-20260910.log`.

Two new oracle corrections retain the product assertions: native list creation
serializes `- ---`, which the Markdown grammar correctly recognizes as a
root rule. Model creation uses `___` within a list replacement so reopening
retains the list; containment and next-input assertions remain mandatory.
Tracked rule deletion leaves the three deleted markers visible in Markup, so its
exterior caret is offset three, not zero. An independent mapped-source test
proves that the next addition remains outside the retained deletion.

The first complete run used worktree
`67365264f075969bb0406cc8ec06f1d377666614bb6897406f7707ef28a7a20b`,
HEAD `3dc316e99c69c4f5d597f08c49986d92f31cfadf`, lock
`b5ab09c6768caa2ec0cda19f73471a7c1d3e3cc46082ad5dc12a48181f6dec93`.
Desktop completed with 3,022 passes and 14 failures: regional updates fell back
to whole-document work, regional views acquired a false EOF paragraph, and
Code/Math front-menu insertion inverted an empty target's source range. Core
also reproduced regional compaction failures; its worker reached about 3 GB RSS.
The owned verification processes were stopped, with all logs preserved, rather
than continuing that demonstrated full-update regression. Core was incomplete;
Muya, upstream and the expanded browser suite had not started. See
`/tmp/marktext-thematic-{desktop,core}-complete-20260910.log` and
`/tmp/marktext-thematic-complete-interrupted-20260910.json`.

These failures invalidate affected earlier passing results. Regional parser
windows must retain their actual document boundary and shared parse provenance;
zero-width insertion targets must not trim the previous line's ending. Those
corrections require unchanged retained tests and a new identified source check.
A browser-test-only nullability correction was also required by typecheck; it
does not change runtime or desktop assertions. No package rebuild, installation,
sustained release measurement or readiness claim accompanies this checkpoint.

The regional correction threads the actual containing-document end into parser
windows and retains shared emitted syntax/physical facts for coincident views.
It also assigns the final zero-width paragraph to the final inventory region.
The shared insertion target trims EOL only for nonempty nodes. Retained regional
view/Code/Math files pass 88/88 and the three authority/materialization assertions
pass unchanged. The two changed Core expectations explicitly include the new
empty editing node and retain exact fresh-AST comparison, nonempty block counts
and unchanged Original/Revised counts; no resource limit was relaxed.

Corrected source checkpoint:
`29001caf83fb9f2e7b8244bc38d161e8a9e40c865a1a3c86c8860e71cf0ccd41`,
same HEAD and lock above; manifest
`/tmp/marktext-unified-checkpoint-20260910-thematic-final2.json`.
That complete run passed desktop 3,036/3,036, Muya 1,570/1,570 and upstream
conformance 1,347/1,347. Core passed 1,011/1,020; Chromium passed 701/703.
Besides the retained image-label dimensions failure, Core exposed four empty
container Enter failures, three tracked-task editing-tree failures and one
resource-accounting failure. The browser failures were the same empty list/quote
Enter behavior. All 20 horizontal-rule browser workflows passed. Logs use
`/tmp/marktext-thematic-<suite>-complete-final2-20260910.log`.

The subsequent corrections address those demonstrated shared-boundary defects:

- Empty container Enter now recognizes its parser-owned empty paragraph instead
  of requiring zero children. The existing four Core and two browser assertions
  are unchanged; the browser cases also verify undo/redo and reopening. New
  comment-only controls verify that exiting the container retains comment bytes.
- Generated arm-separation whitespace must have canonical source-identity
  coverage before the parser admits it as an editable blank paragraph. Existing
  tracked-task assertions remain unchanged; focused arm/blank controls pass 110/110.
- Coincident projections share their owned segment array, so resource accounting
  charges that array once. Distinct syntax roots/nodes still count independently.
  Three new accounting controls failed before the correction and pass afterward.
  The original 65,534/65,536/65,537 resource fixtures, limit and rejection/recovery
  assertions are unchanged and pass.

Focused structural/arm/accounting checks pass 97/97; real-browser Enter and
horizontal-rule workflows pass 64/64. These runtime changes invalidate the
corresponding final2 results. The complete run checked source
`d8aa18a4b8155300f83363f901725465c6ffadefaf824c7f317912264dc19c15`,
with the same HEAD and lock, recorded in
`/tmp/marktext-unified-checkpoint-20260910-thematic-final3.json`.
Rehash after completion confirmed unchanged inputs. Desktop passes 3,036/3,036,
Core 1,024/1,025 (only the known image-label dimensions failure), Muya
1,570/1,570, upstream conformance 1,347/1,347 and Chromium 703/703 (4.8 minutes,
one worker). Complete logs and result summary:
`/tmp/marktext-thematic-<suite>-complete-final3-20260910.log` and
`/tmp/marktext-thematic-complete-final3-20260910.json`.
Core/desktop/Muya/browser types and scoped lint pass (existing warnings retained);
`git diff --check` is clean. No installed or sustained-performance result is
inherited from earlier inputs. The installed app is still `c52ddf4c`; no build,
installation, commit or push accompanied this source checkpoint.

### Front Matter ownership correction, 10 September

Format → `insertFrontMatterAtStart` and Quick Insert → `replaceBlockByLabel`
now submit `createFrontMatter` through the same live owner as the next key.
The model preserves selected prose for Format, consumes the actual trigger for
Quick Insert, and supplies the resulting literal body and selection. The shared
input policy supplies the existing YAML/TOML/JSON delimiter spellings; intrinsic
parser facts supply the language/style to the existing Muya front-matter widget.
Profile 1's earlier YAML-only restriction has been reconciled with the retained
upstream preference contract. No additional recognition was added to the renderer.

Actual bound red: Format inserted native state while the source barrier still
returned `body{>>keep<<}\n`. The new native command tests cover exact source,
immediate input/caret, history and reopen across four formats, all three line
endings and tracking. They exposed two parser defects: regional reparsing at
source offset zero disabled front matter after deleting its last body character;
Markup's combined substitution-arm presentation discarded a front-matter literal
already recognized by the common lane. The regional parser now retains BOF
options, and the existing intrinsic fork fact compilation preserves that owned
literal's canonical coordinates. Core controls pass 41/41. The initial browser
workflows pass 36/36, before the remaining trigger-boundary correction below.

Leading-comment Quick Insert reproduced the shared block replacement defect:
`{>>inside<<}/front` left the comment behind, and Code Block insertion did the
same. The shared insertion target now includes the complete block boundary;
structural ownership admits parser-owned annotation exteriors, and tracked
structural creation explicitly requests that same scope. Ordinary visible
replacements and partial annotation delimiters retain their rejection rules.
The new Core boundary controls went from two failures to 3/3 passing. Actual
Front Matter/Code/Math command tests pass 136/136, including immediate input,
history and reopen. Evidence: `/tmp/marktext-structural-annotation-boundaries-red-20260910.log`,
`/tmp/marktext-structural-annotation-boundaries-green-20260910.log`, and
`/tmp/marktext-frontmatter-trigger-owned-green-20260910.log`.

A bounded recheck corrected an inaccurate U1 entry: native table Tab only
navigates existing content leaves and sets the caret. `TableCellContent.tabHandler`,
its neighbor traversal and `setCursor` do not mutate the document or publish
`json-change`; no new table mutation command is justified by that entry. This
source check does not substitute for integrated table navigation/input testing.

Final source/test checkpoint: `a58d89dccc5b28d3e26d93ded68498fe1181ae074fe404e675b26bbc34134301`,
HEAD `3dc316e99c69c4f5d597f08c49986d92f31cfadf`, lock
`b5ab09c6768caa2ec0cda19f73471a7c1d3e3cc46082ad5dc12a48181f6dec93`.
The manifest is `/tmp/marktext-unified-checkpoint-20260910-frontmatter-final.json`.
Rehash after the complete browser run confirmed unchanged inputs. Desktop passes
2,979/2,979 (264 files); Core passes 950/951 (67 files), retaining only the known
CM image-label dimensions failure awaiting the owner’s source-format decision;
Muya passes 1,570/1,570 (234 files); upstream conformance passes 1,347/1,347;
Chromium passes 683/683 (4.6 minutes, one worker). This includes the actual wrapped
selection regression and 38 Front Matter browser workflows. Complete logs are
`/tmp/marktext-frontmatter-{desktop,core,muya,upstream,browser}-complete-20260910.log`.
The desktop run began at checkpoint `886c9e10`; the only later source-tree change
split properties onto separate lines in the new Core test to satisfy lint.
Desktop/runtime inputs and all test assertions were unchanged, and Core’s full
run used the final formatting. Core/desktop/Muya/browser types and scoped lint
pass (existing warnings retained); `git diff --check` is clean.

There is no specialized Front Matter decoder to delete. These two production
callers no longer reconstruct their intent through native JSON changes, but the
generic decoder remains reachable for the other U1 producers. The earlier
`8253208f`/`d5811b8d` complete source checks are historical for the changed parser,
command/compiler and view inputs. No package rebuild, installed verification or
sustained performance run is claimed by this entry.

These entries record successive worktree checkpoints based on
`3dc316e99c69c4f5d597f08c49986d92f31cfadf`. Later changes supersede affected
results; the CURRENT list above governs remaining work. No new installed
candidate or sustained performance result is claimed.
The `bootBoundMuya` command fixtures use the production synchronous owner,
binding, adapter and native editor. Their legacy-change listener records escaped
mutations without interpreting them: exact source plus zero legacy publication
is the migration gate. A failing source assertion there establishes missing
model-directed behavior, not by itself a claim that the installed app saved
incorrect bytes. Real Chromium and bundled/installed file workflows remain
separate required verification.

The HTML attribute decoder now directly reuses the existing `entities@6.0.1`
dependency. Its package-manager run also changed transitive lock resolutions;
those inputs are retained and require verification before freezing a candidate.

Checkpoint `final10b` records worktree SHA-256
`7c4a6d0ec2ec8ec5e376f12b80441f295bda5e90b706b605287224c722f535d6`
and lock SHA-256
`990e5ac83f33729cae6824cb168e6f86e8f7155fbb39ad82113785c560247c77`.
Complete desktop tests pass 2,731/2,731. Core passes 900/901, with only the
retained CM image-label dimensions failure awaiting the unanswered source-format
decision. Muya 1,570/1,570 and upstream conformance 1,347/1,347 passed at `final9b`;
their native implementation and test inputs are unchanged by the subsequent
Core quote correction. Chromium inventory initially failed because two new Tab
cases had identical titles; adding the target to their names preserves every
assertion and collects 604 tests. The complete browser run finished with 602 passes
and the two incorrect standalone reset expectations described below (4.1 minutes). No rebuilt
or installed artifact, sustained performance result or release readiness is
claimed for this checkpoint.
The new standalone-Muya quote-reset controls assumed preserved caret offsets;
both HEAD and current `_unwrapToParagraphs` explicitly select offset zero.
Their two observed failures therefore identify an incorrect new control oracle,
not a production ownership regression. The corresponding Core/Track controls
pass their required preserved-selection assertions. The corrected standalone
controls retain command/next-key/source/history coverage and leave Core/Track
assertions unchanged; the complete quote browser file passes 17/17. This is
evidence for final10b runtime, superseded where the Code Tab changes apply.

- Code Tab now dispatches the actual DOM selection to the common `tab`
  operation before mutation. The model supplies literal boundaries and language;
  `codeTabExpansion` extracts the existing native selector/HTML expansion policy
  for both callers. The private native recognizer was removed. Generic literal
  diff decoding still has other consumers, so it remains U1 work. Initial actual
  commands failed with unchanged canonical source; 41 controls now pass exact
  source, immediate next key/selected attribute replacement, EOL, existing and
  newly tracked literal annotations, nested containers, literal CM bytes and
  history. Retained native expansion/info-string controls pass 9/9.
  New tracked edits in CR-only literals exposed a parser defect: pending CR had
  not completed the preceding fence before CM marker ownership was inspected.
  The common marker boundary now flushes that physical line and records its
  literal/line facts; LF/CRLF/CR model compilation/selection controls pass 3/3.
  New literal-replacement test expectations were corrected to the parser-owned
  trailing EOL, independently checked through its public compilation result;
  the CR rejection was then reproduced separately and fixed without relaxing it.
  The shared policy declares the already used `html-tags@5.1.0` dependency.
  Removing that new importer entry from the formatted lock reproduces the exact
  prior lock hash; no transitive resolutions changed. These runtime inputs
  invalidate earlier affected parser, desktop and browser evidence. Full checks
  are running on worktree `e37a0ffb1321039b2a68f87a9ac7ad9ed90c933f43728b16b6ca0cb545b5679e`,
  lock `b5ab09c6768caa2ec0cda19f73471a7c1d3e3cc46082ad5dc12a48181f6dec93`.
  All nine real-browser controls pass after that correction, including tracked
  CR-only source and immediate selected-attribute replacement. Full Core ran
  902/904: the known image-sizing failure and the prior no-dependency package
  assertion. The boundary now permits only the pinned HTML tag data in the
  extracted policy; both boundary tests pass and all framework/application
  imports remain forbidden. Full desktop ran 2,771/2,772; the sole failure was
  the packed-policy fixture executing before installing declared dependencies.
  It now installs the tarball's production dependencies in its own scratch area
  and verifies both advertised module formats, including HTML expansion. That
  complete packed-consumer check passes. No runtime change followed these
  harness/boundary corrections. The final worktree checkpoint is
  `e8efdc7567ae2969b52824460113fa09ba55a489a95f7e127d56a1da4364e54f`;
  its complete browser run passed 613/613 (4.2 minutes). The later paragraph-join changes supersede affected evidence. No new app build.

- Forward Delete now dispatches `joinParagraphForward` before native mutation,
  sharing the Backspace model planner and canonical selection/history. The
  initial list-continuation reproduction left canonical source unchanged; native
  command tests now cover ordinary/tracked joins, immediate next input, all three
  EOL spellings and nested sublists. Retained native Delete/Backspace controls
  pass 25/25. Follow-up red tests found rejected standalone HTML-image joins and
  skipped empty list/quote paragraphs. The model and renderer now share the
  parser-owned image range; adjacency includes the empty containers' owned
  physical boundaries. Those actual input/history/reopen controls pass 12 image
  cases and 12 empty-container cases. The numbered-list trailing-block red
  retained a native control: its five-space
  continuation became a code block after the parent changed. The shared join
  planner now rebases owned list/quote trivia, including donor continuation
  lines, preserves relative nesting and leaves matching prefixes unchanged.
  Tracked quote promotion exposed a compiler defect: earlier sparse edits could
  invalidate a later generated suggestion's recognition. The common compiler
  now validates generated annotation/arm ranges after the complete operation,
  using its existing compound compilation when necessary. Typing at the
  resulting substitution's exterior then exposed missing relocation in the
  shared reconciliation rule (previously addition-only); both suggestion forms
  now map their owned editable arms. The final 84-case forward/promotion subset
  passes; the shared compound controls pass 12/12. Chromium promotion/boundary
  controls pass 14/14, including uninterrupted `xy` and exact tracked bytes.
  These are worktree checks, not installed-release evidence.
  `sourceEditForMuyaCrossParagraphChange` and its production invocations were
  removed after six annotated native replacement controls passed before/after
  retirement. Four former synthetic adapter cases now exercise actual ordinary
  and tracked replacement, Cut and stale DOM-selection rejection followed by
  immediate input. Their exact source, history and reopen assertions pass. A
  comment-boundary fixture now selects after the existing zero-width marker,
  retaining its original source-range oracle. The stale-path transport assertion
  was replaced with detached DOM-endpoint rejection: a reconciled path may
  legitimately belong to another paragraph. Generic decoders remain for the
  production consumers in CURRENT U1. These runtime changes invalidate the
  affected `2d1a201a…` checkpoint evidence; no rebuilt/installed or sustained
  performance pass is claimed. Complete desktop 2,909/2,909, Muya 1,570/1,570
  and upstream conformance 1,347/1,347 pass. Core passes 906/907 with only the
  retained image-label dimensions failure. These suites ran on worktree
  `d5811b8d3f0756f1931fd1ed6f3414c667fe74424c72df1a6ad264842078c8bd`,
  source HEAD `3dc316e99c69c4f5d597f08c49986d92f31cfadf`, lock
  `b5ab09c6768caa2ec0cda19f73471a7c1d3e3cc46082ad5dc12a48181f6dec93`.
  Final source/test checkpoint is
  `8253208fe379d4bb45a9bdecad9e373ca782d249cb7bda32f1665b62d4281930`:
  the only subsequent change removed one extra blank line in
  `compound-authoring.spec.ts` for lint. Runtime, lock and assertions are
  unchanged; its complete 12-case file was rerun and passed. Core, desktop,
  Muya and browser types pass; scoped lint has no errors (existing warnings
  remain). Complete Chromium verification passes 645/645 (4.3 minutes) against this
  checkpoint. The final source digest was rechecked unchanged. No current
  desktop build, installed macOS workflow, native IME or sustained release
  performance result is claimed.
  The tracked selection fixtures distinguish a caret in the retained destination
  paragraph from one in the donor/new arm. They assert immediate DOM-to-model
  selection in the Revised source domain and the subsequent input, rather than
  assuming every Markup projection collapses into one paragraph.

- Paragraph-boundary Backspace now enters `joinParagraphBackward` through
  the actual native handler and the existing live owner. Core resolves the
  preceding syntax node, separator and heading boundary before presentation or
  the next key. Initial list and ATX/Setext controls reproduced unchanged
  canonical source after native mutation. The bounded review then reproduced
  a new join defect: reference definitions, rendered as paragraph widgets, were
  skipped by the model traversal and could be removed. The correction includes
  their intrinsic nodes and physical line boundaries. No secondary recognizer
  or event metadata was added. Backspace into literals/tables and forward
  Delete still use legacy mutation, so `sourceEditForMuyaCrossParagraphChange`
  and `decodeNativeEdit` cannot yet be removed.
  The final 142 focused controls pass (29 new joins, 90 retained list-boundary
  cases and 23 native input policies). They retain exact source, resulting
  selection, immediate input, repeated locations, history and reopen; tracked
  paragraphs have independent exact spelling and Original/Revised checks.
  An initial new adjacent-highlight oracle incorrectly put the next character
  inside the highlight: the join's separator caret is outside both annotations.
  Its corrected expectation retains the exact source assertion. Eight real
  browser workflows passed before the definition correction; the complete 622-case
  browser run, including its definition regression, now passes (4.2 minutes).
  Before the definition correction, complete desktop passed 2,799/2,799 and
  Core 903/904 (only the retained image-label dimensions failure). Those results
  do not close the later changed join boundary. Retained native Muya passed
  1,570/1,570 and upstream conformance 1,347/1,347. The latest checkpoint is
  worktree `2d1a201a7114e9ea8c0637c366744bcc06d98ca912749b56004652c5c85b235c`,
  lock `b5ab09c6768caa2ec0cda19f73471a7c1d3e3cc46082ad5dc12a48181f6dec93`.
  Core/desktop/Muya/browser types and scoped lint pass. The local checkpoint
  record lists its reproducible file-hash method. Complete desktop after the
  definition correction passes 2,801/2,801; complete Core passes 903/904, with
  only the retained CM image-label dimensions failure. Final native Muya
  passes 1,570/1,570 and upstream conformance 1,347/1,347 on this unchanged
  checkpoint. No new
  packaged/installed artifact, sustained performance or native IME result.

- Math insertion now runs from existing Quick Insert, front-menu and Format
  callers through `createMathBlock`. Retired `paragraphMathEdit`, Math binding
  maps and `sourceEditForMuyaMathTextChange`. Real commands exposed three
  failures corrected at their owners: inherited container prefixes in tracked
  Math replacements, lost pre-command caret on undo, and rejection of a native
  Enter-created empty paragraph. Focused Math 33 and affected Core 93 pass;
  authored browser controls and full integrated checks remain pending.
- Modified Enter uses the same model input operation as `beforeinput`, while
  existing popup ownership and table-cell row insertion retain precedence.
  Retired `paragraphBlockquoteEdit` and `paragraphTableEdit`. Actual Quick
  Insert with modifiers reproduced the popup-priority regression before its
  correction; modifier 21 and retained native UI/format 33 controls pass.
- The explicit outer-quote reset command previously unwrapped native blocks
  without updating source. It now uses `changeBlockquote` with the existing
  parser's quote markers and preserves inner quotes/headings. Four actual
  command controls pass exact source, immediate next key, caret, history and
  reopen. Markup retains tracked deleted quote markers; Original/Revised are
  asserted independently. Generic container/leaf reset paths remain U1 work.

- Task checkbox clicks now enter `setTaskChecked` before native mutation. Core
  and the retained native caller reuse the same pure cascade/order policy.
  The common parser recognizes a tracked checkbox state from its intrinsic
  substitution owner and publishes its exact marker/state intervals. Retired
  `checkboxEdit` and `checkboxRange`. Actual controls reproduced missing
  canonical updates, tracked-marker rendering failure and movement across an
  ordinary list item; their corrections pass desktop 25, affected Core 77 and
  native 6 controls, including subsequent input/history and independent
  projections. Types and scoped lint pass. Six browser controls await the
  coordinated run; this is not installed candidate evidence.

- Retiring the quote-only branch in `annotatedContainerPrefix` exposed an
  actual front-menu/Format failure: quoting an entire CM paragraph inserted
  the prefix inside its annotation. The shared planner now uses the same owned
  paragraph exterior as headings. Actual substitution checks also caught the
  inherited-container arm separator rendering inline old/new arms as separate
  paragraphs. Its intrinsic parser correction passes the six LF/CRLF/CR quote
  and list regressions alongside retained block/Math controls. Actual quote,
  reset, structural and Math controls pass 70; affected Core controls pass 156.
  Three independent no-command controls establish that typing at the selected
  annotation end stays inside that arm; the new quote tests preserve that
  ownership rather than assume an exterior caret. Browser checks are pending.

- Fenced-code creation now enters `createCodeBlock` from Quick Insert, front
  menu and single-block Format, reusing the Math target/selection helper and
  common insertion planner. `fencedCodeMarkdown` extracts the existing native
  serializer's spelling policy for both callers. Six actual Quick Insert failures
  first reproduced unchanged canonical trigger text after native creation. Code
  33 plus retained Math 33 controls now pass; native menu/fence/info/serializer
  52 controls and scoped lint/types pass. Ten authored browser cases are
  unrun. Cross-block code wrapping and existing-code toggling remain generic
  structural consumers, so no shared decoder was removed for this slice.

- Paragraph/list Tab now uses intrinsic inline boundaries and list/line facts
  before mutation. Native and Core callers share `listTabAction`; existing task
  grouping and nested HTML-pair traversal now serve both checkbox and Tab
  planners. Actual tests caught closer priority and mixed task/plain boundary
  regressions. Retired `listIndentationEdit`, `sourceEditForMuyaContainerChange`
  and their generic structural decoder callsite. Focused production 42, retained
  annotated-container 51, native 16 and affected Core 126 controls pass; eight
  browser controls were authored. Code/table Tab remains unmigrated.
- Combining that work with the quote correction exposed one tracked task move
  rendering four checkboxes instead of the required five. The common parser now
  distinguishes inherited context from an arm-owned container using its existing
  opener source ranges, with incremental rebasing. The unchanged task next-key,
  source and history assertions pass; three EOL variants and shifted-source
  controls verify the range ownership. This supersedes the earlier comparison
  of container shapes. Affected desktop 65 and Core 125 pass.

- The retained annotated-quote matrix was still driving the retired decoder.
  Its four quote cases now invoke the actual command through the production
  owner; the other twelve list cases and all original source/history oracles
  remain. This exposed three real failures: multiline additions gained an
  interior quote prefix, and a tracked exterior prefix coalesced into an
  addition without a proven resulting selection. The shared quote planner now
  preserves the owned continuation; editing reconciliation maps that exact
  compiler relocation through the existing addition delimiters. Different
  payloads or unrelated locations do not qualify. Core 94 and desktop 85
  focused controls pass, including heading/list controls; four browser cases
  retain the command, immediate trusted input, toggling and history scenario.
  These runtime changes invalidate earlier affected full-suite results.

- The production `createLocalCoreOwner` owns the existing actor synchronously.
  Binding and session observers receive its accepted revision before the next
  user action; persistence, composition and view lifecycle retain their barriers.
  Worker test transport no longer satisfies the production binding interface.
- Native `beforeinput` carries actual DOM selection and browser target boundaries
  into the current model projection. Core determines pairing, compilation and
  resulting selection before the native view is reconciled. Successful input no
  longer raw-echoes or decodes a `json-change`; rejected drafts remain recoverable.
  Accepted input followed by rendering failure must not replay into a detached
  block. The lifecycle regression now verifies that failure separately.
- The decisive wrapped-selection test passes with immediate selection/text,
  consecutive `x`, exact source, undo/redo and reopen. Model exterior annotation
  positions, sparse paired deletion across substitution arms/hidden comments,
  and nested DOM boundary round-trips now have red/green controls.
- Real headless Chromium demonstrated that a caret outside an addition can have
  a browser target inside its text node at the same visible position. Core now
  retains the live caret for coincident collapsed insertion targets; expanded
  replacement targets remain intact. The unchanged browser scenario passes,
  including subsequent typing and undo/redo. This is browser integration evidence,
  not installed macOS verification.
- Fenced opener/info input now retains a native editing surface derived from the
  owned code-block AST until there is a body. Both prior adapter failures and
  real native typing/Enter controls pass. That checkpoint alone did not migrate Enter; the later model command controls below cover specific structural paths.
- Native bold, italic, strike and inline-code commands now enter the model before
  either menu or selection-toolbar mutation. Exact DOM boundary variants, tracked
  pending replacements, next-key selection and history/source controls pass.
  Annotation-adjacent code-span parsing and nested tracked replacement edits were
  corrected in their shared parser/compiler owners. Selection events and the
  existing toolbar now use `documentActiveFormats` from owned syntax instead of
  `getFormatsInRange` tokenization. The common lexer supplies inline HTML tag
  facts for existing underline/highlight/sub/sup controls. Other formatting
  mutations and widget consumers remain migration work.
- Composition now captures the actual source selection and submits one model
  commit or explicit cancellation. Its old composition decoding/buffering path
  is retired. Cancellation refreshes stale native DOM even when source is
  unchanged; active destroy/unbind preserves the captured candidate durably
  before disposal. Browser composition controls do not prove native OS IME.
- Clipboard cut and prepared text paste now enter the same owner. Real Chromium
  reproduced paste into selected repeated text retaining a consumed addition;
  the unchanged native fixture passes with the legacy listener retained and zero
  legacy calls. Upstream heading/list/table merge controls pass after reusing the
  owning parser and existing table serializer. Delayed image preparation now
  captures the model selection before awaiting resources and preserves subsequent
  typing; held-save/handoff and overlapping-edit refusal controls pass. Raw-file recovery now retains image bytes after file reading, with a durable-store reopen control. Broader clipboard widget selections and loading preview remain open. A history-limit refusal now faults/preserves
  clipboard intent; post-accept rendering failure cannot replay accepted paste.
- Native paragraph/list/quote/heading Enter now submits the existing model input
  action. Tracked separators exposed an omitted DOM caret origin: exact payload
  boundaries hidden by paragraph layout now have model-derived view bindings.
  The unchanged tracked Enter → next key/history/reopen browser control passes.
  Fenced code indentation/brace Enter now uses the same operation and a shared
  upstream indentation policy. Empty trailing code-block paragraphs and ordinary/Shift table Enter now have passing exact-source, next-key and history controls. Cmd+Enter row insertion and other table/widget commands remain underway.
- Clear Formatting reproduced loss of the addition in `**a{++a++}a**`; its native
  ordinary Markdown control passed. The command now removes owned formatting
  delimiters through `planFormat`, including nested styles and empty link labels.
  Native controls verify exact source, next key, history/reopen and zero legacy
  calls; four headless Chromium controls pass with Track on/off. Retained input
  policies/formatting/actor checks pass 138/138, including the original wrapped
  selection regression; affected upstream formatting/selection checks pass 31/31.
- Underline, HTML highlight, subscript, superscript and inline math independently
  reproduced the same consumed-suggestion defect. They now use the model format
  planner. Math toggling exposed dollar runs joined across hidden CM boundaries;
  the common lexer now applies its existing canonical delimiter-run limit to math.
  Parser/format context controls pass 61/61, including ordinary adjacent-dollar
  behavior. Native subsequent-input/history controls now pass after canonical history was corrected to restore the actual pre-edit selection. Nine real Chromium formatting controls pass; installed verification is still pending.
- Link creation and the existing floating Unlink tool now call the same model
  format operation. The old hovered-fragment unlink lost the remaining label and
  suggestion; native and actual Chromium controls now preserve the complete label,
  subsequent typing, history and reopen. Image creation/properties remain open.
- Canonical history now retains actual before/after selection sets for both native
  and Source input, including backward selections and multiple cursors. Source
  submits its factual edits and selections as one `source-input` action; its
  production caller no longer submits an edit-only command. No-op Source input
  keeps the revision and history unchanged. The retained authority suite passes
  172/172 after updating only obsolete command-type/payload harness assumptions;
  Source/history/lifecycle controls also pass. This is not installed verification.
- Actual clipboard heading, quote, list and table-cell controls exposed missing
  owning-container spelling. Core now supplies those boundaries and reuses the
  existing paste/table policies. Six Chromium controls pass, including retained
  upstream controls, a leading annotation, next typing, undo/redo and reopen.
  Delayed images now reuse the native loading presentation outside document
  content: accepted source remains unchanged during upload, completion preserves
  intervening typing and removes only its own preview. Full retained Muya tests
  pass 1,540/1,540 after fixing incomplete image-token test doubles; that run
  predates later image/author/empty-cell edits.
- Native image creation reproduced `a{++a++}a` becoming `![aaa]()`; it now uses
  the common format planner. One alt-text suggestion exposed three duplicated
  image widgets; the presentation stack now keeps atomic widgets alive across
  partial decorations. The existing picker is reused. The document caret is
  after the atomic image, rather than inside noneditable hidden spelling; the
  picker owns destination entry. Native format/presentation/input policies pass
  153/153. Actual picker submission/property/upload checks remain underway.
- Highlight/Addition → Source → Undo reproduced a collapsed selection. Author
  planning now lives in Core's existing preview boundary, and all four author
  forms return their model-owned selection to canonical history. Native author
  and history checks pass 16/16, Core author 7/7, retained actor author 24/24.
  Other review/search selection/history paths remain unverified.
- Cmd+Enter row insertion now uses a factual model command and the shared table
  serializer. Real Chromium supplied a different collapsed browser target despite
  retaining the intended first-cell selection. The common input operation now
  uses the live caret for ordinary collapsed `insertText`; expanded replacement,
  deletion and composition targets remain unchanged. All three original browser
  controls pass, including Track, next key, history/reopen and zero legacy calls.
  The ineffective CSS hypothesis was removed. Core input/structural controls pass
  82/82; all 29 retained browser Enter controls subsequently passed. The actual
  row popup now passes both before-header and after-body controls, including
  a stale caret in another paragraph, next input, history/reopen and zero legacy
  changes. Track before-header insertion now reuses shared compiler reconciliation for
  each exact source operation, including its resulting selection. All four
  model row-menu controls and four retained upstream browser controls pass;
  row deletion now uses the same command boundary and the clicked widget's live
  DOM target. The owned table AST supplies surviving cells and sparse delimiter
  movement when promoting an annotated body row into the header. Ten actual
  browser deletion controls pass: ordinary/Track header and body deletion,
  sole-table removal with and without outside content, next input, history/reopen
  and zero legacy changes. The upstream sole-row control exposed an existing
  outside-caret defect; navigation now begins at the table's content leaves before
  detach, and that same browser control passes. Current affected Core checks pass
  89/89, owner/history checks 15/15 and retained table mutation checks 19/19.
  Column insertion/removal now enters that same command boundary from the
  existing column toolbar and row/column menu, using the clicked cell's DOM
  endpoint even when the editor caret is elsewhere. The owning table parser
  supplies physical cell and delimiter slots; sparse operations preserve existing
  annotation bytes and materialize missing body cells only when needed. Track
  uses the same compiler and selection reconciliation. The upstream sole-column
  removal reproduced the same outside-caret defect; row and column removal now
  share the content-leaf traversal. All 37 affected Chromium controls pass
  (column toolbar 15, row popup 18, Cmd+Enter 4), including immediate next input,
  exact source, history/reopen and zero bound legacy changes. Current affected
  Core checks pass 95/95, owner/history 17/17 and retained table controls 35/35;
  Core/Muya/browser types pass. These are current worktree checks, not installed
  candidate evidence; alignment/drag/grid and complete rectangle operations
  remain unfinished.
- Rectangle Delete and Cut carry intrinsic table extent plus anchor/focus row and
  column through the same owner and history. The earlier physical-slot selection
  could not distinguish omitted cells sharing a source offset; it is retired.
  A dropped rectangle returns a cell text selection, including when no source
  bytes exist. Ordinary input and structural commands resolve that address in
  the current owned AST; only an actual edit materializes missing cells. Existing
  text selection activation clears the native rectangle. Empty whole rows/columns
  and individual row/column commands share the sparse removal operation.
  Guarded clipboard projection uses the same rectangle identity and owned AST.
- The desktop clipboard guard additionally reproduced a missing table payload:
  its contiguous text range API excluded every native rectangle before Cut could
  reach the model. The same selection-projection barrier now accepts the model's
  table selection. A Core projection selects existing Revised AST cells and the
  shared native table serializer supplies their output positions; clipboard HTML
  renders those owned nodes without reparsing flattened text. The real guarded
  browser control passes exact clipboard Markdown/HTML, omitted neighbors,
  immediate next input, source/history and reopen. Clipboard preparation now
  compares and freezes the complete selection; same-revision rectangle changes
  and in-place mutation invalidate stale payloads. Owner/projection/guard controls
  pass 17/17, including typed refusal of clipboard padding beyond the existing
  32M ceiling while canonical source and saving remain available. Installed desktop and sustained clipboard workloads remain open.
- Heading levels 1–6 from the existing `updateParagraph` menu entry now use one
  model input command. The parser supplies heading content boundaries; the same
  structural planner changes the first selected block and preserves the actual
  expanded selection across blocks. This deliberately fixes the old text-matching
  restoration that collapsed a cross-block range into the first heading. Upgrade,
  degrade and heading-to-paragraph menu actions now use that same `changeHeading`
  operation; Core interprets the current level and retains boundary no-ops. Fourteen
  Chromium controls pass for levels, ordinary upstream behavior, cross-block next
  input, tracked next input, empty documents, exact source and history/reopen;
  bound commands emit no legacy changes. Core heading controls pass 23/23 and
  retained upstream paragraph controls 32/32. These are worktree checks, not
  installed candidate evidence. Native front-menu callers and nonheading paragraph
  conversions still require migration before the heading decoder can be retired;
  reversed cross-block heading reset also needs an actual caller control.
- First tracked rectangle Delete now uses the existing tracked compiler and
  maps its selection through the exact compiled edits. A whole selected pending
  addition reproduced nested deletion instead of cancellation; the shared compiler
  now cancels the exact owned addition while preserving unrelated annotations and
  refusing edits within retained old/deleted arms. Three native text/rectangle
  controls pass next input, exact source, history and reopen; the combined heading
  and table browser run passes 27/27, and affected Core suites pass 248/248.
  Tracked structural removal and whole-table Cut remain unsupported. The later
  intrinsic-cell migration below supersedes the physical-slot selection evidence.
- Omitted-cell red/green controls now distinguish parser-node sharing from cell
  occurrence identity. Native view bindings and structural commands use the
  owned traversal location; no semantic event metadata or alternate parser is
  introduced. Copy/empty Cut leave source byte-exact; subsequent typing uses the
  same pairing and tracked compiler. Empty physical cells restore offset zero
  within their own slot. Source history projects model selections to actual raw
  spans/carets through `sourceSelectionAtBarrier`; it retains intrinsic canonical
  history and does not invent Source bytes. Input binding/recovery copies retain
  nested table addresses immutably. Source/history/immutability checks pass 21/21,
  retained manager/Source checks 82/82, Core Source checks 11/11, and desktop types
  pass. DOM mapping plus the unchanged native policy suite pass 33/33, including
  the original immediate wrapped-selection acceptance test. Affected native table
  and selection unit checks pass 44/44. The initial combined browser run passed
  34/34; broader structural controls caught an exterior annotation caret being
  incorrectly classified as cell content. A direct red reproduced invalid cell
  offsets; mapping now respects the owned content extent. All 96 affected browser
  cases pass against that runtime: 94 in the combined run, then two sole-table
  controls after correcting a test-only diagnostic that mistook a healthy recovery
  snapshot for a failure. Their exact source, next key and history assertions are
  retained. The later run changes no runtime input. The superseded clipboard preview-syntax callback
  used for physical-slot caret restoration is removed. Reachable legacy decoding
  and the remaining semantic consumers still keep U1 open.
  That checkpoint was followed by a real paste failure: clicking the later
  omitted cell and pasting `y` was accepted into column 1 instead of column 2,
  while native Muya passed. The corrected path is recorded below.
- Prepared clipboard/image targets now belong to the existing actor. DOM capture
  supplies the intrinsic cell position; `retainSelection` retains it in that
  session, every accepted mutation rebases it through the same Core model, and
  `apply-prepared` resolves it atomically before the existing clipboard/image
  operation. The adapter's source-only `advancePreparations` interpretation is
  retired. Payloads remain in the existing recovery/preparation lifecycle; cached
  model positions are recovery provenance, not an alternate admission path.
  Completed operations journal their resolved action; recovery never reuses an
  old generation's handle. Registration order governs coincident prepared targets
  independently of resource completion order.
  Red-green controls cover paste into an omitted cell, moving its table before
  completion, structural row/column shifts, removed/overlapping targets, FIFO,
  generation isolation and replay. Header promotion exposed and corrected loss of
  omitted columns; the shared table serializer now materializes only the missing
  header slots. Clipboard and image-property completion share intrinsic result
  selection mapping from the existing owned preview products.
  Additional actual timing reds showed completion during composition getting
  stuck, settlement overlooking pending resources, and accepted-but-failed
  rendering losing original bitmap bytes. Completion now waits for composition
  before capturing current selection; settlement drains both; recovery retains
  the original payload even after accepted source fails to render. Existing native
  composition/typing and new lifecycle controls pass. Chromium composition is not
  native OS IME verification.
  This changed worktree passed 100 affected browser checks (67 editorial/input/
  clipboard and 33 table popup checks), including the original wrong-cell fixture,
  delayed paste with intervening input, completion during Chromium composition,
  exact next-key selection, canonical history and reopen. The immediate wrapped
  selection policy remains green. Core clipboard/image/format checks pass 102,
  selection rebasing 18, and authority/history/recovery checks 206; these are
  scoped checkpoints, not a frozen candidate or full-scope completion.
  A broader retained run exposed stale intrinsic positions in unchanged table
  bindings after regional rendering; the existing heterogeneous-block regression
  now passes after those positions shift at the common view-update boundary.
  Its package-consumer 404 was an unpublished local dependency fixture issue;
  consumer verification now packs both real release packages without extra direct
  consumer dependencies. That check also found a real CommonJS package-scope defect
  in input-policy, now corrected and exercised through both packed module formats.
  The subsequent full desktop run passed 2,410 tests in 241 files. Its log is
  `/tmp/marktext-prepared-desktop-full-20260909.log`; it verifies this prepared-
  resource checkpoint, not later alignment changes or a packaged candidate.
  Reachable `json-change`/`decodeNativeEdit`, table drag/grid, remaining
  tracked structural cases and the other CURRENT requirements still keep U1 open.

- Column alignment now enters the same model command boundary from the existing
  toolbar. The parser supplies exact delimiter token positions; the shared input
  policy toggles alignment, and sparse colon edits preserve cell annotations,
  spacing and dash counts. The actual editor selection is independent of the
  hovered column. Both native and Core browser controls exposed toolbar mousedown
  clearing that selection; the widget now uses the existing inline-toolbar focus
  convention. A second tracked toggle then exposed token-end affinity including
  CM wrappers. Correcting the owned token range lets the existing compiler cancel
  pending colons without a special compiler rule. Core alignment/rebasing checks
  pass 29; all 40 affected browser controls pass after both fixes, including
  Track on/off, immediate typing, exact source, history and reopen. The log is
  `/tmp/marktext-alignment-fixed-browser-20260909.log`. These worktree checks do
  not certify an installed candidate or the remaining table operations.

- Tracked multiline HTML paste now uses the existing scanner's intrinsic
  blank-line/explicit termination fact before the shared tracked compiler runs.
  The authored block owns its necessary separator and at most the immediately
  retained original EOL; it never consumes the rest of a candidate literal's
  suffix. Exact Original bytes, unrelated following headings, annotations and
  comments survive. The original malformed CM closer remains invalid; explicitly
  unterminated HTML still refuses safely. Core affected checks pass 130, and 86
  retained parser checks cover incremental/full-parse equivalence and the existing
  CommonMark/GFM corpus. All 34 clipboard browser cases pass within
  `/tmp/marktext-clipboard-structural-browser-20260909.log`, including actual plain
  paste, subsequent typing, selection, history/reopen and upstream controls.
  The broader run also contains two table-Cut harness failures described by the
  ongoing Cut work; it is not an all-green or installed-candidate result.

- Whole-table Cut uses the existing structural planner and tracked compiler. The
  planner now retains its chosen pre-edit target; selection maps through the
  actual compiled operation before the next key. Exact content boundary affinity
  fixes a half-wrapper range when the entire table is a pending addition. Ordinary
  whole-table deletion uses an explicit structural scope in the existing markup
  compiler: fully consumed annotation subtrees and comments are removed together,
  while visible-text deletion retains its existing comment policy. No table-side
  annotation cleanup was added. Core affected checks pass 90 and owner/history
  checks pass 6; independent adjacent/partial-owner/invisible-subtree repros pass.
  Four actual guarded Cut controls pass for sole/following/added/annotated tables,
  including exact clipboard, immediate input, selection, undo/redo and reopen
  (`/tmp/marktext-cut-and-front-menu-20260909.log`). The new tests initially assumed
  deleted text vanished from Markup and that browser target ranges equalled live
  selection; probes disproved both. They now assert retained Markup text and both
  actual positions separately, with unchanged exact source/history requirements.
  That same run records two new front-menu reds, not a complete browser pass.
  The later repeated-Delete migration below supersedes that remaining guard.

- Tracked structural Delete now uses the same sparse table removal and tracking
  compiler after rectangle text is empty, including after cancelling a pending
  addition with the first Delete. Partial removals retain intrinsic surviving
  cell identity; a whole-table removal retains the exterior source selection.
  Real Chromium exposed an empty retained table with no rendered exterior caret.
  The existing markup-view source anchors now cover nonempty annotation payloads
  with no rendered marked text; no synthetic paragraph or alternate source was
  added. Source positions 0 and 35 roundtrip through actual DOM selection, with
  64 affected mapping/view tests and desktop types passing. The six browser
  controls retain hard immediate selection/text, next input, history and reopen
  assertions. Chromium's collapsed target can be another empty cell while the
  live model selection remains the required exterior position; both are asserted
  separately. Core affected checks pass 93 and owner/history checks pass 9.
- Front-menu heading-level choices now use the same model operation as the menu
  bar with the actual hovered target and explicit set semantics. The menu action
  and subsequent typing are separate history units. Clicking the already-active
  level exposed native focus loss; submenu items now reuse the existing toolbar
  mousedown convention. The unchanged six browser controls cover ordinary/Core/
  Track conversion and no-op behavior; 43 retained Muya checks and types pass.
  Front-menu paragraph conversion subsequently passes three actual-click controls
  (ordinary/Core/Track), 35 retained Muya checks and types by reusing that same
  operation. Backward cross-block reset now routes by the ordered first selected
  block; its unchanged browser regression still fails on reversed selection
  direction, because input mapping discarded anchor/focus. That defect and
  quick-insert remain open; the heading decoder has not been retired.
- The combined desktop checkpoint after the table exterior-anchor and heading
  focus fixes passes 2,416 tests in 243 files
  (`/tmp/marktext-unified-boundaries-desktop-full-20260909.log`). This includes
  retained upstream checks and the decisive no-wait wrapping policy. It is source
  verification, not default-enabled installed macOS evidence. At that same
  checkpoint all 1,549 retained Muya tests (232 files) and the combined 113
  Chromium controls pass (`/tmp/marktext-unified-boundaries-muya-full-20260909.log`,
  `/tmp/marktext-unified-boundaries-confirmed-browser-20260909.log`). The full Core run
  passes 685 of 686 checks; the unchanged image-dimensions failure remains open
  pending the source-format decision. No requirement is waived by these subsets.

- Native input now uses the existing canonical `DocumentTextSelection` instead
  of discarding direction into a source range. DOM mapping, the model planner,
  compiler reconciliation (including no-source-change input), session admission,
  actor history and rendering share that selection. Ordered browser replacement
  targets remain distinct. Unordered native input selections are no longer
  admitted; no direction cache or supplemental event metadata was introduced.
  The backward cross-block reset browser test passes exact source, immediate
  anchor/focus, subsequent replacement, both undo selections, redo and reopen.
  Full desktop checks pass 2,418 tests in 243 files at this checkpoint
  (`/tmp/marktext-directed-input-desktop-confirmed-20260909.log`). Five old-shape
  matcher failures were corrected without changing endpoints, source or recovery
  requirements. The combined 78-browser run passes 74; four actual Track
  quick-insert failures remain, so this is explicitly not a complete browser pass
  (`/tmp/marktext-directed-input-editorial-browser-20260909.log`).

- Slash-menu heading insertion now consumes its actual trigger through one
  heading operation before the next key. The initial Core timeout was isolated
  to an unpositioned, unfiltered menu: accepted model typing bypassed native
  `inputHandler`, the old sole producer of its content notification. The existing
  menu now receives that notification after successful current-view/selection
  reconciliation. Click and keyboard controls pass for native and Core, including
  separate query/command/typing history and reopen. The pending query fixture
  `/h{++e++}a{++d++}\n\noutside{>>keep<<}\n` then reproduced a compiler
  refusal: the visible replacement ended inside the final addition wrapper.
  Ordinary and tracked compilation now reuse `markupEditOwnership`; selection
  reconciliation uses the same consumed marker extents. The actual quick-insert
  action supplies structural ownership, including fully consumed comments, while
  partially enclosing additions remain intact. All ten native/Core/Track mouse
  and keyboard browser controls pass exact source, immediate selection, next key,
  separate undo/redo, reopen and zero legacy events. Full Core at that checkpoint
  passed 704/711: six newly added formatting-direction regressions and the pending
  image-sizing decision were the only failures. These results precede the format
  selection migration. No timeout alone is treated as causal proof.
- Real backward-drag Bold/Italic reproduced reversed formatting, Shift+Arrow
  and undo selections. Ordinary format actions now carry the existing canonical
  `DocumentTextSelection` through planner, admission/journal, history and view;
  no SourceRange formatting fallback or direction cache remains. Native history
  restores saved endpoints directly and its existing command boundary captures
  the before-selection. All six actual native/Core/Track toolbar controls pass.
- Cut → Undo reproduced the same direction loss. Text clipboard actions and
  pending completion selections now use the same canonical model selection as
  input/format/history. Image property targets remain exact ordered image ranges;
  their current caret/selection and result use the canonical selection. Prepared
  clipboard admission/replay rejects the obsolete ordered text-selection shape;
  its renderer fallback is removed. Pending image presentation follows the same
  owned primary range. Existing fixture migrations preserve exact endpoints,
  source and recovery assertions. Core backward Cut → Undo → Shift+Arrow → type
  and reopen passes. Standalone Cut now uses the existing history command boundary
  to capture the actual before-selection; no second history store was added.
  All ten actual formatting/clipboard controls pass, including delayed paste and
  image completion with an intervening backward selection, next key, both undo
  selections, redo and reopen (`/tmp/marktext-format-clipboard-direction-final-20260909.log`).
- Historical 17:01 worktree checkpoint: all 2,419 desktop tests passed (243 files) and
  all 1,551 Muya tests (233 files) passed. The 75-browser run passed 73: ordinary Core
  quote quick-insert loses its native caret, and standalone Cut undo restores a
  collapsed caret. The full Core run passes 725/729: the known image-dimensions
  failure plus three stress timeouts while competing suites were running. The
  two affected Core files then pass all 109 tests in isolation with unchanged
  time/memory limits. This resolves that run's contention uncertainty, not the
  retained sustained performance gate. Logs: `/tmp/marktext-directed-editing-`
  `{desktop,muya,core}-checkpoint-20260909.log`,
  `/tmp/marktext-directed-editing-core-isolated-20260909.log`, and
  `/tmp/marktext-direction-consolidated-browser-20260909.log`. These are scoped
  source checkpoints, not frozen artifact or installed macOS evidence.
- The ordinary quick-insert quote caret failure is closed: the shared view now
  advances the synthetic empty quote paragraph through its owned padding, as it
  already does for an empty list item. All six native/Core/Track front/quick-menu
  controls pass, including next input, history/reopen and zero bound legacy calls
  (`/tmp/marktext-native-input-red-green-rQfvDq/blockquote-browser-green.log`).
- Quote toggle/cross-paragraph commands now dispatch directly from native
  `updateParagraph` into `changeBlockquote`. The common parser retains its actual
  quote-marker/padding facts on physical lines; the planner uses their ancestor
  depth/ranges, preserving lazy lines and unrelated nested quotes. Native unwrap
  retains the actual child nodes instead of finding duplicate children by text,
  and uses the same existing history command boundary as formatting/Cut. The four
  native/Core browser controls pass exact selected child, next input, both undo
  selections, redo/reopen and zero bound legacy events. Core nested/lazy/directed
  checks pass 16/16; retained native paragraph/history checks pass 72/72. Logs:
  `/tmp/marktext-quote-command-green1-20260909.log` (first browser checkpoint;
  subsequent assertions include before-command history). The quote decoder still
  has `resetToParagraph` callers, so it has not been retired.
- Column drag enters `moveTableColumn` from the existing TableDragBar before its
  animation. `tableMovePlanning` moves exact parser-owned physical slots;
  the common structural compiler now receives one table replacement. The former
  tracked per-row spelling produced a paragraph instead of a table. The new
  structural substitution retains both owned tables and exact Original/Revised
  projections. Current selection and retained cell targets share its compiler
  reconciliation, including omitted cells; overlapping raw resource targets
  still conflict rather than being rediscovered by matching text. A second drag
  exposed refusal inside an annotated pending replacement arm: the shared tracked
  compiler now admits canonical structural edits there while preserving the old
  arm and nested annotations. All three actual native/Core/Track browser controls
  pass exact source, caret, immediate next input, undo/redo and reopen; Track also
  repeats the drag and input inside the new arm. Artifacts:
  `/tmp/marktext-column-move-repeat-20260909-1809`. Affected Core tracked-authoring,
  markup-editing, retained-selection and move checks pass 74/74. This replaces the
  drag's legacy reconstruction caller; the generic decoder still has other users.
- The actual row drag reproduced the same ownership defect as columns: moving
  identical visible rows left CM in its old row. Both drag axes now enter the same
  table-move planner/compiler/reconciliation before the next input. Whole-row CM
  travels with its owned row, including repeated moves; a promoted implicit cell
  is materialized by the same row-completion helper as header removal. Actual
  row/column controls pass 8/8, including empty-header promotion, next key,
  source, undo/redo, reopen and zero bound legacy calls. Core move/retained target
  checks pass 28/28 before the final header-promotion additions (which also pass).
- Heading-specific `paragraphHeadingEdit` and its two adapter uses, plus the empty
  heading branch in `muyaStructuralSourceEdit`, are retired. Old unbound/synthetic
  heading tests now exercise the local owner and real model commands, preserving
  their expected source. This exposed a genuine whole-substitution failure:
  `{~~old~>new~~}` was changed to `{~~# old~>new~~}` instead of
  `# {~~old~>new~~}`. Core now supplies the paragraph prefix boundary formerly
  calculated in the view; that duplicate view policy is removed. Scoped Core34,
  desktop114 and upstream Muya60 checks pass; 65 actual heading/Enter controls
  pass (`/tmp/marktext-heading-owned-arms-browser-final-20260909.log`). The earlier
  hot-reloaded browser attempt was invalidated and rerun with runtime edits paused.
- At the 18:21 source checkpoint, all 69 combined structural browser tests pass:
  heading menus/front/quick, quote commands, table picker/create, both drag axes,
  empty-header promotion and retained native table editing. The grid picker now
  restores its actual live trigger before dispatch; shared table serialization
  supplies the parser-consistent empty-cell boundary. Native table creation shares
  the existing history command boundary. Exact source, immediate next input and
  history/reopen assertions remain intact. Log/artifacts:
  `/tmp/marktext-structural-combined-20260909-1821.log` and sibling output directory.
  This is a frozen test interval, not the retained release-candidate gate. Literal
  and modal table creation are undergoing additional actual-caller verification.
- The same frozen runtime then passes 75 supplemental browser controls: retained
  row/column menus, Core Enter, directed formatting and delayed clipboard behavior
  (`/tmp/marktext-structural-retained-20260909-1822.log`). This and the preceding
  69-control run precede table-decoder retirement and later compatibility fixes;
  their affected checks must be rerun after those changes. Source-traced remaining
  table callers include `TableCellContent.backspaceHandler` replacing a table at
  offset zero and `arrowHandler` appending a paragraph below a final table;
  unmigrated list indentation also consumes nested-table source. Those keep U1
  open even after the migrated row/column recognizers are removed.
- The later table migration retires `tableAlignmentEdit`, `tableColumnRemoval`,
  `tableColumnEdit`, row-diff reconstruction, nested-table redispatch and the
  flattened `delimiterCells` recognizer. Generic/list decoding remains reachable.
  Migrating the retained 69 table fixtures to direct model commands exposed
  hidden comments surviving column deletion and nested row insertion losing its
  prefix. Structural compilation and the existing container-prefix helper now
  own those fixes. Desktop 177/177 and Core structural 51/51 pass; the real
  row/column menus, including the four new regressions, pass in the frozen
  104-control browser run at `/tmp/marktext-table-boundary-green-20260909-1832.log`.
- That 104-control checkpoint also covers literal table creation, grid selection,
  native multi-leaf list selection, table dragging and Enter. Table creation now
  restores both live native endpoints through the existing focus service; literal
  insertion uses parser line boundaries and implicit empty-heading replacement
  preserves comments. All 23 creation/grid controls pass after the latter guard
  (`/tmp/marktext-table-boundary-retained-20260909-1835.log`); the same run has
  separately recorded boundary failures and is not an all-green result.
- Table-cell Backspace and final-row ArrowDown now dispatch model commands before
  mutation. Native Backspace previously removed a nonempty table simply because
  it had no preceding block; native and Core controls now preserve it. The model
  returns intrinsic navigation selections for implicit cells without inventing
  physical offsets. Empty-table deletion, hidden-comment preservation, next input
  and history/reopen pass ordinary controls. Track exposed a further rendering
  failure: after removing an empty table, zero-text boundary spans defeat the
  native `:empty` caret placeholder; after reusing that placeholder, the accepted
  next X still disappears from the Markup AST as an extra cell. This parser/view
  failure remains CURRENT until the exact browser sequence passes. The 104-test
  pass predates these additional controls and cannot certify them.
  The native control now flushes Muya's existing deferred serialization after
  the next key before reading source; it does not wait before the key. Two added
  source literals were corrected to retain the established empty-cell padding
  and caret-at-slot-end convention. Those harness corrections preserve exact
  source, location, comment, history and reopen assertions; they do not resolve
  the independent tracked-table rendering failure.
- The 18:49 frozen source check (`3dc316e99` plus worktree; lock SHA-256
  `990e5ac83f33729cae6824cb168e6f86e8f7155fbb39ad82113785c560247c77`)
  passes 119/120 combined Chromium controls. All eight table-boundary controls
  pass, including Track Backspace → X → Y, exact selection/source, history/reopen
  and preceding-table implicit-cell navigation. The parser now separates a block
  following the complete intrinsic table arm on the same physical line. It uses
  the full scope, preserving nested cell annotations and tracked row boundaries;
  40 retained Core and 19 view controls pass after that correction. The one new
  failure was the same-task tracked multiline-list harness dispatching to a
  detached cached block. Trusted keyboard input succeeded. The test now targets
  the actual live DOM selection without reselection or waiting and passes X,
  trusted Y, exact selection/source and history/reopen with unchanged runtime
  (`/tmp/marktext-list-input-live-target-20260909.log`). E2E types pass. Initial log:
  `/tmp/marktext-unified-browser-20260909-final1.log`. No installed or sustained
  release evidence is claimed for this worktree.
- The 18:52 full source checkpoint passes Core 807/808 (61 files) in isolation
  with unchanged limits. Only the retained CM image-label dimensions test fails.
  Muya passes 1,553/1,554 (234 files); its picker unit fake lacks the newly used
  live-content interface and is being replaced with a real native fixture.
  Desktop passes 2,420/2,422 (243 files): the new U2 restore-all close race is
  reproducible, and an older native cross-paragraph test expects one legacy
  event while native replacement now emits separate deletion/insertion events.
  Its actual behavior is under verification before changing the test. All four
  retained upstream conformance/round-trip files pass 1,347 checks. Logs:
  `/tmp/marktext-unified-{core,muya,desktop}-20260909-checkpoint.log` and
  `/tmp/marktext-upstream-specs-20260909-checkpoint.log`. These results describe
  this source checkpoint only; the U2 fix will invalidate affected desktop evidence.
  The picker fixture now invokes the callback against real connected native
  content; all 15 scoped tests and then all 1,554 Muya tests pass. This changes
  no runtime behavior or dimension assertion. The cross-paragraph fixture now
  checks the exact composed native operation across Cut and typing publications,
  exact source and undo/redo; the same selection replacement was also added to
  the production local-owner input matrix. All 31 affected desktop tests pass
  without runtime changes or retiring still-reachable decoding. Logs:
  `/tmp/marktext-unified-muya-20260909-final.log` and
  `/tmp/marktext-cross-paragraph-publication-check-20260909.log`.
- Only-child list Backspace now calls `dispatchDocumentList` before native
  mutation. `changeList`/`planListChange` uses the nearest single-item list's
  intrinsic marker, continuation and sibling facts; the shared structural
  compiler/reconciler supplies source and selection. Compact neighboring
  paragraphs initially merged after marker removal; parser-owned sibling
  boundaries now retain their separation. `sourceEditForMuyaUnwrappedList` and
  its sole dispatcher are removed (no remaining package references). First/later
  sibling Backspace remains native and never matched that whole-list decoder.
  All 11 actual browser controls pass, including ordinary/Track, task/ordered,
  nested/quoted, multiline and adjacent paragraphs, next X, history/reopen.
  Core 58, desktop 169 and retained native 8 checks pass; types pass. Log:
  `/tmp/marktext-list-boundary-final-20260909.log`. This source change supersedes
  earlier affected Core/desktop verification.
- The restore-all quit checkpoint now reuses buffered-state persistence until
  the complete tab snapshot matches newly settled sources and current owned
  generation/revision plus view readiness. Muya flushes pending native delivery;
  Source uses its existing capture/composition/queue state. Failed persistence,
  recovery and stale ownership block authorization. Original and repeated late
  writes, overlapping two-tab barriers, pending views and deferred native
  delivery pass; scoped lifecycle/save/adapter 166 and final controls 48 pass,
  with types and scoped lint. Logs: `/tmp/marktext-close-scoped-final.log` and
  `/tmp/marktext-close-final-control.log`. This fixes checkpoint admission only:
  post-authorization input, native confirmation/save and installed process quit
  remain U2. No synchronous IPC or presentation-only input lock was introduced.
- Migrating the retained 30 unlist cases to the production binding exposed a
  shared reconciliation defect: adjacent declared edits sometimes compile into
  fewer replacement groups, leaving selection unproven and the old native list
  visible despite correct source. `editingReconciliation` now groups those
  contiguous declared edits at the compiler's actual boundaries before applying
  its existing exact interval/payload proof. No decoder or inferred intent was
  added. All 30 retained cases pass with exact EOL/source, model/native state,
  same-task next input, directed selection, two-step history and reopen. The new
  actual browser fenced-item control also passes. The earlier full desktop
  2,398/2,428 run is superseded by the complete 2,428/2,428 pass across 243 files
  (`/tmp/marktext-unified-desktop-20260909-final3.log`).
- The 9 September 19:18 source checkpoint is based on `3dc316e99c69c4f5d597f08c49986d92f31cfadf`,
  non-specs worktree SHA-256
  `497cae656e2b060510a9e95e948665f1fbbc1e9b3c6756d87cc28206d2150e09`,
  lock SHA-256 `990e5ac83f33729cae6824cb168e6f86e8f7155fbb39ad82113785c560247c77`.
  Core passes 832/833 across 62 files, in isolation with unchanged limits; the
  sole failure is the pending CM image-label dimensions case. Muya's full
  1,554/1,554 and upstream conformance/round-trip 1,347/1,347 results retain
  unchanged package inputs. The frozen 170-browser run passed 167: three
  harness assertions assumed deferred native serialization was current or that
  Chromium still displaced an empty exterior caret into the next table cell.
  Corrected serialization observation now first checks immediate text/caret and
  flushes only after the key; table assertions require the actual exterior
  source position. Exact source, next input, history and reopen oracles remain.
  Both complete affected clipboard suites pass 32/32 on unchanged runtime; the
  other 138 controls passed in the frozen run. Logs:
  `/tmp/marktext-unified-core-20260909-final3.log`,
  `/tmp/marktext-unified-muya-20260909-final2.log`,
  `/tmp/marktext-unified-browser-20260909-final3.log`,
  `/tmp/marktext-clipboard-browser-20260909-final4.log`.
  This is a source checkpoint, not a release candidate. No package was rebuilt
  or installed; U1, U2 and sustained/default-enabled installed verification remain
  open. The installed app remains the older `c52ddf4c` build.
- Whole-window close ignored the existing save helper's cancellation result.
  Cancelling Save As could therefore destroy the window without saving that
  document. The actual close-confirm handler now requires every requested save
  to return a saved-file result before its existing close action. The red
  cancellation test failed with `window-close-by-id`; cancellation alone and
  alongside another completed save, all-saved results, Keep Open after failure,
  and explicit Close after failure now pass. Four affected desktop suites pass
  51/51; scoped lint has no errors. Logs: `/tmp/marktext-close-saveas-red.log`,
  `/tmp/marktext-close-saveas-related-final.log`. This main-process change
  invalidates affected earlier desktop evidence; it does not change renderer
  or browser inputs. The separate late-confirmation reproduction uses the real
  handler and local model owner: the accepted revision advances while its
  native dialog is pending, yet the handler writes the captured old source and
  destroys. Its red log is `/tmp/marktext-confirmation-late-input-red.log`;
  the reproduction is `/tmp/marktext-confirmation-late-input-reproducer.spec.ts`.
  That failure and post-authorization input remain CURRENT U2.
- First-paragraph list Backspace now routes from the existing native handler to
  `dispatchDocumentList({type: 'backspace'})` and Core's list planner for only,
  first and later items. The model lifts a first item's children or moves a later
  item's children into its predecessor before the next key. Intrinsic marker and
  continuation facts preserve task indentation, ordered numbering and untouched
  source trivia. Sixty production-owner controls cover ordinary/CM content,
  Track, all three EOL forms, nested and multiline items, immediate typing,
  exact selection/source, history and reopen. The former only-item decoder is
  retired; later paragraphs within an item, indentation and checkbox mutation
  still keep U1 open.
- Those controls exposed shared parser/compiler defects. Empty inherited arm
  prefixes no longer acquire an independent editing block; task-marker-only
  lines no longer manufacture a leading empty paragraph. The tracked compiler
  joins contiguous declared changes before compiling separate spans, retaining
  untouched CM content between them instead of manufacturing a broad enclosing
  substitution. Pre-existing broad multiline ordered substitutions still have
  the loaded-source rendering failure recorded in U1.
- Structural selection reconciliation now proves a retained endpoint using its
  incident text in the existing model and the actual declared/compiled edits.
  Numeric offset equality alone incorrectly treated consumed Quick Insert
  triggers as retained text. The full Core run caught three such regressions;
  all now pass alongside immediate Quick Insert → typing controls. Existing
  authored-payload mapping remains responsible when that retention proof fails.
  Exact narrow-change assertions replace two obsolete broad-wrapper expectations;
  an actual native tracked list-conversion → typing control retains source,
  projections, selection, history/reopen and zero legacy changes.
- The 9 September 19:40 frozen source checkpoint has non-specs worktree SHA-256
  `c5415774cabf870ba1a2d64bf014c1e09610284998ba847e9cd551f1127378c0`, based on
  the revision above with lock SHA-256
  `990e5ac83f33729cae6824cb168e6f86e8f7155fbb39ad82113785c560247c77`.
  Full Core passes 854/855 (63 files), with only the pending image-label dimensions
  failure. Full desktop passes 2,493/2,493 (245 files), full Muya 1,565/1,565
  (234 files), and retained upstream conformance/round-trip 1,347/1,347 (4 files).
  Logs are `/tmp/marktext-unified-core-20260909-final6.log`,
  `/tmp/marktext-unified-desktop-20260909-final6.log`,
  `/tmp/marktext-unified-muya-20260909-final6.log` and
  `/tmp/marktext-upstream-spec-20260909-final6.log`. Full Chromium passes 539/540
  (`/tmp/marktext-unified-browser-20260909-final6.log`); the tracked middle-item
  next-key failure remains U1. No browser assertion was relaxed. Core, desktop,
  Muya and browser type checks pass, and the source digest was rechecked unchanged
  after the run. No package or sustained-performance result is claimed. The
  tracked-authoring correction and U2 close lifecycle work will invalidate their
  affected evidence; these results must not be inherited by changed inputs.
- The full 540-browser checkpoint exposed tracked prefix extension missed by the
  first 60 list controls, which disabled Track before subsequent typing. Tracked
  authoring redirected an exterior insertion into any adjacent new/content arm.
  It now uses the common Markup model's owned inline edge, preserving ordinary
  pending-draft coalescing while leaving structural prefixes outside that rule.
  The actual Core prefix failure and three native EOL variants were red; Core
  143 and native 90 pass, retaining the original 60 and adding 30 with Track still
  enabled. Browser assertions remain unchanged and await the next frozen run.
- The imported broad ordered-list substitution had correct intrinsic new-arm
  container facts but combined editing presentation inherited its old sibling's
  ordinal/indentation. The owning Markdown parser now retains canonical prefix
  facts across that presentation order, and continued ordered items respect their
  intrinsic ordinal. The LF/CRLF/CR reproduction is red → green; 157 affected
  Core checks and six native owner controls pass, including immediate X → Y,
  exact source/projections/selection, history and reopen. Two browser controls
  await verification. The general fork-region scanner remains; this correction
  does not claim its retirement or complete unification.
- Main close handling now requests a final renderer-owned close preparation after
  the initial native decision. Both confirmation and restore-all/no-confirm routes
  share that operation; the previous direct renderer-to-destruction route was
  removed. The actual handler reproduction now saves `seed late\n` accepted while
  confirmation was pending. Wrong sender/request replies cannot authorize close;
  preservation failure and cancelled Save As keep the window open. Newly unsaved
  tab membership receives a fresh decision. A second red test demonstrated that
  one failed save could release preparation while another write remained pending;
  all requested saves now settle before handling failure/cancellation. Thirteen main
  controls pass, including retention of incoming-open diversion until the matching
  renderer restoration acknowledgement; seven related checks also passed at the
  earlier checkpoint. Renderer retirement/remount and main read-drain integration
  have focused controls below; full installed verification remains open. Logs:
  `/tmp/marktext-close-late-input-red-20260909.log`,
  `/tmp/marktext-close-concurrent-red-20260909.log`,
  `/tmp/marktext-close-main-green-20260909.log`.
- Renderer close preparation now retires the actual input lease while preserving
  document actors and canonical history. Cancellation remounts from those actors;
  mounted Source and Muya controls exposed stale Source content and a missing
  native caret, corrected through the existing source handoff and cursor services.
  A failed remount cannot send a resumed acknowledgement, and cancellation can
  retry it. Active composition refuses close with its candidate intact. The
  retained lifecycle run passes 270/270 (`/tmp/marktext-close-renderer-final2.log`);
  desktop types pass. These mounted tests use real owners/editors under the actual
  parent SFC but substitute native widget shells, so they do not establish installed
  window-close behavior.
- Incoming populated tabs and loaded files now use existing main window creation
  and pending-open queues when their original target is preparing to close. Exact
  loaded content/options are handed off without rereading. A held read reproduced
  last-window shutdown before delivery; the owning EditorWindow now drains its
  existing reads before WindowManager destroys it. Replacement registration is
  synchronous before that drain ends. Duplicate close, later reads and read-error
  controls pass with the actual main routing/shutdown modules: 16/16 in
  `/tmp/marktext-incoming-close-drain-final-20260909.log`. Full installed shutdown
  remains unverified.
- The 9 September 20:09 source checkpoint has non-specs SHA-256
  `e966d048a7110dc825490ccda7f5ecc0993f81126823f4572aace4fe78e887fd`
  with the same base and lock above. Full desktop passes 2,557/2,562 across 249
  files (`/tmp/marktext-unified-desktop-20260909-final7.log`). Three retained
  tracked nested-list conversion controls place the caret at offset 11/12 instead
  of 0; two tracked Enter controls split the expected continuing addition. These
  are active U1 regressions, not waived assertions. Broader verification paused
  for their owning parser/tracked-authoring corrections. The preceding full Core
  run passes 866/867 (`/tmp/marktext-unified-core-20260909-next.log`), with only
  the unchanged pending image-label dimensions failure. No installed or sustained
  performance result is claimed.
- The tracked nested-list regression came from reusing inherited indentation as
  the complete prefix when a selected arm supplied additional list markers. The
  owning parser now requires contiguous identity for the complete emitted prefix.
  Unchanged native topology/imported-fork checks pass 54/54 and Core arm/list/table
  checks pass 65/65; Core types and scoped lint pass. The two tracked Enter tests
  were still wired exclusively through post-mutation `json-change` decoding.
  Their same final source expectations now pass via `bootBoundMuya` and real
  `keydown` → `beforeinput` delivery through the production owner, retaining the
  original ten structural source checks and adding immediate source/selection,
  zero legacy calls, next input, history and reopen assertions. The bound harness
  uses the existing jsdom environment for native selection. No runtime exception
  or weaker expectation was introduced for those two obsolete harness routes.
- The 9 September 20:14 frozen source checkpoint has non-specs SHA-256
  `78573631c1d73b136b8589ce6180779abf2c856a8e35724cb64806984eaa0368`,
  the same base revision and dependency lock recorded above. Full Core passes
  866/867 (only the pending image-label dimensions failure); desktop 2,562/2,562,
  Muya 1,565/1,565, retained upstream conformance/round-trip 1,347/1,347 and
  headless Chromium 544/544. This includes the unchanged tracked middle-list
  next-key scenario, imported list substitutions and two added tracked Enter
  end-of-block controls. Logs use `/tmp/marktext-unified-*-20260909-final8.log`
  and `/tmp/marktext-upstream-spec-20260909-final8.log`. Core source/test and
  desktop types pass; Muya/browser types passed with the same affected inputs.
  The source digest was verified unchanged at the end of the full run.
- Built that runtime once after preserving the prior generated output at
  `/tmp/marktext-prior-build-20260909-DJuj7E/prior-out`. Output SHA-256 is
  `cb5514c63abe60a9c98753f416044fc996e0b2925585e39b42b3573c24da102e`;
  main bundle SHA-256 is
  `ab5c6034f9e1eedeb7d80f2aa440181775e5c66f0751b85e96b35e6a3c9ff0ce`.
  The unexecuted close E2E fixture first needed asynchronous file-assertion
  polling; its first run then exposed an incorrect terminal-newline expectation
  for a genuinely empty untitled document. The existing exact-source contract
  and empty-source insertion controls require no invented newline. Corrected
  only that fixture expectation; the runtime was not rebuilt. All four bundled
  close checks pass against the same output: native/Source late typing during
  Save → exact disk write/destruction, and cancelled Save As → immediate next
  key/caret/history/exact save. Native dialog responses are controlled, while
  model, widgets, persistence and destruction run from the actual bundle.
  The windows stayed hidden/nonfrontmost and fixtures used throwaway profiles.
  Logs: `/tmp/marktext-close-e2e-run-20260909-final8.log` (fixture failure),
  `/tmp/marktext-close-e2e-run-20260909-final8b.log` (4/4 pass). Output digest was
  rechecked unchanged. These test-only corrections do not invalidate the earlier
  unchanged runtime/browser checks. No final installed package, sustained
  performance or native OS IME pass is claimed; `/Applications/marktext.app`
  remains the older `c52ddf4c` build. Further U1 runtime migrations invalidate
  affected checks and will require candidate verification after they finish.
- Frozen single-cell rectangle paste reproduced a no-op in both native and Core:
  rectangle selection clears text selection, so paste returned before its existing
  cell replacement logic. The same table clipboard action now carries the paste,
  and the Core planner uses its intrinsic cell while retaining the rectangle in
  history. Multi-cell paste retains its established cancellation behavior. The
  two synchronous browser controls pass exact replacement, next key, caret,
  undo/redo/reopen; affected Core checks pass 20. Desktop always configures async
  clipboard-file lookup, so these host controls do not close desktop behavior.
  Existing retained preparation now carries the actual rectangle through that
  path: all four native/Core × synchronous/desktop-lookup browser controls pass.
  Core rectangle/rebase checks pass 28 and retained-resource/pending checks 24.
  Completed rectangle preparation also replays as its resolved clipboard action
  after owner recovery, restoring exact source/history and invalidating the old
  resource handle (retained-resource file 10/10). Delayed lookup with intervening
  native input also passes: the delayed lookup replaces the captured cell, retains
  the current neighbouring-cell caret, accepts the next key and restores all three
  history steps/reopen (`/tmp/marktext-rectangle-deferred-browser-20260909.log`).
  The retained upstream clipboard suite passes 134 controls after completing
  four obsolete mock selection facades, without assertion or runtime changes.
  This closes plain-text frozen-cell paste, not image/HTML preparation or
  installed macOS clipboard verification.

- Direct image properties now use an owned-image operation with exact label,
  destination and title ranges. The image alt value is shared with rendering;
  destination escaping reuses Muya's existing implementation. URL-only edits
  preserve label CM; property history/recovery tests pass 10/10, including mutable
  caller data and the actual selection after delayed completion. Native direct
  property controls now cover inline and reference images while retaining shared
  definitions, label suggestions, next input and history/reopen (118 formatting
  checks). Captured upload and visible transient progress pass browser controls;
  loading text no longer enters canonical source. The real picker Enter flow now passes ordinary/CM browser controls after
  the model-to-DOM mapping selects editable widget edges and the existing picker
  consumes Enter before returning focus. Exact next character, source, history
  and reopen pass. The delayed chooser also passes target/cancellation controls
  after reproducing a lost target when another image was opened during the wait.
  HTML image attributes now come from the existing raw parser and feed the native
  widget, including preserved dimensions/alignment; affected native/view/render
  checks pass 156/156. Aligned HTML images then reproduced focus loss and a
  missing browser caret line after the terminal noneditable widget. The existing
  editor now focuses its editing host, and the shared native image renderer
  supplies a layout-only terminal break. The Core callback retains that native
  output. Four actual picker controls now pass immediate next input, exact source,
  history and reopen for ordinary/CM Markdown and literal HTML alt text. HTML
  widgets also bypass stale presentation caching like Markdown images (two reds,
  35 presentation checks green). Remaining image mutations stay open.
- Source image-label editing followed by Markup Undo reproduced a canonical
  interior selection in hidden, noneditable image source; real typing emitted no
  input. The shared renderer now uses its existing active-syntax cursor to reveal
  the owned source for that selection. Native image-edge mapping is fixed in the
  existing geometry utility, with the duplicate desktop workaround removed.
  Source/ordinary browser controls pass immediate typing, leaving active syntax,
  history and reopen; 130 desktop and 21 native checks pass. No selection clamp
  or supplemental semantic state was introduced.
- Prepared image upload/chooser targeting and plain HTML clipboard controls pass
  seven browser checks. Selected-image Paste as Plain Text now captures the same
  actual image extent as normal paste/cut before awaiting data; that regression
  and full-payload recovery for the refused tracked HTML case pass two browser
  checks. Retained clipboard/image/DOM checks pass 146/146, Core clipboard 24/24.
  These checkpoints do not cover rectangle clipboard or installed macOS.
- Bound Source uses `sourceSyntax` through its acknowledged lease. CodeMirror's
  Markdown/GFM recognition is retired from that production path; existing code
  language/TeX highlighters receive only parser-owned literal ranges. Comment
  source highlighting includes both suggestion arms from the same parser, while
  comment display retains its Revised semantics. Native Source/authority/recovery
  checks pass 191/191; installed styling and sustained rehighlight cost are not
  verified. No source-text fallback parser was introduced.
  Reachable `json-change` routing and `decodeNativeEdit` still serve unmigrated
  commands; neither has been retired globally. The one-stack gate is not closed.

Recent completed source checks: native formatting 93/93, Core formatting 24/24,
affected upstream formatting/input 59/59; composition/adapter/preferences 95/95,
Core composition/input 42/42, affected upstream composition/pairing 28/28;
headless Chromium input/composition controls 9/9. Clipboard request/history/recovery
checks passed 29/29 before the subsequent paste compatibility changes. These
are overlapping migration checkpoints, not a frozen release gate. Ongoing edits
require affected checks again; final types/lint and complete integrated checks
remain required.

Synchronous execution also invalidated dispatch timing: both adapters originally
recorded dispatch after model execution, excluding its cost. Clock-controlled red
controls reproduced that omission; dispatch now captures its timestamp before
submission. The affected non-clipboard suites pass (248 checks); the combined run
also caught unfinished clipboard import projection ownership, which remains with
that migration. No sustained performance result is claimed from these checks.

The subsequent full Core run passed 424/424 across 35 files. The latest combined
native run passes 188/188, and authority/timing checks pass 248/248. The earlier
187/188 run exposed a fence fixture that dispatched only Enter keydown; an actual
browser control then independently reproduced missing fence completion. The Core
conversion and fixture event sequence were fixed without relaxing source,
selection or history assertions. Further native conversion checks remain underway.
Exact separator DOM-boundary/presentation checks pass 25/25; active format context
and affected upstream selection/toolbar checks pass 42/42 and 12/12 respectively.
The earlier full retained Muya run passed 1,522/1,533: three old clipboard fixtures
omitted Muya's required editor surface. Supplying that surface retained all
assertions; the complete rerun passed 1,533/1,533 with no unhandled errors. Later
clipboard/Source/Enter/format edits still require their affected checks. These runs
are checkpoints on a changing worktree, not proof of installed behavior or a
stable candidate.

Earlier asynchronous transport, raw-echo, installed and sustained-performance
results do not verify this ownership/input/rendering change. Failure/recovery
controls now hold actual view/persistence barriers and use explicit owner failure
controls instead of delaying a synchronous model decision. The guarantees and
assertions remain; the obsolete transport mechanism changed. V1 still requires
all six sustained workloads, editorial/cold cycles and renderer responsiveness
measurements without competing workloads, followed by one frozen candidate's
integrated and default-enabled installed macOS checks.

## Historical source migration checkpoints

### Superseded asynchronous-input checkpoint

The shared model owner is now being migrated to synchronous session ownership
under the updated [authority ADR](../adr/0001-core-document-authority.md#authority-and-input-ordering).
The queued-input failure below remains the required regression; binding and fixture
migration is in progress, so the latest worktree has no complete verification pass.
Preserve authority restart/recovery and all retained performance limits through this
change. The following results describe the last completed migration checkpoint,
not verification of the new ownership path.

Native `beforeinput` now supplies the actual selection, browser replacement range,
input kind/data and existing pairing preferences to Core's first-class input
operation. The bound native handler no longer decides pairing from a presentation
syntax cache. Core owns the policy, ordinary/Track compilation and resulting
selection. Exact compiler mappings now cover the native identity suite's wrapper
removal and retained-comment cases; all 12 identity checks pass. Unsupported maps
remain explicit. Changed sparse compound plans still lack complete compiler
reconciliation: paired deletion across substitution arms has an atomic Core
compiler control, but native input integration is not proven. The ordinary
mapping proof currently repeats the existing
compiler traversal against its committed result without reparsing; its performance
has not been verified.

**U1 remains red at the immediate editing boundary.** The actor decides input
asynchronously after the native view has already echoed raw replacement. Selecting
`abc` in `a{++b++}c`, typing `(`, then `x` before acknowledgement saves
`(xa{++b++}c)` instead of `(x)`: raw echo collapsed the selection before the next
key. Standalone wrapping and pairing reach correct source after acknowledgement,
but that does not recover the next action's lost selection. The regression is
retained in `muya-native-input-policies.spec.ts`; immediate assertions remain in
place. Fix result delivery at the shared model owner so presentation and the next
input consume its actual result. A second predictor or an optional accurate path
would violate the contract. Formatting, clipboard, composition, structure and
other unmigrated consumers remain part of U1.

Final view reconciliation now uses Core's returned selection, including empty
editable leaves. Its five controls cover pairing, Track, closer skip, selected
wrapping and paired deletion. The latest root run passes 20 checks across that
suite and native/Source lifecycle tests; 21 affected existing Muya input/history,
selection and teardown checks pass. These are source-level checks, not installed
or sustained-performance evidence. The later combined 13-suite run passed 325 of
338 checks: 12 input-policy cases remained red, and one new recovery test used an
incomplete fault lifecycle. That fixture was corrected to notify the actual view
fault before recovery; its actor/manager suite then passed 8/8. The 12 policy
failures remain, including premature native history-group timing on closer skip.
The five affected Core suites pass 34/34. Desktop/Muya types and changed-file lint
pass. Source-transition red/green evidence is under
`/tmp/marktext-native-input-red-green-rQfvDq/source-*`.

The following records describe intermediate implementations and their own test
inputs; they do not override the CURRENT blockers or verify the latest worktree.

The rejected `selectionReplacement` metadata and document-reset operation-shape
workarounds were preserved outside the worktree, then retired. The real native
input identity regressions are in
`packages/desktop/test/unit/specs/muya-native-input-identity.spec.ts`; their initial
run reproduced repeated insertion, repeated deletion and identical-text replacement
failures, with distinct-text and ordinary Markdown controls passing.

The replacement path under development captures the actual selection at native
`beforeinput`, submits a common document operation through the existing actor
queue, and applies its exact view edit. It keeps acknowledgement, save, history
and recovery owners. It is incomplete: formatting/syntax context, composition,
clipboard and structural commands still require migration; native auto-pairing and
Markdown input shortcuts must be retained through that same stack. Pending
presentation must follow exact operations across leaves, acknowledgements and
locale changes, not recover edit locations from text differences. These are U1
closure work, not new product scope. No new installed candidate has been verified.

Current red→green evidence for this migration is scoped to source/DOM integration,
not an installed candidate. Basic repeated insertion/deletion, repeated-range and
identical-text replacement now reach the Core source barrier correctly. Rapid
ordinary typing now shares the existing history grouping; native destruction
flushes pending input. The exact pending single-leaf presentation regression and
its existing rendering controls pass. A Happy DOM sanitizer control dropped
leading text; jsdom reproduced the intended fixtures without that harness defect.

The original queued escaped-closer and Track replacement failures now pass through
Core-owned operation reconciliation, including the actual post-acknowledgement
caret. The production view installation/caret restoration is shared with the
native tests. Pairing reuses the existing policies with Core syntax context.
Additional browser-target-range regressions exposed the distinction between the
user's collapsed caret and the browser's expanded deletion range; both paired
deletion cases now pass. Queued bracket pairing also passes: syntax-independent
policies remain applicable while Markdown context is pending.

U1 remains incomplete. Pending Markdown syntax must be established by the common
model before syntax-dependent policies run; an acknowledged syntax cache cannot
answer that query after an intervening delimiter edit. Selected wrapping must
submit separate formatting edits that preserve enclosed annotations, not replace
the selection with a reconstructed string. Formatting, composition, clipboard,
structure and the other consumers listed above still require migration. The
Core input planner under development is not yet the production input entry point.
Single-edit reconciliation does not prove arbitrary compound topology.

The retained pending-Markdown regression now makes this gap concrete: after
`seed`, type a space and then `*` before the first acknowledgement with Markdown
pairing enabled. Immediate text, acknowledged source and redo produce `seed *`
instead of `seed **`; the caret is correct. The policy suite is now 16 passed/1
failed. Keep that actual native regression red until the common input owner
supplies current syntax and preserves both presentation and authoritative edits.

The preceding combined source-level checkpoint was 42/42: eleven native input identity
cases, sixteen input-policy cases, and fifteen presentation-index/context cases.
Earlier in this migration, 263 affected desktop checks and 60 affected Core checks
passed for the reconciliation change; those are scoped historical results, not
verification of later policy/package changes. The full existing Muya default unit
suite subsequently passed 1,529/1,529 after the shared policy relocation. This is
the default unit suite, not the separate conformance or installed suites. Core and
Muya typechecks and the shared policy's packed ESM/CommonJS/type consumers pass.
Independent review reproduced paired deletion across substitution arms being
refused by sparse edit compilation. Those cases now pass after ordinary batches
are compiled atomically against the original owned syntax, preserving separate
edit locations and hidden comments. Core input-planner integration remains
unfinished. An additional held-acknowledgement control for select-all followed by
five separate keystrokes passes exact source, caret, undo and reopen; the native
identity suite is now 12/12. No installed or
sustained-performance result is claimed for these changes. Input logs are retained in
`/tmp/marktext-native-input-red-green-rQfvDq`; policy controls in
`/private/var/folders/6k/xzgngnms6jg4_z2l40y0_9vh0000gn/T/marktext-input-review-zw87gp4q`.

For U2, the latest scoped run is 181/181 across the native lifecycle and existing
document-authority suites, including ten lifecycle cases. The recovery capture
retains the actual view with its lease until drain or backup; the existing main
draft store remains the durable owner. Teardown waits for inactive saves and
requires successful preservation before aborting a failed final session. These
tests do not establish Source-view or full-application shutdown coverage.

## Historical convention-refactoring checkpoint

The owner authorized red-green refactoring of the six convention-review findings. Muya now owns complete heading-ID allocation and native table spelling, including bounded padding allocation. Core readers/TOC and native exports share the allocator; table adapters retain admission, source boundaries and EOL provenance. Projection regions have themed keyboard focus, recovery text inherits document direction, and CI supplies the clipboard isolation flag and PDF extraction prerequisites.

Verification uses clean-base HEAD `c52ddf4c12efd9acaca95ce8c8bb3e010945918c` plus uncommitted changes, not a newly committed release candidate. Runtime input manifest SHA-256: `98015e3cfa36881b9b86beb23f6b64b1cbff261848ef51ad5844c821fbb26125`; lock unchanged at `df87117b23ac5bb8f35e6efa497de01fe79e1034659dfac0db6312fc6da0730f`. The scratch Mac ARM64 package ASAR SHA-256 is `0da89333abbe1d7cba81ac6ec76fa9fea2caae7e2382a14eaedf0defa3eabc59`; all 890 compiled files match the frozen build and ad-hoc signature verification passes. It has not undergone DMG installation or distribution signing/notarization.

- Red: identical old-package fixtures reproduce duplicate heading IDs and incorrect Unicode table source in ordinary and tracked paste. Unit/component controls reproduce focus, recovery direction, exact-fit budget and padding-allocation failures; the actual PR workflow environment reproduces the clipboard guard failure.
- Green source: desktop 2,046 tests/216 files; Muya 1,522/226; conformance 1,347/4 with known exceptions retained; desktop/Muya types; root lint zero errors/335 warnings; Muya lint zero errors/10 warnings; no Muya import cycles.
- Green package: 37 distinct hidden application cases, 38 executions (the focus case was repeated with screenshots). These cover heading copy/reader anchors; keyboard/locale/theme behavior; annotated container/table edits; ordinary/tracked ASCII and Unicode table paste; exact save/history; recovery through restart including pending/backed-up RTL text; and actual HTML/PDF/Print commands with the native Muya control. Light-comment and dark-reader screenshots were inspected and show visible focus outlines. Physical printer output was not exercised.
- CI: actual workflow clipboard environment red→green, actionlint and local Mac `pdftotext` preflight pass. Fresh hosted Mac provisioning and Windows execution remain unperformed.

Evidence and the scratch package are under `/var/folders/6k/xzgngnms6jg4_z2l40y0_9vh0000gn/T/marktext-0012-refactor-f6sxo10a`; table red/green logs are under `marktext-unicode-table-3_e4lw43` in the same temporary parent, UI controls under `/tmp/marktext-c52-ui-fixes`, and CI results under the historical run directory below. The first scratch packaging configuration accidentally included old `out/` files; manifest comparison rejected that artifact before app verification. Repackaging corrected the scratch configuration without rebuilding or changing runtime source. Both artifacts are retained; only `package-verified` supplies the current checks. Existing user apps, data and build outputs remain untouched.

These focused checks do not close V1 or the retained external/deferred requirements. The earlier broad/installed/performance results below describe their own inputs.

## Historical candidate and verification — `5e5c6178`

Runtime source: **`5e5c617842453503d56895c1ce626700fd8654df`**. Dependency lock SHA-256: `df87117b23ac5bb8f35e6efa497de01fe79e1034659dfac0db6312fc6da0730f`. The source was committed clean before building. Later action-screenshot readiness assertions change only the test harness; they require no runtime rebuild.

Mac ARM64 artifact SHA-256 identities:

- DMG: `c29880d972a8917c95ac4e09cb72ff96bc890345e58b1f2ec2aba05694a70c9b`.
- ZIP: `f57aaab4dd2e2d347f2dbf57fccabe8c2bc6bbd5686d6ba1ef73e8da6986be81`.
- DMG-installed `app.asar`: `b378b9f96c020c06c7c84cdd612fa713242222639a404c9aefcd6ed32d75acbd`.

All 890 installed compiled files match the frozen build; ad-hoc signature verification passes. The installed app is under `candidate2-dmg-installed/marktext.app` in the run directory below. Existing user apps, documents, profiles, clipboard and recovery data are preserved.

- **R1:** Both public test entry points execute with the explicit nested config/project. Installed discovery includes five artifact-required specs; the current installed suite passes 36 cases, with its separate optional performance producer skipped. The broad suite passes 400 cases/9 skips (four Linux-native IME cases and five opt-in performance cases). The required sustained workloads run separately below.
- **R2:** Existing Markdown preferences map into the same session at open/live update, preserving actor, source, pending edits, history and recovery options. The drain/read race is fixed at the session owner; actual installed preference, pending Markup/Source and retained-composer cases pass. All four actual application cases pass ten repetitions each: 40/40 on this exact candidate, including exact save/history and no recovery regression.
- **R3:** Core semantic projections reuse native math, diagrams, highlighting, footnotes, image normalization, link dispatch and export processing. Identical reader/comment fixtures pass with exact source and loaded local Markdown/raw-HTML images. Actual HTML/PDF/Print checks pass, including a full native Muya control. The shared print service loads used fonts and owns readiness/cleanup per preparation. Fresh PDF raster inspection confirms `x²`, diagrams, highlighted code and Revised content; the former blank formula is fixed. Print dispatch is observed through the test probe, not a physical printer. The 1×1 image fixtures prove loading, not meaningful large-image layout.
- **R4:** Shared upstream query/capture helpers pass installed escaped-hyphen, cross-annotation selection and replace-all/capture tests with exact one-step undo. Zero-width iteration and unmatched-capture regressions remain covered.
- **R5–R7:** Logical focus, shared native controls, localized marker names, translated labels and RTL review text pass. Explicit sidebar navigation now supersedes a pending caret-follow read instead of silently discarding the click; the original integrated lifecycle passes three repetitions and the full broad run. Nine final UI repetitions require populated action rows; all six light/dark action screenshots show complete words and contained controls. French/Chinese/RTL composer screenshots pass visual review. Translations have not received native-speaker review.
- **R8:** Actual editable/comment/reader surface checks pass with negative controls, execution sentinels and the same normal-document, normal-Mermaid and hostile-Mermaid fixtures. The export harness distinguishes generated CSS custom properties from document text while retaining raw excluded-word privacy checks and real-CM-leak controls.
- **Source and compatibility:** Candidate desktop suite: 2,036 tests/214 files, serial; root lint: zero errors/335 warnings; desktop types pass. Core 291/26, Muya 1,519/226, conformance 1,347/4, Chromium 247/71, their types/lint/cycle checks retain validity because those source, package and lock inputs are unchanged from the completed `8f4417aa` checks. `candidate2-source-inputs.json` records that comparison. Known upstream conformance exceptions remain exceptions.
- **Recovery:** Nine broad-run scenarios plus 81 serial repetitions pass: 90 total, including queue/rejection/backup/Worker failure, active/inactive tabs, restart discovery and immediate Source input. No complete candidate-readiness claim is made before the remaining sustained checks finish.

Sustained plain-workload result (1,200 inputs in the 1,000-paragraph document): echo p95 6.6 ms (limit 16.7), dispatch 8.8 ms (limit 8, **failed**), acknowledgement 12.4 ms and reconciliation 21.5 ms (both limits 50). Pairing is valid, maximum pending depth is six, and final saved source matches exactly. Renderer retained heap after explicit GC grew from 20,672,780 to 22,458,496 bytes; this includes undo history and bounded traces. These are DOM checkpoints, not physical paint. Host snapshots show continuing unrelated CPU/memory pressure; source/build/GUI/agent work from this task had finished. This run does not establish an isolated performance pass or prove host contention caused the miss. The remaining extended/media/editorial/cold stages have not run.

Evidence is retained under `/var/folders/6k/xzgngnms6jg4_z2l40y0_9vh0000gn/T/marktext-0012-zffwyujz`: current `candidate2-*` logs, results, manifests, screenshots and artifacts. Focused red/green logs also remain under `/tmp/marktext-0012-*`. No assertions, limits or required coverage were relaxed.

## Execute red → green at the responsible boundary

Apply the architecture's [verification gate](../architecture/criticmarkup-native-integration.md#verification-gate)
to each semantic migration and its review. Keep evidence with the existing blockers
and test results here or in the PR; no separate completion ledger is needed. U1
remains open until all production consumers satisfy that gate. Carry the standing
contract and unresolved blockers forward if this plan is superseded or archived.

First, close U1–U2 before another candidate. Preserve the demonstrated failures as
production-path regressions. Integrate existing native input, formatting and structural
commands with the common language model, then make rendering and UI context consume
that same syntax. Retire the superseded recognition and reconstruction paths; an added
event field or moved decoder does not close U1. Verify existing and CM behavior through
the same entry points, including pending-input disposal. Do not change established
comment-preservation semantics to make a replacement test pass. The rejected
selection-only patch has been preserved and retired. Retain the checks below for
the shared services affected by this work; their earlier results remain historical.

1. **Repair test entry points (R1).** Preserve the failing public-command reproduction, then prove the ordinary command selects only unpacked cases with the expected setup/concurrency and that the installed command requires an artifact. Retain installed coverage in the packaging workflow.
2. **Repair semantic/service integration (R2–R4).** Begin with the actual preference, media and regex fixtures above. Share existing implementations through narrow owning-package interfaces; do not feed projected text into a second semantic parser or import a DOM-mutating search owner. Run existing callers' tests alongside new production-path regressions.
3. **Finish native interaction (R5–R7).** Write keyboard, theme, locale and direction regressions before fixes. Use shared controls and translation keys. Keep retained draft identity, stale-target protection, submission failure and composition handling. Native review components remain appropriate where no existing widget has their responsibility.
4. **Correct visible-surface security coverage (R8).** Establish negative controls, then assert each mounted projection/comment surface. For media failures retain normal-document, normal-diagram and hostile-diagram controls with the same fixture before/after; a startup timeout alone does not identify a rendering cause.
5. **Verify the candidate (V1).** Complete affected integration first, then freeze once for release verification. Optional extraction of review orchestration from `editor.vue` is not a separate completion gate and does not authorize broad refactoring.

Use independent expected source and visible output. Do not weaken assertions, limits, coverage or invalid-input behavior to obtain green. Classify product, harness and environment failures explicitly. For recurring synchronization failures, repair ownership/reconciliation at the shared boundary. Admit additional work only for an evidenced violation of the existing product, safety, compatibility or release contract.

## Final verification and completion

Record the final source revision, dependency-lock identity and platform artifact identities using existing reports. Run required lint/types, Core and desktop/Muya suites, semantic/conformance baselines, Chromium compatibility, security checks, and corrected public E2E entry points. Retain known upstream conformance exceptions explicitly; green baselines do not mean full standards conformance. Refresh upstream before an eventual PR and validate affected changes.

On one default-enabled installed Mac candidate, run the complete editorial pass, real preference changes, media reader/export flows, native UI and consumer workflows, exact save/reopen/history, tab/Source handoff, queued edits and authority failure/recovery. Verify HTML, PDF, print and clipboard outputs as applicable; inspect screenshots for actual rendering, layouts and theme/focus states. Do not silently reduce the existing broad/installed/recovery suites to the new regressions.

Retain the sustained workload scope: six plain/dense/Unicode/mixed-block/media scenarios with 1,200 measured inputs each, the 200-cycle editorial session, repeated queue/recovery scenarios, and separate cold-open observations. Keep the existing p95 limits: echo 16.7 ms, dispatch 8 ms, acknowledgement/reconciliation 50 ms; Core open 500 ms and first editable viewport 1,500 ms. Keep the existing 180-second editorial deadline. Measure distributions, pending depth, exact final source and memory retention; DOM checkpoints are not physical paint. Isolate performance from competing task-owned work and report unavoidable host noise and upstream-comparison limits.

Rebuild only after a demonstrated failure requires changed inputs. Record which evidence the change invalidates and rerun affected checks; do not repeat unchanged failures without a new hypothesis. Preserve all user apps, documents, settings, clipboard and recovery data. Use private fixtures/profiles, hidden non-focus-stealing GUI testing and cleanup confined to the current run's owned processes/resources. Emit measurable progress for long work.

Completion requires the retained product scope and final candidate verification, with no unresolved reproducible implementation failure. Report implemented/verified behavior, reproducible failures, deferred platforms and external verification separately. External dependencies must not interrupt feasible work, but do not claim those checks passed or declare full production readiness from the available subsets.

## Historical evidence

### 0012 review and superseded candidate

Documentation baseline `c88aa486` was pushed before implementation. The table below records the reviewed source at `2f2a09d7`; it is historical reproduction evidence, not the current blocker list.

| ID / violated requirement                         | Evidence or reproduction                                                                                                                                                                                                                                                                           | Responsible boundary and observable closure                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 — runnable, controlled PR tests                | `packages/desktop/package.json` runs `playwright test test/e2e` without the nested config. A narrowed invocation collects an installed test and fails because `MARKTEXT_PACKAGED_APP` is absent; the PR E2E job only builds unpacked output. Configured serial/setup safeguards are also bypassed. | Public test scripts/workflows explicitly select the nested config and unpacked project; installed tests have a separate artifact-requiring entry. Run the real commands, verify discovery/configuration, and preserve all suites. This is harness wiring, not an app failure.                                                                                                                                                      |
| R2 — one interpretation honoring preferences      | All Core open paths in `editorWithTabs/index.vue` omit Markdown options; live preference handlers in `editor.vue` update only Muya. A source fixture with `H~2~O`, `2^n^`, footnotes and a GitLab math fence produces different AST kinds with the supported options enabled.                      | Session-owned preference mapping and coherent option changes preserve source/history and pending input. Real application preference changes before open and during editing agree across Markup, Original/Revised, isolated comments and exports. No data loss was established by the review.                                                                                                                                       |
| R3 — shared rendering and resource behavior       | `markdownProjectionHtml.ts` emits relative image destinations unchanged and math/diagrams as escaped text. The actual Core projection renderer reproduces this for Original/Revised; the export path also consumes it.                                                                             | Reuse/expose existing media presentation, resource resolution and export services with Core-owned semantics. Identical fixtures render math/diagrams and document-relative images correctly in reader/comment/export paths; link activation follows existing policy. Cover highlighting, footnotes, themes, invalid/hostile media and source preservation as affected upstream behavior, not presumed additional defects.          |
| R4 — upstream search compatibility                | New query/capture code in `documentProjectionConsumers.ts` copies `packages/muya/src/utils/search.ts`. Regex `\-` matches `a-b` upstream but new unconditional Unicode mode rejects it.                                                                                                            | Share pure query and capture-expansion policy; retain Core traversal/mapping and transactional replacement. Existing accepted queries and replacement captures agree through real search/replace, including selection, replace-all and exact undo.                                                                                                                                                                                 |
| R5 — keyboard accessibility                       | The actual comment-composer SFC loses focus to `body` after Escape. Newly focusable sidebar icons have no visible focus styling under the global outline reset.                                                                                                                                    | Composer lifecycle restores a logical target on cancel/success while failures retain the draft/focus; shared sidebar controls show focus. Keyboard/menu/marker invocation, Tab navigation, cancellation, success, failure and composition are exercised without mouse assistance.                                                                                                                                                  |
| R6 — reuse native control behavior                | Comment/review action buttons duplicate ordinary styles; recovery controls bypass shared button theme states.                                                                                                                                                                                      | Reuse existing `.button`/`.button-primary` or appropriate existing components, keeping local layout only. Verify hover/active/focus/disabled states, light/dark themes and narrow layouts. Retain feature-specific draft/recovery behavior instead of substituting unrelated dialogs/toasts.                                                                                                                                       |
| R7 — localization and writing direction           | Teleported review content loses the editor's direction inheritance. Comment markers hardcode English accessible names. New Cancel duplicates translated `common.cancel`; all 55 new Review/recovery labels in each of ten non-English locales are English fallbacks.                               | Reuse existing keys, translate remaining new strings and route marker names through the existing locale lifecycle. Pass document direction to review text/composition surfaces. Test language switching, accessible names, non-English controls/recovery, and mixed RTL/LTR text with punctuation. Direction is source-traced; visual RTL verification is still required. English fallback presence is not translation completion. |
| R8 — security tests observe their claimed surface | `criticmarkup-rendering-security.spec.ts` always inspects `.editor-component`, even when comments are teleported or Original/Revised are sibling surfaces.                                                                                                                                         | Assert unsafe content absence in each actual visible surface and use a negative control proving the selector catches an unsafe link. Keep execution sentinels and sanitization unit checks. This is a demonstrated coverage gap, not a demonstrated vulnerability.                                                                                                                                                                 |

First implementation candidate `8f4417aa` passed the complete source gates and 40 preference repetitions. Its installed run passed after correcting a CSS-delimiter test false positive, but the broad run stopped after 182 passes at the review-lifecycle selection failure. Screenshot/PDF inspection also exposed split action words and blank PDF math. Those demonstrated failures justified the `5e5c6178` rebuild. Existing latest-view ownership now handles explicit navigation; native shared print readiness handles fonts and stale preparations. The current candidate’s results above supersede affected earlier artifact evidence.

The original artifacts remain in `dist/`, `dmg-installed/` and `candidate-out/` under the run directory, with `candidate-source.json`, `candidate-artifact-sha256.json` and original logs. Their successful executions remain historical evidence, not certification of changed inputs.

[Archived 0011](archive/0011-criticmarkup-editable-review.md) retains the detailed results and artifact identities for runtime `f7bf454e4a035c4e10b66fc207c761d59fd6596f`, its unchanged-runtime verification through reviewed HEAD `2f2a09d7`, and earlier candidates. Its full Mac source, installed, recovery and performance passes remain evidence of what those tests exercised. The later review established gaps in behavior and coverage; it did not turn those earlier executions into failures or certify the proposed repairs.

Update CURRENT with concise closure evidence as work finishes. Keep long logs and historical runs separate; do not introduce another evidence framework, approval packet or open-ended architecture audit.
