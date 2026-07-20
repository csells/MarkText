# 0009 — Source-Authoritative CriticMarkup Document Engine Rebuild

- **Status:** Reviewed; ready for implementation
- **Created:** 2026-07-19
- **Branch:** `feat/native-criticmarkup`
- **Owns:** the architecture and migration needed to satisfy plans 0006 and 0007
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

This is an editor-engine migration, not a parser sidecar replacement. The existing CriticMarkup
parser, UX, fixtures, sanitizers, and E2E work are valuable as requirements, oracles, and adapters.
The current canonical-state, provenance, mutation, and rendering architecture is not the
destination.

## Relationship to 0006, 0007, and 0008

- Plan 0006 remains the product-wide production acceptance contract: all five forms, exact
  persistence, projections, Track Changes, Review operations, security, performance, platform
  builds, and final automated evidence.
- Plan 0007 remains the comment UX acceptance contract: sidebar composition, hidden bodies,
  highlighted context, edit/remove, passive selection, context-menu editing, and a real mouse path
  to Review from a completely hidden sidebar.
- This plan owns the architecture and red-green migration that make those contracts achievable
  without rebinding or reconstructed source authority.
- This plan supersedes every 0006/0007 clause that prescribes mutable Muya state,
  bindings/rebinding, parser sidecars, serializer normalization, Marked authority, legacy command
  facades, or legacy phase status. Their product outcomes and automated acceptance obligations
  remain binding.
- Their current phase statuses, checkmarks, and evidence ledgers describe the legacy implementation
  only. They are historical regression evidence and do not prove any phase of this rebuild.
- Plan 0008's local deepening suggestions are superseded where they improve modules that this plan
  deletes. A suggestion survives only if its concept is still present behind the new
  `DocumentSession` seam.
- Manual reachability walkthroughs, personal evaluation, and Print-to-PDF use are post-completion
  dogfooding. They are not checkboxes, evidence, or blockers in any of the three active plans.

## Settled decisions

1. **One authority.** An immutable `DocumentRevision` owns the exact canonical source and every
   interpretation of it. Mutable JSON state and the live DOM are not document authorities. A
   checksummed durable commit record is the serialized identity of that same logical revision during
   crash recovery, not a second semantic model. See ADR-0005.

2. **One atomic syntax graph.** A revision contains a lossless source tape, a canonical Markdown
   CST, a CriticMarkup forest, and Original/Revised Markdown CSTs with common provenance. This is a
   graph because Markdown and CM can cross each other's containment boundaries. See ADR-0006.

3. **Exact decoded source.** Parse, no-op save, autosave, and reopen preserve the decoded source
   exactly: BOM, CRLF/LF, blank lines, missing terminal EOL, marker spelling, escapes, and untouched
   trivia. Normalization is an explicit transform only. See ADR-0007.

4. **Versioned language.** Canonical CriticMarkup is the compatibility base; behavior the upstream
   prose leaves undefined is named and tested as the MarkText CriticMarkup Profile. See ADR-0008.

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

Existing scope boundaries remain: external-file concurrency and collaboration metadata are separate
efforts, and `.vscode/settings.json` is not modified.

## Language contract

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
   that elide a CM prefix before it, with following YAML/fence/heading/CM openers.

2. **All complete empty forms are syntax.** Empty Addition, Deletion, Highlight, Comment, and either
   Substitution arm are semantic constructs. They do not acquire secret sentinel meaning. App
   commands never manufacture an empty form as hidden state; source edits and imported text may
   produce one, and the revision preserves it exactly.

3. **Proper CM nesting is supported.** Same-kind and mixed-kind marks may be nested to arbitrary
   semantic depth subject only to general resource budgets. CM marks may not cross other CM marks. A
   selection-based command may wrap complete existing items but must reject partial intersection.

4. **Markdown and CM are orthogonal structures.** A CM item may span Markdown blocks, and a
   nonliteral Markdown span may cross a CM boundary. Neither hierarchy is forced into the other; the
   syntax graph records shared source provenance. For Markdown recognition inside an accepted CM
   carrier/arm, that carrier's marker/separator tokens are zero-width grammar trivia: they consume
   no virtual column, do not break BOF/BOL/indentation, and cannot themselves satisfy Markdown
   syntax. Retained payload code units and EOL tokens keep their exact order and columns. Each
   Substitution arm is a separate alternative lane inheriting the exact same pre-opener Markdown
   state—virtual BOF/BOL, indentation, open containers, delimiter state, and option profile—and both
   rejoin the one post-closer suffix; it is never parsed as old text concatenated with new text.
   Thus a root-level Substitution at virtual document BOF gives both arms BOF status and each may
   independently own YAML front matter. A leading U+FEFF virtual-BOM unit stays once outside a
   generated CM wrapper; arms inherit its post-BOM BOF state and never reinterpret or duplicate it.
   The same wrapper away from virtual BOF cannot authenticate front matter in either arm and must
   use another valid provider or reject. This is why a complete fenced block can be enclosed as
   `{==```…```==}` and still be a fenced block, and why Markdown emphasis may cross a nested CM
   boundary. The graph maps every virtual Markdown token back to canonical source; no consumer
   constructs an elided string privately. `markdown-profile-1.yml` freezes BOF/BOL, indentation,
   lazy-continuation, delimiter-run, and block open/close cases for every CM marker placement and
   both Substitution lanes, including BOM/no-BOM front matter in old/new/both arms and non-BOF
   rejection.

5. **Literal contexts win locally.** The revision freezes an exact Markdown option manifest. Under
   that manifest, the literal set is: inline code; fenced and indented code blocks; raw HTML blocks;
   inline HTML tag and attribute source; autolink targets; link/image destinations and titles;
   reference and footnote definitions; YAML front matter; inline/block math; and diagram bodies.
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
included boundary code units, interruption/termination rules, and enabled-option predicate. The
staged algorithm is fixed and non-circular: authenticate root Markdown literals; recognize a
nonliteral outer CM opener; scan its provisional payload with the containing-context Markdown
literal lexer taking precedence over nested CM; pair properly nested envelopes; and accept the
compatible outer closer. For Substitution, that payload scan remains unsplit until the first
top-level `~>` outside a literal and nested envelope is found; only then are old/new arms finalized
and parsed independently. The manifest, not an implementation helper, generates the
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
title; reference/footnote definition; YAML front matter; inline/block math node; or diagram block.
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
    lines in canonical source. For card presentation only, the processing order is exact and has two
    distinct Markdown stages: use the raw-payload Markdown literal lexer to authenticate literals
    before nested-CM recognition; recursively build boundary-safe Revised projected Markdown with
    raw/source maps; fold each maximal `H*(EOL H*)+` sequence to one U+0020, where `H` is U+0020 or
    U+0009 and `EOL` is one CRLF token or one bare CR or LF; run a second, display-only inline
    Markdown parse; then sanitize for the Review sink. That Comment-display Markdown profile renders
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
    by a Comment receives the special one-card `anchoredComment` presentation required by 0007. The
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
- rendered semantic text/HTML produced only by parsing that projected Markdown.

The projector walks the recursive matrix once and produces a `ProjectionCandidateV1`: retained raw
units with canonical provenance, stable elision records, every generated adjacency, and any prior
`BofTextCodecV1` unit. It never decodes a protected delimiter into projected source. Before emitting
protected source it freezes a `RetainedCMManifestV1` from the canonical revision and requested
transition. That manifest contains:

- every retained canonical delimiter decision that must remain inactive;
- every retained active opener, separator, and closer that may remain active, including its exact
  form, role, expected containing frame, and expected opener relationship;
- the exact revision-mapped CM survivor set and expected survivor-parent relationship; and
- the canonical incomplete-frame relationships for retained malformed syntax.

Markers belonging to a discarded node may not appear in the retained manifest, and every marker
required by a survivor must be retained. Violating either rule is an engine fault before protection
begins. Original and Revised projection have an empty complete-node survivor set, although retained
malformed decisions may still be present. Elision can make a previously non-top or unterminated
retained delimiter active even when all three code units came from one slice, or can retarget two
individually compatible delimiters into a new node.

`ProjectionGuardV1` performs one iterative, left-to-right guarded run of the complete Profile state
machine over the whole candidate. Candidate coordinates are ordinals in the pre-protection candidate
tape, so earlier generated backslashes never renumber later decisions:

1. Before committing any otherwise-active CM transition, authenticate it against
   `RetainedCMManifestV1`. Authentication requires an exact retained canonical delimiter
   identity—not merely equal characters—the manifest form and role, the expected current parent for
   an opener, the expected opener for a Substitution separator or closer, and, when the transition
   completes a node, the expected survivor identity and parent. A delimiter assembled across an
   elision has no canonical delimiter identity. A delimiter that was canonically inactive has no
   permission to become active.

2. A transition that satisfies the manifest commits normally. An otherwise-active transition that
   fails authentication is unsafe. Its responsible delimiter is the delimiter for that first failing
   transition: an unauthenticated or wrongly parented opener is responsible at its opener; a
   separator that would split a different frame is responsible at its separator; and a closer that
   would bind a different frame or complete an unexpected node is responsible at its closer. A
   completed or retargeted node is a consequence, never a separate repair candidate.
   Malformed-recovery promotion is assigned to the delimiter transition that first commits the
   promoted node.

3. For the responsible delimiter, plan exactly one backslash at Rule 7's protection site: before the
   opener's `{`, before the separator's `~`, or between the closer prefix and `}`. Feed that
   protected spelling back to the same run as an inactive literal decision and continue after the
   original candidate units; do not rewind or rescan a prefix or suffix. If an earlier repair makes
   a later delimiter otherwise active, judge that later transition when its candidate ordinal is
   reached.

4. This is the sole protection order: ascending candidate ordinal under the Profile machine's frozen
   token-decision order. There is no rightmost search or kind-priority tuple. Each repair is
   prefix-minimal: with the already emitted prefix fixed, omitting it would commit the observed
   unauthorized transition, and one backslash is Rule 7's shortest spelling that prevents that
   transition. The guard never protects a delimiter that would remain inactive.

5. After the guarded run, emit all planned insertions and perform exactly one clean, unguarded full
   Profile parse of the result. It must reproduce every required retained decision, the exact
   survivor identities/relationships, the guarded run's Markdown CST, projected meaning, and
   provenance map, and no other active delimiter or CM node. A mismatch is an engine fault that
   commits/publishes nothing; it never starts another repair pass.

The guarded run emits `DelimiterDecisionTraceV1`. Each tentative decision records bounded-fanout
dependencies on retained input, parser-state transitions, stable elision IDs, and prior
generated-protection decisions. For each generated backslash, `causingElisions` is the sorted unique
backward slice from the responsible delimiter's rejected tentative decision through only differing
dependencies to stable elision IDs. A dependency on an earlier protection expands through that
protection's slice; a repair with no causing elision is an engine fault.

Provenance stores each slice as a structurally shared `CausalSliceRef` rather than eagerly copying
an elision-ID array per repair. Expanding `causingElisions` is deterministic and output-sensitive;
shared trace work is memoized. Its source affinity is exactly `before` the retained canonical unit
protected in step 3 (`{`, `~`, or the closer's `}`), even when the other delimiter units came from
different slices. The repair belongs to that zero-width provenance record, never a neighboring
retained slice.

For a candidate of `N` UTF-16 units, `D` delimiter decisions, `T` trace edges, and `R` repairs, `T`,
`D`, and `R` are each `O(N)`, every candidate decision is consumed once, and emitted length is
`N + R`. Candidate construction, guarded recognition, protection planning, and final verification
use `O(N + R)` time and space, excluding the unavoidable size of explicitly requested cause-list
output. A nontrivial projection invokes at most two whole-candidate Profile runs—the guarded run and
clean verification—independent of `R`; suffix replay and repair-by-reparse loops are forbidden.

Trace schema, manifest identity, candidate ordinals, guarded decision order, responsible-delimiter
identity, inserted source, cause sets, source affinity, and final parser-call count are literal
fixture data for isolated, independent, retargeted, and repair-dependent cascade cases.

Individual Accept/Reject/Remove planning uses the same candidate-manifest-guard protocol with its
nonempty expected survivor set; `SemanticEditCodec` composes that CM guard with the
Markdown-construct guard required by Rule 8. Neither path may fall back to iterative whole-candidate
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
| `CM_UNTERMINATED_OPENER`              | the exact three-code-unit opener                  | one per still-open frame; Substitution metadata records whether a valid top-level separator was seen                     |
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
        │ envelopes               │ identity                     ├─ Markdown/CM graph
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
  criticMarkupProfile: CriticMarkupProfileId
  markdownProfile: MarkdownProfileId
  liveHtmlSafetyProfile: LiveHtmlSafetyProfileId
  executionBudget: ExecutionBudgetId
}

type DocumentRevision = CompleteDocumentRevision | SourceOnlyDocumentRevision

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
  `criticMarkupProfile`; `markdownProfile`; `liveHtmlSafetyProfile`; execution budget limits-profile
  ID; execution budget accounting-schema ID; unsigned 32-bit little-endian `recordSchemaVersion`;
  and length-prefixed UTF-8 `coreEngineBuild`. Every length prefix is unsigned 32-bit little-endian
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
- persistent green CST nodes with typed red readers;
- a canonical Markdown CST and CM interval forest;
- Original/Revised mapped source tapes and Markdown CSTs;
- comment-payload views;
- source/view maps with explicit `previous`/`next` affinity;
- interval, reference, Review, command, and diagnostic indexes;
- parser checkpoints for incremental convergence.

“One parser” means one invocation authority and one indivisible revision, not one physical pass. A
custom parser kernel is the target. Marked, micromark, MultiMarkdown, or other engines may be
out-of-package differential oracles in tests, but none is a hidden production backend and no foreign
token type crosses the core package boundary.

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
  readonly authoringTextPolicy: AuthoringTextPolicyId
}

type AuthoringTextPolicyId = 'nearest-owner-eol-v1'

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

`nearest-owner-eol-v1` is the one authoring policy for line breaks synthesized by Enter, split/join,
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

Pending state is lossless, not a spinner count. It can represent one active batch, multiple queued
input runs separated by commands, one live composition, and multiple retained rejected/cancelled
drafts at the same time. Each retained entry carries its ticket IDs, exact draft/target, localized
reason, and allowed Retry/Discard actions; `lastRejection` remains available across component
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
`{sessionId, ticketIds, firstSequence, lastSequence, admittedAt[], expectedRevision, expectedSourceHash, parseConfiguration, authoringTextPolicy}`.
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

Pinning does not by itself authorize a filesystem rename. One host-wide `FileTargetRegistry` maps
aliases to a canonical `FileTargetId` before registration. Because persistence atomically replaces a
directory entry, the identity is the final resolved destination entry—not its current inode: safely
resolve `.`/`..` and symlink chains to the final target, then key the stable resolved
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
target, verifies its raw hash/length against `SavePreparedV1`, and when matched fsyncs the target
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
typed terminal closed results. A **new**`close({kind:'cancel', target})` remains the
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
mode, Track toggle, authoring-text-policy ID and chosen synthesized EOL tokens, selection/draft
anchors, diagnostics, effect outbox, and a deterministic active-view live-plan delta hash keyed by
`{baseRevision, nextRevision, view, mode, coreBuild}`—with length framing, checksum, and durable
sync is the commit linearization point. Only then may the host publish the descriptor/plan delta and
run effects. A replacement worker opens the last verified source checkpoint, replays later journal
records by ID, and reconciles pending tickets idempotently, regenerates the plan delta, and rejects
same-build publication if its hash differs. Reinterpret, undo, and redo use the same record with
zero/new-history semantics as already defined. Durable session-only changes (view, mode, Track
state, authoring-text policy, selection/draft lifecycle, close state, and effect-bearing
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
identity, and authoring-text-policy identity. Same-build recovery verifies the stored plan-delta
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

Only `revision-changed` transitions caused by a new `source-edit` enter document undo history.
`reinterpret` and semantic session changes such as explicit selection, view, mode, Track state,
authoring-text policy, or draft begin/update/cancel create no undo entry but carry
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
`session-state-changed` transition that marks the ticket/draft blocked and presents its localized
reason; pending status and overlay chrome may therefore change. No document-change event or
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

The snapshot publishes actual type-aware command presentations, including localized labels and
enabled state. Sidebar, in-window controls, context menus, native menus, and command palette consume
those presentations rather than reconstructing semantics from copied booleans.

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
| Cut                            | same bundle as Normal Copy, then one editable Markup semantic deletion; Track applies when enabled                                                                                                                                       | disabled/read-only                                             | disabled/read-only                                             |
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

1. Concatenating canonical leaf tokens reproduces the decoded source exactly.

2. Every tree, projection, index, live plan, materialized result, diagnostic, and handle in a
   revision belongs to the same source and language profile.

3. Parser provenance is created with syntax. No range intersection, repeated- text search, DOM
   inference, structural-carrier rank, or topology rebinding may manufacture it later.

4. Incremental parsing is observably equivalent to a clean full parse of the resulting source.
   Equivalence compares canonical source, profile/options, syntax kinds/ranges/raw slices,
   projections/maps, diagnostics, semantic indexes, revision-owned action capabilities, and
   materialized outputs. Localized labels, active item, draft state, menu placement, and other
   `CommandPresentation` fields are session-owned and excluded here; a separate harness mounts each
   result in a `DocumentSession` with identical locale, selection, view, and app context and
   compares those presentations. Green-node object identity, cache layout, checkpoint placement, and
   performance counters are deliberately excluded. The full parser is the correctness oracle.

5. Projection segments record canonical slice, generated boundary, or elision while they are
   constructed; consumers never reverse-engineer origins.

6. View-to-source maps are total for editable positions and explicit about affinity at
   collapsed/zero-width boundaries.

7. Node handles are opaque and revision-bound. Reuse requires an explicit, proven
   `RevisionTransition`.

8. A session transform computes source edits, parses, validates its semantic postcondition, and only
   then publishes.

9. Hidden Comment source has no editable Markup-view positions.

10. No renderer, menu, sidebar, clipboard path, or desktop process privately parses CriticMarkup
    marker text.

11. Malformed input preserves every source unit and never throws as user data.

12. Internal invariant failure commits nothing and emits a captured fatal diagnostic outside the
    durable document transaction.

13. Parser and index work is linear or `O(log n + k)` for indexed queries; delimiter edits may
    legitimately invalidate a suffix or full document but hidden `O(n²)` behavior is forbidden.

14. Async exports read an immutable revision and cannot race later edits.

15. New-engine documents have exactly one write authority for their lifetime.

16. Persistence obtains canonical source from the revision by identity; no render, serializer, CST
    walk, or materializer reconstructs it.

17. Every non-Source semantic transform reparses all changed joins through `SemanticEditCodec`; only
    an explicitly named authoring/Track/Review command may create CM, and no untargeted CM or
    Markdown construct appears or changes identity as a side effect.

## Brutal current-to-target gap analysis

| Concern            | Current branch                                                                                                            | Required target                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Canonical document | Mutable `TState[]` in `state/index.ts`; parser artifact is an invalidated cache                                           | Exact source plus immutable `DocumentRevision`                                                      |
| Parse product      | `markdownToState` returns states, CM token document, analysis, and a separate binding graph                               | One atomic syntax graph                                                                             |
| Source fidelity    | Critic markers and Markdown spelling are woven through `sourceTrivia`; ordinary source may normalize                      | Every source unit is a CST/token leaf; no-op persistence is exact                                   |
| Persistence        | `stateToMarkdown.generate()` reconstructs Markdown and weaves CM trivia                                                   | Save reads `revision.source` directly                                                               |
| Parser integration | Markdown literal ranges, provisional CM scan, projection rescans, final scan, and separate bindings                       | One language engine and versioned precedence                                                        |
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
| Original/Revised   | Project text, parse it back into mutable state, and switch authority-like trees                                           | Revision-owned read-only CSTs/views                                                                 |
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
- the explicitly legacy `specs/architecture/criticmarkup.md` record and release notes still describe
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
authorities and invalidate the new architecture.

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

### Phase 0 — freeze the contract and prove one walking slice

**Red**

- First, one engine test opens literal `{++new++}` and expects exact source, one Addition with
  literal half-open ranges, Original `''`, Revised `'new'`, and provenance for every projected code
  unit.
- After that is green, one session test dispatches a plain-text insertion, observes one
  revision-changed descriptor, undoes it, and recovers exact source through its lease plus the
  mapped selection. Kernel tests inspect the full `RevisionTransition` proof inside the worker
  package.
- After that is green, one real-browser walking tracer opens literal `a{++new++}b`, mounts its
  session plan, sends a real `beforeinput` insertion, observes only committed DOM and mapped caret,
  undoes to the exact opening source, redoes to the exact changed source, and saves those revision
  bytes through a temporary `FileSnapshot`.
- Finally, one import-boundary test prevents core from importing Muya, Marked, DOM, Vue, Pinia, or
  Electron.

**Green**

- Create `@marktext/document-core`, immutable revision, profile identity, minimal asynchronous
  `DocumentSessionClient`/`SessionCoordinator`/ `RevisionWorker`, one-ticket checksummed journal
  commit, transition, `LiveRenderPlan`, browser adapter, and file adapter needed by those tests—no
  broader grammar, batching, crash recovery, or optimization yet.
- Split fixture manifests into `CM_STANDARD`, `MARKTEXT_PROFILE_1`, and `MALFORMED_RECOVERY`, plus
  reference-projection rows. Inventory exact-source, recursive-matrix, comment-context,
  independent-node, no-sentinel, comment-metadata, contribution-atom, Comment-fold,
  contextual-codec, malformed-diagnostic, literal-boundary, and 0006/0007 rows without enabling them
  in bulk.
- Transcribe the normative table above into the checked-in consumer-policy matrix; also check in the
  file-backed corpus matrix, legacy deletion manifest, `syntax-accounting-1.yml` event algebra/known
  traces, hash and `wire-envelope-v1.yml` known-answer vectors, authoring-EOL vectors, and
  test-disposition ledger with schema validation.
- Record every old test's disposition; delete or rewrite tests that require accidental topology,
  source normalization, sentinel behavior, or private helper names.

**Exit**

- The one browser tracer proves an Addition travels source → revision → session → live DOM → edit →
  undo/redo → exact file save without mutable-state or serializer authority; the smaller tests are
  its diagnostic scaffolding, not a substitute.
- The profile is documented once; glossary, ADRs, architecture, plans, and corpus expectations
  contain no known contradiction.
- Every 0006/0007 requirement maps to a named automated target test.

### Phase 1 — exact source and the lossless Markdown base

**Red**

- Enable one token-concatenation/open→save identity example at a time over arbitrary Unicode, BOM,
  mixed line endings, blank lines, no terminal EOL, and malformed Markdown.
- Enable the U+FEFF grammar matrix one row at a time: zero/one/two leading units and one
  moved/nonleading unit × YAML front matter, fenced block, ATX heading, and leading CM.
  File-signature provenance true/false must not change parsing; the first source unit is virtual
  grammar trivia, the second/nonleading unit is literal, every canonical range includes the retained
  units, and persistence is exact.
- Enable one cross-platform known-answer vector at a time for `SourceHashV1`, `FileHashV1`, and
  `RevisionSemanticHashV1`: empty, U+FEFF, CR/LF/CRLF, astral/unpaired surrogates, length
  boundaries, raw encodings, and every configuration/schema/build field. Reinterpretation changes
  only the semantic hash; byte-only encoding changes change only the file hash.
- Enable CommonMark 0.31, GFM 0.29, and each supported MarkText extension row one at a time through
  `LanguageEngine.open`.
- Enable each literal-context option and delimiter-boundary row one at a time.

**Green**

- Implement `SourceSnapshot`, an opaque exact-source storage interface, line index, token tape,
  profile identity, diagnostics, and a full-batch lossless Markdown CST. A plain immutable string is
  an acceptable first green; rope/piece storage waits for Phase 5 profiling evidence.
- Implement the three versioned hash codecs from their exact framed byte definitions; no
  platform/native convenience string hash is admissible.
- Use current Marked only from an out-of-package differential test adapter. The core never imports
  it or adapts its AST into canonical state.

**Exit**

- Every decoded code unit is owned exactly once; no ranges overlap or leave a gap. Full-parse
  conformance and exact-source properties pass.
- Parsing arbitrary user text is total and bounded.

### Phase 2 — native CM syntax graph and projections

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

- Implement the CM forest, typed delimiter/arm nodes, multi-view mapped tapes, Original/Revised
  CSTs, isolated Comment views, semantic indexes, and editable render plan only as each row needs
  them.
- Derive `precedingChange` for all four eligible preceding forms and the mandatory nonempty
  Highlight/Comment `anchoredComment` presentation in `ReviewIndex`; never add a persisted
  relationship to the syntax graph.

**Exit**

- The full parser alone produces every view, mapping, review item, and diagnostic for one immutable
  revision.
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
  YAML/fence/heading/CM openers. Each proves literal source, one decoded U+FEFF text atom where
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
  leaves the canonical document/history untouched and publishes one localized, actionable,
  non-focus-stealing rejection. Journal, publication, observer, and effect failures begin only after
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
  2.25×. Separately, 0006's 4,096-line ≤5-second open and interaction p95 <500 ms remain wall-clock
  artifact ceilings.

### Phase 6 — materializers, file persistence, and security boundaries

**Red**

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
  malformed recovery, BOM+CRLF+astral, escaped repeated table cells, front matter, hostile
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
- Implement desktop `FileSnapshot`, composite `preparePersistence`, encoding/BOM policy, exact no-op
  byte reuse, destination-entry registry, durable save-intent/reconciliation, per-target
  generation/CAS arbitration, monotonic receipts, autosave, and explicit unrepresentable-character
  flow.
- Integrate Phase 4's already-green journal/recovery/compaction protocol with owner-only app-data
  permissions, desktop startup discovery, and cleanup after a clean persisted close or completed
  discard tombstone; Phase 6 does not reimplement its framing or compaction semantics.
- Move desktop read paths one vertical slice at a time; remove their legacy parser/renderer once
  migrated.

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
    rejection, and each remaining 0007 mapping row enter separate cycles rather than one aggregate
    red.

Only after all rows are green, add one already-supported fresh-state journey as a regression: select
→ compose → exact pair/distinct anchor/one card → edit → remove with exact Highlight payload
retained. That journey must be green on its first run; it is not a large substitute red.

**Green**

- Make Vue/Pinia, native menu, context menu, command palette, and persistent mouse control thin
  consumers of session snapshots/intents.
- Move comment drafts into the session and remove copied target tuples and parser logic from IPC/UI
  layers.

**Exit**

- Every 0007 outcome passes in a fresh built desktop app with real pointer and keyboard events. No
  test pre-seeds the final document state to skip creation.
- Dedicated accessibility expansion removed from 0006 remains out of scope; this phase proves only
  the concrete pointer, keyboard/caret, focus, and non-focus-stealing behaviors already required by
  0006/0007.

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
- a merge-base audit of every tracked and untracked branch file, removal of generated/unrelated
  artifacts, and proof that `.vscode/settings.json` was not modified or staged by this work;
- an evidence-gated completion audit of every 0006/0007/0009 claim.

For each gate, retain the exact commit and dirty state, command/environment, test identities and
pass/fail/skip counts, duration, captured app errors, resource measurements, and artifact path/hash
where applicable. Skipped, quarantined, source-shape-only, retried-until-green, silently timed-out,
or unexecuted gates are not evidence.

Manual dogfooding is not in this gate.

## Acceptance mapping for 0006 and 0007

| Requirement                                         | Required automated proof                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Five CM forms and projections                       | Standard/Profile corpora, recursive 7×5 projection matrix, all-five nesting fixture, and literal projection properties                                                                                                                                                                                              |
| Boundary-safe projection/resolution                 | Protective escape; retained-decision/survivor manifest; linear whole-candidate guarded run; responsible delimiter for retargeted nodes; one clean verifier parse; exact shared causes/affinity; `O(n)` unsafe-join scaling; idempotence, survivor-set, Accept All, and Reject All with literal expected source      |
| Boundary-safe semantic editing                      | Every CM/Markdown delimiter split across inserted/retained and retained/retained joins; complete-vs-partial CM/literal enclosure; atomic literal-owner editing; exact-empty cleanup; literal canonical/projected/meaning expectations; no synthetic, duplicated, or retargeted node                                 |
| Exact core source                                   | Code-unit identity over BOM/EOL/trivia/malformed/Unicode variants; source-only U+FEFF grammar matrix; versioned Source/File/Semantic hash known answers; persistence reads revision source by identity                                                                                                              |
| Exact desktop persistence                           | File-backed no-op save×2/reopen, edit/save/reopen, autosave, pinned lease, destination-entry aliases, durable save-intent crash/reconciliation, all target-ordinal/write/rename/ack CAS orders, discard tombstone races, distinct Save As, monotonic receipts with byte/encoding/BOM evidence                       |
| View and source-mode persistence                    | Save/autosave in Markup, Original, Revised, and Source; WYSIWYG↔Source no-op handoff; every path persists the same committed canonical revision                                                                                                                                                                     |
| Track Changes                                       | Full 0006 source-native mutation matrix across all forms × arms/boundaries × plain/empty/nested/block-spanning shapes for text, formatting, structure, paste/cut, drag/drop, spellcheck, IME, table/list, image placeholder/resolution, and replacement; atomic literal owners; projection/locality laws            |
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
| Installed full 0006 workflow                        | The installed/mounted artifact opens every corpus class; authors five forms; performs tracked inline/structural edits; resolves individual/all; switches views; exercises clipboard/search/source; save/autosave/reopen/undo/redo; and emits HTML/PDF/print                                                         |
| Platform readiness                                  | Fresh hidden/unfocused build and named macOS arm64/Windows x64/Linux x64 build plus Review menu/keybinding jobs                                                                                                                                                                                                     |

Tests that inspect filenames, helper names, line counts, or regex-match source text are not proof of
these behaviors. Architectural boundaries should be enforced by package dependency rules, public
type tests, runtime seam spies, and deletion of forbidden APIs.

## Definition of done

This plan, 0006, and 0007 may close only when all of the following are true:

1. The exact canonical source and immutable `DocumentRevision` are the sole document authority in
   every production editor flow.

2. The MarkText CriticMarkup Profile is documented, versioned, and backed by separate
   standard/profile/recovery corpora.

3. All Markdown and CM interpretation, provenance, projections, mappings, and diagnostics come from
   one atomic parser artifact.

4. All mutations originate as typed source-native intents and commit atomically.

5. The live editor uses the session/`LiveRenderPlan` seam, each static consumer uses its typed
   materializer, and persistence reads revision source directly.

6. The legacy deletion manifest is complete; no rebinding, trivia weaving, mutation inference, dual
   history, or private CM parsing remains callable.

7. Every mapped 0006/0007 automated proof passes on the final tree, including the real mouse-only
   hidden-sidebar path.

8. Lint, typecheck, conformance, unit, property, browser/Electron, fresh-build, packaged,
   performance, security, PDF/print, and platform gates are green.

9. User docs, architecture, glossary, ADRs, plans, release notes, and actual UI behavior agree
   without portability overclaims.

10. A fresh completion audit marks every claim proven. Historical green runs, checked boxes, and
    implementation summaries are not sufficient evidence.

## Primary upstream references

- [Canonical CriticMarkup specification](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md)
- [MultiMarkdown 6 CriticMarkup philosophy and limitations](https://fletcher.github.io/MultiMarkdown-6/syntax/critic.html)
- [MultiMarkdown 6 pairing definitions](https://github.com/fletcher/MultiMarkdown-6/blob/3f729288baccc9aa8a2c74ce1bf77adf8bd17c37/src/mmd.c#L145-L153)
- [MultiMarkdown 6 structured pairing](https://github.com/fletcher/MultiMarkdown-6/blob/3f729288baccc9aa8a2c74ce1bf77adf8bd17c37/src/token_pairs.c#L180-L225)
- [MultiMarkdown 6 CriticMarkup corpus](https://github.com/fletcher/MultiMarkdown-6/blob/3f729288baccc9aa8a2c74ce1bf77adf8bd17c37/tests/MMD6Tests/CriticMarkup.text#L28-L92)
- [MultiMarkdown 6 rendered corpus, including Markdown inside Comment](https://github.com/fletcher/MultiMarkdown-6/blob/3f729288baccc9aa8a2c74ce1bf77adf8bd17c37/tests/MMD6Tests/CriticMarkup.html#L33-L97)
- [MultiMarkdown 6 CriticMarkup renderer/parser behavior](https://github.com/fletcher/MultiMarkdown-6/blob/3f729288baccc9aa8a2c74ce1bf77adf8bd17c37/src/critic_markup.c)
- [MultiMarkdown 5 grammar (recursive change payloads; opaque Comment payload)](https://github.com/fletcher/MultiMarkdown-5/blob/193c09a5362eb8a6c6433cd5d5f1d7db3efe986a/src/parser.leg#L1587-L1684)
