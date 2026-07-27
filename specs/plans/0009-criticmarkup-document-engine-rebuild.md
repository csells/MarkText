# CriticMarkup document-engine rebuild

- **Status:** RED — G1–G21 open
- **Owner:** MarkText
- **Updated:** 2026-07-27
- **Profiles:** `markdown-profile-1`, `marktext-profile-1`, `live-html-sanitized-v1`
- **Order:** P0 → P0.5 → P1 → … → P9 → P11 → P10
- **Completion authority:** only P10 may declare this plan complete

This is the single plan and incorporated audit; there is no separate audit
document. Git history holds discarded designs and progress notes. The branch
targets one parser, one document engine, and one MarkText host; code outside
that architecture is deleted.

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
11. No target drives, observes, or settles production through a seam that
    exists only for tests. Every precondition, barrier, observation, and
    submission a named target relies on is a public production affordance
    reachable by a real user gesture. A production branch selected by a
    test-mode environment variable, a substituted sink, an attribute set only
    for tests, and a fixed sleep in place of a public barrier are not evidence.

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
under 500 ms; maximum-document admission is at most 50 ms; main staging slices
are at most 4 ms; cancellation acknowledgement and animation-heartbeat gaps are
at most 100 ms; and the viewport settles within 10 seconds with bounded DOM and
a working set of at most 2 GB. P11 records the green band below an 8 ms measured
edit stall, requires equivalence-proven reuse above 16 ms, and validates the
pre-measurement owner decision between. `performance-reuse-decision.yml` fixes
that decision as `retain-equivalence-proven-reuse`; the timing run reports the
band but cannot choose its own architecture.

## 4. Current gap ledger

“Local proof” means the named behavior passed while the tree was changing; it
is not frozen-tree evidence. A closure claim resting on uncommitted work is not
closed.

<!-- Machine contract: 0009-evidence-collector.ts and 0009-final-closure.spec.ts
parse the table below. Keep the heading above, the header cells "Area" and
"Open before closure", the row labels "Document engine" and "P10 release
proof", and the single-space cell padding exactly as written. -->
<!-- prettier-ignore -->
| Area | Established | Open before closure |
| --- | --- | --- |
| Document engine | One intrinsic parser and fork graph own exact source, structure, identity, views, Review data, and typed mutation. Main owns sessions, persistence, recovery, Source mode, and every effect. Sole parser ownership is asserted but not yet independently provable (G5). | G1 (W1) |
| Review and editor UX | Review, paragraph commands, Quick Insert, Table, diagrams, Image, selection, and locales reach typed session intents. | G2 (W1) |
| Product authority | The five forms, projections, and the portable-byte promise match the vision. | G3 (W1) |
| Evidence integrity | Every manifest target exists, is collected, and is unskipped. | G4–G9 (W2) |
| Language, configuration, and coverage | Profile 1 semantics, exact fidelity, the frozen limit table, and the CommonMark 0.31.2 corpus are implemented and passing. | G10–G14 (W3) |
| Absence and documentation truth | Retired authorities, discarded routes, and research artifacts are deleted; muya is absent from production. | G15–G16 (W4) |
| P11 performance proof | The parser, views, facts, sparse 16,384-edit transform, exact source publication and recovery, conservative reuse cache, retained-`Text` transition, certified-reopen source-limit escape, and slow-edit DOM-selection race are locally green. | The post-fix Electron run is RED on edit and deletion latency, worker stall, renderer animation, working-set memory, and per-family reuse; measured values live in that run's artifact. Close them without changing any section 3 budget. Also G17–G19 (W5). |
| P10 release proof | The design has detached clean passes, independent installed artifacts, authenticated downloads, content-addressed evidence, compact attestations, one-parent closure, and one atomic closure command. | G20–G21 (W6), and the executable-proof list under W6 below. |

### Gaps

Every gap closes red–green under section 5 against a named target, and carries
its own manifest row — which records its owning phase — before that phase may
turn green. Three gaps are not single public behaviors and say so: G3 closes as
a recorded ruling plus a divergence target, G9 as a two-sided sweep record over
every named target, and G20 as a reproduction from retained records alone.

**W1 — Correctness and product authority**

- **G1 Undo and redo do not restore the exact prior revision.** History replay
  re-derives edits through the candidate-protection path instead of re-applying
  the recorded ones, so protection fires a second time on bytes it already
  protected (`packages/document-core/src/internal/session/revisionWorker.ts:5604`,
  `:5558-5570`); deleting one `+` from `{++new++}` and undoing commits
  `\{++new++}`, and redo then commits `\{+new++}`. The obligation is general:
  every undo and redo restores the exact UTF-16 source of the revision it
  targets, for every intent, and candidate protection runs only when an edit is
  first admitted. Dirty state is a second defect of the same shape —
  `historyState()` reports `dirty: false` across a divergent undo because
  history identities are positional tokens minted only when an edit is recorded
  (`:5673-5676`) while undo only decrements the cursor (`:5704`), so the head
  identity it compares against the saved identity (`:1778`) returns to the saved
  value even though the committed bytes diverged, and save and close cannot
  observe the divergence. Reachable from Source mode. Violates non-negotiable 6.
  No existing test edits across a delimiter and then undoes.
- **G2 Required commands are invocable when they are impossible.**
  Availability is not a property of a command: only Review commands declare
  `isAvailable` (`packages/desktop/src/renderer/src/commands/index.ts:464`),
  main registers every accelerator through `electron-localshortcut` with no
  availability check
  (`packages/desktop/src/main/keyboard/shortcutHandler.ts:80-88`), and 12 of the
  18 Edit-menu item rows declare no `id` at all — including the three paragraph
  rows (`packages/desktop/src/main/menu/templates/edit.ts:92-112`) that no
  disable path could address. Independently, three renderer handlers bare-return
  in Source mode instead of rejecting visibly
  (`packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue:1186`,
  `:1214`, `:1238`), two of them behind menu rows that do declare ids — so an
  `id` alone is not the fix. Every command declares its availability; every
  invocation path — menu, accelerator, palette, keybinding — resolves that one
  predicate before dispatch; an unavailable command rejects visibly; and
  registration rejects a command no disable path can address. Violates
  non-negotiable 10.
- **G3 The engine authors bytes the user did not type, under no recorded
  authority.** `protectChangedSourceJoins` inserts backslashes into committed
  source with no diagnostic and no rejection, while the product authority
  states the editor “never silently rewrites your document”
  (`specs/vision/criticmarkup-vision.md:53-54`). G3 closes as data: record the
  ruling in `specs/migration/source-authorship-decision.yml` on the
  `performance-reuse-decision.yml` pattern — permitted authorship class, the
  diagnostic each authored byte emits, implementation targets, proof targets —
  and bind one target that goes red when production authors a byte outside the
  recorded class.

**W2 — Evidence integrity**

Section 5 and non-negotiable 11 forbid every construct in G4–G8; each is a
named target whose assertion cannot distinguish pass from fail. G7 and G8 close
by removing the seam, not by repairing the assertion.

- **G4 The supply-chain mutation proof cannot fail.** Its fixture writes a
  placeholder for `packages/document-view/e2e/playwright.config.ts`
  (`packages/document-core/test/plan/0009-evidence-collector.spec.ts:195-197`)
  while the validator requires that file to contain `reuseExistingServer: false`
  (`packages/document-core/test/plan/0009-evidence-collector.ts:658`), so the
  un-mutated fixture already throws `/supply-chain/i` and all 28 rows pass
  regardless of detection. The two electron-builder rows have no detection logic
  at all.
- **G5 The P0.5 architecture gate is tautological.** Its owner and input trace
  assertions read a vocabulary closed to single values emitted from
  unconditional call sites, so they cannot fail, and a second parser that did
  not self-report would be invisible. The gate must prove single ownership
  without the parser's cooperation: derive syntax-decision ownership from the
  module graph and fail when any module outside the grammar produces one. A
  richer self-report is not a repair.
- **G6 Reuse equivalence never proves reuse engaged.** The trace-identity test
  primes the cache and compares traces without asserting any reuse counter, so
  it may compare two full parses.
- **G7 The print gate is proven by substitution.** A `proofPath` branch inside
  the production static sink host substitutes `writePrintProof` — implemented
  as `writePdf` — for native print submission. The A21 exception in section 5
  is the only substitution this plan authorizes; print is not covered.
- **G8 Selection evidence is synthetic.** A08 and A31 select through a
  `TreeWalker`, a `Range`, and hand-dispatched untrusted events, and Review
  evidence settles with fixed sleeps even though the public
  `commitAuthoringSelection` barrier exists. G8 closes when every
  selection-sensitive target drives selection with real input and settles on
  the public barrier.
- **G9 Mutation proof is one-sided, so a target that always fails counts as
  proved.** G4 is that failure already. Every named target — A01–A32, D01–D11,
  and every `phases[].target` in `0009-exit-gates.yml` — is proved twice: the
  un-mutated tree passes it, and a stated mutation of the production behavior
  it claims to prove makes it fail. A target that cannot pass its own baseline
  is red, not proved. The mutation and both results are recorded per target and
  retained with the evidence bundle (G20). Assertion presence is not proof. The
  P1 gate never opens a corpus example.

**W3 — Language, configuration, and coverage**

- **G10 The base language is bound to no gate.** Neither manifest mentions
  CommonMark or GFM, so the passing 652-example 0.31.2 corpus and its totality
  gate turn nothing red, and GFM is bound only as 24 curated examples. The
  conformance suite also runs with `gfm: false` under `test-unbounded`, never
  under shipping `desktop-v1`.
- **G11 Frozen corpora are narrower than the requirements they are named for.**
  The A10 recovery corpus is four single-line cases and cannot prove “nested
  block and literal contexts,” and the MMD-6 differential and Fevol lexical
  suites that the language authority makes mandatory have no target anywhere.
- **G12 Closed claims with no manifest row.** Accessibility, image handling,
  and per-Profile-1-kind exactness across the six sinks are each claimed closed
  while no A or D row names them; `consumer-policy.yml` is a view × consumer
  matrix, not a per-kind exactness matrix. Each needs a row. The image write
  path is already main-derived and proved — the write root comes from
  main-owned settings plus the main-resolved document path
  (`packages/desktop/src/main/imageAssets/imageAssetService.ts:343-409`), the
  filename is a content hash (`:609-612`), and
  `packages/desktop/test/unit/specs/image-asset-mutation-authority.spec.ts:39`
  proves the request carries no destination field — but no row binds that proof.
- **G13 The configuration is not closed, and tests can select a configuration
  production cannot.** The decoder accepts `live-html-escaped-v1`, which
  branches no behavior yet changes the semantic hash, and `test-unbounded`,
  which disables every parse-time hard limit in section 3 — decoded source
  units, `BudgetEvent`s, Markdown container depth, and CriticMarkup depth
  (`packages/document-core/src/configuration.ts:6-10`;
  `packages/document-core/src/internal/profile1Document.ts:3910`, `:3927`,
  `:3934`, `:4140`) — so any limit-bearing gate can run outside the limits it
  proves. Closure requires that no test-only limits profile survive and that
  each of the five rejection classes named in section 3 carry a decoder test;
  `unsafe` currently has none
  (`packages/document-core/test/language-engine/configuration-validation.spec.ts:74-134`
  covers only unknown, missing, mistyped, and invalid).
- **G14 Over-budget depth semantics are misimplemented, not undecided.**
  Section 3 and the language authority agree that a depth-class limit degrades
  to exact literal text, never to failure. The implementation and the A11 row
  instead lose semantics document-wide one level past 16,384. Align the
  implementation and retitle A11; no ruling is required.

**W4 — Absence and documentation truth**

- **G15 The scanned surface is prose in the plan and a hardcoded list in the
  test, so the two drift.** The P9 sweep runs its forbidden-symbol list over
  code surfaces only and checks specs and ADRs for two citation strings, while
  this plan claims it scans production, tests, configuration, and fixtures;
  `specs/architecture/document-core-module-design.md:50-52` still presents the
  deleted `shiftPlainMarkdownLane` in present tense, and tracked root files
  outside `package.json` and `pnpm-workspace.yaml` — `eslint.config.js`,
  `.npmrc`, `.gitignore`, `pnpm-lock.yaml`, `CONTEXT.md` — are never scanned
  (`packages/document-core/test/plan/0009-retired-authority-absence.spec.ts:66-87`).
  The sweep derives its surface from the tracked-file set minus a declared
  exclusion list, applies the whole forbidden inventory to every file in it, and
  fails when a tracked file is neither scanned nor excluded. This plan is the
  one declared document exclusion, because its gap text must name retired
  symbols to order their deletion, and a target proves it is the only such
  entry. D09's fixed phrase list over six documents is retired by that rule.
- **G16 Markdown syntax is recognized outside the parser.** Non-negotiable 2
  becomes a P9-enforced property: no production module outside the
  `document-core` grammar may pattern-match Markdown or CriticMarkup syntax,
  and P9 fails on any such recognizer whether or not it has callers. The
  exported `adjustCursor`
  (`packages/desktop/src/renderer/src/util/index.ts:74`), which hand-recognizes
  GFM tables, fences, math, and list markers with regexes and has no callers,
  is the first instance and is deleted.

**W5 — P11**

G17 and G19 are non-negotiable 11 violations; G19 closes through the P9 absence
inventory, not the timing run.

- **G17 A P11 performance test could not pass at HEAD.**
  `packages/desktop/test/e2e/critic-markup-perf.spec.ts` — a P11 measurement no
  manifest row names, unlike A29 and the P11 phase row, which both name
  `document-core-max-document-perf.spec.ts` — waited on a `data-critic-warm`
  attribute no production code sets; only the working tree replaces it with
  public menu commands.
- **G18 The interaction budget is never measured on the cold path,** because
  both variants measure a deliberately warmed steady state. The 500 ms p95
  covers the first interaction after open on an unwarmed session; the P11
  target reports cold and warm separately and gates on the cold figure.
- **G19 Ambient test-mode switches remain compiled into production.**
  `PERF_TESTING`, `MARKTEXT_TEST_BACKGROUND`, and
  `MARKTEXT_E2E_READONLY_BRIDGE` select production behavior and install main and
  renderer globals (`packages/desktop/src/main/ipc/documentCore.ts:477-509`,
  `packages/desktop/src/main/presentationPolicy.ts:208-209`,
  `packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue:1677-1679`),
  and two of them are re-exported to the renderer through the boot-info
  allowlist (`packages/desktop/src/main/ipc/bootInfo.ts:7-16`).

**W6 — P10**

- **G20 A green closure CI is not reproducible.** Section 7 requires compact
  candidate, platform, and closure records to be retained; no open item covers
  it. Retention closes when a target reconstructs the attestation of a
  completed closure run from the retained records alone, without the original
  workspace.
- **G21 The release proof resolves tools from the ambient environment.** The
  platform workflow invokes ambient `pnpm` in eight run steps
  (`.github/workflows/document-core-platform.yml:67`, `:91`, `:96`, `:185`,
  `:191`, `:225`, `:257`, `:265`), and the pinned-Corepack bootstrap that
  replaced `pnpm/action-setup` (`.github/actions/setup/action.yml:18-47`)
  authenticates only its own install — it never puts a pinned `pnpm` on `PATH`,
  so every one of those steps still resolves the runner's ambient binary. The
  rule is general: every tool, checksum authority, rebuild, command body, and
  the executed environment itself resolves from a pinned, authenticated,
  recorded source.

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

Three orderings are real dependencies: the G3 ruling precedes G1's design; G9
precedes any closure claim anywhere; and the W6 freeze is last because every
earlier fix invalidates it. Everything else may land in any order, consistent
with section 6. W1 and W2 lead by severity, not dependency — a
document-corrupting engine and an invocable command that does nothing are
shipping defects — and because W1's own targets land before the G9 sweep
exists, they are included in that sweep, never exempted from it.

- **W1** — exit: undo and redo restore exact prior source across the frozen
  intent matrix, dirty state tracks revision identity, and every invocation
  path consults one availability predicate, all proved by real gestures.
- **W2** — G9 runs after G4–G8 are repaired. No later workstream may be
  declared closed before G9 passes.
- **W3** — manifest rows land before the implementation work they gate. Exit:
  no section 8 claim and no G12 claim — accessibility, image handling, per-kind
  sink exactness — lacks a row, and every conformance corpus runs under
  `desktop-v1`.
- **W4** — exit: the scanned surface equals the tracked-file set minus a
  declared exclusion list, and the sweep fails when a tracked file is neither
  scanned nor excluded.
- **W5** — exit: A29 and the P11 phase row pass on a frozen tree, cold path
  included.
- **W6** — after the P10 control plane closes, freeze: commit and push the
  exact candidate, run two sequential `evidence/0009/pass-*` tags, publish
  authenticated evidence, and create the atomic three-document closure child
  with GREEN final-closure CI.

The whole sweep reruns after the freeze.

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
physical-work counter, stale log, hand-written result, manual check, or claim
resting on uncommitted work is not evidence. A focused green run never changes a
manifest status by itself.

Two standing exceptions carry their own policy. Native Comment context editing
uses a layered proof: Playwright's Electron API cannot select an OS-native
context-menu row, and the non-presenting three-platform automation policy
suppresses that popup, while a test-only `MenuItem` callback is barred by this
section and non-negotiable 11. A21 therefore requires a real right-click to arm
one exact parser-owned target, then a real user keybinding that invokes the
one-shot typed edit command twice and proves the consumed command cannot reopen
either nested card. A machine-owned real-Electron auxiliary target instruments
`Menu.prototype.append` from the test process, captures only the production
Comment row, verifies it is an actual Electron `MenuItem`, invokes it, and
restores the prototype. Production exposes no observation hook. Both targets are
required A21 evidence.

Windows Heading 1–6 are unbound by default because `Ctrl+Alt+digit` aliases
AltGr on many layouts and `Ctrl+Shift+digit` yields no stable digit key. They
remain user-bindable; macOS and Linux retain their tested defaults; and this
exception creates no view-owned fallback shortcut.

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
| P8    | Review cards, drafts, CRUD, context identity, shared menu/user commands, navigation, pointer, and focus pass real events; localization passes its named presentation target. |
| P9    | The complete absence inventory has zero production, test, configuration, or document references.                                        |
| P11   | Responsiveness, maximum-document limits, cancellation, viewport, and reuse decision pass measured gates.                                |
| P10   | Two fresh clean-tree passes cover all required surfaces and three platforms.                                                            |

Later slices may land while dependencies are red; a phase turns green only when
its manifest target, requirements, and dependencies are green.

## 7. Evidence status

Most of the work described here is uncommitted. The section 4 ledger carries the
current P11 and P10 run results; they are not repeated here.

Every P10 mutation row must be re-proved against a fixture the un-mutated
validator accepts (G4). No final source-freeze sweep or remote platform pass has
been collected. Exact commands and counts belong in test output and the evidence
bundle, not a progress diary.

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

- every section 2 non-negotiable is true of shipped production behavior;
- real MarkText gestures provide exact source, selection, rejection, visible
  state, one-step undo/redo, save, reopen, and crash behavior;
- every applicable Profile 1 kind is exact in live, text, HTML, clipboard, PDF,
  and print output, including hostile input;
- every G1–G21 gap is closed — including the G9 two-sided mutation sweep and
  the G10 and G12 bindings — and every A01–A32 and D01–D11 row and phase
  dependency is green;
- P9 proves every named forbidden authority, route, export, fixture, design,
  and document reference absent and unreferenced;
- P11 meets every measured budget and records the reuse decision; and
- P10 produces two genuine clean-tree passes plus successful macOS arm64,
  Windows x64, and Linux x64 records for the final source candidate, followed
  only by its verified closure child.

Anything section 5 rules out as evidence — plus a timeout, stale build,
unavailable platform, uncaptured installed flow, or dirty collector run — is
**UNPROVEN**. Until every item above has current evidence, this plan remains RED.
