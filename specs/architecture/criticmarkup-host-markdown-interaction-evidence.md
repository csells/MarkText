# CriticMarkup and host-Markdown interaction: upstream evidence

## Question

Does canonical CriticMarkup require an old/new Substitution choice to change how later
CriticMarkup-looking bytes are interpreted by Markdown? In particular, what should happen for:

```markdown
{~~`~>plain~~}{++literal++}`
```

## Canonical CriticMarkup answer

It does **not define this case**.

The pinned toolkit README says only that CriticMarkup is compatible with Markdown and should work
alongside it. It defines the five surface forms and says a Substitution's arrow separates old text
from new text; it does not define host-parser ordering, grammar state, precedence, projection-time
reparsing, literal contexts, or conditional recognition of a later mark.
([compatibility](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L6),
[Three Laws](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L10-L14),
[Substitutions](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L113-L123))

The closest applicable rule is a caveat headed **Wrap Markdown Tags Completely**. It says the
then-current processor could not handle incomplete Markdown tags. Its bad example lets emphasis
begin outside a Substitution and finish separately in either arm; its recommended spelling repeats
the complete emphasis span inside each arm.
([README lines 201–217](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L201-L217))

The backtick example likewise completes an inline-code span only after selecting the old arm and
continuing into shared suffix text. It is therefore in the territory the canonical README tells
authors to avoid. The README does not call such text invalid, prescribe recovery, or specify any UI
for it; it explicitly frames support for incomplete Markdown tags as a possible future feature.

Consequently, canonical CriticMarkup supplies **no user-facing answer** such as “show this region as
read-only source,” and it supplies no semantic-ownership model for the same source bytes having
different meanings in different projected documents.

## MultiMarkdown implementation evidence (not canonical specification)

MultiMarkdown 5 resolves accept/reject CriticMarkup before its Markdown parse. Its separate
whole-document Critic grammar recognizes marker-looking sequences without first projecting an arm,
then the resolved string is passed to the Markdown parser.
([Critic grammar](https://github.com/fletcher/MultiMarkdown-5/blob/193c09a5362eb8a6c6433cd5d5f1d7db3efe986a/src/parser.leg#L1587-L1684),
[resolve-before-parse pipeline](https://github.com/fletcher/MultiMarkdown-5/blob/193c09a5362eb8a6c6433cd5d5f1d7db3efe986a/src/parser.leg#L1815-L1847))

MultiMarkdown 6 splits into two code paths with different architectures. Its
**accept/reject** path is a true prepass: the CLI runs the source transformer
before parsing, and that transformer's Aho-Corasick tokenizer scans CriticMarkup
delimiter strings independently of Markdown state. Its **rendering** path
integrates CM tokens into the per-block inline token-pair engine. Consequence,
undocumented upstream: the same
multi-block annotation renders as literal text yet transforms under `--accept`.
([MMD 6 CriticMarkup guide](https://fletcher.github.io/MultiMarkdown-6/syntax/critic.html#the-criticmarkup-syntax),
[CLI preprocessing](https://github.com/fletcher/MultiMarkdown-6/blob/3f729288baccc9aa8a2c74ce1bf77adf8bd17c37/src/main.c#L415-L427),
[transformer tokenizer](https://github.com/fletcher/MultiMarkdown-6/blob/3f729288baccc9aa8a2c74ce1bf77adf8bd17c37/src/critic_markup.c#L67-L158))

Those processors therefore do not establish arm-selected parsing of following source for the example. They see
the later `{++literal++}` during the Critic pass, before a selected old arm could make it part of a
code span. MMD 6 separately demonstrates that marks already enclosed by a complete code span remain
literal, but that corpus does not cover a code span formed only after selecting one Substitution arm.
([input corpus](https://github.com/fletcher/MultiMarkdown-6/blob/3f729288baccc9aa8a2c74ce1bf77adf8bd17c37/tests/MMD6Tests/CriticMarkup.text#L64-L72),
[rendered corpus](https://github.com/fletcher/MultiMarkdown-6/blob/3f729288baccc9aa8a2c74ce1bf77adf8bd17c37/tests/MMD6Tests/CriticMarkup.html#L69-L77))

## MarkText decision

Consistent with the upstream compatibility guidance, MarkText Markdown Profile 1 defines a more
precise recovery rule: paired Markdown syntax with one endpoint inside a Substitution arm must have
both endpoints in that arm. An arm neither inherits open inline/literal matching state from outside
nor exports it to later source. Incomplete arm-local state recovers at the boundary and cannot change
how source after the Substitution is recognized. Definitions created in one arm likewise remain
arm-local. The enclosing state resumes unchanged after the Substitution; a complete construct with
both endpoints outside may enclose it.

Carrying each arm's complete Markdown state into a shared suffix would be a MarkText-only extension,
not canonical CriticMarkup behavior. MarkText does not implement that extension because it would
give one canonical source range alternative semantic owners, complicate editing and deterministic
resource accounting, and reduce interoperability without a specified user-facing benefit. See
ADR-0010.
