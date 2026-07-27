# 0006 — Implementing Profile 1 on an existing hardened parser: gap analysis

- **Type:** Research (fresh-eyes build-vs-adopt analysis, requested 2026-07-24)
- **Status note:** §1–§5 were written from prior findings plus two primary-source fetches,
  _before_ adversarial verification. §7–§9 (added later on 2026-07-24) carry the verified
  deep-research run and the three-way synthesis with Gemini's independent report, and
  **supersede §5's verdict where they differ** — most notably the engine ranking and the
  lezer multi-block assessment.
- **Question:** With the Profile 1 spec (`specs/language/marktext-markdown-profile-1.md`) as the
  requirement, compare the top 3 headless Markdown parsers (TypeScript or Rust) and analyze the
  gap to implementing Profile 1 on top of each — versus finishing the from-scratch document-core
  parser.
- **Candidates:** `@lezer/markdown` (TS), `micromark` (TS), `markdown-rs` (Rust; `comrak` noted).
  Selection rationale in §2.

## 1. Fresh-eyes corrections to the prior analyses

Three things the earlier documents got wrong or never examined. Stated bluntly:

1. **The TypeScript ecosystem was never evaluated as a replacement engine.** Research 0004 was
   scoped to Rust because that was the question asked. Research 0001 mined Lezer only for
   incremental _techniques_. The two strongest adoption candidates for a TS renderer are TS
   engines, and no prior doc did this comparison. This document closes that gap.
2. **Neither TS candidate is excluded by plan 0009's architecture law.** The law forbids a
   _separate_ CM scanner/sidecar and post-hoc reconstruction. A micromark syntax extension runs
   inside micromark's single tokenizer pass — that _is_ intrinsic parsing. @lezer/markdown is one
   parser with a declared block→inline order, which the law explicitly permits ("a declared
   block-phase→inline-phase order inside one co-progressing parser is not this"). The
   disqualifications in 0004 (tree-sitter's two separate grammars, Rust batch parsers) do not
   transfer to these two. Research 0001's own verified finding F5 (3-0) already said CM "can ride
   the same pass" in @lezer/markdown.
3. **The from-scratch engine's remaining work is its riskiest work.** Of document-core's ~15.3k
   source lines, ~8.5k is the `profile1/` Markdown recognition layer and ~6.8k is everything else
   (session, revisions, views, rendering). Plan 0009 Phase 1 ("complete lossless Markdown
   coverage") is not done, and incremental reparse (Phases 5/11) is not started. So "keep
   building" does not mean "20% remains" — it means the CommonMark conformance long tail and the
   entire incremental system remain. Those are precisely the two things a hardened host engine
   can remove. Honest framing: the built 15k lines are an asset with passing coverage, but the
   sunk cost is not an argument; the _remaining risk profile_ is the argument.

## 2. The candidates

- **`@lezer/markdown`** — CodeMirror's incremental CommonMark(+extensions) parser (Marijn
  Haverbeke). Single-pass, produces Lezer trees over the source, **consumes tree fragments for
  incremental reparse**, ships GFM (Table, TaskList, Strikethrough), Subscript/Superscript/Emoji
  as extensions, and a public extension API (`defineNodes`, `BlockParser`, `InlineParser`,
  delimiter resolution, `parseCode` for nested regions). MIT. Hardened by the CodeMirror
  ecosystem (including Obsidian-class editors).
- **`micromark`** — wooorm's reference CommonMark tokenizer. **100% CommonMark, 100% GFM**, math
  / frontmatter / directives / MDX all built on its _public_ `SyntaxExtension` API (unlike its
  Rust port markdown-rs, which dropped the public API — a decisive difference 0004 could not
  see). Emits concrete events for every byte. ~2k tests, fuzzed, cross-checked against
  cmark-gfm. MIT. The most battle-hardened TS parser in existence (underlies remark/unified).
- **`markdown-rs`** — best Rust candidate per 0004 (byte-exact provenance, 100% CommonMark/GFM +
  math + frontmatter). Retained here as the Rust representative; comrak is more hardened
  (GitHub parity) but its AST/batch/output-side-extension design gaps are strictly larger.

## 3. Gap analysis against the Profile 1 spec

Legend: ✅ provided · 🔧 buildable on public API · 🔨 fork-level surgery · ❌ absent, build from scratch.

| Profile 1 requirement                       | @lezer/markdown                                                                                                                                                                              | micromark                                                                                                              | markdown-rs                                          | document-core (today)                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| §2 CommonMark 0.31.2 conformance            | 🔨 close, but **documented deviation**: link references are not validated (`[a][b]` parses as a link with no definition) — a deliberate trade for single-pass incrementality                 | ✅ 652/652                                                                                                             | ✅                                                   | 🔧 in progress (Phase 1); full reference resolution already built (`referenceDefinitionIndex`) |
| §3 GFM set                                  | ✅ official extensions                                                                                                                                                                       | ✅ official extension                                                                                                  | ✅ built-in options                                  | 🔧 partial (tables/strikethrough/tasklist present)                                             |
| §4 math / front matter / diagrams           | 🔧 trivial Block/Inline parsers (no official math ext)                                                                                                                                       | ✅ official math+frontmatter exts; diagrams = info-string mapping                                                      | ✅ math/frontmatter; diagrams = mapping              | ✅                                                                                             |
| R1 CM in the same pass                      | 🔧 InlineParser + delimiter resolver (0001-F5, verified)                                                                                                                                     | 🔧 SyntaxExtension in the one tokenizer — the purest intrinsic fit                                                     | 🔨 no public API — fork                              | ✅ by construction                                                                             |
| R2 pairing, literal degradation             | 🔧 resolver-level                                                                                                                                                                            | 🔧 attempt/nok machinery is designed for exactly this                                                                  | 🔨                                                   | ✅                                                                                             |
| **R3 multi-block spans**                    | 🔨 inline context is per-block; open-mid-paragraph→close-mid-other-paragraph fits neither inline nor container cleanly; needs custom composite-block surgery, possibly beyond the public API | 🔨 same conflict with the flow/text content-type model; frontmatter-style flow constructs don't cover mid-text openers | 🔨 same, plus fork baseline                          | 🔧 the lane/fork machinery is being built for exactly this                                     |
| N1 recursive nesting                        | 🔧                                                                                                                                                                                           | 🔧                                                                                                                     | 🔨                                                   | ✅ (corpus rows exist)                                                                         |
| C1–C4 containment                           | 🔧 resolver discipline, real work                                                                                                                                                            | 🔧 resolver discipline, dense but supported                                                                            | 🔨                                                   | ✅ (ADR-0010 implemented)                                                                      |
| L1–L3 literal precedence                    | ✅ falls out of one grammar                                                                                                                                                                  | ✅ falls out of one tokenizer                                                                                          | ✅                                                   | ✅                                                                                             |
| E1 escaping                                 | ✅ inherits CommonMark escapes                                                                                                                                                               | ✅                                                                                                                     | ✅                                                   | 🔧                                                                                             |
| §10 views, forks, safe points, segment maps | ❌                                                                                                                                                                                           | ❌                                                                                                                     | ❌                                                   | 🔧 being built — **no engine on earth provides this**                                          |
| T1–T4 error tolerance                       | ✅ markdown never errors; incremental-safe                                                                                                                                                   | ✅                                                                                                                     | ✅                                                   | ✅                                                                                             |
| P2 losslessness / round-trip                | ✅ trivially — tree annotates the source you keep (the CodeMirror model _is_ source-authoritative)                                                                                           | ✅ events cover every byte (consume events, not lossy mdast)                                                           | 🔧 positions exact; no round-trip guarantee          | ✅ by design                                                                                   |
| §1.1 UTF-16 offsets                         | ✅ native                                                                                                                                                                                    | ✅ native                                                                                                              | ❌ UTF-8 ↔ UTF-16 conversion layer at every boundary | ✅                                                                                             |
| X1 O(n)                                     | ✅                                                                                                                                                                                           | ✅ (constant factor mediocre)                                                                                          | ⚠️ known pathological cases (#113)                   | ✅ target                                                                                      |
| **X4 incremental reparse**                  | ✅ **fragment reuse ships today**                                                                                                                                                            | ❌ whole-document per keystroke                                                                                        | ❌                                                   | ❌ not started (Phases 5/11)                                                                   |
| Renderer embedding                          | ✅ TS, zero boundary                                                                                                                                                                         | ✅ TS, zero boundary                                                                                                   | 🔨 WASM boundary + API redesign to handles           | ✅ TS                                                                                          |
| Hardening / maintenance                     | ✅ Marijn + CodeMirror ecosystem                                                                                                                                                             | ✅ the most-tested MD parser in JS                                                                                     | ⚠️ single-author, no ext API by policy               | ❌ single-project, self-hardened via corpus                                                    |

## 4. What adoption actually buys and costs

**What you delete by adopting a TS host:** roughly the 8.5k-line `profile1/` recognition layer
and — the bigger item — the _unfinished_ work: the CommonMark conformance long tail (the least
differentiated engineering in the whole project) and, with Lezer, the entire incremental-reparse
system (document-core's hardest unbuilt phase, currently deferred to Phases 5/11).

**What you keep building no matter what:** the ~6.8k-line-and-growing layer above the parser —
revisions, session, typed intents, views/forks/segment maps (§10), Review UX plumbing — plus all
of Layer D's CM semantics. No candidate provides any of it. The build-vs-adopt question is _only_
about Layers A–C plus the CM recognition machinery.

**The two genuine adoption risks:**

1. **R3 (multi-block CM) is fork-risk on every host.** It is also the hardest part of the custom
   engine — the lane/fork/safe-point machinery exists _because_ of it. Honest statement: R3 is
   approximately equally hard everywhere; the difference is whether you fight it in code you own
   or in a fork of code you don't. This is the decisive unknown, and it is spike-able.
2. **Lezer's link-reference deviation vs the §2 pin.** Lezer deliberately does not validate
   reference labels (the same trade ikatyang's tree-sitter grammar made — research 0004). Profile
   1 pins CommonMark 0.31.2; document-core already implements full reference resolution.
   Adopting Lezer means either accepting a documented conformance deviation (and amending §2), or
   adding a post-structure validation that cannot fully restore CommonMark's fallback semantics
   (an unresolved reference changes how surrounding text tokenizes). This is Lezer's one real
   spec defect for our purposes — and it is the _same_ non-locality that makes incremental
   parsing hard, which is why every incremental engine compromises here. A Profile 1 on Lezer
   would likely ruled-amend §2 with this single named deviation.

**The custom engine's mirror-image risks:** the conformance long tail (thousands of CommonMark
edge cases profile1/ has not yet been proven against — muya's spec suites exist, document-core's
own Phase 1 gate does not yet pass them) and building incrementality from zero on a codebase
whose full-parse design didn't have to accommodate it (decision 12 says nothing may foreclose it;
nothing yet proves it either).

## 5. Verdict — brutal version

- **markdown-rs / Rust: no.** Fork-required, no incrementality, WASM boundary plus a UTF-8/UTF-16
  offset schism against §1.1, for speed the project doesn't need. Dominated by the TS candidates
  on every axis that matters here. (Unchanged from 0004, now for the right comparative reason.)
- **micromark: the "conformance-first" adoption.** You get §2–§4 hardened to perfection and a
  genuine intrinsic-single-pass extension API. You give up incrementality entirely and inherit
  the job of building it on foreign, dense internals — trading document-core's hardest unbuilt
  problem for the same problem on someone else's state machine, with a mediocre full-parse
  constant factor in the meantime. Only rational if Profile 1 drops X4 or accepts
  full-reparse-per-keystroke permanently.
- **@lezer/markdown: the serious challenger.** It ships, today, hardened versions of the four
  riskiest properties in document-core's remaining roadmap: incremental fragment reuse, total
  error tolerance, source-as-authority, and TS/UTF-16-native embedding — with an extension API
  that prior verified research (0001-F5) says CM can ride. Its costs are one documented
  conformance deviation and fork-risk on R3.
- **The from-scratch engine is not irrational** — it is the only path that satisfies the spec
  with zero amendments and zero foreign-code risk, and its CM/views machinery is ahead of
  anything else on earth. But it carries the most _undifferentiated_ remaining work.

**Recommendation: run a decision spike before writing more of the profile1/ Markdown layer.**
Time-boxed (order of days, not weeks):

1. Implement the five CM forms single-block as a `@lezer/markdown` extension with containment
   (C1) via delimiter resolution; run the CM corpus rows against it.
2. Prototype R3 as a composite-block construct; specifically attack open-mid-paragraph →
   close-mid-other-paragraph. This is the go/no-go: if it needs more than a shallow,
   upstreamable patch to Lezer's block loop, the fork cost is real and the custom engine wins.
3. Measure per-keystroke incremental reparse on the scale corpus in the real renderer.
4. Decide with data: **Lezer passes the spike →** adopt for Layers A–C + CM recognition, amend §2
   with the named reference-link deviation, keep document-core's session/views layer unchanged on
   top, and delete `profile1/`'s Markdown internals. **Lezer fails the spike →** continue the
   custom engine with documented conviction, and steal its fragment-reuse design for Phase 5/11
   (research 0001 already maps it).

Either outcome converts today's architectural faith into a tested decision for the price of a
few days — cheap insurance against spending months hand-hardening CommonMark edge cases that
Marijn and wooorm already paid for.

## 7. Adversarially verified update (2026-07-24, deep-research run wf_e8926e2c)

A full verified run (105 agents; 22 claims surviving 3-vote verification, 3 refuted) was
executed on the same question after §1–§5 were written. Full findings:
`sources/claude-deep-research-build-vs-adopt.json`. What it confirmed, corrected, and added:

**Confirmed (3-0 votes):** lezer's link-reference deviation, quoted verbatim from its README
(F4). Lezer's public extension API is real and proven by first-party extensions
(`addDelimiter`/`findOpeningDelimiter`/`takeContent`/`DelimiterType.resolve`; Strikethrough,
Table, TaskList built on it — F5). Lezer is the only surveyed engine where per-keystroke
incremental reparse is _provided_ (FragmentCursor/reuseFragment, shipped, driven in production
by CodeMirror 6 and Obsidian — F6). micromark is fully conformant (~2k tests, fuzzed — F1),
lossless with UTF-16-native offsets (F2), and its `SyntaxExtension` API demonstrably supports
custom pairing/containment: the first-party strikethrough extension registers character-keyed
tokenizers with a custom `resolveAll` that pairs closers to openers with extension-supplied
logic — no fork, no second scanner (F3). All of Profile 1's non-CM surface (GFM, math,
frontmatter, footnotes, directives) exists as first-party micromark extensions.

**Corrected / new since §5:**

1. **Lezer's multi-block ceiling is verified, not speculative (F7, 3-0).** The complete
   first-party extension inventory confines constructs to a single leaf block or single inline
   context; no mechanism matches a delimiter opened in one paragraph to a closer in a later
   one. Requirement R3 on lezer is fork-required-or-impossible _within the parse_.
2. **The Lezer-ecosystem CriticMarkup precedent is actively discouraging (F9, 3-0).** Fevol's
   Obsidian plugin — ~2 years, 449 commits, a dedicated parser — still ships data-loss
   warnings ("do not use this plugin in your main vault"), and its unclosed-delimiter
   document-swallowing failure was escalated to the CodeMirror forum, where **Lezer's own
   author concluded "the thing you're trying to do may not match what Lezer can do very
   well."** (Caveat: that grammar is a standalone LR grammar, not an @lezer/markdown
   extension — suggestive, not probative, for the extension path.)
3. **No intrinsic same-pass CriticMarkup implementation exists anywhere (F8, 3-0).** Every
   surveyed implementation — Fevol/Zettlr (overlay grammars), PyMdown (regex preprocessor +
   post-processor), remark-critic-markup (post-parse mdast text-node regex emitting raw HTML,
   _not_ a micromark tokenizer), MMD-6 — chose an architecture Profile 1 forbids. Requirement
   3+4 together is unprecedented in the entire ecosystem.
4. **Bolt-on approaches demonstrably fail WYSIWYG rendering (F11, 3-0).** PyMdown's maintainer
   froze its preview mode over invalid-HTML failures "especially in relation to lists or if
   breaking up Markdown syntax" — the exact multi-block/mid-inline domain. The intrinsic
   requirement is evidence-backed, not gold-plating.
5. **Coverage caveat:** no claims about the Rust engines, markdown-it, or marked survived
   verification in this run — their §3 assessments stand on research 0004 and analyst judgment,
   not on this run's verified evidence.

**Verified ranking (F12, analyst synthesis over the confirmed claims):** 1. micromark
(conformance + losslessness + proven pairing API; gap: incrementality must be built), 2. @lezer/markdown (incrementality + error tolerance provided; gaps: conformance deviation,
verified single-block ceiling, discouraging ecosystem precedent). No third engine earned
verified support.

## 8. Three-way synthesis (this doc §5 · Gemini's report · the verified run)

Gemini's independent report (preserved at
`sources/gemini-headless-engines-evaluation.md`) ranked lezer #1 / micromark #2 /
pulldown-cmark disqualified — agreeing with §5, disagreeing with the verified run. Scorecard
of its load-bearing claims against verification:

- **Confirmed:** lezer's link-ref deviation (and Gemini adds a fair pro-editor argument:
  strict validation would invalidate links document-wide while typing a definition);
  the `DelimiterType`/`takeContent` manual-resolution API; micromark's flow/text taxonomy
  as the multi-block obstacle; pulldown's UTF-8 offsets (consistent with 0004).
- **Undermined:** Gemini rates lezer multi-block "buildable-on-API" via standalone unlinked
  marker nodes + a projection layer that pairs them above the parse. F7 verifies the parse
  itself cannot pair them, and the design has a semantic knot Gemini did not examine: with
  markers as inert atoms, emphasis pairs _across_ annotation closers (`{++ *bold ++} rest*`),
  violating containment (C1); making markers block emphasis unconditionally breaks R2 (an
  unmatched literal marker must affect nothing). Pairing-outside-the-parse also makes
  marker-literalness (R2) a post-parse decision, which violates P3/L3 as currently specified.
  The design is a legitimate spike candidate, not a settled "buildable."
- **Unverified, likely spurious:** "Incremark," an alleged incremental block-caching wrapper
  around micromark. No trace survived verification; treat as nonexistent until shown
  otherwise. micromark incrementality remains _unbuilt anywhere_.

## 9. Final verdict (supersedes §5)

The verified evidence moves the needle in two directions at once, and honesty requires saying
both:

**Against adoption-as-obvious:** the two hosts split Profile 1's two hardest gifts between
them. The engine that provides incrementality (lezer) is verified to be unable to express
multi-block CM within the parse, carries a conformance deviation, and its ecosystem's best
two-year CM effort ends in data-loss warnings with Lezer's author skeptical. The engine that
can plausibly express the CM semantics on its public API (micromark) provides no
incrementality, and no one has ever built it on top. **Whichever host is chosen, one of the
two hardest systems still gets built by hand on foreign internals** — and requirement 3+4
together is unprecedented everywhere (F8), so the "hardened path" does not actually exist for
the part that matters most. Gemini's "abandoning the custom engine is sunk-cost fallacy
avoidance" does not survive this evidence: the custom engine's already-built parts (intrinsic
CM productions, arm containment, multi-block machinery, views) are precisely the parts no
host or precedent provides, while what it still owes — CommonMark conformance — is _bounded_
work against a perfect public oracle (652 spec tests + micromark/cmark as differential
references), the lowest-risk kind of remaining work there is. The genuinely hard shared
remainder, incrementality, is unbuilt everywhere except lezer.

**For keeping adoption live:** micromark's verified API expressiveness (F3) is better than
§5 assumed, the non-CM surface is entirely free there, and the cost of _finding out_ is days.

**Decision procedure (two cheap spikes, then commit):**

1. **micromark spike** — the verified run's open question #1: can a text-level construct open
   mid-inline in one flow block and close mid-inline in a later one on the public API
   (tokenizer + `resolveAll` over the document-level event stream), with arm containment and
   R2 literal degradation? If yes: adopt micromark for Layers A–C + CM recognition; build
   incrementality later over its lossless token stream (accepting full-reparse latency in the
   interim, cf. 0004-F9); delete the 8.5k-line recognition layer and the conformance tail.
2. **lezer spike** — Gemini's marker-node + projection design, explicitly testing the C1/R2
   knot above, plus the verified run's open question #4 (can a composite BlockParser re-enter
   inline parsing across child blocks). Pass criteria include containment correctness, not
   just span synthesis.
3. **Both fail → the custom engine is validated by evidence, not doctrine.** Continue it;
   import micromark's test corpus as the Phase 1 conformance oracle and lezer's
   fragment-reuse design (research 0001) for Phases 5/11 — adopting their hardening even
   while declining their engines.

> **Executed 2026-07-25 — outcome (3), both spikes failed the go/no-go.** Results, the
> adversarial review of the spike itself, two review-contributed micromark designs, and two
> newly found host-level hazards are in `specs/research/0007-host-engine-spike-results.md`.
> The experiment artifacts were deleted after their conclusions and regression inputs were
> transferred into the document-core requirements and corpus.

## 10. Sources

`lezer-parser/markdown` README (fetched 2026-07-24: incremental + extension API + the
link-reference deviation, quoted verbatim in §3/§4). `micromark/micromark` readme (fetched
2026-07-24: 100% CommonMark/GFM claims, extension list, `SyntaxExtension` docs, test counts).
Research 0001 (F1/F2/F5 — verified Lezer fragment-reuse and CM-rides-the-pass findings),
research 0004 (Rust candidates), research 0005 (CM semantics), plan 0009 (architecture law,
phase status), `specs/language/marktext-markdown-profile-1.md` (requirement baseline).
Line counts measured on `feat/native-criticmarkup` at `9a5b6d8e`.
