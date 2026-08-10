# Comments are single-note CriticMarkup, not threads

A comment is one unstructured `{>>…<<}` payload with a create/edit/delete
lifecycle. CriticMarkup permits generic metadata text, including author initials
or timestamps, but defines no schema, identity, replies, or resolved state;
MarkText preserves such text without interpreting it. We adopt the reference
review sidebar's _look and interaction_ (compose-in-sidebar, highlighted anchor,
not-inline) but not its threaded data model. Durable threads, structured
authors, and resolution would require an additional metadata encoding such as
`<!--MC:id-->`, which is explicitly out of scope. Deleting the comment is the
only "done" state.
