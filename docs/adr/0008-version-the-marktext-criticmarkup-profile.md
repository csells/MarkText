# Version the MarkText CriticMarkup profile

MarkText will publish and version its complete CriticMarkup language contract
as the MarkText CriticMarkup Profile: intrinsic productions within the MarkText
Markdown grammar, not a peer parser pipeline. The five published CriticMarkup
forms are the compatibility base. Empty forms, nesting, block-spanning constructs,
Markdown-literal precedence, protective escapes, malformed recovery, resource
limits, deterministic diagnostic identity, Comment-display folding, and the
contextual codec that prevents semantic editor actions from accidentally
authoring marker syntax are explicit profile rules with conformance tests.
Authenticated Markdown literals have parser-owned atomic edit/enclosure rules,
and Substitution arms are self-contained Markdown fragments as specified by
ADR-0010. A paired Markdown construct cannot inherit matching state into an arm
or export arm-local matching state into later source.

The parse configuration contains a closed, versioned `MarkdownOptionsV1`
snapshot with exactly `frontMatter`, `math`, `gitLabMath`, `footnotes`, and
`subscriptAndSuperscript`. Every field is required and normalized; missing or
unknown fields and unknown option versions are rejected rather than silently
defaulted. The option version and values participate in revision semantic
hashes, caches, durable recovery records, and full/incremental equivalence;
changing one requires explicit reinterpretation. `frontMatter` controls
recognition of all Profile 1 front-matter forms—YAML, TOML, semicolon-delimited
JSON, and brace-delimited JSON—rather than choosing the spelling of newly
authored front matter.

Authoring preferences such as preferred EOL, list marker/delimiter and
indentation, loose-list preference, front-matter insertion spelling, and code
block cleanup affect only future source transformations. They are excluded
from parse configuration and revision semantic hashes, but the session journals
the exact authoring-policy identity and chosen spelling with each operation so
replay is deterministic. Changing an authoring preference does not reinterpret
existing source. If a setting later changes syntax recognition, it must enter a
new closed Markdown-options version or Markdown Profile through an explicit
compatibility decision; it cannot migrate between these categories implicitly.

Deterministic limits use a separately versioned abstract accounting schema
rather than implementation object counts. Every document revision is
interpreted under one immutable profile/configuration identity. MarkText will
not describe its extensions or accidental parser behavior as universal
CriticMarkup semantics. See ADR-0009.
