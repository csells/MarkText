# Markdown standards and conventions for out-of-line CriticMarkup metadata

Date: 2026-08-13

## Question

Which Markdown syntax already in common use can support a compact inline
CriticMarkup reference whose structured data is stored elsewhere in the same
document? In particular, which mechanisms are portable, absent from rendered
output, able to carry one line of plain JSON, and predictably recoverable when
malformed?

This note evaluates syntax and document semantics only. It does not prescribe
an editor data structure, parser architecture, or WYSIWYG implementation.

## Executive finding

Markdown has one standard, long-established **reference-to-definition**
mechanism: reference-style links and their link reference definitions. John
Gruber described their purpose as moving “markup-related metadata out of the
paragraph,” and CommonMark formally specifies their grammar, document-wide
label matching, first-definition-wins rule, and absence from rendered output.
That is the convention closest to the proposed CriticMarkup shape.

Markdown does **not** have a standard opaque-data definition facility. A link
reference definition's value is a link destination plus an optional title,
not an arbitrary payload. A one-line JSON object can be placed lexically in an
angle-bracketed destination, but CommonMark applies link-destination escaping
and entity processing to the semantic destination. Therefore a CriticMarkup
extension that uses this envelope must explicitly define the JSON as source
text inside the envelope; it cannot pretend that JSON is already a standard
Markdown link value.

HTML comments are the other broadly supported candidate. They preserve
arbitrary source text more naturally and GitHub explicitly documents them as
a way to hide content. They provide no standard ID matching or duplicate
semantics, however, and a missing `-->` causes a CommonMark HTML block to
consume the rest of its container or document. This is a materially worse
malformed-input boundary than a link reference definition.

No current mechanism simultaneously provides all of these properties:

- CommonMark/GFM portability;
- standard inline-reference and out-of-line-definition semantics;
- no rendered content;
- an opaque, exact, one-line JSON value; and
- bounded failure when malformed.

The best standards-grounded proposal is consequently a small semantic
extension of a CommonMark link reference definition, with the deviation from
ordinary link semantics stated explicitly and tested. HTML comments are the
fallback if exact opaque source preservation is judged more important than
reference-definition semantics and malformed-input containment.

## 1. The native Markdown externalization convention

### 1.1 Original Markdown

Original Markdown defines reference-style links as an inline label plus a
definition elsewhere in the document:

```markdown
This is [an example][id].

[id]: https://example.com/ "Optional title"
```

The definition can occur anywhere in the document, is removed from HTML
output, and exists specifically to move link metadata out of prose. Labels may
contain letters, numbers, spaces, and punctuation and are case-insensitive.
These are not later conventions inferred from implementations; they are in
the original syntax description. See John Gruber's [Markdown syntax,
Links](https://daringfireball.net/projects/markdown/syntax#link).

This establishes the general Markdown design precedent:

```text
compact inline reference  <->  document-local out-of-line definition
```

It does not establish arbitrary data after the definition label.

### 1.2 CommonMark 0.31.2 definition grammar

CommonMark 0.31.2 defines a link reference definition as:

1. a link label, preceded by at most three spaces;
2. `:`;
3. optional spaces/tabs and at most one line ending;
4. a required link destination;
5. optionally, a separated link title; and
6. no other characters.

The definition may occur before or after its use. It does not become a
document node and an unused definition produces no visible output. Several
definitions may be consecutive without blank lines. A definition cannot
interrupt a paragraph, but it can immediately follow another block; definitions
inside a list or block quote still have document-wide effect. See CommonMark
0.31.2 [§4.7 Link reference
definitions](https://spec.commonmark.org/0.31.2/#link-reference-definitions),
especially examples 192, 203, 207, 213, 217, and 218.

These placement rules matter for a proposed metadata definition. For a
definition written after ordinary prose to be recognized by standard Markdown,
it must begin a new block, normally by inserting a blank line before it.

### 1.3 Label matching and duplicates

A CommonMark link label contains 1–999 characters; unescaped square brackets
are prohibited. Matching performs Unicode case folding, trims leading and
trailing whitespace, and collapses internal whitespace. When multiple
definitions match, the first definition in document order wins; the spec says
a warning is desirable. See CommonMark 0.31.2 [§6.3 Links, link
labels](https://spec.commonmark.org/0.31.2/#link-label) and example 544.

For canonical lowercase hexadecimal CriticMarkup IDs, the complicated parts
of label normalization have no practical effect. Reusing the first-wins rule
would align duplicate behavior with CommonMark rather than inventing a second
policy.

There is an important namespace side effect: whenever `[label]: destination`
exists, ordinary `[label]` text may become a CommonMark shortcut reference
link. Using `[1]` as metadata's full Markdown label therefore claims an
existing and commonly used reference-link label. A fixed reserved prefix in
the **definition-label syntax** can avoid most such collisions without making
that prefix part of the document-local CriticMarkup ID. For example, an
extension could map local ID `1` to a definition label such as
`[criticmarkup:1]`. The spelling of that reserved prefix is a proposal decision,
not a CommonMark rule.

### 1.4 Malformed and missing definitions

CommonMark does not define a general document syntax-error state: every
character sequence is a document. A line that fails link-reference-definition
grammar remains ordinary Markdown, usually paragraph text. For example, a
definition with trailing material, four-space indentation, an omitted
destination, or placement that would interrupt a paragraph is rendered as
ordinary content rather than rejected. See CommonMark 0.31.2 examples
[199](https://spec.commonmark.org/0.31.2/#example-199),
[209](https://spec.commonmark.org/0.31.2/#example-209),
[211](https://spec.commonmark.org/0.31.2/#example-211), and
[213](https://spec.commonmark.org/0.31.2/#example-213).

A reference with no matching definition is likewise ordinary bracketed text,
not a fatal error. A CriticMarkup extension may diagnose a missing or malformed
metadata definition, but the underlying Markdown convention favors editable
source and local fallback over document rejection.

## 2. Can a link reference definition carry plain JSON?

### 2.1 Lexically, with restrictions

An angle-bracketed CommonMark link destination may contain any characters
except line endings and unescaped `<` or `>`. Spaces are permitted in this
form. Consequently, this is lexically a valid CommonMark link reference
definition and contributes no rendered block:

```markdown
[criticmarkup:1]: <{"body":"This is a comment","by":"a@example.test"}>
```

JSON strings may encode any Basic Multilingual Plane character as `\uXXXX`, so
literal `<` and `>` can be represented as `\u003c` and `\u003e` without
changing their decoded values. JSON already requires line breaks inside
strings to be escaped; compact serialization can keep the complete object on
one physical line. See [RFC 8259 §7,
Strings](https://www.rfc-editor.org/rfc/rfc8259#section-7) and CommonMark 0.31.2
[§6.3 Link destinations](https://spec.commonmark.org/0.31.2/#link-destination).

Thus an arbitrary JSON object can be carried as **source JSON** in this
envelope if the extension requires:

- exactly one physical line;
- valid JSON object syntax;
- no literal `<` or `>` inside the JSON serialization; and
- `\u003c` / `\u003e` where those characters are needed in string values.

### 2.2 Semantically, not as an opaque standard value

CommonMark specifies a link destination as a URI value. Backslash escapes and
HTML entity/numeric references are active in link destinations and titles.
For example, `\*` becomes `*`, and an entity in a destination is decoded. A
conforming parser is not required to preserve whether a source character came
from an entity reference. See CommonMark 0.31.2 [§2.4 Backslash
escapes](https://spec.commonmark.org/0.31.2/#backslash-escapes), examples 22–23,
and [§2.5 Entity and numeric character
references](https://spec.commonmark.org/0.31.2/#entity-and-numeric-character-references),
examples 32–33.

This conflicts with JSON's own use of backslashes. In particular, JSON escapes
such as `\"`, `\\`, and `\/` contain a backslash before ASCII punctuation,
which Markdown is allowed to consume when producing the semantic link
destination. An implementation that receives only a normalized URI from a
generic Markdown parser may therefore not receive the original JSON text.

The syntax proposal must be explicit on this point: if it uses a link
definition envelope, the JSON payload is the raw source substring between the
destination delimiters, interpreted according to JSON rules after the
extension's carrier restrictions—not the normalized CommonMark URI. This is a
new CriticMarkup semantic layered on standard Markdown block recognition.

An alternative is URI- or base64-encoding the value so ordinary Markdown URI
semantics preserve it. That would no longer satisfy the requirement that the
document contain directly readable plain JSON.

### 2.3 Titles do not remove the conflict

A link definition could use an empty destination and put JSON in its title:

```markdown
[criticmarkup:1]: <> '{"body":"This is a comment"}'
```

CommonMark supports double-quoted, single-quoted, or parenthesized titles, but
the matching delimiter must be backslash-escaped and backslash processing is
still active. No title delimiter is excluded from arbitrary JSON string values,
and normalized-title access has the same collision with JSON escapes. See
CommonMark 0.31.2 [§6.3 Link
titles](https://spec.commonmark.org/0.31.2/#link-title).

The title form is therefore not more opaque or portable than the
angle-bracketed destination form. It merely moves the escaping restrictions.

## 3. HTML comments

### 3.1 Support and rendered visibility

CommonMark recognizes a line beginning (after at most three spaces) with
`<!--` as an HTML block. The block ends at the first line containing `-->`.
Raw HTML is passed through to HTML output; browsers do not display comment
content. GitHub's current authoring documentation explicitly presents
`<!-- ... -->` as the way to hide content from rendered Markdown. See
CommonMark 0.31.2 [§4.6 HTML
blocks](https://spec.commonmark.org/0.31.2/#html-blocks) and GitHub Docs,
[Hiding content with
comments](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#hiding-content-with-comments).

A metadata line could therefore use a new CriticMarkup convention inside a
standard HTML comment, for example:

```markdown
<!-- criticmarkup-metadata 1 {"body":"This is a comment"} -->
```

Backslash escapes are not processed in raw HTML, so JSON source is preserved
more directly than in a link destination. The payload must not contain the
comment terminator `-->`. Because RFC 8259 permits Unicode escaping, a JSON
string that would contain this sequence can encode its `>` as `\u003e`.

### 3.2 Missing standard semantics

Markdown gives the contents of the comment no ID, association, matching,
normalization, duplicate, or orphan semantics. Every one of those behaviors
would be new CriticMarkup syntax. An HTML comment is therefore a standard
hidden envelope, not a standard external-definition convention.

HTML comments can also be removed by sanitizers, export pipelines, and
processors configured to discard raw HTML. GFM's formal `tagfilter` extension
filters a specific list of dangerous element names rather than comments, but
GitHub also notes that its deployed service performs additional sanitization.
The formal baseline is [GFM 0.29-gfm, Raw HTML and Disallowed Raw
HTML](https://github.github.io/gfm/#disallowed-raw-html-extension).

### 3.3 Malformed-input blast radius

The major robustness problem is normative: if the matching `-->` is absent,
the CommonMark HTML block continues to the end of the containing block or the
end of the document. A single damaged metadata line can therefore prevent the
entire following suffix from being parsed as Markdown. See CommonMark 0.31.2
[§4.6 HTML blocks, type
2](https://spec.commonmark.org/0.31.2/#html-blocks).

Restricting valid CriticMarkup metadata to one line makes extension-aware
diagnostics easy, but it cannot change how an unaware CommonMark processor
handles the unclosed `<!--`. This is worse degradation than a malformed link
reference definition, which falls back to ordinary Markdown content.

## 4. Established extension mechanisms

### 4.1 Footnotes

GitHub currently supports the familiar paired syntax:

```markdown
Text with a note[^1].

[^1]: Note body.
```

GitHub renders the definition as a footnote at the bottom of the document; it
is not out-of-band data. GitHub also states that footnotes are not supported in
wikis. See GitHub Docs,
[Footnotes](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#footnotes).

Footnotes do not appear among the extensions in the formal GFM 0.29-gfm
specification, whose defined extensions are tables, task-list items,
strikethrough, autolinks, and disallowed raw HTML. They are a deployed GitHub
feature, not part of the current formal GFM specification. Pandoc separately
defines a `footnotes` extension, with its own identifier restrictions and
multi-block content rules. See the [GFM
specification](https://github.github.io/gfm/) and Pandoc's [Footnotes
extension](https://pandoc.org/MANUAL.html#extension-footnotes).

Footnotes are therefore useful prior art for a bracketed inline ID paired with
an out-of-line definition, but are unsuitable as the carrier: their content is
meant to be rendered, their formal support is dialect-specific, and their body
is Markdown rather than an opaque JSON record.

### 4.2 YAML front matter and metadata blocks

Jekyll requires valid YAML between `---` lines at the very beginning of a
file. Pandoc's `yaml_metadata_block` is a separately selectable extension;
Pandoc notes that JSON is a YAML subset, permits multiple blocks in its native
Markdown mode, but restricts its `commonmark`, `gfm`, and `commonmark_x` modes
to one block at the beginning of the document. See Jekyll [Front
Matter](https://jekyllrb.com/docs/front-matter/) and Pandoc's [YAML metadata
block extension](https://pandoc.org/MANUAL.html#extension-yaml_metadata_block).

Front matter is document-level metadata with privileged placement. It does
not supply distributed definitions or inline association. It may also already
be owned by a site's build system. In an implementation without the extension,
the same `---` lines participate in ordinary CommonMark thematic-break or
setext-heading parsing rather than being universally hidden metadata.

Front matter can hold the complete CriticMarkup data model, but adopting it
would be a dependency on a Markdown dialect and a shared document-global
namespace, not reuse of a portable reference convention.

### 4.3 Attributes

Attribute syntax is not part of CommonMark or formal GFM. Established dialects
also disagree about which elements accept attributes and how they are written.
For example, Pandoc's `link_attributes` extension permits attributes after a
link or on its reference definition, while `bracketed_spans` attaches an
attribute list directly to bracketed inline content. See Pandoc's
[link_attributes](https://pandoc.org/MANUAL.html#extension-link_attributes)
and [bracketed_spans](https://pandoc.org/MANUAL.html#extension-bracketed_spans)
extensions.

Attributes keep key/value data inline with the element; they do not externalize
an arbitrary JSON record. They are relevant precedent for extensible metadata,
but not a carrier meeting this proposal's central goal.

### 4.4 Fenced code blocks

Fenced code blocks preserve JSON literally and can declare an info string, but
they render visibly as code. If the closing fence is missing, CommonMark takes
the content through the end of its container or document as part of the code
block. See CommonMark 0.31.2 [§4.5 Fenced code
blocks](https://spec.commonmark.org/0.31.2/#fenced-code-blocks).

They solve exact payload preservation but fail both hidden rendering and
bounded malformed-input recovery.

## 5. Comparison

| Mechanism | Portable baseline | Rendered behavior | One-line plain JSON | Existing ID/duplicate semantics | Malformed boundary |
| --- | --- | --- | --- | --- | --- |
| Link reference definition | Original Markdown, CommonMark, GFM | Definition produces no block | Valid as source in `<...>` with carrier restrictions; normalized destination is not opaque | Yes: normalized labels, document scope, first wins | Invalid form becomes ordinary Markdown |
| HTML comment | CommonMark raw HTML, GFM, original Markdown's HTML escape hatch | Comment is not visually displayed in HTML; raw HTML policy can discard/escape it | Yes, except `-->` must be avoided | No | Missing close can consume document suffix |
| Footnote definition | GitHub product feature; multiple dialect extensions | Renders as document footnote | Body is Markdown, not opaque JSON | Dialect-specific | Dialect-specific; visible under unaware processors |
| YAML front matter | Jekyll/Pandoc and other dialects | Hidden/consumed only by supporting processor | Yes | Document metadata merge rules are dialect-specific | Placement/dialect mistakes become ordinary Markdown |
| Attributes | Multiple incompatible extensions | Attached to rendered element | Not external; value grammar is not arbitrary JSON | Element-specific | Usually literal text under unaware processors |
| Fenced code | CommonMark, GFM | Visible code block | Yes, literally | No | Missing close consumes document suffix |

## 6. Syntax implications for a CriticMarkup community proposal

### 6.1 Use specification terms, not implementation terms

The public syntax should describe an **inline metadata reference** and an
out-of-line **metadata definition**. “Registry” suggests an internal index and
does not name anything standardized by Markdown.

The durable CriticMarkup ID and its Markdown carrier should be defined
separately. For example, `1` can remain the document-local ID even if a fixed
word is reserved in the definition's Markdown label to prevent collisions.

### 6.2 Preferred standards-grounded carrier

If the primary goal is to externalize metadata in the way Markdown already
externalizes link metadata, the strongest candidate shape is:

```markdown
This is a test{>>:1<<}.

[criticmarkup:1]: <{"body":"This is a comment","by":"a@example.test","at":"2026-08-13T12:00:00-07:00"}>
```

In this illustration:

- `1` is the CriticMarkup ID;
- `:1` is the compact CriticMarkup inline-reference payload;
- `criticmarkup:` is fixed metadata-definition syntax, not part of the ID;
- the complete `[criticmarkup:1]: <...>` line is also a valid CommonMark link
  reference definition and therefore contributes no rendered block; and
- the extension assigns new meaning to the raw angle-bracketed source as JSON.

The exact reserved word is still a design choice. A shorter prefix saves only
characters on out-of-line lines while increasing the chance of occupying a
label another Markdown document already uses. Omitting the prefix entirely
and using `[1]` most literally copies Markdown's examples, but also makes any
ordinary `[1]` in the document a shortcut link. That collision must be weighed
explicitly, not hidden inside the implementation.

For this carrier, a proposal needs normative rules for:

- the one-line/block placement required for CommonMark recognition;
- the exact mapping from inline local ID to the reserved definition label;
- source-level JSON extraction before Markdown URI normalization;
- escaping literal `<` and `>` as JSON Unicode escapes;
- first-definition-wins duplicate handling;
- missing, malformed, and orphan definitions; and
- preservation of definitions and unknown JSON members by editing tools.

### 6.3 Alternative when opaque raw JSON dominates

If the community rejects using a link destination as a non-link payload, the
standards-grounded alternative is a one-line HTML comment:

```markdown
This is a test{>>:1<<}.

<!-- criticmarkup-metadata 1 {"body":"This is a comment","by":"a@example.test"} -->
```

This is more honest about being an opaque extension payload and avoids
Markdown's URI normalization. It is less aligned with Markdown's established
reference-definition idiom, supplies none of that idiom's matching rules, is
subject to raw-HTML stripping, and has a much larger failure region if its
closing delimiter is damaged.

### 6.4 Claims the proposal should and should not make

The proposal can accurately claim that it:

- follows Markdown's original reference/definition externalization pattern;
- uses a CommonMark-recognized, non-rendering definition block (if the first
  candidate is chosen);
- leaves an ordinary Markdown rendering without visible metadata definitions;
  and
- adds CriticMarkup semantics without requiring any particular editor model.

It should not claim that:

- Markdown already defines generic JSON reference records;
- footnotes, attributes, or YAML front matter are portable CommonMark syntax;
- a generic Markdown AST will necessarily preserve JSON placed in a link URI;
  or
- HTML comments have bounded recovery when their close delimiter is missing.

That distinction makes the proposal both Markdown-native and technically
honest: it reuses the closest established carrier while specifying precisely
the small amount of new syntax and meaning CriticMarkup requires.
