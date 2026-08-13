# Markdown-native carrier behavior for CM2 records

**Status:** research, 2026-08-12

**Question:** What constraints do normative Markdown and maintained parsers impose on possible out-of-line CM2 records?

**Scope:** facts and constraint ranking only; this note does not choose CM2 syntax.

## Result

No tested carrier simultaneously provides standard Markdown semantics, arbitrary plain JSON, hidden rendering, free placement, robust malformed-input behavior, and exact round-trip preservation.

- An unused CommonMark link reference definition is the only tested **normative CommonMark/GFM construct whose successful recognition produces no rendered block at all**. Its value is nevertheless a link destination plus optional title, not an arbitrary-data field. Labels are case-folded and whitespace-normalized, duplicates are first-wins, and any eligible matching `[label]` becomes a link.
- An HTML comment is the closest existing **opaque hidden region**, and GitHub explicitly documents it as hidden content. Its invisibility depends on allowing raw HTML through to an HTML renderer; safe renderers may escape it visibly. `-->` in data closes it, and a missing closer causes CommonMark-family parsers to consume the rest of the containing document as HTML.
- YAML front matter is an established structured-metadata carrier, but it is a Markdown-dialect extension normally recognized only at the beginning of a document. Plain CommonMark/GFM renders the same bytes as ordinary Markdown. Updating a per-annotation record also rewrites one shared document-head region.
- Footnote definitions are remote definitions, but a referenced footnote is deliberately visible. Footnotes are absent from the formal GFM 0.29 specification even though current GitHub and maintained parser extensions support them.
- Fenced code blocks accept uncomplicated JSON and make CriticMarkup markers literal, but they are intentionally visible code. A missing closer consumes the rest of the containing block or document as code.
- MultiMarkdown and Pandoc have credible metadata blocks, but their placement and duplicate policies disagree with one another and with front-matter plugins. They demonstrate prior art for document metadata, not a portable annotation-record carrier.

The proposed literal suffix form

```markdown
This is a test{>>:[1]<<}.

[1] {"v":1,"by":"Chris"}
```

has no out-of-band meaning in CommonMark, GFM, Marked, or micromark: the second line is a visible paragraph. Adding the colon needed to make it a link reference definition changes both the value grammar and the meaning of `[1]`.

## Normative baseline

### What is actually in CommonMark and GFM

CommonMark 0.31.2 defines link reference definitions, HTML blocks/comments, raw HTML, and fenced code blocks. It does not define front matter, footnotes, arbitrary attributes, directives, or a generic metadata record. The formal GFM 0.29 specification adds tables, task-list items, strikethrough, autolink literals, and tag filtering; its published table of contents contains no footnote or front-matter extension. GitHub notes separately that its service performs post-processing and sanitization after GFM conversion. See the [CommonMark 0.31.2 specification](https://spec.commonmark.org/0.31.2/), and the [formal GFM 0.29 introduction and extension list](https://github.github.io/gfm/#introduction).

GitHub's current product behavior is broader than that frozen formal specification. GitHub documents `[^id]` footnotes, rendered at the bottom regardless of definition placement, and documents HTML comments as a way to hide rendered content. Its footnotes are not supported in wikis. See [GitHub's footnote documentation](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#footnotes) and [GitHub's hidden-comment documentation](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#hiding-content-with-comments).

The maintained micromark project reflects this layered ecosystem: CommonMark is core, while GFM footnotes and front matter are separately named extensions. Its own extension guidance calls HTML/comments one possible marker mechanism, warns that platforms sanitize HTML differently, and warns that adding new Markdown syntax reduces portability. See [micromark's extension inventory and design guidance](https://github.com/micromark/micromark#extensions).

### Exact source is a separate property

The Markdown specifications define recognition and rendered meaning, not a byte- or code-unit-preserving editor serialization. A construct being standard or hidden in HTML therefore says nothing about whether an AST editor will preserve its spelling.

In the fixtures below, `mdast-util-from-markdown@2.0.3` followed by `mdast-util-to-markdown@2.1.2`:

- changed `  [X]: <my url>` to `[X]: <my url>`; and
- changed a `~~~~cm2-json` fence to a backtick fence.

The semantic nodes survived, but the source spelling did not. micromark advertises concrete tokens and positions for every byte, but its ordinary HTML compiler is not a source serializer. MarkText's current engine is different by design: every fixture below satisfied `revision.source === input`, consistent with Profile 1's exact-source rule ([Profile 1 §1, P2](../../language/marktext-markdown-profile-1.md#1-scope-and-design-principles)).

## Carrier matrix

| Carrier                         | Rendered visibility                                                                                            | Placement                                                                                                   | Duplicate / missing reference behavior                                                                                                              | One-line JSON and escaping                                                                                   | CriticMarkup interaction in current MarkText engine                                                                                            | Exact-source implication                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Plain `[1] {json}`              | Visible paragraph                                                                                              | Anywhere a paragraph may occur                                                                              | No identity or reference semantics                                                                                                                  | JSON itself is easy                                                                                          | Outer Comment is recognized, but suffix stays ordinary text                                                                                    | Preserved by MarkText; other serializers may normalize surrounding Markdown                                                             |
| Link reference definition       | Definition block omitted from HTML; matching `[id]` becomes a visible link                                     | Before or after references; cannot interrupt a paragraph; valid inside containers with document-wide effect | Normalized-label namespace; first matching definition wins; missing reference stays literal                                                         | Value must fit destination/title grammar; plain arbitrary JSON does not                                      | Definition is a Markdown node. A `[1]` in a Comment cannot resolve an outer definition because Comment Markdown is isolated                    | MarkText retains exact source and exposes raw and semantic destination/title separately; generic HTML compilers normalize/sanitize URLs |
| Footnote-like definition        | Unused definitions are often omitted; referenced footnotes render a superscript and bottom section             | Extension-specific; GitHub says source position does not affect rendered position                           | Not normatively specified by formal GFM; tested micromark and MarkText resolve the first normalized duplicate; missing ref stays literal/unresolved | Definition body can contain JSON text, but it is Markdown content, not an opaque JSON value                  | With `footnotes: true`, MarkText creates footnote nodes. A reference inside a Comment remains unresolved against an outer definition           | MarkText preserves source; extension serializers control spelling                                                                       |
| HTML comment                    | Browser-hidden when raw HTML passes through; visibly escaped by safe micromark default                         | Inline or block forms; block comment can interrupt a paragraph                                              | No reference/duplicate semantics                                                                                                                    | JSON must not contain an unencoded comment terminator; HTML-valid comments have further forbidden substrings | HTML is a literal owner, so CM-looking bytes inside do not form. Missing close can hide all later CM from the language                         | MarkText preserves exact comment source; HTML render/sanitize policy can escape, strip, or retain it                                    |
| YAML front matter               | Stripped by supporting processors; plain CommonMark/GFM renders it visibly as thematic-break/heading structure | Normally decoded-source offset 0 only                                                                       | YAML mapping keys must be unique; application record-ID policy would still be needed                                                                | JSON is a YAML subset, or records can be YAML; YAML escaping/schema rules apply                              | Profile 1 treats a recognized BOF block as literal, so CM-looking bytes do not form. The same block later in the document is ordinary Markdown | MarkText preserves exact source; front-matter tools may parse/re-emit and normalize it                                                  |
| Fenced code block               | Visible `<pre><code>`                                                                                          | Almost anywhere; can interrupt paragraphs                                                                   | No identity/reference semantics                                                                                                                     | Easy: content is literal; choose a fence not closed by content                                               | CM-looking bytes are literal. Missing close suppresses later CM recognition through end of container/document                                  | MarkText preserves exact source; generic serializers commonly change fence character/length                                             |
| Pandoc / MultiMarkdown metadata | Processor-specific, normally omitted from body output                                                          | MultiMarkdown: document start; Pandoc: multiple YAML blocks may occur anywhere with constraints             | MultiMarkdown keys normalize case/spaces; Pandoc says later block wins for a repeated field                                                         | Rich structured values, including JSON as YAML, but dialect parsing/escaping applies                         | Not recognized as metadata by Profile 1 except when it also matches BOF YAML front matter                                                      | Dialect writers may consolidate or normalize blocks                                                                                     |

## Carrier details

### 1. Link reference definitions

#### Recognition and visibility

A CommonMark link reference definition has this grammar at a high level:

```text
[label]: destination optional-title
```

It may have up to three leading spaces. The destination is mandatory (although `<>` denotes an empty destination); the title is optional. No non-whitespace characters may follow the title. An unused valid definition produces no rendered content. Definitions may precede or follow uses, may appear inside lists or block quotes while affecting the whole document, and cannot interrupt a paragraph. These are normative rules and examples in [CommonMark §4.7](https://spec.commonmark.org/0.31.2/#link-reference-definitions).

The label is not a case-sensitive record key. CommonMark caps it at 999 characters, Unicode-case-folds it, trims surrounding whitespace, and collapses internal whitespace. When definitions normalize to the same label, the first one wins; consumers are merely encouraged to warn. A missing definition leaves reference-looking text literal. See [CommonMark §6.3's label matching rules](https://spec.commonmark.org/0.31.2/#links).

Consequences for a putative CM2 reference are:

1. `[1]: ...` makes every eligible `[1]` in that Markdown scope a shortcut link. It is not an inert identifier declaration.
2. `ID`, `id`, and whitespace variants are not distinct record IDs.
3. Appending a correcting duplicate does not override an earlier record; the earlier definition remains authoritative.
4. A direct line `[1] {json}` lacks the colon and destination grammar and is visible text.

#### JSON does not fit without a second encoding decision

The destination has two spellings:

- `<...>` permits spaces but forbids line endings and an unescaped `<` or `>`; or
- an unbracketed nonempty destination forbids spaces and ASCII controls and requires balanced or escaped parentheses.

Titles use matching `"..."`, `'...'`, or `(...)` delimiters; their own delimiter must be backslash-escaped and they cannot contain a blank line. Backslash escapes are semantically decoded. See [CommonMark's destination and title grammar](https://spec.commonmark.org/0.31.2/#links).

Thus compact `{"v":1}` happens to fit as an unbracketed destination, but `{"text":"A B"}` does not. Angle brackets admit spaces, but a JSON string containing `>` terminates the destination for conforming parsers unless the data uses a JSON-level escape such as `\u003e`. Putting JSON in a title replaces that hazard with delimiter/backslash double-escaping. There is no delimiter among these forms that can contain every JSON string unchanged.

The maintained parsers also demonstrate why the semantic URL must not be mistaken for stored data:

- Marked encoded `{"v":1}` into the rendered `href`.
- micromark's safe HTML compiler emitted an empty `href`, while its mdast definition node retained the semantic URL string.
- MarkText exposed both `rawDestination: '{"v":1}'` and a percent-encoded `semanticDestination` while preserving the source range.
- For `[j]: <{"text":"a > b"}>`, micromark and MarkText correctly rejected the definition, while Marked 18.0.5 accepted it. An edge encoding that relies on permissive behavior is not portable.
- For JSON in a single-quoted title containing a Markdown-escaped apostrophe, micromark and MarkText accepted the definition while Marked did not.

A link-definition carrier therefore needs a CM2-owned data encoding and must read the exact source field, not a renderer's URL. At that point it is borrowing CommonMark's hidden-block recognition, not obtaining a plain-JSON record from CommonMark.

#### Current MarkText isolation rule

Profile 1 interprets a Comment payload as an isolated full Markdown+CriticMarkup subdocument. Definition and reference state cannot cross the Comment boundary ([Profile 1 R5](../../language/marktext-markdown-profile-1.md#6-criticmarkup-recognition-rules)). In the fixture

```text
Text{>>:[1]<<}.

[1]: <{"v":1}>
```

the outer `[1]: ...` is a valid `definition` node, but the Comment Display AST contains only the text `:[1]`; it is not a resolved link. A CM2 implementation would need its own cross-boundary record lookup. Reusing Markdown reference resolution would contradict the current Comment-isolation rule.

### 2. Footnote-like definitions

Footnotes are useful prior art for a remote note body, but they are presentation, not hidden metadata. GitHub renders references as superscripts and definitions in a bottom section, regardless of where the definition is written ([GitHub footnotes](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#footnotes)).

Formal GFM 0.29 does not specify them, so duplicate and malformed behavior is extension policy. In the tested `micromark-extension-gfm@3.0.0`:

- an unused definition emitted nothing;
- a missing reference rendered literally;
- matching was case-insensitive and the first duplicate supplied the footnote body; and
- multiple references to one definition generated multiple backlinks.

Marked 18.0.5 without a footnote extension instead interpreted a compact `[^1]: {"v":1}` as an ordinary link reference definition, making `[^1]` a link. The same bytes therefore switch between link semantics and footnote semantics based on enabled extensions.

MarkText also makes footnotes option-dependent. Its facade defaults `footnotes` to false ([`DEFAULT_MARKDOWN_OPTIONS`](../../../packages/document-core/src/documentCore.ts)); with `footnotes: true`, it creates `footnote-definition` / `footnote-reference` nodes, retains duplicate definitions, resolves a reference to the first normalized definition, and marks a missing reference `resolved: false`. A `[^1]` inside a Comment remains unresolved against an outer definition because of R5 isolation.

### 3. HTML comments

HTML comments are genuine CommonMark raw-HTML syntax. A block starting with `<!--` continues through the first line containing `-->`, or through the end of its containing block/document when no closer occurs. CommonMark passes raw HTML through to HTML output; [CommonMark §4.6](https://spec.commonmark.org/0.31.2/#html-blocks) includes a multiline comment example. GitHub explicitly recommends comments to hide rendered content ([GitHub hidden comments](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#hiding-content-with-comments)).

Three constraints dominate:

1. **Hidden is a rendering policy.** `micromark@4.0.2` with `allowDangerousHtml: true` passed the comment through, so a browser hid it. With the safe default it escaped the entire comment, visibly rendering `&lt;!--...--&gt;`. Marked passes raw HTML and explicitly warns that it does not sanitize output ([Marked security warning](https://marked.js.org/#usage)). A sanitizer may retain, escape, or strip comments.
2. **The delimiter is data-sensitive.** The first `-->` ends the comment. The HTML Living Standard additionally forbids comment text containing `<!--`, `-->`, or `--!>`, and certain boundary strings ([HTML §13.1.6](https://html.spec.whatwg.org/multipage/syntax.html#comments)). Arbitrary JSON strings must therefore escape or encode those sequences before insertion.
3. **A missing closer has a large failure radius.** Marked, micromark, and MarkText all classified every following line through EOF as the HTML block in the unclosed fixture. MarkText consequently recognized no `{++change++}` annotation after the bad opener. This is standards-conforming, but hostile to robust review metadata.

For a well-formed block comment MarkText produced an `html-block` node and preserved exact source. Because Profile 1 gives HTML literal ownership, CM-looking bytes inside the comment do not form CriticMarkup ([Profile 1 §7](../../language/marktext-markdown-profile-1.md#7-literal-precedence)). That collision behavior is clean when the delimiter is correct and catastrophic when it is not.

### 4. YAML front matter

Front matter is established metadata but not CommonMark/GFM. With no extension, this fixture renders as a thematic break followed by a setext heading:

```text
---
cm2: [{"v":1}]
---

Body.
```

With `micromark-extension-frontmatter@2.0.0`, the BOF block is tokenized and omitted from HTML. The same bytes in the middle of a document are ordinary Markdown by default. The maintained remark-frontmatter project explicitly says front matter is normally recognized only at the start and calls enabling it “anywhere” bad for portability. It also says the syntax plugin does not parse the data; a second YAML-processing step is required. See [remark-frontmatter's API and authoring guidance](https://github.com/remarkjs/remark-frontmatter#api).

MarkText Profile 1 likewise recognizes only YAML `---` front matter at decoded-source offset 0 (after an optional BOM); TOML and JSON-specific fences are ordinary Markdown ([Profile 1 §4](../../language/marktext-markdown-profile-1.md#4-layer-c--marktext-built-in-constructs)). The current engine made the BOF fixture one `front-matter` AST node, made the middle fixture a thematic break plus heading, and preserved both sources exactly. Recognized front matter is a literal range, so CM-looking record data cannot become CriticMarkup.

JSON can be embedded because JSON is a YAML-compatible data notation, but then the document has a shared metadata object rather than separately placeable records. YAML mapping keys are required to be unique ([YAML 1.2.2 representation model](https://yaml.org/spec/1.2.2/#3211-nodes)); CM2 would still need its own record-ID and merge policy inside a sequence or mapping. Every per-comment append/update touches the same BOF region, increasing ordinary line-merge contention.

### 5. Fenced code blocks

CommonMark fenced code accepts backtick or tilde fences of at least three characters; content is literal, the closing fence must use the same character and be at least as long, and an unclosed fence continues through the end of the containing block/document. Fences may interrupt paragraphs. The info string is available but its treatment is not standardized beyond common language-class rendering. See [CommonMark §4.5](https://spec.commonmark.org/0.31.2/#fenced-code-blocks).

All tested parsers rendered a `cm2-json` fence visibly as code. MarkText treated `{"text":"{++x++}"}` as literal code and formed no Addition. This is straightforward and robust for well-formed JSON, but violates the hidden-carrier goal. An unclosed fence has the same broad “consume the suffix” failure class as an unclosed HTML comment. Source serializers may also change fence character or length without changing code-block semantics.

### 6. Existing dialect metadata

Two maintained CriticMarkup-adjacent ecosystems already carry document metadata, but not with common semantics:

- MultiMarkdown metadata is a key/value header at the very top of the document (optionally surrounded by YAML-like fences). Keys are case-insensitive and stripped of spaces; values can span lines. A blank line ends the metadata. See [MultiMarkdown 6 metadata](https://fletcher.github.io/MultiMarkdown-6/syntax/metadata.html).
- Pandoc's `yaml_metadata_block` may occur anywhere when preceded appropriately, permits multiple blocks, accepts JSON because JSON is a YAML subset, and uses the later block when fields repeat. When Pandoc writes Markdown, it may consolidate metadata into one block at the beginning. See [Pandoc's YAML metadata block extension](https://pandoc.org/MANUAL.html#extension-yaml_metadata_block).

These are credible precedents for _document-level_ structured metadata. Their incompatible placement and duplicate behavior are evidence that “Markdown editors understand metadata” is an ecosystem convention, not one Markdown contract.

## Reproducible fixture evidence

### Toolchain

The fixtures were run on 2026-08-12 with:

- Node.js 26.7.0;
- Marked 18.0.5;
- micromark 4.0.2;
- micromark-extension-gfm 3.0.0;
- micromark-extension-frontmatter 2.0.0;
- mdast-util-from-markdown 2.0.3 and mdast-util-to-markdown 2.1.2; and
- the current uncommitted MarkText `packages/document-core/src` checkout at base commit `cce65011c8dbb882dd52a81cee60ad98003f9b11`.

No package was installed for this research; versions came from the existing MarkText workspace lockfile and node_modules. Each MarkText fixture used `createDocumentCore().open(source)` (and `{footnotes: true}` for footnote cases), then inspected `revision.source`, `project(..., 'revised')`, `project(..., 'markup')`, and `projectComment(...)` where applicable.

### Minimal fixtures and observations

| Fixture                                           | Marked 18.0.5                                      | micromark 4.0.2                                                         | Current MarkText language engine                                                       |
| ------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `[1] {"v":1}`                                     | Visible paragraph                                  | Visible paragraph                                                       | Paragraph node; exact source                                                           |
| `[1]: <{"v":1}>` plus eligible `[1]`              | Definition hidden; `[1]` links to encoded JSON URL | Definition hidden; safe HTML gives empty `href`; mdast URL is `{"v":1}` | Definition + link nodes; raw/semantic destination split; exact source                  |
| duplicate `[ID]: ...` then `[id]: ...`            | First definition supplies link                     | First definition supplies link                                          | Both definition nodes retained; link resolves to first                                 |
| destination containing literal `>` inside `<...>` | Accepted (nonconforming edge)                      | Rejected; both lines visible                                            | Rejected; paragraph nodes                                                              |
| `[^1]: ...` with a `[^1]` use                     | Ordinary link-reference behavior without plugin    | Footnote section under GFM extension                                    | Option off: ordinary Markdown/link-definition possibilities; option on: footnote nodes |
| closed HTML comment                               | Raw comment emitted; browser hides                 | Raw-enabled: browser hides; safe default: visibly escaped               | `html-block`; exact source                                                             |
| unclosed HTML comment followed by `{++change++}`  | Suffix remains in raw HTML block                   | Suffix remains in raw HTML block                                        | One HTML block through EOF; no Addition recognized                                     |
| BOF YAML front matter                             | Visible rule + heading                             | Visible without extension; omitted with frontmatter extension           | `front-matter` node; exact source                                                      |
| middle YAML-looking block                         | Visible rule + heading                             | Visible rule + heading even with default frontmatter extension          | Thematic break + heading; exact source                                                 |
| `cm2-json` fenced block                           | Visible code                                       | Visible code                                                            | `code-block`, CM-looking payload literal; exact source                                 |

Representative invocation pattern:

```js
const htmlFromMarked = marked.parse(source)
const htmlFromCommonMark = micromark(source, { allowDangerousHtml: true })
const htmlFromGfm = micromark(source, {
  allowDangerousHtml: true,
  extensions: [gfm()],
  htmlExtensions: [gfmHtml()]
})
const htmlWithFrontmatter = micromark(source, {
  allowDangerousHtml: true,
  extensions: [frontmatter(['yaml'])]
})

const core = createDocumentCore()
const revision = core.open(source)
const revised = core.project(revision, 'revised')
```

The fixture conclusions depend only on output categories recorded above, not incidental HTML whitespace.

## Ranked constraints for a later syntax decision

This ranking identifies which questions should be resolved first; it is not a carrier ranking or syntax choice.

1. **Bound malformed-input blast radius.** A missing closer must not turn the remaining document into metadata/literal content or suppress later CriticMarkup. HTML comments and fences fail this constraint without an additional recovery rule, which would itself be a Markdown divergence.
2. **Define identity and lifecycle independently of Markdown label accidents.** Record IDs need explicit case sensitivity, normalization, duplicate handling, missing-record handling, orphan handling, copy/paste behavior, and behavior when an annotation is accepted/rejected or text is duplicated. CommonMark labels silently bring Unicode case-folding, whitespace normalization, and first-wins behavior that may be wrong for CM2.
3. **Preserve Comment scope deliberately.** Current MarkText Comment Markdown is isolated. CM2 cross-references must either be a separate post-parse association layer or explicitly revise that language rule; they cannot accidentally inherit outer Markdown definitions.
4. **Specify a data encoding, not merely “JSON.”** The carrier delimiter may constrain `>`, `-->`, quotes, backslashes, line endings, or fence lines. The spec must say whether consumers parse exact source, Markdown-decoded semantic fields, percent/base64 data, or another canonical representation. Double escaping is an interoperability surface.
5. **Separate hidden rendering from preservation.** Raw HTML policy, sanitizers, WYSIWYG presentation, HTML/PDF/export, and AST reserialization can each expose, strip, or normalize a carrier. Conformance needs source-round-trip tests as well as render tests.
6. **Choose placement and update locality.** A BOF aggregate minimizes syntax nodes but makes every record update collide in one shared region. Per-record suffix entries append/merge better but require a portable remote-definition construct and orphan policy. “Anywhere” front matter is demonstrably dialect-specific.
7. **Define collision precedence with all five CriticMarkup forms and Markdown literals.** Metadata must not create CM inside JSON, while malformed metadata must not mask valid CM after it. Link destinations, HTML, front matter, and code fences currently receive literal ownership in Profile 1; any new carrier needs equally explicit precedence.
8. **Version the extension boundary.** Profile 1 currently recognizes exactly five CriticMarkup forms and rejects third-party metadata separators ([Profile 1 §5](../../language/marktext-markdown-profile-1.md#5-layer-d--criticmarkup-surface-forms)). Any recognition/structure/projection change requires a new profile under [Profile 1 §14](../../language/marktext-markdown-profile-1.md#14-versioning), even if its surface borrows existing Markdown syntax.

## Facts a CM2 proposal can safely assume

- Plain JSON after `[id]` is not hidden Markdown metadata.
- Link definitions supply a standard hidden _definition block_, not a standard arbitrary-data record.
- HTML comments supply standard raw-HTML comment recognition, not uniform hide/preserve behavior across sanitizer policies.
- Footnotes and front matter are extension ecosystems with useful prior art but no single GFM/CommonMark contract.
- Fenced code is a reliable literal envelope but an intentionally visible one.
- In MarkText, exact source ranges are available and should remain the authority; renderer-decoded URLs/titles are unsuitable as the only copy of record data.
- Any out-of-line reference from a Comment is separate from the Comment's isolated Markdown resolution and must be designed as such.

Those facts narrow the next design round without deciding whether CM2 should use a Markdown-native carrier, an HTML-comment convention, a document metadata block, or new dedicated syntax.
