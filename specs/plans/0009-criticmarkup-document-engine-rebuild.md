# CriticMarkup document-engine rebuild

- **Status:** RED — G6–G9, G13, G19, G23, G24, G32, G34 open;
  G5 partial
- **Owner:** MarkText
- **Updated:** 2026-07-30
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
| Document engine | The section 2 admission authority, history, saved identity, durable record, source authorship, coordinate authority, and selection, over one intrinsic parser and fork graph. | G32, G34 (W1) |
| Host surfaces | Non-negotiable 7 plus the section 2 intent seam, command record, effect adapters, execution report, and grammar configuration. | G5 (visible half done), G6–G8, G39 (W2) |
| Evidence integrity | Two-sided mutation proof under section 5 for every target the manifests name. | G9, G13 (W3) |
| Language, configuration, and coverage | Section 3 language, configuration, and limits, each bound to a manifest row and proved under `desktop-v1`. | G19 (W4) |
| Absence and documentation truth | Non-negotiable 2 and the P9 absence inventory over every tracked surface. | None. |
| P11 performance proof | Every section 3 budget, on a frozen tree. | G23 (W6), blocked by G32 |
| P10 release proof | The section 7 P10 criteria. | G24 (W6), and the executable-proof list under W6. |

### Gaps

A closed gap is removed from this list; the status line and ledger record what
remains, and git history holds the rest. Every gap closes red–green under
section 5 against a named target, and carries its own manifest row — which
records its owning phase — before that phase may turn green. Three gaps are not
single public behaviors: G9, G24, and G34. An abbreviated citation is relative
to `packages/document-core/src` in W1, W3, and W4, and to
`packages/desktop/src` in W2 and W6.

G29–G40 entered this ledger on 2026-07-29 from a fresh-eyes audit of the
branch against this plan and the vision, each carrying evidence reproduced
against a fresh build; G27, G29–G31, G33, and G35–G40 closed red–green
within two days (G38 by ratifying the introduced-BOM encoding as Profile 1
E4/D9; G40 by emitting line, content, and info extents the conversions now
consume, deleting every worker recognizer, dropping the renderer's bundled
Markdown grammar, and widening the sweep — probes spelled as shipped,
document-core in scope, constructed expressions detected — with a mutation
proof that a planted recognizer turns it red; G31 by digest keys with a
64 MiB total / 4 MiB per-entry retention split plus sub-block reuse:
closed top-level list items and blockquote segments are retained as
templates and grafted on identical windows, measured at 3,999 of 4,000
items or segments reused per keystroke, with a monolithic single block —
one unbroken multi-thousand-line paragraph, quoted or not — remaining one
emission unit by the block-granular design), and git history holds their
diagnoses. Severity in a gap's title is rated against the vision:
critical defeats a principle outright or destroys the author's bytes; high
makes the north star unreachable or breaks a principle on an ordinary path.
One audit finding was rejected rather than recorded: hand-typed CriticMarkup
delimiters in Markup mode are encoded (`{++new++` + `}` commits `{++new++\}`),
which ADR-0015 ratifies — projected text is encoded faithfully; source bytes
are transcribed exactly. Its real residue is G36.

**W1 — Document engine**

- **G32 [critical] The intrinsic pass re-reads the entire document on every
  keystroke.** `intrinsicSourceUnits ÷ document length = 1.000` at every
  measured size — "unchanged text is parsed once" fails at ordinary sizes,
  and G23's measured keystroke number is this gap observed at target scale.
  Progress 2026-07-29: the safe-point computation was O(transitions × lines)
  and alone cost a fifth of every reopen; indexed, a 135 KB reopen fell from
  ~149 ms to ~97 ms, and the remaining profile is flat across the intrinsic
  pipeline (lane state, tape scan, identity emission, fork graph) — the
  genuinely architectural O(document) work. Closure: the intrinsic pass
  reuses a settled prefix, re-scans only from the last safe point before an
  edit to the first reconvergent safe point after it, and re-bases the
  suffix — invalidated whole by the non-local re-key classes (reference
  definitions, unclosed fences). The safe-point primitive exists
  (`safePoints.ts`); the convergence contract and artifact splicing across
  tape, decisions, lane, forks, identity, and provenance are the work.

- **G34 [high] Section 2 modules are missing or partial.** The
  persistence lease now carries `installed(lease)`
  (`DocumentSession.installed`, `persistence-installed.spec.ts`):
  durability is proven against the held lease — authenticated, owned, and
  unreleased — with the leased revision's identity resolved by the
  session, and the desktop worker's save flow confirms through the lease
  instead of a worker-side identity capture; recovery and sidecar-restore
  remain the two identity-replay callers of `markPersisted`. The grammar
  configuration module now carries its named members
  (`documentParseConfigurationFor(settings)` as the sole main-owned
  construction site and `decodeDocumentParseConfiguration(unknown)` at the
  worker's wire intake); the Selection module now
  exists (`internal/session/selectionAuthority.ts`) with the public
  `DocumentSession.settled()` barrier over the session mailbox
  (`selection-authority.spec.ts`), and the view now chains onto it: the
  session barrier crosses the wire (`await-settled` worker command, host
  member, typed IPC channel), the renderer session exposes `settled()`
  over that channel, and the view's `settled()` drains only its
  not-yet-dispatched input chains before awaiting the session barrier —
  the source-mode controller drains its queued operations and then
  awaits the same barrier, so no surface owns a second settlement
  notion; G13's first migration is landed: the A19 gesture spec reads
  canonical bytes through the real Save flow instead of the read-only
  bridge, settles selections by observation instead of a fixed sleep, and
  in doing so surfaced and fixed three real selection-integrity races the
  sleep had been masking — focus restoration and publication restores
  stamping the session's older selection over a newer user gesture, and
  authoring commands capturing their target before the last selection
  report landed. The A08 interaction ladder is migrated the same way, and
  that migration forced the selection-generation design to its settled
  form: the generation advances exactly when the view adopts a browser
  selection that diverges from the session's (at the synchronize and
  commit-selection dispatch sites), never on raw selectionchange arrival,
  because an arrival may be the view's own render or restore echo and an
  echo-driven bump made an edit cycle's own authoritative restore stand
  down; an IME composition window defers selection reads while the
  browser owns the draft DOM (insertCompositionText is not cancelable);
  and a deferred selection is adopted at flush only if the live selection
  still sits on the exact recorded DOM positions — otherwise the queued
  input's publication replaced what the read named, and the flush
  re-stamps the session-authoritative selection instead of adopting
  repaint debris. The migration's shared reader
  (`expectCanonicalOnDisk` in the e2e module) now also covers the
  comment-crud, review-workflow, and review-command-surfaces specs, and
  running five migrated specs in parallel amplified three more
  production races the bridge had hidden: a select refused for a
  superseded base snapshot was swallowed and left the session behind
  the browser selection (the command boundary now retries recoverable
  refusals through the settlement barrier and re-reads the live
  selection); an IME composition's trailing normalization was adopted
  as a gesture (the composition-settling window now classifies it as
  debris); and a command's editor-focus restored the session's lagging
  selection over a still-adopting gesture, contracting it by however
  many adoption reports were in flight — `focus()` now stands down
  whenever a live browser selection is mounted, the section 2 rule
  applied to presentation. The remaining A31 target and the bridge's
  deletion (G6) follow the same pattern.
  `internal/sourceAuthorship.ts` now owns marker composition, the escape
  rule, and the section 2 protect drafting in one module — the unary,
  substitution, comment, and comment-pair composers beside
  `buildSourceCandidateDraft` and `protectSourceCandidateDraft`, with the
  kernel, the worker, and admission all routing through them and no
  caller spelling a marker or wiring the escape inline, and the Track
  Changes carrier decision derived there too — the carrier policy, the
  deepest-carrier rule, and the carrier escape wiring moved out of the
  worker, whose residue is the per-intent choice among authored forms — and the execution counter bank is
  fully engine-owned: line-materialization walks record through the
  recorder each line path captures at construction, long-line retention
  is proven bounded from retained/evicted counters instead of a cache
  seam, AST-template constructions joined the recorder, and the
  projected-text reference-definition index builder proved dead and was
  deleted — no `__` counter seam remains in the parser. The line
  memoization itself stays module-level by design: identity-keyed
  (entries can never serve another engine), leak-free short paths in a
  WeakMap, and a four-entry LRU for long lines. The concerns are answered today inside
  `revisionWorker.ts` and its callers. Progress: the admission authority
  exists (`internal/session/admissionAuthority.ts`):
  `admit(base, edits, class)` owns edit validation, resource limits, join
  protection, inverse derivation, and the postcondition proof, returns
  `Admitted | Rejected` values with one named rejection class, and is the
  only production caller of the engine's `reopen`
  (`admission-authority.spec.ts` sweeps for a second caller); the worker
  maps rejections onto its intent boundary and keeps identity minting. The
  physical execution report is engine-owned (`physicalTraversalAccounting.ts` is
  `createPhysicalTraversalRecorderV1`, no counter bank, no reset seam):
  every counter lives on the recorder an engine creates for itself and
  threads through the intrinsic pass, the fork parser, and comment-display
  preparation, so parse products attribute later work to the engine that
  parsed them; `LanguageEngine.traversalCounts()` and
  `DocumentSession.physicalWork()` are the ordinary members hosts and
  targets read, and the desktop worker takes operation deltas from the
  session record (`physical-work-attribution.spec.ts`). The
  saved-identity module exists (`internal/session/savedIdentityLedger.ts`)
  — minting, validation, the content-addressed dirty comparison, and
  persistence acceptance in one owner, identities transported opaquely —
  and the History module exists (`internal/session/historyRecord.ts`):
  entries, the cursor, the typed-run coalescing rule, compaction, and the
  exhaustion states in one owner, with `undo()` and `redo()` handing the
  named `Replay` — the exact edit set plus the exact selections to
  restore, direction resolved inside History so no caller re-derives
  edits — confirmed at commit so a rejected replay never desynchronizes
  the cursor, and History reporting outcomes the worker maps onto the
  ledger — it never mints saved identity. Not one behavior: closure is the remaining
  section 2 extraction, landed green-to-green with
  interface-conformance targets per module.

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
- **G39 [high] The view predicts model positions and submits them.** During a
  typing burst the view chains a draft target from hard-coded widths —
  `+data.length`, `+2` for a paragraph break, `+1` for a line break
  (`packages/document-view/src/documentCore/documentCoreView.ts:3907-3950`).
  Measured: the engine moves the caret by 4 after a paragraph break on a CRLF
  document, so the next burst keystroke aims two units short; a CR document
  and LF document move by 2. The section 2 Selection rule says the view
  reports gestures and never computes a position it then submits. Closure:
  a queued browser input resolves its target from the session's settled
  selection at dequeue time; the width table is deleted.

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


- **G19 Consumer policy declares what production routes around.** The live
  editor sink now reads its plan through `routeLiveConsumer` at the worker's
  publication site, so that declared route is load-bearing. Three exported
  entry points still have no production caller — `viewLength`,
  `classifyPasteConsumer`, and `planReplaceConsumer` — while production
  classifies paste by hand
  (`packages/desktop/src/main/ipc/documentClipboardPaste.ts:73-77`) and
  routes replace elsewhere. Production routes those questions through the
  policy; deleting the declarations is rejected, because the module owns
  the per-kind sink exactness table (`PROFILE1_KIND_SINK_EXACTNESS`, A41).
**W6 — Budgets and release**

- **G23 Measured budgets are unmet.** Edit and deletion latency, worker stall,
  renderer animation, working-set memory, and per-family reuse are RED on the
  maximum-document target. No current measurement observes the cold-path
  interaction p95 at all. Measured 2026-07-29 on an idle Apple M5 Max (18
  cores, 128 GB): a keystroke at the end of the 32,000,000-unit target reaches
  terminal state in 1,341 ms against the 500 ms budget, and the
  five-projection-toggle p95 measures 1,157 ms against 500 ms. Viewport mount
  (5.5 s against 10 s) and the admission heartbeat are inside budget. The
  keystroke path is G31–G32 observed at target scale; this gap re-measures
  after they close.
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

These orderings are real dependencies:

- G4 preceded G13 and is closed (A42), because a real-gesture selection
  target asserts positions the
  coordinate authority does not yet answer alone;
- G8 precedes G5, because the capability snapshot a predicate reads is
  published by the intent seam;
- G6 and G7 precede G9, because a mutation sweep over an environment-selected
  adapter or a second open path mutates something production does not run;
- G32 precedes G23, because the keystroke budget fails on the path it owns,
  and G7 precedes G23, since a budget measured off the production open path
  proves nothing;
- G9 precedes any closure claim; and
- the W6 freeze is last, because every earlier fix invalidates it and only its
  evidence is retained.

Everything else may land in any order, consistent with section 6. W1 and W2
additionally lead by severity — a document-corrupting engine and an invocable
command that does nothing are shipping defects — and their targets are included
in the G9 sweep, never exempted from it. Within W1, the remaining work is the
incremental intrinsic pass (G32) and the structural extraction (G34).

- **W1** — exit: G4, G32, and G34 closed, each proved by real gestures.
- **W2** — exit: G5–G8 and G39 closed.
- **W3** — exit: G13 repaired, G6 and G7 landed, every named target passing
  its own baseline, and G9 passing over all of them. No later workstream may
  be declared closed before G9 passes.
- **W4** — manifest rows land before the implementation work they gate. Exit:
  G14–G19 closed, and no section 8 claim lacks a manifest row.
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

The manifests own every exact target, A01–A41 and D01–D11 mapping, status, and
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
progress diary. Resolved diagnoses live in git history; this section keeps
only what still binds future work.

The eight once-red acceptance targets are all resolved — final tally five
stale targets repaired against three product defects fixed. Two lessons from
that split remain binding. First, a red row carries no information about
whether the product or the target is wrong, so neither answer may be assumed
(A07's autosave "defect" was the harness toggling the checkbox off; A22's
card text was sliced from the wrong projection's offsets). Second, dirtiness
is content-addressed and head identity deliberately moves across undo/redo,
so `dirty` and `headIdentity !== savedIdentity` are independent by
construction and must never be cross-checked — that cross-check silently
broke a Review command (A17/P8), and the rejection-reporting hole that made
it silent is fixed separately.

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

The three final-closure targets are the P10 gate itself: they consume the
release evidence bundle (`specs/migration/0009-candidate-evidence.yml`, kept
out of the tree by design) that can only exist after the freeze, so running
them in candidate state is a category error, not a red signal. Candidate
suites (`test`, `test:platform`, and both `check` scripts) exclude exactly that
one spec; the gate runs through the dedicated `test:closure` entry at closure
time, and the evidence collector pins this split so it cannot silently widen.

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
