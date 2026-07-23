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
