# MarkText CriticMarkup core integration
- **Status:** Active — Core authority and Phase 4 installed workflows are implemented and current-build green; Phase 0 owner ratification, authenticated performance calibration, full parity execution, final rebase, and release-candidate evidence remain incomplete

- **Working upstream baseline:** `43bd8b77795fb27b1a9512737c000f7362031ea0`

- **Supersedes:** [0009 CriticMarkup document-engine rebuild](./archive/0009-criticmarkup-document-engine-rebuild.md)

- **Product authority:** [CriticMarkup vision](../vision/criticmarkup-vision.md)

- **Language candidate:** [MarkText Markdown Profile 1](../language/marktext-markdown-profile-1.md), pending explicit ratification

## 1. Outcome
Ship the MarkText application users already know, with CriticMarkup built into the Markdown engine and exposed through a fast, native review experience.

The finished product must:

1. Preserve the user-visible Markdown editing, presentation, preferences, file lifecycle, and export behavior of the recorded upstream MarkText baseline at each validation checkpoint.

2. Parse Markdown and all five CriticMarkup forms as one lossless language. No regex side channel or flattened-source reparse may become a second CriticMarkup interpretation.

3. Let users render, author, navigate, accept, and reject comments and suggestions in WYSIWYG; support Track Changes; and round-trip through Source mode and disk without silent source loss.

4. Keep ordinary typing and editing visually immediate while the engine remains the sole durable document authority.

5. Recover malformed syntax according to the ratified language rules. Reject stale, oversized, or unsafe operations explicitly and atomically. A failed edit or save must not publish a partial document.


This plan is complete only when the installed application satisfies those outcomes. A green engine suite, evidence ledger, or package build is supporting evidence, not a substitute for the product.
## 2. Scope boundary
### In scope
- Use a recorded upstream `develop` commit as the working baseline. Before PR submission, rebase the integration branch onto current upstream `develop`, regenerate the parity denominator, and rerun the affected parity, conformance, performance, and installed checks.

- Selectively carry forward (“salvage”) the pure Markdown+CriticMarkup parsing and edit kernel in `packages/document-core`, together with its independently supported conformance tests, transformations, source/model mappings, incremental-reuse work, and corpora. Phase 0 gives every candidate asset an import, adapt, supersede, or reject disposition; “salvage” does not mean copying the current branch wholesale.

- Integrate through the existing MarkText product shell, treating upstream Muya and the current `document-core`/`document-view` replacements as implementation assets to evaluate rather than automatically retaining or discarding either. Preserve CodeMirror, presentation plugins, preferences, and their tests until a measured replacement passes the parity and authority gates. Starting from `develop` restores a known product baseline; it does not erase the reasons particular Muya responsibilities were replaced.

- Add complete CriticMarkup rendering, authoring, Track Changes, Review, projections, persistence, clipboard/search, and export behavior.

- Replace only the editor internals that prevent a single language authority or measured low-latency interaction, and only after their product behavior is protected by acceptance tests.

### Not release blockers for this plan
- Real-time co-editing, CRDTs, or presence.

- Publishing `document-core` as a general-purpose third-party library.

- New three-way external-file merge/conflict UX beyond the recorded upstream reload behavior.

- Unrelated desktop authority, uploader, image-storage, or supply-chain redesign.

- Exhaustive mutation attestations or a bespoke evidence-retention protocol.

- Degenerate maximum-size stress cases beyond documented, bounded, recoverable behavior. Keep them as nonblocking stress and profiling inputs.


Security, packaging, and cross-platform correctness remain normal release requirements where this integration touches them. They do not authorize a general application rewrite.
## 3. Sources of truth
Use one authority for each kind of decision:

| Question | Authority |
| --- | --- |
| Product value and exclusions | CriticMarkup vision |
| Existing MarkText behavior | Recorded upstream commit for the current validation checkpoint, its unchanged tests, and the installed app |
| Markdown+CriticMarkup semantics | Ratified MarkText Markdown Profile 1 |
| Engine and integration ownership | This plan plus focused ADRs for durable decisions |
| Whether the feature is ready | Product-path acceptance and measured performance |
| Implementation-specific limits and measurements | Versioned test or benchmark baselines, not normative language rules |

Profile 1 remains a candidate until its deliberate interoperability rulings are reviewed and accepted. In particular, nesting, Highlight+Comment adjacency, escaping, BOM behavior, CJK emphasis, malformed recovery, and block interactions must not become product semantics merely because the research implementation currently behaves that way.

Owner ruling (2026-08-10): a Comment payload remains exact source and is interpreted by MarkText as an isolated full Markdown+CriticMarkup subdocument. Its block structure, references, footnotes, and nested annotations are local to that Comment and cannot affect or inherit state from the surrounding document. This is a richer MarkText presentation of canonical `{>> … <<}` metadata, not a new on-disk syntax or permission to normalize the payload.

Before ratification, separate language semantics from implementation machinery. Parser algorithms, parse counts, configuration APIs, accounting schemas, resource profiles, reuse safe points, and test-harness mechanics belong in ADRs, benchmarks, or implementation baselines—not the normative language profile.
## 4. Target seams
The implementation may evolve, but these ownership boundaries must remain true:
### Language and transaction engine
Owns decoded canonical source, the lossless Markdown+CriticMarkup interpretation, explicitly scoped syntax identity, source/model coordinate maps, validated edits, projections, and incremental/full-parse equivalence. Revision-local IDs must never be presented as persistent identities or reused for a different node within their declared scope. If rendering or deltas need cross-revision anchors, the engine supplies a separately defined identity with prepend, move, split/join, duplicate, delete/reinsert, and undo/redo tests. The engine has no DOM, Vue, Electron, file-dialog, or presentation-library dependency.

MarkText consumes a small integration facade. Parser internals, forensic data, and diagnostic accounting do not become general editor APIs merely because they exist in the research package.
### Document actor
Owns live revisions, ordered transactions, history, tracked changes, and undo metadata for one open document. It validates every operation against the revision and ranges on which the operation was authored.

The actor is reachable from the renderer without a mandatory main-process round trip on each caret movement or keystroke. Main may create, supervise, and persist the session, but it is not on the synchronous interaction path.

Integration has two explicit authority modes:

- **Shadow:** upstream Muya/CodeMirror source, history, and save behavior remain authoritative; the core may compare and report but may not affect output.

- **Core:** the core owns the entire document's source, history, undo, and save state. Muya and CodeMirror are projections and command producers.


Authority changes per document session, never per editing feature or operation. There is no mode in which Muya, CodeMirror, and the core may each commit part of one document or maintain competing durable undo histories.
### Editor and view adapter
Owns browser selection, IME/composition state, viewport state, widgets, presentation enhancement, and speculative visual echo. Speculation is tagged with a transaction identity and is reconciled with an authoritative engine result; it never becomes a second durable document model.

Muya and CodeMirror integrate through one authority gateway covering text and structural edits, selection mapping, undo/redo, Source/WYSIWYG switching, tab switching, and save barriers. Before Core mode is enabled, a focused ADR defines ordered pending edits, transformed or rejected edits, selection recovery, composition, immediate undo, autosave, mode/tab switching, worker restart, and a finite pending-work bound. Pending visual drafts can never reach persistence.

Ordinary edits publish semantic changes to affected regions. They do not require full-document serialization, hashing, snapshot transport, DOM replacement, or presentation enhancement before the typed character becomes visible.
### Desktop host
Owns file bytes, decoding/encoding and EOL policy, durable save, native effects, clipboard permissions, link/file safety, printing, PDF, and other platform integration. It consumes explicit engine projections and must not reparse or serialize the document from DOM.
## 5. Compatibility contract
Before replacing an upstream path, create one finite parity manifest from the recorded baseline. Derive its denominator from all command IDs, preference keys, registered editor plugins, menus, routes, README feature promises, desktop and Muya test files, and every skipped, fixme, backlog, or manual baseline case. Record the count and provenance of each source. Every source item maps to a parity row, an explicit unaffected rationale, or an owner-approved compatibility decision; a validator fails on an undisposed addition or removal. The baseline is immutable within one validation run and advances at explicit rebase checkpoints, when the manifest and affected evidence are regenerated.

Every parity row names the upstream behavior, its existing oracle, the new production-path test, and current status. It covers:

- Editing: selection, mouse and keyboard movement, IME/composition, undo/redo, copy/cut/paste, drag/drop, search/replace, shortcuts, focus, and spellcheck.

- Markdown: paragraphs, headings, lists and tasks, block quotes, code and language selection, tables, links, images, footnotes, front matter, HTML, math, diagrams, emoji, thematic breaks, and line-break behavior.

- Product UI: toolbars, context menus, quick insert, table/image tools, outline, tabs, themes, source mode, preferences, and accessibility behavior already supported upstream, plus command palette, focus/typewriter modes, localization, file tree/project operations, window modes, and update flows.

- File lifecycle: open, no-op save, edited save, save-as, autosave, reload, encoding/BOM/EOL preservation policy, recent files, and recovery from errors.

- Consumers: search/count, clipboard, HTML, print, PDF, and other existing exports.


An upstream test may be replaced only when the replacement exercises the same observable behavior through the production path. Until then, retain and run the upstream test unchanged. A deliberate compatibility break requires owner approval and an explicit product decision; it may not be hidden as migration cleanup.

Release-blocking rows use agent-runnable automation through the production interface. A manual-only upstream behavior must gain such a harness or carry an explicitly approved limitation; user dogfooding is welcome but never the only completion oracle.
## 6. CriticMarkup contract
Acceptance covers all five canonical surface forms:

- Addition `{++new++}`

- Deletion `{--old--}`

- Substitution `{~~old~>new~~}`

- Highlight `{==text==}`

- Comment `{>>note<<}`


The product must demonstrate, through the installed WYSIWYG and Source surfaces:

- faithful rendering in Markup, Original, and Revised projections;

- standalone Highlight and Comment behavior plus the canonical gapless Highlight+Comment anchored relationship;

- full Markdown+CriticMarkup rendering inside Comment bodies, with block, literal, reference, footnote, and nested-Comment state isolated from the surrounding document and sibling Comments;

- authoring comments and each suggestion form, including selection-based comments and Track Changes for typing, backspace/delete, cut/paste, replace, formatting, and IME input;

- editing and deleting comments without collapsing or losing the target;

- preserving the comment target and draft across cancel, validation failure, stale revision, and submission errors;

- next/previous Review navigation and per-item and bulk accept/reject;

- undo/redo across authoring and resolution;

- save, close, reopen, and Source/WYSIWYG switching without semantic or source drift;

- correct behavior in literal Markdown contexts, across supported block boundaries, with nesting, Unicode, empty payloads, and malformed delimiters;

- defined clipboard, search, HTML, print, PDF, and persistence projections;

- safe rendering of untrusted Markdown and CriticMarkup payloads.


External fixtures must come from the CommonMark and GFM conformance suites, the canonical CriticMarkup toolkit examples, and independently reviewed Profile 1 rulings. Fixtures generated by `document-core` can catch regressions but cannot, by themselves, establish correctness.

The language suite compares every CommonMark and GFM example for which the upstream standard defines semantic output; merely parsing an input or preserving its source is not conformance. Every normative Profile 1 grammar or recovery rule maps to at least one independently reviewed expected result. A finite, versioned CriticMarkup interaction matrix crosses the five forms with the Markdown constructs and user operations selected as release risks; it replaces the unbounded phrase “all adversarial cases.” New acceptance tests demonstrate a red-before/green-after or an equivalent negative control.
## 7. Latency contract
Performance is judged on checked-in representative documents that include plain prose, long documents, tables, code, Unicode, math, diagrams, images, and dense CriticMarkup. Every result records the document, hardware, OS, build, and metric distribution. Pathological stress inputs are reported separately.

Every recorded observation uses `fresh-application-profile-per-observation-v1`: launch one fresh
application process with one newly created profile, perform one warmup or measured observation,
close that application, and delete that profile before the next observation. The five documents at
20 warmup plus 200 measured observations each therefore require exactly 1,100 application launches,
1,100 unique profiles, 1,100 application closes, and 1,100 successful profile cleanups in each raw
run. Application launch, editor bootstrap, application close, and profile cleanup are protocol
overhead outside every timed metric; no sample may reuse a pooled process, browser context, or
profile.

Observation order is `warmup-then-measured-rotating-round-robin-v1`: all warmup rounds run before
all measured rounds; each representative document runs exactly once per round, and the first
document rotates by one position continuously across rounds and across the phase boundary. This
deterministic rotating round-robin limits fixed document/time-order confounding but does not
eliminate temporal, thermal, cache, hardware, or environment drift. Mandatory time-ordered drift
diagnostics are required for every document and metric. No drift pass/fail threshold is defined
before owner review and ratification; the protocol does not invent one.

The authenticated launcher starts runner-owned `caffeinate -d` display-sleep prevention before
package build and holds the exact process through sampling and cleanup; it neither synthesizes user
input nor focuses MarkText. The raw run records
`runner-owned-caffeinate-display-sleep-prevention-v1`, and cleanup waits for that owned process to
exit.

Before pre-timing readiness, Electron calls `setVisibleOnAllWorkspaces(true, {
visibleOnFullScreen: true, skipTransformProcessType: true })`; readiness asserts
`isVisibleOnAllWorkspaces() === true` and `isHiddenInMissionControl() === true`. Pre-timing readiness
requires two consecutive exact Electron and CGWindow matches within a bounded 5 seconds. During
pre-timing readiness only, a transient origin mismatch or missing optional `onScreen` metadata on
the otherwise exact CGWindow row may settle, but readiness cannot complete until the external
CGWindow row provides explicit on-screen proof. Explicit `onScreen: false` and every other native
or Electron mismatch remain strict and fail immediately. Post-measurement validation remains
one-shot strict; null `onScreen` metadata remains strict and fails immediately. Cleanup reverses the
workspace policy with `setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: false,
skipTransformProcessType: true })` before restoring window state. Application launch and readiness
are excluded from every timed metric; the measurement window remains unfocused and not
always-on-top, with no retries of a measurement or its post-measurement validation.

Required measurements are:

- captured browser input to the exact speculative DOM checkpoint and one Electron `WebContents.capturePage` call with `stayHidden` and `stayAwake` while the exact macOS measurement window is render-active but opacity-zero, nonfocusable, noninteractive, inactive, and not frontmost, immediately followed by retained-state validation; this is a captured compositor-surface upper bound, while the post-capture checkpoint proves only that view state was retained—not screenshot pixel equality, physical display, vsync, or next-frame presentation;

- input to authoritative engine acknowledgement;

- renderer/engine transport;

- DOM patch and authenticated transparent render-active Electron compositor-surface capture;

- first editable viewport on open;

- memory and responsiveness during sustained editing;

- pending-input depth and the frequency of corrective paints.


On reference hardware, ordinary input must reach the exact speculative DOM checkpoint at p95 without waiting for persistence or presentation enhancement. The transparent render-active compositor-capture target remains explicitly unratified until an owner freezes a positive target from comparable upstream and Core calibration runs. Engine acknowledgement and reconciliation must normally complete without visible correction or input queue growth. The first viewport must become editable before the remainder of a large document is fully enhanced.

Before the authority feasibility gate, ratify numeric acknowledgement/open targets from an upstream baseline and user-perceptible latency criteria. If external hardware instrumentation is not used, do not call the browser event boundary “physical input.” The targets may not redefine a measurably slower replacement as acceptable merely because an extreme stress case passes.
## 8. Execution
### Phase 0 — Freeze and establish the oracles
1. Tag the current branch as engine research; do not resume archived plan-0009 closure work.

2. Create the integration branch from a current, recorded upstream `develop` commit.

3. Run and retain the upstream unit, browser, and installed smoke suites before importing engine code.

4. Build and validate the finite parity manifest and capture baseline interaction measurements.

5. Split nonsemantic implementation machinery out of Profile 1, review active parser ADRs for the same leakage, then explicitly ratify, amend, or supersede the affected language and architecture decisions.

6. Inventory reusable assets from both the current research branch and `feat/native-criticmarkup`, including the installed CriticMarkup E2E flows, Review UI, corpora, transformations, and parser tests. Give every asset an import, adapt, supersede, or reject disposition.

7. Record the approved working baseline commit and freeze the parity denominator, language profile, interaction matrix, representative documents, and performance targets for this implementation interval. The upstream baseline is refreshed at the required pre-PR rebase checkpoint.

The generated denominator and its human review overlay live in `specs/baselines/`. That directory
also records the upstream oracle gaps and the import/adapt/supersede/reject salvage inventory. These
files are reproducible implementation baselines; they do not add product or language requirements.


**Exit:** the compatibility baseline, language target, representative documents, latency measurement method, and salvage inventory are reviewable and reproducible.
### Phase 1 — Import a bounded core
1. Bring over the pure language engine, tests, and independently sourced corpora without replacing the editor.

2. Define the narrow MarkText integration facade.

3. Run the core as a diagnostic shadow on representative documents. It may report divergence but does not control user-visible output during this phase.

   Shadow instrumentation is opt-in and bounded. It may coalesce samples or stop reporting when observation would perturb the editor, but it must never synchronously gate input, add unbounded renderer work, gate save, or affect source, history, rendering, or file output. Shadow results do not satisfy the Phase 1A authority or latency exit criteria.

4. Prove full-parse and incremental results equivalent for accepted edits, and prove stale or invalid edits fail without partial publication.


**Exit:** upstream behavior remains unchanged and the core independently parses the target language through the intended facade.
### Phase 1A — Prove authority and latency feasibility
Implement the authority gateway and exercise one Core-mode document through the production transport. The spike covers plain typing, structural conversion, cross-block replacement, table paste, native IME, transformed/rejected/stale edits, immediate undo/redo, incremental Source edits, Source/WYSIWYG and tab switching, save with pending input, worker restart, and one enhanced math or diagram render.

Prove exactly one durable source and undo history after every operation. Prove that pending drafts never reach save, input echo meets the ratified target, cross-revision anchors do not alias, and ordinary edits avoid steady-state whole-document transport, reconstruction, or DOM replacement.

Implementation checkpoint (2026-08-10, measurement boundary revised 2026-08-13): the production Muya path traces browser input to a matching editor DOM state; the former requestAnimationFrame, CDP screenshot, and OS-hidden `capturePage` observations are not accepted performance evidence and have been replaced by the transparent render-active Electron `WebContents.capturePage` compositor-surface upper-bound defined above. The bounded Shadow exercises the real Worker transport without becoming an authority. The core now admits edits as an atomic transaction: it owns exact candidate reconstruction and either publishes the accepted revision or nothing. CodeMirror's native change events provide an exact-edit seam for a single LF-domain change. Exact Source-mode authority still requires the adapter to map preserved CRLF/CR source coordinates, handle multiple changes from one editor operation, and distinguish user edits from programmatic replacement. Muya's JSON operations address a normalized block tree, not canonical Markdown source, so WYSIWYG Core mode remains gated on serializable semantic region replacements and an explicit projection-to-source map; a whole-document serialization-and-diff bridge does not satisfy this phase.

Implementation checkpoint (2026-08-11): the core publishes structured-cloneable Markup region replacements for two deliberately narrow, parser-proved cases: an ordinary plain middle paragraph and text edited inside one clean, non-nested Markup-visible annotation in a middle safe region. The latter covers Addition, Deletion, Highlight, and either arm of Substitution. Each replacement carries independent old and new source, editing-syntax, and event ranges. CriticMarkup replacements contain a complete balanced event stream, exact coordinates, the updated public annotation, and enough range information to rebase retained syntax and events. Substitution preserves old-then-new arm order and distinct paired marks. Repeated eligible edits remain regional, older revisions remain projectable, and unsupported requested changes return a typed whole-document fallback. The visible-form path accepts any authored spelling when bounded old and new parses prove the same marker, Markdown, accounting, and canonical-coordinate shape; it does not use a character allowlist.

The core also publishes an explicitly requested whole Comment Display replacement together with the affected main-Markup region. The request identifies the prior Comment by value, not object identity. The replacement carries the next Comment payload ranges, isolated Markdown and local AST, exact source or generated coordinate segments, and a depth-independent flat annotation table suitable for Worker transport. Local block Markdown, front matter, definitions, references, footnotes, literals, nested CriticMarkup, and protective spelling remain isolated Comment semantics. Repeated eligible edits retain their Comment projection for old and new revisions without forcing a full parse or source materialization. Request order and duplicates are normalized; unsupported targets and combinations return typed document fallbacks.

The plain-paragraph index shares original safe-point facts and path-copies a logarithmic prefix-sum overlay, so those edits do not rebuild the retained-fact suffix. Canonical source is held in an immutable balanced piece rope; eligible edits path-copy it and read only the affected region, while full-string access is a lazy, cached compatibility barrier. Shadow recognition uses the non-materializing source length. This proves the semantic-delta, retained-index, canonical-source, balanced visible-CriticMarkup, and Comment Display seams without putting them on the production input path.

A persistent measured regional inventory now covers documents with multiple top-level CriticMarkup roots. It stores detailed facts only for CM-bearing safe regions, collapses consecutive plain regions into measured gaps, and path-copies one immutable tree path when one region changes. Source, editing-syntax, and event prefix measures remain independent, so an earlier length-changing edit can be followed by an exact Comment edit identified by its shifted range without first materializing the document's annotation array. The admitted path parses one candidate region, performs no old-region or full-document parse, and leaves historical inventory roots projectable. Plain and single-root documents keep their prior specialized paths and pay no inventory construction cost.

This is still a preparatory slice, not general incremental authority. Inventory admission currently requires one edit in one fixed safe region, more than one top-level CM root, stable marker/annotation/main-Markup/Comment-Display topology, no diagnostics, canonical main-Markup coordinates, and unchanged Markdown options. Multiple requested Comments are normalized and projected locally across inventory leaves, including nested targets: the edited leaf and each distinct requested leaf are parsed once, only the edited inventory path is copied, and every requested changed or shifted Comment receives a portable replacement and a retained local projection. Both the plain-paragraph index and multi-region inventory carry a retained dependency-prefix fingerprint, so unrelated edits strictly after unchanged global reference/definition facts remain regional. Edits touching or preceding those facts retain the typed `definition-or-reference-facts` barrier; because a leaf-only parse cannot resolve definitions owned by another leaf, a changed leaf containing a possible reference delimiter pair also fails closed through the same typed barrier. Gaps, split/join edits, multiple edited regions, and structural changes remain explicit whole-document barriers. Legacy one-root visible-form and Comment admission still parse both bounded old and new regions. A very large single safe region can therefore still be expensive.

Resource admission now exposes `DOCUMENT_RESOURCE_POLICY_V1.maximumLogicalNodes = 65,536`. The ceiling is derived conservatively from a 512 MiB recoverability envelope with a 25% heap reserve, the full source-unit allowance, and a 4 KiB per-node envelope, rounded down to a power of two. Production accounting enforces the limit at syntax-emission time rather than after constructing every tape, AST, projection, and fork product. Bounded-heap regressions admit exact below/at-limit fixtures, reject the first over-limit node with a typed diagnostic, reject a compact roughly sixteen-times overshoot without exhausting V8, preserve the prior revision and projection identity, and accept a later valid edit. Structural scale tests that intentionally exceed production admission use a package-internal unbounded inspection facade and do not weaken the desktop policy.

Full-revision parser products now live behind a revision-owned store. Before parsing a new head, the core drops its strong reference to the prior full products and keeps only the retained intrinsic pass needed for incremental/full equivalence. Cached history reads need no parser work. An uncached historical projection drops the current full products, reparses for the duration of that call, and returns detached public data. A revision that is still current may retain products again on its next projection; historical revisions may not. Structural counters show at most one strong revision-owned full-product store. A Node 22 child regression also completes an 18,000-region forced intrinsic fallback followed by historical projection under a 512 MiB heap cap, which the pre-fix implementation exhausts.

Canonical-source piece growth is bounded independently at 256 pieces. Crossing the bound emits one typed `source-fragmentation-rebase`, commits an atomic one-piece source root, preserves history, and returns the following eligible edit to regional processing. The desktop recovery journal also checkpoints internally before its 256-outcome bound; a failed maintenance barrier preserves the prior checkpoint and full accepted suffix for recovery. CodeMirror maps one attached native multi-change operation to one sorted Core apply and one actor history entry, including exact CRLF coordinates, while distinct editor operations retain distinct undo entries.

Full document fallbacks requested through the projection seam now attach one frozen, structured-cloneable canonical-source resynchronization to the accepted change. Regional commits carry no such payload. The Worker acknowledgement transports the exact fallback source and typed reason without a second source request, so callers can fail closed or rebuild from the actor-owned revision rather than reconstructing a document snapshot in the renderer.

Production Core mode remains blocked on ratified latency evidence and a current-build installed authority run. Ordinary CodeMirror and Muya edits no longer use renderer snapshot/diff authority, and focused reconciliation, pending-save, composition, generation, recovery, and dependency-directed regional tests cover the manager-owned and parser-owned barriers; those seams still require final release-candidate installed evidence.

**Exit:** choose, from reproduced evidence, whether to continue with the Muya adapter or build a constrained replacement view inside the preserved MarkText product shell. If neither route passes, stop for an owner decision; do not let Phase 2 silently become another editor rewrite.
### Phase 2 — Complete one vertical review slice
Route one document through the new authority end to end: open source, render all five forms, create a comment and tracked suggestion, navigate Review, accept and reject, undo and redo, switch Source/WYSIWYG, save, close, and reopen.

Use and extend the proven low-latency renderer/actor path during this slice. Do not route ordinary typing exclusively through the new engine until immediate visual echo, IME/composition, reconciliation, and semantic region updates pass production-path tests and measurements.

**Exit:** the installed app completes the vertical slice without source drift, upstream regression, a main-process interaction round trip, or a miss against the ratified interaction targets.
### Phase 3 — Migrate full MarkText parity
Move remaining editor behaviors through the authority gateway one adapter at a time. Preserve mature presentation plugins and UI until their typed-node adapters pass the parity row. Shadow mode remains entirely upstream-authoritative. A Core-mode document remains entirely core-authoritative even while presentation adapters migrate; diagnostic comparison is temporary and cannot silently choose whichever result succeeds.

**Exit:** every parity row is green or has an explicitly approved compatibility decision, and no upstream test was retired without equivalent coverage.
### Phase 4 — Complete CriticMarkup workflows and consumers
Complete Track Changes, Review UI, projections, bulk resolution, search, clipboard, persistence, HTML, print, PDF, and the frozen CriticMarkup interaction matrix.

The current-build installed Phase 4 transaction at commit `71ebb14711f9577a6b318883bde7423a0bc62fff`
passes the exact 25-row interaction matrix plus eight workflow tests for bulk Review, Track Changes,
native clipboard, Revised search/replace, and HTML/PDF/Print projection. Its 33-test record
authenticates the packaged application, executable, test and harness sources, Playwright report,
runner log, and cleanup receipt. The interaction behaviors remain proposed until owner approval, and
this evidence does not close parity, performance, final-rebase, or supported-platform release gates.

**Exit:** the CriticMarkup contract in section 6 passes through production paths, including installed save/reopen and output consumers.
### Phase 5 — Rebase, optimize, and release
Before submitting the PR, rebase onto current upstream `develop`, refresh the recorded baseline and parity denominator, and disposition upstream changes. Then profile measured bottlenecks, harden the already-required semantic-delta and viewport-bounded paths, and remove temporary comparison code. Run the complete parity, language, CriticMarkup, security, performance, and cross-platform installed suites from a clean checkout.

**Exit:** all Definition of Done evidence below is current for one release candidate. Release-engineering failures remain visible as release failures; they do not retroactively redefine implemented product behavior.
## 9. Definition of Done
The feature is done only when all of the following are true for the same release candidate:

- The upstream parity manifest regenerated after the final rebase is entirely green, except for explicitly approved compatibility changes.

- Official CommonMark/GFM conformance, ratified Profile 1 behavior, exact-source round trips, and incremental/full equivalence pass with no hidden skips.

- All five CriticMarkup forms and the workflows in section 6 pass through the installed application.

- Ordinary input and first-viewport performance meet the ratified section 7 targets on representative documents, with no unbounded queue growth or steady-state whole-document editing work.

- Session-wide authority, cross-revision identity, speculative reconciliation, IME, save barriers, and worker recovery pass the Phase 1A production-path cases.

- Save and every shipped consumer use the declared projection, preserve source and encoding policy, and fail without partial output.

- The supported platform packages pass the same installed smoke workflow.

- Temporary dual-run code, obsolete parser authority, and superseded tests are removed only after the replacement evidence is green.


The release record consists of ordinary CI/test transcripts, the parity matrix, performance results, and installed smoke results. It does not require a second bespoke certification system.
## 10. Change control
At Phase 0 exit, the product owner records the working baseline commit and approves the parity manifest, language profile, interaction matrix, representative documents, and performance targets for that validation interval. The baseline and parity manifest are regenerated at explicit rebase checkpoints; changes to the other approved artifacts require the change control below. New findings are classified as one of:

1. A blocker because a reproduced production-path failure falsifies a named row in the frozen product, language, safety, parity, or latency contract.

2. A normal defect because it prevents a written exit criterion in the current phase.

3. Follow-up work outside this release.

4. Evidence or process improvement that does not change product readiness.


Only the first two enter this plan. Amending a frozen artifact requires an explicit product-owner decision that records the affected scope and schedule. Fresh-eyes reviews may discover blockers but may not silently expand the product contract. No hook or agent instruction may turn “all remaining gaps” into an unbounded same-session obligation.

Implementation work uses one integration branch with coordinated ownership. Parallel agents either work read-only or on explicitly disjoint files; no audit grades a moving target and then automatically rewrites its completion criteria.
