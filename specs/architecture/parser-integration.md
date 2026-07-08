# Parser Integration: MC Syntax Is First-Class

Product bar #1 (vision): MC syntax is recognized by the base Markdown parser
itself — block-level and inline — not by side-scans layered on top of it.

## Block level: metadata definitions

`packages/muya/src/utils/marked/extensions/commentMetadata.ts` registers a
marked block extension in `lexBlock` (unconditionally — MC is core syntax,
not an option) that tokenizes `[MC:id]: …` lines **ahead of marked's generic
reference-definition rule** and emits `commentMetadataDefinition` tokens.
`markdownToState` lowers the token to a paragraph state node carrying the raw
line, exactly like `def`.

Why this must stay tokenizer-level: marked's generic def rule registers
definition labels case-insensitively and drops duplicates. Routed through it,
a duplicate `[MC:id]` line (a merge artifact diagnostics must see) is
silently deleted, and an `[MC:x]` registration shadows a user's own `[mc:x]`
link definition into deletion. The extension guarantees:

- Duplicate definitions round-trip byte-identically, in place.
- Malformed payloads survive verbatim for the analyzer to diagnose.
- MC definitions never enter marked's link registry, so they can neither
  shadow nor be shadowed by ordinary reference definitions.
- The extension has **no `start` hook** on purpose: a definition line inside
  a paragraph run keeps folding into the paragraph (lazy continuation),
  which is also the analyzer's view of such lines.

The dependency direction is one-way: the parser imports only
`comments/syntax.ts` (the grammar owner); the comment analysis layer builds
on parser output. It is enforced by the import-graph test
(`src/__tests__/commentsDependencyBoundaries.spec.ts`), which asserts over
the transitive runtime imports of `markdownToState` and the marked setup
that no comments module beyond `comments/syntax.ts` is reachable; muya's
CI-level `check-circular` gate additionally catches the cyclic violations
(e.g. `comments/parse`, which imports the parser). The parser must never
call up into `comments/analyze` or `comments/parse` — the one time it did
(a post-hoc "restore dropped definitions" repair pass), it created a
dependency cycle, a mutual-recursion hazard, and two silent data bugs.
Repair passes over parser output are a design smell here: fix the tokenizer
instead.

## Inline level: range markers

`packages/muya/src/inlineRenderer/lexer.ts` tokenizes `<!--MC:id-->` /
`<!--MC:~id-->` into dedicated `comment_marker` tokens, ordered after inline
code (backticks win) and before generic HTML tags. Generic HTML comments are
untouched.

Runtime note: with the OT-anchor runtime
([comment-anchors.md](comment-anchors.md)), marker bytes never reach the
rendered document at load — the inline `comment_marker` rule and the
definition tokenizer serve **load-time extraction and file-level analysis**
(source mode, the CLI, merge gates, and any consumer of serialized bytes).
Marker-shaped bytes a user TYPES are literal text and render visibly — the
live renderer does no comment-specific hiding. Highlight spans derive from
anchors in clean-text offsets, never from marker tokens or nested DOM
structure (overlaps are not trees).

## Block classification interplay

A paragraph whose text begins with MC markers followed by non-HTML prose must
classify as a paragraph even though marked's html-block rule matches the
leading `<!--`. Two layers deliver it: the block tokenizer's `html` override
declines marker-led non-HTML lines before they become html tokens, and
`markdownToState` reclassifies via `htmlBlockTokenIsParagraph` — the shared
predicate living in `comments/syntax.ts` (the grammar owner) so the
tokenizer override, state lowering, and the comment source index cannot
drift. True raw HTML wrapped in markers stays an html-block and yields no
ranges.

## Consumers that must not re-implement the grammar

Desktop source mode (CodeMirror overlay mode), the source-mode comment
controller, and the agent CLI all consume the same recognition rules. The
CLI cannot import Electron-tainted modules, so it consumes `@muyajs/core`
exports (see agent-cli.md); the desktop imports the same package. Any second
implementation of "what is an MC marker/definition" is drift waiting to ship
and gets rejected in review.
