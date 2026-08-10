# Plan 0009 migration artifacts

- **Status:** Historical implementation evidence; non-normative
- **Active plan:** [0010 MarkText CriticMarkup core integration](../plans/0010-marktext-criticmarkup-core-integration.md)

This directory records corpora, fixtures, implementation limits, wire formats, and certification
artifacts created while executing archived plan 0009. Nothing here defines product readiness or
changes the language merely because the research implementation consumed it.

The `0009-*` ledgers and `criticmarkup-retired-authority-deletion.tsv` are closed certification
history. They must not be revived as plan 0010 gates. In particular, absence of archived files,
two-pass mutation attestations, exact evidence tags, and the old completion state do not determine
whether the CriticMarkup product is complete.

The remaining files are candidates for selective reuse during plan 0010 Phase 0:

- Language examples and expected results may move beside the imported engine tests after their
  semantics are independently reviewed against the ratified Profile 1.
- File, EOL, malformed-input, consumer, and interaction cases may seed product acceptance tests.
- Hash, wire, accounting, resource, and reuse records describe one implementation. Their exact
  encodings, limits, algorithms, and thresholds are not product or language requirements.

Every reused artifact receives an import, adapt, supersede, or reject disposition in the Phase 0
salvage inventory. Until then it is evidence, not authority.
