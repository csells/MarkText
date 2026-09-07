# CriticMarkup whitespace and adjacency

## Bottom line

Canonical CriticMarkup does **not** define insignificant whitespace around marks or a
general rule that attaches a following construct to a mark. Its delimiters are fixed
character sequences; whitespace between them is annotation content, and whitespace
outside them is ordinary document text.

The one apparent attachment convention is Highlight followed by Comment. The README
recommends that a Highlight be followed by a related Comment and shows them with zero
characters between them, but it does not say whether intervening whitespace is allowed
or define an abstract relationship independent of source adjacency. Canonical/reference
implementations consequently disagree on the separated case.

## What the canonical README specifies

The five displayed forms use fixed delimiters: `{++ ++}`, `{-- --}`, `{~~ ~> ~~}`,
`{>> <<}`, and `{== ==}{>> <<}`. The document does not publish an EBNF grammar or an
"optional whitespace" rule around those delimiters.
([basic syntax](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L29-L38))

Whitespace **inside** a mark is content:

- In `dolor{++ sit++} amet`, the README expressly says that the space and `sit` are
  added. Thus the space after `{++` is payload, not ignored padding.
  ([addition example](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L40-L48))
- In the corresponding Deletion example, it expressly says that the word and a space
  are deleted.
  ([deletion example](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L78-L86))
- Newlines can occur inside marks and are assigned to the containing Addition,
  Deletion, or Substitution arm, although the README later advises avoiding newlines
  inside CriticMarkup because inline HTML output can become invalid.
  ([paragraph examples](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L50-L62),
  [Substitution newlines](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L123-L145),
  [caveat](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L201-L207))
- Comments may contain newlines, but the recommended HTML conversion strips them;
  the source whitespace is still Comment content.
  ([Comments](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L148-L162))

Whitespace **outside** a mark is not claimed by it. The examples deliberately put a
space inside an Addition when that space is to be added, or inside a Deletion when it
is to be removed. Spaces before or after the complete `{...}` remain ordinary source
text under that model.

For Highlight plus Comment, the README says a Highlight "can be used on [its] own" but
recommends that it "always be followed by a comment related to the highlighted
passage." Both its detailed example and its combined example spell this as exact
adjacency: `{==text==}{>>comment<<}`.
([Highlight guidance and example](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L164-L180),
[combined example](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L182-L199))
The wording is a recommendation, not a parsing rule: it does not say that a gap is
allowed, forbidden, or ignored, nor how far "followed" may reach.

The README also describes a Comment as generic metadata whose HTML span appears "after
the relevant change" and says metadata may be used however the author likes. It does
not define IDs, parent/child relationships, or an association between an arbitrary
annotation and a later marker.
([Comments](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L148-L162))

## Reference implementation behavior

### MultiMarkdown 5: independent marks; gap preserved

MultiMarkdown 5 gives each opener and closer an exact token (`{++`/`++}`,
`{==`/`==}`, `{>>`/`<<}`, and so on). Its content productions consume all intervening
characters, including whitespace. Its Highlight and Comment are separate grammar
productions; there is no Highlight-Comment pair production.
([grammar](https://github.com/fletcher/MultiMarkdown-5/blob/193c09a5362eb8a6c6433cd5d5f1d7db3efe986a/src/parser.leg#L1587-L1673))

At document level, anything outside a recognized mark is emitted as `RawString`.
Consequently all of these contain two independently recognized marks:

```markdown
{==range==}{>>note<<}
{==range==} {>>note<<}
{==range==}
{>>note<<}
```

In the latter two, the space or newline is an ordinary raw string between them.
([document grammar and `RawString`](https://github.com/fletcher/MultiMarkdown-5/blob/193c09a5362eb8a6c6433cd5d5f1d7db3efe986a/src/parser.leg#L1675-L1684))
Accept/reject processing retains Highlight content, removes Comment content, and emits
ordinary strings unchanged, so the intervening whitespace survives either projection.
([projection code](https://github.com/fletcher/MultiMarkdown-5/blob/193c09a5362eb8a6c6433cd5d5f1d7db3efe986a/src/critic.c#L43-L80))

This parser behavior recognizes both constructs; it does **not** reconstruct a semantic
relationship between them.

### Bundled toolkit processors: inconsistent separated-Highlight behavior

The toolkit's CLI processor has one combined Highlight-and-Comment regular expression
whose boundary is literally `==}{>>`; no space or newline is accepted there.
([CLI patterns](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/CLI/criticParser_CLI.py#L24-L38))
It processes that combined expression before standalone Comments. Therefore with a
gap, its Highlight remains unprocessed source while its Comment is still processed.
([CLI processing order](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/CLI/criticParser_CLI.py#L330-L340))

By contrast, the bundled Marked processor uses independent standalone Highlight and
Comment expressions, so it processes both even when source characters separate them
and leaves the intervening characters untouched.
([Marked processor patterns](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/Marked%20Processor/critic.py#L6-L18),
[processing](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/Marked%20Processor/critic.py#L269-L275))

This disagreement confirms that the canonical prose does not settle separated
Highlight-Comment parsing.

## Consequence for `ANNOTATION<!--cmid:ID-->`

CriticMarkup 1 supplies no inherited answer for whitespace between an annotation and
the proposed HTML marker:

```markdown
{>>note<<}<!--cmid:1-->
{>>note<<} <!--cmid:1-->
{>>note<<}
<!--cmid:1-->
```

To a CM1 parser, the valid CriticMarkup Comment is the same in all three cases; the gap,
when present, is ordinary document text, and the HTML comment has no CriticMarkup
meaning. Whether the latter two markers still attach to the preceding annotation is
therefore a **new extension grammar decision**, not a permissiveness rule that can be
borrowed from CM1.

The proposal must state the allowed gap explicitly (for example, exact adjacency only,
or a precisely bounded set of spaces/tabs/newlines). It must also state that any
allowed gap remains ordinary Markdown source text rather than being absorbed into the
annotation or ID. Without that rule, implementations can reasonably reproduce the
same divergence already present for Highlight plus Comment.

## Ambiguities left by CriticMarkup 1

- No normative grammar distinguishes required, optional, and payload whitespace.
- No rule defines whether a Comment is structurally attached to a Highlight or merely
  conventionally placed after it.
- No rule says whether intervening spaces, tabs, newlines, or Markdown constructs
  prevent such a relationship.
- No rule associates any existing annotation type with an arbitrary following marker.
- Bundled/reference implementations prove that relying on unspecified adjacency gives
  non-portable results.
