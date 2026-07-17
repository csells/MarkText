# Comment interaction is explicit and non-intrusive

Putting the caret in a commented span marks that comment's sidebar card as
selected and does nothing else — it never opens or scrolls the comments sidebar.
The reviewer opens the sidebar themselves, and edits a comment by a deliberate
act: clicking its card (inline edit), or right-clicking the span → Edit Comment.
Deleting is the card's Remove.

We chose this over the more discoverable "click the highlight / indicator opens
the comment" because comment reading should not hijack the reader's focus or
viewport while they are editing prose — the document stays the primary surface,
and comment work is opt-in. Composing a *new* comment is the one exception that
opens the sidebar, because the compose box must be visible to type into.

This replaces the earlier build's behaviour, where the in-document comment
indicator force-opened the sidebar on click.
