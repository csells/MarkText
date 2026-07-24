# 0005 — CriticMarkup-in-Markdown: ecosystem semantics, consensus, and the Profile 1 rulings

- **Type:** Research (external evidence, adversarially verified + cross-checked against an
  independent Gemini Deep Research run)
- **Created:** 2026-07-24
- **Question:** What are the de-facto standard semantics for CriticMarkup-in-Markdown across
  existing OSS implementations, per the 11 open questions the prose spec never answered — so
  document-core can adopt established practice where it exists and knowingly rule where it doesn't?
- **Method:** Two independent runs over the same 11-question brief:
  1. Claude deep-research harness — 5 search angles, 94 claims extracted, 24 adversarially
     verified (3-vote), 1 refuted 0-3, synthesized to 11 findings. Verifiers fetched primary
     sources directly (raw C/Python/Lezer sources, test suites); one verifier **compiled MMD-6**
     to confirm unclosed-marker behavior empirically.
  2. Google Gemini Deep Research — independent report from the same prompt
     (`CriticMarkup_Semantics_Implementation_Analysis.pdf`).
- **Downstream purpose:** feeds the normative MarkText md+cm specification and the design of an
  O(n), incrementally-reparsing, error-tolerant editor parser (plan 0009's Profile 1).

## TL;DR

The ecosystem's "de-facto standard" is thinner than expected: only three implementations survived
primary-source verification — **MultiMarkdown-6** (C, by CM co-creator Fletcher Penney), the
**original CriticMarkup toolkit** (Python, the reference tooling), and **lang-criticmarkup**
(Lezer/CodeMirror 6, by Zettlr's author). Everything they agree on, they agree on because they are
all *Markdown-blind*: annotation arms are opaque text, straddling delimiters are unsupported, no
escape mechanism exists, and none of them protects code spans from marker recognition. Where the
editor-grade questions begin — literal precedence, mid-edit tolerance, structural interactions,
multi-block rendering — the ecosystem offers either defects, divergence, or silence. **Best
existing practice is real for about half the questions; for the other half there is no considered
practice to adopt, and a normative Profile 1 ruling fills a genuine vacuum.**

Product ruling recorded in this document: **multi-block annotations stay** (owner decision,
2026-07-24). The verified evidence supports it — see Q1.

## The verified evidence base

| Implementation | Architecture | Authority weight |
| --- | --- | --- |
| MultiMarkdown-6 (`fletcher/MultiMarkdown-6`) | Rendering: CM tokens integrated into the per-block inline token-pair engine. Accept/reject: Aho-Corasick source-text prepass (`critic_markup.c`), byte-range erasure, then normal Markdown parse | Co-creator's implementation; executable CuTest suite |
| CriticMarkup toolkit (`CriticMarkup/CriticMarkup-toolkit`) | Five sequential whole-document `re.sub` passes → `<ins>/<del>/<mark>` HTML → pipe to a Markdown converter | The reference tooling (dormant since ~2013) |
| lang-criticmarkup (`nathanlesage/lang-criticmarkup`) | Standalone Lezer grammar mounted over Markdown via `parseMixed` overlay | The only modern editor-grade grammar; small, single-author |

Gemini's run additionally surveyed pancritic (Pandoc/LaTeX wrapper), Emacs `cm-mode.el`,
vim-criticmarkup, markdown-it-criticmarkup, Obsidian Commentator (Fevol's grammar fork), Mist,
Zettlr, and the CommonMark forum debates. None of those produced claims that survived my run's
adversarial verification (mostly: never fetched/checked, not refuted), so they appear below as
**secondary, unverified** corroboration only.

## The 11 questions: verified answer · secondary evidence · Profile 1 position

### Q1 — Multi-block spans: THE sharpest divergence; no single-block "consensus" exists · high (merged 3-0s, one 2-1)

- **MMD-6 rendering path:** confined to a single block — "CriticMarkup must be contained within a
  single block (e.g. paragraph, list item, etc.) CM that spans multiple blocks will not be
  recognized"; Penney, issue #41: "For now, CriticMarkup doesn't play well 'across' paragraphs."
- **MMD-6 accept/reject path:** the Aho-Corasick scanner runs over the whole buffer ignoring blank
  lines — **multi-block annotations DO resolve correctly at accept/reject time**. The same
  document renders the annotation as literal text but transforms it under `--accept`. This
  render/accept asymmetry is undocumented.
- **Original toolkit:** deliberately multi-paragraph — all five regexes carry `(?s)`/`re.DOTALL`,
  with dedicated `\n\n` branches (a deletion of exactly `\n\n` renders `<del>&nbsp;</del>`;
  additions touching `\n\n` emit `<ins class='critic break'>&nbsp;</ins>` placeholders).
- **lang-criticmarkup:** no line/block restriction in the grammar at all.
- **Block-level syntax:** Penney proposed markers-on-their-own-lines as a block form (issue #41),
  never implemented anywhere. No implementation ships a defined block-level-change syntax.
- **Secondary (Gemini):** Mist and Emacs cm-mode refuse multi-paragraph; both for stated
  implementation reasons (line-by-line parse; erratic multiline font-lock).

**Profile 1 ruling (owner, 2026-07-24): multi-block spans stay.** The evidence base makes this
*more* defensible than research 0001 assumed: the reference toolkit implements multi-paragraph
spans on purpose, MMD-6's own accept/reject honors them, and every "single block only" rule in the
ecosystem is an artifact of a parser that couldn't cope (regex line loops, font-lock, per-block
inline engines) — an engineering concession, not a language ruling. Profile 1's safe-point
fork/reconvergence design (decision 11) is what makes the spec-faithful choice implementable at
O(n). Compatibility footnote for the spec: multi-block documents degrade to literal text in MMD-6
*rendering* while still transforming under MMD-6 *accept/reject* — both behaviors must appear in
the interop notes.

### Q2 — Literal precedence: the ecosystem has none; modern divergence is mandatory · high (3-0)

No verified implementation protects code contexts: the toolkit applies CM regexes to raw text with
zero exemption for inline/fenced code or HTML, and MMD-6's accept/reject tokenizer has no
backtick/fence checks — `{++` inside a code span is consumed as a marker in both. This is
universally acknowledged as a defect class (Penney's own release notes patch `$`-math collisions).
Gemini's report frames AST-era parsers as "Markdown wins," but no verified implementation actually
demonstrates it.

**Profile 1 position (already decided, aligned with the only defensible practice):** literal
contexts win; ownership of each source run is one parser decision (`composeMarkdownLiteralRanges`,
the one-lexer rule). This is a *knowing divergence from the reference tools* and the spec must say
so explicitly — with the compatibility consequence that documents relying on markers-inside-code
behave differently in MMD.

### Q3/Q4 — Markdown inside annotations & delimiter containment: real consensus · high (3-0)

Annotation arms are opaque at CM-parse time everywhere; Markdown formatting must be fully
contained per arm. Toolkit README: "Wrap Markdown Tags Completely… the CriticMarkup processor
currently chokes on them," prescribing complete emphasis pairs inside each substitution arm.
MMD-6 limitations: `{++** foo} bar**` "will not properly manage the intended markup." No
implementation lets emphasis/link state cross an annotation boundary or the `~>` separator.

**Profile 1 position: ADR-0010's arm-local containment IS the consensus**, made precise: matching
state begun inside an arm completes there or recovers at the arm boundary; nothing leaks past the
closer. Profile 1 goes beyond the ecosystem by *parsing* Markdown inside arms as arm-local
fragments (the ecosystem defers that to a later HTML pass) — an editor requirement, consistent
with the containment consensus.

### Q5 — Nesting: divergent; MMD-6 is the only tested precedent · high (3-0)

MMD-6 deliberately supports recursive nesting in accept/reject — all five pair types registered
`PAIRING_ALLOW_EMPTY | PAIRING_PRUNE_MATCH`, recursive child processing, CuTest-proven:
accept `{++foo{--bat--}bar++}` → `foobar`; reject `{--foo{-- bat --}bar--}` → `foo bat bar`.
lang-criticmarkup's grammar does not admit nesting (bodies are `Content*`); the toolkit's flat
non-greedy regexes give undesigned, ordering-dependent results.

**Profile 1 position:** nesting is supported (the corpus already carries `mixed-nested-forms` and
`nested-block-spanning-addition-and-deletion`); MMD-6's accept/reject results are the
differential-test oracle to track, per the existing REFERENCE_PROJECTION_CONVENTIONS approach.

### Q6 — Accept/reject: firmly settled, and it validates the views-are-parses decision · high (3-0)

MMD-6 is the only verified implementation with executable accept/reject, and its semantics match
plan 0009's projection table exactly: accept keeps addition content / erases deletions /
keeps the new substitution arm; reject inverts; highlights keep inner text under both; comments
erase under both. Operations are **raw source-text edits followed by a full re-parse** — block
structure changes (deleted heading markers, added blank lines) are resolved by the downstream
Markdown parse. This is independent confirmation of the Phase 0.5 amendment: a projection is a
genuine parse of projected source, not a selection over retained decisions.

**Profile 1 position:** already aligned (REFERENCE_PROJECTION_CONVENTIONS is differential-tested
against these exact processors). ADR-0013's contribution is doing the re-parse *without* the
string-materialization step for convergent text — same semantics, better complexity.

### Q7 — Highlight+comment pairing: loose adjacency convention, not grammar · high (3-0)

The toolkit codifies adjacency with a dedicated combined regex applied before the standalone
comment pattern; lang-criticmarkup's own test fixture parses `{==…==}{>>…<<}` as two *sibling*
nodes; MMD-6 gives the pair no special treatment (comment always erased). Standalone comments are
anchored to nothing anywhere. Secondary: Mist/Zettlr link threads via front-matter IDs — an
app-level convention on top, not parser identity.

**Profile 1 position: decision 6 is exactly the consensus** (derived relation, not parser
identity; no proprietary metadata). No change.

### Q8 — Escaping: none exists, anywhere · high (3-0)

No backslash or other escape mechanism in any verified implementation; a literal `{++` outside
code is unwritable in the reference tools. The only practice is "use a code span," which works
only where Q2's literal precedence exists — i.e., not in the reference tools themselves.

**Profile 1 position:** adopt code-span escaping as the documented mechanism (it works under
Profile 1's literal precedence); do not invent a backslash escape. If the corpus's
`escaped-opener-and-closer-like-payload` row implements more than this, that delta must be
declared as a MarkText extension in the spec, not attributed to CM.

### Q9 — Structural interactions (tables, lists, front matter, footnotes): ecosystem silence · medium

No verified test suite or doc addresses pipes-in-annotations, annotations spanning list items
(beyond MMD-6's blanket single-block rendering rule), front matter, or footnotes. Gemini asserts
"CM is toxic to GFM tables" from architecture reasoning, not test evidence.

**Profile 1 position: genuine vacuum — Profile 1 must rule and say it is ruling.** The existing
corpus rows (escaped pipes in table cells, front-matter literalness, footnote-definition literal
ranges) are already ahead of the entire ecosystem here.

### Q10 — Unclosed markers: graceful literal degradation is the precedent · high (3-0, empirically compiled)

MMD-6: an unmated marker token is skipped and left as literal text; nothing is consumed to
end-of-document (verifier-compiled: `{++ok++} and {++unclosed` accept → `ok and {++unclosed`).
One exception found: a stray `~>` divider (`CM_SUB_DIV`) is unconditionally erased — the
substitution divider is NOT error-tolerant in MMD-6. The toolkit's regexes simply fail to match
(literal); lang-criticmarkup produces Lezer error-recovery nodes and its suite includes
start-missing/end-missing cases. Secondary (Gemini): lang-criticmarkup's README warns an unclosed
`{++` "will match all subsequent tokens" in live editing — the document-swallowing hazard.

**Profile 1 position:** literal degradation for unmated openers/closers, never consume-to-EOF, and
*do not* reproduce MMD-6's stray-`~>` erasure (treat a divider outside a substitution as literal).
For the incremental parser this is also the error-tolerance requirement: an unclosed marker is a
permanent mid-edit state and must parse to a bounded, recoverable structure every keystroke.

### Q11 — Parse architecture: the "orthogonal layer" position is real but does not survive editor requirements · high (3-0; one claim refuted 0-3)

Penney's primary-source ruling: CriticMarkup "is orthogonal to… Markdown… a separate 'layer'…
processed *before* parsing." The toolkit implements exactly that (five ordered regex passes —
cross-type interactions decided purely by pass order). **Correction established by this run:
MMD-6's rendering path is NOT a prepass** — the claim was refuted 0-3. Rendering integrates CM
tokens into the per-block inline token-pair engine, which is precisely why rendering inherits
single-block confinement while accept/reject (a true prepass) does not. lang-criticmarkup is the
overlay variant (separate grammar via `parseMixed` — still two authorities over one region).
Every known bug class maps to the architecture: pass-ordering dependence and code-blindness for
the prepass; document-swallowing for the naive integrated grammar.

**Profile 1 position:** the intrinsic single-pass architecture (decision 2 / the architectural
law) has no ecosystem precedent — and the ecosystem's defects are the argument for it. The spec
should present intrinsic parsing as the mechanism that *implements* the layer's documented
semantics without the prepass's ordering bugs, and note MMD-6's render/accept asymmetry as the
cautionary tale for two-authority designs.

## Cross-run comparison (Claude verified run vs Gemini report)

**Agreement:** the open-questions framing; arm opacity/containment consensus (Q3/Q4); accept/reject
as string-edit-then-reparse (Q6); no native escaping (Q8); loose highlight-comment pairing (Q7);
unclosed-marker hazards in live grammars (Q10); the architecture-determines-bug-profile analysis
(Q11); CommonMark community repeatedly cited CM as the de-facto review syntax but never codified
an extension.

**Corrections to Gemini's report established by verification:**

1. **"MultiMarkdown executes a pure string-replacement pre-pass… before the AST is generated" is
   wrong for rendering** (refuted 0-3). Only accept/reject is a prepass. Gemini's Q1/Q2 rows for
   MMD inherit this error. (The same nuance needs a one-word fix in this repo's
   `criticmarkup-host-markdown-interaction-evidence.md`, which describes MMD-6 CLI accept/reject
   correctly but summarizes it as "the same layering" for MMD generally.)
2. **"Confine to single blocks" is not the consensus Gemini claims.** The reference toolkit
   deliberately supports multi-paragraph spans (DOTALL + `\n\n` surgery); MMD-6 accept/reject
   honors them; only MMD-6 rendering, Mist, and cm-mode refuse — each for stated implementation
   reasons. Gemini's recommendation #1 was rejected as a Profile 1 ruling (owner decision; see Q1).
3. **Gemini's "AST parsers protect code blocks" (Q2) is aspiration, not evidence** — no verified
   implementation does; lang-criticmarkup's overlay runs over unprotected regions only insofar as
   the host mounts it that way, and nobody tests it.
4. Gemini's per-cell matrix values for pancritic/Mist/cm-mode/vim remain plausible but unverified;
   treat as leads, not facts. Its "Fevol forked the grammar to fix nesting" lead is worth
   verifying: my run found nathanlesage's grammar does NOT admit nesting, so the Commentator fork
   (`Fevol/criticmarkup-parser`) may be the only grammar-level nesting precedent.

## Implications for the Profile 1 spec and the O(n)/incremental/error-tolerant parser

1. **The spec fills a real vacuum.** For Q2, Q9, Q10-divider, and all of Q1's block-level syntax,
   there is no considered practice to adopt. The spec's existing CM_STANDARD /
   REFERENCE_PROJECTION_CONVENTIONS / Profile-1-ruling separation is the right structure — this
   research supplies the citations for which bucket each of the 11 answers belongs to.
2. **Differential oracles:** MMD-6's CuTest accept/reject matrix (including the three nesting
   cases and unclosed-marker passthrough) and the toolkit's five patterns + `\n\n` behaviors are
   concrete, runnable interop oracles to import into the corpus. The stray-`~>` erasure is a
   documented *non-goal* (divergence).
3. **Error tolerance has a precedent shape:** unmated marker → literal, bounded recovery, never
   consume-to-EOF — matching the existing unclosed-fence safe-point treatment (an unclosed fence
   forks to EOF; an unclosed CM marker must not).
4. **Incrementality:** nothing in the ecosystem parses CM incrementally; lang-criticmarkup rides
   Lezer's fragment reuse but with the two-authority overlay caveat. Profile 1's decision 12
   (fragment reuse over the intrinsic parse, safe-point-bounded) remains without precedent —
   research 0001's Lezer findings are the closest transferable mechanism.

## Open questions carried forward

1. Does Obsidian Commentator's `Fevol/criticmarkup-parser` grammar admit nesting and define
   mid-edit recovery — the only potential editor-grade precedent for Q5/Q10 live behavior?
2. Do any Pandoc/markdown-it/remark CM plugins give code spans literal precedence (precedent for
   Q2's divergence)?
3. Is MMD-6's render/accept multi-block asymmetry a reported bug (evidence of user expectations)?
4. Formal spec efforts: my run found none surviving verification; Gemini found only the CommonMark
   forum debates (no codified extension). A follow-up targeted fetch of
   `Fevol/criticmarkup-parser` docs and the CommonMark "Reviewing Markups" thread would close this.

## Sources

Primary (verified verbatim, some compiled): `fletcher/MultiMarkdown-6` (`src/critic_markup.c`,
`main.c`, CuTest suite, syntax docs, issue #41), `CriticMarkup/CriticMarkup-toolkit`
(`CLI/criticParser_CLI.py`, `Marked Processor/critic.py`, README/spec, issue #33),
`nathanlesage/lang-criticmarkup` (`src/critic.grammar`, `src/index.ts`, test fixtures, README).
Secondary (Gemini report, unverified): `ickc/pancritic`, `joostkremers/criticmarkup-emacs`,
`vim-pandoc/vim-criticmarkup`, `wafer-li/markdown-it-criticmarkup`, `Fevol/criticmarkup-parser`,
`inanimate-tech/mist`, Zettlr discussions, CommonMark forum threads (strikethrough / Reviewing
Markups / comment facility), `DivineDominion/criticmarkup.tmbundle`.
