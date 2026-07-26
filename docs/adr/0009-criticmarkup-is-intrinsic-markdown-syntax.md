# CriticMarkup is intrinsic Markdown syntax

MarkText Markdown Profile 1 recognizes Addition, Deletion, Substitution,
Highlight, and Comment as native grammar productions in the same parser and
state model as the CommonMark, GFM, and built-in MarkText constructs that
profile enables. One parser owns all their shared parse state: source
progression, literal precedence, block/container state, inline delimiters,
definitions/references, recovery, provenance, and accounting. Everything else —
the CM forest, projections, Comment views, Review indexes, transformations, and
render products — derives from its one atomic lossless syntax graph (ADR-0006),
not from a separate pass. Substitution arms are self-contained Markdown
fragments; see ADR-0010.

This deliberately rejects the easier CM preprocessor/sidecar design. Markdown
and CM containment may cross, so the parse product is a graph, not a
conventional containment-only AST. But crossing topology does not license a CM
scanner, excluded-range pass, CM-first facade, post-hoc semantic join, or
flattened projection reparse as an authority. Multiple internal parser phases
are allowed only when they consume the same canonical source tape and directly
build or refine the same parser-owned node/event identity space.

Resolving a recorded fork is part of that one parse, not a separate pass. Where
eliding a marker changes structure, a view's resolution may re-run a parser
phase over the divergent region alone: it reads the same canonical tape through
the projection's exact segment map, settles a divergence the parse itself
recorded, and yields a view read rather than a competing authority (ADR-0013).
Because reference definitions are document-scoped and their visibility is
view-dependent, inline resolution takes a per-view definition index even where
block structure is shared — a block containing no marker can still resolve
differently per view. None of that relaxes what is forbidden above: no stage may
re-recognize CriticMarkup, discover syntax from a flattened string, or join
identity after the fact. It adds one obligation instead — text that does not
change across views is resolved once and shared, never re-parsed per view.

The HTML serializer is the render-product case of this rule. It is a
materializer packaged with document-core: a pure consumer of a revision's
block/inline structure that walks parser-created nodes and emits HTML, sitting
outside the parser exactly as the canonical-bytes and markup-render
materializers do. It performs no recognition — no regex over source, no
re-tokenization of node text, no discovery of syntax the graph does not
already carry — and therefore can never become the second authority this
decision forbids. Structural conformance runs through it: comparing its
output for a corpus input against the specification's expected HTML tests the
one intrinsic parse, which is only meaningful because the serializer adds no
interpretation of its own.
