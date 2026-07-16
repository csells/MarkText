# CriticMarkup review

MarkText understands [CriticMarkup](https://github.com/CriticMarkup/CriticMarkup-toolkit), a plain-text convention for suggesting edits inside a Markdown file. Suggested changes, highlights, and comments live in the file itself as ordinary text, so they survive any editor, any diff tool, and any version control system. MarkText parses them natively, renders them as review items, and gives you a Track Changes mode plus a full accept/reject workflow on top.

## The five marks

| Mark | Syntax | Accept | Reject |
| --- | --- | --- | --- |
| Addition | `{++inserted text++}` | Keeps the text | Removes it |
| Deletion | `{--removed text--}` | Removes the text | Keeps it |
| Substitution | `{~~old~>new~~}` | Keeps `new` | Keeps `old` |
| Highlight | `{==highlighted text==}` | Keeps the text, removes the markers | Same as accept |
| Comment | `{>>a comment<<}` | Removes the annotation | Same as accept |

A substitution is always one review item, never a separate deletion and addition. Highlights and comments are annotations rather than changes: accepting and rejecting produce the same result, so MarkText presents a single **Remove** action for them instead of pretending there is a decision to make.

You can type the marks by hand anywhere in a document. Markdown context wins over CriticMarkup syntax: marks inside inline code, code blocks, and other literal Markdown ranges stay literal text and never become review items. Incomplete or malformed marks also remain ordinary text.

## Marking up a document

The **Review** menu holds the authoring commands. Each one enables when the current selection can support it:

- **Mark as Addition** wraps the selection in `{++...++}`.
- **Mark as Deletion** wraps the selection in `{--...--}`.
- **Suggest Replacement…** opens a dialog asking for replacement text and produces a `{~~old~>new~~}` substitution.
- **Highlight for Review** wraps the selection in `{==...==}`.
- **Add Comment…** opens a dialog asking for the comment and inserts `{==selection==}{>>comment<<}` (or a bare comment when nothing is selected).

The two dialogs return focus to the editor when they close. A pending dialog is cancelled, never applied blindly, if you switch to another tab first.

## Track Changes

**Review** → **Track Changes** records your ordinary edits as CriticMarkup instead of applying them directly. Typed text becomes an addition, deleted text becomes a deletion, and replacing a selection becomes a substitution. Typing consecutively extends the current addition rather than nesting new marks, and editing text that is already inside a pending addition changes that addition directly.

Structural edits are recorded too: cutting and pasting across paragraphs, pasting multiple paragraphs, replacing text that spans blocks, and splitting or joining paragraphs. Each tracked edit is a single undo step.

Every tracked edit keeps one exact guarantee: the **Original** view shows the document as it was before the edit, and the **Revised** view shows it as it will be after. Untouched text is never swept into a broader suggestion.

When Track Changes cannot record an edit while keeping that guarantee, it refuses the edit entirely. The document, your undo history, and your selection are left exactly as they were, and a banner titled "Edit not recorded" appears with the reason and what to do about it (usually: try a smaller edit, or turn Track Changes off for that one change). The banner never steals focus or opens a dialog, and screen readers announce it as an alert. There are no silent failures: if the document did not change, you were told why.

## Reviewing changes

### The Review menu

- **Previous Change** and **Next Change** step through the review items in the document. Navigation works in the Markup view.
- **Accept Change** and **Reject Change** resolve the item at the cursor. For a highlight or comment, either command removes the annotation, since both decisions mean the same thing there.
- **Accept All Changes** and **Reject All Changes** resolve everything at once.

### The Review sidebar

The sidebar has a **Review** panel alongside Files, Search, and the table of contents. It shows the item count, a **Track Changes** switch, and a picker for the three views. Every review item appears as a card labeled with its type (Addition, Deletion, Substitution, Highlight, Comment) and its text. Clicking a card focuses the mark in the document. Change cards carry **Accept Change** and **Reject Change** buttons; annotation cards carry **Remove comment** or **Remove highlight** instead.

### In the text

Clicking a mark in the editor (in the Markup view) opens a small floating tool next to it with **Accept** and **Reject** buttons, or a single **Remove** button for highlights and comments. Clicking inside nested marks targets the innermost item. Resolving from the keyboard hands focus back to the editor rather than leaving it stranded on the tool.

## Markup, Original, and Revised views

The **Review** → **Display** submenu (and the sidebar picker) switches between three views of the same document:

- **Markup** is the editable document with all marks visible. This is the normal working view.
- **Original** shows the document with every suggestion rejected: the text as it stood before the proposed changes.
- **Revised** shows the document with every suggestion accepted: the text as it will read.

Original and Revised are read-only projections. Previous/Next navigation and the in-text tool operate in the Markup view; resolving an item from the sidebar while in another view returns you to Markup first.

Whatever view is active, **save and autosave always write the canonical markup**. Switching to Revised and saving does not accept anything; the marks stay in the file until you resolve them. The word counter follows the same rule and counts the canonical text, marks included.

## Copy, export, and source mode

Text you copy and documents you export follow the view you are looking at:

- Normal copy and cut in the Markup view put the raw Markdown, marks included, on the clipboard, so pasting elsewhere is lossless. In Original or Revised they copy the projected text you see.
- **Copy as Markdown** always copies the raw markup regardless of view.
- HTML export, PDF export, and print render the active view: Markup produces review-styled HTML with insertions and deletions visibly marked, while Original and Revised produce the clean projected document. Exported and printed HTML is sanitized; comment text is treated as text, never as live HTML.
- Search looks through the text of the active view: canonical text with markers in Markup, projected text in Original and Revised.

**Source Code Mode** shows the canonical Markdown with marks as plain text you can edit freely. Review commands are disabled while source mode owns the document, and the sidebar reports "Review is unavailable in this view." Leaving source mode brings Review back with a fresh snapshot of the items.

## Keyboard access and screen readers

Every Review control is reachable and operable from the keyboard: the menu commands, the sidebar's switch, view picker, cards, and buttons, and the in-text tool. The Review commands ship without default shortcuts to avoid colliding with your existing bindings; assign your own in `keybindings.json` using the `review.*` command IDs on macOS, Windows, or Linux. Review controls expose proper names, roles, and states to assistive technology, and Track Changes rejection notices are announced through a live region without moving your focus.

## Sharing files with other tools

MarkText writes pure CriticMarkup and nothing else. No author names, timestamps, comment threads, IDs, or metadata of any kind are added to the file, so there is nothing proprietary to strip before sharing. Any CriticMarkup-aware tool can process the file, and any plain editor can read it.

Round-trips are byte-exact: opening a document containing CriticMarkup and saving it reproduces the same bytes, including BOM and CRLF line endings, until you actually change something. CriticMarkup syntax is never normalized, sanitized, or rewritten on save. (MarkText's few pre-existing Markdown normalizations, which predate this feature, still apply to the surrounding Markdown as before.)

## Deep nesting and large documents

Nested marks are parsed, preserved, and resolvable. MarkText itself never creates nested marks when authoring; support exists so that files containing them survive intact. The parser follows nesting to a depth budget of 128 levels, and the editor renders up to 64 nested levels. Marks nested deeper than that are displayed as literal source text with a diagnostic explaining why. No bytes are dropped: saving, copying as Markdown, and source mode still carry the complete document, and other editors may treat deeply nested forms as plain text anyway.

## Out of scope in this release

Reconciling concurrent external edits, where another program rewrites a reviewed file while MarkText has it open, is deliberately out of scope for this release. Review assumes MarkText is the writer for the document you are working on.
