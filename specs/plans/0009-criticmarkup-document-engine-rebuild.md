# CriticMarkup document-engine rebuild

- **Status:** RED — known MarkText UX gaps and final source-freeze evidence remain
- **Owner:** MarkText
- **Updated:** 2026-07-26
- **Profiles:** `markdown-profile-1`, `marktext-profile-1`, `live-html-sanitized-v1`
- **Order:** P0 → P0.5 → P1 → … → P9 → P11 → P10
- **Completion authority:** only P10 may declare this plan complete

This is the single plan and incorporated audit; there is no separate audit document.
Git history holds discarded designs and progress notes. The branch has one target parser,
one document engine, and one MarkText host. Code outside that architecture is deleted.

## 1. Authority and outcome

| Question                                   | Authority                                                       |
| ------------------------------------------ | --------------------------------------------------------------- |
| Product and Review experience              | `specs/vision/criticmarkup-vision.md`                           |
| Profile 1 language                         | `specs/language/marktext-markdown-profile-1.md`                 |
| Engine vocabulary                          | `packages/document-core/CONTEXT.md`                             |
| Verified parser facts                      | `specs/architecture/parser-core-verified-facts.md`              |
| Architecture and completion rule           | this plan                                                       |
| Exact tests, IDs, dependencies, and status | `specs/migration/0009-exit-gates.yml` and `0009-acceptance.yml` |

Each open document has one durable, main-owned, source-authoritative session:

```text
decoded source → immutable DocumentRevision
  → one lossless Markdown + CriticMarkup syntax graph and parser-emitted AST
  → views, identity, ownership, references, diagnostics, ReviewIndex, and maps
typed intent → candidate edits → parse → postconditions → atomic commit
```

The outcome is exact UTF-16 fidelity; CommonMark 0.31.2, pinned GFM, MarkText
Profile 1, and five CriticMarkup forms; all required views and workflows; typed
editing and consumers; one history; and one direct MarkText flow through
`document-core` + `document-view`.

Non-goals are external-file concurrent merge, collaboration metadata, runtime
grammar plug-ins, editing Original/Revised, and manual testing as evidence.

## 2. Non-negotiables

1. Exact source and its immutable `DocumentRevision` are the sole authority.
   DOM, view strings, drafts, journals, and renderer state are derived data.
2. Markdown and CriticMarkup are recognized in one canonical-source
   progression. No whole-view grammar pass may reinterpret a materialized view.
3. The parser emits nodes, edges, NodeId values, forks, ownership, references,
   provenance, diagnostics, and resolution boundaries. Consumers do not infer
   or reconstruct them.
4. All five CriticMarkup forms are intrinsic AST kinds. Divergent structure
   forks only where an annotation changes it and reconverges at the next safe
   top-level blank line.
5. Lossless leaves reproduce every UTF-16 code unit, including BOM, EOL
   spelling, trivia, escapes, and a missing final EOL.
6. Every mutation is a typed intent. The session creates edits, parses with one
   frozen configuration, proves postconditions, and commits everything or
   nothing. One gesture creates one history entry with exact undo.
7. Main owns session identity, revision head, history, journal, saved identity,
   persistence, effects, cancellation, recovery, SourceOnly state, and resource
   disposal. Renderer state is a publication cache.
8. Persistence leases canonical source. Live, text, HTML, clipboard, PDF, and
   print use closed sink-specific materializers and runtime-decoded requests.
9. Source mode is an adapter over the same session, intent surface, history,
   selection, dirty state, and persistence path.
10. Required commands reject visibly when impossible. Silent no-ops, alternate
    mutation authorities, renderer-authored document bytes, DOM-to-source
    repair, and source syntax manufactured by the view are forbidden.

## 3. Product, configuration, and budgets

| Form         | Source           | Original | Revised |
| ------------ | ---------------- | -------- | ------- |
| Addition     | `{++new++}`      | empty    | `new`   |
| Deletion     | `{--old--}`      | `old`    | empty   |
| Substitution | `{~~old~>new~~}` | `old`    | `new`   |
| Highlight    | `{==text==}`     | `text`   | `text`  |
| Comment      | `{>>note<<}`     | empty    | empty   |

- Empty forms, recursive same-form nesting, and block-spanning forms are valid.
  The first unowned top-level `~>` divides a Substitution.
- Code, HTML, math, autolinks, link destinations, definitions, front matter,
  diagrams, and footnote definitions own marker-looking literal text.
- A Comment payload is a lossless isolated inline Profile 1 subdocument.
  Original and Revised omit it; a Comment card lazily reads its Revised subtree.
- A gapless Highlight + Comment appears as one Commented span while retaining
  independent nodes. Add Comment writes exactly `{==selection==}{>>note<<}`.
- Malformed or over-budget candidates degrade to exact literal source.
  Hidden nested Comment loss rejects before mutation.
- Markup and Source are editable; Original and Revised are read-only. Save pins
  one revision lease. SourceOnly remains exact, editable, saveable, and visible.

`ParseConfigurationV1` is strictly decoded, deeply immutable, and closed.
Unknown, missing, mistyped, unsafe, or invalid values reject.
`MarkdownOptionsV1` contains exactly:

```ts
{
  schema: 'markdown-options-1'
  gfm: boolean
  frontMatter: boolean
  math: boolean
  gitLabMath: boolean
  footnotes: boolean
  subscriptAndSuperscript: boolean
}
```

| Hard limit               |                              `desktop-v1` |
| ------------------------ | ----------------------------------------: |
| Decoded UTF-16 units     |                                32,000,000 |
| `BudgetEvent`s           |                                 2,000,000 |
| Markdown container depth |                                       128 |
| CriticMarkup depth       |                                    16,384 |
| Wire chunk               |                             262,144 bytes |
| Worker checkpoint        | 4,096 source units or 2,048 logical nodes |

Every limit has below/at/above cases. Full and fragment-reuse parses must emit
identical accounting traces and first-failure identities. Doubling families
grow by at most 2.25×; a 4,096-line open is under 5 seconds; interaction p95 is
under 500 ms; maximum-document admission is at most 50 ms; main staging slices
are at most 4 ms; cancellation acknowledgement and animation-heartbeat gaps are
at most 100 ms; and the viewport settles within 10 seconds with bounded DOM and
memory. P11 records the green band below an 8 ms measured edit stall, requires
equivalence-proven reuse above 16 ms, and validates the pre-measurement owner
decision between. `performance-reuse-decision.yml` fixes that decision as
`retain-equivalence-proven-reuse`; the timing run reports the band but cannot
choose its own architecture.

## 4. Current gap ledger

Focused proof means a narrow implementation slice passed while the tree was
changing. It is not phase closure, final-suite evidence, or a shipping claim.

| Area                                              | Implemented with focused proof                                                                                                                                                          | Remaining gap before closure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parser, views, identity, and intents              | One intrinsic parser/fork graph owns structure, facts, maps, Review identity, typed mutations, and atomic history.                                                                      | No known local design gap; run the complete frozen P0.5–P3 and P5 matrices.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Main session, persistence, effects, and consumers | Main owns the worker session, journal, persistence, recovery, paths, clipboard, image capabilities, HTML/PDF/print, and Source mode.                                                    | Run the frozen failure, cancellation, crash-window, hostile-input, wrong-tab, save/reopen, and resource-return matrix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Review transport and commands                     | Original/Revised publish their clean display model with an explicitly retained Markup coordinate map. Focused wire, main-host, renderer, projection, and one complete Accept flow pass. | Make automated shortcut input choose exactly one injection path before the stroke: Playwright input for verified interactive mode or `webContents.sendInputEvent` for verified background mode; prove one keyDown/keyUp stroke produces one command dispatch. Add a public selection-settlement barrier used by every selection-sensitive Review command, so a command issued immediately after pointer or keyboard selection—without a delay—acts on that selection and cannot restore an earlier one. Then pass the complete Review command, workflow, projection, navigation, context, focus, rejection, and localization Electron suite.                                                                                                                                                                                                                                                                                                     |
| MarkText editor UX                                | Task checkbox cascade, auto-pairing, basic Quick Insert, localized controls, Review rail, Source UX, and the target-owned Image selector are implemented in focused slices.             | Quick Insert must add Table plus `vega-lite`, `mermaid`, `plantuml`, `flowchart`, and `sequence`; restore the documented accelerators for Paragraph, Horizontal Line, Front Matter, Heading 1–6, Table, Display Math, HTML, Code, Quote, Ordered List, Bullet List, and Task List; render a localized no-result status; and make the focused control announce the active option. Every choice must reach one authenticated intent with exact undo/redo. Table selection must use a dimensions-only host adapter: it exposes no document target or mutation authority, returns exactly 1–30 rows and 1–20 columns, and core accepts every returned shape including 1×1. A response is cancelled if its originating editor/document/revision/selection is no longer current, Source mode opens, or the owner unmounts; it never retargets. Image selection must pass frozen real-Electron open/focus/cancel/create/edit and exact undo/redo proof. |
| Removal and absence                               | Superseded packages, parser routes, renderer session authorities, source history, export paths, fixtures, and design archives are removed with focused absence checks.                  | Re-run the complete P9 inventory after the final edit and remove every residual caller, export, fixture, route, debug probe, and stale vocabulary named by the manifest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Performance and release evidence                  | Deterministic accounting, worker/viewport instrumentation, maximum-source hash optimization, and the evidence collector exist; focused maximum-source core timing passes.               | Run frozen P11 Electron admission, stall, heartbeat, cancellation, viewport DOM/memory, and edit-latency gates. P10 installed, two-pass, security, PDF/print, and three-platform evidence remains **UNPROVEN**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Open implementation order is deliberately short:

1. close Review input and selection-settlement behavior;
2. close Quick Insert, Table, diagram, and Image UX through public gestures;
3. freeze a candidate tree and run a fresh letter-and-spirit audit plus the complete P9/P11/local matrix;
4. repair only failures found by that matrix and repeat from a fresh freeze; and
5. collect P10 installed and platform evidence from the final pushed commit.

Native Comment context editing uses an explicit layered proof. Playwright's
Electron API cannot inspect or select an OS-native context-menu row, while the
required non-presenting three-platform automation policy deliberately
suppresses that popup. A test-only callback substituted for a `MenuItem` would
create a second command path and is forbidden. A21 therefore requires a real
right-click to authenticate and arm one exact parser-owned target followed by
a real user keybinding that invokes the one-shot typed edit command twice and
proves the consumed command cannot reopen either nested card. The mocked
main-process unit proves only production menu-construction wiring. A separately
machine-owned real-Electron auxiliary target temporarily instruments the actual
`Menu.prototype.append` from the test process, calls the original method,
captures only the production Comment row, verifies its menu and row are actual
Electron `Menu`/`MenuItem` instances, invokes that row, and restores the
prototype in test cleanup. Production exposes no observation or callback hook.
The user-input target and native integration target are both required A21
evidence.

## 5. Red–green protocol

For each vertical behavior:

1. name one public behavior and literal expected result;
2. add and run an ordinary test that fails for the intended behavioral reason;
3. implement only enough target behavior to pass;
4. rerun the narrow test and its regression slice;
5. refactor only green-to-green; and
6. record exact command, counts, result, and relevant artifact.

A skip, retry, conditional omission, assertion-free test, private-shape proxy,
mock substituted for an Electron/installed/PDF/print/platform gate, incomplete
physical-work counter, stale log, hand-written result, or manual check is not
evidence. A focused green run never changes a manifest status by itself.

## 6. Phases and manifest ownership

The manifests own every exact target, A01–A32 and D01–D11 mapping, status, and
dependency. This table states only the phase outcome.

| Phase | Required outcome                                                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| P0    | Machine contracts validate; every target is ordinarily collected and enabled.                                                           |
| P0.5  | One intrinsic parse emits unified structure, identity, forks, and honest work accounting.                                               |
| P1    | Exact language, configuration, hash, resource, and boundary corpora pass.                                                               |
| P2    | Five forms, views, maps, indices, and Comment reads use emitted structure only.                                                         |
| P3    | Typed transforms, semantic codec, postconditions, transitions, Track, and Review pass.                                                  |
| P4    | Main-owned async session, SourceOnly, worker, cancellation, recovery, and real input-to-file flow pass.                                 |
| P5    | Deterministic accounting, scale/depth limits, and any reuse equivalence pass.                                                           |
| P6    | Leased persistence/CAS, recovery, branded HTML, hostile PDF, print, and clipboard sinks pass.                                           |
| P7    | Every editor, Track, table, search, and clipboard gesture reaches one typed intent with exact undo.                                     |
| P8    | Review cards, drafts, CRUD, context identity, shared menu/user commands, navigation, pointer, focus, and localization pass real events. |
| P9    | The complete absence inventory has zero production or test callers.                                                                     |
| P11   | Responsiveness, maximum-document limits, cancellation, viewport, and reuse decision pass measured gates.                                |
| P10   | Two fresh clean-tree passes cover all required surfaces and three platforms.                                                            |

Later slices may land while dependencies are red; a phase turns green only when
its manifest target, requirements, and dependencies are green.

## 7. Evidence status

The implementation tree is still changing. Focused core, view, Desktop unit,
typecheck, wire/publication, maximum-source timing, and selected real-Electron
slices have passed during development. Review input and immediate-selection
hardening, Quick Insert Table/diagram closure, Image Electron proof, and a fresh
whole-tree audit remain;
therefore no final source-freeze sweep has been collected. Exact commands and
counts belong in test output and the evidence bundle, not in a progress diary.

P11 is **UNPROVEN** until the frozen tree supplies maximum-document admission,
owning-thread stalls, heartbeat, cancellation, viewport DOM/memory, edit
latency, and the resulting reuse decision.

P10 is **UNPROVEN** until the collector runs from the final clean commit against
a genuine installed application, completes the fixed surface twice with
distinct run IDs and zero retry/skip, verifies every report and artifact hash,
and ingests first-attempt macOS arm64, Windows x64, and Linux x64 records.

## 8. Definition of done

Done means all of these are simultaneously true:

- exact source and immutable revision are the only production authority;
- one intrinsic parser emits all Markdown/CriticMarkup structure, identity,
  ownership, references, views, indices, and maps;
- every mutation and consumer crosses a closed, runtime-decoded typed seam;
- main alone owns sessions, history, effects, persistence, recovery, and paths;
- real MarkText gestures provide exact source, selection, rejection, visible
  state, one-step undo/redo, save, reopen, and crash behavior;
- every applicable Profile 1 kind is exact in live, text, HTML, clipboard, PDF,
  and print output, including hostile input;
- every A01–A32 and D01–D11 row and every phase dependency is green;
- P9 proves every named forbidden authority, route, export, fixture, and design
  absent and unreferenced;
- P11 meets every measured budget and records the reuse decision; and
- P10 produces two genuine clean-tree passes plus successful macOS arm64,
  Windows x64, and Linux x64 records for the final commit.

A timeout, stale build, unavailable platform, skipped live test, uncaptured
installed flow, dirty collector run, retry, or hand-authored result is
**UNPROVEN**. Until every item above has current evidence, this plan remains RED.
