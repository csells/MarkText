# Vision: MarkText With Portable Inline Review

MarkText should become a serious review surface for Markdown-based work: specs, plans, design docs, README files, and agent-authored artifacts. The editor must support source mode and WYSIWYG mode without making comments visible noise reading or writing via a UX just like Google Docs.

## The Bar (non-negotiable product quality)

These four demands define "done" for the review feature; anything below this
bar is not shippable:

1. **First-class parser syntax.** The Markdown extensions that carry review
   data — the `<!--MC:id-->` inline markers and the `[MC:id]:` metadata
   definitions — are pushed down into the base Markdown parser as first-class
   syntax (block-level and inline tokenizers), not recognized by side-scans
   and special cases layered on top of it. One module owns the grammar; every
   consumer (engine, source mode, agent tooling) derives from it.
2. **Bulletproof comment data manipulation.** No data loss, no corruption, no
   silent normalization of comment bytes on any path: typing, backspace/
   delete, cut/copy/paste, undo/redo, search, source-mode round-trips,
   save/reload, and merges. Byte-exact preservation wherever it is promised.
3. **Polished, exemplary UX.** The review surface blends in seamlessly as a
   native part of MarkText: correct under every theme, localized in every
   shipped language, keyboard-accessible, with the affordances (scroll-sync,
   focus handoff, file identification, empty states) a Google-Docs-quality
   reviewer expects.
4. **Robust agent collaboration.** An agent editing the loaded file on disk
   has its changes properly, correctly, robustly merged into the user's
   current document — automatically when the edits don't overlap, and through
   a polished, seamlessly blended merge-assist UI when they do.

Backwards compatibility is explicitly not a constraint while these initial
versions are hammered out: rearchitecture and redesign in service of the bar
are always in scope. `specs/architecture/` records the technical contracts
that implement this vision.

The first-class workflow is:

1. Open a Markdown file from the local filesystem.
2. Select text in the WYSIWYG editor and add a comment.
3. See comment threads in a sidebar, linked to highlighted ranges in the document.
4. Edit, reply, resolve, or reopen threads.
5. Save a plain `.md` file that carries all comment data with it.
6. Let Git, branches, pull requests, and agents handle collaboration using normal files.
7. When an agent edits a loaded Markdown file on disk, MarkText auto-syncs the clean editor view from the filesystem so the human reviewer sees agent changes without manually reloading.

## Canonical Comment Model

The Markdown file is the source of truth. There are no JSON sidecars, databases, MCP servers, daemon-only stores, or hidden project metadata required to preserve comments.

Comment ranges use compact HTML comments embedded directly around the selected text:

```md
This paragraph has <!--MC:cmt_123-->reviewed text<!--MC:~cmt_123--> inside it.
```

`<!--MC:id-->` opens a comment range. `<!--MC:~id-->` closes that same range. Explicit close IDs are required so overlapping comments can be represented:

```md
<!--MC:a-->alpha <!--MC:b-->beta<!--MC:~a--> gamma<!--MC:~b-->
```

Thread metadata belongs in Markdown reference-style definitions near the bottom of the file, using the same ID:

```md
[MC:cmt_123]: data:application/json;base64,...
```

Metadata may include status, authors, timestamps, and replies. It must not store anchor offsets or repair positions. The markers are the anchors.

### Hidden syntax is untouchable in WYSIWYG

In WYSIWYG mode both the inline markers (`<!--MC:id-->` / `<!--MC:~id-->`) and
the metadata definition lines (`[MC:id]: data:...`) render as zero-size hidden
regions. **The caret must never be able to enter, cross into, or type inside any
of them, by any means** — arrow keys, word/line/document jumps (including ⌘↓ /
Down-arrow to end-of-document, where the metadata block usually sits), mouse
click, select-all-then-collapse, or programmatic cursor restore. The document,
for the purpose of the caret, ends at the last *visible* content; the trailing
hidden metadata is not a place the user can go. This raw syntax is editable only
in source mode. This is a hard, general invariant — enforce it at the navigation
and cursor-placement layer, not as one-off patches per key.

## Agent Experience

Agents should not need a long-running server or editor-specific process to participate. A project-provided skill with scripts should parse Markdown, validate comment structure, and output JSON for agent workflows such as `list`, `reply`, and `resolve`. The agents use the skill (and the scripts) to write back to the `.md` file as well.
