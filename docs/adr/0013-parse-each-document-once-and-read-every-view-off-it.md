# Markdown and CriticMarkup have one interpretation; views do not re-recognize source

- **Status:** Accepted semantic boundary; parse-count and safe-point mechanics superseded by
  [plan 0010](../../specs/plans/0010-marktext-criticmarkup-core-integration.md) and implementation
  baselines.

The engine owns one lossless interpretation of Markdown and CriticMarkup for a document revision.
Original, Revised, and Markup select CriticMarkup arms from that interpretation. A projection,
renderer, exporter, search index, clipboard path, or adapter must not flatten text and run a second
CriticMarkup recognizer or otherwise assign different syntax ownership to the same source.

This boundary is necessary because annotation arm selection can change Markdown adjacency and
block structure. For example, `{--# --}Title` contains a heading marker in Original and a paragraph
in Revised; `a{++\n\n++}b` can be one paragraph in Original and two in Revised. Each view must expose
the structure implied by the shared annotation recognition and Profile 1 projection rules without
changing which source spans are CriticMarkup or who owns literal ranges.

The editing view preserves marker-bearing canonical source. Original and Revised are derived,
read-only projections. Accept and Reject are source edits followed by a new authoritative revision,
not mutations to a private projection tree. Every projection carries an exact map back to canonical
source, and no consumer repairs or invents syntax after the engine publishes the revision.

The following are deliberately **not** architectural requirements:

- one physical parser pass or a particular parse count;
- fork nodes or any particular alternative-tree representation;
- a top-level-blank-line “safe point” algorithm;
- boundary-safe string codecs, parser configuration APIs, or accounting schemas;
- one storage or incremental-reuse data structure.

An implementation may use those mechanisms when measured evidence supports them. Whatever it uses
must preserve the language result, keep full and incremental parsing observationally equivalent,
avoid competing consumer interpretations, and meet plan 0010's product-path latency contract.
