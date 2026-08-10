# A nonempty gapless Highlight and Comment are one Review presentation

Add Comment on a selection emits two CriticMarkup items — a `{==…==}` highlight
(the anchor) and a `{>>…<<}` comment — but Review presents them as one
"commented span": one list entry (the anchor is never a separate Highlight
card). Explicit **Remove comment** unwraps the Highlight while retaining its
payload and deletes the Comment. A standalone `{==…==}` made by Mark Highlight
is a plain highlight and shows on its own.

CriticMarkup stores the Highlight and Comment independently and has no creation
intent, attachment edge, or special point-comment form. Its published usage
recommends that a Highlight be followed immediately by a related Comment.
MarkText therefore freshly derives a **nonempty**, gapless pair as one Review
presentation from each source revision while the parser retains two ordinary
syntax nodes; no creation intent, relationship, or durable identity is
persisted or fed back into grammar identity. “Nonempty” means the Highlight
contributes content to the Revised projection, not merely marker bytes or
renderer pixels. If editing removes that final contribution, the Highlight
wrapper is removed and the Comment remains a standalone source-position
comment. Track Changes must make that transition undoable and preserve normal
accept/reject meaning. `{====}{>>…<<}` is an empty Highlight and an independent
Comment, not a barrier, sentinel, or zero-width anchor.
