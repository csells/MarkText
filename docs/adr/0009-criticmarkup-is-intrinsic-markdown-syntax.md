# CriticMarkup is intrinsic Markdown syntax

MarkText Markdown Profile 1 recognizes Addition, Deletion, Substitution,
Highlight, and Comment as native grammar productions in the same parser/state
model alongside the CommonMark, GFM, and built-in MarkText constructs enabled by
that profile. The parser owns
their shared source progression, literal precedence, block/container state,
inline delimiters, definitions/references, Substitution-arm boundaries,
recovery, provenance, and accounting; the CM forest, projections, Comment
views, Review indexes, transformations, and render products are derived from
its one atomic lossless syntax graph. A matched-boundary Markdown construct
with one endpoint inside a Substitution arm must have both endpoints in that
same arm. The arm neither inherits open inline/literal matching state from
outside nor exports matching state to later source. At the boundary, unmatched
arm-local state ends under normal fragment recovery; the unchanged enclosing
state resumes after the closer. A complete construct whose two endpoints are
outside may enclose the whole Substitution.

This deliberately rejects the easier CM preprocessor/sidecar design. Markdown
and CM containment may cross, so the parse product is a graph rather than one
conventional containment-only AST, but crossing topology does not permit a CM
scanner, excluded-range pass, CM-first facade, post-hoc semantic join, or
flattened projection reparse to become an authority. Multiple internal parser
phases are allowed only when they consume the same canonical source tape and
directly build or refine the same parser-owned node/event identity space.
