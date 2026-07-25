# 0008 — Final wide engine sweep: verdict and prior-art digest

- **Type:** Research (adversarially verified; the closing sweep commissioned by the owner at the
  2026-07-25 requirements grilling, before committing to the custom build)
- **Created:** 2026-07-25
- **Question:** Does ANY existing parser/engine — any language, architecture, mainstream or
  research — satisfy or come materially close to the ratified R-1…R-7 set (plan 0009)? And what
  prior art exists for the hardest requirement, form-(a) cross-block spans, even in
  non-adoptable systems?
- **Method:** deep-research harness, 102 agents, 700 tool calls; five angles (unevaluated
  mainstream engines · incremental-parsing research · overlapping-span prior art ·
  editor-internal engines · contrarian hunt for any form-(a) implementation); 21 claims survived
  3-vote adversarial verification (19 at 3-0), 4 sharper sub-claims refuted and excluded.
  Raw findings: `sources/claude-deep-research-wide-sweep.json`.

## Verdict

**No adoptable engine exists; the sweep confirms the custom build** (owner ruling on the gate
still pending — this document is the input to it). Every newly evaluated engine with a public
extension API fails R-1+R-2 for the same architectural reason as the twelve previously swept:
CommonMark's canonical block-then-inline two-phase strategy freezes block boundaries before any
inline recognition, and every cross-block escape hatch is a post-parse pass.

**And the contrarian angle came back empty in a meaningful way:** no implementation anywhere —
mainstream, research, or production tracked-changes — parses form-(a) cross-block spans as
first-class single-pass productions. Even **Microsoft Word**, the most battle-tested
track-changes system in existence, internally decomposes a cross-paragraph deletion into
per-block deletions plus a `w:del` flag on the paragraph-mark token (ECMA-376, verified
verbatim: the deleted paragraph mark means the paragraph's contents "are combined with the
following paragraph"). Word's _gesture_ is one suggestion; its _model_ is fragments plus
boundary flags. R-1 as ratified goes beyond every model surveyed — a deliberate, now
fully-priced choice.

## Per-engine verdicts (all 3-0, verified against parser source, not docs alone)

| Engine                                    | Wall                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **markdig** (C#)                          | Inline parsing is a strictly separate second phase per-LeafBlock after the block tree is fixed; even its own emphasis/link pairing is temporary `DelimiterInline` nodes + a post-processing rewire — the exact mechanism R-2 excludes. Cross-block hooks (`DocumentProcessed`) are post-parse. |
| **goldmark** (Go, Hugo's engine)          | Two-phase; delimiter resolution deferred to end-of-block; an InlineParser physically cannot see another block's text (`parseBlock` resets the reader to the current block's segments). Whole-document hook = post-parse `ASTTransformer`.                                                      |
| **intellij-markdown** (Kotlin, JetBrains) | "Two logical parts" by its own README; extension surface plugs into fixed slots inside that pipeline; escaping it means replacing `MarkdownParser` itself. (Its new `parseStreaming` machinery is a harvest lead — open question below.)                                                       |
| **@lezer/markdown** (revisited)           | Reconfirmed as both the strongest existence proof (production hand-written single-pass incremental JS markdown parsing — R-5 is achievable in JS) and the clearest ceiling: the maintainer states flatly that inline elements cannot continue beyond a block's end.                            |

Precision note carried from verification (the sweep's own caveat): "structurally forecloses"
must be read exactly — stateful extensions CAN pair markers across blocks in several engines;
what none can do is emit **one first-class cross-block entity in-pass without post-parse
revision**, which is what R-1+R-2 jointly require. Four sharper sub-claims that overstated
individual walls were refuted 0-3/1-2 and excluded; the surviving conclusions don't depend on
them. flexmark-java, commonmark-java, swift-markdown, and mistune produced no surviving claims
in this run — closed out in the addendum below (all four fail R-1+R-2). Closed editors (Typora,
Bear, Ulysses, iA Writer) are unverifiable from primary sources; Obsidian's use of
@lezer/markdown is confirmed.

## Prior-art digest (the sweep's real yield)

1. **Wagner & Graham (TOPLAS 1998; tree-sitter's ancestry)** — incremental reparse in
   O(t + s·lg N), location-independent, multi-site; **optimal node reuse formulated
   independently of the parsing algorithm** (direct prior art for R-3's stable identity across
   reparses); and the finding that **balancing lengthy sequences is THE decisive structure** —
   the top-level block list must be a balanced sequence, not a linked list. Transfer at the
   level of technique and invariants, not code (known published bugs, later fixed by Diekmann
   2019).
2. **Peritext (Ink & Switch)** — the strongest overlay-span prior art: standoff formatting
   operations anchored to **the gaps before/after stable per-character identities**, explicitly
   contrasted with tree representations. Scoped to within-paragraph inline formatting (so NOT
   R-1 prior art), but the gap-anchor semantics is the design vocabulary for the span store.
   Open question: the source-authoritative analogue of a stable atom identity under incremental
   reparse.
3. **GODDAG (Sperberg-McQueen & Huyssteen)** — the formal grounding for R-7: "Overlap is
   multiple parentage." One span node dominated by containers in different hierarchies; every
   strictly-nested workaround (milestones, fragmentation, CONCUR) sacrifices first-class status.
   Exactly the shape of a form-(a) span.
4. **OOXML boundary-token semantics** — the `w:del`-on-paragraph-mark model is the **semantic
   oracle for paragraph-break deletion** (what "accept" means at a block boundary: merge, with
   normative rules), even though its fragment representation is what R-1 rejects.
5. **@blocknote/prosemirror-suggest-changes** — closest editor-world precedent for the overlay
   authority: suggestions as three overlay mark types on the node tree (including block marks),
   destructive edits intercepted into mark additions; cross-block suggestions remain id-grouped
   fragments — overlay-mark concept and editor-mount projection pattern, not R-1.
6. **Eco / language boxes** — negative result worth keeping: the flagship composed-language
   incremental editor is strictly nested (tree-of-trees) and not source-authoritative; it
   confirms the strictly-nested ceiling R-7's graph is designed to break.

## Consequences

1. The harvest list grows to include Wagner & Graham's balanced-sequence mandate and reuse
   formulation, Peritext's gap-anchor semantics, and OOXML's boundary-token accept/reject
   oracle (consolidated in `specs/architecture/parser-core-verified-facts.md`).
2. **A genuinely new design obligation surfaced:** accept/reject semantics when a form-(a)
   span's endpoints cross container _types_ (opens mid-paragraph, closes inside a blockquoted
   list item). OOXML's oracle covers only sibling-paragraph merging; the general
   container-boundary case has **no precedent anywhere** and must be designed and specified —
   flagged for the language spec and the plan's corpus obligations.
3. Open lead: intellij-markdown's `parseStreaming`/`unstableStartOffset` machinery as an
   error-tolerance/incrementality harvest. (The four-family confirmation pass is done — see
   the addendum.)

## Disposition

This was the owner-commissioned closing check. With it, the evidence chain is:
0004 (Rust) → 0005 (CM semantics) → 0006 (TS gap analysis) → 0007 (executed spikes) →
0008 (wide sweep): five independent methods, one convergent answer. The build-versus-adopt gate
in plan 0009 now awaits the owner's ruling with nothing left unexamined except closed-source
editors (the four previously-unassessed families are closed out in the addendum below).

## Addendum (2026-07-25) — close-out of the four unassessed families

At the owner's direction, a dedicated pass closed out flexmark-java, commonmark-java,
swift-markdown, and mistune against the deciding pair R-1+R-2. Method: deep-research harness,
102 agents; 25 claims 3-vote verified (all 3-0) covering flexmark-java and commonmark-java to
source level; the run's synthesis step died on a usage limit, so swift-markdown and mistune
claims are extracted-with-quotes and were then spot-verified directly against source by hand
(files fetched and inspected; citations below). Raw claims:
`sources/claude-deep-research-closeout-four-families.json`.

**All four fail R-1+R-2 on their public APIs. The sweep is now formally exhaustive over every
open-source engine family named in any phase of this research arc.**

- **flexmark-java** (deepest extension surface of the four; 18 verified claims): strictly
  two-phase (`DocumentParser.parse()` runs `PARSE_BLOCKS` to completion, then
  `PARSE_INLINES`); inline recognition invoked per finalized block (`processInlines()`
  iterates block parsers); delimiter/bracket state **reset at the start of every per-block
  parse and flushed at its end** (`processDelimiters(null)` per block), so a pending `{++`
  cannot survive into the next block; the complete `Parser.Builder` hook inventory attaches
  only to the block phase, the per-block inline phase, or post-parse. The maintainer's own
  guidance for paired custom constructs is a PostProcessor over the finished AST, with the
  explicit caveat that already-made recognition decisions persist — the exact mechanism R-2
  excludes. Harvest note: its celebrated source-fidelity/lossless AST is a **retrofit onto a
  commonmark-java fork** — exact-source reconstruction at unchanged two-phase recognition —
  confirming source fidelity and cross-block recognition are independent axes; its
  position-preservation design is prior art for P2, nothing more.
- **commonmark-java** (7 verified claims): the reference two-phase shape flexmark inherited —
  per-block `InlineParserImpl.parse(SourceLines, Node)` with `reset(lines)` destroying
  delimiter/bracket stacks between blocks, `processDelimiters(null)` flushing per block, the
  public extension surface (InlineContentParserFactory, DelimiterProcessor) wired into that
  per-block parser, and `postProcess(document)` running only after the whole parse.
- **swift-markdown** (extracted claims + hand spot-verified): not a parser at all for these
  purposes — `CommonMarkConverter.swift` delegates wholesale to cmark-gfm
  (`cmark_parser_new/feed/finish`, verified in source); no user grammar extensions exist (only
  cmark-gfm's precompiled extension set, not even runtime-toggleable on the shipped API); its
  one grammar-level feature (block directives) is a Swift-side **pre-pass**
  (`BlockDirectiveParser`'s `ParseContainer`/`.lineRun` segmentation, verified in source) that
  feeds cmark independent per-segment sub-documents — so an inline construct cannot even span
  two _segments_, let alone two blocks; the Swift layer above is `MarkupVisitor`/
  `MarkupRewriter` post-parse tree rewriting.
- **mistune** (extracted claims + hand spot-verified): strictly two-phase, verified in source —
  `Markdown.parse` runs `self.block.parse(state)` to completion and inline parsing happens
  during rendering; `InlineParser.__call__(s, env)` receives a single block's text as its
  entire universe (`state.src = s`); block-plugin patterns must anchor at line starts
  (documented "MUST startswith ^"), so a mid-sentence opener cannot start a block rule.

No candidate produced a counterexample to the universal conclusion; no community extension in
any of the four ecosystems was found to have crossed a block boundary in-pass. Evidence-grade
note: flexmark/commonmark-java verdicts are 3-0 panel-verified; swift-markdown/mistune verdicts
rest on extracted primary-source quotes plus direct source inspection — a lower formal grade,
flagged here rather than silently blended.
