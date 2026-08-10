# An annotation closer stands against an open in-arm literal

When an inline literal (a code span or math span) opens inside a CriticMarkup
annotation arm and its would-be completing delimiter lies at or beyond the
arm's closer candidate, **the closer stands**. The arm ends at its first
unowned closer candidate; the open literal never completes and degrades to
literal text under arm-local recovery. A closer decision never requires
reading source beyond the candidate itself.

Example: in `{++a `x++}` b++}` the addition closes at the **first** `++}`.
The arm is ``a `x``, its backtick is literal, and the trailing text —
including the second `++}`, a closer with no opener — is plain text. After
Accept, the surviving text is reparsed as ordinary Markdown, where the two
backticks may then legitimately pair; that recognition change is the
documented accept-then-reparse semantics, not an inconsistency.

The canonical CriticMarkup prose does not define this overlap. Taking the first
unowned closer matches the ecosystem's observable behavior, makes `++}` reliably
close an annotation while typing, and applies ADR-0010's rule that paired
Markdown syntax cannot cross an arm boundary. Deferring the closer would let one
unfinished code or math delimiter invisibly swallow later prose.

Normative wording lives in Profile 1 rule **L2a**. Conformance examples cover
the first-closer result, unfinished literal recovery, and the fact that accepting
the annotation may let the surviving Markdown parse differently in the next
revision. Ratified by the owner on 2026-07-25.
