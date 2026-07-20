# CriticMarkup Review & Comments

The vocabulary of MarkText's CriticMarkup review surface: the change/annotation
forms, their projections, and the comment sidebar UX. This glossary covers only
terms with a specific meaning in that surface — general editor and Markdown
terms are out of scope.

## Language

**Document revision**:
One exact canonical Markdown snapshot together with its complete Markdown and
CriticMarkup interpretation. A revision is replaced as a whole by an accepted
edit; views of it are never independent document authorities.
_Avoid_: JSON state, live DOM state, parser sidecar

**Canonical source**:
The exact decoded UTF-16 code-unit sequence owned by a Document revision and
written by save or autosave. Parsing and no-op persistence do not normalize its
line endings, trivia, escapes, marker spelling, or Unicode representation. The
desktop persistence adapter separately owns file encoding and byte-exact
open/save behavior.
_Avoid_: normalized Markdown, serialized view

**MarkText CriticMarkup Profile**:
A named, versioned language contract whose base is the five published
CriticMarkup forms and whose explicit extensions define MarkText behavior where
the upstream prose or reference implementations are silent or inconsistent.
Every parser revision records its profile version; conformance tests cover both
the shared base and each declared extension. Profile 1 permits properly nested
CriticMarkup only: CM items never cross or partially overlap other CM items.
Markdown and CM remain independent structures and may cross each other's
containment boundaries.
_Avoid_: CriticMarkup dialect, current parser behavior, de facto grammar

**Comment**:
The unstructured metadata payload serialized by CriticMarkup as `{>>…<<}`.
MarkText presents the whole payload as one note with a create, edit, and delete
lifecycle; it does not interpret author initials, timestamps, replies, or
resolution state, although imported payload text may contain any of them.
Profile 1 exposes inline Markdown and properly nested CM from that exact
payload in a comment-specific view without inventing a structured schema.
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
Here “nonempty” means plan 0009's revision-owned contribution classifier finds
at least one atom from the Highlight that survives its full ancestor path into
the root Revised plan; raw payload length, renderer pixels, and Comment payload
emptiness are irrelevant.
Explicit **Remove comment** unwraps the Highlight, retaining its exact payload
source including nested CM (apart from minimum protection at any delimiter
causally reclassified by the transform or a provenance-bearing
`BofTextCodecV1` encoding when an ordinary nonleading U+FEFF moves to offset
zero), and deletes the Comment. With Track Changes off, ordinary deletion of all
anchor prose removes the Highlight wrapper and leaves the standalone Comment;
with Track Changes on, the root-effective Highlight is wrapped in a Deletion so
Accept/Reject remain explicit. Inside an
already pending revised carrier, its direct-edit policy wins; if the Highlight
contains a hidden Comment descendant, the check runs before every carrier policy
and whole-anchor or final-contribution deletion rejects visibly rather than
silently destroying it. The last partial deletion is structural: tracking off
removes the exhausted Highlight wrapper while retaining residual untargeted
non-Comment nodes, while root-effective tracking wraps that exact current
Highlight in one Deletion so Reject restores the immediately prior anchor.
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
