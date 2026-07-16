# Native CriticMarkup review and Track Changes

MarkText now speaks [CriticMarkup](https://github.com/CriticMarkup/CriticMarkup-toolkit) natively. Suggested edits, highlights, and comments are stored as plain markup in the Markdown file itself — `{++insertions++}`, `{--deletions--}`, `{~~old~>new~~}` substitutions, `{==highlights==}`, and `{>>comments<<}` — so review works across editors, diffs, and version control with no sidecar files and no proprietary metadata.

**:cactus:Feature**

- All five CriticMarkup forms parse natively and render as review items. Marks in code spans, code blocks, and other literal Markdown contexts stay literal.
- **Track Changes** records ordinary edits as markup: typing, deleting, replacing, cut/paste across paragraphs, multi-paragraph paste, and paragraph split/join. Each tracked edit is one undo step, and Original/Revised always reflect the exact before/after text. An edit that cannot be recorded exactly is refused with a localized "Edit not recorded" banner instead of silently doing nothing — the document is never left half-changed.
- New **Review** menu: mark additions, deletions, replacements, highlights, and comments; step through changes; accept or reject the current item or all items.
- New **Review** sidebar panel listing every item with per-item Accept/Reject, plus explicit **Remove comment** / **Remove highlight** actions for annotations (accepting and rejecting an annotation mean the same thing, so there is one button, not two).
- Clicking a mark in the text opens a floating Accept/Reject (or Remove) tool; nested marks resolve innermost-first.
- Three views via **Review** → **Display**: **Markup** (editable, marks visible), **Original** (read-only, all suggestions rejected), and **Revised** (read-only, all suggestions accepted).
- Save and autosave always write the canonical markup regardless of the active view. Copy and HTML/PDF/print export follow the view you are looking at; **Copy as Markdown** always copies the raw markup. Source Code Mode shows the raw markup and disables Review until you leave it.
- Full keyboard operation and screen-reader support: every Review control is keyboard-reachable, rejection notices are announced via a live region, and all Review commands are user-assignable in `keybindings.json` (no default shortcuts, so nothing collides with your bindings).

**Notes**

- Pure CriticMarkup only: no authors, timestamps, threads, or IDs are ever written. Documents round-trip byte-exact, including BOM and CRLF line endings; CriticMarkup syntax is never rewritten on save.
- Nesting is preserved losslessly; display renders up to 64 nested levels (parse budget 128) and shows anything deeper as literal source with a diagnostic.
- Reconciling concurrent external edits to an open file is out of scope for this release.
