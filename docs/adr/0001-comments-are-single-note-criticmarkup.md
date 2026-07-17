# Comments are single-note CriticMarkup, not threads

A comment is one anonymous `{>>…<<}` string with a create/edit/delete lifecycle —
no replies, authors, timestamps, or resolved state. We adopt the reference
review sidebar's *look and interaction* (compose-in-sidebar, highlighted anchor,
not-inline) but not its threaded data model, because the project constraint is
pure CriticMarkup only: threads/authors/timestamps/resolve would require a
metadata encoding (the `<!--MC:id-->` marker approach) that is explicitly out of
scope. Deleting the comment is the only "done" state.
