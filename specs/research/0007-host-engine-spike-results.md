# 0007 — Host-engine experiment: durable results

- **Type:** Closed decision record
- **Created:** 2026-07-25
- **Question:** Can `@lezer/markdown` or `micromark` host Profile 1, especially a
  CriticMarkup annotation that opens mid-paragraph and closes mid-inline in a later block,
  through their public extension APIs?
- **Evidence status:** The experiment artifacts were deleted after the decision facts and
  regression inputs were transferred. This record is not a competing parser or test
  authority; Profile 1 and the document-core corpus own the expected behavior.

## Verdict

Neither host can express Profile 1's mid-inline, multi-block CriticMarkup spans inside its
parse through its public API without violating other Profile 1 rules. Research 0006's
go/no-go therefore ended at outcome 3: build the source-authoritative document-core parser.

The decisive walls were:

- **`@lezer/markdown`:** inline contexts are scoped to one block, while composite blocks are
  line-anchored. Treating CriticMarkup markers as inert inline atoms lets Markdown emphasis
  pair across an annotation boundary, so a later pairing pass is retroactively unsound. A
  leaf-observation approach could synthesize a cross-block span only by consuming lines
  irreversibly, pairing through literal regions, breaking fragment reuse, and still producing
  a strictly nested tree that cannot represent a span crossing its container.
- **`micromark`:** text streams end synthetically at each content block, flow and container
  constructs begin only at line starts, and the public extension surface has no hook over the
  merged document event stream. Cross-context pairing would therefore be a second parser over
  internal output rather than intrinsic grammar recognition.

The common cause is structural: both hosts freeze block boundaries before per-block inline
recognition, while Profile 1 permits annotation and Markdown container ranges to cross.

## Durable positive findings

The failed host decision still established reusable facts:

- Both APIs can recognize all five same-block forms with arm-local Markdown, literal unmatched
  markers, recursive same-form nesting, containment, literal precedence, and escaped
  delimiters when the recognition shares the host's active inline pass.
- Both can represent the markers-on-own-lines whole-block enclosure subset. That subset is not
  a substitute for Profile 1's mid-inline, multi-block rule.
- A shared position-advancing lexer naturally enforces the one-lexer rule: a delimiter-like
  sequence inside a literal region cannot close the outer annotation.
- Lezer-style fragment reuse remained valid when CriticMarkup recognition participated in the
  same parse. The experiment measured 97% byte reuse and roughly 30–35× incremental speedup at
  varied edit positions against independent full-parse controls.
- Attention-style delimiter resolution avoided the repeated-lookahead cost seen in a direct
  scan-to-block-end tokenizer.

## Host-level hazards

Two performance hazards became document-core requirements:

1. Stock `@lezer/markdown` emphasis resolution measured superlinear on adversarial delimiter
   runs, and sufficiently deep balanced nesting overflowed the stack. The required response is
   cmark-style openers-bottom discipline plus stack-safe traversal.
2. Scanning from every unclosed CriticMarkup opener to the block end measured quadratic
   (6.5 seconds at 24 KB versus a roughly 1.5 ms host baseline). Delimiter resolution must
   record and pair candidates in a linear pass instead.

## Regression inputs transferred to document-core

The following cases are durable inputs, not expectations delegated to another implementation:

1. All five CriticMarkup forms, including empty payloads and Markdown parsed independently
   inside substitution arms.
2. Unmatched openers and closers remain literal and do not alter surrounding Markdown.
3. Emphasis, links, and annotations contain one another in both directions without pairing
   across a completed annotation boundary.
4. Recursive and same-form nesting preserve exact source ranges.
5. Substitution uses the first valid top-level divider; nested dividers, dividers in literal
   regions, stray dividers, and divider hijacking cannot split the wrong arm.
6. Code spans and fenced code own marker-like text, including closer-shaped text; escaped
   delimiters follow Profile 1's backslash rules.
7. A mid-inline opener may close mid-inline after paragraphs, lists, blockquotes, headings, or
   other block boundaries while source order and container membership remain lossless.
8. Link-versus-annotation overlap follows Profile 1's explicit tie-break rather than host
   eagerness.
9. Long runs of unmatched openers, delimiter runs, and deep balanced nesting stay linear and
   stack-safe.
10. Incremental parses at document start, middle, and end equal independent full parses while
    reusing only unaffected structure.

## Consequences

- The document-core syntax graph beside its Markdown block structure is required by the
  language shape, not an optional host abstraction.
- Host implementations and their output are not conformance oracles. Their test corpora,
  delimiter hardening, and incremental-reuse techniques may be harvested only after expected
  results are written in Profile 1 and target-owned tests.
- Research 0006 remains the candidate analysis; this record closes its experiment and
  preserves the evidence that still constrains document-core.
