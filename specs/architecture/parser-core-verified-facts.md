# Parser core — verified architectural facts

> The single source of truth for evidence facts behind the MD+CM core parser: plan 0009 states
> the owner-ratified requirements (R-1…R-7) and points here; the research docs own methods and
> vote margins; this sheet owns the durable facts and the harvest list. Supersedes any older
> statement in this directory that conflicts.

## 1. The topology fact (why the graph exists)

A form-(a) annotation — opening mid-sentence in one block, closing mid-sentence in a later one —
cannot be a node in a strictly nested tree: the span and the crossed container (blockquote,
list, heading) cannot both be nodes of one hierarchy. Every engine evaluated to date
(research 0004/0006/0007/0008) exposes only strictly nested trees, which is the categorical
kill for tree-shaped hosts (verified for `@lezer/markdown`; `micromark` fails earlier, on
stream-truncation walls — see §3). The overlapping-markup literature formalizes the required
shape: **"Overlap is multiple parentage"** (GODDAG, verified in research 0008) — one span node
dominated by containers in different hierarchies, which is what document-core's lossless syntax
graph beside the block AST (plan 0009 decision 2) provides.

## 2. The two-authority fact (why one parse is a requirement, not doctrine)

Every two-authority CriticMarkup design examined (research 0005/0006/0007 — a second
recognizer ruling over text the Markdown parser also rules) exhibits a characteristic failure
class, verified from primary sources:

- PyMdown froze its preview mode over invalid HTML "especially in relation to lists or if
  breaking up Markdown syntax" (maintainer statement; 0006 F11).
- Fevol's Obsidian plugin — two years, 449 commits, a dedicated grammar — still ships
  data-loss warnings, and its unclosed `{++` swallows the rest of the document
  (author-acknowledged; Lezer's author called the goal a poor fit; 0006 F9).
- MultiMarkdown-6's render path and accept/reject path disagree about the same document (see
  `criticmarkup-host-markdown-interaction-evidence.md`).
- Pairing markers in a later pass is retroactively unsound: the historical host-engine
  experiment parsed markers as inert inline atoms, and emphasis then paired straight across
  an annotation closer. A later pass that joined those markers would turn the already-made
  emphasis decision into a containment violation (analysis: research 0006 §8; result:
  research 0007).

## 3. Host-engine walls (verified to source, spike-proven)

Neither `@lezer/markdown` nor `micromark` can pair an annotation delimiter across block
boundaries on its public API; both host the markers-on-own-lines whole-block enclosure subset.
Three walls each were verified against host source and exercised during the now-closed
host-engine experiment; mechanisms, regression inputs, and kill details live in research 0007.
Research 0008 extended the same verdict to markdig, goldmark, and intellij-markdown (walls
verified against parser source), and its close-out addendum finished the census: flexmark-java
and commonmark-java (3-0 panel-verified to source — per-block inline state reset/flushed at
block granularity), swift-markdown (wholesale cmark-gfm delegation plus a segmenting
directive pre-pass), and mistune (block phase to completion, per-block inline universe). The
underlying cause is universal across every evaluated open-source engine: CommonMark's
block-then-inline two-phase strategy freezes block boundaries before any inline recognition,
and every cross-block escape hatch is a post-parse pass. Remaining unexamined: closed-source
editor internals only.

## 4. Performance facts

- document-core plain path: linear ~12 ms/1k lines. CM path: ~5× and superlinear
  (58→84 ms/1k) — research 0003 attributes the creep to the current per-view + redundant
  recognition tax and expects it to collapse under parse-once; the Phase 1 gate verifies that.
  Separately, cmark-style openers-bottom discipline is the named fix (research 0007) for
  adversarial delimiter-run quadratics — a different pathology, host-level in stock
  `@lezer/markdown` (measured exp ≈1.7–2.0; ~6k nesting depth overflows its stack).
- The spike's lookahead-scanning micromark tokenizer measured quadratic on unclosed-opener
  runs (6.5 s at 24 KB vs 1.5 ms baseline); its resolveTo marker design measured linear. The
  mechanism generalizes to any per-opener scan-to-block-end tokenizer (research 0007).
- Fragment reuse in the lezer style is compatible with intrinsic CM: 30–35× incremental
  speedup (97% byte reuse) at arbitrary edit positions with the CM extension active (research
  0007, verified against independent-parse controls). Wagner & Graham (research 0008) supply
  the theory: O(t + s·lg N) incremental reparse, optimal node reuse formulated independently
  of the parsing algorithm, and the finding that **balancing lengthy sequences** (the
  top-level block list) is the decisive structure.

## 5. Ecosystem semantic evidence

- MMD-6's accept/reject CuTest matrix is evidence about additions, deletions,
  substitutions, highlights, comments, recursive nesting, and unclosed-marker
  passthrough (research 0005; one verifier compiled MMD-6). Profile 1 owns all
  expected results directly; no other implementation is an executable
  authority.
- No implementation anywhere parses CriticMarkup as intrinsic same-pass grammar productions
  (0005, reconfirmed 0008 across five sweep angles), and no Markdown-aware implementation
  renders a form-(a) span as parsed structure: MMD-6 rendering confines CM to one block; the
  reference toolkit matches multi-paragraph spans only via DOTALL regex placeholder surgery.
  Multi-block CM is canonical usage — the toolkit does it deliberately — not a MarkText
  invention.
- Even Word/OOXML — production track changes at maximum hardening — models a cross-paragraph
  deletion as per-block deletions plus a `w:del` flag on the paragraph-mark token, whose
  normative semantics is block merging. That boundary-token rule informed the
  Profile 1 paragraph-break-deletion ruling; the fragment representation is what R-1 rejects (research
  0008).
- No native CM escape mechanism exists in the ecosystem; code-span escaping is the only
  documented practice, and it works only under literal precedence — hence not in the reference
  tools themselves. Literal precedence exists in NO reference tool; MarkText's adoption of it
  is a deliberate divergence recorded in the language spec (research 0005).

## 6. Harvest list (adopt the hardening, not the engines — sequencing lives in plan 0009)

1. micromark's ~2k-test conformance corpus (CommonMark 0.31.2 + GFM), plus its first-party
   math/front-matter extension suites → target-owned conformance rows.
2. cmark's openers-bottom delimiter discipline → the adversarial-quadratic fix.
3. `@lezer/markdown`'s `TreeFragment` reuse contract → incremental-reparse template
   (spike-verified above), with Wagner & Graham's balanced-sequence mandate and
   algorithm-independent reuse formulation as the underlying theory (research 0008).
4. The 0007 spike regression inputs (containment both directions, same-form nesting, divider
   hijack/first-wins/stray, unclosed probes) → corpus rows.
5. MMD-6's CuTest accept/reject matrix → evidence used to author projection
   conformance rows with literal Profile 1 expectations.
6. Peritext's gap-anchor semantics (span ends attach to gaps before/after stable atom
   identities) → design vocabulary for the span store; open design question: the
   source-authoritative analogue of a stable atom identity under incremental reparse
   (research 0008).
7. OOXML's `w:del` paragraph-mark semantics → evidence for the Profile 1
   paragraph-break-deletion ruling (research 0008).

## 7. Related records

Requirements and gate: plan 0009 ("Ratified core-parser requirements"). Wide-sweep verdict and
prior-art digest: research 0008. Language-spec ratification items (five judgment calls, the
link-vs-annotation overlap tie-break, container-boundary accept/reject semantics — the
no-precedent case 0008 surfaced): `specs/language/marktext-markdown-profile-1.md`.
