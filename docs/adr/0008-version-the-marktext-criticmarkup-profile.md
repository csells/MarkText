# Version the MarkText CriticMarkup profile

MarkText will publish and version its complete CriticMarkup language contract
as the MarkText CriticMarkup Profile: intrinsic productions within the MarkText
Markdown grammar, not a peer parser pipeline. The five published CriticMarkup
forms are the compatibility base. Empty forms, nesting, block-spanning
constructs, Markdown-literal precedence, escaping, malformed recovery,
projection behavior, and deliberate interoperability divergences are explicit
profile rules with independent conformance expectations.

Every document revision is interpreted under an explicit language profile and
syntax-affecting option set. Unknown profile versions or option fields are
rejected rather than silently defaulted. A setting that changes recognition or
projection requires a new profile or a recorded compatibility decision;
authoring preferences that only choose future source spelling do not reinterpret
existing source.

Resource budgets, diagnostic IDs, hashes, caches, journals, parser APIs,
accounting schemas, and protective transform implementations are not language
rules unless independent implementations must agree on their observable result.
MarkText will document its extensions as MarkText rulings rather than universal
CriticMarkup semantics. See ADR-0009 and the candidate Profile 1.
