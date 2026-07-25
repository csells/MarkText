# 0004 — Can an OSS Rust markdown parser replace document-core?

- **Type:** Research (external evidence, adversarially verified + cross-checked against an
  independent Gemini Deep Research run)
- **Created:** 2026-07-24
- **Question:** Which open-source Rust markdown parsers/parsing engines could replace the custom
  TypeScript `@marktext/document-core` engine being built on `feat/native-criticmarkup`?
- **Method:** Two independent deep-research runs over the same requirement set:
  1. Claude deep-research harness — 5 search angles, 19 sources fetched, 94 claims extracted,
     25 adversarially verified (3-vote), 2 killed, synthesized to 10 findings.
  2. Google Gemini Deep Research — independent report from the same prompt
     (`Rust_Markdown_Parsers_Evaluation.pdf`).
     Where the two disagree, this document records which claims survived primary-source verification.
- **Requirements evaluated against** (from plan 0009 and the document-core architecture):
  (1) source-authoritative & lossless (exact byte provenance, lossless round-trip);
  (2) incremental per-keystroke reparse; (3) CriticMarkup as intrinsic single-pass grammar,
  including multi-block spans — no sidecar scanner; (4) CommonMark + GFM + math + front matter;
  (5) error tolerance mid-edit; (6) WASM/Electron-sandboxed-renderer embeddability;
  (7) MIT-compatible license.

## TL;DR — both runs converge on the headline

**No existing OSS Rust markdown parser can replace document-core wholesale. Every candidate fails
at least one hard requirement.** The two runs disagree on the recommended fallback: Gemini
recommends forking `tree-sitter-markdown`; the verified evidence collected here says that grammar
is disqualified by its own README, and the honest alternatives are (a) keep building document-core,
(b) fork `markdown-rs` and build incrementality on top, or (c) write a _new_ single-grammar
tree-sitter(-like) markdown+CriticMarkup grammar from scratch — each substantial engineering.

## Verified findings (Claude run; vote margins shown)

### F1 — tree-sitter core is the only ecosystem with genuine incremental CST parsing · 3-0

Tree-sitter "can build a concrete syntax tree for a source file and efficiently update the syntax
tree as the source file is edited" (tree-edit + fragment reuse), with official Rust and WASM
bindings and a dependency-free pure-C runtime. The "fast enough to parse on every keystroke" claim
survived only **2-1** — it is a stated aim, and it covers the core C library, not the WASM +
markdown-grammar configuration MarkText would actually run.

### F2 — but both tree-sitter _markdown grammars_ are disqualifying · 3-0 (all five sub-claims)

- The maintained `tree-sitter-grammars/tree-sitter-markdown` is **split into separate block and
  inline grammars requiring two parses** (`ts_parser_set_included_ranges`) — architecturally the
  same block-phase→separate-inline-authority split that plan 0009's "no second pass" law forbids,
  and it forecloses intrinsic multi-block CriticMarkup.
- Its README explicitly disclaims correctness: "there are still lots of inaccuracies in the
  output. As such it is not recommended to use this parser where correctness is important" —
  fatal for a source-authoritative engine and requirement (4).
- Its WASM build "does not work out of the box" (external scanner uses unexported C functions;
  static-linking workaround required) — verified current as of 2026-07-24.
- The older `ikatyang/tree-sitter-markdown` targets CommonMark 0.29-gfm and hard-codes the
  assumption that reference-link label matching never fails, because forward references otherwise
  make correct incremental parsing infeasible — a documented correctness-for-incrementality trade.

### F3/F4 — markdown-rs: best provenance and spec coverage; no incrementality, no extension API · 3-0

`wooorm/markdown-rs` is 100% CommonMark + 100% GFM with math and front matter built in, and its
tokenizer "accounts for every byte" with positional info — the strongest requirement-(1)/(4) story
of the batch parsers, though it makes **no lossless round-trip guarantee**. It fails (2) and (3):
whole-document state machine, no fragment reuse, and extensions are compiled-in toggles with no
public API for user-defined syntax (extension-API issue #32 open since Dec 2022) — CriticMarkup
means a fork. `#![no_std]+alloc` design makes WASM compilation straightforward (mdxjs-rs ships it).

### F5/F6 — pulldown-cmark and comrak: fast, positioned, but not lossless and not incremental · 3-0

pulldown-cmark is an event stream that deliberately builds no tree; `into_offset_iter()` gives
byte spans per event, but there is no CST, no round-trip, no incrementality, and no grammar
extension surface. Comrak is CommonMark 0.31.2 + full GFM (652/652, 670/670 spec tests) with front
matter and math built in, but it is a mutable arena AST, batch-only, sourcepos is line/column
rather than byte spans, and its extension points are output-side, not grammar-side.
(BSD-2-Clause — MIT-compatible.)

### F7 — markdown-it.rs is the only batch candidate with genuine same-pass grammar extensibility · 3-0

In `markdown-it-rust/markdown-it`, CommonMark itself is a plugin; custom rules of arbitrary
complexity run in the same pipeline, with source maps on all nodes including inlines. But its
block-then-inline two-phase model makes multi-block CriticMarkup hard, it has no incrementality or
lossless CST, and the project self-describes as an alpha/beta tech preview.

### F8 — jotdown parses Djot, not Markdown · 3-0. Disqualified on requirement (4).

### F9 — full-reparse-per-keystroke is not obviously absurd for the fast parsers · 3-0 (medium confidence)

On md-rosetta-rs, pulldown-cmark/comrak/jotdown parse the corpus in ~2 ms native release builds vs
~11 ms for markdown-rs (~5×). A 2 ms full reparse could make batch-per-keystroke viable on typical
documents — but the benchmark has ms-granularity rounding, an unspecified corpus, and measures
native builds, **not** the WASM boundary; and speed does not repair losslessness or intrinsic CM.
(Consistent with this branch's own research 0003 on full-parse latency.)

### Killed claims (failed adversarial verification, 1-2)

- "pulldown-cmark targets full CommonMark compliance [+ specific extension list]" — the composite
  claim did not survive; this report does not assert pulldown-cmark's exact coverage.
- "Tree-sitter is robust to syntax errors, matching the error-tolerance requirement" — refuted as
  an overreach: the README line is a design aim scoped to highlighting-grade results; independent
  reports document poor/unpredictable error recovery on real mid-edit states. Requirement (5) is
  **not** verified for tree-sitter, contrary to its reputation.

## Where the Gemini report agrees, diverges, and errs

**Agreement (independent replication — high confidence):** no wholesale replacement exists;
event-stream (pulldown-cmark, jotdown) and batch-AST (comrak, markdown-rs, markdown-it.rs)
architectures fail incrementality/losslessness; tree-sitter core is the only incremental-CST
ecosystem with mature WASM (tree in WASM memory, pointer-based access avoids per-keystroke
serialization); a rowan/Typst-style red-green-tree markdown parser would be ideal but does not
exist, and building one means writing a CommonMark parser from scratch.

**Divergences, with resolution:**

1. **Gemini's headline recommendation — fork `tree-sitter-markdown` — is undermined by the
   grammar's own README** (F2, verified verbatim 3-0). Gemini presents the dual block/inline
   grammar as a strength and proposes defining `{++`/`++}` "ambiguously as both inline lexical
   elements and block containers," resolved by GLR. The split-grammar design makes that a
   _cross-grammar_ problem GLR cannot see (inline content is a second parse over included ranges),
   and Gemini's report never mentions the grammar's correctness disclaimer, the two-parse
   architecture's conflict with the single-pass law, or the WASM static-linking caveat. A
   tree-sitter path is really option (c): a **new** single-grammar markdown+CM grammar — rewriting
   what the existing grammars got wrong, not forking them.
2. **Error tolerance:** Gemini states mid-edit states "naturally resolve to ERROR nodes ... leaving
   the surrounding document perfectly intact." That exact claim was killed 1-2 in verification.
3. **markdown-rs performance:** Gemini cites the quadratic edit-path issue (#113, large-MDX
   pathologies); this run measured the ~5× rosetta gap. Complementary evidence, same direction.
4. **markdown-it.rs:** Gemini dismisses it outright (alpha, AST, batch); the verified run confirms
   the alpha status and missing incrementality but credits the one property no other batch parser
   has — CommonMark-as-a-plugin same-pass extensibility with full inline source maps.
5. **Prior art:** Gemini surfaces Rust CriticMarkup users — Marko Editor (GTK4 WYSIWYG using CM as
   diffable storage; its README concedes weak while-typing formatting) and CaSILE (batch PDF
   diffs) are real but batch/native, not incremental engines. Its "Quoin" macOS editor citation is
   weakly sourced and unverified. The Claude run's open question stands: **no reusable Rust
   CriticMarkup parser implementation surfaced in either run.**

## Consequence for plan 0009

Adopting Rust today would buy raw parse speed while forfeiting the properties document-core is
being built for: lossless source authority, intrinsic single-pass CriticMarkup with multi-block
spans, per-view projections with exact segment maps, and (per research 0001/0003) an
incremental-reuse path that no Rust candidate provides off the shelf either. Every Rust path is a
fork-plus-build (markdown-rs) or a from-scratch grammar (tree-sitter/rowan) that re-implements
precisely the hard parts document-core already encodes. If Rust is ever pursued, the strongest
candidates are markdown-rs-as-fork (provenance + spec coverage) or a purpose-built single-grammar
incremental engine; neither obsoletes the current work, and both would need the same acceptance
corpus this branch already has.

## Open questions

1. Real per-keystroke WASM-boundary latency in a sandboxed Electron renderer for each candidate
   (unmeasured everywhere; decisive for the "fast batch reparse" alternative).
2. Whether wooorm would accept upstream extension-API work on markdown-rs (#32), or a fork is
   permanent.
3. Whether a Lezer/Typst-style hand-written incremental parser hosts markdown+CM more practically
   than tree-sitter's GLR — markdown resisted GLR description badly enough to force the external
   scanner and the two-grammar split.

## Sources

Primary: github.com/tree-sitter/tree-sitter · tree-sitter-grammars/tree-sitter-markdown ·
ikatyang/tree-sitter-markdown · wooorm/markdown-rs (+ issues #32, #113) · pulldown-cmark ·
kivikakk/comrak · markdown-it-rust/markdown-it · hellux/jotdown · rosetta-rs/md-rosetta-rs ·
rust-analyzer/rowan (issue #73). Cross-run: Gemini Deep Research report
"Architectural Analysis of Rust-Based Markdown Parsing Engines for Sandboxed WYSIWYG
Environments" (2026-07-24), citing additionally mmMike/marko-editor, alerque/casile,
ck37/tree-sitter-quarto, Byron/pulldown-cmark-to-cmark, nberlette/comrak-wasm.
