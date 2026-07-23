# Substitution arms are self-contained Markdown fragments

MarkText Markdown Profile 1 treats the old and new payloads of a CriticMarkup
Substitution as separate Markdown fragments. Both receive the same applicable
positional, block-container, option, and outer definition context. Matching
state created inside an arm—including inline delimiter, literal, fence, and
container state—must finish inside that arm. An unfinished construct recovers
at the separator or closer as it would at the end of a fragment; it cannot
make later source literal or otherwise change how a following CriticMarkup
item is recognized. An arm also does not inherit open inline, link, or literal
matching state from outside: paired Markdown syntax with one endpoint inside an
arm and the other outside is unsupported. Definitions created in one arm are
visible only in that arm. After the Substitution, the enclosing parser state
resumes unchanged. A construct with both endpoints outside may enclose the
whole Substitution.

When recursive arm selection would place an outside delimiter next to an
arm-local delimiter and make the flattened projection look like a valid pair,
the boundary-safe projector applies the shortest typed Profile 1 codec at the
first unsafe transition. Usually that is one escape. Preserving retained
meaning may instead require extending both ends of an inline-code span,
respelling both ends of enclosing emphasis (with a minimum round-tripping
entity codec where flanking requires it), or generating a fence closer/line
ending at an arm-fragment exit. Raw NUL and unpaired surrogate units remain
exact source and use CommonMark's virtual replacement-atom semantics for
flanking; they are never serialized as non-round-tripping references.
Generated provenance points to the causal canonical delimiter, scalar, or arm
exit. The protected Original or Revised source therefore reparses to the same
meaning as the retained graph; a projection never retroactively turns a
cross-arm pair into Markdown syntax or merges two independent block fragments.

The upstream CriticMarkup toolkit does not define choosing one arm as changing
how Markdown after the Substitution is parsed, and it advises authors to wrap
Markdown tags completely inside each alternative. MarkText therefore parses
following source once from the unchanged enclosing state. Giving later source
different semantic owners depending on an arm would complicate editing and
resource limits and reduce interoperability without a specified user benefit.
Complete Markdown constructs may still span a whole
CriticMarkup item from outside it, and non-Substitution CM markers remain
zero-width grammar events; only arm-local matching state is contained.
