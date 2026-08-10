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
the derived projection preserves the syntax meaning established by the arm
boundaries; it does not retroactively form cross-arm Markdown pairs or merge
independent block fragments. If a consumer materializes projected source, any
protective spelling is minimal, reversible, and explicitly mapped to canonical
source. The language profile defines the observable result; it does not require
a particular codec.

The upstream CriticMarkup toolkit does not define choosing one arm as changing
how Markdown after the Substitution is parsed, and it advises authors to wrap
Markdown tags completely inside each alternative. MarkText therefore interprets
following source from the unchanged enclosing state. Giving later source
different semantic owners depending on an arm would complicate editing and
resource limits and reduce interoperability without a specified user benefit.
Complete Markdown constructs may still span a whole CriticMarkup item from
outside it; only arm-local matching state is contained.
