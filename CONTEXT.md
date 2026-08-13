# CriticMarkup review and document authority

The vocabulary of MarkText's CriticMarkup review surface and the document
authority that preserves its source. Parser and language mechanics live behind
the document-core facade.

## Language

**Comment**:
The unstructured metadata payload serialized by CriticMarkup as `{>>…<<}`.
MarkText presents the whole payload as one note with a create, edit, and delete
lifecycle; it does not interpret author initials, timestamps, replies, or
resolution state, although imported payload text may contain any of them.
Profile 1 exposes a full, isolated Markdown+CriticMarkup subdocument from that
exact payload without inventing a structured schema. Its blocks, definitions,
references, footnotes, literals, and nested annotations are local to the
Comment and cannot inherit from or alter the surrounding document.
Because the main projections elide the complete outer Comment subdocument, a
Comment nested inside another Comment is preserved and edited through the outer
raw-payload editor or Source mode; it is not promoted to an independently
actionable main Review card.
_Avoid_: thread, structured comment record

**Anchor**:
The MarkText Review UI's name for a nonempty Highlight immediately followed by
a related Comment — `{==text==}{>>…<<}`. CriticMarkup stores no attachment edge
or creation intent; the parser retains the two marks independently and Review
freshly derives the relationship from each revision's source adjacency. Every
comment created by the **Add Comment** command uses this conventional form.
Here “nonempty” means at least one unit of content from the Highlight
contributes to the Revised projection; marker length, renderer pixels, and
Comment payload emptiness are irrelevant. Explicit **Remove comment** unwraps
the Highlight while retaining its exact decoded payload source, including
nested CM, and deletes the Comment.
If ordinary editing removes the final highlighted contribution, the Highlight
wrapper disappears and the Comment remains standalone. Track Changes makes that
transition undoable and preserves normal accept/reject meaning.
_Avoid_: target, range, selection

**Highlight**:
A standalone `{==…==}` span marking text for attention, created by Mark
Highlight. CriticMarkup also documents the convention of immediately following
a nonempty Highlight with a related Comment. That adjacency may drive Review
presentation, but it does not change either mark's parser identity. An empty
Highlight has no barrier, sentinel, or attachment meaning.

**Commented span**:
MarkText's Review presentation for the nonempty, gapless Highlight and Comment
produced by Add Comment — `{==sel==}{>>note<<}`. It is not a sixth
CriticMarkup form or a persisted syntax node. Review freshly derives it from
each source revision and presents it as one entry. Explicit **Remove comment**
unwraps the Highlight and deletes the Comment.

**Point comment**:
MarkText's UI term for a standalone `{>>…<<}` Comment with no highlighted span.
CriticMarkup stores no point/attached bit, so it cannot distinguish an intended
standalone Comment placed gaplessly after a Highlight from the documented
related-comment convention. A Point comment may be typed in source mode,
imported, or left when ordinary editing deletes all highlighted prose. Add
Comment never creates one because it requires a selection.

**Active comment**:
The anchored Comment selected when its visible anchor contains the
caret/selection and no deeper visible Review item owns that exact hit. Nested
anchors choose the innermost Comment; a nested change or plain Highlight wins
when it is the deeper visible item. Explicit sidebar/navigation focus on a
parent stays there while the target survives. Passive selection never opens or
scrolls the sidebar. A right-click retains the deepest item's actions and also
offers **Edit Comment** for the nearest containing anchored Comment.

**CriticMarkup Metadata Extension**:
The proposed optional, backward-compatible CriticMarkup superset for durable
annotation metadata and Comment conversations. “CM2” is only its working name
unless the canonical CriticMarkup maintainers adopt and version it.
_Avoid_: CriticMarkup 2, MarkText metadata format

## Authority

**Acknowledged revision**:
The latest actor commit whose acceptance the document-authority session has
recorded. It is the only source state MarkText may save, reopen, or use as the
base of another durable edit; an unobserved commit from a failed generation is
not acknowledged.
_Avoid_: editor snapshot, current Markdown

**Pending draft**:
An immediate editor presentation of input that the document authority has not
acknowledged. It may be reconciled or discarded, but it is never saved as
document source.
_Avoid_: unsaved revision, current source

**Save barrier**:
The operation that reconciles or discards every earlier pending draft, then
returns the exact acknowledged revision chosen for persistence. A terminally
rejected draft cannot cross it.
_Avoid_: flush, snapshot save
