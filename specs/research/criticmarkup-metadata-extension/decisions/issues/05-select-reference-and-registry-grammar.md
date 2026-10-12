Status: resolved
Type: grilling
Blocked by: 02, 03

# Select the inline reference and metadata-definition grammar

## Question

Which exact inline ID sentinel and Markdown-hidden, out-of-line metadata
definition syntax best satisfy the standing compatibility, compactness,
editability, recovery, and cross-implementation constraints?

The decision must define lexical recognition and escaping, legal placement,
record association, duplicate and missing-reference behavior, interaction with
nested CriticMarkup and Markdown literals, and preservation by unaware tools.
Compare at least the user's `:id` and `>>>>id<<<<` sketches with the strongest
evidence-backed alternatives.

## Research update — 2026-08-13

Current Markdown standards and interoperability evidence favors an ordinary
CriticMarkup Comment reference such as `{>>:1<<}` paired with a constrained
CommonMark link-reference definition such as
`[:1]: <{"body":"Comment text"}>`. The reusable Markdown construct is the
out-of-line definition, not an implementation registry. The local ID is `1`;
the `:` is fixed reference syntax appearing in both the Comment payload and
the Markdown label.

This remains a candidate until its source grammar and tradeoffs are accepted.
The key limitation is explicit: Markdown defines the value as a link
destination, not arbitrary data, so the extension must specify a one-line
Markdown-safe JSON spelling and parse its source representation. Research:

- `specs/research/criticmarkup-metadata-extension/markdown-standards-and-conventions.md`
- `specs/research/criticmarkup-metadata-extension/cm-metadata-syntax-risk-analysis.md`

Collision review: `{>>[1]<<}` was rejected as a candidate because `[1]`
participates in ordinary Markdown link resolution. The current candidate is
`{>>@1@<<}` paired with `[1]: <JSON>`. Only `1` is the ID; `@` and the other
punctuation belong to the reference grammar. ID allocation is outside the
syntax specification.

Three contrast designs were assessed. A self-describing CM1 Comment such as
`{>>!cm-meta(1)<<}` further reduces accidental legacy-Comment recognition but
more than doubles inline noise. A dedicated new command such as `{@@1@@}` is
cleaner in isolation but is not recognized or removed by CM1 tools. A design
with no inline ID and out-of-line contextual selectors leaves CM1 source
untouched but loses durable annotation identity under editing, copying, and
duplicate content. This comparison is not yet a decision.

HTML is also a viable extension seam. `<span id="1">ANNOTATION</span>` binds
structurally and renders without extra visible prose, but CM1 projections retain
the wrapper, empty spans remain after removed Comments/Changes, HTML `id` has
document/DOM semantics, sanitizers rewrite or remove attributes, and an inline
`span` cannot safely wrap block-spanning annotations. Paired HTML comments can
span arbitrary source but a line-leading `<!--` creates a CommonMark HTML block
that may suppress CriticMarkup recognition; malformed delimiters have a broad
failure radius. The stronger HTML variant is a single trailing marker,
`ANNOTATION<!--cmid:1-->`: it is inert/hidden in raw-HTML renderers and malformed
inline forms degrade locally, but CM1 source projections retain the marker and
safe Markdown renderers may expose it. This comparison is not yet a decision.

## Answer

Use one trailing HTML Comment as the metadata marker and one ordinary, unused
Markdown link-reference definition as the out-of-line metadata definition:

```markdown
ANNOTATION<!--cmid:ID-->

[ID]: <JSON>
```

For example:

```markdown
{++added text++}<!--cmid:1-->

[1]: <{"by":"alice@example.com"}>
```

The identifier is exactly the text represented by `ID`; in the example it is
`1`. `cmid:` is fixed marker grammar and is not part of the identifier. The
Markdown definition label contains the same identifier. Identifier allocation
is an implementation detail and is outside this syntax specification.

Zero or more ASCII spaces or tabs may separate the annotation from its marker;
they remain ordinary document content and are preserved. A line ending or any
non-whitespace character breaks the association. Writers emit the canonical
gapless form. CriticMarkup 1 does not supply an insignificant-whitespace or
following-marker rule; this behavior belongs explicitly to the extension.

The same marker follows Additions, Deletions, Substitutions, and Comments;
Highlights do not carry extension metadata. All human-authored annotation and
reply text remains inline as ordinary CriticMarkup. A reply is another inline
Comment with its own marker and metadata definition; its JSON metadata relates
it to the original annotation. The JSON therefore augments CM1 content instead
of replacing it.

The definition is one physical line. Its value is an RFC 8259 JSON object in an
angle-bracketed Markdown destination, with the extension interpreting the raw
source representation rather than a Markdown processor's normalized URL.
Literal `<` and `>` within JSON strings are written as `\u003c` and `\u003e`.

This design gives useful degradation at all three levels: non-CM Markdown
continues to expose CM1 syntax while normally hiding the HTML marker and unused
definition; CM1 tools retain their existing annotation semantics while ignoring
the extension; extension-aware tools add provenance and reply relationships.
Its documented costs are that unaware source transformations may discard HTML
Comments or unused definitions, CM1 accept/reject/remove operations may strand
orphan metadata, and `[ID]` participates in Markdown's document-wide reference
label namespace.

The whitespace decision is grounded in
`specs/research/criticmarkup-metadata-extension/criticmarkup-whitespace-and-adjacency.md`:
CM1 treats whitespace inside marks as payload and outside marks as ordinary
document text, while its prose and reference implementations do not agree on a
general adjacency rule.
