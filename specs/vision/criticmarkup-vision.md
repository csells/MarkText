# CriticMarkup in MarkText — Vision

> **Scope.** This is the vision for MarkText's **CriticMarkup integration** — what it
> means to make CriticMarkup a first-class part of the editor. The vision for the editor
> *as a whole* belongs to the upstream MarkText project and is treated here as given.
> Canonical reference: the CriticMarkup toolkit
> (<https://github.com/CriticMarkup/CriticMarkup-toolkit>).

## The promise

CriticMarkup makes MarkText a place where editorial change is first-class and lock-in-free.
Suggestions and comments live in the document as plain, standard CriticMarkup, and you
author, review, and resolve them in true WYSIWYG. Anyone or anything — a co-author, an
editor, an external tool, an AI — proposes a change by writing CriticMarkup; you accept or
reject it with a gesture, not by reading a diff. Because the document is *only ever*
standard Markdown plus the five CriticMarkup forms, other CriticMarkup-aware tools can
retain and expose the same markers. MarkText documents its behavior where the ecosystem
does not define one common semantic answer.

## The five forms, exactly

We implement the canonical CriticMarkup forms and nothing else:

| Addition | Deletion | Substitution | Highlight | Comment |
| --- | --- | --- | --- | --- |
| `{++ ++}` | `{-- --}` | `{~~ ~> ~~}` | `{== ==}` | `{>> <<}` |

Two things keep "100% CriticMarkup" honest against the canonical toolkit:

- **Accept/Reject is a workflow, not a format extension.** The toolkit renders CriticMarkup;
  it defines no accept/reject. "Original" (reject all) and "Revised" (accept all) are the
  *standard interpretation* of the five forms — accepting keeps content and drops the
  markers, rejecting drops both — surfaced as a review surface. It adds nothing to the
  bytes on disk.
- **Cross-block CriticMarkup is faithful, not invented.** The toolkit itself shows
  paragraph-level insertion and deletion (`{++\n\n++}`). We support CriticMarkup that spans
  block boundaries — going beyond single-block implementations, never beyond the spec.
- **The Highlight+Comment pair is canonical, not our invention.** The spec enumerates the fifth
  form as `{== ==}{>> <<}` and says *"While a highlight can be used on it's own, we recommend that
  it always be followed by a comment related to the highlighted passage."* We treat a gapless
  `{==passage==}{>>note<<}` as one anchored annotation. Byte-exact adjacency is the entire signal:
  zero characters between `==}` and `{>>`. Nothing may normalize that gap.

## Principles

1. **100% CriticMarkup surface syntax, and only CriticMarkup.** The five forms exactly as
   specified. We add no proprietary syntax, metadata, IDs, threads, anchors, or sentinels,
   and support all five forms, including standalone Highlight and Comment. Where the spec is
   silent, the versioned MarkText profile defines deterministic behavior without changing the
   on-disk forms. Syntax portability does not imply every existing tool shares those rulings.

2. **Source-authoritative and lossless.** The decoded source is the document authority.
   A no-op save preserves the original bytes; an edited save preserves the declared
   encoding/EOL policy and never silently rewrites unrelated source, trivia, marker
   spelling, or escapes.

3. **One intrinsic language model.** Markdown and CriticMarkup are one language, not a
   Markdown parse plus a CriticMarkup side channel. Original (reject all), Revised (accept
   all), and the editing view derive from that shared interpretation; no consumer invents
   a second meaning by rescanning flattened text.

4. **True WYSIWYG.** Suggestions and comments are authored, reviewed, accepted, and rejected
   in the WYSIWYG surface — not only in a source pane. A tracked change looks like a tracked
   change while you write around it.

5. **Instant.** Typing has no perceptible lag. Ordinary edits reuse unchanged work, update
   only affected presentation, and are measured from browser input through visible paint
   and authoritative acknowledgement.

## Who suggests

Humans (co-authors, editors), external tools, and AI are the same to the document: each
proposes a change or comment by writing CriticMarkup, and each is reviewed the same way.
The integration privileges no source of suggestions.

## Non-goals

- **No author attribution — we neither emit nor parse it.** Note the honest version: the spec
  *does* bless a place for it. Multi-author change tracking "through the use of comments" is a
  stated design goal, and a comment "may include a note, time stamp, author initial or similar
  annotation … used however you like." So `{>>@chris<<}` is already a legal comment we preserve
  byte-exactly. What the spec deliberately does **not** define is a *format*, and three verified
  facts make building one a mistake:
  1. **There is nothing to conform to.** Implementations in the wild spell it at least eight
     mutually incompatible ways (`@tag`, `author: X, date: Y`, `Name:`, `[author=X]`,
     `author|date:`, …). No implementation parses another's, so adopting one buys recognition in
     at most one tool and literal prose everywhere else.
  2. **Permitting is free; parsing is the harm.** Preserving what an author types costs nothing.
     *Parsing* it means reinterpreting prose we didn't write — `{>>ask @bob about this<<}` and
     `{>>Maya Chen: source for these?<<}` are indistinguishable from author fields under real
     grammars. *Emitting* it buries genuine reviewer comments in unparseable machine noise.
  3. **It cannot survive resolution.** Accepting or rejecting a change erases the comment that
     described it, so attribution parked there vanishes exactly when the change is resolved. A
     feature that deletes its own data is not a feature.

  So: comments carrying initials or dates are ordinary comments, preserved exactly and never
  interpreted. Real attribution belongs to a host or transport layer that has somewhere durable
  to put it — not to the document.
- **No comment threads or replies.** Reply-by-adjacency (a comment touching another mark) is the
  only pure-CriticMarkup candidate, but it is not an adopted convention — the two tools that
  implement it disagree on the rule, and it would encode meaning in the *absence* of whitespace,
  which a serializer could silently create or destroy. Comments are flat.
- **No real-time co-editing.** No live cursors, presence, or CRDT sync. CriticMarkup is
  asynchronous, in-document review, not multiplayer editing.
- **Not a version-control or diff/merge tool.** CriticMarkup is in-document suggestion, not
  a git replacement or three-way merge.
- **Not the editor's whole vision.** Focus mode, math, diagrams, themes, and the rest belong
  to the upstream MarkText project.

## Where the CriticMarkup documents live

The CriticMarkup work spans several documents; they differ by **role**, not by subject:

| Role | Document |
| --- | --- |
| **Why** — this vision | `specs/vision/criticmarkup-vision.md` |
| **Decisions** — binding, hard to reverse | Semantic/product ADRs `0001`–`0005`, `0007`–`0010`, and `0013`–`0015` |
| **What the language means** — candidate pending ratification | `specs/language/marktext-markdown-profile-1.md` |
| **How we get there** — the integration plan | `specs/plans/0010-marktext-criticmarkup-core-integration.md` |
| **Vocabulary** | `CONTEXT.md` |
| **Evidence** — upstream research answering a specific question | `specs/architecture/criticmarkup-host-markdown-interaction-evidence.md` |

The architecture lives in the active ADRs, plan 0010, and this vision. ADRs 0006,
0011, and 0012 record plan-0009 implementation designs and are not active target
authority. Research and evidence may explain a ruling, but no prior implementation
defines target behavior.

## North star

Run a complete editorial pass — receive suggestions and comments, weigh them, accept or
reject each — entirely in WYSIWYG, with zero perceptible lag, and save a byte-exact document
that is nothing but standard Markdown and CriticMarkup any other tool can open.
