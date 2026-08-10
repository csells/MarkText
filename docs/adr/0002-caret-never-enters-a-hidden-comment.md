# The caret never enters a hidden comment

A comment's `{>>…<<}` is collapsed to zero width in WYSIWYG. The other four
forms expose their semantic payload through the active WYSIWYG projection, but no CM
marker or Substitution separator has a live editable position; raw marker edits
belong to Source mode. Because the Comment payload is edited only in the sidebar
or Source mode, the caret must never be able to land inside that hidden region — by
arrow, word/line/document jump, mouse click, select-all-then-collapse, or
programmatic cursor restore. Enforce it at the navigation and cursor-placement
layer as a general invariant, not as per-key patches.

Without this, a reviewer arrowing through a paragraph could type into
`{>>…<<}` content they cannot see, silently corrupting the comment. The
comment form is the only fully-hidden CriticMarkup form, so this invariant is
comment-specific.
