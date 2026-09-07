# CriticMarkup metadata extension research

This directory preserves the research requested during the 12–16 August 2026
CriticMarkup extension discussion. It supports a community syntax proposal for
optional attribution, replies and conversation state. It is not implemented CM1
behavior, an accepted CriticMarkup standard, or part of plan 0011 delivery.

## Later decisions

The [domain vocabulary](../../../CONTEXT.md) records the later decisions:
`ANNOTATION<!--cmid:ID-->` refers directly to `[ID]: <JSON>`; all annotation and
reply bodies remain inline CriticMarkup; JSON adds provenance, relationships and
current state. Highlights carry no metadata. The schema evolves through optional
additions while preserving unknown fields. These are proposal decisions, not
claims about the capabilities of the current editor.

## Research chronology

| Report | Status and purpose |
| --- | --- |
| [Stewardship and proposal path](stewardship-and-proposal-path.md) | August 12 investigation of the community and submission route. Originally committed on `research/cm2-stewardship` at `dbfe63e6`. |
| [Prior extensions and metadata](prior-extensions-and-metadata.md) | August 12 prior-art survey. Originally committed on `research/cm2-prior-art` at `c1604b5d`. |
| [Markdown carrier behavior](markdown-carrier-behavior.md) | August 12 carrier experiments. Originally committed on `research/cm2-markdown-carriers` at `1f7cb892`. |
| [Markdown standards and conventions](markdown-standards-and-conventions.md) | August 13 standards analysis by the `markdown_standards` research agent. |
| [Syntax risk analysis](cm-metadata-syntax-risk-analysis.md) | August 13 historical proposal by the `syntax_risk` agent. Its `{>>:ID<<}` markers and JSON comment bodies were superseded by the later decisions above. Preserved unchanged as research history. |
| [Markdown ecosystem interoperability](markdown-ecosystem-interoperability.md) | August 13 parser/serializer experiments by the `markdown_ecosystem` agent. Example markers reflect the earlier proposal; compatibility observations are dated evidence. |
| [Whitespace and adjacency](criticmarkup-whitespace-and-adjacency.md) | August 14 research by the `cm_whitespace_research` agent, followed by the decision to allow same-line ASCII spaces/tabs without absorbing them into an annotation. |
| [Versioning](criticmarkup-versioning.md) | August 14 research by the same agent supporting optional additive metadata fields. |

The five later reports and domain additions had remained uncommitted in the shared
CM1 worktree. This branch consolidates them with the three previously committed
reports. Original research files are preserved verbatim; their recommendations
must be read in chronological context. The local Wayfinder map and decision
working files remain preserved under `.scratch/criticmarkup-metadata-extension/`;
this index does not assert that its proposed implementation or conformance work
has been completed.
