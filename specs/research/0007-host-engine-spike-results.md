# 0007 — Host-engine decision spikes: results and verdict

- **Type:** Executable research — the decision spikes prescribed by research 0006 §9, run and
  adversarially reviewed
- **Created:** 2026-07-25
- **Question:** Can `@lezer/markdown` or `micromark` host Profile 1
  (`specs/language/marktext-markdown-profile-1.md`) — in particular R3's multi-block
  CriticMarkup spans — on their public extension APIs?
- **Code:** `spikes/parser-hosts/` — four runnable suites, 57 tests, all green at this commit
  (`node --test` from that directory; `node smoke.mjs` for the repo-wide smoke). Versions:
  `@lezer/markdown` 1.7.2, `micromark` 4.0.2, Node 26.
- **Method:** implement the five CM forms (lezer) / the Addition form in three competing designs
  (micromark) as extensions; drive Profile 1's rule IDs as executable tests; then a 4-cluster
  adversarial review (workflow `wf_94bf082a`, ~473k tokens, 127 tool calls) attacked the tests
  for vacuous passes, hunted untried public-API designs, and probed pathological inputs. The
  review found 3 real bugs in the spike's substitution machinery (fixed; regression-tested),
  one sibling-blind assertion pattern (fixed: cursor-range assertions in `tree-util.js`),
  two designs the spike had missed (both incorporated), and two host-level hazards (documented
  below). One reviewer prototype and four kill-proofs are cited inline.

## Verdict

**Both spikes fail the §9 go/no-go: neither host can express Profile 1 R3 — an annotation
opening mid-paragraph and closing mid-inline in a later block — inside the parse, on the public
API, without violating other Profile 1 rules.** Per research 0006 §9's decision procedure, the
custom document-core engine is now validated by executed evidence, not doctrine.

The precise failure shapes (each verified to host source by the review):

- **lezer:** inline delimiters cannot pair across blocks (inline contexts are per-block). The
  atom-marker workaround (Gemini's design) demonstrably violates C1 — the spike shows
  `Emphasis` pairing straight across a `CriticCloseAtom`. Composite blocks are line-anchored
  and cannot open mid-paragraph. The review's genuinely new find — a **leaf-observation design**
  (`BlockParser.leaf` + `LeafBlockParser.finish()` consuming lines and re-entering
  `parseInline`) — DOES synthesize the span, but dies on four API-inherent kills: an unmatched
  opener swallows the rest of the document (R2; the API offers only one-line peek and
  irreversible line consumption, so pairing needs lookahead it cannot have), the forward scan is
  raw text and pairs into fenced code (L1), a mid-inline close inside a blockquote is
  topologically unrepresentable in the strictly nested tree (the categorical kill), and the
  design breaks fragment reuse — so a fork would have to rebuild lezer's incremental machinery,
  not just its block loop.
- **micromark:** three walls verified in source — mid-inline openers exist only in text
  contexts whose streams are physically truncated with a synthetic EOF at the content block's
  end; flow/container constructs run only at line starts; and there is no extension hook over
  the merged final event stream, so cross-context pairing would be post-parse rewriting through
  internal fields (forbidden by Profile 1 P3/L3 and by micromark's public/internal boundary).

## What DID work — the surprising positive results

The spike hosted far more of Profile 1 than research 0006 predicted, on both engines:

| Profile 1 rule                                                                       | lezer (paired design)                                                                                                    | micromark (best design per rule)                                                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Five forms, arm-local markdown (R1, R7)                                              | ✅                                                                                                                       | ✅ (Addition implemented; same mechanism for the rest)                                  |
| R2 unmatched → literal, affects nothing                                              | ✅                                                                                                                       | ✅                                                                                      |
| R4 divider semantics incl. first-divider-wins, nested dividers, divider-in-code-span | ✅ (post-fix)                                                                                                            | untested (substitution not implemented)                                                 |
| N1 recursive nesting incl. same-form                                                 | ✅                                                                                                                       | ✅ (depth tracking)                                                                     |
| C1 containment: emphasis, links, across `~>`                                         | ✅                                                                                                                       | ✅ emphasis (direct design); one pinned ordering gap (resolveTo design)                 |
| C2 enclosure by outside pairs                                                        | ✅                                                                                                                       | ✅                                                                                      |
| L1 literal precedence (code/fence own markers)                                       | ✅                                                                                                                       | ✅                                                                                      |
| L2 one-lexer ownership (`{++a `x++}` b++}` closes at the SECOND closer)              | ✅ **free** — the shared position-advancing inline loop IS the one-lexer rule                                            | direct design ✗ (pinned gap); resolveTo design ✅ free                                  |
| E1 escaped delimiters                                                                | ✅ (CommonMark escapes)                                                                                                  | direct design: backslash-parity fix; resolveTo design: free                             |
| CM2 empty payloads                                                                   | ✅                                                                                                                       | untested                                                                                |
| R3 enclosure subset (markers on own lines around whole blocks)                       | ✅ composite block                                                                                                       | ✅ flow-level construct (review find)                                                   |
| **R3 mid-inline multi-block**                                                        | ❌                                                                                                                       | ❌                                                                                      |
| X4 incremental reparse                                                               | ✅ 1.6–2.7ms vs ~20ms full on 136KB, 97% of bytes reused, 30–35× at any edit position (review-verified against controls) | ❌ nothing exists ("Incremark" from Gemini's report: no trace — treat as hallucination) |
| X1 O(n), no pathological inputs                                                      | ❌ **host-level quadratic** (below)                                                                                      | direct design quadratic (pinned); resolveTo design linear (tested)                      |

Two review-contributed micromark designs are now part of the spike: the **flow-level enclosure
construct** (`micromark-critic-flow.js`) — which forms `{++` / `++}` on their own lines around
whole blockquotes/paragraphs with real block structure inside, micromark's parallel to the
lezer composite block and to Penney's proposed-but-never-shipped block syntax (research 0005
F2) — and the **attention-style resolveTo design** (`micromark-critic-resolve.js`), which gets
L2 and E1 free and is quadratic-proof, at the cost of one pinned C1 ordering gap.

## Host-level hazards (new gap-analysis facts, both from the review)

1. **Stock `@lezer/markdown` violates Profile 1 X1**: its emphasis resolution is quadratic on
   adversarial delimiter runs (measured exp ≈1.7–2.0 with and without the CM extension — same
   exponent, so host-attributed), and ~6,000-deep balanced nesting crashes tree serialization
   with a stack-overflow `RangeError`. CodeMirror mitigates by time-slicing and viewport-first
   parsing, but X1 is a language-level requirement; adopting lezer means accepting or upstream-
   fixing this. (document-core's cmark-style openers-bottom discipline is the known fix.)
2. **The micromark direct-tokenizer design is extension-induced quadratic** on unclosed-opener
   runs (measured 6.5s at 24KB; baseline micromark 1.5ms flat) — every `{` scans to block end
   then backtracks. Pinned as a test. The resolveTo design avoids the scan entirely and
   measures linear; a production micromark design would start there.

## Spec questions surfaced (for the Profile 1 document)

1. **Overlap tie-breaking, link-vs-annotation:** `[label {++ a](url) b++}` — lezer's eager
   LinkEnd resolves the link and destroys the pending annotation opener; C1 §9.1 presupposes
   the annotation exists and does not rule this direction. Pinned in the spike; the spec needs
   an explicit overlap rule (suggest: consistent left-to-right, first-complete-wins, matching
   the one-decision law).
2. **Payload trailing spaces** (micromark finding): text-context compilers may classify
   payload-final spaces as line suffixes; P2 losslessness is unaffected at the token level but
   any HTML sink must not rely on compiled output for round-trip. Consistent with the existing
   source-authority rules; worth one sentence in §10's materialization notes.

## Consequences

1. **Continue document-core.** Both §9 spikes are now executed and negative on the only
   question that mattered. The residual justification for the custom engine is exactly: R3
   mid-inline multi-block spans + X1 under adversarial input + views/forks/segment maps — all
   three now evidence-backed, none available on any host.
2. **The relaxation trade is now precisely priced:** if R3 were ever softened to
   "inline annotations single-block + block annotations markers-on-own-lines" (the
   MMD-6/Penney shape), BOTH hosts express Profile 1's recognition layer on their public APIs —
   lezer with incrementality included (minus the X1 hazard), micromark with conformance
   included (minus incrementality). That is a product decision, already ruled the other way
   (2026-07-24, research 0005 Q1); this doc records what the ruling costs.
3. **Steal with pride:** micromark's ~2k-test corpus as the Phase 1 conformance oracle;
   lezer's TreeFragment reuse shape (verified 30–35× here) as the Phase 5/11 incremental
   design; the spike's C1/R2/R4/N1/L2 regression inputs (including the review's adversarial
   probes) into the document-core corpus; cmark openers-bottom as the X1 requirement's known
   implementation.
4. Research 0006 §9's decision procedure is closed: outcome (3), "both fail → custom engine
   validated by evidence." 0006 remains the analysis record; this doc is the execution record.
