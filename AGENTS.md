# Repository instructions

Standing requirement: all existing Markdown and new CriticMarkup features share
one parser, document model and editing stack through rendering and UI. Semantic
sidecars and supplemental legacy-event metadata do not satisfy this requirement.

Before implementing, refactoring, testing or reviewing parsing, document state,
editing, rendering, or a UI feature that consumes document semantics, read the
[unified-stack contract and verification gate](specs/architecture/criticmarkup-native-integration.md#one-parser-to-ui-stack).
It governs existing Markdown and CriticMarkup together. Existing code is not proof
of compliance; known violations are recorded in the CURRENT blockers of the
[active integration plan](specs/plans/0012-criticmarkup-upstream-integration-review.md#current-completion-blockers).

Check the intended production path against that contract before choosing an
implementation, then apply its verification gate before declaring a migration
complete or a candidate ready. Carry
the contract link, affected blockers and unresolved regressions into delegated
tasks and handoffs. Keep unfinished requirements active when plans are archived;
repair this pointer when the active plan changes. A passing subset or a new plan
does not waive the contract.

See [CLAUDE.md](CLAUDE.md) for repository tooling and package conventions; its
descriptions of current implementation do not supersede the architecture contract.
