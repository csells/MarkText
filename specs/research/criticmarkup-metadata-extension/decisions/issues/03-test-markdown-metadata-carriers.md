Status: resolved
Type: research
Blocked by:

# Test Markdown-native carriers for CM2 records

## Question

How do normative CommonMark/GFM and representative maintained Markdown parsers
treat candidate out-of-band carriers and reference spellings: link reference
definitions, footnote-like definitions, HTML comments, front matter, fenced
blocks, and any prior-art carrier discovered by the extension survey?

Establish, from specifications and small reproducible fixtures, visibility in
rendered output, placement constraints, duplicate and missing-reference rules,
source preservation, JSON escaping constraints, interactions with CriticMarkup
recognition, and behavior in the current MarkText language engine. This ticket
gathers facts; it does not choose the grammar.

## Research artifact

Planned branch: `research/cm2-markdown-carriers`

## Answer

No tested Markdown-native carrier simultaneously provides normative Markdown
semantics, arbitrary plain JSON, hidden rendering, free placement, bounded
malformed-input behavior, and exact preservation.

An unused CommonMark link reference definition is the only tested normative
construct that emits no rendered block, but its value is a URL plus optional
title rather than arbitrary JSON. It also imports label normalization, a shared
link namespace, first-definition-wins semantics, and Comment-scope behavior
that CM2 cannot adopt accidentally. Plain `[id] {json}` is only a visible
paragraph.

HTML comments are the closest opaque hidden region, but hiding depends on raw
HTML policy; arbitrary JSON must encode forbidden terminators; and an unclosed
comment can absorb the remainder of a document and suppress later
CriticMarkup. Front matter is dialect-specific and normally beginning-only;
footnotes render when referenced and are not formal GFM; fenced code is visible
and also has an unbounded missing-closer failure mode. Generic Markdown AST
round trips may normalize any of these even when their semantic node survives.

The syntax decision must therefore prioritize bounded malformed-input failure,
explicit CM2 identity rules, Comment isolation, exact data encoding, separate
rendering and preservation contracts, update locality, literal precedence, and
profile versioning. Borrowing an existing Markdown form does not remove the
need for a CM2-owned grammar and association layer.

Research artifact: `specs/research/criticmarkup-metadata-extension/markdown-carrier-behavior.md`
on branch `research/cm2-markdown-carriers`, commit
`1f7cb89252fd814590ca440080a38b8eefa820bd`.
