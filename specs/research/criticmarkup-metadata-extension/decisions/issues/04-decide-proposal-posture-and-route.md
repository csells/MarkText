Status: resolved
Type: grilling
Blocked by: 01, 02

# Choose the proposal posture and submission package

## Question

Given the actual stewardship, prior extension history, and current ecosystem,
how should the proposal be named, packaged, evidenced, and presented to the
canonical CriticMarkup maintainers?

The answer must name the provisional public posture, proposal venue, artifact
type, compatibility claim, and supporting implementation evidence. Decisions
about the maintainers' eventual response are outside this ticket.

## Answer

Use **CriticMarkup Metadata Extension 1** as the provisional public name and
describe it as an optional, backward-compatible CriticMarkup superset. “CM2”
remains only a working nickname unless the canonical maintainers choose a
different normative name or version.

Submit the complete proposal itself as one self-contained issue in
`CriticMarkup/CriticMarkup-toolkit`, not a preliminary request for permission
to write a proposal. The issue should address the historical maintainers and
the active CriticMarkup implementer community; cross-link the prior attribution,
referenced-comments, and JSON-metadata proposals; state exactly which of their
recorded objections the new design resolves; and identify any limitation that
remains.

The proposal package consists of:

- the complete normative issue text, including terminology, grammar, record
  model, lifecycle, compatibility, recovery, security/resource limits, and
  worked examples;
- an executable, implementation-neutral conformance corpus; and
- a dedicated MarkText branch implementing the proposal and demonstrating the
  claimed CM1 compatibility and CM2 behavior.

Every CM1 document remains valid and unchanged under the extension. A legacy
CM1 reader must still recognize the containing annotation in an extended
document, though it may expose the compact reference as degraded payload. The
exact reference and registry grammar remains intentionally undecided until the
grammar ticket resolves it.

This effort makes no decision about upstream acceptance, rejection, silence,
independent publication, or later governance. Its destination is an excellent
proposal and credible implementation evidence to put before the maintainers.
