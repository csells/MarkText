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

Named exception, by owner decision (plan 0012 G11, G24): to match upstream
MarkText, an untracked edit inside a table rewrites that table's pipes, cell
padding and delimiter row. That respelling never removes text. A row's cells
beyond the header's columns, which upstream drops, stay as written after the
row's last column. Tracked edits never re-pad.
