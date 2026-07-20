# A nonempty gapless Highlight and Comment are one Review presentation

Add Comment on a selection emits two CriticMarkup items — a `{==…==}` highlight
(the anchor) and a `{>>…<<}` comment — but Review presents them as one
"commented span": one list entry (the anchor is never a separate Highlight
card). Explicit **Remove comment** unwraps the Highlight, retaining its exact
payload source including nested CM, with only minimum protection at a delimiter
causally reclassified by the transform or a provenance-bearing
`BofTextCodecV1` encoding when an ordinary nonleading U+FEFF moves to offset
zero, and deletes the entire Comment. A standalone `{==…==}` made by Mark
Highlight is a plain highlight and shows on its own.

CriticMarkup stores the Highlight and Comment independently and has no creation
intent, attachment edge, or special point-comment form. Its published usage
recommends that a Highlight be followed immediately by a related Comment.
MarkText therefore freshly derives a **nonempty**, gapless pair as one Review
presentation from each source revision while the parser retains two ordinary
syntax nodes; no creation intent, relationship, or durable identity is
persisted or fed back into grammar identity. “Nonempty” is the
revision-owned, ancestor-net root-Revised contribution classification frozen in
plan 0009—not raw payload bytes, renderer pixels, or Comment payload length.
Ordinary untracked text editing that deletes all highlighted prose removes the
Highlight wrapper and leaves the canonical standalone `{>>…<<}` Comment. For a
root-effective `(present,present)` anchor, tracked whole-anchor deletion wraps
the complete Highlight in a Deletion so Reject restores the pair and Accept
leaves the standalone Comment. The pending-carrier and hidden-descendant
exceptions are deliberate: an `(absent,present)` anchor edits directly inside
its existing Addition/Substitution-new carrier, while the hidden-descendant
check runs first for every carrier and rejects direct/tracked whole deletion or
the partial edit that would remove the final Revised contribution. Without a
hidden Comment, that last partial edit discards the exhausted Highlight wrapper
when tracking is off while retaining residual untargeted non-Comment nodes;
root-effective tracking wraps that whole current Highlight
in one Deletion, even if earlier tracked edits are nested inside it, so Reject
restores the immediately prior anchor. `{====}{>>…<<}` is an empty Highlight and
an independent Comment, not a barrier, sentinel, or zero-width anchor.
