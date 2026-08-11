# MarkText CriticMarkup core integration
- **Status:** Active — Phase 0 baseline work and the bounded Phase 1 Shadow are in progress

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

Required measurements are:

- captured browser input to speculative DOM mutation and next rendered frame;

- input to authoritative engine acknowledgement;

- renderer/engine transport;

- DOM patch and next paint;

- first editable viewport on open;

- memory and responsiveness during sustained editing;

- pending-input depth and the frequency of corrective paints.


On reference hardware, ordinary input must be visible by the next rendered frame at p95 without waiting for persistence or presentation enhancement. Engine acknowledgement and reconciliation must normally complete without visible correction or input queue growth. The first viewport must become editable before the remainder of a large document is fully enhanced.

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
