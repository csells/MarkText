# Markdown ecosystem interoperability for out-of-line CriticMarkup metadata

**Status:** research, 2026-08-13

**Question:** Which existing Markdown construct most commonly supports an out-of-line, rendered-hidden definition, and what constraints would a CriticMarkup syntax proposal inherit by reusing it?

## Conclusion

The closest thing Markdown has today is a **link reference definition**:

```markdown
This is a test{>>:1<<}.

[1]: <{"by":"csells@sellsbrothers.com","at":"2026-08-13T09:30:00-07:00"}>
```

Valid unused link reference definitions are recognized and omitted from rendered HTML by CommonMark/GFM, GitHub.com, Marked, markdown-it, micromark/unified, and Pandoc. No other tested construct has that combination of standardization and render-hidden behavior.

That does **not** make the destination an arbitrary-data slot. It remains a Markdown link destination. A syntax proposal that reuses this carrier must explicitly define the exact source substring between `<` and `>` as its JSON field, require JSON to escape literal `<` and `>` as `\u003c` and `\u003e`, and forbid line breaks. It must not parse the destination after Markdown URL decoding: CommonMark backslash processing turns JSON `\"` into `"` and `\\` into `\`, which can corrupt otherwise valid JSON.

The other important limitation is preservation. Markdown specifications define parsing and rendered meaning, not lossless source round trips. GitHub and HTML renderers omit the definition as desired, but generic AST serializers may normalize or delete it. In the fixtures below, remark changed definition spelling, and Pandoc dropped an unused definition entirely when writing Markdown. A source-preserving editor can preserve it; a general Markdown converter is not required to.

There is no existing Markdown carrier that simultaneously provides arbitrary unescaped JSON, hidden rendering, free placement, bounded malformed-input behavior, and lossless preservation.

## What is standard and widely implemented

### Link reference definitions

CommonMark defines a link reference definition as a label, colon, mandatory link destination, and optional title. A definition:

- may occur before or after its uses;
- may occur inside a list or block quote while affecting the entire document;
- cannot interrupt a paragraph;
- produces no rendered block even when unused;
- uses Unicode-case-folded and whitespace-normalized labels;
- uses the first matching definition when duplicates normalize to the same label; and
- causes an eligible matching `[label]` elsewhere to become a link.

These are normative rules in [CommonMark §4.7, Link reference definitions](https://spec.commonmark.org/0.31.2/#link-reference-definitions) and [§6.3, Links and link-label normalization](https://spec.commonmark.org/0.31.2/#links). The formal [GFM specification](https://github.github.com/gfm/#link-reference-definitions) inherits the same construct.

The angle-bracket destination form allows spaces but forbids line endings and unescaped `<` or `>`. Consequently, this is portable:

```markdown
[1]: <{"body":"A B","less":"\u003c","greater":"\u003e"}>
```

This is not:

```markdown
[1]: <{"body":"A > B"}>
```

CommonMark-conforming micromark, markdown-it, and Pandoc reject the second line as a definition and render it visibly. Marked 18 accepted it, demonstrating why a syntax proposal cannot rely on one parser's permissiveness.

The syntax also occupies Markdown's link-label namespace. If `[1]: ...` exists, an otherwise eligible `[1]` in ordinary prose becomes a shortcut link. A reserved label prefix can reduce that collision, but that is a proposal-level syntax decision rather than a CommonMark facility.

### Rendering versus source preservation

Rendering support and source preservation are independent:

| Implementation | Valid unused link definition in rendered HTML | Definition available to parser | Parse/write preserves exact source |
| --- | --- | --- | --- |
| CommonMark/GFM contract | Omitted | Yes, as link-definition data | Not specified |
| GitHub Markdown service | Omitted | Service does not expose its tree | Not applicable |
| Marked 18.0.5 | Omitted | Yes, `def` token | No Markdown writer supplied |
| markdown-it 15.0.0 | Omitted | Yes, in `env.references` | No Markdown writer supplied |
| micromark 4.0.2 / remark 11 | Omitted | Yes, mdast `definition` node | Semantic round trip; spelling can change |
| Pandoc 3.10.2 | Omitted | Yes, used definitions affect the AST | No: unused definitions are dropped by Markdown writers |
| Current MarkText/Muya branch | Hidden in HTML rendering; source editor represents the line | Yes, raw paragraph text plus reference recognition | Tested fixtures round-trip exactly except paragraph spacing normalization between consecutive definitions |

micromark describes itself as a CommonMark parser whose concrete tokens account for every byte, but its normal output is HTML; source serialization is a separate operation. remark explicitly parses Markdown into mdast and serializes the semantic tree back to Markdown. See the [micromark documentation](https://github.com/micromark/micromark) and [remark documentation](https://github.com/remarkjs/remark). Pandoc likewise documents an AST-based reader/writer architecture and cautions against expecting formatting details to survive conversions in the [Pandoc User's Guide](https://pandoc.org/MANUAL.html#description).

## Why the other familiar carriers do not fit as well

### Footnotes

Footnotes use the familiar remote-definition pattern:

```markdown
Text[^1].

[^1]: note body
```

They are not CommonMark, and the frozen formal GFM specification does not include them. Current GitHub, `remark-gfm`, markdown-it with a plugin, Pandoc GFM, and optionally MarkText do support them, but a referenced footnote is intentionally visible as a superscript and rendered note. An unused definition may disappear, but a metadata reference would make it visible. The body is Markdown content rather than an opaque JSON field. GitHub documents the presentation behavior in [Basic writing and formatting syntax: Footnotes](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#footnotes); `remark-gfm` confirms that footnotes are an extension rather than front matter or core CommonMark in its [official README](https://github.com/remarkjs/remark-gfm).

### HTML comments

GitHub explicitly documents HTML comments as a way to [hide content from rendered Markdown](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#hiding-content-with-comments):

```markdown
<!-- {"id":"1","by":"csells@sellsbrothers.com"} -->
```

They carry nearly plain JSON and are standard CommonMark raw HTML, but have two robustness problems:

1. a JSON string containing `-->` terminates the carrier; and
2. an unclosed `<!--` consumes the remaining document as an HTML block in CommonMark-family parsers.

Visibility also depends on HTML policy. GitHub strips comments from its result. Marked and markdown-it emit them as raw HTML by default or when HTML is enabled, so a browser hides them. micromark's safe default visibly escapes them; `allowDangerousHtml` passes them through. CommonMark's rules are in [§4.6, HTML blocks](https://spec.commonmark.org/0.31.2/#html-blocks) and [§6.6, Raw HTML](https://spec.commonmark.org/0.31.2/#raw-html).

### YAML front matter

Front matter is a widespread metadata convention, not CommonMark or formal GFM. It is normally recognized only at the beginning of the file, making it a single shared document-level region rather than a collection of definitions placed after content. Without an extension, the same bytes render as thematic breaks and headings. GitHub's Markdown rendering API likewise rendered the test fixture visibly; GitHub repositories have separate product behavior that displays YAML metadata as a table, rather than universally hiding it. See [GitHub's YAML metadata announcement](https://github.blog/news-insights/product-news/viewing-yaml-metadata-in-your-documents/) and [`remark-frontmatter`](https://github.com/remarkjs/remark-frontmatter), whose maintainers explicitly warn that recognizing front matter “anywhere” reduces portability.

Pandoc and static-site systems support richer metadata, but the conventions vary. Pandoc permits multiple YAML metadata blocks and later values override earlier ones, then may consolidate metadata when writing Markdown; see [Pandoc: Metadata blocks](https://pandoc.org/MANUAL.html#metadata-blocks). This is sound prior art for document metadata, not a portable per-annotation definition syntax.

### Fenced code and custom containers

Fenced code is standard, provides a reliable literal envelope, and accepts JSON easily:

````markdown
```criticmarkup-metadata
{"1":{"by":"csells@sellsbrothers.com"}}
```
````

It is intentionally visible as `<pre><code>`. An unclosed fence also consumes the remaining containing block or document as code. See [CommonMark §4.5, Fenced code blocks](https://spec.commonmark.org/0.31.2/#fenced-code-blocks).

Colon-fenced custom containers such as `::: criticmarkup-metadata` are not CommonMark or GFM. CommonMark, GitHub, Marked, markdown-it without a plugin, and micromark render the tested syntax as an ordinary visible paragraph. Pandoc recognizes fenced `Div` blocks only in its extended Markdown dialect; see [Pandoc: `fenced_divs`](https://pandoc.org/MANUAL.html#extension-fenced_divs).

## Reproducible fixtures and exact outputs

Tests were run on 2026-08-13 with Node 26.7.0; Marked 18.0.5; micromark 4.0.2; remark-parse/stringify 11.0.0; remark-gfm 4.0.1; markdown-it 15.0.0; markdown-it-footnote 4.0.0; Pandoc 3.10.2; GitHub's `POST /markdown` endpoint in `gfm` mode; and the current MarkText/Muya checkout at `177a13f24fe5e5c265dcef468f71988186d1f85e`. GitHub documents the rendering endpoint and its `markdown`/`gfm` modes in the [REST API documentation](https://docs.github.com/en/rest/markdown/markdown).

### Fixture A: plain proposed line is visible

Input:

```markdown
[1] {"v":1,"body":"A B"}
```

Exact HTML bodies:

```text
GitHub:     <p dir="auto">[1] {"v":1,"body":"A B"}</p>
Marked:     <p>[1] {&quot;v&quot;:1,&quot;body&quot;:&quot;A B&quot;}</p>\n
micromark:  <p>[1] {&quot;v&quot;:1,&quot;body&quot;:&quot;A B&quot;}</p>\n
markdown-it:<p>[1] {&quot;v&quot;:1,&quot;body&quot;:&quot;A B&quot;}</p>\n
Pandoc GFM: <p>[1] {"v":1,"body":"A B"}</p>\n
```

MarkText parsed one paragraph and serialized the exact input.

### Fixture B: unused valid link definition is hidden

Input:

```markdown
[cm:1]: <{"v":1,"body":"A B"}>
```

Exact rendered bodies:

```text
GitHub:      ""
Marked:      ""
micromark:   ""
markdown-it: ""
Pandoc GFM:  "\n"
```

remark parsed:

```json
{"type":"definition","identifier":"cm:1","label":"cm:1","title":null,"url":"{\"v\":1,\"body\":\"A B\"}"}
```

Its Markdown writer preserved the angle brackets in this space-containing case. For compact `{"v":1,"by":"a"}`, however, it normalized:

```text
input:  [cm:1]: <{"v":1,"by":"a"}>
output: [cm:1]: {"v":1,"by":"a"}
```

Pandoc's Markdown writer emitted only `"\n"`, dropping the unused definition.

### Fixture C: literal `>` makes the definition invalid

Input:

```markdown
[cm:1]: <{"body":"a > b"}>

Use [cm:1].
```

Exact micromark and markdown-it output:

```html
<p>[cm:1]: &lt;{&quot;body&quot;:&quot;a &gt; b&quot;}&gt;</p>
<p>Use [cm:1].</p>
```

GitHub and Pandoc produced the same two visible paragraphs (with incidental attribute/escaping differences). Marked accepted the line, a portability disagreement. Replacing `>` with the JSON escape `\u003e` made all tested parsers recognize and hide the definition.

### Fixture D: Markdown decoding corrupts JSON escapes

Input destination JSON was produced by `JSON.stringify`:

```markdown
[cm:1]: <{"quote":"He said \"hi\"","slash":"C:\\tmp","stars":"*x*"}>
```

remark's semantic definition URL was:

```text
{"quote":"He said "hi"","slash":"C:\tmp","stars":"*x*"}
```

and its Markdown writer emitted that invalid JSON. Therefore an extension cannot define its value as “the Markdown-decoded link URL.” It must either define a separate encoding or parse the exact raw source field. MarkText's current state round-tripped the original bytes, but its current reference-definition recognizer did not semantically recognize this escaped fixture—another reason the proposal must provide conformance fixtures rather than assume URL handling is uniform.

### Fixture E: HTML comment failure radius

Input:

```markdown
Before.

<!--cm:1 {"body":"A B"}

After {++x++}.
```

micromark with raw HTML enabled produced exactly:

```html
<p>Before.</p>
<!--cm:1 {"body":"A B"}

After {++x++}.
```

Marked, markdown-it, Pandoc CommonMark/GFM, GitHub, and MarkText likewise treated the suffix as part of the unclosed HTML block. GitHub rendered only `<p dir="auto">Before.</p>` after sanitization.

### Fixture F: footnotes and custom blocks are dialect-dependent

For:

```markdown
Body[^cm-1].

[^cm-1]: {"v":1,"body":"A B"}
```

GitHub and micromark/remark GFM rendered a numbered footnote section. Marked, core micromark, and core markdown-it rendered both forms literally. markdown-it with `markdown-it-footnote`, Pandoc GFM, and MarkText with its footnote option enabled rendered/parsed them as footnotes. MarkText's default footnote option is false.

For:

```markdown
::: criticmarkup-metadata
{"1":{"v":1}}
:::
```

GitHub, Marked, micromark, and core markdown-it rendered one visible paragraph. Pandoc's extended `markdown` reader created a `Div`; its `commonmark` and `gfm` readers rendered a visible paragraph.

## Constraints that follow for a syntax proposal

If CriticMarkup reuses the common link-definition convention, the proposal—not any particular implementation—must define:

1. the complete metadata-definition grammar, including where it may occur;
2. whether its ID matching inherits or overrides Markdown label normalization;
3. duplicate, missing, malformed, and orphan behavior;
4. extraction from exact source rather than a Markdown-decoded URL;
5. JSON escaping for literal `<`, `>`, and line breaks;
6. interaction with ordinary shortcut references such as `[1]`;
7. rendering expectations for consumers that understand only Markdown; and
8. conformance in terms of parsed association and source preservation separately.

Those rules belong in the CriticMarkup extension syntax. They do not prescribe a WYSIWYG data structure, parser architecture, or editor storage mechanism.
