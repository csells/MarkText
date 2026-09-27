# MarkText CriticMarkup Profile 2 — Recordable edits in arm literals

- **Status:** Implementer ruling under the owner's delegation, 23 September 2026
  ([ADR-0016](../../docs/adr/0016-arm-boundaries-end-arm-opened-literals.md)).
  Conformance examples live in
  `packages/document-core/test/criticmarkup-profile-2-arm-literals.spec.ts`.
- **Identifiers:** `markdownProfile: 'markdown-profile-2'` ·
  `criticMarkupProfile: 'marktext-profile-2'`.
- **Base:** [Profile 1](marktext-markdown-profile-1.md) with
  [Markdown Profile 2](marktext-markdown-profile-2.md). This document adds rule
  **L2c** and replaces rules **L2b** and **C3**. Every other rule, including L1,
  L2 and L2a, is unchanged.

## Why

With Track Changes on, every edit that works untracked must be recordable as a
tracked change: accepting the change yields the untracked result and rejecting
it yields the original. Under Profile 1 some such edits had no faithful
spelling. A fenced code block or HTML block that runs to the end of the
document cannot sit in an arm, because the arm's closer on its own line is
literal content of the block. A reference definition typed into an Addition
was invisible to references outside the Addition even after acceptance, and a
definition line ending at the closer swallowed the closer as its destination.

## L2c — line-start arm boundary

When a block literal (fenced or indented code, math, diagram, or HTML block)
opens inside an annotation arm, an unowned boundary token of that annotation
(`~>` or its closer) that begins a line, after that line's container prefix,
stands against the literal: the literal ends at the arm boundary as it would at
end of document. Block literals opened outside the arm keep L1 in full.

- "Begins a line" means the token directly follows the container prefix that
  the literal's own containers consume on that line (block-quote markers and
  list-item indentation). Any other leading whitespace, or any preceding text,
  leaves the token inside the literal.
- Only the innermost annotation's own boundary tokens qualify. An escaped token
  (E1) is never a boundary.
- Projections keep the arm's meaning: a fenced block that the boundary ended is
  materialized with its closing fence, so Revised for
  `{++```x⏎code⏎++}⏎after` is the untracked ` ```x⏎code⏎```⏎after `.

```markdown
{~~<div>
abc

</div>
~>new
~~}
```

The Substitution forms; Original is the HTML block and Revised is `new`.

````markdown
- {++```js
  let x = 1
  ++}
  after
````

The Addition closes after the list-item prefix; `after` is a paragraph in the
same item. A fence opened before any arm is unaffected:
` ```⏎++}⏎``` ` is one code block containing `++}`.

## L2b — reference-dependent ownership (replaces Profile 1 L2b)

A Comment or Substitution boundary that conflicts only with a possible
reference-dependent link destination stands. An Addition, Deletion or
Substitution closer also stands against a reference definition opened in its
arm: the definition is read as the arm-local fragment ending at the closer, so
`{++[a]: /u++}` is an Addition containing the definition `[a]: /u`, and
`{++[a]:++}` is an Addition containing the text `[a]:`. Any other already
recognized literal owner, including inline code, a direct link destination,
fenced code, HTML, front matter, and a definition inside a Comment or
Highlight, retains precedence under L1/L2.

## C3 — definitions in arms (replaces Profile 1 C3)

Link reference and footnote definitions written in an Addition or in a
Substitution's new arm are document-global in Revised. Definitions written in a
Deletion or in a Substitution's old arm are document-global in Original. In
each reader view, CommonMark's first-definition-wins rule then applies across
the whole view, exactly as in the document that accepting or rejecting every
change would produce. For example, in

```markdown
{++[a]: /u
++}

[a]
```

Revised resolves `[a]` to `/u` and Original leaves it as text.

Definitions in a Highlight payload remain local to that payload in every view.
Comment payloads remain isolated subdocuments (R5); inside a Comment Display the
same rule applies to its nested annotations. The Markup view keeps definitions
arm-local.

## Editing around commented spans (plan 0012 G39)

This section governs MarkText's editing and review operations, not
recognition: it changes how no existing source parses, so it needs no profile
identifier of its own and applies under Profile 1 as well. It keeps the
Highlight/Comment relation of Profile 1 V5 meaningful.

- **Markup input.** Typing, paste and drops in the Markup view never insert
  between a Highlight and the Comment after it. Text at the edges of commented
  text goes outside the commented span: after the Comment at its end, before
  the Highlight at its start. Text typed inside the commented text joins it.
  Google Docs likewise keeps text typed at a comment's edge out of the comment.
  Source-mode edits keep the bytes the author typed (ADR 0015).
- **Resolution.** Accepting or rejecting changes applies Profile 1 V4 and then,
  in the same transaction: if resolution removes all of a commented passage's
  text, its now-empty Highlight goes with it and the Comment stays standalone
  at that position (ADR 0003), so rejecting `{=={++new++}==}{>>n<<}` gives
  `{>>n<<}`, not `{====}{>>n<<}`; if resolution would leave a standalone
  Comment directly after a Highlight it was not paired with, the Comment moves
  to the end of that Highlight's text, keeping its position without creating a
  pair, so rejecting the Addition in `{==a==}{++x++}{>>n<<}` gives
  `{==a{>>n<<}==}`.

## Compatibility and versioning

These rules change the recognition of existing source, so they form a new
CriticMarkup profile under [Profile 1 §14](marktext-markdown-profile-1.md#14-versioning).
The compatibility cost is deliberate:

- An existing document whose in-arm block literal contains a line-start
  boundary token of its annotation now ends the literal and the annotation
  there. For example, a Comment whose fenced code sample shows a line `<<}`
  closes at that line.
- A reference outside an Addition, Deletion or Substitution may now resolve in
  Revised or Original to a definition inside the arm, and a definition line
  whose destination ran through an Addition, Deletion or Substitution closer now
  ends at that closer.

The canonical CriticMarkup specification, MultiMarkdown 6 and Fevol/Commentator
define no literal-block interaction, so neither rule departs from a published
behavior; L1 itself is already a MarkText ruling (Profile 1 §12, D1). Both
profile identifiers describe one composed grammar and do not authorize a second
parser or per-view reparsing.
