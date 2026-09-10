# Finish CriticMarkup through native MarkText reuse

- **Status:** Active; unified parser-to-UI integration is incomplete. Unconverted semantic consumers and incomplete integrated/candidate verification block delivery. The selection-only metadata patch is not an accepted solution. Earlier convention-review results remain historical; sustained performance and external/deferred verification remain open.
- **Started:** 2026-09-07 at the owner's request following the branch review.
- **Supersedes:** [0011](archive/0011-criticmarkup-editable-review.md), archived incomplete. Its full product scope and unfinished requirements carry forward; archival is not completion.
- **Authority:** [vision](../vision/criticmarkup-vision.md), [domain language](../../CONTEXT.md), [Profile 1](../language/marktext-markdown-profile-1.md), semantic ADRs, [document authority](../adr/0001-core-document-authority.md), and [native integration architecture](../architecture/criticmarkup-native-integration.md).
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

R1–R8 were verified on the historical `5e5c6178` candidate. Later convention repairs are recorded below. The latest architecture review demonstrated U1 against the installed package and current source; those failures take priority over the historical green subsets. The full retained scope and release blockers remain open. Changed runtime inputs must not inherit earlier candidate verification.

| ID / violated requirement                         | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Responsible boundary and closure                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1 — one parser-to-UI stack and faithful editing  | Production `json-change` → `decodeNativeEdit` remains reachable for unconverted structural commands, other literal/table Backspace merges and container/leaf resets. Math/diagram/HTML/frontmatter now share intrinsic literal payloads and selection ownership; the source-suffix view reconstruction is removed. Six native CM/plain queued-input controls pass. Retained Core/Desktop/Muya/upstream checks at `c14686e25423` and 104 affected Chromium checks at the subsequent test-only `953957e6bade` checkpoint are recorded below; the retained Core image-label sizing failure remains. Paragraph Backspace into code and the shared adjacent-block input context now pass 19 actual-input and 13 browser controls. The broader code-join source checks below are historical after the literal runtime changes. Completed wrapping and normalized-input checkpoints are recorded below. Other retained semantic consumers and the mounted desktop table dialog remain unverified. CM image-label sizing retains its failure and the owner’s unanswered source-format decision. | Route each actual caller through the live shared model before presentation and retire its legacy semantic path. Preserve immediate selection/next input, exact source, canonical history and save/reopen. Pass retained upstream and integrated checks; no remaining production semantic consumer may depend on the old split.                               |
| U2 — preserve pending input through view teardown | The corrected lease retirement, durable recovery, final close preparation and cancellation restoration pass retained owner/component tests. Historical final8 built-app tests passed four hidden-window Markup/Source close workflows: late input while Save is pending, exact disk bytes/destruction, cancelled Save As followed by immediate typing/history/save. Incoming-open routing and pending-read drain pass actual main-module tests. Packaged/installed quit, queued-open/recovery workflows and native IME remain unverified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Preserve the same actor/history while retiring input; wait for durable state and outstanding reads before destruction. Verify complete application quit/recovery against the final installed candidate, including incoming documents and rejected drafts. Controlled native dialog responses in the bundled test do not prove native dialog/IME interaction. |
| V1 — sustained candidate verification             | No frozen candidate has completed the retained integrated, sustained, upstream and default-enabled installed macOS verification after the synchronous ownership change. The prior measured dispatch-budget miss remains historical evidence below, not a pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Freeze source, lock and artifact identities after fixes. On a quiet host, complete all six 1,200-input workloads, 200 editorial cycles and 15 cold observations with unchanged limits, then complete affected integrated/package checks. Measure renderer model execution; no competing workloads.                                                           |
| E1 — native Mac/Intel execution, external         | Local input sources expose U.S. keyboard only. Mini XCUITest previously failed before launch while enabling automation. Native CJK IME, the actual screenshot picker and Intel Mac execution remain unverified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Obtain non-disruptive native execution/CJK input and Intel hardware; verify candidate selection/commit, history/save and the picker. Chromium composition and completed-capture IPC do not substitute.                                                                                                                                                       |
| E2 — distribution trust, external                 | Developer ID/notarization credentials are unavailable. Current ad-hoc signing verifies local integrity only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Verify signed/notarized distribution and Gatekeeper trust when credentials are available.                                                                                                                                                                                                                                                                    |
| D1 — Windows/Linux, deferred                      | Windows run `34068611204` once left the first saved file unchanged; ten repetitions passed without explaining it. Native Windows IME and final platform checks remain unfinished.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Preserve ARM64 installation fixes. Resume the unexplained save failure only with a new hypothesis or recurrence, then run the retained installed platform checks when platform work resumes.                                                                                                                                                                 |

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
