# Architecture: Portable Inline Review

Technical contracts for the review-comment feature described in
`specs/vision/review-comment-vision.md` and staged in
`specs/plans/review-comment-plan.md`. Each document records the invariants an
implementation must keep; file-level layout is described only where it is
itself a contract (e.g. which module owns a grammar).

| Document | Contract |
| --- | --- |
| [comment-format.md](comment-format.md) | The on-disk wire format (v2): MC markers, line-oriented thread metadata, payload schema, diagnostics, Git merge properties. |
| [comment-anchors.md](comment-anchors.md) | The runtime representation: OT-transformed anchors, extraction/materialization, mutations and undo, detach policy. |
| [parser-integration.md](parser-integration.md) | How MC syntax is first-class in the base Markdown parser, and the single-grammar-owner rule. |
| [editing-invariants.md](editing-invariants.md) | Editing under the anchor runtime: one coordinate space, deletion semantics for commented text, round-trip preservation. |
| [external-merge.md](external-merge.md) | The dirty-external three-way merge pipeline: base tracking, decision table, escalation gates, resolver UX. |
| [agent-cli.md](agent-cli.md) | The agent-facing CLI in `skills/markdown-comments`: commands, output schema, byte-preservation rules. |
| [test-infrastructure.md](test-infrastructure.md) | How tests earn trust: real component mounts, the e2e markdown bridge, condition waits. |

Two repo-wide working agreements govern every contract here (see `AGENTS.md`):
no fallbacks/heuristics/error-swallowing, and one source of truth per fact —
when two sources disagree, the divergence is a bug at the source.
