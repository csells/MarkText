# CriticMarkup document-engine rebuild

- **Status:** RED — G6–G9, G13, G19, G23, G24, G32 open;
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
| Document engine | The section 2 admission authority, history, saved identity, durable record, source authorship, coordinate authority, and selection, over one intrinsic parser and fork graph. | G32 (W1) |
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
  definitions, unclosed fences). Progress 2026-07-30: the splice landed
  for its first guard class (`internal/profile1/intrinsicPassSplice.ts`):
  the parse retains its intrinsic facts per revision, a reopen whose
  edits sit in an end-of-document bracket re-scans only that window and
  splices tape, line facts, and a per-safe-segment fork lane around it —
  segmented precisely so downstream regionization keeps the fragment
  reuse G31 proved. A one-character reopen at sixty paragraphs now costs
  under a quarter of the document and stops scaling with untouched prose
  (`incremental-intrinsic-pass.spec.ts`), and the spliced revision is
  deeply indistinguishable from a full parse across five edit shapes and
  three sizes with a marker fallback
  (`incremental-equivalence.spec.ts`). The guards refuse everything
  else: marker-bearing documents, literals, reference definitions,
  interior brackets, and non-clean lane shapes all take the full pass.
  Interior brackets, literal-bearing regions, CRLF spellings, and the
  marker-bearing class landed with their equivalence rows — a reopen on
  a Review document whose nodes sit clear of the edit bracket replays
  the retained forest, shifts the fork branches, and re-scans only the
  bracket; degraded parses and nesting past sixty-four refuse.
  Measured 2026-07-30 after the marker route: the per-keystroke
  intrinsic charge is ~0.01 of the document (the pinned target), but
  wall time still tracks the document — ~18 ms at 30 KB, ~200 ms at
  300 KB, ~3.4 s at 3 MB — because the downstream per-reopen stages
  remain O(document). Profiled 2026-07-30 at ~340 KB: fork-AST emission
  is 65% of the keystroke (407 of 622 ms over three keystrokes), then
  graph-core validation (26 ms) and projection preparation (21 ms);
  materialization and finalization are negligible. Emission re-derives
  every region and hashes its exact bytes per keystroke even when the
  region cache hits. Closing G23's keystroke budget starts there: the
  spliced fork graph knows which regions the edit never touched, so
  emission can carry the prior revision's region ASTs by provenance
  instead of re-hashing the whole document to rediscover them. Landed
  2026-07-30 for the coinciding-projections case: the emission keeps a
  per-cache region-template index, splice provenance consults it for
  unchanged and shifted regions — no slice, no key, no digest, counted
  by `forkAstRegionProvenanceReuses` — and every keystroke on an
  eligible document carries all of its untouched regions this way.
  Re-profiled after: the keystroke's residual cost is region fact
  parsing, template re-materialization, and projection preparation —
  the next levers are carrying materialized nodes for unchanged-prefix
  regions verbatim and giving fact parsing the same provenance skip.
  Located and fixed 2026-07-31: the splice itself was quadratic — the
  per-safe-segment synthesis filtered the whole tape, line list, and
  literal list for every segment, so a two-keystroke reopen at 16,000
  paragraphs spent 12.2 of 13.0 s partitioning already-ordered facts.
  Advancing pointers replaced the per-segment filters in both the
  prefix and suffix loops; the same reopen now costs 0.6 s and scales
  linearly (150 ms at 4,000 paragraphs, 624 ms at 16,000), leaving
  AST emission as the largest linear stage. Widened 2026-07-31 to
  definition-bearing documents: a CriticMarkup-free document whose
  bracket stays clear of every definition block splices, the lookup
  rebuilds from the shifted literal offsets against the new bytes, and
  emission re-resolves every reference through the definition cache
  key — provenance carrying stays withheld there because carried
  templates bypass that key. Edits reaching a definition still take
  the full pass. Marker-bearing documents with definitions — the
  Review-document class — followed the same day: the pass's final
  reference scope regions are retained, shifted with the other facts,
  and handed back as preset regions, so comment- and arm-scoped
  resolution survives the splice (a comment-body reference stays
  unresolved against a document-scope definition, and a definition
  opening a comment body scopes to that comment; the equivalence rows
  compare comment display ASTs to prove it). Remaining widenings
  inside the splice: provenance carrying under definitions, and
  CR-only line endings — the latter deliberately residual, because a
  boundary after a bare CR carries cross-boundary state (a following
  LF would merge into a CRLF pair), so CR boundaries are never clean
  checkpoints and the fallback is the sound route; an equivalence row
  pins that route.

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
  shape: two methods over 2,050 lines. Progress 2026-07-31 — the
  postcondition half is closed: the admission authority already carried
  the edit bounds, ordering proof, join protection, zero-delta rule, and
  exact source-transaction proof for every prepared intent, and the one
  missing member of the kernel's battery — the structural survivor proof
  that untargeted nodes keep their kind at their mapped envelope — moved
  to a shared module (`internal/untargetedNodePreservation.ts`) that both
  the kernel and `admit()` now enforce; replays stay exempt exactly as
  the zero-delta rule exempts them, since an undo legitimately removes
  nodes its recorded edits never spelled out. Two-sided proof: the same
  typed gesture admits through the real engine and rejects
  `semantic-postcondition-failed` through an engine whose reopen loses an
  untargeted node. What remains of G8 is the nine-fold declaration
  dedup.
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
  on that barrier. Progress: A19 and A08 are migrated, and twenty-six suites
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
**W4 — Language, configuration, and coverage**


- **G19 Consumer policy declares what production routes around.** The live
  editor sink now reads its plan through `routeLiveConsumer` at the worker's
  publication site, and the paste question now routes through
  `classifyPasteConsumer` at the session coordinator: the paste intent
  carries a declared clipboard payload (`private-source`, `markdown`,
  `external-text`) instead of a pre-classified treatment, the policy
  answers how each flavor lands (including the new `source-text-edit`
  route that makes the declaration truthful about source-view pastes),
  and no caller — the desktop paste handler included — classifies by
  hand. Two exported entry points still have no production caller —
  `viewLength` and `planReplaceConsumer` — while production routes
  replace elsewhere and in-editor find still searches visible text where
  the policy demands canonical source. Production routes those remaining
  questions through the policy; deleting the declarations is rejected,
  because the module owns the per-kind sink exactness table
  (`PROFILE1_KIND_SINK_EXACTNESS`, A41).
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
  after they close. Decomposed 2026-07-31 with layered in-app probes (all
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
