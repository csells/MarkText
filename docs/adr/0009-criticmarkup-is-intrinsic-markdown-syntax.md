# CriticMarkup is intrinsic Markdown syntax

MarkText Markdown Profile 1 recognizes Addition, Deletion, Substitution,
Highlight, and Comment as native productions in the same language model as the
CommonMark, GFM, and built-in MarkText constructs that profile enables. One
engine interpretation owns literal precedence, block/container state, inline
delimiters, definitions/references, recovery, and provenance. Projections,
Comment views, Review indexes, transformations, and render products derive from
that atomic lossless model (ADR-0006). Substitution arms are self-contained
Markdown fragments; see ADR-0010.

This rejects a competing CM preprocessor or sidecar authority. Markdown and CM
containment may cross, and arm selection can change Markdown structure, so a
conventional containment-only AST may be insufficient. That does not require a
particular parser algorithm or graph representation. Multiple internal phases
are permitted, but no consumer may re-recognize CriticMarkup, discover syntax
from a flattened projection, or assign new identity after publication. See
ADR-0013.

HTML, print, PDF, clipboard, search, and other consumers receive typed structure
and explicit projections. They perform presentation and safe materialization,
not syntax recognition. Comparing their output with independently defined
expected results tests the shared language interpretation only when those
consumers add no private parser.
