# The document revision is the sole authority

MarkText will replace mutable JSON block state as document authority with one
immutable, lossless document revision containing the exact canonical Markdown
and its unified Markdown/CriticMarkup interpretation. The DOM, editor block
tree, review surfaces, projections, and exports are derived views; accepted
commands replace the revision as a whole. This prevents independently produced
state, syntax, and provenance from being rebound or inferred after the fact.

A durable commit record may encode a revision's exact base/source edits, source
hash, profile, and transition metadata for crash recovery. That record is the
serialized identity of the same logical revision, not a second semantic model:
no consumer can query syntax from it, and after worker loss all semantic access
stops until the exact revision is deterministically rematerialized and verified.
