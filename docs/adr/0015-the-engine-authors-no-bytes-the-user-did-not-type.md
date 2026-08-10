# Source edits transcribe source; projection edits preserve intended text

When the user edits canonical source, MarkText commits the decoded source units
they supplied and does not insert protective syntax on their behalf. Source mode
does not directly edit file bytes; the desktop file layer separately owns
encoding, BOM, and EOL policy. Marker-looking source becomes CriticMarkup where
the language recognizes it, and an author who wants a literal `{++` uses the
language's explicit mechanism.

This governs canonical-source editing. A projection edit is different: in
Markup mode the user supplies visible text and the engine chooses source that
preserves that text in the targeted language context. Any protective spelling
must be defined by the ratified language behavior, minimal, lossless, and visible
in Source mode. The transform must never silently preserve an obsolete parse at
the expense of the user's requested edit.

Backslash CriticMarkup escaping is a MarkText extension and code-span escaping is
the more portable authoring form; the UI must disclose this difference. A Source
edit never receives an engine-invented escape. A projection edit is admitted
atomically with its chosen spelling and exact source mapping; undo/redo replays
the admitted source edit rather than re-deciding how to encode it.
