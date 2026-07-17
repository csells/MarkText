# The caret never enters a hidden comment

A comment's `{>>…<<}` is collapsed to zero width in WYSIWYG (unlike the other
four CriticMarkup forms, which gray-reveal their markers when the caret enters
them for inline editing). Because the comment is edited only in the sidebar or
source mode, the caret must never be able to land inside that hidden region — by
arrow, word/line/document jump, mouse click, select-all-then-collapse, or
programmatic cursor restore. Enforce it at the navigation and cursor-placement
layer as a general invariant, not as per-key patches.

Without this, a reviewer arrowing through a paragraph could type into
`{>>…<<}` content they cannot see, silently corrupting the comment. The
comment form is the only fully-hidden CriticMarkup form, so this invariant is
comment-specific.
