# Version the MarkText CriticMarkup profile

MarkText will publish and version its complete CriticMarkup language contract
as the MarkText CriticMarkup Profile. The five published CriticMarkup forms are
the compatibility base. Empty forms, nesting, block-spanning constructs,
Markdown-literal precedence, protective escapes, malformed recovery, resource
limits, deterministic diagnostic identity, Comment-display folding, and the
contextual codec that prevents semantic editor actions from accidentally
authoring marker syntax are explicit profile rules with conformance tests.
Authenticated Markdown literals have parser-owned atomic edit/enclosure rules,
and deterministic limits use a separately versioned abstract accounting schema
rather than implementation object counts. Every document revision is
interpreted under one immutable profile/configuration identity. MarkText will
not describe its extensions or accidental parser behavior as universal
CriticMarkup semantics.
