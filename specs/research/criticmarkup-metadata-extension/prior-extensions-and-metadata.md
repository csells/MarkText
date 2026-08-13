# CriticMarkup metadata extensions and prior art

Research date: 2026-08-12

## Executive finding

No accepted CriticMarkup extension was found that combines durable IDs, attribution, timestamps, replies, resolution state, and out-of-band records. The canonical project still documents the original five forms and treats a comment's contents as unconstrained text. Three directly relevant proposals remain open and unmerged: author names ([#17](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/17)), referenced comments ([#35](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/35)), and inline JSON metadata plus adjacent replies ([#50](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/50)).

There are shipping implementations, but they form incompatible dialects rather than an established CM2:

- NVUltra appends human-readable initials and dates as ordinary CriticMarkup comments.
- Commentator puts JSON before an `@@` separator inside each CriticMarkup range and infers replies from exact adjacency.
- Obsidian Track Changes puts HTML-like key/value metadata before the CriticMarkup sigil and also infers threads from adjacency.
- Markdown Markup embeds a short stable ID, author, and pipe-separated replies in the comment body.
- Other systems use separate, non-CriticMarkup record formats at the end of the document.

The closest precedent to the proposed architecture is an unreleased historical MarkText branch. It used inline durable IDs and an end-of-file registry, first as one opaque record per thread and then as line-oriented JSON records. Its design notes explicitly report that the single-record form was difficult to review and produced same-line merge conflicts. This is strong implementation evidence, but it did not become a released CriticMarkup convention.

## Scope and method

This survey uses only primary sources: the canonical specification repository and issue tracker, source and tests from implementations, project release notes, and official application documentation. “Shipping” means an implementation has an official release or product documentation; it does not mean that its syntax was accepted upstream. Repository and branch state was inspected on 2026-08-12.

## Canonical CriticMarkup

### Current syntax and intended extensibility

The canonical README defines five marks: addition `{++...++}`, deletion `{--...--}`, substitution `{~~old~>new~~}`, comment `{>>...<<}`, and highlight `{==...==}`. It calls comments “generic markup for metadata” and says they may contain a note, timestamp, author initials, or anything else, but defines no fields, escaping rules, identity, reply relation, or status semantics. Its design goals are human readability, regular-expression processing, and compatibility with Markdown-like formats ([canonical README](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L10-L38), [comment guidance](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L148-L160)).

That guidance permits conventions *inside* comment text, but it is not a metadata schema. A legacy reader will expose such conventions as part of the comment body.

### An earlier metadata experiment was removed

The original v0.3a RFC allowed bracketed metadata immediately before a change's closing brace—for example, `{++added++[why]}` and `{--removed--[why]}`—and described that field as suitable for explanations or timestamps. It also used different comment forms, including `{~~selected text~~[comment]}` and `{[comment]}` ([original RFC, issue #1](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/1)).

The February 2013 major revision replaced that draft with the modern five-form language and an unconstrained `{>>comment<<}` form ([revision commit](https://github.com/CriticMarkup/CriticMarkup-toolkit/commit/a42a846ac191af10ccc2336135742a02d798f9e6)). The current command-line parser still has optional bracket captures on its addition and deletion regular expressions, but its processing functions discard those captures; this is historical parser residue, not a documented metadata contract ([CLI parser](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/CLI/criticParser_CLI.py#L24-L34)).

The project has changed syntax when ecosystem compatibility required it. In 2013 it changed highlight delimiters from `{{...}}` to `{==...==}` after collisions with static-blog template engines, updating the specification and bundled toolkits together and warning that syntax changes should be rare ([highlight-delimiter commit](https://github.com/CriticMarkup/CriticMarkup-toolkit/commit/b107add658092b438ebf490e0bb4df20289dc003)). This is the clearest historical precedent for acceptance: a maintainer-approved change landed in the canonical spec and implementations together.

## Direct upstream proposals

### Attribution: issue #17

[Issue #17](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/17), open since 2013, asks for a reviewer name in the syntax. Existing guidance was to prepend something such as `@name` to ordinary comment text. Maintainer Erik Hess described author attribution as unsolved, noted that every new delimiter risks collisions, and invited working implementations rather than selecting a new grammar ([maintainer response](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/17#issuecomment-55905529)). No field schema or accepted syntax resulted.

### Referenced, out-of-band comments: issue #35

[Issue #35](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/35), open since 2015, is the closest upstream proposal to an inline reference plus later record. It proposed:

```markdown
{==reviewed text==}{>>[1,2,3]<<}

{[1]}: @gsw First comment
{[2]}: @abc Another comment
```

The maintainer objected that comma-separated numeric lists would be error-prone and difficult to process. He suggested either a footnote-like syntax—`{^^ 1 ^^}` with `{^^ 1 ^^}: comment`—or MultiMarkdown-style bibliography references such as `[#arbitrary-label][]` with `[#arbitrary-label]: comment`. He specifically favored arbitrary labels and Markdown-capable values over sequential numeric IDs ([maintainer response](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/35#issuecomment-75368897)). A 2023 participant again favored arbitrary identifiers, but the issue remains open and no form was incorporated into the canonical README.

This proposal established useful design pressure but not a standard: references should be durable labels rather than positional comment lists, and the record carrier should reuse a familiar Markdown idiom where possible.

### Inline JSON and adjacent replies: issue #50

[Issue #50](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/50), open since 2023, proposes two extensions:

```markdown
{++{"author":"Fevol","time":1695214491}@@added text++}
{>>root comment<<}{>>reply with no whitespace between marks<<}
```

The JSON object may precede the content of any CriticMarkup mark. `@@` separates metadata from payload. Proposed fields include `author`, Unix `time`, `done`, `color`, and `style`, with possible short keys. A comment immediately adjacent to a preceding comment or other range is its reply; any intervening whitespace breaks that relation.

After discussion with canonical maintainer macdrifter, the proposer said he would ship it as a **superset** and leave the issue open for awareness and possible adoption ([proposal follow-up](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/50#issuecomment-1782105968)). It was not merged into the canonical specification.

Calling this form “backwards compatible” requires qualification. A CM1 parser can still recognize the outer addition or comment, but it sees the JSON and `@@` as ordinary payload. The document remains processable; its legacy-visible semantics are not unchanged.

## Shipping and implemented conventions

| Implementation | Exact convention | IDs | Replies | Time / author | Resolution | Adoption evidence |
| --- | --- | --- | --- | --- | --- | --- |
| NVUltra | Appends an ordinary `{>>...<<}` comment containing configured initials and optional date | No | No schema | Free-form text | No durable state | Product feature documented by the vendor |
| Commentator | `{++{"author":"A","time":...}@@text++}`; metadata works on all five ranges | No | Exact adjacency | Structured JSON | `done` field | Released Obsidian plugin, explicitly beta |
| Obsidian Track Changes | `{author="A" date="2026-06-14" status="open">>comment<<}` | No | Adjacent comments, spaces/tabs allowed but not newline | Key/value fields | “Finalize” removes markup | Released and present in Obsidian's community catalog |
| Review Comments | `{==text==}{>>author\|date: body<<}` | No | No thread grammar documented | Delimited comment text | Resolve removes markup | Released Obsidian plugin |
| Markdown Markup | `{==text==}{>>#a1b2 @author: body \| @other: reply<<}` | Four-character document-local ID | Pipe-separated in one body | Author, no timestamp | Resolve removes markup | Released on Open VSX |
| CommentsMarkup | `{^q1}` anchor plus separate `{^q1 [x]} @author date: body` records | Hierarchical IDs | Child IDs such as `q1.1` | Structured text fields | `[ ]` / `[x]` | Published spec and implementations; separate language, not CM |

### NVUltra: canonical-compatible free text

NVUltra can automatically insert a CriticMarkup comment after every insertion, deletion, change, or comment. The comment normally contains reviewer initials and may include a `strftime`-formatted date ([official NVUltra documentation](https://nvultra.com/help/preferences-criticmarkup)). Because the annotation is ordinary comment text, canonical tools preserve it. It offers no machine-defined identity, reply, or resolution semantics.

### Commentator: the implementation of issue #50

Commentator 0.2.0 shipped the issue #50 syntax as an opt-in extension. Its release notes describe authorship and timestamps on all range types and reply threads formed by immediately adjacent comments ([0.2.0 release](https://github.com/Fevol/obsidian-criticmarkup/releases/tag/0.2.0)). The parser grammar gives each of the five forms an optional JSON metadata prefix followed by `@@` ([parser grammar](https://github.com/Fevol/criticmarkup-parser/blob/0c0c89e84a34f9b199d9f0b404e83ce3160d300f/src/criticmarkup.grammar#L12-L60)), and its fixtures cover both normal and malformed metadata ([basic fixture](https://github.com/Fevol/criticmarkup-parser/blob/0c0c89e84a34f9b199d9f0b404e83ce3160d300f/test/metadata_basic_range.txt), [edge fixture](https://github.com/Fevol/criticmarkup-parser/blob/0c0c89e84a34f9b199d9f0b404e83ce3160d300f/test/metadata_edge_range.txt)).

The implementation recognizes `author`, `time`, `done`, `style`, and `color`, preserves unknown keys, and maps shorter aliases; serialization emits compact JSON followed by `@@` ([metadata model and parser](https://github.com/Fevol/obsidian-criticmarkup/blob/ffe0df4feea9e14233fc5e98f101f5bc01ccf001/src/editor/base/ranges/base_range.ts#L6-L59), [serializer](https://github.com/Fevol/obsidian-criticmarkup/blob/ffe0df4feea9e14233fc5e98f101f5bc01ccf001/src/editor/base/ranges/base_range.ts#L138-L158)). Reply attachment requires exact right adjacency ([range parser](https://github.com/Fevol/obsidian-criticmarkup/blob/ffe0df4feea9e14233fc5e98f101f5bc01ccf001/src/editor/base/edit-util/range-parser.ts#L27-L59)). Metadata features are disabled by default ([defaults](https://github.com/Fevol/obsidian-criticmarkup/blob/ffe0df4feea9e14233fc5e98f101f5bc01ccf001/src/constants.ts#L75-L89)).

The release history is also evidence about implementation cost. Version 0.2.0 says the rewrite took months and replaced most core systems. An early UI path emitted invalid JSON until 0.2.1 ([bug #9](https://github.com/Fevol/obsidian-criticmarkup/issues/9)); by 0.2.7 the maintainer announced a pause in active development ([0.2.7 release](https://github.com/Fevol/obsidian-criticmarkup/releases/tag/0.2.7)). The project README still labels the plugin beta and warns of possible text loss ([README](https://github.com/Fevol/obsidian-criticmarkup/blob/ffe0df4feea9e14233fc5e98f101f5bc01ccf001/README.md#L12-L17)). This is real adoption of a dialect, not evidence that the dialect is robust or canonical.

### Obsidian Track Changes: attribute-prefixed ranges

Track Changes 1.7.0 added metadata to all five range types ([release](https://github.com/philphilphil/obsidian-track-changes/releases/tag/1.7.0)). Its syntax places optional key/value pairs after `{` and before the CriticMarkup sigil:

```markdown
{author="Claude" date="2026-06-14"++added text++}
{author="Gemini" date="2026-06-14" status="open">>comment<<}
```

The parser accepts arbitrary keys with quoted values, with restrictions on quotes, braces, and newlines; the first duplicate key wins. Consecutive comments form a thread when separated only by spaces or tabs, not a newline ([parser](https://github.com/philphilphil/obsidian-track-changes/blob/857e0731d46b28c192c6b3063cc3a81ccbcaeff6/src/parser.ts#L1-L43), [metadata parsing](https://github.com/philphilphil/obsidian-track-changes/blob/857e0731d46b28c192c6b3063cc3a81ccbcaeff6/src/parser.ts#L105-L134)). The design PR documents the grammar change and notes that adversarial review found a nesting regression not covered by the initial tests ([PR #25](https://github.com/philphilphil/obsidian-track-changes/pull/25)).

The plugin is present in Obsidian's official community-plugin catalog ([catalog entry](https://github.com/obsidianmd/obsidian-releases/blob/47c13fd51bf72b6613c3692dbd0b412853babf5f/community-plugins.json#L27184-L27188)), although that catalog itself says listings are not manually reviewed. Its README documents threads, metadata, and finalize/delete behavior ([README](https://github.com/philphilphil/obsidian-track-changes/blob/857e0731d46b28c192c6b3063cc3a81ccbcaeff6/README.md#L13-L37)). It does not define stable IDs, and finalizing a comment removes the markup rather than retaining resolved state. Because the added fields precede the canonical sigil, an unextended CM1 parser will generally not recognize these as CM marks at all.

Commentator and Track Changes expose the fragility of adjacency as a reply relation: one requires zero whitespace, while the other accepts horizontal whitespace. Both reject a newline. Formatting alone can therefore change thread membership, and the two implementations disagree on which formatting is safe.

### Inline-text conventions

Review Comments records attribution and date inside ordinary comment payload—for example, `{==text==}{>>shirai|2026-05-13: please rewrite<<}`—and resolves by unwrapping the highlight and deleting the comment ([project documentation](https://github.com/ShotaShirai1719/obsidian-review-comments/blob/6b7bd2e44600524b3d0b2372ffebccb27e7e97cf/README.md#L5-L15), [configuration and resolution](https://github.com/ShotaShirai1719/obsidian-review-comments/blob/6b7bd2e44600524b3d0b2372ffebccb27e7e97cf/README.md#L42-L64)). This is CM1-readable but delimiter-dependent and has no identity or reply model.

Markdown Markup uses a more complete inline convention:

```markdown
{==anchored text==}{>>#a1b2 @till: note | @agent: reply<<}
```

It assigns a short stable ID, stores replies after `|`, and resolves by removing the marks while keeping the anchored prose ([README](https://github.com/tillahoffmann/markdown-markup/blob/a7d484d2449a5a39b79e867ae749d91a753d43e3/README.md#L11-L42)). IDs begin as four random base-36 characters, are checked against the document, and widen after repeated collisions; the parser accepts longer word-character IDs ([format source](https://github.com/tillahoffmann/markdown-markup/blob/a7d484d2449a5a39b79e867ae749d91a753d43e3/src/format.ts)). Its changelog reports duplicate-ID self-healing and the first public Open VSX release in version 0.2.0 ([changelog](https://github.com/tillahoffmann/markdown-markup/blob/a7d484d2449a5a39b79e867ae749d91a753d43e3/CHANGELOG.md)). This is the strongest direct precedent found for compact durable CriticMarkup comment IDs, but the metadata and replies remain inline, timestamps are absent, and resolution erases the record.

Pandoc's still-open CriticMarkup discussion exposes the conversion consequence of omitting identity metadata. Pandoc's Word-comment representation has paired `comment-start`/`comment-end` spans with `id` and `author` attributes; maintainer John MacFarlane explicitly asked how a conversion back from CriticMarkup could reconstruct author, ID, and date. A participant proposed generated unique “number-hash” IDs when importing otherwise-unidentified CriticMarkup comments, and a later comment pointed to the Commentator JSON extension as a possible answer ([Pandoc issue #2873](https://github.com/jgm/pandoc/issues/2873)). No native CriticMarkup solution has landed there. This is evidence that stable identity is required for loss-controlled interchange, not merely for editor UI.

## Out-of-band record precedents

### Historical MarkText branch

A public but unreleased MarkText branch from July 2026 implemented almost the proposed architecture using HTML comment anchors and an end-of-file JSON registry. Its v2 design was:

```markdown
<!--MC:cmt_123-->selected text<!--MC:~cmt_123-->

[MC:cmt_123]: {"version":2,"status":"open","authors":["Ada"],"createdAt":"..."}
[MC:cmt_123.0]: {"author":"Ada","createdAt":"...","body":"..."}
```

IDs match a word character followed by word characters or hyphens. One root record stores thread state, and one record per reply uses a positional suffix; reply order is document order. Malformed records are preserved with diagnostics rather than silently discarded ([format design](https://github.com/csells/MarkText/blob/2b53d30f859f7ab3738f7ae98593b29045cfb66b/specs/architecture/comment-format.md#L24-L122)).

The same design document explains why it replaced v1, which stored a whole thread as one base64-encoded JSON definition: the opaque line was difficult to review, and concurrent replies modified the same line and created merge conflicts. V2 split the thread into line-oriented records so independent replies usually append independent lines ([v1 problem statement](https://github.com/csells/MarkText/blob/2b53d30f859f7ab3738f7ae98593b29045cfb66b/specs/architecture/comment-format.md#L1-L13), [compatibility and merge rules](https://github.com/csells/MarkText/blob/2b53d30f859f7ab3738f7ae98593b29045cfb66b/specs/architecture/comment-format.md#L56-L87)). The test plan included byte-for-byte round trips, malformed data, and Git merge behavior ([test requirements](https://github.com/csells/MarkText/blob/2b53d30f859f7ab3738f7ae98593b29045cfb66b/specs/architecture/comment-format.md#L132-L146)).

Local tag and branch inspection found this work on `markupdown-inline-comments`, not on the released/development line and not contained by a release tag as of the research date. It is implementation evidence, not a deployed MarkText or CriticMarkup standard. It nonetheless supplies the most directly applicable warning for a “single JSON line per ID” design: plain JSON improves human readability over base64, but all edits to one thread still contend on one physical line.

### iA Writer Markdown Annotations

iA Writer 7 ships an open, end-of-file Markdown Annotations format for authorship rather than comments. It deliberately avoids noisy inline author marks and stores author keys plus character ranges in a final `Annotations:` block. A SHA-256 hash detects whether external edits have invalidated those ranges ([format repository](https://github.com/iainc/Markdown-Annotations/blob/f67628f59186869ff0006c74ddbc08781e3a51f0/README.md#L9-L69)). iA's product documentation says Writer hides the annotation data, other editors may show it, export strips it, and external edits can misplace ranges, which Writer detects and warns about ([Writer 7 announcement](https://ia.net/topics/ia-writer-7), [Authorship support](https://ia.net/writer/support/editor/authorship)).

This is strong evidence that a production Markdown editor can own hidden out-of-band metadata. It also shows why durable inline IDs are preferable to numeric character ranges for comments: offsets drift when another editor modifies the prose.

### CommentsMarkup

CommentsMarkup is a separate complementary language, not a CriticMarkup extension. It uses inline anchors such as `{^q1}` and a later comments section with records such as `{^q1 [x]} @alice 2026-03-15: text`; replies use hierarchical IDs such as `q1.1`, and `[ ]`/`[x]` records current resolution state ([specification](https://github.com/vgracian/comments-markup/blob/d36586aac55d5b7165c645269b5eb5a9c534e2bc/README.md#L1-L49)). It demonstrates the readability of durable references and separate thread records, but its carrier is custom structured text rather than JSON and its anchors are not CM1 marks.

## Compatibility and robustness conclusions

“Backward compatible” has at least four distinct meanings here:

1. A CM2 editor accepts every valid CM1 document unchanged.
2. A CM1 parser still recognizes the outer mark in a CM2 document.
3. A CM1 tool presents the same human payload without exposing metadata as content.
4. An ordinary Markdown renderer hides or harmlessly preserves the out-of-band registry.

Existing extensions generally achieve only (1), sometimes (2). Commentator's JSON form is recognizable as a CM1 range, but legacy tools expose JSON as range content. Track Changes changes the opening grammar, so legacy parsers generally miss the mark. Markdown Markup's ID and replies are legal comment text but are shown as comment text. None supplies transparent legacy semantics.

The evidence favors the following constraints for a new proposal:

- Keep the five canonical CM1 forms accepted exactly as they are.
- Use compact durable opaque IDs rather than positional lists, reply adjacency, or character offsets.
- Define IDs as document-local strings whose values consumers treat as opaque; an allocator may still issue short monotonic values.
- Put author identity, timestamps, reply relationships, and current status in explicit fields rather than parsing human comment prose.
- Specify malformed JSON, dangling references, duplicate IDs/records, and unknown-field preservation. Shipping implementations have encountered malformed serialization, duplicate IDs, and nesting bugs.
- Treat a single-line thread record as an intentional tradeoff: it is easy to hide and manipulate atomically, but edits and replies to the same record share a Git conflict surface. The historical MarkText design changed away from it for exactly that reason.
- Prove the chosen record carrier against the actual Markdown parser. A string resembling a link-reference definition is not automatically a valid hidden reference definition for every JSON payload or every Markdown implementation.
- Do not use whitespace adjacency as the normative reply relation. Existing implementations already disagree on its grammar, and reformatting can alter meaning.

No surveyed convention simultaneously provides all of the requested properties. A compact inline reference plus one-line out-of-band JSON would therefore be a new dialect, though it can cite issue #35 and the historical MarkText design as close antecedents.

## Ownership and proposal route

The canonical repository contains no `CONTRIBUTING`, `CODEOWNERS`, formal standards body, extension registry, version-negotiation process, or tagged releases. The README attributes CriticMarkup to Gabe Weatherhead and Erik Hess ([canonical README](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L221-L225)). In 2019 maintainer macdrifter said the plain-text specification was considered relatively complete, no new syntax was planned, and toolkit changes might be accepted when maintainers could test them ([issue #39](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/39#issuecomment-451777563)).

The practical route is therefore:

1. Publish an implementable proposal in the canonical repository, explicitly relating it to #17, #35, and #50.
2. Include an unambiguous grammar, legacy-reader behavior, malformed/duplicate-record behavior, examples, and executable conformance tests.
3. Demonstrate it in MarkText while naming it a CriticMarkup **superset** until the canonical maintainers merge it.
4. Ask the current repository maintainers to accept the spec and reference implementation together, following the 2013 delimiter-change precedent.

Without that upstream merge—or independent adoption by multiple tools—it should be described as a MarkText extension, not “CriticMarkup 2.” The evidence suggests acceptance is possible only through the loosely maintained canonical repository; there is no separate authority to ratify it.

## Bottom line

The idea is genuinely new in combination, but not without precedent. Upstream has already discussed author attribution, durable referenced comments, and JSON metadata; shipping tools have independently implemented several incompatible subsets; and MarkText itself previously prototyped an out-of-band JSON registry. The strongest proposal would reuse those lessons, make compatibility claims precise, and present a tested MarkText superset to upstream rather than assume a formal extension process exists.
