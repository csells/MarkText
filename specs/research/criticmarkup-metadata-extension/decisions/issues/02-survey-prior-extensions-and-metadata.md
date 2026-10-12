Status: resolved
Type: research
Blocked by:

# Survey prior CriticMarkup extensions and metadata conventions

## Question

What CriticMarkup proposals, forks, extensions, and shipping implementations
have added or discussed stable annotation identity, attribution, timestamps,
replies, resolution, or out-of-band records? What exact syntaxes and semantics
did they use, how interoperable were they, and what evidence exists about their
adoption or failure modes?

Use original specifications, repositories, issues, source code, fixtures, and
release documentation. Include incompatible de facto conventions only when a
primary source establishes them.

## Research artifact

Planned branch: `research/cm2-prior-art`

## Answer

No accepted CriticMarkup extension combines durable IDs, attribution,
timestamps, replies, resolution, and out-of-band records. The canonical
project still defines only its original five forms. Its relevant proposals for
attribution, referenced comments, and inline JSON metadata plus adjacent
replies all remain open and unmerged.

Shipping tools have created mutually incompatible dialects. NVUltra and Review
Comments encode free-form attribution inside Comment text; Commentator prefixes
each annotation payload with JSON and infers replies from exact adjacency;
Obsidian Track Changes prefixes CriticMarkup sigils with HTML-like attributes;
Markdown Markup embeds a compact stable ID, author, and pipe-separated replies
inside Comment text. These demonstrate demand and implementation feasibility,
not convergence or canonical acceptance. Their bug and release histories expose
delimiter collisions, malformed serialization, nesting regressions, duplicate
IDs, and adjacency-dependent thread fragility.

The closest architectural precedent is an unreleased historical MarkText
branch with inline IDs and end-of-file JSON records. It replaced a whole-thread
single-record format because the opaque line was hard to review and concurrent
replies produced same-line merge conflicts. A one-line-per-thread format is
therefore a feasible hypothesis with a demonstrated Git-conflict cost, not a
settled constraint; the later design ticket must compare it with the replacement
and other layouts.

The combination under consideration remains new. Evidence favors compact
opaque IDs, explicit structured fields, no adjacency semantics, precise
compatibility claims, explicit malformed/duplicate behavior, and conformance
against the actual Markdown parser.

Research artifact: `specs/research/criticmarkup-metadata-extension/prior-extensions-and-metadata.md`
on branch `research/cm2-prior-art`, commit
`c1604b5d561b631fb32efcd5c486e156620c618e`.
