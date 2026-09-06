# MarkText Markdown Profile 1 — Language Specification

- **Status:** Draft 2 semantic record (2026-08-10), carried forward by plan 0011; accepted rulings and unresolved proposals retain their individual status.
- **Identifiers:** `markdownProfile: 'markdown-profile-1'` ·
  `criticMarkupProfile: 'marktext-profile-1'`
- **Derived from:** the canonical CriticMarkup specification, CommonMark and GFM, historical
  interoperability evidence, semantic ADRs 0008–0010 and 0013–0015, and owner rulings recorded
  2026-07-24.
- **Audience:** the document-core parser, its test corpus, adapters, and any future
  reimplementation (including a port). This document defines the candidate _language_;
  [plan 0011](../plans/0011-criticmarkup-editable-review.md) owns architecture,
  migration, performance, and acceptance. Where implementation status lags this document,
  established rulings remain the language target. Plan 0011 supersedes blanket packet
  ratification as an implementation prerequisite; genuinely disputed semantics require
  a focused decision and are not silently accepted from current parser behavior.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as in RFC 2119.

---

## 1. Scope and design principles

Profile 1 is the complete composed language that MarkText documents are written in: a pinned
CommonMark base, a pinned GFM extension set, MarkText's built-in constructs, and the five
CriticMarkup annotation forms as **intrinsic productions of the same grammar**. Markdown and
CriticMarkup have one shared interpretation: a consumer must not rescan flattened text and invent
a second CriticMarkup or Markdown meaning. The parser algorithm, number of internal passes, data
structures, and incremental-reuse strategy are implementation choices.

Principles every rule below serves:

- **P1 — Total language.** Every sequence of Unicode text is a valid Profile 1 document. There
  are no syntax errors, only constructs that form or fail to form. A conforming parser MUST
  produce a complete parse for any input, including every mid-edit prefix of a document.
- **P2 — Source authority and losslessness.** The decoded source text is the single authority.
  The parse product accounts for every decoded code unit exactly once, including line-ending
  spellings, blank lines, marker spellings, escapes, trailing-space trivia, and a leading U+FEFF.
  Normalization is only ever an explicit transform. File bytes, encoding, BOM policy, and
  byte-exact no-op save behavior belong to the file layer and plan 0011's compatibility contract.
- **P3 — One language decision per source run.** Literal ownership and CriticMarkup delimiter
  activity have one deterministic meaning. No projection, materializer, adapter, or consumer may
  revise a recognition decision (§7).
- **P4 — Views are reads.** Original, Revised, and the editing view are reads of one parse by
  arm selection, never independent interpretations of assembled strings. Where eliding a marker
  changes Markdown structure, each view exposes the structure implied by the same recognized
  annotation and the normative projection table (§10).
- **P5 — Rulings are named.** Behavior the upstream CriticMarkup prose leaves undefined is a
  versioned MarkText ruling, tested as such, and never attributed to the canonical specification
  (ADR-0008). §12 ledgers every deliberate divergence from reference tools.

### 1.1 Offsets and text model

Offsets exchanged by Profile 1 APIs are **UTF-16 code-unit indices** into decoded source;
implementations may use another internal representation. Every decoded code unit has one language
meaning. Line endings are LF, CRLF, or CR; all three delimit lines and are preserved exactly. A
leading U+FEFF is part of decoded source, treated as leading trivia, and preserved.

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

### 2.1 Emphasis flanking admits CJK boundaries

One deliberate widening of a CommonMark rule. When evaluating the delimiter-run
flanking clauses, Profile 1 treats a CJK ideograph, kana, or hangul syllable as
a **boundary** — the class CommonMark calls "punctuation" — and not as an
ordinary letter. Scripts: `Han`, `Hiragana`, `Katakana`, `Hangul`.

Strict CommonMark classifies these as letters, so a `**` run between an
ideograph and a quotation mark is simultaneously left- and right-flanking,
opens nothing, and `中文**"x"**中文` renders literal asterisks. That makes bold
around quoted text unreachable for CJK authors (product issue #4307). Typora
and markdownlint apply the same widening, so this is the interoperable reading
in practice even though it is not the letter of the specification.

The widening is additive: it can only admit emphasis CommonMark refused for
this boundary reason. It never creates emphasis that a whitespace, empty-run,
or intraword-underscore rule already forbids, and it must not change the
expected output of any CommonMark 0.31.2 conformance example.

## 3. Layer B — GFM extension set (pinned)

Profile 1 includes these GFM extensions, per the GFM spec's definitions:

- **Tables** (pipe tables with a delimiter row; `\|` writes a literal pipe in a cell).
- **Task list items** (`[ ]` / `[x]` markers at list-item start).
- **Strikethrough** (`~~…~~`). See §9.6 for the required disambiguation against the
  CriticMarkup substitution closer.
- **Autolinks (extended)** as GFM defines them.

GFM constructs participate in the single grammar like any CommonMark construct.

## 4. Layer C — MarkText built-in constructs

Layer C is controlled by a versioned set of syntax-affecting options. A disabled switch removes
its production from the composed language before CriticMarkup recognition; it is not merely a
rendering preference.

- **YAML front matter.** A `---` line at the very start of decoded source (offset 0, or immediately
  after a BOM) opens front matter, closed by a `---` or `...` line. Front matter is a literal
  range: no Markdown and no CriticMarkup is recognized inside it (§7). A `---` line anywhere
  else is ordinary Markdown (setext underline or thematic break per CommonMark). This
  production is enabled exactly when `frontMatter` is true. TOML `+++`, semicolon-delimited
  JSON, and brace-delimited JSON are ordinary Markdown in Profile 1.
- **Table-of-contents marker.** A single physical top-level line which would otherwise be a
  paragraph is a table-of-contents marker when removing
  zero or more ASCII spaces (`U+0020`) and tabs (`U+0009`) from both ends leaves exactly the
  five case-sensitive code units `[TOC]`. No other spelling is a marker: `[toc]`, escaped
  `\[TOC]`, character-reference spellings such as `&#91;TOC]`, and lines padded only by other
  Unicode whitespace remain ordinary Markdown. Normal block precedence applies before this
  production: setext headings, block quotes, lists, footnote definitions, indented or fenced
  code, raw HTML blocks, and every other literal owner keep their normal meaning. Inline code,
  raw inline HTML, and link syntax containing those visible characters likewise remain their
  normal inline productions. A multi-line paragraph is never a marker.

  Original and Revised apply this production to their projected content, so an Addition,
  Deletion, or Substitution can make the fact exist in one clean view
  and not the other. In Markup, CriticMarkup ownership keeps a marked spelling visible as reviewed
  paragraph content; an unmarked marker remains active. The marker never changes retained source
  or ordinary paragraph text. A consumer that supports generated tables of contents may activate
  it in HTML, PDF, or print output.
- **Inline math.** `$…$` spans, recognized as a literal range with CommonMark-code-span-like
  ownership (§7), are enabled exactly when `math` is true.
- **Math blocks.** `$$` blocks are enabled exactly when `math` is true. A fenced block whose
  info string is `math` (case-insensitive) is promoted from `code-block` to `math-block`
  exactly when both `math` and `gitLabMath` are true. Math-block content is a literal range.
- **Diagram blocks.** A fenced code block whose info string names one of the diagram languages
  `flowchart`, `mermaid`, `plantuml`, `sequence`, `vega-lite` is a diagram block; content is a
  literal range. The language list is normative to Profile 1.
- **Footnotes.** Footnote references (`[^label]`) and footnote definitions; a footnote
  definition's block is tracked with its own literal/ownership rules. These productions are
  enabled exactly when `footnotes` is true; otherwise their bytes are ordinary Markdown.
- **Subscript and superscript.** A single unescaped `~payload~` or `^payload^` pair with a
  nonempty, whitespace-free payload forms `subscript` or `superscript` when
  `subscriptAndSuperscript` is true. The Layer C production takes precedence over GFM
  strikethrough on the same single-tilde run. When the switch is false, normal GFM/CommonMark
  precedence applies.

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
| Comment      | `{>>` _note_ `<<}`           | _note_               |

- **CM1.** Delimiters are exactly the ASCII sequences above. Profile 1 MUST NOT recognize
  HTML-entity or tag aliases (`{<del>`, `{&gt;&gt;`, …) or in-annotation metadata separators
  (`@@`); those are third-party extensions found in Fevol/Commentator and their
  characters are ordinary payload text.
- **CM2.** Empty payloads are valid: `{++++}`, `{----}`, `{~~~>~~}`, `{====}`, `{>><<}` all
  form. `{====}` has no barrier or pairing meaning beyond being an empty Highlight.
- **CM3.** Whitespace inside payloads is payload. Delimiters MUST NOT contain interior
  whitespace (`{ ++` does not open).

## 6. CriticMarkup recognition rules

- **R1 — Shared language recognition.** CM delimiters and Markdown constructs are recognized as
  productions of the same language, subject to literal ownership (§7). A later consumer may not
  reinterpret CM independently.
- **R2 — Pairing.** An opener forms an annotation if and only if its matching closer occurs
  later in the document under properly-nested pairing (§6.1). An
  opener with no closer, and a closer with no opener, are **literal text** — they form nothing,
  consume nothing, and MUST NOT affect recognition of any later construct. This holds
  identically for complete documents and for mid-edit states (P1); an unclosed opener MUST NOT
  swallow the remainder of the document (the lang-criticmarkup failure mode is
  non-conforming here).
- **R3 — Multi-block spans (owner ruling, 2026-07-24).** All five forms MAY span line breaks,
  blank lines, and block boundaries. A paragraph-spanning deletion, an addition containing a
  blank line, an annotation enclosing an entire block quote, list, or table — all form. The
  canonical toolkit's DOTALL behavior and MMD-6's accept/reject path are precedent; the
  single-block confinement found in some renderers is a parser artifact Profile 1 rejects.
  Structural consequences are handled by the projection semantics
  (§10), not by refusing recognition. Bounds:
  - **R3a.** An annotation MUST NOT start or end _inside_ a literal range (§7) — but may
    enclose one whole.
  - **R3b.** Within a table, each cell is a containment region: an annotation that opens inside
    a cell must close inside the same cell. An unescaped `|` retains its structural, cell-
    delimiting role even between CM markers; write `\|` for a literal pipe inside an annotation
    in a table. An annotation MAY instead enclose the entire table (open before its first row,
    close after its last). Annotations spanning _some but not all_ of a table's rows do not
    form (openers/closers are literal). _(Profile 1 ruling; the reference ecosystem is silent.)_
- **R4 — Substitution divider.** Exactly one `~>` at the top nesting level of a substitution's
  payload divides _old_ from _new_. A `~>` anywhere outside a substitution payload is literal
  text. Profile 1 deliberately diverges from MMD-6, which erases stray `~>` tokens; see §12. A
  substitution containing no top-level `~>` does not form (all its
  delimiters are literal). Additional top-level `~>` sequences after the first are payload text
  of the _new_ arm.
- **R5 — Comment subdocument (owner ruling, 2026-08-10).** A Comment payload is exact source
  interpreted as an isolated full Profile 1 subdocument using the containing document's syntax
  options. Block and inline Markdown, literal ranges, local definitions and references, local
  footnotes, and properly nested CriticMarkup may form wholly inside it. No Markdown block,
  inline-matching, literal, definition/reference, footnote, or annotation state crosses a
  Comment boundary; each nested Comment starts another isolated scope. The outer Comment closes
  under the ordinary pairing, literal-precedence, escaping, and recovery rules. Original and
  Revised elide the complete outer Comment. A Comment Display is the Revised projection of its
  payload: nested CriticMarkup is applied recursively and nested Comments are elided from the
  parent display but remain independently readable. Payload source remains canonical and exact;
  Markdown-looking author names, timestamps, or similar text acquire no metadata schema.
- **R6 — Highlight content.** A Highlight's payload is ordinary Markdown (and may contain
  nested CM, §6.1) — its text is present in both projections, so it parses like surrounding
  text.
- **R7 — Addition/Deletion/Substitution arms.** Each payload/arm is an **arm-local Markdown
  fragment**: full inline Markdown, and — when the arm spans block boundaries (R3) — full block
  structure. See §9.1 for containment.

### 6.1 Nesting

- **N1.** Annotations nest recursively: any of the five forms may appear inside an Addition,
  Deletion, or Substitution arm, or inside a Highlight payload — including the same form inside
  itself. Pairing is properly nested: `{--a{--b--}c--}` is a Deletion containing a Deletion,
  matching MMD-6's tested recursive semantics (`accept({++foo{--bat--}bar++}) = "foobar"`;
  `reject({--foo{-- bat --}bar--}) = "foo bat bar"` — both are conformance oracles).
- **N2.** Any of the five forms may nest properly inside a Comment subdocument (R5), including
  another Comment. Its Markdown state and annotation stack are local to that Comment.
- **N3.** Resource exhaustion must not silently change nesting semantics by reinterpreting inner
  annotations as literal text. An implementation that cannot complete the interpretation fails
  explicitly without publishing a partial revision.

## 7. Literal precedence

Certain constructs own their source ranges as **literal ranges**: inline code spans, fenced code
blocks (including math and diagram blocks), indented code blocks, `$…$` / `$$` math, autolinks,
link destinations, link reference definitions, HTML blocks, inline HTML, front matter, and
footnote-definition tracking ranges.

- **L1.** Inside a literal range, CM delimiters are data. `` `{++` `` is a code span containing
  four characters; a fenced code block containing `{++ … ++}` renders those bytes verbatim.
  _(Profile 1 ruling: the reference tools protect no literal ranges, and Profile 1 deliberately
  diverges; see §12.)_
- **L2.** Literal ownership and CM recognition are deterministic. An accepted literal range owns
  any marker-looking text inside it. A literal that opens inside a CM payload is arm-local and
  must complete inside that arm or it does not form.
- **L2a — closer precedence (owner-ratified 2026-07-25; ADR-0014).** If an inline literal opens
  inside an annotation arm but would complete at or beyond the arm's first unowned closer, the
  annotation closer stands and the unfinished literal recovers as text. For example,
  ``{++a `x++}` b++}`` closes at the first `++}`.
- **L2b — reference-dependent ownership (owner-ratified 2026-07-25).** A Comment or Substitution
  boundary that conflicts only with a possible reference-dependent link destination stands. An
  already recognized literal owner, including inline code, a direct link destination, fenced code,
  HTML, front matter, or a definition, retains precedence under L1/L2.
- **L3.** No consumer, projection, or adapter may re-recognize CriticMarkup in a flattened string
  or assign a different meaning to already recognized source.

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
  (see §12). E1 MUST be presented in user-facing
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
  limitation documented by MMD-6).
- **C2.** Symmetrically, paired syntax fully outside may enclose a whole annotation:
  `*a {++b++} c*` is emphasis containing an Addition.
- **C3.** Link reference and footnote definitions written inside an arm are arm-local: they
  resolve references only within that arm's fragment (ADR-0010). Reference resolution is
  otherwise per-view: each view resolves references against the definitions present in that
  view (§10) — a definition inside a Deletion exists in Original but not Revised.
- **C4.** Table cell edges are containment regions per R3b. List-item and blockquote
  boundaries are _not_ containment boundaries for annotations (R3 allows spanning them); they
  are ordinary block structure inside multi-block payloads.

### 9.2 Block constructs inside payloads

When a payload spans blocks (R3), its interior is parsed as block structure (paragraphs,
headings, lists, quotes, whole literal blocks) in the views where that text is present.
Structure-affecting edge cases are governed by projection semantics (§10): e.g. a Deletion covering a
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

Profile 1 documents are read through three views:

| Form         | Original (reject-all) | Revised (accept-all) | Editing (Markup) view |
| ------------ | --------------------- | -------------------- | --------------------- |
| Addition     | ∅                     | _new_                | annotation shown      |
| Deletion     | _old_                 | ∅                    | annotation shown      |
| Substitution | _old_                 | _new_                | annotation shown      |
| Highlight    | _text_                | _text_               | annotation shown      |
| Comment      | ∅                     | ∅                    | annotation shown      |

This table is normative and tested against literal Profile 1 expectations.
MMD-6's accept/reject processors informed some rows but do not determine them.
Nested annotations resolve recursively per the same table.

- **V1.** Original and Revised are read-only projections; only the editing and source views
  edit canonical content.
- **V2 — Views are reads.** Each view selects annotation arms from the same recognized source.
  Where keeping or eliding an arm changes Markdown block structure, the view exposes the
  corresponding structure without changing the annotation recognition or source authority.
- **V3 — Source relationship.** Every view and materialized projection retains an exact,
  gapless relationship to canonical source. Derived protection may preserve projection meaning,
  but it may not create or revise CriticMarkup recognition. The scoped projection AST remains
  the semantic authority when an isolated result is not safely flattenable; protective Markdown
  spelling is a render-safe materialization, not a contract to recover that AST by reparsing it.
- **V4 — Accept/Reject semantics.** Accepting or rejecting an annotation produces the canonical
  source that results from removing its markers and the non-selected arm. The table's column is
  applied to that annotation alone; the resulting source is interpreted as a new revision.
- **V5 — Highlight/Comment relation.** A gapless, nonempty `{==text==}{>>note<<}` pair is
  presented as one related Review item; the relation is _derived adjacency context_, not parser
  identity, stored intent, or a grammar production (toolkit convention;
  lang-criticmarkup sibling-node precedent). A standalone Comment anchors to its own source
  position only.

## 11. Error tolerance

- **T1.** Every input, including every prefix of every input, parses to a complete revision
  (P1). Typing `{++` and stopping is a stable state: the three characters are literal text
  (R2), the surrounding document is unaffected, and the next keystroke re-decides only per
  normal parsing.
- **T2.** Recovery is always _degradation to literal text_ — never dropped bytes, never an
  error sentinel that changes downstream recognition, never consumption to end-of-document.
  MMD-6's unmated-marker passthrough is the
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
| D7  | Comments retain isolated full Profile 1 Markdown+CriticMarkup subdocuments (R5)                  | Toolkit/MMD erase or render the payload as inline metadata                 | A portable note may contain full Markdown while remaining one unstructured payload; local resolution and Comment Display stay lossless  |
| D8  | An annotation closer stands against an in-arm open literal whose completion lies beyond it (L2a) | An alternative shared-loop parser reading defers the closer                | Reliable closer behavior and arm containment (ADR-0014)                                                                                 |

## 13. Implementation boundary

Performance targets, resource limits, incremental equivalence, accounting, parser APIs, and
failure publication are engine requirements owned by plan 0011 and implementation baselines.
They do not change Profile 1 language meaning.

## 14. Versioning

- **Y1.** Unknown profile identifiers are rejected explicitly before a revision is published.
- **Y2.** Any change that alters the recognition, structure, projection, or round-trip of any
  existing decoded-source sequence — pinned CommonMark/GFM version bumps, construct additions/removals,
  new escape rules, changed rulings — is a new Profile (`…-profile-2`), never a silent revision
  of Profile 1. Bug fixes that make an implementation conform to _this document_ are not
  version changes.
- **Y3.** `markdownProfile` and `criticMarkupProfile` version two aspects of one grammar; they
  MUST NOT select peer language interpretations.

## 15. Conformance

A conforming implementation MUST pass:

1. **CM_STANDARD** — the canonical-forms suite (§5, R5/R6, V5 adjacency), asserting only what
   the upstream spec states or demonstrates.
2. **REFERENCE_PROJECTION_CONVENTIONS** — the §10 table, differential against MMD-6
   (`critic_markup.c` CuTest matrix imported verbatim, including the three nesting cases and
   unclosed-marker passthrough; D4 is the one documented delta).
3. **PROFILE1_RULINGS** — every R/L/E/C/N/T/V rule above, including the multi-block corpus
   rows (`block-spanning-addition`, `nested-block-spanning-addition-and-deletion`), table
   containment (R3b), escaping (E1), and mid-edit prefix states (T1: for each corpus document,
   every prefix parses and round-trips).
4. **Decoded-source round-trip** — exact serialize∘parse identity over the full corpus and
   representative real documents, including leading U+FEFF, CRLF, and astral rows. File-byte,
   encoding, and no-op save fidelity are integration acceptance, not language conformance.
5. **Lexical fixtures** — imported `basic_ranges`/`malformed_ranges`/`edge_cases` rows from
   Fevol/criticmarkup-parser, with expectations adjusted to Profile 1 rulings (N1 vs its flat
   nesting; CM1 vs its aliases).

## 16. References

Plan 0010 defines the active integration and acceptance work. Archived plan 0009 records
historical candidate decisions but is not authority. Architecture evidence records the
host-parser facts behind some rulings and is non-normative. CommonMark 0.31.2; GFM spec;
CriticMarkup toolkit README (canonical prose spec); `fletcher/MultiMarkdown-6`
`src/critic_markup.c` (projection evidence);
`nathanlesage/lang-criticmarkup` and `Fevol/criticmarkup-parser` (lexical fixtures and
cautionary precedents).
