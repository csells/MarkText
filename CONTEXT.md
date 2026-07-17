# CriticMarkup Review & Comments

The vocabulary of MarkText's CriticMarkup review surface: the change/annotation
forms, their projections, and the comment sidebar UX. This glossary covers only
terms with a specific meaning in that surface — general editor and Markdown
terms are out of scope.

## Language

**Comment**:
A single anonymous note anchored to the document and serialized as the
CriticMarkup `{>>…<<}` form. Its entire lifecycle is create, edit, delete — it
carries no author, timestamp, reply, or resolved state.
_Avoid_: thread, note

**Anchor**:
The highlighted span a comment is attached to — the `{==…==}` immediately
preceding the comment's `{>>…<<}` in the source (gapless). It is created and
removed together with the comment as one unit, and never shown as a separate
Highlight. Every comment created through the app has one; the app requires a
selection to comment.
_Avoid_: target, range, selection

**Highlight**:
A standalone `{==…==}` span marking text for attention, created by Mark
Highlight. It is not a comment. A `{==…==}` that is immediately followed by a
`{>>…<<}` is not a plain Highlight — it is that comment's Anchor. Identity
follows creation intent, and adjacency is the proxy for intent.

**Commented span**:
The highlight+comment unit a single Add Comment produces —
`{==sel==}{>>note<<}`. Presented and managed as one thing (one Review entry;
Remove deletes the whole pair).

**Point comment**:
A comment whose anchor text has been fully deleted during editing, leaving a
`{>>…<<}` with an empty/collapsed anchor. It still lists in the sidebar and is
removable there. The app never *creates* one (it requires a selection); a point
comment only arises from later editing.

**Active comment**:
The comment whose anchor currently contains the caret/selection. It is shown as
selected in the comments sidebar (when the sidebar is open); nothing is opened
or scrolled on its behalf — viewing comments is an explicit user choice.
