# Arm boundaries end arm-opened literals, and arm definitions follow their view

The owner's requirement is that, with Track Changes on, every edit that works
untracked can be recorded as a tracked change whose Accept is the untracked
result and whose Reject is the original. Profile 1 could not express some of
those edits. Under L1, a fenced code or HTML block that runs to the end of the
document owns every later line, so a closer on its own line inside the arm is
code text and the annotation never forms. A reference definition typed into an
Addition resolved nothing outside the Addition even in Revised (C3), and a
definition line ending at the closer took the closer as its destination.

MarkText CriticMarkup Profile 2 therefore adopts three rules, decided by the
implementer under the owner's delegation of language and architecture choices:

- **L2c.** A boundary token of the innermost annotation (`~>` or its closer)
  that begins a line after the container prefix ends a block literal opened in
  that arm, exactly as end of document would. Literals opened outside the arm
  keep L1 in full, and indented or mid-line tokens remain literal content.
- **C3.** Definitions in an Addition or new arm are global in Revised;
  definitions in a Deletion or old arm are global in Original. Highlight
  definitions stay arm-local, Comments stay isolated, and Markup keeps
  definitions arm-local.
- **L2b.** An Addition, Deletion or Substitution closer stands against a
  definition opened in its arm; the definition is read from the arm-local
  fragment ending at the closer.

## Research

The canonical CriticMarkup prose, MultiMarkdown 6 and Fevol/Commentator define
no interaction between annotations and literal blocks; their processors either
ignore literal ranges or confine annotations to one block. Profile 1's L1 is
MarkText's own ruling (Profile 1 §12, D1), so narrowing it at arm boundaries
departs from no published behavior. The line-start restriction mirrors how a
Markdown fence closer is recognized and keeps closers that are genuinely part
of code samples, such as `x ++}`, literal.

## Consequences

The profile identifier changes to `marktext-profile-2` (Y2). An existing
document whose in-arm literal contains a line-start boundary token of its
annotation now ends that literal and the annotation there, and references may
now resolve in Original or Revised to definitions inside change arms. This
compatibility cost is accepted to make tracked editing complete. Normative
wording lives in
[CriticMarkup Profile 2](../../specs/language/marktext-criticmarkup-profile-2.md).
