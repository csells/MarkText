# 0009 — Source-Authoritative Intrinsic CriticMarkup Markdown Engine Rebuild

- **Status:** In progress — Phase 0
- **Created:** 2026-07-19
- **Branch:** `feat/native-criticmarkup`
- **Owns:** the architecture, migration, product behavior, and automated acceptance for the
  CriticMarkup rebuild
- **Dogfooding:** explicitly outside completion; the user will do it afterward

## Executive verdict

The current branch is not one cleanup wave away from a production-quality CriticMarkup
implementation. It has substantial useful behavior and an unusually deep test corpus, but its
authority runs in the wrong direction:

```text
DOM / mutable TState
        ↓
serialize reconstructed Markdown
        ↓
infer exact source edits and parser topology
        ↓
reparse, rebind, normalize, and repair
```

That design makes source fidelity, parser provenance, Track Changes, selection, history, comments,
and every output sink coordinate after mutation. The branch's binding graphs, source trivia,
mapped-state rebinding, rollback choreography, and hidden-comment caret repair are consequences of
that inversion. More local patches can make individual tests green, but they cannot make the system
simple, local, or trustworthy.

The target reverses the authority:

```text
typed intent
    ↓
exact source edit plan
    ↓
candidate immutable DocumentRevision
    ↓
validate language and command invariants
    ↓
atomic commit
    ↓
DOM, sidebar, menus, projections, persistence, and exports
```

This is an editor-engine migration that eliminates the parser-sidecar architecture, not merely a
swap from one sidecar to another. The existing CriticMarkup parser, UX, fixtures, sanitizers, and E2E
work are valuable as requirements, oracles, and adapters. The current canonical-state, provenance,
mutation, and rendering architecture is not the destination.

And it reverses the *parse* model as well as the authority model (decisions 11-13, ADR-0013):

```text
one parse of the source, CriticMarkup markers as zero-width grammar events
    ↓
one block AST — CriticMarkup nodes beside Markdown nodes — emitted as the parse advances,
recording a per-view fork only where eliding a marker changes Markdown structure
    ↓
Original (reject all) · Revised (accept all) · editing view  ← reads by arm selection
    ↓
the same AST the WYSIWYG editor mounts
```

Three consequences, each measurable: **text that does not change across views is parsed exactly
once** (no per-view reparse of convergent text); **each incremental edit is parsed once** — fragment
reuse, the 0-lag lever, named as future work in Phases 5/11 so no earlier phase forecloses it; and
**there is one block AST model for Markdown and CriticMarkup alike**, so no view re-parses Markdown to
recover block structure and the editor never needs a second model.

## Primary architectural law — CriticMarkup is intrinsic Markdown syntax

CriticMarkup is an intrinsic syntax family of the MarkText Markdown Profile 1 grammar, at the same
architectural level as paragraphs, emphasis, links, code spans, lists, block quotes, tables, math,
and every other enabled Markdown construct. The canonical parse starts from the exact source tape
and recognizes Markdown and all five CM forms together. CM recognition participates directly in the
same block/container state, inline delimiter state, reference-definition environment, literal
precedence, recovery, incremental-convergence, and resource-accounting rules as the rest of
Markdown. This is a normative MarkText Profile 1 architecture decision; it is not attributed to the
short upstream CriticMarkup prose specification.

“Intrinsic” is an enforceable parser boundary, not branding:

- Addition, Deletion, Substitution, Highlight, Comment, their delimiters, and their arms are native
  productions/events in the canonical Profile 1 parse.
- Each Substitution arm is an arm-local Markdown fragment with parser-created node/event identity.
  Matching state begun inside an arm must complete there; unfinished arm-local state recovers at the
  separator or closer and cannot affect source after the Substitution. The unchanged enclosing state
  resumes after the closer. See ADR-0010.
- Literal ownership and CM delimiter activity are one parser decision at each source run. A later
  range join, forest walk, projection, or consumer cannot revise that decision.
- The atomic lossless syntax graph is the parse product. `CriticMarkupForest`, source ownership,
  references, Original/Revised projections, Comment views, diagnostics, and Review indexes are
  derived lenses over its intrinsic nodes and edges, never separately recognized authorities.
- Each of Original, Revised, and Comment-display is produced by one run of the same Markdown grammar
  over that view's text, accompanied by an exact, gapless, parser-created segment map to canonical
  offsets (`validateMappedProjection` enforces the map). No view run may recognize CriticMarkup, or
  create, repair, or revise a CM node, ownership run, reference edge, marker decision, or diagnostic;
  the guard may only propose generated protection before the derived projection is finalized.
  (Amended 2026-07-22: this clause previously read "materialized by selecting and mapping retained
  parser decisions," which is measurably impossible — deleting `# ` turns a heading into a
  paragraph, and a blank line inside an Addition adds a block boundary, so a view is a genuine parse,
  not a selection. See Phase 0.5.)

The following architectures are forbidden in both the core and adapters:

- a Markdown literal/excluded-range prepass whose ranges a *separate* CM scanner then owns (a declared
  block-phase→inline-phase order inside one co-progressing parser is not this);
- a CM scanner or CM-first facade driving a partial Markdown sidecar;
- a CM-only parse whose forest is later woven into a Markdown CST;
- post-hoc topology, ownership, delimiter, or reference-resolution reconstruction;
- re-*recognizing CriticMarkup* in any flattened Original, Revised, or Comment string (building the
  *Markdown* CST over a projected string that carries an exact canonical segment map is permitted and
  is how views are produced — the forbidden thing is a second CriticMarkup authority, not a second
  Markdown parse);
- projector-only revision of an intrinsic parser decision — the guard may *add* generated protection
  but may never flip an accepted marker to rejected; and
- private marker recognition in Review, rendering, commands, clipboard/export, persistence, or UI.

The dependency direction is fixed:

```text
exact source + MarkText Markdown Profile 1
    ↓
intrinsic Markdown+CM parser
    ↓
one atomic lossless syntax graph
    ↓
derived CM index / projections / maps / diagnostics / Review index
    ↓
transformations and session
    ↓
rendering / sidebar / commands / clipboard / export / persistence
```

No arrow points upward. Every remaining CM feature in this plan is built around the immutable output
of the intrinsic parser. A downstream green cannot compensate for or count toward an incomplete
parser foundation. See ADR-0009.

## Relationship to archived plans 0006, 0007, and 0008

- Archived plan 0006 is the historical production-readiness source for the five forms, exact
  persistence, projections, Track Changes, Review operations, security, performance, platform
  builds, and final automated evidence.
- Archived plan 0007 is the historical Comment UX source for sidebar composition, hidden bodies,
  highlighted context, edit/remove, passive selection, context-menu editing, and a real mouse path
  to Review from a completely hidden sidebar.
- This plan has absorbed every surviving product outcome and automated acceptance obligation from
  those plans and is the sole active CriticMarkup implementation and closure contract.
- Every clause that prescribed mutable Muya state, bindings/rebinding, parser sidecars, serializer
  normalization, Marked authority, legacy command facades, or legacy phase status is superseded.
  Archived phase statuses, checkmarks, and evidence ledgers are regression oracles only and prove no
  phase of this rebuild.
- Archived plan 0008's local deepening suggestions are migration evidence for modules this plan
  deletes. A concept survives only when this plan places it behind the new `DocumentRevision` or
  `DocumentSession` seam.
- Manual reachability walkthroughs, personal evaluation, and Print-to-PDF use are post-completion
  dogfooding. They are not checkboxes, evidence, or blockers in this plan.

The mutation acceptance taxonomy is explicit and self-contained: typing, Backspace/Delete,
selection replacement, split/join, block conversion, table/list mutation, cut/paste, multi-match
search replacement, spellcheck, IME composition/cancel/commit, formatting, image placeholder and
resolution, undo/redo, and whole-document replacement. Every applicable tracked row requires exact
captured operations, one canonical source-edit composition, the two projection equations, untouched
decoded-source code-unit preservation outside the named hull/protection sites, one semantic history
entry, and exact undo restoration. File-byte fidelity is proved separately through the desktop
adapter.

The product-surface boundary is equally explicit. The Review sidebar, native Review menu,
contextual Review tool, command palette, and required persistent in-window mouse control are the
baseline surfaces. Additional toolbar or preference controls are out of scope. A future dedicated
accessibility expansion remains out of scope, but the pointer, keyboard/caret, focus, and
non-focus-stealing behaviors specified here remain mandatory automated acceptance.

## Settled decisions

1. **One authority.** An immutable `DocumentRevision` owns the exact canonical source and every
   interpretation of it. Mutable JSON state and the live DOM are not document authorities. A
   checksummed durable commit record is the serialized identity of that same logical revision during
   crash recovery, not a second semantic model. See ADR-0005.

2. **One intrinsic grammar and atomic lossless syntax graph.** A revision is produced by one
   MarkText Markdown Profile 1 parser in which CM forms are native productions. Its lossless graph
   retains Markdown and CM nodes, typed Substitution-arm subgraphs, projection-selection edges,
   delimiter/reference edges, and common provenance. The public `CriticMarkupForest` is a derived index over the graph's CM
   nodes, not a separately parsed product. A graph rather than a conventional containment-only AST
   is required because Markdown and CM spans can cross each other's containment boundaries. See
   ADR-0006, ADR-0009, and ADR-0010.

3. **Exact decoded source.** Parse, no-op save, autosave, and reopen preserve the decoded source
   exactly: BOM, CRLF/LF, blank lines, missing terminal EOL, marker spelling, escapes, and untouched
   trivia. Normalization is an explicit transform only. See ADR-0007.

4. **Versioned intrinsic language.** Canonical CriticMarkup is the compatibility base; behavior the
   upstream prose leaves undefined is named and tested as CM productions within the versioned
   MarkText Markdown Profile 1 grammar. `criticMarkupProfile` configures those productions; it never
   selects a peer parser pipeline. See ADR-0008 and ADR-0009.

5. **No proprietary review metadata.** Persistence uses Markdown and the five CriticMarkup forms
   only. There are no serialized IDs, threads, attachment edges, YAML review records, or invisible
   MarkText sentinels.

6. **Highlight and Comment stay independent syntax.** A gapless, nonempty `{==text==}{>>note<<}`
   pair is presented as one related Review item, following the documented CM convention. That
   relation is derived context, not parser identity or stored creation intent. Deleting all
   highlighted prose leaves the canonical standalone Comment when the effective carrier is ordinary
   present/present content, while preserving untargeted residual non-Comment nodes. Existing
   pending-revised carriers edit directly; hidden Comment descendants reject whole-anchor and
   final-contribution deletion before carrier policy. `{====}` has no barrier meaning.

7. **Source-native editing.** Every direct edit, structural edit, Review action, Track Changes
   operation, source-mode commit, undo, and redo starts as a typed intent and either atomically
   commits a new revision or changes nothing.

8. **One engine per open document.** A development flag may choose legacy or new engine when opening
   a document. A new-engine document never falls back to legacy mutation. Unsupported intents reject
   visibly.

9. **Built-in language profile.** Runtime grammar plugins are out of scope. MarkText's supported
   Markdown features are versioned built-ins. Parser internals may change without changing the
   public engine interface.

10. **Only Markup and Source edit canonical content.** Original and Revised are read-only
    projections. Changing that is a separate product design.

11. **Parse once; read every view off one structure.** The engine parses a document once. Original,
    Revised, and the editing (Markup) view are *reads* of one structure by arm selection (reject-all /
    accept-all / show-all), not separate reparses. Outside CriticMarkup marker regions the views are
    byte-identical, so text that does not change across views is parsed exactly once; the parse forks —
    recomputing both resolutions — only across a region where eliding a marker changes Markdown
    structure, and reconverges after it. Worst case (pervasive divergence) is the bounded `O(views · n)`
    the per-view proof establishes; the common case (sparse markers) is `O(n)`. This is **not** the
    retracted "one tokenization, then select" mechanism — a fork stores both fully-resolved
    sub-structures rather than sharing one tokenization across a divergence. It deletes the per-view
    reparses, the post-hoc reconstruction, and most of the flatten + boundary-safe-codec machinery. See
    ADR-0013.

12. **Parse each incremental edit once — future work.** The same principle across time: a keystroke
    should re-parse only its changed region and reuse unchanged fragments, never re-derive the whole
    document. This is the 0-lag lever (fragment reuse + main-thread time-slicing), sequenced as Phase 5
    / Phase 11. It is not required for correctness and does not change the public model; it is named
    here so no earlier phase forecloses it.

13. **One block AST model for Markdown and CriticMarkup alike.** The structure the engine exposes is a
    single block/inline AST in which the five CriticMarkup forms are nodes beside Markdown blocks and
    inlines — the same model the WYSIWYG editor mounts. The editing view is that AST; Original and
    Revised are the same AST read through arm selection. There is no separate "CM model" and "MD model,"
    and no view re-parses Markdown to recover block structure. The lossless syntax graph (decision 2)
    remains the internal authority spans cross; the block AST is the per-view read the editor consumes.

Existing scope boundaries remain: external-file concurrency and collaboration metadata are separate
efforts, and `.vscode/settings.json` is not modified.

## Language contract

Terminology is exact throughout this plan:

- **MarkText Markdown Profile 1** is the complete composed language: pinned CommonMark/GFM,
  supported built-in MarkText constructs, and the configured intrinsic CM productions. Bare
  “Profile 1 parser,” “Profile 1 grammar,” and “Profile 1 graph” mean this complete language.
- **MarkText CriticMarkup Profile 1** is the CM-production subset identified by
  `criticMarkupProfile: 'marktext-profile-1'` within that composed grammar.
- `markdownProfile` and `criticMarkupProfile` version two aspects of one parser configuration. They
  never select peer pipelines or artifacts.

The current `compatibilityCorpus` mixes upstream behavior, MarkText extensions, and malformed
recovery. The rewrite separates three suites so no implementation accident can masquerade as the
CriticMarkup specification.

### `CM_STANDARD`

This suite contains only syntax and relationships stated or demonstrated by the published
CriticMarkup specification:

| Form         | Stored form      | Payloads          |
| ------------ | ---------------- | ----------------- |
| Addition     | `{++new++}`      | `new`             |
| Deletion     | `{--old--}`      | `old`             |
| Substitution | `{~~old~>new~~}` | `old`, then `new` |
| Highlight    | `{==text==}`     | `text`            |
| Comment      | `{>>metadata<<}` | `metadata`        |

The standard suite also establishes these facts:

- A Comment is generic, unstructured metadata. MarkText preserves imported author initials,
  timestamps, Markdown-looking text, or any other payload without pretending that CM defines a
  schema for it.
- Highlight and Comment are independently valid. An immediately following Comment is the documented
  convention for a comment related to highlighted text, not a durable attachment edge.
- The upstream examples demonstrate line breaks in Addition, Deletion, and Substitution and visually
  wrap a Highlight. They do not define one uniform recursive or block grammar for all five forms,
  and Comment conversion in the reference tool folds line endings.

No projection name, Accept/Reject command, MarkText-specific escape, nesting, recovery, emptiness,
or UI lifecycle rule is attributed to the canonical prose.

### `REFERENCE_PROJECTION_CONVENTIONS`

Established MultiMarkdown accept/reject processors supply the interoperability convention MarkText
adopts for the two read-only projections; the canonical toolkit agrees form-by-form where it
implements the corresponding conversion:

| Form         | Original projection | Revised projection |
| ------------ | ------------------- | ------------------ |
| Addition     | empty               | `new`              |
| Deletion     | `old`               | empty              |
| Substitution | `old`               | `new`              |
| Highlight    | `text`              | `text`             |
| Comment      | empty               | empty              |

These rows are normative for Profile 1 and differential-tested against the reference processors, but
they are not mislabeled as rules from the short canonical prose specification.

The toolkit-reference suite also records that an unstructured Comment may immediately follow a
relevant change: its bundled example places one after a Deletion. Profile 1 generalizes the same
gapless contextual index to Addition, Deletion, Substitution, and Highlight without turning any pair
into one syntax node.

### `MARKTEXT_PROFILE_1`

Profile 1 defines the complete language MarkText accepts and emits:

1. **Lossless ownership.** Every UTF-16 code unit in the decoded source belongs to exactly one token
   or trivia leaf. Coordinates are branded half-open UTF-16 ranges. Decoding a file signature
   retains one leading U+FEFF in this string; `FileSnapshot` separately records that unit's BOM
   provenance and the encoding. The language engine's exactness contract begins with that decoded
   string. Exactly the first U+FEFF at source range `[0,1)` is virtual grammar-BOF trivia: a
   front-matter delimiter, fenced block, ATX heading, or CM opener immediately after it is
   recognized exactly as in the BOM-less source, with every reported range shifted by one. This rule
   depends only on canonical source, not `FileSnapshot` provenance; a leading encoded U+FEFF is
   indistinguishable from a signature after file reopen, so making provenance alter grammar would
   create a second authority and break semantic round-trip. A U+FEFF away from offset zero is
   ordinary text and can prevent a BOF-only construct. With two leading U+FEFF units, only the first
   is virtual trivia and the second is literal text. The source tape, hashes, projections,
   persistence, undo, and diagnostics still retain and count every U+FEFF code unit exactly. Virtual
   BOM trivia has no editable position and every generated wrapper at document start is inserted
   **after** it, so semantic commands never move it away from offset zero. If deletion, resolution,
   or projection would instead move an ordinary nonleading U+FEFF to offset zero, `BofTextCodecV1`
   preserves its text meaning with the canonical source spelling `&#xFEFF;` and records
   generated-protection provenance; reparsing must decode that entity as one text atom without
   granting BOM or front-matter status. Source mode/raw import is exempt and may intentionally
   change first-unit grammar. Fixtures cover a retained signature outside every generated CM
   wrapper, deletion of a prefix before ordinary U+FEFF, and Original/Revised/Accept/Reject paths
   that elide a CM prefix before it, with following YAML/TOML/semicolon-JSON/brace-JSON front matter,
   fence, heading, and CM openers.

2. **All complete empty forms are syntax.** Empty Addition, Deletion, Highlight, Comment, and either
   Substitution arm are semantic constructs. They do not acquire secret sentinel meaning. App
   commands never manufacture an empty form as hidden state; source edits and imported text may
   produce one, and the revision preserves it exactly.

3. **Proper CM nesting is supported.** Same-kind and mixed-kind marks may be nested to arbitrary
   semantic depth subject only to general resource budgets. CM marks may not cross other CM marks. A
   selection-based command may wrap complete existing items but must reject partial intersection.

4. **CriticMarkup is intrinsic Markdown syntax with orthogonal containment.** Recognition and parser
   state are unified; only containment topology is orthogonal. A CM item may span Markdown blocks,
   and a nonliteral Markdown span may cross a CM boundary, so neither hierarchy is forced into the
   other. The one intrinsic parser records both kinds of node, their shared source provenance, and
   their crossing relationships in its atomic lossless syntax graph. Inside a CM carrier/arm, that
   carrier's marker/separator tokens are zero-width grammar events: they consume no virtual column,
   do not break BOF/BOL/indentation, and cannot themselves satisfy Markdown syntax. Retained payload
   code units and EOL tokens keep their exact order and columns. Each Substitution arm is parsed as
   an independent Markdown fragment using the same applicable virtual BOF/BOL, indentation, outer
   container, option, and outer-definition context. An arm neither inherits open inline, link, or
   literal matching state from outside nor exports matching state to later source. Paired syntax
   with one endpoint inside an arm must have both endpoints there. Delimiters, literals, fences,
   containers, and definitions begun inside an arm must finish or recover at that arm's
   separator/closer and cannot affect its sibling or later source. The
   unchanged enclosing state resumes after the closer. The source is never interpreted as old text
   concatenated with new text. This follows the upstream guidance to wrap Markdown tags completely
   within each alternative; the rejected shared-suffix extension is documented in ADR-0010.
   Thus a root-level Substitution at virtual document BOF gives both arms BOF status and each may
   independently own YAML, TOML, semicolon-JSON, or brace-JSON front matter. A leading U+FEFF virtual-BOM unit stays once outside a
   generated CM wrapper; arms inherit its post-BOM BOF state and never reinterpret or duplicate it.
   The same wrapper away from virtual BOF cannot authenticate front matter in either arm and must
   use another valid provider or reject. This is why a complete fenced block can be enclosed as
   `{==```…```==}` and still be a fenced block, and why Markdown emphasis may cross a nested CM
   boundary. The graph maps every virtual Markdown token back to canonical source; no consumer
   constructs an elided string privately. `markdown-profile-1.yml` freezes BOF/BOL, indentation,
   lazy-continuation, delimiter-run, and block open/close cases for every CM marker placement and
   both Substitution arms, including BOM/no-BOM front matter in old/new/both arms and non-BOF
   rejection.

5. **Literal contexts win locally.** The revision freezes an exact Markdown option manifest. Under
   that manifest, the literal set is: inline code; fenced and indented code blocks; raw HTML blocks;
   inline HTML tag and attribute source; autolink targets; link/image destinations and titles;
   reference and footnote definitions; YAML, TOML, semicolon-delimited JSON, and brace-delimited JSON
   front matter; inline/block math; and diagram bodies.
   Visible link labels, image alt text, paragraphs, headings, emphasis, lists, block quotes, and
   table-cell prose are not literal. A delimiter is active only when all its code units lie outside
   an authenticated literal range in its current canonical or containing-arm parse. Literal
   precedence applies inside CM payloads. A projected literal cannot retroactively erase its
   enclosing valid CM item.

6. **Precedence is explicit.** Disambiguation follows:

```text
canonical Markdown literal
    > enclosing active CM item
    > containing-arm Markdown literal
    > nested CM candidate
    > ordinary Markdown text
```

Phase 0 checks in `markdown-profile-1.yml`, pinning CommonMark 0.31.2, GFM 0.29, every supported
MarkText extension/version/option, and—for each literal provider—the exact opener/closer grammar,
included boundary code units, interruption/termination rules, and enabled-option predicate. One
Profile 1 parser consumes the exact source tape in grammar order. Its current Markdown state decides
whether marker-looking units belong to an authenticated literal or begin a CM production; an active
CM production then advances that same state through its carrier. A Substitution production creates
two arm-local fragment states, terminates each at its boundary, and resumes the unchanged enclosing
state after its closer. Later source therefore has one canonical interpretation independent of arm
contents. Lexical,
block, inline, delimiter-resolution, recovery, and incremental phases are permitted only when they
directly build or refine the same parser-owned graph with stable source/event/node identities. A
completed Markdown prepass, CM envelope pass, excluded-range pass, arm-text parse, or projected-text
parse whose products are later joined is forbidden. The first active top-level `~>` decision is
therefore made by the intrinsic grammar while the Substitution production is open, with literal and
nested-production state already in scope. The manifest, not an implementation helper, generates the
before/at/inside/after boundary fixture inventory. It also freezes, for every Markdown construct
that ordinary text or a generated join could activate, the semantics-preserving escape/entity
spelling and the left-to-right minimum-protection tie-break used by `SemanticEditCodec`.

7. **Protective escaping is exact and reversible.** Before an opener's `{` or a Substitution
   separator's `~`, a run of `2k+1` backslashes protects the delimiter and semantically represents
   `k` literal backslashes plus the delimiter text. A run of `2k` leaves that delimiter active. For
   a node whose closer is `prefix + "}"`, only the exact zero-backslash spelling is active. Any
   positive run inserted between `prefix` and `}` interrupts the closer; both `2k` and `2k+1`
   backslashes there semantically represent `k` literal backslashes plus `}`, and no-op parsing
   preserves which spelling the user supplied. The semantic serializer uses one backslash for `k=0`
   and the shortest `2k` spelling for `k>0`. Backslashes before the closer's `prefix` do not protect
   it. Thus `\{++literal++}` has no CM node, `{~~a\~>b~>c~~}` has old text `a~>b`, and
   `{++literal ++\} inside++}` has payload `literal ++} inside`. No-op parsing and persistence
   preserve original escape spelling. For newly authored semantic text containing `k` backslashes
   immediately before an opener or separator, the grammar serializer emits `2k+1`; the
   closer-specific encoder above applies between its prefix and `}`. It does not decode general
   Markdown escapes. Protection applies only to an otherwise-active CM delimiter outside an
   authenticated Markdown literal; backslashes inside code, math, HTML, or another literal construct
   belong to that construct. A protected delimiter is never rescanned as CM after a display layer
   decodes its semantic text.

Literal codec rows cover zero/one/two semantic backslashes before each opener and separator, before
each closer prefix, and between each closer prefix and `}`. They prove that `\++}` does not protect
an Addition closer, while `++\}`, `++\\}`, and `++\\\}` interrupt it with the exact semantic results
defined above.

8. **Semantic edits are contextually encoded.** Typing in WYSIWYG is an edit to document meaning,
   not a raw-CM entry path. Before any non-Source transform is committed, `SemanticEditCodec`
   considers the retained source on both sides of every edit and every newly generated join. It
   emits the minimum deterministic Profile protection needed so that reparsing creates no CM or
   Markdown construct except the constructs explicitly named by the command, destroys or retargets
   no untargeted construct, and produces the intended semantic edit. This applies when a delimiter
   is split across old/new text, when deletion or wrapper cleanup joins old fragments, and when
   Track Changes encloses existing prose. Generated protection is transition provenance and
   canonical source; after save/reopen it is intentionally indistinguishable from a user-authored
   escape.

`ContextualEnclosureCodec` is the selection-wrapping specialization. It copies authenticated literal
spans and fully selected CM nodes byte-for-code-unit, contextually encodes ordinary leaves, emits
the requested outer node(s), and reparses to prove that outer-node identity, nested-node survival,
and semantic projection are exact. For a target admitted by the CM/Markdown-literal boundary
classifier below, a semantics-preserving spelling exists through Rule 7; failure to prove one
rejects atomically. Source-mode drafts and raw Comment-payload fields are deliberately exempt: those
are the two interfaces where typing active marker syntax is intentional.

Permanent literal rows include Highlight/Add Comment around `a ==} b` as `{==a ==\} b==}`, Highlight
around `a {++ b` as `{==a \{++ b==}`, tracked Deletion of `a --} b` as `{--a --\} b--}`, insertion
of `}` after an existing `==`, insertion of `{` before existing `++x++}`, deletion of `q` from
`{q++x++}` yielding protected `\{++x++}`, deletion of `x` from `{x++y++}` yielding protected
`\{++y++}`, a top-level `~` + inserted `>` inside a Substitution arm, and every
opener/closer/separator split across retained/inserted and retained/retained boundaries. Wrapping
the complete `{++x++}` and `{~~old~>new~~}` nodes preserves their owned delimiters as nested syntax
rather than escaping them.

Authenticated Markdown literals are atomic semantic owners for WYSIWYG mutation. A
`LiteralEditOwner` is the smallest complete Markdown source node that can carry outer CM while each
projected arm reparses to the intended subtree: complete inline-code span; fenced or indented code
block; raw-HTML block; inline-HTML tag token; autolink; link/image when editing its destination or
title; reference/footnote definition; any enabled Profile 1 front matter; inline/block math node; or diagram block.
CM-looking bytes inside that owner remain literal bytes.

The enclosure target classifier, computed from the revision graph rather than DOM tags, reports:

- `literal-disjoint`, when no owner is intersected;
- `literal-complete`, when the selection contains the owner's complete visible semantic contribution
  and widening to its exact source boundaries adds only owned syntax/trivia;
- `literal-inside`, when it contains only part of one owner's visible contribution;
- `literal-partial`, when an endpoint or discontiguous target cuts an owner; or
- `literal-source-only`, when it maps only to noneditable literal syntax.

Add Comment and Mark Highlight admit `literal-disjoint` and `literal-complete`. A complete target
widens to exact owner boundaries and may include adjacent selected prose or complete CM nodes. The
codec then proves the requested outer Highlight is active, the owner source/provider/meaning and
node identity survive exactly inside it, and both projections reproduce the pre-command Markdown
meaning. The other three classes reject atomically with typed `selection-inside-markdown-literal`,
`selection-partially-intersects-markdown-literal`, or
`selection-targets-noneditable-markdown-source`; Add Comment opens no composer or retained draft.
Mere source adjacency is not intersection. The Markdown manifest declares whether each provider
variant exposes a selectable visible contribution in each view. Every applicable
inside/partial/full/before/after coordinate has a fixture; a provider such as nonrendering
inline-HTML syntax, a link destination, reference definition, or front matter with no editable
visible contribution has an explicit `literal-source-only` or typed `inapplicable` row, never a
manufactured positive full-selection test. Add Comment's prospective root-Revised-contribution rule
remains an additional gate after literal completeness. For ``p `abc` q``, selecting the whole
visible `abc` widens to the code-span owner and yields ``p {==`abc`==}{>>note<<} q``; selecting only
`b` rejects.

Ordinary editing inside a literal is provider-owned editing, not enclosure. Track off commits the
exact untracked candidate and proves the intended owner reparses; it never inserts incidental CM
inside literal bytes. With Track on, a `(present,present)` semantic subtree that exists before and
after becomes one outer Substitution; a subtree semantically deleted becomes a whole-owner Deletion,
and a newly inserted subtree becomes a whole-owner Addition. The old arm is the exact previous
grammar-safe target hull and the new arm the exact untracked-candidate hull. Owner syntax appearing
or disappearing does **not** mean the semantic subtree was inserted or deleted. For example,
formatting plain `abc` as inline code yields ``{~~abc~>`abc`~~}``; removing that formatting yields
``{~~`abc`~>abc~~}``; converting inline code to inline math yields ``{~~`abc`~>$abc$~~}``. The old
literal node does not survive a provider conversion and the new one has a fresh identity; unchanged
source outside the complete semantic hull survives. Inserting `X` into `` `abc` `` yields
``{~~`abc`~>`abXc`~~}``, not inert CM bytes inside code. `(absent,present)` owners edit directly
under their existing pending carrier; `(present,absent)` is read-only. The containing-arm parser
authenticates each complete literal independently and both Track projection equations must hold.

A multi-owner intent emits one atomic transition per proven one-to-one owner mapping in the same
source transaction; an explicitly structural command may name one larger complete semantic hull.
Formation, dissolution, and provider conversion require a one-to-one before/after semantic-hull map;
otherwise the command rejects rather than misclassifying syntax change as content
insertion/deletion. If the minimum owner/hull contains an untargeted active CM node, widening would
add an unselected visible atom, the old→new mapping is ambiguous, or active outer CM cannot be
placed outside all literal ranges, tracking rejects as `track-literal-owner-unavailable` or
`track-literal-owner-contains-review`. It never duplicates an existing Review node into both
Substitution arms. Literal fixtures cover every owner above, including ``p `abc` q`` →
``p {~~`abc`~>`abXc`~~} q``, `[x](old)` → `{~~[x](old)~>[x](new)~~}`, HTML-attribute and
fenced-block edits, direct pending-Addition edits, read-only pending Deletion, a literal owner
containing Review, plain↔code formation/dissolution, code→math provider conversion, and two-owner
replacement. Each freezes exact old/new source, both projections and meaning trees, locality,
mapping, survivor identities, and one-step undo/redo under Track off and on.

9. **The first active top-level** `~>` **splits a Substitution.** A separator inside a nested CM
   item or authenticated Markdown literal does not count, and a protected `\~>` is payload text.
   Zero active top-level separators makes the outer candidate malformed. Later active top-level `~>`
   sequences belong to the revised arm: `{~~a~>b~>c~~}` means old `a`, new `b~>c`. This matches the
   canonical toolkit and MultiMarkdown 5 grammar and intentionally differs from MultiMarkdown 6's
   multiple-divider behavior; fixture metadata names that divergence. The fixture
   ``{~~`a~>b`~>c~~}`` chooses the second `~>`: the code span belongs to the old arm and `c` to the
   new arm.

10. **Multiline and block-spanning forms are first-class.** Every form can span soft breaks, blank
    lines, and Markdown block boundaries. Projection-specific Markdown trees own the resulting block
    structure.

11. **Comment payloads are lossless inline subdocuments.** Every Comment may span lines and blank
    lines in canonical source. The intrinsic Profile 1 parser—not a Comment-specific literal lexer
    or nested-CM scan—creates the canonical Comment payload subtree, its Markdown literal decisions,
    and every nested CM node. For card presentation only, recursively select that subtree's Revised
    arm selection with raw/source maps; fold each maximal `H*(EOL H*)+` sequence to one U+0020, where `H` is
    U+0020 or U+0009 and `EOL` is one CRLF token or one bare CR or LF; apply that fold as a mapped
    leaf/text transformation over the retained Comment events; materialize the display tree from
    those mapped events; then sanitize for the Review sink. An optional clean post-fold parse is a
    verifier only: its product is discarded and it may reject a mismatch but cannot supply or repair
    the displayed tree. That Comment-display Markdown profile renders
    raw HTML tokens as escaped text rather than live elements; the sanitizer is still the final
    defense for links and generated HTML. The fold consumes only U+0020 and U+0009 next to the
    line-ending run, never NBSP or other whitespace, and applies across all retained
    segments—including authenticated inline-code, HTML, and math literal bodies—only after literal
    authentication and nested-CM projection are complete. It therefore cannot change CM recognition.
    Fixtures freeze CRLF, bare CR/LF, blank-line, tabs-on-both-sides, and multiline code/HTML/math
    cases. The parser preserves exact raw payload and exposes properly nested CM in a
    comment-specific tree. Main Original/Revised projections elide the complete outer Comment,
    including all descendants. Comment descendants are not promoted into the main Review list or
    independently mutated through WYSIWYG. A card shows the sanitized Revised projection of its
    inline subdocument and edits its exact raw payload. In fixture ``{>>`{++x++}`<<}``, the
    Addition-looking bytes belong to inline code and create no nested CM node. MarkText infers no
    author/thread schema.

12. **Comment context is derived and type-aware.** For any Comment, the semantic index exposes
    `precedingChange` when its immediate, gapless previous sibling in the same CM parent and
    Substitution arm is an Addition, Deletion, Substitution, or Highlight. This relation never
    changes syntax identity. Only a Highlight with a nonempty Revised-visible contribution followed
    by a Comment receives the special one-card `anchoredComment` presentation required by this
    plan's Comment UX contract. The
    core's revision-owned `RevisedContribution` classifier—not DOM pixels, CSS, or a renderer
    heuristic—decides this. A contribution must have provenance inside the Highlight and survive its
    full ancestor-carrier path into the document's root Revised plan. Counting atoms are: a decoded
    text leaf with at least one UTF-16 code unit (including spaces, tabs, ZWJ, and other zero-width
    text); soft/hard breaks and thematic breaks; images and other safe replaced objects; code or
    math objects, including an empty rendered object; and text or displayed/replaced elements
    admitted by the revision's immutable `LiveHtmlSafetyProfileId` (`<br>` counts). That ID is part
    of `ParseConfiguration`, `RevisionSemanticHash`, revision/cache identity, and every contribution
    fixture—but never `SourceHash`; changing it requires `reinterpret`. Empty container markup such
    as `[](u)`, HTML comments, raw HTML discarded by that safety profile, syntax/trivia alone,
    hidden Comments, and changes suppressed by an ancestor do not count. Thus `{--{==x==}{>>c<<}--}`
    has no anchored-card presentation in the root Revised context. Raw marker/payload length and
    Comment payload emptiness never control pairing. **Remove Comment** on that pair unwraps the
    Highlight while retaining its exact payload source, including nested CM, except for minimum
    protection at a causally reclassified delimiter or a provenance-bearing `BofTextCodecV1`
    encoding when unwrapping moves an ordinary nonleading U+FEFF to offset zero, and deletes the
    Comment in one source transaction; for every other context it deletes only the Comment. With
    Track Changes off, ordinary deletion of all anchor prose removes the Highlight wrapper, retains
    untargeted residual non-Comment nodes, and leaves the adjacent standalone Comment, provided the
    Highlight does not contain a hidden Comment descendant; whole or final-contribution exhaustion
    then rejects as defined below. The tracked whole-anchor rule is also defined below. If a later
    parse makes that Comment gapless after another change, it derives the new context the source
    expresses. No creation-intent flag or `{====}` sentinel is persisted.

13. **Resource behavior is total and deterministic.** Parsing, projection, and rendering are
    iterative over CM depth; recognized Comment bodies remain hidden and noneditable at every depth.
    `open` always returns the exact decoded source in either a complete revision or a source-only
    revision with a fatal resource diagnostic. A source-only revision permits source viewing, exact
    persistence, and retry under a larger budget, but no WYSIWYG or static semantic render. `revise`
    and `dispatch` reject before commit when a budget is exceeded, leaving the prior revision
    unchanged. No path truncates, normalizes, or presents disputed marker text as trusted prose.

`ParseConfiguration` records execution-budget identity separately from language identity.
`ExecutionBudgetId` is the pair of a limits profile and an accounting-schema ID. Desktop budget
`desktop-v1/syntax-accounting-1` accepts at most 32,000,000 decoded UTF-16 code units, 2,000,000
`BudgetEvent`s, 128 nested Markdown block containers, and 16,384 nested CM nodes. Preflight applies
these limits in that order and emits one stable diagnostic at the first exceeded boundary. Limits
are count-based, never wall-clock-based. Source units are `decodedSource.length`. CM depth is the
maximum accepted Profile forest depth, including Comment subtrees. Markdown depth is the maximum
across canonical, Original, Revised, and every Comment-display CST.

`syntax-accounting-1.yml` is the normative, implementation-independent event algebra. It enumerates:
one `TapeRun` for each maximal contiguous source run with the same frozen lexical role (CRLF is one
EOL token and each complete CM delimiter/separator has its named role); one `MarkdownNode` for each
listed grammar production occurrence in canonical, Original, Revised, and Comment CSTs; one
`CriticNode`, `MarkerNode`, and applicable `ArmNode` for each accepted CM form; and one
`ProjectionSegment` for each maximal run with the same view action, provenance owner path, and
affine source mapping. Runs are maximal over the whole logical artifact and may not be split at
storage chunks, incremental checkpoints, green-node sharing, or allocation boundaries. Caches,
diagnostics, indexes, history, checkpoints, and physical helper objects emit no event. The manifest
assigns every event's stable ordering key and source range and contains literal expected event
traces and totals for empty/plain/all-five/nested/literal/malformed/Comment-display fixtures plus
the three 2,000,000 boundary generators. Full and incremental modes must emit the same trace before
any limit decision. A harmless parser refactor therefore cannot change accounting; any incompatible
taxonomy or maximalization change requires a new accounting-schema ID and explicit
reinterpretation/migration tests, never a silent `desktop-v1` change.

Each Substitution arm contributes one bounded fragment parse and explicit arm-entry/termination
events; choosing an arm never changes parsing after the closer, so sequential or nested
Substitutions add work linearly in source length and arm count. Following source is parsed once from
the unchanged enclosing state. Original, Revised, and actionable outer Comment displays are fixed
derived traversals. `BudgetEvent` counts only the manifest's source, syntax, arm, and projection
events; parser checkpoints and helper states remain uncounted implementation details.

The same source and full configuration must hit the same first exceeded boundary and produce the
same complete/source-only classification and diagnostic on every platform. Unexpected allocation
failure is an engine fault, not an alternate recovery grammar, and cannot count as a passing
resource test.

Recursive projection matrix

Projection is recursive and outer elision dominates descendants. First choose whether a parent
carrier recurses into its payload:

| Parent carrier       | Original | Revised  |
| -------------------- | -------- | -------- |
| Root                 | recurse  | recurse  |
| Addition payload     | omit     | recurse  |
| Deletion payload     | recurse  | omit     |
| Substitution old arm | recurse  | omit     |
| Substitution new arm | omit     | recurse  |
| Highlight payload    | recurse  | recurse  |
| Comment payload      | omit all | omit all |

Whenever the carrier says `recurse`, each child operator applies:

| Child form   | Original child result | Revised child result |
| ------------ | --------------------- | -------------------- |
| Addition     | omit payload          | recurse into payload |
| Deletion     | recurse into payload  | omit payload         |
| Substitution | recurse into old arm  | recurse into new arm |
| Highlight    | recurse into payload  | recurse into payload |
| Comment      | omit entire subtree   | omit entire subtree  |

These two tables define every parent-form × child-form × Substitution-arm combination. Comment-card
presentation starts at the raw Comment payload, applies the Revised child column while preserving
raw/source mapping, and only then folds retained newline/indentation runs for inline Markdown
presentation; a nested Comment remains hidden.

The conformance generator must execute all 7 parent-carrier × 5 child-form cells, both projections,
both Substitution arms, same-kind nesting, and a fixture that nests all five forms together.
Expected strings are literal fixture data, never computed by the implementation under test.

Boundary-safe projected Markdown

A projection is not a concatenated semantic string. Each revision exposes `ProjectedMarkdown` for
Original and Revised with three distinct layers:

- canonical `rawPayloadSource` slices, including existing protective spelling;
- boundary-safe projected Markdown source plus provenance segments; and
- a projected Markdown CST/meaning tree materialized by recursive arm selection from retained events in
  the intrinsic canonical graph, followed by typed rendering.

Recursive arm selection can place two canonical Markdown delimiters next to each other even though
their retained parser events cannot match—for example, one endpoint outside a Substitution and the
other inside an arm. `ProjectionGuardV1` therefore composes CM-transition authentication with the
Profile 1 Markdown boundary guard. At the first transition that a clean parse would commit contrary
to the retained graph, it selects the left-to-right prefix-minimal **typed codec edit** declared for
that Markdown provider. Most edits insert one escape before the responsible delimiter. Preserving an
already-retained construct may instead require one atomic paired edit, such as extending both ends
of an inline-code span or respelling both ends of enclosing emphasis. A fragment boundary may require
a generated fence closer or line ending. Every generated unit carries causal-elision provenance at
its canonical delimiter, scalar, or arm-exit position. Fully arm-local pairs and pairs whose
endpoints both enclose the whole Substitution remain unprotected. The final clean verifier must
reproduce both the retained CM decisions and this retained Markdown meaning.

The projector walks the recursive matrix once and produces a `ProjectionCandidateV1`: retained raw
units with canonical provenance, stable elision records, every generated adjacency, and any prior
`BofTextCodecV1` unit. It never decodes a protected delimiter into projected source. Before emitting
protected source it freezes a `RetainedProjectionSyntaxManifestV1` from the canonical revision and
requested transition. That manifest contains:

- every retained canonical CM and Markdown delimiter/literal/reference decision that must remain
  inactive or literal, with parser-created identity and arm-boundary scope;
- every retained active CM opener, separator, and closer that may remain active, including its exact
  form, role, expected containing frame, and expected opener relationship;
- every retained active Markdown opener/closer pair, literal provider, definition/reference edge,
  and block/container relationship that may remain active after recursive arm selection;
- the exact revision-mapped CM survivor set and expected survivor-parent relationship; and
- the canonical incomplete-frame relationships for retained malformed syntax.

Markers belonging to a discarded node may not appear in the retained manifest, and every marker
required by a survivor must be retained. Violating either rule is an engine fault before protection
begins. Original and Revised projection have an empty complete-node survivor set, although retained
malformed decisions may still be present. Elision can make a previously non-top or unterminated
retained delimiter active even when all three code units came from one slice, or can retarget two
individually compatible delimiters into a new node.

`ProjectionGuardV1` is a guarded observer/planning mode of the intrinsic Profile 1 parser kernel,
not a second state machine or guard-local recognizer. The projector supplies only the candidate and
`RetainedProjectionSyntaxManifestV1` through a narrow internal port; the parser kernel owns every grammar
transition and returns delimiter decisions plus the protection plan. Projection and materializer
modules cannot import the raw parser entry point. The kernel performs one iterative, left-to-right
guarded run over the whole candidate. Candidate coordinates are ordinals in the pre-protection
candidate tape, so earlier generated backslashes never renumber later decisions:

The projector materializes its expected CST, ownership, references, and meaning from the canonical
graph before this run. The guarded run and final clean parse below are validators of that derived
product, not sources for it. They may reject publication but may not contribute nodes, edges,
ownership, references, diagnostics, or repair missing canonical decisions.

1. Before committing any otherwise-active CM or Markdown transition, authenticate it against
   `RetainedProjectionSyntaxManifestV1`. CM authentication requires an exact retained canonical
   delimiter identity—not merely equal characters—the manifest form and role, the expected current
   parent for an opener, the expected opener for a Substitution separator or closer, and, when the
   transition completes a node, the expected survivor identity and parent. Markdown authentication
   likewise requires retained opener/closer identities, arm-boundary scope, literal-provider or
   definition/reference edge, and expected node meaning. A delimiter assembled across an elision
   has no canonical permission merely because its spelling now matches. A decision that was
   canonically inactive or whose endpoints crossed an arm boundary has no permission to become
   active.

2. A transition that satisfies the manifest commits normally. An otherwise-active transition that
   fails authentication is unsafe. Its responsible delimiter is the delimiter for that first failing
   transition: an unauthenticated or wrongly parented opener is responsible at its opener; a
   separator that would split a different frame is responsible at its separator; and a closer that
   would bind a different frame or complete an unexpected node is responsible at its closer. A
   completed or retargeted node is a consequence, never a separate repair candidate.
   For an unauthorized Markdown match, the responsible delimiter is the first delimiter in guarded
   decision order whose activation would create the mismatched pair, provider, or edge.
   Malformed-recovery promotion is assigned to the delimiter transition that first commits the
   promoted node.

3. For the responsible transition, plan exactly one shortest `ProjectionCodecEditV1` at its frozen
   Profile 1 site. Rule 7 defines the CM sites. The Markdown provider table defines one of these
   deterministic operations:

   - insert one escape before the responsible escapable delimiter;
   - for an authenticated retained inline-code span, extend both canonical delimiter runs to one
     code unit longer than the longest interior run; an assembled or otherwise unauthenticated run
     is not eligible and falls back to delimiter protection;
   - for authenticated enclosing emphasis, respell both delimiter runs with the alternate marker
     and entity-encode only the nearest round-tripping Unicode scalar(s) whose raw spelling would
     otherwise defeat flanking. Raw U+0000 and unpaired surrogate units retain their exact source
     spelling and use CommonMark's virtual U+FFFD semantics for flanking; they are never emitted as
     non-round-tripping numeric-reference codecs; or
   - at a self-contained arm exit, emit the shortest matching fence closer or the one line ending
     required to terminate the selected block fragment before the unchanged suffix.

   A paired or fragment operation is one causal repair even though it may emit units at more than
   one frozen candidate ordinal. Feed its protected spelling back to the same run and continue after
   the original candidate units; do not rewind or rescan a prefix or suffix. If an earlier repair
   makes a later delimiter otherwise active, judge that later transition when its candidate ordinal
   is reached.

4. This is the sole protection order: ascending candidate ordinal under the Profile machine's frozen
   token-decision order. There is no rightmost search or cross-provider kind-priority tuple. Each
   repair is prefix-minimal within its provider's typed codec: with the already emitted prefix fixed,
   omitting the edit would commit the observed unauthorized transition, and no shorter valid spelling
   preserves the retained construct and meaning. A paired edit may touch a previously seen retained
   opener only when that opener identity and the complete pair were frozen in the manifest before the
   run. The guard never edits a delimiter that would remain inactive.

5. After the guarded run, emit all planned insertions and perform exactly one clean, unguarded full
   intrinsic Profile parse of the result. It must independently match every required retained
   decision, the exact survivor identities/relationships, and the already-derived projected
   Markdown CST, meaning, and provenance map, with no other active delimiter or CM node. Its parse
   product is discarded after comparison. A mismatch is an engine fault that commits/publishes
   nothing; it never starts another repair pass or substitutes verifier output.

The guarded run emits `DelimiterDecisionTraceV1`. Each tentative decision records bounded-fanout
dependencies on retained input, parser-state transitions, stable elision IDs, and prior
generated-protection decisions. For each generated codec edit, `causingElisions` is the sorted unique
backward slice from the responsible transition's rejected tentative decision through only differing
dependencies to stable elision IDs. A dependency on an earlier protection expands through that
protection's slice; a repair with no causing elision is an engine fault.

Provenance stores each slice as a structurally shared `CausalSliceRef` rather than eagerly copying
an elision-ID array per repair. Expanding `causingElisions` is deterministic and output-sensitive;
shared trace work is memoized. Public provenance for a generated protection is exactly
`{ kind: 'generated', sourcePosition, affinity: 'next' }`: `sourcePosition` is the canonical offset
of the causal retained delimiter/scalar, or the parser-owned arm-exit position for a fragment
terminator. For a simple insertion this is normally the retained unit immediately after it (the
Markdown delimiter, `{`, `~`, or the closer's `}`). Each generated unit in a paired delimiter edit
uses its corresponding endpoint; each unit replacing a flanking scalar uses that scalar's canonical
start. The repair belongs to that zero-width provenance record, never a neighboring retained slice.

For a candidate of `N` UTF-16 units, `D` delimiter decisions, `T` trace edges, `R` typed repairs,
`Q` replaced candidate units, and `G` generated output units, `T`, `D`, `R`, and `G` are each
`O(N)`, every candidate decision is consumed once, and emitted length is `N - Q + G`. Candidate
construction, guarded recognition, protection planning, and final verification use `O(N + G)` time
and space, excluding the unavoidable size of explicitly requested cause-list output. A nontrivial
projection invokes at most two whole-candidate Profile runs—the guarded run and clean
verification—independent of `R`; suffix replay and repair-by-reparse loops are forbidden.

Trace schema, manifest identity, candidate ordinals, guarded decision order, responsible-delimiter
identity, inserted source, cause sets, source affinity, and final parser-call count are literal
fixture data for isolated, independent, retargeted, and repair-dependent cascade cases.

Individual Accept/Reject/Remove planning uses the same candidate-manifest-guard protocol with its
nonempty expected survivor set; `SemanticEditCodec` invokes the same unified projection-syntax
guard required by Rule 8. Neither path may fall back to iterative whole-candidate
repair.

These laws are permanent fixtures:

1. reparsing Original/Revised projected Markdown recognizes no CM nodes;

2. a delimiter made literal in canonical source remains literal after projection and is never
   rescanned after semantic display decoding;

3. projection is source-idempotent: `project(open(project(revision, view).source), view).source`
   equals the first projected source;

4. no generated adjacency or changed stack/precedence context synthesizes an active opener, closer,
   separator, or CM node;

5. Accept All/Reject All use the corresponding boundary-safe projected source, and reparsing their
   committed source recognizes no CM nodes; and

6. individual resolution reparses with exactly the revision-mapped survivor set and no synthetic
   node. Retained raw slices are code-unit exact except for a prefix-minimal generated protection at
   a `ProjectionGuardV1`-rejected responsible delimiter or a provenance-bearing `BofTextCodecV1`
   encoding required to keep an ordinary nonleading U+FEFF from becoming BOF trivia after the
   resolution.

Required literal fixtures include `{++\{--x--}++}` (Revised keeps `\{--x--}`), `{~~a\~>b~>c~~}`, and
`{{--z--}++x++}` (Revised emits the protected source `\{++x++}` rather than synthesizing an
Addition), plus every split delimiter across an elided child boundary. The malformed fixture
`{++a{--b++}c--}` promotes Deletion `[4,15)`; Rejecting that Deletion must emit `{++ab++\}c`, not
synthetic `{++ab++}c`, and its protection provenance names that resolution's elisions.

### `MALFORMED_RECOVERY`

Malformed input is valid editor input, not an exceptional API condition:

- unmatched openers and closers remain literal source;
- a malformed outer candidate does not swallow a later complete item;
- same-kind nesting closes last-in/first-out;
- an active closer closes only the top compatible frame; a non-top closer is literal, so no semantic
  nodes cross;
- an outer Substitution with no active top-level separator remains literal;
- complete descendants of an invalid or unterminated frame are promoted in source order to the
  nearest valid carrier or the root;
- parser diagnostics use the stable code/range contract below;
- `parse(source).source.text === source` for every malformed input;
- malformed user input never throws, loops indefinitely, or causes quadratic suffix rescans.

Profile 1 freezes malformed diagnostic identity; parser implementation order is not observable:

| Code                                  | Primary range                                     | Multiplicity/metadata                                                                                                    |
| ------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `CM_UNMATCHED_CLOSER`                 | the exact three-code-unit closer                  | one per closer with no compatible open frame                                                                             |
| `CM_NON_TOP_CLOSER`                   | the exact three-code-unit closer                  | one per closer; records found form and currently open top form                                                           |
| `CM_UNTERMINATED_OPENER`              | the exact three-code-unit opener                  | one per still-open frame; Substitution metadata is exactly `{ separatorSeen: 'true' }` or `{ separatorSeen: 'false' }`    |
| `CM_SUBSTITUTION_SEPARATOR_MISSING`   | opener through its compatible closer              | one per closed Substitution candidate with no valid top-level separator; it emits no additional opener/closer diagnostic |
| `CM_RESOURCE_SOURCE_UNITS_EXCEEDED`   | zero-width at the admitted source limit           | the sole diagnostic after first-failure preflight                                                                        |
| `CM_RESOURCE_LOGICAL_NODES_EXCEEDED`  | the opener/token that would exceed the limit      | the sole diagnostic after first-failure preflight                                                                        |
| `CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED` | the opener that would create the excess container | the sole diagnostic after first-failure preflight                                                                        |
| `CM_RESOURCE_CM_DEPTH_EXCEEDED`       | the CM opener that would create the excess frame  | the sole diagnostic after first-failure preflight                                                                        |

Diagnostics are deduplicated by `(code, range, metadata)` and sorted by primary range start, then
end, then the table's code order. Localized prose is not part of parser equivalence. In
`{++a{--b++}c--}`, the Deletion `[4,15)` is promoted to root and the exact diagnostic list is
`CM_UNTERMINATED_OPENER [0,3)` followed by
`CM_NON_TOP_CLOSER [8,11) { found: Addition, top: Deletion }`. In `{~~a{++b++}~~}`, the Addition
`[4,11)` is promoted to root and the only diagnostic is `CM_SUBSTITUTION_SEPARATOR_MISSING [0,14)`.
`cm-diagnostics.yml` contains literal expected nodes and diagnostics for every malformed corpus row;
full and incremental parsing must match it exactly.

The corpus must include all five forms, every delimiter boundary, empty arms, same/mixed nesting,
crossing candidates, multiline and block-spanning forms, repeated identical text, Unicode/astral
characters, BOM/CRLF/LF/no-terminal-EOL variants, hostile HTML/URLs, and resource limits.
Literal-precedence fixtures cross every declared literal construct and every opener/closer/separator
at one code unit before, at, within, and one code unit after each boundary under every supported
Markdown option profile.

## Target architecture

The new pure TypeScript package is `@marktext/document-core`. Muya becomes a browser/WYSIWYG
adapter. Electron remains the platform adapter. No Marked, Muya state, DOM, Vue, Pinia, or Electron
type appears in the core's public interface.

```text
Renderer                    Host                         Revision worker
────────                    ────                         ───────────────
DocumentSessionClient ───▶ SessionCoordinator ───────▶ DocumentSession core
pending overlay/cache       mailbox + commit arbiter     LanguageEngine
DOM/Review consumers        checksummed journal          immutable revision
        ▲                         │                              │
        │ atomic snapshot         │ prepared/committed           ├─ exact source tape
        │ envelopes               │ identity                     ├─ intrinsic atomic lossless Profile 1 graph
        └─────────────────────────┴──────────────────────────────┤
                                                               ├─ Original/Revised CSTs
                                                               ├─ semantic indexes/maps
                                                               ├─ LiveRenderPlan deltas
                                                               └─ typed materializers

Persistence receives a pinned canonical-source lease from the exact committed
revision/checkpoint. It bypasses DOM, plans, CST serialization, and materializers.
```

### `LanguageEngine`

```ts
interface LanguageEngine {
  open(source: SourceSnapshot, configuration: ParseConfiguration): DocumentRevision
}

// Package-private: absent from package exports.
interface RevisionKernel {
  revise(previous: DocumentRevision, edits: readonly SourceEdit[]): RevisionOutcome
  reinterpret(previous: DocumentRevision, configuration: ParseConfiguration): RevisionOutcome
}

interface ParseConfiguration {
  /** Native CM-production contract within markdownProfile; never a separate parser pipeline. */
  readonly criticMarkupProfile: CriticMarkupProfileId
  readonly markdownProfile: MarkdownProfileId
  readonly markdownOptions: MarkdownOptionsV1
  readonly liveHtmlSafetyProfile:
    | 'live-html-sanitized-v1'
    | 'live-html-escaped-v1'
  readonly executionBudget: ExecutionBudgetId
}

interface MarkdownOptionsV1 {
  readonly schema: 'markdown-options-1'
  readonly frontMatter: boolean
  readonly math: boolean
  readonly gitLabMath: boolean
  readonly footnotes: boolean
  readonly subscriptAndSuperscript: boolean
}

type DocumentRevision = CompleteDocumentRevision | SourceOnlyDocumentRevision

interface SourceSnapshot {
  /** Exact decoded UTF-16 source; no normalization or synthesized terminator. */
  readonly text: string
}

interface CompleteDocumentRevision {
  readonly kind: 'complete'
  readonly source: SourceSnapshot
  readonly configuration: ParseConfiguration
  /** Derived index over intrinsic CM nodes in the canonical Profile 1 syntax graph. */
  readonly criticMarkup: CriticMarkupForest
  readonly diagnostics: DiagnosticIndex
  /** Gapless canonical-source ownership; never parser frames or mutable lexer tokens. */
  readonly ownership: SourceOwnershipIndex
  readonly projection: (view: 'original' | 'revised') => ProjectedMarkdown
}

interface SourceOnlyDocumentRevision {
  readonly kind: 'source-only'
  readonly source: SourceSnapshot
  readonly configuration: ParseConfiguration
  readonly fatalDiagnostic: SourceOnlyDiagnostic
}

type SourceOnlyDiagnostic = ResourceDiagnostic | CompatibilityDiagnostic

interface CriticMarkupForest {
  readonly roots: readonly CriticMarkupNode[]
}

interface DiagnosticIndex {
  readonly count: number
  /** Return one stable recoverable diagnostic by sorted ordinal. */
  readonly at: (ordinal: number) => SyntaxDiagnostic
}

type CriticMarkupNode =
  | UnaryCriticNode<'addition', 'content'>
  | UnaryCriticNode<'deletion', 'content'>
  | SubstitutionNode
  | UnaryCriticNode<'highlight', 'content'>
  | UnaryCriticNode<'comment', 'comment'>

interface UnaryCriticNode<
  Kind extends 'addition' | 'deletion' | 'highlight' | 'comment',
  Arm extends 'content' | 'comment'
> {
  readonly kind: Kind
  readonly range: SourceRange
  readonly markers: {
    readonly open: SourceRange
    readonly close: SourceRange
  }
  readonly arms: readonly [CriticMarkupArm<Arm>]
}

interface SubstitutionNode {
  readonly kind: 'substitution'
  readonly range: SourceRange
  readonly markers: {
    readonly open: SourceRange
    readonly separator: SourceRange
    readonly close: SourceRange
  }
  readonly arms: readonly [CriticMarkupArm<'old'>, CriticMarkupArm<'new'>]
}

interface CriticMarkupArm<Name extends 'content' | 'old' | 'new' | 'comment'> {
  readonly name: Name
  readonly range: SourceRange
  readonly children: readonly CriticMarkupNode[]
}

interface ProjectedMarkdown {
  /** Boundary-safe projected Markdown source, before Markdown rendering. */
  readonly source: string
  readonly provenance: ProjectionProvenance
  /** Graph-derived Profile 1 Markdown interpretation of this exact projected source. */
  readonly markdown: MarkdownDocument
}

interface SourceOwnershipIndex {
  readonly count: number
  /** Return one maximal canonical ownership run by source order. */
  readonly at: (ordinal: number) => SourceOwnershipRun
  /** Return the one run owning a canonical UTF-16 code unit. */
  readonly ownerAt: (sourceOffset: number) => SourceOwnershipRun
}

interface SourceOwnershipRun {
  readonly range: SourceRange
  readonly owner:
    | {
        readonly kind: 'critic-marker'
        readonly form: CriticMarkupNode['kind']
        readonly role: 'open' | 'separator' | 'close'
        readonly nodeRange: SourceRange
      }
    | {
        readonly kind: 'markdown-literal'
        readonly provider:
          | 'inline-code'
          | 'fenced-code'
          | 'indented-code'
          | 'html-block'
          | 'inline-html'
          | 'autolink'
          | 'link-destination'
          | 'definition'
          | 'front-matter'
          | 'math'
          | 'diagram'
        readonly ownerRange: SourceRange
      }
    | { readonly kind: 'markdown-text' }
    | {
        readonly kind: 'trivia'
        readonly role: 'virtual-bom' | 'line-ending'
        readonly spelling?: 'lf' | 'cr' | 'crlf'
      }
}

interface MarkdownDocument {
  /** Exactly the containing ProjectedMarkdown.source. */
  readonly source: string
  readonly root: MarkdownNode
  /** Ordered outermost-to-innermost semantic path at one projected position. */
  readonly nodeAt: (
    projectedOffset: number,
    affinity: 'previous' | 'next'
  ) => readonly MarkdownNode[]
}

interface MarkdownNode {
  readonly kind: MarkdownNodeKind
  /** Half-open coordinates in MarkdownDocument.source. */
  readonly range: { readonly start: number; readonly end: number }
  readonly attributes: Readonly<Record<string, string | number | boolean>>
  readonly childCount: number
  readonly childAt: (ordinal: number) => MarkdownNode
}

type MarkdownNodeKind =
  | 'document' | 'paragraph' | 'heading' | 'blockquote' | 'list' | 'list-item'
  | 'thematic-break' | 'text' | 'soft-break' | 'hard-break' | 'emphasis'
  | 'strong' | 'strikethrough' | 'link' | 'image' | 'inline-code' | 'code-block'
  | 'inline-html' | 'html-block' | 'autolink' | 'definition' | 'front-matter'
  | 'inline-math' | 'math-block' | 'diagram' | 'table' | 'table-row' | 'table-cell'
  | 'footnote-definition' | 'footnote-reference'

interface ProjectionProvenance {
  /** Return the origin of one projected UTF-16 code unit. */
  readonly originAt: (projectedOffset: number) => ProjectedCodeUnitOrigin
}

type ProjectedCodeUnitOrigin =
  | { readonly kind: 'canonical'; readonly sourceOffset: SourceOffset }
  | {
      readonly kind: 'generated'
      readonly sourcePosition: SourceOffset
      readonly affinity: 'previous' | 'next'
    }

declare const sourceOffsetBrand: unique symbol
type SourceOffset = number & { readonly [sourceOffsetBrand]: 'SourceOffset' }

interface SourceRange {
  /** Inclusive UTF-16 code-unit offset. */
  readonly start: SourceOffset
  /** Exclusive UTF-16 code-unit offset. */
  readonly end: SourceOffset
}

type RevisionOutcome =
  | {
      kind: 'revised'
      revision: CompleteDocumentRevision
      transition: RevisionTransition
    }
  | {
      kind: 'rejected'
      previous: DocumentRevision
      diagnostic: ResourceDiagnostic | ContractDiagnostic
    }
```

#### P0 architecture-proof seam

Public semantic acceptance continues to enter only through `LanguageEngine.open` and the immutable
readers above. A package-owned, test-only `ProfileParseTraceV1` observer supplies the complementary
architecture proof that those public results cannot provide. The observer is installed by
document-core's package-private test-support harness, is absent from the production export map and
packed consumer, cannot influence parser decisions, and observes the same `LanguageEngine.open`
call used by the public assertions.

The versioned trace records canonical-source admission; parser-created syntax event/node identity
and source provenance; Markdown/CM production kind; Substitution-arm entry, fragment termination,
and enclosing-state resumption; definition/reference edge creation; derived-product origin; boundary-guard
admission/protection; verifier admission; and verifier-product discard. Semantic nodes, projected
nodes, and diagnostics cite parser-created identities where applicable; rejected/malformed
diagnostics cite their parser-created candidate event and exact range, while generated view nodes
carry explicit source/event/projection provenance rather than pretending to be canonical nodes. A P0 test
asserts one canonical admission, the required intrinsic events and derivation edges, balanced arm
entry/termination events, and no second canonical admission or unclassified parse. Package dependency rules and
runtime seam spies separately prove that no CM-only recognizer, forest reconstruction, post-hoc
semantic join, or raw-source parser entry exists in a projector/materializer. Trace assertions are
architecture evidence only and can never replace public behavioral assertions.

`createSourceSnapshot` and `createLanguageEngine` are the public construction seam. Source offsets
are a branded numeric coordinate space and all ranges are half-open UTF-16 code-unit ranges. The CM
forest exposes typed form, marker, and arm records as a derived index over the canonical
parser's intrinsic CM node identities; it never recognizes syntax and never exposes lexer tokens or
parser frames. `SourceOwnershipIndex` is a normalized semantic lens, not the internal token tape: its
maximal runs are ordered, nonoverlapping, gapless over `[0, source.text.length)`, and concatenating
their canonical ranges reproduces the exact source. Marker-looking bytes authenticated inside a
Markdown literal never report `critic-marker`; CRLF is one `line-ending` run. `ownerAt`, `at`,
`MarkdownNode.childAt`, `MarkdownDocument.nodeAt`, and
`ProjectedMarkdown.provenance.originAt` reject non-integer or out-of-range coordinates. Each
`MarkdownDocument.source` is exactly its containing projection's source, and its node readers are
consumer-shaped immutable semantic records rather than green nodes. These lenses hide compressed
storage, parser checkpoints, typed arm subgraphs, and graph topology so the implementation
can change without changing consumers. Complete revisions, snapshots, configurations, CM records,
ownership records, Markdown readers, projections, provenance results, and all contained arrays are
transitively immutable.
`DiagnosticIndex` provides checked ordinal access to the stable sorted diagnostic contract without
exposing parser storage; `at` rejects non-integer or out-of-range ordinals.

This is the primary pure language seam. It owns parsing, projections, provenance, incremental reuse,
diagnostics, and validation. `DocumentRevision` and all node handles are immutable and
revision-bound. A complete revision owns the atomic syntax graph; a source-only revision owns exact
source plus fatal diagnostics and exposes no semantic facade that could be mistaken for a parse.
Arbitrary user text never loses source. Invalid API coordinates and programmer contract violations
fail loudly.

Each revision records its full immutable `ParseConfiguration` as interpretation identity. `revise`
inherits it. A language, Markdown, live-HTML safety, or budget change dispatches a session
`reinterpret` intent, which calls the package-private zero-source-edit operation. It either
publishes a `revision-changed` transition with cause `reinterpret`, a new complete revision, and
identity source map (invalidating handles unless survival is proven), or rejects without changing
the prior revision. It can retry SourceOnly→Complete under a larger budget; a failed
Complete→Complete reinterpretation leaves the complete revision mounted. Reinterpretation creates no
document undo entry.

`ParseConfiguration` is closed and strictly validated: missing, extra, wrongly typed, or unsupported
fields reject before parsing. `MarkdownOptionsV1` records every current parse-affecting host option.
Desktop supplies its fixed `frontMatter: true` and `math: true` defaults and maps
`isGitlabCompatibilityEnabled`, `footnote`, and `superSubScript` to `gitLabMath`, `footnotes`, and
`subscriptAndSuperscript`, respectively. `markdown-profile-1.yml` pins non-configurable grammar:
CommonMark 0.31.2, GFM 0.29, GFM enabled, `breaks=false`, `pedantic=false`, diagram providers, and
the remaining built-ins. When `frontMatter` is enabled, Profile 1 recognizes the four existing
forms: YAML `---`, TOML `+++`, semicolon-delimited JSON `;;;`, and brace-delimited JSON `{…}`.
Preferred creation spelling belongs to session authoring configuration, not parse identity.
`live-html-sanitized-v1` maps the current enabled-but-sanitized behavior;
`live-html-escaped-v1` maps the current disabled/show-source behavior.

Hash identities are wire formats, not aliases for a runtime string hash:

- `SourceHashV1` is SHA-256 over ASCII domain bytes `MarkText.SourceHash.v1\0`, the canonical source
  length as unsigned 64-bit little-endian code units, then every exact UTF-16 code unit as unsigned
  16-bit little-endian. It includes leading U+FEFF, CR versus LF, missing final EOL, and unpaired
  surrogates; it performs no Unicode or line-ending normalization and includes no parse/file
  metadata.
- `FileHashV1` is SHA-256 over ASCII domain bytes `MarkText.FileHash.v1\0`, unsigned 64-bit
  little-endian byte length, then the raw file bytes exactly. It is an adapter receipt identity,
  never a source or revision identity.
- `RevisionSemanticHashV1` is SHA-256 over ASCII domain bytes `MarkText.RevisionSemanticHash.v1\0`,
  the 32 raw `SourceHashV1` digest bytes, then these fields in exact order: length-prefixed UTF-8
  `criticMarkupProfile`; `markdownProfile`; `markdownOptions.schema`; five option bytes, each exactly
  `0` or `1`, in the declared `MarkdownOptionsV1` field order; `liveHtmlSafetyProfile`; execution
  budget limits-profile ID; execution budget accounting-schema ID; unsigned 32-bit little-endian
  `recordSchemaVersion`; and length-prefixed UTF-8 `coreEngineBuild`. Every length prefix is unsigned 32-bit little-endian
  byte length. Identity strings are restricted to printable ASCII `[A-Za-z0-9._-]+` and hashed
  exactly, with no Unicode normalization. The codec never uses JSON property order, decimal
  rendering, or locale encoding. `reinterpret` leaves `SourceHashV1` unchanged but changes this hash
  whenever interpretation identity changes.

`RevisionId` remains a unique, opaque, session-local instance ID; neither it nor a source hash is
treated as proof that two revision instances share handles. Checked-in known-answer vectors cover
empty input, U+FEFF, bare CR/LF/CRLF, astral pairs, unpaired high/low surrogates, length-framing
boundaries, each configuration field, and raw files in every supported encoding. Node, browser,
worker, recovery, and desktop implementations must produce byte-identical digests on all supported
platforms.

`RevisionKernel.revise` is package-private and absent from the package export map; application
adapters cannot import, reflect, or structurally obtain it. Compile-time package-consumer tests and
dependency rules enforce that boundary. The engine does not plan product commands. A session-owned
`TransformationKernel` converts authenticated `EditorIntent` into source edits and command
postconditions. Application mutation has exactly two named session entry points: `dispatch` for
every ordinary typed intent, and the narrow composite `preparePersistence`, which may internally
execute that same typed `CommitSourceDraft` transaction at its frozen frontier before installing a
save fence. It cannot plan any other edit. No adapter or persistence caller can reach another write
seam.

Internally it owns:

- an opaque exact-source store and line index, with representation chosen from profiling rather than
  exposed in any contract;
- a lossless token tape;
- one persistent atomic lossless Profile 1 syntax graph whose native productions include Markdown and
  all five CM forms, with typed red readers;
- retained block/container, inline-delimiter, literal, definition/reference, recovery, arm-boundary, and
  resource-accounting events that created that graph;
- a derived CM interval forest/index over the graph's intrinsic CM node identities;
- Original/Revised mapped source tapes and Markdown CSTs derived by recursive arm selection from
  retained graph events;
- Comment-payload views derived from retained Comment subgraphs;
- source/view maps with explicit `previous`/`next` affinity;
- interval, reference, Review, command, and diagnostic indexes;
- parser checkpoints for incremental convergence.

“One parser” means one grammar kernel, one canonical source admission, one parser-owned event and
node identity space, and one indivisible revision. It does not require one implementation loop:
lexical, block, inline, resolution, recovery, incremental, and graph-materialization phases are
allowed when they consume the same source tape and directly build or refine the same intrinsic
artifact. A CM-only recognizer, Markdown parse over CM-excluded/elided text, forest-to-CST join,
post-hoc ownership/reference inference, or flattened projection parse used to determine
authoritative syntax is forbidden even if hidden behind one facade. A verifier may invoke the same
Profile 1 parser on a derived candidate only to reject a mismatch; the verifier's CST and decisions
never become canonical or projected products. A custom parser kernel is the target. Marked,
micromark, MultiMarkdown, or other engines may be out-of-package differential oracles in tests, but
none is a hidden production backend and no foreign token type crosses the core package boundary.

### `DocumentSession`

```ts
interface DocumentSession {
  snapshot(): EditorSnapshot
  dispatch(intent: EditorIntent): DispatchTicket
  cancel(ticket: IntentId, reason: CancellationReason): SessionOperation<CancellationResult>
  preparePersistence(reason: PersistenceReason): SessionOperation<FlushResult>
  flush(reason: FlushReason): SessionOperation<FlushResult>
  close(disposition: CloseDisposition): SessionOperation<CloseResult>
  subscribe(listener: (transition: SessionTransition) => void): Disposable
}

interface SessionConfiguration {
  readonly authoring: AuthoringConfigurationV1
}

interface AuthoringConfigurationV1 {
  readonly schema: 'authoring-1'
  readonly textPolicy: 'nearest-owner-eol-v1'
  readonly bulletListMarker: '-' | '+' | '*'
  readonly orderedListDelimiter: '.' | ')'
  readonly listIndentation: 'dfm' | 'tab' | 1 | 2 | 3 | 4
  readonly preferLooseListItems: boolean
  readonly headingStyle: 'atx' | 'setext'
  readonly frontMatterStyle:
    | 'yaml'
    | 'toml'
    | 'json-semicolon'
    | 'json-braces'
  readonly tabSize: number
  readonly taskCheckPolicy: 'single' | 'cascade'
  readonly checkedTaskPlacement: 'in-place' | 'move-to-end'
  readonly trimCodeBlockBoundaryBlankLines: boolean
}

interface DispatchTicket {
  readonly id: IntentId
  readonly clientSequence: number
  readonly admission: Promise<AdmissionResult>
  readonly completion: Promise<DispatchResult>
}

interface SessionOperation<T> {
  readonly id: SessionOperationId
  readonly clientSequence: number
  readonly completion: Promise<T>
}

type AdmissionResult =
  | { kind: 'admitted'; sequence: number; submittedAgainst: RevisionId }
  | { kind: 'transport-rejected'; reason: TransportRejection }

type PersistenceReason = 'save' | 'autosave'
type FlushReason = 'materialize' | 'print'

type FlushBlockReason =
  | Rejection
  | 'active-composition'
  | 'uncommitted-source-draft'
  | 'uncommitted-review-draft'
  | 'pending-input'
  | 'recovering'
  | 'semantic-unavailable'

type CloseDisposition =
  | { kind: 'flush' }
  | {
      kind: 'discard-pending-confirmed'
      expectedSnapshot: EditorSnapshotId
      drafts: readonly DraftId[]
      confirmation: CloseConfirmation
    }
  | {
      kind: 'discard-all-unsaved-confirmed'
      expectedSnapshot: EditorSnapshotId
      drafts: readonly DraftId[]
      revision: RevisionId
      expectedPersistenceState: PersistenceStateId
      confirmation: CloseConfirmation
    }
  | { kind: 'cancel'; target: SessionOperationId }

type EditorSnapshot = CompleteEditorSnapshot | SourceEditorSnapshot
type EditorView = 'markup' | 'original' | 'revised'
type CompleteEditorSnapshot =
  | CompleteEditorSnapshotFor<'markup'>
  | CompleteEditorSnapshotFor<'original'>
  | CompleteEditorSnapshotFor<'revised'>

interface CompleteEditorSnapshotFor<V extends EditorView> {
  kind: 'complete'
  id: EditorSnapshotId
  configuration: SessionConfiguration
  revision: RevisionDescriptor<'complete'>
  view: V
  livePlan: LiveRenderPlan<V>
  review: SessionReviewPresentation
  persistence: SessionPersistenceState
  sourceDraft?: SourceDraftDescriptor
  pending: PendingSessionState
}

interface SourceEditorSnapshot {
  kind: 'source'
  id: EditorSnapshotId
  configuration: SessionConfiguration
  revision: RevisionDescriptor<'complete' | 'source-only'>
  view: 'source'
  sourceDraft: SourceDraftDescriptor
  semanticViews:
    | { kind: 'available-after-source-exit' }
    | {
        kind: 'unavailable'
        diagnostic: ResourceDiagnostic | CompatibilityDiagnostic
      }
  review: { kind: 'unavailable-in-source' }
  persistence: SessionPersistenceState
  pending: PendingSessionState
}

interface SessionPersistenceState {
  readonly id: PersistenceStateId
  readonly status: 'clean' | 'dirty' | 'saving' | 'rename-unknown' | 'failed'
  readonly lastReceipt?: PersistenceReceipt
  readonly activeTargets: readonly FileTargetId[]
}

interface PendingSessionState {
  activeBatch?: {
    ticketIds: readonly IntentId[]
    firstSequence: number
    lastSequence: number
  }
  queue: readonly PendingTicketPresentation[]
  inputDrafts: readonly PendingInputDraft[]
  composition?: CompositionDraft
  retained: readonly RetainedDraftPresentation[]
  lastRejection?: RejectionPresentation
  status: 'idle' | 'working' | 'blocked'
  lifecycle: 'open' | 'closing' | 'recovering' | 'closed'
}

type FlushResult =
  | {
      kind: 'flushed'
      watermark: number
      revision: RevisionDescriptor
      source: CanonicalSourceLease
    }
  | {
      kind: 'blocked'
      watermark: number
      reason: FlushBlockReason
      retainedDrafts: readonly (
        | PendingInputDraft
        | CompositionDraft
        | SourceDraftDescriptor
        | ReviewDraft
      )[]
    }
  | { kind: 'closed'; watermark: number }
  | { kind: 'transport-rejected'; reason: TransportRejection }

interface CanonicalSourceLease {
  readonly id: SourceLeaseId
  readonly watermark: number
  readonly revision: RevisionDescriptor
  readonly sourceHash: SourceHash
  readChunks(): AsyncIterable<CanonicalSourceChunk>
  acknowledge(receipt: PersistenceReceipt): SessionOperation<LeaseAckResult>
  release(reason: LeaseReleaseReason): SessionOperation<LeaseReleaseResult>
}

interface PersistenceReceipt {
  readonly lease: SourceLeaseId
  readonly revision: RevisionId
  readonly sourceHash: SourceHash
  readonly target: FileTargetId
  readonly targetOrdinal: number
  readonly targetGeneration: number
  readonly watermark: number
  readonly fileHash: FileHash
}

type LeaseAckResult =
  | { kind: 'acknowledged'; receipt: PersistenceReceipt }
  | { kind: 'stale-or-invalid'; reason: LeaseRejection }
  | { kind: 'transport-rejected'; reason: TransportRejection }

type LeaseReleaseResult =
  | { kind: 'released'; lease: SourceLeaseId }
  | { kind: 'already-terminal'; lease: SourceLeaseId }
  | { kind: 'transport-rejected'; reason: TransportRejection }

type CloseResult =
  | { kind: 'closed'; revision: RevisionDescriptor }
  | {
      kind: 'requires-persistence'
      lease: CanonicalSourceLease
      snapshot: EditorSnapshot
    }
  | {
      kind: 'blocked'
      reason: Rejection | 'uncommitted-draft'
      retainedDrafts: readonly DraftDescriptor[]
      snapshot: EditorSnapshot
    }
  | { kind: 'cancelled'; snapshot: EditorSnapshot }
  | { kind: 'too-late'; snapshot: EditorSnapshot }
  | {
      kind: 'stale-confirmation'
      reason: 'persistence-state-changed' | 'save-already-applied'
      snapshot: EditorSnapshot
      receipt?: PersistenceReceipt
    }
  | { kind: 'transport-rejected'; reason: TransportRejection }

type DispatchResult =
  | { kind: 'committed'; transition: SessionTransition }
  | { kind: 'session-updated'; transition: SessionTransition }
  | {
      kind: 'rejected'
      reason: Rejection
      snapshot: EditorSnapshot
      retainedDraft?: PendingInputDraft | CompositionDraft | SourceDraftDescriptor
    }
  | {
      kind: 'cancelled'
      reason: CancellationReason
      snapshot: EditorSnapshot
      retainedDraft?: PendingInputDraft | CompositionDraft | SourceDraftDescriptor
    }
  | { kind: 'transport-rejected'; reason: TransportRejection; retainedDraft?: PendingInputDraft }
  | { kind: 'closed'; snapshot: EditorSnapshot }
  | { kind: 'noop'; reason: NoopReason; snapshot: EditorSnapshot }

type CancellationResult =
  | { kind: 'cancelled'; ticket: IntentId; snapshot: EditorSnapshot }
  | { kind: 'too-late'; ticket: IntentId; transition: SessionTransition }
  | { kind: 'not-found'; ticket: IntentId; snapshot: EditorSnapshot }
  | { kind: 'closed'; snapshot: EditorSnapshot }
  | { kind: 'transport-rejected'; reason: TransportRejection }

type SessionTransition =
  | {
      kind: 'revision-changed'
      id: SessionTransitionId
      cause: 'source-edit' | 'reinterpret' | 'undo' | 'redo'
      history: 'record' | 'coalesce' | 'none'
      before: EditorSnapshot
      after: EditorSnapshot
      revision: RevisionTransitionDescriptor
      effects: readonly EffectDescription[]
    }
  | {
      kind: 'session-state-changed'
      id: SessionTransitionId
      coalescing: 'preserve' | 'break'
      before: EditorSnapshot
      after: EditorSnapshot
      effects: readonly EffectDescription[]
    }
```

`RevisionDescriptor` and `RevisionTransitionDescriptor` expose identity, configuration, source
hash/length, semantic hash, diagnostics summary, and mapped public selection—not source edits, CST
objects, or internal maps. The full `DocumentRevision` and `RevisionTransition` proof remain
worker-local. Tests and persistence obtain exact source through a revision-bound
`CanonicalSourceLease`; no application consumer gains a second write seam.

`nearest-owner-eol-v1` is the authoring policy for line breaks synthesized by Enter, split/join,
list/table/quote/block planners, code-block creation, and `RawCommentDraft`; it never rewrites
retained or pasted source. First choose the editable source owner authenticated by the model
position and affinity. Use the nearest preceding EOL token in that owner; if none, the nearest
following token in that owner; if none, the document-preferred token. CRLF is one token. The
document preference is the most frequent of CRLF, bare CR, and bare LF in exact canonical source; a
tie chooses the token whose first occurrence is earliest, and a document with no EOL uses LF. For a
raw Comment field the owner is exactly that Comment payload. Every authoring intent and worker
request is stamped with the session policy ID; changing it is a durable, coalescence-breaking
session transition, not a parse reinterpretation or document undo entry. The policy ID and the
chosen EOL token are recorded in the transaction proof and journal so retry, undo/redo, recovery,
and another platform cannot choose again.

The rest of `AuthoringConfigurationV1` freezes current generated-spelling and command-scope
preferences. Desktop maps `bulletListMarker`, `orderListDelimiter`, `listIndentation`,
`preferLooseListItem`, heading style, `frontmatterType`, `tabSize`, task-check behavior, and
`autoMoveCheckedToEnd`, and `trimUnnecessaryCodeBlockEmptyLines` directly. `tabSize` is a bounded positive integer. Fixtures preserve output
for every currently accepted list-indentation value, including legacy `tab`, before implementation
changes. An authoring-configuration change is a durable, coalescence-breaking session transition;
it is not parse reinterpretation, semantic hashing, source mutation, or document undo. Journal
records carry the complete before/after value, and each transaction records the exact value and
generated tokens chosen. Auto-pair preferences remain input-adapter policy because the admitted
intent already contains their exact generated characters. Code-block boundary cleanup applies only
to a future explicit authoring transform and may never trim canonical source during open, render,
save, or reinterpretation; EOL or terminal-newline normalization is likewise an explicit source
transformation only.

Pending state is lossless, not a spinner count. It can represent one active batch, multiple queued
input runs separated by commands, one live composition, and multiple retained rejected/cancelled
drafts at the same time. Each retained entry carries its ticket IDs, exact draft/target, stable
rejection descriptor, and allowed Retry/Discard actions; `lastRejection` remains available across component
unmount/remount until acknowledged. UI previews may truncate visually, but the coordinator retains
the complete data.

The session hides source patches, history, selection rebasing, Track Changes, projection caches,
source drafts, Review drafts, and commit/rollback ordering. A prevented browser input cannot
disappear into `false`; it must commit, reject with a visible reason, or be an explicit no-op.

`dispatch` is an asynchronous actor boundary, not a synchronous parse call. The client synchronously
allocates only a stable `IntentId`, a client-stream sequence, and an exact provisional input buffer;
it does **not** claim a host sequence or base revision until `admission` resolves. A
timeout/disconnect after send is not a negative admission result: the client retains the exact bytes
and same ID, fences the old transport epoch on reconnect, queries the terminal/ ingress ledger, and
resends that ID only when the coordinator reports it absent. The original promises remain pending
through reconciliation. `transport-rejected` is terminal only when the local transport proves no
handoff occurred **and** the coordinator durably admits a sequence tombstone, or when the host
returns a durably recorded explicit rejection; ambiguity never settles input as rejected while it
may still commit. The same rule applies to every `SessionOperation` and lease operation:
reconnect/query by ID precedes any terminal transport result. A host-side `SessionCoordinator`
deduplicates the client ID, admits intents to one ordered mailbox, assigns the authoritative
sequence/base/timestamp, mirrors exact pending drafts, arbitrates cancellation/commit, journals
transitions, and publishes pending session state. Admission is durable: before resolving
`AdmissionResult` **or authorizing the client to paint the pending overlay**, the host appends and
syncs a stable `IngressEnvelopeV1` containing the exact intent/operation or draft delta, client/host
sequence, admission timestamp, base identity, and retained bytes. Host crash replays that envelope
before work resumes. If the renderer dies before durable acknowledgement, those bytes were never
presented as accepted editor content; after acknowledgement, recovery is host-owned. The ≤50 ms
admission gate includes this group-commit path. A dedicated `RevisionWorker` owns the active
`DocumentRevision`, `RevisionKernel`, canonical source store, history proofs, and materializers.
Outside Source mode, the renderer holds only a `DocumentSessionClient`, revision descriptors,
derived Review presentation, and live-plan cache; none can mutate or reconstruct canonical source.
While Source mode is mounted it may additionally hold the explicitly nonauthoritative `SourceMirror`
defined below. These three pieces form the one logical `DocumentSession`; only its coordinator
exposes the write seam. Requests carry only edits/intents or draft deltas, never clone the whole
document through the renderer. Every worker request records
`{sessionId, ticketIds, firstSequence, lastSequence, admittedAt[], expectedRevision, expectedSourceHash, parseConfiguration, authoringConfiguration}`.
At most one revision-changing request per session is in flight. A result may publish only when that
identity still matches the complete queue head and mounted session; stale, duplicate, out-of-order,
or post-close results are discarded as results, never as user input.

Every renderer-originated dispatch, cancel, persistence barrier, flush, close, lease
acknowledgement, and lease release carries an idempotency ID on one gap-detecting per-session client
stream. Native-menu Save/Close and the OS window-close handshake route through that same client
sequencer; they cannot race an earlier `beforeinput` on a second IPC channel. Each lifecycle request
carries the highest client sequence visible to its caller, and the coordinator neither admits nor
resolves it until every earlier sequence is admitted or closed by an authoritative recorded
rejection/tombstone. An omitted sequence is closed only by a checksummed `ClientGapTombstoneV1`
record naming the fenced client epoch, exact sequence/operation ID, and authoritative no-ingress
reason. The coordinator syncs that tombstone before admitting a later sequence and rejects every
delayed envelope from the old epoch. Renderer crash/reconnect may tombstone only gaps the host
ledger proves absent; an admitted ID is replayed instead. Tombstones are checkpointed and
outcome-acknowledged like other terminal records. If the client is unavailable with unacknowledged
provisional input, close/save blocks unless the user explicitly confirms its discard. Cross-channel
reordering is a permanent fault-injection test, not an assumption about Electron message timing.

Worker parsing need not yield to admit later UI input: admission, overlay updates, watermarks, and
the commit/cancel arbiter stay in the responsive host. Each request carries a shared atomic
cancellation flag that iterative parse, projection, and materialization loops check at bounded work
checkpoints; the coordinator may terminate and rebuild an unresponsive worker after the watchdog. A
cancelled/terminated worker can only return a prepared candidate; it cannot cross the journal commit
point itself. Checkpoints occur at least every 4,096 consumed source units or 2,048 produced logical
nodes, whichever comes first; cancellation acknowledgement is ≤100 ms on closure reference hardware,
with forced termination as the tested fallback.

The logical snapshot shown above is implemented over a structured-clone wire protocol. Initial mount
transfers one revision-bound plan snapshot; later commits transfer keyed `LivePlanDelta`s plus
Review/session deltas, never a full `DocumentRevision` or complete source copy. The client applies a
delta only to its matching plan/revision and exposes the resulting immutable local snapshot. Only
the mounted view's plan crosses the wire. A view-switch intent requests a full or cached plan for
the same revision and atomically publishes a new active-view snapshot; any unmounted client cache is
disposable and cannot be read as current state. The worker may lazily derive/cache other view plans
from the immutable revision, but source commits do not eagerly clone three plans into the renderer.
Language-engine tests inspect full revisions directly inside core; application adapters receive only
`RevisionDescriptor`. Materialization and canonical-source leases are requested by revision ID and
execute against the worker-owned revision.

Every wire publication—revision commit or session-only transition—is one checksummed envelope:
`{publicationId, transitionId?, wireSequence, baseSnapshotId, nextSnapshotId, revision, activeView, livePlanDelta?, reviewDelta, sessionDelta, terminalOutcomeDelta}`.
The client stages and validates all members, including each base plan ID, before swapping one
immutable snapshot; it never publishes a partial plan/Review/session mix. The host durably retains
an acknowledgement-trimmed terminal-outcome ledger keyed by every
Intent/SessionOperation/lease-operation ID. Dispatch, cancel, prepare-persistence, flush, close,
acknowledge, and release each settle exactly once; retrying an ID returns the same admission,
watermark/lease, close decision, or terminal result rather than repeating the operation. Wire
sequences and terminal outcomes are independently acknowledged and deduplicated by the client.

An operation that changes revision/session state carries its `SessionTransitionId` and matching
deltas. A pure flush, unchanged lease ack/release, cancellation `too-late`/`not-found`, or other
outcome-only operation uses an explicit base-equals-next envelope: `transitionId` is absent,
`baseSnapshotId === nextSnapshotId`, plan/Review/session members are absent, and one nonempty
`terminalOutcomeDelta` is required. It still consumes a wire sequence, is
checksummed/chunked/replayed, and settles only after atomic client installation. It never invents a
session transition or document event.

“One envelope” is logical, not one giant structured-clone message. Its header contains a target
snapshot/revision, member IDs, per-member lengths, at most 256 KiB transferable-chunk boundaries,
individual hashes, and one root hash. Chunks may arrive out of order;
`(publicationId, memberId, chunkIndex)` deduplicates them. A staging worker verifies and
incrementally installs chunks into an immutable binary `PlanStore` with at most 8 MiB queued for
main-thread handoff; main-thread tasks are time-sliced to ≤4 ms. Nothing becomes mountable until all
members and the root hash verify, at which point one descriptor/pointer swap publishes the snapshot.
Missing, corrupt, duplicate, and reordered chunks, supersession by a newer snapshot, cancellation,
client disconnect, and staging budget exhaustion each have a typed retry/resnapshot or terminal
outcome and release all unreferenced segments. No fallback concatenates the full payload on the
renderer thread.

`WireEnvelopeCodecV1` freezes these hashes independently from source/file hashes. All integers are
unsigned little-endian; strings are unsigned-32-bit byte-length-prefixed UTF-8 IDs restricted to the
identity alphabet above; a chunk is at most exactly 262,144 bytes. `ChunkHashV1` is SHA-256 over
`MarkText.WireChunk.v1\0`, publication ID, member ID, chunk index, chunk count, unsigned-64-bit
member length, unsigned-32-bit chunk length, and chunk bytes. `MemberHashV1` is SHA-256 over
`MarkText.WireMember.v1\0`, member ID, unsigned-64-bit member length, chunk count, then each ordered
`{index, chunkLength, ChunkHashV1}`. `EnvelopeRootHashV1` is SHA-256 over
`MarkText.WireEnvelope.v1\0`, the canonical V1 header bytes with the root field omitted, then
present member records in fixed enum order
`livePlanDelta, reviewDelta, sessionDelta, terminalOutcomeDelta`, each with ID, length, and raw
member digest. Absence is encoded in the header bitmap, not by an empty member. Header field order,
enum tags, bitmap bits, and known-answer bytes live in `wire-envelope-v1.yml`; JSON serialization
and arrival order are never hash inputs. Empty/exact-boundary/two-chunk/all-member/outcome-only
vectors run in Node, worker, renderer, and every supported platform.

A duplicate envelope is idempotent. A gap, base mismatch, missing member, or checksum failure leaves
the last complete snapshot mounted and requests a full snapshot for the committed revision. The
coordinator keeps a bounded delta replay window; otherwise the worker regenerates the full snapshot
from the pinned revision. A full snapshot also carries every unacknowledged terminal outcome, so
resnapshot/reconnect cannot leave an earlier Promise hanging. Pending overlay/status may report
resynchronization, but canonical DOM and Review never mix generations.

The session reauthenticates a queued intent after every preceding commit. It rebases revision-bound
targets only through the intervening `RevisionTransition`s; if survival cannot be proved, the ticket
rejects visibly with its exact draft retained. Renderer and Electron adapters never rebase offsets
themselves. Session-only intents are ordered in the same mailbox, so a view/profile change cannot
overtake an edit.

The browser prevents native document mutation at `beforeinput`. Contiguous plain-text events that
arrive while work is pending accumulate in one session-owned `PendingInputDraft` with a base model
anchor and relative caret; backspace/delete may edit that draft without pretending it is canonical
source. The snapshot exposes a nonauthoritative pending overlay so typed text and a pending state
can be painted by the next animation frame. A structural command waits behind that draft. IME
updates live in one `CompositionDraft`; only `compositionend` enqueues one source-changing intent. A
composition cancel is an explicit no-op, not a partial commit.

Every accumulated input atom retains its own ticket and sequence. The worker may batch one
contiguous draft into one source transaction, but its result names the entire ticket range and
settles every member exactly once against that shared transition. A pending insertion removed by a
later pending backspace settles as an explicit coalesced-away no-op; if the insertion has already
started, the deletion remains ordered behind it. Queue batching and undo-history coalescing are
separate policies and have separate tests.

Cancellation is serialized with batch commit. Before a batch starts, one ticket can be removed. If a
batch is in flight, cancelling any member aborts the whole prepared batch, restores unaffected
members in original sequence, and places the target's exact input in `blocked` state. The
durable-commit arbiter decides a cancel/result race: cancellation either wins before commit, or
returns `too-late` and every batch ticket observes the one commit. `RetryPending` and
`DiscardPending` are explicit intents; only the latter may destroy retained input after user
confirmation. First/middle/last member cancellation has the same rule.

`flush` and `preparePersistence` each capture the caller's causal client frontier and, after all
earlier stream entries are durably admitted, freeze the highest host sequence as an immutable
watermark. Later intents are excluded. That watermark is a hard worker-batch fence: no transaction
may contain a ticket on both sides. In `t1 → barrier → t2`, the result must name a revision
containing `t1` and excluding `t2`, even when neither ticket had started when the barrier was
admitted. Concurrent barriers retain their own watermarks and outcomes.

`flush('materialize' | 'print')` is pure: it never changes source, history, drafts, or sequence
state. It waits for earlier editor input and returns the exact complete `RevisionDescriptor`/lease
to materialize. SourceOnly returns `semantic-unavailable`, and active composition, any dirty
Source/Review draft, or retained rejected input returns its typed block with exact identities.

Save and autosave use one composite `preparePersistence` operation, never
`dispatch CommitSourceDraft` followed by a separately admitted flush. At its frozen frontier the
coordinator first waits for every earlier admitted input to commit or reach a retained terminal
state, then preflights **all** draft classes. Active composition, a dirty ReviewDraft, retained
rejected/cancelled input, an unreconciled transport sequence, or any other pending input blocks with
its exact typed identity; Save never implicitly submits/cancels Review, finishes composition, or
discards retained input. No source commit or lease occurs when that preflight blocks. If it passes,
the coordinator atomically commits the exact acknowledged SourceDraft version when dirty, validates
that revision, installs the hard fence, and returns its `CanonicalSourceLease`; any failure leaves
the draft and prior revision exact. A clean committed SourceOnly revision—including
unsupported-schema recovery—may return an exact lease. A dirty SourceOnly draft must first parse to
Complete or the barrier blocks; semantic invalidity never prevents persistence of the already
committed SourceOnly source.

Saving while remaining in Source mode does not dispose the draft. The committed version becomes its
new clean base, and deltas sequenced after the barrier apply to the same Draft ID as a dirty
successor based on that new revision. Exiting Source mode uses a final fenced commit and disposes
the draft only after proving that no successor delta exists. Permanent permutations cover
Save/autosave before, between, and after source deltas. The file adapter persists only the returned
lease and may not reread a later `snapshot()`.

A lease pins its exact revision, checkpoint, and required journal prefix until `acknowledge` or
`release`; later commits, concurrent flushes, worker restart, view changes, and a close attempt
cannot change its chunks. On worker loss the coordinator reconstructs and hash-verifies the same
chunks before resuming the stream. A `PersistenceReceipt` names lease/revision/source hash plus
resulting file hash, target ordinal/generation, and session watermark and is accepted only after the
adapter's durable write/rename. Failure releases no pin implicitly. Leases are reference-counted,
leak-diagnosed, and have explicit adapter-abort release; no timeout silently invalidates one.

Pinning does not by itself authorize a filesystem rename. The native target resolver resolves
aliases and returns an opaque capability plus canonical `FileTargetId`; one host-wide
`FileTargetRegistry` keys registration and arbitration by that returned identity. Because
persistence atomically replaces a directory entry, the identity is the final resolved destination
entry—not its current inode: safely resolve `.`/`..` and symlink chains to the final target, then key the stable resolved
parent-directory identity plus the filesystem's actual name-equivalence/case rules. Saving through a
symlink preserves the symlink and replaces its resolved target entry. Two hard-link names are
deliberately different targets because replacing one breaks their inode sharing and leaves the other
entry unchanged. Case/Unicode aliases converge only when the mounted filesystem treats them as the
same entry. New targets use that same parent/name identity before creation. `.`/`..`, symlink,
hard-link-independence, case-folding, Unicode-name, and Save-As-to-open-target tests run on every
platform where each class exists. If the adapter cannot prove destination-entry identity, it rejects
visibly rather than creating two arbiters. The adapter retains a resolved directory
handle/capability and revalidates the destination entry under the target lock immediately before
rename; symlink retargeting or directory replacement produces a stale-target failure rather than a
TOCTOU write to a different file.

The registry owns one host-wide persistence ledger and one generation/CAS arbiter per canonical
target, shared across document sessions. Its records use the same versioned length/checksum/sync and
crash-safe compaction discipline as the session journal and owner-only app-data permissions. Under
that target lock, registration assigns a globally total `targetOrdinal`, derives the unique
`TempIdentityV1` from the canonical target and that never-reused ordinal, and durably appends
`SaveIntentV1`
`{target, targetOrdinal, tempIdentity, expectedTargetGeneration, session, watermark, lease, revision, sourceHash, encodingPlan}`
before authorizing creation or writing of that temporary file. The identity names one
target-directory entry beneath the retained directory capability; it is not an unresolved path or
caller input. Exclusive creation must find no existing entry. Recovery can therefore remove or
reconcile that exact orphan idempotently after a crash at any later instruction, including creation
or a partial write before `SavePreparedV1`. Session watermarks remain evidence in receipts but never
order different sessions. Every registered/prepared/applied/failed/tombstoned change advances the
session's published `PersistenceStateId`, so a confirmation can name exactly what it observed. After
encoding and fsyncing the temporary file, the adapter appends `SavePreparedV1` with that temp
identity, exact `FileHashV1`, byte length, and intended target generation. Immediately before
replacement it reacquires the target lock, reconciles any earlier ambiguous prepared record, and
validates that this ordinal is still the maximum registered ordinal and its expected generation is
current. Any later registration permanently supersedes the older ordinal before it can rename.

The winning adapter atomically replaces the target, fsyncs the target directory, then—while still
holding the target lock—appends and syncs `SaveAppliedV1` with the new target generation and
complete `PersistenceReceipt`. Only that record authorizes receipt acknowledgement or releases the
lock to a later rename. A crash after filesystem replacement but before `SaveAppliedV1` is an
explicit `rename-unknown` state: recovery blocks new save/discard decisions, reads the canonical
target only after reacquiring a fresh native capability and revalidating the recorded target
identity/generation, verifies its raw hash/length against `SavePreparedV1`, and when matched fsyncs the target
directory before idempotently recording applied; otherwise it records a visible reconciliation
failure/retry requirement. It never calls the revision “unpersisted” merely because the
acknowledgement was lost. Temporary cleanup is also ledgered and idempotent.

The newest registered ordinal must either persist/retry against the reconciled target generation or
return a visible terminal failure while its watermark remains explicitly unpersisted; only a later
ordinal may supersede it. Receipt acknowledgement is monotonic by target ordinal/generation and
session watermark. A late r1 write/ack can therefore never regress or delay registered r2; truly
distinct Save As targets have independent ordinals. Crash tests stop before/ after intent sync,
exclusive temp creation, partial/full temp write, temp fsync, prepared sync, rename, directory
fsync, applied sync, receipt delivery, acknowledgement, and temp cleanup.

`close({ kind: 'flush' })` enters `closing` under that operation ID and rejects new ordinary edits,
but still accepts `FinishComposition`, `CancelComposition`, `RetryPending`, `DiscardPending`,
`CommitSourceDraft`, and a targeted `CancelClose`. Every accepted resolution advances and re-arms
the close frontier; the session installs its final hard `document-close` batch fence only after the
allowed resolution queue is quiescent. It completes only when that final watermark includes every
resolution and every Review/Source/input/composition draft is committed, explicitly cancelled, or
explicitly discarded. If a draft blocks, `close` returns `CloseResult.blocked` and restores
lifecycle `open`, so the user can resolve it and retry; there is no closing-state deadlock. If
committed source is newer than the last acknowledged persistence receipt, close returns
`requires-persistence` with the pinned lease and also restores `open`; the host writes it,
acknowledges the receipt, and retries close. `close({ kind: 'discard-pending-confirmed', ... })`
discards only the named Draft IDs after matching the expected snapshot/confirmation and retains the
last committed revision; `close({ kind: 'discard-all-unsaved-confirmed', ... })` separately abandons
the named drafts and exact newer committed Revision ID after explicit confirmation; it also carries
the `PersistenceStateId` displayed by the confirmation UI. A stale snapshot, draft set, revision,
persistence state, or confirmation rejects without discard.
`close({ kind: 'cancel', target: closeOperationId })` restores `open`, settles the named pending
close and the cancellation operation as `cancelled`. Replaying that exact close or cancellation
operation ID returns its recorded result; a new cancellation operation aimed at an unknown or
already terminal close returns `too-late`.

Confirmed discard-all acquires every target arbiter referenced by this session in stable
`FileTargetId` order and first reconciles every `rename-unknown` record. Exactly one side of a
save/discard race can linearize. If `SaveAppliedV1` for the revision won first—or any
registration/applied state differs from the confirmed `PersistenceStateId`—discard changes nothing
and returns `stale-confirmation` (with the matching receipt when available), so the UI must show the
now-persisted/current state. It cannot pretend to revoke an already renamed file. If discard wins
before replacement, the registry appends and syncs one `DiscardTombstoneV1` naming session,
close-operation/result ID, snapshot, revision/source hash, drafts, confirmed persistence state,
every target and registration-ordinal cutoff, and required temp/lease cleanup. That single record is
both the discard linearization point and durable terminal close outcome. It revokes those
registrations before releasing the locks; every later pre-rename validation observes the tombstone
and returns `superseded`.

Recovery replays a discard tombstone instead of remounting its abandoned revision, settles the
original close exactly once, releases listed leases, removes prepared temps idempotently, and
reconciles all outbox/effect work. The tombstone is a valid clean-close terminal in lieu of a
persistence receipt. Only after its cleanup obligations and all independent receipt/effect outcomes
are terminal may compaction remove the source-bearing session journal; a small
acknowledgement-trimmed close tombstone remains until the client acknowledges the close outcome.
Crashes before/after tombstone sync, lock release, temp removal, lease release, journal cleanup, and
outcome acknowledgement cannot resurrect discarded work or lose settlement.

Once `closed`, dispatch/cancel/preparePersistence/flush and ordinary close requests return their
typed terminal closed results. A **new** `close({kind:'cancel', target})` remains the
targeted-cancellation exception and returns `too-late`; exact operation-ID replay still returns its
recorded result. Switching files may leave the per-document session and draft mounted off-screen.
The last committed revision remains the sole canonical authority throughout.

Worker crash recovery uses a host-owned append-only session journal as the durability adapter for
the same logical source authority—not as a second parser or mutable document model. The host mirrors
admitted intent envelopes and exact pending drafts. A worker first prepares and validates the
complete immutable candidate revision; atomically appending one complete record starts with a
permanently frozen `RecoveryEnvelopeV1` containing base/next source hashes and canonical UTF-16
forward/inverse source edit lists—sorted, nonoverlapping, and coalesced as defined below, never
text-normalized—in a version-independent codec. Its versioned body then carries
record-schema/core-build/Profile identities, transition/cause identity, ticket/sequence range and
immutable admission timestamps, base/next descriptor and hashes, forward/inverse edits, before/after
`ParseConfiguration`, history record/coalescing/cursor/redo delta, before/after active view, editor
mode, Track toggle, complete before/after `AuthoringConfigurationV1` and chosen generated tokens
including synthesized EOLs, selection/draft
anchors, diagnostics, effect outbox, and a deterministic active-view live-plan delta hash keyed by
`{baseRevision, nextRevision, view, mode, coreBuild}`—with length framing, checksum, and durable
sync is the commit linearization point. Only then may the host publish the descriptor/plan delta and
run effects. A replacement worker opens the last verified source checkpoint, replays later journal
records by ID, and reconciles pending tickets idempotently, regenerates the plan delta, and rejects
same-build publication if its hash differs. Reinterpret, undo, and redo use the same record with
zero/new-history semantics as already defined. Durable session-only changes (view, mode, Track
state, authoring configuration, selection/draft lifecycle, close state, and effect-bearing
transitions) append a smaller record with the same before/after session fields and active-plan
identity; ephemeral progress is reconstructed. Crash before append retains/retries the draft; crash
after append yields exactly that commit even without an earlier acknowledgement; duplicate replay
cannot add history or enqueue an outbox effect twice.

Checkpoint compaction is a crash-safe protocol, not `write` followed by delete: write and fsync a
framed temporary checkpoint, fsync its directory, atomically install and fsync a manifest that names
the new checkpoint and retained journal suffix, reopen and hash-verify that pair, and only then
delete the old checkpoint and covered journal prefix and fsync the directory again. Until manifest
verification, the old complete checkpoint/log pair remains recoverable. Kill, short-write,
checksum-tear, and rename-failure tests cover every boundary. The checkpoint covers committed
source/history, active view/mode/Track/session state, exact pending input and Source/Review drafts,
unacknowledged terminal outcomes, effect claims/results, open lease identities, and persistence
receipts; compaction cannot garbage-collect any of them before its protocol-specific
acknowledgement.

Recovery reads source and history before presentation. A journal/checkpoint records
`recordSchemaVersion`, `coreEngineBuild`, language/Profile identity, parse-budget/accounting
identity, and authoring-configuration identity. Same-build recovery verifies the stored plan-delta
hash. After an app/schema update, a declared migrator must preserve and hash-verify exact source,
edits, history groups/cursor/redo, anchors, drafts, and outbox identity, then regenerate
presentation under the recorded Profile with the new engine; an old presentation hash is not reused
as a cross-build oracle. An unsupported record never discards source: it opens exact SourceOnly
recovery with an actionable compatibility diagnostic and permits persistence/export of canonical
source. Previous-schema startup and migration-interruption fixtures are permanent. The stable outer
envelope and each checkpoint's exact canonical UTF-16 source chunks must remain readable even when
the versioned semantic body is unknown; an unknown-inner-schema test replays through the latest
source hash and saves those exact units. Recovery files use owner-only app-data permissions, never
alter the Markdown file. They are removed only after either a clean persisted close's matching
receipt is acknowledged or a confirmed discard's durable tombstone has completed every cleanup
obligation, according to a separately tested retention policy.

The committed journal record is the durable serialization of that prepared revision's identity, not
an independently queryable canonical document. Between commit and publication—or after worker
loss—the session exposes `recovering` and permits no semantic consumer, canonical commit,
materialization, or save lease until the complete revision and plan-delta hash are rematerialized
and verified. The responsive coordinator may still admit, journal, echo, cancel, and retain new
provisional input in sequence while recovering; it drains that queue only after verified
rematerialization. `flush` reports `recovering` rather than silently omitting it.

An `EditorSnapshot` is the only mount unit: its one active-view plan carries the same `RevisionId`
as its snapshot. A DOM host installs plans only from `SessionTransition.after` (or the initial
snapshot), and rejects a plan whose revision does not match the mounted snapshot. Separate session
reads cannot mix r1 Review/commands with an r2 DOM plan. A Source snapshot exposes no live plan or
Review commands; when its revision is SourceOnly it also exposes no static semantic materializer.
Pending overlays are session presentation, never live plans, syntax, save input, or a source of
parser truth.

Every document-changing intent follows one transaction:

```text
admit intent and retain exact pending input
    → serialize against the current queue head off the renderer thread
    → authenticate revision-bound handles and selection
    → plan exact canonical SourceEdits
    → apply Track Changes policy only for an eligible Markup ordinary-edit intent
    → parse candidate revision
    → prove command and projection postconditions
    → map next selection and drafts
    → prepare revision + history delta + effect outbox
    → durably append one commit record (linearization point)
    → publish the exact descriptor + plan/session deltas
```

`Cut` has one named fail-safe pre-commit prerequisite because OS clipboard mutation and the journal
cannot be atomic. At the ordered queue head the session authenticates the pinned selection,
materializes and hashes the immutable clipboard bundle, and fully prepares the deletion candidate
through parse, postconditions, history, and selection mapping. It then holds later commits and calls
`CutClipboardPort` with `{ cutOperationId, bundleHash, bundle }`. Only a matching `confirmed`
receipt may be included in and followed by the already-prepared source commit. `failed`,
`outcome-unknown`, cancellation, timeout, or crash before confirmation publishes a typed rejection
and leaves canonical source/history unchanged; the clipboard may have become copy-only. Duplicate
requests are safe only because `CutClipboardPort` deduplicates the operation ID plus bundle digest
and returns its recorded receipt without rewriting a clipboard that may since have changed; the
operation ID and journal still make the source commit exactly once. A later failure never attempts
clipboard rollback. This is the sole named pre-commit
external prerequisite and never runs through the post-commit `EffectRunner`; Source-draft Cut uses
the same acknowledgement gate. Failure-injection covers partial MIME writes, lost/duplicate/late
confirmation, crash before/after confirmation ingress and commit sync, cancellation, stale
selection, Track Changes, Source mode, and read-only Original/Revised. See ADR-0012.

Only `revision-changed` transitions caused by a new `source-edit` enter document undo history.
`reinterpret` and semantic session changes such as explicit selection, view, mode, Track state,
authoring configuration, or draft begin/update/cancel create no undo entry but carry
`coalescing: 'break'`. Ephemeral admission, queue-depth, pending overlay, worker-progress, and
recovery-status transitions carry `coalescing: 'preserve'`; otherwise ordinary async typing could
never coalesce. `undo`/`redo` move the history cursor without recording themselves. Compatible
typing coalesces if and only if intent kind/direction and Track/profile state match, both endpoints
map contiguously in the same surviving semantic text leaf, selection remains collapsed at that
endpoint, no coalescence-breaking transition intervenes, and the coordinator-assigned admission
timestamps of adjacent input atoms differ by at most 750 ms. Those immutable timestamps and the
resulting coalescing-decision basis travel in the worker request and journal record; worker
start/completion, batching, retry, and crash recovery never reread a clock or change the group.
Paste, composition commit, structure, Review, and source commit never coalesce. A successful
Add/Edit Comment or `CommitSourceDraft` submission is a `source-edit` and records one undo entry;
only manipulating or cancelling its uncommitted draft is session-only. A checked-in history matrix
tests every condition, preserving transition, and breaker one row at a time, including a delayed
worker and crash-before-append retry.

History stores canonical forward/inverse source-edit lists, before/after source hashes, and
canonical selection/draft anchors—not old revision objects or session view/mode. Undo/redo applies
that source transaction to the current revision under the current `ParseConfiguration`, then
revalidates/restores its anchors; session-only view/mode remains current. Reinterpretation preserves
undo/redo source entries but invalidates cached transition proofs. If reparse under the current
configuration exceeds budget, undo/redo rejects visibly and does not move the history cursor. A new
source edit after undo truncates redo; reinterpretation alone does not. Permanent rows cover undo →
reinterpret → redo, edit → reinterpret → undo, handle invalidation, and budget failure. If the
source transaction parses but a stored selection anchor is no longer a legal position under the new
profile, the source/history commit still succeeds and selection falls to the nearest legal Markup
position in the stored affinity direction (or `none` when no editable position exists), with an
explicit restoration diagnostic. A Review/Source draft whose semantic target no longer survives
remains exact and stale; it is never retargeted. Literal history rows cover both fallback
directions, no-position documents, and stale drafts across undo and redo.

A language-transaction failure changes no canonical source, revision, syntax, history cursor, model
selection target, or retained draft bytes. The session does publish exactly one
`session-state-changed` transition that marks the ticket/draft blocked and carries its stable
rejection descriptor; the desktop presentation adapter localizes it, and pending status and overlay
chrome may therefore change. No document-change event or
executable effect is emitted. A committed `SessionTransition` publishes immutable effect
descriptions atomically with state; returning or subscribing to that transition grants no execution
authority.

One session host owns exactly one `EffectRunner`. After publishing a transition, the host submits
its effects once in ascending ordinal order. Each effect has stable
`{transitionId, ordinal, target, snapshotId, planId?, prerequisite, stalePolicy}` identity.
`after-snapshot` effects may run after the exact snapshot is published; `after-live-plan` effects
wait until the matching revision's DOM plan is installed. An `after-live-plan` effect is valid only
with `drop-if-revision-changed`; if a newer revision publishes before that plan mounts, the runner
returns terminal `superseded` and never mounts stale DOM merely to run it. A same-revision view
switch, plan replacement, unmount, or close is equally stale when the exact snapshot/plan
prerequisite no longer can mount; close yields terminal `session-closed`. `after-snapshot` may
instead declare `run-once` only when its target is revision/view/lifecycle-independent. The runner
deduplicates the ID and routes to one named adapter. A pre-call check is not enough: it acquires an
`EffectTargetLease` from the same serialized mount registry that processes view
switch/unmount/close, and the adapter atomically validates that lease at its actual
DOM/external-commit point. An asynchronous adapter receives an invalidation signal and must
revalidate before every irreversible step; failure returns `superseded` without acting. The
journaled effect outbox guarantees exactly-once **runner admission**, not impossible exactly-once
arbitrary external side effects. Before an adapter call, the runner records `claimed`; afterward it
records the typed result. Every effectful adapter must accept the effect ID as an idempotency key or
provide a reconciliation read. After a crash with `claimed` but no result, recovery reconciles; an
adapter that can do neither is restricted to at-most-once execution and returns terminal
`outcome-unknown` rather than being blindly retried. Results travel on a separate effect-result
channel and never amend or roll back document state. Tests prove ordering, one outbox admission
despite multiple subscribers, idempotent replay, claimed-without-result reconciliation,
r1→r2-before-r1-mount supersession, adapter failure, correct SourceOnly behavior, and no
render-dependent execution before the matching DOM plan is mounted. A document recovery journal is
not deleted while any outbox entry is unclaimed, claimed, or unreconciled. Clean close either waits
for a terminal result or atomically transfers a genuinely document-independent effect to a
separately durable global outbox; DOM/view effects can never be transferred after session close.

### `RevisionTransition` contract

Every successful `revise`, including one implemented by a clean full parse, returns the proof object
used to move revision-bound state:

```ts
interface RevisionTransition {
  readonly base: RevisionId
  readonly next: RevisionId
  readonly edits: readonly SourceEdit[]
  readonly inverseEdits: readonly SourceEdit[]
  readonly canonicalMap: ChangeMap
  readonly nodeSurvival: NodeSurvivalMap
  invert(): RevisionTransition
  compose(next: RevisionTransition): RevisionTransition
}
```

- `edits` are nonoverlapping half-open ranges in base coordinates, sorted by start ascending and
  applied right-to-left. The planner coalesces all insertions at one base offset into one insertion
  in intent order, so equal-position edit ordering is never implicit. `inverseEdits` obey the same
  canonical-list rule in next coordinates and reproduce the base source exactly.
- `ChangeMap` maps positions and ranges forward and backward with explicit `previous`/`next`
  affinity. A deleted interior maps to the corresponding replacement boundary plus affinity; range
  mapping reports `unchanged`, `changed`, `split`, or `deleted` rather than inventing continuity.
- `NodeSurvivalMap` returns a next-revision handle only when the engine proves that the complete
  semantic node, its carrier/arm, and its mapped source have survived. Range equality or matching
  text is not proof.
- Composition is associative over adjacent transitions, retains deletion and affinity information,
  and is observationally identical to sequential maps.
- `invert()` swaps base/next, edits/inverse edits, map direction, and survival evidence. That
  inverse is directly publishable only while the mounted revision and `ParseConfiguration` exactly
  match the transition's original `next` side. After reinterpretation, undo/redo reapplies the
  stored inverse or forward source edits through the current `RevisionKernel` and publishes a fresh
  transition. No consumer treats an old revision as the `next` side of a forward map.
- Selection, drafts, history metadata, async handles, diagnostics, and DOM keys rebase only through
  this object. No adapter performs offset arithmetic or repeated-text search.

Contract tests cover insertion/deletion/replacement at both boundaries, surrogate pairs, CRLF,
same-offset insertion coalescing, split/deleted ranges, forward then inverse identity, undo/redo
direction, three-transition composition, survived versus replaced nodes, and full-parse versus
incremental production of the same observable map.

### Selection and browser editing

Selections are model positions in a revision/view coordinate space, not mutable DOM ranges or
`TState` paths. The live plan provides exact view↔canonical maps, including two-sided affinity where
hidden source collapses to one visible position. Hidden Comment bodies expose no editable positions,
so mouse, keyboard, IME, restore, and `beforeinput` share one structural caret invariant.

The DOM adapter prevents native mutation at `beforeinput`, translates input to an intent, and
patches canonical DOM only from a committed live plan. The session-owned pending overlay is visually
distinct adapter chrome and cannot be queried as editable document content. IME composition is an
isolated draft committed once. Async operations carry revision-bound handles and reject visibly when
stale.

Even a delimiter edit at the start of a maximum accepted document cannot block the renderer on
parsing **or on result delivery**. On closure reference hardware, admission plus pending snapshot
publication takes at most 50 ms and pending text is visible within two animation frames. The
measured heartbeat window begins before `beforeinput` and ends only after worker parse,
structured-clone transfer, checksum and delta staging, atomic client snapshot swap, and the matching
current-viewport DOM-plan patch/mount acknowledgement; it has no gap over 100 ms and that mount
settles within 10 seconds. Transferable/chunked plan data, persistent structures, viewport
virtualization, and scheduled DOM chunks are required where profiling shows them; a monolithic delta
clone or offscreen DOM replacement is not an acceptable hidden renderer stall. The test edits a
leading delimiter that forces worst-case suffix invalidation; a warm local insertion cannot
substitute for it. Hardware metadata, payload sizes, phase timings, heartbeat samples, and mount
acknowledgement are retained.

### Track Changes

Track Changes decorates only eligible Markup ordinary-edit plans before mutation.
`CommitSourceDraft` commits its exact raw draft regardless of the Track toggle; Review
authoring/resolution, undo/redo, and reinterpretation also bypass tracking and apply their own typed
contracts. A newly tracked ordinary-edit intent first produces `untrackedCandidate` by running the
same intent, selection, view, and base revision without tracking. It commits `trackedCandidate` only
if:

```text
meaning(trackedCandidate, Original) = meaning(previous, Original)
meaning(trackedCandidate, Revised)  = meaning(untrackedCandidate, Revised)
```

`meaning` is the revision-owned projection-semantic tree after CM projection, Profile Markdown
parsing, escape/entity decoding, and safe raw-HTML classification. Equality compares exact semantic
node kinds, decoded content, attributes, and structure, but not protective source spelling,
provenance, or DOM/CSS identity. When no generated protection is required, projected Markdown source
must also be code-unit equal. This distinction makes tracking literal delimiter text possible:
deleting `a --} b` produces `{--a --\} b--}`; its Original projected source is `a --\} b`, while its
Original meaning is exactly the previous `a --} b`.

The law is compositional in documents that already contain CriticMarkup; it does not compare a
projection with raw canonical marker source. Review resolution is not a newly tracked ordinary edit
and follows its type-specific command postcondition instead. Permanent fixtures apply tracked edits
inside and around a properly nested document containing all five forms and prove both equations with
literal expected canonical source, projected source, and meaning trees for every opener, closer, and
separator protection case.

Track Changes never mutates DOM/JSON state first and tries to infer the user's source edit
afterward. Direct edits and tracked edits use the same planners for text, formatting, structural
commands, paste, drag/drop, IME, tables, lists, and document replacement.

Tracked-edit interaction contract

The two projection equations are necessary but not sufficient: many different marker rewrites have
the same projections. Each editable semantic leaf is therefore classified recursively from the
projection matrix before planning. Rule 8's atomic `LiteralEditOwner` transition and the
anchor-exhaustion rule below take precedence because CM inserted inside a literal would be inert and
a last-contribution leaf wrapper would violate the anchor lifecycle. For all other targets:

| Leaf presence `(Original, Revised)` | Examples                                                                                        | Markup edit policy with tracking                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `(present, present)`                | root prose; Highlight payload not suppressed by an outer carrier                                | insert → nested Addition; delete → nested Deletion; replace → nested Substitution                                    |
| `(absent, present)`                 | Addition payload; Substitution new arm; any descendant whose carrier path has that net presence | apply the ordinary edit directly inside the already-pending revised payload; do not create a redundant nested change |
| `(present, absent)`                 | Deletion payload; Substitution old arm; descendants with that net presence                      | read-only in Markup; ordinary edit rejects visibly                                                                   |
| `(absent, absent)`                  | Comment subtree or content suppressed in both views                                             | no live position; browser input is blocked before dispatch                                                           |

Marker and separator code units never have live editable positions. Source mode can edit them as raw
source, but that is a source commit, not a tracked ordinary edit. An Addition wrapper is removed
after direct editing only when its payload has exactly zero source code units and no surviving
node/trivia; cleanup then runs through `SemanticEditCodec`. Projection-emptiness is insufficient:
`{++x{--old--}++}` deleting `x` must retain `{++{--old--}++}`, and `{++x{>>c<<}++}` must retain
`{++{>>c<<}++}`. An empty Substitution arm remains meaningful and is retained.

Selections are classified as `inside-one-leaf`, `contains-complete-items`, `touches-boundary`,
`partial-intersection`, or `crosses-noneditable`. Markers and separators **owned by a fully
contained CM node** are part of that semantic node and are allowed; an endpoint that cuts a node or
directly targets any owned marker/separator rejects. Thus complete Addition, Deletion, and
Substitution (including its owned `~>`) are positive **enclosure-command** fixtures. Add Comment and
Mark Highlight may copy a fully contained CM change node atomically even when that node owns
`(present,absent)` descendants; they do not claim a live caret inside those descendants. This
exception never applies to a direct or partial ordinary edit, and any hidden Comment in the target
still rejects. Rule 8's literal classifier additionally rejects an inside-literal or partial-literal
enclosure and admits a complete literal owner only after its reparse proof. Apart from those
enclosure cases and the whole-anchor rule below, a selection containing a partially contained item,
`(present,absent)` content, or hidden Comment content rejects atomically. Otherwise the planner
partitions the ordinary edit across complete `(present,present)` and `(absent,present)` segments in
source order: it wraps only the former and edits/removes only the latter. Complete nested items are
preserved unless the user's semantic target contains their entire Revised-visible contribution. A
collapsed boundary uses the model position's explicit `previous`/`next` affinity to choose its
carrier; ambiguous or stale affinity rejects rather than guessing.

Add Comment has a stronger postcondition than syntactic nonemptiness: before opening a draft and
again at commit, the proposed outer Highlight must have at least one `RevisedContribution` atom that
survives its complete ancestor path to the root Revised plan. A complete Deletion alone therefore
rejects Add Comment; a complete Substitution qualifies only when its revised arm contributes. Thus
`{~~old~>new~~}` may be anchored when `new` contributes, while `{~~old~>~~}` may not. Mark Highlight
is only an annotation enclosure and may wrap a complete Deletion even when its root Revised
contribution is zero.

Whole-Highlight exhaustion—whether the Highlight is a Comment anchor or a standalone annotation—is
classified by the Highlight's **effective carrier presence before** applying its structural rule:

- Before any carrier policy, every whole-Highlight deletion—or partial edit that would change any
  affected Highlight from positive to zero root-Revised contribution—checks each complete exhausted
  Highlight subtree for a Comment descendant. If one exists, the operation rejects with
  `selection-crosses-hidden-comment` without source, history, selection, or draft change. This
  precondition applies equally at the root and inside Addition or Substitution-new carriers. In
  particular, `{++{==a{>>inner<<}b==}{>>outer<<}++}` is unchanged under direct and tracked
  whole-anchor deletion, and `{==x{>>inner<<}==}` is unchanged when deleting its last visible `x`
  with tracking either off or on. This guard is for ordinary Highlight-exhausting edits; Source
  commits and explicit Remove/Accept/Reject commands instead obey their own typed postconditions,
  including the command matrix's explicit descendant retention or arm discard.
- For `(present,present)`, `{==x==}{>>c<<}` directly becomes `{>>c<<}`. With tracking it becomes
  `{--{==x==}--}{>>c<<}`, **not**`{=={--x--}==}{>>c<<}`. Original is `x`, Revised is empty, the
  outer Comment derives `precedingChange = Deletion`, and its card is unanchored in the root Revised
  context. Accept yields `{>>c<<}`; Reject restores the exact pair.
- For `(absent,present)`, the existing pending carrier policy wins and no redundant Deletion is
  added. Deleting the anchor in `{++{==x==}{>>c<<}++}` yields `{++{>>c<<}++}` with tracking either
  on or off; the nonzero Comment payload means the Addition is retained. In a Substitution new arm,
  `{~~old~>{==x==}{>>c<<}~~}` yields `{~~old~>{>>c<<}~~}`. `(present,absent)` and `(absent,absent)`
  have no legal ordinary whole-anchor target.
- A `(present,present)` nested/block-spanning Highlight may contain complete nested Addition,
  Deletion, Substitution, or Highlight nodes. The tracked operation copies their exact source inside
  the outer Deletion; the direct operation retains any untargeted residual source/nodes after
  removing the selected Revised-visible contribution and the exhausted Highlight wrapper. For
  `{==a{>>inner<<}b==}{>>outer<<}`, the global precondition above leaves the exact source, both
  Comments, and history unchanged until the user explicitly removes the inner Comment (or edits
  Source) and retries. This is the deliberate no-silent-loss rule.

Partial deletion follows the ordinary leaf rule while the Highlight retains a root-Revised
contribution. The edit that removes its final contribution is replanned as one structural final
transition, not allowed to leave an unpresentable empty anchor. With Track Changes off, it applies
the ordinary edit, removes the exhausted Highlight wrapper, and retains every residual untargeted
payload code unit and non-Comment CM node in source order before the adjacent outer Comment. If no
residual remains, the exact result is the bare Comment; deleting `b` from `{=={--a--}b==}{>>c<<}`
yields `{--a--}{>>c<<}`. With tracking on in `(present,present)`, it wraps the **complete pre-intent
current Highlight** in one outer Deletion—even when earlier partial tracked edits already exist
inside it—so Reject restores that immediately prior Highlight byte-for-code-unit and Accept leaves
the bare Comment. In `(absent,present)` it applies the same direct residual-preserving rule under
the existing carrier with no redundant Deletion; the other presence classes remain noneditable. The
global hidden-Comment check runs before all of these outcomes. Sequential fixtures start from
`{==ab==}{>>c<<}`, remove one contributing atom, remove the last, and assert literal source,
context, Accept/Reject where applicable, plus each undo/redo state with Track off and on. Rows with
prior nested Deletion/Addition/Substitution/Highlight prove residual survival; rows with pending
Addition and Substitution-new prove carrier-local results. Literal rows also prove both projected
sources and meanings, and adjacency after the transition.

Anchor exhaustion is computed as a set, so nesting cannot manufacture empty annotation shells. For
one ordinary candidate, collect every Highlight whose root-Revised contribution changes
positive→zero and order containment inner to outer. Run the hidden-Comment precheck over every
affected Highlight's complete subtree first, including standalone Highlights; any failure rejects
the entire ordinary candidate before a cleanup plan exists. Partition the exhaustion set into
overlapping containment components. With Track on in `(present,present)`, the **outermost exhausted
Highlight in each component** owns the rule: wrap its exact complete pre-intent source once in a
Deletion and suppress every overlapping inner cleanup/edit plan. A gapless paired Comment remains
adjacent to that wrapper. Thus deleting `x` from `{=={==x==}==}{>>outer<<}` yields
`{--{=={==x==}==}--}{>>outer<<}`; Reject restores the exact nested pair and Accept leaves the
Comment. Deleting `x` from the standalone `{==x==}` yields `{--{==x==}--}`; Reject restores the
exact Highlight and Accept removes it and its payload. With Track off, or in `(absent,present)`,
apply the ordinary edit and perform `ExactEmptyAnnotationCleanupV1` inner-to-outer: discard each
exhausted Highlight's markers, retain residual untargeted non-Comment payload nodes/code units, and
remove a zero-unit payload entirely. The same example becomes `{>>outer<<}` at root and
`{++{>>outer<<}++}` inside Addition. Standalone Highlights use that cleanup too, so app commands
never create `{====}`; source/import can still preserve it. Fixtures cover two/three nested
Highlights, standalone and paired exhaustion, standalone/paired hidden-Comment rejection with
tracking off/on, residual Deletion/Substitution, pending Addition/Substitution-new, multiple
disjoint annotations in one transaction, and every intermediate undo/redo/Accept/Reject source.

Every semantic candidate also proves a locality/survival law: source is code-unit identical outside
(a) the minimal canonical target hull, (b) every explicitly named exact-empty-wrapper cleanup range,
(c) every minimum codec protection site for a guard-rejected responsible delimiter, and (d) an
explicitly named provenance-bearing `BofTextCodecV1` repair site for an ordinary U+FEFF moved to
offset zero; every untargeted pre-existing node survives through `NodeSurvivalMap`; and no command
silently accepts, rejects, reorders, or canonicalizes an existing Review item. Phase 0 checks in
`track-changes-interactions.tsv`, crossing intent family (insert, delete, replace, format,
structure, paste/cut, drag/drop, spellcheck, IME, table/list, image placeholder/resolution, and
document replacement) with target form (root plus all five CM forms), arm (payload, Substitution
old/new, or none), boundary (before/open/inside/separator/close/after), shape
(plain/empty/nested/block-spanning), presence class, direction, and affinity. The manifest schema
requires every Cartesian coordinate to be either a literal test row or an explicit typed
`inapplicable` row with a reviewed reason; silence cannot count as coverage. Each executable row
carries literal previous, ordinary, tracked, Original/Revised projected sources, Original/Revised
meaning trees, outcome, generated-protection provenance, source edits, and survival expectations.
Phases 3, 4, and 7 enable each applicable row in its command family one red-green cycle at a time.

### Type-safe Review command matrix

The core owns stable semantic descriptors, never localized strings:

```ts
type PresentationMessage = {
  [Key in keyof PresentationMessageParametersByKey]: Readonly<{
    readonly key: Key
    readonly parameters: Readonly<PresentationMessageParametersByKey[Key]>
  }>
}[keyof PresentationMessageParametersByKey]

interface CommandPresentation {
  readonly action: ReviewAction
  readonly label: PresentationMessage
  readonly enabled: boolean
  readonly disabledReason?: PresentationMessage
}
```

`PresentationMessageParametersByKey` is a generated closed interface from the checked-in message
manifest; each key has its exact named parameter object, including an empty object when no
parameters are legal. Rejections and retained drafts use the same key-plus-typed-parameters contract. Journals and worker
envelopes store codes, keys, and typed parameters only. One desktop-owned `PresentationLocalizer`
maps them through the existing locale catalog; sidebar, shell control, context menu, native menu,
and command palette consume that one localized result. A locale change is presentation-only: it
causes no reinterpretation, session transition, history entry, journal rewrite, or semantic-hash
change. Tests require exhaustive key coverage in every shipped locale, identical descriptors across
all sinks, and relocalization of retained rejections after a locale change.

`CommandPresentation` exposes only actions that have a defined language result:

| Target                       | Authoring command                                   | Resolution commands  | Exact result                                       |
| ---------------------------- | --------------------------------------------------- | -------------------- | -------------------------------------------------- |
| Addition                     | Mark as Addition; Track insertion                   | Accept, Reject       | keep payload / delete whole item                   |
| Deletion                     | Mark as Deletion; Track deletion                    | Accept, Reject       | delete whole item / keep payload                   |
| Substitution                 | Suggest Replacement; Track replacement              | Accept, Reject       | keep new arm / keep old arm                        |
| standalone Highlight         | Mark Highlight                                      | Remove Highlight     | unwrap and retain payload                          |
| standalone Comment           | none in WYSIWYG; source/import/anchor deletion only | Edit, Remove Comment | edit payload / delete Comment                      |
| nonempty Highlight + Comment | Add Comment to selection                            | Edit, Remove Comment | edit Comment / unwrap Highlight and delete Comment |

There is no Remove Addition, Accept Comment, Reject Highlight, or other generic action alias. Add
Comment requires an editable Markup selection whose proposed Highlight has a positive root-Revised
contribution and rejects a collapsed, hidden, stale, crossing, `literal-inside`, `literal-partial`,
`literal-source-only`, or partially intersecting CM target; it never authors a bare Comment through
the WYSIWYG command. Imported bare Comments remain valid and removable.

The three direct change-authoring commands are first-class typed intents, not aliases for turning
Track Changes on and synthesizing browser input: `MarkAddition { target }`,
`MarkDeletion { target }`, and `SuggestReplacement { target, replacementText }`. On ordinary `sel`
they author `{++sel++}`, `{--sel--}`, and `{~~sel~>replacement~~}` respectively, independent of the
Track Changes toggle. `replacementText` is semantic authoring text—not raw CM—and is encoded with
`SemanticEditCodec` plus the frozen authoring-EOL policy; an empty replacement arm is an intentional
visible deletion suggestion, not private state.

All three share the revision-owned enclosure target classifier with Mark Highlight and Add Comment:
Markup view only, noncollapsed authenticated selection, complete CM-node containment,
complete-literal-owner widening, hidden-Comment rejection, and typed
stale/crossing/inside-literal/partial-CM or partial-literal rejection. `ContextualEnclosureCodec`
must reparse and prove the one requested outer node, exact survival of fully contained CM/literal
owners, and no untargeted syntax change. Mark Addition additionally requires positive root-Revised
contribution after enclosure; Mark Deletion and Suggest Replacement require a positive root-Original
old contribution. These gates keep direct commands from manufacturing semantically empty wrappers
while preserving Profile 1's source/import support for every complete empty form.

Individual resolution removes only the target's own wrapper/separator and the arm that its command
discards. Retained raw payload slices remain source-exact, including nested CM, except for minimum
generated protection at any delimiter causally reclassified by the transform's verified
delimiter-decision trace and a provenance-bearing `BofTextCodecV1` repair when the candidate moves
an ordinary nonleading U+FEFF to offset zero; descendants inside a discarded payload are discarded
with it. **Accept All** is one atomic source transaction whose canonical result is the revision's
boundary-safe Revised projected Markdown source. **Reject All** analogously produces the Original
projected source. Both remove annotation wrappers and Comments as the projection tables specify, are
independent of traversal order, and create one undo entry.

The legacy resolver's special BOF/mid-document/EOF “whole-line junction collapse” is superseded. It
was serializer normalization outside the resolved syntax item. Profile 1 resolution retains every
whitespace code unit outside the target and changes only its wrapper/discarded arm plus the minimum
Profile protection at any delimiter causally reclassified by the verified delimiter-decision trace
or a provenance-bearing `BofTextCodecV1` repair for an ordinary U+FEFF moved to offset zero.
Protection is not limited to a generated boundary. Vacated blank lines therefore remain exactly when
the selected projection retains them.

`resolution-parity.yml` generates nested and whole-line cases at BOF, middle, and EOF. For every
legal leaf-first/parent-first order, resolving all surviving items individually must finish with no
CM nodes and the same parsed Markdown and rendered text as Accept All or Reject All. It must also be
code-unit identical when no generated protection anywhere was needed, including every legacy 45-row
parity fixture. Universal byte identity is deliberately not promised: an earlier individual
resolution may have preserved a user-authored protective escape or inserted a now-redundant but
semantically neutral one that pure CM cannot distinguish after save/reopen. Bulk resolution remains
the unique canonical source operation. Fixtures prove protective tokens stay associated with the
literal delimiter they encode, so later removal cannot strand a semantic backslash.

### Comment command input contract

Sidebar Add/Edit controls are plain-text editors for **raw Comment payload source**, not rich-text
replacements of the card's Revised display. Their command types are
`AddComment { target, rawPayloadSource }` and `EditCommentPayload { comment, rawPayloadSource }`.
The card may show a live, sanitized Revised preview, but commit inserts the validated raw code units
verbatim between the outer `{>>` and `<<}` or replaces only that existing payload range. Existing
protective spelling and nested CM therefore survive until the user explicitly changes those bytes.

The candidate must reparse to exactly one surviving target Comment with the submitted payload range.
An active unprotected outer `<<}` or any other input that closes, destroys, or retargets that
Comment rejects visibly and retains the draft. A zero-code-unit Add or Edit also rejects
(`empty-comment-payload`); **Remove Comment** owns deletion. Whitespace-only payload is nonempty and
is preserved. Source mode/import may still contain the Profile-valid empty `{>><<}` form. Properly
nested CM is intentional raw source; protective escapes are how raw input requests literal
CM-looking text. The semantic-text escape codec in Profile rule 7 applies to ordinary WYSIWYG
document-text intents, not to this explicitly raw Review field.

The sidebar control is not source authority. `RawCommentDraft` retains the exact payload code units
and a display↔source map; `beforeinput`-style range edits apply to that model. A
textarea/contenteditable's normalized whole `.value` is never submitted. Existing CRLF tokens, bare
CR/LF, tabs, and untouched astral units therefore survive a one-character edit. A newly entered line
break uses the session's frozen `nearest-owner-eol-v1` authoring policy, while pasted raw payload
retains its submitted line endings. Browser/session rows open existing CRLF, bare-CR, LF, and
mixed-EOL payloads; prove no-op/cancel identity; press Enter before/between/after competing tokens
and assert the chosen token; edit one character with all other units exact; commit; recover; and
undo to the exact original.

Literal command fixtures are:

| Raw draft    | Result                                                      |
| ------------ | ----------------------------------------------------------- |
| `note`       | `{>>note<<}`                                                |
| `{++x++}`    | `{>>{++x++}<<}` with one nested Addition                    |
| `\{++x++}`   | `{>>\{++x++}<<}` with literal Addition-looking text         |
| `<<\}`       | `{>><<\}<<}` with a protected literal closer in the payload |
| `<<}`        | rejected; exact draft retained                              |
| empty string | rejected; imported `{>><<}` remains valid                   |

Edit repeats every row and every EOL fixture while proving all source outside the exact changed
subrange code-unit identical and exact undo restoration.

### Review and comment drafts

Comment composition and editing are session state, not mounted Vue state:

```ts
interface ReviewDraft {
  document: DocumentIdentity
  baseRevision: RevisionId
  target: SourceAnchor | NodeRef<'Comment'>
  rawPayloadSource: string
  status: 'ready' | 'stale' | 'blocked'
}
```

Beginning Add Comment pins the exact selection. Moving the caret, hiding the sidebar, switching
panels/files, or unmounting a component cannot retarget or erase the draft. A nonoverlapping
revision transition rebases it if and only if the `ChangeMap` proves the target unchanged. Overlap
retains the exact draft and returns a typed stale-target rejection.

The snapshot publishes actual type-aware command descriptors, including message keys, parameters,
and enabled state. The desktop presentation adapter localizes them once. Sidebar, in-window
controls, context menus, native menus, and command palette consume that localized result rather than
reconstructing semantics from copied booleans.

Review order is canonical source-opener order, parent before descendants, with a stable type
tie-break only for zero-width equal offsets. Each `LiveRenderPlan<V>` derives
`VisibleReviewOrder<V>` by filtering that total order to presentations available in the active view;
the filter never reorders survivors. A caret or pointer hit uses the mounted `LiveRenderPlan<V>`
hit-test map and chooses the deepest Review item visible at that exact semantic position in the
**current view** (smallest source span, then source order). Deletion payloads and Substitution old
arms are therefore targetable in Markup/Original even though Revised suppresses them; Revised
visibility remains special only to the Highlight-anchor nonempty rule. If no deeper visible Review
item owns the hit, a position in an anchored span selects its derived Comment presentation; nested
anchored spans choose the innermost/deepest Comment. If a nested visible change or plain Highlight
owns the exact hit, that deeper item wins instead. Explicit card selection or Previous/Next may
focus a parent and remains on that exact surviving handle; passive hit-testing does not immediately
steal it until the caret/pointer enters a different semantic target. Previous/Next traverses
`VisibleReviewOrder<V>`, not hidden entries in the flat canonical order. After resolution, focus
moves to the next surviving visible entry, else the previous visible entry, else the editor position
mapped from the resolved item's start. A projection handoff retains the same active handle only when
it survives and belongs to the destination view's visible subset. Otherwise it chooses the first
destination-visible item at or after that handle's canonical source position, else the previous
destination-visible item, else the mapped editor position; switching back recomputes from the
current authenticated handle or source position rather than reviving stale UI identity. Deletions
and old Substitution arms therefore cannot become navigation dead ends in Revised. No DOM nesting
heuristic chooses a target.

A context-menu hit returns an event-scoped `ReviewHitPath`: the deepest visible item plus its
authenticated visible ancestry and nearest containing anchored Comment, all bound to frame, gesture
epoch, snapshot, revision, and plan. The menu keeps the deepest item's legal change/Highlight
actions and, whenever an anchor is in that path, also offers **Edit Comment** for the nearest
anchored Comment; choosing it does not retarget or discard the nested item's other commands.
Duplicate targets collapse to one action. The renderer revalidates the selected path entry against
the current snapshot before dispatch. Nested E2E rows right-click a change inside an outer comment
anchor and an inner anchored comment inside an outer anchor, proving both action ancestry and
nearest-anchor editing without stale or wrong-frame fallback.

Review has one persistent, discoverable in-window mouse control that remains visible when both the
panel and icon rail are hidden. The native View menu is a fallback, not the only pointer path.
Opening Review is one stable session/app command consumed by every entry point.

Concretely, the control is mounted in the editor shell outside the collapsible sidebar subtree, uses
the Review icon plus tooltip/accessible name and item-count badge, and opens (rather than silently
toggling away) the Review panel on click. When the rail is visible, its existing Review icon remains
a second pointer entry. Hiding the panel, the rail, or the whole sidebar cannot hide or disable the
shell control; opening it does not create a comment, select an item, or move editor focus on its
own.

### Rendering, materializers, persistence, and source mode

Normative consumer policy

Phase 0 transcribes this table into `consumer-policy.yml`; implementation does not get to choose its
cells. “Canonical slice” means the minimum exact source hull mapped from the selected view range,
including every fully covered hidden or syntax span between its mapped endpoints. “Projected text”
means decoded plain text from that view's `meaning` tree, not projected Markdown spelling. “Review
HTML” uses semantic `<ins>`, `<del>`, `<mark>`, and safe annotation roles; “clean HTML” contains no
CM nodes or annotation metadata.

| Consumer                       | Markup                                                                                                                                                                                                                                   | Original                                                       | Revised                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| Normal Copy                    | `text/plain` is the exact canonical slice and the private source flavor carries the same source/provenance; `text/html` is Review HTML                                                                                                   | projected plain text plus clean HTML                           | projected plain text plus clean HTML                           |
| Copy Rich                      | Review HTML plus projected Markup-visible plain-text fallback (not raw markers)                                                                                                                                                          | clean HTML plus projected plain text                           | clean HTML plus projected plain text                           |
| Copy HTML                      | plain text containing serialized sanitized Review HTML                                                                                                                                                                                   | plain text containing serialized clean HTML                    | plain text containing serialized clean HTML                    |
| Copy Markdown                  | exact canonical slice, independent of active projection                                                                                                                                                                                  | exact canonical slice mapped from the selected projected range | exact canonical slice mapped from the selected projected range |
| Cut                            | same bundle as Normal Copy; only a matching `CutClipboardPort` receipt authorizes one editable Markup semantic deletion; Track applies when enabled                                                                                      | disabled/read-only                                             | disabled/read-only                                             |
| Paste                          | private MarkText source flavor is an explicit exact Markdown/CM import; explicit Paste as Markdown treats supplied Markdown/CM as raw syntax; external plain text and converted safe HTML are semantic edits through `SemanticEditCodec` | disabled/read-only                                             | disabled/read-only                                             |
| Search                         | exact canonical source, including Markdown/CM markers and Comment payload                                                                                                                                                                | projected plain text                                           | projected plain text                                           |
| Replace/Replace All            | only hits with authenticated editable Markup ranges are enabled and use semantic intents; an atomic Replace All containing any syntax/hidden/read-only hit rejects and offers Source mode                                                | disabled/read-only                                             | disabled/read-only                                             |
| Word/character/paragraph count | committed canonical source, markers and Comment payload included                                                                                                                                                                         | the same committed canonical source count                      | the same committed canonical source count                      |
| Static HTML                    | sanitized Review HTML                                                                                                                                                                                                                    | sanitized clean Original HTML                                  | sanitized clean Revised HTML                                   |
| Styled HTML                    | styled sanitized Review HTML                                                                                                                                                                                                             | styled sanitized clean Original HTML                           | styled sanitized clean Revised HTML                            |
| PDF                            | actual artifact rendered from styled Review HTML                                                                                                                                                                                         | actual clean Original artifact                                 | actual clean Revised artifact                                  |
| Print                          | captured/printed artifact rendered from styled Review HTML                                                                                                                                                                               | captured/printed clean Original artifact                       | captured/printed clean Revised artifact                        |
| Save/autosave                  | exact committed canonical revision                                                                                                                                                                                                       | exact committed canonical revision                             | exact committed canonical revision                             |

Source mode has its own exact policy: normal Copy, Copy Markdown, Cut, Paste, Search, and Replace
operate on the acknowledged raw `SourceDraft`; rich/HTML copy and semantic export are disabled. Its
counter uses the exact acknowledged draft (and is visibly labeled draft-derived) until commit.
Save/autosave first commit that exact Draft ID/version/hash and block on invalid or unacknowledged
input. Static/styled HTML, PDF, and print require a committed revision plus an explicit
Markup/Original/Revised target; they never render an uncommitted source mirror.

Comment handling is equally fixed:

- raw consumers—canonical save, Source mode, Markup normal Copy/Copy Markdown, Markup search, and
  canonical count—include exact `{>>payload<<}` source;
- the live Markup prose plan hides marker and payload positions and exposes only the
  indicator/anchor plus the separate Review card;
- Markup Review HTML keeps Comment payload out of the main prose flow but emits a numbered
  annotation reference and a visible source-ordered annotation list. Each note is the sanitized
  Revised display of the Comment subdocument; raw HTML in a Comment is escaped as text, never
  executed. Clipboard HTML includes notes whose Comment or anchored Highlight intersects the copied
  hull; static, styled, PDF, and print include all notes in the materialized document; and
- Original/Revised text, HTML, search, PDF, and print elide the complete Comment subtree and emit
  neither indicator nor note.

Normal Markup copy's exact `text/plain` payload remains the lossless interchange promise even though
its optional HTML flavor is presentation. Paste consumes a private source flavor as raw syntax only
after source/profile validation; it never trusts HTML to carry canonical source.

Each search hit is typed as editable-visible, read-only-visible, or syntax/hidden. Markup
syntax/Comment hits remain countable and listed but never manufacture a DOM caret; their action is
**Show in Source**. Original/Revised hits are navigable highlights in the read-only plan. Replace
and Replace All obey the table atomically—there is no silent skip of a hidden or read-only hit.

`LiveRenderPlan<V>` is deliberately narrow: it carries semantic role, source provenance, hidden
status, keyed DOM structure, selection maps, and hit-test data for one live `markup`, `original`, or
`revised` view. The type fixes Markup as editable and Original/Revised as read-only; only
`LiveRenderPlan<'markup'>` exposes editable positions or input targets. Source mode is not a DOM
plan. A live plan is not a universal sink object.

`EditorSnapshot.review` owns `SessionReviewPresentation`: revision-derived Review items plus
session-owned active item, drafts, command presentations, and rejections. Sidebar components consume
that snapshot. It is not a pure revision materializer and cannot be reconstructed by a static
renderer.

Separate typed materializers consume an immutable revision and a named view:

```ts
interface DocumentMaterializers {
  materialize<R extends MaterializeRequest>(
    revision: CompleteDocumentRevision,
    request: R
  ): MaterializedResult<R>
}

type Materialized =
  | ClipboardBundle
  | StaticHtml<'markup' | 'original' | 'revised'>
  | StyledHtml<'markup' | 'original' | 'revised'>
  | PdfRenderDocument<'markup' | 'original' | 'revised'>
  | PrintDocument<'markup' | 'original' | 'revised'>
  | SearchText<'markup' | 'original' | 'revised'>
  | CountResult<'markup' | 'original' | 'revised'>
```

`PdfRenderDocument<V>` is the typed, sink-sanitized core input to the desktop PDF adapter; it is not
a claim that the pure package can call Electron. That adapter accepts only its `TrustedHtml<'pdf'>`
capability, returns a typed `PdfArtifact` with bytes/hash, and is the only step allowed to invoke
the platform PDF renderer. `PrintDocument<V>` similarly feeds the captured print adapter. Tests
inspect both final artifacts, not only these precursors.

Each HTML sink accepts only a sanitizer-produced, sink-specific
`TrustedHtml<'live-dom' | 'review' | 'clipboard' | 'static' | 'styled' | 'pdf' | 'print'>`.
TypeScript branding is developer guidance, not a security boundary: constructors and sink insertion
live in one unexported module, package/lint rules forbid unsafe casts and raw HTML insertion, and
the runtime sink validates a module-private capability (plus a browser Trusted Types policy where
available). HTML is sanitized in the process that performs final insertion; an IPC payload never
transfers a trusted capability. Hostile fixtures assert both output and actual
nonexecution/nonnavigation at every sink. No renderer or materializer independently reparses CM or
rediscovers that Addition means `<ins>`, Comment is hidden, or a particular run is noneditable.

Persistence is simpler and bypasses rendering entirely. The core creates a revision-bound
`CanonicalSourceLease` that reads the exact source-store chunks by identity for either complete or
source-only revisions; it never serializes a tree. The desktop adapter owns a `FileSnapshot`
containing original bytes, encoding/BOM information, decoded source, and decoder metadata. A no-op
save copies the original bytes. After an edit it encodes the new canonical source in the retained
encoding when representable. The decoder does not strip a BOM: its signature is one leading U+FEFF
in canonical source and its origin is recorded in `FileSnapshot`. Edited saves disable the encoder's
automatic BOM option and encode canonical code units—including that U+FEFF—once, so they neither
duplicate nor drop it. A leading U+FEFF that did not originate as a signature can remain
distinguishable in the current `FileSnapshot` for byte-reuse decisions but is encoded by the same
exact rule and may be decoded as a signature on a later independent open. That cannot change grammar
because Profile 1 treats the first source U+FEFF by value and position alone; BOM provenance is
absent from `SourceHashV1` and `RevisionSemanticHashV1`. An unrepresentable character causes a
visible rejection or an explicit encoding-conversion/Save As flow, never an implicit rewrite. This
is the byte-fidelity contract; the core remains code-unit exact.

Source mode uses an authoritative session-owned `SourceDraft` plus an explicitly nonauthoritative
renderer `SourceMirror`:

1. `BeginSourceDraft` creates a stable Draft ID pinned to an exact base revision/hash and journals
   its initial identity. The coordinator/worker owns the exact draft chunks, version, selection, and
   delta log.

2. Source entry streams a revision-bound, checksummed chunk snapshot into CodeMirror. The mirror may
   contain the full source because displaying raw source is its one purpose, but it is never
   canonical document authority or a save input.

3. Every CodeMirror transaction becomes an ordered
   `{draftId, baseDraftVersion, sourceEdits, selection, clientSequence}` delta on the same causal
   stream as all other session operations. The coordinator writes its `IngressEnvelopeV1` before
   acknowledging the new draft version/hash; only that durable acknowledgement applies/paints the
   delta in the SourceMirror. The input event may be held as adapter chrome during the bounded
   admission round trip, but it is not claimed as editor content. Diagnostics are tagged with the
   exact acknowledged draft version.

4. A gap, stale base, hash mismatch, renderer crash, unmount, or remount never reconstructs
   authority from CodeMirror. The host retains the exact draft and every acknowledged delta, and the
   client discards/resyncs its mirror solely from host chunks. A locally unsent delta becomes a
   separate retry draft only after its authoritative gap tombstone; an ambiguous send reconciles the
   same ID and was never painted before durable admission. Save/close waits for that causal frontier
   or returns blocked; only explicit confirmed discard may destroy the draft.

5. `CommitSourceDraft { draftId, expectedVersion, expectedHash }` references the owned draft rather
   than sending a whole string. The worker parses that exact version and, on success, creates one
   history entry/revision regardless of the Track toggle. Canceling changes no canonical source and
   disposes the draft only after its terminal operation is acknowledged.

A SourceOnly session uses the same protocol so a user can reduce an over-budget document or correct
source. Commit succeeds only when the candidate is a complete revision under the current
`ParseConfiguration`; otherwise the source-only revision stays authoritative and the exact draft
remains available. Increasing the budget uses `reinterpret`, not an implicit configuration change.

## Non-negotiable invariants

1. The authoritative parse is a Markdown parse whose Profile 1 grammar includes all five CM forms
   as native productions. No stage discovers CM separately, masks it from Markdown, or reconstructs
   canonical syntax from a CM forest or projection.

2. The intrinsic parser owns source progression and every block/container, inline-delimiter,
   literal, reference, CM-arm, recovery, and arm-boundary decision. A CM-first orchestrator
   with a Markdown checkpoint/lane is not the target architecture.

3. `CriticMarkupForest`, canonical/source ownership, Original/Revised/Comment CSTs, projections,
   provenance, references, diagnostics, and Review indexes derive from the intrinsic graph's exact
   node/event identities. None reparses a flattened string to rediscover authoritative syntax.

4. Concatenating canonical leaf tokens reproduces the decoded source exactly.

5. Every tree, projection, index, live plan, materialized result, diagnostic, and handle in a
   revision belongs to the same source and language profile.

6. Parser provenance is created with syntax. No range intersection, repeated-text search, DOM
   inference, structural-carrier rank, forest walk, or topology rebinding may manufacture it later.

7. Incremental parsing is observably equivalent to a clean full intrinsic parse of the resulting source.
   Equivalence compares canonical source, profile/options, syntax kinds/ranges/raw slices,
   projections/maps, diagnostics, semantic indexes, revision-owned action capabilities, and
   materialized outputs. Active item, draft state, menu placement, and selection-dependent semantic
   `CommandPresentation` descriptors are session-owned and excluded here; a separate harness mounts
   each result in a `DocumentSession` with identical selection, view, and app context and compares
   those stable descriptors. Locale and localized strings are desktop presentation state and never
   enter parser/session equivalence; a separate localizer harness checks them. Green-node object identity, cache layout, checkpoint placement, and
   performance counters are deliberately excluded. The full parser is the correctness oracle.

8. Projection segments record canonical slice, generated boundary, or elision while they are
   constructed; consumers never reverse-engineer origins.

9. View-to-source maps are total for editable positions and explicit about affinity at
   collapsed/zero-width boundaries.

10. Node handles are opaque and revision-bound. Reuse requires an explicit, proven
    `RevisionTransition`.

11. A session transform computes source edits, parses the candidate with the same intrinsic Profile 1
    parser, validates its semantic postcondition, and only then publishes.

12. Hidden Comment source has no editable Markup-view positions.

13. No renderer, menu, sidebar, clipboard path, or desktop process privately parses CriticMarkup
    marker text.

14. Malformed input preserves every source unit and never throws as user data.

15. Internal invariant failure commits nothing and emits a captured fatal diagnostic outside the
    durable document transaction.

16. Parser and index work is linear or `O(log n + k)` for indexed queries; delimiter edits may
    legitimately invalidate a suffix or full document but hidden `O(n²)` behavior is forbidden.

17. Async exports read an immutable revision and cannot race later edits.

18. New-engine documents have exactly one write authority for their lifetime.

19. Persistence obtains canonical source from the revision by identity; no render, serializer, CST
    walk, or materializer reconstructs it.

20. Every non-Source semantic transform parses its changed candidate through the intrinsic Profile 1
    parser and validates all changed joins through `SemanticEditCodec`; only an explicitly named
    authoring/Track/Review command may create CM, and no untargeted CM or Markdown construct appears
    or changes identity as a side effect.

21. Text that does not change across views is parsed exactly once. A document is parsed once and
    every view is a *read* of that one structure by arm selection; the parse forks — recomputing both
    resolutions — only across a region where eliding a marker changes Markdown structure, and
    reconverges after it. A CriticMarkup-free document therefore parses exactly once. Measured by
    `__markdownDocumentParsesV1`. See ADR-0013 and decision 11.

22. One block AST serves Markdown and CriticMarkup alike, and it is the model the editor mounts. The
    five CM forms are nodes beside Markdown blocks and inlines in a single tree. No view, renderer, or
    editor re-parses Markdown to recover block structure, and no second "CriticMarkup model" exists
    beside the Markdown model. See decision 13.

## Brutal current-to-target gap analysis

| Concern            | Current branch                                                                                                            | Required target                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Canonical document | Mutable `TState[]` in `state/index.ts`; parser artifact is an invalidated cache                                           | Exact source plus immutable `DocumentRevision`                                                      |
| Parse product      | `markdownToState` returns states, CM token document, analysis, and a separate binding graph                               | One atomic lossless Profile 1 syntax graph with native Markdown and CM productions                 |
| Source fidelity    | Critic markers and Markdown spelling are woven through `sourceTrivia`; ordinary source may normalize                      | Every source unit is a CST/token leaf; no-op persistence is exact                                   |
| Persistence        | `stateToMarkdown.generate()` reconstructs Markdown and weaves CM trivia                                                   | Save reads `revision.source` directly                                                               |
| Parser integration | Markdown literal ranges, provisional CM scan, projection rescans, final scan, and separate bindings                       | One intrinsic Profile 1 Markdown grammar; no CM pre/post-pass, CM-first driver, excluded ranges, flattened authoritative reparse, or post-hoc topology/ownership/reference join |
| Literal editing    | CM is inert in code/math/HTML/destinations, but Track/enclosure policy has no complete parser-owned atomic owner contract | Complete-owner widening or typed rejection; whole-owner Track changes with literal arm reparses     |
| Provenance         | Marked fork token ledgers plus located-token weaving and multiple path-domain binding graphs                              | Provenance emitted during syntax construction                                                       |
| Live topology      | `rebindCriticMarkupStateBindings` maps old bindings through new live spans and carrier rank                               | No rebinding API exists                                                                             |
| Mutation           | DOM/state mutates first, JSON ops are captured, source edits inferred, then state repaired or rolled back                 | Intent → source edits → candidate revision → atomic commit                                          |
| Semantic encoding  | Serializer edits can activate CM/Markdown across old/new, cleanup, or changed stack/precedence contexts                   | Contextual codec proves intended meaning and protects every causal reclassification                 |
| BOM/hash identity  | File BOM metadata, decoded source, runtime hashes, and parser/cache identity are not one frozen cross-platform contract   | Source-only leading-U+FEFF grammar plus framed Source/File/Semantic hash formats                    |
| Resource identity  | Limits count implementation-shaped parser artifacts, so refactoring can move the boundary                                 | Versioned abstract `BudgetEvent` algebra with literal traces and stable accounting ID               |
| Authored EOL       | Browser fields and structural planners can choose/normalize line endings independently                                    | One journaled nearest-owner EOL policy for every synthesized break                                  |
| Async/input        | Renderer-side mutation and parsing have no serialized ticket, pending-input, stale-result, or save/close barrier contract | Worker-owned session actor, exact retained drafts, ordered tickets, and atomic publication          |
| Track Changes      | Captures proposed state, serializes it, derives exact edits, reparses candidates, then replaces state                     | Decorates the ordinary source-native edit plan and proves projection laws                           |
| History            | `ot-json1` operations over a lossy block tree                                                                             | Canonical source transactions plus selections/drafts                                                |
| Selection          | DOM ranges and block paths are repeatedly reconciled and repaired                                                         | Revision/view model positions with one map                                                          |
| Hidden comments    | DOM content exists and caret exclusion is corrective selection logic                                                      | Hidden content has no editable view positions                                                       |
| Rendering          | Live blocks and static paths duplicate CM semantics and may reparse                                                       | Narrow `LiveRenderPlan` plus typed materializers                                                    |
| Original/Revised   | Project text, parse it back into mutable state, and switch authority-like trees                                           | Graph-derived read-only CSTs/views; no flattened-string syntax discovery                            |
| Comment relation   | Adjacency is promoted into ownership; current deletion code persists undocumented `{====}` in one edge                    | Independent syntax, derived UI context, residual survival, global hidden-Comment guard, no sentinel |
| Draft safety       | Compose/edit state is split across controller, store, and mounted Vue state; context changes can cancel it                | Session-owned pinned draft with proven rebase or retained rejection                                 |
| Commands/menus     | Bespoke facade calls and copied capability booleans allow label/type drift                                                | One typed intent and command-presentation model                                                     |
| Nested mouse hit   | Comment-always-wins prose conflicts with deepest-item hit tests; context menus return one opaque target                   | View-plan hit ancestry: deepest action target plus nearest containing Comment                       |
| Mouse access       | Sidebar rail works only when visible; native menu and in-progress UI patches do not yet prove a persistent in-window path | Always-visible pointer affordance plus real-pointer E2E from fully hidden state                     |
| Source mode        | Whole-string handoff between CodeMirror and WYSIWYG authorities                                                           | Authoritative session `SourceDraft` plus acknowledged deltas and a nonauthoritative mirror          |
| Durability         | No revision-atomic worker journal, ticket replay ledger, crash-safe compaction, or causal save generation                 | Versioned commit/outcome journal, recoverable compaction, exact leases, and per-target save CAS     |
| Consumer policy    | View/clipboard/search/count/export behavior is spread across callers and Comment treatment is implicit                    | Checked-in normative matrix consumed by typed materializers and command presentation                |
| Sinks/security     | Persistence, clipboard, static HTML, PDF, and print traverse different parse/render/sanitize paths                        | Typed materializers with sink brands; direct-source persistence                                     |
| Error model        | Exceptions, booleans, strings, `null`, silent no-ops, and swallowed prevented input coexist                               | Exhaustive committed/rejected/noop outcomes                                                         |
| Performance        | Final adapter has known quadratic scans and a prior >21-minute hostile case                                               | Indexed linear parse/planning and explicit budgets                                                  |
| Tests              | Strong corpus mixed with accidental behavior; architecture tests often scan filenames/helper names                        | Standard/profile/recovery corpora plus behavioral, property, differential, and boundary tests       |
| Gates              | Current final tree has historical evidence but outstanding lint/type/E2E/CI proof after later changes                     | Fresh final-tree automated evidence only                                                            |
| Documentation      | Spec facts, MarkText extensions, current behavior, and settled promises contradict each other                             | One profile, glossary, ADR set, architecture, and user docs that agree                              |

The clearest architectural alarms are concrete:

- `JSONState` owns `_state: TState[]` and merely caches parser analysis.
- `StateToMarkdown` reconstructs source and calls `weaveCriticSourceTrivia`.
- `CriticMarkupDocumentService` invokes `rebindCriticMarkupStateBindings` to transplant parser
  bindings onto a separately serialized live state.
- the mutation gateway captures state mutation and runs post-hoc comment-anchor normalization;
- Track Changes captures the proposed JSON state before it can know the source edit;
- `commentAnchorDeletion.ts` persists an empty Highlight as an invisible boundary even though the
  plans and architecture promise a bare Comment.
- `parser.spec.ts` currently requires exactly one top-level Substitution separator and rejects
  `{~~a~>b~>c~~}`, contrary to the official toolkit's first-separator behavior adopted by Profile 1.
- the current Track decorator has no grammar-safe representation for an edit inside an authenticated
  Markdown literal; placing CM bytes inside code, math, HTML, or a link destination merely writes
  inert text;
- logical resource counts and cache/source hashes are helper-shaped rather than versioned wire
  contracts, so a refactor or platform encoding can move an allegedly deterministic boundary;
- raw Comment editing and structure commands do not share a persisted EOL authoring decision, so
  mixed-line-ending source can change according to the UI control or retry path;
- Comment adjacency is modeled chiefly as Highlight ownership, so the semantic index does not expose
  the documented contextual Comment after Deletion (or the equally expressible Addition/Substitution
  cases).
- the explicitly legacy `specs/architecture/archive/criticmarkup-legacy-engine.md` record and release notes still describe
  serializer normalization, binding authority, and a depth-64 literal-render fallback as
  current-branch behavior. They are retained only as migration evidence; carrying any of those
  claims into the cutover would conflict with exact revision source and could expose a deeply nested
  Comment body as prose.
- Existing corpora contain valuable nesting examples but no complete executable parent×child×arm
  projection matrix, so several asserted recursive semantics are implementation accidents rather
  than frozen language behavior.
- passive Comment selection and deepest nested Review targeting are both asserted, but the
  one-target context-menu protocol cannot preserve nested change commands while also reaching the
  containing Comment by mouse.

Those are not isolated bugs. They are evidence that the current authority cannot express the
required invariants locally.

## What is retained and what is deleted

### Retain as requirements or migration assets

- CommonMark/GFM and MarkText-extension conformance fixtures;
- the useful portions of the existing CM corpus after classification;
- user-facing Review/sidebar/menu/context-menu behavior;
- localization strings after command-presentation consolidation;
- sanitization policies and hostile sink fixtures;
- packaged-app, PDF/print, and platform test harnesses;
- proven source/view examples and property generators;
- existing parser implementations only as differential oracles during migration.

### Delete before cutover is complete

- CriticMarkup binding graphs and all rebinding;
- `CriticMarkupDocumentService` in its present form;
- the separate `CriticMarkupAnalysis`/excluded-range sidecar architecture;
- any document-core entry point in which a top-level CM parser or CM state machine owns source
  progression and merely consults a Markdown checkpoint/lane;
- any canonical CM-only scanner/forest builder, Markdown-literal prepass, or completed Markdown parse
  whose results are later joined to manufacture the authoritative graph;
- canonical, Original, Revised, or Comment CST construction from flattened projected strings;
- post-hoc ownership, delimiter, arm-boundary, topology, or reference-resolution inference, including
  forest-to-graph reconstruction and projector-only semantic repair;
- Marked token-graph authority, source-provenance ledger, native CM extension, fork patch/manifest
  machinery once no non-CM consumer requires the fork;
- Critic-specific `sourceTrivia` and marker weaving;
- state→Markdown reconstruction as the persistence path;
- JSON mutation capture and post-mutation source inference;
- comment-anchor post-mutation normalization and the empty-Highlight sentinel;
- per-block CM reparsing and renderer-owned marker semantics;
- projection→text→mutable-state reparsing;
- `ot-json1` as canonical document history;
- DOM/block-path selection as model authority;
- bespoke Review command facades and copied menu capability states;
- whole-string source-mode authority handoff.

Deletion is a gate, not optional cleanup. Leaving the legacy path callable would preserve two
authorities and invalidate the new architecture. Recreating any forbidden pattern inside
`@marktext/document-core` under a new filename also fails this gate.

### Machine-checked deletion manifest

Phase 0 checks in `specs/migration/criticmarkup-legacy-deletion.tsv`. Each row contains `id`, exact
`path`, exported `symbol`, current production callers, replacement owner, phase when new-engine use
becomes forbidden, physical-delete phase, and verification command. Schema validation rejects globs,
blank caller fields, or a path/symbol that no longer resolves. A reference scanner fails CI when it
finds an undocumented production caller; Phase 9 requires zero callers and zero rows not marked
physically deleted.

The seed inventory is:

| ID  | Exact path and symbol                                                                                                 | Current production callers                                                                                                                                                                                                                               | Replacement owner                                | Unreachable / delete         |
| --- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------- |
| L01 | `packages/muya/src/state/rebindCriticMarkupStateBindings.ts` — `rebindCriticMarkupStateBindings`                      | `packages/muya/src/criticMarkup/documentService.ts`                                                                                                                                                                                                      | parser-created revision provenance               | P2 / P9                      |
| L02 | `packages/muya/src/state/criticMarkupSerialization.ts` — `weaveCriticSourceTrivia`                                    | `packages/muya/src/state/stateToMarkdown.ts`                                                                                                                                                                                                             | lossless token tape; direct revision persistence | P1 / P9                      |
| L03 | `packages/muya/src/state/mutationCapture.ts` — `StateMutationCapture`                                                 | `packages/muya/src/state/index.ts`; `packages/muya/src/mutation/trackedCriticMarkup.ts`; `packages/muya/src/mutation/operationSourceEdits.ts`                                                                                                            | `TransformationKernel`                           | P4–P7 by command family / P9 |
| L04 | `packages/muya/src/mutation/commentAnchorDeletion.ts` — `normalizeDeletedCommentAnchors`                              | `packages/muya/src/mutation/gateway.ts`                                                                                                                                                                                                                  | source-native deletion postcondition             | P3 / P9                      |
| L05 | `packages/muya/src/criticMarkup/documentService.ts` — `CriticMarkupDocumentService`                                   | `packages/muya/src/editor/index.ts`                                                                                                                                                                                                                      | `DocumentSession`                                | P4–P8 by consumer / P9       |
| L06 | `packages/muya/src/utils/marked/criticMarkupDocument.ts` — `parseCriticMarkupDocument`, `projectCriticMarkupMarkdown` | `packages/muya/src/utils/marked/lexBlock.ts`; `packages/muya/src/criticMarkup/documentService.ts`; `packages/muya/src/clipboard/copyData.ts`; `packages/muya/src/utils/marked/getClipboardHtml.ts`; `packages/muya/src/utils/marked/getHighlightHtml.ts` | `LanguageEngine` and typed materializers         | P2/P6 / P9                   |
| L07 | `packages/muya/src/utils/marked/extensions/nativeCriticMarkup.ts` — native CM extension exports                       | `packages/muya/src/utils/marked/lexBlock.ts`; `packages/muya/src/utils/marked/extensions/criticMarkupDocument.ts`                                                                                                                                        | native CM forest and `LiveRenderPlan`            | P2/P4 / P9                   |
| L08 | `packages/muya/src/history/index.ts` — JSON-operation history                                                         | `packages/muya/src/editor/index.ts`; `packages/muya/src/state/index.ts`                                                                                                                                                                                  | session source-transaction history               | P4–P7 by command family / P9 |

This table is intentionally a seed, not a claim that eight rows exhaust the branch. Phase 0 expands
it to every path named in the deletion list and records all test-only callers separately so obsolete
tests cannot keep dead production architecture alive.

## Red-green migration plan

Approval of this plan in Roughdraft confirms the public seams and behavioral contracts before the
first production test is written. If implementation discovers that a confirmed public interface must
change materially, update this plan and obtain review again before encoding the new interface in
tests.

Every production capability follows one strict red-green slice:

1. select one confirmed public behavior and write one test with literal expected input/output;

2. run that test and retain the failure proving the capability is absent for the expected reason;

3. add only enough production behavior to make that one test pass;

4. rerun the narrow test and its already-green regression set;

5. record the slice green before selecting the next row.

The **Red** lists below are ordered queues, not permission to land a batch of failing tests. A
second test does not go red until the prior test is green. Refactoring is a separate review after a
coherent green slice; it begins and ends with the suite green and is not smuggled into the
capability cycle. Test expectations cannot be generated by the parser, serializer, mapper,
materializer, or renderer under test.

### Authority transition rule

Two kinds of coexistence are permitted:

- the legacy app remains sole authority while the new engine runs in tests or as a read-only shadow
  whose result cannot affect UI, history, save, or error recovery;
- a document is opened under the new `DocumentSession`, which is then its sole authority while
  remaining UI adapters are migrated.

Dual writes are forbidden. The app may not apply an edit to both authorities, rebuild either
authority from the other after every command, fall back to a legacy mutation after rejection, or
choose authority independently per command.

For a migrated slice, its legacy write entry point becomes unreachable for new-engine documents
immediately and a runtime spy proves that fact. Physical deletion occurs only when its last
legacy-document caller is gone in Phase 9.

### Phase 0 — make CriticMarkup intrinsic to the Markdown parser (blocking P0)

This is the foundation for every later phase. The previously completed Addition/session/browser
walking slices remain useful transport evidence, but they do not define or satisfy this gate. No
projection, Review, transformation, session, rendering, sidebar, or persistence implementation may
be credited toward plan completion until its language inputs come from this parser artifact.

**Red**

- First, take the upstream bad/good emphasis pair red: an outside opener cannot match an arm-local
  closer, while complete emphasis inside either arm remains active. The unsafe Original/Revised join
  receives prefix-minimal generated Markdown protection with exact provenance. Then take one
  self-contained boundary row red at a time for both directions and both arms: an arm-local or
  outside inline-code, emphasis, math, fence, link, or container boundary cannot match across the
  arm; incomplete arm-local state recovers at the boundary and cannot make a following CM sibling
  literal or change its source owner. Definitions created in an arm remain arm-scoped. Sequential
  and nested Substitutions prove recursive arm selection and boundary isolation without carrying
  arm-local matching state into later source.
- Next, public semantic tests plus the package-private `ProfileParseTraceV1` architecture observer
  prove that CM nodes are native nodes/events in the canonical Profile 1 Markdown graph, not a
  forest woven into a completed Markdown parse. Exact parser-created identity must be shared by the
  canonical graph and every applicable derived CM, ownership, projection, reference, and diagnostic
  record; generated or rejected records carry explicit source/event/projection provenance instead.
  The versioned parser-trace/dependency gate proves one canonical source admission, native CM
  grammar events, and zero authoritative `parse-projected-markdown`, `parse-comment-string`, CM-only
  scan, forest reconstruction, or post-hoc ownership/reference events. Tests enter through
  `LanguageEngine.open`; internal trace assertions are supplementary, never the sole semantic proof.
- Keep the existing engine test that opens literal `{++new++}` and expects exact source, one
  Addition with literal half-open ranges, Original `''`, Revised `'new'`, and provenance for every
  projected code unit as the smallest diagnostic slice.
- After the intrinsic parser proof is green, keep the session test that dispatches a plain-text
  insertion, observes one revision-changed descriptor, undoes it, and recovers exact source through
  its lease plus the mapped selection. Kernel tests inspect the full `RevisionTransition` proof
  inside the worker package.
- After that is green, keep the real-browser walking tracer that opens literal `a{++new++}b`, mounts
  its session plan, sends a real `beforeinput` insertion, observes only committed DOM and mapped
  caret, undoes to the exact opening source, redoes to the exact changed source, and saves those
  revision bytes through a temporary `FileSnapshot`.
- Finally, import and runtime-boundary tests prevent core from importing Muya, Marked, DOM, Vue,
  Pinia, or Electron and prevent projection/materializer modules from importing parser entry points
  or accepting raw source as a syntax-discovery input.

**Green**

- Replace the CM-first facade with an intrinsic Profile 1 Markdown parser kernel. The Markdown
  parser owns source progression; CM forms are its grammar productions. One retained atomic lossless
  graph owns source tape, block/container events, inline delimiters, literal ownership,
  definitions/references, CM arms, arm-local fragment boundaries, diagnostics, and resource events.
- Make the CM forest, ownership index, canonical/Original/Revised/Comment CSTs, provenance maps, and
  Review indexes pure derivations of that graph. Projection selection may not invoke a parser to
  create its CST. A separate clean verifier may reject a mismatch but contributes no product data.
- Physically delete the current top-level `parseCriticMarkup` authority, CM-first
  checkpoint/lane/`rejoinCarrier` scaffolding, flattened projection-to-`parseMarkdownDocument` construction, and
  post-hoc ownership/reference joins. Moving those behaviors behind another facade is not green.
- Retain `@marktext/document-core`, immutable revision, profile identity, minimal asynchronous
  `DocumentSessionClient`/`SessionCoordinator`/ `RevisionWorker`, one-ticket checksummed journal
  commit, transition, `LiveRenderPlan`, browser adapter, and file adapter only as downstream
  consumers needed by the walking tests—no broader session batching, crash recovery, or optimization
  yet.
- Split fixture manifests into `CM_STANDARD`, `MARKTEXT_PROFILE_1`, and `MALFORMED_RECOVERY`, plus
  reference-projection rows. Inventory exact-source, recursive-matrix, comment-context,
  independent-node, no-sentinel, comment-metadata, contribution-atom, Comment-fold,
  contextual-codec, malformed-diagnostic, literal-boundary, production-readiness, and Comment UX
  rows without enabling them in bulk.
- Transcribe the normative table above into the checked-in consumer-policy matrix; also check in the
  file-backed corpus matrix, legacy deletion manifest, `syntax-accounting-1.yml` event algebra/known
  traces, hash and `wire-envelope-v1.yml` known-answer vectors, authoring-EOL vectors, and
  test-disposition ledger with schema validation.
- Record every old test's disposition; delete or rewrite tests that require accidental topology,
  source normalization, sentinel behavior, or private helper names.

**Exit**

- All intrinsic-parser public reds pass, including self-contained Substitution-arm boundaries and
  arm-scoped references. A clean parse trace proves that canonical and applicable derived
  records share parser-created identity, generated/rejected records carry explicit source/event/projection
  provenance, and no forbidden sidecar/reparse path ran.
- The P0 CM-index, canonical/Original/Revised CST, ownership, reference, diagnostic, and one
  representative Comment-view slice are derived from the retained graph. Phases 1 and 2 broaden
  grammar and product coverage without changing that direction. Removing the independent verifier
  must not change any published P0 product.
- No CM-first parser, separate Markdown-literal scan, forest-to-graph synthesis, flattened
  authoritative projection parse, or post-hoc ownership/reference join remains callable in
  document-core or reachable by a new-engine document. A legacy-only parser may remain behind the
  authority-transition boundary and exact deletion manifest until Phase 9; it cannot feed, verify,
  repair, or fall back from the new engine.
- No Addition-only parser, projector, live-plan role, or authoring special case remains callable in
  document-core or the application. All five CM forms share generic parser and command paths.
- The one browser tracer proves an Addition travels source → revision → session → live DOM → edit →
  undo/redo → exact file save without mutable-state or serializer authority; the smaller tests are
  its diagnostic scaffolding, not a substitute.
- The profile is documented once; glossary, ADRs, architecture, plans, and corpus expectations
  contain no known contradiction.
- Every row in this plan's product acceptance mapping maps to a named automated target test.

Phase 0 cannot exit on facade-level output equivalence. It exits only when the intrinsic-parser
architecture and its deletion gates are both proven. Later phases may stage future acceptance tests
as reds, but implementation of downstream CM features remains blocked on this exit.

**Implementation ledger**

The checked entries below are historical narrow slices, not endorsements of their implementation
direction. In particular, every tranche described as a CM tape/state machine consuming source while
consulting a Markdown lane/checkpoint is target-incompatible scaffolding. It must be inverted or
replaced so the intrinsic Markdown parser owns source progression and emits CM productions. No
checked slice counts toward the blocking intrinsic-parser exit merely because its public output is
useful or green.

- [x] 2026-07-19 — first engine slice: public `LanguageEngine.open` opened `{++new++}` into one
      immutable Addition with exact source/ranges, Original `''`, Revised `'new'`, and canonical origin
      for all three projected UTF-16 code units. RED was
      `vitest run test/language-engine/open-addition.spec.ts --maxWorkers=1` exiting 1 at the explicit
      `LanguageEngine.open is not implemented` seam. GREEN was the same test with 1/1 passing, plus
      production/test typecheck, package lint, and declaration build. The implementation is deliberately
      limited to the Addition walking slice; the other four forms, Markdown literal precedence,
      escapes, malformed promotion, boundary protection, budget behavior, and the complete Markdown
      CST remain later reds. Until those turn green, the package is a test-only tracer with no product
      caller; its provisional `complete` result must not be treated as Profile 1 conformance or wired to
      editor, rendering, persistence, or export authority.
- [x] 2026-07-21 — session/transition slice: sequential focused reds established synchronous intent
      snapshotting, admission-before-observation, cross-session selection authentication, explicit
      no-op/rejection frontiers, retained stale input with a blocking causal flush, immutable
      `RevisionTransition` edits/inverses/maps/node survival, Markup-view source mapping, insertion
      caret affinity, undo, redo, and the separate `preparePersistence('save' | 'autosave')` barrier.
      Adversarial reds additionally caught and fixed reversed previous-affinity typing, composition
      across merely equal revision text, repeated-text edit relocation, reversed/non-split range maps,
      and false node survival after carrier promotion. GREEN was
      `pnpm -C packages/document-core check`: lint and both typechecks passed, 16 test files/22 tests
      passed, and declaration/runtime build passed. This proves only one same-thread, single-edit
      process-lifetime tracer. The journal is volatile; worker transport, batching/rebase, durable
      recovery, Retry/Discard, full range-map algebra, and crash-safe pending input remain unproved.
- [x] 2026-07-21 — browser/package walking slice: the Chromium test first failed because the tracer
      had no trusted-`beforeinput` interception, then because undo/redo had no browser controller, and
      finally because save was absent. Its greens prove `a{++new++}b` mounts as committed plan text
      `anewb` with one `<ins>`, a trusted insertion is prevented while the opening revision/DOM pair is
      still mounted, the committed result is `anewb!` with mapped caret 6, undo/redo mount four distinct
      committed revision/text generations, and save after each history state writes the exact canonical
      UTF-8 bytes through a released `preparePersistence('save')` lease. A post-green adversarial pass
      then took separate reds for an editor-container caret whose prevented byte was lost before
      dispatch, an empty plan whose caret could not mount, an unobservable lease release, a runtime
      adapter carrying host-only capabilities, the absent focused TypeScript CI gate, and the absent
      explicit forbidden-dependency policy. The configured one-worker Chromium command now passes 2/2:
      the walking row uses an independent `MutationObserver` to reject torn revision/text pairs and
      asserts four distinct revision IDs, while the diagnostic row proves empty-plan mounting. The
      adapter rejects host-only source capabilities at runtime, container/boundary positions are mapped
      from the immutable plan rather than mutable DOM metadata, and the browser row directly observes
      each lease release. A separate clean-copy pack test initially failed because the package had no
      clean-pack build lifecycle; after the narrow `prepack` fix it built and installed an isolated
      tarball, passed public runtime/type imports, and rejected private runtime/type deep imports. The
      dependency policy fixes runtime/peer/optional dependencies to empty, fixes the ambient library to
      ES2022 without DOM, and names Muya, Marked, Vue, Pinia, and Electron as forbidden; both boundary
      tests pass (2/2). A focused strict browser typecheck and actionlint pass. A targeted CI workflow is
      checked in; no hosted CI run is claimed here. The browser page and
      `TemporaryUtf8FileSnapshot` are test-only adapters, not product authority or Phase 6 persistence;
      they prove UTF-8/no-BOM bytes only. Host and adapter still share one browser thread, and an input
      that cannot be translated from a corrupted/outside-plan DOM is retained only as a tracer
      diagnostic, not a durable session draft. No Muya or desktop production caller imports the package.
- [x] 2026-07-21 — focused Profile 1 parser tranche, not Profile 1 closure: public-seam reds were
      taken separately for Deletion, Substitution, Highlight, Comment, complete empty forms and empty
      Substitution arms, same/mixed nesting, the 35-cell parent-carrier × child-form projection matrix,
      protective escapes/separators, selected malformed promotion/diagnostics, resource limits, and
      generic Markup output. Follow-on reds closed the then-known literal defects for escaped/invalid
      inline HTML, malformed inline links and reference definitions, quote/list/nested-list fences,
      type-7 HTML, virtual BOM/BOF, constructed math across CM carriers, Comment-local literals, and
      root Substitution arms with independent front matter and fences. The exact precedence row
      ``{++`x ++} y` z++}`` is intentionally **not** a later-closer case: once the outer Addition is
      active, its compatible closer wins over a containing-arm literal, as Rule 6 requires. Guard reds
      for `{~~{=={~~>~~}==}~~}`, `{++{++++}~~~{>>++}`, and `{--x--}{++~~~}` now return total,
      source-idempotent protected projections. Markup is a discontinuous source-mapped run tape, so a
      Comment gap or Substitution alternative cannot be reparsed as one synthetic Markdown string.
      A later public red put a root Substitution after a list marker and fenced both arms; the former
      parser exposed nested CM because it inherited only Boolean BOF/BOL flags. Accepted CM markers now
      advance no Markdown text state, literal-owned marker bytes do, and each Substitution arm forks the
      same persistent current-line checkpoint plus exact positional BOF classification. Both
      list-contained fence alternatives are green, while a second red proves an empty preceding root CM
      sibling does not grant document BOF/front-matter status to the next carrier.
      Desktop limits now prove decoded source units, accepted rather than provisional CM depth, and
      Markdown depth over canonical, Original, Revised, and each Comment-display lane. Configuration
      validation rejects every unsupported identifier. Production Addition-specific parser/projector
      files and the Addition-only live-plan role were deleted; a clean-before-build/pack regression also
      proves stale `dist/internal/additionParser.*` cannot leak into the package. These are real
      red-green closures, but they still sit on a CM tape plus a deliberately incomplete Markdown
      event lane, not the single manifest-driven Markdown+CM graph required below.
- [x] 2026-07-21 — first atomic-graph proof tranche, not P0 closure: separate public-seam reds now
      prove a gapless canonical ownership partition, Markdown-literal authority inside a CM arm,
      distinct Original/Revised Markdown trees, projection-specific block structure, multiple blocks
      inside one carrier, a fenced-code decision shared by CM recognition and the mapped CST, inline
      emphasis crossing zero-width CM markers, and inherited list/fence summaries in both Substitution
      arms. The implementation retains one lossless source tape with stable candidate-run identities;
      accepted CM markers reference those exact runs; inactive candidates remain Markdown-owned; and
      the retained graph owns marker decisions, a typed canonical arm topology, mapped projection
      tapes, Original/Revised CSTs, and Comment-display lanes. Projection construction walks that graph
      rather than independently walking the public CM forest. Projection CST materialization still
      invokes the shared Markdown grammar over flattened projected source strings assembled from that
      graph, and the canonical lane
      topology is not itself a full Markdown CST, so the atomic-graph P0 row remains unchecked.
- [x] 2026-07-21 — canonical Markdown-owner authority consolidation, not P0 closure: the old
      root/per-arm literal scanners, batch fence/front-matter/HTML/definition helpers, and retained
      Addition-only compatibility paths were deleted. One persistent Markdown checkpoint now decides
      canonical literal ownership while the CM state machine consumes the lossless source tape. Public
      red-green cases added retained quote/list container identity for fences and HTML blocks, correct
      CommonMark type-1/type-4/type-5 HTML boundaries, link-versus-image delimiter behavior, multiline
      reference destinations/titles, CRLF coalescing across accepted zero-width CM, and open-paragraph
      interruption for indented code. Carrier rejoin policy and marker ownership/protection queries now
      live behind the Markdown-lane seam rather than a field-by-field checkpoint reconstruction in the
      CM parser. Follow-on reds made container-depth failure a retained result of that same lane run,
      moved projected-delimiter authorization into parser-emitted delimiter events, retained overlapping
      marker candidates instead of losing them to a greedy tape scan, and added reference-link resolution.
      Reference-definition collection is not yet arm-scoped across mutually exclusive Substitution arms.
      Focused language verification is 18 files/167 tests. This establishes one canonical but incomplete
      authority; it does not complete CommonMark/GFM/MarkText grammar, the canonical CST, deterministic
      accounting/guard manifests, or mapped Comment and Review products.

- [x] 2026-07-21 — projected Markdown product tranche, not Profile 1 closure: public-seam reds now prove
      CM-carrier-assembled setext headings, hard/soft breaks, GFM strikethrough, tables with alignment,
      reference links, thematic breaks, images, footnote references/definitions, diagram blocks, and
      fenced math blocks in addition to the earlier heading/list/blockquote/emphasis/link/code slices.
      A carrier-rejoin regression also proves that a fence closing exactly at a CM boundary cannot reopen
      on the parent lane and swallow the next CM sibling. These greens broaden one shared grammar; they do
      not establish full CommonMark/GFM/MarkText conformance, an ordered block-container stack, the full
      delimiter-run algorithm, canonical-CST construction, or arm-scoped definition resolution.

- [x] 2026-07-21 — arm-scoped reference-definition tranche, not canonical-CST closure: the former
      global definition union was proven to let an old Substitution arm change delimiter ownership in
      its mutually exclusive new arm. A parser-owned definition index now records document scope and
      compatible Substitution-arm constraints and resolves labels using the occurrence's source scope.
      Public-seam tests cover old/new isolation in both directions, root/Comment isolation in both
      directions, same-Comment forward resolution, and compatible root-to-arm inheritance. Resolution
      edges are not yet retained in the syntax graph, so projected CSTs still rediscover definitions.

- [x] 2026-07-21 — ordered-container authentication tranche, not ordered-CST closure: a public red proved
      that the old list-first/quote-depth summary lost `blockquote → list-item` ordering and authenticated
      CM inside a continued fenced-code literal. The Markdown checkpoint and block-literal continuation
      matcher now use an outermost-to-innermost persistent container path with relative list indentation;
      that parser-core red and the focused literal/resource suite are green. The projected block builder
      now consumes those ordered parser facts through one generic path assembler; the separate
      `parseList`/`parseBlockquote` recognizers were deleted, and public CST cases prove list→quote→list,
      quote→list and list→quote in independent Substitution arms, and a same-line nested list.

- [x] 2026-07-21 — delimiter-run and projection-dependency tranche, not canonical-CST closure: the
      projected Markdown grammar no longer uses greedy `findInlineCloser` searches. One iterative
      delimiter stack now tokenizes maximal `*`, `_`, and GFM `~` runs, computes Unicode flanking,
      applies the modulo-three rule and bounded opener bottoms, and treats code/HTML/autolink/link/math
      nodes as atomic. File-backed public-seam conformance covers all 132 CommonMark 0.31.2
      emphasis/strong examples and all three GFM 0.29 strikethrough examples; nine CM cases cover arm
      flanking, carrier-assembled maximal runs, underscores, opener selection, literal/link boundaries,
      multiline list continuations, and GFM one/triple tilde behavior. A separate BOL-dependency red
      proved that projection incorrectly pre-authorized a canonical definition range after eliding the
      EOL that established it. Guard and clean verification now run the exact candidate without mapped
      literal-range authorization; they protect the newly active CM and remain source-idempotent. This
      deletes the projection-time literal-range join, but canonical branch delimiter events and a full
      canonical Markdown CST are still not retained. Current language verification is 20 files/324 tests.

- [x] 2026-07-21 — parser-owned canonical-lane evidence tranche, not canonical-CST closure: the
      Profile parser now records immutable lane entry/exit checkpoints, exact tape-backed consumed
      slices, operation identity, emitted literal facts, and block-state summaries while it performs
      each advance, boundary release, lane finish, carrier rejoin, and malformed recovery. The syntax
      graph requires that artifact and rejects forest/artifact lane or branch divergence; it no longer
      synthesizes lane topology by walking CM ranges after parsing. This is a retained execution trace,
      not a Markdown CST: it does not retain block/inline node decisions, delimiter-run events,
      reference-resolution edges, or intrinsic arm-boundary events, and projected CSTs still
      come from another grammar run over flattened projected text.

- [x] 2026-07-21 — bounded CommonMark lazy-continuation tranche, not full block closure: public-seam
      reds now retain unmarked/unindented paragraph continuation text inside blockquotes, list items,
      and mixed nested quote/list paths in both Substitution arms. Interrupting headings, thematic
      breaks, and lists still close the inherited path; a noninterrupting ordered marker remains text;
      and the setext-looking line after an already-lazy line follows CommonMark 0.31.2 behavior. These
      eight cases remove the previously named absence of lazy continuation, but they are not the full
      CommonMark/GFM block corpus or a replacement for retained canonical block-tree events.

- [ ] 2026-07-21 — self-contained Substitution-arm conformance (blocking P0 queue; architecture and
      block-container slices remain):
      upstream evidence does not define arm-conditioned host-Markdown parsing and advises complete
      Markdown tags inside each alternative. Profile 1 therefore gives every following source unit
      one canonical owner: incomplete matching state created inside an old or new arm recovers at
      the arm boundary and cannot make a later CM sibling literal. The former three failing
      branch-conditioned expectations are being replaced one red-green slice at a time by a public
      arm-boundary conformance corpus. The upstream bad/good emphasis pair is green: parser-owned
      Substitution-arm enter/exit events map into selected projection scopes; a root opener cannot
      match an arm-local closer; the unsafe join receives prefix-minimal generated `\*` protection
      with canonical provenance; and complete emphasis in either arm remains active and unprotected.
      The inline-code slice is also green: scope-aware backtick matching protects a new-arm
      opener from a later closer, independently reopening the protected projection is source-idempotent
      literal text, and pairs wholly inside an arm or wholly outside the Substitution remain code.
      When preserving an enclosing code span requires more than an escape, the projection codec
      lengthens both retained backtick runs above the longest interior run and records generated
      causal provenance without replacing either canonical run. Inline math has the corresponding
      containment, clean-reopen, and arm-local-dollar protection. Link labels, inline destinations,
      images assembled across a boundary, pending destinations, arm-scoped definitions and following
      references, and one-protection retargeting all have public semantic plus clean-reopen coverage.
      Enclosing emphasis is deterministically respelled when an arm-local pair would steal its closer;
      if the alternate marker would be intraword, the codec entity-encodes the minimum adjacent Unicode
      scalars and retains exact generated provenance. (Corrected 2026-07-22: the "green at 382/382"
      count recorded here was stale and unpinned — at audit the suite was 398 passing with one failing
      spec. Ledger rows must cite the verification command, not a remembered count.) The current ordered red is fenced-block fragment termination, followed by quote/list
      container termination. Choosing an arm never changes parsing after the closer, but this does not
      close P0: the Markdown parser must still own source progression, emit native CM and arm-boundary
      events, and derive all public products without the current CM-first facade. See ADR-0010 and
      `specs/architecture/criticmarkup-host-markdown-interaction-evidence.md`.

- [x] 2026-07-22 — architecture gate made executable (instrument only; the gap it measures is
      unchanged): `ProfileParseTraceV1` was a stub recording one event kind
      (`projection-planning-range-visit` / `inline-code-extension-analysis`) and could not observe any
      fact Phase 0 Red names, so nine tranches grew the target-incompatible owner while the suite
      stayed green. It now records canonical-source admission, source-progression ownership
      (`criticmarkup-driver` vs `markdown-kernel`), authoritative-CST input (`canonical-source` vs
      `flattened-projection`), post-hoc joins (`reference-definitions`, `source-ownership`,
      `matching-scopes`), and canonical reparse. All recording is through optional calls, so a
      document opened without a capture is byte-for-byte unaffected.
      `test/language-engine/architecture-gate.spec.ts` asserts the Phase 0 exit conditions directly.
      For CriticMarkup documents the three BLOCKING rows — a CM state machine owns progression,
      authoritative CSTs come from flattened projections, ownership facts are joined post hoc — are
      pinned with `it.fails` and will start failing *because they pass* when the intrinsic kernel
      lands, which is the signal to delete the `.fails`.

- [x] 2026-07-22 — intrinsic-kernel beachhead for CriticMarkup-free documents (first real ownership
      inversion; the CriticMarkup path is unchanged): the architecture gate's two CriticMarkup-free
      rows were taken RED and are now GREEN by construction, not by relabelling.
      `parseMarkdownOnlyPass` hands canonical source straight to the Profile 1 Markdown lane for any
      source containing none of the ten CriticMarkup marker tokens. On that path no marker scan drives
      the loop, no parse frame or marker decision is created, `parseCriticMarkup` never runs, and the
      lane consumes the canonical tape's Markdown-text runs directly — the Markdown parser owns source
      progression. The marker prefilter is a necessary condition only, so it cannot produce a false
      negative: a marker token cannot be recognized without appearing literally in the source.
      Projection now records its CST input truthfully: `canonical-source` when the guarded candidate is
      byte-identical to canonical source (offsets map 1:1, so the identity objection does not arise),
      `flattened-projection` otherwise — the condition is byte equality, not the absence of
      CriticMarkup, so a projection that elides or generates even one code unit is still recorded as a
      flattened reparse. The post-hoc `matching-scopes` join is likewise recorded only when arm scopes
      actually exist. Side effect: the CriticMarkup-free Markdown container-depth budget row went green,
      because the kernel path emits the public `CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED` code.
      Verify with `pnpm -C packages/document-core exec vitest run
      test/language-engine/architecture-gate.spec.ts` (5 passed, 3 expected-fail). Boundary: this
      inverts ownership only for documents that need no CriticMarkup grammar. Every document
      containing CriticMarkup still runs the CM-first driver, still builds its CSTs from flattened
      projections, and still joins ownership and references post hoc — the three `it.fails` rows.
      Extending the kernel to CriticMarkup documents requires `markdownParser.ts` to emit CM
      productions and lane events itself, which is the remaining Phase 0 work.

#### Profile 1 parser as-built and remaining gap ledger (2026-07-21)

This ledger replaces the now-stale Addition-only snapshot. The implementation has moved materially:
one private Profile 1 facade recognizes all five CM forms, produces generic recursive projections and
Markup runs, reports selected syntax/resource diagnostics, and no tracked production path preserves an
Addition-only parser, projector, or live-render role. That work is real, but its parser ownership is
backward: a CM-driven facade owns source progression and consults an incomplete Markdown event lane.
That is target-incompatible scaffolding, not an early form of the intrinsic parser. The graph and
several public products are assembled post hoc, flattened projections are parsed again to create
Markdown CSTs, and the public revision lacks the complete mapped Markdown and Comment products that
make one authority enforceable.

The rows below distinguish a completed focused slice from the broader obligation. A checked row means
the named, deliberately narrow behavior has a public-seam red-green test; it must not be read as
conformance for a broader unchecked row. Semantic tests enter through
`LanguageEngine.open(SourceSnapshot, ParseConfiguration)`. The package-owned `ProfileParseTraceV1`
test-support observer is the designated architecture-proof seam; it cannot supply semantic results or
alter parsing. Two qualifications, corrected 2026-07-22: architecture-gate specs may import
`ProfileParseTraceV1` itself, and `canonical-lane-artifact.spec.ts` /
`projection-clean-verifier.spec.ts` currently import parser internals directly — those imports are a
known violation to retire as the trace gate takes over their assertions, not a sanctioned pattern.
`ProfileParseTraceV1` did not observe any Phase 0 Red architectural fact until the 2026-07-22
architecture-gate work; earlier rows citing it as architecture proof were overclaims.

| Status | As-built obligation or remaining closure | Evidence and honest boundary |
| --- | --- | --- |
| [x] | Exact canonical source and immutable public revision seam | Focused opens retain the exact decoded UTF-16 string, immutable typed CM records, projections, diagnostics, and public provenance queries. This proves the seam, not the complete atomic graph. |
| [x] | Basic syntax for all five standard forms | Separate public fixtures prove Addition, Deletion, Substitution, Highlight, and Comment with exact whole/marker/arm ranges and their basic Original/Revised behavior. This does not cover every delimiter/literal boundary. |
| [x] | Complete empty forms and empty Substitution arms | Focused fixtures prove all complete empty unary forms plus empty-old, empty-new, and both-empty Substitution arms as syntax. |
| [x] | Focused mixed nesting and recursive projection matrix | Same/mixed nesting, nested Comments, arm assignment, Comment elision from the two main projections, canonical provenance for retained units, and the 35-cell parent-carrier × child-form matrix are green. Mapped Comment display/folding products remain absent. |
| [x] | Narrow protective-escape and Substitution-separator slice | Focused fixtures prove odd/even opener protection, first active top-level `~>`, a protected separator falling through to a later active separator, a code-owned separator, exact closer adjacency, and independent BOF front-matter/fence arms. The full provider-boundary matrix is not green. |
| [x] | Narrow malformed-recovery slice | Focused fixtures prove the two specified descendant promotions, the unmatched closer family, selected non-top/unterminated diagnostics, stable ordering, and source losslessness. This is not the independent `MALFORMED_RECOVERY` corpus or a totality proof. |
| [x] | Generic document-core CM products; no Addition-only compatibility layer in the new core | The Addition-specific parser/projector files and live-plan role are gone. Generic marks drive the dedicated Markup artifact and downstream tracer. Build and prepack clean `dist` first, and the packed-consumer test seeds a stale `additionParser.js` then proves it is absent from the installed tarball. Fixture names may describe Addition examples; production semantics may not special-case them. This claim is deliberately limited to the new core: legacy Muya still uniquely permits collapsed-caret Addition and manufactures `{++++}`; that obsolete authoring path must be removed during typed-intent migration. |
| [ ] | One canonical Profile 1 Markdown graph with native CM productions | A retained source tape now partitions exact source into stable BOM/EOL/text/marker-candidate runs; accepted CM nodes retain edges to the exact marker runs; semantic ownership is gapless; and one immutable graph owns marker decisions, the CM forest, typed arm topology, mapped projection tapes, Original/Revised CSTs, and internal Comment arms. Parser-owned lane evidence now retains checkpoints, exact consumed tape slices, operation identity, emitted literal facts, and block summaries, and graph construction rejects divergence from that artifact instead of rebuilding topology solely from the forest. Original/Revised construction walks the graph. This is still not the required intrinsic graph: the CM facade rather than the Markdown parser owns source progression; the artifact is an execution trace rather than a canonical Profile 1 CST; projection CSTs are materialized by another grammar run over flattened strings; and provenance/ownership/reference facts are partly joined post hoc. The forest must become a derived index over parser-created CM nodes. This row therefore remains unchecked. |
| [ ] | Integrated Markdown/CM state, precedence, and self-contained arm parsing | Targeted greens now cover inline code; backtick/tilde fences; an ordered persistent quote/list-item path for literal continuation and heterogeneous projected CST assembly; bounded CommonMark lazy paragraph continuation through quote/list paths; indented-code paragraph interruption; all currently supported raw/type-7/inline HTML boundaries; autolinks; link/image destinations and titles; multiline definitions and arm-scoped resolved reference links; YAML front matter; math/diagram providers; virtual BOM; zero-width CRLF; Comment/CM arm lanes; and the complete pinned CommonMark 0.31.2 emphasis/strong plus GFM 0.29 strikethrough example sets. One persistent checkpoint currently decides canonical literal ownership within the selected CM-driven lane, while a separate projected delimiter stack handles maximal runs, Unicode flanking, modulo-three matching, literal/link boundaries, and multiline container paragraphs. That split is not the target. The intrinsic Markdown parser must decide CM activity and Markdown ownership together, emit explicit arm-entry/termination events, contain matching state created inside each arm, and resume one unchanged enclosing state for the suffix. Canonical block/inline events, graph-retained reference edges, complete provider indexes, the remaining production manifests, and the generated boundary matrix also remain open. |
| [ ] | Full deterministic resource accounting and iterative totality | Source-unit, accepted-CM-depth, exact accepted-depth materialization, and Markdown-depth checks across canonical/Original/Revised/Comment lanes are green with exact ranges. Markdown-depth failure is now emitted from the same retained lane run rather than a separate container preflight. Shared ancestry paths remove the known quadratic full-mark-array copy; indexed CM closers plus preindexed backtick/math runs remove known repeated scans; and delimiter matching uses bounded opener bottoms. `syntax-accounting-1.yml`, the 2,000,000 logical-event algebra/limit, full mixed-container depth semantics, full/incremental trace equality, stack/heap proof, and linear adversarial bounds remain open. Inline HTML/link/autolink terminators and current-line probes still inspect suffixes. The projection-time ranges-by-segments literal join has been deleted. |
| [ ] | Total, idempotent boundary guard and verified fixed point | The previously throwing overlapping/malformed cases, constructed math, selected assembled/retargeted delimiters, BOF codec, and a source-idempotence case are green. The guard-local CM frame recognizer is gone: the Profile parser emits delimiter events and rejected candidates used by protection planning. The guard still lacks the frozen retained-decision/survivor/elision manifest, causal trace, exact Markdown-CST meaning proof, bounded parser-call contract, and independent whole corpus. Generated protection provenance is frozen as `sourcePosition` plus `affinity: 'next'`. |
| [ ] | Mapped Original/Revised Markdown CSTs and isolated Comment views | `SourceOwnershipIndex` and immutable projected `MarkdownDocument` readers are implemented. Public reds prove ATX/setext headings, ordered/unordered/nested/interleaved containers, multiple blocks, pinned emphasis/strong/strikethrough behavior, links/reference links/images, tables/alignment, breaks, thematic breaks, footnotes, fenced code/math/diagram blocks inherited through CM arms, inline structure across CM boundaries, and multiline inline structure inside a list item. The graph retains both mapped tapes/CSTs and internal Comment lanes. This is not a complete Profile 1 Markdown CST: canonical CST/state-transition retention, the remaining production/trivia/token set, public Comment display/folding, `ReviewIndex`, `precedingChange`, `anchoredComment`, semantic indexes, and editable source/view maps remain open. |
| [ ] | Complete parse-configuration validation | One centralized public seam currently validates the provisional profile and budget identifiers before parsing. It does not yet require/freeze the closed `MarkdownOptionsV1`, reject unknown object fields and wrong field types, or expose the target `live-html-sanitized-v1` / `live-html-escaped-v1` identities. The completed row must cover every field and independent `reinterpret`/semantic-hash vector. |
| [ ] | Independent manifests, corpus, and product acceptance | File-backed, versioned fixtures now cover all 132 CommonMark 0.31.2 emphasis/strong examples and all three GFM 0.29 strikethrough examples through the public seam; focused inline expectations plus a read-only 50,000-case marker fuzz pass add bounded evidence. This is not the frozen complete `CM_STANDARD`, `MARKTEXT_PROFILE_1`, `MALFORMED_RECOVERY`, `markdown-profile-1.yml`, `syntax-accounting-1.yml`, literal-boundary, Comment, guard-trace, adversarial-depth, and product manifests. The remaining checked-in property/differential/reference evidence and schema validation stay open. |

The immediate closure order is therefore not “add more forms” and not “teach the CM facade more
Markdown state”; those paths preserve the wrong owner. First invert or replace the parser so the
Profile 1 Markdown kernel owns source progression and invokes CM grammar productions. In that
kernel, retain the enclosing state plus each Substitution arm's local parse, terminate arm-local
matching state at the arm boundary, and resume the unchanged enclosing state for the suffix; then retain canonical block-tree, delimiter-run, literal-provider,
definition/reference, recovery, and accounting events in the same identity space. Derive the CM
forest, ownership, canonical/Original/Revised/Comment CSTs, provenance, and references from those
events without flattening and reparsing. Only then complete guard proof traces, Comment/Review
indexes, manifests, properties, and downstream features. The current bounded lexical terminators
and block-boundary probes are transitional evidence only. Any facade that cannot evolve into the
intrinsic parser is scaffolding to split or delete, never a second authority.

Phase 0 has **not** exited. The checked rows establish bounded implementation slices only. The
intrinsic atomic lossless graph, integrated Markdown/CM state and ownership, resource/event algebra,
total guard, mapped CST/Comment products,
profile/glossary/ADR consistency gate, three-way fixture manifests, consumer-policy matrix,
file-backed corpus matrix, legacy deletion manifest, accounting/hash/wire/EOL vectors,
test-disposition schema, and complete product-acceptance target mapping remain ordered work.
The parser must not be described as MarkText Profile 1 until every applicable unchecked row is
independently green.

Until Phase 0 exits, work in later phases may add independent red fixtures or remove legacy code,
but it may not add another CM feature around the current CM-driven facade and call that progress.
Every implemented downstream feature must consume the intrinsic parser artifact.

#### 2026-07-22 independent audit — the disjointness finding and the corrected closure order

An independent gap analysis (fresh-eyes, adversarially verified: 11 findings confirmed, 11 refuted)
confirmed every unchecked row above and produced one structural finding the ledger did not state,
plus six honesty defects in checked rows. Both are recorded here because they change the closure
order.

**Correction (2026-07-22, same day).** This section originally claimed the two Markdown halves were
"disjoint, not invertible" — that `markdownParser.ts` and `markdownLaneState.ts` could not see each
other and had to be merged from scratch. **That was wrong**, and the error mattered because it
overstated the cost of the inversion. `markdownParser.ts:11` imports `parsePlainMarkdownLane` from
`markdownLaneState.js` and calls it at `markdownParser.ts:2598`. The CST builder is already *layered
on* the lane. The accurate structure is:

- **one scanner** — the lane state machine in `markdownLaneState.ts` (containers, fences, HTML,
  definitions, front matter, lazy continuation, literal ownership) — with
- **two drivers over it**: the CriticMarkup driver in `profile1Document.ts` (`parseCriticMarkup`,
  marker-scan loop, frame stack) and the plain driver `parsePlainMarkdownLane`
  (`markdownLaneState.ts:3304`); and
- **one CST builder**, `markdownParser.ts`, which runs on the *plain* driver only.

So the inversion is not a merge of two parsers. It is: **collapse the two drivers into one, teach
that one driver CriticMarkup, and make the CST builder consume its emissions instead of a flattened
string.** The measured split below is real and still explains why neither file is a superset of the
other, but it is a division of labour inside one stack, not two disconnected stacks:

| Component | LOC | Decides CM? | Emits nodes? |
| --- | --- | --- | --- |
| `profile1Document.ts` + `profile1/markdownLaneState.ts` | ~6,470 | yes | **no** |
| `profile1/markdownParser.ts` (the only CST builder) | 2,697 | **no** (0 `critic` mentions, 0 CM delimiter literals) | yes |

`MarkdownLaneState`'s entire public surface returns `MarkdownCheckpoint`, `MarkdownLaneAdvance`,
`boolean`, and `MarkdownContainerDepthFailure` — never a node, token, or block/inline event carrying
identity. It is a literal-ownership oracle answering `markerIsProtected` / `markerIsLiteralOwned` per
marker. Conversely `markdownParser.ts` is CM-blind and only ever runs over flattened projected
strings, so its offsets are projected-string offsets and **no published Markdown node can share
parser-created identity with any canonical CM node**; identity is bridged only by `mappedTape`.
Invariant 3 is therefore structurally unsatisfiable on this path, not merely unimplemented.

Neither file is a superset of the other, which is why "just delete one" is not available. The lane
owns raw-source block/literal state but emits no nodes; the CST builder emits nodes but only over a
string handed to it, and has no front matter, no lazy continuation, and no CriticMarkup. Phase 0
requires **one** parser that owns canonical source progression, recognizes CriticMarkup as grammar
productions, and emits the nodes every product derives from. See "Phase 0.5" below for the ordered
plan that produces it.

**Corrected honesty defects in checked rows.** These are amended in place above; they are listed
together here so the pattern is visible:

1. `ProfileParseTraceV1` was described as "the sole architecture-proof seam" while as-built it
   recorded exactly one event kind (`projection-planning-range-visit` /
   `inline-code-extension-analysis`) and could observe none of the facts Phase 0 Red names.
2. "Tests ... may not import parser internals" was falsified by `canonical-lane-artifact.spec.ts` and
   `projection-clean-verifier.spec.ts`, which reach past `LanguageEngine.open` to assert the very
   architecture claims they are cited for.
3. "all three GFM 0.29 strikethrough examples" — that spec section defines two; the third fixture row
   is a MarkText case carrying a false spec-provenance header.
4. "a read-only 50,000-case marker fuzz pass" — no such test exists in the package or its history.
5. "Markdown depth over canonical, Original, Revised, and each Comment-display lane" — only the
   canonical lane is asserted; all three projected lanes have zero depth coverage.
6. "The document-core suite is green at 382/382" — counts in this ledger are unpinned and were stale.
   Ledger rows must cite a command, not a remembered count.

**Unacknowledged runtime facts.** The clean verifier is not test-only: `verifyCleanProjectedMarkdownV1`
runs from the projection path on every `LanguageEngine.open`. A comment-free CM document therefore
runs `parseCriticMarkup` about five times (one canonical, plus a guard and a verifier run per
projection) and six flattened Markdown parses. Reference resolution additionally completes a whole
parse, builds its definition index from the finished forest, then discards and re-runs the entire
pass — a post-hoc reference join (forbidden at line 89) with no fixed point, capped at two passes.

**Corrected closure order.** The immediate next action is not another Markdown feature and not a
direct assault on the inversion. It is to make the architecture observable, because every drift to
date was invisible to the suite:

1. **Make `ProfileParseTraceV1` record the architectural facts Phase 0 Red names**, and publish an
   architecture gate over them. The gate must fail while a CM state machine owns progression, while
   any authoritative CST is built from a flattened string, and while ownership/reference facts are
   joined post hoc. This gate is the only mechanism that cannot be satisfied by growing the facade,
   and it converts "we know we are on the wrong owner" from prose into a red test.
2. Collapse the two drivers into one kernel behind that gate and teach it CriticMarkup, one
   increment at a time. The lane's state machine already owns raw-source progression, so the frame
   stack and marker recognition move *into* it and the CST builder is rehosted onto its emissions.
   (An earlier revision of this step read "grow the intrinsic kernel inside `markdownParser.ts`";
   that followed from the mistaken disjointness claim corrected above.)
3. Delete the `parseCriticMarkup` driver loop, the execution-trace artifact, and the
   flattened-projection CST path as the gate rows turn green.

**Phase 0.5 below is the ordered, executable form of steps 2 and 3.**

Adding capability to the CM-driven lane while the gate is red is explicitly not progress.

### Phase 0.5 — one CriticMarkup authority, emit-don't-reconstruct, parse once and read every view off it

Phase 0's exit is blocked on one thing: canonical source progression is owned by a CriticMarkup
driver that treats the Markdown lane as a node-less oracle. This section is the architecture that
fixes it and the migration that gets there. It supersedes the earlier "16 steps → 7 steps" ladder,
whose archaeology is dropped; landed results are carried forward under **Progress** below.

#### Build-versus-buy: build (settled, re-confirmed against 2026-07-22 deep research)

The buy path was already taken here and failed: a patched `marked` fork plus ~1,556 LOC of
CriticMarkup on top, all slated for deletion, because a render-oriented token stream cannot carry
exact source, parser-created provenance, or projection identity.

A dedicated deep-research pass (see `specs/research/0001-…`, 23 primary sources, adversarially
verified) re-examined every candidate with fresh eyes. It **strengthened** the build decision and
sharpened the reason:

| Candidate | What it actually is | Why it does not replace this engine |
| --- | --- | --- |
| `@lezer/markdown` + `lang-criticmarkup` (the strongest candidate) | a single-pass, incremental, extensible Markdown parser, with CriticMarkup mounted as a `parseMixed` **overlay** | the overlay is a *second parser layered on the raw-source Markdown tree* — precisely the CM sidecar this plan's law (lines 84-93) forbids; `lang-criticmarkup` is a **source-editor highlighter**, not a document model — it produces no Original/Revised projection, no canonical provenance, no Accept/Reject round-trip |
| `@lezer/markdown` alone, as the Markdown grammar | single-pass incremental CommonMark(-ish) | deliberately omits some conformant CommonMark behaviors (its own README); emits **one** compact tree for editor tooling, not lossless source or per-view projections; a runtime dependency (reverses decision 9). See the steelman below. |
| `tree-sitter-markdown` | native (C/WASM) incremental grammar for tooling | native dependency; trees are for highlighting/structure, not lossless document modeling or projections |
| `micromark` | intrinsic construct API, mdast for rendering | no CriticMarkup extension exists; renders rather than models; runtime dependency |
| `remark-critic-markup` / `@gerhobbelt/markdown-it-criticmarkup` / Fevol `criticmarkup-parser` | small CriticMarkup utilities | render/highlight streams or single-maintainer plugins; none carry losslessness, provenance, projections, or budgets |
| MultiMarkdown 6 | native CriticMarkup (our reference oracle) | C renderer; constrains CriticMarkup to a single block — a boundary we reject (we support cross-paragraph CM) |

**The decisive finding: every candidate solves the *easy* half (parse Markdown, or highlight
CriticMarkup) and leaves the entire *hard* half unbuilt** — lossless source as authority
(ADR-0005/0007), provenance created with syntax (invariant 6), Original/Revised/Comment projections
each a real parse of the elided view, Profile 1 boundary-safe escaping that round-trips under Accept
All, arm-scoped references, resource budgets, and zero runtime dependencies. Those are the reason the
engine exists, and no upstream supplies any of them.

**Steelman for buying the Markdown half (the closest call), and why it still loses.** The coherent
"buy" option is to drop `@lezer/markdown` in as the *per-view Markdown grammar* only — keeping the
CriticMarkup authority, projections, provenance, and escaping in-house — which would delete ~4,200 LOC
of hand-maintained CommonMark/GFM and inherit incremental fragment reuse for free. It loses on four
counts: (1) it replaces the part the adversarial review said is *good and should be kept*, not the
part that hurts (the deletable reconstruction layer and legacy); (2) it risks the locked, passing
CommonMark 0.31.2 + GFM conformance the current grammar already banks, since `@lezer/markdown`
omits conformant behaviors by design; (3) you still wrap it in a canonical-provenance and
lossless-source layer, so the impedance-mismatch integration cost is real while the hard problems stay
yours; (4) it reverses the zero-dependency policy (decision 9). Net: buying the Markdown half is
coherent but low-value — it trades a working, conformant, dependency-free grammar for a dependency
that solves a problem we do not have.

**What the research *does* change: copy the techniques, not the code.** The ecosystem's low-lag
mechanisms — fragment reuse, single-pass block/inline extension, main-thread time-slicing — are proven
and are the right ones. `@lezer/markdown`'s `parseBlock`/`parseInline` extension model and its
`TreeFragment` reuse contract are concrete templates to *study and reimplement*, not depend on. Those
techniques land in **Phase 11** below, sequenced after the correctness rebuild.

#### Target architecture: parse once, read every view off it (ADR 0013)

> **Two retractions, 2026-07-22 — kept because they bound the real architecture.** A first draft
> proposed "one scanner emits a view-tagged node stream; views are produced by *selecting* nodes by
> view-set, not reparsing." A fresh-eyes adversarial review filed 15 flaws; 13 held, one proven live.
> Its load-bearing proof stands:
>
> - **You cannot share one tokenization and select per view.** Elision changes character *adjacency*,
>   and CommonMark recognition is adjacency-dependent: `a*{--X--}*b` → Original `a*X*b` (emphasis on
>   `X`) vs Revised `a**b` (plain). The same source `*`s are emphasis delimiters in one view and
>   literal in the other; no single tokenization selects into both trees.
> - **Divergence is unbounded and not only Substitution.** `{++```++}\n# Heading` → Revised opens a
>   fence to EOF; Original is a heading. A deleted list marker re-parents an unbounded suffix.
>
> A second draft then over-corrected to "keep N fully independent per-view parses," which re-parses the
> shared text once per view and needs the flatten/codec machinery. **The committed architecture
> (ADR 0013) is neither.** One parse *shares* the convergent regions — the bulk of any document, byte-
> identical across views — and *forks* at a divergence, storing both fully-resolved sub-structures
> there. A fork is a local re-parse of the divergent span, **not** a shared tokenization, so the proof
> holds: forks are not shared, and pervasive divergence degrades to the bounded `O(views · n)` ceiling.
> The common case (sparse markers) is `O(n)`, and text that does not change across views is parsed once.

A CriticMarkup document is a **family of documents sharing one source tape** whose members agree
everywhere except inside marker-divergent regions. The one parse recognizes the five forms and arms as
zero-width grammar events, emits the block/inline AST — CriticMarkup nodes beside Markdown nodes — as
it advances (decision 13), and records a fork wherever an elision changes structure. Original, Revised,
and the editing view are *reads* of that AST by arm selection; no view re-recognizes CriticMarkup,
re-parses convergent text, or reconstructs structure afterward.

```text
canonical source
    │  ONE parse: recognize the five forms + arms as zero-width events; own progression;
    │  emit the block/inline AST (CM nodes beside MD nodes), ownership, references, diagnostics
    │  AS IT ADVANCES; record a fork only where an elision changes Markdown structure
    ▼
one emitted AST  (blocks · inlines · CM nodes · per-view forks · ownership · arm scopes · diagnostics)
    │
    ├─ read(view): walk the AST, take each fork's arm (reject-all / accept-all / show-all).
    │              No reparse of convergent text; no CriticMarkup re-recognition.
    └─ Accept All materializes Revised AS new canonical source — only THAT serialization needs the
                   boundary-safe escapes (a re-parse of the saved bytes must mean the same); a view
                   READ needs none.
```

Three properties define the end state — each is a real, verified reduction, none depends on the
retracted mechanism:

1. **One CriticMarkup authority.** The five forms and arm fork/rejoin are recognized exactly once,
   during the canonical parse. A per-view parse runs the **Markdown grammar only**; it never
   re-recognizes CriticMarkup. Today two extra CriticMarkup recognitions run per view
   (`guardProjectionCandidate`'s `parseCriticMarkup` and the clean verifier's) — those violate
   invariants 1/3/13 and are the removable "second authority." (Landed already: both are gone for
   CriticMarkup-free documents, and the clean verifier no longer recognizes CriticMarkup at all.)
2. **Emit, don't reconstruct.** The Markdown lane emits no nodes today, so the canonical driver
   tape-records every oracle call and rebuilds topology, ownership, and edges afterward. Make the lane
   *emit* block nodes and ownership runs as it advances; the ~1,198-LOC reconstruction layer then has
   nothing to do. This is the intrinsic-parser requirement (invariant 6) and it is independent of how
   views are parsed.
3. **Boundary escaping moves to materialization, off the read path.** When an elision makes two
   retained runs adjacent, their fusion can (a) form Markdown syntax absent from the source — handled
   by the fork, which re-parses only that divergent span's elided text with the **Markdown grammar
   only** — or (b) fuse into what *looks* like a CriticMarkup marker (`{{--a--}+{--b--}+x++}` →
   `{++x++}` in Revised). Case (b) never affects a view *read*: CriticMarkup is recognized once over the
   real source and never re-recognized, so a fused `{++` is inert literal text on every read and inside
   every fork. It matters only when **Accept All materializes Revised as a new canonical source file** —
   re-parsing those saved bytes must mean the same, so that one serialization applies the boundary-safe
   escapes (ADR-0010). The escape codec is therefore a **materialization obligation, not a per-view
   scan**: the guard's per-projection `parseCriticMarkup` deletes outright rather than becoming a
   lexical sweep.

##### How this reconciles with the architectural law

The law (lines 77-93, already amended) forbids a **second CriticMarkup authority** during view
production and **post-hoc reconstruction** of identity the parse should have emitted. ADR 0013
satisfies it more cleanly than a per-view reparse would: CriticMarkup is recognized exactly once; a
view is a *read* of the one emitted AST (with local Markdown-only forks at divergences), never a fresh
Markdown parse of a whole assembled string and never a CriticMarkup re-recognition; and the AST is
emitted, not reconstructed. The escaping codec's *outputs* remain a serialization obligation at Accept
All; what deletes is the redundant recognition, the reconstruction layer, and the per-view flatten +
escape scan.

#### What deletes, what survives (adversarially verified)

The reconstruction layer exists *only* because the Markdown lane emits no nodes: the driver must
tape-record every oracle call and rebuild topology afterward. Emit nodes as the scanner advances and
it evaporates. Confirmed removals (LOC re-measured; refuted claims excluded):

| Deletes | LOC | Why it exists today |
| --- | --- | --- |
| `canonicalMarkdownArtifact.ts` (whole file) | 500 | execution-trace of oracle calls, retained only to rebuild lane/branch topology |
| graph post-hoc joins (`createOwnershipIndex` interval join, `createCriticMarkupEdges`, `validateProfile1SyntaxGraphCore`) | ~395 | re-derive ownership/edges/consistency from by-products of a parse that emitted no structure |
| recorder plumbing in `parseCriticMarkupPass` | ~181 | every lane call shadowed by a `recordTransition` |
| two-driver duplication + duplicate reference indexes | ~620 | a CM driver separate from the Markdown driver, each with its own index and two-pass rerun |
| codec/guard *plumbing* (scope re-anchor, authenticated-delimiter lookup, evidence validation, side-channel policy) | ~672 | repair a flattened candidate in projected-offset space, then re-validate the repair |
| **legacy outside document-core** — patched `marked` fork (~5,606) + muya `SourceProvenance`/`TokenGraphAuthority` transparent-marker views, `criticMarkupStateBindings`, `documentService`, `commentAnchorDeletion`, `nativeCriticMarkup` | **~19,000** | "hide CM from marked, then put it back" — the buy-path scaffolding in its purest form; already in the deletion manifest |

| Survives (do **not** rewrite) | Note |
| --- | --- |
| the lane's ~2,300 LOC block/literal grammar + `markdownParser`'s ~1,900 LOC delimiter/inline/table grammar | this is CommonMark 0.31.2 + GFM conformance; keep it, make it *emit* instead of *answer* |
| the six boundary-codec *kinds* and their emitted escapes | serialization law under ADR-0010 (Accept All re-opens the string) — the decision stays, the reparse-to-find-it goes |
| `BofTextCodecV1`, clean-verification budget, `provenance.originAt` view↔source map | permanent Profile 1 fixtures; invariants 8, 9 |
| arm fork/rejoin, arm-scoped reference visibility rule | correct today; relocates into the scanner |

The largest single win — the ~19,000-LOC legacy purge — is **independent of every design decision
above** and can proceed whenever `@marktext/document-core` becomes the sole engine.

#### Migration

Three independent tracks toward ADR 0013. Track A removes every second CriticMarkup recognition from
view production. Track B makes the one parse emit the block/inline AST so views become reads/forks and
the reconstruction layer dies. Track C is the legacy purge. None requires the retracted
view-tagged-selection mechanism.

**Track A — one CriticMarkup recognition.**

1. Clean verifier stops recognizing CriticMarkup. **Done.**
2. Delete the guard's per-projection `parseCriticMarkup` outright. Under ADR 0013 a view is a read of
   the emitted AST (with local Markdown-only forks), so no assembled view string is reparsed and the
   synthesized-marker hazard cannot arise on a read — CriticMarkup is recognized once and never again.
   The boundary escape it guarded relocates to **Accept-All materialization** (below), the only place
   Revised becomes bytes a fresh parse reopens. *(Partial: guard already skipped entirely when the
   document has no CriticMarkup.)*

**Track B — emit, don't reconstruct (flips the BLOCKING gate rows).**

3. **Lane emits block nodes + ownership runs** (open/close with canonical ranges; owner per run) as it
   advances, instead of returning checkpoints and being tape-recorded. It already computes everything
   needed (`analyzeContainerLine`, literal ranges, container path). **Flips BLOCKING row 3**
   (parser-emitted ownership).
4. **Marker recognition + frame stack + arm fork/rejoin relocate** from `parseCriticMarkupPass` into
   the one emitting scanner; `markerIsProtected`/`markerIsLiteralOwned` become internal decisions,
   scope ids parser-created at fork time. **Flips BLOCKING row 1** (progression ownership).
5. **Delete the reconstruction layer**: `canonicalMarkdownArtifact.ts`, the ownership interval join,
   `createCriticMarkupEdges`, `validateProfile1SyntaxGraphCore`, the recorder plumbing, and the six
   `project()` reads of `lane.parseArtifact.transitions` (replaced by the emitted structure). Remove
   the driver duplication and the three `it.fails` markers. **Flips BLOCKING row 2** in the honest
   sense: the per-view parse is Markdown-only over an exact segment map, with no CriticMarkup
   re-recognition and no post-hoc join. Per-view *Markdown* parsing remains — that is not the
   violation.

**Track C — legacy purge (independent).**

6. **Purge the ~19,000-LOC legacy layer** (patched `marked` fork + muya CM machinery). Gated only on
   `@marktext/document-core` becoming the sole engine; do it whenever.

**Safety net.** Snapshot the normalized public revision for every file-backed fixture at the current
green baseline and diff each step. Two honest product decisions to record, not slip in: (1) step 2
(guard hazard scan) and step 5 may **change some published bytes** — ≈360 spec lines and much of the
1,002-line arm-boundary suite pin current strings via `open(original.source)` round-trips, and the
review flagged step 2/5 as the one place the byte snapshot is *not* trivially empty, so that diff must
be reviewed as a deliberate product change, not waved through; (2) the marker-elided-line block
semantics settled in step 4 is a Profile 1 language choice.

#### Progress landed (2026-07-22)

Work already merged into the tree, each red-green with the suite green (currently 414 passing, all
gates clean; the one red is a pre-existing untracked linearity spec, not caused by this work):

- **Clean verifier no longer recognizes CriticMarkup** (uses `parseMarkdownDocument` + the guard's
  `acceptedMarkerCount`). Recognitions/open 5 → 3.
- **Guard skipped entirely when the document has no CriticMarkup** — CriticMarkup-free docs do **zero**
  CriticMarkup recognitions per open (was 4). Upgrades the gate's CM-free rows from a byte-equality
  coincidence to a real mechanism.
- **Tautological clean-verification parse dropped** where a view has no arm scopes: Markdown parses/open
  4 → 2 for CriticMarkup-free and unary-form documents; Substitution correctly still verifies (stays 4).
- **Shared reference-definition index** built once from final literals: index builds/open 12 → 4
  (no-definitions) / → 8 (with definitions).
- **Dead `retainedMarkdownLiterals` oracle removed**; literal precedence has one owner (the lane).
- **Shared line construction** (`buildPlainMarkdownLine`, `plainMarkdownLineBounds`) extracted — the
  first mechanical piece of migration step 1.
- **Precondition cleared**: the `CANONICAL_LANE_DEPTH_SENTINEL` diagnostic was restored to the real
  `CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED` code, unblocking `tsc`, the resource-budget rows, and the
  packed build.

Instrumentation counters (`__criticMarkupRecognitionCountV1`, `__markdownDocumentParsesV1`,
`__referenceDefinitionIndexBuildsV1`) and their specs are the measurable bar for migration steps 3–6.

### Execution strategy — integration-first vertical slices (the actual critical path)

**Sequencing, corrected 2026-07-22 (twice).** First correction: the bottleneck seemed to be that
`@marktext/document-core` has zero production callers (~11,515 LOC parser vs ~1,848 LOC session
surface, nothing in the app importing it), so a thin integration vertical slice was started to
connect it. Second correction, from what that slice *found*: connecting the engine proved its output
is **architecturally incomplete** — there is no canonical block AST for the editing view (increment
2b), because the parse computes block structure for marker-ownership and discards it. **You cannot
build the app's view layer on that output shape.** So the corrected sequence is:

1. **Discovery (done, cheap).** The vertical slice's real job was to reveal what the engine must
   produce. It did: a canonical block AST, inline runs with CriticMarkup marks, a source map, and
   intent dispatch. Keep the inline-run layer it produced (`renderMarkupPlan`); discard the
   block-structure hack (newline line-splitting) — that was building on the wrong output.
2. **Engine architecture, directed (now).** Do Track B — emit block structure, ownership, and arm
   events natively (the inversion) — *guided by those discovered requirements*, not as open-ended
   parser perfectionism. This is the one change that simultaneously gives the editor its block AST,
   deletes the ~1,198-LOC reconstruction layer, and achieves one authority.
3. **App on the correct seam (after).** Rebuild the view layer (block nodes from the engine, inline
   runs nested inside, gesture→intent, muya-as-view) on the *right* output — not the flat-run stub.

The discipline that keeps step 2 from becoming the research-project trap: it is **bounded by the
app's known requirements** (step 1's list) and proven by red-green tests, not by an 11-phase ideal.
The engine becomes real when it emits the products the editor consumes — which is step 2, done right,
then step 3.

**The two engines (do not conflate them).**
- *Language engine* = `document-core` (source-authoritative MD+CM, headless). Already a from-scratch
  rebuild; correct; keep going — but behind an integration seam, not in isolation.
- *WYSIWYG engine* = `muya` (renders the document into an editable contenteditable surface). Measured
  ~42,800 LOC of selection/block/inline/editor **browser-knowledge core (KEEP — irreplaceable;
  contenteditable/IME/selection is the most expensive code in the product)** and ~48,000 LOC of
  CriticMarkup-authority + `marked` fork + mutable `state` **(DELETE — the wrong architecture that is
  "in the way")**.

**Verdict (fresh-eyes, 2026-07-22).** Do **not** rebuild the WYSIWYG core from scratch — greenfield
contenteditable re-earns every browser bug from zero (a multi-month tar pit; the cross-block selection
bug fixed earlier this branch is a taste). Do **not** finish the parser before integrating. **Gut
muya, don't grow it:** strip the ~48k authority/CM machinery, keep the ~42k view core, and refactor it
from *owning* the document to *rendering document-core's projection and translating gestures into typed
intents*. ("Remake muya" = amputate the authority, keep the body.) ProseMirror as a view-only
substrate is the one external option worth a *timeboxed spike* — only if muya's view proves too
entangled to salvage; its inverted state-authority means you fight it.

**The seam already exists.** `DocumentSession` exposes `MarkupLiveRenderPlan` (a flat `runs` list, each
run carrying `text`, CriticMarkup `marks`, `modelRange`, and `sourceRange`) and accepts
`EditorIntent` (`insert-text` | `undo` | `redo`). That is precisely what a view renders and what a
gesture becomes. The missing pieces are the **view adapter** (render plan → DOM; DOM gesture → intent)
and the **wiring** behind the new-engine flag.

**Ordered vertical-slice increments** (each red-green, each keeps the suite green; the goal is one flow
working end-to-end in the app, then widen):

1. **Render adapter: `LiveRenderPlan` → render-node tree.** A pure, DOM-free function mapping the
   plan's runs (with CriticMarkup marks) to a minimal renderable structure a view mounts. First line
   of the view layer; testable headless. *(This turn.)*
2. **Line grouping** (done) — split the flat run stream into lines at newlines, preserving CriticMarkup
   marks and model/source ranges across each split (`groupRenderLines`; a mark spanning a newline
   stays on both halves). This is the inline/line layer and is enough for the single-paragraph flow.

   **The canonical block AST is an engine responsibility, not the view's (corrected twice, 2026-07-22).**
   The first correction here said "markdown block rendering is the view's job." *That was also wrong,
   and it matters.* The editor edits the **canonical** (marker-bearing) view; to render it WYSIWYG it
   needs that view's block structure (headings, lists, blockquotes). If document-core does not emit it,
   the view must re-parse Markdown to get it — a **second Markdown authority in the editing path**, the
   exact original sin this rebuild exists to eliminate (and against the spirit of invariant 13). So the
   view may **mount** a block tree but must never **compute** one.

   The committed architecture is **ADR 0013 (parse each document once and read every view off it)**:
   one intrinsic parse over the real source with CriticMarkup markers as zero-width grammar events,
   producing a structure that records the **per-view fork** wherever eliding a marker would change
   Markdown structure. Original/Revised/editing are **reads** of that one structure (reject-all /
   accept-all / show-all arm selection) — never reparsed, never flattened, never reconstructed.

   This replaces the interim "N independent per-view parses over boundary-safe flattened strings"
   idea (itself a correction of the still-earlier "invert the lane" framing). That interim design
   parsed the shared text once *per view* and needed the flatten/codec machinery; a CriticMarkup-free
   document parsed **twice** under it. The decision (user, 2026-07-22, in response to "why parse more
   than once if it hasn't changed?") is the single intrinsic parse. Forced by two facts together:
   per-view results are **irreducible** (eliding a marker changes block structure — `{--# --}Title`
   heads in Original, not Revised), so no view derives from another by transform; *and* parse-once
   forbids re-traversing the shared text per view. Only a single parse carrying per-view forks
   satisfies both.

   What this deletes (not just shrinks): the ~1,198-LOC reconstruction layer, the per-view reparses,
   **and most of the flatten + boundary-safe codec machinery** (`project()` / ADR 0010) — the cross-arm
   false-pair hazard the codecs guard against cannot arise when the parser reads the real source and
   never concatenates arms into a string.

   The editing view is the parse that always runs (it is the surface the user types into), so it is
   the home of the single structure; `canonicalMarkupDocument` returns it and Original/Revised are
   reads of its forks. The migration is **measured by parse count per document** (`__markdownDocumentParsesV1`):

   - **Slice 1 (this section's first red-green):** a CriticMarkup-free document parses **once**, not
     twice — all views read one shared parse. (Today: 2.)
   - **Slice 2:** a marker that does not change block structure (an addition inside a paragraph) parses
     once; views differ only by inline arm selection.
   - **Slice 3+:** a marker that changes block structure parses once and records a **block fork** — the
     hard core (CommonMark non-locality under forks: lazy continuation, reference definitions, setext).

   Consequence for the muya gut: it is deeper than deleting the ~48k CriticMarkup/authority machinery —
   muya's own Markdown **block parsing** (inside the ~42k) must also be removed and replaced by reading
   the engine's single forked structure. muya keeps the DOM/contenteditable/selection *mechanics*; it
   stops *deciding* block structure. Keep the hands, replace the brain.
3. **Gesture → intent translation.** A pure function mapping a DOM selection + input event to an
   `EditorIntent` against the current plan's `modelRange`s. Testable headless.
4. **Mount in a gutted muya-as-view behind the new-engine flag, one flow (plain paragraph typing).**
   Wire adapter + translator to muya's contenteditable core; prove gesture → intent → revision → plan →
   DOM diff end-to-end in the real app (the loop never yet demonstrated in production).
5. **Migrate flows one at a time**, deleting muya's authority + CM machinery as each lands, until muya
   is a pure view and the ~48k legacy is gone.

Parser Phases 1–10 and latency Phase 11 continue **behind this seam** — refined against the running
app, not ahead of it. The first production caller is worth more than the next parser phase.

### Phase 1 — complete lossless Markdown coverage inside the intrinsic Profile 1 parser

**Red**

- Enable one token-concatenation/open→save identity example at a time over arbitrary Unicode, BOM,
  mixed line endings, blank lines, no terminal EOL, and malformed Markdown.
- Enable the U+FEFF grammar matrix one row at a time: zero/one/two leading units and one
  moved/nonleading unit × each of the four Profile 1 front-matter forms, fenced block, ATX heading,
  and leading CM.
  File-signature provenance true/false must not change parsing; the first source unit is virtual
  grammar trivia, the second/nonleading unit is literal, every canonical range includes the retained
  units, and persistence is exact.
- Enable one cross-platform known-answer vector at a time for `SourceHashV1`, `FileHashV1`, and
  `RevisionSemanticHashV1`: empty, U+FEFF, CR/LF/CRLF, astral/unpaired surrogates, length
  boundaries, raw encodings, and every configuration/schema/build field. Reinterpretation changes
  only the semantic hash; byte-only encoding changes change only the file hash.
- Enable closed `ParseConfiguration` validation one field at a time: every required field missing,
  every object with an extra field, every wrong primitive/object type, every unknown identifier,
  every unknown `MarkdownOptionsV1.schema`, and each option boolean changed independently. Valid
  inputs are deeply frozen; no engine default fills an omitted field.
- Enable CommonMark 0.31, GFM 0.29, and each supported MarkText extension row one at a time through
  `LanguageEngine.open`.
- Enable each literal-context option and delimiter-boundary row one at a time.

**Green**

- Extend the Phase 0 intrinsic parser's `SourceSnapshot`, immutable exact-source value interface,
  line index, token tape, profile identity, diagnostics, and lossless Profile 1 syntax graph/CST. This
  is conformance work inside the existing Markdown+CM kernel, never construction of a separate
  Markdown base to which CM will later be attached. A plain immutable string is an acceptable first
  green; rope/piece storage waits for Phase 5 profiling evidence.
- Implement the three versioned hash codecs from their exact framed byte definitions; no
  platform/native convenience string hash is admissible.
- Use current Marked only from an out-of-package differential test adapter. The core never imports
  it or adapts its AST into canonical state.

**Exit**

- Every decoded code unit is owned exactly once; no ranges overlap or leave a gap. Full-parse
  conformance and exact-source properties pass.
- Parsing arbitrary user text is total and bounded.

### Phase 2 — complete intrinsic CM productions and derive their products

**Red**

- Enable one form, delimiter boundary, empty form, escape, first-separator, nested-matrix,
  multiline, Comment-display, contextual-adjacency, malformed, or projection row at a time through
  `LanguageEngine.open`.
- Enable Comment-fold and `RevisedContribution` adversarial rows one at a time:
  CRLF/bare-CR/LF/tabs/literal bodies; text/whitespace/ZWJ, `<br>`, HTML comment, unsafe raw HTML,
  empty link, code/math object, hard break/thematic break, image, and Highlight suppression by an
  outer carrier.
- After literal examples are green, add one property at a time for projections, provenance, proper
  nesting, deterministic crossing recovery, literal precedence, and malformed losslessness.
- Take `ProjectionGuardV1` red one fixture at a time for assembled opener, wrong-parent opener,
  retargeted separator, retargeted closer/synthetic node, independent repairs, split spelling, and
  repair-dependent cascades. Assert the literal manifest, candidate ordinals, guarded decision
  order, responsible-delimiter identity, inserted unit, structurally shared recursive cause slice,
  source affinity, final verifier result, and parser-call count; inject one bad guard result and
  prove the verifier publishes nothing.
- Compare one standard/reference row at a time with official tools; every Profile 1 difference is
  named in fixture metadata.

**Green**

- Complete CM productions in the intrinsic Profile 1 grammar. Derive the CM forest/index, typed
  delimiter/arm readers, multi-view mapped tapes, Original/Revised CSTs, isolated Comment views,
  semantic indexes, and editable render plan from those parser-created nodes only as each row needs
  them. None of these products may recognize markers or parse flattened projected strings.
- Derive `precedingChange` for all four eligible preceding forms and the mandatory nonempty
  Highlight/Comment `anchoredComment` presentation in `ReviewIndex`; never add a persisted
  relationship to the syntax graph.

**Exit**

- The intrinsic parser alone produces authoritative syntax. Every view, mapping, Review item, and
  consumer product is produced solely by its named graph derivation; none parses source or marker
  text to rediscover syntax.
- No binding, range-search, or topology-inference API exists in the new package.

### Phase 3 — source-native transformations and transition proofs

**Red**

- Enable one type-safe command-matrix cell at a time through `DocumentSession.dispatch`, including
  exact undo and rejection.
- Enable one `RevisionTransition` mapping/composition row at a time.
- Enable foundational text insertion/deletion/replacement Track Changes rows one at a time, then the
  pre-existing properly nested all-five-forms fixture proving both projection equations. The full
  interaction manifest stays frozen but its later command-family rows wait for their ordinary
  planners in Phases 4 and 7.
- Enable each `SemanticEditCodec` join/enclosure row one at a time: every CM opener/closer/separator
  split over old/new and old/old boundaries, Markdown constructs created by a join, wrapper cleanup,
  Add Comment/Highlight around delimiter-looking plain text, and wrapping complete nested Addition,
  Deletion, and Substitution nodes. Then take each authenticated Markdown provider variant red at
  every applicable inside/partial/full/before/after selection boundary, with typed
  `literal-source-only`/`inapplicable` rows where the provider has no editable visible contribution:
  enclosure rejects the first two, widens/proves an applicable complete visible owner, and preserves
  its exact literal node. Add Comment additionally rejects a complete Deletion and an
  empty-revised-arm Substitution for zero prospective root-Revised contribution; Mark Highlight may
  wrap the complete Deletion. Each row asserts literal canonical source, projected source,
  `meaning`, generated-protection provenance, and survivor identities.
- Enable `BofTextCodecV1` rows for a wrapper after retained leading BOM trivia, prefix deletion
  before ordinary U+FEFF, individual/bulk resolution, and both projections before
  each Profile 1 front-matter form plus fence/heading/CM openers. Each proves literal source, one decoded U+FEFF text atom where
  intended, no accidental BOF construct, and exact undo/redo/provenance.
- Enable one atomic literal-edit row at a time under Track off/on for inline code, fenced/indented
  code, raw/inline HTML, autolink, link/image destination/title, reference/footnote definition,
  front matter, math, and diagram owners. Freeze old→new whole-owner Substitution, whole-owner
  Addition/Deletion for true semantic insertion/removal, plain↔literal formation/dissolution and
  cross-provider Substitution, direct pending-revised editing, present/absent rejection,
  owner-containing-Review rejection, and multi-owner mapping with literal
  source/projection/locality/undo expectations. Front-matter rows give both Substitution arms
  inherited virtual BOF with a retained BOM outside the wrapper and reject the same spelling away
  from BOF.
- Enable ordinary highlighted-text deletion to bare Comment and explicit anchored Remove Comment as
  separate rows; then enable the root-effective tracked whole-anchor literal `{--{==x==}--}{>>c<<}`
  and its Accept/Reject/context lifecycle. Follow with pending Addition/Substitution-new direct
  outcomes, residual nested non-Comment survival, and direct/tracked visible rejection for a hidden
  Comment descendant at root and inside each pending revised carrier. Finally delete one
  contribution and then the last from the same anchor under Track off/on, including prior nested
  tracked edits, hidden descendants, cascading two/three-Highlight exhaustion, residual nodes,
  pending carriers, disjoint anchors, Accept/Reject, and every undo/redo state. No test expects
  `{====}`.
- Inject failure separately at intent preparation, source-edit composition, candidate parse,
  resource classification, command-postcondition proof, and selection/draft mapping. Every row
  leaves the canonical document/history untouched, publishes one stable actionable rejection
  descriptor, and proves one localized non-focus-stealing desktop presentation. Journal,
  publication, observer, and effect failures begin only after
  the coordinator/recovery seam exists in Phase 4.

**Green**

- Implement the session-owned `TransformationKernel`, exact `SourceEdit[]`, candidate validation,
  type-specific command postconditions, Track Changes decorator, and `RevisionTransition` proof
  before publication.

**Exit**

- Every Review and foundational Track Changes transformation enabled so far is source-native. None
  depends on DOM, `TState`, JSON ops, serialized live state, or post-hoc normalization.
- Change maps, inverse edits, survival, and composition satisfy their public contracts.

### Phase 4 — session semantics and the first useful live editor

Phase 4 owns the transport/session protocol using one plain-text leaf, one minimal composition host,
and one minimal source draft. It proves ordering, retention, barriers, and atomicity, not the
complete platform IME or CodeMirror command surface. Structure-specific planners and real
browser/platform cells remain in Phase 7 and reuse these already-green protocol rows.

**Red**

- Enable one session row at a time: immutable snapshots, atomic rejection, typing coalescence,
  undo/redo truncation, stale handles, selection affinity, hidden-Comment exclusion, source draft,
  Review draft, immutable effect descriptions, and single-owner `EffectRunner` delivery.
- Drive one effect-outbox row at a time through duplicate subscribers, claimed-before-call crash,
  adapter-call-before-result crash, idempotent retry, reconciliation, at-most-once
  `outcome-unknown`, stale-plan supersession, and adapter failure. Same-revision view switch, plan
  replacement, unmount, and close each receive their own terminal-result row, including unmount
  between runner precheck and adapter commit plus close with a claimed unreconciled effect.
- Enable the asynchronous protocol one row at a time: immediate ticket plus an exact unpainted local
  provisional buffer; durable host admission followed by pending-overlay paint, or transport
  rejection with retained retry bytes; strict client/host queue order; exact request identity;
  queued-target reauthentication; proven rebase; stale/duplicate/out-of-order worker result
  rejection; worker crash; retry; cancel before start; abort in flight; and late result after close.
- Crash the renderer and host before ingress receipt, after durable ingress but before
  AdmissionResult/paint, and after paint but before worker start. The first row never presents
  accepted content; the latter rows replay the exact intent/delta once from `IngressEnvelopeV1`.
- Disconnect after send but before response with the host absent, appended, and terminal in separate
  rows: reconnect fences the old epoch, queries by the same ID, resends only the proven-absent
  envelope, and never returns an ambiguous `transport-rejected`. Leave an actually unsent client
  sequence, durably append `ClientGapTombstoneV1`, admit its successor, then deliver the delayed
  old-epoch message and prove it cannot commit. Crash/replay every tombstone boundary.
- Corrupt or omit each wire-envelope member, duplicate a wire sequence, create a gap, mismatch a
  base plan, exhaust the replay window, and recover by full resnapshot one row at a time. Drop each
  dispatch/cancel/preparePersistence/ flush/close/lease terminal response and reconnect beyond the
  replay window; the acknowledged outcome ledger settles every Promise once with its original
  result. No row may expose a partial DOM/Review/session generation.
- Lose, duplicate, reorder, corrupt, cancel, and supersede individual plan chunks; exceed the
  staging memory budget; and disconnect between final chunk and atomic swap. Each row proves bounded
  queues, ≤4 ms main-thread slices, exact cleanup, one resnapshot/result, and no partial mount.
- Enable each `wire-envelope-v1.yml` known-answer vector in host, staging worker, and client,
  including exact 262,144-byte boundaries and member-order swaps. Repeat loss/corruption/replay for
  a base-equals-next outcome-only flush, lease acknowledgement/release, cancellation `not-found`,
  and `CancelClosetoo-late`; none may invent a transition or leave its Promise unsettled.
- While a worker is synchronously scanning a worst-case suffix, admit and echo a later input from
  the coordinator, observe its pending snapshot, cancel the active request through the shared
  checkpoint flag within 100 ms, and prove the hard-termination fallback reconstructs the worker
  without a commit.
- Kill the worker at three distinct commit boundaries—before journal append, after append before
  acknowledgement, and after acknowledgement before host publication—and recover one row at a time
  for source-edit record, source-edit coalesce, undo, redo, reinterpret, and edit-after-undo redo
  truncation. Each row proves exactly the specified commit or retained draft, exact source/save
  bytes, history group/cursor/redo state, configuration, selection/draft anchors, and effect outbox.
  Undo/redo/reinterpret do not falsely add a history entry.
- Tear/truncate a journal record, corrupt its checksum, and mismatch its base or checkpoint hash in
  separate rows. Recovery stops at the last verified commit, reports the retained later input
  visibly, and never guesses or mutates source.
- Kill/tear every checkpoint-compaction boundary from temporary write through manifest installation
  and old-prefix cleanup. Then open one previous-schema journal under a new engine build, migrate
  source/history before regenerating presentation, and interrupt that migration at every durable
  boundary.
- Inject journal append/fsync failure before commit, then host publication, subscriber, plan-mount,
  outbox-claim, and adapter failure after commit in separate rows. The first rejects without a
  revision; every post-commit row recovers and publishes the one durable revision and never pretends
  to roll it back.
- Freeze barrier/lifecycle races individually: cross-channel `beforeinput → native Save/Close`,
  `t1 → preparePersistence(save) → t2` with neither ticket started and a hard batch fence,
  concurrent watermarks, rejection/blocked input, active composition, worker failure during
  preparePersistence or pure flush, dispatch/cancel after closing and after closed, and a file
  adapter that persists the returned lease rather than a later snapshot.
- At one `preparePersistence` frontier, block dirty ReviewDraft, active composition, retained
  rejected/cancelled input, ambiguous transport ingress, and their pairwise combinations one row at
  a time. Repeat each with a dirty SourceDraft and prove preflight commits neither source nor
  history and returns no lease; after explicit resolution, retry commits the exact acknowledged
  source version once.
- Take `CancelClose` red separately for a known pending close, an unknown target, the exact
  duplicate cancellation-operation ID, a different cancellation ID against the already-cancelled
  target, and cancellation after close linearization. The named close and successful cancel both
  settle `cancelled`; exact request replay returns its recorded result, while unknown or newly
  targeted terminal closes return `too-late`. Re-arm close after each allowed resolution, then race
  its final fence with another allowed resolution. Race confirmed discard-all against
  registered/temp-written/pre-rename/renamed saves and open leases: rename-first returns stale
  confirmation, tombstone-first forbids rename, and every crash boundary replays one exact close
  outcome.
- Hold old and concurrent source leases across later commits, worker restart, close attempts,
  adapter abort, durable persistence acknowledgement, and release. Prove exact chunks/hash,
  reference pins, `requires-persistence`, no cleanup before the matching receipt or discard
  tombstone obligations, and cleanup afterward.
- Enable rapid-input rows separately: contiguous insertion accumulation, backspace within the
  pending draft, a structural command behind pending text, source save/autosave barriers, file
  switch retention, close with a blocked draft, IME update/cancel/one-time commit, and no lost input
  after rejection.
- Enable `nearest-owner-eol-v1` one red row at a time for Enter and every enabled structural
  planner: nearest preceding, following fallback, document-frequency winner, first-occurrence tie,
  no-EOL LF, CRLF atomicity, mixed owners, and policy change/retry/recovery. Retained and pasted
  EOLs remain byte-for-code-unit exact; the journal proves the chosen token is never recomputed.
- Change each `AuthoringConfigurationV1` field independently, then in combinations, and prove a
  durable coalescence-breaking session transition with the complete frozen before/after values,
  no parse reinterpretation, no semantic-hash or source change, no document undo entry, and exact
  journal/checkpoint/restart recovery. Each generated-token command records the complete value and
  chosen spelling; stale worker requests carrying an older value cannot publish.
- Drive Cut through its pre-commit clipboard gate one failure at a time: partial MIME write,
  explicit failure, lost/duplicate/late confirmation, outcome unknown, cancellation, timeout,
  stale selection, crash before/after confirmation ingress and commit sync, Track Changes, Source
  mode, and read-only Original/Revised. `CutClipboardPort` deduplicates the exact operation ID plus
  bundle digest and returns its recorded receipt without rewriting a clipboard that may since have
  changed. Only that matching receipt authorizes one deletion commit; every other outcome preserves
  canonical source/history and may be copy-only. See ADR-0012.
- For batched tickets, cancel the first, middle, and last member both before start and in flight,
  then force cancel/commit races. Prove unaffected tickets retain order and settle once;
  `RetryPending` and confirmed `DiscardPending` are separate red-green rows.
- At the worker-start frontier, start insertion `a`, queue `b`, backspace only pending `b`, then
  enqueue a structural command before `a` settles. Assert every overlay frame, ticket result, final
  source/caret, queue order, and history group. Test the entirely pre-start net-zero pair
  separately.
- Exercise composition in pending snapshots through save, autosave, close, file switch/unmount,
  prior queued text, and a later structural command; no barrier may omit visible uncommitted
  composition.
- Drive Source mode through chunked begin, acknowledged delta, stale-base/hash rejection, gap
  resync, diagnostics by draft version, renderer crash/unmount, file switch, Commit-by-ID/hash,
  cancel, invalid candidate retention, and SourceOnly reduction. CodeMirror's string is never
  submitted as authority.
- Admit input while the worker is `recovering`, prove exact echo/retention with no canonical commit,
  then drain it in order after verified rematerialization; flush must return the typed recovering
  block.
- Delay a worker past 750 ms and crash/retry before append while admitting two compatible keystrokes
  20 ms apart; both rows must preserve the same admission-time history group.
- Enable one real-browser row at a time for text insertion/deletion, selection, inline formatting,
  links, paragraph split/join, headings, quotes, and thematic breaks. Each ordinary session planner
  goes green first, its Track Changes interaction row second, and its browser row third.
- Simulate sidebar unmount, view/file switch, unrelated edit, overlapping edit, and async completion
  one at a time without losing or retargeting a draft.

**Green**

- Complete `DocumentSession`, source-transaction history, model selections, `ReviewDraft`,
  `SourceDraft`, `SessionTransition`, the single host-owned `EffectRunner` integration, two-stage
  admission, causal client stream, acknowledged terminal-outcome ledger, serialized worker protocol,
  pending-input overlay, SourceMirror delta/resync protocol, and DOM adapter for the enabled slices.

**Exit**

- Core integration tests execute complete editing/draft lifecycles without a browser. The live
  subset proves DOM is a projection and save reads session source. New-engine documents cannot
  invoke legacy writes for these families.
- Every ticket and lifecycle/lease operation settles exactly once; no stale result publishes; save
  and close cannot omit visible or acknowledged input; IME produces zero or one canonical source
  transaction; and renderer parsing work is zero by dependency/runtime proof.

### Phase 5 — incremental equivalence and deterministic resources

**Red**

- Enable randomized edit seeds one at a time, comparing the defined observable revision/transition
  result with a clean full parse.
- Enable deep, wide, malformed, literal-heavy, and projection-repair-heavy doubling rows one at a
  time. The last family constructs `O(n)` independently unsafe and causally cascading joins and
  asserts `R <= D <= N`, no candidate ordinal consumed twice, at most two whole-candidate Profile
  runs, `O(N + R)` operations/allocations excluding requested cause-list expansion, and
  byte-identical shared repair traces across full, incremental, and restarted execution.
- Enable exact `desktop-v1` boundaries: Markdown depths 127/128/129, CM depths 12,000/16,384/16,385,
  source units 31,999,999/32,000,000/32,000,001, and node count 1,999,999/2,000,000/2,000,001.
- For `N` sequential Substitutions, prove exactly `N` `CriticNode`, `2N` `ArmNode`, and `3N`
  `MarkerNode` events plus only the manifest-defined linear Markdown/projection events. Nested and
  sequential doubling must remain linear and must never allocate or enumerate `2^N` arm
  combinations. Full, incremental, and restarted parses must hit the same first budget boundary.
- Prove definitions created in an arm remain in that arm and cannot affect suffix syntax,
  reference resolution, or canonical ownership.
- Before those generated boundaries, enable every literal `syntax-accounting-1.yml` trace one at a
  time and compare the ordered `BudgetEvent` kind/range/key list—not physical object counts—across
  clean full, incremental, checkpoint-restarted, and green-node-sharing implementations. Mutating a
  helper allocation must leave the trace unchanged; changing one manifest maximalization rule must
  fail under the old accounting ID and require a new ID.
- Prove full and incremental parses hit the same first logical-count boundary; SourceOnly→Complete
  succeeds after `reinterpret` with a larger budget, while a failing Complete→Complete reinterpret
  leaves the mounted revision unchanged.
- At CM depth 16,384, enable one revision-owned boundary cell at a time for Original/Revised
  projected source and CST, Comment subdocument presentation, `ReviewIndex`, and each of the three
  active-view `LiveRenderPlan`s requested one at a time. At 16,385, the same fixtures must return
  SourceOnly with no semantic facade or plan. Use pure same-kind and mixed all-five nests, with
  Comment at outer, inner, and alternating levels.

**Green**

- Add persistent green nodes, parser checkpoints, safe predecessor restart, suffix convergence,
  interval indexes, lazy projection trees, and subtree sharing only after profiling the live slice.
- Fall back internally to a clean full parse when incremental convergence is unavailable; never
  publish a stale or observably different result.

**Exit**

- Incremental/full differential fuzz is observably equivalent and every deterministic limit returns
  the specified complete/source-only/rejected outcome.
- Every enabled maximum-depth projection/index/live-plan cell is iterative, completes without stack
  overflow, preserves exact provenance, and never leaks Comment payload into prose or an editable
  position. SourceOnly disables every semantic cell by type and runtime contract.
- Instrumented operation, allocation, and parser-call counts scale linearly; doubling is at most
  2.25×. Separately, a 4,096-line document opens within 5 seconds and interaction p95 remains below
  500 ms as wall-clock artifact ceilings.

### Phase 6 — materializers, file persistence, and security boundaries

**Red**

- Make native persistence feasibility the first gate: real-filesystem kill-point tests on macOS,
  Windows, and Linux prove target-capability resolution, exclusive temporary creation, file and
  namespace durability, symlink preservation, hard-link-entry independence, supported case/Unicode
  aliases, and packaged native-module loading in every official artifact. A dependency gate proves
  the document-save adapter never imports `write-file-atomic`; unsupported capability fails closed.
- Continue the checked-in 16,384/16,385 cross-consumer resource matrix one cell at a time through
  each form's defined individual command (Accept/Reject for Addition/Deletion/Substitution; Remove
  Highlight; Edit/Remove Comment), Accept All, Reject All, clipboard bundles, static/styled HTML,
  PDF, captured print, search, count, and exact persistence. A 16,384 complete revision must serve
  each semantic consumer without recursion failure or hidden-Comment leakage. A 16,385 SourceOnly
  revision must make every semantic consumer unavailable or return the one typed diagnostic; exact
  persistence alone remains enabled and writes every source unit.
- Enable each pure revision-consumer cell of the checked-in policy matrix one at a time:
  static/styled HTML, PDF, print, word/character count, search text, and clipboard serialization
  where no unimplemented editor command is required. The complete matrix still includes normal Copy,
  Copy Rich, Copy HTML, Copy Markdown, cut, paste, search/replace, source mode, and
  Markup/Original/Revised enabled/read-only policy; command-dependent cells wait for their Phase 7
  session/browser slice.
- Enable each file-backed corpus row one at a time through open → no-op save → second save → reopen,
  edit/save/reopen, and autosave/reopen. Required rows are all five forms, nested/block-spanning,
  malformed recovery, BOM+CRLF+astral, escaped repeated table cells, all four front-matter forms, hostile
  cross-block content, no-final-EOL, and repeated blank lines.
- Start r1 and r2 saves to the same target in both registration orders and interleave
  intent/temp-identity sync, target-ordinal publication, exclusive temporary creation, partial/full
  temporary write, temp fsync, prepared sync, pre-rename validation, rename, directory fsync,
  applied sync, receipt, acknowledgement, and cleanup at every legal pair of boundaries. Crash after
  temp creation and after partial/full write but before `SavePreparedV1`, and prove restart/discard
  removes the exact intent-owned orphan idempotently. Crash at each single boundary and reconcile
  exact target bytes/generation/ receipt. A newer target ordinal immediately suppresses every older
  rename; an older rename can never terminally supersede the newest, whose unpersisted watermark
  remains visible until durable success or failure. Repeat with r3 arriving during retry, two Save
  As targets to prove independent generations, two sessions aimed at one target,
  path/symlink/hard-link/case/ Unicode names (including hard-link entries remaining independent),
  and stale-generation/failed-write/failed-rename/ reconciliation-failure/adapter-abort rows.
- Enable each hostile vector—script, event attribute, unsafe scheme, hostile image field,
  quote-breaking title, raw HTML, nested Comment payload, and cross-block payload—at every
  applicable branded HTML sink one at a time.

**Green**

- Implement typed materializers and opaque sink-branded `TrustedHtml` factories.
- Implement a packaged native `DurableReplaceAdapter` whose opaque `NativeTargetCapability` owns
  target resolution, staging, atomic replacement, directory/namespace durability, identity evidence,
  reconciliation, and discard. TypeScript retains leases, encoding, target ledger, ordinals, and CAS
  policy. No unresolved path is used after resolution and only serializable evidence—not native
  handles—enters the journal. Official builds fail closed rather than silently weakening the
  contract. See ADR-0011.
- Implement desktop `FileSnapshot`, composite `preparePersistence`, encoding/BOM policy, exact no-op
  byte reuse, destination-entry registry, durable save-intent/reconciliation, per-target
  generation/CAS arbitration, monotonic receipts, autosave, and explicit unrepresentable-character
  flow.
- Integrate Phase 4's already-green journal/recovery/compaction protocol with owner-only app-data
  permissions, desktop startup discovery, and cleanup after a clean persisted close or completed
  discard tombstone; Phase 6 does not reimplement its framing or compaction semantics.
- Move desktop read paths one vertical slice at a time; remove their legacy parser/renderer once
  migrated.

The native boundary is deliberately narrow:

```ts
type NativeTargetResolution =
  | Readonly<{
      kind: 'resolved'
      targetId: FileTargetId
      capability: NativeTargetCapability
      evidence: TargetEvidence
    }>
  | Readonly<{
      kind: 'unsupported' | 'stale-target' | 'resolution-failed'
      diagnostic: PersistenceDiagnostic
    }>

interface DurableReplaceAdapter {
  resolveDestination(path: string): Promise<NativeTargetResolution>
  reacquire(recorded: RecordedTargetIdentity): Promise<NativeTargetResolution>
  stage(
    target: NativeTargetCapability,
    temp: TempIdentity,
    chunks: AsyncIterable<Uint8Array>
  ): Promise<StagedWriteReceipt>
  replace(
    target: NativeTargetCapability,
    staged: StagedWriteReceipt,
    expected: TargetEvidence
  ): Promise<NativeReplaceResult>
  reconcile(
    target: NativeTargetCapability,
    record: PreparedReplaceRecord
  ): Promise<NativeReplaceResult>
  discard(
    target: NativeTargetCapability,
    record: StagedWriteReceipt
  ): Promise<void>
}
```

**Exit**

- No migrated sink parses CM privately or accepts unbranded HTML. Persistence never touches a
  render/materialization path.
- Actual PDF and captured print artifacts, not only HTML precursors, prove the selected projection.
- The completed cross-consumer resource matrix proves the 16,384 boundary through every semantic
  consumer and the 16,385 SourceOnly cutoff through every disabled consumer plus exact file
  persistence.

### Phase 7 — complete live editor command families

New-engine documents are selected at open and never dual-written. A temporary one-way
revision→legacy-view adapter is allowed for rendering; it may not infer write-back or call legacy
mutation.

The numbered groups below define order, not batch size. Within each group, take one literal
command/gesture cell red and green; take its Track Changes cell red and green when applicable; then
take its browser and consumer-policy cells red and green. Make that legacy write entry unreachable
for new-engine documents before selecting the next cell.

1. lists and task lists;

2. tables;

3. code, math, diagrams, HTML, footnotes, and references;

4. paste/cut and clipboard variants;

5. drag/drop and images;

6. full browser/platform IME and composition across inline, structural, hidden, and boundary
   contexts;

7. find/replace and search/count behavior;

8. full CodeMirror source mode, document replacement, and parser-option changes.

Unsupported commands reject visibly during development. They never mutate the legacy model behind
the new session.

**Exit**

- Every editor command originates as an intent; the live DOM is a projection.
- Save reads exact session source, not serialized blocks.
- Every row of `track-changes-interactions.tsv` and the consumer-policy matrix is green; no late
  family relies only on the foundational Phase 3 rows.

### Phase 8 — complete Track Changes and Review UX

**Red**

The following is an ordered queue. Each numbered capability gets its own confirmed red and minimum
green before the next test is written:

1. collapsed, hidden, stale, crossing, partial-CM, literal-inside, literal-partial,
   literal-source-only, and zero-prospective-contribution Add Comment targets each reject without
   opening a composer or authoring a bare Comment;

2. Add Comment positively wraps a selection containing complete nested CM as
   `{=={++new++}==}{>>note<<}` and the full visible contribution of every applicable selectable
   Markdown literal provider variant, widening to exact owner boundaries with literal projections
   and no flattened child; nonvisible provider variants have typed source-only/inapplicable
   rejection rows instead;

3. Add Comment positively wraps a complete Substitution, including its owned `~>`, only when its
   revised arm contributes, with no marker-target rejection or flattened child; the empty
   revised-arm counterpart rejects;

4. Mark Highlight positively wraps a different complete nested CM selection as `{=={--old--}==}`
   even though the complete Deletion has no root-Revised contribution, with literal projections and
   no flattened child. Three sibling direct-authoring rows independently take `MarkAddition`,
   `MarkDeletion`, and `SuggestReplacement` red then green through the real menu/command-palette,
   session, worker, renderer, undo/redo, and desktop-reopen boundaries. Each proves its literal
   wrapper, complete-CM and complete-literal-owner cases, form-specific contribution gate,
   partial/hidden/stale rejection, semantic replacement encoding (including empty replacement), and
   independence from the Track Changes toggle;

5. a valid nonempty selection opens a focused sidebar composer and no modal;

6. each raw Comment payload fixture—including nested syntax, protective syntax, active closer,
   whitespace, empty, CRLF/bare-CR/LF/mixed-EOL no-op and edit, nearest-owner Enter choices, paste,
   recovery, and undo—gets its own Add/Edit result and retained rejection proof;

7. submitting writes exact `{==sel==}{>>note<<}` through the desktop file path and hides the Comment
   body from prose;

8. an anchored Highlight is visually distinguishable from a plain Highlight;

9. Review shows exactly one Comment card and no separate anchor Highlight card; a nested Comment in
   that card's raw payload remains exact but is not promoted to a second main Review card/action,
   and outer raw editing plus Source mode can still address it;

10. an anchored card shows payload plus anchor preview, while a standalone Comment card shows an
    explicit unanchored state and remains removable;

11. comments and changes occupy one flat list with no Comments tab or section;

12. clicking a Comment card enters in-place editing without focusing or jumping the document;

13. edit commit changes only the raw Comment payload; invalid/empty commit retains the draft; exact
    undo/redo restores both valid revisions;

14. Remove Comment on an anchored card unwraps the Highlight, retains its exact payload source
    including nested CM except for minimum delimiter protection or a provenance-bearing
    `BofTextCodecV1` offset-zero repair, and deletes the Comment in one transaction;

15. direct root-effective whole-anchor deletion yields the exact bare Comment, and one undo/redo
    restores/reapplies the exact source;

16. tracked root-effective whole-anchor deletion yields the exact outer Deletion, correct context,
    Accept/Reject sources, and history lifecycle;

17. an anchor in Addition and Substitution-new carriers follows each exact
    direct-without-redundant-Deletion outcome with tracking both off and on;

18. root-effective anchors with nested Addition, Deletion, Substitution, or Highlight copy those
    complete descendants exactly through the tracked lifecycle and retain untargeted residual nodes
    under direct exhaustion;

19. an anchor containing a hidden Comment descendant at root, in Addition, or in Substitution-new
    visibly rejects direct/tracked whole and final-contribution deletion with exact source/history
    preservation;

20. sequential partial then final anchor deletion under Track off/on—including a prior nested
    tracked edit and cascading nested-Highlight exhaustion—proves the residual-preserving direct
    result, one exact outer-Deletion Reject restoration, Accept, every undo/redo state, and fresh
    adjacency context without a sentinel;

21. `precedingChange` is derived after Addition, Deletion, Substitution, and Highlight, while only
    the frozen ancestor-net root-Revised contribution classifier grants the one-card anchor UX;

22. passive selection marks the containing Comment active only when no deeper visible Review item
    owns the hit, chooses the innermost nested anchor, and never opens, scrolls, focuses, or edits;

23. a caret/pointer hit in nested Review content activates the deepest item visible in the mounted
    view—including Original-only content in Markup/Original—while explicit card/navigation focus can
    select its parent and remains there while that target survives;

24. a real event-scoped right-click opens Edit Comment and rejects stale or wrong-frame responses;
    nested rows preserve the deepest change/Highlight actions while Edit Comment targets the nearest
    containing anchor from the authenticated hit ancestry;

25. mouse, arrow, restore, target-range, and IME paths cannot enter hidden Comment source;

26. each legal/illegal command-matrix action gets the correct localized label, enabled state,
    result, and rejection; individual/all resolution parity uses the same session and the frozen
    BOF/middle/EOF matrix;

27. list-item and block-spanning contextual targeting, nested previous/next navigation, focus
    restoration, and Markup↔Original/Revised projection handoff each pass their own browser row;

28. the native Review menu dispatches the same typed intent and observes the same result/rejection
    through the real Electron boundary;

29. the command palette dispatches that intent and observes the same result and focus behavior
    through its real UI boundary;

30. the contextual Review tool targets the parser-selected item and dispatches the same
    command/result through a real browser boundary;

31. with the sidebar rail visible, clicking its Review icon opens the panel;

32. with panel and icon rail completely hidden, a pointer-only row clicks the persistent in-window
    Review control and reaches the panel without a keyboard, command palette, or starting an edit;
    the editor's focus and model selection are unchanged after the pointer activation;

33. a real-gesture authoring matrix covers same-paragraph and cross-paragraph × mouse and keyboard
    selection. Synthetic DOM Ranges, programmatic selection, `test.fixme`, and transitive coverage
    cannot satisfy any cell; and

34. draft conflict retention, nested/block-spanning Review, bare standalone lifecycle, actionable
    rejection, and each remaining Comment/Review row in this plan's product acceptance mapping enter
    separate cycles rather than one aggregate red.

Only after all rows are green, add one already-supported fresh-state journey as a regression: select
→ compose → exact pair/distinct anchor/one card → edit → remove with exact Highlight payload
retained. That journey must be green on its first run; it is not a large substitute red.

**Green**

- Make Vue/Pinia, native menu, context menu, command palette, and persistent mouse control thin
  consumers of session snapshots/intents.
- Move comment drafts into the session and remove copied target tuples and parser logic from IPC/UI
  layers.

**Exit**

- Every Comment UX outcome in this plan passes in a freshly built desktop app with real pointer and
  keyboard events. No test pre-seeds the final document state to skip creation.
- Dedicated accessibility expansion remains out of scope; this phase proves the concrete pointer,
  keyboard/caret, focus, and non-focus-stealing behaviors specified by this plan.

### Phase 9 — cut over and delete the old engine paths

**Red**

- For one deletion-manifest row at a time, take its caller/reference gate red, migrate or remove the
  last caller, delete that exact path/symbol, and return the focused plus existing deletion suite
  green.
- After all rows are green, take the default-engine/feature-flag gate red and remove the final
  legacy selection path.

**Green**

- Make the new session the default, remove the feature flag, remove obsolete tests, and regenerate
  licenses/dependency metadata only after each manifest row has completed its own red-green deletion
  cycle.
- Delete the patched Marked fork, its patch/manifest scripts, and every document-language adapter.
  If a named non-document utility still needs Marked, migrate only that utility to the stock pinned
  dependency and prove by package-boundary/runtime gates that no editor, session, parser, render
  plan, materializer, or persistence path imports it.

**Exit**

- There is one authority and one production parser path. The old system cannot be re-enabled by
  configuration or a forgotten adapter.
- Every deletion-manifest path is physically absent or, for a retained non-document utility, moved
  to an explicitly allowed manifest with zero document-language callers.

### Phase 10 — final automated closure

Run long suites using the observable-test workflow, sequentially where the repo requires it.
Evidence must come from the final clean tree and include:

- core unit, corpus, property, differential, mutation, and incremental/full equivalence tests;
- CommonMark/GFM/MarkText-extension conformance;
- Muya/browser integration and desktop unit tests;
- Muya lint, Muya CSS lint, typecheck, circular-dependency, root/desktop lint, Vue typecheck,
  license, dependency-boundary, and manifest-schema gates;
- a fresh `build:unpack` followed by E2E against that build with zero captured renderer/main errors
  and deterministic stale-bundle rejection;
- presentation preflight plus one hidden, unfocused, low-priority, one-worker Electron run under the
  documented background scheduler, with no Dock/focus/ window takeover;
- actual generated PDF plus deterministic captured print document;
- the complete file-backed persistence/corpus matrix through the actual desktop adapter;
- a fresh native distributable installed or mounted in an isolated location and packaged automation
  against that artifact, not only unpacked output. It opens every required corpus class; authors all
  five forms; performs tracked inline and structural edits; resolves each type and Accept/Reject
  All; switches all three views; exercises clipboard, search, and source mode; saves, autosaves,
  reopens, undoes, and redoes; and produces HTML, actual PDF, and captured print output. The focused
  comment lifecycle is one row inside this workflow, not a substitute for it;
- named macOS arm64, Windows x64, and Linux x64 jobs, each building the app and running its platform
  Review menu/keybinding tests;
- a negative dependency/runtime proof that the patched Marked fork and its patch/manifest machinery
  are absent and that any stock Marked dependency has no editor/session/materializer caller;
- performance artifacts with machine metadata and doubling ratios;
- the maximum-accepted-document leading-delimiter edit: renderer admission ≤50 ms, pending echo
  within two frames, a second input admitted/echoed while the worker is busy, cooperative cancel
  acknowledgement ≤100 ms, exact committed source, and no stale result. From `beforeinput` through
  worker work, structured-clone transfer, envelope checksum/delta staging, atomic client swap, and
  matching current-viewport DOM-plan mount ≤10 seconds, no animation-heartbeat gap may exceed 100
  ms; payload sizes and each phase timing are retained;
- final synchronization of local `develop`, `origin/develop`, and `upstream/develop`, followed by a
  merge-forward rerun if upstream advanced;
- documentation/profile/ADR consistency audit;
- user documentation and release notes verified against the built artifact, covering the five
  forms, Track Changes, Original/Revised projections, Accept/Reject/Remove, Source mode,
  save/autosave, copy/export policy, interoperability limits, and the explicit external-file
  concurrency non-goal;
- a merge-base audit of every tracked and untracked branch file, removal of generated/unrelated
  artifacts, and proof that `.vscode/settings.json` was not modified or staged by this work;
- an evidence-gated completion audit of every claim in this plan.

For each gate, retain the exact commit and dirty state, command/environment, test identities and
pass/fail/skip counts, duration, captured app errors, resource measurements, and artifact path/hash
where applicable. Skipped, quarantined, source-shape-only, retried-until-green, silently timed-out,
or unexecuted gates are not evidence.

Manual dogfooding is not in this gate.

### Phase 11 — perceived latency (0-lag typing), sequenced AFTER the correctness rebuild

This phase exists because a distinct goal was being conflated with the rebuild: **"clean O(n) full
parse" is not "0-lag from the user's point of view."** The rebuild (Phases 0.5–10) delivers a correct,
single-authority, dependency-free engine whose *full* parse is O(n). Perceived zero lag is a separate,
*incremental-computation and scheduling* problem, and it is deliberately sequenced **after**
correctness — you cannot make an incremental parser trustworthy on top of an architecture that
reconstructs provenance after the fact.

Evidence base: `specs/research/0001-incremental-markdown-criticmarkup-parsing-for-zero-lag.md`
(23 primary sources, adversarially verified). The ecosystem achieves low lag with four techniques;
none is "make the full parse faster." Two findings reshape the naive approach: (a) **no** surveyed
editor runs the Markdown/CriticMarkup parse in a Web Worker — the win is main-thread **time-slicing**;
(b) **no** primary source has ms/keystroke benchmarks — so this phase is **measurement-gated**, not
architecture-first.

**Two perf facts specific to this engine, both verified in-tree:**

- **Eager comment-display projections are O(comments × n).** `createCommentDisplayProjections` runs one
  full per-view parse *per comment* on every `open()`. A review tool is slowest exactly when most
  used. No upstream solves this because no surveyed editor emits per-view projections at all — it is
  ours alone to fix.
- **Fragment reuse is unsafe until "emit-don't-reconstruct" (Phase 0.5 Track B) lands.** Incremental
  reuse is only correct when gated on a context key that includes parser-created provenance and lane
  state. While provenance is *reconstructed after* the parse (today's 1,198-LOC layer), reuse would
  resurrect stale provenance. So Track B is the **precondition** for any incremental parsing — the
  correctness rebuild and the eventual 0-lag work are the same road, in order.

**Ordered, measurement-gated steps** (each keeps the automated suite green; the first two are cheap and
independent of everything):

1. **Time-slice the canonical parse against a deadline; parse the viewport first.** Adopt the proven
   `startParse`/`advance`/deadline pattern (Lezer/CodeMirror `ParseContext.work`) with
   `requestIdleCallback`/`isInputPending` scheduling. Bounds per-keystroke cost without any incremental
   algorithm and without a worker. **Highest value, lowest risk — do first.** Not a Web Worker: our
   provenance/projection reads are synchronous, so off-thread parsing risks projection tearing for no
   evidenced gain.
2. **Make comment-display projections lazy and revision-keyed** — materialize a comment's display only
   when the sidebar renders it, cached by revision. Removes the verified O(comments × n) blow-up.
   Independent of the rebuild; land it whenever.
3. **Measure before building incremental parsing.** No source (and not this project) has ms/keystroke
   numbers. Time a viewport-slice parse on a realistic corpus (~100 KB document; ~30 KB / ~50-comment
   document) on target hardware. Crossover: viewport-slice parse **< ~8 ms → time-slicing + lazy
   projections is sufficient; do not build incremental parsing** (likely for typical documents).
   Residual stall **> ~16 ms even viewport-first → proceed to step 4.**
4. **Add fragment reuse to the canonical parse, only if step 3 demands it.** Study `@lezer/markdown`'s
   `TreeFragment` reuse contract and reimplement it (do not depend on it). Gate reuse on a context key
   that includes provenance/lane state (per the precondition above), and expect CommonMark non-locality
   (unclosed fence, lazy continuation, reference definition) to force a bounded reparse-suffix on those
   edits — scope reuse to the common intra-block edit, with a reparse-to-bounded-suffix fallback for
   the non-local cases. This is the hardest, most bug-prone lever; take it on last and only against
   evidence.

**Acceptance:** a real-gesture typing benchmark (sustained input on the realistic corpus) shows no
frame exceeding the budget from step 3, with the automated suite and all invariants (especially
invariant 7, full ≡ incremental equivalence) green. Block-locality — the ecosystem's cheapest lever —
is unavailable here by product choice (we support cross-paragraph CriticMarkup), which is *why* the
other three levers carry the whole load.

## Product acceptance mapping

| Requirement                                         | Required automated proof                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intrinsic Profile 1 Markdown grammar                | Public canonical-graph fixtures plus `ProfileParseTraceV1` prove native CM node/event identity, shared Markdown/CM literal and delimiter decisions, CM across blocks, Markdown across CM boundaries, self-contained Substitution arms, nested/sequential Substitutions, arm-scoped references, exact provenance/ownership, explicit source/event/projection provenance for generated or rejected records, and full/incremental equivalence; dependency/runtime gates prove no CM-only scan, CM-first driver, forest reconstruction, post-hoc semantic join, or flattened projection parse establishes authoritative syntax |
| Five CM forms and projections                       | Standard/Profile corpora, recursive 7×5 projection matrix, all-five nesting fixture, and literal projection properties                                                                                                                                                                                              |
| Boundary-safe projection/resolution                 | Protective escape; retained-decision/survivor manifest; linear whole-candidate guarded run; responsible delimiter for retargeted nodes; one clean verifier parse; exact shared causes/affinity; `O(n)` unsafe-join scaling; idempotence, survivor-set, Accept All, and Reject All with literal expected source      |
| Boundary-safe semantic editing                      | Every CM/Markdown delimiter split across inserted/retained and retained/retained joins; complete-vs-partial CM/literal enclosure; atomic literal-owner editing; exact-empty cleanup; literal canonical/projected/meaning expectations; no synthetic, duplicated, or retargeted node                                 |
| Exact core source                                   | Code-unit identity over BOM/EOL/trivia/malformed/Unicode variants; source-only U+FEFF grammar matrix; versioned Source/File/Semantic hash known answers; persistence reads revision source by identity                                                                                                              |
| Exact desktop persistence                           | File-backed no-op save×2/reopen, edit/save/reopen, autosave, pinned lease, native target-capability aliases, packaged native-module loading/fail-closed unsupported-capability proof, durable save-intent crash/reconciliation, all target-ordinal/write/rename/ack CAS orders, discard tombstone races, distinct Save As, monotonic receipts with byte/encoding/BOM evidence |
| View and source-mode persistence                    | Save/autosave in Markup, Original, Revised, and Source; WYSIWYG↔Source no-op handoff; every path persists the same committed canonical revision                                                                                                                                                                     |
| Track Changes                                       | Full source-native mutation taxonomy defined above across all forms × arms/boundaries × plain/empty/nested/block-spanning shapes; atomic literal owners; exact captured operations and source-edit composition; one semantic history entry; exact undo; projection/locality laws                                    |
| Mutation failure and rejection                      | Preparation, composition, parse/resource, postcondition, mapping, journal, publication, observer, and effect injection matrix with atomic pre-commit failure, exact crash recovery, and one localized actionable non-focus-stealing rejection where applicable                                                      |
| Malformed, nested, block-spanning, literal contexts | Profile/recovery corpus, every frozen manifest boundary, and property tests                                                                                                                                                                                                                                         |
| Deterministic resource boundary                     | Versioned `syntax-accounting-1` traces, 16,384/16,385 cross-consumer matrix, exact other budget edges, full/incremental first-failure identity, no stack overflow/leakage, and SourceOnly semantic disablement plus exact persistence                                                                               |
| Type-safe resolution and undo/redo                  | Change forms Accept/Reject; annotations Remove/Edit as defined; BOF/middle/EOF individual-vs-bulk semantic parity and exact no-protection parity; no legacy junction normalization; fresh transitions after reinterpretation; exact history for every structure                                                     |
| Comments hidden from prose                          | Render-position-map tests plus real browser mouse/keyboard/IME tests at arbitrary nesting depth                                                                                                                                                                                                                     |
| Comment context and anchor deletion                 | Gapless context after all four relevant forms; frozen root-Revised contribution atoms; root/pending exact outcomes; residual nested-node survival; global nested-Comment rejection; sequential partial/final Track off/on/undo/redo and adjacency matrix with no sentinel or data loss                              |
| Sidebar composition and cards                       | Nonempty selection opens a focused composer; anchored card shows payload plus anchor preview; standalone Comment shows explicit unanchored state; flat list has no duplicate Highlight card                                                                                                                         |
| Raw Comment command input                           | Add/Edit fixtures for nested CM, protection, active outer closer, whitespace/empty, CRLF/bare-CR/LF/mixed-EOL no-op/edit/Enter/paste/recovery, exact retained drafts, target survival, and payload-only undo                                                                                                        |
| Sidebar create/edit/delete                          | One contiguous fresh-state E2E proving no modal, distinct anchor, one card, in-place edit, flat list, and prose-retaining removal                                                                                                                                                                                   |
| Exact Add Comment persistence                       | Real desktop authoring and file reopen prove exactly `{==sel==}{>>note<<}` with no private bytes or normalization                                                                                                                                                                                                   |
| Add Comment validity and gestures                   | Collapsed/hidden/stale/crossing/partial-CM/inside-literal/partial-literal/zero-contribution targets reject; positive Add Comment/Highlight wraps complete nested CM/literal owners; same/cross-paragraph × mouse/keyboard real-selection matrix                                                                     |
| Passive selection                                   | Browser tests proving deepest visible item/innermost anchor versus persistent explicit parent focus, without open, scroll, focus jump, or edit                                                                                                                                                                      |
| Native context-menu edit                            | Event-scoped Electron E2E with authenticated nested hit ancestry, deepest-item actions, nearest-anchor Edit Comment, and stale/wrong-frame rejection                                                                                                                                                                |
| Contextual Review and navigation                    | List-item/block-spanning targeting, deterministic deepest-hit versus explicit parent focus, nested previous/next, focus restoration, and Markup↔Original/Revised projection handoff each have an independent browser row                                                                                            |
| Review command surfaces                             | Native menu through Electron, command palette, and contextual Review tool each dispatch the same typed intent and observe the same result/rejection at their real boundary                                                                                                                                          |
| Mouse Review access                                 | Separate real-pointer rows for the visible-rail Review icon and the persistent in-window control with panel and rail fully hidden; persistent-control activation preserves editor focus and selection                                                                                                               |
| Draft and asynchronous input safety                 | Durable-before-paint admission, ambiguous-send reconciliation and gap tombstones, frozen wire hash/outcome envelopes, SourceDraft delta/resync, unmount/file switch/rebase/overlap/rapid typing/IME/cancel/recovery, all-draft preparePersistence gates, targeted CancelClose/final fences, exactly-once settlement |
| Menu semantics/localization                         | Command-presentation contract tests for every legal/illegal item action and locale                                                                                                                                                                                                                                  |
| Consumer projection policy                          | Every frozen Markup/Original/Revised × copy/cut/paste/search/replace/count/source/export/PDF/print cell, including raw/live/note/elided Comment handling                                                                                                                                                            |
| HTML security                                       | Sink-specific opaque `TrustedHtml` type tests, hostile fixtures at every boundary, and actual artifacts                                                                                                                                                                                                             |
| Performance and renderer responsiveness             | Deterministic scaling and ceilings plus maximum-document leading-delimiter heartbeat through worker, structured clone, checksum/delta staging, atomic swap, and current-viewport DOM mount                                                                                                                          |
| Installed comment workflow                          | The complete select → focused compose → exact persisted pair → distinct anchor/card → edit → remove/save/reopen flow against a freshly installed or mounted distributable, not only unit tests or unpacked smoke                                                                                                    |
| Installed full CriticMarkup workflow                | The installed/mounted artifact opens every corpus class; authors five forms; performs tracked inline/structural edits; resolves individual/all; switches views; exercises clipboard/search/source; save/autosave/reopen/undo/redo; and emits HTML/PDF/print                                                         |
| Platform readiness                                  | Fresh hidden/unfocused build and named macOS arm64/Windows x64/Linux x64 build plus Review menu/keybinding jobs                                                                                                                                                                                                     |

Tests that inspect filenames, helper names, line counts, or regex-match source text are not proof of
these behaviors. Architectural boundaries should be enforced by package dependency rules, public
type tests, runtime seam spies, and deletion of forbidden APIs.

## Definition of done

This plan may close only when all of the following are true:

1. The exact canonical source and immutable `DocumentRevision` are the sole document authority in
   every production editor flow.

2. The MarkText CriticMarkup Profile is documented, versioned, and backed by separate
   standard/profile/recovery corpora.

3. The sole authoritative parse is an intrinsic MarkText Markdown Profile 1 parse with native CM
   productions. Its atomic lossless syntax graph creates all Markdown/CM identity, precedence,
   provenance, ownership, arm boundaries, references, and diagnostics; the CM forest, projections,
   mappings, Comment/Review products, transformations, and render plans are derived from it without
   a CM sidecar, post-hoc semantic join, or authoritative flattened-string reparse.

4. All mutations originate as typed source-native intents and commit atomically.

5. The live editor uses the session/`LiveRenderPlan` seam, each static consumer uses its typed
   materializer, and persistence reads revision source directly.

6. The legacy deletion manifest is complete; no rebinding, trivia weaving, mutation inference, dual
   history, or private CM parsing remains callable.

7. Every mapped automated proof passes on the final tree, including the real mouse-only
   hidden-sidebar path.

8. Lint, typecheck, conformance, unit, property, browser/Electron, fresh-build, packaged,
   performance, security, PDF/print, and platform gates are green.

9. User docs, architecture, glossary, ADRs, plans, release notes, and actual UI behavior agree
   without portability overclaims. User-facing documentation covers the five forms, Track Changes,
   Original/Revised projections, Accept/Reject/Remove, Source mode, save/autosave, copy/export
   policy, interoperability limits, and the explicit external-file concurrency non-goal.

10. A fresh completion audit marks every claim proven. Historical green runs, checked boxes, and
    implementation summaries are not sufficient evidence.

11. `specs/architecture/archive/` is deleted. Those records (`criticmarkup-legacy-engine.md`,
    `criticmarkup-corpus-boundary-matrix.md`) exist only as migration/deletion oracles for the engine
    this plan replaces; they are retained until this plan is declared done and dropped with the code
    they describe. Any row still needed at that point must already have been imported into a
    checked-in Profile 1 fixture.

## Primary upstream references

- [Canonical CriticMarkup specification](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md)
- [MultiMarkdown 6 CriticMarkup philosophy and limitations](https://fletcher.github.io/MultiMarkdown-6/syntax/critic.html)
- [MultiMarkdown 6 pairing definitions](https://github.com/fletcher/MultiMarkdown-6/blob/3f729288baccc9aa8a2c74ce1bf77adf8bd17c37/src/mmd.c#L145-L153)
- [MultiMarkdown 6 structured pairing](https://github.com/fletcher/MultiMarkdown-6/blob/3f729288baccc9aa8a2c74ce1bf77adf8bd17c37/src/token_pairs.c#L180-L225)
- [MultiMarkdown 6 CriticMarkup corpus](https://github.com/fletcher/MultiMarkdown-6/blob/3f729288baccc9aa8a2c74ce1bf77adf8bd17c37/tests/MMD6Tests/CriticMarkup.text#L28-L92)
- [MultiMarkdown 6 rendered corpus, including Markdown inside Comment](https://github.com/fletcher/MultiMarkdown-6/blob/3f729288baccc9aa8a2c74ce1bf77adf8bd17c37/tests/MMD6Tests/CriticMarkup.html#L33-L97)
- [MultiMarkdown 6 CriticMarkup renderer/parser behavior](https://github.com/fletcher/MultiMarkdown-6/blob/3f729288baccc9aa8a2c74ce1bf77adf8bd17c37/src/critic_markup.c)
- [MultiMarkdown 5 grammar (recursive change payloads; opaque Comment payload)](https://github.com/fletcher/MultiMarkdown-5/blob/193c09a5362eb8a6c6433cd5d5f1d7db3efe986a/src/parser.leg#L1587-L1684)
