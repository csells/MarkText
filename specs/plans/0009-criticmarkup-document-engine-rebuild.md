# CriticMarkup document-engine rebuild

- **Status:** RED — G4, G6–G9, G13, G18, G19, G23, G24 open;
  G5, G14–G16 partial
- **Owner:** MarkText
- **Updated:** 2026-07-28
- **Profiles:** `markdown-profile-1`, `marktext-profile-1`, `live-html-sanitized-v1`
- **Order:** P0 → P0.5 → P1 → … → P9 → P11 → P10
- **Completion authority:** only P10 may declare this plan complete

This plan states the architecture MarkText is built to and the distance still to
travel. It is the only architecture and completion authority; git history holds
discarded designs and progress notes.

## 1. Authority and outcome

| Question                                   | Authority                                                       |
| ------------------------------------------ | --------------------------------------------------------------- |
| Product and Review experience              | `specs/vision/criticmarkup-vision.md`                           |
| Profile 1 language                         | `specs/language/marktext-markdown-profile-1.md`                 |
| Engine vocabulary                          | `packages/document-core/CONTEXT.md`                             |
| Review and Comments vocabulary             | `CONTEXT.md`                                                    |
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

## 2. Architecture and non-negotiables

### Modules

Each concern below has exactly one module, and that module's interface is the
surface both callers and targets cross. A concern answered in two places is a
defect regardless of whether any behavior is wrong; a concern with no module is
the same defect, because it is answered wherever the last caller needed it. This
list is complete when every concern the non-negotiables name appears in it once.

- **Admission authority.** `admit(base, edits, class): Admitted | Rejected`,
  where class is `typed-gesture`, `proven-candidate`, or `exact-replay`.
  `Admitted` carries the candidate revision, the transition with its inverse
  edits, and the admitted diagnostics; `Rejected` carries one named class. It
  owns edit validation, resource limits, inverse derivation, and postcondition
  proof, and it is the only caller of the language engine's `reopen` — nothing
  else turns edits into a revision. It calls source authorship at most once per
  candidate, before the parse, and never for `exact-replay`, whose bytes were
  authored and proved when they were first admitted. The class is an ordinary
  argument, discriminating in the type, never inferred from an argument's
  presence.
- **History.** One module owns the undo and redo record: what an entry contains,
  the one-gesture-one-entry coalescing rule, the cursor, and the exhaustion
  states. Its interface is `record(admitted)`, `undo(): Replay | null`,
  `redo(): Replay | null`, and `state()`. A `Replay` is an exact edit set plus
  the exact selections to restore; history hands it to admission under
  `exact-replay` and never re-derives edits, calls the parser, or mints saved
  identity.
- **Saved identity.** One module owns the identity by which a revision is
  recognized as the one on disk. It mints, compares, serializes, validates, and
  recovers that identity as an opaque branded value derived from `SourceHashV1`
  over exact canonical units; `FileHashV1` and `RevisionSemanticHashV1` are
  never substituted for it, and their divergence under re-encoding is a stated
  case. Dirty state is a comparison this module performs, never an expression a
  caller writes, and every other module transports the value opaquely.
- **Durable record.** One module owns crash-durable serialization of committed
  work: `begin(ticket)`, `commit(record)`, `recover(): RecoveredHead`. It stores
  the opaque saved identity, the admitted edit sets, and transition metadata; it
  re-declares no field of an identity another module owns and publishes nothing
  a consumer can query for syntax. Recovery rematerializes the exact revision
  through admission and verifies it before semantic access resumes.
- **Source authorship.** Every byte production writes into canonical source that
  the user did not type is authored here: CriticMarkup marker composition, the
  escape rule at changed joins, and the Track Changes carrier decision. Its
  interface is `author(revision, range, input)` and `protect(revision, edits)`,
  each returning exact replacement text, its authorship class, and the
  diagnostic every authored byte emits — never a committed revision. Admission
  decides whether the result is admitted; no caller composes marker syntax,
  spells an escape, or branches on Track Changes inline.
- **Coordinate authority.** One module answers every model↔source position
  question — `sourcePositionAt`, `modelPositionAt`, `boundaryNear`,
  `mapThroughEdits`, `nodeModelRange`, and every view length — under one
  affinity rule. Views publish runs for rendering; runs are not a coordinate
  substrate, and no consumer re-derives a mapping. `boundaryNear` is the only
  nearest-visible-boundary answer: Review focus, caret snapping, and hidden-gap
  resolution call it rather than restating its tie rule.
- **Selection.** One module owns the caret and range as session state in both
  Markup and canonical-source coordinates, and owns settlement. Its interface is
  `select(range)`, `current()`, and one public `settled()` barrier every
  consumer awaits. Positions cross this interface; the view reports gestures and
  never computes a position it then submits. The barrier is production behavior
  a real user gesture reaches.
- **Intent seam.** One typed intent union, declared once in `document-core`, is
  the only description of a document mutation. It has exactly three readers:
  `prepare(intent)` in the engine, `dispatch(intent)` in the view, and a wire
  schema derived from the union rather than restated beside it. Revision
  identity is minted by the session on the prepared result, never passed in.
  Adding an intent adds exactly one union arm — no facade method, dispatch
  ladder, parallel command union, menu constant, or bus string restates it. The
  seam publishes one capability snapshot per revision: a closed record whose
  fields are exactly the preconditions the typed intents declare.
- **Command record.** Availability is a property of a command. One record
  carries id, an availability predicate over the capability snapshot, dispatch,
  and its menu, accelerator, palette, and context projections. Every invocation
  path resolves that one predicate before dispatch, registration rejects a
  command no disable path can address, and one outcome presenter renders every
  rejection. A predicate that consults renderer state, a store, a timed
  round-trip, or a DOM query is not a predicate over the snapshot.
- **Effect adapters.** Every external effect — print submission, native dialogs,
  presentation mode — is an interface with a production adapter and an
  automation adapter, bound once at one named composition-root module that is
  the only place an adapter is chosen. No production module reads `process.env`,
  and no environment value that selects production behavior is exported to the
  renderer.
- **Execution control and report.** One module owns the lifecycle of every unit
  of engine work a budget names: stage allocation, checkpointing, cancellation,
  acknowledgement, and the typed report each stage publishes — named stages,
  counters, reuse engagement, and first-failure identity. The seam sits at the
  report: measurement subscribes to what production already publishes and never
  instruments a host, and no second work authority exists. A cancelled stage
  publishes no revision and no partial accounting.
- **Language engine.** One module owns Markdown and CriticMarkup recognition,
  including which changed joins became syntax. `LanguageEngine` declares every
  capability a caller may reach — `open`, `reopen`,
  `inspectChangedCriticMarkerJoins`, `nextExecutionStage` — as ordinary
  interface members; no capability is resolved through an instance-keyed side
  channel, because a capability resolved at run time is invisible to
  module-graph analysis. Its stated invariants: `reopen` accepts only a revision
  this engine produced under an identical configuration, and `reopen` over
  source S yields a revision indistinguishable from `open` over S. Complete
  declaration is not runtime grammar selection.
- **Grammar configuration.** One main-owned module turns persisted settings into
  the process's single `ParseConfiguration` and strictly decodes any
  configuration arriving over the wire: `configurationFor(settings)` and
  `decode(unknown)`. Exactly one construction site exists. The renderer receives
  a decoded configuration and never builds one, constructs a language engine, or
  opens a revision — including for previews, theme samples, and Preferences.
- **Consumer policy.** One module answers, for every named consumer — live,
  text, HTML, clipboard, PDF, print — which projection it reads, which
  sink-specific materializer renders it, and under which live-HTML safety
  profile. It never selects a parse and never answers a coordinate question.
  Per-Profile-1-kind exactness across the six sinks is this module's table, not
  six tables. Every such question production answers is answered here.
- **Persistence lease.** One module owns the ordered path from head to installed
  bytes: `lease(reason)`, `release(lease)`, `installed(lease)`. Acquiring a
  lease flushes admitted work first; while a lease is held the leased revision
  cannot be replaced. Nothing else reads canonical source in order to write it,
  and no module infers durability from a successful callback.
- **Wire decoding.** One module owns closed-record admission and bounded
  identities and coordinates, with one closed, enumerated rejection vocabulary
  shared by every codec, so a target asserts a named class rather than a message
  pattern. Channel codecs are schema declarations over it.

### Non-negotiables

1. Exact source and its immutable `DocumentRevision` are the sole authority.
   DOM, view strings, drafts, journals, and renderer state are derived data.
2. Markdown and CriticMarkup are recognized in one canonical-source
   progression. No whole-view grammar pass may reinterpret a materialized view,
   and no production module outside the grammar pattern-matches either syntax.
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
11. No target drives, observes, or settles production through a seam that
    exists only for tests. Every precondition, barrier, observation, and
    submission a named target relies on is a public production affordance
    reachable by a real user gesture.

## 3. Product, configuration, and budgets

| Form         | Source           | Original | Revised |
| ------------ | ---------------- | -------- | ------- |
| Addition     | `{++new++}`      | empty    | `new`   |
| Deletion     | `{--old--}`      | `old`    | empty   |
| Substitution | `{~~old~>new~~}` | `old`    | `new`   |
| Highlight    | `{==text==}`     | `text`   | `text`  |
| Comment      | `{>>note<<}`     | empty    | empty   |

- Formation, empty payloads, recursive nesting, block spanning, the dividing
  `~>`, literal ownership by code, HTML, math, autolinks, link destinations,
  definitions, front matter, diagrams, and footnote definitions, and degradation
  to exact literal text — never to failure — are the language authority's rules.
  This plan adds no language rule.
- Comment payloads, Anchors, and the Commented span carry `CONTEXT.md`'s
  meanings. A Comment payload is a lossless isolated inline Profile 1
  subdocument that Original and Revised omit; Add Comment writes exactly
  `{==selection==}{>>note<<}`; and hidden nested Comment loss rejects before
  mutation.
- Markup and Source are editable; Original and Revised are read-only. Save pins
  one revision lease. SourceOnly remains exact, editable, saveable, and visible.

`ParseConfigurationV1` is strictly decoded, deeply immutable, and closed.
Unknown, missing, mistyped, unsafe, or invalid values reject, as does any
identifier that branches no production behavior. The accepted Markdown,
CriticMarkup, and live-HTML profiles are exactly the three named in the header,
and `desktop-v1` is the only accepted limits profile.
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
under 500 ms on the cold path; maximum-document admission is at most 50 ms; main
staging slices are at most 4 ms; cancellation acknowledgement and
animation-heartbeat gaps are at most 100 ms; and the viewport settles within 10
seconds with bounded DOM and a working set of at most 2 GB. P11 records the
green band below an 8 ms measured edit stall, requires equivalence-proven reuse
above 16 ms, and validates the pre-measurement owner decision between.
`performance-reuse-decision.yml` fixes that decision as
`retain-equivalence-proven-reuse`; the timing run reports the band but cannot
choose its own architecture.

## 4. Current gap ledger

Each row states where the code stands against section 2 and what remains;
section 5 governs what counts as evidence for closing one.

<!-- Machine contract: 0009-evidence-collector.ts and 0009-final-closure.spec.ts
parse the table below. Keep the heading above, the header cells "Area" and
"Open before closure", the row labels "Document engine" and "P10 release
proof", and the single-space cell padding exactly as written. -->
<!-- prettier-ignore -->
| Area | Target | Open before closure |
| --- | --- | --- |
| Document engine | The section 2 admission authority, history, saved identity, durable record, source authorship, coordinate authority, and selection, over one intrinsic parser and fork graph. | G4 (W1) |
| Host surfaces | Non-negotiable 7 plus the section 2 intent seam, command record, effect adapters, execution report, and grammar configuration. | G5 (visible half done), G6–G8 (W2) |
| Evidence integrity | Two-sided mutation proof under section 5 for every target the manifests name. | G9, G13 (W3) |
| Language, configuration, and coverage | Section 3 language, configuration, and limits, each bound to a manifest row and proved under `desktop-v1`. | G14–G16 residues, G18–G20 (W4) |
| Absence and documentation truth | Non-negotiable 2 and the P9 absence inventory over every tracked surface. | None. |
| P11 performance proof | Every section 3 budget, on a frozen tree. | G23 (W6) |
| P10 release proof | The section 7 P10 criteria. | G24 (W6), and the executable-proof list under W6. |

### Gaps

A closed gap is removed from this list; the status line and ledger record what
remains, and git history holds the rest. Every gap closes red–green under
section 5 against a named target, and carries its own manifest row — which records its owning phase — before that phase may
turn green. Two gaps are not single public behaviors: G9 and G24. An
abbreviated citation is relative to `packages/document-core/src` in W1, W3, and
W4, and to `packages/desktop/src` in W2, W5, and W6.

**W1 — Document engine**

- **G4 Model↔source answers are re-derived in four modules.** The declared
  authority (`markupCoordinateMap.ts:36-42`) is bypassed:
  `internal/session/markupView.ts:94-112` publishes raw runs beside the derived
  answers, and four consumers scan them with their own affinity and edge rules
  (`internal/session/revisionWorker.ts:5467-5522`, `:321-365`,
  `internal/session/sessionCoordinator.ts:434-473`,
  `view/markupRender.ts:771-840`, and
  `packages/document-view/src/documentCore/documentCoreInputAdapter.ts:156-193`).
  A sixth answer with its own tie rule sits in the Review index
  (`internal/session/sessionCoordinator.ts:483-497`). Violates non-negotiable 3.

**W2 — Host surfaces**

- **G5 Availability is not a property of a command.** Only Review commands
  declare `isAvailable` (`renderer/src/commands/index.ts:464`). Main registers
  every accelerator with no availability check
  (`main/keyboard/shortcutHandler.ts:80-88`); the palette and the accelerator
  registry default to available; the context menu runs its own timed
  round-trip; and 12 of the 18 Edit-menu rows declare no `id`, so no disable
  path can address them (`main/menu/templates/edit.ts:11-172`). Three renderer
  handlers guard Source mode
  (`renderer/src/components/editorWithTabs/editor.vue:1205`, `:1234`, `:1259`).
  Violates non-negotiable 10. Its visible half is closed: those handlers now
  reject through one outcome presenter rather than returning silently, so an
  impossible command is visible to the user. What remains is the predicate —
  `common/commands/review.ts:14-44` carries the record shape across five
  surfaces; generalize it over the capability snapshot G8 publishes.
- **G6 Effects branch inside production.** A `proofPath` field on the production
  request type selects a written proof over native print submission inside the
  static sink host (`main/documentCore/staticSinkHost.ts:33`, `:48-53`,
  `:244-259`); presentation mode binds its adapter by reading `process.env` at
  module load (`main/presentationPolicy.ts:207-211`); and
  `MARKTEXT_E2E_READONLY_BRIDGE` installs a main static-sink acceptance surface
  and a renderer read-only bridge (`main/ipc/documentCore.ts:497-498`,
  `renderer/src/components/editorWithTabs/editor.vue:1679`). The boot-info
  allowlist exports `PERF_TESTING` and `MARKTEXT_E2E_READONLY_BRIDGE` to the
  renderer (`main/ipc/bootInfo.ts:7-16`); it closes to values that select no
  production behavior. Violates non-negotiable 11 and the section 2
  effect-adapter rule; `specs/architecture/background-application-testing.md`
  keeps its one production presentation policy.
- **G7 A second document-open path exists.** A 373-line surface re-implements
  the ticket, chunk, and complete protocol
  (`main/documentCore/documentCorePerformanceSurface.ts:31-373`) under a grammar
  fixed at module load instead of the settings-derived configuration production
  admits (`:86-90`; compare `main/windows/editor.ts:1030-1035`), reached through
  a `PERF_TESTING` global. The production host carries the numbers
  (`main/documentCore/documentFileHost.ts:257-262`); the second path is deleted.
- **G8 One intent is declared nine times.** A single block conversion is
  restated as a menu constant, an IPC string, a bus string, a host facade
  method, a parallel command-union variant, an `EditorIntent`, a `prepare*`
  method, a dispatch-ladder arm, and a wire-codec arm
  (`internal/session/revisionWorker.ts:1748-5465` exposes 36 `prepare*` methods;
  `internal/session/sessionCoordinator.ts:1171-1354` holds no behavior;
  `internal/session/intentCodec.ts:440-870` is a third;
  `packages/document-view/src/documentCore/documentCoreView.ts:389-455` and
  `packages/desktop/src/renderer/src/components/editorWithTabs/documentCoreDesktopEditor.ts:132-265`
  mirror it again). Seven intents receive the kernel's postconditions and
  thirty-four do not; every intent must receive them.
  `packages/document-core/src/transformationKernel.ts:125-135` carries the
  shape: two methods over 2,050 lines.
**W3 — Evidence integrity**

Section 5 and non-negotiable 11 forbid the constructs these gaps name: a target
whose assertion cannot distinguish pass from fail.

- **G9 Mutation proof is one-sided, so a target that always fails counts as
  proved.** Every target the manifests name is proved twice: the un-mutated tree
  passes it, and a stated mutation of the production behavior it claims to prove
  makes it fail. A target that cannot pass its own baseline is red, not proved.
  The mutation and both results are recorded per target and retained with the
  evidence bundle (G24). Assertion presence is not proof.
- **G13 Selection evidence is synthetic.** A08 and A31 select through a
  `TreeWalker`, a `Range`, and hand-dispatched untrusted events, and Review
  evidence settles with fixed sleeps instead of the public `settled()` barrier.
  Every selection-sensitive target drives selection with real input and settles
  on that barrier.

**W4 — Language, configuration, and coverage**

- **G14 GFM is bound to no gate.** CommonMark is bound: A35 names the
  652-example 0.31.2 totality target and A36 names the conformance target that
  admits no pending exclusion, both under the shipping profile. GFM is still
  bound only as 24 curated examples, so a GFM regression turns nothing red.
  Closure needs a pinned GFM corpus gated the way A35 and A36 gate CommonMark.
- **G15 Two mandatory conformance suites have no target.** The A10 recovery
  corpus now proves the scope its requirement names: nine frozen cases covering
  a fenced block, inline code, and a fence inside a list item owning
  marker-looking text, plus unterminated openers spanning a blank line and
  inside a blockquote. The MMD-6 differential and Fevol lexical suites the
  language authority makes mandatory still have no target anywhere, so a
  conforming-implementation claim rests on corpora the plan never runs.
- **G16 Per-kind sink exactness has no manifest row.** Image handling and
  accessibility are bound: A33 names the proof that the ingestion request
  carries no destination field, so the write root stays main-derived from
  main-owned settings plus the main-resolved document path
  (`packages/desktop/src/main/imageAssets/imageAssetService.ts:343-409`), and
  A34 names the modal-behavior proof. Per-Profile-1-kind exactness across the
  six sinks still has none: `consumer-policy.yml` is a view × consumer matrix,
  not a per-kind exactness matrix, so section 8's exactness claim rests on no
  target. That matrix is this gap's remaining work.
- **G18 Over-budget depth semantics are misimplemented.** The implementation and
  the A11 row lose semantics document-wide one level past the section 3
  CriticMarkup depth limit instead of degrading to literal text. The bound is
  accepted-node depth: an opener that never closes nests nothing and is charged
  nothing, and runaway openers are bounded by the `BudgetEvent` limit instead.
  Enforcing that at close by counting the open-frame stack is **not** equivalent
  and was tried and reverted: a document whose accepted depth is 1 can hold
  thousands of open frames, because a frame that never closes still sits on the
  stack, so frame counting degrades a node whose accepted ancestry is shallow.
  Accepted depth is only knowable once the parse completes, so closure needs
  either a post-parse pass that rewrites too-deep nodes to literal text or a
  confirmed-ancestor count maintained during the parse. Align the
  implementation, then retitle A11.
- **G19 Consumer policy declares what production routes around.** Four exported
  entry points have no production caller
  (`materialize/consumerPolicy.ts:247`, `:821`, `:1075`, `:1220`) while
  production classifies paste by hand
  (`packages/desktop/src/main/ipc/documentClipboardPaste.ts:73-77`) and routes
  replace and live rendering elsewhere. Production routes those questions
  through the policy; deleting the declarations is rejected, because it leaves
  G16's per-kind matrix with no owning module.
**W6 — Budgets and release**

- **G23 Measured budgets are unmet.** Edit and deletion latency, worker stall,
  renderer animation, working-set memory, and per-family reuse are RED on the
  maximum-document target. No current measurement observes the cold-path
  interaction p95 at all. `packages/desktop/test/e2e/critic-markup-perf.spec.ts`
  is a P11 measurement no manifest row names; it is bound or deleted.
- **G24 A green closure CI is not reproducible.** Section 7 requires compact
  candidate, platform, and closure records to be retained. Retention closes when
  a target reconstructs the attestation of a completed closure run from the
  retained records alone, without the original workspace.
The P10 executable proofs stay RED until all of these hold:

- the Electron distribution, native headers, and every advertised-architecture
  import library are authenticated;
- electron-builder and `@electron/get` cannot fall back to a remote checksum
  authority;
- every postinstall and packaging rebuild routes through the authenticated
  authority;
- `npmRebuild: false` is required semantically;
- package-manager resolution is authenticated for nested lifecycle scripts;
- ambient `gh` is replaced by a bounded authenticated API client;
- the exact Node runtime is bound;
- stale browser-server reuse is forbidden and CI mode is required;
- every workflow and composite-action command body is structurally bound;
- the exact executed environment is sanitized and recorded; and
- the stale runner-label proof is updated.

### Order of work

Six orderings are real dependencies:

- G4 precedes G13, because a real-gesture selection target asserts positions the
  coordinate authority does not yet answer alone;
- G8 precedes G5 and G20, because the capability snapshot a predicate reads and
  the schema a codec derives are both published by the intent seam;
- G6 and G7 precede G9, because a mutation sweep over an environment-selected
  adapter or a second open path mutates something production does not run;
- the eight red acceptance targets precede G9, because a sweep cannot prove a
  target two-sided while its own baseline fails;
- G7 precedes G23, since a budget measured off the production open path proves
  nothing;
- G9 precedes any closure claim; and
- the W6 freeze is last, because every earlier fix invalidates it and only its
  evidence is retained.

Everything else may land in any order, consistent with section 6. W1 and W2
additionally lead by severity — a document-corrupting engine and an invocable
command that does nothing are shipping defects — and their targets are included
in the G9 sweep, never exempted from it.

- **W1** — exit: G1–G4 closed, each proved by real gestures.
- **W2** — exit: G5–G8 closed.
- **W3** — exit: G13 repaired, G6 and G7 landed, every named target passing its
  own baseline, and G9 passing over all of them. No later workstream may be
  declared closed before G9 passes.
- **W4** — manifest rows land before the implementation work they gate. Exit:
  G14–G20 closed, and no section 8 claim lacks a manifest row.
- **W6** — after budgets are met and the P10 control plane closes, freeze:
  commit and push the exact candidate, run two sequential
  `evidence/0009/pass-*` tags, publish authenticated evidence, and create the
  atomic three-document closure child with GREEN final-closure CI.

Workstreams order the work; phases order the evidence. Each gap's manifest row
names its owning phase, and a workstream exit is a claim about behavior, never a
phase status. The whole sweep reruns after the freeze.

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
physical-work counter, stale log, hand-written result, manual check, production
branch selected by a test-mode environment variable, substituted sink, attribute
set only for tests, fixed sleep in place of a public barrier, run over a
changing tree, or claim resting on uncommitted work is not evidence. A focused
green run never changes a manifest status by itself. When a deepening replaces a
shallow module, the targets that reached past its interface are deleted, not
layered.

Two standing exceptions carry their own policy.

Native Comment context editing uses a layered proof: Playwright's Electron API
cannot select an OS-native context-menu row, the non-presenting three-platform
automation policy suppresses that popup, and a test-only `MenuItem` callback is
barred by this section and non-negotiable 11. A21 requires two targets, both
required evidence:

- a real right-click that arms one exact parser-owned target, then a real user
  keybinding that invokes the one-shot typed edit command twice and proves the
  consumed command cannot reopen either nested card; and
- a machine-owned real-Electron auxiliary target that instruments
  `Menu.prototype.append` from the test process, captures only the production
  Comment row, verifies it is an actual Electron `MenuItem`, invokes it, and
  restores the prototype.

Production exposes no observation hook.

Windows Heading 1–6 are unbound by default because `Ctrl+Alt+digit` aliases
AltGr on many layouts and `Ctrl+Shift+digit` yields no stable digit key. They
remain user-bindable; macOS and Linux retain their tested defaults; and this
exception creates no view-owned fallback shortcut.

## 6. Phases and manifest ownership

The manifests own every exact target, A01–A36 and D01–D11 mapping, status, and
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
| P8    | Review cards, drafts, CRUD, context identity, shared menu/user commands, navigation, pointer, and focus pass real events; localization passes its named presentation target. |
| P9    | The complete absence inventory has zero production, test, configuration, or document references.                                        |
| P11   | Responsiveness, maximum-document limits, cancellation, viewport, and reuse decision pass measured gates.                                |
| P10   | Two fresh clean-tree passes cover all required surfaces and three platforms.                                                            |

Later slices may land while dependencies are red; a phase turns green only when
its manifest target, requirements, and dependencies are green.

## 7. Evidence status

Exact commands and counts belong in test output and the evidence bundle, not a
progress diary.

Eight named acceptance targets failed, which is why their rows and phases are
red. Each has now been diagnosed as product-or-target on evidence, and the split
is four to four — a red row carries no information about which, so neither
answer may be assumed.

Four were stale targets and are repaired and passing: A08 asserted a machine
token A26 forbids rendering; A18 drove an unbound-by-default Review command
without seeding a keybinding; A19 resolved a drag's end needle globally, so an
earlier occurrence inverted the gesture; A20 measured a pointer target without
revealing it; A28 asserted sink security as a byte blacklist that rejected the
escaped output sanitization produces. In every case the product was correct and
the target had never reached the behavior its row claims.

All three product defects are closed. A22 was understated: Review card text was
not merely projection-dependent but wrong, because marked-projection model
offsets were sliced out of whichever projection was mounted. Under `original`
the addition card read `" remo"` and the deletion card `"ed hi o"` — unrelated
characters, not a shortened answer. Card content and anchor text now come from
the parser-issued source range, which is projection-independent by construction.
A17 and P8 — a Review sidebar command leaving the document byte-identical — are
closed below.

A07 was diagnosed as a product defect and was not one. Autosave never wrote
typed text to disk because it was never enabled: `MenuItem.click()` performs
Electron's own checkbox toggle, and the harness set `checked` beforehand as
well, so every click that appeared to enable autosave disabled it. The
observation was accurate — typed text really was absent from disk — and the
inference from it was wrong, which is the failure mode this split exists to
catch. The final tally is five stale targets against three product defects.

A17 and P8 are **closed**. Removing a Comment restores a document to the bytes
it was opened with, so its content-addressed dirty flag goes false while its
head identity has moved past the saved revision. The renderer's history-state
codec cross-checked the two — `dirty === (headIdentity !== savedIdentity)` — and
rejected that legitimate publication as invalid. The failure then vanished
without trace: `applyMounted` re-attached the previous head, the rethrown error
was swallowed by the sidebar's fire-and-forget dispatch, and the user saw a
Review command that did nothing and reported nothing. Dirtiness has been
content-addressed since saved identity became so (G2), and identity deliberately
stays stable across undo/redo, so the two are independent by construction and
must not be cross-checked.

Two things this cost, worth keeping. The defect was invisible to every
in-process test because it lives in the renderer's mounting of a *main-owned*
publication; a real `DocumentEditorHost` over a local session removes the same
Comment correctly, which is why it took an instrumented Electron probe to find.
And the reason it was silent rather than merely wrong is now fixed separately:
the sidebar observed its dispatch with a single fulfilment arm, so a rejected
command left the boundary without ever reaching the code that tells the user.
Refusals that return `false` were always reported; only rejections escaped.

The guard that authenticates a card against its revision must stay. Node ids are
positional counters minted in parse order (`p1:1`, `p1:2`, … —
`packages/document-core/src/internal/profile1/syntaxIdentity.ts:91`), so the
same id denotes a different node after any revision, and authenticating a Review
command by node id alone would resolve a stale card onto whatever now occupies
that slot and silently remove the wrong annotation. A mutation proof in
`packages/desktop/test/unit/specs/critic-markup-remove-annotation.spec.ts` pins
this: deleting the stamp check turns the refusal test red and leaves the rest
green.

P11 is **UNPROVEN** until the frozen tree passes its section 6 outcome against
the unchanged section 3 budgets.

P10 is **UNPROVEN** until its section 6 outcome is met from the frozen pushed
source candidate: the exact workflow and tag ref authenticated, every command,
report, and artifact cross-bound in the bundle that attests them, exactly one
closure parent, durable compact candidate/platform/closure records, two
independently prepared clean passes over independent installed artifacts, and
first-attempt macOS arm64, Windows x64, and Linux x64 records.

## 8. Definition of done

Done means all of these are simultaneously true:

- every section 2 module owns its concern alone, and every section 2
  non-negotiable is true of shipped production behavior;
- real MarkText gestures provide exact source, selection, rejection, visible
  state, one-step undo/redo, save, reopen, and crash behavior;
- every applicable Profile 1 kind is exact in every non-negotiable 8 sink,
  including hostile input;
- every gap in section 4 is closed, and every manifest row and phase dependency is
  green; and
- P9, P11, and P10 have met their section 6 outcomes under the section 7
  conditions.

Anything section 5 rules out as evidence — plus a timeout, stale build,
unavailable platform, uncaptured installed flow, or dirty collector run — is
**UNPROVEN**. Until every item above has current evidence, this plan remains RED.
