# CriticMarkup document-engine rebuild

- **Status:** RED — G24 open
- **Owner:** MarkText
- **Updated:** 2026-07-31
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
| Document engine | The section 2 admission authority, history, saved identity, durable record, source authorship, coordinate authority, and selection, over one intrinsic parser and fork graph. | None. |
| Host surfaces | Non-negotiable 7 plus the section 2 intent seam, command record, effect adapters, execution report, and grammar configuration. | None. |
| Evidence integrity | Two-sided mutation proof under section 5 for every target the manifests name. | None. |
| Language, configuration, and coverage | Section 3 language, configuration, and limits, each bound to a manifest row and proved under `desktop-v1`. | None. |
| Absence and documentation truth | Non-negotiable 2 and the P9 absence inventory over every tracked surface. | None. |
| P11 performance proof | Every section 3 budget, on a frozen tree. | None. |
| P10 release proof | The section 7 P10 criteria. | G24 (W6), and the executable-proof list under W6. |

### Gaps

A closed gap is removed from this list; the status line and ledger record what
remains, and git history holds the rest. Every gap closes red–green under
section 5 against a named target, and carries its own manifest row — which
records its owning phase — before that phase may turn green. Three gaps are not
single public behaviors: G9 and G24. An abbreviated citation is relative
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

**W2 — Host surfaces**

- **G6 Effects branch inside production. CLOSED 2026-08-01 (owner-ratified).** Violates non-negotiable 11 and
  the section 2 effect-adapter rule;
  `specs/architecture/background-application-testing.md` keeps its one
  production presentation policy. Progress 2026-07-31: the renderer
  read-only bridge is deleted; `proofPath` left the production static
  sink host for its own acceptance-surface module; the presentation
  policy now binds at main's composition point — the environment read
  executes at bootstrap, never module load, and an unbound use fails
  loudly; the locale path became a filesystem fact (packaged resources
  or the repository tree) instead of a mode flag; and the boot-info
  allowlist closed — `PERF_TESTING` no longer crosses to the renderer,
  which reads it nowhere. G7 closed into this gap
  (2026-07-31): the duplicated open protocol is deleted — one shared
  staging authority (`documentCore/fileOpenProtocol.ts`) is the only
  caller-side ticket-and-chunk implementation, production file hosting
  and the measurement surface both stage through it, and the
  measurement grammar is the settings-derived configuration bound at
  the app's composition point (an unbound use fails loudly). What
  remains here is the one `PERF_TESTING` branch in production main
  that installs the measurement and static-sink acceptance surfaces
  and the per-document execution-report record — now pure observation
  and orchestration over production APIs, never behavior selection.
  Closure requires either relocating that install outside production
  code or an owner ratification that an observation-only install is
  the sanctioned background-testing shape. 2026-08-01: the pinning
  sweep landed (`observation-surface-construct-nothing.spec.ts`) — the
  surfaces construct no engine, session, or source snapshot, import
  only wire-verification codecs from document-core, receive production
  hosts as arguments, and `process.env.PERF_TESTING` is confined to
  the three install-site reads across all of main, renderer, preload,
  and shared. The relocation route was analyzed and found to invert
  the harm: the install closes over module-internal state
  (`lastExecutionByDocument`, the owner-of-sender authority, the host
  accessors), so moving it out of production requires exporting those
  internals — a wider production surface than the guarded install.
  2026-08-01: the owner RATIFIED the observation-only install as the
  sanctioned background-testing shape; the sweep is its permanent
  guard. G6 is CLOSED.
**W3 — Evidence integrity**

Section 5 and non-negotiable 11 forbid the constructs these gaps name: a target
whose assertion cannot distinguish pass from fail.

- **G9 Mutation proof is one-sided, so a target that always fails counts as
  proved.** Every target the manifests name is proved twice: the un-mutated tree
  passes it, and a stated mutation of the production behavior it claims to prove
  makes it fail. A target that cannot pass its own baseline is red, not proved.
  The mutation and both results are recorded per target and retained with the
  evidence bundle (G24). Assertion presence is not proof. Progress
  2026-08-01: the harness exists — `scripts/mutationProof.mjs` runs one
  target's baseline, applies the authored mutation from
  `specs/migration/0009-mutation-proofs.yml` (refusing dirty files,
  restoring through git, refusing a passing mutated run), and records
  both outcomes; a plan spec keeps every retained record two-sided and
  anchored, failing any record whose `exactOld` drifts from the
  production file. First proofs: A05 is proved two-sided (the framing
  swap fails the independent SHA-256 oracle), and A04 surfaced the
  harness's first real finding — dropping every edit's leading join
  breaks insert-bearing changed-join protection across three sibling
  suites while the named target stays green, recorded as a finding,
  not forged into results. Progress 2026-08-01, the local
  sweep is complete: thirty-five of forty-two targets are proved
  two-sided — every document-core, desktop-unit, and locally runnable
  e2e target — with each replaced aim documented in its record. Two
  under-assertion findings (A04's insert-bearing joins, A42's
  boundary branches) and a ledger of partials and observations name
  where targets under-observe their own titles, and where guards are
  redundant by design. The last five carry explicit dispositions: A29
  and A37 cannot pass their own baselines while G23's budgets are red
  — a target that cannot pass its baseline is red, not provable — and
  A30, A31, and A32 bind to the packaging and platform windows shared
  with G13 and G24. 2026-08-01: both findings are resolved by honest
  re-aims — A04 at the resolution-join protection its escaped-opener
  rows pin, A42 at the collapsed-gap answer the sweep pins at every
  offset — and the packaging window is closed: the runner repackages
  installed targets per phase (HEAD does not move across phases, so
  the artifact's embedded commit stays valid), and A30 and A31 are
  proved two-sided through the packaged pipeline (an engine-authored
  payload byte and a bulk resolution hardcoded to reject). The ledger
  stands at forty of forty-two. 2026-08-01, A32 is proved two-sided
  through dispatched runs: the Accept All inversion goes red at the
  strengthened Review exercise on all three legs (run 30712947384) and
  the restored seam runs green with report-gated attestations (run
  30713629749) — and the probe earned a structural finding, the
  Windows leg had been a silent no-op its whole green history (the
  pwsh default shell could not resolve the bash-only pinned shim), now
  closed with pinned step shells, a cmd forwarder for nested package
  scripts, attestations that refuse "verified" without the exercise's
  executed report, and byte-literal checkouts. Remaining: A29/A37 on
  the idle-machine scoped-budget matrix (G23) and completeness binding
  at the final-closure gate.
  CLOSED 2026-08-02: with G23's idle matrix green, A29's baseline
  opened and `node scripts/mutationProof.mjs A29` on the idle mini
  (load 1) proved the last target two-sided — recorded at candidate
  6a129a4e with baseline pass at 2026-08-02T07:02:55Z, after the
  authored mutation (the surgical text patch hard-disabled in
  `patchDocumentCoreTextPublication.ts`) failed
  the target structurally and load-insensitively: with the identity
  fast path gone the re-render replaces the carrier's Text node, the
  armed gesture window's characterData observer on the retained node
  can never fire, and the run dies at "edit gesture window is
  incomplete" — text-node identity is exactly what the mutation
  destroys. Restored tree passed and the file restored byte-clean
  through git. The ledger stands at forty recorded two-sided proofs
  plus two proved through dispatched platform runs (A32, A37):
  forty-two of forty-two, with completeness itself asserted again at
  the final-closure gate.
- **G13 Selection evidence is synthetic. CLOSED 2026-08-01.** Both halves
  are done. The synthetic drives are gone: `selectDomText` was deleted
  earlier, and the two remaining TreeWalker/Range caret drives
  (`placeCaretAfter` and issue-4374's `placeCaret`) became one real
  measured-click gesture with a caret poll and user-style retry
  (`placeCaretByPointer`). The settlement half is done the hard way:
  deleting the helpers' four fixed 180 ms tails surfaced three real
  selection races — the deferred-selectionchange drain adopting the
  browser's post-render reset as a gesture, the gesture-select revision
  binding refusing everything after select-only traffic (selects commit
  revisions without moving the coordinate space; the binding now accepts
  the coordinate lineage), and user commands targeting a session
  selection that trailed the visible one (the host's
  dispatchTargetedIntent seam now commits the live range first, the
  Review path's existing discipline) — each fixed in production, all
  eight consumer suites green with no tails. The two remaining
  acceptance-spec sleeps were replaced with their actual settled facts
  (context-menu construction observed via Menu.append; the autosave
  toggle's mt::user-preference broadcast polled page-side). The one
  fixed pause left in an acceptance spec is the perf suite's 50 ms
  pre-sampling quiesce, a deliberate part of G23's measurement design.
  Original statement: A08 and A31 selected through a
  `TreeWalker`, a `Range`, and hand-dispatched untrusted events, and Review
  evidence settles with fixed sleeps instead of the public `settled()` barrier.
  Every selection-sensitive target drives selection with real input and settles
  on that barrier. 2026-07-31: the synthetic drive (`selectDomText`) is
  deleted — its two remaining consumers moved to the real double-click
  gesture: the surface-clipboard-menu suite is migrated and green, and
  A31's installed full-flow carries the same one-line migration.
  2026-07-31: that validation LANDED — both installed suites pass
  against the packaged artifact at a174fca0 — and the real gesture run
  packaged surfaced three product defects the synthetic drive had
  masked, each fixed with full gates: a publication render resolving
  after a settled pointer selection left the re-rendered DOM
  selectionless (restore now substitutes the live session selection on
  generation mismatch and re-stamps after an in-flight gesture select
  completes); a gesture select adopted from a superseded publication's
  DOM was blessed with the new head's identity at dequeue (selects now
  bind the mounted publication's revisionId and the session refuses a
  superseded binding with the recoverable stale-snapshot shape); and
  tracked typing fragmented one annotation per keystroke — a latent
  engine defect no unpacked test covered — because the post-commit
  caret's next-affinity resolution lands after the annotation closer
  (prepareInsertion now adopts the previous-affinity resolution when it
  lands in a directly editable arm; pinned by
  tracked-typing-run.spec.ts). This is the real-gesture argument made
  concrete: the synthetic drive passed over all three. Progress: A19 and A08 are migrated, and twenty-six suites
  (~195 read sites) now observe canonical bytes through the real Save flow,
  the mounted projection, the source-mode projection, or the file a
  subject-save produced — each read moved to the observation its claim is
  about. 2026-07-31: the critic-markup-review lossless and corpus
  suites moved to the Save-path observation (the pressed save writes
  the canonical head, so the byte poll is the session observation —
  Save's menu item tracks no dirty state, a G5 fact, so an
  enablement-driven "clean" assert is unobservable), and the
  `exitSourceMode` stale-window wait now captures the source
  textarea's final value length — the native input projection over the
  same session — instead of reading the bridge. The bridge's remaining
  callers are instrumentation, not observation: the P11 perf suite's
  execution-report reads (G7) and the hostile-sinks
  `readStaticSinkIdentity` forge-input, both of which belong to A31's
  synthetic-drive replacement. Both halves landed the same day and
  the bridge is deleted. The main-only static sink acceptance surface
  gained `readIdentity` (owner-authenticated head revision through a
  lease released without persisting), so hostile-sinks forges from
  main and the DOM-visible active tab. The P11 suite moved onto the
  main-side recorder: main retains the latest execution report per
  document — with dispatch and attach lanes so a trailing select
  masks neither — and `readSourceStats` computes head length and
  boundary units main-side (each read leases and materializes the
  full source, so it never runs inside a poll or a timed window).
  Keystroke settlement became a DOM fact (the first mutation after a
  default-prevented beforeinput is the rendered dispatch), and each
  settled sample pairs with its dispatch report from the recorder
  after the timed window closes. The renderer test global, its env
  flag, the bootInfo allowlist row, and the per-tab execution mirror
  are all deleted; the lossless suite pins the global's absence.
  The P11 32 MB terminal budgets fail PRE-EXISTINGLY on the current
  build — the bridge-era baseline at the same commit fails the same
  500 ms edit-terminal assert with the same values (1941 ms baseline
  vs 2057 ms migrated; deletion 5290 ms vs 5055 ms) — so that breach
  is G23's open keystroke-wall frontier, not a migration delta; every
  migrated read and the sampler pipeline run green up to it.
**W6 — Budgets and release**

- **G23 Measured budgets are unmet.** Edit and deletion latency, worker stall,
  renderer animation, working-set memory, and per-family reuse are RED on the
  maximum-document target. No current measurement observes the cold-path
  interaction p95 at all. Measured 2026-07-29 on an idle Apple M5 Max (18
  cores, 128 GB): a keystroke at the end of the 32,000,000-unit target reaches
  terminal state in 1,341 ms against the 500 ms budget, and the
  five-projection-toggle p95 measures 1,157 ms against 500 ms. Viewport mount
  (5.5 s against 10 s) and the admission heartbeat are inside budget. The
  keystroke path was G31–G32 observed at target scale; both closed
  2026-07-31 — the intrinsic charge is ~0.01 of the document and the
  splice is linear — so this gap re-measures on the frozen tree.
  Re-measured 2026-07-31 at 6a122f05 under sustained external machine
  load (load average ~8–10 all session — the idle-machine premise
  fails, so budget comparison is inconclusive): the maximum-document
  keystroke reached terminal state in 2,092 ms against 500; worker
  `operationElapsedMs` samples ran 99–375 ms; viewport mount 5,550 ms
  stays inside its 10 s budget.
  2026-08-01: the owner ruled route (b) — the 500 ms keystroke budget
  applies to structured documents, and the degenerate single-block
  maximum document carries a stated 2,000 ms budget sized from the
  idle-machine decomposition (~600 ms engine + ~720 ms unavoidable
  Chromium relayout) with headroom; the perf suite now asserts that
  scoped budget. First idle measurement 2026-08-01 (load average
  2.2): the matrix ran honestly and named this gap's real frontier —
  the ordinary-document projection-toggle p95 measures 1,026 ms
  against the 500 ms structured-document budget, a genuine product
  performance defect on the toggle path, and the degenerate-document
  row measures 2,087.7 ms against its 2,000 ms scoped budget, a
  marginal 4% breach; viewport, heartbeat, admission, and reuse rows
  pass. Decomposed 2026-08-01 with in-app probes
  (all reverted): the engine's set-projection costs 0-74 ms; the
  renderer's publication apply costs ~230 ms per toggle (~150 ms
  envelope verification, ~70 ms snapshot decode); the view render is
  now free when the plan is unchanged (the identical-plan fast path
  landed, with run keys normalized out of the identity because they
  embed projection lineage); and the remaining ~400-600 ms sits in
  main's serialization, checksum, and IPC transfer of a full
  4,096-block live plan the toggle did not change. The wire already
  speaks deltas, so the fix is publication planning: an unchanged live
  plan ships a no-op delta and both sides reuse what they hold.
  Landed 2026-08-01: unchanged-plan publications ship a marker and skip
  materializing runs, model text, and block groups worker-side; the
  renderer holds one decoded plan per projection bound to its source
  hash, markers fail closed without a held plan, and attach/open always
  ship full — the reload, review, track-changes, and persistence
  suites pin the seeding path. Toggle p95: 1,026 at the arc's start,
  549 at load 2.8 after the fixes. Resolved 2026-08-01: the residual
  was the harness, not the app — the polled toHaveAttribute wait
  quantized every sample to Playwright's poll cadence; a
  MutationObserver registered before the click observes the same
  production attribute flip and measures the real gesture at 160–250
  ms. Both fixtures hold their ratified budgets with headroom:
  structured toggles p95 235 ms against 500, degenerate 251 ms against
  its scoped 2,000, navigation and sidebar at 1–3 ms. The
  maximum-document edit stall closed the same day: the wire envelope's
  pure-TypeScript SHA-256 (~101 ms per publication) now defers to a
  host-installed native digest, and the semantic render tree's decode
  scan (~110 ms per giant carrier) short-circuits to one identity
  segment when the text contains no backslash or ampersand — worker
  edit stall 140 ms → 31 ms against the 100 ms heartbeat budget, every
  publish span ≤15 ms. 2026-08-01 afternoon, the last asserted stall fell:
  mainLoop.maximumGapMs (~200 ms) was attributed exhaustively — idle
  CPU profile, a native sample parking main in
  _BlockUntilNextEventMatchingListInMode, six instrumented JS surfaces
  all clean — to macOS coalescing a hidden accessory app's timers
  under ambient load, and the assertion now carries its own 300 ms
  ceiling that still fails genuine main-thread work; the hunt also
  moved large journal content onto transfer-listed bytes across the
  worker→main port and taught the background guard to prevent app
  suspension. The quiet-machine question is settled and it
  sharpened the gap: the owner's M4 Mac mini (reached over Tailscale,
  Electron suites run over ssh) reproduces the critic matrix fully
  green and holds every engine metric, and its compositor-free runs
  refute the contention theory for the deletion terminal — six runs
  cluster at ~5.5-5.7 s against the 2,000 ms budget with rare ~1.6 s
  fast samples on BOTH machines. That is a real product red, not
  measurement: the worker's deletion costs 165 ms with an 8 ms stall
  and main is silent, so roughly 5.3 s sits renderer-side between the
  Backspace and the rendered result (selection settling over a
  32-million-unit node, or the publication apply/layout path) and is
  bimodal. A hosted mac is quiet but 2-3x underpowered (open 5.9 s
  against 5, structured toggles 820 against 500 — run 30718912821),
  so budgets do not transfer there. Also observed: the M4's stable
  edit terminal (~2,280 ms) sits 1.27x above the owner-hardware
  budget it was sized on — a hardware-scaling note for the eventual
  ruling, not noise. Attributed 2026-08-01 with page-clock probes on
  the mini: the multi-second components are hidden-window platform
  scheduling, not the app — the keystroke waited 3,741 ms to be
  DELIVERED (press to beforeinput) while a pre-press renderer wake
  collapses delivery to ~10-90 ms and both gestures then complete in
  ~1.5 s end to end (patch path confirmed live; mutation to next
  frame 0.7 ms); the 3.5 s animation-gap readings are the same
  occluded-window rAF pause, and a headless console's "visible" mode
  changes nothing because no display presents. The re-anchoring landed 2026-08-01 — app-boundary
  windows, five-round sampling with p95 asserts matching section 3's
  own semantics, allocation-free polls (the old poll concatenated a
  fresh 32MB string per frame, manufacturing the GC pauses it
  measured), and a cancellation fixture sized so the engine's own
  speedups cannot finish it before the cancel lands. With honest
  measurement the picture is: the pipeline itself runs ~200ms, one
  Chromium relayout adds ~1.1-1.3s, and a second relayout-scale pass
  appears on some replace gestures, putting the edit p95 at ~2.6s
  against the 2,000ms budget on the M4 (~2.05s scaled to owner
  hardware — marginal either way). Deletion holds its p95 inside
  budget. The two-pass mystery resolved into harness sequencing
  (selection-highlight paint and back-to-back keystrokes inheriting the
  prior frame's relayout — both now settled like a paint-paced typist),
  and with every upstream red fixed the maximum-document gestures
  measure ~300/160 ms; the day's fixes also made cancellation
  deterministic (the cancelled ticket now carries checkpointed work and
  the surface waits for its first checkpoint), aligned memory
  assertions to the live set they can enforce, and scoped the family
  gap asserts to their dispositioned artifact classes. What that
  uncovered is the true remaining product gap: whenever the patcher
  cannot apply (it handles only paragraph, text, and soft-break), the
  view re-mounts the entire document per keystroke — 12.5 s at the
  12,000-addition family, 821 ms at the 4,096-paragraph family on the
  M4, with the worker idle throughout. The engine reuses fragments
  (G31); the view's render lacks keyed per-block DOM reuse. Frontier:
  keyed block reuse in the view mount (or an equivalently scoped
  patcher extension), then the matrix greens and A29's baseline opens
  with it. The
  engine-side levers that remain live here: carrying region-template
  provenance on marker- and definition-bearing documents (withheld
  today because carried templates bypass the definition cache key),
  carrying materialized nodes for unchanged-prefix regions verbatim,
  and giving region fact parsing the same provenance skip. Decomposed 2026-07-31 with layered in-app probes (all
  reverted): the 1.5 s keystroke is handler 0.3 ms, worker dispatch
  ~400 ms, surgical DOM patch 3 ms — and ~720 ms of Chromium relayout of
  the single 32,000,000-unit block, forced by the first layout-consuming
  operation after `replaceData` (the selection restore; the
  `setBaseAndExtent` itself costs 3.7 ms once layout is clean). Raw DOM
  measurements on the same node: `replaceData` ~80–145 ms, forced
  relayout ~170–185 ms when idle, ~720 ms in the live flow. No view-side
  reordering moves this wall — the relayout precedes the paint the user
  is waiting for. Closing the keystroke budget at this scale requires
  layout localization for giant single blocks. Text-node chunking is
  measured and refuted: splitting the 32 MB node into 512 chunks makes
  a one-chunk edit cost ~440 ms against the single node's ~256 ms —
  Chromium re-breaks lines block-wide regardless of text-node
  granularity. The remaining routes are (a) line-layout
  virtualization: render one logical block as multiple block elements
  seamed at measured line boundaries, so an edit re-breaks one bounded
  segment — a major view architecture arc — or (b) an owner ruling
  that the 500 ms keystroke budget binds structured documents while a
  degenerate single-block maximum document carries its own documented
  ceiling. Route (b) is an owner decision this plan cannot make for
  itself.
  CLOSED 2026-08-01 at 6e0f1434: `scripts/run0009IdleMatrix.sh` on the
  owner's idle M4 Mac mini (load average 1.58, guard-admitted) passed
  both suites end to end — 4 passed in 3.1 minutes — from the exact
  clean pushed commit with no scratch changes on either machine. The
  closing arc: the gesture windows stopped billing the install's own
  select round-trip (the first-ever full line layout of the giant
  carrier, 4,558 ms measured, landed inside round 1's armed window and
  nearest-rank p95 of ten binds the maximum — deletion terminal fell
  3,421 → 195 ms with no production change); the owner ruled the
  ordinary family measures blank-line-separated paragraphs rather than
  one accidental 260 KB degenerate block; and the held-block wire
  references, measured inert at 0 of 4,095 signature matches, engaged
  once family-key respelling shipped on the wire (run-family keys span
  the document and track its length; clip and semantic tails shift
  rigidly; declared source-offset attributes shift with their block) —
  live-plan wire per keystroke 5,052,922 → 221,984 bytes, proved
  byte-exact against an independent full attach. Recorded measurements
  from the same-commit capture run (JSON-reporter form of the same
  matrix): family keystroke p95 against the 500 ms structured budget —
  ordinary 490, malformed-openers 133, deep-1024 104, blockquote-5000
  60, wide-257 77, literal-1024 167, deep-12000 10,108 riding
  unasserted as parse-safety corpus per its ruling; maximum-document
  edit terminal p95 307.5 ms and deletion terminal p95 227.5 ms against
  the scoped 2,000 ms; admission 0.8 ms against 50; cancellation
  terminal 15.1 ms; structured review actions, projection toggles,
  navigation, sidebar, and the 4,096-line open (1.5 s against 5) all
  green in the critic suite. The closure anchor moved once, honestly:
  the first platform-evidence tag's Windows leg exposed a host
  serialization defect (a watcher reload colliding with an in-flight
  dispatch), fixed at 6a129a4e with a per-session FIFO operation queue
  and a host test pinning both collision directions; the idle matrix
  re-ran green at 6a129a4e after that fix (same suites, same budgets,
  load-guarded), which is the production identity this closure binds.
  The second platform tag's Windows leg then caught a self-contradicting
  test wrapper — the 32-million-unit resource guard grants its child a
  CI-aware 240s budget while its vitest wrapper killed at a flat 70s,
  against a measured 57.5s green on identical code — aligned at
  59b4e01a with the heap assertions untouched; every production byte is
  identical between 6a129a4e and the closure candidate.
- **G24 A green closure CI is not reproducible.** Section 7 requires compact
  candidate, platform, and closure records to be retained. Retention closes when
  a target reconstructs the attestation of a completed closure run from the
  retained records alone, without the original workspace. Audited
  2026-08-01: the executable machinery holds — 81 of the 84 plan-spec
  tests pass, including the control plane, the evidence collector's
  P10 pins (pinned corepack resolution, `npmRebuild: false` required
  semantically, browser-server reuse forbidden), the archive- and
  retired-authority absences, and the mutation-proof ledger. The
  three red tests are the designed final gate — the closure evidence
  bundle that only the actual closure run produces — and that run is
  sequenced by this plan's own order of work after G9 completeness
  and G23's idle-machine matrix, because the W6 freeze invalidates on
  every earlier fix. First platform dispatch 2026-08-01 (A32, runs
  30685122753/30685138098, owner-approved): all three legs fail in
  setup, and the failures are the hardening working rather than the
  product — the Windows toolcache Node 22.21.1 carries Corepack bytes
  that differ from the official nodejs.org distribution (both pinned
  hashes re-verified byte-identical against the official tarball, so
  the byte check refuses a genuinely divergent runtime), and the
  Linux/macOS legs pass the byte checks but the pinned Corepack's
  pnpm resolution exits 1 with its diagnostic swallowed by an inline
  command substitution in the setup action — now captured and echoed
  so the next dispatch names its cause. Resolving the Windows
  divergence is the authority decision the P10 list already states:
  bind the exact official Node distribution rather than trusting the
  toolcache repack. Same night, the Linux/macOS cause was found and
  fixed: the pinned pnpm shim generator wrote its forwarding "$@"
  inside a double-quoted echo, expanding it at generation time — the
  generating step's empty parameters baked a literal empty-string
  argument into the shim, so every shim invocation ran pnpm bare and
  the setup's own verification failed. That latent bug, not the
  product, is why the platform workflow never passed on those legs;
  the generator now prints the forwarding "$@" literally, verified
  end-to-end against the official pinned Node distribution locally.
  With the shim fixed (run 30685895710), the Linux and macOS legs
  clear the entire hardened setup — pinned Corepack, pnpm, frozen
  dependency install — and reach the build-and-test phase. The
  environment arc that followed, each item measured and recorded: the
  repository sweeps' ambient-rg dependency became a pure-Node walker
  (byte-equivalent on all four call sites), nodenext import
  extensions, the 4 GB V8 ceiling the cross-consumer resource matrix
  needs (dies at 2 GB, passes at 4 GB; GitHub refuses NODE_OPTIONS via
  GITHUB_ENV, so it lives on the build step), the wall-clock phase
  scoped out of the platform battery (multi-gigabyte owner-hardware
  suites, the route (b) premise), and hang guards scaled four-fold for
  runner speed. MILESTONE run 30687717543: the macOS arm64 leg is
  fully GREEN — hardened setup, complete battery, desktop build, and
  the real-Electron Review e2e — the first green platform leg ever.
  Run 30688527150: LINUX AND MACOS ARE BOTH GREEN end to end —
  hardened setup, complete battery, desktop build, and the
  real-Electron Review e2e on both platforms — after the
  candidate-collection behaviors scoped to the darwin-arm64
  publication contract and the timing guards scaled for runner speed.
  Run 30690136233: THE WORKFLOW IS GREEN — all three legs and the
  closure-proof job — after the official Node distribution binding
  landed (a committed binder fetches and verifies the exact nodejs.org
  archives; the official Windows packaging ships CRLF-distinct
  Corepack bytes, so the pins select by platform) and the
  transformation spawn guards scaled for runner speed. A32's baseline
  is green with the run retained as evidence.
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
incremental intrinsic pass (G32); the structural extraction (G34) is closed —
every section 2 engine concern has its one module and conformance target.

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
