# Canonical source is lossless

The parser core preserves the exact decoded canonical source, including a
leading U+FEFF retained from a file BOM, line-ending style, blank lines,
terminal-EOL absence, CriticMarkup spelling, escapes, and untouched trivia. The
desktop file layer separately owns original bytes, encoding, BOM provenance,
and EOL policy. Opening and saving without an edit is byte-exact. An edited save
encodes the canonical source under the declared policy without duplicating or
dropping a leading U+FEFF or rewriting unrelated source.

Grammar treats a leading source U+FEFF according to the ratified Profile 1 rule;
later U+FEFF units are ordinary text. No parser, serializer, or consumer
normalizes Unicode, line endings, markers, or trivia implicitly. Normalization
is permitted only as an explicit document transformation. Hash algorithms,
framing, snapshot fields, and save implementation are versioned implementation
details, not language semantics.

Typing never re-spells source it does not change (owner decision): an edit
inside a table or paragraph changes only what was typed. Explicit
commands are explicit transformations and may re-spell the structure they act
on, as upstream MarkText does: table commands (insert or delete a row or
column, alignment) re-pad their table, and list Tab/Shift+Tab renumber the
following ordered items and remove blank lines where the item joins a tight
list (upstream #5349). They never remove text; a row's cells beyond the
header's columns stay as written. Tracked edits never re-pad.
