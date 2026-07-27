# document-core — engine language

The ubiquitous language of the `@marktext/document-core` engine: revisions,
the composed Markdown+CriticMarkup profile, lanes, views, and materialization.
This glossary travels with the package (it must survive extraction from
MarkText). The review-surface UX vocabulary lives in the repo root
`CONTEXT.md`; see `CONTEXT-MAP.md`.

## Language

**Document revision**:
One immutable exact canonical Markdown snapshot accepted as document authority
under one immutable parse configuration. It is either a Complete revision or a
Source-only revision. An accepted edit replaces the revision as a whole; views
of it are never independent document authorities.
_Avoid_: JSON state, live DOM state, parser sidecar

**Complete revision**:
A Document revision whose MarkText Markdown Profile interpretation completed
within its deterministic execution budget. It owns the atomic lossless syntax
graph, diagnostics, provenance, ownership, projections, and semantic indexes
used by WYSIWYG, Review, commands, and materializers.
_Avoid_: normal revision, successful parse result

**Source-only revision**:
A Document revision that retains the exact canonical source, immutable parse
configuration, identity, and one fatal resource diagnostic
when a complete interpretation cannot safely be published. It permits Source
mode, exact persistence, and an explicit retry or reinterpretation, but exposes
no semantic graph, projection, WYSIWYG surface, Review surface, or semantic
materializer. It remains document authority rather than becoming an error
placeholder.
_Avoid_: failed document, partial parse, literal fallback, truncated revision

**Canonical source**:
The exact decoded UTF-16 code-unit sequence owned by a Document revision and
written by save or autosave. Parsing and no-op persistence do not normalize its
line endings, trivia, escapes, marker spelling, or Unicode representation. The
desktop persistence adapter separately owns file encoding and byte-exact
open/save behavior.
_Avoid_: normalized Markdown, serialized view

**MarkText Markdown Profile**:
The complete versioned Markdown language MarkText accepts: pinned CommonMark,
GFM, built-in MarkText constructs, and the configured intrinsic CriticMarkup
productions.
_Avoid_: base Markdown parser, host language

**MarkText CriticMarkup Profile**:
The versioned subset of the MarkText Markdown Profile that defines the five
intrinsic CriticMarkup forms and MarkText behavior where upstream sources are
silent or inconsistent. Its forms participate in the complete profile's syntax
and precedence rather than forming a peer language.
_Avoid_: CriticMarkup dialect, peer CM language, current parser behavior, de facto grammar

**Projection**:
A read-only Original, Revised, or Comment-display interpretation selected from
one Complete revision. It is never an independent document authority and is
unavailable for a Source-only revision.
_Avoid_: parsed copy, alternate document

**Substitution arm**:
The old or new payload of one Substitution. Markdown constructs that require a
matching boundary must have both endpoints within that arm. An arm neither
inherits an open matching boundary from outside nor exports one to later
source. A complete construct with both endpoints outside may enclose the whole
Substitution.
_Avoid_: route, branch-continuation lane

**Standing closer**:
An annotation's closer candidate always ends its annotation at the first
unowned occurrence, even while an inline literal opened inside the arm is
still awaiting its completing delimiter. The literal never completes across
the boundary; its opener degrades to literal text. Typing a closer therefore
always closes the annotation, and no closer decision depends on source beyond
the candidate. (ADR-0014; Profile 1 rule L2a.)
_Avoid_: deferred closer, extended arm, literal-first closing

**Lane**:
One contiguous stretch of canonical source parsed under a single Markdown
continuation state — the root document flow or one annotation arm's flow. A
lane neither inherits open matching state from outside nor exports it.
_Avoid_: sub-parser, region, sidecar parse

**Fork**:
The recorded alternative block or inline shapes a marker region takes in
different views, captured during the one canonical parse where eliding a
marker changes Markdown structure. Reading a view selects an alternative; it
never reparses.
_Avoid_: view reparse, branch copy

**Safe point**:
A top-level blank line with no open fenced-code or HTML block, where diverged
view structure reconverges and shared parsing resumes.
_Avoid_: sync point, checkpoint (that is the lane-state term)

**Segment map**:
The exact, gapless, parser-created mapping from a projection's text to
canonical source offsets. Every materialized view carries one; consumers never
reconstruct provenance.
_Avoid_: offset table, diff map

**Materializer**:
A doc-core module that renders a revision's structure into an output form
(canonical bytes for persistence, HTML for export and conformance). A
materializer consumes the parse; it is never part of the parser and never a
second recognition authority.
_Avoid_: renderer pass, serializer stage (for the persistence case)
