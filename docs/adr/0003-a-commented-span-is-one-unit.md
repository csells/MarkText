# A commented span is one unit, distinguished from a plain highlight by adjacency

Add Comment on a selection emits two CriticMarkup items — a `{==…==}` highlight
(the anchor) and a `{>>…<<}` comment — but they are treated everywhere as one
"commented span": one Review-list entry (the anchor is never a separate
Highlight card), and Remove deletes the pair together. A standalone `{==…==}`
made by Mark Highlight is a plain highlight and shows on its own.

Identity follows the user's creation intent (highlight vs comment), which
CriticMarkup can't store; the proxy is source adjacency — a gapless
`{==…==}{>>…<<}` (always how the app emits it) is a comment's anchor, a lone
`{==…==}` is a highlight. Treating the pair as one unit avoids orphans: a
reviewer can't delete the anchor and strand an anchorless comment, or delete the
comment and leave a dangling highlight.
