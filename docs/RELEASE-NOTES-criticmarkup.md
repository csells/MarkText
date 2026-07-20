# Native CriticMarkup review and Track Changes

> **Draft target release notes—not current branch behavior.** Publish these only
> after plans 0006, 0007, and 0009 close against their final automated gates.
> The current branch still lacks parts of the contract, including the persistent
> hidden-sidebar mouse entry, source-authoritative exact persistence,
> session-owned raw Comment drafts, and the 16,384/16,385 resource boundary.

MarkText now speaks [CriticMarkup](https://github.com/CriticMarkup/CriticMarkup-toolkit) natively. Suggested edits, highlights, and comments are stored as plain markup in the Markdown file itself — `{++insertions++}`, `{--deletions--}`, `{~~old~>new~~}` substitutions, `{==highlights==}`, and `{>>comments<<}` — so review works across editors, diffs, and version control with no sidecar files and no proprietary metadata.

**:cactus:Feature**

- All five CriticMarkup forms parse natively; forms in the main document/CM-arm tree render as Review items. Nested CM inside a Comment stays lossless raw outer-payload content instead. Marks in code spans, code blocks, and other literal Markdown contexts stay literal.
- **Track Changes** records ordinary edits as markup: typing, deleting, replacing, cut/paste across paragraphs, multi-paragraph paste, and paragraph split/join. Each tracked edit is one undo step, and Original/Revised always reflect the exact before/after text. An edit that cannot be recorded exactly is refused with a localized "Edit not recorded" banner instead of silently doing nothing — the document is never left half-changed.
- New **Review** menu: mark additions, deletions, replacements, highlights, and comments; step through changes; accept or reject the current item or all items.
- New **Review** sidebar panel listing every main-document Review item with per-item Accept/Reject, plus explicit **Remove comment** / **Remove highlight** actions for annotations (accepting and rejecting an annotation mean the same thing, so there is one button, not two). Add Comment requires selected text and opens a sidebar composer; activating a comment card edits it in place. Nested CM inside a Comment remains lossless raw outer-payload content and is edited through that outer card or Source mode, not promoted to unreachable child cards.
- Review remains mouse-accessible when the entire sidebar is hidden: a persistent editor-shell Review control sits outside the collapsible panel/rail, while the visible rail icon remains a second pointer path. Opening it preserves the editor selection.
- Clicking a suggestion or plain highlight in the text opens a floating Accept/Reject (or Remove) tool; nested marks resolve innermost-first. Comment syntax and bodies stay hidden in the editor: the caret skips that hidden content, anchored text is highlighted with an indicator, selection is passive, and **Edit Comment** is available from the anchor's native right-click menu.
- **Remove comment** removes an anchored comment's two annotation wrappers while retaining its prose. Deleting all of that prose through ordinary editing instead preserves `{>>comment<<}` as a sidebar point comment; source-authored and imported bare comments work the same way.
- Three views via **Review** → **Display**: **Markup** (editable, marks visible), **Original** (read-only, all suggestions rejected), and **Revised** (read-only, all suggestions accepted).
- Save and autosave always write the canonical markup regardless of the active view. Copy and HTML/PDF/print export follow the view you are looking at; **Copy as Markdown** always copies the raw markup. Source Code Mode shows the raw markup and disables Review until you leave it.
- Every Review command is available from the native Review menu and the command palette, and all Review commands are user-assignable in `keybindings.json` (no default shortcuts, so nothing collides with your bindings).

**Notes**

- Pure CriticMarkup only: no authors, timestamps, threads, or IDs are ever written. The document engine preserves the exact decoded UTF-16 source—including BOM units, CRLF/bare-CR/LF spelling, blank lines, and final-newline choice—and normalization is available only as an explicit transform.
- Nesting is preserved losslessly; Add Comment can nest around an existing complete mark or within one of its semantic arms. The `desktop-v1/syntax-accounting-1` budget serves a depth-16,384 document completely. Crossing the frozen 16,385 boundary enters typed SourceOnly mode: exact source editing and persistence remain available, while every semantic renderer or Review consumer is unavailable rather than showing misleading literal fallback.
- Reconciling concurrent external edits to an open file is out of scope for this release.
