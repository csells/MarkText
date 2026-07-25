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

Two self-consistent readings of this case exist, because the literal's
legality depends on the arm's extent while the arm's extent depends on the
closer — a fixpoint choice, not a derivable fact. The rejected reading (defer
the closer until the literal completes, the shared-loop behavior the
`@lezer/markdown` spike exhibited in research 0007) was implemented and then
reverted when four corpus rows defeated it. The grounds for this decision:

- **The typing invariant.** Typing `++}` always closes your annotation. Under
  the deferring reading, one stray backtick earlier in the arm silently keeps
  the annotation open and it swallows subsequent typing until a second closer
  appears — an invisible-state trap triggered while the user is mid-edit,
  which is the state this engine must be best at.
- **Comment opacity needs no special case.** A comment's payload is opaque
  metadata; under deferral, `{>>see `code<<} note`fails to close at`<<}`
  unless comments are exempted by hand. Under this decision R5 falls out of
  the same rule as everything else.
- **Containment at the smallest fixpoint.** The completing delimiter lies
  outside the arm, and paired Markdown with one endpoint inside an arm must
  have both endpoints there (ADR-0010). Taking the smallest fixpoint applies
  that rule without ever assuming the extended arm it would justify.
- **Locality.** Closer decisions depend only on source up to the candidate.
  The deferring reading makes an annotation's extent depend on text after it,
  which would add a third non-local re-key class to incremental fragment
  reuse (beyond reference definitions and unclosed fences) and widen
  keystroke invalidation for no user-visible benefit.
- **Interop.** The canonical CriticMarkup prose does not define this case and
  its only adjacent guidance tells authors to wrap Markdown pairs completely;
  every shipped implementation is Markdown-blind at closers and mechanically
  takes the first closer. This decision matches the entire ecosystem's
  observable behavior; deferral would be a MarkText-only invention.

Normative wording lives in the Profile 1 specification as rule **L2a**, with
divergence-ledger entry **D8** recording the departure from the lezer-spike
reading. The corpus pins the behavior from both directions: the pre-existing
row "does not let a containing-arm literal erase its enclosing closer" and
the spike-vocabulary rows covering the no-swallow and cross-arm-pairing
guards. Ratified by the owner on 2026-07-25 after review of the
specification silence, the user-impact comparison, and the performance
analysis.
