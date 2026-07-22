# CriticMarkup review

> **Target documentation—not current branch behavior.** This guide describes
> the product contract that plan 0009 requires. The current
> `feat/native-criticmarkup` implementation does not yet satisfy every claim,
> including the persistent mouse path from a fully hidden sidebar, the
> source-authoritative/no-normalization engine, session-owned Comment drafts and
> raw-payload editing, and the 16,384/16,385 Complete/SourceOnly boundary. Do not
> publish this as a completed user guide until plan 0009's automated definition
> of done passes.

MarkText understands [CriticMarkup](https://github.com/CriticMarkup/CriticMarkup-toolkit), a plain-text convention for suggesting edits inside a Markdown file. Suggested changes, highlights, and comments live in the file itself as ordinary text, so they survive any editor, any diff tool, and any version control system. MarkText parses them natively, renders them as review items, and gives you a Track Changes mode plus a full accept/reject workflow on top.

## The five marks

| Mark         | Syntax                   | Accept                              | Reject         |
| ------------ | ------------------------ | ----------------------------------- | -------------- |
| Addition     | `{++inserted text++}`    | Keeps the text                      | Removes it     |
| Deletion     | `{--removed text--}`     | Removes the text                    | Keeps it       |
| Substitution | `{~~old~>new~~}`         | Keeps `new`                         | Keeps `old`    |
| Highlight    | `{==highlighted text==}` | Keeps the text, removes the markers | Same as accept |
| Comment      | `{>>a comment<<}`        | Removes the annotation              | Same as accept |

A substitution is always one review item, never a separate deletion and addition. Highlights and comments are annotations rather than changes: accepting and rejecting produce the same result, so MarkText presents a single **Remove** action for them instead of pretending there is a decision to make.

You can type active marks by hand in Source Code Mode or another raw Markdown editor. Ordinary WYSIWYG typing is semantic text: marker-looking characters are protected as literals unless Track Changes or a direct Review command intentionally authors a mark. The raw Comment editor likewise accepts nested syntax only inside that Comment payload. Markdown context wins over CriticMarkup syntax, so marks inside inline code, code blocks, and other literal Markdown ranges stay literal text and never become review items. Unmatched delimiters and an invalid outer candidate remain literal source. If that malformed outer text contains a complete, properly nested CriticMarkup item, MarkText promotes that complete descendant as a Review item and reports the malformed surrounding syntax without changing any source bytes.

## Marking up a document

The **Review** menu holds the authoring commands. Each one enables when the current selection can support it:

- **Mark as Addition** wraps the selection in `{++...++}`.
- **Mark as Deletion** wraps the selection in `{--...--}`.
- **Suggest Replacement…** opens a dialog asking for replacement text and produces a `{~~old~>new~~}` substitution.
- **Highlight for Review** wraps the selection in `{==...==}`.
- **Add Comment…** requires selected text, opens a composer in the Review sidebar, and inserts `{==selection==}{>>comment<<}` when you submit it.

The replacement dialog and sidebar composer return focus to the editor when they close. A pending Comment draft stays with its document when you switch tabs, hide Review, or unmount the sidebar. When you return, MarkText rebases only a provably unchanged target; otherwise it keeps the exact draft and explains that the target is stale. It is never cancelled or applied blindly by a context switch. MarkText can read and preserve a bare `{>>comment<<}` typed in source mode or imported from another tool, but the Add Comment command never creates one without an anchor.

## Track Changes

**Review** → **Track Changes** records your ordinary edits as CriticMarkup instead of applying them directly. Typed text becomes an addition, deleted text becomes a deletion, and replacing a selection becomes a substitution. Typing consecutively extends the current addition rather than nesting new marks, and editing text that is already inside a pending addition changes that addition directly.

Structural edits are recorded too: cutting and pasting across paragraphs, pasting multiple paragraphs, replacing text that spans blocks, and splitting or joining paragraphs. Each tracked edit is a single undo step.

Every tracked edit keeps one exact guarantee: the **Original** view shows the document as it was before the edit, and the **Revised** view shows it as it will be after. Source outside the smallest grammar-safe target stays untouched. When you edit inside a Markdown literal, that target may be the complete code span, HTML tag, link, math node, block, or other parser-owned literal needed to keep both versions valid.

When Track Changes cannot record an edit while keeping that guarantee, it refuses the edit entirely. The document, your undo history, and your selection are left exactly as they were, and a banner titled "Edit not recorded" appears with the reason and what to do about it (usually: try a smaller edit, or turn Track Changes off for that one change). The banner never steals focus or opens a dialog. There are no silent failures: if the document did not change, you were told why.

## Reviewing changes

### The Review menu

- **Previous Change** and **Next Change** step through the review items visible from the active view. Switching views keeps the same parser-owned target only when it remains visible there; otherwise focus moves deterministically to the next visible item at that source position, then the previous one, then the mapped editor position.
- **Accept Change** and **Reject Change** resolve additions, deletions, and substitutions. Highlights use **Remove Highlight**; comments use **Remove Comment**. MarkText does not present fake Accept/Reject aliases for annotations.
- **Accept All Changes** and **Reject All Changes** resolve everything at once.

### The Review sidebar

The sidebar has a **Review** panel alongside Files, Search, and the table of contents. It shows the item count, a **Track Changes** switch, and a picker for the three views. Every review item appears as a card labeled with its type (Addition, Deletion, Substitution, Highlight, Comment) and its semantic text; protective source escapes remain in the file but are not shown as part of the message. Activating a change or highlight card focuses its mark in the document. Activating a comment card opens its inline editor without moving the document. Change cards carry **Accept Change** and **Reject Change** buttons; annotation cards carry **Remove comment** or **Remove highlight** instead. Removing an anchored comment removes both annotation wrappers but keeps the anchored prose as ordinary text. The Comment editor edits the exact raw payload: nested CriticMarkup, Markdown-looking bytes, protective spelling, and line endings are intentional source. An empty payload or a candidate that closes, destroys, or retargets the outer Comment rejects with the exact draft retained.

You can always reach Review with the mouse. When the sidebar rail is visible, click its Review icon. When both the panel and rail are hidden, a persistent Review control remains in the editor shell outside the collapsible sidebar; clicking it opens Review without changing the editor selection or requiring a shortcut, command palette, or in-progress edit.

A Comment nested inside another Comment's raw payload is preserved as part of that outer payload, not promoted to a second Review card. Edit it through the outer card's raw-payload editor or Source mode. This is the deliberate exception to the one-card-per-Comment rule: the main document projections elide the whole outer Comment subdocument, so pretending its descendants were independently actionable would expose targets that do not exist in the active document view.

### In the text

In the Markup view, clicking an addition, deletion, substitution, or plain highlight opens a small floating tool next to it with **Accept** and **Reject**, or **Remove** for a highlight. Clicking inside nested marks targets the innermost item. Resolving from the keyboard hands focus back to the editor rather than leaving it stranded on the tool.

Comments stay out of the text flow: their markers and bodies are hidden, while an anchored comment appears as a distinct highlighted span with a comment indicator. The caret skips hidden comment content during mouse, keyboard, input-method, and restored-selection paths. Moving the caret into the visible anchor selects its sidebar card when no deeper visible Review item owns that exact hit; nested anchors select the innermost comment, and explicit parent focus stays put while it survives. Passive selection never opens or scrolls the sidebar. Edit a comment deliberately by activating its card or right-clicking its anchored span and choosing **Edit Comment**. On nested review text, the context menu keeps the deepest item's actions and also offers **Edit Comment** for the nearest containing comment anchor.

A bare `{>>comment<<}` is a point comment. It may come from source mode, another CriticMarkup editor, or ordinary editing that deletes every character of an existing comment's anchor. MarkText keeps that feedback in the sidebar instead of silently deleting it; undo restores the exact anchored pair. If an imported anchor contains a hidden nested Comment, whole-anchor deletion and the later partial edit that would exhaust the anchor both reject before pending-carrier or Track Changes policy is applied. Without a hidden Comment, the final partial deletion preserves residual non-Comment review nodes; tracked root-effective deletion wraps the exact current Highlight so Reject restores the immediately prior anchor. Use **Remove comment** when you intend to discard the comment itself.

## Markup, Original, and Revised views

The **Review** → **Display** submenu (and the sidebar picker) switches between three views of the same document:

- **Markup** is the editable review view. Suggestions and highlights are visible; comments appear as highlighted anchors and indicators while their marker syntax and bodies stay hidden. This is the normal working view.
- **Original** shows the document with every suggestion rejected: the text as it stood before the proposed changes.
- **Revised** shows the document with every suggestion accepted: the text as it will read.

Original and Revised are read-only projections. Previous/Next navigation uses the active view's parser-owned hit map, including text visible only in Original, and view switches preserve the active item only when it both survives and remains visible in the destination. Otherwise they use the same next-visible, previous-visible, then mapped-position fallback. The floating in-text editing tool appears only in editable Markup. Resolving from the sidebar or another command surface refreshes the active projection and maps focus to the surviving item or its defined neighbor; it does not force a switch to Markup.

Whatever view is active, **save and autosave always write the canonical markup**. Switching to Revised and saving does not accept anything; the marks stay in the file until you resolve them. The word counter follows the same rule and counts the canonical text, marks included.

## Copy, export, and source mode

Text you copy and documents you export follow the view you are looking at:

- Normal copy and cut in the Markup view put the raw Markdown, marks included, on the clipboard, so pasting elsewhere is lossless. In Original or Revised they copy the projected text you see.
- **Copy as Markdown** always copies the raw markup regardless of view.
- HTML export, PDF export, and print render the active view: Markup produces review-styled HTML with insertions and deletions visibly marked, plus numbered comments outside the prose flow; Original and Revised produce the clean projected document with comments elided. Exported and printed HTML is sanitized; comment text is treated as text, never as live HTML.
- Search looks through the text of the active view: canonical text with markers in Markup, projected text in Original and Revised.

**Source Code Mode** shows the canonical Markdown with marks as plain text you can edit freely. Review commands are disabled while source mode owns the document, and the sidebar reports "Review is unavailable in this view." Leaving source mode brings Review back with a fresh snapshot of the items.

## Keyboard access

Every Review command is available from the native Review menu and the command palette. The Review commands ship without default shortcuts to avoid colliding with your existing bindings; assign your own in `keybindings.json` using the `review.*` command IDs on macOS, Windows, or Linux.

## Sharing files with other tools

MarkText writes only Markdown and the five CriticMarkup forms. No author names, timestamps, comment threads, IDs, or private metadata are added, so there is nothing proprietary to strip before sharing and every plain editor can read the source. Other CriticMarkup tools can recognize the base forms, but processors disagree on nesting, empty or block-spanning forms, escapes, and Markdown-literal precedence; they may preserve or interpret MarkText Profile 1 documents differently.

The document engine keeps the exact decoded Markdown source as its authority. Saving, autosaving, source mode, and copying as Markdown read that source directly; they do not reconstruct it from the rendered editor or run a save-time normalization pass. Leading U+FEFF, internal CRLF/bare-CR/LF spelling, blank lines, protective escapes, and a missing final newline all remain exact unless you invoke an explicit transform. The desktop file adapter separately preserves or explicitly converts the file encoding. A brand-new empty document saves as an empty file rather than a lone newline.

## Deep nesting and large documents

Nested marks are parsed and preserved. Items in the main document/CM-arm tree are independently resolvable; a Comment nested inside another Comment remains actionable only through the outer raw-payload editor or Source mode, as described above. Add Comment and Mark Highlight may enclose complete existing marks or the complete visible value of a Markdown literal such as a code span; they refuse a selection that cuts a mark or literal boundary. With Track Changes on, editing inside code, math, HTML, or another literal records a change around the smallest complete Markdown owner instead of writing inert CriticMarkup bytes inside it.

Resource limits never turn a hidden Comment body into visible literal prose. The desktop profile accepts up to 16,384 nested CriticMarkup nodes and 128 nested Markdown block containers, alongside its source-size and syntax-event limits. Opening a larger document keeps every source unit available in Source mode and for exact saving but disables semantic views and rendering with an actionable SourceOnly diagnostic. An edit that would cross a limit rejects atomically and leaves the prior revision unchanged.

## Out of scope in this release

Reconciling concurrent external edits, where another program rewrites a reviewed file while MarkText has it open, is deliberately out of scope for this release. Review assumes MarkText is the writer for the document you are working on.
