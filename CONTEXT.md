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

**Metadata marker**:
The optional `<!--cmid:ID-->` following an Addition, Deletion, Substitution, or
Comment on the same line. Zero or more intervening ASCII spaces or tabs are
allowed and remain ordinary document content; a line ending or any other
character breaks the association. Writers use the gapless canonical form. `ID`
alone is the annotation's durable, document-local identifier; `cmid:` is marker
grammar and is not part of it. Highlights do not have metadata markers.
_Avoid_: ID comment, CM2 Comment

**Metadata definition**:
The hidden, one-line Markdown reference definition `[ID]: <JSON>` whose label
is the same identifier carried by a Metadata marker. Its JSON augments the
inline CriticMarkup content with creation provenance, relationships, and
current state; it does not own or duplicate the annotation's human-authored
body or CM1 kind. It carries no edit provenance because unrestricted source
edits cannot be detected or attributed reliably. Its unversioned JSON schema
evolves only by adding optional members with defined absence behavior; existing
meanings and types remain stable, and unknown members survive record rewrites.
_Avoid_: registry, metadata block

**Reply**:
An inline CriticMarkup Comment with its own Metadata marker and definition,
whose metadata relates it to an earlier annotated Change or Comment. It inherits
the original annotation's Anchor when applicable; its human-authored body never
lives only in JSON.
_Avoid_: JSON reply body, nested Comment record

**Comment conversation**:
A root Comment together with the flat set of Replies whose metadata refers to
it, regardless of their physical adjacency. Replies are presented in source
order; writers normally keep the conversation together for CM1 and source
readability. Resolution is current state of the whole conversation, recorded
only on the root Comment; individual Replies cannot be resolved. Reopening
removes that resolution state. Any participant may resolve or reopen the
conversation, with the actor and time recorded as resolution provenance.
Changes instead leave review through accept or reject.
_Avoid_: nested thread, resolved reply

**Contribution author**:
The optional, self-asserted identity recorded when an Addition, Deletion,
Substitution, Comment, or Reply is created. An extension-aware WYSIWYG editor
offers body editing only to that author; accepting, rejecting, replying, and
resolving are separate actions. Source editing is unrestricted, unauthenticated,
and carries no reliable edit provenance. When authorship is absent or invalid,
WYSIWYG editing is unrestricted and never assigns creation attribution
retroactively.
_Avoid_: owner, authenticated author

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
