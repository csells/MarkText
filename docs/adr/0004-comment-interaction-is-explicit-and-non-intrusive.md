# Comment interaction is explicit and non-intrusive

Putting the caret in a commented span marks that Comment's sidebar card as
selected when no deeper visible Review item owns the exact hit. Nested anchors
choose the innermost Comment; a nested change or plain Highlight wins when it is
deeper. Explicit card/navigation focus may remain on a parent while it survives.
None of these passive hits opens or scrolls Review. The reviewer opens the
sidebar themselves and edits by a deliberate act: clicking the Comment card, or
right-clicking the span and choosing **Edit Comment**. A nested right-click keeps
the deepest item's actions and also offers **Edit Comment** for the nearest
containing anchored Comment. Deleting is the card's Remove.

We chose this over the more discoverable "click the highlight / indicator opens
the comment" because comment reading should not hijack the reader's focus or
viewport while they are editing prose — the document stays the primary surface,
and comment work is opt-in. Composing a _new_ comment is the one exception that
opens the sidebar, because the compose box must be visible to type into.

This replaces the earlier build's behaviour, where the in-document comment
indicator force-opened the sidebar on click.
