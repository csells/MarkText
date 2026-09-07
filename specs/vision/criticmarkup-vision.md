# CriticMarkup in MarkText — Vision

> **Scope.** This is the vision for MarkText's **CriticMarkup integration** — what it
> means to make CriticMarkup a first-class part of the editor. The vision for the editor
> _as a whole_ belongs to the upstream MarkText project and is treated here as given.
> Canonical reference: the CriticMarkup toolkit
> (<https://github.com/CriticMarkup/CriticMarkup-toolkit>).

## The promise

CriticMarkup makes MarkText a place where editorial change is first-class and lock-in-free.
Suggestions and comments live in the document as plain, standard CriticMarkup, and you
author, review, and resolve them in true WYSIWYG. Anyone or anything — a co-author, an
editor, an external tool, an AI — proposes a change by writing CriticMarkup; you accept or
reject it with a gesture, not by reading a diff. Because the document is _only ever_
standard Markdown plus the five CriticMarkup forms, other CriticMarkup-aware tools can
retain and expose the same markers. MarkText documents its behavior where the ecosystem
does not define one common semantic answer.

Comments, suggestions, and highlights must feel as though MarkText was built with them
from the beginning. Language-engine integration and native MarkText UI integration are
equal parts of this promise. Rendering the markers correctly or providing a separate
review interface does not fulfill it.

## The five forms, exactly

We implement the canonical CriticMarkup forms and nothing else:

| Addition  | Deletion  | Substitution | Highlight | Comment   |
| --------- | --------- | ------------ | --------- | --------- |
| `{++ ++}` | `{-- --}` | `{~~ ~> ~~}` | `{== ==}` | `{>> <<}` |

Two things keep "100% CriticMarkup" honest against the canonical toolkit:

- **Accept/Reject is a workflow, not a format extension.** The toolkit renders CriticMarkup;
  it defines no accept/reject. "Original" (reject all) and "Revised" (accept all) are the
  _standard interpretation_ of the five forms — accepting keeps content and drops the
  markers, rejecting drops both — surfaced as a review surface. It adds nothing to the
  bytes on disk.
- **Cross-block CriticMarkup is faithful, not invented.** The toolkit itself shows
  paragraph-level insertion and deletion (`{++\n\n++}`). We support CriticMarkup that spans
  block boundaries — going beyond single-block implementations, never beyond the spec.
- **The Highlight+Comment pair is canonical, not our invention.** The spec enumerates the fifth
  form as `{== ==}{>> <<}` and says _"While a highlight can be used on it's own, we recommend that
  it always be followed by a comment related to the highlighted passage."_ We treat a gapless
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

5. **Native throughout MarkText.** Extend the existing editor, sidebar, selection tools,
   menus, commands, and history with comments, suggestions, and highlights. Follow
   MarkText's visual language, interaction conventions, and platform behavior. The user
   should keep working in the editor they already know.

6. **Instant.** Typing has no perceptible lag. Ordinary edits reuse unchanged work, update
   only affected presentation, and are measured from browser input through visible paint
   and authoritative acknowledgement.

## What native integration means

“Native” means part of MarkText's existing product experience, including its macOS
conventions; it does not prescribe a replacement UI toolkit. These are required user
outcomes for CM1, not optional polish after the engine is complete.

| Existing surface                  | Required CriticMarkup experience                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Left sidebar                      | A **Comments and Suggestions** tab sits alongside Files, Search, and Table of Contents. It includes standalone highlights as well as suggestions and comments, with recognizable text and visible comment bodies. It uses the existing sidebar's opening, switching, resizing, and theme behavior. A second right-hand review panel is not the product design.                                                                                       |
| Document and selection tools      | Suggestions and highlights are visible and remain editable in context. Selecting text exposes relevant authoring actions through the existing selection tools and context menu. Standalone comments have a discoverable location without exposing their hidden payload as ordinary document text. Working with annotations preserves normal caret, selection, typing, and formatting behavior.                                                       |
| Menus, commands, and keyboard     | Relevant authoring, tracking, review, and display actions participate in MarkText's existing menus, command discovery, and keyboard conventions. Enabled and selected states reflect the current document, selection, and mode. A separate strip of review buttons is not the only way to use the feature.                                                                                                                                           |
| Review and comment editing        | Selecting an entry reveals its document target; selecting an annotation keeps the sidebar's active item consistent. Previous/Next navigate identifiable items, and actions make their target clear. Comments are readable and editable in the normal sidebar flow. Accept/reject apply to suggestions; standalone highlights and comments have appropriate removal actions. Passive caret movement does not unexpectedly open panels or steal focus. |
| View modes and document lifecycle | Markup is the editable document. Original and Revised show a single, clearly identified read-only projection of that same document. Switching modes never overlaps views or changes source. Authoring and resolution participate in ordinary undo/redo, Source handoff, save/reopen, tab isolation, and recovery.                                                                                                                                    |
| Presentation and accessibility    | Reuse MarkText's typography, spacing, icons, controls, themes, focus treatment, and localization conventions. Mouse and keyboard users can discover and operate the same actions. Sidebar visibility, narrow windows, scrolling, and focus/typewriter modes remain coherent.                                                                                                                                                                         |

Verify this through a complete editorial pass in the normal installed Mac app: open an
annotated document, find its comments, select text and add a comment or suggestion,
mark a highlight, navigate and resolve items, undo and redo, compare Original/Revised,
then save and reopen. Use the actual menus, selection tools, sidebar, and keyboard
interactions, and inspect the rendered result. Engine tests and command-routing tests
alone cannot establish this experience. Make macOS work first; retain the other
platform requirements in plan 0012.

## Who suggests

Humans (co-authors, editors), external tools, and AI are the same to the document: each
proposes a change or comment by writing CriticMarkup, and each is reviewed the same way.
The integration privileges no source of suggestions.

## Non-goals

- **No author attribution — we neither emit nor parse it.** Note the honest version: the spec
  _does_ bless a place for it. Multi-author change tracking "through the use of comments" is a
  stated design goal, and a comment "may include a note, time stamp, author initial or similar
  annotation … used however you like." So `{>>@chris<<}` is already a legal comment we preserve
  byte-exactly. What the spec deliberately does **not** define is a _format_, and three verified
  facts make building one a mistake:
  1. **There is nothing to conform to.** Implementations in the wild spell it at least eight
     mutually incompatible ways (`@tag`, `author: X, date: Y`, `Name:`, `[author=X]`,
     `author|date:`, …). No implementation parses another's, so adopting one buys recognition in
     at most one tool and literal prose everywhere else.
  2. **Permitting is free; parsing is the harm.** Preserving what an author types costs nothing.
     _Parsing_ it means reinterpreting prose we didn't write — `{>>ask @bob about this<<}` and
     `{>>Maya Chen: source for these?<<}` are indistinguishable from author fields under real
     grammars. _Emitting_ it buries genuine reviewer comments in unparseable machine noise.
  3. **It cannot survive resolution.** Accepting or rejecting a change erases the comment that
     described it, so attribution parked there vanishes exactly when the change is resolved. A
     feature that deletes its own data is not a feature.

  So: comments carrying initials or dates are ordinary comments, preserved exactly and never
  interpreted. Real attribution belongs to a host or transport layer that has somewhere durable
  to put it — not to the document.

- **No comment threads or replies.** Reply-by-adjacency (a comment touching another mark) is the
  only pure-CriticMarkup candidate, but it is not an adopted convention — the two tools that
  implement it disagree on the rule, and it would encode meaning in the _absence_ of whitespace,
  which a serializer could silently create or destroy. Comments are flat.
- **No real-time co-editing.** No live cursors, presence, or CRDT sync. CriticMarkup is
  asynchronous, in-document review, not multiplayer editing.
- **Not a version-control or diff/merge tool.** CriticMarkup is in-document suggestion, not
  a git replacement or three-way merge.
- **Not the editor's whole vision.** Focus mode, math, diagrams, themes, and the rest belong
  to the upstream MarkText project.

## Where the CriticMarkup documents live

The CriticMarkup work spans several documents; they differ by **role**, not by subject:

| Role                                                                                   | Document                                                                |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Why** — this vision                                                                  | `specs/vision/criticmarkup-vision.md`                                   |
| **Decisions** — binding, hard to reverse                                               | Semantic/product ADRs `0001`–`0005`, `0007`–`0010`, and `0013`–`0015`   |
| **What the language means** — semantic target, with historical proposals distinguished | `specs/language/marktext-markdown-profile-1.md`                         |
| **How it fits MarkText** — ownership and upstream reuse                                | `specs/architecture/criticmarkup-native-integration.md`                 |
| **How we get there** — the integration plan                                            | `specs/plans/0012-criticmarkup-upstream-integration-review.md`          |
| **Vocabulary**                                                                         | `CONTEXT.md`                                                            |
| **Evidence** — upstream research answering a specific question                         | `specs/architecture/criticmarkup-host-markdown-interaction-evidence.md` |

The architecture lives in the active ADRs, `specs/architecture/criticmarkup-native-integration.md`,
and this vision. Plans 0009, 0010 and 0011 are archived incomplete; their remaining product
requirements continue in plan 0012.
The proposed CriticMarkup Metadata Extension is a separate future milestone; this
vision defines the CM1 integration and does not erase its research or domain decisions.
ADRs 0006,
0011, and 0012 record plan-0009 implementation designs and are not active target
authority. Research and evidence may explain a ruling, but no prior implementation
defines target behavior.

## North star

Run a complete editorial pass — receive suggestions and comments, weigh them, accept or
reject each — through MarkText’s familiar WYSIWYG editor and native UI, with zero perceptible lag,
and save a byte-exact document
that is nothing but standard Markdown and CriticMarkup any other tool can open.
