# 0001 — How OSS editors parse Markdown + CriticMarkup with near-zero typing lag

- **Type:** Research (external evidence + applicability analysis)
- **Created:** 2026-07-22
- **Question:** How do existing open-source Markdown editors that support CriticMarkup (and closely
  comparable OSS editors) optimize Markdown + CriticMarkup parsing to achieve near-zero perceived
  typing lag? What is implementable here, and what does *not* transfer to an engine that must keep
  lossless source, parser-created provenance, and multiple per-view projections?
- **Method:** deep-research harness — 6 search angles, 23 sources fetched, 105 claims extracted,
  25 adversarially verified (3-vote), 1 killed, synthesized to 7 findings. Primary sources preferred
  (Lezer/CodeMirror/tree-sitter/ProseMirror/CommonMark docs and source; MultiMarkdown; lang-criticmarkup).
- **Relationship to the rebuild:** informs the "0-lag" gap identified in plan 0009 Phase 0.5 — that
  the plan delivers a clean O(n) *full* parse, which is a different goal from *perceived* zero lag.

## TL;DR

Near-zero typing lag in this class of editor comes from **four reinforcing techniques**, none of
which is "make the full parse faster":

1. **Incremental reparse via reusable syntax-tree fragments.** Keep the previous tree; on an edit,
   adjust it for the change and *reuse unchanged subtrees* instead of re-parsing them.
2. **Time-slicing the parse on the UI thread** — advance the parse in bounded steps against a
   deadline, parse the viewport first, let the tail catch up in idle time. **No Web Worker.**
3. **An immutable document model with structural sharing + DOM diffing** (ProseMirror) — never
   re-parse text while editing; apply typed steps to a shared-structure tree and diff to touch
   minimal DOM. Re-parse only on import.
4. **Single-pass mixed parsing** — parse CriticMarkup in the *same* pass as Markdown (an overlay /
   extension), not a reconciled second parser.

The universal hard constraint is **CommonMark non-locality**: one local edit can restructure blocks
to end-of-document, so reuse must be context-gated and the reparse region explicitly bounded.
MultiMarkdown (by CriticMarkup's own author) sidesteps CriticMarkup's share of this by **constraining
each annotation to a single block** — a lever this project has deliberately declined.

**Two honest evidence gaps up front:** (a) *no* surveyed editor runs the Markdown/CriticMarkup parse
in a Web Worker — the off-thread question resolved to main-thread time-slicing; (b) *no* primary
source produced reproducible ms/keystroke benchmarks — "parse on every keystroke" and "very little
work" are design goals, not measured latencies.

## Findings

### F1 — Fragment reuse is the core mechanism (Lezer / @lezer/markdown) · high confidence (3-0)

Lezer accepts a cache of `TreeFragment`s "annotated with information about the document changes that
happened in the meantime" and reuses nodes "rather than re-parsing the parts of the document they
cover." `TreeFragment.applyChanges` removes/splits fragments across edited ranges and adjusts offsets
for moved fragments. `@lezer/markdown` "produces Lezer-style compact syntax trees and consumes
fragments of such trees for its incremental parsing" — the **same** fragment-reuse mechanism, even
though Markdown is not parsed by the LR runtime.

- **Tradeoff:** reuse is context-gated and *not bulletproof* — a tiny edit that changes downstream
  meaning forces a larger reparse, and maintainers have shipped fixes for incorrect reuse (nodes
  ending in a repeat/optional part; failing to reuse unchanged inner mixed parses). Version-dependent
  (fixes cited from `@lezer/lr` 1.4.1 / `@lezer/common` 1.5.2).
- Sources: lezer.codemirror.net/docs/{guide,ref,changelog}; github.com/lezer-parser/markdown README.

### F2 — Parsing stays off the critical path by TIME-SLICING, not threads · high (3-0)

Lezer exposes `startParse` → repeatedly call `advance` "until you decide you have parsed enough or the
method returns a tree." CodeMirror's `@codemirror/language ParseContext.work` drives exactly this loop
with a deadline (`endTime = Date.now() + until`, bail when exceeded); its `ParseWorker` scheduler
bounds slices with `requestIdleCallback` `timeRemaining()` and `navigator.scheduling.isInputPending()`,
falling back to `setTimeout`. **The viewport is parsed first; the tail catches up in idle time.**

- **Tradeoff:** the parse can lag the latest edit briefly, so features needing a fully-parsed tree may
  read stale results for a frame or two. This is acceptable *because* typing is never blocked.
- **The name "ParseWorker" is misleading — it is a main-thread scheduler, not a Web Worker.**
- Source: lezer.codemirror.net/docs/guide; deepwiki codemirror/language parse-context.

### F3 — tree-sitter: explicit edit API + structural sharing + error tolerance · high (3-0)

Flow: call `ts_tree_edit()` with a `TSInputEdit` (start byte+point, old-end, new-end), then re-parse
with the old tree — "this will create a new tree that internally shares structure with the old tree,"
reusing unedited subtrees. Stated design goal: "fast enough to parse on every keystroke." Error
tolerance means a mid-edit invalid state still yields a usable tree.

- **Tradeoff:** requires the host to *report* every edit as byte/point ranges — a discipline, not free.
- **Applicability caveat:** tree-sitter emits one tree per language layer for *rendering/analysis*; it
  does not model lossless source ownership or multiple semantic projections.
- Sources: tree-sitter.github.io advanced-parsing; github.com/tree-sitter/tree-sitter.

### F4 — ProseMirror never re-parses while editing; it diffs an immutable model · high (3-0)

ProseMirror applies typed steps to an immutable node/mark tree that **shares unchanged sub-nodes**,
and its view diffs old-vs-new to "leave the parts of the DOM that correspond to unchanged nodes
alone," doing "very little work for typical updates." `prosemirror-markdown` delegates tokenization to
markdown-it and maps tokens onto schema nodes; `MarkdownParser.parse` builds a **whole** document from
text with **no** incremental/streaming path — Markdown is parsed only on **import**.

- **Tradeoff / why it does not transfer wholesale:** the **source Markdown is not the authority — the
  model is.** Round-tripping is model → serializer. This is exactly the inverted authority direction
  plan 0009 rejects (ADR-0005: the revision is the sole authority; source is lossless). ProseMirror
  avoids the incremental-*Markdown*-parse problem by not keeping Markdown as the source of truth.
- Sources: prosemirror.net/docs/guide; github.com/ProseMirror/prosemirror-markdown.

### F5 — @lezer/markdown is single-pass and extensible; CM can ride the same pass · high (3-0)

From the parser's own README (by Lezer's author): "It does not in fact use the Lezer runtime (that
runs LR parsers, and Markdown can't really be parsed that way), but it produces Lezer-style compact
syntax trees and consumes fragments of such trees for its incremental parsing." It exposes
`parseBlock: BlockParser[]` and `parseInline: InlineParser[]` via `configure()`, so extensions run
**within** the one pass. Bundled Strikethrough (`~~ ~~`) proves delimited inline syntaxes of the same
construct class as CriticMarkup's `{== ==}` integrate into that single pass.

- **Tradeoff:** being single-pass, it deliberately omits some conformant CommonMark behaviors.
- Source: github.com/lezer-parser/markdown README.

### F6 — CommonMark non-locality is the universal obstacle · high (3-0)

- **Unclosed fence:** "if the end of the containing block (or document) is reached and no closing code
  fence has been found, the code block contains all of the lines after the opening code fence until
  the end of the containing block" — one fence edit can restructure *every* following block.
- **Lazy continuation:** an unindented line is a list-item lazy continuation *only because* an earlier
  line left a paragraph open; a blank line would instead start a new top-level block.
- **Reference definitions:** a third non-locality source (a definition can precede or follow its use).

Implication: fragment reuse and structural sharing remain *correct* here — context-gated reuse simply
forces a **larger reparse** when downstream meaning changes. That is exactly why maintainers stress
reuse is "not bulletproof." **Open question the research could not close:** the specific algorithm
each parser uses to *bound* the reparse region (reparse-to-EOF vs cached block boundaries vs
per-line open-block checkpoints) was not extractable from primary sources.

- Sources: spec.commonmark.org/0.29; github.com/lezer-parser/markdown README.

### F7 — CriticMarkup-specific: overlay in one pass; block-locality bounds reparse · high (3-0)

`lang-criticmarkup` (Nathan Lesage) is "intended to be used atop of other (plain-text style) syntaxes
such as Markdown," mounted via Lezer `parseMixed`:
`markdownLanguage.parser.configure({ wrap: parseMixed(node => node.type.isTop ? { parser: criticMarkupLanguage.parser, overlay: node => true } : null) })`.
CriticMarkup tokens are **layered onto the existing Markdown tree by CodeMirror's incremental Lezer
engine** — one pass riding fragment reuse, not a reconciled second parser.

MultiMarkdown (by CriticMarkup's creator) requires that "CriticMarkup must be contained within a
single block (e.g. paragraph, list item, etc.)" and silently ignores cross-block CM. **This
block-locality is a deliberate performance lever** that bounds CriticMarkup reparse to one block.

- **Direct tension for this project:** block-locality is the cheapest CriticMarkup boundary, **but
  MarkText deliberately supports cross-paragraph CriticMarkup** (the whole point of ADR-0010's
  self-contained arms and the cross-block comment work landed earlier this branch). We have chosen the
  expensive boundary on purpose. That is a legitimate product choice, but it means the single cheapest
  lever the ecosystem uses is *unavailable to us by design* — and that raises the value of the other
  three levers (fragment reuse, time-slicing, lazy projections).

## Refuted / not established

- **Refuted (1-2):** "MultiMarkdown 6 runs CriticMarkup as a pre-pass (two-layer)." Verification
  failed; its docs describe single-block-scoped recognition. Do **not** assume MMD is two-pass.
- **Not established:** any editor running the MD/CM parse in a Web Worker; reproducible ms/keystroke
  latency numbers; a documented content-hash block cache or lazy-annotation-render scheme (viewport
  parsing was confirmed only indirectly, via CodeMirror parsing the viewport first).

## What this means for `@marktext/document-core`

The engine's constraints are unusual: **lossless source is the authority** (not a model, unlike
ProseMirror), **provenance is created with syntax**, and it emits **multiple per-view projections**
(Original/Revised/Comment), not one render tree. That reshapes which techniques transfer.

| Technique | Transfers? | How it maps / what to watch |
| --- | --- | --- |
| **Fragment reuse (F1/F3)** | **Yes, high value** | Maps onto the immutable-revision / atomic-syntax-graph design. **But** the context gate that makes reuse *safe* must include parser-created provenance and lane state, or reuse can resurrect stale provenance. Reduces reparse *work*; does not itself produce lossless-source or projection outputs. |
| **Time-slicing on the UI thread (F2)** | **Yes, high value, low risk** | Adopt `startParse`/`advance`/deadline directly; parse the viewport first. This is the cheapest large win and it does **not** require solving incremental parsing — it just stops a full parse from blocking a keystroke. Preferred over a Web Worker precisely because provenance/projection reads are synchronous and a worker introduces tearing. |
| **Single-pass mixed parse (F5/F7)** | **Yes — and it is exactly plan 0009's goal** | "CriticMarkup in the same pass as Markdown" is the intrinsic-parser thesis. The `parseBlock`/`parseInline` extension shape is a concrete model for how CM productions live inside one Markdown pass. |
| **Immutable model + DOM diff (F4)** | **Partially** | The structural-sharing + diff idea transfers to rendering; the "model is authority, source is derived" part is the inverted direction ADR-0005 rejects. Take the diffing, leave the authority inversion. |
| **Block-locality for CM (F7, MMD)** | **No — declined by design** | We support cross-paragraph CM. The cheap lever is off the table; lean harder on the other three. |
| **Off-main-thread parse** | **Unevidenced; likely a trap here** | Nobody surveyed does it, and synchronous provenance/projection reads make it worse for us than for a render-to-HTML editor. Do **not** reach for a worker before exhausting time-slicing + fragment reuse. |

### The projection multiplier — the finding most specific to us

Every surveyed single-pass parser emits **one** tree/render target. This engine emits **2 +
(number of comments)** per-view parses, and today it does so **eagerly on every open**
(`createCommentDisplayProjections`, verified O(comments × n)). None of the ecosystem techniques
addresses this because none of those editors have the concept. The research's own open question names
it: *"how can an engine that must emit both a lossless source projection and CriticMarkup
Original/Revised projections keep the second projection cheap under incremental edits?"* — unanswered
by any surveyed source.

That points at two conclusions the external evidence supports by *absence*:

1. **Make comment-display projections lazy and cached** (parse a comment's display only when shown,
   keyed by revision). This is our problem alone to solve; no upstream will solve it for us, and it is
   cheap. It is the single most project-specific perf fix and is independent of the rebuild.
2. **The correct 0-lag architecture here is: one incremental (fragment-reusing) canonical parse,
   time-sliced on the UI thread, feeding lazily-materialized per-view projections** — combining F1 +
   F2 + F5, plus a projection-laziness layer the ecosystem does not need and therefore does not
   provide.

### Ordered, evidence-backed recommendations

1. **Time-slice the canonical parse against a deadline; parse the viewport first (F2).** Highest
   value / lowest risk; requires no incremental algorithm; directly attacks per-keystroke blocking.
2. **Make comment-display projections lazy + revision-keyed.** Kills the verified O(comments × n)
   blow-up; nobody else can give us this.
3. **Add fragment reuse to the canonical parse (F1/F3)** — but gate reuse on a context key that
   includes provenance/lane state, and expect CommonMark non-locality (F6) to force reparse-to-a-
   bounded-suffix on fence/definition/lazy-continuation edits. **Measure first** (see below): fragment
   reuse is the hardest correctness surface and may be unnecessary if a time-sliced full parse is
   already < one frame for realistic documents.
4. **Do the intrinsic single-pass MD+CM parse (F5/F7)** — this is plan 0009 Phase 0.5 and it is
   validated by the ecosystem as the right shape.
5. **Do not build a Web Worker parse** until 1–4 are exhausted and measurement proves a residual
   main-thread stall.

### The measurement the research says we are missing

No primary source has ms/keystroke numbers, and neither do we. Before committing to incremental
parsing (the hardest, most bug-prone lever, per F1/F6), **measure a time-sliced full canonical parse**
on a realistic corpus (a ~100 KB document; a ~30 KB document with ~50 comments) on target hardware.
Crossover logic:

- Full parse of the *viewport slice* < ~8 ms → **time-slicing + lazy projections is sufficient;
  incremental parsing is not needed.** (Likely for typical documents.)
- Residual stall > ~16 ms even viewport-first → **add fragment reuse**, scoped to the common
  intra-block edit, with a bounded reparse-suffix fallback for the non-local cases.

## Open questions carried forward

- The concrete reparse-region **bounding algorithm** for fence/definition/lazy-continuation edits
  (reparse-to-EOF vs cached block boundaries vs per-line open-block checkpoints) — not extractable
  from surveyed sources; likely requires reading `@lezer/markdown` / `tree-sitter-markdown` source
  directly if we pursue fragment reuse.
- Whether a **single annotated canonical tree with lazy per-view projection** is viable and its true
  per-keystroke cost — the projection-multiplier problem, unanswered by any external source.
- The **ms/keystroke crossover** at which fragment reuse starts to matter for our document sizes.

## Primary sources

- Lezer guide / ref / changelog — https://lezer.codemirror.net/docs/{guide,ref,changelog}/
- @lezer/markdown README — https://github.com/lezer-parser/markdown/blob/main/README.md
- tree-sitter advanced parsing — https://tree-sitter.github.io/tree-sitter/using-parsers/3-advanced-parsing.html
- tree-sitter repo — https://github.com/tree-sitter/tree-sitter
- ProseMirror guide — https://prosemirror.net/docs/guide/
- prosemirror-markdown — https://github.com/ProseMirror/prosemirror-markdown
- CommonMark 0.29 spec — https://spec.commonmark.org/0.29/
- MultiMarkdown 6 CriticMarkup — https://fletcher.github.io/MultiMarkdown-6/syntax/critic.html
- lang-criticmarkup — https://github.com/nathanlesage/lang-criticmarkup/blob/main/README.md
- criticmarkup-parser (Fevol) — https://github.com/Fevol/criticmarkup-parser
- CodeMirror parse-context (secondary) — https://deepwiki.com/codemirror/language/2.2-parse-context-and-syntax-tree
- typometer (typing-latency measurement) — https://github.com/pavelfatin/typometer
- CM6 performance discussion — https://discuss.codemirror.net/t/measuring-performance-in-cm6/5005

*Confidence note: all seven findings are high-confidence (3-0 verification). Applicability analysis to
`document-core` is engineering inference from the confirmed mechanisms plus this repo's ADRs, not a
statement from the cited upstreams.*
