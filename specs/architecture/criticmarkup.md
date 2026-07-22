# CriticMarkup Architecture and Compatibility

> **Status: legacy implementation record; not the target architecture.** This
> file describes the mutable-state/Marked/binding engine currently present on
> `feat/native-criticmarkup`. ADR-0005 through ADR-0009 and plan 0009 supersede it
> for all new work: the immutable `DocumentRevision` is sole authority, decoded
> source is exact, CM is intrinsic syntax in one conditional Markdown graph, and resource failure
> yields SourceOnly rather than literal rendering. Any conflict is an explicit
> current-to-target gap, not an alternate allowed design. Keep this record only
> as a migration/deletion oracle; rewrite or archive it when cutover completes.

## Purpose

CriticMarkup is a native Markdown feature in Muya and MarkText. One typed
grammar owns recognition, source ranges, nesting, projections, resolution, and
serialization. One immutable, source-neutral `CriticMarkupAnalysis` owns the
normalized literal ranges, parser-profile/context-coverage identity, and
branded semantic forest for a source revision. `CriticMarkupDocument<Path>`
binds that analysis to a checked live-state or Marked-parser source map and
adds only mapped fragments and indexes. The desktop shell consumes those Muya
models; it does not rediscover markers with regular expressions or a second
parser.

This document records compatibility decisions behind that **legacy
implementation**. It is not authority for the replacement engine; Profile 1 in
plan 0009 owns every silent or divergent case there.

## Parser artifact and binding authority

One parser artifact owns an exact source revision, frozen parser-option
profile, Markdown-context coverage identity, parser invocation/token graph,
mapped path-domain revision, `CriticMarkupAnalysis`, and a complete generic
binding graph. If Markdown normalization changes the source,
the artifact publishes the normalized state, analysis, and bindings from the
same reparse; it never combines state from one revision with provenance from
another.

The state adapter and the located Marked adapter use different typed path
domains but implement the same binding contract. Every semantic item has
parser-owned inline or structural bindings carrying item identity, arm, role,
path, and exact source/local segments. A document that exposes fragments,
path lookup, source mapping, rendering, authoring, or review targeting requires
that authenticated graph. Optional bindings, generic mapped-span intersection,
structural source-cover reconstruction, repeated-text search, hidden sidecars,
and module-global provenance are forbidden.

Provenance is explicit at every construction site: the document factory takes
a required binding argument — a complete graph, the literal `'semantic-only'`,
or the `'grammar'` sentinel, which only the grammar-only parser profile may
use (a Markdown-aware parse with items must hand over its own graph). No
production entry point defaults or infers it, a repo-wide fitness contract
forbids optional binding-graph parameters in any production source, and the
test suites' bound-document convenience composition lives in test support,
never in a production module.

Native extension planning is deliberately separate: it may consume a
source-neutral analysis through an explicitly semantic-only API. Semantic-only
construction cannot expose fragment or path APIs and cannot masquerade as a
fragment-bearing document.

## Authority order

When sources disagree, use this order:

1. MarkText's native Markdown AST and literal-context rules.
2. The five canonical CriticMarkup forms and their accept/reject semantics.
3. Explicit decisions in this document.
4. Roughdraft behavior as product and interaction precedent.

Roughdraft is not a grammar dependency. The reviewed reference was
`roughdraft@0.1.10`, repository commit
`33f4399c22c2297ef4548f42022e5eb19bfda452`. That release contains two
materially different parsers: a global character scanner in
`@roughdraft/rfm` and Marked inline tokenizers in the rich editor. They disagree
on escapes, empty forms, multiline/block-spanning markup, raw HTML, and fenced
code comments. MarkText therefore borrows Roughdraft's well-defined review UX
and resolution behavior, not either parser architecture.

## Canonical forms

| Type         | Stored form      | Accept                    | Reject                    |
| ------------ | ---------------- | ------------------------- | ------------------------- |
| Addition     | `{++new++}`      | Keep `new`                | Remove `new`              |
| Deletion     | `{--old--}`      | Remove `old`              | Keep `old`                |
| Substitution | `{~~old~>new~~}` | Keep `new`                | Keep `old`                |
| Highlight    | `{==text==}`     | Keep text, remove markers | Keep text, remove markers |
| Comment      | `{>>comment<<}`  | Remove annotation         | Remove annotation         |

A substitution is always one semantic review item. In the parser, a highlight
and an immediately adjacent comment remain two flat items because pure
CriticMarkup carries no durable relationship between them. The Review snapshot
may derive their gapless source adjacency for the current revision and present
the pair as one anchored Comment card; that UI relationship is never persisted
or fed back into grammar identity.

Explicit Review removal of that derived Comment card removes both annotation
wrappers while retaining the anchor payload as ordinary prose. Deleting the
anchor payload through ordinary editing is intentionally different: the empty
highlight wrapper is removed, but the comment survives as a bare point comment.
Source-authored and imported bare comments are equally valid parser items.

Parser tokens retain both canonical raw payload bytes and their semantic
payload view. The semantic view decodes only grammar-owned protective escapes;
parser-declared Markdown literals and authenticated nested CriticMarkup ranges
remain opaque islands with mapped coordinates. Review cards, editors, and
comment tooltips use semantic text, while routing, persistence, and stale-target
checks retain exact raw identity. Parent-comment editing relocates those opaque
ranges through semantic-text diffs. An island must have one exact whole-range
mapping in the edited text; split/ambiguous/crossing mappings fail closed, for
Markdown literals as well as nested review items, instead of re-escaping
parser-owned bytes. Semantic materialization uses indexed exclusion jumps: an
ancestor treats a direct nested item as one opaque interval and does not revisit
each of that child's Markdown literals.

## Persistence boundary

MarkText writes only the five pure forms above. IDs, author names, timestamps,
threads, replies, resolution status, compact references, inline attribute
blocks, and YAML review metadata are not part of this implementation. In-memory
item IDs are source-range-derived, revision-local routing handles and are never
serialized. A new canonical revision invalidates an old handle even when a new
item happens to receive the same derived string; desktop drafts and commands
therefore revalidate document identity, exact source range, and raw syntax
rather than trusting an ID alone.

The parser owns the source's terminal line ending as part of the same
provenance: `''` (absent), `'\n'`, or `'\r\n'` is recorded on the final state
and restored byte-exactly on serialization. The empty source owns an _absent_
terminal EOL, so an empty document round-trips to zero bytes and a document
authored from an empty tab serializes without a manufactured trailing LF. The
serializer never invents a final newline the parser did not record. Internal
CRLF is subject to MarkText's pre-existing canonical Markdown normalization to
LF; CriticMarkup does not claim a stronger byte-preservation contract than the
host serializer.

Roughdraft's metadata model is intentionally outside this boundary. It remains
useful precedent for a future, separately specified collaboration layer, but it
must not leak into Markdown during this effort.

## Defined behavior for silent or divergent cases

### Markdown context wins

CriticMarkup-looking bytes remain literal wherever the Markdown parser says
the source is literal, including inline code, fenced and indented code blocks,
raw HTML tokens, link destinations, and other parser-declared literal ranges.
This fixes gaps in Roughdraft's global scanner and keeps all parser consumers on
one interpretation.

Critic delimiters can change Markdown flanking at an arm boundary—for example,
the `$` opening a new substitution arm follows `~>` in stored source even
though it begins an inline-math span in the Revised document. The canonical
adapter therefore derives context in two parser-owned stages: a Critic-disabled
whole-document AST establishes base literal ranges; a provisional Critic
forest identifies semantic arms, then the complete Original and Revised
projections plus the comment-body view are parsed with one frozen Markdown
option snapshot. Their literal ranges are mapped back to canonical source
coordinates. If those normalized final ranges equal the base ranges, the
provisional forest is reused; if they differ, one conditional final scan is
required because new literal syntax can change outer delimiter balancing. The
result is materialized exactly once as the immutable analysis. This is
recomputed from stored Markdown on load; Track Changes never relies on
ephemeral side ranges or a mutation-only interpretation.

The analysis records whether Markdown context coverage is `none` (the
no-opener display fast path) or `complete`. Authoring and Track Changes require
complete coverage, so a cheap display result can never masquerade as command
context merely because its bytes and parser profile match. A grammar-only
analysis is separately identified and cannot be injected into a parser-aware
transaction. Exact source bytes, parser-profile identity, and required context
coverage are all checked when an analysis is rebound to another mapped path
domain.

MarkText vendors Marked with parser-owned source provenance. Every block and
inline lexer invocation receives a mapped source view, and its ledger
partitions that input exactly into semantic token consumption, explicit parser
residue, or delegation to a later native reconstruction. Recursive blockquote,
list, table, link, emphasis, and other tokenizer calls carry their transformed
views into the child parser; source positions are not inferred afterward from
`raw` strings or token order. Bytes deliberately consumed without a final
semantic token remain typed residue instead of disappearing.

Marked sometimes replaces tokens while repairing native lazy blockquote/list
continuations. Both reconstruction sites use one Lexer-owned replacement
operation guarded by a module-private, single-use authority ticket bound to the
exact lexer, array slot, old carrier, and replacement. Extensions can invoke
the public lexer surface but cannot mint or reuse that authority. The operation
validates the array slot and records the old-to-new carrier transition. Trace
finalization accepts a `delegated` ledger entry only when
that explicit, acyclic supersession chain terminates at a semantic token in the
final AST. An extension that removes a prior token—or merely hides it in
unrelated metadata—fails loudly instead of manufacturing delegation.
Delegation retains the exact partition and superseded token type without
retaining a dead token reference, creating a literal exclusion, or appearing
in token-source queries. Semantic AST reachability follows Marked's native and
declared extension child-token rules; the broader descriptor graph is used
only for mutation detection. Every token or literal carrier that remains in an
authoritative ledger is therefore semantically reachable from the completed
token graph.

`locatedMarkdown.ts` consumes this trace and performs only typed view
composition and Critic-to-native-token weaving. Its located inline-token tree
is the authority used to place Critic nodes inside native link, emphasis,
image-label, and other Marked wrappers without reparsing canonical source.
The outer Marked token analysis supplies base context directly; only distinct
Original/Revised/comment projection strings require additional Markdown
parses, and identical strings share one parse while retaining separate source
mappings.

The final token graph is snapshotted inside the parser before extension hooks
can observe it. Claiming provenance and beginning or ending Critic analysis
assert descriptor, prototype, property, and reachability identity without
invoking graph-controlled accessors. A hook that mutates tokens after lexing
therefore fails loudly instead of silently detaching parser semantics from
source authority.

Ordinary Markdown does not pay for mapped provenance. `lexBlock` uses Marked's
plain lexer path; `analyzeMarkdownBlockSource` is the explicit parser-analysis
entry point. When the grammar-owned prefilter proves there is no Critic opener,
the final Marked extension still authenticates exact source and parser options
but does not allocate a mapped source document, source views, or a provenance
trace. This adapter is deliberately coupled to the vendored Marked contract,
so a fork update must reproduce the declared upstream tree and pass the
fail-loud context, wrapper, parity, conformance, and losslessness corpora.

The vendored fork is one tracked release artifact: source, upstream license and
commit identity, fork package metadata, canonical patch, complete manifest,
offline verifier/self-test, workspace lock wiring, and CommonMark conformance
version must agree byte-for-byte. A source edit without a regenerated patch and
manifest, or a consumer that resolves a registry Marked instead of the
workspace fork, is a release failure.

All parser and state mappings use half-open UTF-16 ranges. When normalization
collapses a nonempty source range to one local position, the view retains both
same-local boundaries: `previous` affinity maps before the removed bytes and
`next` maps after them. Span ends never preempt the requested side, and this
two-sided boundary survives conversion from parser provenance into Muya's
mapped-source index. Generated prefixes and escapes use the same named
affinity contract rather than an implicit inclusive-end convention.

A Markdown-escaped opener is literal. Escaped delimiter-like payload text is
preserved, and the grammar serializer emits protective escapes when needed so
its own output reparses to the same semantic payload.

### Malformed input

Incomplete or structurally invalid forms remain ordinary Markdown text.
Scanning continues far enough to recover complete later or nested items without
quadratic suffix rescans. Dangling closers are text. Parser APIs fail loudly for
invalid coordinate requests; editor commands fail closed when an edit would
damage a live delimiter.

### Empty forms

Empty payloads and empty substitution arms remain semantic. They are needed
while the editor is authoring a change and make partially typed syntax stable.
Roughdraft's scanner and rich editor disagree here, so this is explicit MarkText
behavior rather than a portability claim.

### Nested forms

Balanced nested forms are parsed deterministically, deepest items can be
selected, and projections recurse through the token forest. Add Comment may
deliberately nest when its selected anchor wholly contains existing parser
items or remains within one semantic arm; a selection that crosses only part of
an item fails closed. The grammar serializer treats the already-authenticated
contained item ranges as opaque so it preserves their valid delimiters instead
of protective-escaping them as newly typed payload. Other authoring commands
do not deliberately create nested review syntax. Other editors may treat
nested forms as literal content, so nesting remains a lossless MarkText
capability rather than a universal portability claim.

### Block-spanning forms

One marker pair may span soft line breaks, blank lines, and block syntax. Muya's
document model links every rendered fragment back to one parser item. This is
required to represent tracked paragraph split/join, cross-block cut/paste, and
multi-paragraph insertion without proprietary sentinels or multiple unrelated
suggestions.

The CriticMarkup draft is silent on block-spanning syntax, and Roughdraft's two
parsers disagree. MarkText deliberately supports it as pure marker syntax. The
Markdown parser and source map—not DOM adjacency or a global regex—determine its
fragments and resolution.

### Projection and mutation

Marked view is the canonical editable document. Original and Revised are
read-only reparses of the corresponding parser projection. Their block paths do
not identify canonical source positions. Any targeted sidebar or contextual
action returns to Marked view before focusing or resolving an item.

The invariant for a newly tracked edit is:

```text
project(tracked, Original) = source before the edit
project(tracked, Revised)  = source after the edit
```

An operation that cannot satisfy this invariant exactly is rejected until it
has an explicit multi-edit transform. Untouched Markdown must never be swept
into a broad inferred substitution.

All editor mutations enter through one `MutationGateway`. The editor creates a
single closure-backed synchronous mutation authority and injects it into both
the gateway and JSON state. Low-level tree and state mutators assert that
authority before changing live state, so a forgotten gateway cannot partially
change the DOM/tree and fail later while committing JSON. Direct, tracked,
read-only, history, document-replacement, and nested operations share this one
transaction boundary; nested operations join the active transaction rather
than creating a second policy or commit path.

Parser-option changes use the same transactional discipline. Preparation runs
against the prospective frozen option snapshot; rollback rebuilds against the
previous snapshot. Option identity is part of reset/rollback authority. A
failed transition restores options, state, tree, history, selection, search,
and events, and rethrows the original failure unless rollback itself fails
independently.

Projection derivation has a fixed cost model. Read-only projection states are
parsed at most once per document revision (the cache is keyed on the JSON
state's `documentVersion`, which every mutation advances); an item-free
document projects as its own canonical state with no reparse at all. After
every document open or reset an asynchronous warmup precomputes both
read-only projections off the reset path — deferring and rescheduling while a
mutation holds the authority — and stamps `data-critic-warm` on the editor
root as the steady-state marker automation waits for (see
`background-application-testing.md`). A pure view switch is not an edit: it
reuses unchanged blocks, never grabs focus, and never seats a caret. The same
`documentVersion` key also caches the engine's whole-document
reference-definition collection, which whole-tree rebuilds previously
re-derived per block at O(blocks²).

Two input-path guards keep the gateway's boundary flush safe: a keystroke
that arrives with no committed cursor (possible on the first input event
after a UI interaction, because the gateway flushes pending boundaries first)
is ignored rather than crashing or guessing an edit position, and the next
keystroke with a committed cursor lands normally.

### Desktop Review ownership

Muya emits one detached, typed Review snapshot for a document revision. One
desktop lifecycle controller consumes it, publishes sidebar and native-menu
state, and owns prompt lifetime. One descriptor registry owns Review command
IDs, actions, menu metadata, descriptions, and default bindings. Review actions
use the existing command execution protocol; a bespoke Review IPC protocol is
forbidden, and IPC derives window identity from the sender. Desktop contracts
use canonical exported Muya types or explicit exported `Pick`s, never
handwritten duplicate unions.
Source mode clears actionable Review state while it owns the document and
restores a fresh parser-backed snapshot after handoff.

Comment composition and editing are sidebar-owned. Add Comment requires a
selection and emits a gapless `{==anchor==}{>>comment<<}` pair; imported bare
comments remain valid parser items but are not created by that command. Comment
selection is passive: an anchor updates current-item state only when no deeper
visible Review item owns the hit, nested anchors choose the innermost Comment,
and explicit parent focus survives while its target does. It never opens or
scrolls the sidebar. A card activation edits the comment in place. The native
right-click command uses an event-scoped, request-correlated `ReviewHitPath` from
the exact originating Electron frame. The mounted plan identifies the deepest
item, visible ancestry, and nearest containing anchor; main retains the deepest
item's commands and also offers Edit Comment for that nearest anchor. The
renderer revalidates the chosen opaque path entry against the current Review
snapshot before opening the persistent, mount-safe sidebar edit request. No
process reparses markers or infers identity from displayed text.

An edit submission has an explicit saved/rejected acknowledgement. The sidebar
closes only after the engine accepts the mutation; rejection retains the exact
draft and presents a localized, non-focus-stealing status. An ordinary edit that
exhausts a comment anchor is classified from the before/candidate revision pair.
A hidden Comment descendant rejects before carrier or Track policy. Otherwise
the direct path removes the exhausted Highlight wrapper, preserves residual
untargeted non-Comment nodes, and leaves the outer point Comment; the tracked
root-effective path wraps the exact current Highlight in a Deletion so Reject
restores it. One undo restores the exact prior source. Primitive capture writes
only mark the isolated draft dirty. After the outermost mutation body completes,
and before its single history/observer commit, the gateway invokes the direct
planner exactly once for that dirty capture; nested operations join the same
capture. It does not run after every primitive write or at an intermediate
consumption point. No delimiter scan or post-save source rewrite participates.

Hidden comment content is also excluded from the editable caret domain. The
parser binding graph identifies both inline comment fragments and native block
carriers; only a structural **content** fragment whose semantic arm is
`comment` is hidden, never an ordinary block that merely carries a zero-width
comment boundary. Muya resolves a caret in such a fragment through the
document's source map to the nearest visible semantic boundary, walking across
consecutive and nested structural comments when necessary. Programmatic cursor
placement, native `selectionchange`, arrow traversal, `beforeinput` target
ranges, and IME composition all share that resolver. Exact DOM endpoints are
seated outside the hidden wrapper, and a comment-only document collapses the
native/model selection because it has no legal visible owner. This is a
selection-layer invariant over parser identity, not a renderer heuristic over
comment text.

Fail-closed editing is not silent. Mutation rejection has a typed reason that
reaches one localized, actionable, non-focus-stealing banner. Annotation
**Remove** semantics stay distinct from change **Accept** semantics. Every
Review command is reachable through the native menu and the command palette
(the OS-accessible surfaces); dedicated assistive-technology affordances
(ARIA semantics, live-region announcements, DOM keyboard traversal) are
deliberately **not** part of the CriticMarkup implementation — the app has no
such layer anywhere, and building one is an app-wide effort in its own right
(scope ruling 2026-07-16; a future a11y effort can seed its Review portion by
reverting commit `c616f030`).

### Sink and security policy

The canonical Markdown file is the collaboration record, so text-only source
sinks preserve CriticMarkup bytes. Rendered sinks follow the active parser
projection. “Marked” below means the semantic review view, not an implicit
accept operation.

Canonical Muya Markdown is the sole save and autosave value regardless of the
active display projection. Explicit save flushes pending editor operations
before reading it. Original/Revised views are read-only presentations; neither
may replace canonical bytes in the tab buffer, autosave queue, source-mode
handoff, or file write.

| Sink                             | Marked view                                                              | Original/Revised view           | Security boundary                                             |
| -------------------------------- | ------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------- |
| File save, autosave, source mode | Raw canonical Markdown                                                   | Raw canonical Markdown          | Text only; never sanitize or normalize Critic syntax          |
| Copy as Markdown                 | Raw selected Markdown                                                    | Raw selected Markdown           | Text only                                                     |
| Normal copy/cut `text/plain`     | Raw selected Markdown, preserving review syntax for lossless paste       | Selected projected Markdown     | Text only; clean views are read-only                          |
| Copy as Rich `text/html`         | Semantic `<ins>`/`<del>`/review HTML                                     | Projected HTML                  | Sanitize immediately before `clipboardData.setData`           |
| Copy as Rich plain fallback      | Raw selected Markdown                                                    | Selected projected Markdown     | Text only                                                     |
| Copy as HTML                     | Sanitized semantic review HTML source                                    | Sanitized projected HTML source | HTML is placed in `text/plain`; the `text/html` slot is blank |
| Static/export HTML, PDF, print   | Semantic review HTML                                                     | Projected HTML                  | Sanitize final rendered HTML before it reaches the sink       |
| Search                           | Active parser-view text, including canonical marker bytes in Marked view | Projected read-only-view text   | Search never evaluates markup                                 |
| Word/character count             | Canonical Markdown, including annotations                                | Canonical Markdown              | Text only; changing this is a separate product decision       |

Comments are annotations, not trusted HTML. Their payload may be displayed as
text or a sanitized Markdown rendering, but it never becomes an unescaped
attribute. Script elements, event-handler attributes, and unsafe URL schemes
must not survive any final HTML sink, including payloads nested inside an
addition, deletion, substitution arm, highlight, or comment.

`getClipBoardHtml` is an intermediate renderer, not a safe sink. A caller that
places its output into an HTML-capable destination must apply the common final
clipboard sanitizer. Raw-source sinks deliberately bypass HTML parsing rather
than relying on sanitization.

### Resource and render-depth policy

Marked itself remains unlimited by default. MarkText opts its Markdown entry
points into a native block nesting budget of **128 container levels**. Parser
depths 0–127 remain semantic; attempting to parse another child at depth 128
creates one block-level `parser_residue` AST token for the complete excess
subtree. A source with 128 nested containers therefore retains all 128 native
wrappers and places the terminal bytes in residue. A zero budget makes the
root document one literal residue. Invalid budgets fail before parsing.

Parser residue carries its exact mapped source envelope plus a nonblocking
`marked-block-nesting-limit` diagnostic. It is neither a text-token convention
nor a Critic-specific fallback: Marked renders it as a preformatted block,
Muya lowers it to the registered `markdown-parser-residue` state/DOM block, and
the serializer writes its literal bytes back through the surrounding native
containers. Markdown, HTML, links, images, and Critic delimiters inside the
residue are displayed as text and never interpreted. Lazy continuation repair
must produce one reachable residue envelope and bounded provenance, including
for thousands of apparent nesting levels. Marked's pre-existing serializer
normalization may add explicit blockquote prefixes to unprefixed lazy lines;
fully prefixed input remains byte-identical.

The Markdown parser budget is separate from CriticMarkup semantic nesting.
The former protects native Markdown AST construction at 128 block containers;
the latter protects presentation recursion at 64 nested Critic items.

The grammar, projections, source map, and canonical document model do not use
the presentation ceiling: they scan and flatten nesting iteratively, retain
every item, and preserve the canonical Markdown byte-for-byte. Final renderers
have a separate ceiling of **64 semantic CriticMarkup levels** (depths 0–63).
This is intentionally far beyond plausible human review nesting while leaving
call-stack headroom for Markdown wrappers and DOM/HTML renderer frames.

At depth 64, the renderer emits the complete nested item—including every
deeper descendant—as literal source text. It does not accept, reject, truncate,
or discard any bytes. The live editor wraps that editable text in
`mu-critic-render-limit`/`MU_WARN`; static Marked output uses
`critic-render-limit`. Both carry the nonblocking
`critic-markup-render-depth-limit` diagnostic and an explanatory title. Source
mode, save, autosave, copy-as-Markdown, parser projections, and resolution
continue to operate on the unbounded canonical model.

Final adapters consume one cached, backend-neutral render plan built from the
immutable document's path index. That plan alone builds the parent/child forest,
sorts and validates siblings, assigns every child to exactly one semantic arm,
applies the render-depth policy, and supplies descendants-before-parent order
plus monotonic cursor lookup. The live tokenizer lowers its render sequences;
the Marked adapter weaves the same semantic nodes into the parser's located
native token tree. Neither backend owns a second parent index, arm partition,
overlap rule, depth rule, or per-item offset shifter, and neither may filter or
sort the complete item set per character, per arm, or per nested item. Dense
and over-budget final-pipeline tests enforce bounded path queries, linear item
reads, exact literal fallback, native-wrapper preservation, and round-trip
source preservation.

The same complexity law covers native fragment planning and tokenization.
Marker ranges, plan starts, next-plan offsets, boundary plans, and item/path
indexes are built once per parser artifact. Per-token and per-boundary work may
advance a monotonic cursor or query an index; it may not repeatedly `find`,
`filter`, or sort a complete global marker/plan set. Permanent call-count or
size-ratio tests enforce this on ordinary, dense, malformed, exclusion-heavy,
deep, wide, and native-container-heavy inputs.

## Vendored parser fork

Native CriticMarkup tokens required parser changes upstream `marked` does not
carry, so `packages/marked` vendors a private fork pinned to upstream
v18.0.5. Its contract: upstream release + the canonical patch = the checked-in
fork, byte-exact and verifiable offline. `FORK_MANIFEST.json` pins the
reviewed upstream git objects and the complete file inventory;
`scripts/verify-fork.mjs --self-test` proves the round trip and runs one
negative control per recorded drift class (source, version, manifest, patch,
consumer wiring); a network-isolated CI job re-proves it from a clean
checkout. Muya resolves `marked` through `workspace:*` only. The update
procedure lives in `packages/marked/UPSTREAM.md`.

## Roughdraft behavior reused as precedent

- Sequential typing extends the current addition rather than nesting markers.
- Replacing original text creates one substitution.
- Editing or removing text already inside a pending addition changes that
  addition directly.
- Addition, deletion, and substitution use Accept/Reject actions.
- Highlight and comment use one Remove/Resolve action because both projection
  decisions have the same result.
- Change and highlight cards focus their exact source annotation; comment cards
  edit in place, and every card reflects the current item.
- Source view exposes the raw Markdown syntax losslessly.

Roughdraft does not define Original/Revised display projections, Previous/Next
navigation, standalone-highlight review behavior, nested resolution, or one
complete cross-block editing matrix. MarkText's native model owns those areas.

## Test ownership

- `packages/muya/src/criticMarkup/__tests__/`: grammar, malformed recovery,
  projections, transforms, and Track Changes source invariants.
- `packages/muya/src/utils/marked/__tests__/`: Markdown AST context and literal
  ranges.
- `packages/muya/src/state/__tests__/`: source maps, block-spanning items,
  serialization, static HTML, and projection reparses.
- `packages/muya/src/__tests__/` and block/clipboard tests: real editor commands,
  history, focus, and structural mutations.
- `packages/desktop/test/`: native menu routing, Review sidebar, source-mode
  handoff, and hidden real-app workflows.

New edge cases belong first in the grammar/context corpus and then at every
affected consumer boundary. No consumer may add a private delimiter
interpretation to make its own test pass.
