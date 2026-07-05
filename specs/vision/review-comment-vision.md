# Vision: MarkText With Portable Inline Review

MarkText should become a serious review surface for Markdown-based work: specs, plans, design docs, README files, and agent-authored artifacts. The editor must support source mode and WYSIWYG mode without making comments visible noise reading or writing via a UX just like Google Docs.

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
