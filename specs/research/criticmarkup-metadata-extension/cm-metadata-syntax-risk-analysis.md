# CriticMarkup out-of-line metadata: syntax risk analysis

## Conclusion

Use a CriticMarkup Comment containing a compact reference token, paired with a
top-level CommonMark link-reference definition containing one line of
Markdown-safe JSON:

```markdown
The {++quick ++}{>>:1<<}fox.
This sentence needs a source{>>:2<<}.

[:1]: <{"by":"csells@sellsbrothers.com","at":"2026-08-13T09:30:00-07:00"}>
[:2]: <{"body":"Which source supports this?","by":"csells@sellsbrothers.com","at":"2026-08-13T09:31:00-07:00"}>
```

This is the best fit among syntax commonly understood by Markdown today. A
link-reference definition is a standardized, document-wide Markdown
definition which may precede or follow its uses and which produces no
structural output of its own. CommonMark also already defines label
normalization and first-definition-wins behavior. No other core Markdown
construct considered here provides all three properties. See CommonMark's
[link-reference definition grammar](https://spec.commonmark.org/0.31.2/#link-reference-definitions)
and [reference-link matching rules](https://spec.commonmark.org/0.31.2/#reference-link).
GitHub Flavored Markdown carries the same
[link-reference-definition construct](https://github.github.com/gfm/#link-reference-definitions),
so this is not dependence on a niche authoring dialect.

The recommendation is not risk-free. It deliberately uses the destination
slot of a link-reference definition to carry JSON, even though that slot is
normally a URI. That is the strongest technical objection and requires a
small, explicit JSON serialization profile described below. If the community
rejects that semantic reuse, there is no equally portable Markdown-native
fallback that remains hidden in ordinary rendered Markdown; a new CriticMarkup
block syntax would be the more honest fallback, at the cost of being visible
to every unaware Markdown renderer.

## Proposed source grammar

The following is source syntax, not an implementation data structure.

```text
local-id             = canonical lowercase hexadecimal token
reference-token      = ":" local-id
metadata-reference   = "{>>" reference-token "<<}"
definition-label     = "[" reference-token "]"
metadata-definition  = definition-label ": <" markdown-safe-json ">"
```

The local ID is the hexadecimal component (`1` in the example). The exact
reference token is `:1`; putting that same token inside brackets produces the
definition label `[:1]`. This avoids both an invented namespace and the common
numeric Markdown label `[1]` while keeping the inline form at the requested
minimum size.

IDs should be treated as durable opaque strings whose spelling is lowercase
hexadecimal with no leading zeroes. The allocation policy does not affect the
syntax; `max(current document IDs) + 1` is compatible with it without making
IDs position- or sequence-dependent after allocation.

### Why the `:id` Comment form?

All backward-compatible candidates must remain ordinary CM1 Comments to an
unaware CriticMarkup reader. Of the compact forms:

- `{>>:1<<}` makes the complete Comment body identical to the definition
  label token inside `[:1]`.
- `{>>@1<<}` has no stronger parse guarantee once the complete body is
  constrained, and `@name` is already natural human comment text.
- `{>>>>1<<<<}` can be parsed as a Comment whose body is `>>1<<`, but it is
  delimiter-dense and more difficult to inspect or type correctly.
- `{>>:[1]<<}` adds brackets without gaining Markdown reference behavior
  inside the CriticMarkup Comment and no longer matches the definition label
  token directly.

A brand-new delimiter could reserve a stronger namespace, but CM1 tools would
no longer recognize it as a Comment. The `:id` form is therefore the smallest
backward-compatible choice; its nonzero legacy-comment collision remains an
explicit objection rather than something extra punctuation can eliminate.

### Association

- A metadata reference immediately following an Addition, Deletion, or
  Substitution, with no intervening character, refers to that mark:
  `{++text++}{>>:a<<}`. This reuses an existing CriticMarkup convention rather
  than introducing nesting or a sixth delimiter. The canonical maintainers
  confirmed that comments directly following those three change types were a
  use case intended from the beginning in
  [Comments with Additions, Deletions, and Substitutions](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/34#issuecomment-74537705).
- A metadata reference not attached to one of those changes denotes a Comment;
  its human-readable comment body is stored in the corresponding definition.
- A Comment attached to highlighted text remains the Comment in the existing
  `{==text==}{>>comment<<}` combination. The Highlight itself does not acquire
  metadata merely because the Comment does.

An unaware CriticMarkup implementation therefore continues to parse every
inline marker as an ordinary Comment. It may display `:1` instead of resolving
the definition, but the containing CM1 document remains syntactically valid.
This follows CriticMarkup's existing five-mark grammar and its stated priority
order of human readability, computer readability, and compatibility with
Markdown, MultiMarkdown, and HTML in the
[canonical toolkit README](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/master/README.md).

### Definition placement

A metadata definition must:

- occupy one physical line;
- begin at column zero;
- occur at top-level Markdown block scope, not inside a list, block quote,
  code block, or other container; and
- begin after a blank line, so it cannot be absorbed into a preceding
  paragraph.

Definitions may occur anywhere those constraints hold, although collecting
them at the end of the document is the readable convention. CommonMark allows
definitions before or after their references and allows consecutive
definitions without intervening blank lines. It also says a definition cannot
interrupt a paragraph and that definitions placed inside block containers
affect the whole document. Requiring top-level placement avoids leaving an
empty rendered list item or block quote after a definition is removed. These
behaviors are specified in
[CommonMark section 4.7](https://spec.commonmark.org/0.31.2/#link-reference-definitions).

### Markdown-safe JSON

The content between `<` and `>` is an RFC 8259 JSON object on one physical
line. It remains JSON—not base64, URL encoding, or a second serialization—but
it must use ordinary JSON Unicode escapes where Markdown's destination grammar
or normalization would otherwise change it:

- String data containing `<` or `>` must serialize those characters as
  `\u003c` and `\u003e`. CommonMark's angle-bracketed destination form forbids
  unescaped angle brackets and line endings.
- String data containing `"` or `\` must serialize those characters as
  `\u0022` and `\u005c`, rather than the shorter JSON escapes `\"` and `\\`.
  CommonMark backslash processing removes escapes before ASCII punctuation.
- String data containing `&` must serialize it as `\u0026`, avoiding entity
  and numeric-character-reference normalization.
- A slash should be written as `/`, not the optional JSON escape `\/`.
- Object member names must be unique. Insignificant JSON whitespace may be
  omitted, and no literal line ending is allowed.

RFC 8259 permits any Unicode character to be represented with a `\uXXXX`
escape, so these restrictions do not reduce what the JSON can represent. They
only select a portable spelling. See the RFC's
[JSON string rules](https://www.rfc-editor.org/rfc/rfc8259.html#section-7),
CommonMark's
[link-destination grammar](https://spec.commonmark.org/0.31.2/#link-destination),
[backslash escapes](https://spec.commonmark.org/0.31.2/#backslash-escapes), and
[entity references](https://spec.commonmark.org/0.31.2/#entity-and-numeric-character-references).

The interior remains directly parseable by a JSON parser. An implementation
that consumes a generic Markdown AST rather than source ranges should receive
the same JSON value when the safe profile is followed. The specification
should require preservation of unknown JSON members but should require
semantic preservation, not byte-for-byte retention of whitespace or escape
spellings.

### Why put JSON in the destination?

Two variants of the same Markdown definition were also considered:

```markdown
[:1]: <> '{"body":"It\u0027s here"}'
[:1]: <data:application/json,%7B%22body%22%3A%22It%27s%20here%22%7D>
```

The first uses an empty destination and a single-quoted link title. It is valid
CommonMark and avoids pretending that JSON is a URI, but every apostrophe in
JSON string data must become `\u0027` so it cannot terminate the title.
Apostrophes are substantially more common in prose comments than literal
angle brackets. The second is URI-shaped but percent-encoding defeats the
requirement that the stored value remain plain, directly readable JSON. The
angle-bracketed destination therefore has the smallest readability tax,
provided the proposal is candid about its unconventional semantics.

## Error and collision behavior

The extension should adopt the following source-level rules:

- **Duplicate definition:** the first CommonMark link-reference definition
  with a matching label wins, exactly as CommonMark specifies. Later matches
  remain source text and should produce a recoverable diagnostic. CommonMark
  explicitly recommends warning on duplicate matches.
- **First definition has invalid JSON:** it still occupies the first matching
  Markdown label, but it does not provide usable metadata. A later definition
  must not silently take over. This keeps Markdown and extension lookup order
  aligned and makes corruption visible.
- **Missing definition:** preserve the inline reference and treat its metadata
  as unresolved; report a recoverable diagnostic. Do not delete it or invent
  a record.
- **Orphan definition:** preserve it and keep it non-rendering; a diagnostic is
  appropriate, but orphan cleanup is not implied by parsing.
- **Malformed candidate line:** if it is not a valid CommonMark
  link-reference definition, it is ordinary Markdown source. Because an
  angle-bracketed link destination cannot cross a line ending, a missing `>`
  exposes that line as text instead of consuming the remainder of the
  document.

The one-character `:` sigil creates two small collision surfaces. A legacy
Comment whose complete body is `:1` will be recognized as a metadata reference
by an extension-aware reader, and literal prose `[:1]` becomes a shortcut link
when a matching definition exists. Both are much less likely than collisions
with `@name` comments or numbered `[1]` references, but neither probability is
zero. Requiring the complete Comment body to match and using canonical hex IDs
bounds the collision. A longer reserved token would reduce it further at the
cost of every inline occurrence.

## Carrier comparison

| Carrier | Rendering in unaware Markdown | Arbitrary readable JSON | Failure containment | Portability | Decision |
|---|---|---:|---|---|---|
| CommonMark link-reference definition | No structural output when unused | Yes, with the safe JSON profile | One line; malformed angle destination becomes text | Core CommonMark/GFM behavior | **Use** |
| Footnote definition (`[^1]: ...`) | Rendered as a note and backlink | Yes | Usually bounded, but dialect-dependent | Widely implemented extension, absent from core CommonMark | Reject |
| MultiMarkdown citation/bibliography | Rendered as a citation/bibliography | Yes | Bounded | MultiMarkdown-specific | Reject |
| HTML comment | Hidden by browsers and many Markdown products | Only with restrictions on comment terminators | Missing `-->` can consume the rest of the document | Raw HTML policies and sanitizers vary | Reject |
| YAML/MultiMarkdown front matter | Often hidden by supporting products | Yes | A bad closing fence can change document parsing | Dialect-specific and restricted to the start of the file | Reject |
| Fenced/custom block | Visible as code or literal text when unsupported | Yes | An unclosed fence can consume the document suffix | Custom block forms are dialect extensions | Reject |
| Plain custom line such as `[1] {json}` | Visible paragraph text | Yes | One line | No established Markdown meaning | Reject |

### Why not footnotes or citations?

The shape is attractive and was explicitly raised in the prior
[Referenced Comments proposal](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/35).
The maintainer objected to comma-separated reference lists as error-prone and
asked whether existing footnote or MultiMarkdown bibliography syntax already
provided enough value. The proposed single-reference form answers the list
objection, but actual footnotes and citations are the wrong semantics: GitHub
renders footnote references and a bottom-of-document note section, while
Pandoc and MultiMarkdown likewise treat them as reader-visible notes or
bibliography entries. See
[GitHub's footnote behavior](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#footnotes),
[Pandoc footnotes](https://pandoc.org/demo/example33/8.19-footnotes.html), and
[MultiMarkdown citations](https://fletcher.github.io/MultiMarkdown-6/syntax/citation.html).

### Why not HTML comments?

HTML comments are familiar and GitHub documents them as a way to hide content,
but CommonMark treats a line beginning `<!--` as an HTML block that ends only
at `-->` or the end of the document/container. A missing terminator therefore
has a document-sized blast radius, and `-->` inside data terminates the block.
See CommonMark's
[HTML-block start and end conditions](https://spec.commonmark.org/0.31.2/#html-blocks)
and [HTML-comment grammar](https://spec.commonmark.org/0.31.2/#raw-html).

### Why not front matter or a custom block?

Jekyll requires front matter to be the first thing in the file; MultiMarkdown
metadata also begins at the top. Those are document metadata conventions, not
portable repeated definition syntax. See
[Jekyll front matter](https://jekyllrb.com/docs/front-matter/) and
[MultiMarkdown metadata](https://fletcher.github.io/MultiMarkdown-6/syntax/metadata.html).

A fenced code block is core Markdown but renders visibly, and CommonMark
specifies that an unclosed fence consumes everything to the end of its
container or document. Custom fenced divs are explicitly a Pandoc extension,
not a common hidden-data construct. See
[CommonMark fenced code blocks](https://spec.commonmark.org/0.31.2/#fenced-code-blocks)
and [Pandoc fenced divs](https://pandoc.org/demo/example33/8.18-divs-and-spans.html#extension-fenced_divs).

## Cross-parser check

A small local check against Marked 18.0.5 and micromark 4.0.2 produced the
same important results:

- `[:1]: <{"body":"hello world"}>` was recognized and omitted from HTML;
- `[:1]: <{"body":"a\u003eb"}>` was recognized and omitted;
- a missing closing `>` rendered as ordinary paragraph text; and
- duplicate definitions resolved to the first destination.

For deliberately invalid `[:1]: <{"body":"a>b"}>`, micromark rendered the
line as text while Marked accepted and hid it. That divergence reinforces the
need to specify CommonMark's stricter destination grammar and the safe JSON
profile rather than relying on permissive parser behavior.

This check demonstrates feasibility, not universal conformance. A proposal
should ship the same cases as an executable syntax corpus so implementers can
test their parser rather than infer behavior from one Markdown library.

## Relationship to prior CriticMarkup proposals

- The attribution request in
  [issue 17](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/17)
  received a maintainer warning that collisions with other Markdown systems
  are a “huge” problem. Reusing a real Markdown definition form avoids a new
  block delimiter; the compact Comment token retains a small, explicit
  collision risk.
- The referenced-comments proposal in
  [issue 35](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/35)
  established the value of moving comments out of line. This recommendation
  keeps one ID per mark, avoiding its comma-list parsing/readability problem,
  and uses a Markdown definition form as the maintainer suggested exploring.
- The JSON metadata proposal in
  [issue 50](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/50)
  puts JSON inside every CriticMarkup tag. Moving it to definitions preserves
  readable inline prose while retaining JSON as the interchange format.

None of those upstream issues has been incorporated into the canonical
CriticMarkup README as of this analysis.

## Strongest objections to take to the proposal

1. **A link destination is semantically a URI, not a JSON field.** The syntax
   is portable because Markdown recognizes and hides it, but the reuse is
   unconventional. Generic Markdown formatters may normalize destinations,
   percent-encode them in rendered output, or discard unused definitions.
   The proposal must claim semantic Markdown coexistence, not guaranteed
   byte-perfect round trips through every generic AST writer.
2. **Plain JSON needs a Markdown-safe spelling.** Literal `>` is invalid in an
   angle-bracketed destination, and Markdown backslash/entity normalization
   can change JSON string data. The Unicode-escape profile is small but must
   be normative; omitting it makes implementations disagree on valid data.
3. **`:id` is not collision-free.** It is compact and less conversational than
   `@id`, but an existing Comment can contain exactly `:1`. A longer reserved
   sentinel is safer if the community prizes zero semantic reinterpretation
   over minimum inline size.
4. **Definitions share Markdown's document-wide link-label namespace.** Using
   `[:1]` rather than `[1]` makes accidental collisions uncommon, but literal
   `[:1]` elsewhere becomes a shortcut link while the definition exists.
5. **Externalization reduces raw-source locality.** Readers without suitable
   tooling must jump from the marker to a later definition. This is inherent
   in every out-of-line design and should be acknowledged rather than hidden
   as an implementation issue.

Subject to those objections, a compact CriticMarkup Comment reference plus a
CommonMark link-reference definition is the narrowest extension that follows
established Markdown behavior instead of inventing a proprietary metadata
block.
