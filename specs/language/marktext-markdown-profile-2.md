# MarkText Markdown Profile 2 — Image layout

- **Status:** Owner-authorized on 20 September 2026 by choosing independent
  image-label suggestions after resizing (option 1). Implementation and
  verification are tracked in [plan 0012](../plans/0012-criticmarkup-upstream-integration-review.md).
- **Identifiers:** `markdownProfile: 'markdown-profile-2'` ·
  `criticMarkupProfile: 'marktext-profile-1'`.
- **Base:** [Profile 1](marktext-markdown-profile-1.md), including all its
  CriticMarkup, containment, projection, literal-precedence, losslessness and
  error-recovery rules. This document changes only Markdown image layout.

## Image layout suffix

A resolved Markdown image may have an immediately adjacent layout suffix:

```markdown
![A {++sunny ++}{++sandy ++}beach](beach.jpg){width=320}
![A beach][photo]{width=50% height=200 data-align=center}
```

The same production applies to inline, full-reference, collapsed-reference and
shortcut-reference images. Layout belongs to that image occurrence; it does not
change its reference definition or other images using the same definition.

A suffix is a single `{…}` containing one or more of these fields, in any order:

| Field        | Values                                              |
| ------------ | --------------------------------------------------- |
| `width`      | Positive decimal number, optionally followed by `%` |
| `height`     | Positive decimal number, optionally followed by `%` |
| `data-align` | `inline`, `left`, `center`, or `right`              |

A number is one or more ASCII digits, optionally followed by a decimal point
and one or more digits, or a decimal point followed by one or more digits.
Its numeric value must be finite and greater than zero. Thus `.5` and `01` are
valid; `5.`, `0`, signed values and exponent notation are not. Numbers without
`%` are pixel dimensions. Keys and alignment values are
case-sensitive. Each key occurs at most once. One or more ASCII spaces or tabs
separate fields; optional ASCII spaces or tabs may appear inside the braces at
either end. No whitespace separates the image from its suffix. Values are
unquoted, with no whitespace around `=`; line endings are not allowed inside
the suffix. Unknown keys, duplicate keys, invalid values, an empty suffix or an
unclosed suffix leave the entire candidate suffix as ordinary Markdown text.
An escaped opening brace likewise remains text. This syntax does not attach to
links, unresolved image references, code, raw HTML or other literal content.

The image and its valid suffix are one syntax node with parser-owned layout
values and source positions. The label remains ordinary image-label syntax,
including its independent CriticMarkup suggestions, highlights and comments.
Rendering, Source highlighting, clipboard, editing and exports consume that
same node. Reading or rendering it does not rewrite its source.

## Editing and review

The existing image controls author or update the suffix for Markdown images.
Existing HTML images retain their HTML representation. Updating one layout
field preserves other fields and the image's label, destination, title and
reference spelling. Clearing a field removes it; removing the final field
removes the suffix.

Resizing without Track Changes does not merge label suggestions or turn the
image into a replacement suggestion. For the first example above, accepting
“sunny” and rejecting “sandy” independently produces:

```markdown
![A sunny beach](beach.jpg){width=320}
```

Both review choices retain the width. With Track Changes enabled, layout edits
use the existing five CriticMarkup forms and common editing rules; they do not
invent a property-specific annotation or consume unrelated label suggestions.
For example, an existing width can become
`{width={~~120~>320~~}}`: Original uses `120`, Revised uses `320`, and Markup
previews the revised width while retaining the substitution for review. The
numeric arms are never concatenated into a new dimension. Existing containment
rules also apply to suffix braces: a suffix opening inside an annotation arm
must close within that arm.

## Compatibility and versioning

This is a MarkText Markdown extension, not CommonMark or CriticMarkup syntax.
Other Markdown tools can retain the source and may show the suffix as text
until they support it. HTML exports express the layout using ordinary image
attributes. Existing HTML image syntax remains supported.

Recognizing a suffix changes the meaning of previously ordinary text, so this
addition has a new Markdown profile under [Profile 1 §14](marktext-markdown-profile-1.md#14-versioning).
CriticMarkup retains its five forms and Profile 1 semantics. Both versions
describe one composed grammar; they do not authorize a second parser, parallel
document state or reparsing of rendered projections.
