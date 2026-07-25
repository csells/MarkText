# MarkText Markdown Profile 1 — Language Specification

- **Status:** Draft 1 for owner review (2026-07-24)
- **Identifiers:** `markdownProfile: 'markdown-profile-1'` ·
  `criticMarkupProfile: 'marktext-profile-1'`
- **Derived from:** plan 0009 settled decisions and ADRs 0005–0013; research 0004 (Rust OSS
  parser evaluation), research 0005 (CriticMarkup ecosystem semantics, adversarially verified);
  the canonical CriticMarkup specification; owner rulings recorded 2026-07-24.
- **Audience:** the document-core parser, its test corpus, adapters, and any future
  reimplementation (including a port). This document defines the _language_; plan 0009 owns the
  _architecture and migration_. Where implementation status lags this document, this document is
  the target.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as in RFC 2119.

---

## 1. Scope and design principles

Profile 1 is the complete composed language that MarkText documents are written in: a pinned
CommonMark base, a pinned GFM extension set, MarkText's built-in constructs, and the five
CriticMarkup annotation forms as **intrinsic productions of the same grammar**. One parser
recognizes all of it in one pass; there is no separate CriticMarkup scanner, prepass, overlay, or
post-processor (plan 0009, architectural law; the forbidden architectures listed there apply to
this specification's conforming implementations).

Principles every rule below serves:

- **P1 — Total language.** Every sequence of Unicode text is a valid Profile 1 document. There
  are no syntax errors, only constructs that form or fail to form. A conforming parser MUST
  produce a complete parse for any input, including every mid-edit prefix of a document.
- **P2 — Source authority and losslessness.** The decoded source text is the single authority.
  The parse product accounts for every code unit exactly once, and serializing a revision
  reproduces the source byte-for-byte (BOM, line-ending spellings, blank lines, marker
  spellings, escapes, trailing-space trivia, missing final newline). Normalization is only ever
  an explicit transform (plan 0009 decision 3).
- **P3 — One decision per source run.** Literal ownership and CriticMarkup delimiter activity
  are decided once, in one left-to-right pass, at the moment the parser reaches that source run.
  No later stage — projection, materialization, adapter, consumer — may revise a recognition
  decision (plan 0009 decision 2; §7).
- **P4 — Views are reads.** Original, Revised, and the editing view are reads of one parse by
  arm selection, never independent reparses of assembled strings; where eliding a marker changes
  block structure, the parse forks locally and reconverges at a safe point (§10).
- **P5 — Rulings are named.** Behavior the upstream CriticMarkup prose leaves undefined is a
  versioned MarkText ruling, tested as such, and never attributed to the canonical specification
  (plan 0009 decision 4). §12 ledgers every deliberate divergence from reference tools.

### 1.1 Offsets and text model

Offsets in this specification and in every Profile 1 API are **UTF-16 code-unit indices** into
the decoded source tape. A conforming parser MUST leave no code unit unowned (the scanner
enforces this invariant). Line endings are LF, CRLF, or CR; all three delimit lines and are
preserved exactly. A leading U+FEFF is part of the tape, owned as trivia, and preserved.

---

## 2. Layer A — CommonMark base (pinned)

Profile 1's Markdown base is **CommonMark 0.31.2**, incorporated by reference. All CommonMark
block and inline constructs are in the language: ATX and setext headings, thematic breaks,
paragraphs, block quotes, ordered/bullet lists and list items, indented and fenced code blocks,
HTML blocks, link reference definitions, inline code spans, emphasis and strong emphasis, links,
images, autolinks, raw inline HTML, hard and soft breaks, backslash escapes, and entity
references — with CommonMark's own precedence and tie-breaking rules, except where a later layer
of this document explicitly extends or interacts with them.

A change of pinned CommonMark version is a new Profile (see §14).

## 3. Layer B — GFM extension set (pinned)

Profile 1 includes these GFM extensions, per the GFM spec's definitions:

- **Tables** (pipe tables with a delimiter row; `\|` writes a literal pipe in a cell).
- **Task list items** (`[ ]` / `[x]` markers at list-item start).
- **Strikethrough** (`~~…~~`). See §9.6 for the required disambiguation against the
  CriticMarkup substitution closer.
- **Autolinks (extended)** as GFM defines them.

GFM constructs participate in the single grammar like any CommonMark construct.

## 4. Layer C — MarkText built-in constructs

- **YAML front matter.** A `---` line at the very start of the tape (offset 0, or immediately
  after a BOM) opens front matter, closed by a `---` or `...` line. Front matter is a literal
  range: no Markdown and no CriticMarkup is recognized inside it (§7). A `---` line anywhere
  else is ordinary Markdown (setext underline or thematic break per CommonMark).
- **Inline math.** `$…$` spans, recognized as a literal range with CommonMark-code-span-like
  ownership (§7).
- **Math blocks.** A fenced block whose info string is `math` (case-insensitive), or `$$`
  blocks; content is a literal range.
- **Diagram blocks.** A fenced code block whose info string names one of the diagram languages
  `flowchart`, `mermaid`, `plantuml`, `sequence`, `vega-lite` is a diagram block; content is a
  literal range. The language list is normative to Profile 1.
- **Footnotes.** Footnote references (`[^label]`) and footnote definitions; a footnote
  definition's block is tracked with its own literal/ownership rules.

Adding, removing, or renaming any built-in changes what previously-literal text means and is
therefore a new Profile (§14).

---

## 5. Layer D — CriticMarkup: surface forms

Profile 1 recognizes exactly the five canonical forms, with exactly these delimiters:

| Form         | Production                   | Payloads             |
| ------------ | ---------------------------- | -------------------- |
| Addition     | `{++` _new_ `++}`            | _new_                |
| Deletion     | `{--` _old_ `--}`            | _old_                |
| Substitution | `{~~` _old_ `~>` _new_ `~~}` | _old_ arm, _new_ arm |
| Highlight    | `{==` _text_ `==}`           | _text_               |
| Comment      | `{>>` _metadata_ `<<}`       | _metadata_           |

- **CM1.** Delimiters are exactly the ASCII sequences above. Profile 1 MUST NOT recognize
  HTML-entity or tag aliases (`{<del>`, `{&gt;&gt;`, …) or in-annotation metadata separators
  (`@@`); those are third-party extensions (research 0005, Fevol inspection) and their
  characters are ordinary payload text.
- **CM2.** Empty payloads are valid: `{++++}`, `{----}`, `{~~~>~~}`, `{====}`, `{>><<}` all
  form. `{====}` has no barrier or pairing meaning beyond being an empty Highlight (plan 0009
  decision 6).
- **CM3.** Whitespace inside payloads is payload. Delimiters MUST NOT contain interior
  whitespace (`{ ++` does not open).

## 6. CriticMarkup recognition rules

- **R1 — Same pass.** CM delimiters are recognized by the same left-to-right parse that
  recognizes Markdown, subject to literal ownership (§7). There is no separate CM pass.
- **R2 — Pairing.** An opener forms an annotation if and only if its matching closer occurs
  later in the document, found by properly-nested pairing (§6.1) during the single scan. An
  opener with no closer, and a closer with no opener, are **literal text** — they form nothing,
  consume nothing, and MUST NOT affect recognition of any later construct. This holds
  identically for complete documents and for mid-edit states (P1); an unclosed opener MUST NOT
  swallow the remainder of the document (the lang-criticmarkup failure mode is
  non-conforming here).
- **R3 — Multi-block spans (owner ruling, 2026-07-24).** All five forms MAY span line breaks,
  blank lines, and block boundaries. A paragraph-spanning deletion, an addition containing a
  blank line, an annotation enclosing an entire block quote, list, or table — all form. The
  canonical toolkit's DOTALL behavior and MMD-6's accept/reject path are precedent; the
  single-block confinement found in some renderers is a parser artifact Profile 1 rejects
  (research 0005 Q1). Structural consequences for the projections are handled by fork semantics
  (§10), not by refusing recognition. Bounds:
  - **R3a.** An annotation MUST NOT start or end _inside_ a literal range (§7) — but may
    enclose one whole.
  - **R3b.** Within a table, each cell is a containment region: an annotation that opens inside
    a cell must close inside the same cell. An unescaped `|` retains its structural, cell-
    delimiting role even between CM markers; write `\|` for a literal pipe inside an annotation
    in a table. An annotation MAY instead enclose the entire table (open before its first row,
    close after its last). Annotations spanning _some but not all_ of a table's rows do not
    form (openers/closers are literal). _(Profile 1 ruling — ecosystem silent, research 0005
    Q9.)_
- **R4 — Substitution divider.** Exactly one `~>` at the top nesting level of a substitution's
  payload divides _old_ from _new_. A `~>` anywhere outside a substitution payload is literal
  text. Profile 1 deliberately diverges from MMD-6, which erases stray `~>` tokens (research
  0005 Q10); see §12. A substitution containing no top-level `~>` does not form (all its
  delimiters are literal). Additional top-level `~>` sequences after the first are payload text
  of the _new_ arm.
- **R5 — Comment opacity.** A Comment's payload is opaque, unstructured metadata: no Markdown
  and no CriticMarkup is recognized inside `{>> … <<}`. The payload ends at the first
  subsequent `<<}` (subject to escaping, §8). Imported author initials, timestamps, or
  Markdown-looking text are preserved byte-exact (plan 0009 CM_STANDARD). Consequence: a
  literal `<<}` cannot appear unescaped in a comment.
- **R6 — Highlight content.** A Highlight's payload is ordinary Markdown (and may contain
  nested CM, §6.1) — its text is present in both projections, so it parses like surrounding
  text.
- **R7 — Addition/Deletion/Substitution arms.** Each payload/arm is an **arm-local Markdown
  fragment**: full inline Markdown, and — when the arm spans block boundaries (R3) — full block
  structure, parsed with parser-created identity. See §9.1 for containment.

### 6.1 Nesting

- **N1.** Annotations nest recursively: any of the five forms may appear inside an Addition,
  Deletion, or Substitution arm, or inside a Highlight payload — including the same form inside
  itself. Pairing is properly nested: `{--a{--b--}c--}` is a Deletion containing a Deletion,
  matching MMD-6's tested recursive semantics (`accept({++foo{--bat--}bar++}) = "foobar"`;
  `reject({--foo{-- bat --}bar--}) = "foo bat bar"` — both are conformance oracles, research
  0005 Q5).
- **N2.** Nothing nests inside a Comment (R5).
- **N3.** Nesting depth MAY be bounded by the active limits profile (§13); at the bound, inner
  openers are literal text (graceful degradation, never an error state).

## 7. Literal precedence — the one-lexer rule

Certain constructs own their source ranges as **literal ranges**: inline code spans, fenced code
blocks (including math and diagram blocks), indented code blocks, `$…$` / `$$` math, autolinks,
link destinations, link reference definitions, HTML blocks, inline HTML, front matter, and
footnote-definition tracking ranges.

- **L1.** Inside a literal range, CM delimiters are data. `` `{++` `` is a code span containing
  four characters; a fenced code block containing `{++ … ++}` renders those bytes verbatim.
  _(Profile 1 ruling: the reference tools protect nothing — research 0005 Q2 — and that
  behavior is universally a defect class; Profile 1 diverges deliberately, see §12.)_
- **L2.** Ownership is decided by one composed lexer in one pass: candidates are ordered by
  start offset (earliest start wins; on ties, the longer range), and once a range is owned, any
  construct starting inside it is data and cannot extend ownership past the owner's end
  (`composeMarkdownLiteralRanges` is the reference algorithm). Symmetrically, a literal-range
  **L2a — the arm-boundary fixpoint (owner-ratified 2026-07-25; ADR-0014).** When an inline literal opens inside
  an annotation payload and its would-be completing run lies at or past the payload's closer
  candidate, two self-consistent readings exist: defer the closer (extending the arm until the
  literal completes) or let it stand (the literal never completes; C1 forbids the
  cross-boundary pair). Profile 1 rules for **the closer standing**: the arm ends at its first
  unowned closer candidate, the open literal degrades per C1/T2, and no closer decision ever
  requires lookahead past the candidate. Rationale: C1's both-endpoints-in-arm rule applied at
  the smallest fixpoint; locality (decisions never depend on text beyond the candidate — the
  R-6 and incrementality-friendly choice); and comment opacity (R5) falls out with no special
  case. Diverges from the shared-loop reading the `@lezer/markdown` spike exhibited (research
  0007's L2 row) — ledgered as D8.
  opener that begins inside an already-open CM payload is arm-local (§9.1): it must complete
  within the arm or it does not form.
- **L3.** No consumer, projection, or adapter may re-recognize CriticMarkup in any flattened
  string (plan 0009 architectural law). Recognition happens exactly once, here.

## 8. Escaping

- **E1.** CriticMarkup delimiters participate in CommonMark backslash-escape semantics, because
  they are ASCII-punctuation sequences inside the same grammar. An escaped character cannot
  serve as part of a CM delimiter: `\{++x++}` renders literal `{++x++}` (the `{` is escaped, so
  no opener forms and the trailing `++}` is a closer with no opener — literal by R2).
  Within a payload, escaping any character of a closing sequence prevents it from closing:
  `{++a \++} b++}` is an Addition whose payload is `a ++} b` (with the escape preserved in
  source, per P2). The same mechanism writes a literal `~>` (`\~>`) or `<<}` (`\<<}` or
  `<<\}`) inside payloads.
- **E2.** Code spans remain the interoperable escape (`` `{++` ``), per L1 — this is the only
  escape that also survives the reference tools.
- **E3.** E1 is a MarkText extension: no reference implementation has any escape mechanism
  (research 0005 Q8). The divergence is ledgered in §12, and E1 MUST be presented in user-facing
  docs as MarkText-specific.

## 9. Interactions with Markdown constructs

### 9.1 Containment (ADR-0010, generalized)

Every annotation payload boundary — opener, closer, and the `~>` divider — is a **containment
boundary for paired Markdown state**:

- **C1.** Paired inline syntax (emphasis, strong, strikethrough, links, images, code spans,
  math spans) with one endpoint inside a payload/arm must have both endpoints in that same
  payload/arm. State opened inside an arm neither inherits open matching state from outside nor
  exports state past the closer or across `~>`. Where the pairing cannot complete in-arm, the
  inline construct does not form (its delimiters are text); the annotation still forms.
  `{~~*italic~>plain~~}*` contains no emphasis anywhere. This is the ecosystem's one true
  consensus (toolkit "Wrap Markdown Tags Completely"; MMD-6's documented cross-span
  limitation — research 0005 Q3/Q4).
- **C2.** Symmetrically, paired syntax fully outside may enclose a whole annotation:
  `*a {++b++} c*` is emphasis containing an Addition.
- **C3.** Link reference definitions written inside an arm are arm-local: they resolve
  references only within that arm's fragment (ADR-0010). Reference resolution is otherwise
  per-view: each view resolves reference links against the definitions present in that view
  (§10) — a definition inside a Deletion exists in Original but not Revised.
- **C4.** Table cell edges are containment regions per R3b. List-item and blockquote
  boundaries are _not_ containment boundaries for annotations (R3 allows spanning them); they
  are ordinary block structure inside multi-block payloads.

### 9.2 Block constructs inside payloads

When a payload spans blocks (R3), its interior is parsed as block structure (paragraphs,
headings, lists, quotes, whole literal blocks) in the views where that text is present.
Structure-affecting edge cases are governed by fork semantics (§10): e.g. a Deletion covering a
heading's `# ` produces a heading in Original and a paragraph in Revised.

### 9.3 Headings and thematic breaks

Annotations are valid in heading text. A setext underline or thematic-break line inside a
payload counts as such only in views where the surrounding text supports it (§10). An ATX
heading line beginning inside an arm is arm-local block structure per §9.2.

### 9.4 Lists

Annotations may sit inside list-item text, span items, or enclose whole lists (R3). Task-list
markers are structural: `[x]`→`[ ]` changes are expressed as a Substitution over the marker
(`{~~[x]~>[ ]~~}` at item start), which the views resolve per §10.

### 9.5 Front matter

CM inside front matter is literal (L1). An annotation MUST NOT begin before the front-matter
close and end inside it, nor open inside and close after (R3a). Front matter is only ever the
document head; an Addition cannot _create_ front matter in a projection because a projection is
a genuine parse of the projected source (§10) — if accepting an addition yields a leading
`---` block, the Revised view has front matter. That is the intended consequence of P4.

### 9.6 Strikethrough vs substitution closer

`~~` is both GFM strikethrough and part of `{~~ … ~~}`. Disambiguation is positional and needs
no lookahead beyond pairing: `{~~` is a three-character opener token (CM1); a `~~` run inside a
substitution payload at top level is a candidate strikethrough delimiter unless it is
immediately followed by `}` at the point where the substitution's pairing closes — the closer
`~~}` is matched as a unit during pairing (R2). Inside other payloads and in plain text, `~~`
is ordinary strikethrough. `{~~a ~~b~~ ~>c~~}` is a Substitution whose old arm contains
struck-through `b` (containment per C1).

---

## 10. Views, projections, and accept/reject semantics

Profile 1 documents are read through three views (plan 0009 decisions 10–13):

| Form         | Original (reject-all) | Revised (accept-all) | Editing (Markup) view |
| ------------ | --------------------- | -------------------- | --------------------- |
| Addition     | ∅                     | _new_                | annotation shown      |
| Deletion     | _old_                 | ∅                    | annotation shown      |
| Substitution | _old_                 | _new_                | annotation shown      |
| Highlight    | _text_                | _text_               | annotation shown      |
| Comment      | ∅                     | ∅                    | annotation shown      |

This table is normative and differential-tested against MMD-6's accept/reject processors (the
CuTest matrix in `critic_markup.c` is an imported oracle; REFERENCE_PROJECTION_CONVENTIONS).
Nested annotations resolve recursively per the same table (N1 oracles).

- **V1.** Original and Revised are read-only projections; only the editing and source views
  edit canonical content (plan 0009 decision 10).
- **V2 — Views are reads.** One parse produces one structure; each view is a read of it by arm
  selection. Text that does not change across views is parsed exactly once. Where eliding or
  keeping a marker changes _block structure_ (a deletion spanning `# `, an addition containing
  a blank line), the parse forks across that region, computing both resolutions, and
  reconverges at the next **safe point**: a top-level blank line with no open fenced-code or
  HTML block. Worst case is the bounded O(views·n); the sparse-marker common case is O(n)
  (plan 0009 decision 11; research 0002).
- **V3 — Segment maps.** Every view read and every materialized projection carries an exact,
  gapless, parser-created segment map to canonical offsets (`validateMappedProjection`
  enforces this). Guards may add generated protection to a derived projection; nothing may
  create, repair, or revise CM nodes, ownership runs, reference edges, or diagnostics
  post-parse (plan 0009 architectural law).
- **V4 — Accept/Reject as commands.** Accepting or rejecting an annotation is a typed intent
  that produces an exact source edit (delete marker and non-selected content ranges), then an
  atomic reparse-and-commit of the new revision. Semantics per annotation are the table's
  column applied to that annotation alone. This matches the ecosystem's tested model —
  source-text edit followed by a genuine reparse (MMD-6; research 0005 Q6) — realized without
  string materialization for convergent text.
- **V5 — Highlight/Comment relation.** A gapless, nonempty `{==text==}{>>note<<}` pair is
  presented as one related Review item; the relation is _derived adjacency context_, not parser
  identity, stored intent, or a grammar production (plan 0009 decision 6; toolkit convention;
  lang-criticmarkup sibling-node precedent). A standalone Comment anchors to its own source
  position only.

## 11. Error tolerance

- **T1.** Every input, including every prefix of every input, parses to a complete revision
  (P1). Typing `{++` and stopping is a stable state: the three characters are literal text
  (R2), the surrounding document is unaffected, and the next keystroke re-decides only per
  normal parsing.
- **T2.** Recovery is always _degradation to literal text_ — never dropped bytes, never an
  error sentinel that changes downstream recognition, never consumption to end-of-document.
  MMD-6's unmated-marker passthrough (verified by compilation, research 0005 Q10) is the
  precedent; its stray-`~>` erasure is explicitly non-adopted (R4).
- **T3.** Unfinished arm-local state recovers at the arm boundary (C1) and cannot affect
  source after the annotation.
- **T4.** Diagnostics (e.g. "unclosed marker here") are derived data over the parse and MUST
  NOT alter it.

## 12. Divergence ledger (normative interop notes)

Deliberate, named divergences from reference implementations — each MUST appear in user-facing
compatibility documentation:

| #   | Profile 1 behavior                                                                               | Diverges from                                                              | Rationale                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Literal ranges win over CM markers (L1)                                                          | MMD-6 accept/reject and the toolkit consume markers inside code/math       | Their behavior is an acknowledged defect class (patched piecemeal by MMD's own author)                                                   |
| D2  | Multi-block annotations render (R3)                                                              | MMD-6 _rendering_ treats them as literal (its accept/reject honors them)   | Owner ruling; toolkit precedent; MMD's confinement is a parser artifact. Note MMD's own render/accept asymmetry when documenting interop |
| D3  | Backslash escaping of delimiters (E1)                                                            | No reference tool has any escape                                           | Natural consequence of intrinsic parsing; code-span escape (E2) remains the portable form                                                |
| D4  | Stray `~>` is literal (R4)                                                                       | MMD-6 erases it under accept/reject                                        | Error tolerance (T2)                                                                                                                     |
| D5  | No `{<del>`-style aliases, no `@@` metadata (CM1)                                                | Fevol/Commentator grammar                                                  | Not canonical CM; payload bytes must round-trip                                                                                          |
| D6  | Recursive nesting incl. same-form (N1)                                                           | lang-criticmarkup/Fevol parse nested markers as flat text                  | MMD-6's tested recursion is the authoritative precedent                                                                                  |
| D7  | Comments fully opaque (R5)                                                                       | (matches toolkit/MMD erasure; noted because Highlight payload _is_ parsed) | CM_STANDARD: comment payload is generic metadata                                                                                         |
| D8  | An annotation closer stands against an in-arm open literal whose completion lies beyond it (L2a) | The lezer-host shared-loop reading (research 0007) defers the closer       | C1 at the smallest fixpoint; closer decisions stay lookahead-free (R-6, incrementality)                                                  |

## 13. Complexity and resource model

- **X1.** A full parse of n code units MUST run in O(n) time and memory — no backtracking
  blowup, no quadratic delimiter or edit-map behavior (research 0004's markdown-rs finding is
  the cautionary precedent). Pairing (R2), literal composition (L2), and containment (C1) are
  all single-scan-compatible by construction.
- **X2.** With view forks, worst case is O(views·n) (V2). Convergent text is parsed once
  (plan 0009 decision 11, invariant 21).
- **X3.** Deterministic resource accounting: parses run under a named limits profile
  (`desktop-v1`, `test-unbounded`) and accounting schema (`syntax-accounting-1`) carried in the
  frozen `ParseConfiguration`. Depth-class limits (N3) degrade to literal text, never to
  failure, and identically on every conforming implementation.
- **X4 — Incremental reparse (forward-looking, plan 0009 decision 12).** The language is
  designed so a keystroke can reparse only its changed region with fragment reuse bounded by
  safe points; two non-local features require explicit gating: reference-definition
  environments (C3) and multi-block/unclosed CM pairing (R2/R3), both of which an incremental
  implementation MUST re-key on edits that add or remove delimiters or definitions. Nothing in
  Layers A–D may be extended in a way that forecloses fragment reuse. Incrementality does not
  change this language's meaning: an incremental parse MUST be observationally identical to a
  full parse (same graph, same views, same maps).

## 14. Versioning

- **Y1.** Profile identifiers (§ header) are validated at parse time; unknown identifiers are
  rejected (`validateAndFreezeParseConfiguration`).
- **Y2.** Any change that alters the recognition, structure, projection, or round-trip of any
  existing byte sequence — pinned CommonMark/GFM version bumps, construct additions/removals,
  new escape rules, changed rulings — is a new Profile (`…-profile-2`), never a silent revision
  of Profile 1. Bug fixes that make an implementation conform to _this document_ are not
  version changes.
- **Y3.** `markdownProfile` and `criticMarkupProfile` version two aspects of one grammar; they
  MUST NOT select peer pipelines (plan 0009 language contract).

## 15. Conformance

A conforming implementation MUST pass:

1. **CM_STANDARD** — the canonical-forms suite (§5, R5/R6, V5 adjacency), asserting only what
   the upstream spec states or demonstrates.
2. **REFERENCE_PROJECTION_CONVENTIONS** — the §10 table, differential against MMD-6
   (`critic_markup.c` CuTest matrix imported verbatim, including the three nesting cases and
   unclosed-marker passthrough; D4 is the one documented delta).
3. **PROFILE1_RULINGS** — every R/L/E/C/N/T/V/X rule above, including the multi-block corpus
   rows (`block-spanning-addition`, `nested-block-spanning-addition-and-deletion`), table
   containment (R3b), escaping (E1), and mid-edit prefix states (T1: for each corpus document,
   every prefix parses and round-trips).
4. **Round-trip** — byte-exact serialize∘parse identity over the full corpus and over every
   real document in the repository (the branch's existing exact-round-trip suite), including
   BOM/CRLF/astral rows.
5. **Lexical fixtures** — imported `basic_ranges`/`malformed_ranges`/`edge_cases` rows from
   Fevol/criticmarkup-parser, with expectations adjusted to Profile 1 rulings (N1 vs its flat
   nesting; CM1 vs its aliases).
6. **Complexity gates** — the scale corpus under `desktop-v1` limits with linear-fit assertions
   (X1/X2).

## 16. References

Plan 0009 (`specs/plans/0009-criticmarkup-document-engine-rebuild.md`) — settled decisions,
ADRs, language contract. Research 0004/0005 (`specs/research/`) — verified ecosystem evidence
behind every ruling above. CommonMark 0.31.2; GFM spec; CriticMarkup toolkit README (canonical
prose spec); `fletcher/MultiMarkdown-6` `src/critic_markup.c` (projection oracle);
`nathanlesage/lang-criticmarkup` and `Fevol/criticmarkup-parser` (lexical fixtures and
cautionary precedents).
